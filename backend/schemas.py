from typing import Any, Dict, List, Optional
from pydantic import BaseModel, EmailStr


class AuthRegister(BaseModel):
    email: EmailStr
    username: str
    password: str
    confirm_password: str


class AuthLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class StatePayload(BaseModel):
    debit_balance: Optional[int] = None
    credit_balance: Optional[int] = None
    cc_pay_day: Optional[int] = None
    cc_pay_method_value: Optional[str] = None
    cc_pay_amount_value: Optional[int] = None
    cc_pay_amount_unit_value: Optional[int] = None
    cc_apr_value: Optional[int] = None
    cashflow_days: Optional[int] = None
    cashflow_view_filter: Optional[str] = None
    graph_view_type: Optional[str] = None
    graph_end_date: Optional[str] = None
    safe_to_spend_days: Optional[int] = None
    debit_floor_target: Optional[int] = None
    bills: Optional[List[Dict[str, Any]]] = None
    income: Optional[List[Dict[str, Any]]] = None
    categories: Optional[List[Dict[str, Any]]] = None
    budgets: Optional[List[Dict[str, Any]]] = None
    alerts: Optional[List[Dict[str, Any]]] = None
    accounts: Optional[List[Dict[str, Any]]] = None


class CSVImportResult(BaseModel):
    imported: int
    skipped: int
