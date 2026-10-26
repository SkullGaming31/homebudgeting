// An empty or undefined time zone means "use the system time zone".
export type TimeZone = string | undefined;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function getZonedParts(date: Date, timeZone?: TimeZone): ZonedParts | null {
  if (!Number.isFinite(date.getTime())) return null;
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
    };
  }

  const values: Record<string, number> = {};
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

export function getZonedDateKey(value: string | Date, timeZone?: TimeZone) {
  const parts = getZonedParts(typeof value === 'string' ? new Date(value) : value, timeZone);
  if (!parts) return null;
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

export function getZonedMonthKey(value: string | Date, timeZone?: TimeZone) {
  return getZonedDateKey(value, timeZone)?.slice(0, 7) ?? null;
}

// Returns the instant of noon on the given calendar date in the time zone, so the
// stored timestamp stays on that date regardless of the viewer's system time zone.
export function zonedNoonToIso(dateKey: string, timeZone?: TimeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const wallClock = Date.UTC(year, month - 1, day, 12);
  if (new Date(wallClock).getUTCDate() !== day) return null;

  let instant = wallClock;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = getZonedParts(new Date(instant), timeZone);
    if (!parts) return null;
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    instant += wallClock - shown;
  }
  const result = new Date(instant);
  return getZonedDateKey(result, timeZone) === dateKey ? result.toISOString() : null;
}
