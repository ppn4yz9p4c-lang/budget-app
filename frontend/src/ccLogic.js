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

function buildPaidKey({ sourceId, name, date, type, amount }) {
  const base = sourceId || name || "";
  return `${base}|${date}|${type}|${amount}`;
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

function computeCcPayDates(startDate, days, ccPayDay) {
  if (ccPayDay === null || ccPayDay === undefined) return [];
  const schedule = {
    frequency: "Monthly",
    day: Number(ccPayDay),
    name: "Credit Card Bill",
    amount: 0
  };
  return occurrencesForEntry(schedule, startDate, days, false).map((occ) => occ.date);
}

function computeCcBillWindows(state, days, startDate = new Date(), paidEvents = {}) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const payDates = computeCcPayDates(start, days, state?.cc_pay_day);
  if (payDates.length === 0) {
    return { payDates: [], rows: [], payments: [] };
  }

  const payDateSet = new Set(payDates.map((date) => isoDate(date)));
  const creditChanges = new Map();
  const paidCreditChanges = new Map();
  const bills = Array.isArray(state?.bills) ? state.bills : [];
  bills.forEach((bill) => {
    const type = String(bill?.type || "").trim().toLowerCase();
    if (type === "debit") return;
    occurrencesForEntry(bill, start, days, false).forEach((occ) => {
      let occDate = occ.date;
      let dateKey = isoDate(occDate);
      if (payDateSet.has(dateKey)) {
        occDate = addDays(occDate, 1);
        dateKey = isoDate(occDate);
      }
      const amount = Math.abs(Number(occ.delta || 0));
      const paidKey = buildPaidKey({
        sourceId: bill.id || "",
        name: bill.name || "",
        date: dateKey,
        type: "Credit",
        amount
      });
      creditChanges.set(dateKey, (creditChanges.get(dateKey) || 0) + amount);
      if (paidEvents?.[paidKey]) {
        paidCreditChanges.set(dateKey, (paidCreditChanges.get(dateKey) || 0) + amount);
      }
    });
  });

  const sortedPayDates = payDates.slice().sort((a, b) => a - b);
  const payDateKeySet = new Set(sortedPayDates.map((date) => isoDate(date)));
  const rows = [];
  const payments = [];
  let creditRunning = Math.max(0, Number(state?.credit_balance || 0));
  let paidCreditRunning = 0;
  for (let i = 0; i <= days; i += 1) {
    const day = addDays(start, i);
    const key = isoDate(day);
    const dailyCredit = creditChanges.get(key) || 0;
    const dailyPaidCredit = paidCreditChanges.get(key) || 0;
    creditRunning += dailyCredit;
    paidCreditRunning += dailyPaidCredit;
    if (payDateKeySet.has(key)) {
      const creditBeforePayment = creditRunning - dailyCredit;
      const paidBeforePayment = paidCreditRunning - dailyPaidCredit;
      const payAmount = Math.max(0, creditBeforePayment - paidBeforePayment);
      rows.push({
        date: key,
        creditBeforePayment,
        dailyCredit,
        paidBeforePayment,
        payAmount
      });
      if (payAmount > 0) {
        payments.push({ date: key, amount: payAmount });
        creditRunning -= payAmount;
      }
    }
  }

  return {
    payDates: sortedPayDates.map((date) => isoDate(date)),
    rows,
    payments
  };
}

export {
  addDays,
  buildPaidKey,
  computeCcBillWindows,
  computeCcPayDates,
  isoDate,
  normalizeDate,
  occurrencesForEntry
};
