const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

function buildUrl(path) {
  if (!API_BASE) return path;
  return `${API_BASE.replace(/\/$/, "")}${path}`;
}

function authHeaders() {
  return {};
}

export async function getState() {
  const res = await fetch(buildUrl("/api/state"), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Failed to load state");
  }
  return res.json();
}

export async function putState(payload) {
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
  const res = await fetch(buildUrl(`/api/libraries?days=${days}`), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Failed to load libraries");
  }
  return res.json();
}

export async function getAlerts() {
  const res = await fetch(buildUrl("/api/alerts"), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Failed to load alerts");
  }
  return res.json();
}

export async function registerUser(payload) {
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
  const res = await fetch(buildUrl(`/api/safe_to_spend?days=${days}`), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Failed to load safe to spend");
  }
  return res.json();
}

export async function getRecurringSuggestions() {
  const res = await fetch(buildUrl("/api/recurring/suggest"), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Failed to load suggestions");
  }
  return res.json();
}

export async function importCsv(file) {
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
  const res = await fetch(buildUrl(`/api/checklist?days=${days}`), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Checklist failed");
  }
  return res.json();
}

export async function markChecklist(payload) {
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
  const res = await fetch(buildUrl("/api/summary/weekly"), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Weekly summary failed");
  }
  return res.json();
}

export async function exportBackup() {
  const res = await fetch(buildUrl("/api/export"), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error("Export failed");
  }
  return res.json();
}

export async function uploadBackup(payload) {
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
