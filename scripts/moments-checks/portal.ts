// scripts/moments-checks/portal.ts: the client portal's signing moments
// (wave-next W3, lane MOMPORTAL). Loaded by scripts/validate-moments.ts.
//
// What it holds the portal to:
//   P1 moments.js carries the app's numbers: every spring, timing, gesture and
//      seal value equals utils/moments/motionSpec.ts / signTimeline.ts, and the
//      solver steps at a fixed 1/240 s.
//   P2 moments.js's gesture maths is the app's, EXECUTED side by side with
//      utils/moments/capsuleMath.ts on a grid; every spring settles.
//   P3 the port's shape: setPointerCapture, touch-action none on the head only,
//      a reduced-motion media query, only transform / opacity (and the seal's
//      stroke-dashoffset) animate, no colour literal, no "MAGE ID" on the seal.
//   P4 retired: no alert( on a signing path, no fireWebConfetti anywhere, no
//      '#FF6A1A', no "Signing…" / "Sealing…" button text.
//   P5 the seal only on the server's yes: {ok: true} for the contract,
//      `recorded: true` for a change order or a proposal; every other answer
//      is a line, never a seal (text rules AND an executed jsdom run).
//   P6 no signing result line says "notified".
//   P7 "(server time)" only next to a time the server stored.
//   P8 the contract fine print (the seven "tapping Sign" copies, and the one
//      English slide sentence D-7 added), both e-sign disclosures and the
//      proposal note are byte-identical to pinned hashes. D-7 (founder,
//      2026-09-28): the counter-sign is the slide ONLY in English with
//      moments.js loaded, under the slide sentence; the other five languages,
//      and English without moments.js, keep the tap button under "tapping
//      Sign". Each control sits with the one sentence that describes it.
//   P9 every NEW string is in the English table and in no other language
//      table (the page's CONTRACT_COPY, COMMERCIAL_PASSPORT_STRINGS, and every
//      bundle in utils/portalLanguages.ts).
//
// MUTATION PROOF: set PORTAL_MUT_DIR to a directory that mirrors repo paths;
// any file found there is read INSTEAD of the repo copy.

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { MomentsCtx } from '../validate-moments';
import { MOMENT_SPRING, MOMENT_TIMING, CAPSULE_RULES, CAPSULE_GEOMETRY } from '../../utils/moments/motionSpec';
import { SEAL_TIMING, LINE_GEOMETRY } from '../../utils/moments/signTimeline';
import { rubber as appRubber, resist as appResist, shouldCommit as appShouldCommit, lockStep as appLockStep } from '../../utils/moments/capsuleMath';
import { lintMomentCopy } from '../../utils/moments/copy';

const PAGE = 'marketing/portal/index.html';
const JS = 'marketing/portal/moments.js';
const CSS = 'marketing/portal/moments.css';
const LANGS = 'utils/portalLanguages.ts';

/**
 * Every string key this lane added to the page. English only until a reviewed
 * human translation lands: the list is the translator hand-off.
 */
export const NEW_PORTAL_KEYS = [
  'contractSignNameReason', 'contractSignBusy', 'contractSignAlready', 'contractSignedSeal', 'contractSealChip',
  'contractSignDeniedSigned', 'contractSignDeniedPending', 'contractSignDeniedLink',
  'momentRecordedAt', 'momentNoAnswer', 'momentHint', 'momentArmed', 'momentBusy', 'momentCancelled',
  'esignSlideApprove', 'esignSlideAccept', 'esignSealApproved', 'esignSealAccepted',
  'esignCOApproved', 'esignProposalAccepted', 'esignCONotRecorded', 'esignProposalNotRecorded',
  'esignNeedName', 'esignNeedSignature', 'esignNeedConsent',
  // D-7: the contract slide's label and its consent sentence (English only).
  'contractSlideLabel', 'contractFinePrintSlide',
] as const;
/** Two of them are sentences the page already said (moved out of alert() calls, words unchanged). */
const MOVED_SENTENCES = new Set(['contractSignDeniedPending', 'contractSignDeniedLink']);
/** The seal's chip words: a label, not a sentence. */
const CHIP_WORDS = new Set(['contractSealChip', 'esignSealApproved', 'esignSealAccepted']);

/** sha256 of the consent / fine-print texts on 2026-09-28 (base 616842c8). Moves only with D-7 approval. */
export const PINNED = {
  fallbackFinePrint: '8c20255a7b769eb2179e87b7ced9afe3a1d27cba72e1bfc65388b2fbe63f8ad7',
  contractCopyFinePrint: 'b0c3f55a9fcd4ae064687ec043c195a3904565596742e64513f9acfdd418f7a8',
  esign: 'fd347f8ed5bd8934c14563241ed7407dc95acf499ea1e2a1666d3114c3872eaa',
  proposal: 'd849236eb869597138afb69fa7de634f7e2c4f9b22778f43b34637d38d0b8da2',
  note: '78fb1382fcd46b50766c58ee500e2fae6098961f580d4b85c580bfcf43424bab',
  /** D-7 (founder, 2026-09-28): the English consent line under the slide. */
  slideFinePrint: '2ea7c78ac6592109f90ec4748586f674d12d57156c1bc9ac3f1120ee88e9a512',
} as const;

const MUT = process.env.PORTAL_MUT_DIR;
function readF(ctx: MomentsCtx, rel: string): string {
  if (MUT && existsSync(join(MUT, rel))) return readFileSync(join(MUT, rel), 'utf8');
  return ctx.read(rel);
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Blank <!-- --> and JS comments, keeping strings. */
function code(ctx: MomentsCtx, src: string): string {
  return ctx.stripComments(src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' ')));
}
function between(src: string, a: string, b: string): string {
  const i = src.indexOf(a);
  if (i < 0) return '';
  const j = src.indexOf(b, i + a.length);
  return j < 0 ? '' : src.slice(i, j);
}
/** The text a `var NAME = '…' + '…';` concatenation evaluates to. */
function joinedVar(src: string, name: string): string {
  const a = src.indexOf(`var ${name} =`);
  if (a < 0) return '';
  const body = src.slice(a, src.indexOf(';', a));
  return (body.match(/'([^']*)'/g) ?? []).map((x) => x.slice(1, -1)).join('');
}
/** FALLBACK_STRINGS as key -> value (single-quoted entries). */
function fallbackTable(src: string): Map<string, string> {
  const block = between(src, 'var FALLBACK_STRINGS = {', '\n  };');
  return new Map([...block.matchAll(/^\s{4}(\w+): '((?:[^'\\]|\\.)*)',?$/gm)].map((m) => [m[1], m[2].replace(/\\'/g, "'")]));
}

type Moments = {
  SPRING: Record<string, { stiffness: number; damping: number; mass: number }>;
  TIMING: Record<string, number>; RULES: Record<string, number>; GEOMETRY: Record<string, number>; SEAL: Record<string, number>;
  SEAL_BOX: number; STEP: number;
  rubber(x: number, d: number): number; resist(x: number, T: number): number;
  lockStep(l: boolean, p: number, th: number): boolean;
  shouldCommit(a: { locked: boolean; progress: number; vx: number; f: number; T: number }): boolean;
  simulateSpring(cfg: { stiffness: number; damping: number; mass: number }, from: number, to: number, v0: number, maxS: number): { steps: number; peak: number; x: number; settled: boolean };
};
/** moments.js executed with a bare window (no DOM needed for the maths). */
function loadMoments(src: string): Moments | null {
  try {
    const win: Record<string, unknown> = {};
    new Function('window', src)(win);
    return (win.MageMoments as Moments) ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// the text rules, pure (proven on planted pages below)
// ─────────────────────────────────────────────────────────────────────────────

/** P4 + P5 + P6 + P7 + P8(tap) over the page's comment-stripped code. Returns failures. */
export function pageRules(pageCode: string, fullPage: string): string[] {
  const f: string[] = [];
  // The contract handler: from the click listener that owns [data-action="sign-contract"]
  // to showContractSignNote (comments are stripped, so anchor on code).
  const signAt = pageCode.indexOf(`ev.target.closest('[data-action="sign-contract"]')`);
  const clickAt = signAt < 0 ? -1 : pageCode.lastIndexOf("document.addEventListener('click'", signAt);
  // D-7: the tap handler ends where the shared request and the line begin;
  // the line's commit runs up to showContractSignNote.
  const lineAt = clickAt < 0 ? -1 : pageCode.indexOf('function postContractSignature(', clickAt);
  const commitAt = lineAt < 0 ? -1 : pageCode.indexOf('function commitContractLine(', lineAt);
  const noteAt = commitAt < 0 ? -1 : pageCode.indexOf('function showContractSignNote(', commitAt);
  const contract = clickAt >= 0 && noteAt > clickAt ? pageCode.slice(clickAt, noteAt) : '';
  const tap = clickAt >= 0 && lineAt > clickAt ? pageCode.slice(clickAt, lineAt) : '';
  const lineCommit = commitAt >= 0 && noteAt > commitAt ? pageCode.slice(commitAt, noteAt) : '';
  const docSign = between(pageCode, 'function showDocSignModal(opts) {', 'function showCOSignModal(opts) {');
  const coHandler = between(pageCode, 'function handleCODecision(', 'function bindCOHandlers(');
  const propHandler = between(pageCode, 'function handleProposalDecision(', 'function bindProposalHandlers(');
  if (!contract || !tap || !lineCommit || !docSign || !coHandler || !propHandler) {
    f.push(`P0 a signing path is missing (contract ${!!contract}, tap ${!!tap}, line ${!!lineCommit}, modal ${!!docSign}, CO ${!!coHandler}, proposal ${!!propHandler})`);
    return f;
  }
  const paths: [string, string][] = [['contract counter-sign', contract], ['e-sign sheet', docSign], ['CO decision', coHandler], ['proposal decision', propHandler]];
  // P4
  for (const [n, s] of paths) if (/\balert\s*\(/.test(s)) f.push(`P4 alert( on the ${n} path`);
  if (/fireWebConfetti|web-confetti/.test(fullPage)) f.push('P4 fireWebConfetti / web-confetti is still in the page');
  if (/#FF6A1A/i.test(fullPage)) f.push("P4 the retired '#FF6A1A' is in the page");
  for (const w of ['Signing…', 'Sealing…', 'Signing...', 'Sealing...']) if (fullPage.includes(w)) f.push(`P4 "${w}" button text is still in the page`);
  // P5 contract (the tap): the seal is drawn only after the already-answer and the ok-check returned.
  const okGate = tap.indexOf('if (!res || res.ok !== true) {');
  const firstSeal = tap.indexOf('drawContractSeal(');
  const already = tap.indexOf('if (res && res.already === true) {');
  const catchAt = tap.lastIndexOf('.catch(function (err)');
  if (okGate < 0) f.push('P5 the contract handler does not check the server\'s {ok: true} before sealing');
  if (already < 0) f.push('P5 the contract handler lost its {already: true} branch');
  if (firstSeal < 0) f.push('P5 the contract handler never draws the seal');
  if (okGate >= 0 && firstSeal >= 0 && (firstSeal < okGate || firstSeal < already)) f.push('P5 the contract seal is drawn before the {ok: true} check');
  if (catchAt < 0) f.push('P5 the contract tap lost its failure path');
  if (catchAt >= 0 && /drawContractSeal\(|keepContractSeal\(|sealResult\(|contractSealOpts\(/.test(tap.slice(catchAt))) f.push('P5 a seal in the contract failure path');
  if (!/if \(!res \|\| res\.ok !== true\) \{\s*setContractSignLine\(contractId, t\('momentNoAnswer'\), 'error'\);\s*return;\s*\}/.test(tap)) f.push('P5 a 2xx without {ok: true} must read "No answer yet" and return');
  // P5 contract (the line, D-7): 'confirmed' once, after the already-answer
  // and the ok-check; the rejection path never seals; no answer locks it.
  const lOk = /if \(!res \|\| res\.ok !== true\) \{\s*return \{ status: 'timeout', reason: t\('momentNoAnswer'\) \};\s*\}/.exec(lineCommit);
  const lAlready = lineCommit.indexOf('if (res && res.already === true) {');
  const lConfirmed = [...lineCommit.matchAll(/status: 'confirmed'/g)].map((m) => m.index ?? -1);
  const lReject = lineCommit.indexOf('}, function (err) {');
  if (!lOk) f.push('P5 the contract line must read a 2xx without {ok: true} as no answer (timeout)');
  if (lAlready < 0) f.push('P5 the contract line lost its {already: true} branch');
  if (lReject < 0) f.push('P5 the contract line lost its failure path');
  if (lConfirmed.length !== 1) f.push(`P5 the contract line answers 'confirmed' ${lConfirmed.length} times (want exactly 1)`);
  else if (!lOk || lAlready < 0 || lConfirmed[0] < lOk.index || lConfirmed[0] < lAlready) f.push('P5 the contract line seals before the {ok: true} check');
  if (lAlready >= 0 && lOk && /contractSealOpts\(|sealResult\(|drawContractSeal\(|'confirmed'/.test(lineCommit.slice(lAlready, lOk.index))) f.push('P5 a seal on the contract line\'s {already: true} answer');
  if (lReject >= 0 && /contractSealOpts\(|sealResult\(|drawContractSeal\(|keepContractSeal\(|'confirmed'/.test(lineCommit.slice(lReject))) f.push('P5 a seal in the contract line failure path');
  if (!/if \(!\(err && \/Sign failed: 4\/\.test\(String\(err\.message\)\)\)\) \{\s*return \{ status: 'timeout', reason: t\('momentNoAnswer'\) \};/.test(lineCommit)) f.push('P5 no answer on the contract line must read "No answer yet" and lock (timeout)');
  // P5 CO: ui.confirmed once, after the recorded:false return and the !== true guard.
  const coConfirmed = [...coHandler.matchAll(/ui\.confirmed\(/g)].map((m) => m.index ?? -1);
  const coFalse = coHandler.indexOf('if (res.recorded === false) {');
  const coGuard = coHandler.indexOf('if (isApprove && res.recorded !== true) {');
  if (coConfirmed.length !== 1) f.push(`P5 the CO decision calls ui.confirmed ${coConfirmed.length} times (want exactly 1)`);
  if (coFalse < 0 || coGuard < 0) f.push('P5 the CO decision lost its recorded:false branch or its recorded:true gate');
  else if (coConfirmed[0] < coGuard || coConfirmed[0] < coFalse) f.push('P5 the CO seal comes before the recorded gate');
  if (!/if \(isApprove && res\.recorded !== true\) \{\s*ui\.timeout\(t\('momentNoAnswer'\)\);/.test(coHandler)) f.push('P5 a CO answer without recorded:true must read "No answer yet"');
  if (/\.catch\([\s\S]*ui\.confirmed\(/.test(coHandler)) f.push('P5 a CO seal in the failure path');
  // P5 proposal: ui.confirmed only inside `decision === 'accepted' && wasRecorded`, after the unknown guard.
  const pConfirmed = [...propHandler.matchAll(/ui\.confirmed\(/g)].map((m) => m.index ?? -1);
  const pGate = propHandler.indexOf("if (decision === 'accepted' && wasRecorded) {");
  const pUnknown = propHandler.indexOf("if (decision === 'accepted' && res.recorded !== true && res.recorded !== false) {");
  if (pConfirmed.length !== 1) f.push(`P5 the proposal decision calls ui.confirmed ${pConfirmed.length} times (want exactly 1)`);
  if (pGate < 0 || pUnknown < 0) f.push('P5 the proposal decision lost its recorded gate');
  else if (!(pUnknown < pGate && pGate < pConfirmed[0] && pConfirmed[0] - pGate < 80)) f.push('P5 the proposal seal is not inside the recorded gate');
  // P5 the sheet: 'confirmed' is produced only by ui.confirmed.
  const confirmedTokens = [...docSign.matchAll(/status: 'confirmed'/g)].length;
  if (confirmedTokens !== 1 || !/confirmed: function \(r\) \{\s*answer\(\{\s*status: 'confirmed'/.test(docSign)) f.push("P5 the sheet makes status 'confirmed' somewhere other than ui.confirmed");
  if (!/catch \(e\) \{\s*answer\(\{ status: 'timeout'/.test(docSign)) f.push('P5 a throw inside onConfirm must read as no answer (timeout)');
  // An answer object with a then() is a thenable: resolving the line's promise
  // with it runs it at once (the sheet closed before the seal was seen).
  for (const [n, s] of paths) if (/\bthen:\s/.test(s)) f.push(`P5 a \`then:\` key in an answer object on the ${n} path (a thenable resolves itself)`);
  // P6
  for (const [n, s] of paths) if (/\bnotified\b/i.test(s.replace(/notifyEvent/g, ''))) f.push(`P6 "notified" on the ${n} path`);
  // P7: every recordedAt is the server's.
  const recAt = [...pageCode.matchAll(/recordedAt:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
  const allowedRec = new Set(['signedAt', 'res.sealed_at || null', '(r && r.recordedAt) || null']);
  for (const r of recAt) if (!allowedRec.has(r)) f.push(`P7 recordedAt: ${r} is not a server time`);
  if (!/drawContractSeal\(signHost, contractId, null, true\)/.test(tap)) f.push('P7 the first contract seal must carry no time (the RPC returns none)');
  if (!/seal: contractSealOpts\(null, true\)/.test(lineCommit)) f.push('P7 the contract line\'s seal must carry no time (the RPC returns none)');
  const snapTime = /var signedAt = \(fc && fc\.id === contractId && fc\.status === 'signed' && fc\.homeownerSignedAt\) \|\| null;/g;
  if ((contract.match(snapTime) ?? []).length !== 2) f.push("P7 the contract's Recorded time (tap and line) must come from the refreshed snapshot's homeownerSignedAt");
  if (/new Date\(\)/.test(contract)) f.push('P7 the contract handler reads the device clock');
  const serverTime = (fullPage.match(/\(server time\)/g) ?? []).length;
  if (serverTime !== 1) f.push(`P7 "(server time)" appears ${serverTime} times in the page (want 1: the momentRecordedAt template)`);
  // P8 D-7: the slide only in English with moments.js; the tap everywhere
  // else; each control with the one sentence that describes it.
  if (!/'<button type="button" class="contract-sign-btn" data-action="sign-contract"/.test(pageCode)) f.push('P8 the tap button must stay (the other five languages, and English without moments.js)');
  if (/MomentLine/.test(tap)) f.push('P8 the tap handler must stay a tap');
  const uses = between(pageCode, 'function contractUsesLine() {', '\n  }');
  if (!/var lang = String\(d\.language \|\| 'en'\)\.slice\(0, 2\)\.toLowerCase\(\);/.test(uses) || !/return lang === 'en' && !!\(M && M\.MomentLine\);/.test(uses)) f.push('P8 D-7: the slide must be English-only and need moments.js (contractUsesLine)');
  const card = between(pageCode, 'function renderContractCard(c) {', 'function renderSelections(');
  const slideHost = card.indexOf('data-contract-line="');
  const slideFp = card.indexOf(`data-contract-fine-print="slide">' + esc(t('contractFinePrintSlide'))`);
  const tapBtn = card.indexOf('data-action="sign-contract"');
  const tapFp = card.indexOf(`data-contract-fine-print="tap">' + esc(contractCopy('finePrint'))`);
  if (!/var slide = contractUsesLine\(\);/.test(card) || !/\(slide\s*\?\s*'<div class="contract-line-name"/.test(card)) f.push('P8 the contract card must choose the slide through contractUsesLine()');
  if ([slideHost, slideFp, tapBtn, tapFp].some((i) => i < 0) || !(slideHost < slideFp && slideFp < tapBtn && tapBtn < tapFp)) f.push('P8 each control must sit with its own fine print (the line with the slide sentence, the button with "tapping Sign")');
  if ((pageCode.match(/contractFinePrintSlide/g) ?? []).length !== 2) f.push('P8 the slide sentence may appear only in the English table and under the line');
  return f;
}

/** P8 hashes + P9 English-only keys. */
export function copyRules(page: string, langs: string): string[] {
  const f: string[] = [];
  const fb = fallbackTable(page);
  const fine = fb.get('contractFinePrint') ?? '';
  if (sha(fine) !== PINNED.fallbackFinePrint) f.push('P8 FALLBACK contractFinePrint changed (consent text: D-7 decision needed)');
  if (sha(fb.get('contractFinePrintSlide') ?? '') !== PINNED.slideFinePrint) f.push('P8 FALLBACK contractFinePrintSlide changed (the English consent line under the slide)');
  const cc = between(page, 'var CONTRACT_COPY = {', 'function contractCopy(');
  const fps = [...cc.matchAll(/finePrint: (['"])((?:(?!\1)[^\\]|\\.)*)\1,/g)].map((m) => m[2]);
  if (fps.length !== 6 || sha(fps.join('\n')) !== PINNED.contractCopyFinePrint) f.push(`P8 CONTRACT_COPY finePrint changed in some language (${fps.length} found)`);
  if (sha(joinedVar(page, 'ESIGN_DISCLOSURE_TEXT')) !== PINNED.esign) f.push('P8 ESIGN_DISCLOSURE_TEXT changed');
  if (sha(joinedVar(page, 'PROPOSAL_DISCLOSURE_TEXT')) !== PINNED.proposal) f.push('P8 PROPOSAL_DISCLOSURE_TEXT changed');
  if (sha(joinedVar(page, 'PROPOSAL_NOT_A_CONTRACT_NOTE')) !== PINNED.note) f.push('P8 PROPOSAL_NOT_A_CONTRACT_NOTE changed');
  // P9
  const commercial = between(page, 'var COMMERCIAL_PASSPORT_STRINGS = {', '\n  };');
  for (const k of NEW_PORTAL_KEYS) {
    const v = fb.get(k);
    if (!v) { f.push(`P9 ${k} is missing from FALLBACK_STRINGS (English)`); continue; }
    const keyRe = new RegExp(`\\b${k}\\b`);
    if (keyRe.test(cc)) f.push(`P9 ${k} appears in CONTRACT_COPY (a non-English table)`);
    if (keyRe.test(commercial)) f.push(`P9 ${k} appears in COMMERCIAL_PASSPORT_STRINGS`);
    if (keyRe.test(langs)) f.push(`P9 ${k} appears in utils/portalLanguages.ts (the translated bundles)`);
    if (/notif/i.test(v)) f.push(`P6 ${k} says "${v}"`);
    if (!MOVED_SENTENCES.has(k) && !CHIP_WORDS.has(k)) {
      const sample = v.replace('{amount}', '+$4,200.00').replace('{number}', '4').replace('{date}', 'Sep 27, 2026').replace('{time}', '2:41 PM');
      const lint = lintMomentCopy(sample);
      if (lint.length) f.push(`P9 ${k} "${v}": ${lint.join(', ')}`);
    }
  }
  if (/\(server time\)/.test(fb.get('momentRecordedAt') ?? '') === false) f.push('P7 momentRecordedAt must label the time "(server time)"');
  return f;
}

/** P3 over moments.js + moments.css text. */
export function portRules(js: string, css: string, jsCode: string): string[] {
  const f: string[] = [];
  if (!/setPointerCapture\(/.test(jsCode)) f.push('P3 moments.js never captures the pointer');
  const touchNone = [...css.matchAll(/([^{}]+)\{[^}]*touch-action:\s*none/g)].map((m) => m[1].trim());
  if (touchNone.length !== 1 || touchNone[0] !== '.mp-head') f.push(`P3 touch-action: none must sit on the head only (found on ${JSON.stringify(touchNone)})`);
  if (!/@media \(prefers-reduced-motion: reduce\)/.test(css)) f.push('P3 moments.css has no prefers-reduced-motion media query');
  if (!/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(jsCode)) f.push('P3 moments.js never reads prefers-reduced-motion');
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)) {
    const props = [...m[2].matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]);
    const bad = props.filter((p) => !['transform', 'opacity', 'stroke-dashoffset'].includes(p));
    if (bad.length) f.push(`P3 @keyframes ${m[1]} animates ${bad.join(', ')}`);
  }
  for (const m of css.matchAll(/transition:\s*([^;]+);/g)) {
    const props = m[1].replace(/\([^)]*\)/g, '').split(',').map((x) => x.trim().split(/\s+/)[0]);
    const bad = props.filter((p) => !['transform', 'opacity'].includes(p));
    if (bad.length) f.push(`P3 a transition moves ${bad.join(', ')}`);
  }
  const styleWrites = [...jsCode.matchAll(/\.style\.(\w+)\s*=/g)].map((m) => m[1]);
  const badWrites = styleWrites.filter((p) => !['transform', 'opacity', 'strokeDasharray'].includes(p));
  if (badWrites.length) f.push(`P3 moments.js writes style.${badWrites.join(', style.')}`);
  if (/#[0-9a-f]{3,8}\b/i.test(css.replace(/\/\*[\s\S]*?\*\//g, ''))) f.push('P3 a colour literal in moments.css (tokens only)');
  if (/'#[0-9a-f]{3,8}'|"#[0-9a-f]{3,8}"/i.test(jsCode)) f.push('P3 a colour literal in moments.js');
  if (/MAGE ID/.test(jsCode)) f.push('P3 "MAGE ID" in moments.js (never on a seal)');
  if (/\bconfetti\b/i.test(jsCode) || /\bconfetti\b/i.test(css)) f.push('P3 confetti in the port');
  if (!/var STEP = 1 \/ 240;/.test(jsCode)) f.push('P1 the solver step is not a fixed 1 / 240 s');
  return f;
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function run(ctx: MomentsCtx): Promise<void> {
  const { ok } = ctx;
  const page = readF(ctx, PAGE);
  const js = readF(ctx, JS);
  const css = readF(ctx, CSS);
  const langs = readF(ctx, LANGS);
  ok('P0 marketing/portal/index.html, moments.js and moments.css are present', !!page && !!js && !!css);
  if (!page || !js || !css) return;
  const pageCode = code(ctx, page);
  const jsCode = ctx.stripComments(js);

  // P0 the page loads the port (versioned: netlify caches *.js / *.css for a year) and falls back without it.
  ok('P0 the page links moments.css and loads moments.js before its own script, both with ?v=',
    /<link href="\/portal\/moments\.css\?v=[\w-]+" rel="stylesheet" \/>/.test(page)
    && /<script src="\/portal\/moments\.js\?v=[\w-]+"><\/script>\s*<script>/.test(page));
  ok('P0 without moments.js the approve path keeps a working button and the contract a plain note',
    /var useLine = isApprove && !!\(Moments && Moments\.MomentLine && lineHost\);/.test(pageCode)
    && /if \(M && M\.sealResult\) \{/.test(pageCode));

  // P1 numbers.
  const M = loadMoments(js);
  ok('P1 moments.js runs and exports MageMoments', !!M);
  if (M) {
    const springDrift = Object.entries(MOMENT_SPRING).filter(([k, v]) => JSON.stringify(M.SPRING[k]) !== JSON.stringify(v)).map(([k]) => k);
    const extraSprings = Object.keys(M.SPRING).filter((k) => !(k in MOMENT_SPRING));
    ok('P1 every spring equals utils/moments/motionSpec.ts MOMENT_SPRING', springDrift.length === 0 && extraSprings.length === 0, `drift ${springDrift} extra ${extraSprings}`);
    const T = MOMENT_TIMING as unknown as Record<string, number>;
    const timingDrift = Object.entries(M.TIMING).filter(([k, v]) => T[k] !== v).map(([k, v]) => `${k} ${v} vs ${T[k]}`);
    ok(`P1 every timing equals MOMENT_TIMING (${Object.keys(M.TIMING).length} keys)`, timingDrift.length === 0 && Object.keys(M.TIMING).length >= 8, timingDrift.join(', '));
    const R = CAPSULE_RULES as unknown as Record<string, number>;
    const rulesDrift = Object.entries(M.RULES).filter(([k, v]) => R[k] !== v).map(([k, v]) => `${k} ${v} vs ${R[k]}`);
    ok(`P1 every gesture rule equals CAPSULE_RULES (${Object.keys(M.RULES).length} keys)`, rulesDrift.length === 0 && Object.keys(M.RULES).length >= 10, rulesDrift.join(', '));
    const G = CAPSULE_GEOMETRY.line;
    ok('P1 the line geometry equals CAPSULE_GEOMETRY.line (H, D, inset) and the hitSlop LINE_GEOMETRY.capsuleHitSlop',
      M.GEOMETRY.H === G.H && M.GEOMETRY.D === G.D && M.GEOMETRY.inset === G.inset && M.RULES.hitSlop === LINE_GEOMETRY.capsuleHitSlop);
    const S = SEAL_TIMING as unknown as Record<string, number>;
    const sealDrift = Object.entries(M.SEAL).filter(([k, v]) => S[k] !== v).map(([k, v]) => `${k} ${v} vs ${S[k]}`);
    ok(`P1 every seal timing equals signTimeline SEAL_TIMING (${Object.keys(M.SEAL).length} keys) and the seal box LINE_GEOMETRY.seal`,
      sealDrift.length === 0 && Object.keys(M.SEAL).length >= 10 && M.SEAL_BOX === LINE_GEOMETRY.seal, sealDrift.join(', '));
    ok('P1 the solver steps at 1/240 s', Math.abs(M.STEP - 1 / 240) < 1e-12);

    // P2 executed parity.
    const Tpx = 300;
    const xs = [-40, -12, -1, 0, 1, 5, 12, 23.9, 24, 60, 150, 299, 300, 301, 320, 400];
    const rDrift = xs.filter((x) => Math.abs(M.resist(x, Tpx) - appResist(x, Tpx)) > 1e-9 || Math.abs(M.rubber(x, 14) - appRubber(x, 14)) > 1e-9);
    ok('P2 EXECUTED: resist() and rubber() equal utils/moments/capsuleMath.ts on a 16-point grid', rDrift.length === 0, `differs at ${rDrift}`);
    let commitDrift = 0;
    for (const locked of [false, true]) for (const progress of [0.3, 0.55, 0.6, 0.9]) for (const vx of [0, 600, 900, 2000]) {
      const a = { locked, progress, vx, f: progress * Tpx, T: Tpx };
      if (M.shouldCommit(a) !== appShouldCommit(a)) commitDrift++;
    }
    let lockDrift = 0;
    for (const l of [false, true]) for (const p of [0.7, 0.78, 0.79, 0.84, 0.85, 0.9]) if (M.lockStep(l, p, 0.85) !== appLockStep(l, p, 0.85)) lockDrift++;
    ok('P2 EXECUTED: shouldCommit() and lockStep() decide as the app does (32 + 12 cases)', commitDrift === 0 && lockDrift === 0, `${commitDrift} / ${lockDrift}`);
    const unsettled = Object.entries(M.SPRING).filter(([, cfg]) => !M.simulateSpring(cfg, 0, 300, 0, 3).settled).map(([k]) => k);
    ok('P2 EXECUTED: every spring settles within 3 s at the fixed step', unsettled.length === 0, unsettled.join(', '));
    const snap = M.simulateSpring(M.SPRING.snapBack, 300, 0, 0, 3);
    ok('P2 EXECUTED: the snap-back (ζ 1.00) never overshoots the start by a pixel', snap.peak > -1, `peak ${snap.peak}`);
  }

  // P3
  const port = portRules(js, css, jsCode);
  ok('P3 the port: pointer capture, touch-action on the head only, reduced motion, transform/opacity only, no colour literal, no "MAGE ID", no confetti', port.length === 0, port.join('\n'));

  // P4-P8 on the page
  const pr = pageRules(pageCode, page);
  ok('P4-P8 the signing paths: no alert(, no confetti, no retired orange, no busy-word swap; the seal only on the server\'s yes (tap and line); no "notified"; "(server time)" only on a server time; the slide only in English with moments.js, the tap everywhere else', pr.length === 0, pr.join('\n'));
  const cr = copyRules(page, langs);
  ok(`P8-P9 fine print and disclosures byte-identical; ${NEW_PORTAL_KEYS.length} new keys in English only, lint clean`, cr.length === 0, cr.join('\n'));

  // Planted proofs: each rule family goes red on a planted defect.
  for (const [name, red] of plantedProofs(ctx, page, js, css, langs)) ok(`red on planted: ${name}`, red);

  // Executed: the page and the line in jsdom.
  await executedChecks(ctx, page, js);
}

function plantedProofs(ctx: MomentsCtx, page: string, js: string, css: string, langs: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  const pr = (p: string) => pageRules(code(ctx, p), p);
  const swap = (s: string, a: string, b: string) => (s.includes(a) ? s.replace(a, b) : `${s}\n/*NOT-PLANTED ${a}*/`);
  out.push(['P4 an alert( on the contract path', pr(swap(page, "setContractSignLine(contractId, t('contractSignDeniedLink'), 'error');", "alert('To sign, ask your contractor to re-send your portal link.');")).some((x) => /P4 alert\(/.test(x))]);
  out.push(['P4 fireWebConfetti back in the page', pr(swap(page, 'function showContractSignNote(btn, text) {', 'function fireWebConfetti() {}\n  function showContractSignNote(btn, text) {')).some((x) => /P4 fireWebConfetti/.test(x))]);
  out.push(["P4 '#FF6A1A' back on the sign button", pr(swap(page, 'background: var(--brand); color: var(--surface);\n    font-family: inherit; font-weight: 800;', 'background: #FF6A1A; color: var(--surface);\n    font-family: inherit; font-weight: 800;')).some((x) => /FF6A1A/.test(x))]);
  out.push(['P5 the contract seal before the ok check', pr(swap(page, "      if (!res || res.ok !== true) {\n        setContractSignLine(contractId, t('momentNoAnswer'), 'error');", "      drawContractSeal(target, contractId, null, true);\n      if (!res || res.ok !== true) {\n        setContractSignLine(contractId, t('momentNoAnswer'), 'error');")).some((x) => /P5 the contract seal is drawn before/.test(x))]);
  out.push(['P5 a CO seal on an answer without recorded:true', pr(swap(page, "              if (isApprove && res.recorded !== true) {\n                ui.timeout(t('momentNoAnswer'));", "              if (isApprove && res.recorded !== true) {\n                ui.confirmed({ title: 'x' });")).some((x) => /P5/.test(x))]);
  out.push(['P5 a thenable answer (then: instead of after:)', pr(swap(page, '                after: redraw,', '                then: redraw,')).some((x) => /thenable/.test(x))]);
  out.push(['P5 a proposal seal outside the recorded gate', pr(swap(page, "if (decision === 'accepted' && wasRecorded) {", "if (decision === 'accepted') {")).some((x) => /P5 the proposal/.test(x))]);
  out.push(['P6 "notified" on the contract path', pr(swap(page, "showContractSignNote(target, t('contractSignAlready'));", "showContractSignNote(target, 'Signed. Your contractor has been notified.');")).some((x) => /P6/.test(x))]);
  out.push(['P7 the device clock labelled server time', pr(swap(page, "drawContractSeal(signHost, contractId, null, true)", "drawContractSeal(signHost, contractId, new Date().toISOString(), true)")).some((x) => /P7/.test(x))]);
  out.push(['P7 a recordedAt from the device clock in the sheet', pr(swap(page, 'recordedAt: res.sealed_at || null,', 'recordedAt: new Date().toISOString(),')).some((x) => /P7 recordedAt/.test(x))]);
  out.push(['P8 the tap button removed (the other languages lose their control)', pr(swap(page, "'<button type=\"button\" class=\"contract-sign-btn\" data-action=\"sign-contract\"", "'<div class=\"mp-line\" data-action=\"sign-contract\"")).some((x) => /P8/.test(x))]);
  out.push(['P8 the slide in every language (D-7 is English only)', pr(swap(page, "return lang === 'en' && !!(M && M.MomentLine);", 'return !!(M && M.MomentLine);')).some((x) => /P8 D-7/.test(x))]);
  out.push(['P8 the "tapping Sign" sentence under the slide', pr(swap(page, `data-contract-fine-print="slide">' + esc(t('contractFinePrintSlide'))`, `data-contract-fine-print="slide">' + esc(contractCopy('finePrint'))`)).some((x) => /P8 each control/.test(x))]);
  out.push(['P8 the English slide sentence edited', copyRules(swap(page, 'sliding along the line, you accept', 'sliding, you accept'), langs).some((x) => /P8 FALLBACK contractFinePrintSlide/.test(x))]);
  out.push(['P5 the contract line seals before the ok check', pr(swap(page, "      if (!res || res.ok !== true) {\n        return { status: 'timeout'", "      if (res) return { status: 'confirmed', seal: contractSealOpts(null, true) };\n      if (!res || res.ok !== true) {\n        return { status: 'timeout'")).some((x) => /P5 the contract line/.test(x))]);
  out.push(['P5 the contract line seals on a network error', pr(swap(page, '      console.error(err);\n      if (!(err && /Sign failed: 4/', "      console.error(err);\n      if (err) return { status: 'confirmed', seal: contractSealOpts(null, true) };\n      if (!(err && /Sign failed: 4/")).some((x) => /P5 the contract line|P5 a seal in the contract line/.test(x))]);
  out.push(['P7 the contract line sealed with the device clock', pr(swap(page, 'seal: contractSealOpts(null, true)', 'seal: contractSealOpts(new Date().toISOString(), true)')).some((x) => /P7/.test(x))]);
  out.push(['P8 one language\'s fine print edited', copyRules(swap(page, 'Al escribir su nombre y pulsar Firmar', 'Al escribir su nombre y deslizar'), langs).some((x) => /P8 CONTRACT_COPY/.test(x))]);
  out.push(['P8 the CO disclosure edited', copyRules(swap(page, 'you consent to sign this change order electronically', 'you consent to slide this change order electronically'), langs).some((x) => /P8 ESIGN/.test(x))]);
  out.push(['P9 a new key machine-translated into the Spanish contract table', copyRules(swap(page, "    es: {\n      explainer:", "    es: {\n      contractSignedSeal: 'Firmado. Este contrato es vinculante.',\n      explainer:"), langs).some((x) => /P9 contractSignedSeal appears in CONTRACT_COPY/.test(x))]);
  out.push(['P9 a new key added to a portalLanguages bundle', copyRules(page, `${langs}\nconst es = { esignSlideAccept: 'Desliza a lo largo de la línea para aceptar' };`).some((x) => /P9 esignSlideAccept appears in utils\/portalLanguages/.test(x))]);
  out.push(['P9 a new key missing from the English table', copyRules(swap(page, "    momentArmed: 'Tap again to confirm.',\n", ''), langs).some((x) => /P9 momentArmed is missing/.test(x))]);
  out.push(['P9 an amount without cents in a new line', copyRules(swap(page, "esignCOApproved: 'Change order #{number} approved. Your signature is recorded.'", "esignCOApproved: 'Change order #{number} approved for $4,200 today.'"), langs).some((x) => /cents/.test(x))]);
  const jc = (s: string) => portRules(s, css, ctx.stripComments(s));
  out.push(['P3 a colour literal in moments.js', jc(swap(js, "var SVGNS = 'http://www.w3.org/2000/svg';", "var SVGNS = 'http://www.w3.org/2000/svg'; var INK = '#0B0D10';")).some((x) => /colour literal/.test(x))]);
  out.push(['P3 a left: animation in moments.js', jc(swap(js, "this.el.head.style.transform = 'translateX(", "this.el.head.style.left = (this.x) + 'px'; this.el.head.style.transform = 'translateX(")).some((x) => /style\.left/.test(x))]);
  out.push(['P3 touch-action none on the whole line', portRules(js, swap(css, '.mp-line { position: relative; margin-top: 14px; }', '.mp-line { position: relative; margin-top: 14px; touch-action: none; }'), ctx.stripComments(js)).some((x) => /touch-action/.test(x))]);
  out.push(['P3 the reduced-motion media query removed', portRules(js, css.replace('@media (prefers-reduced-motion: reduce)', '@media (min-width: 1px)'), ctx.stripComments(js)).some((x) => /reduced-motion media/.test(x))]);
  const Mbad = loadMoments(swap(js, 'snapBack: { stiffness: 380, damping: 39, mass: 1 }', 'snapBack: { stiffness: 380, damping: 20, mass: 1 }'));
  out.push(['P1 a spring that drifted from motionSpec', !!Mbad && JSON.stringify(Mbad.SPRING.snapBack) !== JSON.stringify(MOMENT_SPRING.snapBack)]);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// executed: the real page and the real line in jsdom
// ─────────────────────────────────────────────────────────────────────────────

type Win = Record<string, any>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function executedChecks(ctx: MomentsCtx, page: string, js: string): Promise<void> {
  const { ok } = ctx;
  let JSDOM: any;
  let VirtualConsole: any;
  try { ({ JSDOM, VirtualConsole } = await import('jsdom')); } catch { ok('E0 jsdom is available for the executed checks', false); return; }
  const { buildPortalSnapshot } = await import('../../utils/portalSnapshot');

  // ── E1 the line itself ─────────────────────────────────────────────────────
  const lineDom = new JSDOM('<!doctype html><body><div id="h"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const lw: Win = lineDom.window;
  lw.eval(js);
  const MM = lw.MageMoments;
  const strings = { hint: 'hint', armed: 'Tap again to confirm.', busy: 'Waiting.', cancelled: 'Cancelled.', noAnswer: 'No answer yet.' };
  const key = (el: any, type: string, k: string) => el.dispatchEvent(new lw.KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
  const makeLine = (onCommit: () => Promise<unknown>, extra: Record<string, unknown> = {}) => {
    const host = lw.document.createElement('div');
    lw.document.body.appendChild(host);
    let done: unknown = null;
    const line = new MM.MomentLine(host, { label: 'Slide along the line to approve · +$4,200.00', strings, onCommit, onDone: (r: unknown) => { done = r; }, ...extra });
    return { host, line, head: host.querySelector('.mp-head'), done: () => done };
  };
  let calls = 0;
  const hold = async (head: any) => { key(head, 'keydown', ' '); await wait(MOMENT_TIMING.holdFill + 150); };

  const a = makeLine(async () => { calls++; return { status: 'confirmed', seal: { label: 'Signed. Keep a copy for your records.', chip: 'Binding', closing: true, recordedAt: '2026-09-27T18:41:00Z', recordedTemplate: 'Recorded {date}, {time} (server time).' } }; });
  ok('E1 the head is a focusable button with the label, and the line starts idle', a.head?.tagName === 'BUTTON' && a.head.getAttribute('aria-label')?.includes('+$4,200.00') && a.host.querySelector('[data-state="idle"]'));
  await hold(a.head);
  const busySeal = a.host.querySelector('.mp-seal');
  ok('E1 EXECUTED: press-and-hold Space commits once, and no seal is drawn while the answer is pending', calls === 1 && !busySeal && a.host.querySelector('[data-state="busy"]'));
  await wait(MOMENT_TIMING.minBusy + 100);
  const seal = a.host.querySelector('.mp-seal');
  ok('E1 EXECUTED: a confirmed answer draws the seal (two arcs, check, chip, record line with the server time)',
    !!seal && seal.querySelectorAll('.mp-arc').length === 2 && !!seal.querySelector('.mp-check')
    && seal.querySelector('.mp-chip')?.textContent === 'Binding' && /\(server time\)\.$/.test(seal.querySelector('.mp-seal-record')?.textContent ?? '')
    && !/MAGE ID/.test(seal.textContent));
  await wait(MOMENT_TIMING.holdMs + 100);
  ok('E1 EXECUTED: onDone fires after the result hold', (a.done() as { status?: string } | null)?.status === 'confirmed');

  const b = makeLine(async () => ({ status: 'refused', reason: 'Not recorded. A decision on this change order was already on file.', final: true }));
  await hold(b.head);
  await wait(MOMENT_TIMING.minBusy + MOMENT_TIMING.failHomeLeadAt + 700);
  ok('E1 EXECUTED: a final refusal draws no seal, says the reason and locks the line',
    !b.host.querySelector('.mp-seal') && /already on file/.test(b.host.querySelector('.mp-reason')?.textContent ?? '') && b.head.disabled === true);

  const c = makeLine(() => Promise.reject(new Error('offline')));
  await hold(c.head);
  await wait(MOMENT_TIMING.minBusy + MOMENT_TIMING.failHomeLeadAt + 700);
  ok('E1 EXECUTED: a rejected write reads "No answer yet", no seal, and the line locks (a retry could double it)',
    !c.host.querySelector('.mp-seal') && c.host.querySelector('.mp-reason')?.textContent === 'No answer yet.' && c.head.disabled === true);

  let dCalls = 0;
  const d = makeLine(async () => { dCalls++; return { status: 'confirmed', seal: {} }; }, { disabledReason: 'Tick the consent box to sign.' });
  await hold(d.head);
  ok('E1 EXECUTED: a disabled line shows its reason and never commits', dCalls === 0 && d.head.disabled === true && d.host.querySelector('.mp-reason')?.textContent === 'Tick the consent box to sign.');
  d.line.setDisabledReason(null);
  key(d.head, 'keydown', ' ');
  await wait(200);
  key(d.head, 'keydown', 'Escape');
  await wait(MOMENT_TIMING.holdFill + 100);
  ok('E1 EXECUTED: Esc during the hold cancels, nothing is sent', dCalls === 0 && d.host.querySelector('[data-state="idle"]'));
  key(d.head, 'keydown', ' ');
  await wait(200);
  key(d.head, 'keyup', ' ');
  await wait(MOMENT_TIMING.holdFill + 100);
  ok('E1 EXECUTED: letting go of Space early cancels, nothing is sent', dCalls === 0);
  d.head.dispatchEvent(new lw.MouseEvent('click', { bubbles: true, cancelable: true }));
  ok('E1 EXECUTED: a tap (or a screen reader activation) arms a confirming tap first', dCalls === 0 && d.host.querySelector('[data-state="armed"]') && /Tap again/.test(d.host.querySelector('.mp-reason')?.textContent ?? ''));
  d.head.dispatchEvent(new lw.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(50);
  ok('E1 EXECUTED: …and the second tap commits', dCalls === 1);
  lineDom.window.close();

  // ── E2 the page: the contract counter-sign as the TAP (Spanish: D-7 keeps
  //    the tap outside English), the CO approval (slide); E4 the contract
  //    counter-sign as the SLIDE (English) ──
  const contract = {
    id: 'c-1', projectId: 'p1', userId: 'gc-1', version: 1, title: 'Construction Agreement', contractValue: 100000.5,
    scopeText: 'Kitchen remodel per plans.', termsText: 'Terms.', warrantyText: 'One year.', startDate: '2026-10-05', durationDays: 90,
    paymentSchedule: [{ id: 'm1', label: 'Deposit', trigger: 'on_signing', amount: 25000.13, status: 'pending' }],
    allowances: [], status: 'sent', createdAt: 'x', updatedAt: 'x',
  };
  const snap: any = buildPortalSnapshot({
    project: { id: 'p1', name: 'Maple St', status: 'in_progress', updatedAt: 'x' },
    portal: { portalId: 'pid', enabled: true, showChangeOrders: true, coApprovalEnabled: true },
    contract,
    changeOrders: [{ id: 'co1', projectId: 'p1', number: 4, description: 'Add a window', reason: '', date: '2026-09-01', status: 'submitted', changeAmount: 4200, lineItems: [] }],
    supabaseUrl: 'https://nteoqhcswappxxjlpvap.supabase.co', supabaseAnonKey: 'anon',
  } as any);
  // The same portal in Spanish: D-7 keeps its counter-sign a tap.
  const snapEs: any = buildPortalSnapshot({
    project: { id: 'p1', name: 'Maple St', status: 'in_progress', updatedAt: 'x' },
    portal: { portalId: 'pid', enabled: true, showChangeOrders: true, coApprovalEnabled: true, homeownerLanguage: 'es' },
    contract,
    changeOrders: [],
    supabaseUrl: 'https://nteoqhcswappxxjlpvap.supabase.co', supabaseAnonKey: 'anon',
  } as any);
  const ES = { snap: snapEs };
  const enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const withJs = (p: string) => p.replace(/<script src="\/portal\/moments\.js\?v=[\w-]+"><\/script>/, () => `<script>${js}</script>`);
  const html = withJs(page);

  type Plan = { sign?: () => unknown; co?: () => unknown; server?: () => unknown };
  async function boot(plan: Plan, opt: { snap?: any; html?: string } = {}) {
    const bootSnap = opt.snap ?? snap;
    const errors: string[] = [];
    const calls: string[] = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e: any) => { const m = String(e?.message ?? e); if (!/Not implemented/.test(m)) errors.push(m); });
    const dom = new JSDOM(opt.html ?? html, {
      url: `https://mageid.app/portal/pid?t=tok#d=${enc(bootSnap)}`, runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
      beforeParse(w: any) {
        w.IntersectionObserver = class { observe() {} disconnect() {} };
        w.open = () => null;
        w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
        w.fetch = async (url: string, init: any) => {
          calls.push(url);
          const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
          const answer = (fn?: () => unknown) => {
            const r = fn ? fn() : { body: {} };
            if (r instanceof Error) return Promise.reject(r);
            const x = r as { body: unknown; status?: number };
            return json(x.body, x.status ?? 200);
          };
          if (url.includes('portal_sign_contract')) return answer(plan.sign);
          if (url.includes('portal_submit_co_approval_signed')) return answer(plan.co);
          if (url.includes('portal_get_snapshot_v2')) return answer(plan.server ?? (() => ({ body: { status: 'ok', snapshot: bootSnap } })));
          return json({});
        };
      },
    });
    const w: Win = dom.window;
    await wait(400);
    return { w, d: w.document, errors, calls, close: () => w.close() };
  }
  const typeName = (w: Win, d: any, v: string) => {
    const input = d.getElementById('contract-name-c-1');
    input.value = v;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    return input;
  };
  const signBtn = (d: any) => d.querySelector('[data-action="sign-contract"]');
  const signLine = (d: any) => (d.getElementById('contract-sign-line-c-1')?.textContent ?? '') as string;

  type OkFn = (name: string, cond: boolean, detail?: string) => void;
  const scen: ((ok: OkFn) => Promise<void>)[] = [];
  scen.push(async (ok) => {
    // ok -> seal now, Recorded line only once the re-read carries the server's signed-at.
    const signedSnap = { ...snapEs, contract: { ...snapEs.contract, status: 'signed', needsSignature: false, homeownerSignerName: 'Dana Reyes', homeownerSignedAt: '2026-09-27T18:41:00.000Z', homeownerSignatureMethod: 'portal' } };
    let signed = false;
    const s = await boot({
      sign: () => { signed = true; return { body: { ok: true } }; },
      server: () => ({ body: { status: 'ok', snapshot: signed ? signedSnap : snapEs } }),
    }, ES);
    const alerts: string[] = [];
    s.w.alert = (m: string) => alerts.push(m);
    const esFine = s.d.querySelector('#sec-contract [data-contract-fine-print]');
    ok('E2 Spanish (D-7): the counter-sign stays the tap button, no line, and the Spanish fine print is byte-identical ("pulsar Firmar")',
      !!signBtn(s.d) && !s.d.querySelector('[data-contract-line]') && esFine?.getAttribute('data-contract-fine-print') === 'tap'
      && esFine.textContent === 'Al escribir su nombre y pulsar Firmar, usted firma este acuerdo electrónicamente. Su contratista conserva la copia firmada y sellada y puede enviársela.',
      esFine?.outerHTML);
    ok('E2 the contract sign button renders locked, with the reason under it', signBtn(s.d)?.disabled === true && signLine(s.d) === 'Type your full legal name to sign.',
      `errors: ${s.errors.join(' | ')}; portal ${s.d.getElementById('portal')?.style.display}; sections ${s.d.getElementById('sections')?.innerHTML.length}; calls ${s.calls.join(', ')}`);
    if (!signBtn(s.d)) { s.close(); return; }
    typeName(s.w, s.d, 'Da');
    const shortLocked = signBtn(s.d).disabled === true;
    typeName(s.w, s.d, 'Dana Reyes');
    ok('E2 EXECUTED: a name under 3 characters keeps it locked; a full name unlocks it and clears the line', shortLocked && signBtn(s.d).disabled === false && signLine(s.d) === '');
    const label = signBtn(s.d).textContent;
    signBtn(s.d).click();
    ok('E2 EXECUTED: while the RPC runs the button keeps its words, locked, with a busy line', signBtn(s.d)?.textContent === label && signBtn(s.d).disabled === true && /Waiting for the server/.test(signLine(s.d)));
    await wait(60);
    const host = s.d.querySelector('[data-contract-seal="c-1"]');
    ok('E2 EXECUTED: {ok: true} draws the closing seal with "Binding" and "Signed. Keep a copy for your records." and no Recorded line yet',
      !!host?.querySelector('.mp-seal[data-moment-seal="closing"]') && host.querySelector('.mp-chip')?.textContent === 'Binding'
      && /Signed\. This contract is binding\./.test(host.textContent) && host.querySelector('.mp-seal-record')?.hidden === true
      && !/notified/i.test(s.d.getElementById('sec-contract')?.textContent ?? ''),
      host?.outerHTML?.slice(0, 600));
    await wait(1800 + 400);
    const kept = s.d.querySelector('#sec-contract [data-contract-seal="c-1"] .mp-seal-record');
    ok('E2 EXECUTED: after the re-read the seal stays on the signed card and the Recorded line carries the snapshot\'s server time',
      !!kept && kept.hidden === false && /^Recorded Sep 27, 2026, \d{1,2}:41 [AP]M \(server time\)\.$/.test(kept.textContent), kept?.textContent);
    ok('E2 EXECUTED: no alert() and no page error on the way', alerts.length === 0 && s.errors.length === 0, s.errors.join(' | '));
    s.close();
  });
  scen.push(async (ok) => {
    const s = await boot({ sign: () => new TypeError('Failed to fetch') }, ES);
    s.w.alert = () => { throw new Error('alert'); };
    typeName(s.w, s.d, 'Dana Reyes');
    signBtn(s.d).click();
    await wait(80);
    ok('E2 EXECUTED: a network failure reads "No answer yet. Refresh the page to check before trying again.", no seal, button locked, name kept',
      signLine(s.d) === 'No answer yet. Refresh the page to check before trying again.' && !s.d.querySelector('.mp-seal')
      && signBtn(s.d).disabled === true && s.d.getElementById('contract-name-c-1').value === 'Dana Reyes');
    s.close();
  });
  scen.push(async (ok) => {
    const s = await boot({ sign: () => ({ body: { ok: true, already: true } }) }, ES);
    typeName(s.w, s.d, 'Dana Reyes');
    signBtn(s.d).click();
    await wait(80);
    ok('E2 EXECUTED: {already: true} reads "Already signed. Updating the page." with no seal',
      /Already signed\. Updating the page\./.test(s.d.querySelector('#sec-contract').textContent) && !s.d.querySelector('.mp-seal'));
    s.close();
  });
  scen.push(async (ok) => {
    const s = await boot({ sign: () => ({ body: { message: 'sign_denied' }, status: 403 }) }, ES);
    typeName(s.w, s.d, 'Dana Reyes');
    signBtn(s.d).click();
    await wait(200);
    ok('E2 EXECUTED: a 4xx with an unsigned snapshot reads the re-send-the-link line, no seal, the name stays',
      /re-send your portal link/.test(signLine(s.d)) && !s.d.querySelector('.mp-seal') && s.d.getElementById('contract-name-c-1')?.value === 'Dana Reyes');
    s.close();
  });
  scen.push(async (ok) => {
    const s = await boot({ sign: () => ({ body: {} }) }, ES);
    typeName(s.w, s.d, 'Dana Reyes');
    signBtn(s.d).click();
    await wait(80);
    ok('E2 EXECUTED: a 2xx without {ok: true} is not a signature: "No answer yet", no seal', /No answer yet/.test(signLine(s.d)) && !s.d.querySelector('.mp-seal'));
    s.close();
  });

  // ── E4 D-7: the contract counter-sign as the slide (English) ───────────────
  const lineOf = (d: any) => d.querySelector('[data-contract-line="c-1"]');
  const lineHead = (d: any) => lineOf(d)?.querySelector('.mp-head');
  const lineReason = (d: any) => (lineOf(d)?.querySelector('.mp-reason')?.textContent ?? '') as string;
  const holdSpace = async (w: Win, head: any) => { head.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })); await wait(MOMENT_TIMING.holdFill + 150); };
  const posts = (s: { calls: string[] }) => s.calls.filter((u) => u.includes('portal_sign_contract')).length;
  const settle = MOMENT_TIMING.minBusy + MOMENT_TIMING.failHomeLeadAt + 800;
  const SLIDE_FINE = 'By typing your name and sliding along the line, you are signing this agreement electronically. Your contractor keeps the sealed signed copy and can send it to you.';
  scen.push(async (ok) => {
    const signedSnap = { ...snap, contract: { ...snap.contract, status: 'signed', needsSignature: false, homeownerSignerName: 'Dana Reyes', homeownerSignedAt: '2026-09-27T18:41:00.000Z', homeownerSignatureMethod: 'portal' } };
    let signed = false;
    const s = await boot({
      sign: () => { signed = true; return { body: { ok: true } }; },
      server: () => ({ body: { status: 'ok', snapshot: signed ? signedSnap : snap } }),
    });
    const alerts: string[] = [];
    s.w.alert = (m: string) => alerts.push(m);
    const fine = s.d.querySelector('#sec-contract [data-contract-fine-print]');
    ok('E4 English: the counter-sign is the line ("Slide along the line to sign"), no tap button, and the fine print names the slide',
      !!lineHead(s.d) && !signBtn(s.d) && /Slide along the line to sign/.test(lineOf(s.d).textContent)
      && fine?.getAttribute('data-contract-fine-print') === 'slide' && fine.textContent === SLIDE_FINE,
      `errors: ${s.errors.join(' | ')}; ${s.d.getElementById('sec-contract')?.innerHTML.slice(-1500)}`);
    if (!lineHead(s.d)) { s.close(); return; }
    ok('E4 the line starts locked: "Type your full legal name to sign."', lineHead(s.d).disabled === true && lineReason(s.d) === 'Type your full legal name to sign.');
    typeName(s.w, s.d, 'Da');
    const shortLocked = lineHead(s.d).disabled === true && lineReason(s.d) === 'Type your full legal name to sign.';
    typeName(s.w, s.d, 'Dana Reyes');
    ok('E4 EXECUTED: under 3 characters the line stays locked with the reason; a full name unlocks it and sits on the line',
      shortLocked && lineHead(s.d).disabled === false && lineReason(s.d) === '' && s.d.getElementById('contract-line-name-c-1')?.textContent === 'Dana Reyes');
    await holdSpace(s.w, lineHead(s.d));
    ok('E4 EXECUTED: press-and-hold Space sends one signature; no seal while the answer is pending; the name is locked',
      posts(s) === 1 && !s.d.querySelector('.mp-seal') && !!lineOf(s.d).querySelector('[data-state="busy"]') && s.d.getElementById('contract-name-c-1').readOnly === true);
    await wait(MOMENT_TIMING.minBusy + 150);
    const seal = lineOf(s.d)?.querySelector('.mp-seal[data-moment-seal="closing"]');
    ok('E4 EXECUTED: {ok: true} closes the ring on the line: "Binding", "Signed. Keep a copy for your records.", no Recorded line yet, no "notified"',
      !!seal && seal.querySelector('.mp-chip')?.textContent === 'Binding' && /Signed\. This contract is binding\./.test(seal.textContent)
      && seal.querySelector('.mp-seal-record')?.hidden === true && !/notified/i.test(s.d.getElementById('sec-contract')?.textContent ?? ''),
      lineOf(s.d)?.outerHTML.slice(0, 900));
    await wait(MOMENT_TIMING.holdMs + 600);
    const kept = s.d.querySelector('#sec-contract [data-contract-seal="c-1"] .mp-seal-record');
    ok('E4 EXECUTED: after the re-read the seal stays on the signed card with the snapshot\'s server time; one POST; no alert(), no page error',
      !!kept && kept.hidden === false && /^Recorded Sep 27, 2026, \d{1,2}:41 [AP]M \(server time\)\.$/.test(kept.textContent)
      && posts(s) === 1 && alerts.length === 0 && s.errors.length === 0, `${kept?.textContent} / posts ${posts(s)} / ${s.errors.join(' | ')}`);
    s.close();
  });
  scen.push(async (ok) => {
    const s = await boot({ sign: () => ({ body: { ok: true, already: true } }) });
    typeName(s.w, s.d, 'Dana Reyes');
    // A screen reader's activation: the first arms, the second confirms.
    lineHead(s.d).click();
    const armedOnly = posts(s) === 0;
    lineHead(s.d).click();
    await wait(150);
    ok('E4 EXECUTED: a double activation signs once; {already: true} reads "Already signed. Updating the page." with no seal',
      armedOnly && posts(s) === 1 && /Already signed\. Updating the page\./.test(s.d.querySelector('#sec-contract').textContent) && !s.d.querySelector('.mp-seal'));
    s.close();
  });
  scen.push(async (ok) => {
    const s = await boot({ sign: () => ({ body: { message: 'sign_denied' }, status: 403 }) });
    typeName(s.w, s.d, 'Dana Reyes');
    await holdSpace(s.w, lineHead(s.d));
    await wait(settle);
    const input = s.d.getElementById('contract-name-c-1');
    ok('E4 EXECUTED: a 4xx reads the re-send-the-link reason under the line, no seal, the typed name restored and editable, the line open to try again',
      /re-send your portal link/.test(lineReason(s.d)) && !s.d.querySelector('.mp-seal') && input?.value === 'Dana Reyes' && input.readOnly === false && lineHead(s.d)?.disabled === false,
      `${lineReason(s.d)} / ${input?.value} / ro ${input?.readOnly} / head ${lineHead(s.d)?.disabled}`);
    s.close();
  });
  // Offline mid-sign, run on the real page and on a planted page whose line
  // seals on a network error: the check must pass the first and fail the second.
  const lineOffline = async (h: string) => {
    const s = await boot({ sign: () => new TypeError('Failed to fetch') }, { html: h });
    typeName(s.w, s.d, 'Dana Reyes');
    await holdSpace(s.w, lineHead(s.d));
    await wait(settle);
    const honest = lineReason(s.d) === 'No answer yet. Refresh the page to check before trying again.' && !s.d.querySelector('.mp-seal')
      && lineHead(s.d)?.disabled === true && s.d.getElementById('contract-name-c-1')?.value === 'Dana Reyes';
    const detail = `${lineReason(s.d)} / seal ${!!s.d.querySelector('.mp-seal')} / head ${lineHead(s.d)?.disabled}`;
    s.close();
    return { honest, detail };
  };
  scen.push(async (ok) => {
    const real = await lineOffline(html);
    ok('E4 EXECUTED: offline mid-sign reads "No answer yet. Refresh the page…", never a seal; the line locks and the name stays', real.honest, real.detail);
    const planted = page.replace('      console.error(err);\n      if (!(err && /Sign failed: 4/', "      console.error(err);\n      if (err) return { status: 'confirmed', seal: contractSealOpts(null, true) };\n      if (!(err && /Sign failed: 4/");
    const mut = planted === page ? { honest: true, detail: 'NOT PLANTED' } : await lineOffline(withJs(planted));
    ok('E4 red on planted (executed): a line that seals on a network error fails the offline check', !mut.honest, mut.detail);
  });
  scen.push(async (ok) => {
    const s = await boot({ sign: () => ({ body: {} }) });
    typeName(s.w, s.d, 'Dana Reyes');
    await holdSpace(s.w, lineHead(s.d));
    await wait(settle);
    ok('E4 EXECUTED: a 2xx without {ok: true} on the line is no answer: "No answer yet", no seal, the line locks',
      /No answer yet/.test(lineReason(s.d)) && !s.d.querySelector('.mp-seal') && lineHead(s.d)?.disabled === true);
    s.close();
  });
  scen.push(async (ok) => {
    // English, but moments.js did not load: the tap button under the "tapping Sign" sentence.
    const s = await boot({ sign: () => ({ body: { ok: true } }) }, { html: page });
    const fine = s.d.querySelector('#sec-contract [data-contract-fine-print]');
    typeName(s.w, s.d, 'Dana Reyes');
    ok('E4 English without moments.js falls back to the tap button and its "tapping Sign" fine print',
      !!signBtn(s.d) && signBtn(s.d).disabled === false && !s.d.querySelector('[data-contract-line]') && fine?.getAttribute('data-contract-fine-print') === 'tap'
      && fine.textContent === 'By typing your name and tapping Sign, you are signing this agreement electronically. Your contractor keeps the sealed signed copy and can send it to you.',
      `${s.errors.join(' | ')} / ${fine?.outerHTML}`);
    s.close();
  });

  // CO approval: the slide, gated on name + drawn signature + consent.
  const coRun = async (co: () => unknown) => {
    const s = await boot({ co });
    const approveBtn = s.d.querySelector('[data-co-approve]');
    approveBtn?.click();
    await wait(50);
    const lineHost = s.d.getElementById('esign-line');
    const head = lineHost?.querySelector('.mp-head');
    const reason = () => lineHost?.querySelector('.mp-reason')?.textContent ?? '';
    return { s, approveBtn, lineHost, head, reason };
  };
  const fillSheet = async (s: { w: Win; d: any }) => {
    const name = s.d.getElementById('esign-name');
    name.value = 'Dana Reyes';
    name.dispatchEvent(new s.w.Event('input', { bubbles: true }));
    const pad = s.d.getElementById('esign-pad');
    const reason1 = s.d.querySelector('#esign-line .mp-reason')?.textContent;
    pad.dispatchEvent(new s.w.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    pad.dispatchEvent(new s.w.MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 30, clientY: 20 }));
    s.w.dispatchEvent(new s.w.MouseEvent('mouseup', { bubbles: true }));
    const reason2 = s.d.querySelector('#esign-line .mp-reason')?.textContent;
    const check = s.d.getElementById('esign-consent-check');
    check.checked = true;
    check.dispatchEvent(new s.w.Event('change', { bubbles: true }));
    return [reason1, reason2];
  };
  scen.push(async (ok) => {
    const r = await coRun(() => ({ body: { ok: true, recorded: true, id: 'row', document_hash: 'a'.repeat(64), sealed_at: '2026-09-27T18:41:00.000Z' } }));
    ok('E3 the CO approve sheet shows the line (label with cents) instead of the submit button',
      !!r.head && /Slide along the line to approve · \+\$4,200\.00/.test(r.lineHost.textContent) && r.s.d.querySelector('.esign-actions.esign-line-mode'));
    ok('E3 the slide starts locked with the first missing piece named', r.head?.disabled === true && r.reason() === 'Type your full legal name to sign.');
    const [afterName, afterPad] = await fillSheet(r.s);
    ok('E3 EXECUTED: each missing piece is named in turn (signature, then consent), then the slide unlocks',
      afterName === 'Draw your signature to sign.' && afterPad === 'Tick the consent box to sign.' && r.head.disabled === false, `${afterName} / ${afterPad}`);
    key(r.head, 'keydown', ' ');
    await wait(MOMENT_TIMING.holdFill + 150);
    const posted = r.s.calls.filter((u) => u.includes('portal_submit_co_approval_signed')).length;
    await wait(MOMENT_TIMING.minBusy + 200);
    const coSeal = r.lineHost.querySelector('.mp-seal');
    ok('E3 EXECUTED: recorded:true draws the APPROVED seal with the server\'s sealed_at, once', posted === 1 && !!coSeal
      && coSeal.querySelector('.mp-chip')?.textContent === 'APPROVED' && /Change order #4 approved\. Your signature is recorded\./.test(coSeal.textContent)
      && /\(server time\)\.$/.test(coSeal.querySelector('.mp-seal-record')?.textContent ?? ''),
      `posted ${posted}; ${r.lineHost.outerHTML.slice(0, 900)}`);
    await wait(MOMENT_TIMING.holdMs + 200);
    ok('E3 EXECUTED: …then the sheet closes and the section redraws', !r.s.d.getElementById('esign-modal').classList.contains('open'));
    r.s.close();
  });
  scen.push(async (ok) => {
    const r = await coRun(() => ({ body: { ok: true, recorded: false, decision: 'approved', signer_name: 'Sam Reyes', sealed_at: '2026-09-26T10:00:00Z' } }));
    await fillSheet(r.s);
    key(r.head, 'keydown', ' ');
    await wait(MOMENT_TIMING.holdFill + MOMENT_TIMING.minBusy + MOMENT_TIMING.failHomeLeadAt + 800);
    ok('E3 EXECUTED: recorded:false draws no seal, says "Not recorded…", locks the line and keeps the sheet open',
      !r.lineHost.querySelector('.mp-seal') && /Not recorded\. A decision on this change order was already on file\./.test(r.reason())
      && r.head.disabled === true && r.s.d.getElementById('esign-modal').classList.contains('open'));
    r.s.close();
  });
  scen.push(async (ok) => {
    const r = await coRun(() => ({ body: { ok: true } }));
    await fillSheet(r.s);
    key(r.head, 'keydown', ' ');
    await wait(MOMENT_TIMING.holdFill + MOMENT_TIMING.minBusy + MOMENT_TIMING.failHomeLeadAt + 800);
    ok('E3 EXECUTED: an answer with no `recorded` field is no answer: no seal, "No answer yet"', !r.lineHost.querySelector('.mp-seal') && /No answer yet/.test(r.reason()));
    r.s.close();
  });
  scen.push(async (ok) => {
    const r = await coRun(() => new TypeError('Failed to fetch'));
    await fillSheet(r.s);
    key(r.head, 'keydown', ' ');
    await wait(MOMENT_TIMING.holdFill + MOMENT_TIMING.minBusy + MOMENT_TIMING.failHomeLeadAt + 800);
    ok('E3 EXECUTED: offline mid-approve reads "No answer yet. Refresh the page…", never a seal, never "couldn\'t record"',
      !r.lineHost.querySelector('.mp-seal') && r.reason() === 'No answer yet. Refresh the page to check before trying again.');
    r.s.close();
  });
  // The page scenarios are independent jsdom instances: run them side by side,
  // report in order.
  const results = await Promise.all(scen.map(async (fn) => {
    const got: [string, boolean, string | undefined][] = [];
    try { await fn((n, c, d) => { got.push([n, !!c, d]); }); } catch (e) { got.push(['E scenario ran without throwing', false, String((e as Error)?.stack ?? e)]); }
    return got;
  }));
  for (const got of results) for (const [n, c, d] of got) ctx.ok(n, c, d);
}
