export type RecurrenceFrequency = 'weekly' | 'monthly';

export interface RecurringTransactionSchedule {
  id: string;
  budgetId: string;
  description: string;
  amount: number;
  frequency: RecurrenceFrequency;
  nextDueDate: string;
  dayOfMonth?: number;
}

function parseDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) return null;
  return { year, month, day, date };
}

export function isValidDateKey(dateKey: string) {
  return parseDateKey(dateKey) !== null;
}

export function getNextOccurrenceDate(
  currentDate: string,
  frequency: RecurrenceFrequency,
  dayOfMonth?: number
) {
  const parsed = parseDateKey(currentDate);
  if (!parsed) throw new RangeError('A valid YYYY-MM-DD due date is required');

  if (frequency === 'weekly') {
    parsed.date.setUTCDate(parsed.date.getUTCDate() + 7);
    return parsed.date.toISOString().slice(0, 10);
  }
  if (frequency !== 'monthly') throw new RangeError('Unsupported recurrence frequency');

  const nextMonth = new Date(Date.UTC(parsed.year, parsed.month, 1));
  const lastDay = new Date(Date.UTC(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth() + 1,
    0
  )).getUTCDate();
  const requestedDay = dayOfMonth ?? parsed.day;
  if (!Number.isInteger(requestedDay) || requestedDay < 1 || requestedDay > 31) {
    throw new RangeError('Monthly recurrence day must be between 1 and 31');
  }
  const nextDay = Math.min(requestedDay, lastDay);
  nextMonth.setUTCDate(nextDay);
  return nextMonth.toISOString().slice(0, 10);
}

export function getDaysUntilDate(dateKey: string, fromDateKey: string) {
  const target = parseDateKey(dateKey);
  const start = parseDateKey(fromDateKey);
  if (!target || !start) throw new RangeError('Valid YYYY-MM-DD dates are required');
  return Math.round((target.date.getTime() - start.date.getTime()) / 86_400_000);
}