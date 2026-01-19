export function computeSnpProjection(balances, debitFloor, dailyReturn) {
  const safeBalances = Array.isArray(balances) ? balances.slice() : [];
  if (safeBalances.length === 0 || debitFloor === null || debitFloor === undefined) {
    return {
      calculatedReturn: 0,
      totalTransferred: 0,
      finalInvestmentValue: 0,
      finalHypDebit: safeBalances[safeBalances.length - 1] ?? 0,
      minProjected: 0,
      cap: 0
    };
  }
  const minProjected = Math.min(...safeBalances);
  const cap = minProjected - debitFloor;
  const dr = dailyReturn ?? Math.pow(1.07, 1 / 365) - 1;
  const horizon = safeBalances.length;
  const minFuture = new Array(horizon);
  for (let i = horizon - 1; i >= 0; i -= 1) {
    const next = i === horizon - 1 ? safeBalances[i] : minFuture[i + 1];
    minFuture[i] = Math.min(safeBalances[i], next);
  }
  let investmentValue = 0;
  let cumTransferred = 0;
  for (let i = 0; i < horizon; i += 1) {
    investmentValue *= 1 + dr;
    const maxCumAllowed = minFuture[i] - debitFloor;
    const transferToday = Math.max(0, maxCumAllowed - cumTransferred);
    investmentValue += transferToday;
    cumTransferred += transferToday;
  }
  const baselineNetWorth = safeBalances[horizon - 1];
  const finalHypDebit = baselineNetWorth - cumTransferred;
  const investingNetWorth = finalHypDebit + investmentValue;
  const calculatedReturn = investingNetWorth - baselineNetWorth;
  return {
    calculatedReturn,
    totalTransferred: cumTransferred,
    finalInvestmentValue: investmentValue,
    finalHypDebit,
    minProjected,
    cap
  };
}
