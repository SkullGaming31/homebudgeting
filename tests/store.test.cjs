const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { afterEach, beforeEach, describe, it } = require('node:test');
const {
  getBudgetAlertStatus,
  getBudgetRemaining,
  getMonthInputValue,
  getMonthKey,
  getTransactionsForMonth,
} = require('../dist/budget');
const { calculateSavingsReserve } = require('../dist/savings');
const { getSpendingSummary } = require('../dist/spending');
const {
  getDaysUntilDate,
  getNextOccurrenceDate,
  isValidDateKey,
} = require('../dist/recurring');
const {
  getZonedDateKey,
  isValidTimeZone,
  zonedNoonToIso,
} = require('../dist/timezone');
const { filterTransactions } = require('../dist/transactions');
const {
  appendCsvTransactions,
  createAppDataBackup,
  exportTransactionsCsv,
  parseAppDataBackup,
  parseTransactionsCsv,
} = require('../dist/dataTransfer');

function searchableTransaction(id, overrides = {}) {
  return {
    id,
    description: `Transaction ${id}`,
    amount: 0,
    date: '2025-05-10T12:00:00',
    budgetId: 'budget-a',
    budgetName: 'Category A',
    ...overrides,
  };
}

function transactionFilters(overrides = {}) {
  return {
    query: '',
    budgetId: '',
    fromDate: '',
    toDate: '',
    ...overrides,
  };
}

describe('filterTransactions', () => {
  it('matches description queries without regard to case or surrounding whitespace', () => {
    const transactions = [
      searchableTransaction('match', { description: 'Weekly GROCERIES run' }),
      searchableTransaction('no-match', { description: 'Monthly utilities' }),
    ];

    assert.deepEqual(
      filterTransactions(transactions, transactionFilters({ query: '  groceries  ' }))
        .map(({ id }) => id),
      ['match']
    );
  });

  it('filters by category ID rather than the category display name', () => {
    const transactions = [
      searchableTransaction('selected', { budgetId: 'budget-b', budgetName: 'Shared name' }),
      searchableTransaction('same-name-other-id', {
        budgetId: 'budget-c',
        budgetName: 'Shared name',
      }),
      searchableTransaction('different-name', {
        budgetId: 'budget-b',
        budgetName: 'Another name',
      }),
    ];

    assert.deepEqual(
      filterTransactions(transactions, transactionFilters({ budgetId: 'budget-b' }))
        .map(({ id }) => id),
      ['selected', 'different-name']
    );
  });

  it('applies inclusive minimum and maximum amount filters to negative amounts', () => {
    const transactions = [
      searchableTransaction('below', { amount: -21 }),
      searchableTransaction('min-boundary', { amount: -20 }),
      searchableTransaction('inside', { amount: -15 }),
      searchableTransaction('max-boundary', { amount: -10 }),
      searchableTransaction('above', { amount: -9 }),
    ];

    assert.deepEqual(
      filterTransactions(
        transactions,
        transactionFilters({ minAmount: -20, maxAmount: -10 })
      ).map(({ id }) => id),
      ['min-boundary', 'inside', 'max-boundary']
    );
  });

  it('includes transactions on both date boundaries', () => {
    const transactions = [
      searchableTransaction('before', { date: '2025-05-09T23:59:00' }),
      searchableTransaction('from-boundary', { date: '2025-05-10T00:01:00' }),
      searchableTransaction('within', { date: '2025-05-11T12:00:00' }),
      searchableTransaction('to-boundary', { date: '2025-05-12T23:59:00' }),
      searchableTransaction('after', { date: '2025-05-13T00:01:00' }),
    ];

    assert.deepEqual(
      filterTransactions(
        transactions,
        transactionFilters({ fromDate: '2025-05-10', toDate: '2025-05-12' })
      ).map(({ id }) => id),
      ['to-boundary', 'within', 'from-boundary']
    );
  });

  it('applies search, category, amount, and date filters together', () => {
    const transactions = [
      searchableTransaction('all-match', {
        description: 'Coffee beans',
        amount: -12,
        date: '2025-05-11T12:00:00',
        budgetId: 'food',
      }),
      searchableTransaction('wrong-category', {
        description: 'Coffee beans',
        amount: -12,
        date: '2025-05-11T12:00:00',
        budgetId: 'travel',
      }),
      searchableTransaction('wrong-query', {
        description: 'Train ticket',
        amount: -12,
        date: '2025-05-11T12:00:00',
        budgetId: 'food',
      }),
      searchableTransaction('wrong-amount', {
        description: 'Coffee beans',
        amount: -5,
        date: '2025-05-11T12:00:00',
        budgetId: 'food',
      }),
      searchableTransaction('wrong-date', {
        description: 'Coffee beans',
        amount: -12,
        date: '2025-05-09T12:00:00',
        budgetId: 'food',
      }),
    ];

    assert.deepEqual(
      filterTransactions(
        transactions,
        transactionFilters({
          query: 'COFFEE',
          budgetId: 'food',
          minAmount: -15,
          maxAmount: -10,
          fromDate: '2025-05-10',
          toDate: '2025-05-12',
        })
      ).map(({ id }) => id),
      ['all-match']
    );
  });

  it('excludes transactions with invalid dates', () => {
    const transactions = [
      searchableTransaction('valid'),
      searchableTransaction('invalid', { date: 'not-a-date' }),
    ];

    assert.deepEqual(
      filterTransactions(transactions, transactionFilters()).map(({ id }) => id),
      ['valid']
    );
  });

  it('orders matching transactions newest first', () => {
    const transactions = [
      searchableTransaction('oldest', { date: '2025-05-08T12:00:00' }),
      searchableTransaction('newest', { date: '2025-05-12T12:00:00' }),
      searchableTransaction('middle', { date: '2025-05-10T12:00:00' }),
    ];

    assert.deepEqual(
      filterTransactions(transactions, transactionFilters()).map(({ id }) => id),
      ['newest', 'middle', 'oldest']
    );
  });
});

describe('getBudgetRemaining', () => {
  it('returns the category limit minus transactions, including a negative overspend balance', () => {
    assert.equal(getBudgetRemaining(200, [{ amount: 100 }, { amount: 150 }]), -50);
    assert.equal(getBudgetRemaining(200, [{ amount: 75 }]), 125);
    assert.equal(getBudgetRemaining(200), 200);
  });

  it('accounts for transaction credits when calculating the remaining balance', () => {
    assert.equal(getBudgetRemaining(200, [{ amount: 250 }, { amount: -25 }]), -25);
  });
});

describe('getBudgetAlertStatus', () => {
  it('uses the 80 percent threshold boundary and treats spending above the limit as over', () => {
    assert.equal(getBudgetAlertStatus(100, [{ amount: 79 }], 80), null);
    assert.equal(getBudgetAlertStatus(100, [{ amount: 80 }], 80), 'approaching');
    assert.equal(getBudgetAlertStatus(100, [{ amount: 100 }], 80), 'approaching');
    assert.equal(getBudgetAlertStatus(100, [{ amount: 101 }], 80), 'over');
  });

  it('honors a configurable percentage and nets credits against spending', () => {
    assert.equal(getBudgetAlertStatus(100, [{ amount: 49 }], 50), null);
    assert.equal(getBudgetAlertStatus(100, [{ amount: 50 }], 50), 'approaching');
    assert.equal(
      getBudgetAlertStatus(100, [{ amount: 85 }, { amount: -10 }], 80),
      null
    );
    assert.equal(
      getBudgetAlertStatus(100, [{ amount: 110 }, { amount: -15 }], 80),
      'approaching'
    );
  });
});

describe('monthly transaction helpers', () => {
  it('formats month input values and derives month keys from transaction dates', () => {
    assert.equal(getMonthInputValue(new Date(2025, 0, 15)), '2025-01');
    assert.equal(getMonthInputValue(new Date(2025, 10, 15)), '2025-11');
    assert.equal(getMonthInputValue(new Date(2025, 11, 15)), '2025-12');
    assert.equal(getMonthKey('2025-02-15T12:00:00.000Z'), '2025-02');
    assert.equal(getMonthKey('not-a-date'), null);
  });

  it('filters transactions to the selected month and excludes invalid dates', () => {
    const transactions = [
      { id: 'january', date: '2025-01-15T12:00:00.000Z' },
      { id: 'february-one', date: '2025-02-01T12:00:00.000Z' },
      { id: 'february-end', date: '2025-02-28T12:00:00.000Z' },
      { id: 'march', date: '2025-03-01T12:00:00.000Z' },
      { id: 'invalid', date: 'not-a-date' },
    ];

    assert.equal(getMonthKey('not-a-date'), null);
    assert.deepEqual(
      getTransactionsForMonth(transactions, '2025-02').map(({ id }) => id),
      ['february-one', 'february-end']
    );
    assert.deepEqual(getTransactionsForMonth(transactions, '2025-04'), []);
  });
});

describe('time zone support', () => {
  it('validates IANA time zone names', () => {
    assert.equal(isValidTimeZone('UTC'), true);
    assert.equal(isValidTimeZone('America/St_Johns'), true);
    assert.equal(isValidTimeZone('Not/AZone'), false);
  });

  it('assigns the same instant to different dates and months by time zone', () => {
    const instant = '2025-03-01T00:30:00.000Z';

    assert.equal(getZonedDateKey(instant, 'UTC'), '2025-03-01');
    assert.equal(getZonedDateKey(instant, 'America/Los_Angeles'), '2025-02-28');
    assert.equal(getZonedDateKey(instant, 'Pacific/Auckland'), '2025-03-01');
    assert.equal(getMonthKey(instant, 'UTC'), '2025-03');
    assert.equal(getMonthKey(instant, 'America/Los_Angeles'), '2025-02');
    assert.equal(getZonedDateKey('not-a-date', 'UTC'), null);
  });

  it('uses the system time zone when no time zone is selected', () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';

    try {
      const instant = '2025-01-01T01:00:00.000Z';
      assert.equal(getZonedDateKey(instant), '2024-12-31');
      assert.equal(getMonthKey(instant), '2024-12');
      assert.deepEqual(
        getTransactionsForMonth([{ date: instant }], '2024-12').map(({ date }) => date),
        [instant]
      );
      assert.equal(getZonedDateKey(instant, 'UTC'), '2025-01-01');
    } finally {
      if (previousTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimeZone;
    }
  });

  it('groups transactions and spending by the selected time zone', () => {
    const transactions = [{ id: 'edge', amount: 25, date: '2025-03-01T00:30:00.000Z' }];

    assert.equal(getTransactionsForMonth(transactions, '2025-03', 'UTC').length, 1);
    assert.equal(getTransactionsForMonth(transactions, '2025-03', 'America/Los_Angeles').length, 0);
    assert.equal(getTransactionsForMonth(transactions, '2025-02', 'America/Los_Angeles').length, 1);

    const budgets = [{ name: 'Edge', transactions }];
    assert.equal(getSpendingSummary(budgets, '2025-03', 'UTC').total, 25);
    assert.equal(getSpendingSummary(budgets, '2025-03', 'America/Los_Angeles').total, 0);
    assert.equal(getSpendingSummary(budgets, '2025-02', 'America/Los_Angeles').total, 25);
  });

  it('applies the time zone to transaction date range filters', () => {
    const transactions = [
      searchableTransaction('edge', { date: '2025-03-01T00:30:00.000Z' }),
    ];
    const filters = transactionFilters({ fromDate: '2025-03-01', toDate: '2025-03-01' });

    assert.equal(filterTransactions(transactions, { ...filters, timeZone: 'UTC' }).length, 1);
    assert.equal(
      filterTransactions(transactions, { ...filters, timeZone: 'America/Los_Angeles' }).length,
      0
    );
  });

  it('stores noon on the chosen calendar date in that time zone, including across DST', () => {
    assert.equal(zonedNoonToIso('2025-03-01', 'UTC'), '2025-03-01T12:00:00.000Z');
    assert.equal(zonedNoonToIso('2025-01-15', 'America/Los_Angeles'), '2025-01-15T20:00:00.000Z');
    assert.equal(zonedNoonToIso('2025-07-15', 'America/Los_Angeles'), '2025-07-15T19:00:00.000Z');
    assert.equal(zonedNoonToIso('2025-03-01', 'Pacific/Auckland'), '2025-02-28T23:00:00.000Z');

    for (const zone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Pacific/Kiritimati']) {
      assert.equal(getZonedDateKey(zonedNoonToIso('2025-03-01', zone), zone), '2025-03-01');
    }
  });

  it('converts calendar dates on both daylight-saving transition days', () => {
    const daylightSavingStarts = zonedNoonToIso('2025-03-09', 'America/Los_Angeles');
    const daylightSavingEnds = zonedNoonToIso('2025-11-02', 'America/Los_Angeles');

    assert.equal(daylightSavingStarts, '2025-03-09T19:00:00.000Z');
    assert.equal(daylightSavingEnds, '2025-11-02T20:00:00.000Z');
    assert.equal(getZonedDateKey(daylightSavingStarts, 'America/Los_Angeles'), '2025-03-09');
    assert.equal(getZonedDateKey(daylightSavingEnds, 'America/Los_Angeles'), '2025-11-02');
  });

  it('rejects a calendar date skipped entirely by a time-zone change', () => {
    assert.equal(zonedNoonToIso('2011-12-30', 'Pacific/Apia'), null);
  });

  it('rejects malformed or impossible calendar dates', () => {
    assert.equal(zonedNoonToIso('2025-02-30', 'UTC'), null);
    assert.equal(zonedNoonToIso('2025-2-1', 'UTC'), null);
    assert.equal(zonedNoonToIso('', 'UTC'), null);
  });
});

describe('calculateSavingsReserve', () => {
  it('applies the percentage to positive remaining balance and handles percentage boundaries', () => {
    assert.equal(calculateSavingsReserve(200, 0), 0);
    assert.equal(calculateSavingsReserve(200, 25), 50);
    assert.equal(calculateSavingsReserve(200, 100), 200);
  });

  it('does not reserve money from zero or negative remaining balance', () => {
    assert.equal(calculateSavingsReserve(0, 50), 0);
    assert.equal(calculateSavingsReserve(-75, 50), 0);
    assert.equal(calculateSavingsReserve(-75, 100), 0);
  });
});

describe('getSpendingSummary', () => {
  it('groups positive spending by category and returns six monthly totals through the selected month', () => {
    const budgets = [
      {
        name: 'Groceries',
        transactions: [
          { amount: 30, date: '2025-01-15T12:00:00.000Z' },
          { amount: 50, date: '2025-06-02T12:00:00.000Z' },
          { amount: 10, date: '2025-06-20T12:00:00.000Z' },
          { amount: -5, date: '2025-06-25T12:00:00.000Z' },
        ],
      },
      {
        name: 'Utilities',
        transactions: [
          { amount: 40, date: '2025-06-10T12:00:00.000Z' },
          { amount: 20, date: '2025-07-02T12:00:00.000Z' },
        ],
      },
    ];

    assert.deepEqual(getSpendingSummary(budgets, '2025-06'), {
      categories: [
        { name: 'Groceries', total: 60 },
        { name: 'Utilities', total: 40 },
      ],
      months: [
        { month: '2025-01', total: 30 },
        { month: '2025-02', total: 0 },
        { month: '2025-03', total: 0 },
        { month: '2025-04', total: 0 },
        { month: '2025-05', total: 0 },
        { month: '2025-06', total: 100 },
      ],
      total: 100,
    });
  });

  it('returns zero-filled trend months and no categories when there is no spending', () => {
    assert.deepEqual(getSpendingSummary([], '2025-01'), {
      categories: [],
      months: [
        { month: '2024-08', total: 0 },
        { month: '2024-09', total: 0 },
        { month: '2024-10', total: 0 },
        { month: '2024-11', total: 0 },
        { month: '2024-12', total: 0 },
        { month: '2025-01', total: 0 },
      ],
      total: 0,
    });
  });

  it('keeps exactly the six-month window across a year boundary', () => {
    const budgets = [{
      name: 'Travel',
      transactions: [
        { amount: 100, date: '2024-07-15T12:00:00.000Z' },
        { amount: 20, date: '2024-08-15T12:00:00.000Z' },
        { amount: 30, date: '2025-01-01T12:00:00.000Z' },
        { amount: 200, date: '2025-02-15T12:00:00.000Z' },
      ],
    }];

    assert.deepEqual(getSpendingSummary(budgets, '2025-01'), {
      categories: [{ name: 'Travel', total: 30 }],
      months: [
        { month: '2024-08', total: 20 },
        { month: '2024-09', total: 0 },
        { month: '2024-10', total: 0 },
        { month: '2024-11', total: 0 },
        { month: '2024-12', total: 0 },
        { month: '2025-01', total: 30 },
      ],
      total: 30,
    });
  });

  it('aggregates budgets with the same category name and sorts tied totals alphabetically', () => {
    const budgets = [
      {
        name: 'Zeta',
        transactions: [{ amount: 25, date: '2025-06-10T12:00:00.000Z' }],
      },
      {
        name: 'Alpha',
        transactions: [{ amount: 15, date: '2025-06-11T12:00:00.000Z' }],
      },
      {
        name: 'Zeta',
        transactions: [{ amount: 15, date: '2025-06-12T12:00:00.000Z' }],
      },
    ];

    assert.deepEqual(
      getSpendingSummary(budgets, '2025-06').categories,
      [
        { name: 'Zeta', total: 40 },
        { name: 'Alpha', total: 15 },
      ]
    );

    const tiedSummary = getSpendingSummary([
      budgets[1],
      { name: 'Beta', transactions: [{ amount: 15, date: '2025-06-12T12:00:00.000Z' }] },
    ], '2025-06');
    assert.deepEqual(tiedSummary.categories, [
      { name: 'Alpha', total: 15 },
      { name: 'Beta', total: 15 },
    ]);
  });

  it('rejects an invalid selected month', () => {
    assert.throws(() => getSpendingSummary([], '2025-13'), RangeError);
    assert.throws(() => getSpendingSummary([], '2025-1'), RangeError);
    assert.throws(() => getSpendingSummary([], 'not-a-month'), RangeError);
  });
});

describe('recurring date helpers', () => {
  it('advances weekly occurrences by seven calendar days across month, year, and leap-day boundaries', () => {
    assert.equal(getNextOccurrenceDate('2025-01-29', 'weekly'), '2025-02-05');
    assert.equal(getNextOccurrenceDate('2024-12-28', 'weekly'), '2025-01-04');
    assert.equal(getNextOccurrenceDate('2024-02-24', 'weekly'), '2024-03-02');
  });

  it('clamps monthly occurrences to month end without losing their anchor day', () => {
    assert.equal(getNextOccurrenceDate('2025-01-31', 'monthly'), '2025-02-28');
    assert.equal(getNextOccurrenceDate('2025-02-28', 'monthly', 31), '2025-03-31');
    assert.equal(getNextOccurrenceDate('2024-01-31', 'monthly'), '2024-02-29');
    assert.equal(getNextOccurrenceDate('2024-02-29', 'monthly', 31), '2024-03-31');
    assert.equal(getNextOccurrenceDate('2025-01-30', 'monthly', 30), '2025-02-28');
  });

  it('calculates positive, same-day, and overdue reminder intervals as calendar days', () => {
    assert.equal(getDaysUntilDate('2025-06-15', '2025-06-10'), 5);
    assert.equal(getDaysUntilDate('2025-06-10', '2025-06-10'), 0);
    assert.equal(getDaysUntilDate('2025-06-07', '2025-06-10'), -3);
    assert.equal(getDaysUntilDate('2025-03-01', '2025-02-28'), 1);
  });

  it('accepts only real YYYY-MM-DD date keys and rejects invalid recurrence inputs', () => {
    for (const date of ['2024-02-29', '2025-12-31']) {
      assert.equal(isValidDateKey(date), true);
    }
    for (const date of ['', '2025-2-01', '2025-02-29', '2025-04-31', '2025-13-01', '2025-01-01T00:00:00Z']) {
      assert.equal(isValidDateKey(date), false, `expected ${date} to be invalid`);
      assert.throws(() => getDaysUntilDate(date, '2025-01-01'), RangeError);
      assert.throws(() => getNextOccurrenceDate(date, 'weekly'), RangeError);
    }

    assert.throws(() => getDaysUntilDate('2025-01-01', 'not-a-date'), RangeError);
    assert.throws(() => getNextOccurrenceDate('2025-01-01', 'yearly'), RangeError);
    assert.throws(() => getNextOccurrenceDate('2025-01-01', 'monthly', 0), RangeError);
    assert.throws(() => getNextOccurrenceDate('2025-01-01', 'monthly', 32), RangeError);
  });
});

describe('CSV transaction transfer', () => {
  it('round-trips quoted commas, embedded newlines, negative amounts, and formula-safe text', () => {
    const budgets = [{
      id: 'budget-1',
      name: '=Household',
      limit: 1000,
      transactions: [{
        id: 'transaction-1',
        description: '=SUM(1,2), "quoted"\nand continued',
        amount: -42.75,
        date: '2025-04-12T12:30:00.000Z',
      }],
    }];

    const csv = exportTransactionsCsv(budgets);
    assert.ok(csv.startsWith('\uFEFF'));
    assert.match(csv, /"'=Household"/);
    assert.match(csv, /"'=SUM\(1,2\), ""quoted""\nand continued"/);

    assert.deepEqual(parseTransactionsCsv(csv), [{
      category: '=Household',
      description: '=SUM(1,2), "quoted"\nand continued',
      amount: -42.75,
      date: '2025-04-12T12:30:00.000Z',
    }]);
  });

  it('rejects malformed CSV headers, quoting, columns, amounts, and dates', () => {
    const invalidCsv = [
      ['missing required headers', 'Name,Description,Amount,Date\nFood,Lunch,12,2025-01-01'],
      ['header without a transaction', 'Category,Description,Amount,Date\n'],
      ['unclosed quoted field', 'Category,Description,Amount,Date\nFood,"Lunch,12,2025-01-01'],
      ['unexpected quote', 'Category,Description,Amount,Date\nFood,Lun"ch,12,2025-01-01'],
      ['wrong number of columns', 'Category,Description,Amount,Date\nFood,Lunch,12'],
      ['invalid amount', 'Category,Description,Amount,Date\nFood,Lunch,nope,2025-01-01'],
      ['invalid date', 'Category,Description,Amount,Date\nFood,Lunch,12,2025-02-30'],
    ];

    for (const [label, csv] of invalidCsv) {
      assert.throws(() => parseTransactionsCsv(csv), undefined, label);
    }
  });

  it('appends to matching categories and creates missing categories', () => {
    const source = {
      budgets: [{
        id: 'food-id',
        name: 'Food',
        limit: 500,
        income: 25,
        transactions: [{
          id: 'existing',
          description: 'Earlier purchase',
          amount: 10,
          date: '2025-01-01T12:00:00.000Z',
        }],
      }],
      globalIncome: 3000,
    };
    const ids = ['added-existing', 'new-budget', 'added-new'];
    const result = appendCsvTransactions(source, [
      { category: 'fOoD', description: 'Groceries', amount: -30, date: '2025-02-01T12:00:00.000Z' },
      { category: 'Travel', description: 'Train', amount: 45, date: '2025-02-02T12:00:00.000Z' },
    ], () => ids.shift());

    assert.equal(result.budgets.length, 2);
    assert.equal(result.budgets[0].name, 'Food');
    assert.equal(result.budgets[0].limit, 500);
    assert.deepEqual(result.budgets[0].transactions.map(({ id, amount }) => ({ id, amount })), [
      { id: 'existing', amount: 10 },
      { id: 'added-existing', amount: -30 },
    ]);
    assert.deepEqual(result.budgets[1], {
      id: 'new-budget',
      name: 'Travel',
      limit: 0,
      income: 0,
      transactions: [{
        id: 'added-new',
        description: 'Train',
        amount: 45,
        date: '2025-02-02T12:00:00.000Z',
      }],
    });
    assert.equal(result.globalIncome, 3000);
  });
});

describe('versioned app-data backups', () => {
  it('round-trips app data in the supported backup format and version', () => {
    const data = {
      budgets: [{
        id: 'budget-1',
        name: 'Home',
        limit: 1200,
        income: 4000,
        transactions: [{
          id: 'transaction-1',
          description: 'Rent',
          amount: -950,
          date: '2025-01-01T12:00:00.000Z',
        }],
      }],
      globalIncome: 4000,
      savingsPercentage: 15,
      savingsGoals: [{ id: 'goal-1', name: 'Emergency fund', target: 5000, saved: 500 }],
      timeZone: 'America/St_Johns',
      budgetAlertThreshold: 75,
      recurringTransactions: [{
        id: 'recurring-1',
        budgetId: 'budget-1',
        description: 'Utilities',
        amount: 100,
        frequency: 'monthly',
        nextDueDate: '2025-02-15',
        dayOfMonth: 15,
      }],
    };
    const backup = JSON.parse(createAppDataBackup(data, '2025-03-01T00:00:00.000Z'));

    assert.equal(backup.format, 'home-budgeting-backup');
    assert.equal(backup.version, 1);
    assert.equal(backup.exportedAt, '2025-03-01T00:00:00.000Z');
    assert.deepEqual(parseAppDataBackup(JSON.stringify(backup)), data);
  });

  it('rejects unsupported format/version and invalid backup schemas', () => {
    const valid = {
      format: 'home-budgeting-backup',
      version: 1,
      exportedAt: '2025-03-01T00:00:00.000Z',
      data: { budgets: [] },
    };
    for (const backup of [
      { ...valid, format: 'other-format' },
      { ...valid, version: 2 },
      { ...valid, data: { budgets: [{ id: 'budget', name: 'Home', limit: 10, transactions: 'not-an-array' }] } },
      { ...valid, exportedAt: 'not-a-date' },
    ]) {
      assert.throws(() => parseAppDataBackup(JSON.stringify(backup)));
    }
    assert.throws(() => parseAppDataBackup('{not json}'), { message: 'Backup file is not valid JSON' });
    assert.throws(() => createAppDataBackup({ budgets: [{ id: 'bad', name: 'Home', limit: Infinity, transactions: [] }] }));
  });
});

let userDataPath;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => userDataPath } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { Store } = require('../dist/store');
Module._load = originalLoad;

describe('Store', () => {
  let temporaryDirectory;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'home-budgeting-store-'));
    userDataPath = temporaryDirectory;
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('initializes missing data with empty budgets and persists the default global income', async () => {
    const store = new Store();

    assert.deepEqual(await store.load(), { budgets: [], globalIncome: 0 });
    assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), {
      budgets: [],
      globalIncome: 0,
    });
  });

  it('creates and updates recurring schedules with trimmed fields and persisted monthly anchor days', async () => {
    const store = new Store();
    const budget = await store.createBudget('Household', 1000);

    const monthly = await store.createRecurringTransaction(
      budget.id,
      '  Rent  ',
      900,
      '2025-01-31',
      'monthly'
    );
    assert.deepEqual(
      {
        budgetId: monthly.budgetId,
        description: monthly.description,
        amount: monthly.amount,
        frequency: monthly.frequency,
        nextDueDate: monthly.nextDueDate,
        dayOfMonth: monthly.dayOfMonth,
      },
      {
        budgetId: budget.id,
        description: 'Rent',
        amount: 900,
        frequency: 'monthly',
        nextDueDate: '2025-01-31',
        dayOfMonth: 31,
      }
    );
    assert.ok(monthly.id);

    const weekly = await store.createRecurringTransaction(
      budget.id,
      'Internet',
      60,
      '2025-02-01',
      'weekly'
    );
    assert.equal(Object.hasOwn(weekly, 'dayOfMonth'), false);

    const updated = await store.updateRecurringTransaction(
      monthly.id,
      budget.id,
      '  Mortgage  ',
      1100,
      '2025-02-28',
      'monthly'
    );
    assert.deepEqual(
      {
        id: updated.id,
        description: updated.description,
        amount: updated.amount,
        nextDueDate: updated.nextDueDate,
        dayOfMonth: updated.dayOfMonth,
      },
      {
        id: monthly.id,
        description: 'Mortgage',
        amount: 1100,
        nextDueDate: '2025-02-28',
        dayOfMonth: 28,
      }
    );

    const convertedToWeekly = await store.updateRecurringTransaction(
      monthly.id,
      budget.id,
      'Mortgage',
      1100,
      '2025-03-01',
      'weekly'
    );
    assert.equal(convertedToWeekly.frequency, 'weekly');
    assert.equal(Object.hasOwn(convertedToWeekly, 'dayOfMonth'), false);

    const reloaded = new Store();
    assert.deepEqual(
      (await reloaded.getRecurringTransactions()).map((schedule) => schedule.id),
      [monthly.id, weekly.id]
    );
    assert.equal(
      (await reloaded.getRecurringTransactions())[0].nextDueDate,
      '2025-03-01'
    );
  });

  it('rejects invalid recurring schedule fields and leaves persisted schedules unchanged', async () => {
    const store = new Store();
    const budget = await store.createBudget('Household', 1000);
    const schedule = await store.createRecurringTransaction(
      budget.id,
      'Rent',
      900,
      '2025-01-31',
      'monthly'
    );

    const invalidCreates = [
      ['', 900, '2025-02-01', 'weekly'],
      ['Rent', NaN, '2025-02-01', 'weekly'],
      ['Rent', Infinity, '2025-02-01', 'weekly'],
      ['Rent', 900, '2025-02-30', 'weekly'],
      ['Rent', 900, '2025-02-01', 'yearly'],
    ];
    for (const [description, amount, dueDate, frequency] of invalidCreates) {
      await assert.rejects(
        store.createRecurringTransaction(budget.id, description, amount, dueDate, frequency)
      );
    }
    await assert.rejects(
      store.createRecurringTransaction('missing-budget', 'Rent', 900, '2025-02-01', 'weekly'),
      { message: 'Budget not found' }
    );

    await assert.rejects(
      store.updateRecurringTransaction(schedule.id, budget.id, '  ', 950, '2025-02-01', 'weekly')
    );
    await assert.rejects(
      store.updateRecurringTransaction(schedule.id, budget.id, 'Rent', NaN, '2025-02-01', 'weekly')
    );
    await assert.rejects(
      store.updateRecurringTransaction(schedule.id, budget.id, 'Rent', 950, '2025-02-30', 'weekly')
    );
    await assert.rejects(
      store.updateRecurringTransaction(schedule.id, 'missing-budget', 'Rent', 950, '2025-02-01', 'weekly'),
      { message: 'Budget not found' }
    );
    await assert.rejects(
      store.updateRecurringTransaction('missing-schedule', budget.id, 'Rent', 950, '2025-02-01', 'weekly'),
      { message: 'Recurring transaction not found' }
    );

    assert.deepEqual(await new Store().getRecurringTransactions(), [schedule]);
  });

  it('completes a recurring occurrence by persisting its transaction and advanced date together', async () => {
    const store = new Store();
    const budget = await store.createBudget('Household', 1000);
    const schedule = await store.createRecurringTransaction(
      budget.id,
      'Rent',
      900,
      '2025-01-31',
      'monthly'
    );

    const completed = await store.completeRecurringTransaction(
      schedule.id,
      925,
      '2025-01-31T12:30:00.000Z'
    );
    assert.deepEqual(
      {
        description: completed.transaction.description,
        amount: completed.transaction.amount,
        date: completed.transaction.date,
        nextDueDate: completed.schedule.nextDueDate,
      },
      {
        description: 'Rent',
        amount: 925,
        date: '2025-01-31T12:30:00.000Z',
        nextDueDate: '2025-02-28',
      }
    );
    assert.ok(completed.transaction.id);

    const persisted = JSON.parse(await fs.readFile(store.filePath, 'utf8'));
    assert.deepEqual(persisted.budgets[0].transactions, [completed.transaction]);
    assert.deepEqual(persisted.recurringTransactions, [completed.schedule]);

    const reloaded = new Store();
    assert.deepEqual(await reloaded.getTransactions(budget.id), [completed.transaction]);
    assert.deepEqual(await reloaded.getRecurringTransactions(), [completed.schedule]);
  });

  it('rejects invalid completion details without persisting a transaction or advancing the schedule', async () => {
    const store = new Store();
    const budget = await store.createBudget('Household', 1000);
    const schedule = await store.createRecurringTransaction(
      budget.id,
      'Rent',
      900,
      '2025-01-31',
      'monthly'
    );

    for (const amount of [NaN, Infinity, -Infinity]) {
      await assert.rejects(
        store.completeRecurringTransaction(schedule.id, amount, '2025-01-31T12:00:00.000Z'),
        { message: 'Transaction amount must be finite' }
      );
    }
    await assert.rejects(
      store.completeRecurringTransaction(schedule.id, 900, 'not-a-date'),
      { message: 'Transaction date is invalid' }
    );
    await assert.rejects(
      store.completeRecurringTransaction('missing-schedule', 900, '2025-01-31T12:00:00.000Z'),
      { message: 'Recurring transaction not found' }
    );
    assert.deepEqual(await store.getTransactions(budget.id), []);
    assert.deepEqual(await store.getRecurringTransactions(), [schedule]);
  });

  it('skips and deletes recurring schedules persistently without recording a transaction', async () => {
    const store = new Store();
    const budget = await store.createBudget('Household', 1000);
    const skippedSchedule = await store.createRecurringTransaction(
      budget.id,
      'Utilities',
      150,
      '2025-12-25',
      'weekly'
    );
    const deletedSchedule = await store.createRecurringTransaction(
      budget.id,
      'Unused',
      1,
      '2025-12-31',
      'monthly'
    );

    const skipped = await store.skipRecurringOccurrence(skippedSchedule.id);
    assert.equal(skipped.nextDueDate, '2026-01-01');
    await assert.rejects(store.skipRecurringOccurrence('missing-schedule'), {
      message: 'Recurring transaction not found',
    });
    await store.deleteRecurringTransaction(deletedSchedule.id);
    await store.deleteRecurringTransaction('missing-schedule');

    const reloaded = new Store();
    assert.deepEqual(await reloaded.getRecurringTransactions(), [skipped]);
    assert.deepEqual(await reloaded.getTransactions(budget.id), []);
  });

  it('defaults the budget alert threshold to 80 and persists configured values', async () => {
    const store = new Store();

    assert.equal(await store.getBudgetAlertThreshold(), 80);
    assert.equal(await store.setBudgetAlertThreshold(65), 65);
    assert.equal(
      JSON.parse(await fs.readFile(store.filePath, 'utf8')).budgetAlertThreshold,
      65
    );
    assert.equal(await new Store().getBudgetAlertThreshold(), 65);
  });

  it('uses the default threshold when loading existing data without an alert setting', async () => {
    const store = new Store();
    const legacyData = {
      budgets: [{ id: 'budget-1', name: 'Groceries', limit: 300, transactions: [] }],
      globalIncome: 1200,
    };
    await fs.writeFile(store.filePath, JSON.stringify(legacyData), 'utf8');

    assert.equal(await store.getBudgetAlertThreshold(), 80);
    assert.deepEqual(store.data, legacyData);
    assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), legacyData);
  });

  it('accepts threshold endpoints and rejects invalid configured or saved values', async () => {
    const store = new Store();

    assert.equal(await store.setBudgetAlertThreshold(1), 1);
    assert.equal(await store.setBudgetAlertThreshold(100), 100);

    for (const threshold of [0, 100.01, NaN, Infinity, -Infinity]) {
      await assert.rejects(store.setBudgetAlertThreshold(threshold), {
        message: 'Budget alert threshold must be between 1 and 100',
      });
      assert.equal(await store.getBudgetAlertThreshold(), 100);
    }

    const persisted = JSON.parse(await fs.readFile(store.filePath, 'utf8'));
    for (const threshold of [0, 100.01, 'not-a-number']) {
      persisted.budgetAlertThreshold = threshold;
      await fs.writeFile(store.filePath, JSON.stringify(persisted), 'utf8');
      await assert.rejects(new Store().getBudgetAlertThreshold(), {
        message: 'Saved budget alert threshold must be between 1 and 100',
      });
    }
  });

  it('recovers from invalid JSON by replacing it with the empty default data', async () => {
    const store = new Store();
    await fs.writeFile(store.filePath, '{not valid json', 'utf8');

    assert.deepEqual(await store.load(), { budgets: [], globalIncome: 0 });
    assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), {
      budgets: [],
      globalIncome: 0,
    });
  });

  it('persists global income and budget create, update, and delete operations', async () => {
    const store = new Store();

    assert.equal(await store.getGlobalIncome(), 0);
    assert.equal(await store.setGlobalIncome(4250.75), 4250.75);

    const first = await store.createBudget('Groceries', 600);
    const second = await store.createBudget('Utilities', 300, 125);
    assert.equal(first.name, 'Groceries');
    assert.equal(first.limit, 600);
    assert.equal(first.income, 0);
    assert.deepEqual(first.transactions, []);
    assert.ok(first.id);
    assert.equal(second.income, 125);

    const updated = await store.updateBudget(first.id, 'Food', 700, 50);
    assert.deepEqual(
      { id: updated.id, name: updated.name, limit: updated.limit, income: updated.income },
      { id: first.id, name: 'Food', limit: 700, income: 50 }
    );

    await store.deleteBudget(second.id);
    assert.deepEqual(await store.getBudgets(), [updated]);

    const reloaded = new Store();
    assert.equal(await reloaded.getGlobalIncome(), 4250.75);
    assert.deepEqual(await reloaded.getBudgets(), [updated]);
  });

  it('rejects negative and non-finite global income without changing the persisted value', async () => {
    const store = new Store();
    await store.setGlobalIncome(4250.75);

    for (const amount of [-0.01, NaN, Infinity, -Infinity]) {
      await assert.rejects(store.setGlobalIncome(amount));
      assert.equal(await store.getGlobalIncome(), 4250.75);
      assert.equal(
        JSON.parse(await fs.readFile(store.filePath, 'utf8')).globalIncome,
        4250.75
      );
    }
  });

  it('rejects whitespace-only budget names without adding a budget', async () => {
    const store = new Store();

    for (const name of ['', '   ']) {
      await assert.rejects(store.createBudget(name, 250), {
        message: 'Budget name is required',
      });
    }
    assert.deepEqual(await store.getBudgets(), []);
  });

  it('trims valid budget names consistently when creating budgets', async () => {
    const store = new Store();
    const budget = await store.createBudget('  Groceries  ', 250);
    assert.equal(budget.name, 'Groceries');
    assert.deepEqual(await store.getBudgets(), [budget]);

    const reloaded = new Store();
    assert.deepEqual(await reloaded.getBudgets(), [budget]);
  });

  it('rejects whitespace-only budget names when updating and trims valid names', async () => {
    const store = new Store();
    const budget = await store.createBudget('Groceries', 250);

    await assert.rejects(store.updateBudget(budget.id, '   ', 300, 0), {
      message: 'Budget name is required',
    });
    assert.equal((await store.getBudgets())[0].name, 'Groceries');

    const updated = await store.updateBudget(budget.id, '  Pantry  ', 300, 0);
    assert.equal(updated.name, 'Pantry');
  });

  it('persists savings percentages at both valid boundaries', async () => {
    const store = new Store();

    assert.equal(await store.setSavingsPercentage(0), 0);
    assert.equal(await store.getSavingsPercentage(), 0);
    assert.equal(await store.setSavingsPercentage(100), 100);

    const reloaded = new Store();
    assert.equal(await reloaded.getSavingsPercentage(), 100);
  });

  it('persists a valid time zone, allows clearing it, and rejects unknown zones', async () => {
    const store = new Store();

    assert.equal(await store.getTimeZone(), '');
    assert.equal(await store.setTimeZone('America/St_Johns'), 'America/St_Johns');
    assert.equal(await new Store().getTimeZone(), 'America/St_Johns');

    await assert.rejects(() => store.setTimeZone('Not/AZone'), /time zone/i);
    await assert.rejects(() => store.setTimeZone(undefined), /time zone/i);
    assert.equal(await new Store().getTimeZone(), 'America/St_Johns');

    assert.equal(await store.setTimeZone(''), '');
    assert.equal(await new Store().getTimeZone(), '');
  });

  it('rejects savings percentages outside the finite 0-to-100 range', async () => {
    const store = new Store();
    await store.setSavingsPercentage(40);

    for (const percentage of [-0.01, 100.01, NaN, Infinity, -Infinity]) {
      await assert.rejects(store.setSavingsPercentage(percentage), {
        message: 'Savings percentage must be between 0 and 100',
      });
      assert.equal(await store.getSavingsPercentage(), 40);
    }
  });

  it('persists savings goal create, update, and delete operations', async () => {
    const store = new Store();

    const first = await store.createSavingsGoal('  Emergency fund  ', 5000);
    const second = await store.createSavingsGoal('Vacation', 1500);
    assert.deepEqual(first, {
      id: first.id,
      name: 'Emergency fund',
      target: 5000,
      saved: 0,
    });
    assert.ok(first.id);
    assert.ok(second.id);

    const updated = await store.updateSavingsGoal(first.id, '  Rainy day fund ', 6000, 1250);
    assert.deepEqual(updated, {
      id: first.id,
      name: 'Rainy day fund',
      target: 6000,
      saved: 1250,
    });

    await store.deleteSavingsGoal(second.id);
    assert.deepEqual(await store.getSavingsGoals(), [updated]);

    const reloaded = new Store();
    assert.deepEqual(await reloaded.getSavingsGoals(), [updated]);
  });

  it('rejects invalid savings goal fields and updates for unknown goal IDs', async () => {
    const store = new Store();
    const goal = await store.createSavingsGoal('Emergency fund', 3000);

    for (const name of ['', '   ']) {
      await assert.rejects(store.createSavingsGoal(name, 100), {
        message: 'Savings goal name is required',
      });
      await assert.rejects(store.updateSavingsGoal(goal.id, name, 100, 0), {
        message: 'Savings goal name is required',
      });
    }

    for (const target of [0, -1, NaN, Infinity, -Infinity]) {
      await assert.rejects(store.createSavingsGoal('Invalid target', target), {
        message: 'Savings goal target must be greater than 0',
      });
      await assert.rejects(store.updateSavingsGoal(goal.id, 'Emergency fund', target, 0), {
        message: 'Savings goal target must be greater than 0',
      });
    }

    for (const saved of [-1, NaN, Infinity, -Infinity]) {
      await assert.rejects(store.updateSavingsGoal(goal.id, 'Emergency fund', 3000, saved), {
        message: 'Savings goal balance cannot be negative',
      });
    }

    await assert.rejects(
      store.updateSavingsGoal('missing-goal', 'Valid name', 100, 0),
      { message: 'Savings goal not found' }
    );
    assert.deepEqual(await store.getSavingsGoals(), [goal]);

    await store.deleteSavingsGoal('missing-goal');
    assert.deepEqual(await store.getSavingsGoals(), [goal]);
  });

  it('adds, updates, retrieves, and deletes timestamped transactions', async () => {
    const store = new Store();
    const budget = await store.createBudget('Transport', 250);

    const addStartedAt = Date.now();
    const transaction = await store.addTransaction(budget.id, 'Bus pass', 40);
    const addCompletedAt = Date.now();
    assert.equal(transaction.description, 'Bus pass');
    assert.equal(transaction.amount, 40);
    assert.ok(transaction.id);
    const defaultDate = Date.parse(transaction.date);
    assert.ok(Number.isFinite(defaultDate));
    assert.ok(defaultDate >= addStartedAt && defaultDate <= addCompletedAt);
    assert.deepEqual(await store.getTransactions(budget.id), [transaction]);

    const updated = await store.updateTransaction(budget.id, transaction.id, 'Monthly pass', 55);
    assert.equal(updated.id, transaction.id);
    assert.equal(updated.description, 'Monthly pass');
    assert.equal(updated.amount, 55);
    assert.equal(updated.date, transaction.date);
    assert.ok(Number.isFinite(Date.parse(updated.date)));
    assert.deepEqual(await store.getTransactions(budget.id), [updated]);

    await store.deleteTransaction(budget.id, transaction.id);
    assert.deepEqual(await store.getTransactions(budget.id), []);
    assert.deepEqual(await store.getTransactions('missing-budget'), []);
  });

  it('accepts a custom transaction date and rejects invalid transaction dates', async () => {
    const store = new Store();
    const budget = await store.createBudget('Health', 300);
    const customDate = '2024-06-12';

    const transaction = await store.addTransaction(budget.id, 'Appointment', 80, customDate);
    assert.equal(transaction.date, '2024-06-12T00:00:00.000Z');
    assert.deepEqual(await store.getTransactions(budget.id), [transaction]);

    for (const invalidDate of ['not-a-date', '2024-13-12']) {
      await assert.rejects(
        store.addTransaction(budget.id, 'Invalid date', 10, invalidDate),
        { message: 'Transaction date is invalid' }
      );
    }
    assert.deepEqual(await store.getTransactions(budget.id), [transaction]);
  });

  it('preserves a historical transaction date when its details are updated', async () => {
    const store = new Store();
    const budget = await store.createBudget('Home', 500);
    const historicalDate = '2021-09-03T16:45:00.000Z';
    const transaction = await store.addTransaction(
      budget.id,
      'Old repair',
      125,
      historicalDate
    );

    const updated = await store.updateTransaction(
      budget.id,
      transaction.id,
      'Revised repair description',
      150
    );

    assert.equal(updated.description, 'Revised repair description');
    assert.equal(updated.amount, 150);
    assert.equal(updated.date, historicalDate);
    assert.deepEqual(await store.getTransactions(budget.id), [updated]);

    const reloaded = new Store();
    assert.deepEqual(await reloaded.getTransactions(budget.id), [updated]);
  });

  it('rejects updates and transaction creation for missing budgets or transactions', async () => {
    const store = new Store();
    const budget = await store.createBudget('Dining', 200);

    await assert.rejects(store.updateBudget('missing-budget', 'New', 1, 0), {
      message: 'Budget not found',
    });
    await assert.rejects(store.addTransaction('missing-budget', 'Meal', 10), {
      message: 'Budget not found',
    });
    await assert.rejects(
      store.updateTransaction(budget.id, 'missing-transaction', 'Meal', 10),
      { message: 'Transaction not found' }
    );
    await assert.rejects(
      store.deleteTransaction('missing-budget', 'missing-transaction'),
      { message: 'Budget not found' }
    );
  });

  it('imports CSV rows by appending to existing categories and persists new categories', async () => {
    const store = new Store();
    const existing = await store.createBudget('Food', 600, 100);
    const existingTransaction = await store.addTransaction(
      existing.id,
      'Existing purchase',
      20,
      '2025-01-01T12:00:00.000Z'
    );
    const imported = await store.importTransactions([
      { category: 'food', description: 'Market, produce', amount: -32.5, date: '2025-02-01T12:00:00.000Z' },
      { category: 'Travel', description: 'Bus fare', amount: 8, date: '2025-02-02T12:00:00.000Z' },
    ]);

    assert.equal(imported, 2);
    const reloaded = new Store();
    const data = await reloaded.getAppData();
    assert.equal(data.budgets.length, 2);
    assert.equal(data.budgets[0].id, existing.id);
    assert.equal(data.budgets[0].limit, 600);
    assert.deepEqual(data.budgets[0].transactions.map(({ id, description, amount }) => ({
      id, description, amount,
    })), [
      { id: existingTransaction.id, description: 'Existing purchase', amount: 20 },
      { id: data.budgets[0].transactions[1].id, description: 'Market, produce', amount: -32.5 },
    ]);
    assert.equal(data.budgets[1].name, 'Travel');
    assert.equal(data.budgets[1].limit, 0);
    assert.equal(data.budgets[1].transactions[0].description, 'Bus fare');
    assert.equal(data.budgets[1].transactions[0].amount, 8);
    assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), data);
  });

  it('restores a versioned backup and persists the complete restored app data', async () => {
    const store = new Store();
    await store.createBudget('Temporary', 25);
    const backupData = {
      budgets: [{
        id: 'restored-budget',
        name: 'Restored',
        limit: 900,
        income: 1200,
        transactions: [{
          id: 'restored-transaction',
          description: 'Restored expense',
          amount: -75,
          date: '2025-03-04T12:00:00.000Z',
        }],
      }],
      globalIncome: 1200,
      savingsPercentage: 10,
      savingsGoals: [{ id: 'restored-goal', name: 'Reserve', target: 500, saved: 100 }],
      timeZone: 'America/St_Johns',
      budgetAlertThreshold: 70,
    };
    const restored = parseAppDataBackup(createAppDataBackup(backupData, '2025-03-05T00:00:00.000Z'));
    await store.replaceAppData(restored);

    assert.deepEqual(await new Store().getAppData(), backupData);
    assert.deepEqual(JSON.parse(await fs.readFile(store.filePath, 'utf8')), backupData);
  });

  it('leaves in-memory and persisted data unchanged when backup restore validation fails', async () => {
    const store = new Store();
    const budget = await store.createBudget('Keep me', 250);
    await store.addTransaction(budget.id, 'Saved expense', 30, '2025-04-01T12:00:00.000Z');
    const persistedBefore = await fs.readFile(store.filePath, 'utf8');
    const memoryBefore = await store.getAppData();
    const invalidBackupData = {
      budgets: [{ id: 'invalid', name: 'Broken', limit: 100, transactions: 'invalid' }],
    };

    await assert.rejects(store.replaceAppData(invalidBackupData));
    assert.deepEqual(await store.getAppData(), memoryBefore);
    assert.equal(await fs.readFile(store.filePath, 'utf8'), persistedBefore);
    assert.deepEqual(await new Store().getAppData(), memoryBefore);
  });
});
