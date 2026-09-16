// utils/estimateItemsToScope.ts — turn the estimate line items a bid package
// already carries into the scope paragraph the sub is asked to price.
//
// WHY THIS EXISTS (screen audit 2026-09-16, subs-network). `BidPackage.scopeDescription`
// was plumbed all the way to the invite email (supabase/functions/notify/index.ts
// renders `${scope ? '<p><strong>Scope:</strong>…' : ''}`) and to the sub-facing
// page (bid_invite_get returns `scope_description`) — and had no writer for any
// package the GC made by hand. `handleCreatePackage` passed name, phase, CSI,
// linked items and budget, and never the scope. So the email went out headed
// "You're invited to bid on Plumbing rough-in" with a CSI number and a button,
// and the sub either did not bid, or phoned — which is the fallback the whole
// invite flow exists to replace.
//
// The package already knows the answer: the create sheet makes the GC tick the
// estimate line items the package covers, and each one carries name, quantity,
// unit and an allowance flag. This formats those, and nothing else.
//
// WHAT IS DELIBERATELY LEFT OUT: unitPrice, lineTotal, markup, bulkPrice and
// supplier. The invite path withholds `estimate_budget` on purpose — the GC's
// own number in front of the people bidding against it anchors every bid just
// under it, which is why `bid_invite_get` refuses to return it server-side. The
// same reasoning applies line by line: "420 LF of 3/4" PEX" is the scope, and
// "$3.10/LF" is the GC's carry.
//
// Allowances ARE flagged, because awarding converts an allowance line to firm
// price (contexts/ProjectContext.tsx stamps `firmPricedAt` and clears
// `isAllowance` on award) and the sub is entitled to know which lines he is
// being asked to firm up before he prices them.
//
// Pure: no React, no clock, no I/O — scripts/validate-bid-invite.ts executes it.
// The bullet shape is the one utils/contractEngine.ts:192-205 already prints in
// a contract's SCOPE OF WORK block, so a sub reading the invite and then the
// subcontract reads the same list twice rather than two different documents.

/** The shape this needs off a `LinkedEstimateItem` — structural on purpose, so
 *  the formatter can be exercised without building a whole estimate. */
export interface ScopeSourceItem {
  name: string;
  quantity?: number;
  unit?: string;
  isAllowance?: boolean;
}

/** Suffix on an allowance line. Spelled out rather than abbreviated: "ALLOW"
 *  means nothing to a sub reading an email on a phone. */
const ALLOWANCE_NOTE = ' (allowance — awarding this package firms this price)';

/**
 * One line per item: `• 3/4" PEX supply — 420 LF`.
 *
 * Quantity and unit are printed only when BOTH are usable. A bare `• Fixture
 * rough-in — 11` invites the sub to guess the unit, and `— 0 EA` (the value a
 * half-filled estimate row carries) reads as "none of this work", which is a
 * wrong fact rather than a missing one.
 */
function scopeLine(item: ScopeSourceItem): string {
  const name = (item.name ?? '').trim();
  if (!name) return '';
  const qty = typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0
    ? item.quantity
    : null;
  const unit = (item.unit ?? '').trim();
  const measured = qty !== null && unit ? `${name} — ${qty} ${unit}` : name;
  return `• ${measured}${item.isAllowance ? ALLOWANCE_NOTE : ''}`;
}

/**
 * The seed text written into `BidPackage.scopeDescription` at creation time.
 *
 * Persisted at creation rather than generated at send time on purpose: the
 * sub-facing page reads `bid_packages.scope_description` server-side through
 * `bid_invite_get`, so a value that only exists inside the send call would
 * reach the email and never reach the page. Persisting it also makes it the
 * GC's to edit — this is a seed, not a lock.
 *
 * Returns '' when there is nothing honest to say (no items, or every item
 * nameless). An empty string is what the invite screen gates on, and an
 * invented "Per attached scope" with no attachment is the string the A401
 * generator already falls back to — one dead end is enough.
 */
export function estimateItemsToScope(items: readonly ScopeSourceItem[]): string {
  const lines = (items ?? []).map(scopeLine).filter(Boolean);
  if (lines.length === 0) return '';
  const allowances = (items ?? []).filter(i => i.isAllowance).length;
  const out = [
    'Scope of work — price the following:',
    '',
    ...lines,
  ];
  if (allowances > 0) {
    out.push(
      '',
      `${allowances} line${allowances === 1 ? ' is an allowance' : 's are allowances'} — carried as a placeholder in the estimate. Awarding this package converts ${allowances === 1 ? 'it' : 'them'} to a firm price, so price ${allowances === 1 ? 'it' : 'them'} as work you are committing to.`,
    );
  }
  out.push(
    '',
    'Quantities are the contractor\'s take-off and are given so you can price the same work as everyone else bidding. Verify against the drawings; say in your exclusions anything you are not carrying.',
  );
  return out.join('\n');
}

/**
 * Is there anything the generator could write for this package?
 *
 * The invite screen uses this to tell the two empty-scope cases apart: a
 * package with linked estimate items whose scope can be filled in one tap, and
 * a package created with no items linked (the AI takeoff writes
 * `scopeDescription` but sets `linkedEstimateItemIds: []`, so the two writers
 * are mutually exclusive), where the GC has to type it.
 */
export function canGenerateScope(items: readonly ScopeSourceItem[]): boolean {
  return estimateItemsToScope(items).length > 0;
}
