export function formatCurrency(n: number) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}
