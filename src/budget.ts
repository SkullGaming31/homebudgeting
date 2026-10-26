export function getBudgetRemaining(
  limit: number,
  transactions: readonly { amount: number }[] = []
) {
  const spent = transactions.reduce((total, transaction) => total + transaction.amount, 0);
  return limit - spent;
}
