// validate-commit-morph.ts — round 2 ('slicker'), lane A: the commit morph.
//
// WHY. On every key commit the founder sees two things: the send button and
// the success toast. Round 2 made the button MORPH (label → spinner → check on
// a teal fill, same width, full opacity) and gave the toast one calm drop-in
// that a second message REPLACES in place. This guard pins the rules that
// make those feel right and that a tidy-up would silently undo:
//   - Button declares `done`, exports useCommitFeedback, and guards run() with
//     a ref (a double tap inside one frame must not run the work twice);
//   - the check holds under a second (COMMIT_HOLD_MS <= 1000);
//   - the phone's shrink-to-spinner swap is gone (the width holds);
//   - the morph arms only on a phase CHANGE against a committed-phase ref, so
//     a button that never changes renders exactly what it did before;
//   - `!morphing && styles.disabled` in BOTH style arrays (the morph plays at
//     full opacity, not greyed at 50%);
//   - snap spring + the theme's success fill; reducedMotion() is honoured;
//   - no bounciness / friction / Easing.bounce / elastic in either file;
//   - SendToClientButton drives the Button with useCommitFeedback and keeps
//     the two strings other validators pin;
//   - NailItToast: no hammer, no sparks, rise spring, Reduce Motion, a hold
//     under 1.8 s, and the same three exports.
//
// Text-only (bun). Run: bun run scripts/validate-commit-morph.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  \u2713 ${name}`); }
  else { failed++; console.log(`  \u2717 ${name}${detail ? `\n      ${detail}` : ''}`); }
}

/** Copied from scripts/validate-motion.ts: blanks comments, keeps strings. */
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

const BTN_RAW = read('components/ui/Button.tsx');
const BTN = stripComments(BTN_RAW);
const STC_RAW = read('components/SendToClientButton.tsx');
const STC = stripComments(STC_RAW);
const TOAST = stripComments(read('components/animations/NailItToast.tsx'));

console.log('\nButton: the commit morph');
ok('Button declares `done?: boolean`', /\n\s*done\?: boolean;/.test(BTN));
ok('Button.tsx exports useCommitFeedback', /export function useCommitFeedback\(/.test(BTN));
{
  const at = BTN.indexOf('export function useCommitFeedback(');
  const hook = at < 0 ? '' : BTN.slice(at);
  ok('run() is guarded by a ref, not React state (busyRef.current)',
    /if \(busyRef\.current\) return undefined;\s*busyRef\.current = true;/.test(hook)
    && /const busyRef = useRef\(false\)/.test(hook));
  ok('the timer is cleared on unmount and nothing is set after it',
    /clearTimeout\(timerRef\.current\)/.test(hook) && /mountedRef\.current = false/.test(hook)
    && (hook.match(/if \(mountedRef\.current\) setPhase\(/g) ?? []).length >= 3);
}
{
  const m = BTN.match(/const COMMIT_HOLD_MS = (\d+);/);
  const hold = m ? Number(m[1]) : NaN;
  ok(`COMMIT_HOLD_MS <= 1000 (${hold})`, Number.isFinite(hold) && hold > 0 && hold <= 1000);
}
ok('the phone `loading && !desktop ? (` swap is gone', !/loading && !desktop \? \(/.test(BTN));
ok('arming compares the phase against a committed-phase ref',
  /const committedPhase = useRef/.test(BTN)
  && /if \(!armed\.current && phase !== committedPhase\.current\) \{\s*armed\.current = true;\s*seed\(committedPhase\.current\);/.test(BTN)
  && !/armed\.current = phase !== 'idle'/.test(BTN),
  'a morph armed by `phase !== idle` alone would animate a button that MOUNTS loading');
ok('`!morphing && styles.disabled` appears in both style arrays',
  (BTN.match(/isDisabled && !morphing && styles\.disabled/g) ?? []).length === 2
  && !/isDisabled && styles\.disabled/.test(BTN));
ok('the check lands on Tokens.motion.spring.snap', /Animated\.spring\(v\.checkS, \{[\s\S]{0,120}\.\.\.Tokens\.motion\.spring\.snap/.test(BTN));
ok('the teal fill is the theme success token (t.success, in makeStyles)', /tint: \{[\s\S]{0,160}backgroundColor: t\.success/.test(BTN));
ok('Button.tsx calls reducedMotion() — and the morph effect jumps every layer to its target under it',
  /reducedMotion\(\)/.test(BTN)
  && /useLayoutEffect\(\(\) => \{[\s\S]*?if \(reducedMotion\(\)\) \{\s*v\.labelO\.setValue\(to\.labelO\);\s*v\.spinO\.setValue\(to\.spinO\);\s*v\.checkO\.setValue\(to\.checkO\);\s*v\.tintO\.setValue\(to\.tintO\);/.test(BTN));
ok('the morph layers use the nativeDriver const, never a literal', !/useNativeDriver:\s*true/.test(BTN) && /useNativeDriver: nativeDriver/.test(BTN));
ok('only the tint, spinner and check layers are hidden from accessibility',
  (BTN.match(/accessibilityElementsHidden/g) ?? []).length === 4 /* 3 armed layers + the static check */
  && /<Animated\.View style=\{\[styles\.row, \{ opacity: values\.current\.labelO \}\]\}>/.test(BTN));

console.log('\nno bounce anywhere in the commit');
for (const [name, code] of [['Button.tsx', BTN], ['NailItToast.tsx', TOAST]] as const) {
  ok(`${name}: no bounciness / friction / Easing.bounce / Easing.elastic`,
    !/\bbounciness\b|\bfriction\b|Easing\.bounce\b|Easing\.elastic\b|\belastic\(/.test(code));
}

console.log('\nSendToClientButton');
ok('imports useCommitFeedback', /import \{[^}]*\buseCommitFeedback\b[^}]*\} from '@\/components\/ui\/Button'/.test(STC));
ok('renders <Button … done={commit.done}> for both send bars',
  (STC.match(/<Button\b[\s\S]{0,400}?done=\{commit\.done\}/g) ?? []).length === 2
  && (STC.match(/loading=\{commit\.loading\}/g) ?? []).length === 2);
ok('keeps `await sendToClientPortal({ kind, itemId, projectId })`', /await sendToClientPortal\(\{ kind, itemId, projectId \}\)/.test(STC));
ok("keeps `if (!isOwner) showAlert('Sent to the client portal', EDITOR_SEND_NOTE);`",
  /if \(!isOwner\) showAlert\('Sent to the client portal', EDITOR_SEND_NOTE\);/.test(STC));
ok('the tapped bar is held through the check (branch = commit.busy ? heldBranch : computed)',
  /const branch = commit\.busy \? heldBranch : computed;/.test(STC));
ok('no hand-rolled send bar or "Sending…" swap left', !/styles\.primary\b/.test(STC) && !/Sending\u2026|Sending…/.test(STC));

console.log('\nNailItToast');
ok('no Hammer import, no spark', !/\bHammer\b/.test(TOAST) && !/spark/i.test(TOAST));
ok('still exports nailIt, oops and NailItToastHost',
  /export function nailIt\(message: string\): void/.test(TOAST)
  && /export function oops\(message: string\): void/.test(TOAST)
  && /export function NailItToastHost\(\)/.test(TOAST));
ok('the card rises on Tokens.motion.spring.rise (enter AND replace)',
  (TOAST.match(/Animated\.spring\(translateY, \{ toValue: 0, useNativeDriver: nativeDriver, \.\.\.Tokens\.motion\.spring\.rise \}\)/g) ?? []).length === 2);
ok('honours Reduce Motion on the way in (values set, no translate/scale) and out',
  /if \(reducedMotion\(\)\) \{[\s\S]{0,200}opacity\.setValue\(1\);\s*translateY\.setValue\(0\);\s*bubbleScale\.setValue\(1\);/.test(TOAST)
  && /if \(reducedMotion\(\)\) \{[\s\S]{0,120}opacity\.setValue\(0\);/.test(TOAST));
ok('honours Reduce Motion', /reducedMotion\(\)/.test(TOAST));
{
  const m = TOAST.match(/const HOLD_MS = (\d+);/);
  const hold = m ? Number(m[1]) : NaN;
  ok(`HOLD_MS <= 1800 (${hold})`, Number.isFinite(hold) && hold > 0 && hold <= 1800);
}
ok('one message at a time: setActive(event), no queue', /setActive\(event\);/.test(TOAST) && !/\bqueue\b|\.push\((?:event|e)\)/.test(TOAST));
ok('a stopped or replaced exit cannot clear the new message', /if \(finished && idRef\.current === id\)/.test(TOAST));
ok('every Animated call uses the nativeDriver const', !/useNativeDriver:\s*true/.test(TOAST) && /useNativeDriver: nativeDriver/.test(TOAST));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
