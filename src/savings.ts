export function calculateSavingsReserve(remainingGlobal: number, percentage: number) {
  const balanceAvailableForSavings = Math.max(0, remainingGlobal);
  return balanceAvailableForSavings * (percentage / 100);
}
