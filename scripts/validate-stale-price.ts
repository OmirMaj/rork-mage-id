// validate-stale-price.ts — pins utils/stalePriceWarning.ts.
//
// The stale-price note is the one honest thing standing between a learned
// rate nobody has re-measured in a year and a signed proposal. Two failure
// directions are equally bad: a note that never fires (the GC never gets
// warned) and a note that fires on "we don't know" (a missing date must never
// read as "fresh" — see ideas-roadmap.md T2 and the file's own header).
// Run: bun run scripts/validate-stale-price.ts
import { stalePriceDays, stalePriceNote, STALE_PRICE_THRESHOLD_DAYS } from '../utils/stalePriceWarning';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

console.log('\nstale-price warning (an honest age check on a learned rate):');

const NOW = new Date('2026-09-28T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

// ── threshold constant matches the spec (roadmap names no age; default 180) ──
expect('threshold is 180 days', STALE_PRICE_THRESHOLD_DAYS, 180);

// ── "not known" is NEVER "fresh" ──
expect('no date at all → null', stalePriceNote(undefined, NOW), null);
expect('null date → null', stalePriceNote(null, NOW), null);
expect('empty string (book cannot attest a date) → null', stalePriceNote('', NOW), null);
expect('unparsable date → null', stalePriceNote('not-a-date', NOW), null);
expect('unparsable date has no age either', stalePriceDays('not-a-date', NOW), null);

// ── a future "measurement" is not something we can age ──
expect('future date → null, not a negative age', stalePriceNote(daysAgo(-30), NOW), null);
expect('future date has no day count', stalePriceDays(daysAgo(-30), NOW), null);

// ── fresh enough: no note, silence is correct ──
expect('1 day old → null', stalePriceNote(daysAgo(1), NOW), null);
expect('30 days old → null', stalePriceNote(daysAgo(30), NOW), null);
expect('179 days old (just under threshold) → null', stalePriceNote(daysAgo(179), NOW), null);
expect('179 days has a real age even though no note fires', stalePriceDays(daysAgo(179), NOW), 179);

// ── at and past the threshold: the note fires, in months ──
expect('exactly 180 days (the threshold) → note fires', stalePriceNote(daysAgo(180), NOW), 'Price last updated 6 months ago');
expect('240 days ≈ 8 months (the roadmap\'s own example)', stalePriceNote(daysAgo(240), NOW), 'Price last updated 8 months ago');
expect('210 days rounds to 7 months', stalePriceNote(daysAgo(210), NOW), 'Price last updated 7 months ago');
expect('390 days rounds to 13 months, plural stays plural past a year', stalePriceNote(daysAgo(390), NOW), 'Price last updated 13 months ago');
expect('545 days rounds to 18 months (still expressed in months, not years)', stalePriceNote(daysAgo(545), NOW), 'Price last updated 18 months ago');

// Note: with a 180-day floor, months is always ≥ 6 and (once the years branch
// is reached) years is always ≥ 2 — so the singular "1 month"/"1 year" text
// is unreachable in practice. The pluralization branch is still real code
// (exercised at every value above); this just records why n=1 isn't pinned.

// ── the months → years handover at the 24-month boundary ──
expect('700 days stays just under the 24-month handover', stalePriceNote(daysAgo(700), NOW), 'Price last updated 23 months ago');
expect('730 days crosses into years', stalePriceNote(daysAgo(730), NOW), 'Price last updated 2 years ago');
expect('760 days reads in years', stalePriceNote(daysAgo(760), NOW), 'Price last updated 2 years ago');
expect('3 years old', stalePriceNote(daysAgo(365 * 3), NOW), 'Price last updated 3 years ago');

// ── sentence case, no hype, no emoji (docs/VOICE.md) ──
const sample = stalePriceNote(daysAgo(240), NOW) ?? '';
ok('starts with a capital letter, sentence case', /^[A-Z][a-z]/.test(sample), sample);
ok('no emoji', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sample), sample);
ok('no exclamation point (no hype)', !sample.includes('!'), sample);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
