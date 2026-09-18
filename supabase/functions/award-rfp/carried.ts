// carried.ts — what an award actually carries onto the contractor's project,
// in the words the homeowner reads.
//
// PURE: no Deno, no Supabase, no React. app/rfp-responses-review.tsx imports
// it for both award alerts; scripts/validate-rfp-marketplace-honesty.ts
// executes it. It mirrors the conditions in award_rfp
// (20260918120000_award_rfp_carries_homeowner_data.sql) so the alert names
// only what the RPC wrote — never "your address, photos, any drawings" for a
// post that had no street address or no photos (audit round 2, #7/#19
// follow-up: a claim shown as fact must be checked).

export interface AwardSourceLike {
  address_line?: string | null;
  photo_urls?: unknown;
  drawing_urls?: unknown;
}

function nonBlankCount(v: unknown): number {
  if (!Array.isArray(v)) return 0;
  return v.filter(x => typeof x === 'string' && x.trim() !== '').length;
}

/**
 * The list of things on the contractor's new project, joined for a sentence
 * ("your street address, 5 photos, 3 drawings and the $48,500.00 price").
 * `priceText` is the formatted accepted price, or null when the bid had none
 * (award_rfp sets no budget for a missing / zero bid rather than $0).
 */
export function awardCarriedItems(src: AwardSourceLike, priceText: string | null): string[] {
  const items: string[] = [];
  // award_rfp: location = NULLIF(btrim(address_line), '') else "city, state".
  items.push(typeof src.address_line === 'string' && src.address_line.trim() !== ''
    ? 'your street address' : 'your city (you gave no street address)');
  const photos = nonBlankCount(src.photo_urls);
  if (photos > 0) items.push(`${photos} photo${photos === 1 ? '' : 's'}`);
  const drawings = nonBlankCount(src.drawing_urls);
  if (drawings > 0) items.push(`${drawings} drawing${drawings === 1 ? '' : 's'}`);
  if (priceText) items.push(`the ${priceText} price`);
  return items;
}

export function joinItems(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
