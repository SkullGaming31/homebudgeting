import { getZonedDateKey } from './timezone';

export interface SearchableTransaction {
  id: string;
  description: string;
  amount: number;
  date: string;
  budgetId: string;
  budgetName: string;
}

export interface TransactionFilters {
  query: string;
  budgetId: string;
  minAmount?: number;
  maxAmount?: number;
  fromDate: string;
  toDate: string;
  timeZone?: string;
}

export function filterTransactions<T extends SearchableTransaction>(
  transactions: readonly T[],
  filters: TransactionFilters
) {
  const query = filters.query.trim().toLocaleLowerCase();

  return transactions
    .filter((transaction) => {
      const date = getZonedDateKey(transaction.date, filters.timeZone);
      if (!date) return false;
      if (query && !transaction.description.toLocaleLowerCase().includes(query)) return false;
      if (filters.budgetId && transaction.budgetId !== filters.budgetId) return false;
      if (filters.minAmount !== undefined && transaction.amount < filters.minAmount) return false;
      if (filters.maxAmount !== undefined && transaction.amount > filters.maxAmount) return false;
      if (filters.fromDate && date < filters.fromDate) return false;
      if (filters.toDate && date > filters.toDate) return false;
      return true;
    })
    .sort((first, second) => Date.parse(second.date) - Date.parse(first.date));
}
