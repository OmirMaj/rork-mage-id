// scripts/copy-title-case.ts — the ONE Title Case function (docs/VOICE.md §3).
//
// Imported by the guard (scripts/validate-copy-voice.ts, rule R15) and by its
// --fix-labels mode, so the code that writes a label and the code that checks
// it can never disagree. Pure string code: no fs, no react-native.
//
// The rule, exactly:
//   - Capitalize the first word, the last word and every word in between
//     except the small words in SMALL_WORDS.
//   - "in" and "on" are capitalized when they belong to the verb before them
//     (Sign In, Clock In, Fill In, Turn On). isTitleCase() accepts either case
//     for a middle "in" / "on", because only a reader can tell "Sign In to
//     MAGE ID" from "Photos in This Project"; titleCase() uses PARTICLE_VERBS.
//     "up", "out" and "off" are never small words, so they are always capital.
//   - Both halves of a hyphenated word are capitalized (Sign-In Link,
//     Auto-Name PDFs), except a small word in the middle (Day-to-Day).
//   - The first word after "(", ":" or an opening quote starts a new run.
//   - A word that already carries a capital anywhere (MAGE, RFIs, iPhone,
//     QuickBooks, G702/G703, PDFs) or a digit is left exactly as typed.

export const SMALL_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in', 'of',
  'on', 'per', 'to', 'vs', 'vs.', 'via', 'with', 'from', 'into',
]);

/** Verbs that own a following "in" / "on" (Sign In, Turn On). */
export const PARTICLE_VERBS: ReadonlySet<string> = new Set([
  'sign', 'signed', 'signing', 'clock', 'clocked', 'log', 'logged', 'check', 'checked', 'fill',
  'opt', 'zoom', 'turn', 'turned', 'switch', 'switched',
]);

const OPENERS = /^[("“‘'\[]+/;
const CLOSERS = /[)"”’'\],;:.!?…]+$/;

function capFirst(w: string): string {
  // First LETTER, so an escaped or quoted lead-in is left alone.
  const i = w.search(/[A-Za-zÀ-ÿ]/);
  if (i < 0) return w;
  return w.slice(0, i) + w[i].toUpperCase() + w.slice(i + 1);
}

function lowerFirst(w: string): string {
  const i = w.search(/[A-Za-zÀ-ÿ]/);
  if (i < 0) return w;
  return w.slice(0, i) + w[i].toLowerCase() + w.slice(i + 1);
}

/** A word typed with its own capitals or digits: left exactly as it is. */
function isFixed(core: string): boolean {
  return /\d/.test(core) || /[A-Za-z][A-Z]/.test(core) || /^[A-Z]{2,}s?$/.test(core);
}

type Tok = { raw: string; open: string; core: string; close: string };

function tokenize(s: string): { toks: Tok[]; gaps: string[] } {
  const parts = s.split(/(\s+)/);
  const toks: Tok[] = [];
  const gaps: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) { gaps.push(parts[i]); continue; }
    const raw = parts[i];
    const open = raw.match(OPENERS)?.[0] ?? '';
    const rest = raw.slice(open.length);
    const close = rest.match(CLOSERS)?.[0] ?? '';
    toks.push({ raw, open, core: rest.slice(0, rest.length - close.length), close });
  }
  return { toks, gaps };
}

/** 'cap' | 'small' | 'either' | 'fixed' for the word at index i. */
function want(toks: Tok[], i: number): 'cap' | 'small' | 'either' | 'fixed' {
  const t = toks[i];
  if (!/[A-Za-z]/.test(t.core)) return 'fixed';
  if (t.core.split(/[-/]/).every((p) => !/[A-Za-z]/.test(p) || isFixed(p))) return 'fixed';
  const prev = toks.slice(0, i).reverse().find((x) => /[A-Za-z0-9]/.test(x.core));
  const next = toks.slice(i + 1).find((x) => /[A-Za-z0-9]/.test(x.core));
  const startsRun = !prev || /[:.?!]$/.test(prev.close) || t.open.length > 0 || /^[·|•/&+]$/.test(toks[i - 1]?.raw ?? '');
  const endsRun = !next || /[)\]"”]/.test(t.close) || /[:.?!]/.test(t.close) || /^[·|•]$/.test(toks[i + 1]?.raw ?? '');
  const low = t.core.toLowerCase();
  if (startsRun || endsRun) return 'cap';
  if (!SMALL_WORDS.has(low)) return 'cap';
  if (low === 'in' || low === 'on') return 'either';
  return 'small';
}

function capWord(core: string): string {
  // Hyphen and slash halves: Sign-In, Auto-Name, Push/Email, Day-to-Day.
  return core
    .split(/([-/])/)
    .map((part, idx, all) => {
      if (part === '-' || part === '/') return part;
      if (isFixed(part)) return part;
      const middle = idx > 0 && idx < all.length - 1;
      if (middle && SMALL_WORDS.has(part.toLowerCase())) return lowerFirst(part);
      return capFirst(part);
    })
    .join('');
}

/** The Title Case form of a label. */
export function titleCase(s: string): string {
  const { toks, gaps } = tokenize(s);
  const out: string[] = [];
  toks.forEach((t, i) => {
    const w = want(toks, i);
    let core = t.core;
    if (w === 'cap') core = capWord(core);
    else if (w === 'small') core = lowerFirst(core);
    else if (w === 'either') {
      const prev = toks[i - 1]?.core.toLowerCase() ?? '';
      core = PARTICLE_VERBS.has(prev) ? capFirst(core) : lowerFirst(core);
    }
    out.push(t.open + core + t.close);
    if (i < gaps.length) out.push(gaps[i]);
  });
  return out.join('');
}

/** True when a label is already in Title Case (a middle in / on may be either). */
export function isTitleCase(s: string): boolean {
  const { toks } = tokenize(s);
  return toks.every((t, i) => {
    const w = want(toks, i);
    if (w === 'fixed' || w === 'either') return true;
    if (w === 'cap') return t.core === capWord(t.core);
    return t.core === lowerFirst(t.core);
  });
}
