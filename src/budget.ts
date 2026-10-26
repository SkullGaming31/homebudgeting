export function getBudgetRemaining(
  limit: number,
  transactions: readonly { amount: number }[] = []
) {
  const spent = transactions.reduce((total, transaction) => total + transaction.amount, 0);
  return limit - spent;
}

export function getMonthInputValue(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

export function getMonthKey(date: string) {
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime())) return null;
  return getMonthInputValue(parsed);
}

export function getTransactionsForMonth<T extends { date: string }>(
  transactions: readonly T[],
  month: string
) {
  return transactions.filter((transaction) => getMonthKey(transaction.date) === month);
}
