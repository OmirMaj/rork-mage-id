// scripts/validate-chase-log.ts — the chase log on /waiting-on must survive the
// screen, must be keyed so two kinds cannot overwrite each other, and must not
// claim more than it witnessed.
//
// WHY THIS EXISTS. /waiting-on is the System of Action: the one screen whose
// entire job is that MAGE chases the architect instead of the PM. It tracked
// what he had sent in a component-state Set:
//
//     const [sent, setSent] = useState<Set<string>>(new Set())
//
// so every "Follow-up sent" chip evaporated the moment he navigated away, and
// Tuesday's list was indistinguishable from Monday's. Three separate failures
// sat in that one line:
//
//   1. LOST RECORD. Nothing was written anywhere — not to the RFI, not to the
//      submittal, not to disk. He chases the architect twice and looks
//      disorganised to the design team, or he is unsure and a second week goes
//      by; and when the job goes sideways, "I chased RFI #12 four times over
//      three weeks" is a memory, not a document. That is the difference between
//      a delay claim he wins and one he eats.
//   2. COLLIDING KEY. The Set was keyed on the bare ChaseItem.id, and those ids
//      are inconsistent by kind — rfi / submittal / co_approval carry the raw
//      record id while delivery and quiet_trade namespace themselves
//      ('delivery:<id>', 'quiet:<projectId>:<trade>', utils/systemOfAction.ts).
//      An RFI and a submittal sharing a row id across two tables marked each
//      other sent.
//   3. OVERSTATED CLAIM. "Follow-up sent" is more than the app knows. The text
//      goes to the OS share sheet or to the clipboard and the app loses sight
//      of it there — it cannot know the mail was sent, delivered or read. A
//      delay claim built on an overstated record is worse than no record.
//
// Plus the tenant boundary, which is what makes a NEW persisted key dangerous
// in the first place: the sweep in contexts/AuthContext.tsx works by PREFIX
// (utils/localCacheKeys.ts), and on web AsyncStorage IS the origin's
// localStorage — so a chase log under an unrecognised prefix would hand the
// next contractor to sign in on a site-office iPad this one's chase history,
// drafted messages and the names of the people in them. That half is asserted
// by RESOLVED BEHAVIOUR (the real selectTenantKeysToWipe over the real key
// literal), not by text.
//
// Pure node:fs + a direct import of the pure decision module. No react-native
// import — those crash bun — so the screen itself is asserted by source scan,
// which is how this repo pins screen behaviour it cannot import.
//
// Run: bun run test:chase-log

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isAppStorageKey, selectTenantKeysToWipe } from '../utils/localCacheKeys';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const SCREEN = 'app/waiting-on.tsx';
const src = read(SCREEN);
const types = read('types/index.ts');

console.log('\nchase log (/waiting-on remembers what it chased):');

// ── 0. the guard is looking at the right file ────────────────────────────────
// A guard that silently reads an empty string passes everything. Anchor on
// something that must be true of this screen whatever else changes.
ok('the screen still builds its list from the chase engine',
  /buildChaseList/.test(src) && src.length > 4000,
  `${SCREEN} does not look like the waiting-on screen (${src.length} bytes)`);

// ── 1. the chase is PERSISTED, not held in component state ───────────────────
const keyMatch = /const\s+FOLLOW_UP_HOLDS_KEY\s*=\s*'([^']+)'/.exec(src);
const holdsKey = keyMatch?.[1] ?? '';
ok('the screen declares a storage key for the chase log',
  !!holdsKey,
  `${SCREEN} has no FOLLOW_UP_HOLDS_KEY. Without a persisted key the chase log is component state ` +
  `again, and every chase is lost on navigate-away.`);

ok('it READS the log back on mount',
  new RegExp(`AsyncStorage\\.getItem\\(\\s*FOLLOW_UP_HOLDS_KEY`).test(src),
  'the log is written but never read — the screen still forgets on every mount');

ok('it WRITES the log when it changes',
  new RegExp(`AsyncStorage\\.setItem\\(\\s*FOLLOW_UP_HOLDS_KEY`).test(src),
  'the log is read but never written — nothing is ever recorded');

// The exact shape of the original bug. Named so a reviewer reading a red run
// knows what regressed rather than only that something did.
ok('the chases are not tracked in a component-state Set',
  !/useState<Set<string>>/.test(src),
  `${SCREEN} is back to \`useState<Set<string>>\` for what it has sent. That state dies with the ` +
  `screen: navigate away and every chase is forgotten, which is the whole defect this guard pins.`);

// ── 2. the key cannot leak across tenants ────────────────────────────────────
// Resolved behaviour, not text: the real sweep decision is asked about the real
// key literal the screen writes.
ok('the chase-log key is recognised as app-owned',
  isAppStorageKey(holdsKey),
  `'${holdsKey}' matches no prefix in APP_STORAGE_PREFIXES (utils/localCacheKeys.ts), so ` +
  `wipeLocalUserCache never sees it. On web it would survive sign-out inside the shared origin store.`);

ok('the chase log is wiped on a tenant switch',
  selectTenantKeysToWipe([holdsKey]).length === 1,
  `'${holdsKey}' survives selectTenantKeysToWipe. A chase log carries drafted messages and the names ` +
  `of the people in them; the next contractor to sign in on a shared iPad must not inherit it.`);

ok('…and on a same-user re-auth too (it is a cache, not a pending write)',
  selectTenantKeysToWipe([holdsKey], { dropOfflineQueue: false }).length === 1,
  `'${holdsKey}' was added to the offline-write-queue exemption. The chase log is not an un-sent write.`);

// ── 3. the hold id is namespaced by kind ─────────────────────────────────────
ok('the hold id is derived through one helper',
  /function\s+chaseHoldId\s*\(/.test(src),
  'chaseHoldId is gone — every call site now spells the key itself, and they will diverge');

ok('the hold id is prefixed with the chase KIND',
  /function\s+chaseHoldId[\s\S]{0,400}?return\s+`\$\{item\.kind\}:\$\{item\.id\}`/.test(src),
  'chaseHoldId no longer returns `${item.kind}:${item.id}`. ChaseItem.id is the BARE record id for ' +
  'rfi / submittal / co_approval (utils/systemOfAction.ts), so without the kind prefix an RFI and a ' +
  'submittal that share a row id across two tables mark each other chased.');

ok('no lookup bypasses the helper with a bare record id',
  !/holds\[\s*(?:item|i)\.id\s*\]/.test(src),
  'a `holds[item.id]` lookup reintroduces the cross-kind collision the kind prefix exists to prevent');

// ── 4. the log is shown, and shapes the order ────────────────────────────────
ok('the row reports how many times it has been chased',
  /function\s+chaseLabel\s*\(/.test(src) && /Chased \$\{count\}×/.test(src),
  'chaseLabel is gone — the row is back to an undifferentiated red bar that says nothing about Monday');

ok('the "last chased" date is read through utils/calendarDate',
  /calendarDayOf\(\s*hold\?\.lastFollowUpAt\s*\)/.test(src),
  'the stored value is a full ISO instant; `new Date(...)` on it reads UTC midnight and ages every ' +
  'evening chase by a day west of Greenwich (see utils/calendarDate.ts)');

ok('un-chased items sort above already-chased ones',
  /lastFollowUpAt/.test(src) && /\[\.\.\.items\]\.sort/.test(src),
  'the list no longer re-ranks on the chase log, so a row he nudged this morning sits at the top ' +
  'beside one nobody has touched');

// ── 5. honesty — it says CHASED, never DELIVERED ─────────────────────────────
ok('the screen no longer claims the follow-up was sent',
  !/'Follow-up sent'/.test(src),
  `${SCREEN} says "Follow-up sent". All the app witnessed is the tap — the message went to the OS ` +
  `share sheet or the clipboard and it lost sight of it there.`);

ok('the screen states where the chase count comes from',
  /Counted when you tap Send/.test(src) && /not that anyone read it/.test(src),
  'the grounding chip is gone. A count the reader believes means "delivered" is the honesty rule ' +
  'broken in the one place it matters most — a delay claim.');

// ── 6. the held face carries the log in the type system ──────────────────────
ok('FollowUpChase exists',
  /export interface FollowUpChase\b/.test(types),
  'types/index.ts lost FollowUpChase — the chase log has no typed shape');

ok('FollowUpChase records WHEN and HOW, and keeps the words',
  /export interface FollowUpChase[\s\S]{0,900}?\bat:\s*string/.test(types)
  && /export interface FollowUpChase[\s\S]{0,900}?\bvia:\s*'share'\s*\|\s*'clipboard'/.test(types)
  && /export interface FollowUpChase[\s\S]{0,900}?\bmessage\?:\s*string/.test(types),
  'a chase without its message is a tally, not evidence — the delay-evidence export needs the words');

ok('FollowUpHold holds the chases',
  /export interface FollowUpHold[\s\S]{0,2000}?chases\?:\s*FollowUpChase\[\]/.test(types),
  'FollowUpHold lost `chases` — the one thing about a follow-up that cannot be recomputed');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
