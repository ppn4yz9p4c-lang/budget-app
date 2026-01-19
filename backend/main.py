import csv
import io
import os
import datetime as dt
import re
from typing import Any, Dict, List

from authlib.integrations.starlette_client import OAuth
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from backend.auth import create_access_token, get_current_user, get_db, hash_password, verify_password
from backend.db import Base, engine
from backend.logic import build_upcoming_libraries, recurring_suggestions, safe_to_spend
from backend.models import (
    AlertSetting,
    Account,
    Bill,
    BillPayment,
    Budget,
    Category,
    Income,
    Transaction,
    User,
    UserSettings,
)
from backend.schemas import AuthLogin, AuthRegister, CSVImportResult, StatePayload, TokenResponse


Base.metadata.create_all(bind=engine)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth = OAuth()
google_client_id = os.environ.get("GOOGLE_CLIENT_ID")
google_client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
if google_client_id and google_client_secret:
    oauth.register(
        name="google",
        client_id=google_client_id,
        client_secret=google_client_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


def _ensure_settings(db: Session, user_id: int) -> UserSettings:
    settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    if settings:
        return settings
    settings = UserSettings(user_id=user_id)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


def _ensure_user_columns() -> None:
    with engine.connect() as conn:
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()}
        if "username" not in columns:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN username VARCHAR(64)")
        indexes = {row[1] for row in conn.exec_driver_sql("PRAGMA index_list(users)").fetchall()}
        if "ix_users_username" not in indexes:
            conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)")


def _validate_password(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if len(password.encode("utf-8")) > 128:
        raise HTTPException(status_code=400, detail="Password must be 128 bytes or less")
    if not re.search(r"[A-Z]", password):
        raise HTTPException(status_code=400, detail="Password must include an uppercase letter")
    if not re.search(r"[a-z]", password):
        raise HTTPException(status_code=400, detail="Password must include a lowercase letter")
    if not re.search(r"[0-9]", password):
        raise HTTPException(status_code=400, detail="Password must include a number")
    if not re.search(r"[^A-Za-z0-9]", password):
        raise HTTPException(status_code=400, detail="Password must include a symbol")


_ensure_user_columns()


def _ensure_settings_columns() -> None:
    with engine.connect() as conn:
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(user_settings)").fetchall()}
        if "debit_floor_target" not in columns:
            conn.exec_driver_sql("ALTER TABLE user_settings ADD COLUMN debit_floor_target INTEGER DEFAULT 0")
        if "cc_apr_value" not in columns:
            conn.exec_driver_sql("ALTER TABLE user_settings ADD COLUMN cc_apr_value INTEGER")


_ensure_settings_columns()


def _state_response(db: Session, user_id: int) -> Dict[str, Any]:
    settings = _ensure_settings(db, user_id)
    bills = db.query(Bill).filter(Bill.user_id == user_id).all()
    income = db.query(Income).filter(Income.user_id == user_id).all()
    categories = db.query(Category).filter(Category.user_id == user_id).all()
    budgets = db.query(Budget).filter(Budget.user_id == user_id).all()
    alerts = db.query(AlertSetting).filter(AlertSetting.user_id == user_id).all()
    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    return {
        "debit_balance": settings.debit_balance,
        "credit_balance": settings.credit_balance,
        "cc_pay_day": settings.cc_pay_day,
        "cc_pay_method_value": settings.cc_pay_method_value,
        "cc_pay_amount_value": settings.cc_pay_amount_value,
        "cc_pay_amount_unit_value": settings.cc_pay_amount_unit_value,
        "cc_apr_value": settings.cc_apr_value,
        "cashflow_days": settings.cashflow_days,
        "cashflow_view_filter": settings.cashflow_view_filter,
        "graph_view_type": settings.graph_view_type,
        "graph_end_date": settings.graph_end_date,
        "safe_to_spend_days": settings.safe_to_spend_days,
        "debit_floor_target": settings.debit_floor_target,
        "bills": [
            {
                "id": b.id,
                "name": b.name,
                "amount": b.amount,
                "frequency": b.frequency,
                "day": b.day,
                "type": b.type,
            }
            for b in bills
        ],
        "income": [
            {
                "id": i.id,
                "name": i.name,
                "amount": i.amount,
                "frequency": i.frequency,
                "day": i.day,
            }
            for i in income
        ],
        "categories": [
            {"id": c.id, "name": c.name, "type": c.type} for c in categories
        ],
        "budgets": [
            {"id": b.id, "category_id": b.category_id, "amount": b.amount, "period": b.period}
            for b in budgets
        ],
        "alerts": [
            {"id": a.id, "type": a.type, "threshold": a.threshold, "enabled": a.enabled}
            for a in alerts
        ],
        "accounts": [
            {"id": a.id, "name": a.name, "type": a.type, "balance": a.balance}
            for a in accounts
        ],
    }


@app.post("/api/auth/register", response_model=TokenResponse)
def register(payload: AuthRegister, db: Session = Depends(get_db)) -> TokenResponse:
    if not payload.username or not payload.username.strip():
        raise HTTPException(status_code=400, detail="Username is required")
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    _validate_password(payload.password)
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        email=payload.email,
        username=payload.username,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _ensure_settings(db, user.id)
    return TokenResponse(access_token=create_access_token(user.id))


@app.post("/api/auth/login", response_model=TokenResponse)
def login(payload: AuthLogin, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return TokenResponse(access_token=create_access_token(user.id))


@app.get("/api/auth/me")
def me(user: User = Depends(get_current_user)) -> Dict[str, Any]:
    return {"id": user.id, "email": user.email, "username": user.username}


@app.get("/api/auth/google/start")
async def google_start():
    if not google_client_id or not google_client_secret:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")
    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback")
    return await oauth.google.authorize_redirect(redirect_uri)


@app.get("/api/auth/google/callback")
async def google_callback(db: Session = Depends(get_db)):
    if not google_client_id or not google_client_secret:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")
    token = await oauth.google.authorize_access_token()
    user_info = token.get("userinfo")
    if not user_info:
        raise HTTPException(status_code=401, detail="Google login failed")
    email = user_info.get("email")
    sub = user_info.get("sub")
    user = db.query(User).filter(User.email == email).first()
    if not user:
        base_username = (email or "").split("@")[0] or f"user_{sub[:8]}"
        candidate = base_username
        if db.query(User).filter(User.username == candidate).first():
            candidate = f"{base_username}_{sub[:6]}"
        user = User(
            email=email,
            username=candidate,
            password_hash=hash_password(os.urandom(16).hex()),
            google_sub=sub,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        _ensure_settings(db, user.id)
    return TokenResponse(access_token=create_access_token(user.id))


@app.get("/api/state")
def get_state(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Dict[str, Any]:
    return _state_response(db, user.id)


@app.put("/api/state")
def put_state(
    payload: StatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    settings = _ensure_settings(db, user.id)
    data = payload.dict(exclude_unset=True)
    for key in [
        "debit_balance",
        "credit_balance",
        "cc_pay_day",
        "cc_pay_method_value",
        "cc_pay_amount_value",
        "cc_pay_amount_unit_value",
        "cc_apr_value",
        "cashflow_days",
        "cashflow_view_filter",
        "graph_view_type",
        "graph_end_date",
        "safe_to_spend_days",
        "debit_floor_target",
    ]:
        if key in data:
            setattr(settings, key, data[key])

    if data.get("bills") is not None:
        db.query(Bill).filter(Bill.user_id == user.id).delete()
        for item in data["bills"]:
            db.add(
                Bill(
                    user_id=user.id,
                    name=item.get("name", ""),
                    amount=int(item.get("amount", 0)),
                    frequency=item.get("frequency", ""),
                    day=str(item.get("day", "")),
                    type=item.get("type", "Debit"),
                )
            )

    if data.get("income") is not None:
        db.query(Income).filter(Income.user_id == user.id).delete()
        for item in data["income"]:
            db.add(
                Income(
                    user_id=user.id,
                    name=item.get("name", ""),
                    amount=int(item.get("amount", 0)),
                    frequency=item.get("frequency", ""),
                    day=str(item.get("day", "")),
                )
            )

    if data.get("categories") is not None:
        db.query(Category).filter(Category.user_id == user.id).delete()
        for item in data["categories"]:
            db.add(
                Category(
                    user_id=user.id,
                    name=item.get("name", ""),
                    type=item.get("type", "Expense"),
                )
            )

    if data.get("budgets") is not None:
        db.query(Budget).filter(Budget.user_id == user.id).delete()
        for item in data["budgets"]:
            db.add(
                Budget(
                    user_id=user.id,
                    category_id=int(item.get("category_id", 0)),
                    amount=int(item.get("amount", 0)),
                    period=item.get("period", "Monthly"),
                )
            )

    if data.get("alerts") is not None:
        db.query(AlertSetting).filter(AlertSetting.user_id == user.id).delete()
        for item in data["alerts"]:
            db.add(
                AlertSetting(
                    user_id=user.id,
                    type=item.get("type", "low_balance"),
                    threshold=int(item.get("threshold", 0)),
                    enabled=bool(item.get("enabled", True)),
                )
            )

    if data.get("accounts") is not None:
        db.query(Account).filter(Account.user_id == user.id).delete()
        for item in data["accounts"]:
            db.add(
                Account(
                    user_id=user.id,
                    name=item.get("name", ""),
                    type=item.get("type", "Checking"),
                    balance=int(item.get("balance", 0)),
                )
            )

    db.commit()
    return _state_response(db, user.id)


@app.get("/api/libraries")
def get_libraries(
    days: int = Query(1825, ge=1, le=1825),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    return build_upcoming_libraries(db, user.id, days=days)


@app.get("/api/safe_to_spend")
def get_safe_to_spend(
    days: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    settings = _ensure_settings(db, user.id)
    window = days or settings.safe_to_spend_days or 14
    return {"safe_to_spend": safe_to_spend(db, user.id, window), "days": window}


@app.get("/api/recurring/suggest")
def get_recurring_suggestions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    return recurring_suggestions(db, user.id)


@app.post("/api/transactions/import", response_model=CSVImportResult)
def import_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CSVImportResult:
    content = file.file.read().decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(content))
    imported = 0
    skipped = 0
    for row in reader:
        date_value = row.get("date") or row.get("Date")
        name = row.get("name") or row.get("description") or row.get("Description") or ""
        amount_value = row.get("amount") or row.get("Amount")
        if not date_value or amount_value is None:
            skipped += 1
            continue
        try:
            date = dt.datetime.fromisoformat(date_value).date()
        except Exception:
            try:
                date = dt.datetime.strptime(date_value, "%m/%d/%Y").date()
            except Exception:
                skipped += 1
                continue
        try:
            amount = float(amount_value)
        except Exception:
            skipped += 1
            continue
        tx = Transaction(
            user_id=user.id,
            date=date,
            name=name,
            amount=amount,
            type="Debit" if amount < 0 else "Credit",
            source="csv",
        )
        db.add(tx)
        imported += 1
    db.commit()
    return CSVImportResult(imported=imported, skipped=skipped)


@app.get("/api/transactions")
def get_transactions(
    start: str | None = None,
    end: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    query = db.query(Transaction).filter(Transaction.user_id == user.id)
    if start:
        query = query.filter(Transaction.date >= dt.datetime.fromisoformat(start).date())
    if end:
        query = query.filter(Transaction.date <= dt.datetime.fromisoformat(end).date())
    return [
        {
            "id": t.id,
            "date": t.date.isoformat(),
            "name": t.name,
            "amount": t.amount,
            "type": t.type,
            "category_id": t.category_id,
            "source": t.source,
        }
        for t in query.all()
    ]


@app.get("/api/checklist")
def get_checklist(
    days: int = Query(30, ge=1, le=1825),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    libraries = build_upcoming_libraries(db, user.id, days=days)
    items = []
    for bill in libraries.get("upcoming_debit_bills", []):
        due = bill["date"]
        payment = (
            db.query(BillPayment)
            .filter(
                BillPayment.user_id == user.id,
                BillPayment.bill_name == bill.get("name", ""),
                BillPayment.due_date == due,
            )
            .first()
        )
        items.append(
            {
                "bill_name": bill.get("name", ""),
                "due_date": due.isoformat() if hasattr(due, "isoformat") else str(due),
                "amount": bill.get("amount", 0),
                "paid": bool(payment.paid) if payment else False,
            }
        )
    return items


@app.post("/api/checklist/mark")
def mark_checklist(
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    bill_name = payload.get("bill_name", "")
    due_date = payload.get("due_date")
    paid = bool(payload.get("paid", True))
    if not bill_name or not due_date:
        raise HTTPException(status_code=400, detail="Missing bill_name or due_date")
    due = dt.datetime.fromisoformat(due_date).date()
    payment = (
        db.query(BillPayment)
        .filter(
            BillPayment.user_id == user.id,
            BillPayment.bill_name == bill_name,
            BillPayment.due_date == due,
        )
        .first()
    )
    if not payment:
        payment = BillPayment(user_id=user.id, bill_name=bill_name, due_date=due)
        db.add(payment)
    payment.paid = paid
    payment.paid_at = dt.datetime.utcnow() if paid else None
    db.commit()
    return {"ok": True}


@app.get("/api/alerts")
def get_alerts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    alerts = db.query(AlertSetting).filter(AlertSetting.user_id == user.id).all()
    results = []
    for alert in alerts:
        if alert.type == "low_balance":
            current = safe_to_spend(db, user.id, 14)
            if alert.enabled and current < alert.threshold:
                results.append(
                    {"type": "low_balance", "message": "Balance below threshold", "value": current}
                )
    return results


@app.get("/api/summary/weekly")
def weekly_summary(
    start: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    if start:
        start_date = dt.datetime.fromisoformat(start).date()
    else:
        today = dt.date.today()
        start_date = today - dt.timedelta(days=today.weekday())
    end_date = start_date + dt.timedelta(days=6)
    txs = (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id, Transaction.date >= start_date, Transaction.date <= end_date)
        .all()
    )
    income = sum(t.amount for t in txs if t.amount > 0)
    spend = sum(abs(t.amount) for t in txs if t.amount < 0)
    return {
        "week_start": start_date.isoformat(),
        "week_end": end_date.isoformat(),
        "total_income": round(income, 2),
        "total_spend": round(spend, 2),
    }


@app.get("/api/export")
def export_backup(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    return _state_response(db, user.id)


@app.post("/api/backup/upload")
def upload_backup(
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    settings = _ensure_settings(db, user.id)
    for key, value in payload.items():
        if hasattr(settings, key):
            setattr(settings, key, value)
    db.commit()
    return _state_response(db, user.id)
