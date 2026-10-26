import { promises as fs } from 'fs';
import path from 'path';
import { app } from 'electron';
import { AppData, Budget, RecurringTransaction, SavingsGoal, Transaction } from './types';
import { getNextOccurrenceDate, isValidDateKey } from './recurring';
import { isValidTimeZone } from './timezone';
import { appendCsvTransactions, CsvTransactionRow, validateAppData } from './dataTransfer';

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export class Store {
  filePath: string;
  data: AppData = { budgets: [] };

  constructor(filename = 'data.json') {
    const userData = app.getPath('userData');
    this.filePath = path.join(userData, filename);
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw) as AppData;
    } catch (err) {
      this.data = { budgets: [], globalIncome: 0 };
      await this.save();
    }
    return this.data;
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  async getAppData() {
    await this.load();
    return validateAppData(this.data);
  }

  async replaceAppData(data: unknown) {
    const validatedData = validateAppData(data);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${makeId()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(validatedData, null, 2), 'utf8');
      await fs.rename(temporaryPath, this.filePath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch((cleanupError: NodeJS.ErrnoException) => {
        if (cleanupError.code !== 'ENOENT') throw cleanupError;
      });
      throw error;
    }
    this.data = validatedData;
    return validateAppData(this.data);
  }

  async importTransactions(rows: CsvTransactionRow[]) {
    await this.load();
    const importedData = appendCsvTransactions(this.data, rows, makeId);
    await this.replaceAppData(importedData);
    return rows.length;
  }

  async getGlobalIncome() {
    await this.load();
    return this.data.globalIncome || 0;
  }

  async getBudgetAlertThreshold() {
    await this.load();
    const threshold = this.data.budgetAlertThreshold ?? 80;
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) {
      throw new Error('Saved budget alert threshold must be between 1 and 100');
    }
    return threshold;
  }

  async setBudgetAlertThreshold(threshold: number) {
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) {
      throw new Error('Budget alert threshold must be between 1 and 100');
    }
    await this.load();
    this.data.budgetAlertThreshold = threshold;
    await this.save();
    return threshold;
  }

  async getSavingsPercentage() {
    await this.load();
    return this.data.savingsPercentage || 0;
  }

  async setSavingsPercentage(percentage: number) {
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      throw new Error('Savings percentage must be between 0 and 100');
    }
    await this.load();
    this.data.savingsPercentage = percentage;
    await this.save();
    return this.data.savingsPercentage;
  }

  async getTimeZone() {
    await this.load();
    return this.data.timeZone || '';
  }

  async setTimeZone(timeZone: string) {
    if (typeof timeZone !== 'string' || (timeZone && !isValidTimeZone(timeZone))) {
      throw new Error('Time zone must be empty or a valid IANA time zone');
    }
    await this.load();
    this.data.timeZone = timeZone;
    await this.save();
    return this.data.timeZone;
  }

  async getRecurringTransactions() {
    await this.load();
    return this.data.recurringTransactions || [];
  }

  async createRecurringTransaction(
    budgetId: string,
    description: string,
    amount: number,
    nextDueDate: string,
    frequency: 'weekly' | 'monthly'
  ) {
    if (typeof description !== 'string' || !description.trim()) {
      throw new Error('Recurring transaction description is required');
    }
    if (!Number.isFinite(amount)) throw new Error('Recurring transaction amount must be finite');
    if (!isValidDateKey(nextDueDate)) throw new Error('Recurring transaction due date is invalid');
    if (frequency !== 'weekly' && frequency !== 'monthly') {
      throw new Error('Recurrence frequency must be weekly or monthly');
    }

    await this.load();
    if (!this.data.budgets.some((budget) => budget.id === budgetId)) {
      throw new Error('Budget not found');
    }
    const schedule: RecurringTransaction = {
      id: makeId(),
      budgetId,
      description: description.trim(),
      amount,
      frequency,
      nextDueDate,
      ...(frequency === 'monthly' ? { dayOfMonth: Number(nextDueDate.slice(-2)) } : {}),
    };
    this.data.recurringTransactions = [...(this.data.recurringTransactions || []), schedule];
    await this.save();
    return schedule;
  }

  async updateRecurringTransaction(
    id: string,
    budgetId: string,
    description: string,
    amount: number,
    nextDueDate: string,
    frequency: 'weekly' | 'monthly'
  ) {
    if (typeof description !== 'string' || !description.trim()) {
      throw new Error('Recurring transaction description is required');
    }
    if (!Number.isFinite(amount)) throw new Error('Recurring transaction amount must be finite');
    if (!isValidDateKey(nextDueDate)) throw new Error('Recurring transaction due date is invalid');
    if (frequency !== 'weekly' && frequency !== 'monthly') {
      throw new Error('Recurrence frequency must be weekly or monthly');
    }

    await this.load();
    if (!this.data.budgets.some((budget) => budget.id === budgetId)) {
      throw new Error('Budget not found');
    }
    const schedule = (this.data.recurringTransactions || []).find((item) => item.id === id);
    if (!schedule) throw new Error('Recurring transaction not found');
    schedule.budgetId = budgetId;
    schedule.description = description.trim();
    schedule.amount = amount;
    schedule.frequency = frequency;
    schedule.nextDueDate = nextDueDate;
    if (frequency === 'monthly') schedule.dayOfMonth = Number(nextDueDate.slice(-2));
    else delete schedule.dayOfMonth;
    await this.save();
    return schedule;
  }

  async completeRecurringTransaction(id: string, amount: number, date: string) {
    if (!Number.isFinite(amount)) throw new Error('Transaction amount must be finite');
    const transactionDate = new Date(date);
    if (!Number.isFinite(transactionDate.getTime())) throw new Error('Transaction date is invalid');

    await this.load();
    const schedule = (this.data.recurringTransactions || []).find((item) => item.id === id);
    if (!schedule) throw new Error('Recurring transaction not found');
    const budget = this.data.budgets.find((item) => item.id === schedule.budgetId);
    if (!budget) throw new Error('Budget not found');

    const transaction: Transaction = {
      id: makeId(),
      description: schedule.description,
      amount,
      date: transactionDate.toISOString(),
    };
    budget.transactions.push(transaction);
    schedule.nextDueDate = getNextOccurrenceDate(
      schedule.nextDueDate,
      schedule.frequency,
      schedule.dayOfMonth
    );
    await this.save();
    return { transaction, schedule };
  }

  async skipRecurringOccurrence(id: string) {
    await this.load();
    const schedule = (this.data.recurringTransactions || []).find((item) => item.id === id);
    if (!schedule) throw new Error('Recurring transaction not found');
    schedule.nextDueDate = getNextOccurrenceDate(
      schedule.nextDueDate,
      schedule.frequency,
      schedule.dayOfMonth
    );
    await this.save();
    return schedule;
  }

  async deleteRecurringTransaction(id: string) {
    await this.load();
    this.data.recurringTransactions = (this.data.recurringTransactions || [])
      .filter((schedule) => schedule.id !== id);
    await this.save();
  }

  async getSavingsGoals() {
    await this.load();
    return this.data.savingsGoals || [];
  }

  async createSavingsGoal(name: string, target: number) {
    if (!name.trim()) throw new Error('Savings goal name is required');
    if (!Number.isFinite(target) || target <= 0) {
      throw new Error('Savings goal target must be greater than 0');
    }
    await this.load();
    const goal: SavingsGoal = { id: makeId(), name: name.trim(), target, saved: 0 };
    this.data.savingsGoals = [...(this.data.savingsGoals || []), goal];
    await this.save();
    return goal;
  }

  async updateSavingsGoal(id: string, name: string, target: number, saved: number) {
    if (!name.trim()) throw new Error('Savings goal name is required');
    if (!Number.isFinite(target) || target <= 0) {
      throw new Error('Savings goal target must be greater than 0');
    }
    if (!Number.isFinite(saved) || saved < 0) {
      throw new Error('Savings goal balance cannot be negative');
    }
    await this.load();
    const goal = (this.data.savingsGoals || []).find((item) => item.id === id);
    if (!goal) throw new Error('Savings goal not found');
    goal.name = name.trim();
    goal.target = target;
    goal.saved = saved;
    await this.save();
    return goal;
  }

  async deleteSavingsGoal(id: string) {
    await this.load();
    this.data.savingsGoals = (this.data.savingsGoals || []).filter((goal) => goal.id !== id);
    await this.save();
  }

  async setGlobalIncome(amount: number) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Global income must be a finite non-negative amount');
    }
    await this.load();
    this.data.globalIncome = amount;
    await this.save();
    return this.data.globalIncome;
  }

  async getBudgets() {
    await this.load();
    return this.data.budgets;
  }

  async createBudget(name: string, limit: number, income: number = 0) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Budget name is required');
    }
    await this.load();
    const b: Budget = { id: makeId(), name: name.trim(), limit, income: income || 0, transactions: [] };
    this.data.budgets.push(b);
    await this.save();
    return b;
  }

  async deleteBudget(id: string) {
    await this.load();
    this.data.budgets = this.data.budgets.filter((b) => b.id !== id);
    this.data.recurringTransactions = (this.data.recurringTransactions || [])
      .filter((schedule) => schedule.budgetId !== id);
    await this.save();
  }

  async updateBudget(budgetId: string, name: string, limit: number, income: number) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Budget name is required');
    }
    await this.load();
    const budget = this.data.budgets.find((b) => b.id === budgetId);
    if (!budget) throw new Error('Budget not found');
    budget.name = name.trim();
    budget.limit = limit;
    budget.income = income;
    await this.save();
    return budget;
  }

  async addTransaction(budgetId: string, description: string, amount: number, date?: string) {
    await this.load();
    const budget = this.data.budgets.find((b) => b.id === budgetId);
    if (!budget) throw new Error('Budget not found');
    const transactionDate = date ? new Date(date) : new Date();
    if (!Number.isFinite(transactionDate.getTime())) throw new Error('Transaction date is invalid');
    const t: Transaction = { id: makeId(), description, amount, date: transactionDate.toISOString() };
    budget.transactions.push(t);
    await this.save();
    return t;
  }

  async updateTransaction(budgetId: string, transactionId: string, description: string, amount: number, date?: string) {
    await this.load();
    const budget = this.data.budgets.find((b) => b.id === budgetId);
    if (!budget) throw new Error('Budget not found');
    const tx = budget.transactions.find((t) => t.id === transactionId);
    if (!tx) throw new Error('Transaction not found');
    const transactionDate = date === undefined ? undefined : new Date(date);
    if (transactionDate && !Number.isFinite(transactionDate.getTime())) throw new Error('Transaction date is invalid');
    tx.description = description;
    tx.amount = amount;
    if (transactionDate) tx.date = transactionDate.toISOString();
    await this.save();
    return tx;
  }

  async deleteTransaction(budgetId: string, transactionId: string) {
    await this.load();
    const budget = this.data.budgets.find((b) => b.id === budgetId);
    if (!budget) throw new Error('Budget not found');
    budget.transactions = budget.transactions.filter((t) => t.id !== transactionId);
    await this.save();
  }

  async getTransactions(budgetId: string) {
    await this.load();
    const budget = this.data.budgets.find((b) => b.id === budgetId);
    return budget ? budget.transactions : [];
  }
}
