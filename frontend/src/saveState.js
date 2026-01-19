export function summarizePayload(payload) {
  if (!payload || typeof payload !== "object") return { keys: [] };
  const keys = Object.keys(payload);
  const summary = { keys };
  if (Array.isArray(payload.bills)) summary.bills = payload.bills.length;
  if (Array.isArray(payload.income)) summary.income = payload.income.length;
  if (Array.isArray(payload.categories)) summary.categories = payload.categories.length;
  if (Array.isArray(payload.budgets)) summary.budgets = payload.budgets.length;
  if (Array.isArray(payload.accounts)) summary.accounts = payload.accounts.length;
  return summary;
}

export async function saveState({
  putState,
  payload,
  dirty,
  log,
  onSuccess,
  onError,
  onFinally
}) {
  log?.("[save] click");
  log?.("[save] dirty", dirty);
  log?.("[save] payload", summarizePayload(payload));
  try {
    log?.("[save] request");
    const saved = await putState(payload);
    log?.("[save] success");
    onSuccess?.(saved);
    return saved;
  } catch (err) {
    log?.("[save] error", err);
    onError?.(err);
    throw err;
  } finally {
    log?.("[save] finally");
    onFinally?.();
  }
}
