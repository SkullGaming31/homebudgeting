import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { Store } from './store';

let mainWindow: BrowserWindow | null = null;
let store: Store;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  // DevTools will not open automatically in production

  // Forward renderer console messages to the terminal for easier debugging
  mainWindow.webContents.on('console-message', (_ev, level, message, line, sourceId) => {
    console.log(`Renderer console [${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_ev, errorCode, errorDescription, validatedURL) => {
    console.error('Renderer failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('render-process-gone', (_ev, details) => {
    console.error('Renderer process gone:', details);
  });

  // Quick runtime checks: log if preload exposed `window.api` and document body HTML length
  mainWindow.webContents.executeJavaScript(
    'console.log("__ELECTRON_CHECK__ window.api=", typeof window.api, " bodyLen=", document.body ? document.body.innerHTML.length : 0)'
  );
}

app.whenReady().then(async () => {
  store = new Store();
  await store.load();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers
ipcMain.handle('getBudgets', async () => {
  return store.getBudgets();
});

ipcMain.handle('getGlobalIncome', async () => {
  return store.getGlobalIncome();
});

ipcMain.handle('getSavingsPercentage', async () => {
  return store.getSavingsPercentage();
});

ipcMain.handle('setSavingsPercentage', async (_ev, percentage: number) => {
  return store.setSavingsPercentage(percentage);
});

ipcMain.handle('getSavingsGoals', async () => {
  return store.getSavingsGoals();
});

ipcMain.handle('createSavingsGoal', async (_ev, name: string, target: number) => {
  return store.createSavingsGoal(name, target);
});

ipcMain.handle('updateSavingsGoal', async (_ev, id: string, name: string, target: number, saved: number) => {
  return store.updateSavingsGoal(id, name, target, saved);
});

ipcMain.handle('deleteSavingsGoal', async (_ev, id: string) => {
  return store.deleteSavingsGoal(id);
});

ipcMain.handle('createBudget', async (_ev, name: string, limit: number, income: number) => {
  return store.createBudget(name, limit, income);
});

ipcMain.handle('deleteBudget', async (_ev, id: string) => {
  return store.deleteBudget(id);
});

ipcMain.handle('updateBudget', async (_ev, id: string, name: string, limit: number, income: number) => {
  return store.updateBudget(id, name, limit, income);
});

ipcMain.handle('setGlobalIncome', async (_ev, amount: number) => {
  return store.setGlobalIncome(amount);
});

ipcMain.handle('addTransaction', async (_ev, budgetId: string, description: string, amount: number) => {
  return store.addTransaction(budgetId, description, amount);
});

ipcMain.handle('getTransactions', async (_ev, budgetId: string) => {
  return store.getTransactions(budgetId);
});

ipcMain.handle('updateTransaction', async (_ev, budgetId: string, transactionId: string, description: string, amount: number) => {
  return store.updateTransaction(budgetId, transactionId, description, amount);
});

ipcMain.handle('deleteTransaction', async (_ev, budgetId: string, transactionId: string) => {
  return store.deleteTransaction(budgetId, transactionId);
});

ipcMain.on('preload-ready', () => {
  console.log('Preload script executed (preload-ready)');
});

ipcMain.on('renderer-error', (_ev, info) => {
  console.error('Renderer reported error:', info);
});
