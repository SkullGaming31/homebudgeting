import { getMonthInputValue, getMonthKey } from './budget';
import { TimeZone } from './timezone';

interface SpendingTransaction {
  amount: number;
  date: string;
}

interface SpendingBudget {
  name: string;
  transactions?: readonly SpendingTransaction[];
}

export interface SpendingCategoryTotal {
  name: string;
  total: number;
}

export interface SpendingMonthTotal {
  month: string;
  total: number;
}

export interface SpendingSummary {
  categories: SpendingCategoryTotal[];
  months: SpendingMonthTotal[];
  total: number;
}

export function getSpendingSummary(
  budgets: readonly SpendingBudget[],
  selectedMonth: string,
  timeZone?: TimeZone
): SpendingSummary {
  const [year, month] = selectedMonth.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)
    || !Number.isFinite(monthStart.getTime())
    || getMonthInputValue(monthStart) !== selectedMonth
  ) {
    throw new RangeError('Selected month must be a valid YYYY-MM value');
  }

  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(year, month - 6 + index, 1);
    return { month: getMonthInputValue(date), total: 0 };
  });
  const monthlyTotals = new Map(months.map(({ month: monthKey }) => [monthKey, 0]));
  const categories = new Map<string, number>();

  for (const budget of budgets) {
    for (const transaction of budget.transactions || []) {
      if (transaction.amount <= 0) continue;
      const transactionMonth = getMonthKey(transaction.date, timeZone);
      if (!transactionMonth) continue;

      if (transactionMonth === selectedMonth) {
        categories.set(
          budget.name,
          (categories.get(budget.name) || 0) + transaction.amount
        );
      }

      if (monthlyTotals.has(transactionMonth)) {
        monthlyTotals.set(
          transactionMonth,
          (monthlyTotals.get(transactionMonth) || 0) + transaction.amount
        );
      }
    }
  }

  const categoryTotals = [...categories]
    .map(([name, total]) => ({ name, total }))
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
  const monthTotals = months.map(({ month: monthKey }) => ({
    month: monthKey,
    total: monthlyTotals.get(monthKey) || 0,
  }));

  return {
    categories: categoryTotals,
    months: monthTotals,
    total: categoryTotals.reduce((sum, category) => sum + category.total, 0),
  };
}
