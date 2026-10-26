import React, { useEffect, useState } from 'react';
import Modal from './components/Modal';
import Toasts, { ToastItem } from './components/Toast';
import { formatCurrency } from './utils';
import { getBudgetRemaining, getMonthInputValue, getTransactionsForMonth } from '../budget';
import { calculateSavingsReserve } from '../savings';
import { getSpendingSummary } from '../spending';
import { filterTransactions } from '../transactions';

type Budget = { id: string; name: string; limit: number; income?: number; transactions?: Transaction[] };
type Transaction = { id: string; description: string; amount: number; date: string };
type SavingsGoal = { id: string; name: string; target: number; saved: number };

const THEME_KEY = 'theme-preference';
const GLOBAL_INCOME_KEY = 'home-budgeting-global-income';
const BUDGETS_KEY = 'home-budgeting-budgets';
const SAVINGS_PERCENTAGE_KEY = 'home-budgeting-savings-percentage';
const SAVINGS_GOALS_KEY = 'home-budgeting-savings-goals';

function readBrowserBudgets(): Budget[] {
  const stored = localStorage.getItem(BUDGETS_KEY);
  if (!stored) return [];
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed)) throw new Error('Saved browser budgets are invalid');
  return parsed as Budget[];
}

function writeBrowserBudgets(budgets: Budget[]) {
  localStorage.setItem(BUDGETS_KEY, JSON.stringify(budgets));
}

function readBrowserSavingsGoals(): SavingsGoal[] {
  const stored = localStorage.getItem(SAVINGS_GOALS_KEY);
  if (!stored) return [];
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed)) throw new Error('Saved browser savings goals are invalid');
  return parsed as SavingsGoal[];
}

function writeBrowserSavingsGoals(goals: SavingsGoal[]) {
  localStorage.setItem(SAVINGS_GOALS_KEY, JSON.stringify(goals));
}

function updateBrowserBudget(id: string, update: (budget: Budget) => void) {
  const budgets = readBrowserBudgets();
  const budget = budgets.find((item) => item.id === id);
  if (!budget) throw new Error('Budget not found');
  update(budget);
  writeBrowserBudgets(budgets);
}

function makeBrowserId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function getLocalDateInputValue(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${getMonthInputValue(date)}-${day}`;
}

function getDefaultTransactionDate(month: string) {
  const today = new Date();
  return getMonthInputValue(today) === month ? getLocalDateInputValue(today) : `${month}-01`;
}

function getLastDateOfMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch { }
}

function initTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY) as 'dark' | 'light' | null;
    if (saved) return applyTheme(saved);
  } catch { }
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(prefersDark ? 'dark' : 'light');
}

export default function App() {
  const [theme, setThemeState] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY) as 'dark' | 'light' | null;
      if (saved) return saved;
    } catch { }
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });

  function setTheme(t: 'dark' | 'light') {
    applyTheme(t);
    setThemeState(t);
  }
  const [animating, setAnimating] = useState(false);

  function handleThemeToggle() {
    // trigger a short animation, then swap theme
    setAnimating(true);
    setTimeout(() => {
      setTheme(theme === 'dark' ? 'light' : 'dark');
      setAnimating(false);
    }, 180);
  }
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [name, setName] = useState('');
  const [limit, setLimit] = useState<number | ''>('');
  const [current, setCurrent] = useState<{ id: string; name: string } | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [transactionSearch, setTransactionSearch] = useState('');
  const [transactionCategoryFilter, setTransactionCategoryFilter] = useState('');
  const [transactionMinAmount, setTransactionMinAmount] = useState<number | ''>('');
  const [transactionMaxAmount, setTransactionMaxAmount] = useState<number | ''>('');
  const [transactionFromDate, setTransactionFromDate] = useState('');
  const [transactionToDate, setTransactionToDate] = useState('');
  const [deleting, setDeleting] = useState<null | { id: string; name: string }>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState<number | ''>('');
  const [editingBudget, setEditingBudget] = useState<null | { id: string; name: string; limit: number; income?: number }>(null);
  const [editBudgetName, setEditBudgetName] = useState('');
  const [editBudgetLimit, setEditBudgetLimit] = useState<number | ''>('');
  const [editBudgetIncome, setEditBudgetIncome] = useState<number | ''>('');
  const [globalIncome, setGlobalIncome] = useState<number | ''>(0);
  const [savingsPercentage, setSavingsPercentage] = useState<number | ''>(0);
  const [selectedMonth, setSelectedMonth] = useState(() => getMonthInputValue());
  const [savingsGoalName, setSavingsGoalName] = useState('');
  const [savingsGoalTarget, setSavingsGoalTarget] = useState<number | ''>('');
  const [editingSavingsGoal, setEditingSavingsGoal] = useState<SavingsGoal | null>(null);
  const [editSavingsGoalName, setEditSavingsGoalName] = useState('');
  const [editSavingsGoalTarget, setEditSavingsGoalTarget] = useState<number | ''>('');
  const [editSavingsGoalSaved, setEditSavingsGoalSaved] = useState<number | ''>('');
  const [adjustingSavingsGoal, setAdjustingSavingsGoal] = useState<null | { goal: SavingsGoal; direction: 'add' | 'withdraw' }>(null);
  const [savingsAdjustment, setSavingsAdjustment] = useState<number | ''>('');
  const [deletingSavingsGoal, setDeletingSavingsGoal] = useState<SavingsGoal | null>(null);
  const [page, setPage] = useState<'home' | 'transactions' | 'savings' | 'settings'>('home');

  function showToast(message: string, type: ToastItem['type'] = 'info') {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((s) => [...s, { id, message, type }]);
  }

  function removeToast(id: string) {
    setToasts((s) => s.filter((t) => t.id !== id));
  }

  useEffect(() => {
    console.log('App mounted');
    initTheme();
    refresh();
  }, []);

  async function refresh() {
    try {
      const api = (window as any).api;
      setBudgets(api?.getBudgets ? await api.getBudgets() : readBrowserBudgets());
      const storedIncome = api?.getGlobalIncome
        ? await api.getGlobalIncome()
        : Number(localStorage.getItem(GLOBAL_INCOME_KEY)) || 0;
      setGlobalIncome(storedIncome);
      const storedSavingsPercentage = api?.getSavingsPercentage
        ? await api.getSavingsPercentage()
        : Number(localStorage.getItem(SAVINGS_PERCENTAGE_KEY)) || 0;
      setSavingsPercentage(storedSavingsPercentage);
      setSavingsGoals(api?.getSavingsGoals ? await api.getSavingsGoals() : readBrowserSavingsGoals());
    } catch {
      showToast('Failed to load saved data', 'error');
    }
  }

  async function saveSavingsPercentage() {
    const percentage = Number(savingsPercentage);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      showToast('Savings percentage must be between 0 and 100', 'error');
      return;
    }
    try {
      const api = (window as any).api;
      const savedPercentage = api?.setSavingsPercentage
        ? await api.setSavingsPercentage(percentage)
        : (localStorage.setItem(SAVINGS_PERCENTAGE_KEY, String(percentage)), percentage);
      setSavingsPercentage(savedPercentage);
      showToast('Savings percentage saved', 'success');
    } catch {
      showToast('Failed to save savings percentage', 'error');
    }
  }

  async function createSavingsGoal() {
    const target = Number(savingsGoalTarget);
    if (!savingsGoalName.trim()) {
      showToast('Enter a savings goal name', 'error');
      return;
    }
    if (!Number.isFinite(target) || target <= 0) {
      showToast('Enter a target greater than 0', 'error');
      return;
    }
    try {
      const api = (window as any).api;
      if (api?.createSavingsGoal) {
        await api.createSavingsGoal(savingsGoalName.trim(), target);
      } else {
        writeBrowserSavingsGoals([
          ...readBrowserSavingsGoals(),
          { id: makeBrowserId(), name: savingsGoalName.trim(), target, saved: 0 },
        ]);
      }
      setSavingsGoalName('');
      setSavingsGoalTarget('');
      await refresh();
      showToast('Savings goal created', 'success');
    } catch {
      showToast('Failed to create savings goal', 'error');
    }
  }

  async function saveSavingsGoal(goal: SavingsGoal, successMessage: string) {
    try {
      const api = (window as any).api;
      if (api?.updateSavingsGoal) {
        await api.updateSavingsGoal(goal.id, goal.name, goal.target, goal.saved);
      } else {
        const goals = readBrowserSavingsGoals();
        const goalIndex = goals.findIndex((item) => item.id === goal.id);
        if (goalIndex === -1) throw new Error('Savings goal not found');
        goals[goalIndex] = goal;
        writeBrowserSavingsGoals(goals);
      }
      await refresh();
      showToast(successMessage, 'success');
      return true;
    } catch {
      showToast('Failed to update savings goal', 'error');
      return false;
    }
  }

  async function confirmSavingsGoalEdit() {
    if (!editingSavingsGoal) return;
    const target = Number(editSavingsGoalTarget);
    const saved = Number(editSavingsGoalSaved);
    if (!editSavingsGoalName.trim() || !Number.isFinite(target) || target <= 0 ||
      !Number.isFinite(saved) || saved < 0) {
      showToast('Enter a name, a target greater than 0, and a non-negative saved amount', 'error');
      return;
    }
    const updated = await saveSavingsGoal({
      ...editingSavingsGoal,
      name: editSavingsGoalName.trim(),
      target,
      saved,
    }, 'Savings goal updated');
    if (updated) setEditingSavingsGoal(null);
  }

  async function confirmSavingsAdjustment() {
    if (!adjustingSavingsGoal) return;
    const amount = Number(savingsAdjustment);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Enter an amount greater than 0', 'error');
      return;
    }
    const { goal, direction } = adjustingSavingsGoal;
    if (direction === 'withdraw' && amount > goal.saved) {
      showToast('Withdrawal cannot exceed the saved amount', 'error');
      return;
    }
    const updated = await saveSavingsGoal({
      ...goal,
      saved: goal.saved + (direction === 'add' ? amount : -amount),
    }, direction === 'add' ? 'Contribution added' : 'Withdrawal recorded');
    if (updated) {
      setAdjustingSavingsGoal(null);
      setSavingsAdjustment('');
    }
  }

  async function saveGlobalIncome() {
    const amount = globalIncome === '' ? 0 : Number(globalIncome);
    if (!Number.isFinite(amount) || amount < 0) {
      showToast('Enter a non-negative global income amount', 'error');
      return;
    }

    try {
      const api = (window as any).api;
      const savedIncome = api?.setGlobalIncome
        ? await api.setGlobalIncome(amount)
        : (localStorage.setItem(GLOBAL_INCOME_KEY, String(amount)), amount);
      setGlobalIncome(savedIncome);
      showToast(
        api?.setGlobalIncome ? 'Global income saved' : 'Global income saved in this browser',
        'success'
      );
    } catch {
      showToast('Failed to save global income', 'error');
    }
  }

  async function createBudget() {
    const budgetName = name.trim();
    if (!budgetName) {
      showToast('Enter a budget name', 'error');
      return;
    }
    try {
      const api = (window as any).api;
      if (api?.createBudget) {
        await api.createBudget(budgetName, Number(limit) || 0);
      } else {
        const budgets = readBrowserBudgets();
        budgets.push({
          id: makeBrowserId(),
          name: budgetName,
          limit: Number(limit) || 0,
          income: 0,
          transactions: [],
        });
        writeBrowserBudgets(budgets);
      }
      setName('');
      setLimit('');
      await refresh();
      showToast(api?.createBudget ? 'Budget created' : 'Budget created in this browser', 'success');
    } catch {
      showToast('Failed to create budget', 'error');
    }
  }

  async function openBudget(b: Budget) {
    // Toggle: if clicking the currently-open budget, close the transactions panel
    if (current && current.id === b.id) {
      setCurrent(null);
      setTxs([]);
      return;
    }

    setCurrent({ id: b.id, name: b.name });
    try {
      const api = (window as any).api;
      const transactions = api?.getTransactions
        ? await api.getTransactions(b.id)
        : readBrowserBudgets().find((budget) => budget.id === b.id)?.transactions || [];
      setTxs(transactions);
    } catch {
      showToast('Failed to load transactions', 'error');
    }
  }

  async function addTransaction(description: string, amount: number, date: string): Promise<boolean> {
    if (!current) {
      showToast('No budget selected', 'error');
      return false;
    }
    try {
      const api = (window as any).api;
      if (api?.addTransaction) {
        await api.addTransaction(current.id, description, amount, date);
        setTxs(await api.getTransactions(current.id));
      } else {
        const transaction: Transaction = { id: makeBrowserId(), description, amount, date };
        updateBrowserBudget(current.id, (budget) => {
          budget.transactions = [...(budget.transactions || []), transaction];
        });
        setTxs((transactions) => [...transactions, transaction]);
      }
      await refresh();
      showToast('Transaction added', 'success');
      return true;
    } catch {
      showToast('Failed to add transaction', 'error');
      return false;
    }
  }

  async function updateTransaction(transactionId: string, description: string, amount: number) {
    if (!current) return showToast('No budget selected', 'error');
    try {
      const api = (window as any).api;
      if (api?.updateTransaction) {
        await api.updateTransaction(current.id, transactionId, description, amount);
        setTxs(await api.getTransactions(current.id));
      } else {
        updateBrowserBudget(current.id, (budget) => {
          const transaction = budget.transactions?.find((item) => item.id === transactionId);
          if (!transaction) throw new Error('Transaction not found');
          transaction.description = description;
          transaction.amount = amount;
        });
        setTxs((transactions) => transactions.map((transaction) => (
          transaction.id === transactionId
            ? { ...transaction, description, amount }
            : transaction
        )));
      }
      await refresh();
      showToast('Transaction updated', 'success');
    } catch {
      showToast('Failed to update transaction', 'error');
    }
  }

  async function deleteTransaction(transactionId: string) {
    if (!current) return showToast('No budget selected', 'error');
    try {
      const api = (window as any).api;
      if (api?.deleteTransaction) {
        await api.deleteTransaction(current.id, transactionId);
        setTxs(await api.getTransactions(current.id));
      } else {
        updateBrowserBudget(current.id, (budget) => {
          budget.transactions = (budget.transactions || []).filter((item) => item.id !== transactionId);
        });
        setTxs((transactions) => transactions.filter((transaction) => transaction.id !== transactionId));
      }
      await refresh();
      showToast('Transaction deleted', 'info');
    } catch {
      showToast('Failed to delete transaction', 'error');
    }
  }

  async function deleteSearchedTransaction(transaction: Transaction & { budgetId: string }) {
    try {
      const api = (window as any).api;
      if (api?.deleteTransaction) {
        await api.deleteTransaction(transaction.budgetId, transaction.id);
      } else {
        updateBrowserBudget(transaction.budgetId, (budget) => {
          budget.transactions = (budget.transactions || []).filter((item) => item.id !== transaction.id);
        });
      }
      if (current?.id === transaction.budgetId) {
        setTxs((items) => items.filter((item) => item.id !== transaction.id));
      }
      await refresh();
      showToast('Transaction deleted', 'info');
    } catch {
      showToast('Failed to delete transaction', 'error');
    }
  }

  function openEditor(tx: Transaction) {
    setEditingTx(tx);
    setEditDesc(tx.description);
    setEditAmount(tx.amount);
  }

  function editSearchedTransaction(transaction: Transaction & { budgetId: string; budgetName: string }) {
    setCurrent({ id: transaction.budgetId, name: transaction.budgetName });
    openEditor(transaction);
  }

  function closeEditor() {
    setEditingTx(null);
    setEditDesc('');
    setEditAmount('');
  }

  async function confirmEdit() {
    if (!editingTx) return;
    await updateTransaction(editingTx.id, editDesc, Number(editAmount) || 0);
    closeEditor();
  }

  function moveSelectedMonth(offset: number) {
    const [year, month] = selectedMonth.split('-').map(Number);
    setSelectedMonth(getMonthInputValue(new Date(year, month - 1 + offset, 1)));
  }

  const [selectedYear, selectedMonthNumber] = selectedMonth.split('-').map(Number);
  const selectedMonthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(selectedYear, selectedMonthNumber - 1, 1));
  const totalTransactions = budgets.reduce(
    (total, budget) => total + getTransactionsForMonth(
      budget.transactions || [],
      selectedMonth
    ).reduce((sum, transaction) => sum + (transaction.amount || 0), 0),
    0
  );
  const globalBalanceBeforeSavings = (Number(globalIncome) || 0) - totalTransactions;
  const savingsReserve = calculateSavingsReserve(globalBalanceBeforeSavings, Number(savingsPercentage) || 0);
  const remainingGlobal = globalBalanceBeforeSavings - savingsReserve;
  const spendingSummary = getSpendingSummary(budgets, selectedMonth);
  const maxMonthlySpending = Math.max(...spendingSummary.months.map(({ total }) => total), 1);
  const filteredTransactions = filterTransactions(
    budgets.flatMap((budget) => (budget.transactions || []).map((transaction) => ({
      ...transaction,
      budgetId: budget.id,
      budgetName: budget.name,
    }))),
    {
      query: transactionSearch,
      budgetId: transactionCategoryFilter,
      minAmount: transactionMinAmount === '' ? undefined : transactionMinAmount,
      maxAmount: transactionMaxAmount === '' ? undefined : transactionMaxAmount,
      fromDate: transactionFromDate,
      toDate: transactionToDate,
    }
  );

  return (
    <div className="container">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="header">
        <h1>Home Budgeting</h1>
        <nav className="page-nav" aria-label="Main navigation">
          <button
            className={page === 'home' ? 'active' : 'btn muted'}
            aria-current={page === 'home' ? 'page' : undefined}
            onClick={() => setPage('home')}
          >
            Home
          </button>
          <button
            className={page === 'transactions' ? 'active' : 'btn muted'}
            aria-current={page === 'transactions' ? 'page' : undefined}
            onClick={() => setPage('transactions')}
          >
            Transactions
          </button>
          <button
            className={page === 'savings' ? 'active' : 'btn muted'}
            aria-current={page === 'savings' ? 'page' : undefined}
            onClick={() => setPage('savings')}
          >
            Savings
          </button>
          <button
            className={page === 'settings' ? 'active' : 'btn muted'}
            aria-current={page === 'settings' ? 'page' : undefined}
            onClick={() => setPage('settings')}
          >
            Settings
          </button>
        </nav>
        <button
          className={`theme-toggle ${animating ? 'anim' : ''}`}
          aria-label={`Toggle theme, currently ${theme}`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          onClick={handleThemeToggle}
        >
          {theme === 'dark' ? (
            // Sun icon when in dark mode (clicking switches to light)
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M12 4V2M12 22v-2M4 12H2m20 0h-2M5.64 5.64L4.22 4.22M19.78 19.78l-1.42-1.42M5.64 18.36L4.22 19.78M19.78 4.22l-1.42 1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          ) : (
            // Moon icon when in light mode (clicking switches to dark)
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <span className="sr-only">{`Current theme ${theme}. Press to switch to ${theme === 'dark' ? 'light' : 'dark'} theme.`}</span>
        </button>
      </header>

      <main id="main-content">
        {page === 'home' ? (
          <>
        <section className="month-selector" aria-label="Budget month">
          <button
            className="btn muted"
            aria-label="Previous month"
            title="Previous month"
            onClick={() => moveSelectedMonth(-1)}
          >
            &lt;
          </button>
          <label htmlFor="budget-month">Budget month</label>
          <input
            id="budget-month"
            type="month"
            value={selectedMonth}
            onChange={(e) => {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setSelectedMonth(e.target.value);
            }}
          />
          <span className="muted small">{selectedMonthLabel}</span>
          <button
            className="btn muted"
            aria-label="Next month"
            title="Next month"
            onClick={() => moveSelectedMonth(1)}
          >
            &gt;
          </button>
        </section>
        <section className="global-income-summary">
          <div className="summary-row">
            <span className="muted small">Monthly Remaining Global Income</span>
            <span className={`amount ${remainingGlobal < 0 ? 'neg' : 'pos'}`}>{formatCurrency(remainingGlobal)}</span>
          </div>
          <div className="summary-row">
            <span className="muted small">Savings reserve ({Number(savingsPercentage) || 0}%)</span>
            <span className="amount">{formatCurrency(savingsReserve)}</span>
          </div>
        </section>
        <section className="spending-summary" aria-labelledby="spending-summary-heading">
          <div className="spending-summary-header">
            <div>
              <h2 id="spending-summary-heading">Spending summary</h2>
              <p className="muted small">For {selectedMonthLabel}; trend covers the selected month and previous five months.</p>
            </div>
            <div className="spending-summary-total">
              <span className="muted small">Total spent</span>
              <strong>{formatCurrency(spendingSummary.total)}</strong>
            </div>
          </div>
          <div className="spending-summary-panels">
            <div className="spending-panel">
              <h3>By category</h3>
              {spendingSummary.categories.length === 0 ? (
                <p className="muted small">No spending recorded for {selectedMonthLabel}.</p>
              ) : (
                <ul className="spending-category-list">
                  {spendingSummary.categories.map(({ name: categoryName, total }) => (
                    <li key={categoryName}>
                      <span>{categoryName}</span>
                      <strong>{formatCurrency(total)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="spending-panel">
              <h3>Monthly trend</h3>
              <ol className="spending-trend" aria-label={`Spending for the six months ending ${selectedMonthLabel}`}>
                {spendingSummary.months.map(({ month, total }) => {
                  const [trendYear, trendMonth] = month.split('-').map(Number);
                  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'short' })
                    .format(new Date(trendYear, trendMonth - 1, 1));
                  return (
                    <li key={month} aria-label={`${monthLabel} ${trendYear}: ${formatCurrency(total)}`}>
                      <strong>{formatCurrency(total)}</strong>
                      <div className="spending-trend-track" aria-hidden="true">
                        <div
                          className="spending-trend-bar"
                          style={{ height: total > 0 ? `${Math.max((total / maxMonthlySpending) * 100, 3)}%` : '0%' }}
                        />
                      </div>
                      <span className="muted small">{monthLabel}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </section>
        <section className="create">
          <div className="form-field">
            <label className="form-label" htmlFor="budget-name">Name</label>
            <input id="budget-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Budget name" />
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="budget-limit">Limit</label>
            <input id="budget-limit" value={limit as any} onChange={(e) => setLimit(e.target.value === '' ? '' : Number(e.target.value))} type="number" placeholder="Limit" />
          </div>

          <button onClick={createBudget}>Create</button>
        </section>

        <section className="cards">
          {budgets.length === 0 && <div className="empty">No budgets yet — create one.</div>}
          {budgets.map((b) => {
            const monthTransactions = getTransactionsForMonth(b.transactions || [], selectedMonth);
            const remaining = getBudgetRemaining(b.limit, monthTransactions);
            return (
              <div className="card" key={b.id}>
                <div className="card-left">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg className="icon budget-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M21 7H3v10a2 2 0 002 2h14a2 2 0 002-2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M16 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M8 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="card-title">{b.name}</div>
                  </div>
                  <div className="muted">Limit: {formatCurrency(b.limit)}</div>
                  <div className="muted small">{monthTransactions.length} transactions in {selectedMonthLabel}</div>
                  <div style={{ marginTop: 6 }}>
                    <span className={`amount ${remaining < 0 ? 'neg' : 'pos'}`}>{formatCurrency(remaining)}</span>
                    <span className="muted small" style={{ marginLeft: 8 }}>remaining</span>
                  </div>
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button title={`View ${b.name} transactions`} onClick={() => openBudget(b)} aria-label={`View ${b.name}`}>
                      View
                    </button>
                    <button title={`Edit ${b.name}`} onClick={() => { setEditingBudget({ id: b.id, name: b.name, limit: b.limit, income: b.income || 0 }); setEditBudgetName(b.name); setEditBudgetLimit(b.limit); setEditBudgetIncome(b.income || 0); }} aria-label={`Edit ${b.name}`}>
                      Edit
                    </button>
                    <button
                      title={`Delete ${b.name}`}
                      className="btn danger"
                      onClick={() => setDeleting({ id: b.id, name: b.name })}
                      aria-label={`Delete ${b.name}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        {current && (
          <section className="transactions">
            <h2>Transactions — {current.name}</h2>
            <div className="tx-panel">
              <TxForm
                key={selectedMonth}
                categoryName={current.name}
                month={selectedMonth}
                onAdd={addTransaction}
              />
              <ul>
                {getTransactionsForMonth(txs, selectedMonth).map((t) => (
                  <li key={t.id} className="tx">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg className="icon tx-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M21 10H3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M21 6H3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M7 14h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M7 18h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div>
                        {t.description}
                        <div className="muted small">{new Date(t.date).toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="tx-actions">
                      <div className={`amount ${t.amount < 0 ? 'neg' : 'pos'}`}>{formatCurrency(t.amount)}</div>
                      <div className="actions">
                        <button title="Edit transaction" onClick={() => openEditor(t)}>Edit</button>
                        <button title="Delete transaction" onClick={() => deleteTransaction(t.id)} className="btn muted">Delete</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
          </>
        ) : page === 'transactions' ? (
          <section className="transaction-search-page" aria-labelledby="transaction-search-heading">
            <h2 id="transaction-search-heading">Transactions</h2>
            <p className="muted">Search and filter transactions across all categories and months.</p>
            <div className="transaction-filters">
              <div className="form-field">
                <label className="form-label" htmlFor="transaction-search">Description</label>
                <input
                  id="transaction-search"
                  type="search"
                  value={transactionSearch}
                  onChange={(e) => setTransactionSearch(e.target.value)}
                  placeholder="Search descriptions"
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="transaction-category">Category</label>
                <select
                  id="transaction-category"
                  value={transactionCategoryFilter}
                  onChange={(e) => setTransactionCategoryFilter(e.target.value)}
                >
                  <option value="">All categories</option>
                  {budgets.map((budget) => (
                    <option key={budget.id} value={budget.id}>{budget.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="transaction-min-amount">Minimum amount</label>
                <input
                  id="transaction-min-amount"
                  type="number"
                  step="0.01"
                  value={transactionMinAmount}
                  onChange={(e) => setTransactionMinAmount(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="transaction-max-amount">Maximum amount</label>
                <input
                  id="transaction-max-amount"
                  type="number"
                  step="0.01"
                  value={transactionMaxAmount}
                  onChange={(e) => setTransactionMaxAmount(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="transaction-from-date">From date</label>
                <input
                  id="transaction-from-date"
                  type="date"
                  value={transactionFromDate}
                  onChange={(e) => setTransactionFromDate(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="transaction-to-date">To date</label>
                <input
                  id="transaction-to-date"
                  type="date"
                  value={transactionToDate}
                  onChange={(e) => setTransactionToDate(e.target.value)}
                />
              </div>
              <button
                className="btn muted clear-filters"
                onClick={() => {
                  setTransactionSearch('');
                  setTransactionCategoryFilter('');
                  setTransactionMinAmount('');
                  setTransactionMaxAmount('');
                  setTransactionFromDate('');
                  setTransactionToDate('');
                }}
              >
                Clear filters
              </button>
            </div>
            <p className="muted small" aria-live="polite">
              {filteredTransactions.length} matching {filteredTransactions.length === 1 ? 'transaction' : 'transactions'}
            </p>
            <ul className="transaction-search-results">
              {filteredTransactions.length === 0 && (
                <li className="empty">No transactions match these filters.</li>
              )}
              {filteredTransactions.map((transaction) => (
                <li className="tx transaction-result" key={`${transaction.budgetId}-${transaction.id}`}>
                  <div className="transaction-result-description">
                    <strong>{transaction.description}</strong>
                    <span className="muted small">{transaction.budgetName}</span>
                    <span className="muted small">{new Date(transaction.date).toLocaleString()}</span>
                  </div>
                  <div className="tx-actions">
                    <div className={`amount ${transaction.amount < 0 ? 'neg' : 'pos'}`}>
                      {formatCurrency(transaction.amount)}
                    </div>
                    <div className="actions">
                      <button
                        aria-label={`Edit ${transaction.description}`}
                        onClick={() => editSearchedTransaction(transaction)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn muted"
                        aria-label={`Delete ${transaction.description}`}
                        onClick={() => deleteSearchedTransaction(transaction)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : page === 'savings' ? (
          <section className="savings-page" aria-labelledby="savings-heading">
            <h2 id="savings-heading">Savings Goals</h2>
            <p className="muted">Track progress toward savings targets. Contributions are managed separately from category spending.</p>
            <section className="global-income-summary">
              <div className="summary-row">
                <span className="muted small">Reserved from remaining global</span>
                <span className="amount">{formatCurrency(savingsReserve)}</span>
              </div>
              <p className="muted small">This is a planned savings amount, not an automatic contribution to a goal.</p>
            </section>
            <section className="create">
              <div className="form-field">
                <label className="form-label" htmlFor="savings-goal-name">Goal name</label>
                <input
                  id="savings-goal-name"
                  value={savingsGoalName}
                  onChange={(e) => setSavingsGoalName(e.target.value)}
                  placeholder="Emergency fund"
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="savings-goal-target">Target</label>
                <input
                  id="savings-goal-target"
                  value={savingsGoalTarget}
                  onChange={(e) => setSavingsGoalTarget(e.target.value === '' ? '' : Number(e.target.value))}
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Target amount"
                />
              </div>
              <button onClick={createSavingsGoal}>Create goal</button>
            </section>
            <section className="cards">
              {savingsGoals.length === 0 && <div className="empty">No savings goals yet — create one.</div>}
              {savingsGoals.map((goal) => {
                const progress = Math.min(100, (goal.saved / goal.target) * 100);
                return (
                  <div className="card savings-goal" key={goal.id}>
                    <div className="card-left">
                      <div className="card-title">{goal.name}</div>
                      <div className="muted">Saved: {formatCurrency(goal.saved)}</div>
                      <div className="muted">Target: {formatCurrency(goal.target)}</div>
                      <progress
                        className="goal-progress"
                        value={Math.min(goal.saved, goal.target)}
                        max={goal.target}
                        aria-label={`${goal.name} progress`}
                      />
                      <div className="muted small">{progress.toFixed(0)}% complete</div>
                      <div className="actions goal-actions">
                        <button onClick={() => { setAdjustingSavingsGoal({ goal, direction: 'add' }); setSavingsAdjustment(''); }}>
                          Add funds
                        </button>
                        <button
                          className="btn muted"
                          onClick={() => { setAdjustingSavingsGoal({ goal, direction: 'withdraw' }); setSavingsAdjustment(''); }}
                          disabled={goal.saved <= 0}
                        >
                          Withdraw
                        </button>
                        <button
                          className="btn muted"
                          onClick={() => {
                            setEditingSavingsGoal(goal);
                            setEditSavingsGoalName(goal.name);
                            setEditSavingsGoalTarget(goal.target);
                            setEditSavingsGoalSaved(goal.saved);
                          }}
                        >
                          Edit
                        </button>
                        <button className="btn danger" onClick={() => setDeletingSavingsGoal(goal)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          </section>
        ) : (
          <section className="settings-page" aria-labelledby="settings-heading">
            <h2 id="settings-heading">Settings</h2>
            <p className="muted">Manage your household-wide income used to calculate your remaining global balance.</p>
            <div className="settings-card">
              <div className="form-field">
                <label className="form-label" htmlFor="global-income">Monthly Global Income</label>
                <input
                  id="global-income"
                  value={globalIncome}
                  onChange={(e) => setGlobalIncome(e.target.value === '' ? '' : Number(e.target.value))}
                  type="number"
                  min="0"
                  step="0.01"
                />
              </div>
              <button onClick={saveGlobalIncome}>Save Changes</button>
            </div>
            <div className="settings-card">
              <div className="form-field">
                <label className="form-label" htmlFor="savings-percentage">Savings reserve percentage</label>
                <input
                  id="savings-percentage"
                  value={savingsPercentage}
                  onChange={(e) => setSavingsPercentage(e.target.value === '' ? '' : Number(e.target.value))}
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                />
              </div>
              <button onClick={saveSavingsPercentage}>Save Percentage</button>
            </div>
            <p className="muted small">
              This percentage is calculated from your positive remaining global balance after category transactions.
              It is reserved from the available balance but is not automatically added to a savings goal.
            </p>
          </section>
        )}
        {deleting && (
          <Modal
            title={`Delete ${deleting.name}?`}
            onClose={() => setDeleting(null)}
            onConfirm={async () => {
              try {
                const api = (window as any).api;
                if (api?.deleteBudget) {
                  await api.deleteBudget(deleting.id);
                } else {
                  writeBrowserBudgets(readBrowserBudgets().filter((budget) => budget.id !== deleting.id));
                }
                setDeleting(null);
                await refresh();
                showToast('Budget deleted', 'info');
              } catch {
                showToast('Failed to delete budget', 'error');
              }
            }}
            confirmLabel="Delete"
          >
            <p>Deleting a budget will remove its transactions. This cannot be undone.</p>
          </Modal>
        )}
        {editingTx && (
          <Modal title={`Edit Transaction`} onClose={closeEditor} onConfirm={confirmEdit} confirmLabel="Save">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
              <input value={editAmount as any} onChange={(e) => setEditAmount(e.target.value === '' ? '' : Number(e.target.value))} type="number" />
            </div>
          </Modal>
        )}
        {editingBudget && (
          <Modal
            title={`Edit Budget`}
            onClose={() => setEditingBudget(null)}
            onConfirm={async () => {
              const budgetName = editBudgetName.trim();
              if (!budgetName) {
                showToast('Enter a budget name', 'error');
                return;
              }
              try {
                const api = (window as any).api;
                const updatedLimit = Number(editBudgetLimit) || 0;
                const updatedIncome = Number(editBudgetIncome) || 0;
                if (api?.updateBudget) {
                  await api.updateBudget(editingBudget.id, budgetName, updatedLimit, updatedIncome);
                } else {
                  updateBrowserBudget(editingBudget.id, (budget) => {
                    budget.name = budgetName;
                    budget.limit = updatedLimit;
                    budget.income = updatedIncome;
                  });
                }
                setEditingBudget(null);
                await refresh();
                showToast('Budget updated', 'success');
              } catch {
                showToast('Failed to update budget', 'error');
              }
            }}
            confirmLabel="Save"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="form-field">
                <label className="form-label" htmlFor="edit-budget-name">Name</label>
                <input id="edit-budget-name" value={editBudgetName} onChange={(e) => setEditBudgetName(e.target.value)} />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="edit-budget-limit">Limit</label>
                <input id="edit-budget-limit" value={editBudgetLimit as any} onChange={(e) => setEditBudgetLimit(e.target.value === '' ? '' : Number(e.target.value))} type="number" />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="edit-budget-income">Income</label>
                <input id="edit-budget-income" value={editBudgetIncome as any} onChange={(e) => setEditBudgetIncome(e.target.value === '' ? '' : Number(e.target.value))} type="number" placeholder="Income" />
              </div>
            </div>
          </Modal>
        )}
        {deletingSavingsGoal && (
          <Modal
            title={`Delete ${deletingSavingsGoal.name}?`}
            onClose={() => setDeletingSavingsGoal(null)}
            onConfirm={async () => {
              try {
                const api = (window as any).api;
                if (api?.deleteSavingsGoal) {
                  await api.deleteSavingsGoal(deletingSavingsGoal.id);
                } else {
                  writeBrowserSavingsGoals(
                    readBrowserSavingsGoals().filter((goal) => goal.id !== deletingSavingsGoal.id)
                  );
                }
                setDeletingSavingsGoal(null);
                await refresh();
                showToast('Savings goal deleted', 'info');
              } catch {
                showToast('Failed to delete savings goal', 'error');
              }
            }}
            confirmLabel="Delete"
          >
            <p>Deleting this goal will remove its saved balance. This cannot be undone.</p>
          </Modal>
        )}
        {editingSavingsGoal && (
          <Modal
            title={`Edit ${editingSavingsGoal.name}`}
            onClose={() => setEditingSavingsGoal(null)}
            onConfirm={confirmSavingsGoalEdit}
            confirmLabel="Save"
          >
            <div className="goal-modal-fields">
              <div className="form-field">
                <label className="form-label" htmlFor="edit-savings-goal-name">Goal name</label>
                <input
                  id="edit-savings-goal-name"
                  value={editSavingsGoalName}
                  onChange={(e) => setEditSavingsGoalName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="edit-savings-goal-target">Target</label>
                <input
                  id="edit-savings-goal-target"
                  value={editSavingsGoalTarget}
                  onChange={(e) => setEditSavingsGoalTarget(e.target.value === '' ? '' : Number(e.target.value))}
                  type="number"
                  min="0.01"
                  step="0.01"
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="edit-savings-goal-saved">Saved</label>
                <input
                  id="edit-savings-goal-saved"
                  value={editSavingsGoalSaved}
                  onChange={(e) => setEditSavingsGoalSaved(e.target.value === '' ? '' : Number(e.target.value))}
                  type="number"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
          </Modal>
        )}
        {adjustingSavingsGoal && (
          <Modal
            title={`${adjustingSavingsGoal.direction === 'add' ? 'Add funds to' : 'Withdraw from'} ${adjustingSavingsGoal.goal.name}`}
            onClose={() => setAdjustingSavingsGoal(null)}
            onConfirm={confirmSavingsAdjustment}
            confirmLabel={adjustingSavingsGoal.direction === 'add' ? 'Add funds' : 'Withdraw'}
          >
            <div className="form-field">
              <label className="form-label" htmlFor="savings-adjustment-amount">Amount</label>
              <input
                id="savings-adjustment-amount"
                value={savingsAdjustment}
                onChange={(e) => setSavingsAdjustment(e.target.value === '' ? '' : Number(e.target.value))}
                type="number"
                min="0.01"
                step="0.01"
                autoFocus
              />
            </div>
          </Modal>
        )}
      </main>
      <Toasts toasts={toasts} remove={removeToast} />
    </div>
  );
}

function TxForm({
  categoryName,
  month,
  onAdd,
}: {
  categoryName: string;
  month: string;
  onAdd: (desc: string, amount: number, date: string) => Promise<boolean>;
}) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [transactionDate, setTransactionDate] = useState(() => getDefaultTransactionDate(month));
  const [dateError, setDateError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function confirmAdd() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const date = new Date(`${transactionDate}T12:00:00`).toISOString();
      if (await onAdd(desc, Number(amount) || 0, date)) {
        setConfirming(false);
        setDesc('');
        setAmount('');
        setTransactionDate(getDefaultTransactionDate(month));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="tx-form">
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" />
        <input value={amount as any} onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))} type="number" placeholder="Amount" />
        <input
          aria-label="Transaction date"
          aria-invalid={Boolean(dateError)}
          value={transactionDate}
          onChange={(e) => {
            setTransactionDate(e.target.value);
            setDateError('');
          }}
          type="date"
          min={`${month}-01`}
          max={getLastDateOfMonth(month)}
        />
        {dateError && <span className="form-error" role="alert">{dateError}</span>}
        <button
          onClick={() => {
            if (!desc.trim()) return;
            const parsedDate = new Date(`${transactionDate}T12:00:00`);
            if (!transactionDate || !Number.isFinite(parsedDate.getTime()) ||
              getMonthInputValue(parsedDate) !== month) {
              setDateError('Choose a valid date within the selected month');
              return;
            }
            setConfirming(true);
          }}
        >
          Add
        </button>
      </div>
      {confirming && (
        <Modal
          title="Confirm transaction"
          onClose={() => setConfirming(false)}
          onConfirm={confirmAdd}
          confirmLabel="Add transaction"
        >
          <p>Add this transaction to {categoryName}?</p>
          <p><strong>{desc}</strong>: {formatCurrency(Number(amount) || 0)}</p>
          <p>Date: {new Date(`${transactionDate}T12:00:00`).toLocaleDateString()}</p>
        </Modal>
      )}
    </>
  );
}
