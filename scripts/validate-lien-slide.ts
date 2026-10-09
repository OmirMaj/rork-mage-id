// validate-lien-slide.ts — the lien-waiver page signs on the line (LIENSLIDE).
//
// marketing/lien-waiver/index.html lets the sub sign by sliding along the
// signing line (MageMoments.MomentLine from marketing/portal/moments.js), the
// same control and the same result rules as the portal's contract counter-sign.
// The button stays as the fallback for when moments.js did not load, and
// scripts/validate-lien-waivers.ts drives that path unchanged.
//
// HOW IT CHECKS. By RUNNING the page's script against a stub DOM, a stubbed
// Supabase and a fake MomentLine that records what the page handed it, then
// calling the page's own onCommit / onDone. What is asserted is what the line
// would show and what the sub would read:
//   LS1  the line replaces the button and stays locked with the page's sentence
//        until name, signature and consent are all done
//   LS2  {ok:true} is the ONLY confirmed answer, and the seal's Recorded time is
//        the server's signed_at, never this device's clock
//   LS3  the four refusals keep their sentences; voided and denied are final
//   LS4  no answer (or one the page cannot read) rejects: never confirmed, never
//        the done card
//   LS5  without moments.js the button path is untouched
//   LS6  the consent text and version are byte-identical to main
//
// Run via: bun run scripts/validate-lien-slide.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const page = read('marketing/lien-waiver/index.html');
const portal = read('marketing/portal/index.html');
const pageScript = (page.match(/<script>\n([\s\S]*?)\n<\/script>/) ?? [])[1] ?? '';

const NOT_READY = 'Type your name, draw your signature and tick the consent box to enable signing.';
const LABEL = 'Slide along the line to sign this waiver';

// ── stub DOM ────────────────────────────────────────────────────────────────
interface StubEl {
  id: string; hidden: boolean; textContent: string; innerHTML: string; value: string; checked: boolean;
  disabled: boolean; readOnly: boolean; style: Record<string, string>; width: number; height: number;
  clientWidth: number; classes: Set<string>; attrs: Record<string, string>;
  listeners: Record<string, ((e?: unknown) => void)[]>;
  classList: { add: (...c: string[]) => void; remove: (...c: string[]) => void; contains: (c: string) => boolean };
  setAttribute: (k: string, v: string) => void; getAttribute: (k: string) => string | undefined;
  addEventListener: (t: string, f: (e?: unknown) => void) => void;
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
  getContext: () => Record<string, unknown>;
  fire: (t: string) => void;
  parentNode: { insertBefore: (n: StubEl, ref: StubEl) => void } | null;
}

function startsHidden(id: string): boolean {
  return new RegExp(`id="${id}"[^>]*\\shidden`).test(page);
}

function stubEl(id: string, inserted: { node: StubEl; before: string }[]): StubEl {
  const el: StubEl = {
    id, hidden: startsHidden(id), textContent: '', innerHTML: '', value: '', checked: false, disabled: false,
    readOnly: false, style: {}, width: 0, height: 0, clientWidth: 320, classes: new Set(), attrs: {}, listeners: {},
    classList: {
      add: (...c) => c.forEach(x => el.classes.add(x)),
      remove: (...c) => c.forEach(x => el.classes.delete(x)),
      contains: c => el.classes.has(c),
    },
    setAttribute: (k, v) => { el.attrs[k] = v; },
    getAttribute: k => el.attrs[k],
    addEventListener: (t, f) => { (el.listeners[t] ??= []).push(f); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 170 }),
    getContext: () => ({
      scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {},
      lineWidth: 0, lineCap: '', lineJoin: '', strokeStyle: '',
    }),
    fire: t => (el.listeners[t] ?? []).forEach(f => f({ preventDefault() {}, touches: null, clientX: 10, clientY: 10 })),
    parentNode: { insertBefore: (n, ref) => { inserted.push({ node: n, before: ref.id }); } },
  };
  return el;
}

interface FakeLine {
  host: StubEl;
  opts: {
    label: string;
    strings: Record<string, string>;
    disabledReason: string | null;
    onCommit: () => Promise<Answer>;
    onDone: (r: Answer) => void;
  };
  reason: string | null;
}
interface Answer {
  status: string; reason?: string; final?: boolean;
  seal?: { label?: string; chip?: string; recordedAt?: string | null; recordedTemplate?: string };
}

type ServerAnswer = { status: number; body: unknown } | 'network';
const TOKEN = 'x'.repeat(64);
const LOADED = {
  ok: true, id: 'w1', status: 'requested', signed_at: null, sub_name: 'Volt Electric LLC',
  paid_amount: 18400, through_date: '2026-08-31', waiver_type: 'unconditional_partial',
  project_name: 'Henderson Remodel', company_name: 'Hallway Homes LLC',
  waiver_title: 'UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT',
  statute_citation: 'Cal. Civ. Code § 8134', state_name: 'California',
  document_html: '<html><body>SEALED BYTES</body></html>',
};
const settle = () => new Promise<void>(r => setTimeout(r, 0));

async function runPage(sign: ServerAnswer, withMoments: boolean) {
  const els = new Map<string, StubEl>();
  const inserted: { node: StubEl; before: string }[] = [];
  const created: StubEl[] = [];
  const get = (id: string) => { if (!els.has(id)) els.set(id, stubEl(id, inserted)); return els.get(id)!; };
  const lines: FakeLine[] = [];
  const posted: Record<string, unknown>[] = [];
  function MomentLine(this: FakeLine, host: StubEl, opts: FakeLine['opts']) {
    this.host = host;
    this.opts = opts;
    this.reason = opts.disabledReason || null;
    lines.push(this);
  }
  (MomentLine.prototype as unknown as { setDisabledReason: (t: string | null) => void }).setDisabledReason =
    function (this: FakeLine, t: string | null) { this.reason = t || null; };
  const win: Record<string, unknown> = {
    location: { pathname: '/lien-waiver/w1', search: `?t=${TOKEN}` }, addEventListener() {}, devicePixelRatio: 1,
    open: () => null, URLSearchParams,
  };
  if (withMoments) win.MageMoments = { MomentLine };
  const sandbox: Record<string, unknown> = {
    window: win,
    document: {
      getElementById: get,
      createElement: () => { const n = stubEl('', inserted); created.push(n); return n; },
    },
    navigator: { userAgent: 'validator/1.0' },
    fetch: (_url: string, init: { body: string }) => {
      const payload = JSON.parse(init.body) as Record<string, unknown>;
      posted.push(payload);
      const a: ServerAnswer = payload.p_signer_name === undefined ? { status: 200, body: LOADED } : sign;
      if (a === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({
        ok: a.status >= 200 && a.status < 300, status: a.status,
        text: () => Promise.resolve(JSON.stringify(a.body)),
      });
    },
    URLSearchParams, JSON, Math, Date, isFinite, Number, String, RegExp, Array, Object, Error,
    console: { log() {}, warn() {}, error() {} }, setTimeout, parseFloat, isNaN,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(pageScript, sandbox);
  await settle();
  // An element the page created and gave an id is reachable by that id, as in a browser.
  for (const n of created) if (n.id && !els.has(n.id)) els.set(n.id, n);
  return { get, els, lines, inserted, created, posted };
}

async function filledPage(sign: ServerAnswer, withMoments = true) {
  const r = await runPage(sign, withMoments);
  r.get('pad').fire('mousedown'); r.get('pad').fire('mousemove'); r.get('pad').fire('touchend');
  r.get('signer-name').value = 'Jordan Reyes'; r.get('signer-name').fire('input');
  r.get('consent').checked = true; r.get('consent').fire('change');
  return r;
}

/** onCommit's promise, settled: the answer, or the rejection. */
async function commit(line: FakeLine): Promise<{ answer?: Answer; rejected?: unknown }> {
  try { return { answer: await line.opts.onCommit() }; }
  catch (e) { return { rejected: e }; }
}

console.log('\nLIENSLIDE: the page loads the portal\'s own signing line');
ok('moments.css loads in <head> at the portal\'s own ?v=',
  /<head>[\s\S]*<link href="\/portal\/moments\.css\?v=2026-09-28-w3" rel="stylesheet" \/>[\s\S]*<\/head>/.test(page));
{
  const js = page.indexOf('<script src="/portal/moments.js?v=2026-09-28-w3"></script>');
  const own = page.indexOf('<script>\n');
  ok('moments.js loads before the page script, at the portal\'s own ?v=', js > 0 && own > js, `${js} / ${own}`);
}
ok('the portal still serves both files at that version (same files, no copy)',
  portal.includes('/portal/moments.css?v=2026-09-28-w3') && portal.includes('/portal/moments.js?v=2026-09-28-w3'));
ok('the tokens moments.css reads are defined on the page',
  ['--bone:', '--bone-2:', '--brand-tint:', '--shadow-brand:', '--font-display:', '--brand:', '--surface:', '--error:']
    .every(t => page.includes(t)));
ok('the page script can be extracted and run', pageScript.length > 500);

// ── LS1 ─────────────────────────────────────────────────────────────────────
console.log('\nLS1 with moments.js loaded, the line takes the button\'s place');
{
  const r = await runPage({ status: 200, body: { ok: true, signed_at: '2026-10-02T15:00:00Z' } }, true);
  const line = r.lines[0];
  ok('exactly one line is mounted', r.lines.length === 1, `${r.lines.length}`);
  ok('…in a new <div id="sign-line"> where the button was',
    !!line && line.host.id === 'sign-line' && r.inserted.length === 1 && r.inserted[0].before === 'submit'
    && r.inserted[0].node === line.host);
  ok('#submit is hidden (still in the DOM for the fallback)', r.get('submit').hidden === true);
  ok(`the line says "${LABEL}"`, line?.opts.label === LABEL, line?.opts.label);
  const strings = line?.opts.strings ?? {};
  const portalSays = (key: string) => (portal.match(new RegExp(`\\b${key}: '([^']+)'`)) ?? [])[1];
  ok('hint, armed, cancelled and noAnswer are the portal\'s English sentences, verbatim',
    strings.hint === portalSays('momentHint') && strings.armed === portalSays('momentArmed')
    && strings.cancelled === portalSays('momentCancelled') && strings.noAnswer === portalSays('momentNoAnswer')
    && !!strings.hint && !!strings.noAnswer,
    JSON.stringify(strings));
  ok('busy is "Waiting for the server to record your signature."',
    strings.busy === 'Waiting for the server to record your signature.' && strings.busy === portalSays('contractSignBusy'));
  ok('the line starts locked with the page\'s own sentence', line?.opts.disabledReason === NOT_READY && line?.reason === NOT_READY);
  ok('#submit-note stays empty while the line is mounted', r.get('submit-note').textContent === '',
    r.get('submit-note').textContent);

  r.get('pad').fire('mousedown'); r.get('pad').fire('mousemove'); r.get('pad').fire('touchend');
  ok('a signature alone keeps it locked', line?.reason === NOT_READY);
  r.get('signer-name').value = 'Jordan Reyes'; r.get('signer-name').fire('input');
  ok('a signature and a name keep it locked (consent missing)', line?.reason === NOT_READY);
  r.get('consent').checked = true; r.get('consent').fire('change');
  ok('name, signature and consent unlock it (null)', line?.reason === null, String(line?.reason));
  ok('…and #submit-note is still empty', r.get('submit-note').textContent === '');
  r.get('consent').checked = false; r.get('consent').fire('change');
  ok('unticking consent locks it again with the same sentence', line?.reason === NOT_READY);
}

// ── LS2 ─────────────────────────────────────────────────────────────────────
console.log('\nLS2 only the server\'s {ok:true} confirms, with the server\'s time');
{
  const SERVER_AT = '2026-10-02T15:00:00Z';
  const r = await filledPage({ status: 200, body: { ok: true, already_signed: false, signed_at: SERVER_AT } });
  const line = r.lines[0];
  const pending = commit(line);
  ok('while the signature is in flight, name, title, consent and Clear are read-only',
    r.get('signer-name').readOnly === true && r.get('signer-title').readOnly === true
    && r.get('consent').disabled === true && r.get('pad-clear').disabled === true);
  const out = await pending;
  const a = out.answer;
  ok('onCommit resolves confirmed', a?.status === 'confirmed', JSON.stringify(out));
  ok('seal.recordedAt is the server\'s signed_at string, not this device\'s clock',
    a?.seal?.recordedAt === SERVER_AT, String(a?.seal?.recordedAt));
  ok('the seal reads "Signed. This waiver is recorded." with the chip "Signed"',
    a?.seal?.label === 'Signed. This waiver is recorded.' && a?.seal?.chip === 'Signed');
  ok('the Recorded template says server time',
    a?.seal?.recordedTemplate === 'Recorded {date}, {time} (server time).');
  ok('the done card is NOT shown by onCommit (the seal shows first)',
    r.get('done').hidden === true && r.get('signing').hidden === false);
  const posted = r.posted[r.posted.length - 1];
  ok('the line posts the same signature the button does (strokes as text, consent, token)',
    typeof posted.p_signature_paths === 'string' && posted.p_consent_accepted === true
    && posted.p_access_token === TOKEN && posted.p_waiver_id === 'w1'
    && String(posted.p_consent_record).includes('I intend this to be my signature'));
  line.opts.onDone(a!);
  ok('onDone(confirmed) shows the done card, the button\'s own path',
    r.get('done').hidden === false && r.get('signing').hidden === true
    && /Hallway Homes LLC can see it on this job in MAGE ID\./.test(r.get('done-body').textContent),
    r.get('done-body').textContent);
}
{
  const r = await filledPage({ status: 200, body: { ok: true } });
  const a = (await commit(r.lines[0])).answer;
  ok('without the server\'s signed_at the seal has no Recorded time (null, not the client\'s)',
    a?.status === 'confirmed' && a.seal?.recordedAt === null, JSON.stringify(a?.seal));
}
{
  const r = await filledPage({ status: 200, body: { signed_at: '2026-10-02T15:00:00Z' } });
  const out = await commit(r.lines[0]);
  ok('a 200 with no ok:true is never confirmed (it rejects: no answer)',
    !out.answer && out.rejected !== undefined && r.get('done').hidden === true, JSON.stringify(out));
}
{
  const r = await filledPage({ status: 200, body: { ok: 'true', signed_at: '2026-10-02T15:00:00Z' } });
  const out = await commit(r.lines[0]);
  ok('ok:"true" (a string) is not ok:true', out.answer?.status !== 'confirmed', JSON.stringify(out));
}

// ── LS3 ─────────────────────────────────────────────────────────────────────
console.log('\nLS3 the four refusals keep their sentences');
const REFUSALS: { code: string; reason: string; final: boolean }[] = [
  { code: 'lien_waiver_consent_required', final: false,
    reason: 'Tick the box above to agree to sign electronically. Nothing has been signed.' },
  { code: 'lien_waiver_signer_required', final: false,
    reason: 'Type your full legal name above. Nothing has been signed.' },
  { code: 'lien_waiver_voided', final: true,
    reason: 'This waiver was voided by the contractor while you had it open. '
      + 'There is nothing to sign. Nothing has been signed.' },
  { code: 'lien_waiver_denied', final: true,
    reason: 'This signing link has been replaced. The contractor sent a newer '
      + 'one. Open the most recent email and sign there. Nothing has been signed here.' },
];
for (const c of REFUSALS) {
  const r = await filledPage({ status: 400, body: { code: 'P0001', message: c.code } });
  const a = (await commit(r.lines[0])).answer;
  ok(`${c.code} → refused with its existing sentence`, a?.status === 'refused' && a.reason === c.reason,
    JSON.stringify(a));
  ok(`${c.code} → ${c.final ? 'final: true' : 'not final'}`, (a?.final === true) === c.final, JSON.stringify(a));
  ok(`${c.code} → ${c.final ? 'the form stays read-only' : 'the form is handed back'}`,
    r.get('signer-name').readOnly === c.final && r.get('consent').disabled === c.final
    && r.get('signer-title').readOnly === c.final);
  ok(`${c.code} → no done card, #submit-note still empty`,
    r.get('done').hidden === true && r.get('submit-note').textContent === '');
}

// ── LS4 ─────────────────────────────────────────────────────────────────────
console.log('\nLS4 no answer rejects, and the line locks');
for (const [name, sign] of [
  ['a fetch rejection (offline)', 'network'],
  ['a 500 the page cannot read', { status: 500, body: { message: 'boom' } }],
  ['an unknown refusal', { status: 400, body: { code: 'P0001', message: 'some other failure' } }],
] as const) {
  const r = await filledPage(sign as ServerAnswer);
  const out = await commit(r.lines[0]);
  ok(`${name} gives a rejected promise, never "confirmed"`, !out.answer && out.rejected !== undefined,
    JSON.stringify(out));
  ok(`${name} never shows the done card`, r.get('done').hidden === true && r.get('signing').hidden === false);
  ok(`${name} keeps the form read-only (the outcome is unknown)`, r.get('signer-name').readOnly === true);
}
ok('no answer tells the sub to refresh and check, never to just try again',
  page.includes("noAnswer: 'No answer yet. Refresh the page to check before trying again.'"));

// ── LS5 ─────────────────────────────────────────────────────────────────────
console.log('\nLS5 without moments.js the button path is unchanged');
{
  const r = await runPage({ status: 200, body: { ok: true, signed_at: '2026-10-02T15:00:00Z' } }, false);
  ok('no line and no #sign-line', r.lines.length === 0 && r.inserted.length === 0 && r.created.length === 0
    && !r.els.has('sign-line'));
  ok('#submit is visible and off, with the page\'s sentence in #submit-note',
    r.get('submit').hidden === false && r.get('submit').disabled === true
    && r.get('submit-note').textContent === NOT_READY);
  r.get('pad').fire('mousedown'); r.get('pad').fire('mousemove'); r.get('pad').fire('touchend');
  r.get('signer-name').value = 'Jordan Reyes'; r.get('signer-name').fire('input');
  r.get('consent').checked = true; r.get('consent').fire('change');
  ok('with all three the button enables', r.get('submit').disabled === false && r.get('submit-note').textContent === '');
  r.get('submit').fire('click');
  await settle(); await settle();
  ok('the button signs and shows the done card with the server\'s time',
    r.get('done').hidden === false && /can see it on this job/.test(r.get('done-body').textContent));
  ok('the button never locks the form (unchanged behavior)', r.get('signer-name').readOnly === false);
}
for (const [name, sign, note, pressable] of [
  ['voided', { status: 400, body: { message: 'lien_waiver_voided' } }, REFUSALS[2].reason, false],
  ['denied', { status: 400, body: { message: 'lien_waiver_denied' } }, REFUSALS[3].reason, true],
  ['unknown', { status: 400, body: { message: 'x' } },
    'That did not go through. Check your connection and try again. Nothing has been signed.', true],
  ['network', 'network', 'We could not reach the server. Nothing has been signed. Try again.', true],
] as const) {
  const r = await filledPage(sign as ServerAnswer, false);
  r.get('submit').fire('click');
  await settle(); await settle();
  ok(`button, ${name}: today's sentence, byte for byte`, r.get('submit-note').textContent === note,
    r.get('submit-note').textContent);
  ok(`button, ${name}: ${pressable ? 'pressable again' : 'stays off'} and labelled "Sign This Waiver"`,
    r.get('submit').disabled === !pressable && r.get('submit').textContent === 'Sign This Waiver'
    && r.get('done').hidden === true);
}

// ── LS6 ─────────────────────────────────────────────────────────────────────
console.log('\nLS6 the consent record is unchanged');
// Pinned as changed by PROTECT-TEXT (2026-10-09, version bumped to v2; the stored
// record keeps its own version and text per signature). Changing signed consent wording needs a new
// CONSENT_VERSION and a legal-text pass, never a ride-along in a UI lane.
const CONSENT_SOURCE_ON_MAIN = `  var CONSENT_VERSION = '2026-10-esign-v2';
  var CONSENT_TEXT =
    'I agree to sign this lien waiver electronically. I intend this to be my signature. '
    + 'I have read the document above and I am the person named as the claimant, or I am authorised to sign for them.';
`;
ok('CONSENT_VERSION and CONSENT_TEXT are byte-identical to main', page.includes(CONSENT_SOURCE_ON_MAIN));
{
  const r = await filledPage({ status: 200, body: { ok: true, signed_at: '2026-10-02T15:00:00Z' } });
  await commit(r.lines[0]);
  const rec = String(r.posted[r.posted.length - 1].p_consent_record);
  ok('the consent record the line posts carries the same version and text',
    rec.includes('version: 2026-10-esign-v2') && rec.includes('or I am authorised to sign for them.')
    && r.posted[r.posted.length - 1].p_consent_version === '2026-10-esign-v2');
}

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-lien-slide: ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
