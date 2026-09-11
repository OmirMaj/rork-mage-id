// The pricing table must not promise what the project cap takes away.
//
// WHY THIS EXISTS. app/paywall.tsx shipped a comparison row reading
//
//     { label: 'Unlimited Projects', free: true, pro: true, business: true }
//
// while hooks/useTierAccess.ts FEATURE_LIMITS.maxProjects.free = 1 blocked the
// second project — and the block the contractor hits is headed with the LITERAL
// STRING from that row ("Unlimited Projects" / "Requires Pro", fed to
// components/Paywall from app/(tabs)/(home)/index.tsx). So the pricing screen
// made a promise and the app broke it in the same session, to the same person,
// inside his first ten minutes. The app's own Settings FAQ and
// marketing/pricing.html both say Free is one active project, so the table was
// the thing that was wrong.
//
// It survived because the guard that reads this table cannot see it:
// scripts/validate-paywall-feature-matrix.ts only enforces that a row with a
// FeatureKey DERIVES its columns. There is no FeatureKey for a project COUNT,
// so the row is hand-typed, allow-listed by label, and its booleans are
// unexamined — the allowlist reason ("ungated — nothing checks a FeatureKey")
// was written before maxProjects existed and kept certifying the row after.
//
// THE RULE ENFORCED HERE: the Free column of the project row must agree with
// FEATURE_LIMITS.maxProjects.free.
//   • finite cap  → the row must NOT claim free: true, and must print the cap
//                   number in the Free column (an X alone would read "no
//                   projects on Free", the opposite lie).
//   • Infinity    → the row must claim free: true.
// Either file can move; they cannot disagree.
//
// Source-text, deliberately: importing hooks/useTierAccess.ts pulls the React
// tree in, and what is being guarded IS the literal in the file. Both reads
// assert they found their target first, so a rename fails the guard loudly
// instead of quietly making it blind.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** The `free:` entry of FEATURE_LIMITS.maxProjects, as a number (Infinity ok). */
function freeProjectCap(): number {
  const src = read('hooks/useTierAccess.ts');
  const row = src.match(/maxProjects:\s*\{([^}]*)\}/);
  expect(row).not.toBeNull();
  const free = row![1].match(/free:\s*(Infinity|\d+)/);
  expect(free).not.toBeNull();
  return free![1] === 'Infinity' ? Infinity : Number(free![1]);
}

/** The project row of FEATURE_SPECS in app/paywall.tsx, as source text. */
function projectRowSource(): string {
  const src = read('app/paywall.tsx');
  const start = src.indexOf('const FEATURE_SPECS');
  expect(start).toBeGreaterThan(-1);
  const table = src.slice(start, src.indexOf('\n];', start));
  // Matched on the project word rather than the exact label so a reworded row
  // ("Active projects") is still found and checked.
  const rows = table.match(/\{\s*label:\s*'[^']*[Pp]rojects[^']*'[^}]*\}/g);
  expect(rows).not.toBeNull();
  // More than one and "the project row" is ambiguous — this guard would be
  // checking whichever happened to be first, which is how the original row
  // stayed wrong under a validator that was reading it.
  expect(rows!).toHaveLength(1);
  return rows![0];
}

/** The FEATURE_PITCH entry for `key` in components/Paywall.tsx, unquoted. */
function pitchFor(key: string): string {
  const src = read('components/Paywall.tsx');
  const map = src.slice(src.indexOf('const FEATURE_PITCH'));
  const m = map.match(new RegExp(`'${key}':\\s*\n?\\s*(['"\`])([\\s\\S]*?)\\1,`));
  expect(m).not.toBeNull();
  return m![2];
}

describe('paywall project row vs. the enforced project cap', () => {
  it('states the Free allowance the app actually enforces', () => {
    const cap = freeProjectCap();
    const row = projectRowSource();

    if (Number.isFinite(cap)) {
      // A cap exists, so "included on Free" is false.
      expect(row).not.toMatch(/free:\s*true/);
      // …and the number is what the column must show.
      expect(row).toMatch(new RegExp(`freeNote:\\s*'${cap}'`));
    } else {
      // No cap: the row is honest as a plain check.
      expect(row).toMatch(/free:\s*true/);
    }
  });

  it('the block a capped user hits explains the cap instead of only naming it', () => {
    // components/Paywall renders `feature` as a bare heading. For this gate the
    // heading is the pricing-table label, i.e. the exact promise being refused,
    // so the modal needs a sentence that says what Free actually includes.
    //
    // The entry EXISTING is not the bar — an empty string passes a `toContain`
    // on the key and renders nothing, because the JSX is `{pitch ? … : null}`.
    // So: it must be a real sentence, and it must state the enforced number.
    const cap = freeProjectCap();
    const pitch = pitchFor('Unlimited Projects');
    expect(pitch.length).toBeGreaterThan(40);
    expect(pitch).toMatch(/free/i);
    expect(pitch).toMatch(cap === 1 ? /one project/i : new RegExp(`${cap} projects`, 'i'));
    // The feature string the home screen passes into the gate.
    const home = read('app/(tabs)/(home)/index.tsx');
    expect(home).toContain('feature="Unlimited Projects"');
  });

  it('…and the modal actually renders that sentence, in both of its views', () => {
    // Deleting the two JSX lines restores the P0 exactly — the screen goes back
    // to naming the feature and nothing else — while every assertion about the
    // map still passes. Pin the render, not just the data.
    const src = read('components/Paywall.tsx');
    expect(src).toMatch(/const pitch = FEATURE_PITCH\[feature\]/);
    const rendered = src.match(/\{pitch \? <Text style=\{styles\.featurePitch\}>\{pitch\}<\/Text> : null\}/g) ?? [];
    // One for the native modal, one for the web view: a caller on either path
    // must get the sentence.
    expect(rendered.length).toBe(2);
  });
});
