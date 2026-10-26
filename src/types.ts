export interface Transaction {
  id: string;
  description: string;
  amount: number;
  date: string; // ISO
}

export interface Budget {
  id: string;
  name: string;
  limit: number;
  income?: number;
  transactions: Transaction[];
}

export interface SavingsGoal {
  id: string;
  name: string;
  target: number;
  saved: number;
}

export interface RecurringTransaction {
  id: string;
  budgetId: string;
  description: string;
  amount: number;
  frequency: 'weekly' | 'monthly';
  nextDueDate: string;
  dayOfMonth?: number;
}

export interface AppData {
  budgets: Budget[];
  globalIncome?: number;
  savingsPercentage?: number;
  savingsGoals?: SavingsGoal[];
  timeZone?: string;
  budgetAlertThreshold?: number;
  recurringTransactions?: RecurringTransaction[];
}
