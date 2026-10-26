import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getBudgets: () => ipcRenderer.invoke('getBudgets'),
  createBudget: (name: string, limit: number, income: number) => ipcRenderer.invoke('createBudget', name, limit, income),
  deleteBudget: (id: string) => ipcRenderer.invoke('deleteBudget', id),
  updateBudget: (id: string, name: string, limit: number, income: number) => ipcRenderer.invoke('updateBudget', id, name, limit, income),
  getGlobalIncome: () => ipcRenderer.invoke('getGlobalIncome'),
  setGlobalIncome: (amount: number) => ipcRenderer.invoke('setGlobalIncome', amount),
  getBudgetAlertThreshold: () => ipcRenderer.invoke('getBudgetAlertThreshold'),
  setBudgetAlertThreshold: (threshold: number) => ipcRenderer.invoke('setBudgetAlertThreshold', threshold),
  getSavingsPercentage: () => ipcRenderer.invoke('getSavingsPercentage'),
  setSavingsPercentage: (percentage: number) => ipcRenderer.invoke('setSavingsPercentage', percentage),
  getTimeZone: () => ipcRenderer.invoke('getTimeZone'),
  setTimeZone: (timeZone: string) => ipcRenderer.invoke('setTimeZone', timeZone),
  getRecurringTransactions: () => ipcRenderer.invoke('getRecurringTransactions'),
  createRecurringTransaction: (
    budgetId: string,
    description: string,
    amount: number,
    nextDueDate: string,
    frequency: 'weekly' | 'monthly'
  ) => ipcRenderer.invoke('createRecurringTransaction', budgetId, description, amount, nextDueDate, frequency),
  updateRecurringTransaction: (
    id: string,
    budgetId: string,
    description: string,
    amount: number,
    nextDueDate: string,
    frequency: 'weekly' | 'monthly'
  ) => ipcRenderer.invoke('updateRecurringTransaction', id, budgetId, description, amount, nextDueDate, frequency),
  completeRecurringTransaction: (id: string, amount: number, date: string) =>
    ipcRenderer.invoke('completeRecurringTransaction', id, amount, date),
  skipRecurringOccurrence: (id: string) => ipcRenderer.invoke('skipRecurringOccurrence', id),
  deleteRecurringTransaction: (id: string) => ipcRenderer.invoke('deleteRecurringTransaction', id),
  getSavingsGoals: () => ipcRenderer.invoke('getSavingsGoals'),
  createSavingsGoal: (name: string, target: number) => ipcRenderer.invoke('createSavingsGoal', name, target),
  updateSavingsGoal: (id: string, name: string, target: number, saved: number) =>
    ipcRenderer.invoke('updateSavingsGoal', id, name, target, saved),
  deleteSavingsGoal: (id: string) => ipcRenderer.invoke('deleteSavingsGoal', id),
  addTransaction: (budgetId: string, description: string, amount: number, date?: string) =>
    ipcRenderer.invoke('addTransaction', budgetId, description, amount, date),
  getTransactions: (budgetId: string) => ipcRenderer.invoke('getTransactions', budgetId),
  updateTransaction: (budgetId: string, transactionId: string, description: string, amount: number) =>
    ipcRenderer.invoke('updateTransaction', budgetId, transactionId, description, amount),
  deleteTransaction: (budgetId: string, transactionId: string) => ipcRenderer.invoke('deleteTransaction', budgetId, transactionId),
});

// Notify main that preload ran
ipcRenderer.send('preload-ready');

// Forward uncaught errors and rejected promises to main
window.addEventListener('error', (ev) => {
  ipcRenderer.send('renderer-error', { message: ev.message, filename: ev.filename, lineno: ev.lineno, colno: ev.colno });
});

window.addEventListener('unhandledrejection', (ev) => {
  try {
    const reason = (ev as any).reason;
    ipcRenderer.send('renderer-error', { message: 'unhandledrejection', reason });
  } catch { }
});
