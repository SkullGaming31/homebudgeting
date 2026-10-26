import { AppData, Budget, RecurringTransaction, SavingsGoal, Transaction } from './types';
import { isValidDateKey } from './recurring';
import { isValidTimeZone, zonedNoonToIso } from './timezone';

export interface CsvTransactionRow {
  category: string;
  description: string;
  amount: number;
  date: string;
}

const BACKUP_FORMAT = 'home-budgeting-backup';
const BACKUP_VERSION = 1;
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function validTimestamp(value: unknown, label: string) {
  if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
  return value;
}

export function validateAppData(value: unknown): AppData {
  if (!isRecord(value) || !Array.isArray(value.budgets)) {
    throw new Error('Backup data must contain a budgets array');
  }

  const budgetIds = new Set<string>();
  const budgets: Budget[] = value.budgets.map((entry, budgetIndex) => {
    const label = `Budget ${budgetIndex + 1}`;
    if (!isRecord(entry) || !Array.isArray(entry.transactions)) {
      throw new Error(`${label} must contain a transactions array`);
    }
    const id = requiredString(entry.id, `${label} ID`);
    if (budgetIds.has(id)) throw new Error(`Duplicate budget ID: ${id}`);
    budgetIds.add(id);
    const transactionIds = new Set<string>();
    const transactions: Transaction[] = entry.transactions.map((transaction, transactionIndex) => {
      const transactionLabel = `${label} transaction ${transactionIndex + 1}`;
      if (!isRecord(transaction)) throw new Error(`${transactionLabel} is invalid`);
      const transactionId = requiredString(transaction.id, `${transactionLabel} ID`);
      if (transactionIds.has(transactionId)) throw new Error(`Duplicate transaction ID: ${transactionId}`);
      transactionIds.add(transactionId);
      return {
        id: transactionId,
        description: requiredString(transaction.description, `${transactionLabel} description`),
        amount: finiteNumber(transaction.amount, `${transactionLabel} amount`),
        date: validTimestamp(transaction.date, `${transactionLabel} date`),
      };
    });
    const budget: Budget = {
      id,
      name: requiredString(entry.name, `${label} name`),
      limit: finiteNumber(entry.limit, `${label} limit`),
      transactions,
    };
    if (entry.income !== undefined) budget.income = finiteNumber(entry.income, `${label} income`);
    return budget;
  });

  const data: AppData = { budgets };
  if (value.globalIncome !== undefined) {
    const globalIncome = finiteNumber(value.globalIncome, 'Global income');
    if (globalIncome < 0) throw new Error('Global income cannot be negative');
    data.globalIncome = globalIncome;
  }
  if (value.savingsPercentage !== undefined) {
    const percentage = finiteNumber(value.savingsPercentage, 'Savings percentage');
    if (percentage < 0 || percentage > 100) throw new Error('Savings percentage must be between 0 and 100');
    data.savingsPercentage = percentage;
  }
  if (value.savingsGoals !== undefined) {
    if (!Array.isArray(value.savingsGoals)) throw new Error('Savings goals must be an array');
    const ids = new Set<string>();
    data.savingsGoals = value.savingsGoals.map((entry, index): SavingsGoal => {
      const label = `Savings goal ${index + 1}`;
      if (!isRecord(entry)) throw new Error(`${label} is invalid`);
      const id = requiredString(entry.id, `${label} ID`);
      if (ids.has(id)) throw new Error(`Duplicate savings goal ID: ${id}`);
      ids.add(id);
      const target = finiteNumber(entry.target, `${label} target`);
      const saved = finiteNumber(entry.saved, `${label} saved amount`);
      if (target <= 0 || saved < 0) throw new Error(`${label} has invalid amounts`);
      return { id, name: requiredString(entry.name, `${label} name`), target, saved };
    });
  }
  if (value.timeZone !== undefined) {
    if (typeof value.timeZone !== 'string' || (value.timeZone && !isValidTimeZone(value.timeZone))) {
      throw new Error('Time zone must be empty or a valid IANA time zone');
    }
    data.timeZone = value.timeZone;
  }
  if (value.budgetAlertThreshold !== undefined) {
    const threshold = finiteNumber(value.budgetAlertThreshold, 'Budget alert threshold');
    if (threshold < 1 || threshold > 100) throw new Error('Budget alert threshold must be between 1 and 100');
    data.budgetAlertThreshold = threshold;
  }
  if (value.recurringTransactions !== undefined) {
    if (!Array.isArray(value.recurringTransactions)) throw new Error('Recurring transactions must be an array');
    const ids = new Set<string>();
    data.recurringTransactions = value.recurringTransactions.map((entry, index): RecurringTransaction => {
      const label = `Recurring transaction ${index + 1}`;
      if (!isRecord(entry)) throw new Error(`${label} is invalid`);
      const id = requiredString(entry.id, `${label} ID`);
      if (ids.has(id)) throw new Error(`Duplicate recurring transaction ID: ${id}`);
      ids.add(id);
      const budgetId = requiredString(entry.budgetId, `${label} budget ID`);
      if (!budgetIds.has(budgetId)) throw new Error(`${label} references a missing budget`);
      const dueDate = requiredString(entry.nextDueDate, `${label} due date`);
      if (!isValidDateKey(dueDate)) throw new Error(`${label} due date is invalid`);
      if (entry.frequency !== 'weekly' && entry.frequency !== 'monthly') {
        throw new Error(`${label} frequency must be weekly or monthly`);
      }
      const schedule: RecurringTransaction = {
        id,
        budgetId,
        description: requiredString(entry.description, `${label} description`),
        amount: finiteNumber(entry.amount, `${label} amount`),
        frequency: entry.frequency,
        nextDueDate: dueDate,
      };
      if (entry.frequency === 'monthly') {
        const dayOfMonth = entry.dayOfMonth === undefined
          ? Number(dueDate.slice(-2))
          : finiteNumber(entry.dayOfMonth, `${label} day of month`);
        if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
          throw new Error(`${label} day of month must be between 1 and 31`);
        }
        schedule.dayOfMonth = dayOfMonth;
      }
      return schedule;
    });
  }
  return data;
}

function parseCsvRows(source: string): string[][] {
  const csv = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let afterQuote = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (inQuotes) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        cell += character;
      }
    } else if (character === ',') {
      row.push(cell.trim());
      cell = '';
      afterQuote = false;
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && csv[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((field) => field !== '')) rows.push(row);
      row = [];
      cell = '';
      afterQuote = false;
    } else if (character === '"') {
      if (cell.trim() !== '' || afterQuote) throw new Error('CSV contains an unexpected quote');
      cell = '';
      inQuotes = true;
    } else if (afterQuote) {
      if (!/\s/.test(character)) throw new Error('CSV contains characters after a quoted field');
    } else {
      cell += character;
    }
  }

  if (inQuotes) throw new Error('CSV contains an unclosed quoted field');
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim());
    if (row.some((field) => field !== '')) rows.push(row);
  }
  return rows;
}

function decodeSpreadsheetText(value: string) {
  return value.replace(/^'(?=[=+\-@\t\r])/, '');
}

export function parseTransactionsCsv(source: string, timeZone?: string): CsvTransactionRow[] {
  const rows = parseCsvRows(source);
  if (rows.length < 2) throw new Error('CSV must contain a header and at least one transaction');
  const headers = rows[0].map((header) => header.toLowerCase());
  const columns = ['category', 'description', 'amount', 'date'];
  const positions = columns.map((column) => headers.indexOf(column));
  if (positions.some((position) => position < 0) || new Set(positions).size !== positions.length) {
    throw new Error('CSV headers must include Category, Description, Amount, and Date');
  }

  return rows.slice(1).map((fields, index) => {
    const rowNumber = index + 2;
    if (fields.length !== headers.length) throw new Error(`CSV row ${rowNumber} has the wrong number of columns`);
    const category = decodeSpreadsheetText(fields[positions[0]]).trim();
    const description = decodeSpreadsheetText(fields[positions[1]]);
    const amountText = fields[positions[2]];
    const dateText = fields[positions[3]];
    const amount = Number(amountText);
    if (!category) throw new Error(`CSV row ${rowNumber} needs a category`);
    if (!description.trim()) throw new Error(`CSV row ${rowNumber} needs a description`);
    if (!amountText || !Number.isFinite(amount)) throw new Error(`CSV row ${rowNumber} has an invalid amount`);

    const dateKey = dateText.slice(0, 10);
    let date: string;
    if (isValidDateKey(dateText)) {
      const noon = zonedNoonToIso(dateText, timeZone);
      if (!noon) throw new Error(`CSV row ${rowNumber} has an invalid date for the selected time zone`);
      date = noon;
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(dateText) && isValidDateKey(dateKey) &&
      Number.isFinite(new Date(dateText).getTime())) {
      date = new Date(dateText).toISOString();
    } else {
      throw new Error(`CSV row ${rowNumber} has an invalid date`);
    }
    return { category, description, amount, date };
  });
}

function escapeCsvCell(value: string, protectFormula = true) {
  const safeValue = protectFormula && FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))
    ? `'${value}`
    : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

export function exportTransactionsCsv(budgets: Budget[]) {
  const rows = [['Category', 'Description', 'Amount', 'Date']
    .map((value) => escapeCsvCell(value, false))
    .join(',')];
  for (const budget of budgets) {
    for (const transaction of budget.transactions) {
      rows.push([
        escapeCsvCell(budget.name),
        escapeCsvCell(transaction.description),
        escapeCsvCell(String(transaction.amount), false),
        escapeCsvCell(transaction.date, false),
      ].join(','));
    }
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

export function appendCsvTransactions(
  source: AppData,
  rows: CsvTransactionRow[],
  createId: () => string
): AppData {
  if (!rows.length) throw new Error('CSV contains no transactions to import');
  const data = validateAppData(source);
  const budgets = data.budgets;
  for (const [index, row] of rows.entries()) {
    const label = `CSV transaction ${index + 1}`;
    const category = requiredString(row.category, `${label} category`).trim();
    const description = requiredString(row.description, `${label} description`).trim();
    const amount = finiteNumber(row.amount, `${label} amount`);
    const date = validTimestamp(row.date, `${label} date`);
    let budget = budgets.find((item) => item.name.toLowerCase() === category.toLowerCase());
    if (!budget) {
      budget = { id: createId(), name: category, limit: 0, income: 0, transactions: [] };
      budgets.push(budget);
    }
    budget.transactions.push({
      id: createId(),
      description,
      amount,
      date,
    });
  }
  return data;
}

export function createAppDataBackup(data: AppData, exportedAt = new Date().toISOString()) {
  const validated = validateAppData(data);
  validTimestamp(exportedAt, 'Backup export date');
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    data: validated,
  }, null, 2);
}

export function parseAppDataBackup(source: string): AppData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('Backup file is not valid JSON');
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || parsed.version !== BACKUP_VERSION) {
    throw new Error('Backup file format or version is not supported');
  }
  validTimestamp(parsed.exportedAt, 'Backup export date');
  return validateAppData(parsed.data);
}
