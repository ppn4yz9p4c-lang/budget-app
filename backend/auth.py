import os
import datetime as dt
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from backend.db import SessionLocal
from backend.models import User


SECRET_KEY = os.environ.get("BUDGET_APP_SECRET", "dev_secret_change_me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 12

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(user_id: int) -> str:
    expire = dt.datetime.utcnow() + dt.timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _get_or_create_guest_user(db: Session) -> User:
    user = db.query(User).order_by(User.id.asc()).first()
    if user:
        return user
    user = User(
        email="guest@local",
        username="guest",
        password_hash=hash_password(os.urandom(16).hex()),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    if token:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = int(payload.get("sub") or 0)
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                return user
        except (JWTError, ValueError):
            pass
    return _get_or_create_guest_user(db)
