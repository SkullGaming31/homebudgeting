const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { afterEach, beforeEach, describe, it } = require('node:test');
const {
  getBudgetRemaining,
  getMonthInputValue,
  getMonthKey,
  getTransactionsForMonth,
} = require('../dist/budget');
const { calculateSavingsReserve } = require('../dist/savings');
const { getSpendingSummary } = require('../dist/spending');
const { filterTransactions } = require('../dist/transactions');

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

  it('rejects an invalid selected month', () => {
    assert.throws(() => getSpendingSummary([], '2025-13'), RangeError);
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
});
