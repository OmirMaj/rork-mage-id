// ============================================================================
// utils/recentChips.ts — "don't make him type what the app knows" (UX wave,
// Lane B2 / B6).
//
// The last few distinct values he already typed on this job, most recent
// first, as one-tap chips: punch locations under Location, suppliers under
// "It's here now". Distinct by a case- and space-folded key; the first (most
// recent) spelling wins. Blank values never become a chip. Nothing is
// invented: a chip is always a value from one of his own records on THIS job.
//
// Pure. scripts/validate-ux-lane-b.ts runs it under bun.
// ============================================================================

export const RECENT_CHIP_LIMIT = 5;

const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Distinct values, newest first. `at` is any sortable timestamp string. */
export function recentDistinct(
  rows: readonly { text: string | null | undefined; at: string | null | undefined }[],
  limit: number = RECENT_CHIP_LIMIT,
): string[] {
  const sorted = rows
    .map((r, i) => ({ text: (r.text ?? '').trim(), at: r.at ?? '', i }))
    .filter(r => r.text.length > 0)
    // Newest first; ties keep the list's own order (stable on index).
    .sort((a, b) => (b.at.localeCompare(a.at)) || (a.i - b.i));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of sorted) {
    const k = fold(r.text);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r.text);
    if (out.length >= limit) break;
  }
  return out;
}

/** The last 5 distinct locations on this job's punch items. `locationText`
 *  reads the stored location as display text (punch-list passes its own
 *  punchLocationText so a legacy placeholder never becomes a chip). */
export function recentPunchLocations(
  items: readonly { projectId: string; location?: string | null; createdAt?: string; updatedAt?: string }[],
  projectId: string | null | undefined,
  locationText: (raw: string | null | undefined) => string | null,
  limit: number = RECENT_CHIP_LIMIT,
): string[] {
  if (!projectId) return [];
  return recentDistinct(
    items.filter(i => i.projectId === projectId).map(i => ({ text: locationText(i.location), at: i.createdAt ?? i.updatedAt ?? '' })),
    limit,
  );
}

/** The last 5 distinct suppliers on this job's deliveries and receipts. */
export function recentSuppliers(
  deliveries: readonly { projectId: string; supplier?: string | null; createdAt?: string; updatedAt?: string }[],
  receipts: readonly { projectId: string; supplier?: string | null; receivedAt?: string; createdAt?: string }[],
  projectId: string | null | undefined,
  limit: number = RECENT_CHIP_LIMIT,
): string[] {
  if (!projectId) return [];
  return recentDistinct([
    ...deliveries.filter(d => d.projectId === projectId).map(d => ({ text: d.supplier, at: d.updatedAt ?? d.createdAt ?? '' })),
    ...receipts.filter(r => r.projectId === projectId).map(r => ({ text: r.supplier, at: r.receivedAt ?? r.createdAt ?? '' })),
  ], limit);
}
