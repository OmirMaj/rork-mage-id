// validate-calendar-date.ts — pins the calendar-day formatter and the punch
// list's use of it.
//
// WHY THIS EXISTS. app/punch-list.tsx rendered `Due: {item.dueDate}` raw. The
// field is DECLARED 'YYYY-MM-DD' in types/index.ts, but Supabase-synced rows
// come back as a full ISO timestamp — the edit path in the same file already
// knew this and compensated with `.slice(0, 10)` (openEditForm). So the same
// punch item read "Due: 2026-08-30" on the device that created it and
// "Due: 2026-08-30T00:00:00.000Z" on any device that pulled it from the
// server. Permits and warranties both format; the punch card never got it.
//
// The obvious fix — copy warranties.tsx's `new Date(iso).toLocaleDateString()`
// — is ITSELF wrong. The spec parses a bare 'YYYY-MM-DD' as UTC midnight, so
// in any negative-offset zone the label renders the PREVIOUS day: a due date
// of 2026-08-30 shows as "Aug 29, 2026" in America/New_York. A due date is a
// day on a calendar, not an instant; it must not move with the reader.
//
// Pins INTENDED semantics:
//   • a bare calendar day formats to that SAME day in every timezone
//   • a full ISO timestamp is truncated to its date part (matches the edit
//     path's .slice(0, 10)), not reinterpreted as a local instant
//   • out-of-range components are rejected, not silently rolled over — the
//     Date constructor turns 2026-13-45 into February 2027 rather than NaN
//   • unparseable input is echoed back, never replaced by a plausible lie
//   • the punch list actually calls the formatter (the original defect)

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { formatCalendarDay, parseCalendarDay } from '../utils/calendarDate';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
  }
}

function eq(label: string, got: unknown, want: unknown) {
  ok(label, got === want, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

// ── 1. A calendar day does not shift with the timezone ───────────────────
// This is the case `new Date('2026-08-30').toLocaleDateString()` gets wrong.

console.log('\ncalendar days are timezone-stable:');
{
  eq('bare YYYY-MM-DD formats to the same day', formatCalendarDay('2026-08-30'), 'Aug 30, 2026');
  eq('New Year\'s Day does not roll back a year', formatCalendarDay('2026-01-01'), 'Jan 1, 2026');
  eq('leap day survives', formatCalendarDay('2028-02-29'), 'Feb 29, 2028');

  // The guard that actually matters: parse must land on local midnight of the
  // requested day, so getDate() round-trips no matter what TZ the process runs
  // in. Under `new Date(iso)` this is off by one west of Greenwich.
  const d = parseCalendarDay('2026-08-30');
  ok('parse lands on the requested calendar day, not UTC midnight',
    d !== null && d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 30,
    `TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone} got ${d?.toString()}`);
  eq('parse lands at local midnight', d?.getHours(), 0);
}

// ── 2. Synced rows format identically to locally created ones ────────────
// The defect itself: two renderings of one item.

console.log('\nlocal and Supabase-synced rows agree:');
{
  eq('full ISO timestamp truncates to its date part',
    formatCalendarDay('2026-08-30T00:00:00.000Z'), 'Aug 30, 2026');
  ok('a synced row renders identically to the local row',
    formatCalendarDay('2026-08-30T00:00:00.000Z') === formatCalendarDay('2026-08-30'));
  ok('a timestamp late in the UTC day still uses its own date part',
    formatCalendarDay('2026-08-30T23:59:59Z') === formatCalendarDay('2026-08-30'));
  ok('the truncation matches the edit path in app/punch-list.tsx',
    /setDueDate\(\(item\.dueDate \?\? ''\)\.slice\(0, 10\)\)/.test(read('app/punch-list.tsx')));
}

// ── 3. Bad input is echoed, not turned into a plausible wrong date ───────
// `new Date(2026, 12, 45)` is a VALID Date in Feb 2027, so a getTime()/NaN
// check is not enough — the components have to be round-tripped.

console.log('\nbad input is never dressed up as a real date:');
{
  eq('month 13 is rejected, not rolled into next year', formatCalendarDay('2026-13-01'), '2026-13-01');
  eq('day 45 is rejected, not rolled into the next month', formatCalendarDay('2026-01-45'), '2026-01-45');
  eq('Feb 30 is rejected in a non-leap year', formatCalendarDay('2027-02-30'), '2027-02-30');
  eq('Feb 29 is rejected in a non-leap year', formatCalendarDay('2027-02-29'), '2027-02-29');
  eq('free text is echoed back', formatCalendarDay('next tuesday'), 'next tuesday');
  eq('empty string yields empty string', formatCalendarDay(''), '');
  eq('null yields empty string', formatCalendarDay(null), '');
  eq('undefined yields empty string', formatCalendarDay(undefined), '');
  eq('parse rejects month 13', parseCalendarDay('2026-13-01'), null);
  eq('parse rejects day 45', parseCalendarDay('2026-01-45'), null);
}

// ── 4. The screen actually uses it ───────────────────────────────────────
// The original defect was not a broken formatter; it was a call site that
// never had one. Pin the call site so it cannot regress to the raw field.

console.log('\nthe punch list renders a formatted due date:');
{
  const punch = read('app/punch-list.tsx');
  ok('punch-list imports formatCalendarDay',
    /import \{ formatCalendarDay \} from '@\/utils\/calendarDate'/.test(punch));
  ok('the Due meta row calls the formatter',
    /Due: \{formatCalendarDay\(item\.dueDate\)\}/.test(punch));
  ok('the Due meta row no longer interpolates the raw field',
    !/Due: \{item\.dueDate\}/.test(punch),
    (punch.match(/.*Due: \{item\.dueDate\}.*/g) ?? []).join('\n       '));
}

console.log('\nthe same off-by-one is fixed on the other calendar-day surfaces:');
{
  const safety = read('app/safety-hazards.tsx');
  ok('safety-hazards imports formatCalendarDay',
    /import \{ formatCalendarDay \} from '@\/utils\/calendarDate'/.test(safety));
  ok('safety-hazards due meta formats the calendar day, not the raw field',
    /due \$\{formatCalendarDay\(item\.dueDate\)\}/.test(safety) && !/due \$\{item\.dueDate\}/.test(safety),
    (safety.match(/.*due \$\{item\.dueDate\}.*/g) ?? []).join('\n       '));

  const pipe = read('components/StatusPipeline.tsx');
  ok('StatusPipeline imports parseCalendarDay',
    /import \{ parseCalendarDay \} from '@\/utils\/calendarDate'/.test(pipe));
  ok('StatusPipeline.daysUntil resolves the due day via parseCalendarDay before falling back to Date.parse',
    /const day = parseCalendarDay\(iso\)/.test(pipe) && /day \? day\.getTime\(\) : Date\.parse\(iso\)/.test(pipe));
}

// ── 5. The filter rail can share its row with the More-filters button ────
// Yoga's DefaultFlexShrink is 0.0f on native (Style.h), so a horizontal
// ScrollView sized from its own content cannot give width back to a sibling —
// the audited "filter chips clipped by the filter button". `flex: 1` fixes it
// through flexBasis, not shrink: processFlexBasis (Node.cpp) resolves a
// positive flex with auto basis to points(0) on native, so the rail starts at
// zero and grows into the leftover space. Layout is invisible to a render
// test, so the style is pinned textually instead.

console.log('\nthe punch-list filter rail is flexible:');
{
  const punch = read('app/punch-list.tsx');
  ok('filterScroll declares flex: 1', /filterScroll: \{[^}]*flex: 1/.test(punch),
    (punch.match(/filterScroll: \{[^}]*\}/) ?? []).join(''));
  ok('the horizontal ScrollView in the filter bar applies it',
    /style=\{styles\.filterScroll\}/.test(punch));
}

// ── 6. The header eyebrow carries the real brand ─────────────────────────
// Pre-launch de-brand left 43 eyebrows reading "· MAGE" instead of the
// product name, "MAGE ID". All 43 are now fixed and every one is covered by
// this guard — no path is excluded. Prose uses of MAGE (the assistant's name
// in "Ask MAGE") are deliberately NOT covered here — only the brand line.

console.log('\nheader eyebrows say MAGE ID:');
{
  const stale: string[] = [];
  for (const rel of listTsx(join(ROOT, 'app')).concat(listTsx(join(ROOT, 'components')))) {
    const src = readFileSync(rel, 'utf8');
    for (const line of src.split('\n')) {
      // Only the eyebrow/brand-line form: "… · MAGE" immediately closing a
      // JSX text node or a string prop. Prose like "· MAGE never stores…"
      // does not match and is left to a product decision.
      if (/· MAGE(?=["<])/.test(line)) stale.push(`${rel.slice(ROOT.length + 1)}: ${line.trim()}`);
    }
  }
  // Every app/ and components/ eyebrow is now owned here — the guard covers
  // all of them, including app/job-costing.tsx and app/prequal-manager.tsx,
  // which earlier shipped with a hardcoded exclusion that let three stale
  // "· MAGE" eyebrows through while the guard printed "ok".
  ok('no header eyebrow still reads "· MAGE"', stale.length === 0, stale.join('\n       '));
}

function listTsx(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsx(full));
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
