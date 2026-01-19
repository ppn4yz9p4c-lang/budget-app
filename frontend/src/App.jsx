
import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import {
  exportBackup,
  getAlerts,
  getChecklist,
  getLibraries,
  getRecurringSuggestions,
  getSafeToSpend,
  getState,
  getWeeklySummary,
  importCsv,
  markChecklist,
  putState,
  uploadBackup
} from "./api";
import { computeCcBillWindows } from "./ccLogic";
import { computeSnpProjection } from "./investment";
import { saveState } from "./saveState";

const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
];

const BILL_FREQUENCIES = ["Weekly", "Biweekly", "Monthly", "Annually", "One-time"];
const INCOME_FREQUENCIES = ["Weekly", "Biweekly", "Monthly", "Annually", "One-time"];

const GOAL_OPTIONS = [
  "Build emergency fund",
  "Pay down credit cards",
  "Save for something specific",
  "Spend less in general"
];

const STATE_CACHE_KEY = "budget_state_cache";

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

function saveCachedState(nextState) {
  try {
    localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(nextState));
  } catch (err) {
    // ignore cache failures
  }
}

function mergeCachedState(current, patch) {
  if (!current || typeof current !== "object") return;
  if (!patch || typeof patch !== "object") return;
  saveCachedState({ ...current, ...patch });
}

function applyCachedFallback(current, cached, fallback) {
  if (!current || !cached || !fallback) return current;
  const next = { ...current };
  const fields = [
    "debit_balance",
    "credit_balance",
    "cc_pay_day",
    "cc_pay_method_value",
    "cc_pay_amount_value",
    "cc_pay_amount_unit_value",
    "cc_apr_value"
  ];
  fields.forEach((key) => {
    const currentValue = current[key];
    const fallbackValue = fallback[key];
    const cachedValue = cached[key];
    if (
      currentValue === fallbackValue &&
      cachedValue !== undefined &&
      cachedValue !== null &&
      cachedValue !== fallbackValue
    ) {
      next[key] = cachedValue;
    }
  });
  return next;
}

function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const mod100 = num % 100;
  if (mod100 >= 10 && mod100 <= 20) return `${num}th`;
  const mod10 = num % 10;
  if (mod10 === 1) return `${num}st`;
  if (mod10 === 2) return `${num}nd`;
  if (mod10 === 3) return `${num}rd`;
  return `${num}th`;
}

function parseIsoDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAxisDate(value) {
  const date = parseIsoDate(value);
  if (!date) return value;
  const month = date.getMonth() + 1;
  const day = date.getDate().toString().padStart(2, "0");
  return `${month}/${day}`;
}

function formatTooltipDate(value) {
  const date = parseIsoDate(value);
  if (!date) return value;
  return date.toLocaleDateString("en-US");
}

function formatCurrency(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(num);
}

function formatDateShort(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildPaidKey({ sourceId, name, date, type, amount }) {
  const base = sourceId || name || "";
  return `${base}|${date}|${type}|${amount}`;
}

function isSameCalendarDay(a, b) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function ChoiceGroup({ value, options, onChange }) {
  return (
    <div className="choice-group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "choice active" : "choice"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function buildDefaultState() {
  return {
    debit_balance: 0,
    credit_balance: 0,
    cc_pay_day: 13,
    cc_pay_method_value: "I want to pay my bill in full",
    cc_pay_amount_value: null,
    cc_pay_amount_unit_value: null,
    cc_apr_value: null,
    cashflow_days: 30,
    cashflow_view_filter: "All",
    graph_view_type: "Both",
    graph_end_date: null,
    safe_to_spend_days: 14,
    debit_floor_target: 0,
    bills: [],
    income: [],
    categories: [],
    budgets: [],
    alerts: [],
    accounts: []
  };
}

  function buildWeeklyDayOptions() {
    return [{ label: "Pick a day", value: "" }].concat(
      WEEK_DAYS.map((day) => ({ label: day, value: day }))
  );
}

function buildBillTemplate({
  name,
  frequency,
  day,
  amount = "",
  type = "Debit"
}) {
  return {
    name,
    amount,
    frequency,
    day,
    type
  };
}

function buildIncomeTemplate({
  name = "",
  frequency = "Biweekly",
  day = "",
  amount = ""
}) {
  return {
    name,
    amount,
    frequency,
    day
  };
}

function buildDefaultLibraries(state) {
  const today = new Date().toISOString().slice(0, 10);
  const debitBalance = Number(state?.debit_balance || 0);
  const creditBalance = Number(state?.credit_balance || 0);
  return {
    upcoming_debit_bills: [],
    upcoming_credit_bills: [],
    upcoming_incomes: [],
    debit_balance_forecast: [{ date: today, balance: debitBalance }],
    credit_balance_forecast: [{ date: today, balance: creditBalance }]
  };
}

export default function App() {
  const [page, setPage] = useState("My $");
  const [state, setState] = useState(null);
  const [libs, setLibs] = useState(null);
  const [safeSpend, setSafeSpend] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [weeklySummary, setWeeklySummary] = useState(null);
  const [checklist, setChecklist] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [billModal, setBillModal] = useState(null);
  const [incomeModal, setIncomeModal] = useState(null);
  const [ccModalOpen, setCcModalOpen] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [backupText, setBackupText] = useState("");
  const [debitFloorInput, setDebitFloorInput] = useState("");
  const [cashflowDaysInput, setCashflowDaysInput] = useState("");
  const [saveError, setSaveError] = useState("");
  const [showCcDebug, setShowCcDebug] = useState(false);
  const [danSettingsEnabled, setDanSettingsEnabled] = useState(false);
  const [inputsHydrated, setInputsHydrated] = useState(false);
  const [paidEvents, setPaidEvents] = useState(() => {
    try {
      const raw = localStorage.getItem("budget_paid_events");
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  });
  const [debitBalanceInput, setDebitBalanceInput] = useState("");
  const [creditBalanceInput, setCreditBalanceInput] = useState("");
  const [ccPayDayInput, setCcPayDayInput] = useState("");
  const [ccPayAmountInput, setCcPayAmountInput] = useState("");
  const [ccAprInput, setCcAprInput] = useState("");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingData, setOnboardingData] = useState(() => ({
    firstName: localStorage.getItem("budget_first_name") || "",
    debitBalance: "",
    creditBalance: "",
    income: buildIncomeTemplate({}),
    rent: buildBillTemplate({
      name: "Rent/Mortgage",
      frequency: "Monthly",
      day: 1
    }),
    groceries: buildBillTemplate({
      name: "Groceries",
      frequency: "Weekly",
      day: "Sunday"
    }),
    utilities: buildBillTemplate({
      name: "Utilities",
      frequency: "Monthly",
      day: 28
    }),
    restaurants: buildBillTemplate({
      name: "Restaurants",
      frequency: "Weekly",
      day: ""
    }),
    gas: buildBillTemplate({
      name: "Gas/Travel",
      frequency: "Weekly",
      day: "Sunday"
    }),
    subscription: buildBillTemplate({
      name: "Netflix",
      frequency: "Monthly",
      day: 1
    }),
    addAnotherSubscription: false,
    subscriptionExtra: buildBillTemplate({
      name: "",
      frequency: "Monthly",
      day: 1
    }),
    misc: buildBillTemplate({
      name: "Misc",
      frequency: "Weekly",
      day: "Sunday"
    }),
    adultPurchases: "",
    debt: buildBillTemplate({
      name: "Student Loans",
      frequency: "Monthly",
      day: 12
    }),
    goals: {
      focus: "",
      name: "",
      targetAmount: "",
      targetDate: ""
    }
  }));

  async function refresh() {
    const fallback = buildDefaultState();
    const cached = loadCachedState();
    let current = cached ? { ...fallback, ...cached } : fallback;
    let libraries = buildDefaultLibraries(fallback);
    let safe = { safe_to_spend: 0, days: fallback.safe_to_spend_days };
    let week = null;
    let list = [];
    let alertItems = [];
    let suggested = [];

    try {
      try {
        const serverState = await getState();
        current = cached ? applyCachedFallback(serverState, cached, fallback) : serverState;
        saveCachedState(current);
      } catch (err) {
        if (!cached) {
          setSaveError("Failed to load state.");
        }
      }
      try {
        libraries = await getLibraries(1825);
      } catch (err) {
        console.error("Failed to load libraries.", err);
      }
      const results = await Promise.allSettled([
        getSafeToSpend(current.safe_to_spend_days || 14),
        getWeeklySummary(),
        getChecklist(current.cashflow_days || 30),
        getAlerts(),
        getRecurringSuggestions()
      ]);
      safe = results[0].status === "fulfilled" ? results[0].value : safe;
      week = results[1].status === "fulfilled" ? results[1].value : week;
      list = results[2].status === "fulfilled" ? results[2].value : list;
      alertItems = results[3].status === "fulfilled" ? results[3].value : alertItems;
      suggested = results[4].status === "fulfilled" ? results[4].value : suggested;
    } finally {
      if (current.cc_pay_day === null || current.cc_pay_day === undefined) {
        current = {
          ...current,
          cc_pay_day: 13,
          cc_pay_method_value:
            current.cc_pay_method_value || "I want to pay my bill in full"
        };
        saveCachedState(current);
      }
      setState(current);
      setLibs(libraries);
      setSafeSpend(safe);
      setWeeklySummary(week);
      setChecklist(list);
      setAlerts(alertItems);
      setSuggestions(suggested);
    }
  }

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("budget_paid_events", JSON.stringify(paidEvents));
    } catch (err) {
      // ignore persistence errors
    }
  }, [paidEvents]);

  useEffect(() => {
    if (!state) return;
    if (localStorage.getItem("budget_onboarding_done")) return;
    setOnboardingOpen(true);
  }, [state]);

  useEffect(() => {
    if (!state || inputsHydrated) return;
    if (state.debit_balance !== null && state.debit_balance !== undefined) {
      setDebitBalanceInput(String(state.debit_balance));
    }
    if (state.credit_balance !== null && state.credit_balance !== undefined) {
      setCreditBalanceInput(String(state.credit_balance));
    }
    if (state.cc_pay_day !== null && state.cc_pay_day !== undefined) {
      setCcPayDayInput(String(state.cc_pay_day));
    }
    if (state.cc_pay_amount_value !== null && state.cc_pay_amount_value !== undefined) {
      setCcPayAmountInput(String(state.cc_pay_amount_value));
    }
    if (state.cc_apr_value !== null && state.cc_apr_value !== undefined) {
      setCcAprInput(String(state.cc_apr_value));
    }
    setInputsHydrated(true);
  }, [state, inputsHydrated]);

  async function updateState(patch) {
    mergeCachedState(state, patch);
    const saved = await putState(patch);
    saveCachedState(saved);
    setState(saved);
    const libraries = await getLibraries(1825);
    setLibs(libraries);
  }

  async function commitState(patch, reason) {
    setSaveError("");
    mergeCachedState(state, patch);
    try {
      const saved = await saveState({
        putState,
        payload: patch,
        dirty: true,
        log: console.log,
        onSuccess: (next) => {
          console.log("[save] reason", reason);
          saveCachedState(next);
          setState(next);
        },
        onError: (err) => {
          console.error("[save] failed", err);
          setSaveError(err?.message || "Failed to save");
        },
        onFinally: () => {
          console.log("[save] done");
        }
      });
      const libraries = await getLibraries(1825);
      setLibs(libraries);
      return saved;
    } catch (err) {
      return null;
    }
  }

  if (loading || !state || !libs) {
    return <div className="loading">Loading...</div>;
  }

  const cashflowDays = Number(state.cashflow_days || 30);
  const debitBalance = Number(state.debit_balance || 0);
  const creditBalance = Number(state.credit_balance || 0);
  const billsTable = state.bills || [];
  const incomeTable = state.income || [];
  const categories = state.categories || [];
  const budgets = state.budgets || [];
  const accounts = state.accounts || [];
  const today = new Date();

  const cashflowStart = new Date();
  cashflowStart.setHours(0, 0, 0, 0);
  const cashflowEnd = new Date();
  cashflowEnd.setDate(cashflowStart.getDate() + cashflowDays);
  const cashflowToday =
    parseIsoDate(libs.debit_balance_forecast?.[0]?.date) || cashflowStart;

  const ccDebug = computeCcBillWindows(state, cashflowDays, cashflowStart);

  function withinRange(entry) {
    const date = parseIsoDate(entry.date) || new Date(entry.date);
    return date >= cashflowStart && date <= cashflowEnd;
  }

  const debitBills = (libs.upcoming_debit_bills || []).filter(withinRange);
  const creditBills = (libs.upcoming_credit_bills || []).filter(withinRange);
  const incomes = (libs.upcoming_incomes || []).filter(withinRange);

  const totalIncome = incomes.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalBills = debitBills
    .concat(creditBills)
    .filter((item) => item.name !== "Credit Card Bill")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const net = totalIncome - totalBills;

  const debitBalanceMap = new Map();
  (libs.debit_balance_forecast || []).forEach((item) => {
    const date = parseIsoDate(item.date);
    if (date && date >= cashflowStart && date <= cashflowEnd) {
      debitBalanceMap.set(item.date, Number(item.balance || 0));
    }
  });

  const creditBalanceMap = new Map();
  (libs.credit_balance_forecast || []).forEach((item) => {
    const date = parseIsoDate(item.date);
    if (date && date >= cashflowStart && date <= cashflowEnd) {
      creditBalanceMap.set(item.date, Number(item.balance || 0));
    }
  });

  let lowestBalance = debitBalance;
  let lowestDate = cashflowStart;
  debitBalanceMap.forEach((balance, dateString) => {
    if (balance < lowestBalance) {
      lowestBalance = balance;
      lowestDate = parseIsoDate(dateString) || cashflowStart;
    }
  });

  const cashflowEvents = [];
  debitBills.forEach((bill) => {
    cashflowEvents.push({
      date: bill.date,
      item: bill.name || "",
      type: "Debit",
      amount: Number(bill.amount || 0),
      isIncome: false,
      sourceId: bill.sourceId || ""
    });
  });
  creditBills.forEach((bill) => {
    cashflowEvents.push({
      date: bill.date,
      item: bill.name || "",
      type: "Credit",
      amount: Number(bill.amount || 0),
      isIncome: false,
      sourceId: bill.sourceId || ""
    });
  });
  incomes.forEach((inc) => {
    cashflowEvents.push({
      date: inc.date,
      item: inc.name || "",
      type: "Debit",
      amount: Number(inc.amount || 0),
      isIncome: true,
      sourceId: inc.sourceId || ""
    });
  });
  cashflowEvents.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const cashflowEventsWithKeys = cashflowEvents.map((event) => ({
    ...event,
    key: buildPaidKey({
      sourceId: event.sourceId,
      name: event.item,
      date: event.date,
      type: event.type,
      amount: event.amount
    })
  }));

  const paidDebitAdjustments = new Map();
  const paidCreditAdjustments = new Map();
  const addAdjustment = (map, date, delta) => {
    if (!delta) return;
    map.set(date, (map.get(date) || 0) + delta);
  };

  let paidAwareTotalIncome = 0;
  let paidAwareTotalBills = 0;
  cashflowEventsWithKeys.forEach((event) => {
    const isPaid = Boolean(paidEvents?.[event.key]);
    if (!isPaid) {
      if (event.isIncome) {
        paidAwareTotalIncome += event.amount;
      } else if (event.item !== "Credit Card Bill") {
        paidAwareTotalBills += event.amount;
      }
    } else if (event.isIncome) {
      addAdjustment(paidDebitAdjustments, event.date, -event.amount);
    } else if (event.type === "Debit") {
      addAdjustment(paidDebitAdjustments, event.date, event.amount);
    } else if (event.type === "Credit") {
      addAdjustment(paidCreditAdjustments, event.date, -event.amount);
    }
  });

  const paidAwareNet = paidAwareTotalIncome - paidAwareTotalBills;
  const paidBalanceDates = new Set([
    ...debitBalanceMap.keys(),
    ...creditBalanceMap.keys(),
    ...cashflowEventsWithKeys.map((event) => event.date)
  ]);
  const paidBalanceDateList = Array.from(paidBalanceDates).sort();
  let paidDebitAdjRunning = 0;
  let paidCreditAdjRunning = 0;
  const paidDebitBalanceMap = new Map();
  const paidCreditBalanceMap = new Map();
  paidBalanceDateList.forEach((dateKey) => {
    paidDebitAdjRunning += paidDebitAdjustments.get(dateKey) || 0;
    paidCreditAdjRunning += paidCreditAdjustments.get(dateKey) || 0;
    const baseDebit = debitBalanceMap.get(dateKey) ?? debitBalance;
    const baseCredit = creditBalanceMap.get(dateKey) ?? creditBalance;
    paidDebitBalanceMap.set(dateKey, baseDebit + paidDebitAdjRunning);
    paidCreditBalanceMap.set(dateKey, baseCredit + paidCreditAdjRunning);
  });
  let paidLowestBalance = debitBalance;
  let paidLowestDate = cashflowStart;
  paidDebitBalanceMap.forEach((balance, dateString) => {
    if (balance < paidLowestBalance) {
      paidLowestBalance = balance;
      paidLowestDate = parseIsoDate(dateString) || cashflowStart;
    }
  });

  const graphEndDate = state.graph_end_date
    ? parseIsoDate(state.graph_end_date)
    : new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const graphView = state.graph_view_type || "Both";

  const graphDateList = [];
  const graphData = [];
  const endDate = graphEndDate || new Date();
  const daysDiff = Math.max(0, Math.floor((endDate - today) / (24 * 60 * 60 * 1000)));
  for (let i = 0; i <= daysDiff; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    graphDateList.push(date);
  }

  const debitMap = new Map(
    (libs.debit_balance_forecast || []).map((item) => [item.date, Number(item.balance || 0)])
  );
  const creditMap = new Map(
    (libs.credit_balance_forecast || []).map((item) => [item.date, Number(item.balance || 0)])
  );
  graphDateList.forEach((date) => {
    const iso = date.toISOString().slice(0, 10);
    const row = { date: iso };
    if (graphView === "Debit" || graphView === "Both") {
      row.debit = debitMap.get(iso) ?? debitBalance;
    }
    if (graphView === "Credit" || graphView === "Both") {
      row.credit = creditMap.get(iso) ?? creditBalance;
    }
    graphData.push(row);
  });

  const debitFloorTarget = Number(state.debit_floor_target || 0);
  const forecastedLow = (() => {
    const items = libs.debit_balance_forecast || [];
    if (items.length === 0) return null;
    let min = Number(items[0].balance || 0);
    let minDate = items[0].date;
    items.forEach((item) => {
      const value = Number(item.balance || 0);
      if (value < min) {
        min = value;
        minDate = item.date;
      }
    });
    return { min, minDate };
  })();

  const projectionSentence = (() => {
    if (!debitFloorTarget) return null;
    const items = (libs.debit_balance_forecast || []).slice();
    if (items.length === 0) return null;
    items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const horizon = Math.min(1825, items.length);
    const balances = items.slice(0, horizon).map((item) => Number(item.balance || 0));
    const result = computeSnpProjection(balances, debitFloorTarget);
    const rounded = Math.round(result.calculatedReturn);
    const isDev = import.meta?.env?.DEV;
    if (isDev) {
      const invariant = Math.abs(result.finalInvestmentValue - result.totalTransferred - result.calculatedReturn);
      if (invariant > 1) {
        // eslint-disable-next-line no-console
        console.warn("S&P projection invariant mismatch", {
          minProjected: result.minProjected,
          cap: result.cap,
          totalTransferred: result.totalTransferred,
          finalInvestmentValue: result.finalInvestmentValue,
          finalHypDebit: result.finalHypDebit,
          invariant
        });
      }
    }
    return `By investing any savings beyond a ${formatCurrency(
      debitFloorTarget
    )} minimum balance into the S&P 500, you are projected to earn an additional ${formatCurrency(
      rounded
    )} over the next 5.0 years (assuming a 7% average annual return).`;
  })();

  function openBillModal(bill) {
    setBillModal(
      bill || {
        name: "",
        amount: "",
        frequency: "Weekly",
        type: "Credit",
        day: WEEK_DAYS[0]
      }
    );
  }

  function openIncomeModal(inc) {
    setIncomeModal(
      inc || {
        name: "",
        amount: "",
        frequency: "Weekly",
        day: WEEK_DAYS[0]
      }
    );
  }

  function buildFrequencyCell(frequency, day) {
    if (!frequency) return "";
    const freq = String(frequency).toLowerCase();
    if (freq.startsWith("month")) {
      return `${frequency} (${ordinal(day)})`;
    }
    if (freq.startsWith("week")) {
      const label = day ? String(day) : "";
      return label ? `${frequency} (${label}${label.endsWith("s") ? "" : "s"})` : frequency;
    }
    if (freq.startsWith("biweek")) {
      const date = parseIsoDate(day);
      const label = date ? date.toLocaleDateString("en-US", { weekday: "long" }) : String(day || "");
      return label ? `${frequency} (${label}${label.endsWith("s") ? "" : "s"})` : frequency;
    }
    if (freq.startsWith("ann")) {
      const date = parseIsoDate(day);
      const label = date ? date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" }) : String(day || "");
      return label ? `${frequency} (${label})` : frequency;
    }
    if (freq === "one-time" || freq === "one time") {
      const date = parseIsoDate(day);
      const label = date ? date.toLocaleDateString("en-US") : String(day || "");
      return label ? `${frequency} (${label})` : frequency;
    }
    return frequency;
  }

  const showOnboarding = false;

  async function appendBill(entry) {
    const payload = {
      ...entry,
      id: entry.id || `bill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    };
    payload.amount = Number(payload.amount || 0);
    if (payload.frequency === "Monthly") {
      payload.day = payload.day === "" || payload.day === null ? 1 : Number(payload.day);
    }
    const next = (state?.bills || []).concat(payload);
    await commitState({ bills: next }, "onboarding_bill");
  }

  async function appendIncome(entry) {
    const payload = {
      ...entry,
      id: entry.id || `income_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    };
    payload.amount = Number(payload.amount || 0);
    if (payload.frequency === "Monthly") {
      payload.day = payload.day === "" || payload.day === null ? 1 : Number(payload.day);
    }
    const next = (state?.income || []).concat(payload);
    await commitState({ income: next }, "onboarding_income");
  }

  async function handleOnboardingNext() {
    if (onboardingStep === 1) {
      const debit = Number(onboardingData.debitBalance || 0);
      const credit = Number(onboardingData.creditBalance || 0);
      localStorage.setItem("budget_first_name", onboardingData.firstName || "");
      await commitState(
        { debit_balance: debit, credit_balance: credit },
        "onboarding_balances"
      );
    }
    if (onboardingStep === 2) {
      await appendIncome(onboardingData.income);
    }
    if (onboardingStep === 3) {
      await appendBill(onboardingData.rent);
    }
    if (onboardingStep === 4) {
      await appendBill(onboardingData.groceries);
    }
    if (onboardingStep === 5) {
      await appendBill(onboardingData.utilities);
    }
    if (onboardingStep === 6) {
      await appendBill(onboardingData.restaurants);
    }
    if (onboardingStep === 7) {
      await appendBill(onboardingData.gas);
    }
    if (onboardingStep === 8) {
      await appendBill(onboardingData.subscription);
    }
    if (onboardingStep === 9) {
      await appendBill(onboardingData.subscriptionExtra);
    }
    if (onboardingStep === 10) {
      const miscBase = Number(onboardingData.misc.amount || 0);
      const adult = Number(onboardingData.adultPurchases || 0);
      const merged = {
        ...onboardingData.misc,
        amount: miscBase + adult
      };
      await appendBill(merged);
    }
    if (onboardingStep === 11) {
      await appendBill(onboardingData.debt);
    }
    if (onboardingStep === 12) {
      localStorage.setItem("budget_goal_focus", onboardingData.goals.focus || "");
      localStorage.setItem("budget_goal_name", onboardingData.goals.name || "");
      localStorage.setItem("budget_goal_amount", onboardingData.goals.targetAmount || "");
      localStorage.setItem("budget_goal_date", onboardingData.goals.targetDate || "");
      localStorage.setItem("budget_onboarding_done", "1");
      setOnboardingOpen(false);
      return;
    }

    if (onboardingStep === 8 && onboardingData.addAnotherSubscription) {
      setOnboardingStep(9);
      return;
    }
    if (onboardingStep === 8 && !onboardingData.addAnotherSubscription) {
      setOnboardingStep(10);
      return;
    }
    setOnboardingStep((prev) => Math.min(prev + 1, 12));
  }

  async function applyDanSettings() {
    const bills = [
      buildBillTemplate({
        name: "Rent",
        amount: 1825,
        frequency: "Monthly",
        day: 1,
        type: "Debit"
      }),
      buildBillTemplate({
        name: "Loans",
        amount: 211,
        frequency: "Monthly",
        day: 9,
        type: "Debit"
      }),
      buildBillTemplate({
        name: "CookUnity",
        amount: 165,
        frequency: "Weekly",
        day: "Monday",
        type: "Credit"
      }),
      buildBillTemplate({
        name: "Gas + Misc",
        amount: 300,
        frequency: "Weekly",
        day: "Monday",
        type: "Credit"
      }),
      buildBillTemplate({
        name: "Geico",
        amount: 146,
        frequency: "Monthly",
        day: 19,
        type: "Credit"
      }),
      buildBillTemplate({
        name: "Utilities",
        amount: 80,
        frequency: "Monthly",
        day: 28,
        type: "Credit"
      }),
      buildBillTemplate({
        name: "Wifi",
        amount: 35,
        frequency: "Monthly",
        day: 28,
        type: "Credit"
      }),
      buildBillTemplate({
        name: "Lemonade",
        amount: 7,
        frequency: "Monthly",
        day: 28,
        type: "Credit"
      }),
      buildBillTemplate({
        name: "Spotify",
        amount: 12,
        frequency: "Monthly",
        day: 3,
        type: "Credit"
      })
    ].map((entry) => ({
      ...entry,
      id: `bill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    }));

    const income = [
      buildIncomeTemplate({
        name: "Paycheck",
        amount: 1750,
        frequency: "Biweekly",
        day: "2026-01-23"
      }),
      buildIncomeTemplate({
        name: "Tutor",
        amount: 180,
        frequency: "Weekly",
        day: "Monday"
      })
    ].map((entry) => ({
      ...entry,
      id: `income_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    }));

    await commitState(
      {
        debit_balance: 1000,
        credit_balance: 500,
        cc_pay_method_value: "I want to pay my bill in full",
        cc_pay_day: 13,
        cc_pay_amount_unit_value: 0,
        cc_pay_amount_value: null,
        cc_apr_value: null,
        bills,
        income
      },
      "apply_dan_settings"
    );

    setDebitBalanceInput("1000");
    setCreditBalanceInput("500");
    setCcPayDayInput("13");
    setCcPayAmountInput("");
    setCcAprInput("");
    localStorage.setItem("budget_onboarding_done", "1");
    setOnboardingOpen(false);
  }

  function handleOnboardingBack() {
    if (onboardingStep === 9 && onboardingData.addAnotherSubscription) {
      setOnboardingStep(8);
      return;
    }
    setOnboardingStep((prev) => Math.max(prev - 1, 0));
  }

  function renderOnboardingBody() {
    if (onboardingStep === 0) {
      return (
        <>
          <h3>Welcome to Budget App</h3>
          <p className="muted">Let’s set up your budget in just a couple of minutes.</p>
          <p className="muted">We’ll ask a few simple questions about your balances and spending so we can build a budget that actually fits your life.
No bank connections required. You can change everything later.</p>
          <label>
            <input
              type="checkbox"
              checked={danSettingsEnabled}
              onChange={async (e) => {
                const checked = e.target.checked;
                setDanSettingsEnabled(checked);
                if (checked) {
                  await applyDanSettings();
                }
              }}
            />
            Dan settings
          </label>
        </>
      );
    }
    if (onboardingStep === 1) {
      return (
        <>
          <h3>Let&#39;s get a quick snapshot</h3>
          <p className="muted">We&#39;ll start with your name and current balances.</p>
          <label>
            First name
            <input
              value={onboardingData.firstName}
              onChange={(e) =>
                setOnboardingData((prev) => ({ ...prev, firstName: e.target.value }))
              }
            />
          </label>
          <label>
            Cash/Checking Balance
            <input
              type="number"
              value={onboardingData.debitBalance}
              onChange={(e) =>
                setOnboardingData((prev) => ({ ...prev, debitBalance: e.target.value }))
              }
            />
          </label>
          <label>
            Credit Card Balance
            <input
              type="number"
              value={onboardingData.creditBalance}
              onChange={(e) =>
                setOnboardingData((prev) => ({ ...prev, creditBalance: e.target.value }))
              }
            />
          </label>
        </>
      );
    }
    if (onboardingStep === 2) {
      const inc = onboardingData.income;
      return (
        <>
          <h3>“How much do you usually get paid?”</h3>
          <p className="muted">
            This is editable anytime, and you can add more income sources later.
          </p>
          <label>
            Income name
            <input
              value={inc.name}
              onChange={(e) =>
                setOnboardingData((prev) => ({
                  ...prev,
                  income: { ...prev.income, name: e.target.value }
                }))
              }
            />
          </label>
          <label>
            Amount
            <input
              type="number"
              min="0"
              value={inc.amount}
              onChange={(e) =>
                setOnboardingData((prev) => ({
                  ...prev,
                  income: { ...prev.income, amount: e.target.value }
                }))
              }
            />
          </label>
          <label>
            Frequency
            <ChoiceGroup
              value={inc.frequency}
              options={INCOME_FREQUENCIES.map((f) => ({ label: f, value: f }))}
              onChange={(value) =>
                setOnboardingData((prev) => ({
                  ...prev,
                  income: { ...prev.income, frequency: value }
                }))
              }
            />
          </label>
          {inc.frequency === "Weekly" && (
            <label>
              Day of the week
              <ChoiceGroup
                value={inc.day}
                options={WEEK_DAYS.map((day) => ({ label: day, value: day }))}
                onChange={(value) =>
                  setOnboardingData((prev) => ({
                    ...prev,
                    income: { ...prev.income, day: value }
                  }))
                }
              />
            </label>
          )}
          {inc.frequency === "Monthly" && (
            <label>
              Day of the month
              <input
                type="number"
                min="1"
                max="31"
                value={inc.day}
                onChange={(e) =>
                  setOnboardingData((prev) => ({
                    ...prev,
                    income: { ...prev.income, day: e.target.value }
                  }))
                }
              />
            </label>
          )}
          {inc.frequency === "Biweekly" && (
            <label>
              Date of Paycheck
              <input
                type="date"
                value={inc.day}
                onChange={(e) =>
                  setOnboardingData((prev) => ({
                    ...prev,
                    income: { ...prev.income, day: e.target.value }
                  }))
                }
              />
            </label>
          )}
          {(inc.frequency === "Annually" || inc.frequency === "One-time") && (
            <label>
              Date
              <input
                type="date"
                value={inc.day}
                onChange={(e) =>
                  setOnboardingData((prev) => ({
                    ...prev,
                    income: { ...prev.income, day: e.target.value }
                  }))
                }
              />
            </label>
          )}
        </>
      );
    }

    const billSteps = {
      3: { key: "rent", title: "Let's add your housing cost" },
      4: { key: "groceries", title: "How much do you spend on groceries?" },
      5: { key: "utilities", title: "Let's add utilities" },
      6: { key: "restaurants", title: "Dining & takeout" },
      7: { key: "gas", title: "Gas & travel" },
      8: { key: "subscription", title: "Subscriptions" },
      9: { key: "subscriptionExtra", title: "Add another subscription" },
      10: { key: "misc", title: "Anything else you buy in a week?" },
      11: { key: "debt", title: "Any debt?" }
    };
    if (billSteps[onboardingStep]) {
      const { key, title } = billSteps[onboardingStep];
      const bill = onboardingData[key];
      return (
        <>
          <h3>{title}</h3>
          {onboardingStep === 8 && (
            <p className="muted">
              We'll add Netflix as a placeholder. You can edit or add more later.
            </p>
          )}
          {onboardingStep === 9 && (
            <p className="muted">Add another subscription you pay regularly.</p>
          )}
          {onboardingStep === 10 && (
            <p className="muted">
              Treat this like a weekly allowance. We'll keep it low-key in Misc.
            </p>
          )}
          {onboardingStep === 11 && (
            <p className="muted">We'll add Student Loans to start.</p>
          )}
          <label>
            Name
            <input
              value={bill.name}
              onChange={(e) =>
                setOnboardingData((prev) => ({
                  ...prev,
                  [key]: { ...prev[key], name: e.target.value }
                }))
              }
            />
          </label>
          <label>
            Amount
            <input
              type="number"
              min="0"
              value={bill.amount}
              onChange={(e) =>
                setOnboardingData((prev) => ({
                  ...prev,
                  [key]: { ...prev[key], amount: e.target.value }
                }))
              }
            />
          </label>
          <label>
            Credit or Debit
            <ChoiceGroup
              value={bill.type}
              options={[
                { label: "Debit", value: "Debit" },
                { label: "Credit", value: "Credit" }
              ]}
              onChange={(value) =>
                setOnboardingData((prev) => ({
                  ...prev,
                  [key]: { ...prev[key], type: value }
                }))
              }
            />
          </label>
          <label>
            Frequency
            <ChoiceGroup
              value={bill.frequency}
              options={BILL_FREQUENCIES.map((f) => ({ label: f, value: f }))}
              onChange={(value) =>
                setOnboardingData((prev) => ({
                  ...prev,
                  [key]: { ...prev[key], frequency: value }
                }))
              }
            />
          </label>
          {bill.frequency === "Weekly" && (
            <label>
              Day of the week
              <ChoiceGroup
                value={bill.day}
                options={
                  onboardingStep === 6
                    ? buildWeeklyDayOptions()
                    : WEEK_DAYS.map((day) => ({ label: day, value: day }))
                }
                onChange={(value) =>
                  setOnboardingData((prev) => ({
                    ...prev,
                    [key]: { ...prev[key], day: value }
                  }))
                }
              />
            </label>
          )}
          {bill.frequency === "Monthly" && (
            <label>
              Day of the month
              <input
                type="number"
                min="1"
                max="31"
                value={bill.day}
                onChange={(e) =>
                  setOnboardingData((prev) => ({
                    ...prev,
                    [key]: { ...prev[key], day: e.target.value }
                  }))
                }
              />
            </label>
          )}
          {bill.frequency === "Biweekly" && (
            <label>
              Anchor date
              <input
                type="date"
                value={bill.day}
                onChange={(e) =>
                  setOnboardingData((prev) => ({
                    ...prev,
                    [key]: { ...prev[key], day: e.target.value }
                  }))
                }
              />
            </label>
          )}
          {(bill.frequency === "Annually" || bill.frequency === "One-time") && (
            <label>
              Date
              <input
                type="date"
                value={bill.day}
                onChange={(e) =>
                  setOnboardingData((prev) => ({
                    ...prev,
                    [key]: { ...prev[key], day: e.target.value }
                  }))
                }
              />
            </label>
          )}
          {onboardingStep === 8 && (
            <label className="row">
              <input
                type="checkbox"
                checked={onboardingData.addAnotherSubscription}
                onChange={(e) =>
                  setOnboardingData((prev) => ({
                    ...prev,
                    addAnotherSubscription: e.target.checked
                  }))
                }
              />
              <span className="muted">
                I have another subscription I&#39;d like to enter (you can do this again later).
              </span>
            </label>
          )}
          {onboardingStep === 10 && (
            <label>
              Any adult purchases? (bars, nicotine, gambling)
              <input
                type="number"
                min="0"
                value={onboardingData.adultPurchases}
                onChange={(e) =>
                  setOnboardingData((prev) => ({
                    ...prev,
                    adultPurchases: e.target.value
                  }))
                }
              />
            </label>
          )}
        </>
      );
    }

    if (onboardingStep === 12) {
      const goals = onboardingData.goals;
      return (
        <>
          <h3>Top goals</h3>
          <p className="muted">What are you focusing on right now?</p>
          <ChoiceGroup
            value={goals.focus}
            options={GOAL_OPTIONS.map((goal) => ({ label: goal, value: goal }))}
            onChange={(value) =>
              setOnboardingData((prev) => ({
                ...prev,
                goals: { ...prev.goals, focus: value }
              }))
            }
          />
          {goals.focus === "Save for something specific" && (
            <>
              <label>
                Goal name
                <input
                  value={goals.name}
                  onChange={(e) =>
                    setOnboardingData((prev) => ({
                      ...prev,
                      goals: { ...prev.goals, name: e.target.value }
                    }))
                  }
                />
              </label>
              <label>
                Target amount
                <input
                  type="number"
                  min="0"
                  value={goals.targetAmount}
                  onChange={(e) =>
                    setOnboardingData((prev) => ({
                      ...prev,
                      goals: { ...prev.goals, targetAmount: e.target.value }
                    }))
                  }
                />
              </label>
              <label>
                Target date
                <input
                  type="date"
                  value={goals.targetDate}
                  onChange={(e) =>
                    setOnboardingData((prev) => ({
                      ...prev,
                      goals: { ...prev.goals, targetDate: e.target.value }
                    }))
                  }
                />
              </label>
            </>
          )}
        </>
      );
    }

    return null;
  }

  function loadSampleData() {
    const sampleBills = [
      { name: "Rent", amount: 1200, frequency: "Monthly", day: 1, type: "Debit" },
      { name: "Electric", amount: 90, frequency: "Monthly", day: 15, type: "Debit" }
    ];
    const sampleIncome = [
      { name: "Paycheck", amount: 2000, frequency: "Biweekly", day: new Date().toISOString().slice(0, 10) }
    ];
    const sampleCategories = [
      { name: "Housing", type: "Expense" },
      { name: "Utilities", type: "Expense" },
      { name: "Income", type: "Income" }
    ];
    updateState({
      bills: sampleBills,
      income: sampleIncome,
      categories: sampleCategories
    });
    localStorage.setItem("budget_onboarding_done", "1");
  }

  function applyTemplates() {
    const templateBills = [
      { name: "Rent", amount: 1200, frequency: "Monthly", day: 1, type: "Debit" }
    ];
    const templateIncome = [
      { name: "Paycheck", amount: 2000, frequency: "Biweekly", day: new Date().toISOString().slice(0, 10) }
    ];
    updateState({
      bills: billsTable.concat(templateBills),
      income: incomeTable.concat(templateIncome)
    });
    localStorage.setItem("budget_onboarding_done", "1");
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>Budget App</h2>
        {["My $", "Bills & Income", "Graph", "Insights"].map((label) => (
          <button
            key={label}
            type="button"
            className={page === label ? "nav active" : "nav"}
            onClick={() => setPage(label)}
          >
            {label}
          </button>
        ))}
      </aside>
      <main className="content">
        {saveError && <p className="error">{saveError}</p>}
        {showOnboarding && (
          <div className="card">
            <h3>Quick Start</h3>
            <p className="muted">
              Add sample data or templates to see how cash flow works.
            </p>
            <div className="row">
              <button type="button" onClick={loadSampleData}>
                Load Sample Data
              </button>
              <button type="button" className="ghost" onClick={applyTemplates}>
                Apply Templates
              </button>
            </div>
          </div>
        )}
        {page === "My $" && (
          <>
            <h1>My $</h1>
            <div className="card">
              <h3>Current Balances</h3>
              <div className="grid">
                <label>
                  Debit
                  <input
                    type="number"
                    value={debitBalanceInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setDebitBalanceInput(raw);
                      if (raw !== "") {
                        commitState({ debit_balance: Number(raw || 0) }, "debit_balance");
                      }
                    }}
                  />
                </label>
                <label>
                  Credit
                  <input
                    type="number"
                    value={creditBalanceInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setCreditBalanceInput(raw);
                      if (raw !== "") {
                        commitState({ credit_balance: Number(raw || 0) }, "credit_balance");
                      }
                    }}
                  />
                  <button type="button" onClick={() => setCcModalOpen(true)}>
                    Edit credit card bill
                  </button>
                </label>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>My Bills</h3>
                <button type="button" onClick={() => openBillModal(null)}>
                  Add Bill
                </button>
              </div>
              {billsTable.length === 0 ? (
                <p className="muted">No bills added yet.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Amount</th>
                      <th>Frequency</th>
                      <th>Type</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billsTable.map((bill) => (
                      <tr key={bill.id}>
                        <td>{bill.name}</td>
                        <td>{formatCurrency(bill.amount)}</td>
                        <td>{buildFrequencyCell(bill.frequency, bill.day)}</td>
                        <td>{bill.type}</td>
                        <td>
                          <button type="button" onClick={() => openBillModal(bill)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <h3>My Income</h3>
                <button type="button" onClick={() => openIncomeModal(null)}>
                  Add Income
                </button>
              </div>
              {incomeTable.length === 0 ? (
                <p className="muted">No income added yet.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Amount</th>
                      <th>Frequency</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomeTable.map((inc) => (
                      <tr key={inc.id}>
                        <td>{inc.name}</td>
                        <td>{formatCurrency(inc.amount)}</td>
                        <td>{buildFrequencyCell(inc.frequency, inc.day)}</td>
                        <td>
                          <button type="button" onClick={() => openIncomeModal(inc)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {page === "Bills & Income" && (
          <>
            <h1>Bills & Income</h1>
            <div className="row">
              <label>
                Days
                <input
                  type="number"
                  min="1"
                  max="1825"
                  value={cashflowDaysInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setCashflowDaysInput(raw);
                    if (raw !== "") {
                      updateState({ cashflow_days: Number(raw || 1) });
                    }
                  }}
                />
              </label>
              <label>
                View
                <select
                  value={state.cashflow_view_filter || "All"}
                  onChange={(e) => updateState({ cashflow_view_filter: e.target.value })}
                >
                  <option value="All">All</option>
                  <option value="Debit">Debit</option>
                  <option value="Credit">Credit</option>
                </select>
              </label>
            </div>
            <div className="card">
              <h3>Upcoming Cash Flow - Next {cashflowDays} Days</h3>
              <div className="summary">
                <div>
                  <strong>Income</strong> {formatCurrency(paidAwareTotalIncome)}
                </div>
                <div>
                  <strong>Bills</strong> {formatCurrency(paidAwareTotalBills)}
                </div>
                <div>
                  <strong>Net</strong> {paidAwareNet >= 0 ? "+" : "-"}
                  {formatCurrency(Math.abs(paidAwareNet))} {paidAwareNet >= 0 ? "OK" : "WARN"}
                </div>
              </div>
              <p className="muted">
                Lowest Balance: {formatDateShort(paidLowestDate)} - {formatCurrency(paidLowestBalance)}
              </p>
            </div>

            <div className="card">
              {cashflowEventsWithKeys.length === 0 ? (
                <p className="muted">No upcoming items in the selected range.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Item</th>
                      <th>Credit or Debit</th>
                      <th className="right">Amount</th>
                      <th className="right">Debit Balance</th>
                      <th className="right">Credit Balance</th>
                      <th className="right">Paid?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashflowEventsWithKeys
                      .filter((ev) => {
                        const view = state.cashflow_view_filter || "All";
                        if (view === "All") return true;
                        return ev.type === view;
                      })
                      .map((ev, index) => {
                        const isPaid = Boolean(paidEvents?.[ev.key]);
                        const dateObj = parseIsoDate(ev.date);
                        const dateLabel = dateObj
                          ? isSameCalendarDay(dateObj, cashflowToday)
                            ? "Today"
                            : isSameCalendarDay(dateObj, addDays(cashflowToday, 1))
                              ? "Tomorrow"
                              : formatDateShort(dateObj)
                          : ev.date;
                        const debitBal = paidDebitBalanceMap.get(ev.date) ?? debitBalance;
                        const creditBal = paidCreditBalanceMap.get(ev.date) ?? creditBalance;
                        const paidClass = isPaid ? "paid-cell" : "";
                        return (
                          <tr
                            key={`${ev.date}-${ev.item}-${index}`}
                            style={{ backgroundColor: ev.isIncome ? "#e9f8ef" : "#fdecea" }}
                          >
                            <td className={paidClass}>{dateLabel}</td>
                            <td className={paidClass}>{ev.item}</td>
                            <td className={paidClass}>{ev.type}</td>
                            <td className={`right ${paidClass}`}>{formatCurrency(ev.amount)}</td>
                            <td className="right">{formatCurrency(debitBal)}</td>
                            <td className="right">{formatCurrency(creditBal)}</td>
                            <td className="right">
                              <input
                                type="checkbox"
                                checked={isPaid}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setPaidEvents((prev) => {
                                    const next = { ...(prev || {}) };
                                    if (checked) {
                                      next[ev.key] = true;
                                    } else {
                                      delete next[ev.key];
                                    }
                                    return next;
                                  });
                                }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {page === "Graph" && (
          <>
            <h1>Graph</h1>
            <div className="row">
              <label>
                View
                <select
                  value={graphView}
                  onChange={(e) => updateState({ graph_view_type: e.target.value })}
                >
                  <option value="Debit">Debit</option>
                  <option value="Credit">Credit</option>
                  <option value="Both">Both</option>
                </select>
              </label>
              <label>
                Date Forecasted Until
                <input
                  type="date"
                  value={(graphEndDate || new Date()).toISOString().slice(0, 10)}
                  onChange={(e) => updateState({ graph_end_date: e.target.value })}
                />
              </label>
            </div>
            <div className="card chart">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={graphData}>
                  <XAxis dataKey="date" tickFormatter={formatAxisDate} />
                  <YAxis tickFormatter={formatCurrency} />
                  <Tooltip
                    formatter={(value, name) => [formatCurrency(value), name]}
                    labelFormatter={formatTooltipDate}
                  />
                  <Legend />
                  {(graphView === "Debit" || graphView === "Both") && (
                    <Line type="monotone" dataKey="debit" name="Debit" stroke="#2f855a" dot={false} />
                  )}
                  {(graphView === "Credit" || graphView === "Both") && (
                    <Line type="monotone" dataKey="credit" name="Credit" stroke="#c53030" dot={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {page === "Insights" && (
          <>
            <h1>Insights</h1>
            <div className="card">
              <h3>Investment Advice</h3>
              <div className="row">
                <span className="muted">I want to have no less than $</span>
                <input
                  type="number"
                  value={debitFloorInput}
                  onChange={(e) => setDebitFloorInput(e.target.value)}
                />
                <span className="muted">in my debit accounts.</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = Number(debitFloorInput || 0);
                    commitState({ debit_floor_target: next }, "update_debit_floor");
                  }}
                >
                  Update
                </button>
              </div>
              {projectionSentence && <p className="muted">{projectionSentence}</p>}
            </div>
            <div className="card">
              <div className="card-header">
                <h3>CC Bill Debug</h3>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowCcDebug((prev) => !prev)}
                >
                  {showCcDebug ? "Hide" : "Show"}
                </button>
              </div>
              {!state.cc_pay_day && <p className="muted">No CC pay day set.</p>}
              {state.cc_pay_day && showCcDebug && (
                <>
                  <p className="muted">
                    Pay dates: {(ccDebug.payDates || []).join(", ") || "None"}
                  </p>
                  {(ccDebug.rows || []).length === 0 ? (
                    <p className="muted">No CC bill rows found.</p>
                  ) : (
                    (ccDebug.rows || []).map((row) => (
                      <p key={row.date} className="muted">
                        {row.date}: balance {formatCurrency(row.creditBeforePayment)} + day
                        charges {formatCurrency(row.dailyCredit)} → bill{" "}
                        {formatCurrency(row.payAmount)}
                      </p>
                    ))
                  )}
                </>
              )}
            </div>
          </>
        )}



      </main>

      {billModal && (
        <Modal title="Add/Edit Bill" onClose={() => setBillModal(null)}>
          <div className="form-grid">
            <label>
              Bill Name
              <input
                value={billModal.name}
                onChange={(e) => setBillModal({ ...billModal, name: e.target.value })}
              />
            </label>
            <label>
              Amount
              <input
                type="number"
                min="0"
                value={billModal.amount ?? ""}
                onChange={(e) =>
                  setBillModal({ ...billModal, amount: e.target.value })
                }
              />
            </label>
            <label>
              Credit or Debit
              <select
                value={billModal.type}
                onChange={(e) => setBillModal({ ...billModal, type: e.target.value })}
              >
                <option value="Credit">Credit</option>
                <option value="Debit">Debit</option>
              </select>
            </label>
            <label>
              Frequency
              <ChoiceGroup
                value={billModal.frequency}
                options={BILL_FREQUENCIES.map((f) => ({ label: f, value: f }))}
                onChange={(value) => setBillModal({ ...billModal, frequency: value })}
              />
            </label>
            {billModal.frequency === "Weekly" && (
              <label>
                Day of the Week
                <select
                  value={billModal.day}
                  onChange={(e) => setBillModal({ ...billModal, day: e.target.value })}
                >
                  {WEEK_DAYS.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {billModal.frequency === "Monthly" && (
              <label>
                Day of the Month
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={billModal.day ?? ""}
                  onChange={(e) =>
                    setBillModal({ ...billModal, day: e.target.value })
                  }
                />
              </label>
            )}
            {billModal.frequency === "Biweekly" && (
              <label>
                Anchor Date
                <input
                  type="date"
                  value={billModal.day || ""}
                  onChange={(e) =>
                    setBillModal({ ...billModal, day: e.target.value })
                  }
                />
              </label>
            )}
            {(billModal.frequency === "Annually" || billModal.frequency === "One-time") && (
              <label>
                Date
                <input
                  type="date"
                  value={billModal.day || ""}
                  onChange={(e) =>
                    setBillModal({ ...billModal, day: e.target.value })
                  }
                />
              </label>
            )}
          </div>
          <div className="modal-actions">
            {billModal.id && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  const next = billsTable.filter((b) => b.id !== billModal.id);
                  commitState({ bills: next }, "delete_bill");
                  setBillModal(null);
                }}
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                console.log("[save] click save_bill");
                const payload = { ...billModal };
                if (!payload.id) {
                  payload.id = `bill_${Date.now()}`;
                }
                payload.amount = Number(payload.amount || 0);
                if (payload.frequency === "Monthly") {
                  payload.day = payload.day === "" || payload.day === null ? 1 : Number(payload.day);
                }
                const next = billModal.id
                  ? billsTable.map((b) => (b.id === billModal.id ? payload : b))
                  : billsTable.concat(payload);
                await commitState({ bills: next }, "save_bill");
                setBillModal(null);
              }}
            >
              Save Bill
            </button>
          </div>
        </Modal>
      )}

      {incomeModal && (
        <Modal title="Add/Edit Income" onClose={() => setIncomeModal(null)}>
          <div className="form-grid">
            <label>
              Income Name
              <input
                value={incomeModal.name}
                onChange={(e) =>
                  setIncomeModal({ ...incomeModal, name: e.target.value })
                }
              />
            </label>
            <label>
              Amount
              <input
                type="number"
                min="0"
                value={incomeModal.amount ?? ""}
                onChange={(e) =>
                  setIncomeModal({
                    ...incomeModal,
                    amount: e.target.value
                  })
                }
              />
            </label>
            <label>
              Frequency
              <ChoiceGroup
                value={incomeModal.frequency}
                options={INCOME_FREQUENCIES.map((f) => ({ label: f, value: f }))}
                onChange={(value) => setIncomeModal({ ...incomeModal, frequency: value })}
              />
            </label>
            {incomeModal.frequency === "Weekly" && (
              <label>
                Day of the Week
                <select
                  value={incomeModal.day}
                  onChange={(e) =>
                    setIncomeModal({ ...incomeModal, day: e.target.value })
                  }
                >
                  {WEEK_DAYS.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {incomeModal.frequency === "Monthly" && (
              <label>
                Day of the Month
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={incomeModal.day ?? ""}
                  onChange={(e) =>
                    setIncomeModal({ ...incomeModal, day: e.target.value })
                  }
                />
              </label>
            )}
            {incomeModal.frequency === "Biweekly" && (
              <label>
                Anchor Date
                <input
                  type="date"
                  value={incomeModal.day || ""}
                  onChange={(e) =>
                    setIncomeModal({ ...incomeModal, day: e.target.value })
                  }
                />
              </label>
            )}
            {(incomeModal.frequency === "Annually" || incomeModal.frequency === "One-time") && (
              <label>
                Date
                <input
                  type="date"
                  value={incomeModal.day || ""}
                  onChange={(e) =>
                    setIncomeModal({ ...incomeModal, day: e.target.value })
                  }
                />
              </label>
            )}
          </div>
          <div className="modal-actions">
            {incomeModal.id && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  const next = incomeTable.filter((i) => i.id !== incomeModal.id);
                  commitState({ income: next }, "delete_income");
                  setIncomeModal(null);
                }}
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                console.log("[save] click save_income");
                const payload = { ...incomeModal };
                if (!payload.id) {
                  payload.id = `income_${Date.now()}`;
                }
                payload.amount = Number(payload.amount || 0);
                if (payload.frequency === "Monthly") {
                  payload.day = payload.day === "" || payload.day === null ? 1 : Number(payload.day);
                }
                const next = incomeModal.id
                  ? incomeTable.map((i) => (i.id === incomeModal.id ? payload : i))
                  : incomeTable.concat(payload);
                await commitState({ income: next }, "save_income");
                setIncomeModal(null);
              }}
            >
              Save Income
            </button>
          </div>
        </Modal>
      )}

      {ccModalOpen && (
        <Modal title="Edit Credit Card Bill" onClose={() => setCcModalOpen(false)}>
          <div className="form-grid">
            <label>
              What day of the month do you pay your Credit Card?
              <input
                type="number"
                min="1"
                max="31"
                value={ccPayDayInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  setCcPayDayInput(raw);
                  if (raw !== "") {
                    commitState({ cc_pay_day: Number(raw || 1) }, "cc_pay_day");
                  }
                }}
              />
            </label>
            <label>
              How do you pay your credit card?
              <ChoiceGroup
                value={state.cc_pay_method_value || "I want to pay my bill in full"}
                options={[
                  { label: "I want to pay my bill in full", value: "I want to pay my bill in full" },
                  { label: "I pay the minimum", value: "I pay the minimum" },
                  { label: "Custom", value: "Custom" }
                ]}
                onChange={(value) => commitState({ cc_pay_method_value: value }, "cc_pay_method")}
              />
            </label>
            {(state.cc_pay_method_value === "I pay the minimum" ||
              state.cc_pay_method_value === "Custom") && (
              <>
                <label>
                  Amount type
                  <ChoiceGroup
                    value={Number(state.cc_pay_amount_unit_value || 0)}
                    options={[
                      { label: "Dollar amount ($)", value: 0 },
                      { label: "Percentage (%)", value: 1 }
                    ]}
                    onChange={(value) =>
                      commitState({ cc_pay_amount_unit_value: Number(value) }, "cc_pay_amount_unit")
                    }
                  />
                </label>
                <label>
                  Payment amount{" "}
                  {Number(state.cc_pay_amount_unit_value || 0) === 1 ? "(%)" : "($)"}
                  <input
                    type="number"
                    min="0"
                    value={ccPayAmountInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setCcPayAmountInput(raw);
                      if (raw !== "") {
                        commitState(
                          { cc_pay_amount_value: Number(raw || 0) },
                          "cc_pay_amount_value"
                        );
                      }
                    }}
                  />
                </label>
                <label>
                  APR (%)
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={ccAprInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setCcAprInput(raw);
                      if (raw !== "") {
                        commitState(
                          { cc_apr_value: Number(raw || 0) },
                          "cc_apr_value"
                        );
                      }
                    }}
                  />
                </label>
              </>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" onClick={() => setCcModalOpen(false)}>
              Done
            </button>
          </div>
        </Modal>
      )}

      {onboardingOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <h3>Welcome</h3>
              {onboardingStep > 0 && (
                <button type="button" className="ghost" onClick={handleOnboardingBack}>
                  Back
                </button>
              )}
            </div>
            <div className="form-grid">{renderOnboardingBody()}</div>
            <div className="modal-actions">
              <button type="button" onClick={handleOnboardingNext}>
                {onboardingStep === 12 ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
