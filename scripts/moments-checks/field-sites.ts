// field-sites.ts: the field and closeout moments (wave-next W2, lane MOMFIELD).
//
// Loaded by scripts/validate-moments.ts (every scripts/moments-checks/*.ts is
// discovered). The four sites and what this file holds them to:
//
//   C1 app/time-tracking.tsx, your own shift: the "Clock out?" Alert is a
//      sheet with the md slide; the out time is taken at RELEASE inside the
//      commit, never when the sheet opened; no Medium haptic for clock-out.
//   C2 app/time-tracking.tsx, the out-time sheet (a crew member's shift on
//      your project, a missed clock-out): its confirm is the md slide; the
//      picked time is read and checked again inside the commit; a team row's
//      "it stays theirs" is the caption above the track, never an Alert.
//   C3 app/punch-list.tsx: the close sheet's slide, disabled with "Close every
//      punch item first." (and a viewer's write block); the last-item Alert is
//      an inline banner; router.back() waits for onDone.
//   C4 app/closeout-binder.tsx: the finalize slide; finalizedAt at release,
//      saveCloseoutBinderDetailed, no Alert, no success haptic.
//   C5 app/wip-report.tsx: the lock slide (tone ink, resultIcon lock, a
//      neutral result); "Nothing to lock" / "Already locked" are disabled
//      reasons; lockPeriodDetailed; no Warning haptic.
//
// And utils/moments/sites/fieldCopy.ts: every export is called for real and
// must return ONE whole sentence (or one whole label) that lints clean, with
// no pronoun for a user and "project" never "job".
//
// Every rule is proven red on a planted defect first (a rule that cannot see
// a planted defect proves nothing), then run over the real files.

import type { MomentsCtx } from '../validate-moments';
import { lintMomentCopy } from '../../utils/moments/copy';
import * as F from '../../utils/moments/sites/fieldCopy';

type Fails = string[];

const TT = 'app/time-tracking.tsx';
const PL = 'app/punch-list.tsx';
const CB = 'app/closeout-binder.tsx';
const WR = 'app/wip-report.tsx';
const COPY = 'utils/moments/sites/fieldCopy.ts';

// ─────────────────────────────────────────────────────────────────────────────
// scanning helpers (self-contained: check modules never import each other)
// ─────────────────────────────────────────────────────────────────────────────

function skipString(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') { j += 2; continue; }
    if (q !== '`' && src[j] === '\n') return j;
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') {
      const end = closeOf(src, j + 1);
      if (end < 0) return src.length;
      j = end;
      continue;
    }
    j++;
  }
  return j + 1;
}

/** Index just past the bracket closing the one at `open`; -1 when unbalanced. */
function closeOf(src: string, open: number): number {
  const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
  const stack: string[] = [];
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = skipString(src, i); continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === '}' || c === ')' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

/** The text of `const NAME = useCallback(…)` / `function NAME(…) {…}` up to its balanced end; '' when absent. */
export function bodyOf(code: string, name: string): string {
  const m = new RegExp(`(?:const\\s+${name}\\s*=\\s*|function\\s+${name}\\s*\\()`).exec(code);
  if (!m) return '';
  const from = m.index + m[0].length;
  // A hook call wraps the handler: take the whole call. A function: its body.
  if (/^use(?:Callback|Memo)\s*[<(]/.test(code.slice(from))) {
    const open = code.indexOf('(', from);
    const end = closeOf(code, open);
    return end < 0 ? '' : code.slice(m.index, end);
  }
  const open = code.indexOf('{', from);
  const end = open < 0 ? -1 : closeOf(code, open);
  return end < 0 ? '' : code.slice(m.index, end);
}

/** Every `<SlideToConfirm …>` opening tag's text. */
export function slideTags(code: string): string[] {
  return jsxTags(code, 'SlideToConfirm');
}

/** Every `<Name …>` opening tag's text (attributes with balanced braces, so a footer={…} holds its JSX). */
export function jsxTags(code: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let i = m.index + m[0].length;
    // Walk attributes to the closing `>` / `/>` (braces balanced).
    while (i < code.length) {
      const c = code[i];
      if (c === '{') { const e = closeOf(code, i); if (e < 0) break; i = e; continue; }
      if (c === '"' || c === "'") { i = skipString(code, i); continue; }
      if (c === '>') { i++; break; }
      i++;
    }
    out.push(code.slice(m.index, i));
  }
  return out;
}

/** The value text of `attr={…}` or `attr="…"` in a tag; undefined when absent. */
export function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}=`).exec(tag);
  if (!m) return undefined;
  const at = m.index + m[0].length;
  if (tag[at] === '{') { const e = closeOf(tag, at); return e < 0 ? undefined : tag.slice(at + 1, e - 1).trim(); }
  if (tag[at] === '"' || tag[at] === "'") { const e = tag.indexOf(tag[at], at + 1); return tag.slice(at, e + 1); }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// the rules (pure, on file text with comments stripped)
// ─────────────────────────────────────────────────────────────────────────────

const RETIRED: Record<string, string[]> = {
  [TT]: ["'Clock out?'", 'Clock out a shift you didn', "Couldn\\u2019t clock out"],
  [PL]: ["'All punch items closed'", 'Nice — every punch', "'Close project?'", "'Cannot close yet'", "'Project closed', 'This project has been archived.'"],
  [CB]: ["'Finalize binder?'", "Couldn't finalize the binder"],
  [WR]: ["'Lock period?'", "showAlert('Already locked'", "showAlert('Nothing to lock'"],
};

/** The replaced handlers: none may raise an Alert or play a haptic of its own (the capsule plays momentHaptic). */
const QUIET_HANDLERS: Record<string, string[]> = {
  [TT]: ['commitClockOut', 'commitOutTime', 'closeClockOutSheet', 'closeOutSheet'],
  [PL]: ['handleCloseProject', 'commitCloseProject', 'onCloseProjectDone', 'dismissCloseSheet'],
  [CB]: ['commitFinalize', 'onFinalizeDone'],
  [WR]: ['handleLock', 'commitLock', 'lockRefusal', 'closeLockSheet'],
};

/** One site file against its rules. */
export function checkFieldSite(path: string, code: string): Fails {
  const f: Fails = [];
  for (const s of RETIRED[path] ?? []) if (code.includes(s)) f.push(`${path}: retired moment text is back: ${s}`);
  // A missing name never renders as "Check 's shift" or "Check  before": the
  // site picks the no-name sentence instead of passing an empty string.
  for (const m of code.matchAll(/fieldCopy\.(\w+)\([^()]*\?\?\s*''\s*\)/g)) {
    f.push(`${path}: fieldCopy.${m[1]}(… ?? '') renders a broken sentence when the name is missing; choose the no-name variant at the call site`);
  }
  // Both branches of a named/no-name writeOptions pick (rules R3 reads only
  // the first object it meets) take their timeout from fieldCopy.
  for (const m of code.matchAll(/\btimeout:\s*([^,}\n]+)/g)) {
    if (!/^fieldCopy\.\w+\(/.test(m[1].trim())) f.push(`${path}: every copy.timeout calls a fieldCopy function (got ${JSON.stringify(m[1].trim().slice(0, 50))})`);
  }
  for (const h of QUIET_HANDLERS[path] ?? []) {
    const b = bodyOf(code, h);
    if (!b) { f.push(`${path}: ${h} not found (re-point this rule rather than deleting it)`); continue; }
    if (/\bshowAlert\s*\(/.test(b)) f.push(`${path}: ${h} raises an Alert (the slide says what happened)`);
    if (/\bHaptics\.\w+\s*\(/.test(b)) f.push(`${path}: ${h} plays a haptic (the capsule plays its own)`);
  }
  const tags = slideTags(code);
  if (tags.length === 0) f.push(`${path}: no <SlideToConfirm> (the moment is gone)`);
  // W2 integration (critic 2, issue 6): a sheet whose slide plays a result
  // hold (confirmed, or kept on this phone) stays busy, so it cannot be
  // dismissed, until onDone; onResolved clears busy only for any other answer.
  if (path === TT || path === PL || path === WR) {
    for (const t of tags) {
      const res = attr(t, 'onResolved') ?? '';
      if (!/^\(r\) => \{ if \(r\.status !== 'confirmed' && r\.status !== 'queued'\) set\w+Busy\(false\); \}$/.test(res)) {
        f.push(`${path}: a slide's onResolved clears busy on a confirmed or queued result (the sheet could be dismissed during the result hold, and onDone would never run): ${res.slice(0, 60)}`);
      }
    }
  }
  for (const t of tags) {
    const wo = attr(t, 'writeOptions') ?? '';
    const woText = /^[A-Za-z_$][\w$]*$/.test(wo) ? bodyOf(code, wo) : wo;
    if (!/\bidempotent\s*:\s*false\b/.test(woText)) f.push(`${path}: a slide's writeOptions is not idempotent: false (a queued or unknown write never says "nothing was saved")`);
    if (!attr(t, 'onDone')) f.push(`${path}: a slide has no onDone (the sheet must close after the result, not in the write)`);
    // The slide says every result it hands over in the app-wide toast
    // (sayCommitResult), so the answer outlives the sheet. A site that opts
    // out (say={false}) must tell a late answer itself.
    if (attr(t, 'say') === 'false' && !attr(t, 'onResultAfterUnmount')) f.push(`${path}: a slide opts out of saying its result (say={false}) and has no onResultAfterUnmount (a late answer must still be told)`);
    // ...and a site handler that toasts the same result says it twice.
    if (attr(t, 'say') !== 'false') {
      for (const h of ['onDone', 'onResolved', 'onResultAfterUnmount', 'onLateResult']) {
        const v = attr(t, h) ?? '';
        const body = /^[A-Za-z_$][\w$]*$/.test(v) ? bodyOf(code, v) : v;
        if (/\b(nailIt|oops)\s*\(/.test(body)) f.push(`${path}: a slide's ${h} toasts the result the slide already says (two toasts)`);
      }
    }
  }
  if (/function momentAfterUnmount\b/.test(code)) f.push(`${path}: the per-site after-unmount toast is back (the slide says its result itself)`);
  // While the write is in flight (and through a stored answer's hold) the
  // slide's sheet cannot be dismissed: no drag, no X, no scrim, no back.
  const SHEET_BUSY: Record<string, string[]> = { [TT]: ['clockOutBusy'], [PL]: ['closeBusy'], [WR]: ['lockBusy'] };
  for (const busy of SHEET_BUSY[path] ?? []) {
    const sheet = jsxTags(code, 'Sheet').find((tag) => /<SlideToConfirm\b/.test(tag) && new RegExp(`dismissOnBackdrop=\\{!${busy}\\}`).test(tag));
    if (!sheet || attr(sheet, 'dismissible') !== `!${busy}`) f.push(`${path}: the slide's sheet must pass dismissible={!${busy}} (it could be dragged or closed while the write is in flight)`);
  }

  if (path === TT) {
    // C1/C2: the md size on every clock-out slide.
    if (tags.length !== 2) f.push(`${TT}: expected 2 clock-out slides (own shift, out-time sheet), found ${tags.length}`);
    for (const t of tags) if (attr(t, 'size') !== '"md"') f.push(`${TT}: a clock-out slide is not size="md"`);
    // The out time is taken at RELEASE: inside the commit, from Date.now().
    const own = bodyOf(code, 'commitClockOut');
    const rel = own.indexOf('Date.now()');
    const write = own.indexOf('clockOutDetailed(entry.id, outIso)');
    if (!(rel >= 0 && write > rel && /const outIso = new Date\(releaseMs\)\.toISOString\(\)/.test(own))) {
      f.push(`${TT}: commitClockOut must take the out time at release (Date.now() inside the commit, before clockOutDetailed(entry.id, outIso))`);
    }
    const opener = bodyOf(code, 'handleAction');
    if (!/setClockOutFor\(entry\)/.test(opener)) f.push(`${TT}: handleAction's clock_out branch must open the clock-out sheet (setClockOutFor(entry))`);
    if (/toISOString\(\)|clockOutDetailed\(|doClockOut\(/.test(opener)) f.push(`${TT}: handleAction computes or writes an out time (it must only open the sheet; the slide takes the time at release)`);
    if (/\bshowAlert\s*\(/.test(opener)) f.push(`${TT}: handleAction raises an Alert for clock-out`);
    if (!/if \(action !== 'clock_out' && Platform\.OS !== 'web'\) void Haptics\.impactAsync/.test(opener)) f.push(`${TT}: handleAction's Medium haptic must skip clock_out (the slide plays its own)`);
    const out = bodyOf(code, 'commitOutTime');
    if (!/parseClockTime\(outText\)/.test(out) || !/outTimeProblem\(entry, outMs, Date\.now\(\)(?:, displayLang)?\)/.test(out)) f.push(`${TT}: commitOutTime must read the picked time and check it against now at release`);
    if (!/closeTeamShiftDetailed\(entry\.id, \{ clockOut: outIso/.test(out) || !/clockOutDetailed\(entry\.id, outIso\)/.test(out)) f.push(`${TT}: commitOutTime must write through closeTeamShiftDetailed / clockOutDetailed`);
    if (!/fieldCopy\.teamShiftNotOwn\(\)/.test(out)) f.push(`${TT}: a team close that is not on your project must be refused with teamShiftNotOwn()`);
    if (!/fieldCopy\.teamShiftCaption\(/.test(code)) f.push(`${TT}: the team caption above the track is missing`);
    // #106: the caption gets the RAW name. teamLoggedByName() falls back to
    // "a teammate", which would start the caption lowercase and never reach
    // teamShiftCaptionUnnamed().
    const opens = code.match(/openOutSheet\(entry, [^;]*\);/g) ?? [];
    if (opens.length === 0 || opens.some((o) => /teamLoggedByName\(/.test(o) || !/teamRow\?\.loggedByName\?\.trim\(\) \|\| undefined\)/.test(o))) {
      f.push(`${TT}: the out-time sheet must get the raw name (teamRow?.loggedByName?.trim() || undefined), never teamLoggedByName's "a teammate" fallback`);
    }
    if (!/outFor\.loggedByName \? fieldCopy\.teamShiftCaption\(outFor\.loggedByName\) : fieldCopy\.teamShiftCaptionUnnamed\(\)/.test(code)) {
      f.push(`${TT}: an unknown name must read teamShiftCaptionUnnamed() ("A teammate …")`);
    }
  }
  if (path === PL) {
    const tag = tags[0] ?? '';
    const reason = attr(tag, 'disabledReason') ?? '';
    const reasonText = /^[A-Za-z_$][\w$]*$/.test(reason) ? (new RegExp(`const ${reason} = ([^;]+);`).exec(code)?.[1] ?? '') : reason;
    if (!/recordWriteBlock/.test(reasonText) || !/fieldCopy\.closeProjectBlocked\(\)/.test(reasonText) || !/allClosed/.test(reasonText)) {
      f.push(`${PL}: the close slide's disabledReason must be the write block, then "Close every punch item first." while !allClosed`);
    }
    const status = bodyOf(code, 'handleStatusChange');
    if (/showAlert\(\s*'All punch items closed'|setTimeout\(/.test(status) || !/setAllClosedBanner\(true\)/.test(status)) f.push(`${PL}: the last closed item must raise the inline banner, never an Alert`);
    if (!/fieldCopy\.punchAllClosedBanner\(/.test(code)) f.push(`${PL}: the banner sentence is missing`);
    if (/router\.back\(\)/.test(bodyOf(code, 'commitCloseProject'))) f.push(`${PL}: commitCloseProject navigates away (router.back() belongs in onDone)`);
    if (!/router\.back\(\)/.test(bodyOf(code, 'onCloseProjectDone'))) f.push(`${PL}: onCloseProjectDone must go back after the result hold`);
    if (!/closeProjectDetailed\(projectId\)/.test(bodyOf(code, 'commitCloseProject'))) f.push(`${PL}: the close must be closeProjectDetailed(projectId)`);
    if (/updateProject\([^)]*status: 'closed'/.test(code)) f.push(`${PL}: a close through updateProject is back (no confirmed write behind it)`);
  }
  if (path === CB) {
    const b = bodyOf(code, 'commitFinalize');
    const at = b.indexOf('new Date().toISOString()');
    const w = b.indexOf('saveCloseoutBinderDetailed(');
    if (!(at >= 0 && w > at && /status: 'finalized',\s*finalizedAt: now/.test(b))) f.push(`${CB}: commitFinalize must take finalizedAt at release and write through saveCloseoutBinderDetailed`);
    // W2 integration (critic 2, issue 7): Home Passport can push the paywall or
    // raise an Alert, so it runs fire-and-forget AFTER the confirmed result has
    // played (onDone), never inside the write while the capsule animates.
    if (/runPassportGeneration\(/.test(b)) f.push(`${CB}: commitFinalize runs Home Passport inside the write (it must run in onDone, after the confirmed result played)`);
    const done = bodyOf(code, 'onFinalizeDone');
    const confirmedAt = done.indexOf("if (r.status === 'confirmed') {");
    const passAt = done.indexOf('void runPassportGeneration();');
    if (confirmedAt < 0 || passAt < confirmedAt) f.push(`${CB}: onFinalizeDone must run Home Passport fire-and-forget after a confirmed finalize (void runPassportGeneration())`);
    if (/setStatus\('finalized'\)/.test(b)) f.push(`${CB}: commitFinalize flips the bar before the result hold (setStatus belongs in onDone)`);
    // Save draft stays locked from release until onDone on a confirmed
    // finalize (a tap in the hold would upsert the row back to draft), and the
    // slide stays disabled while a Save draft is in flight (two upserts race).
    const tag = tags[0] ?? '';
    const resolved = attr(tag, 'onResolved') ?? '';
    if (resolved && !/r\.status !== 'confirmed'\) setFinalizeBusy\(false\)/.test(resolved)) f.push(`${CB}: onResolved clears finalizeBusy on a confirmed finalize (Save draft could undo it during the hold)`);
    if (!/saving \? fieldCopy\.binderFinalizeSaving\(\)/.test(attr(tag, 'disabledReason') ?? '')) f.push(`${CB}: the finalize slide must be disabled while a Save draft is in flight`);
    if (!/disabled=\{saving \|\| finalizeBusy\} testID="binder-save-draft"/.test(code)) f.push(`${CB}: Save draft must stay disabled while the finalize runs`);
  }
  if (path === WR) {
    const tag = tags[0] ?? '';
    if (attr(tag, 'tone') !== '"ink"' || attr(tag, 'resultIcon') !== '"lock"') f.push(`${WR}: the lock slide must be tone="ink" resultIcon="lock" (a neutral result)`);
    if (!/lockPeriodDetailed\(id\)/.test(bodyOf(code, 'commitLock'))) f.push(`${WR}: the lock must be lockPeriodDetailed`);
    const refusal = bodyOf(code, 'lockRefusal');
    if ((refusal.match(/\breturn\b/g) ?? []).length !== 5 || !/fieldCopy\.wipAlreadyLockedReason\(\)/.test(refusal) || !/target\.rows\.length === 0/.test(refusal)) {
      f.push(`${WR}: lockRefusal must keep its four refusals (no period and nothing to report, no period, an empty period, already locked) and one null`);
    }
    if (!/formatCalendarDay\(lockSheet\.periodEnd, \{ month: 'long', year: 'numeric' \}\)/.test(code)) f.push(`${WR}: the month must come from the period end through formatCalendarDay (i18n-ready)`);
    if (/\blockPeriod\(/.test(code)) f.push(`${WR}: the fire-and-forget lockPeriod is back`);
  }
  return f;
}

const PRONOUN = /\b(he|him|his|she|her|hers)\b/i;
const LABEL_NAME = /(SheetTitle|SlideLabel|Busy|SrLabel|SrConfirm|Title|Action|Queued)$/;

/** Each fieldCopy export, called for real with placeholder data, returns one whole sentence or label. */
export function checkCopyModule(mod: Record<string, unknown>, source: string): Fails {
  const f: Fails = [];
  const names = Object.keys(mod);
  if (names.length < 40) f.push(`${COPY}: expected every C1-C5 sentence as its own export (found ${names.length})`);
  for (const name of names) {
    const fn = mod[name];
    if (typeof fn !== 'function') { f.push(`${COPY}: ${name} is not a function (one function per sentence)`); continue; }
    const args = Array.from({ length: fn.length }, (_, i) => (i === 3 && /AfterBreak/.test(name) ? 30 : `Sample${i}`));
    const out = (fn as (...a: unknown[]) => unknown)(...args);
    if (typeof out !== 'string' || !out.trim()) { f.push(`${COPY}: ${name}() returns no text`); continue; }
    const lint = lintMomentCopy(out);
    if (lint.length) f.push(`${COPY}: ${name}() "${out}": ${lint.join(', ')}`);
    if (!/^[A-Z]/.test(out)) f.push(`${COPY}: ${name}() "${out}" does not start as a sentence`);
    if (PRONOUN.test(out)) f.push(`${COPY}: ${name}() "${out}" uses a pronoun for a person (name them, or "they")`);
    if (/\bjobs?\b/i.test(out)) f.push(`${COPY}: ${name}() "${out}" says job (VOICE glossary: project)`);
    if (/\bowner\b/i.test(out)) f.push(`${COPY}: ${name}() "${out}" says owner in GC-facing UI (VOICE glossary: client)`);
    if (LABEL_NAME.test(name)) {
      if (/\.$/.test(out)) f.push(`${COPY}: ${name}() "${out}" is a label and must not end with a period`);
    } else if (!/[.]$/.test(out)) {
      f.push(`${COPY}: ${name}() "${out}" is a sentence and must end with a period`);
    }
    // ONE return of ONE literal: never a sentence joined from pieces.
    const body = bodyOf(source, name);
    const returns = body.match(/\breturn\b/g) ?? [];
    if (returns.length !== 1 || !/return\s+(?:['"`]|tn?\(\s*'[a-z][\w.]*',\s*['"`])/.test(body) || /\breturn\s+[^;]*\+/.test(body)) {
      f.push(`${COPY}: ${name} must be one return of one string or template literal`);
    }
  }
  return f;
}

/** The sentences the spec names, word for word. */
export function checkSpecSentences(mod: typeof F): Fails {
  const f: Fails = [];
  const want: [string, string, string][] = [
    ['clockOutSummary', mod.clockOutSummary('Jose', '8h 12m', '8.20'), 'Jose has been on the clock 8h 12m. This ends the shift and records 8.20 hours.'],
    ['clockOutSlideLabel', mod.clockOutSlideLabel(), 'Slide to clock out'],
    ['clockedOutTitle', mod.clockedOutTitle('8h 12m'), 'Clocked out · 8h 12m'],
    ['clockOutQueued', mod.clockOutQueued(), 'Clocked out on this phone · sends when online'],
    ['clockOutAlready', mod.clockOutAlready(), 'Already clocked out. Nothing was changed.'],
    ['clockOutRefused', mod.clockOutRefused(), 'Not clocked out. Something went wrong on our side, so the shift is still open.'],
    ['clockOutTimeout', mod.clockOutTimeout('Jose'), "No answer yet. Check Jose's shift before trying again."],
    ['teamShiftCaption', mod.teamShiftCaption('Maria'), 'Maria logged this shift. It stays theirs, and their copy updates too.'],
    ['teamShiftNotOwn', mod.teamShiftNotOwn(), 'Only shifts on your own projects can be closed here.'],
    ['closeProjectSlideLabel', mod.closeProjectSlideLabel(), 'Slide to close the project'],
    ['closeProjectBlocked', mod.closeProjectBlocked(), 'Close every punch item first.'],
    ['punchAllClosedBanner', mod.punchAllClosedBanner('Oak St'), 'Every punch item on Oak St is closed.'],
    ['closeProjectAction', mod.closeProjectAction(), 'Close the project'],
    ['projectClosedNextBinder', mod.projectClosedNextBinder(), 'The closeout binder is ready to hand over.'],
    ['closeProjectTimeout', mod.closeProjectTimeout('Oak St'), 'No answer yet. Check Oak St before trying again.'],
    ['closeProjectTimeoutNoName', mod.closeProjectTimeoutNoName(), 'No answer yet. Check the project before trying again.'],
    ['clockOutTimeoutNoName', mod.clockOutTimeoutNoName(), 'No answer yet. Check the shift before trying again.'],
    ['binderFinalizeSlideLabel', mod.binderFinalizeSlideLabel(), 'Slide to finalize the binder'],
    ['binderFinalizedTitle', mod.binderFinalizedTitle(), 'Binder finalized · ready to hand over'],
    ['binderFinalizedNext', mod.binderFinalizedNext(), 'You can still edit the note and maintenance items.'],
    ['binderFinalizeRefused', mod.binderFinalizeRefused(), 'Not finalized. Something went wrong on our side.'],
    ['binderFinalizeTimeout', mod.binderFinalizeTimeout(), 'No answer yet. Check the binder before trying again.'],
    ['wipLockSlideLabel', mod.wipLockSlideLabel('September 2026'), 'Slide to lock September 2026'],
    ['wipLockedTitle', mod.wipLockedTitle('Sep 2026'), 'Period locked · Sep 2026'],
    ['wipLockedNext', mod.wipLockedNext(), 'Create a new period to make changes.'],
  ];
  for (const [name, got, exp] of want) if (got !== exp) f.push(`${COPY}: ${name}() = ${JSON.stringify(got)}, the spec says ${JSON.stringify(exp)}`);
  return f;
}

// ─────────────────────────────────────────────────────────────────────────────
// planted proofs
// ─────────────────────────────────────────────────────────────────────────────

function planted(ctx: MomentsCtx, real: Record<string, string>, copySrc: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  const red = (path: string, code: string, re: RegExp) => checkFieldSite(path, code).some((x) => re.test(x));
  const tt = real[TT];
  const pl = real[PL];
  const cb = real[CB];
  const wr = real[WR];
  const sub = (src: string, a: string, b: string) => (src.includes(a) ? src.replace(a, b) : `${src}\n/* planted-anchor-missing */`);
  out.push(['C1 red on planted: the out time taken at sheet open',
    red(TT, sub(tt, 'const outIso = new Date(releaseMs).toISOString();', 'const outIso = clockOutFor.clockIn;'), /at release/)]);
  out.push(['C1 red on planted: an Alert back in the commit',
    red(TT, sub(tt, 'setClockOutBusy(true);', "setClockOutBusy(true); showAlert('Clocked out', 'x');"), /commitClockOut raises an Alert/)]);
  out.push(['C1 red on planted: a success haptic after the write',
    red(TT, sub(tt, 'setClockOutBusy(true);', 'setClockOutBusy(true); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);'), /commitClockOut plays a haptic/)]);
  out.push(['C1 red on planted: the lg size',
    red(TT, sub(tt, 'size="md"', 'size="lg"'), /not size="md"/)]);
  out.push(['C1 red on planted: the Medium haptic on clock-out',
    red(TT, sub(tt, "if (action !== 'clock_out' && Platform.OS !== 'web') void Haptics.impactAsync", "if (Platform.OS !== 'web') void Haptics.impactAsync"), /Medium haptic must skip/)]);
  out.push(['C1 red on planted: the "Clock out?" Alert back',
    red(TT, `${tt}\nshowAlert('Clock out?', 'x');`, /retired moment text/)]);
  out.push(['C1 red on planted: idempotent true',
    red(TT, tt.replace(/idempotent: false/g, 'idempotent: true'), /not idempotent: false/)]);
  out.push(['C2 red on planted: the team close no longer refuses a shift off your projects',
    red(TT, sub(tt, "if (closed === 'not_own') return { status: 'refused', reason: fieldCopy.teamShiftNotOwn() };", ''), /teamShiftNotOwn/)]);
  out.push(['C2 red on planted: the caption fed teamLoggedByName (the lowercase "a teammate")',
    red(TT, sub(tt, 'teamRow?.loggedByName?.trim() || undefined);', 'teamRow ? teamLoggedByName(teamRow) : undefined);'), /raw name/)]);
  out.push(['C2 red on planted: the unnamed caption dropped',
    red(TT, sub(tt, ': fieldCopy.teamShiftCaptionUnnamed()}', ": 'A teammate'}"), /teamShiftCaptionUnnamed/)]);
  out.push(['C1 red on planted: an empty worker name spliced into the timeout',
    red(TT, sub(tt, "timeout: fieldCopy.clockOutTimeoutNoName() },\n  }), [clockOutFor]);", "timeout: fieldCopy.clockOutTimeout(clockOutFor?.workerName ?? '') },\n  }), [clockOutFor]);"), /renders a broken sentence/)]);
  out.push(['C1 red on planted: the no-name branch built from an inline string',
    red(TT, sub(tt, "timeout: fieldCopy.clockOutTimeoutNoName() },\n  }), [clockOutFor]);", "timeout: 'No answer yet.' },\n  }), [clockOutFor]);"), /every copy\.timeout/)]);
  out.push(['C3 red on planted: an empty project name spliced into the timeout',
    red(PL, sub(pl, "timeout: fieldCopy.closeProjectTimeoutNoName() },", "timeout: fieldCopy.closeProjectTimeout(project?.name ?? '') },"), /renders a broken sentence/)]);
  out.push(['C3 red on planted: the close slide enabled with items open',
    red(PL, sub(pl, "(allClosed ? null : fieldCopy.closeProjectBlocked())", 'null'), /disabledReason must be/)]);
  out.push(['C3 red on planted: router.back() inside the write',
    red(PL, sub(pl, 'const outcome = await closeProjectDetailed(projectId);', 'const outcome = await closeProjectDetailed(projectId); router.back();'), /navigates away/)]);
  out.push(['C3 red on planted: the last-item Alert back',
    red(PL, sub(pl, 'setAllClosedBanner(true);', "setTimeout(() => { showAlert('All punch items closed', 'x'); }, 250);"), /inline banner|retired moment text/)]);
  out.push(['C1 red on planted: the clock-out sheet lets go in the result hold',
    red(TT, sub(tt, "onResolved={(r) => { if (r.status !== 'confirmed' && r.status !== 'queued') setClockOutBusy(false); }}", 'onResolved={() => setClockOutBusy(false)}'), /onResolved clears busy on a confirmed or queued result/)]);
  out.push(['C2 red on planted: the out-time sheet lets go in the result hold',
    red(TT, sub(tt, "onResolved={(r) => { if (r.status !== 'confirmed' && r.status !== 'queued') setOutBusy(false); }}", 'onResolved={() => setOutBusy(false)}'), /onResolved clears busy on a confirmed or queued result/)]);
  out.push(['C3 red on planted: the close sheet lets go in the result hold',
    red(PL, sub(pl, "onResolved={(r) => { if (r.status !== 'confirmed' && r.status !== 'queued') setCloseBusy(false); }}", 'onResolved={() => setCloseBusy(false)}'), /onResolved clears busy on a confirmed or queued result/)]);
  out.push(['C5 red on planted: the lock sheet lets go in the result hold',
    red(WR, sub(wr, "onResolved={(r) => { if (r.status !== 'confirmed' && r.status !== 'queued') setLockBusy(false); }}", 'onResolved={() => setLockBusy(false)}'), /onResolved clears busy on a confirmed or queued result/)]);
  // The slide says its result (sayCommitResult): no second toast, no opt-out without a late handler, and the sheet held while busy.
  out.push(['C1 red on planted: the per-site after-unmount toast back',
    red(TT, `${tt}\nfunction momentAfterUnmount(r: CommitResult): void { if (r.status === 'confirmed') nailIt(r.title); }`, /per-site after-unmount toast is back/)]);
  out.push(['C1 red on planted: a slide handler that toasts what the slide says',
    red(TT, sub(tt, 'onDone={() => { setClockOutBusy(false); setClockOutFor(null); }}', 'onDone={() => { setClockOutBusy(false); setClockOutFor(null); }}\n            onResultAfterUnmount={(r) => { if (r.status === \'confirmed\') nailIt(r.title); }}'), /toasts the result the slide already says/)]);
  out.push(['C1 red on planted: say={false} with no late handler',
    red(TT, sub(tt, 'testID="clock-out-slide"', 'say={false}\n            testID="clock-out-slide"'), /opts out of saying its result/)]);
  out.push(['C1 red on planted: the clock-out sheet dismissible while busy',
    red(TT, sub(tt, 'dismissible={!clockOutBusy}', ''), /dismissible=\{!clockOutBusy\}/)]);
  out.push(['C3 red on planted: the close sheet dismissible while busy',
    red(PL, sub(pl, 'dismissible={!closeBusy}', 'dismissible'), /dismissible=\{!closeBusy\}/)]);
  out.push(['C5 red on planted: the lock sheet dismissible while busy',
    red(WR, sub(wr, 'dismissible={!lockBusy}', ''), /dismissible=\{!lockBusy\}/)]);
  const subRe = (src: string, a: RegExp, b: string) => (a.test(src) ? src.replace(a, b) : `${src}\n/* planted-anchor-missing */`);
  out.push(['C4 red on planted: Home Passport runs inside the write, during the capsule',
    red(CB, subRe(cb, /setFinalizedAt\(now\);/, 'setFinalizedAt(now); void runPassportGeneration();'), /runs Home Passport inside the write/)]);
  out.push(['C4 red on planted: Home Passport never runs after the finalize',
    red(CB, subRe(cb, /(setStatus\('finalized'\);\s*)void runPassportGeneration\(\);/, '$1'), /onFinalizeDone must run Home Passport/)]);
  out.push(['C4 red on planted: finalizedAt taken outside the commit',
    red(CB, sub(cb, "status: 'finalized',\n      finalizedAt: now,", "status: 'finalized',\n      finalizedAt,"), /finalizedAt at release/)]);
  out.push(['C4 red on planted: the "Couldn\'t finalize" Alert back',
    red(CB, sub(cb, 'setFinalizeBusy(true);', "setFinalizeBusy(true); showAlert(\"Couldn't finalize the binder\", 'x');"), /retired moment text|raises an Alert/)]);
  out.push(['C4 red on planted: onResolved frees Save draft on a confirmed finalize',
    red(CB, sub(cb, "(r) => { if (r.status !== 'confirmed') setFinalizeBusy(false); }", '() => setFinalizeBusy(false)'), /Save draft could undo/)]);
  out.push(['C4 red on planted: the slide live while a Save draft runs',
    red(CB, sub(cb, " : saving ? fieldCopy.binderFinalizeSaving() : null}", ' : null}'), /Save draft is in flight/)]);
  out.push(['C5 red on planted: the lock slide in the brand tone',
    red(WR, sub(wr, 'tone="ink"', 'tone="brand"'), /tone="ink" resultIcon="lock"/)]);
  out.push(['C5 red on planted: the already-locked refusal dropped',
    red(WR, sub(wr, 'if (target.lockedAt) return fieldCopy.wipAlreadyLockedReason();', ''), /four refusals/)]);
  out.push(['C5 red on planted: the Warning haptic back in handleLock',
    red(WR, sub(wr, 'const target = selectedPeriodId', 'void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);\n    const target = selectedPeriodId'), /handleLock plays a haptic/)]);

  // fieldCopy: a pronoun, a fragment, a Title Case line, a missing period, "job".
  const copyRed = (mod: Record<string, unknown>, src: string, re: RegExp) => checkCopyModule(mod, src).some((x) => re.test(x));
  const base = { ...(F as unknown as Record<string, unknown>) };
  out.push(['copy red on planted: a pronoun for the worker',
    copyRed({ ...base, clockOutAlready: () => 'He was already clocked out. Nothing was changed.' }, copySrc, /pronoun/)]);
  out.push(['copy red on planted: a sentence joined from pieces',
    copyRed(base, copySrc.replace("return t('field.time.moment.clockOutAlready', 'Already clocked out. Nothing was changed.');", "return t('field.time.moment.clockOutAlready', 'Already clocked out.') + ' Nothing was changed.';"), /one return of one string/)]);
  out.push(['copy red on planted: Title Case',
    copyRed({ ...base, closeProjectAction: () => 'Close The Project Now' }, copySrc, /Title Case/)]);
  out.push(['copy red on planted: an outcome sentence with no period',
    copyRed({ ...base, clockOutRefused: () => 'Not clocked out' }, copySrc, /must end with a period/)]);
  out.push(['copy red on planted: job instead of project',
    copyRed({ ...base, teamShiftNotOwn: () => 'Only shifts on your own jobs can be closed here.' }, copySrc, /says job/)]);
  out.push(['copy red on planted: owner in GC-facing UI',
    copyRed({ ...base, binderFinalizedTitle: () => 'Binder finalized · ready for the owner' }, copySrc, /says owner/)]);
  out.push(['spec red on planted: a changed timeout sentence',
    checkSpecSentences({ ...F, clockOutTimeout: () => 'No answer yet. Check the shift before trying again.' } as typeof F).length > 0]);
  void ctx;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function run(ctx: MomentsCtx): void {
  const { ok, read, stripComments } = ctx;
  const real: Record<string, string> = {};
  for (const p of [TT, PL, CB, WR]) real[p] = stripComments(read(p));
  const copySrc = stripComments(read(COPY));

  for (const [name, pass] of planted(ctx, real, copySrc)) ok(`field ${name}`, pass);

  for (const p of [TT, PL, CB, WR]) {
    const fails = real[p] ? checkFieldSite(p, real[p]) : [`${p} is missing`];
    ok(`field ${p}: the moment replaces the Alert, writes at release, keeps its disabled reasons and says only what the write did`, fails.length === 0, fails.join('\n'));
  }
  const copyFails = copySrc ? checkCopyModule(F as unknown as Record<string, unknown>, copySrc) : [`${COPY} is missing`];
  ok(`field ${COPY}: every export returns one whole sentence or label, lints clean, names people and says project`, copyFails.length === 0, copyFails.join('\n'));
  const specFails = checkSpecSentences(F);
  ok(`field ${COPY}: the sentences the spec names, word for word`, specFails.length === 0, specFails.join('\n'));
}
