// __tests__/helpers/sanctionedStrip.ts
//
// Step-3 wave (2026-09-26): new cards and buttons whose ROOT testID carries one of these prefixes are removed before a golden is fingerprinted, so each golden still proves that nothing ELSE on the screen moved (the same idea as the SANCTIONED copy map in w6d-z2-phone). Each lane's own smoke test asserts that the new node renders. Never widen a prefix to cover an existing element.
// Wave 4 (2026-09-26): takeoffws- (desktop takeoff), codelook- (Photo code check), pricewatch-/lienclock- (W1), backcharge-/ownerdelay- (W2).
// List-2 round (2026-09-26): plansweep- (Plan Set Code Sweep), njrecord- (NJ building record), lineup- (Tomorrow's lineup), insaudit- (Insurance audit pack).
// Ideas-1 (2026-09-28): validuntil- (the "Valid until" row on the smart proposal and the quick quote; ships with TRUST-1/3).
// Ideas-1 (2026-09-28): joblevel- (The Level as a project-health reading on Home cards and the portfolio table; ships with LEVEL-1/2).
// Content rights (2026-10-03): weather-credit (the "Weather data provided by OpenWeather" line, plus the OpenStreetMap credit, under a live forecast; the root testID is exactly 'weather-credit', new in that wave; __tests__/smoke/content-rights-surfaces.test.tsx asserts it renders on live forecasts and never on simulated ones).

export const SANCTIONED_TESTID_PREFIXES = ['scopegaps-', 'rfiscope-', 'payearned-', 'codethread-', 'takeoffws-', 'codelook-', 'pricewatch-', 'lienclock-', 'backcharge-', 'ownerdelay-', 'plansweep-', 'njrecord-', 'lineup-', 'insaudit-', 'validuntil-', 'joblevel-', 'weather-credit'] as const;

/** A react-test-renderer JSON node whose props.testID starts with a sanctioned prefix. */
export function isSanctionedNode(n: unknown): boolean {
  if (!n || typeof n !== 'object') return false;
  const props = (n as { props?: unknown }).props;
  if (!props || typeof props !== 'object') return false;
  const id = (props as { testID?: unknown }).testID;
  return typeof id === 'string' && SANCTIONED_TESTID_PREFIXES.some((p) => id.startsWith(p));
}

function containsSanctioned(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => isSanctionedNode(x) || containsSanctioned(x));
  if (!v || typeof v !== 'object') return false;
  const children = (v as { children?: unknown }).children;
  return Array.isArray(children) && containsSanctioned(children);
}

/** A copy of a renderer node that keeps its non-enumerable `$$typeof`
 *  (Symbol.for('react.test.json')). A plain spread drops it, and the snapshot
 *  serializer then prints the node as a plain object instead of as JSX. */
function cloneNode(node: object): Record<string, unknown> {
  return Object.defineProperties({}, Object.getOwnPropertyDescriptors(node)) as Record<string, unknown>;
}

function stripChildren(children: unknown[]): unknown[] | null {
  const kept = children.filter((x) => !isSanctionedNode(x)).map(strip);
  // The renderer writes `children: null` for an element with none left.
  return kept.length ? kept : null;
}

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter((x) => !isSanctionedNode(x)).map(strip);
  if (!v || typeof v !== 'object') return v;
  const node = v as { children?: unknown };
  if (!Array.isArray(node.children) || !containsSanctioned(node.children)) return v;
  const copy = cloneNode(node);
  copy.children = stripChildren(node.children);
  return copy;
}

// LANDSCAPE-0 (2026-10-05): every navigator now pins `orientation: 'portrait_up'`
// in its screenOptions (the iPhone's Info.plist allows landscape from the next
// build; scripts/validate-landscape-lock.ts owns which screens may turn), and
// native-stack hands it to the screen as the `screenOrientation` prop. That one
// prop, with that one value, on that one host type, is put back to the
// `undefined` it was before a golden is fingerprinted, so each golden still proves nothing ELSE moved. A screen
// that is OPENED carries another value ('all') and is deliberately not
// stripped: opening a screen moves its golden.
export const SANCTIONED_SCREEN_LOCK = { type: 'RNSScreen', prop: 'screenOrientation', value: 'portrait_up' } as const;

function hasScreenLock(n: unknown): boolean {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return false;
  const node = n as { type?: unknown; props?: Record<string, unknown> | null };
  return node.type === SANCTIONED_SCREEN_LOCK.type && !!node.props
    && node.props[SANCTIONED_SCREEN_LOCK.prop] === SANCTIONED_SCREEN_LOCK.value;
}

function containsScreenLock(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(containsScreenLock);
  if (!v || typeof v !== 'object') return false;
  return hasScreenLock(v) || containsScreenLock((v as { children?: unknown }).children);
}

/** A copy with the portrait lock prop back at undefined; the same reference when there is none
 *  anywhere below, so an untouched tree hashes exactly what it hashed before. */
function stripScreenLock<T>(v: T): T {
  if (!containsScreenLock(v)) return v;
  if (Array.isArray(v)) return v.map((x) => stripScreenLock(x)) as T;
  const copy = cloneNode(v as object);
  if (hasScreenLock(v)) {
    // `undefined`, in place: native-stack always passed the key (with no
    // value) before the lock existed, and a golden that prints props prints it.
    copy.props = { ...(copy.props as Record<string, unknown>), [SANCTIONED_SCREEN_LOCK.prop]: undefined };
  }
  if (Array.isArray(copy.children)) copy.children = copy.children.map((x) => stripScreenLock(x));
  return copy as T;
}

/**
 * Removes every sanctioned node (and its subtree) from any children array and
 * from a root array, copying only the nodes on the path to a removal, so the
 * result is exactly what the renderer would have produced without those
 * nodes: an emptied children array becomes null, a root array left with one
 * node becomes that node, and with none, null. Returns the input unchanged
 * (same reference) when nothing matches, so a golden on an untouched screen
 * hashes exactly what it hashed before. The input is never mutated.
 */
export function stripSanctioned<T>(json: T): T {
  json = stripScreenLock(json);
  if (isSanctionedNode(json)) return null as T;
  if (!containsSanctioned(json)) return json;
  if (Array.isArray(json)) {
    const kept = json.filter((x) => !isSanctionedNode(x)).map(strip);
    return (kept.length === 0 ? null : kept.length === 1 ? kept[0] : kept) as T;
  }
  return strip(json) as T;
}
