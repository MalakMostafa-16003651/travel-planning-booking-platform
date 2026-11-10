/** Split a receipt exactly into cents without float drift or leaking fractional cents. */
export function allocateMinor(amount: number, providers: { id: string; weight: number }[]): Map<string, number> {
  if (!Number.isSafeInteger(amount) || amount < 0 || !providers.length) throw new Error('Invalid analytics amount');
  const weights = new Map<string, bigint>();
  for (const { id, weight } of providers) {
    if (!Number.isSafeInteger(weight) || weight < 0) throw new Error('Invalid analytics fare');
    weights.set(id, (weights.get(id) ?? 0n) + BigInt(weight));
  }
  const ids = [...weights.keys()].sort();
  let total = [...weights.values()].reduce((sum, value) => sum + value, 0n);
  if (!total) { ids.forEach(id => weights.set(id, 1n)); total = BigInt(ids.length); }
  const shares = ids.map(id => {
    const numerator = BigInt(amount) * weights.get(id)!;
    return { id, cents: numerator / total, remainder: numerator % total };
  });
  let remaining = BigInt(amount) - shares.reduce((sum, row) => sum + row.cents, 0n);
  // Largest remainders first; ties use the stable provider ID order.
  shares.sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  for (const share of shares) if (remaining > 0n) { share.cents++; remaining--; }
  return new Map(shares.map(share => [share.id, Number(share.cents)]));
}
