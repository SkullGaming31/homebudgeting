import { getZonedMonthKey, TimeZone } from './timezone';

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

export function getMonthKey(date: string, timeZone?: TimeZone) {
  return getZonedMonthKey(date, timeZone);
}

export function getTransactionsForMonth<T extends { date: string }>(
  transactions: readonly T[],
  month: string,
  timeZone?: TimeZone
) {
  return transactions.filter((transaction) => getMonthKey(transaction.date, timeZone) === month);
}
