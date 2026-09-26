// validate-sheet-rise.ts — the slicker-motion pass, round 2, lane C.
//
//   bun run scripts/validate-sheet-rise.ts        (package.json: test:sheet-rise)
//
// Round 1 gave the punch-list and time-clock sheets the rise: the scrim
// cross-dissolves while the card springs up the last 28 pt with no bounce.
// Round 2 adopts that recipe, UNCHANGED, on the slide-up sheets a contractor
// opens every day (every PDF send, the contact picker, recording a payment,
// the invoice / change-order / daily-report sheets, new project). Text-only
// (these files import react-native, which bun cannot load). It pins:
//   A. every adopted (file, frame): `const fX = useSheetFrame(` is a 'slide'
//      frame that carries `rise: true`; `fX.cardMotion` is the LAST entry of
//      an `<Animated.View style={[…]}>` array that also carries `fX.card`
//      (and `fX.card` appears nowhere else); the frame's Modal reads
//      `animationType={fX.animationType}` (never a hard-coded one).
//   B. `.cardMotion` is only ever appended to an `<Animated.View`: an
//      Animated.Value transform in a Pressable / ScrollView /
//      KeyboardAvoidingView / Modal style fails on native (or moves the root).
//   C. a RATCHET on `rise: true` across app/ and components/.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Measured 2026-09-25 after round 2 lane C (10 from round 1 + 15). NEVER LOWER. */
const FLOOR = 25;

/** The frames round 2 lane C adopted. Each is a 'slide' frame with a View card. */
const ADOPTED: ReadonlyArray<{ file: string; frames: readonly string[] }> = [
  { file: 'components/PDFPreSendSheet.tsx', frames: ['f'] },
  { file: 'components/ContactPickerModal.tsx', frames: ['fSheet'] },
  { file: 'components/RecordPaymentModal.tsx', frames: ['f'] },
  { file: 'app/invoice.tsx', frames: ['fSend', 'fPayment', 'fRetainage', 'fRetention'] },
  { file: 'app/change-order.tsx', frames: ['fSend', 'fAddItem', 'fEstimate', 'fMaterial'] },
  { file: 'app/daily-report.tsx', frames: ['fSend', 'fTask', 'fCrew'] },
  { file: 'app/(tabs)/(home)/index.tsx', frames: ['createFrame'] },
];

/** Blank // and /* *\/ comments to spaces (newlines and strings kept), as in
 *  validate-motion.ts, so positions and line numbers survive. */
function stripComments(src: string): string {
  const out = src.split('');
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; blank(i); blank(i + 1); i += 2; continue; }
      if (two === '/*') { mode = 'block'; blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === "'") mode = 'sq';
      else if (src[i] === '"') mode = 'dq';
      else if (src[i] === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') {
      if (src[i] === '\n') { mode = 'code'; i++; continue; }
      blank(i); i++; continue;
    }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; blank(i); blank(i + 1); i += 2; continue; }
      blank(i); i++; continue;
    }
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) mode = 'code';
    else if ((mode === 'sq' || mode === 'dq') && src[i] === '\n') mode = 'code';
    i++;
  }
  return out.join('');
}

function collect(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
    }
  };
  for (const d of dirs) walk(join(ROOT, d));
  return out;
}
const rel = (p: string) => relative(ROOT, p).split(sep).join('/');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineOf = (src: string, at: number) => src.slice(0, at).split('\n').length;

let failures = 0;
function ok(label: string, pass: boolean, detail = '') {
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${!pass && detail ? `\n      ${detail}` : ''}`);
  if (!pass) failures++;
}

/** The top-level entries of a `[…]` style array body (commas inside
 *  (), {}, [] and strings do not split). */
function topLevelEntries(body: string): string[] {
  const parts: string[] = [];
  let depth = 0; let cur = ''; let q: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) { cur += c; if (c === '\\') { cur += body[++i] ?? ''; } else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    if (c === ')' || c === '}' || c === ']') depth--;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** From an index just past `[`, the index of the matching `]`. */
function closeBracket(src: string, from: number): number {
  let depth = 1; let q: string | null = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '[') depth++;
    if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

// ── A. the adopted frames ─────────────────────────────────────────────────────
console.log('A. the adopted frames rise');
for (const { file, frames } of ADOPTED) {
  const src = stripComments(readFileSync(join(ROOT, file), 'utf8'));
  for (const x of frames) {
    const id = `${file} ${x}`;
    // 1. the declaration: a 'slide' frame with rise: true.
    const decls = [...src.matchAll(new RegExp(`const ${esc(x)} = useSheetFrame\\(([^;]*?)\\);`, 'g'))];
    ok(`${id}: one useSheetFrame( declaration, a 'slide' frame with rise: true`, decls.length === 1
      && /animationType: 'slide'/.test(decls[0][1]) && /\brise: true\b/.test(decls[0][1]),
      `found ${decls.length}: ${decls.map((d) => d[0]).join(' | ')}`);

    // 2. the card: `<Animated.View style={[…, x.card, x.cardMotion]}`.
    const carriers = [...src.matchAll(new RegExp(`<Animated\\.View\\s+style=\\{\\[`, 'g'))]
      .map((m) => {
        const open = m.index! + m[0].length;
        const close = closeBracket(src, open);
        return { at: m.index!, entries: close < 0 ? [] : topLevelEntries(src.slice(open, close)) };
      })
      .filter((c) => c.entries.includes(`${x}.card`) || c.entries.includes(`${x}.cardMotion`));
    const c = carriers[0];
    ok(`${id}: the card is an <Animated.View> whose style array ends with ${x}.cardMotion (and carries ${x}.card, never first)`,
      carriers.length === 1 && c.entries[c.entries.length - 1] === `${x}.cardMotion`
        && c.entries.indexOf(`${x}.card`) > 0 && c.entries.filter((e) => e === `${x}.cardMotion`).length === 1,
      carriers.length === 1 ? `line ${lineOf(src, c.at)}: [${c.entries.join(', ')}]` : `found ${carriers.length} Animated.View carriers`);

    // x.card is referenced exactly once (on that carrier): a second, plain View
    // card for the same frame would sit outside the rise.
    const cardRefs = [...src.matchAll(new RegExp(`\\b${esc(x)}\\.card\\b(?!Motion)`, 'g'))];
    ok(`${id}: ${x}.card is used once, on the Animated.View`, cardRefs.length === 1,
      `found ${cardRefs.length} at lines ${cardRefs.map((m) => lineOf(src, m.index!)).join(', ')}`);

    // 3. the Modal reads the frame's animationType (the phone scrim fades).
    const anim = [...src.matchAll(new RegExp(`animationType=\\{${esc(x)}\\.animationType\\}`, 'g'))];
    const inModal = anim.length === 1 && (() => {
      const before = src.slice(0, anim[0].index!);
      const tag = [...before.matchAll(/<([A-Z][\w.]*)/g)].pop();
      return tag?.[1] === 'Modal';
    })();
    ok(`${id}: its <Modal> reads animationType={${x}.animationType}`, inModal,
      `found ${anim.length} animationType={${x}.animationType}`);
  }
}

// ── B. cardMotion only on an Animated.View ────────────────────────────────────
console.log('\nB. cardMotion is appended only to an <Animated.View>');
{
  const SOURCES = collect(['app', 'components']).map((p) => ({ path: rel(p), code: stripComments(readFileSync(p, 'utf8')) }));
  const bad: string[] = [];
  let uses = 0;
  for (const { path, code } of SOURCES) {
    for (const m of code.matchAll(/\.cardMotion\b/g)) {
      uses++;
      const tag = [...code.slice(0, m.index!).matchAll(/<([A-Z][\w.]*)/g)].pop()?.[1];
      if (tag !== 'Animated.View') bad.push(`${path}:${lineOf(code, m.index!)} is inside <${tag ?? '?'}>`);
    }
  }
  ok(`every .cardMotion (${uses}) sits in an <Animated.View> style — never a Pressable, ScrollView, KeyboardAvoidingView or Modal`,
    uses > 0 && bad.length === 0, bad.join('\n      '));

  // ── C. the ratchet ──────────────────────────────────────────────────────────
  console.log('\nC. ratchet');
  const rises = SOURCES.reduce((n, s) => n + (s.code.match(/\brise: true\b/g)?.length ?? 0), 0);
  ok(`rise: true across app/ and components/ is ${rises} (floor ${FLOOR})`, rises >= FLOOR);
  if (rises > FLOOR) console.log(`      (raise FLOOR to ${rises})`);
}

console.log(failures === 0 ? '\nvalidate-sheet-rise: all checks passed' : `\nvalidate-sheet-rise: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
