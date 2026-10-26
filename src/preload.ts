import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getBudgets: () => ipcRenderer.invoke('getBudgets'),
  createBudget: (name: string, limit: number, income: number) => ipcRenderer.invoke('createBudget', name, limit, income),
  deleteBudget: (id: string) => ipcRenderer.invoke('deleteBudget', id),
  updateBudget: (id: string, name: string, limit: number, income: number) => ipcRenderer.invoke('updateBudget', id, name, limit, income),
  getGlobalIncome: () => ipcRenderer.invoke('getGlobalIncome'),
  setGlobalIncome: (amount: number) => ipcRenderer.invoke('setGlobalIncome', amount),
  getSavingsPercentage: () => ipcRenderer.invoke('getSavingsPercentage'),
  setSavingsPercentage: (percentage: number) => ipcRenderer.invoke('setSavingsPercentage', percentage),
  getSavingsGoals: () => ipcRenderer.invoke('getSavingsGoals'),
  createSavingsGoal: (name: string, target: number) => ipcRenderer.invoke('createSavingsGoal', name, target),
  updateSavingsGoal: (id: string, name: string, target: number, saved: number) =>
    ipcRenderer.invoke('updateSavingsGoal', id, name, target, saved),
  deleteSavingsGoal: (id: string) => ipcRenderer.invoke('deleteSavingsGoal', id),
  addTransaction: (budgetId: string, description: string, amount: number) =>
    ipcRenderer.invoke('addTransaction', budgetId, description, amount),
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
