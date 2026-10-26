import React, { useEffect, useRef, useState } from 'react';
import Modal from './components/Modal';
import Toasts, { ToastItem } from './components/Toast';
import { formatCurrency } from './utils';
import { BudgetAlertStatus, getBudgetAlertStatus, getBudgetRemaining, getMonthInputValue, getTransactionsForMonth } from '../budget';
import { calculateSavingsReserve } from '../savings';
import { getSpendingSummary } from '../spending';
import { filterTransactions } from '../transactions';
import {
  getZonedDateKey,
  getZonedDateTimeInputValue,
  getZonedMonthKey,
  zonedDateTimeToIso,
  zonedNoonToIso,
} from '../timezone';
import { getDaysUntilDate, getNextOccurrenceDate, isValidDateKey, RecurrenceFrequency, RecurringTransactionSchedule } from '../recurring';
import {
  appendCsvTransactions,
  createAppDataBackup,
  exportTransactionsCsv,
  parseAppDataBackup,
  parseTransactionsCsv,
} from '../dataTransfer';
import type { AppData } from '../types';

type Budget = { id: string; name: string; limit: number; income?: number; transactions?: Transaction[] };
type Transaction = { id: string; description: string; amount: number; date: string };
type SavingsGoal = { id: string; name: string; target: number; saved: number };
type RecurringSchedule = RecurringTransactionSchedule;

const THEME_KEY = 'theme-preference';
const GLOBAL_INCOME_KEY = 'home-budgeting-global-income';
const BUDGETS_KEY = 'home-budgeting-budgets';
const SAVINGS_PERCENTAGE_KEY = 'home-budgeting-savings-percentage';
const SAVINGS_GOALS_KEY = 'home-budgeting-savings-goals';
const TIME_ZONE_KEY = 'home-budgeting-time-zone';
const BUDGET_ALERT_THRESHOLD_KEY = 'home-budgeting-alert-threshold';
const RECURRING_SCHEDULES_KEY = 'home-budgeting-recurring-schedules';
const BROWSER_APP_DATA_KEYS = [
  BUDGETS_KEY,
  GLOBAL_INCOME_KEY,
  SAVINGS_PERCENTAGE_KEY,
  SAVINGS_GOALS_KEY,
  TIME_ZONE_KEY,
  BUDGET_ALERT_THRESHOLD_KEY,
  RECURRING_SCHEDULES_KEY,
];

function getTimeZoneOptions(): string[] {
  const supported = (Intl as any).supportedValuesOf;
  return typeof supported === 'function' ? supported.call(Intl, 'timeZone') : ['UTC'];
}

function getSystemTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatDateTime(value: string, timeZone: string) {
  return new Date(value).toLocaleString(undefined, { timeZone: timeZone || undefined });
}

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

function readBrowserRecurringSchedules(): RecurringSchedule[] {
  const stored = localStorage.getItem(RECURRING_SCHEDULES_KEY);
  if (!stored) return [];
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed)) throw new Error('Saved recurring schedules are invalid');
  return parsed as RecurringSchedule[];
}

function writeBrowserRecurringSchedules(schedules: RecurringSchedule[]) {
  localStorage.setItem(RECURRING_SCHEDULES_KEY, JSON.stringify(schedules));
}

function readBrowserAppData(): AppData {
  return {
    budgets: readBrowserBudgets().map((budget) => ({
      ...budget,
      transactions: budget.transactions || [],
    })),
    globalIncome: Number(localStorage.getItem(GLOBAL_INCOME_KEY)) || 0,
    savingsPercentage: Number(localStorage.getItem(SAVINGS_PERCENTAGE_KEY)) || 0,
    savingsGoals: readBrowserSavingsGoals(),
    timeZone: localStorage.getItem(TIME_ZONE_KEY) || '',
    budgetAlertThreshold: Number(localStorage.getItem(BUDGET_ALERT_THRESHOLD_KEY) ?? '80'),
    recurringTransactions: readBrowserRecurringSchedules(),
  };
}

function writeBrowserAppData(data: AppData) {
  const values = [
    JSON.stringify(data.budgets),
    String(data.globalIncome ?? 0),
    String(data.savingsPercentage ?? 0),
    JSON.stringify(data.savingsGoals || []),
    data.timeZone || '',
    String(data.budgetAlertThreshold ?? 80),
    JSON.stringify(data.recurringTransactions || []),
  ];
  const previousValues = BROWSER_APP_DATA_KEYS.map((key) => localStorage.getItem(key));
  try {
    BROWSER_APP_DATA_KEYS.forEach((key, index) => localStorage.setItem(key, values[index]));
  } catch (error) {
    let rollbackFailed = false;
    BROWSER_APP_DATA_KEYS.forEach((key, index) => {
      try {
        const previousValue = previousValues[index];
        if (previousValue === null) localStorage.removeItem(key);
        else localStorage.setItem(key, previousValue);
      } catch {
        rollbackFailed = true;
      }
    });
    if (rollbackFailed) throw new Error('Restore failed and browser data rollback could not complete');
    throw error;
  }
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getDefaultTransactionDate(month: string, timeZone: string) {
  const today = getZonedDateKey(new Date(), timeZone) || '';
  return today.startsWith(`${month}-`) ? today : `${month}-01`;
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
  const [recurringSchedules, setRecurringSchedules] = useState<RecurringSchedule[]>([]);
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
  const [editDateTime, setEditDateTime] = useState('');
  const [editingBudget, setEditingBudget] = useState<null | { id: string; name: string; limit: number; income?: number }>(null);
  const [editBudgetName, setEditBudgetName] = useState('');
  const [editBudgetLimit, setEditBudgetLimit] = useState<number | ''>('');
  const [editBudgetIncome, setEditBudgetIncome] = useState<number | ''>('');
  const [globalIncome, setGlobalIncome] = useState<number | ''>(0);
  const [savingsPercentage, setSavingsPercentage] = useState<number | ''>(0);
  const [budgetAlertThreshold, setBudgetAlertThreshold] = useState(80);
  const [budgetAlertThresholdDraft, setBudgetAlertThresholdDraft] = useState<number | ''>(80);
  const [savedDataLoaded, setSavedDataLoaded] = useState(false);
  const alertStatusesRef = useRef<Map<string, BudgetAlertStatus> | null>(null);
  const alertContextRef = useRef<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => getMonthInputValue());
  const [timeZone, setTimeZone] = useState('');
  const [timeZoneDraft, setTimeZoneDraft] = useState('');
  const [savingsGoalName, setSavingsGoalName] = useState('');
  const [savingsGoalTarget, setSavingsGoalTarget] = useState<number | ''>('');
  const [editingSavingsGoal, setEditingSavingsGoal] = useState<SavingsGoal | null>(null);
  const [editSavingsGoalName, setEditSavingsGoalName] = useState('');
  const [editSavingsGoalTarget, setEditSavingsGoalTarget] = useState<number | ''>('');
  const [editSavingsGoalSaved, setEditSavingsGoalSaved] = useState<number | ''>('');
  const [adjustingSavingsGoal, setAdjustingSavingsGoal] = useState<null | { goal: SavingsGoal; direction: 'add' | 'withdraw' }>(null);
  const [savingsAdjustment, setSavingsAdjustment] = useState<number | ''>('');
  const [deletingSavingsGoal, setDeletingSavingsGoal] = useState<SavingsGoal | null>(null);
  const [page, setPage] = useState<'home' | 'transactions' | 'recurring' | 'savings' | 'settings'>('home');
  const [pendingBackup, setPendingBackup] = useState<AppData | null>(null);
  const [pendingBackupFilename, setPendingBackupFilename] = useState('');
  const csvImportInputRef = useRef<HTMLInputElement | null>(null);
  const backupImportInputRef = useRef<HTMLInputElement | null>(null);
  const [recurringBudgetId, setRecurringBudgetId] = useState('');
  const [recurringDescription, setRecurringDescription] = useState('');
  const [recurringAmount, setRecurringAmount] = useState<number | ''>('');
  const [recurringFrequency, setRecurringFrequency] = useState<RecurrenceFrequency>('monthly');
  const [recurringDueDate, setRecurringDueDate] = useState('');
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null);
  const [recordingSchedule, setRecordingSchedule] = useState<RecurringSchedule | null>(null);
  const [recordingAmount, setRecordingAmount] = useState<number | ''>('');
  const [recordingDate, setRecordingDate] = useState('');
  const [deletingRecurring, setDeletingRecurring] = useState<RecurringSchedule | null>(null);
  const recurringReminderKeysRef = useRef<Set<string>>(new Set());

  function showToast(message: string, type: ToastItem['type'] = 'info') {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((s) => [...s, { id, message, type }]);
  }

  function removeToast(id: string) {
    setToasts((s) => s.filter((t) => t.id !== id));
  }

  useEffect(() => {
    if (!savedDataLoaded) return;

    const context = `${selectedMonth}|${timeZone}|${budgetAlertThreshold}`;
    const statuses = new Map<string, { status: BudgetAlertStatus; name: string }>();
    for (const budget of budgets) {
      const transactions = getTransactionsForMonth(budget.transactions || [], selectedMonth, timeZone);
      const status = getBudgetAlertStatus(budget.limit, transactions, budgetAlertThreshold);
      if (status) {
        statuses.set(budget.id, {
          status,
          name: budget.name,
        });
      }
    }

    if (alertContextRef.current === context && alertStatusesRef.current) {
      for (const [id, current] of statuses) {
        const previous = alertStatusesRef.current.get(id)?.status;
        if (previous === current.status || previous === 'over') continue;
        showToast(
          current.status === 'over'
            ? `${current.name} is over its budget for ${selectedMonthLabel}`
            : `${current.name} is nearing its budget limit for ${selectedMonthLabel}`,
          current.status === 'over' ? 'error' : 'info'
        );
      }
    }

    alertStatusesRef.current = new Map(
      [...statuses].map(([id, { status }]) => [id, status])
    );
    alertContextRef.current = context;
  }, [savedDataLoaded, budgets, selectedMonth, timeZone, budgetAlertThreshold]);

  useEffect(() => {
    if (!savedDataLoaded) return;
    const today = getZonedDateKey(new Date(), timeZone);
    if (!today) return;
    for (const schedule of recurringSchedules) {
      const key = `${schedule.id}:${schedule.nextDueDate}`;
      if (recurringReminderKeysRef.current.has(key)) continue;
      const daysUntil = getDaysUntilDate(schedule.nextDueDate, today);
      if (daysUntil > 5) continue;
      recurringReminderKeysRef.current.add(key);
      showToast(
        daysUntil < 0
          ? `Reminder: ${schedule.description} is overdue`
          : daysUntil === 0
            ? `Reminder: ${schedule.description} is due today`
            : `Reminder: ${schedule.description} is due in ${daysUntil} days`,
        daysUntil < 0 ? 'error' : 'info'
      );
    }
  }, [savedDataLoaded, recurringSchedules, timeZone]);

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
      setRecurringSchedules(api?.getRecurringTransactions
        ? await api.getRecurringTransactions()
        : readBrowserRecurringSchedules());
      const storedAlertThreshold: number = api?.getBudgetAlertThreshold
        ? await api.getBudgetAlertThreshold()
        : Number(localStorage.getItem(BUDGET_ALERT_THRESHOLD_KEY) ?? '80');
      if (!Number.isFinite(storedAlertThreshold) || storedAlertThreshold < 1 || storedAlertThreshold > 100) {
        throw new Error('Saved budget alert threshold must be between 1 and 100');
      }
      setBudgetAlertThreshold(storedAlertThreshold);
      setBudgetAlertThresholdDraft(storedAlertThreshold);
      const storedTimeZone: string = api?.getTimeZone
        ? await api.getTimeZone()
        : localStorage.getItem(TIME_ZONE_KEY) || '';
      setTimeZone(storedTimeZone);
      setTimeZoneDraft(storedTimeZone);
      setSelectedMonth(getZonedMonthKey(new Date(), storedTimeZone) || getMonthInputValue());
      setSavedDataLoaded(true);
      return true;
    } catch {
      showToast('Failed to load saved data', 'error');
      return false;
    }
  }

  async function exportCsv() {
    try {
      const api = (window as any).api;
      const data: AppData = api?.getAppData ? await api.getAppData() : readBrowserAppData();
      const date = new Date().toISOString().slice(0, 10);
      downloadTextFile(`home-budgeting-transactions-${date}.csv`, exportTransactionsCsv(data.budgets), 'text/csv;charset=utf-8');
      showToast('Transactions exported as CSV', 'success');
    } catch (error) {
      showToast(getErrorMessage(error, 'Failed to export transactions'), 'error');
    }
  }

  async function exportBackup() {
    try {
      const api = (window as any).api;
      const data: AppData = api?.getAppData ? await api.getAppData() : readBrowserAppData();
      const date = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        `home-budgeting-backup-${date}.json`,
        createAppDataBackup(data),
        'application/json;charset=utf-8'
      );
      showToast('Backup created', 'success');
    } catch (error) {
      showToast(getErrorMessage(error, 'Failed to create backup'), 'error');
    }
  }

  async function importCsvFile(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const rows = parseTransactionsCsv(await file.text(), timeZone);
      const api = (window as any).api;
      if (api?.importTransactions) {
        await api.importTransactions(rows);
      } else {
        const importedData = appendCsvTransactions(readBrowserAppData(), rows, makeBrowserId);
        writeBrowserAppData(importedData);
      }
      const refreshed = await refresh();
      if (refreshed) {
        showToast(`${rows.length} transaction${rows.length === 1 ? '' : 's'} imported`, 'success');
      }
    } catch (error) {
      showToast(getErrorMessage(error, 'Failed to import CSV file'), 'error');
    } finally {
      input.value = '';
    }
  }

  async function selectBackupFile(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      setPendingBackup(parseAppDataBackup(await file.text()));
      setPendingBackupFilename(file.name);
    } catch (error) {
      showToast(getErrorMessage(error, 'Backup file is invalid'), 'error');
    } finally {
      input.value = '';
    }
  }

  async function restoreBackup() {
    if (!pendingBackup) return;
    try {
      const api = (window as any).api;
      if (api?.replaceAppData) await api.replaceAppData(pendingBackup);
      else writeBrowserAppData(pendingBackup);
      alertStatusesRef.current = null;
      alertContextRef.current = null;
      recurringReminderKeysRef.current.clear();
      setPendingBackup(null);
      setPendingBackupFilename('');
      if (await refresh()) showToast('Backup restored', 'success');
    } catch (error) {
      showToast(getErrorMessage(error, 'Failed to restore backup'), 'error');
    }
  }

  async function saveTimeZone() {
    try {
      const api = (window as any).api;
      const savedTimeZone: string = api?.setTimeZone
        ? await api.setTimeZone(timeZoneDraft)
        : (localStorage.setItem(TIME_ZONE_KEY, timeZoneDraft), timeZoneDraft);
      setTimeZone(savedTimeZone);
      setTimeZoneDraft(savedTimeZone);
      setSelectedMonth(getZonedMonthKey(new Date(), savedTimeZone) || getMonthInputValue());
      showToast('Time zone saved', 'success');
    } catch {
      showToast('Failed to save time zone', 'error');
    }
  }

  async function saveBudgetAlertThreshold() {
    const threshold = Number(budgetAlertThresholdDraft);
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) {
      showToast('Budget alert threshold must be between 1 and 100', 'error');
      return;
    }
    try {
      const api = (window as any).api;
      const savedThreshold = api?.setBudgetAlertThreshold
        ? await api.setBudgetAlertThreshold(threshold)
        : (localStorage.setItem(BUDGET_ALERT_THRESHOLD_KEY, String(threshold)), threshold);
      setBudgetAlertThreshold(savedThreshold);
      setBudgetAlertThresholdDraft(savedThreshold);
      showToast('Budget alert threshold saved', 'success');
    } catch {
      showToast('Failed to save budget alert threshold', 'error');
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

  function resetRecurringForm() {
    setEditingRecurringId(null);
    setRecurringBudgetId('');
    setRecurringDescription('');
    setRecurringAmount('');
    setRecurringFrequency('monthly');
    setRecurringDueDate('');
  }

  function editRecurringSchedule(schedule: RecurringSchedule) {
    setEditingRecurringId(schedule.id);
    setRecurringBudgetId(schedule.budgetId);
    setRecurringDescription(schedule.description);
    setRecurringAmount(schedule.amount);
    setRecurringFrequency(schedule.frequency);
    setRecurringDueDate(schedule.nextDueDate);
  }

  async function saveRecurringSchedule() {
    const amount = Number(recurringAmount);
    if (!recurringBudgetId || !recurringDescription.trim() || recurringAmount === '' || !Number.isFinite(amount) || amount === 0 || !isValidDateKey(recurringDueDate)) {
      showToast('Choose a category, description, non-zero amount, and valid due date', 'error');
      return;
    }

    try {
      const api = (window as any).api;
      if (editingRecurringId) {
        if (api?.updateRecurringTransaction) {
          await api.updateRecurringTransaction(editingRecurringId, recurringBudgetId, recurringDescription.trim(), amount, recurringDueDate, recurringFrequency);
        } else {
          const schedules = readBrowserRecurringSchedules();
          const index = schedules.findIndex((schedule) => schedule.id === editingRecurringId);
          if (index < 0) throw new Error('Recurring transaction not found');
          schedules[index] = {
            ...schedules[index],
            budgetId: recurringBudgetId,
            description: recurringDescription.trim(),
            amount,
            frequency: recurringFrequency,
            nextDueDate: recurringDueDate,
            ...(recurringFrequency === 'monthly' ? { dayOfMonth: Number(recurringDueDate.slice(-2)) } : { dayOfMonth: undefined }),
          };
          writeBrowserRecurringSchedules(schedules);
        }
      } else if (api?.createRecurringTransaction) {
        await api.createRecurringTransaction(recurringBudgetId, recurringDescription.trim(), amount, recurringDueDate, recurringFrequency);
      } else {
        writeBrowserRecurringSchedules([
          ...readBrowserRecurringSchedules(),
          {
            id: makeBrowserId(),
            budgetId: recurringBudgetId,
            description: recurringDescription.trim(),
            amount,
            frequency: recurringFrequency,
            nextDueDate: recurringDueDate,
            ...(recurringFrequency === 'monthly' ? { dayOfMonth: Number(recurringDueDate.slice(-2)) } : {}),
          },
        ]);
      }
      resetRecurringForm();
      await refresh();
      showToast(editingRecurringId ? 'Recurring schedule updated' : 'Recurring schedule created', 'success');
    } catch {
      showToast('Failed to save recurring schedule', 'error');
    }
  }

  function beginRecordingOccurrence(schedule: RecurringSchedule) {
    setRecordingSchedule(schedule);
    setRecordingAmount(schedule.amount);
    setRecordingDate(schedule.nextDueDate);
  }

  async function recordRecurringOccurrence() {
    if (!recordingSchedule || recordingAmount === '' || !Number.isFinite(Number(recordingAmount))) {
      showToast('Enter a valid transaction amount', 'error');
      return;
    }
    const date = zonedNoonToIso(recordingDate, timeZone);
    if (!date) {
      showToast('Choose a valid transaction date', 'error');
      return;
    }

    try {
      const amount = Number(recordingAmount);
      const api = (window as any).api;
      if (api?.completeRecurringTransaction) {
        await api.completeRecurringTransaction(recordingSchedule.id, amount, date);
        if (current?.id === recordingSchedule.budgetId && api?.getTransactions) {
          setTxs(await api.getTransactions(current.id));
        }
      } else {
        const schedules = readBrowserRecurringSchedules();
        const schedule = schedules.find((item) => item.id === recordingSchedule.id);
        if (!schedule) throw new Error('Recurring transaction not found');
        const budgets = readBrowserBudgets();
        const budget = budgets.find((item) => item.id === schedule.budgetId);
        if (!budget) throw new Error('Budget not found');
        const transaction: Transaction = {
          id: makeBrowserId(),
          description: schedule.description,
          amount,
          date,
        };
        budget.transactions = [...(budget.transactions || []), transaction];
        schedule.nextDueDate = getNextOccurrenceDate(schedule.nextDueDate, schedule.frequency, schedule.dayOfMonth);
        writeBrowserBudgets(budgets);
        writeBrowserRecurringSchedules(schedules);
        if (current?.id === budget.id) setTxs((items) => [...items, transaction]);
      }
      setRecordingSchedule(null);
      await refresh();
      showToast('Recurring transaction recorded; next due date advanced', 'success');
    } catch {
      showToast('Failed to record recurring transaction', 'error');
    }
  }

  async function skipRecurringOccurrence(schedule: RecurringSchedule) {
    try {
      const api = (window as any).api;
      if (api?.skipRecurringOccurrence) {
        await api.skipRecurringOccurrence(schedule.id);
      } else {
        const schedules = readBrowserRecurringSchedules();
        const storedSchedule = schedules.find((item) => item.id === schedule.id);
        if (!storedSchedule) throw new Error('Recurring transaction not found');
        storedSchedule.nextDueDate = getNextOccurrenceDate(storedSchedule.nextDueDate, storedSchedule.frequency, storedSchedule.dayOfMonth);
        writeBrowserRecurringSchedules(schedules);
      }
      await refresh();
      showToast('Recurring occurrence skipped', 'info');
    } catch {
      showToast('Failed to skip recurring occurrence', 'error');
    }
  }

  async function deleteRecurringSchedule(schedule: RecurringSchedule) {
    try {
      const api = (window as any).api;
      if (api?.deleteRecurringTransaction) {
        await api.deleteRecurringTransaction(schedule.id);
      } else {
        writeBrowserRecurringSchedules(readBrowserRecurringSchedules().filter((item) => item.id !== schedule.id));
      }
      if (editingRecurringId === schedule.id) resetRecurringForm();
      setDeletingRecurring(null);
      await refresh();
      showToast('Recurring schedule deleted', 'info');
    } catch {
      showToast('Failed to delete recurring schedule', 'error');
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

  async function updateTransaction(transactionId: string, description: string, amount: number, date: string) {
    if (!current) return showToast('No budget selected', 'error');
    try {
      const api = (window as any).api;
      if (api?.updateTransaction) {
        await api.updateTransaction(current.id, transactionId, description, amount, date);
        setTxs(await api.getTransactions(current.id));
      } else {
        updateBrowserBudget(current.id, (budget) => {
          const transaction = budget.transactions?.find((item) => item.id === transactionId);
          if (!transaction) throw new Error('Transaction not found');
          transaction.description = description;
          transaction.amount = amount;
          transaction.date = date;
        });
        setTxs((transactions) => transactions.map((transaction) => (
          transaction.id === transactionId
            ? { ...transaction, description, amount, date }
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
    setEditDateTime(getZonedDateTimeInputValue(tx.date, timeZone));
  }

  function editSearchedTransaction(transaction: Transaction & { budgetId: string; budgetName: string }) {
    setCurrent({ id: transaction.budgetId, name: transaction.budgetName });
    openEditor(transaction);
  }

  function closeEditor() {
    setEditingTx(null);
    setEditDesc('');
    setEditAmount('');
    setEditDateTime('');
  }

  async function confirmEdit() {
    if (!editingTx) return;
    const originalDateTime = getZonedDateTimeInputValue(editingTx.date, timeZone);
    const date = editDateTime === originalDateTime
      ? editingTx.date
      : zonedDateTimeToIso(editDateTime, timeZone);
    if (!date) {
      showToast('Choose a valid transaction date and time', 'error');
      return;
    }
    await updateTransaction(editingTx.id, editDesc, Number(editAmount) || 0, date);
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
  const todayDateKey = getZonedDateKey(new Date(), timeZone) || getMonthInputValue() + '-01';
  const totalTransactions = budgets.reduce(
    (total, budget) => total + getTransactionsForMonth(
      budget.transactions || [],
      selectedMonth,
      timeZone
    ).reduce((sum, transaction) => sum + (transaction.amount || 0), 0),
    0
  );
  const globalBalanceBeforeSavings = (Number(globalIncome) || 0) - totalTransactions;
  const savingsReserve = calculateSavingsReserve(globalBalanceBeforeSavings, Number(savingsPercentage) || 0);
  const remainingGlobal = globalBalanceBeforeSavings - savingsReserve;
  const spendingSummary = getSpendingSummary(budgets, selectedMonth, timeZone);
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
      timeZone,
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
            className={page === 'recurring' ? 'active' : 'btn muted'}
            aria-current={page === 'recurring' ? 'page' : undefined}
            onClick={() => setPage('recurring')}
          >
            Recurring
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
            const monthTransactions = getTransactionsForMonth(b.transactions || [], selectedMonth, timeZone);
            const remaining = getBudgetRemaining(b.limit, monthTransactions);
            const alertStatus = getBudgetAlertStatus(b.limit, monthTransactions, budgetAlertThreshold);
            const spent = b.limit - remaining;
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
                  {alertStatus && (
                    <div className={`budget-alert ${alertStatus}`} role="status" aria-live="polite">
                      {alertStatus === 'over'
                        ? `Over budget by ${formatCurrency(-remaining)}`
                        : `Approaching limit (${Math.round((spent / b.limit) * 100)}% used)`}
                    </div>
                  )}
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
                timeZone={timeZone}
                onAdd={addTransaction}
              />
              <ul>
                {getTransactionsForMonth(txs, selectedMonth, timeZone).map((t) => (
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
                        <div className="muted small">{formatDateTime(t.date, timeZone)}</div>
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
                    <span className="muted small">{formatDateTime(transaction.date, timeZone)}</span>
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
        ) : page === 'recurring' ? (
          <section className="recurring-page" aria-labelledby="recurring-heading">
            <h2 id="recurring-heading">Recurring transactions</h2>
            <p className="muted">Manage weekly and monthly bills or income. In-app reminders appear five days before they are due. Bills use positive amounts; income uses negative amounts.</p>
            {budgets.length === 0 ? (
              <div className="empty">Create a category before scheduling a recurring transaction.</div>
            ) : (
              <section className="settings-card recurring-form" aria-label={editingRecurringId ? 'Edit recurring schedule' : 'Create recurring schedule'}>
                <div className="form-field">
                  <label className="form-label" htmlFor="recurring-category">Category</label>
                  <select id="recurring-category" value={recurringBudgetId} onChange={(e) => setRecurringBudgetId(e.target.value)}>
                    <option value="">Choose a category</option>
                    {budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="recurring-description">Description</label>
                  <input id="recurring-description" value={recurringDescription} onChange={(e) => setRecurringDescription(e.target.value)} placeholder="Rent, paycheck, etc." />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="recurring-amount">Amount</label>
                  <input id="recurring-amount" type="number" step="0.01" value={recurringAmount} onChange={(e) => setRecurringAmount(e.target.value === '' ? '' : Number(e.target.value))} />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="recurring-frequency">Repeats</label>
                  <select id="recurring-frequency" value={recurringFrequency} onChange={(e) => setRecurringFrequency(e.target.value as RecurrenceFrequency)}>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="recurring-due-date">Next due date</label>
                  <input id="recurring-due-date" type="date" value={recurringDueDate} onChange={(e) => setRecurringDueDate(e.target.value)} />
                </div>
                <div className="actions recurring-form-actions">
                  <button onClick={saveRecurringSchedule}>{editingRecurringId ? 'Save Schedule' : 'Add Schedule'}</button>
                  {editingRecurringId && <button className="btn muted" onClick={resetRecurringForm}>Cancel Edit</button>}
                </div>
              </section>
            )}
            <section className="cards" aria-label="Scheduled transactions">
              {recurringSchedules.length === 0 ? (
                <div className="empty">No recurring transactions scheduled yet.</div>
              ) : recurringSchedules.map((schedule) => {
                const daysUntil = getDaysUntilDate(schedule.nextDueDate, todayDateKey);
                const budgetName = budgets.find((budget) => budget.id === schedule.budgetId)?.name || 'Unknown category';
                const dueLabel = daysUntil < 0
                  ? `Overdue by ${Math.abs(daysUntil)} ${Math.abs(daysUntil) === 1 ? 'day' : 'days'}`
                  : daysUntil === 0
                    ? 'Due today'
                    : `Due in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}`;
                return (
                  <div className="card recurring-card" key={schedule.id}>
                    <div className="card-left">
                      <div className="card-title">{schedule.description}</div>
                      <div className="muted">{budgetName}</div>
                      <div className={`amount ${schedule.amount < 0 ? 'neg' : 'pos'}`}>{formatCurrency(schedule.amount)}</div>
                      <div className="muted small">Repeats {schedule.frequency}</div>
                      <div className={daysUntil <= 5 ? 'recurring-due soon' : 'recurring-due'}>
                        {dueLabel} · {new Date(`${schedule.nextDueDate}T12:00:00`).toLocaleDateString()}
                      </div>
                      <div className="actions recurring-actions">
                        <button onClick={() => beginRecordingOccurrence(schedule)}>Record occurrence</button>
                        <button className="btn muted" onClick={() => skipRecurringOccurrence(schedule)}>Skip</button>
                        <button className="btn muted" onClick={() => editRecurringSchedule(schedule)}>Edit</button>
                        <button className="btn danger" onClick={() => setDeletingRecurring(schedule)}>Delete</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
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
                <label className="form-label" htmlFor="time-zone">Time zone</label>
                <select
                  id="time-zone"
                  value={timeZoneDraft}
                  onChange={(e) => setTimeZoneDraft(e.target.value)}
                >
                  <option value="">System default ({getSystemTimeZone()})</option>
                  {getTimeZoneOptions().map((zone) => (
                    <option key={zone} value={zone}>{zone}</option>
                  ))}
                </select>
              </div>
              <button onClick={saveTimeZone}>Save Time Zone</button>
            </div>
            <p className="muted small">
              The time zone decides which month and day each transaction belongs to, and how transaction times are shown.
            </p>
            <div className="settings-card">
              <div className="form-field">
                <label className="form-label" htmlFor="budget-alert-threshold">Budget warning threshold (%)</label>
                <input
                  id="budget-alert-threshold"
                  value={budgetAlertThresholdDraft}
                  onChange={(e) => setBudgetAlertThresholdDraft(e.target.value === '' ? '' : Number(e.target.value))}
                  type="number"
                  min="1"
                  max="100"
                  step="0.1"
                />
              </div>
              <button onClick={saveBudgetAlertThreshold}>Save Alert Threshold</button>
            </div>
            <p className="muted small">
              Show a warning when a category reaches this percentage of its monthly limit. Any spending above the limit is marked over budget.
            </p>
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
            <div className="settings-card data-transfer-card">
              <div>
                <h3>CSV transactions</h3>
                <p className="muted small">
                  Export transaction rows or append a CSV with Category, Description, Amount, and Date columns.
                  Missing categories are created with a zero budget limit.
                </p>
              </div>
              <div className="actions">
                <button onClick={exportCsv}>Export Transactions CSV</button>
                <button className="btn muted" onClick={() => csvImportInputRef.current?.click()}>
                  Import Transactions CSV
                </button>
                <input
                  ref={csvImportInputRef}
                  className="sr-only"
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Choose transaction CSV file"
                  onChange={importCsvFile}
                />
              </div>
            </div>
            <div className="settings-card data-transfer-card">
              <div>
                <h3>Full backup</h3>
                <p className="muted small">
                  Save or restore budgets, transactions, recurring schedules, savings goals, and app settings.
                  Restoring replaces all current app data.
                </p>
              </div>
              <div className="actions">
                <button onClick={exportBackup}>Create Backup</button>
                <button className="btn muted" onClick={() => backupImportInputRef.current?.click()}>
                  Restore Backup
                </button>
                <input
                  ref={backupImportInputRef}
                  className="sr-only"
                  type="file"
                  accept=".json,application/json"
                  aria-label="Choose backup JSON file"
                  onChange={selectBackupFile}
                />
              </div>
            </div>
          </section>
        )}
        {pendingBackup && (
          <Modal
            title="Replace current data?"
            onClose={() => {
              setPendingBackup(null);
              setPendingBackupFilename('');
            }}
            onConfirm={restoreBackup}
            confirmLabel="Restore Backup"
          >
            <p>
              Restore <strong>{pendingBackupFilename}</strong>? This will replace all current budgets,
              transactions, schedules, goals, and app settings.
            </p>
          </Modal>
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
              <input
                aria-label="Transaction date and time"
                type="datetime-local"
                value={editDateTime}
                onChange={(e) => setEditDateTime(e.target.value)}
              />
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
        {recordingSchedule && (
          <Modal
            title={'Record ' + recordingSchedule.description}
            onClose={() => setRecordingSchedule(null)}
            onConfirm={recordRecurringOccurrence}
            confirmLabel="Record transaction"
          >
            <div className="goal-modal-fields">
              <div className="form-field">
                <label className="form-label" htmlFor="recurring-occurrence-amount">Actual amount</label>
                <input
                  id="recurring-occurrence-amount"
                  type="number"
                  step="0.01"
                  value={recordingAmount}
                  onChange={(e) => setRecordingAmount(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="recurring-occurrence-date">Transaction date</label>
                <input
                  id="recurring-occurrence-date"
                  type="date"
                  value={recordingDate}
                  onChange={(e) => setRecordingDate(e.target.value)}
                />
              </div>
            </div>
          </Modal>
        )}
        {deletingRecurring && (
          <Modal
            title={'Delete ' + deletingRecurring.description + '?'}
            onClose={() => setDeletingRecurring(null)}
            onConfirm={() => deleteRecurringSchedule(deletingRecurring)}
            confirmLabel="Delete schedule"
          >
            <p>This removes the recurring reminder. Already recorded transactions are not affected.</p>
          </Modal>
        )}        {deletingSavingsGoal && (
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
  timeZone,
  onAdd,
}: {
  categoryName: string;
  month: string;
  timeZone: string;
  onAdd: (desc: string, amount: number, date: string) => Promise<boolean>;
}) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [transactionDate, setTransactionDate] = useState(() => getDefaultTransactionDate(month, timeZone));
  const [dateError, setDateError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const transactionIso = zonedNoonToIso(transactionDate, timeZone);

  async function confirmAdd() {
    if (submitting || !transactionIso) return;
    setSubmitting(true);
    try {
      if (await onAdd(desc, Number(amount) || 0, transactionIso)) {
        setConfirming(false);
        setDesc('');
        setAmount('');
        setTransactionDate(getDefaultTransactionDate(month, timeZone));
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
            if (!transactionIso || !transactionDate.startsWith(`${month}-`)) {
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
          <p>Date: {transactionIso && new Date(transactionIso).toLocaleDateString(undefined, { timeZone: timeZone || undefined })}</p>
        </Modal>
      )}
    </>
  );
}
