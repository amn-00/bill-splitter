// The share of the member at `index` (0 = first member added).
// Everyone gets the rounded-down share. The leftover cents (always fewer than
// the number of members) go one each to the first members, so the shares
// always add up to the total. Example: 1000 between 3 gives 334, 333, 333.
export function shareAmount(totalCents: number, memberCount: number, index: number): number {
  const base = Math.floor(totalCents / memberCount)
  const leftover = totalCents % memberCount
  return index < leftover ? base + 1 : base
}
