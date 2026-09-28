// utils/growthLink.ts — the one tracked "Built with MAGE ID" link (T6).
//
// Every page an outsider sees (a client, a sub, an architect, someone paying an
// invoice) carries one small link back to the landing page. The link says which
// KIND of page it came from and nothing else, so the landing can count visits
// and sign-ups per surface.
//
// PRIVACY RULE. A growth link never carries a token, a client name, a project
// name, an email, a dollar amount or any id. It carries one allow-listed surface
// name and three fixed utm values. There is deliberately no contractor slug in
// v1: a slug can identify a sole proprietor, and the landing needs no more than
// the surface to count where sign-ups come from.
//
// Pure: no React Native import, so scripts/validate-growth-link.ts runs it under
// bun. The allow-list is copied into marketing/growth.js (plain ES5 on the static
// site); the validator fails when the two lists differ.

export const GROWTH_SURFACES = [
  'portal',
  'shared_estimate',
  'shared_photos',
  'pay_link',
  'lien_waiver',
  'bid_invite',
  'sub_portal',
  'prequal',
  'builders',
  'email',
] as const;

export type GrowthSurface = (typeof GROWTH_SURFACES)[number];

export const GROWTH_LINK_TEXT = 'Built with MAGE ID';

export const GROWTH_LANDING = 'https://mageid.app/';

/**
 * The landing URL for one surface. The parameter order is fixed (the validator
 * pins the exact string), and the surface is a closed union, so nothing a user
 * typed can reach this URL.
 */
export function growthLink(surface: GrowthSurface): string {
  return `${GROWTH_LANDING}?ref=${surface}&utm_source=mageid&utm_medium=outsider_page&utm_campaign=built_with`;
}

export function isGrowthSurface(value: unknown): value is GrowthSurface {
  return typeof value === 'string' && (GROWTH_SURFACES as readonly string[]).includes(value);
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

/**
 * The `ref` a visitor arrived with, if it is one of ours. Anything else is null:
 * an unknown word, a token-shaped string, an email, a second value. Only an exact
 * allow-listed surface name survives, so what is stored and sent to analytics can
 * never be something a stranger typed into the address bar.
 */
export function parseGrowthRef(params: Params): GrowthSurface | null {
  let raw: unknown;
  if (params instanceof URLSearchParams) {
    raw = params.get('ref');
  } else {
    const v = params.ref;
    raw = Array.isArray(v) ? v[0] : v;
  }
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return isGrowthSurface(value) ? value : null;
}
