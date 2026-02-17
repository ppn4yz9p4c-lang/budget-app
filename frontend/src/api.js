import {
  addDays,
  buildPaidKey,
  computeCcBillWindows,
  computeCcPayDates,
  isoDate,
  occurrencesForEntry
} from "./ccLogic";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const LOCAL_ONLY = import.meta.env.VITE_LOCAL_ONLY === "true";
const LOCAL_STATE_KEY = "budget_local_state";
const STATE_CACHE_KEY = "budget_state_cache";
const PAID_EVENTS_KEY = "budget_paid_events";

function isDailyExpenseName(name) {
  const label = String(name || "").trim().toLowerCase();
  const normalized = label.replace(/[^a-z]/g, "");
  return (
    normalized === "misc" ||
    normalized === "miscellaneous" ||
    normalized === "dailyexpense" ||
    normalized === "dailyexpenses"
  );
}

function normalizeDailyExpenseFrequency(frequency, dayHint) {
  const freq = String(frequency || "").trim().toLowerCase();
  if (freq.includes("week")) return "weekly";
  if (freq.includes("month")) return "monthly";
  const dayLabel = String(dayHint || "").toLowerCase();
  if (
    [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday"
    ].some((name) => dayLabel.includes(name))
  ) {
    return "weekly";
  }
  if (/^\d{1,2}$/.test(dayLabel)) return "monthly";
  return "weekly";
}

function computeDailyExpenseAmount(amount, frequency, dayHint) {
  const base = Number(amount || 0);
  const normalized = normalizeDailyExpenseFrequency(frequency, dayHint);
  if (normalized === "monthly") return base / 30.4167;
  return base / 7;
}

function isDailyExpenseName(name) {
  const label = String(name || "").trim().toLowerCase();
  const normalized = label.replace(/[^a-z]/g, "");
  return (
    normalized === "misc" ||
    normalized === "miscellaneous" ||
    normalized === "dailyexpense" ||
    normalized === "dailyexpenses"
  );
}

function normalizeDailyExpenseFrequency(frequency, dayHint) {
  const freq = String(frequency || "").trim().toLowerCase();
  if (freq.includes("week")) return "weekly";
  if (freq.includes("month")) return "monthly";
  const dayLabel = String(dayHint || "").toLowerCase();
  if (
    [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday"
    ].some((name) => dayLabel.includes(name))
  ) {
    return "weekly";
  }
  if (/^\d{1,2}$/.test(dayLabel)) return "monthly";
  return "weekly";
}

function computeDailyExpenseAmount(amount, frequency, dayHint) {
  const base = Number(amount || 0);
  const normalized = normalizeDailyExpenseFrequency(frequency, dayHint);
  if (normalized === "monthly") return base / 30.4167;
  return base / 7;
}

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

function loadPaidEvents() {
  try {
    const raw = localStorage.getItem(PAID_EVENTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function saveLocalState(next) {
  try {
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(next));
  } catch (err) {
    // ignore local save failures
  }
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
  const paidEvents = loadPaidEvents();
  const ccPayDates = computeCcPayDates(start, days, state?.cc_pay_day);

  const bills = Array.isArray(state?.bills) ? state.bills : [];
  bills.forEach((bill) => {
    const type = String(bill?.type || "").trim().toLowerCase();
    const isDebit = type === "debit";
    occurrencesForEntry(bill, start, days, false).forEach((occ) => {
      const date = isoDate(occ.date);
      const amount = Math.abs(Number(occ.delta || 0));
      const entry = {
        date,
        name: occ.name || "",
        amount,
        sourceId: bill.id || ""
      };
      if (isDebit) {
        debitBills.push(entry);
        const paidKey = buildPaidKey({
          sourceId: entry.sourceId,
          name: entry.name,
          date,
          type: "Debit",
          amount
        });
        if (!paidEvents?.[paidKey]) {
          debitChanges.set(date, (debitChanges.get(date) || 0) + Number(occ.delta || 0));
        }
      } else {
        creditBills.push(entry);
        const paidKey = buildPaidKey({
          sourceId: entry.sourceId,
          name: entry.name,
          date,
          type: "Credit",
          amount
        });
        if (!paidEvents?.[paidKey]) {
          creditChanges.set(date, (creditChanges.get(date) || 0) + Number(occ.delta || 0));
        }
      }
    });
  });

  const incomeList = Array.isArray(state?.income) ? state.income : [];
  incomeList.forEach((inc) => {
    occurrencesForEntry({ ...inc, type: "Credit" }, start, days, true).forEach((occ) => {
      const date = isoDate(occ.date);
      const amount = Math.abs(Number(occ.delta || 0));
      const entry = { date, name: occ.name || "", amount, sourceId: inc.id || "" };
      incomes.push(entry);
      const paidKey = buildPaidKey({
        sourceId: entry.sourceId,
        name: entry.name,
        date,
        type: "Debit",
        amount
      });
      if (!paidEvents?.[paidKey]) {
        incomeChanges.set(date, (incomeChanges.get(date) || 0) + Number(occ.delta || 0));
      }
    });
  });

  if (ccPayDates.length > 0) {
    const method = state?.cc_pay_method_value || "I want to pay my bill in full";
    const payInFull =
      method === "I pay in full" || method === "I want to pay my bill in full";
    const sortedPayDates = ccPayDates.slice().sort((a, b) => a - b);
    const ccDates = new Set(sortedPayDates.map((date) => isoDate(date)));

    if (payInFull) {
      let creditRunning = Number(state?.credit_balance || 0);
      for (let i = 0; i <= days; i += 1) {
        const day = addDays(start, i);
        const key = isoDate(day);
        const dailyCredit = creditChanges.get(key) || 0;
        creditRunning += dailyCredit;
        if (ccDates.has(key)) {
          const creditBeforePayment = creditRunning - dailyCredit;
          const payAmount = Math.max(0, creditBeforePayment);
          if (payAmount > 0) {
            debitBills.push({ date: key, name: "Credit Card Bill", amount: payAmount });
            debitChanges.set(key, (debitChanges.get(key) || 0) - payAmount);
            creditChanges.set(key, (creditChanges.get(key) || 0) - payAmount);
            creditRunning -= payAmount;
          }
        }
      }
    } else {
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

export async function getLibraries(days = 730, stateOverride = null) {
  if (LOCAL_ONLY) {
    const base =
      stateOverride && typeof stateOverride === "object"
        ? stateOverride
        : loadMergedLocalState();
    return buildLocalLibraries(base, days);
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
    const libs = buildLocalLibraries(loadMergedLocalState(), days);
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
