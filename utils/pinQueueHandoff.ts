// utils/pinQueueHandoff.ts — "Add N and pin them" hands the Photo walk's new
// items to Pin items without putting up to 200 ids in a URL.
//
// Memory only, on purpose: no AsyncStorage key (nothing to leak across a
// tenant switch) and nothing to clean up. A web reload loses the batch, and
// app/punch-pin.tsx then falls back to every unpinned item on the list and
// says so on screen. The ids are not sensitive, and /punch-pin intersects
// them with the signed-in account's own items, so nothing crosses accounts.
// PURE — executed by scripts/validate-punch-pin-items.ts.

const MAX_BATCHES = 5;
const MAX_IDS = 200;
const TOKEN_RE = /^[a-z0-9]{4,16}$/;

const batches = new Map<string, string[]>();
let counter = 0;

/** Keep `ids` for Pin items; returns the token to put in the URL. */
export function stashPinQueueIds(ids: readonly string[]): string {
  counter = (counter + 1) % 1296;
  const token = `${Date.now().toString(36)}${counter.toString(36)}`.slice(-16);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= MAX_IDS) break;
  }
  batches.delete(token);
  batches.set(token, unique);
  while (batches.size > MAX_BATCHES) {
    const oldest = batches.keys().next().value;
    if (oldest === undefined) break;
    batches.delete(oldest);
  }
  return token;
}

/** The ids behind a token, or null when it is unknown. Never consumes it: back/forward and re-renders keep working. */
export function peekPinQueueIds(token: string | string[] | undefined): string[] | null {
  const t = Array.isArray(token) ? token[0] : token;
  if (typeof t !== 'string' || !TOKEN_RE.test(t)) return null;
  const ids = batches.get(t);
  return ids ? [...ids] : null;
}
