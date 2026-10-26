const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { getBudgetRemaining } = require('../dist/budget');
const { calculateSavingsReserve } = require('../dist/savings');

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

    const transaction = await store.addTransaction(budget.id, 'Bus pass', 40);
    assert.equal(transaction.description, 'Bus pass');
    assert.equal(transaction.amount, 40);
    assert.ok(transaction.id);
    assert.ok(Number.isFinite(Date.parse(transaction.date)));
    assert.deepEqual(await store.getTransactions(budget.id), [transaction]);

    const updated = await store.updateTransaction(budget.id, transaction.id, 'Monthly pass', 55);
    assert.equal(updated.id, transaction.id);
    assert.equal(updated.description, 'Monthly pass');
    assert.equal(updated.amount, 55);
    assert.ok(Number.isFinite(Date.parse(updated.date)));
    assert.deepEqual(await store.getTransactions(budget.id), [updated]);

    await store.deleteTransaction(budget.id, transaction.id);
    assert.deepEqual(await store.getTransactions(budget.id), []);
    assert.deepEqual(await store.getTransactions('missing-budget'), []);
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
