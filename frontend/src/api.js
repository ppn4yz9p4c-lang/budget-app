const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const LOCAL_ONLY = import.meta.env.VITE_LOCAL_ONLY === "true";
const LOCAL_STATE_KEY = "budget_local_state";
const STATE_CACHE_KEY = "budget_state_cache";

function buildUrl(path) {
  if (!API_BASE) return path;
  return `${API_BASE.replace(/\/$/, "")}${path}`;
}

function authHeaders() {
  return {};
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    return null;
  }
}

function loadCachedState() {
  try {
    const raw = localStorage.getItem(STATE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    return null;
  }
}

function loadMergedLocalState() {
  const cached = loadCachedState();
  const local = loadLocalState();
  if (!cached && !local) return {};
  return { ...(cached || {}), ...(local || {}) };
}

function saveLocalState(next) {
  try {
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(next));
  } catch (err) {
    // ignore local save failures
  }
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(`${value}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function occurrencesForEntry(entry, startDate, days, isIncome) {
  const out = [];
  const end = addDays(startDate, days);
  const freq = String(entry?.frequency || "").toLowerCase();
  const name = entry?.name || "";
  const amt = Number(entry?.amount || 0);
  const typ = String(entry?.type || "").trim().toLowerCase();
  const sign = isIncome ? 1 : typ === "debit" ? -1 : 1;
  const day = entry?.day;

  if (freq.includes("biweekly")) {
    const anchor = normalizeDate(day);
    if (!anchor) return out;
    let occ = anchor;
    if (occ < startDate) {
      const diff = Math.floor((startDate - occ) / (24 * 60 * 60 * 1000));
      const k = Math.floor((diff + 13) / 14);
      occ = addDays(occ, 14 * k);
    }
    while (occ <= end) {
      out.push({ date: occ, delta: amt * sign, name, entry });
      occ = addDays(occ, 14);
    }
    return out;
  }

  if (freq.includes("weekly")) {
    const toMondayIndex = (date) => (date.getDay() + 6) % 7;
    let target = toMondayIndex(startDate);
    if (typeof day === "string") {
      const weekdays = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday"
      ];
      const idx = weekdays.indexOf(day.toLowerCase());
      if (idx >= 0) {
        target = idx;
      } else {
        const parsed = normalizeDate(day);
        if (parsed) target = toMondayIndex(parsed);
      }
    } else if (day instanceof Date) {
      target = toMondayIndex(day);
    }
    const delta = (target - toMondayIndex(startDate) + 7) % 7;
    let occ = addDays(startDate, delta);
    while (occ <= end) {
      out.push({ date: occ, delta: amt * sign, name, entry });
      occ = addDays(occ, 7);
    }
    return out;
  }

  if (freq.includes("monthly")) {
    let dom = Number(day);
    if (!Number.isFinite(dom) || dom <= 0) {
      dom = startDate.getDate();
    }
    let year = startDate.getFullYear();
    let month = startDate.getMonth();
    while (true) {
      const clampedDay = Math.min(dom, 28);
      const candidate = new Date(year, month, clampedDay);
      if (candidate >= startDate && candidate <= end) {
        out.push({ date: candidate, delta: amt * sign, name, entry });
      }
      if (year > end.getFullYear() || (year === end.getFullYear() && month >= end.getMonth())) {
        break;
      }
      if (month === 11) {
        year += 1;
        month = 0;
      } else {
        month += 1;
      }
    }
    return out;
  }

  if (freq.includes("ann")) {
    const anchor = normalizeDate(day);
    if (!anchor) return out;
    let occ = new Date(startDate.getFullYear(), anchor.getMonth(), anchor.getDate());
    if (occ < startDate) {
      occ = new Date(startDate.getFullYear() + 1, anchor.getMonth(), anchor.getDate());
    }
    if (occ >= startDate && occ <= end) {
      out.push({ date: occ, delta: amt * sign, name, entry });
    }
    return out;
  }

  const occ = normalizeDate(day);
  if (occ && occ >= startDate && occ <= end) {
    out.push({ date: occ, delta: amt * sign, name, entry });
  }
  return out;
}

function creditCardPaymentAmount(state) {
  const method = state?.cc_pay_method_value || "I want to pay my bill in full";
  const creditBalance = Number(state?.credit_balance || 0);
  if (method === "I pay in full" || method === "I want to pay my bill in full") {
    return Math.max(0, creditBalance);
  }
  if (method === "I pay the minimum" || method === "Custom") {
    const unit = state?.cc_pay_amount_unit_value;
    const amount = state?.cc_pay_amount_value;
    if (unit === null || unit === undefined || amount === null || amount === undefined) {
      return null;
    }
    if (Number(unit) === 1) {
      return Math.max(0, Math.round((creditBalance * Number(amount)) / 100));
    }
    return Math.max(0, Number(amount));
  }
  return null;
}

function buildLocalLibraries(state, days) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const debitBills = [];
  const creditBills = [];
  const incomes = [];
  const debitChanges = new Map();
  const creditChanges = new Map();
  const incomeChanges = new Map();

  const bills = Array.isArray(state?.bills) ? state.bills : [];
  bills.forEach((bill) => {
    const type = String(bill?.type || "").trim().toLowerCase();
    const isDebit = type === "debit";
    occurrencesForEntry(bill, start, days, false).forEach((occ) => {
      const date = isoDate(occ.date);
      const amount = Math.abs(Number(occ.delta || 0));
      const entry = { date, name: occ.name || "", amount };
      if (isDebit) {
        debitBills.push(entry);
        debitChanges.set(date, (debitChanges.get(date) || 0) + Number(occ.delta || 0));
      } else {
        creditBills.push(entry);
        creditChanges.set(date, (creditChanges.get(date) || 0) + Number(occ.delta || 0));
      }
    });
  });

  const incomeList = Array.isArray(state?.income) ? state.income : [];
  incomeList.forEach((inc) => {
    occurrencesForEntry({ ...inc, type: "Credit" }, start, days, true).forEach((occ) => {
      const date = isoDate(occ.date);
      incomes.push({ date, name: occ.name || "", amount: Math.abs(Number(occ.delta || 0)) });
      incomeChanges.set(date, (incomeChanges.get(date) || 0) + Number(occ.delta || 0));
    });
  });

  if (state?.cc_pay_day !== null && state?.cc_pay_day !== undefined) {
    const ccBill = {
      name: "Credit Card Bill",
      amount: creditCardPaymentAmount(state) || 0,
      frequency: "Monthly",
      day: Number(state.cc_pay_day),
      type: "Debit",
      auto: true
    };
    const ccOccurrences = occurrencesForEntry(ccBill, start, days, false).map((occ) => isoDate(occ.date));
    const ccDates = new Set(ccOccurrences);
    const apr = Math.max(0, Number(state?.cc_apr_value || 0));
    const monthlyRate = apr / 100 / 12;
    let creditRunning = Number(state?.credit_balance || 0);
    for (let i = 0; i <= days; i += 1) {
      const day = addDays(start, i);
      const key = isoDate(day);
      const dailyCredit = creditChanges.get(key) || 0;
      creditRunning += dailyCredit;
      if (ccDates.has(key)) {
        const baseBalance = creditRunning - dailyCredit;
        let payAmount = creditCardPaymentAmount({
          ...state,
          credit_balance: baseBalance
        }) || 0;
        if (payAmount > baseBalance) {
          payAmount = Math.max(0, baseBalance);
        }
        const remainingBase = Math.max(0, baseBalance - payAmount);
        if (payAmount > 0) {
          debitBills.push({ date: key, name: "Credit Card Bill", amount: payAmount });
          debitChanges.set(key, (debitChanges.get(key) || 0) - payAmount);
          creditChanges.set(key, (creditChanges.get(key) || 0) - payAmount);
          creditRunning = remainingBase + dailyCredit;
        } else {
          creditRunning = remainingBase + dailyCredit;
        }
        if (monthlyRate > 0 && remainingBase > 0) {
          const interest = Math.round(remainingBase * monthlyRate);
          if (interest > 0) {
            creditChanges.set(key, (creditChanges.get(key) || 0) + interest);
            creditRunning += interest;
          }
        }
      }
    }
  }

  const debitBalanceSeries = [];
  const creditBalanceSeries = [];
  let debitRunning = Number(state?.debit_balance || 0);
  let creditRunning = Number(state?.credit_balance || 0);
  for (let i = 0; i <= days; i += 1) {
    const day = addDays(start, i);
    const key = isoDate(day);
    debitRunning += (debitChanges.get(key) || 0) + (incomeChanges.get(key) || 0);
    creditRunning += creditChanges.get(key) || 0;
    debitBalanceSeries.push({ date: key, balance: Math.round(debitRunning) });
    creditBalanceSeries.push({ date: key, balance: Math.round(creditRunning) });
  }

  return {
    upcoming_debit_bills: debitBills,
    upcoming_credit_bills: creditBills,
    upcoming_incomes: incomes,
    debit_balance_forecast: debitBalanceSeries,
    credit_balance_forecast: creditBalanceSeries
  };
}

export async function getState() {
  if (LOCAL_ONLY) {
    return loadMergedLocalState();
  }
  const res = await fetch(buildUrl("/api/state"), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Failed to load state");
  }
  return res.json();
}

export async function putState(payload) {
  if (LOCAL_ONLY) {
    const current = loadMergedLocalState();
    const next = { ...current, ...payload };
    saveLocalState(next);
    return next;
  }
  const res = await fetch(buildUrl("/api/state"), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error("Failed to save state");
  }
  return res.json();
}

export async function getLibraries(days = 730) {
  if (LOCAL_ONLY) {
    return buildLocalLibraries(loadMergedLocalState(), days);
  }
  const res = await fetch(buildUrl(`/api/libraries?days=${days}`), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Failed to load libraries");
  }
  return res.json();
}

export async function getAlerts() {
  if (LOCAL_ONLY) {
    return [];
  }
  const res = await fetch(buildUrl("/api/alerts"), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Failed to load alerts");
  }
  return res.json();
}

export async function registerUser(payload) {
  if (LOCAL_ONLY) {
    return { token: "local-only", token_type: "local" };
  }
  const res = await fetch(buildUrl("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    let detail = "Registration failed";
    try {
      const data = await res.json();
      if (data?.detail) detail = data.detail;
    } catch (err) {
      // ignore parse errors
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function loginUser(payload) {
  if (LOCAL_ONLY) {
    return { token: "local-only", token_type: "local" };
  }
  const res = await fetch(buildUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    let detail = "Login failed";
    try {
      const data = await res.json();
      if (data?.detail) detail = data.detail;
    } catch (err) {
      // ignore parse errors
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function getSafeToSpend(days) {
  if (LOCAL_ONLY) {
    const libs = buildLocalLibraries(loadLocalState() || {}, days);
    const balances = (libs.debit_balance_forecast || []).map((row) => Number(row.balance || 0));
    const min = balances.length ? Math.min(...balances) : 0;
    return { safe_to_spend: Number(min || 0), days };
  }
  const res = await fetch(buildUrl(`/api/safe_to_spend?days=${days}`), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Failed to load safe to spend");
  }
  return res.json();
}

export async function getRecurringSuggestions() {
  if (LOCAL_ONLY) {
    return [];
  }
  const res = await fetch(buildUrl("/api/recurring/suggest"), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Failed to load suggestions");
  }
  return res.json();
}

export async function importCsv(file) {
  if (LOCAL_ONLY) {
    throw new Error("CSV import is unavailable in local-only mode.");
  }
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(buildUrl("/api/transactions/import"), {
    method: "POST",
    headers: authHeaders(),
    body: form
  });
  if (!res.ok) {
    throw new Error("CSV import failed");
  }
  return res.json();
}

export async function getChecklist(days) {
  if (LOCAL_ONLY) {
    return [];
  }
  const res = await fetch(buildUrl(`/api/checklist?days=${days}`), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Checklist failed");
  }
  return res.json();
}

export async function markChecklist(payload) {
  if (LOCAL_ONLY) {
    return {};
  }
  const res = await fetch(buildUrl("/api/checklist/mark"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error("Checklist update failed");
  }
  return res.json();
}

export async function getWeeklySummary() {
  if (LOCAL_ONLY) {
    return null;
  }
  const res = await fetch(buildUrl("/api/summary/weekly"), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Weekly summary failed");
  }
  return res.json();
}

export async function exportBackup() {
  if (LOCAL_ONLY) {
    return { state: loadLocalState() || {} };
  }
  const res = await fetch(buildUrl("/api/export"), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Export failed");
  }
  return res.json();
}

export async function uploadBackup(payload) {
  if (LOCAL_ONLY) {
    if (payload?.state && typeof payload.state === "object") {
      saveLocalState(payload.state);
      return { ok: true };
    }
    throw new Error("Invalid backup payload");
  }
  const res = await fetch(buildUrl("/api/backup/upload"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error("Backup upload failed");
  }
  return res.json();
}
