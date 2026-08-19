// Render-correctness guard for app/warranties.tsx and app/prequal-manager.tsx.
// Three founder/audit-reported bugs, pinned at SOURCE level because you cannot
// unit-test pixels and neither screen is reachable from a pure function.
//
//   1. WARRANTY DELETE BUTTON PAINTED OVER THE CATEGORY LABEL.
//      `deleteBtn` was `position:'absolute', top:6, right:6, width:44,
//      height:44` inside a card with `padding: 16`, and `cardHeader`'s
//      right-hand child is the uppercase category. The card is ~343pt wide on
//      a 375pt screen, so the button occupied x = [289, 333] while the
//      category's right edge sat at x = 327 — a 38pt overlap on EVERY card,
//      which the audit screenshotted as "PLUMBI[trash]G". hitSlop does not
//      move geometry. Pinned: the delete control is a FLOW child of the header
//      row, so the row reserves the space it occupies and no padding
//      arithmetic has to be maintained by hand.
//
//   2. WARRANTY SUMMARY TILES DID NOT ADD UP.
//      Three tiles counted 'active' / 'expiring_soon' / 'expired' with three
//      independent list.filter() passes. The status union also carries
//      'claimed' and 'void' (and warrantyStatus can derive 'unknown'), so a
//      4-warranty portfolio containing one claim summed to 3 across the tiles
//      — while the screen's own hero copy promised to "Track active, expiring,
//      and claimed warranties". Pinned: every DisplayStatus is either a tile
//      or a line in the overflow summary, and statusMeta has an entry for
//      each, so tiles + overflow always account for every row.
//
//   3. PREQUAL LIST RENDERED A RAW ISO TIMESTAMP.
//      `· Renews ${packet.expiresAt}` printed "· Renews
//      2026-12-14T22:57:36.841Z" for any packet whose expiry had round-tripped
//      through Supabase's `expires_at` timestamptz. Pinned: no date field may
//      reach a render position on that screen without going through
//      formatPacketDate.
//
// Pure node:fs — no bundler, no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let failures = 0;
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log('  PASS  ' + name);
    return;
  }
  failures += 1;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}

/**
 * Strip block comments, JSX comments and line comments so prose that merely
 * *describes* a defect is never mistaken for the defect. Every check below
 * runs on the stripped text.
 *
 * Removed text is replaced by its own newlines, so line numbers in failure
 * messages still point at the real line in the real file.
 */
const blankOut = (m: string) => m.replace(/[^\n]/g, '');
function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, blankOut)
    .replace(/\/\*[\s\S]*?\*\//g, blankOut)
    .replace(/(^|[^:])\/\/.*$/gm, (_m, lead: string) => lead);
}

/** Quoted string literals inside a bracketed/braced source fragment. */
function literals(fragment: string): string[] {
  return [...fragment.matchAll(/['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g)].map(m => m[1]);
}

function setsEqual(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every(x => sb.has(x));
}

console.log('\nwarranty + prequal render validation:');

// ── 1. Warranty delete control is in flow, not overlaid ─────────────────────
const warranties = read('app/warranties.tsx');
const warrantiesCode = stripComments(warranties);

const deleteBtnStyle = /deleteBtn\s*:\s*\{([^}]*)\}/.exec(warrantiesCode)?.[1] ?? '';
ok(
  'warranties: deleteBtn style exists',
  deleteBtnStyle.length > 0,
  'Expected a `deleteBtn: { ... }` entry in makeStyles.',
);
ok(
  'warranties: deleteBtn is NOT absolutely positioned',
  deleteBtnStyle.length > 0 && !/position\s*:/.test(deleteBtnStyle),
  'Found a `position:` in the deleteBtn style: ' + deleteBtnStyle.trim().slice(0, 120) +
    '\n        An absolutely-positioned trash button inside the card is drawn ' +
    'OVER cardHeader, whose right-hand child is the uppercase category label. ' +
    'That is the "PLUMBI[trash]G" bug. Keep it a flow child of the header row ' +
    'so the layout reserves its width. hitSlop does not fix geometry.',
);

const headerIdx = warrantiesCode.indexOf('styles.cardHeader');
const deleteIdx = warrantiesCode.indexOf('styles.deleteBtn');
const titleIdx = warrantiesCode.indexOf('styles.cardTitle');
ok(
  'warranties: the delete control is rendered inside the card header row',
  headerIdx >= 0 && deleteIdx > headerIdx && titleIdx > deleteIdx,
  'Expected render order styles.cardHeader → styles.deleteBtn → styles.cardTitle. ' +
    'The delete control must sit in the header row alongside the category, not ' +
    'be appended to the card and positioned back over it.',
);

// ── 2. Warranty summary buckets are exhaustive ──────────────────────────────
const displayStatuses = literals(/const DISPLAY_STATUSES\s*=\s*\[([^\]]*)\]/.exec(warrantiesCode)?.[1] ?? '');
const tileStatuses = literals(/const TILE_STATUSES\s*=\s*\[([^\]]*)\]/.exec(warrantiesCode)?.[1] ?? '');
const overflowStatuses = [
  ...(/const OVERFLOW_LABEL[^=]*=\s*\{([\s\S]*?)\n\};/.exec(warrantiesCode)?.[1] ?? '')
    .matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm),
].map(m => m[1]);
const metaStatuses = [
  ...(/const statusMeta[\s\S]*?=>\s*\(\{([\s\S]*?)\n\}\);/.exec(warrantiesCode)?.[1] ?? '')
    .matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm),
].map(m => m[1]);

ok(
  'warranties: DISPLAY_STATUSES / TILE_STATUSES / OVERFLOW_LABEL all parsed',
  displayStatuses.length > 0 && tileStatuses.length > 0 && overflowStatuses.length > 0,
  `Parsed display=[${displayStatuses}] tile=[${tileStatuses}] overflow=[${overflowStatuses}]. ` +
    'This check reads the three declarations by name — if they were renamed, ' +
    'rename them here too rather than deleting the check.',
);

ok(
  'warranties: every display status is either a tile or in the overflow line',
  setsEqual(displayStatuses, [...tileStatuses, ...overflowStatuses]),
  `tiles+overflow = [${[...tileStatuses, ...overflowStatuses].sort()}] but the ` +
    `union is [${[...displayStatuses].sort()}]. A status in neither bucket is ` +
    'counted NOWHERE: that is how a 4-warranty portfolio with one claim ' +
    'reported 3 across the summary tiles.',
);

ok(
  'warranties: tile and overflow buckets do not overlap',
  tileStatuses.every(s => !overflowStatuses.includes(s)),
  `Overlapping: [${tileStatuses.filter(s => overflowStatuses.includes(s))}]. ` +
    'A status in both buckets is DOUBLE counted; the summary would exceed the ' +
    'number of warranties on screen.',
);

ok(
  'warranties: statusMeta has a chip for every display status',
  setsEqual(displayStatuses, metaStatuses),
  `statusMeta covers [${[...metaStatuses].sort()}] but display statuses are ` +
    `[${[...displayStatuses].sort()}]. A missing key makes statusMeta(...)[s] ` +
    'undefined and `meta.Icon` throws while rendering the card — this is ' +
    "reachable: ProjectContext maps a null end_date to endDate: '', " +
    "Date.parse('') is NaN, and warrantyStatus returns 'unknown' for that.",
);

ok(
  'warranties: summary counts come from an exhaustive tally, not per-status filters',
  !/list\.filter\(\s*w\s*=>\s*w\.(status|displayStatus)\s*===/.test(warrantiesCode),
  'Found a `list.filter(w => w.status === ...)` count. Independent filter ' +
    'passes are how statuses go missing from the summary. Tally once over ' +
    'DISPLAY_STATUSES so sum(counts) === list.length by construction.',
);

// ── 3. Prequal dates never render raw ───────────────────────────────────────
const prequal = read('app/prequal-manager.tsx');
const prequalLines = stripComments(prequal).split('\n');

const DATE_FIELD_RE = /\b(expiresAt|coiExpiry|inviteSentAt|submittedAt|reviewedAt)\b/;
// A line that WRITES the field (`expiresAt: ...`) or hands it to a non-render
// consumer is fine — those never reach a <Text>.
const DATA_SINK_RE = /\b(expiresAt|coiExpiry|inviteSentAt|submittedAt|reviewedAt)\s*:|renewalBucket\(|dueAt=/;

const rawDateHits: string[] = [];
prequalLines.forEach((text, i) => {
  if (!DATE_FIELD_RE.test(text)) return;
  if (text.includes('formatPacketDate')) return;
  if (DATA_SINK_RE.test(text)) return;
  rawDateHits.push('app/prequal-manager.tsx:' + (i + 1) + '  ' + text.trim().slice(0, 100));
});

ok(
  'prequal-manager: defines formatPacketDate',
  /function formatPacketDate\(/.test(prequal),
  'The screen needs one date formatter that handles BOTH shapes these fields ' +
    "arrive in: date-only 'YYYY-MM-DD' (computePrequalExpiry slices to 10 " +
    'chars) and a full ISO timestamp (Supabase expires_at timestamptz).',
);

ok(
  'prequal-manager: no date field reaches a render position unformatted',
  rawDateHits.length === 0,
  rawDateHits.join('\n        ') +
    '\n        Interpolating the stored string renders ' +
    '"· Renews 2026-12-14T22:57:36.841Z". Route it through formatPacketDate.',
);

ok(
  'prequal-manager: formatPacketDate pins date-only strings to UTC',
  /timeZone:\s*'UTC'/.test(prequal),
  "new Date('2026-12-14') is parsed as UTC midnight, so formatting it in any " +
    'negative-offset zone (every US jobsite) prints the PREVIOUS day. Date-only ' +
    "input must be formatted with timeZone: 'UTC'.",
);

console.log('');
process.exit(failures === 0 ? 0 : 1);
