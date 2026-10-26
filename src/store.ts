import { promises as fs } from 'fs';
import path from 'path';
import { app } from 'electron';
import { AppData, Budget, SavingsGoal, Transaction } from './types';

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

  async getGlobalIncome() {
    await this.load();
    return this.data.globalIncome || 0;
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

  async updateTransaction(budgetId: string, transactionId: string, description: string, amount: number) {
    await this.load();
    const budget = this.data.budgets.find((b) => b.id === budgetId);
    if (!budget) throw new Error('Budget not found');
    const tx = budget.transactions.find((t) => t.id === transactionId);
    if (!tx) throw new Error('Transaction not found');
    tx.description = description;
    tx.amount = amount;
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
