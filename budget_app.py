import streamlit as st
import datetime as dt
import pandas as pd
import json
from pathlib import Path

# Helper: format ordinals (1 -> 1st, 2 -> 2nd, ...)
def ordinal(n):
    try:
        n = int(n)
    except Exception:
        return str(n)
    if 10 <= (n % 100) <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"

def _persist_debit_balance():
    st.session_state.debit_balance_saved = int(st.session_state.get("debit_balance", 0))
    save_state()

def _persist_credit_balance():
    st.session_state.credit_balance_saved = int(st.session_state.get("credit_balance", 0))
    save_state()

def _persist_cashflow_days():
    st.session_state.cashflow_days = int(st.session_state.get("cashflow_days", 30))
    save_state()

STATE_FILE = Path("budget_app_state.json")

def _serialize_day(value):
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    return value

def save_state():
    data = {
        "debit_balance": int(st.session_state.get("debit_balance", 0)),
        "credit_balance": int(st.session_state.get("credit_balance", 0)),
        "cc_pay_day": st.session_state.get("cc_pay_day"),
        "cc_pay_method_value": st.session_state.get("cc_pay_method_value"),
        "cc_pay_amount_value": st.session_state.get("cc_pay_amount_value"),
        "cc_pay_amount_unit_value": st.session_state.get("cc_pay_amount_unit_value"),
        "cashflow_days": int(st.session_state.get("cashflow_days", 30)),
        "bills": [],
        "income": []
    }
    for bill in st.session_state.get("bills", []):
        item = dict(bill)
        item["day"] = _serialize_day(item.get("day"))
        data["bills"].append(item)
    for inc in st.session_state.get("income", []):
        item = dict(inc)
        item["day"] = _serialize_day(item.get("day"))
        data["income"].append(item)
    try:
        STATE_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception:
        pass

def load_state():
    if not STATE_FILE.exists():
        return
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return
    if "debit_balance" in data:
        st.session_state.debit_balance = int(data.get("debit_balance", 0))
        st.session_state.debit_balance_saved = int(data.get("debit_balance", 0))
    if "credit_balance" in data:
        st.session_state.credit_balance = int(data.get("credit_balance", 0))
        st.session_state.credit_balance_saved = int(data.get("credit_balance", 0))
    if "bills" in data:
        st.session_state.bills = data.get("bills", [])
    if "income" in data:
        st.session_state.income = data.get("income", [])
    if data.get("cc_pay_day") is not None:
        st.session_state.cc_pay_day = int(data.get("cc_pay_day"))
        st.session_state.cc_day_input = int(data.get("cc_pay_day"))
    if data.get("cc_pay_method_value") is not None:
        st.session_state.cc_pay_method_value = data.get("cc_pay_method_value")
        st.session_state.cc_pay_method = data.get("cc_pay_method_value")
    if data.get("cc_pay_amount_value") is not None:
        st.session_state.cc_pay_amount_value = int(data.get("cc_pay_amount_value"))
        st.session_state.cc_pay_amount = int(data.get("cc_pay_amount_value"))
    if data.get("cc_pay_amount_unit_value") is not None:
        st.session_state.cc_pay_amount_unit_value = int(data.get("cc_pay_amount_unit_value"))
        st.session_state.cc_pay_amount_unit = int(data.get("cc_pay_amount_unit_value"))
    if data.get("cashflow_days") is not None:
        st.session_state.cashflow_days = int(data.get("cashflow_days"))


# ----------------------
# Helpers to compute upcoming occurrences for entries
# ----------------------
def _as_date(v):
    if isinstance(v, dt.date):
        return v
    if isinstance(v, dt.datetime):
        return v.date()
    try:
        return dt.datetime.fromisoformat(str(v)).date()
    except Exception:
        return None

def occurrences_for_entry(entry, start_date, days=30):
    out = []
    end = start_date + dt.timedelta(days=days)
    freq = (entry.get("frequency") or "").lower()
    name = entry.get("name", "")
    amt = int(entry.get("amount", 0))
    typ = entry.get("type", None)
    sign = -1 if typ and str(typ).lower().startswith("d") else 1
    if typ is None and entry in st.session_state.get("income", []):
        sign = 1
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
                target = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].index(day.lower())
            except Exception:
                target = start_date.weekday()
        elif hasattr(day, 'weekday'):
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
        # iterate months
        year = start_date.year
        month = start_date.month
        while True:
            try:
                candidate = dt.date(year, month, min(dom, 28))
            except Exception:
                candidate = None
            if candidate and start_date <= candidate <= end:
                out.append((candidate, amt * sign, name, entry))
            # advance month
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

def gather_events(start_date, days=30):
    events = []
    for b in st.session_state.get('bills', []):
        events.extend(occurrences_for_entry(b, start_date, days))
    for inc in st.session_state.get('income', []):
        events.extend(occurrences_for_entry(inc, start_date, days))
    events.sort(key=lambda x: x[0])
    return events

def _credit_card_payment_amount():
    method = st.session_state.get("cc_pay_method_value") or st.session_state.get("cc_pay_method")
    if not method:
        return None
    credit_balance = int(st.session_state.get("credit_balance", 0))
    if method in ["I pay in full", "I want to pay my bill in full"]:
        return max(0, credit_balance)
    if method in ["I pay the minimum", "Custom"]:
        unit = st.session_state.get("cc_pay_amount_unit_value")
        amount = st.session_state.get("cc_pay_amount_value")
        if unit is None or amount is None:
            return None
        if int(unit) == 1:
            return max(0, int(round(credit_balance * int(amount) / 100)))
        return max(0, int(amount))
    return None

def _credit_card_bill_entry():
    pay_day = st.session_state.get("cc_pay_day")
    amount = _credit_card_payment_amount()
    if pay_day is None or amount is None:
        return None
    return {
        "name": "Credit Card Bill",
        "amount": int(amount),
        "frequency": "Monthly",
        "day": int(pay_day),
        "type": "Debit",
        "auto": True
    }

def build_upcoming_libraries(days=730):
    start = dt.date.today()
    debit_bills = []
    credit_bills = []
    incomes = []
    debit_changes = {}
    credit_changes = {}
    income_changes = {}

    bills = list(st.session_state.get("bills", []))
    cc_bill = _credit_card_bill_entry()
    if cc_bill:
        bills.append(cc_bill)

    for bill in bills:
        if bill.get("auto"):
            continue
        typ = (bill.get("type") or "").lower()
        for occ_date, amt, name, _ in occurrences_for_entry(bill, start, days):
            entry = {"date": occ_date, "name": name, "amount": abs(int(amt))}
            if typ.startswith("d"):
                debit_bills.append(entry)
                debit_changes[occ_date] = debit_changes.get(occ_date, 0) + int(amt)
            else:
                credit_bills.append(entry)
                credit_changes[occ_date] = credit_changes.get(occ_date, 0) + int(amt)

    for inc in st.session_state.get("income", []):
        for occ_date, amt, name, _ in occurrences_for_entry(inc, start, days):
            incomes.append({"date": occ_date, "name": name, "amount": abs(int(amt))})
            income_changes[occ_date] = income_changes.get(occ_date, 0) + int(amt)

    if cc_bill:
        method = st.session_state.get("cc_pay_method_value") or st.session_state.get("cc_pay_method")
        cc_occurrences = [d for d, _, _, _ in occurrences_for_entry(cc_bill, start, days)]
        cc_amount = _credit_card_payment_amount()
        if method in ["I pay in full", "I want to pay my bill in full"]:
            credit_running = int(st.session_state.get("credit_balance", 0))
            cc_dates = set(cc_occurrences)
            for i in range(days + 1):
                day = start + dt.timedelta(days=i)
                daily_credit = credit_changes.get(day, 0)
                credit_running += daily_credit
                if day in cc_dates:
                    pay_amount = max(0, int(credit_running - daily_credit))
                    if pay_amount <= 0:
                        continue
                    debit_bills.append({"date": day, "name": "Credit Card Bill", "amount": pay_amount})
                    debit_changes[day] = debit_changes.get(day, 0) - pay_amount
                    credit_changes[day] = credit_changes.get(day, 0) - pay_amount
                    credit_running -= pay_amount
        elif cc_amount is not None:
            for occ_date in cc_occurrences:
                pay_amount = max(0, int(cc_amount))
                if pay_amount <= 0:
                    continue
                debit_bills.append({"date": occ_date, "name": "Credit Card Bill", "amount": pay_amount})
                debit_changes[occ_date] = debit_changes.get(occ_date, 0) - pay_amount
                credit_changes[occ_date] = credit_changes.get(occ_date, 0) - pay_amount

    debit_start = int(st.session_state.get("debit_balance", 0))
    credit_start = int(st.session_state.get("credit_balance", 0))
    debit_daily_changes = {}
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
        debit_balance_series.append({"date": day, "balance": int(debit_running)})
        credit_balance_series.append({"date": day, "balance": int(credit_running)})

    st.session_state.upcoming_debit_bills = debit_bills
    st.session_state.upcoming_credit_bills = credit_bills
    st.session_state.upcoming_incomes = incomes
    st.session_state.debit_balance_forecast = debit_balance_series
    st.session_state.credit_balance_forecast = credit_balance_series



# ----------------------
# Session State Initialization
# ----------------------
if "bills" not in st.session_state:
    st.session_state.bills = []

if "income" not in st.session_state:
    st.session_state.income = []

if "editing_bill_index" not in st.session_state:
    st.session_state.editing_bill_index = None

if "editing_income_index" not in st.session_state:
    st.session_state.editing_income_index = None

if "show_add_bill" not in st.session_state:
    st.session_state.show_add_bill = False

if "show_add_income" not in st.session_state:
    st.session_state.show_add_income = False

# Add form version counters to force fresh widget instances after save
if "bill_form_version" not in st.session_state:
    st.session_state.bill_form_version = 0
if "income_form_version" not in st.session_state:
    st.session_state.income_form_version = 0

if "debit_balance" not in st.session_state:
    st.session_state.debit_balance = 0

if "credit_balance" not in st.session_state:
    st.session_state.credit_balance = 0

if "debit_balance_saved" not in st.session_state:
    st.session_state.debit_balance_saved = int(st.session_state.debit_balance)

if "credit_balance_saved" not in st.session_state:
    st.session_state.credit_balance_saved = int(st.session_state.credit_balance)

if "cc_day_input" not in st.session_state:
    st.session_state.cc_day_input = 1

if "cc_pay_method" not in st.session_state:
    st.session_state.cc_pay_method = "I want to pay my bill in full"

if "cc_pay_amount_unit" not in st.session_state:
    st.session_state.cc_pay_amount_unit = 0

if "cc_pay_amount" not in st.session_state:
    st.session_state.cc_pay_amount = 0

if "cashflow_days" not in st.session_state:
    st.session_state.cashflow_days = 30

if "state_loaded" not in st.session_state:
    load_state()
    st.session_state.state_loaded = True

st.session_state.debit_balance = int(st.session_state.get("debit_balance_saved", 0))
st.session_state.credit_balance = int(st.session_state.get("credit_balance_saved", 0))

# ----------------------
# Page Config
# ----------------------
st.set_page_config(page_title="Budget App", layout="wide")

# ----------------------
# Dialog Functions
# ----------------------
@st.dialog("Add/Edit Bill")
def bill_dialog():
    edit_index = st.session_state.editing_bill_index
    if edit_index is not None and 0 <= edit_index < len(st.session_state.bills):
        edit_bill = st.session_state.bills[edit_index]
        default_name = edit_bill['name']
        default_amount = int(edit_bill['amount'])
        default_frequency = edit_bill['frequency']
        default_type = edit_bill['type']
        default_day = edit_bill['day']
    else:
        st.session_state.editing_bill_index = None
        default_name = ""
        default_amount = 0
        default_frequency = "Weekly"
        default_type = "Credit"
        default_day = dt.date.today()

    ver = st.session_state.bill_form_version
    name = st.text_input("Bill Name", key=f"bill_name_{ver}", value=default_name, placeholder="e.g., Rent")
    amount = st.number_input(
        "Amount",
        min_value=0,
        step=1,
        value=default_amount,
        format="%d",
        key=f"bill_amount_{ver}",
        help="Enter whole dollars"
    )

    # Normalize default_day to a date for date_input widgets
    if not isinstance(default_day, (dt.date, dt.datetime)):
        try:
            default_day = dt.datetime.fromisoformat(str(default_day)).date()
        except Exception:
            default_day = dt.date.today()

    type_options = ["Credit", "Debit"]
    type_index = type_options.index(default_type) if default_type in type_options else 0
    debit_or_credit = st.radio(
        "Credit or Debit",
        type_options,
        index=type_index,
        key=f"bill_type_{ver}"
    )

    freq_options = ["Weekly", "Biweekly", "Monthly", "Annually", "One-time"]
    freq_index = freq_options.index(default_frequency) if default_frequency in freq_options else 0
    frequency = st.radio(
        "Frequency",
        freq_options,
        index=freq_index,
        key=f"bill_frequency_{ver}"
    )

    if frequency == "Weekly":
        day = st.selectbox(
            "Day of the Week",
            ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
            key=f"bill_day_week_{ver}"
        )
    elif frequency == "Monthly":
        day = st.number_input(
            "Day of the Month",
            min_value=1,
            max_value=31,
            value=1,
            step=1,
            key=f"bill_day_month_{ver}"
        )
    elif frequency == "Biweekly":
        day = st.date_input(
            f"Last {name}",
            value=default_day,
            key=f"bill_anchor_date_{ver}",
            format="MM/DD/YYYY"
        )
    elif frequency in ["Annually","One-time"]:
        day = st.date_input(
            "Date",
            value=default_day,
            key=f"bill_anchor_date_{ver}",
            format="MM/DD/YYYY"
        )
    else:
        day = default_day

    col_submit, col_delete = st.columns(2)

    with col_submit:
        if st.button("Save Bill"):
            errors = []
            if not name or not str(name).strip():
                errors.append("Bill name is required.")
            if int(amount) <= 0:
                errors.append("Bill amount is required and must be greater than 0.")
            if debit_or_credit == "Select Type":
                errors.append("Please select Credit or Debit.")
            if frequency == "Select Frequency":
                errors.append("Please select a Frequency.")

            if errors:
                st.error("\n".join(errors))
            else:
                bill_data = {
                    "name": name,
                    "amount": int(amount),
                    "frequency": frequency,
                    "day": day,
                    "type": debit_or_credit
                }
                idx = st.session_state.editing_bill_index
                if idx is not None and 0 <= idx < len(st.session_state.bills):
                    st.session_state.bills[idx] = bill_data
                else:
                    st.session_state.bills.append(bill_data)

                save_state()
                st.session_state.bill_form_version += 1
                st.session_state.editing_bill_index = None
                st.rerun()

    with col_delete:
        if st.session_state.editing_bill_index is not None:
            if st.button("Delete Bill"):
                st.session_state.bills.pop(st.session_state.editing_bill_index)
                save_state()
                st.session_state.editing_bill_index = None
                st.rerun()

@st.dialog("Add/Edit Income")
def income_dialog():
    edit_index = st.session_state.editing_income_index
    if edit_index is not None and 0 <= edit_index < len(st.session_state.income):
        edit_income = st.session_state.income[edit_index]
        default_name = edit_income["name"]
        default_amount = int(edit_income["amount"])
        default_frequency = edit_income["frequency"]
        default_day = edit_income["day"]
    else:
        st.session_state.editing_income_index = None
        default_name = ""
        default_amount = 0
        default_frequency = "Weekly"
        default_day = dt.date.today()

    iver = st.session_state.income_form_version
    income_name = st.text_input("Income Name", value=default_name, key=f"income_name_{iver}", placeholder="e.g., Paycheck")
    income_amount = st.number_input(
        "Amount",
        min_value=0,
        step=1,
        value=default_amount,
        format="%d",
        key=f"income_amount_{iver}",
        help="Enter whole dollars"
    )

    # Normalize default_day to a date for date_input widgets
    if not isinstance(default_day, (dt.date, dt.datetime)):
        try:
            default_day = dt.datetime.fromisoformat(str(default_day)).date()
        except Exception:
            default_day = dt.date.today()

    income_freq_options = ["Weekly","Biweekly","Monthly","Annually","One-time"]
    income_freq_index = income_freq_options.index(default_frequency) if default_frequency in income_freq_options else 0
    income_frequency = st.radio(
        "Frequency",
        income_freq_options,
        index=income_freq_index,
        key=f"income_frequency_{iver}"
    )

    if income_frequency == "Weekly":
        income_day = st.selectbox(
            "Day of the Week",
            ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
            key=f"income_day_week_{iver}"
        )
    elif income_frequency == "Monthly":
        income_day = st.number_input(
            "Day of the Month",
            min_value=1,
            max_value=31,
            value=1,
            step=1,
            key=f"income_day_month_{iver}"
        )
    elif income_frequency == "Biweekly":
        income_day = st.date_input(
            f"Last {income_name}",
            value=default_day,
            key=f"income_anchor_date_{iver}",
            format="MM/DD/YYYY"
        )
    elif income_frequency in ["Annually","One-time"]:
        income_day = st.date_input(
            "Date",
            value=default_day,
            key=f"income_anchor_date_{iver}",
            format="MM/DD/YYYY"
        )
    else:
        income_day = default_day

    col_submit, col_delete = st.columns(2)

    with col_submit:
        if st.button("Save Income"):
            errors = []
            if not income_name or not str(income_name).strip():
                errors.append("Income name is required.")
            if int(income_amount) <= 0:
                errors.append("Income Amount is required and must be greater than 0.")
            if income_frequency == "Select Frequency":
                errors.append("Please select a Frequency.")

            if errors:
                st.error("\n".join(errors))
            else:
                income_data = {
                    "name": income_name,
                    "amount": int(income_amount),
                    "frequency": income_frequency,
                    "day": income_day
                }
                idx = st.session_state.editing_income_index
                if idx is not None and 0 <= idx < len(st.session_state.income):
                    st.session_state.income[idx] = income_data
                else:
                    st.session_state.income.append(income_data)

                save_state()
                st.session_state.income_form_version += 1
                st.session_state.editing_income_index = None
                st.rerun()

    with col_delete:
        if st.session_state.editing_income_index is not None:
            if st.button("Delete Income"):
                st.session_state.income.pop(st.session_state.editing_income_index)
                save_state()
                st.session_state.editing_income_index = None
                st.rerun()

# ----------------------
# Essential setup (shown once)
# ----------------------
@st.dialog("Essential Setup")
def essential_dialog():
    if "cc_pay_day" in st.session_state:
        st.session_state.cc_day_input = int(st.session_state.get("cc_pay_day", 1))
    if st.session_state.get("cc_pay_method_value") is not None:
        st.session_state.cc_pay_method = st.session_state.cc_pay_method_value
    if st.session_state.get("cc_pay_amount_unit_value") is not None:
        st.session_state.cc_pay_amount_unit = int(st.session_state.cc_pay_amount_unit_value)
    if st.session_state.get("cc_pay_amount_value") is not None:
        st.session_state.cc_pay_amount = int(st.session_state.cc_pay_amount_value)
    st.header("Welcome — Quick Setup")
    st.write("Please answer one quick question so the app can tailor reminders.")
    cc_day = st.number_input(
        "What day of the month do you pay your Credit Card?",
        min_value=1,
        max_value=31,
        step=1,
        key="cc_day_input"
    )

    st.markdown("#### How do you pay your credit card?")
    cc_pay_method = st.radio(
        "Payment method",
        ["I want to pay my bill in full", "I pay the minimum", "Custom"],
        key="cc_pay_method",
        horizontal=True,
        label_visibility="collapsed"
    )

    cc_pay_amount = None
    cc_pay_amount_unit = None
    if cc_pay_method in ["I pay the minimum", "Custom"]:
        cc_pay_amount_unit = st.radio(
            "Amount type",
            [0, 1],
            key="cc_pay_amount_unit",
            horizontal=True,
            format_func=lambda v: "Dollar amount" if v == 0 else "Percentage"
        )
        is_percent = int(cc_pay_amount_unit) == 1
        max_value = 100 if is_percent else 1000000
        amount_label = "Payment amount (%)" if is_percent else "Payment amount ($)"
        cc_pay_amount = st.number_input(
            amount_label,
            min_value=0,
            max_value=max_value,
            step=1,
            format="%d",
            key="cc_pay_amount"
        )
    if st.button("Save Credit Card Day"):
        st.session_state.cc_pay_day = int(cc_day)
        st.session_state.cc_pay_method_value = cc_pay_method
        st.session_state.cc_pay_amount_value = int(cc_pay_amount) if cc_pay_amount is not None else None
        st.session_state.cc_pay_amount_unit_value = int(cc_pay_amount_unit) if cc_pay_amount_unit is not None else None
        save_state()
        st.success(f"Saved credit-card day: {st.session_state.cc_pay_day}")
        st.rerun()

build_upcoming_libraries(days=730)

# ----------------------
# Sidebar Navigation
# ----------------------
st.sidebar.title("Budget App")
page = st.sidebar.radio("Navigation", ["My $", "Bills & Income", "Graph"])

# ----------------------
# My $ Page
# ----------------------
if page == "My $":
    st.title("My $")

    st.session_state.debit_balance = int(st.session_state.get("debit_balance_saved", 0))
    st.session_state.credit_balance = int(st.session_state.get("credit_balance_saved", 0))

    # ----------------------
    # Current Balances (Integers)
    # ----------------------
    st.subheader("Current Balances")
    bal_col1, bal_col2 = st.columns(2)

    with bal_col1:
        st.markdown("**Debit**")
        st.number_input(
            "",
            step=1,
            format="%d",
            label_visibility="collapsed",
            key="debit_balance",
            on_change=_persist_debit_balance
        )

    with bal_col2:
        st.markdown("**Credit**")
        st.number_input(
            "",
            step=1,
            format="%d",
            label_visibility="collapsed",
            key="credit_balance",
            on_change=_persist_credit_balance
        )
        if st.button("Edit credit card bill", key="edit_cc_bill"):
            essential_dialog()

    st.divider()

    # ----------------------
    # Bills Section
    # ----------------------
    bills_header_col1, bills_header_col2 = st.columns([3,1])
    with bills_header_col1:
        st.subheader("My Bills")
    with bills_header_col2:
        if st.button("➕ Add Bill", key="open_add_bill"):
            st.session_state.editing_bill_index = None
            st.session_state.bill_form_version += 1
            bill_dialog()

    # ----------------------
    # Bills Table
    # ----------------------
    if st.session_state.bills:        
        # Optimized column weights for better responsiveness
        # Name (2), Amount (1.5), Freq (3), Type (1), Action (1)
        cols_spec = [1, 1, 1, 1, 1]
        
        # Table Headers
        h1, h2, h3, h4, h5 = st.columns(cols_spec, vertical_alignment="center")
        h1.markdown("**Name**")
        h2.markdown("**Amount**")
        h3.markdown("**Frequency**")
        h4.markdown("**Type**")
        h5.markdown("**Action**")
        
        st.divider()

        for i, bill in enumerate(st.session_state.bills):
            name = bill.get("name", "")
            amount = int(bill.get("amount", 0))
            freq = bill.get("frequency", "")
            day = bill.get("day", "")
            # Format day_str according to frequency
            day_str = ""
            if freq.lower().startswith("month"):
                # monthly stores day as integer (day of month)
                try:
                    # if stored as date, use day() otherwise use value directly
                    if hasattr(day, 'day'):
                        day_str = ordinal(day.day)
                    else:
                        day_str = ordinal(day)
                except Exception:
                    day_str = str(day) if day else ""
            elif freq.lower().startswith("week"):
                # weekly stores weekday name
                if hasattr(day, "strftime"):
                    day_str = day.strftime("%A")
                else:
                    day_str = str(day) if day else ""
                if day_str and not day_str.endswith('s'):
                    day_str = day_str + 's'
            elif freq.lower().startswith("biweek"):
                # biweekly uses an anchor date; show weekday + s
                if hasattr(day, "strftime"):
                    day_str = day.strftime("%A")
                else:
                    # try parse iso or fallback to string
                    try:
                        parsed = dt.datetime.fromisoformat(str(day)).date()
                        day_str = parsed.strftime("%A")
                    except Exception:
                        day_str = str(day) if day else ""
                if day_str and not day_str.endswith('s'):
                    day_str = day_str + 's'
            elif freq.lower().startswith("ann"):
                # show MM/DD for annual
                if hasattr(day, "strftime"):
                    day_str = day.strftime("%m/%d")
                else:
                    try:
                        parsed = dt.datetime.fromisoformat(str(day)).date()
                        day_str = parsed.strftime("%m/%d")
                    except Exception:
                        day_str = str(day) if day else ""
            elif freq.lower() == "one-time" or freq.lower() == "one time":
                if hasattr(day, "strftime"):
                    day_str = day.strftime("%m/%d/%Y")
                else:
                    day_str = str(day) if day else ""
            else:
                # fallback: format date if possible, otherwise string
                if hasattr(day, "strftime"):
                    day_str = day.strftime("%m/%d/%Y")
                else:
                    day_str = str(day) if day else ""

            freq_cell = f"{freq} ({day_str})" if freq and day_str else freq
            typ = bill.get("type", "")
            
            c1, c2, c3, c4, c5 = st.columns(cols_spec, vertical_alignment="center")
            c1.write(name)
            c2.write(f"${amount:,}")
            c3.write(freq_cell)
            c4.write(typ)
            # Use a container for the button to ensure it fits nicely
            if c5.button("Edit", key=f"edit_bill_{i}", use_container_width=True):
                st.session_state.editing_bill_index = i
                st.session_state.bill_form_version += 1
                bill_dialog()
    else:
        st.markdown("_No bills added yet_")

    st.divider()

    # ----------------------
    # Income Section
    # ----------------------
    income_header_col1, income_header_col2 = st.columns([3,1])
    with income_header_col1:
        st.subheader("My Income")
    with income_header_col2:
        if st.button("➕ Add Income", key="open_add_income"):
            st.session_state.editing_income_index = None
            st.session_state.income_form_version += 1
            income_dialog()

    # ----------------------
    # Income Table
    # ----------------------
    if st.session_state.income:
        
        # Optimized column weights for better responsiveness
        # Name (2), Amount (1.5), Freq (3), Type (1), Action (1)
        cols_spec = [2, 1.5, 3, 1]
        
        # Table Headers
        h1, h2, h3, h4 = st.columns(cols_spec, vertical_alignment="center")
        h1.markdown("**Name**")
        h2.markdown("**Amount**")
        h3.markdown("**Frequency**")
        h4.markdown("**Action**")
        
        st.divider()

        for i, inc in enumerate(st.session_state.income):
            name = inc.get("name", "")
            amount = int(inc.get("amount", 0))
            freq = inc.get("frequency", "")
            day = inc.get("day", "")
            # Format day_str according to frequency (same rules as bills)
            day_str = ""
            if freq.lower().startswith("month"):
                try:
                    if hasattr(day, 'day'):
                        day_str = ordinal(day.day)
                    else:
                        day_str = ordinal(day)
                except Exception:
                    day_str = str(day) if day else ""
            elif freq.lower().startswith("week"):
                if hasattr(day, "strftime"):
                    day_str = day.strftime("%A")
                else:
                    day_str = str(day) if day else ""
                if day_str and not day_str.endswith('s'):
                    day_str = day_str + 's'
            elif freq.lower().startswith("biweek"):
                if hasattr(day, "strftime"):
                    day_str = day.strftime("%A")
                else:
                    try:
                        parsed = dt.datetime.fromisoformat(str(day)).date()
                        day_str = parsed.strftime("%A")
                    except Exception:
                        day_str = str(day) if day else ""
                if day_str and not day_str.endswith('s'):
                    day_str = day_str + 's'
            elif freq.lower().startswith("ann"):
                if hasattr(day, "strftime"):
                    day_str = day.strftime("%m/%d")
                else:
                    try:
                        parsed = dt.datetime.fromisoformat(str(day)).date()
                        day_str = parsed.strftime("%m/%d")
                    except Exception:
                        day_str = str(day) if day else ""
            elif freq.lower() == "one-time" or freq.lower() == "one time":
                if hasattr(day, "strftime"):
                    day_str = day.strftime("%m/%d/%Y")
                else:
                    day_str = str(day) if day else ""
            else:
                if hasattr(day, "strftime"):
                    day_str = day.strftime("%m/%d/%Y")
                else:
                    day_str = str(day) if day else ""

            freq_cell = f"{freq} ({day_str})" if freq and day_str else freq
            typ = inc.get("type", "-")
            
            c1, c2, c3, c4 = st.columns(cols_spec, vertical_alignment="center")
            c1.write(name)
            c2.write(f"${amount:,}")
            c3.write(freq_cell)
            if c4.button("Edit", key=f"edit_income_{i}", use_container_width=True):
                st.session_state.editing_income_index = i
                st.session_state.income_form_version += 1
                income_dialog()
    else:
        st.markdown("_No income added yet_")

elif page == "Bills & Income":
    st.title("Bills & Income")

    # Build a cashflow view from the stored libraries
    start = dt.date.today()
    days_ahead = st.number_input(
        "Days",
        min_value=1,
        max_value=730,
        step=1,
        key="cashflow_days",
        on_change=_persist_cashflow_days
    )
    end = start + dt.timedelta(days=int(days_ahead))

    debit_bills = [
        b for b in st.session_state.get("upcoming_debit_bills", [])
        if start <= b.get("date") <= end
    ]
    credit_bills = [
        b for b in st.session_state.get("upcoming_credit_bills", [])
        if start <= b.get("date") <= end
    ]
    incomes = [
        inc for inc in st.session_state.get("upcoming_incomes", [])
        if start <= inc.get("date") <= end
    ]

    total_income = sum(int(i.get("amount", 0)) for i in incomes)
    total_bills = sum(int(b.get("amount", 0)) for b in debit_bills + credit_bills)
    net = total_income - total_bills

    debit_balance_map = {
        b["date"]: int(b["balance"])
        for b in st.session_state.get("debit_balance_forecast", [])
        if start <= b.get("date") <= end
    }
    credit_balance_map = {
        b["date"]: int(b["balance"])
        for b in st.session_state.get("credit_balance_forecast", [])
        if start <= b.get("date") <= end
    }
    if debit_balance_map:
        lowest_date = min(debit_balance_map, key=lambda d: debit_balance_map[d])
        lowest_balance = debit_balance_map[lowest_date]
    else:
        lowest_date = start
        lowest_balance = int(st.session_state.get("debit_balance", 0))

    # Header summary styled like a compact snapshot
    st.markdown(f"### Upcoming Cash Flow - Next {int(days_ahead)} Days")
    summary_cols = st.columns([2, 2, 2])
    with summary_cols[0]:
        st.markdown(f"**Income**  +${int(total_income):,}")
    with summary_cols[1]:
        st.markdown(f"**Bills**  -${int(total_bills):,}")
    with summary_cols[2]:
        net_badge = "👍" if net >= 0 else "👎"
        sign = "+" if net >= 0 else "-"
        st.markdown(f"**Net**  {sign}${int(abs(net)):,}  {net_badge}")

    st.markdown(f"**Lowest Balance:** {lowest_date.strftime('%b %d')}-> ${int(lowest_balance):,}")

    st.divider()

    # Table view for the selected range
    filter_choice = st.selectbox(
        "View",
        ["All", "Debit", "Credit"],
        index=0,
        key="cashflow_view_filter"
    )
    events = []
    for bill in debit_bills:
        events.append({
            "date": bill["date"],
            "item": bill.get("name", ""),
            "type": "Debit",
            "amount": -abs(int(bill.get("amount", 0)))
        })
    for bill in credit_bills:
        events.append({
            "date": bill["date"],
            "item": bill.get("name", ""),
            "type": "Credit",
            "amount": -abs(int(bill.get("amount", 0)))
        })
    for inc in incomes:
        events.append({
            "date": inc["date"],
            "item": inc.get("name", ""),
            "type": "Debit",
            "amount": abs(int(inc.get("amount", 0)))
        })

    if filter_choice != "All":
        events = [ev for ev in events if ev["type"] == filter_choice]

    events.sort(key=lambda x: x["date"])

    rows = []
    for ev in events:
        d = ev["date"]
        date_str = "Today" if d == start else d.strftime("%b %d")
        amt_val = abs(int(ev["amount"]))
        amt_str = f"${amt_val:,}"
        debit_bal = debit_balance_map.get(d, int(st.session_state.get("debit_balance", 0)))
        credit_bal = credit_balance_map.get(d, int(st.session_state.get("credit_balance", 0)))
        is_income = int(ev["amount"]) >= 0
        rows.append({
            "Date": date_str,
            "Item": ev["item"],
            "Credit or Debit": ev["type"],
            "Amount": amt_str,
            "Debit Balance": f"${int(debit_bal):,}",
            "Credit Balance": f"${int(credit_bal):,}",
            "Row Color": "#e9f8ef" if is_income else "#fdecea"
        })

    if rows:
        table_html = [
            "<table style='width:100%; border-collapse: collapse;'>",
            "<thead><tr>",
            "<th style='text-align:left; padding:6px;'>Date</th>",
            "<th style='text-align:left; padding:6px;'>Item</th>",
            "<th style='text-align:left; padding:6px;'>Credit or Debit</th>",
            "<th style='text-align:right; padding:6px;'>Amount</th>",
            "<th style='text-align:right; padding:6px;'>Debit Balance</th>",
            "<th style='text-align:right; padding:6px;'>Credit Balance</th>",
            "</tr></thead><tbody>"
        ]
        for row in rows:
            table_html.append(
                "<tr style='background-color:{color};'>"
                "<td style='padding:6px;'>{date}</td>"
                "<td style='padding:6px;'>{item}</td>"
                "<td style='padding:6px;'>{typ}</td>"
                "<td style='padding:6px; text-align:right;'>{amount}</td>"
                "<td style='padding:6px; text-align:right;'>{debit}</td>"
                "<td style='padding:6px; text-align:right;'>{credit}</td>"
                "</tr>".format(
                    color=row["Row Color"],
                    date=row["Date"],
                    item=row["Item"],
                    typ=row["Credit or Debit"],
                    amount=row["Amount"],
                    debit=row["Debit Balance"],
                    credit=row["Credit Balance"]
                )
            )
        table_html.append("</tbody></table>")
        st.markdown("".join(table_html), unsafe_allow_html=True)
    else:
        st.markdown("_No upcoming items in the selected range._")

elif page == "Graph":
    st.title("Graph")

    start = dt.date.today()
    max_date = start + dt.timedelta(days=730)
    graph_type = st.selectbox(
        "View",
        ["Debit", "Credit", "Both"],
        index=2,
        key="graph_view_type"
    )
    end_date = st.date_input(
        "Date Forecasted Until",
        value=start + dt.timedelta(days=30),
        min_value=start,
        max_value=max_date,
        key="graph_end_date"
    )

    debit_series = [
        b for b in st.session_state.get("debit_balance_forecast", [])
        if start <= b.get("date") <= end_date
    ]
    credit_series = [
        b for b in st.session_state.get("credit_balance_forecast", [])
        if start <= b.get("date") <= end_date
    ]

    data = {"Date": []}
    if graph_type in ["Debit", "Both"]:
        data["Debit Balance"] = []
    if graph_type in ["Credit", "Both"]:
        data["Credit Balance"] = []

    date_list = [start + dt.timedelta(days=i) for i in range((end_date - start).days + 1)]
    debit_map = {b["date"]: int(b["balance"]) for b in debit_series}
    credit_map = {b["date"]: int(b["balance"]) for b in credit_series}

    for d in date_list:
        data["Date"].append(d)
        if "Debit Balance" in data:
            data["Debit Balance"].append(debit_map.get(d, int(st.session_state.get("debit_balance", 0))))
        if "Credit Balance" in data:
            data["Credit Balance"].append(credit_map.get(d, int(st.session_state.get("credit_balance", 0))))

    df = pd.DataFrame(data).set_index("Date")
    st.line_chart(df)
