import datetime as dt

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.db import Base, utcnow


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)

    settings: Mapped["UserSettings"] = relationship(back_populates="user", uselist=False)


class UserSettings(Base):
    __tablename__ = "user_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    debit_balance: Mapped[int] = mapped_column(Integer, default=0)
    credit_balance: Mapped[int] = mapped_column(Integer, default=0)
    cc_pay_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cc_pay_method_value: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cc_pay_amount_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cc_pay_amount_unit_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cc_apr_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cashflow_days: Mapped[int] = mapped_column(Integer, default=30)
    cashflow_view_filter: Mapped[str] = mapped_column(String(16), default="All")
    graph_view_type: Mapped[str] = mapped_column(String(16), default="Both")
    graph_end_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    safe_to_spend_days: Mapped[int] = mapped_column(Integer, default=14)
    debit_floor_target: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped["User"] = relationship(back_populates="settings")


class Bill(Base):
    __tablename__ = "bills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    amount: Mapped[int] = mapped_column(Integer)
    frequency: Mapped[str] = mapped_column(String(32))
    day: Mapped[str] = mapped_column(String(32))
    type: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class Income(Base):
    __tablename__ = "income"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    amount: Mapped[int] = mapped_column(Integer)
    frequency: Mapped[str] = mapped_column(String(32))
    day: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    type: Mapped[str] = mapped_column(String(16), default="Expense")


class Budget(Base):
    __tablename__ = "budgets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    amount: Mapped[int] = mapped_column(Integer)
    period: Mapped[str] = mapped_column(String(16), default="Monthly")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    date: Mapped[dt.date] = mapped_column(Date)
    name: Mapped[str] = mapped_column(String(255))
    amount: Mapped[float] = mapped_column(Float)
    type: Mapped[str] = mapped_column(String(16))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="manual")


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(32))
    balance: Mapped[int] = mapped_column(Integer, default=0)


class AlertSetting(Base):
    __tablename__ = "alert_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(32))
    threshold: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class BillPayment(Base):
    __tablename__ = "bill_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    bill_name: Mapped[str] = mapped_column(String(255))
    due_date: Mapped[dt.date] = mapped_column(Date)
    paid: Mapped[bool] = mapped_column(Boolean, default=False)
    paid_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class WeeklySummary(Base):
    __tablename__ = "weekly_summaries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    week_start: Mapped[dt.date] = mapped_column(Date)
    total_income: Mapped[float] = mapped_column(Float)
    total_spend: Mapped[float] = mapped_column(Float)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class ExportBackup(Base):
    __tablename__ = "export_backups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    payload: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
