const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const LOCAL_ONLY = import.meta.env.VITE_LOCAL_ONLY === "true";
const LOCAL_STATE_KEY = "budget_local_state";

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

function saveLocalState(next) {
  try {
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(next));
  } catch (err) {
    // ignore local save failures
  }
}

export async function getState() {
  if (LOCAL_ONLY) {
    return loadLocalState() || {};
  }
  const res = await fetch(buildUrl("/api/state"), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Failed to load state");
  }
  return res.json();
}

export async function putState(payload) {
  if (LOCAL_ONLY) {
    const current = loadLocalState() || {};
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
    return {
      upcoming_debit_bills: [],
      upcoming_credit_bills: [],
      upcoming_incomes: [],
      debit_balance_forecast: [],
      credit_balance_forecast: []
    };
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
    return { safe_to_spend: 0, days };
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
