import datetime as dt
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from backend.models import Bill, Income, Transaction, UserSettings


def _as_date(value: Any) -> Optional[dt.date]:
    if isinstance(value, dt.date):
        return value
    if isinstance(value, dt.datetime):
        return value.date()
    try:
        return dt.datetime.fromisoformat(str(value)).date()
    except Exception:
        return None


def occurrences_for_entry(entry: Dict[str, Any], start_date: dt.date, days: int, is_income: bool) -> List[Any]:
    out = []
    end = start_date + dt.timedelta(days=days)
    freq = str(entry.get("frequency") or "").lower()
    name = entry.get("name", "")
    amt = int(entry.get("amount", 0))
    typ = (entry.get("type") or "").strip().lower()
    sign = 1 if is_income else (1 if typ == "credit" else -1)
    day = entry.get("day")

    if "biweekly" in freq:
        anchor = _as_date(day)
        if not anchor:
            return out
        occ = anchor
        if occ < start_date:
            k = ((start_date - occ).days + 13) // 14
            occ = occ + dt.timedelta(days=14 * k)
        while occ <= end:
            out.append((occ, amt * sign, name, entry))
            occ += dt.timedelta(days=14)
    elif "weekly" in freq:
        if isinstance(day, str):
            try:
                target = [
                    "monday",
                    "tuesday",
                    "wednesday",
                    "thursday",
                    "friday",
                    "saturday",
                    "sunday",
                ].index(day.lower())
            except Exception:
                target = start_date.weekday()
        elif hasattr(day, "weekday"):
            target = day.weekday()
        else:
            target = start_date.weekday()
        delta = (target - start_date.weekday()) % 7
        occ = start_date + dt.timedelta(days=delta)
        while occ <= end:
            out.append((occ, amt * sign, name, entry))
            occ += dt.timedelta(weeks=1)
    elif "monthly" in freq:
        try:
            dom = int(day)
        except Exception:
            dom = start_date.day
        year = start_date.year
        month = start_date.month
        while True:
            try:
                candidate = dt.date(year, month, min(dom, 28))
            except Exception:
                candidate = None
            if candidate and start_date <= candidate <= end:
                out.append((candidate, amt * sign, name, entry))
            if year > end.year or (year == end.year and month >= end.month):
                break
            if month == 12:
                year += 1
                month = 1
            else:
                month += 1
    elif "ann" in freq:
        anchor = _as_date(day)
        if anchor:
            occ = dt.date(start_date.year, anchor.month, anchor.day)
            if occ < start_date:
                occ = dt.date(start_date.year + 1, anchor.month, anchor.day)
            if start_date <= occ <= end:
                out.append((occ, amt * sign, name, entry))
    else:
        occ = _as_date(day)
        if occ and start_date <= occ <= end:
            out.append((occ, amt * sign, name, entry))
    return out


def credit_card_payment_amount(settings: UserSettings) -> Optional[int]:
    method = settings.cc_pay_method_value or "I want to pay my bill in full"
    if not method:
        return None
    credit_balance = int(settings.credit_balance or 0)
    if method in ["I pay in full", "I want to pay my bill in full"]:
        return max(0, credit_balance)
    if method in ["I pay the minimum", "Custom"]:
        unit = settings.cc_pay_amount_unit_value
        amount = settings.cc_pay_amount_value
        if unit is None or amount is None:
            return None
        if int(unit) == 1:
            return max(0, int(round(credit_balance * int(amount) / 100)))
        return max(0, int(amount))
    return None


def credit_card_bill_entry(settings: UserSettings) -> Optional[Dict[str, Any]]:
    if settings.cc_pay_day is None:
        return None
    amount = credit_card_payment_amount(settings) or 0
    return {
        "name": "Credit Card Bill",
        "amount": int(amount),
        "frequency": "Monthly",
        "day": int(settings.cc_pay_day),
        "type": "Debit",
        "auto": True,
    }


def _payment_amount_for_balance(settings: UserSettings, balance: int) -> int:
    method = settings.cc_pay_method_value or "I want to pay my bill in full"
    if method in ["I pay in full", "I want to pay my bill in full"]:
        return max(0, int(balance))
    if method in ["I pay the minimum", "Custom"]:
        unit = settings.cc_pay_amount_unit_value
        amount = settings.cc_pay_amount_value
        if unit is None or amount is None:
            return 0
        if int(unit) == 1:
            return max(0, int(round(int(balance) * int(amount) / 100)))
        return max(0, int(amount))
    return 0


def build_upcoming_libraries(db: Session, user_id: int, days: int = 1825) -> Dict[str, Any]:
    start = dt.date.today()
    debit_bills: List[Dict[str, Any]] = []
    credit_bills: List[Dict[str, Any]] = []
    incomes: List[Dict[str, Any]] = []
    debit_changes: Dict[dt.date, int] = {}
    credit_changes: Dict[dt.date, int] = {}
    income_changes: Dict[dt.date, int] = {}

    settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).first()
    if not settings:
        return {
            "upcoming_debit_bills": [],
            "upcoming_credit_bills": [],
            "upcoming_incomes": [],
            "debit_balance_forecast": [],
            "credit_balance_forecast": [],
        }

    bills = [
        {
            "name": b.name,
            "amount": b.amount,
            "frequency": b.frequency,
            "day": b.day,
            "type": b.type,
            "auto": False,
        }
        for b in db.query(Bill).filter(Bill.user_id == user_id).all()
    ]
    cc_bill = credit_card_bill_entry(settings)
    if cc_bill:
        bills.append(cc_bill)

    for bill in bills:
        if bill.get("auto"):
            continue
        typ = str(bill.get("type") or "").strip().lower()
        is_debit = typ != "credit"
        for occ_date, amt, name, _ in occurrences_for_entry(bill, start, days, is_income=False):
            entry = {"date": occ_date, "name": name, "amount": abs(int(amt))}
            if is_debit:
                debit_bills.append(entry)
                debit_changes[occ_date] = debit_changes.get(occ_date, 0) + int(amt)
            else:
                credit_bills.append(entry)
                credit_changes[occ_date] = credit_changes.get(occ_date, 0) + int(amt)

    for inc in db.query(Income).filter(Income.user_id == user_id).all():
        entry = {
            "name": inc.name,
            "amount": inc.amount,
            "frequency": inc.frequency,
            "day": inc.day,
            "type": "Credit",
        }
        for occ_date, amt, name, _ in occurrences_for_entry(entry, start, days, is_income=True):
            incomes.append({"date": occ_date, "name": name, "amount": abs(int(amt))})
            income_changes[occ_date] = income_changes.get(occ_date, 0) + int(amt)

    if cc_bill:
        cc_occurrences = [d for d, _, _, _ in occurrences_for_entry(cc_bill, start, days, is_income=False)]
        cc_dates = set(cc_occurrences)
        apr = max(0, int(settings.cc_apr_value or 0))
        monthly_rate = apr / 100 / 12
        credit_running = int(settings.credit_balance or 0)
        for i in range(days + 1):
            day = start + dt.timedelta(days=i)
            daily_credit = credit_changes.get(day, 0)
            credit_running += daily_credit
            if day in cc_dates:
                base_balance = credit_running - daily_credit
                pay_amount = _payment_amount_for_balance(settings, base_balance)
                if pay_amount > base_balance:
                    pay_amount = max(0, int(base_balance))
                remaining_base = max(0, int(base_balance - pay_amount))
                if pay_amount > 0:
                    debit_bills.append({"date": day, "name": "Credit Card Bill", "amount": pay_amount})
                    debit_changes[day] = debit_changes.get(day, 0) - pay_amount
                    credit_changes[day] = credit_changes.get(day, 0) - pay_amount
                    credit_running = remaining_base + daily_credit
                else:
                    credit_running = remaining_base + daily_credit
                if monthly_rate > 0 and remaining_base > 0:
                    interest = int(round(remaining_base * monthly_rate))
                    if interest > 0:
                        credit_changes[day] = credit_changes.get(day, 0) + interest
                        credit_running += interest

    debit_start = int(settings.debit_balance or 0)
    credit_start = int(settings.credit_balance or 0)
    debit_daily_changes: Dict[dt.date, int] = {}
    for day, delta in debit_changes.items():
        debit_daily_changes[day] = debit_daily_changes.get(day, 0) + delta
    for day, delta in income_changes.items():
        debit_daily_changes[day] = debit_daily_changes.get(day, 0) + delta

    debit_balance_series = []
    credit_balance_series = []
    debit_running = debit_start
    credit_running = credit_start
    for i in range(days + 1):
        day = start + dt.timedelta(days=i)
        debit_running += debit_daily_changes.get(day, 0)
        credit_running += credit_changes.get(day, 0)
        debit_balance_series.append({"date": day.isoformat(), "balance": int(debit_running)})
        credit_balance_series.append({"date": day.isoformat(), "balance": int(credit_running)})

    return {
        "upcoming_debit_bills": debit_bills,
        "upcoming_credit_bills": credit_bills,
        "upcoming_incomes": incomes,
        "debit_balance_forecast": debit_balance_series,
        "credit_balance_forecast": credit_balance_series,
    }


def safe_to_spend(db: Session, user_id: int, days: int) -> int:
    data = build_upcoming_libraries(db, user_id, days)
    balances = [item["balance"] for item in data.get("debit_balance_forecast", [])]
    if not balances:
        return 0
    return int(min(balances))


def recurring_suggestions(db: Session, user_id: int) -> List[Dict[str, Any]]:
    txs = db.query(Transaction).filter(Transaction.user_id == user_id).all()
    grouped: Dict[str, List[Transaction]] = {}
    for tx in txs:
        key = f"{tx.name}|{int(round(tx.amount, 0))}"
        grouped.setdefault(key, []).append(tx)
    suggestions = []
    for key, items in grouped.items():
        if len(items) < 3:
            continue
        items.sort(key=lambda x: x.date)
        gaps = [(items[i].date - items[i - 1].date).days for i in range(1, len(items))]
        avg_gap = sum(gaps) / len(gaps)
        if 12 <= avg_gap <= 16:
            freq = "Biweekly"
        elif 26 <= avg_gap <= 33:
            freq = "Monthly"
        elif 6 <= avg_gap <= 8:
            freq = "Weekly"
        else:
            continue
        suggestions.append({
            "name": items[-1].name,
            "amount": abs(int(round(items[-1].amount))),
            "frequency": freq,
            "day": items[-1].date.isoformat(),
            "type": "Debit" if items[-1].amount < 0 else "Credit",
        })
    return suggestions
