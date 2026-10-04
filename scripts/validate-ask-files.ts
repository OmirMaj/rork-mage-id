// scripts/validate-ask-files.ts — Ask MAGE reads a photo, a PDF or a plan page
// (lane ATTASK), and the client half of the contract the portal sheet shares.
//
// The feature ships DARK. This guard holds, with the flags off and on paper:
//
//   A. LIMITS. Every limit in utils/askFilesCore.ts equals its literal, and
//      equals the server's (supabase/functions/ask-files/core.ts). No limit is
//      typed into a sentence: every number in the English is a variable.
//   B. FLAGS. ASK_FILES_ENABLED and PORTAL_MESSAGE_AI_ENABLED are false in the
//      source. A client flag may be truthy only if its server switch is true.
//   C. PURE RULES. What Ask keeps of a pick (vetAskFiles), which plan paths may
//      be sent (isAskablePlanPath, the server's planSheetKey rule), what a
//      saved turn may remember about a file (a name, a kind, a page count and
//      nothing else), which turns the text model may be sent, how every error
//      code becomes a sentence, and the own-words gate for file text: sheet,
//      invoice and change-order numbers and a client's quoted words pass,
//      and an answer that names no code and no code section is shown as
//      written. When ANY sentence of the answer names a model code or a code
//      section, wherever it stands (above the body, a blank line away, after
//      it), every sentence with code phrasing or a long run is withheld, and
//      so is a code-like sentence that quotes; an open quotation takes at most
//      FILE_QUOTE_CARRY_SENTENCES sentences with it. THE COST, pinned below:
//      in such an answer contract wording with "shall" is withheld too.
//      NOT held (pinned below as known limits): code text in an answer that
//      names no code and no code section (a one-decimal number with no
//      "Section" word, a file named after its section), or with no code
//      phrasing and a short run. The server's prompt rule is the first line.
//   D. SOURCE. The function is named in exactly one app file; askFiles checks
//      the flag, the connection and the consent gate before it reads a file or
//      sends anything; every new element in AskConversation sits behind the
//      flag; the pickers run at quality 0.4 with no EXIF and never through the
//      message picker hook; no new file writes to a log or to storage.
//
// PARITY and the server half of B need supabase/functions/ask-files/core.ts.
// When it is missing those checks FAIL, unless ATT_SOLO=1 (a lane working
// before the server lane's files are on the branch), which prints
// "parity: skipped (ATT_SOLO)". The integrator runs it without the switch.
//
// Pure: imports utils/askFilesCore.ts and constants/featureFlags.ts (neither
// pulls react-native); everything else is read as text.
// Run: bun run scripts/validate-ask-files.ts

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import * as core from '../utils/askFilesCore';
import * as flags from '../constants/featureFlags';
import type { AskAttachedFile, AskFileRead } from '../types';
import type { AskCopy } from '../hooks/useAskCopy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; }
};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log('  PASS  ' + name); return; }
  fail++;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail.split('\n').join('\n        ') : ''));
}

/** Blank out // and /* *\/ comments; strings and newlines kept. */
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
    i++;
  }
  return out.join('');
}

function walk(dir: string, out: string[] = []): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(relative(ROOT, join(ROOT, rel)));
  }
  return out;
}

const SOLO = process.env.ATT_SOLO === '1';
const SERVER_CORE = 'supabase/functions/ask-files/core.ts';

// ═══ A. Limits ═══════════════════════════════════════════════════════════════
console.log('\nAsk files — A. limits');

const LITERALS: [keyof typeof core, number][] = [
  ['ASK_MAX_FILES', 4],
  ['ASK_DEVICE_TOTAL_MAX_BYTES', 6291456],
  ['ASK_PLAN_PAGE_MAX_BYTES', 8388608],
  ['ASK_MESSAGE_FILE_MAX_BYTES', 4194304],
  ['ASK_TOTAL_MAX_BYTES', 8388608],
  ['ASK_PDF_MAX_PAGES', 20],
  ['ASK_QUESTION_MAX', 2000],
  ['ASK_CLIENT_TIMEOUT_MS', 140000],
  ['FILE_CODE_RUN_WORDS', 40],
];
for (const [name, value] of LITERALS) {
  ok(`${name} === ${value}`, (core as Record<string, unknown>)[name] === value, `is ${String((core as Record<string, unknown>)[name])}`);
}
ok('ASK_FILE_MIMES is JPEG, PNG, WebP, PDF, in that order',
  JSON.stringify(core.ASK_FILE_MIMES) === JSON.stringify(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']));
ok('mbOf: whole megabytes (6 MB device, 8 MB plan page, 4 MB message file)',
  core.mbOf(core.ASK_DEVICE_TOTAL_MAX_BYTES) === 6 && core.mbOf(core.ASK_PLAN_PAGE_MAX_BYTES) === 8
  && core.mbOf(core.ASK_MESSAGE_FILE_MAX_BYTES) === 4 && core.mbOf(core.ASK_TOTAL_MAX_BYTES) === 8);
ok('the device allowance is the wire size analyze-photos accepts (6,291,456 bytes = 8,388,608 base64 characters)',
  Math.ceil(core.ASK_DEVICE_TOTAL_MAX_BYTES / 3) * 4 === 8388608);
ok('decodedBase64Bytes: length * 3 / 4 minus the padding',
  core.decodedBase64Bytes('') === 0 && core.decodedBase64Bytes('QQ==') === 1 && core.decodedBase64Bytes('QUI=') === 2
  && core.decodedBase64Bytes('QUJD') === 3 && core.decodedBase64Bytes('A'.repeat(8388608)) === 6291456);

// Parity with the server, and the switches part B reads.
type ServerCore = Record<string, unknown>;
let server: ServerCore | null = null;
if (existsSync(join(ROOT, SERVER_CORE))) {
  try {
    server = await import(join(ROOT, SERVER_CORE)) as ServerCore;
  } catch (e) {
    ok(`${SERVER_CORE} can be imported under bun`, false, e instanceof Error ? e.message : String(e));
  }
  if (server) {
    const PAIRS: [string, keyof typeof core][] = [
      ['MAX_FILES', 'ASK_MAX_FILES'],
      ['DEVICE_TOTAL_MAX_BYTES', 'ASK_DEVICE_TOTAL_MAX_BYTES'],
      ['PLAN_PAGE_MAX_BYTES', 'ASK_PLAN_PAGE_MAX_BYTES'],
      ['MESSAGE_FILE_MAX_BYTES', 'ASK_MESSAGE_FILE_MAX_BYTES'],
      ['TOTAL_MAX_BYTES', 'ASK_TOTAL_MAX_BYTES'],
      ['PDF_MAX_PAGES', 'ASK_PDF_MAX_PAGES'],
      ['QUESTION_MAX', 'ASK_QUESTION_MAX'],
    ];
    for (const [s, a] of PAIRS) {
      ok(`parity: server ${s} === app ${a}`, typeof server[s] === 'number' && server[s] === (core as Record<string, unknown>)[a],
        `server ${String(server[s])}, app ${String((core as Record<string, unknown>)[a])}`);
    }
  }
} else if (SOLO) {
  console.log('  SKIP  parity: skipped (ATT_SOLO)');
} else {
  ok(`parity: ${SERVER_CORE} exists (set ATT_SOLO=1 only inside the lane, before the server lane lands)`, false);
}

// No limit typed into a sentence: the only digit an Ask-files string may hold
// is the "1" of a plural's singular form.
const shard = read('i18n/catalog/en/ai.ask.generated.ts');
const fileLines = shard.split('\n').filter((l) => /^\s*"ai\.ask\.files\./.test(l));
ok('the English shard holds the Ask-files strings', fileLines.length >= 60, `found ${fileLines.length}`);
const digitLines = fileLines.filter((l) => {
  const value = l.slice(l.indexOf(':') + 1).replace(/\{[a-z]+\}/gi, '').replace(/\bone: "[^"]*"/, '');
  return /\d/.test(value);
});
ok('no number is typed into an Ask-files sentence (every limit is a variable)', digitLines.length === 0, digitLines.join('\n'));

// ═══ B. Flags ════════════════════════════════════════════════════════════════
console.log('\nAsk files — B. flags');

const flagsSrc = read('constants/featureFlags.ts');
ok('ASK_FILES_ENABLED is false in the source', /\nexport const ASK_FILES_ENABLED = false;\n/.test(flagsSrc));
ok('PORTAL_MESSAGE_AI_ENABLED is false in the source', /\nexport const PORTAL_MESSAGE_AI_ENABLED = false;\n/.test(flagsSrc));
const askOn = !!(flags as Record<string, unknown>).ASK_FILES_ENABLED;
const portalOn = !!(flags as Record<string, unknown>).PORTAL_MESSAGE_AI_ENABLED;
ok('both flags import as off', !askOn && !portalOn);
if (server) {
  ok('ASK_FILES_ENABLED may be on only if the server has ASK_FILES_SERVER_ENABLED = true',
    !askOn || server.ASK_FILES_SERVER_ENABLED === true);
  ok('PORTAL_MESSAGE_AI_ENABLED may be on only if the server has both switches true',
    !portalOn || (server.ASK_FILES_SERVER_ENABLED === true && server.MESSAGE_SOURCE_ENABLED === true));
  ok('the server exports both switches as booleans',
    typeof server.ASK_FILES_SERVER_ENABLED === 'boolean' && typeof server.MESSAGE_SOURCE_ENABLED === 'boolean');
} else if (SOLO) {
  console.log('  SKIP  parity: skipped (ATT_SOLO)');
  ok('with no server file to read, both client flags are off', !askOn && !portalOn);
} else {
  ok(`flags: ${SERVER_CORE} exists, so the server switches can be read`, false);
}

// ═══ C. Pure rules ═══════════════════════════════════════════════════════════
console.log('\nAsk files — C. pure rules');

const MB = 1048576;
const dev = (id: string, size: number, mime: 'image/jpeg' | 'application/pdf' = 'image/jpeg', pages?: number): AskAttachedFile =>
  ({ id, source: 'device', name: `${id}.${mime === 'application/pdf' ? 'pdf' : 'jpg'}`, mime, size, localUri: `file:///cache/${id}`, ...(pages ? { pages } : {}) });
const planFile = (id: string): AskAttachedFile => ({ id, source: 'plan', name: `Sheet ${id}`, storagePath: `11111111-1111-4111-8111-111111111111/${id}.png` });

{
  const five = [1, 2, 3, 4, 5].map((n) => ({ name: `p${n}.jpg`, size: MB }));
  const r = core.vetAskFiles(five, []);
  ok('vetAskFiles: four kept, the fifth refused for count', JSON.stringify(r.kept) === '[0,1,2,3]'
    && r.refused.length === 1 && r.refused[0].index === 4 && r.refused[0].reason === 'count' && r.refused[0].name === 'p5.jpg');
  const withTray = core.vetAskFiles(five.slice(0, 3), [planFile('a'), planFile('b'), planFile('c')]);
  ok('vetAskFiles: the count includes what is already in the tray (plan pages too)',
    JSON.stringify(withTray.kept) === '[0]' && withTray.refused.map((x) => x.reason).join() === 'count,count');
  const exact = core.vetAskFiles([{ name: 'a.jpg', size: core.ASK_DEVICE_TOTAL_MAX_BYTES }], []);
  const over = core.vetAskFiles([{ name: 'a.jpg', size: core.ASK_DEVICE_TOTAL_MAX_BYTES + 1 }], []);
  ok('vetAskFiles: exactly the device limit is kept; one byte more is refused for size',
    exact.kept.length === 1 && exact.refused.length === 0
    && over.kept.length === 0 && over.refused[0].reason === 'size' && over.refused[0].size === core.ASK_DEVICE_TOTAL_MAX_BYTES + 1);
  const total = core.vetAskFiles([{ name: 'b.jpg', size: 2 * MB }, { name: 'c.jpg', size: MB }], [dev('a', 4 * MB), planFile('p')]);
  ok('vetAskFiles: the total runs across the tray and the pick (4 MB attached + 2 MB kept, then 1 MB more is refused)',
    JSON.stringify(total.kept) === '[0]' && total.refused.length === 1 && total.refused[0].reason === 'total'
    && total.refused[0].index === 1 && total.refused[0].size === 7 * MB);
  const totalEdge = core.vetAskFiles([{ name: 'b.jpg', size: 2 * MB + 1 }], [dev('a', 4 * MB)]);
  ok('vetAskFiles: one byte past the total is refused for total', totalEdge.kept.length === 0 && totalEdge.refused[0].reason === 'total');
  const planDoesNotCount = core.vetAskFiles([{ name: 'b.jpg', size: 6 * MB }], [planFile('p')]);
  ok('vetAskFiles: a plan page in the tray takes a slot but no device megabytes', planDoesNotCount.kept.length === 1);
  const unknown = core.vetAskFiles([{ name: 'u.jpg', size: 0 }], [dev('a', 6 * MB)]);
  ok('vetAskFiles: an unknown size (0) passes; the bytes are measured at send', unknown.kept.length === 1 && unknown.refused.length === 0);
  const order = core.vetAskFiles([{ name: 'big.jpg', size: 7 * MB }], [planFile('a'), planFile('b'), planFile('c'), planFile('d')]);
  ok('vetAskFiles: count is checked before size', order.refused[0].reason === 'count');
  const sizeFirst = core.vetAskFiles([{ name: 'big.jpg', size: 7 * MB }], [dev('a', 5 * MB)]);
  ok('vetAskFiles: size is checked before total', sizeFirst.refused[0].reason === 'size');
}

{
  const P = '3f2b8c1e-9d4a-4b6f-8a21-5c7e9f0a1b2c';
  const O = '7a1c5e9b-2d4f-4a6b-9c8d-0e1f2a3b4c5d';
  const accept = [
    `${P}/${O}-page-3.png`,
    `${P}/img-abc_1.2.jpg`,
    `${P}/A-201_Floor.Plan.png`,
    `${P}/${'a'.repeat(124)}.png`,
  ];
  const refuse: [string, unknown][] = [
    ['%2e%2e into another project', `${P}/%2e%2e/${O}/x.png`],
    ['.%2E', `${P}/.%2E/x.png`],
    ['%2E%2E/%2E%2E into another bucket', `${P}/%2E%2E/%2E%2E/message-attachments/a/b/c.jpg`],
    ['a backslash', `${P}\\..\\x.png`],
    ['a query', `${P}/x.png?download=1`],
    ['a fragment', `${P}/x.png#a`],
    ['three segments', `${P}/a/b.png`],
    ['one segment', `x.png`],
    ['a leading space', ` ${P}/x.png`],
    ['a trailing space', `${P}/x.png `],
    ['a space inside', `${P}/x y.png`],
    ['a tab', `${P}/x\ty.png`],
    ['a newline', `${P}/x.png\n`],
    ['a control character', `${P}/x\u0007.png`],
    ['a leading slash', `/${P}/x.png`],
    ['a .pdf', `${P}/x.pdf`],
    ['no extension', `${P}/x`],
    ['a file that starts with a dot', `${P}/.png`],
    ['dot-dot as the file', `${P}/..`],
    ['a project that is not a uuid', `project/x.png`],
    ['an empty string', ''],
    ['over 256 characters', `${P}/${'a'.repeat(196)}.png${'x'.repeat(40)}`],
    ['a 129-character file name', `${P}/${'a'.repeat(125)}.png`],
    // What the storage rule refuses (supabase/functions/_shared/storagePath.ts):
    // no writer of the bucket spells a key this way, and an upper-case id is a
    // DIFFERENT storage folder.
    ['an upper-case project id', `${P.toUpperCase()}/x.png`],
    ['an upper-case extension', `${P}/x.PNG`],
    ['a .jpeg', `${P}/sheet.jpeg`],
    ['a .webp', `${P}/a.webp`],
    ['a character outside ASCII', `${P}/pl\u00e1n.png`],
    ['a fullwidth dot segment', `${P}/\uff0e\uff0e/x.png`],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['an object', { path: `${P}/x.png` }],
  ];
  const badAccept = accept.filter((p) => !core.isAskablePlanPath(p));
  ok(`isAskablePlanPath: accepts <project uuid>/<file> (${accept.length} cases)`, badAccept.length === 0, badAccept.join('\n'));
  const badRefuse = refuse.filter(([, p]) => core.isAskablePlanPath(p)).map(([why]) => why);
  ok(`isAskablePlanPath: refuses everything else (${refuse.length} cases)`, badRefuse.length === 0, badRefuse.join('\n'));
  ok('isAskablePlanPath: a 128-character file name is the longest accepted',
    core.isAskablePlanPath(`${P}/${'a'.repeat(124)}.png`) && !core.isAskablePlanPath(`${P}/${'a'.repeat(125)}.png`));
  // What it accepts survives a URL unchanged (the server's last check).
  ok('isAskablePlanPath: every accepted path is its own URL pathname',
    accept.every((p) => new URL('https://h/' + p).pathname === '/' + p));

  // Who is offered the Plan page row: the job's owner, and nobody else.
  {
    const st = (role: string | null | undefined, isLoading = false, isError = false, hasJob = true, isPaused = false) =>
      core.askPlanRowBlock({ hasJob, role, isLoading, isError, isPaused });
    ok('askPlanRowBlock: the owner of the anchored job can pick a page', st('owner') === null);
    ok("askPlanRowBlock: with no job the row is off as 'noJob', whatever the role says",
      st('owner', false, false, false) === 'noJob' && st(null, true, false, false) === 'noJob' && st('editor', false, true, false) === 'noJob'
      && st(null, false, false, false) === 'noJob');
    ok("askPlanRowBlock: an editor, a viewer and a field seat are 'notOwner'",
      ['editor', 'viewer', 'field'].every((r) => st(r) === 'notOwner'));
    // The three states of the role check (lane ATT3). Each has its own sentence.
    ok("askPlanRowBlock, still loading: 'checking', never the owner and never 'notOnJob'",
      st(null, true) === 'checking' && st(undefined, true) === 'checking' && st(null, true, false, true, true) === 'checking');
    ok("askPlanRowBlock, the check did not complete (the read failed): 'unknown', never 'notOnJob'",
      st(null, false, true) === 'unknown' && st('editor', false, true) === 'unknown' && st(null, false, true, true, true) === 'unknown');
    ok("askPlanRowBlock, the check did not complete (the read is waiting for a network): 'unknown', never 'notOnJob'",
      st(null, false, false, true, true) === 'unknown');
    ok("askPlanRowBlock, a SETTLED no (role null, not loading, no error, not paused): 'notOnJob', not 'unknown'",
      st(null) === 'notOnJob' && st(null, false, false, true, false) === 'notOnJob');
    ok("askPlanRowBlock, a settled yes: the owner is allowed (null), and a seat that is not the owner's is 'notOwner'",
      st('owner') === null && st('editor') === 'notOwner' && st('field', false, false, true, true) === 'notOwner');
    ok("askPlanRowBlock: a state the rule does not know (no role value, an empty one, a flag that is not a boolean) is 'unknown', never 'notOnJob'",
      st(undefined) === 'unknown' && st('') === 'unknown'
      && core.askPlanRowBlock({ hasJob: true, role: null, isLoading: false, isError: false } as unknown as Parameters<typeof core.askPlanRowBlock>[0]) === 'unknown'
      && core.askPlanRowBlock({ hasJob: true, role: null, isLoading: undefined, isError: false, isPaused: false } as unknown as Parameters<typeof core.askPlanRowBlock>[0]) === 'unknown'
      && core.askPlanRowBlock({ hasJob: true, role: null, isLoading: false, isError: undefined, isPaused: false } as unknown as Parameters<typeof core.askPlanRowBlock>[0]) === 'unknown');
    ok("askPlanRowBlock: 'owner' is matched exactly ('Owner', ' owner' and a truthy non-string are not the owner)",
      st('Owner') === 'notOwner' && st(' owner') === 'notOwner' && st(true as unknown as string) === 'unknown');
    ok('askPlanRowBlock: the owner stamp wins over a failed or running collaborator read (his own job is never locked on a blip)',
      st('owner', true) === null && st('owner', false, true) === null && st('owner', false, false, true, true) === null);
    const rows = [true, false].flatMap((hasJob) => ['owner', 'editor', 'viewer', 'field', null].flatMap((role) =>
      [true, false].flatMap((isLoading) => [true, false].flatMap((isError) => [true, false].map((isPaused) => ({ hasJob, role, isLoading, isError, isPaused }))))));
    const open = rows.filter((r) => core.askPlanRowBlock(r) === null);
    ok(`askPlanRowBlock: of all ${rows.length} states, the row is on only for an owner with a job`,
      rows.length === 80 && open.length === 8 && open.every((r) => r.hasJob && r.role === 'owner'));
    const notOn = rows.filter((r) => core.askPlanRowBlock(r) === 'notOnJob');
    ok(`askPlanRowBlock: of all ${rows.length} states, exactly one is 'notOnJob': a job, role null, not loading, no error, not paused`,
      notOn.length === 1 && notOn[0].hasJob && notOn[0].role === null && !notOn[0].isLoading && !notOn[0].isError && !notOn[0].isPaused,
      JSON.stringify(notOn));
    const tryAgain = rows.filter((r) => core.askPlanRowBlock(r) === 'unknown');
    ok(`askPlanRowBlock: "couldn't check, try again" ('unknown') is only ever said when the read failed or is paused (${tryAgain.length} states)`,
      tryAgain.length > 0 && tryAgain.every((r) => r.hasJob && !r.isLoading && r.role !== 'owner' && (r.isError || (r.isPaused && r.role === null))),
      JSON.stringify(tryAgain.filter((r) => !(r.isError || r.isPaused))));
  }

  // The same strings through the server's own functions, when its file is here.
  if (server) {
    const planSheetKey = server.planSheetKey as ((raw: unknown) => string) | undefined;
    const all: unknown[] = [...accept, ...refuse.map(([, p]) => p), `${P}/${'a'.repeat(196)}.png`, `${P}/${'a'.repeat(123)}.jpg`];
    const differ = typeof planSheetKey === 'function'
      ? all.filter((p) => core.isAskablePlanPath(p) !== (planSheetKey(p) !== '')).map((p) => JSON.stringify(p))
      : ['the server exports no planSheetKey'];
    ok(`parity: isAskablePlanPath agrees with the server's planSheetKey on every case (${all.length})`, differ.length === 0, differ.join('\n'));
    // …and with THE storage rule, which is what the page finally passes on the
    // server before it is read. A page the list offers is a page the rule takes.
    const ruleMod = await import(join(ROOT, 'supabase/functions/_shared/storagePath.ts')) as {
      PLAN_SHEET_PATH: unknown; requestStoragePath(raw: unknown, shape: unknown, pinned?: Record<number, string>): string | null;
    };
    const ruleDiffer = all.filter((p) => core.isAskablePlanPath(p) !== (ruleMod.requestStoragePath(p, ruleMod.PLAN_SHEET_PATH) !== null)).map((p) => JSON.stringify(p));
    ok(`parity: isAskablePlanPath agrees with the storage rule (requestStoragePath, the plan-sheets shape) on every case (${all.length})`,
      ruleDiffer.length === 0, ruleDiffer.join('\n'));
    const decodedBytes = server.decodedBytes as ((b64: string) => number) | undefined;
    ok("parity: decodedBase64Bytes agrees with the server's decodedBytes",
      typeof decodedBytes === 'function'
      && ['', 'QQ==', 'QUI=', 'QUJD', 'A'.repeat(4096), 'A'.repeat(4094) + '=='].every((b) => decodedBytes(b) === core.decodedBase64Bytes(b)));
    const parse = server.parseAskFilesRequest as ((body: unknown) => { ok: boolean }) | undefined;
    const M = '5b8d2f4a-6c1e-4d3b-9a7f-2e0c4b6d8f1a';
    ok('parity: the bodies utils/askFiles.ts builds are bodies the server parser takes',
      typeof parse === 'function'
      && parse({ mode: 'ask', files: [{ source: 'inline', name: 'a.jpg', mime: 'image/jpeg', base64: 'QUJD' }, { source: 'plan', storagePath: accept[0], name: 'A-101' }], question: 'What is this?' }).ok === true
      && parse({ mode: 'message', files: [{ source: 'message', messageId: M, attachmentId: O }] }).ok === true);
    ok('parity: the server refuses a key the app must never send (a location on a message file, an extra top-level key)',
      typeof parse === 'function'
      && parse({ mode: 'message', files: [{ source: 'message', messageId: M, attachmentId: O, path: 'x' }] }).ok === false
      && parse({ mode: 'ask', files: [{ source: 'plan', storagePath: accept[0], name: 'A-101' }], question: 'q', turns: [] }).ok === false);
  }
}

{
  const readList = [
    { index: 0, name: 'IMG_1.jpg', kind: 'image', extra: 'x', storagePath: 'p/x.png' },
    { index: 1, name: 'Spec.pdf', kind: 'pdf', pages: 7, localUri: 'file:///x' },
    { index: 2, name: 'A-101', kind: 'plan', id: 'abc' },
  ] as unknown as AskFileRead[];
  const t = core.toTurnFiles(readList);
  const keys = (o: object) => Object.keys(o).sort().join(',');
  ok('toTurnFiles keeps name, kind and pages ONLY', t.length === 3
    && keys(t[0]) === 'kind,name' && keys(t[1]) === 'kind,name,pages' && keys(t[2]) === 'kind,name'
    && t[1].pages === 7 && t[0].name === 'IMG_1.jpg' && t[2].kind === 'plan',
    JSON.stringify(t));
  ok('toTurnFiles: nothing but a name, a kind and a page count is in the output',
    !/file:|storagePath|localUri|"id"|"index"|"extra"/.test(JSON.stringify(t)));
  const a = core.attachedTurnFiles([dev('photo', 1000), dev('doc', 2000, 'application/pdf', 12), dev('nopages', 2000, 'application/pdf'), planFile('s1')]);
  ok('attachedTurnFiles: image / pdf with pages / pdf without / plan, and only name, kind, pages',
    a.map((x) => x.kind).join() === 'image,pdf,pdf,plan' && a[1].pages === 12 && !('pages' in a[2]) && !('pages' in a[0])
    && a.every((x) => /^(kind,name|kind,name,pages)$/.test(keys(x))),
    JSON.stringify(a));
  ok('attachedTurnFiles never carries a location, an id or a size',
    !/file:|blob:|storagePath|localUri|"id"|"size"|"mime"|11111111-/.test(JSON.stringify(a)));
}

{
  const turns = [
    { role: 'user', text: 'How is the Smith job?' },
    { role: 'assistant', text: 'On budget.' },
    { role: 'user', text: 'What does this show?', files: [{ name: 'a.jpg', kind: 'image' }] },
    { role: 'assistant', text: 'A cracked footing.', read: [{ name: 'a.jpg', kind: 'image' }] },
    { role: 'user', text: 'And this?', files: [{ name: 'a.jpg', kind: 'image' }] },
    { role: 'assistant', text: 'Reading the files took too long.', error: true, read: [] },
    { role: 'user', text: 'Thanks' },
  ];
  const kept = core.withoutFileTurns(turns);
  ok('withoutFileTurns: file questions, file answers and failed file reads are left out; the rest stay in order',
    kept.map((t) => t.text).join('|') === 'How is the Smith job?|On budget.|Thanks');
  ok('withoutFileTurns: no file turns, nothing removed', core.withoutFileTurns(turns.slice(0, 2)).length === 2);
}

// The codes of PLAN 2.6, and the app's own.
const CODE_KEY: Record<string, core.AskFilesErrKey> = {
  too_many_files: 'count', unsupported_type: 'type', file_too_large: 'tooLarge', files_too_large: 'tooLargeTogether',
  too_many_pages: 'pages', unreadable_file: 'unreadable', blocked: 'blocked', feature_off: 'off',
  unauthenticated: 'signIn', tier_required: 'plan', body_too_large: 'tooLargeTogether',
  rate_limiter_unavailable: 'service', hourly_limit: 'generic', bad_request: 'generic', account_ai_off: 'generic',
  ai_check_unavailable: 'service', not_configured: 'service', monthly_cap_reached: 'generic',
  file_unavailable: 'unavailable', before_notice: 'generic', upstream_timeout: 'service', upstream_error: 'service',
  no_answer: 'noAnswer', internal: 'generic',
  offline: 'offline', client_timeout: 'timeout', network: 'network', ai_consent_declined: 'generic',
  some_code_from_the_future: 'generic', '': 'generic',
};
{
  const wrong = Object.entries(CODE_KEY).filter(([code, key]) => core.askFilesErrKey(code) !== key)
    .map(([code, key]) => `${code}: ${core.askFilesErrKey(code)} (want ${key})`);
  ok(`askFilesErrKey: every server code and every app code maps to its sentence (${Object.keys(CODE_KEY).length} codes)`,
    wrong.length === 0, wrong.join('\n'));
  ok('askFilesErrKey: a code that is the name of an Object member is still just an unknown code',
    ['constructor', 'toString', '__proto__', 'hasOwnProperty'].every((c) => core.askFilesErrKey(c) === 'generic'));
  // The table above is checked against the codes the server really sends, so a
  // renamed code (the account refusal was once "ai_off") cannot sit here unseen.
  if (server) {
    const sent = server.ERROR_TEXT && typeof server.ERROR_TEXT === 'object' ? Object.keys(server.ERROR_TEXT as Record<string, unknown>) : [];
    // method_not_allowed answers a request that is not a POST; the app only POSTs.
    const unlisted = sent.filter((c) => c !== 'method_not_allowed' && !Object.prototype.hasOwnProperty.call(CODE_KEY, c));
    const OLD_ACCOUNT_CODE = ['ai', 'off'].join('_');
    ok(`parity: every code in the server's ERROR_TEXT is in the table above (${sent.length} codes), the account refusal as account_ai_off and never under its old name`,
      sent.length >= 20 && unlisted.length === 0 && sent.includes('account_ai_off') && !sent.includes(OLD_ACCOUNT_CODE)
        && Object.prototype.hasOwnProperty.call(CODE_KEY, 'account_ai_off') && !Object.prototype.hasOwnProperty.call(CODE_KEY, OLD_ACCOUNT_CODE),
      `not in the table: ${unlisted.join(', ') || 'none'}`);
  } else if (SOLO) {
    console.log('  SKIP  parity: skipped (ATT_SOLO)');
  }
}

// A stand-in for useAskCopy().files, built from the interface's own text: a
// string accessor answers <name>, a function answers <name:args>.
const copySrc = read('hooks/useAskCopy.ts');
const filesBlock = (() => {
  const at = copySrc.indexOf('\n  files: {\n');
  const end = at < 0 ? -1 : copySrc.indexOf('\n  };\n', at);
  return at < 0 || end < 0 ? '' : copySrc.slice(at, end);
})();
const accessors = [...filesBlock.matchAll(/\n    ([A-Za-z0-9]+): ([^;]+);/g)].map((m) => ({ name: m[1], fn: m[2].includes('=>') }));
ok('useAskCopy declares the files block', accessors.length >= 60, `accessors: ${accessors.length}`);
const fakeCopy = Object.fromEntries(accessors.map(({ name, fn }) => [
  name, fn ? (...args: unknown[]) => `<${name}:${args.join('|')}>` : `<${name}>`,
])) as unknown as AskCopy['files'];
{
  const SHARED = ['fileFallback', 'refuseType', 'refuseCount', 'refusePages', 'errOffline', 'errTimeout', 'errNetwork', 'errPlan',
    'errUnavailable', 'errTooLarge', 'errTooLargeTogether', 'errUnreadable', 'errBlocked', 'errNoAnswer', 'errService',
    'errSignIn', 'errOff', 'errGeneric', 'codeWithheld', 'readTitle', 'readPhoto', 'readPlan', 'readPdf',
    'readPdfNoCount', 'readCaution', 'readPartial', 'readA11y'];
  const missing = SHARED.filter((n) => !accessors.some((a) => a.name === n));
  ok('useAskCopy().files carries every accessor the portal sheet imports', missing.length === 0, missing.join(', '));

  const names = ['first.jpg', 'second.pdf'];
  const empty: string[] = [];
  for (const code of Object.keys(CODE_KEY)) {
    for (const fileIndex of [undefined, 0, 1, 7]) {
      const s = core.askFilesSentence({ code, message: '', fileIndex }, fakeCopy, names);
      if (typeof s !== 'string' || !s.trim()) empty.push(`${code} / ${String(fileIndex)}`);
    }
  }
  ok('askFilesSentence never returns an empty sentence (every code, with and without a file index)', empty.length === 0, empty.join('\n'));
  ok('askFilesSentence: a sentence the gate or the server wrote is shown as it is',
    core.askFilesSentence({ code: 'monthly_cap_reached', message: 'You have used 50 of 50. Resets Oct 31, 8:00 PM.' }, fakeCopy, names)
      === 'You have used 50 of 50. Resets Oct 31, 8:00 PM.'
    && core.askFilesSentence({ code: 'ai_consent_declined', message: 'AI features are off.' }, fakeCopy, names) === 'AI features are off.');
  ok('askFilesSentence: the file is named by its index; with none it is the fallback',
    core.askFilesSentence({ code: 'unreadable_file', message: '', fileIndex: 1 }, fakeCopy, names) === '<errUnreadable:second.pdf>'
    && core.askFilesSentence({ code: 'unreadable_file', message: '' }, fakeCopy, names) === '<errUnreadable:<fileFallback>>'
    && core.askFilesSentence({ code: 'unreadable_file', message: '', fileIndex: 9 }, fakeCopy, names) === '<errUnreadable:<fileFallback>>');
  ok('askFilesSentence: megabytes come from the server limit, else from the constants',
    core.askFilesSentence({ code: 'file_too_large', message: '', fileIndex: 0, limit: 4194304 }, fakeCopy, names) === '<errTooLarge:first.jpg|4>'
    && core.askFilesSentence({ code: 'file_too_large', message: '', fileIndex: 0 }, fakeCopy, names) === `<errTooLarge:first.jpg|${core.mbOf(core.ASK_PLAN_PAGE_MAX_BYTES)}>`
    && core.askFilesSentence({ code: 'files_too_large', message: '', limit: 6291456 }, fakeCopy, names) === '<errTooLargeTogether:6>'
    && core.askFilesSentence({ code: 'body_too_large', message: '' }, fakeCopy, names) === `<errTooLargeTogether:${core.mbOf(core.ASK_TOTAL_MAX_BYTES)}>`);
  ok('askFilesSentence: pages, count and type take their numbers from the outcome or the constants',
    core.askFilesSentence({ code: 'too_many_pages', message: '', fileIndex: 1, pages: 31, limit: 20 }, fakeCopy, names) === '<refusePages:second.pdf|31|20>'
    && core.askFilesSentence({ code: 'too_many_pages', message: '', fileIndex: 1 }, fakeCopy, names) === `<refusePages:second.pdf|0|${core.ASK_PDF_MAX_PAGES}>`
    && core.askFilesSentence({ code: 'too_many_files', message: '' }, fakeCopy, names) === `<refuseCount:${core.ASK_MAX_FILES}>`
    && core.askFilesSentence({ code: 'unsupported_type', message: '', fileIndex: 0 }, fakeCopy, names) === '<refuseType:first.jpg>');
  ok('askFilesSentence: the plain errors',
    core.askFilesSentence({ code: 'offline', message: '' }, fakeCopy, names) === '<errOffline>'
    && core.askFilesSentence({ code: 'client_timeout', message: '' }, fakeCopy, names) === '<errTimeout>'
    && core.askFilesSentence({ code: 'network', message: '' }, fakeCopy, names) === '<errNetwork>'
    && core.askFilesSentence({ code: 'tier_required', message: '' }, fakeCopy, names) === '<errPlan>'
    && core.askFilesSentence({ code: 'file_unavailable', message: '' }, fakeCopy, names) === '<errUnavailable>'
    && core.askFilesSentence({ code: 'blocked', message: '' }, fakeCopy, names) === '<errBlocked>'
    && core.askFilesSentence({ code: 'no_answer', message: '' }, fakeCopy, names) === '<errNoAnswer>'
    && core.askFilesSentence({ code: 'upstream_error', message: '' }, fakeCopy, names) === '<errService>'
    && core.askFilesSentence({ code: 'unauthenticated', message: '' }, fakeCopy, names) === '<errSignIn>'
    && core.askFilesSentence({ code: 'feature_off', message: '' }, fakeCopy, names) === '<errOff>'
    && core.askFilesSentence({ code: 'bad_request', message: '' }, fakeCopy, names) === '<errGeneric>');
}

// The own-words gate for file text.
{
  const UNCHANGED: [string, string[]][] = [
    ['Sheet S1.02 shows the footing schedule. The client wrote "please move the outlet" on page 2.', []],
    ['Invoice INV1024 is marked "past due".', []],
    ['CO123 adds "two recessed lights" in the kitchen.', []],
    ['The invoice total is 1250.75.', []],
    ['The drawing calls for a 36" guard at the landing.', []],
    ['The set is stamped "IFC" and dated March 2.', []],
    ['Section 4.2 of the contract says "payment is due in 10 days".', []],
    ['IRC R312.1 covers guards; a qualified person has to check the height.', []],
    ['A201 General Conditions.pdf, page 3, lists the retainage.', ['A201 General Conditions.pdf']],
    // A sheet number of code shape that is part of this ask's file name.
    ['E101.2 Panel schedule.pdf shows "the main panel" on page 1.', ['E101.2 Panel schedule.pdf']],
    ['The client wrote “we would like the tile changed” under photo 2.', []],
    ['Line one.\nLine two has "a quote".\n\nLine three.', []],
    // Code context: a quotation alone is not held there (only code phrasing or a long run is).
    ['IRC R312.1 covers guards; a qualified person has to check the height. The client wrote "please move the outlet" on page 2.', []],
    // Contract wording in an answer that names no code.
    ['The subcontract says the electrician shall furnish all materials. Payment shall be made in 10 days.', []],
    // Not code names: letters a drawing or a barcode uses, and a lower-case mention.
    ...['IFC', 'UPC', 'IPC', 'IMC', 'UMC', 'the local building code', 'the Building Department', 'Code Red Electric'].map(
      (x): [string, string[]] => [`The set is marked ${x}. The contract says the owner shall pay in 10 days.`, []]),
    // "Section" with a number that is not of code shape.
    ['Section 4.2 says the owner shall pay in 10 days. Section 12 covers changes.', []],
  ];
  // KNOWN LIMITS (documented in guardFileText): the answer names no code this
  // gate knows, so the page text passes. Pinned so a change here is a decision.
  const LIMITS: [string, string[]][] = [
    ['IPC 604.3 Water distribution system design criteria. The water distribution system shall be designed for peak demand.', []],
    ['R312.1.1.pdf is a scan. Guards shall be provided for open sides.', ['R312.1.1.pdf']],
    ['Guards shall be provided for open sides. Required guards shall be not less than 36 inches in height.', []],
  ];
  ok(`guardFileText known limits: an answer that names no code and no code section passes (${LIMITS.length} cases)`,
    LIMITS.every(([text, labels]) => { const g = core.guardFileText(text, labels); return g.withheld === 0 && g.text === text; }));
  const changed = UNCHANGED.filter(([text, labels]) => {
    const g = core.guardFileText(text, labels);
    return g.withheld !== 0 || g.text !== text;
  }).map(([text]) => text);
  ok(`guardFileText: sheet, invoice and change-order numbers, inch marks and a client's quoted words pass unchanged (${UNCHANGED.length} cases)`,
    changed.length === 0, changed.join('\n'));
  ok('guardFileText: the same code-shaped number is held to the gate when it is NOT one of the file names',
    core.guardFileText('E101.2 Panel schedule.pdf shows "the main panel" on page 1.', []).withheld === 1);

  const run45 = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ');
  // A code book's shape: a heading sentence, then body sentences that name no code.
  const B1 = 'Guards shall be provided for those portions of open-sided walking surfaces, including stairs, ramps and landings, that are located more than 30 inches measured vertically to the floor or grade below at any point within 36 inches horizontally to the edge of the open side.';
  const B2 = 'Required guards at open-sided walking surfaces, including stairs, porches, balconies or landings, shall be not less than 36 inches in height as measured vertically above the adjacent walking surface or the line connecting the nosings.';
  const BODY = 'Guards shall be provided for those portions of open-sided walking surfaces, including stairs, ramps and landings, that are located more than 30 inches measured vertically to the floor or grade below. Required guards at open-sided walking surfaces shall be not less than 36 inches in height.';
  const WITHHELD: [string, string, string, number][] = [
    ['a quoted code section',
      'The photo shows a deck. IRC R312.1.1 says "Guards shall be provided for those portions of open-sided walking surfaces". The rail looks low.',
      'The photo shows a deck. The rail looks low.', 1],
    ['code phrasing after a section heading',
      'First line stays. Section R311.7.5.1: The riser height shall be not more than 7-3/4 inches. Last line stays.',
      'First line stays. Last line stays.', 1],
    ['a 45-word run that names NEC 210.8(A), no quotation',
      `Intro stays. NEC 210.8(A) ${run45}. Outro stays.`,
      'Intro stays. Outro stays.', 1],
    ['a two-sentence quotation that opens in a withheld sentence',
      'Before. IBC 1011.5.2 reads "Stair riser heights are measured vertically. They are uniform in a flight." After.',
      'Before. After.', 2],
    ['a two-sentence curly quotation',
      'Before. The International Residential Code says “Guards are required. They are 36 inches high.” After.',
      'Before. After.', 2],
    ['a section of code shape with a quotation, no code name',
      'Start. R602.3(1) "Fastening schedule" lists the nails. End.',
      'Start. End.', 1],
    // ── Code context (review round 1): the body under a code heading ──
    ['the body under a section heading, after a sentence that names the code',
      `The page is from the IRC. R312.1.1 Where required. ${BODY}`,
      'The page is from the IRC. R312.1.1 Where required.', 2],
    ['the body under a heading that carries the code name',
      `IRC R312.1.1 Where required. ${BODY}`,
      'IRC R312.1.1 Where required.', 2],
    ['the body on the line after a heading',
      `The photo is a page of the 2021 International Residential Code, Section R312.1 Guards.\n${BODY}`,
      'The photo is a page of the 2021 International Residential Code, Section R312.1 Guards.', 2],
    ['the body after "It reads:" and a bare section heading',
      'Photo 1 is a code page. It reads: R312.1.2 Height. Required guards at open-sided walking surfaces, including stairs, porches, balconies or landings, shall be not less than 36 inches in height as measured vertically above the adjacent walking surface or the line connecting the nosings.',
      'Photo 1 is a code page. It reads: R312.1.2 Height.', 1],
    ['the body after a heading a plan note carries',
      'The plan says: IBC 1011.5.2 Riser height and tread depth. Stair riser heights shall be 7 inches maximum and 4 inches minimum.',
      'The plan says: IBC 1011.5.2 Riser height and tread depth.', 1],
    ['a body set in its own paragraphs under a lead-in, and keeps the plain paragraph after it',
      'The page shows IRC Section R312.1.1, which reads:\n\nGuards shall be provided for those portions of open-sided walking surfaces.\n\nRequired guards shall be not less than 36 inches in height.\n\nThe rail in photo 2 looks low.',
      'The page shows IRC Section R312.1.1, which reads:\n\nThe rail in photo 2 looks low.', 2],
    ['a body one blank line under a heading that stands alone',
      'R312.1.1 Where required.\n\nGuards shall be provided for open sides.',
      'R312.1.1 Where required.', 1],
    ['a long run with no code name, inside a code context',
      `IRC R312.1 Guards. The ${run45}. Outro stays.`,
      'IRC R312.1 Guards. Outro stays.', 1],
    // ── The whole answer (review round 2): no paragraphs and no order ──
    ['the cost: contract wording with "shall" in an answer that names a code, a blank line away',
      'IRC R312.1 covers guards. A qualified person has to check the height.\n\nSubcontract.pdf says the electrician shall furnish all materials.',
      'IRC R312.1 covers guards. A qualified person has to check the height.', 1],
    ['a body two paragraphs under "It reads:"',
      `This is a page from the IRC, Section R312. It reads:\n\n${B1}\n\n${B2}`,
      'This is a page from the IRC, Section R312. It reads:', 2],
    ['a body under a plain sentence and a blank line, with headings that carry no number',
      `Photo 1 is a page of the International Residential Code. I can read the whole page.\n\nWhere required. ${B1}\n\nHeight. ${B2}`,
      'Photo 1 is a page of the International Residential Code. I can read the whole page.\n\nWhere required.\n\nHeight.', 2],
    ['a body under "The text on it is below." and a blank line',
      'The photo shows a page from the NEC. The text on it is below.\n\nAll 125-volt through 250-volt receptacles installed in the following locations and supplied by single-phase branch circuits rated 150 volts or less to ground shall have ground-fault circuit-interrupter protection for personnel.',
      'The photo shows a page from the NEC. The text on it is below.', 1],
    ['a body two paragraphs under its heading, with a plain paragraph between',
      `IRC R312.1.1 Where required.\n\nHere is what the page says.\n\n${B1}`,
      'IRC R312.1.1 Where required.\n\nHere is what the page says.', 1],
    ['an exception list a blank line under a plain sentence',
      'IRC R312.1.2 Height. The page lists heights.\n\nExceptions: 1. Guards on the open sides of stairs shall have a height of not less than 34 inches measured vertically from a line connecting the nosings.',
      'IRC R312.1.2 Height. The page lists heights.', 2],
    ['a body that comes BEFORE the sentence that names its sections',
      `${B1} ${B2} That is IRC R312.1.1 and R312.1.2.`,
      'That is IRC R312.1.1 and R312.1.2.', 2],
    ['a body before its attribution, a blank line apart',
      `${B1}\n\nThis text is from Section R312.1.1 of the IRC.`,
      'This text is from Section R312.1.1 of the IRC.', 1],
    ['a page of the NYC Building Code (a one-decimal section alone would not name it)',
      'The page is from the 2022 NYC Building Code. BC 1015.2 Where required. Guards shall be located along open-sided walking surfaces that are located more than 30 inches measured vertically to the floor or grade below.',
      'The page is from the 2022 NYC Building Code. BC 1015.2 Where required.', 1],
    ['a page of a state code',
      `The photo is a page of the California Residential Code. ${B1}`,
      'The photo is a page of the California Residential Code.', 1],
    // The word "Section" (or "§", or "Sec.") and a code-shaped number, with no code name.
    ['code phrasing after "Section 210.8"',
      'Section 210.8 says the receptacles shall have GFCI protection. The panel is fine.',
      'The panel is fine.', 1],
    ['code phrasing after "§ 210.8"',
      '§ 210.8 says the receptacles shall have GFCI protection. The panel is fine.',
      'The panel is fine.', 1],
    ['code phrasing after "Sec. 210.8" (the sentence splitter cuts at "Sec.", so the whole answer is asked)',
      'The note cites Sec. 210.8 for the receptacles. They shall have GFCI protection. The panel is fine.',
      'The note cites Sec. 210.8 for the receptacles. The panel is fine.', 1],
    // ── The quotation carry is bounded (review round 1) ──
    ['the rest of the line after a stray quotation mark, and nothing on the next line',
      'NEC 210.8(A) says "all receptacles. Second sentence\nThird line plain. Fourth plain.',
      'Third line plain. Fourth plain.', 2],
    ['only the quoting sentence when its closing quote follows a number (not an inch mark)',
      'Intro. NEC 210.8(A) covers "receptacles within 6 feet of a sink rated 20". The panel photo shows a 200 A main. The second photo shows the meter.',
      'Intro. The panel photo shows a 200 A main. The second photo shows the meter.', 1],
    ['only the sentence itself when its one double quote is an inch mark',
      'IRC R312.1 guards shall be 36" high. The deck is fine. The stairs too.',
      'The deck is fine. The stairs too.', 1],
    ['only the sentence itself when an inch mark sits before a closed quotation',
      'IRC R312.1 guards shall be 36" high per the "note". The deck is fine. The stairs too.',
      'The deck is fine. The stairs too.', 1],
    [`at most ${core.FILE_QUOTE_CARRY_SENTENCES} sentences after a stray quotation mark`,
      'Photo 1 shows the label "NEC 110.26 clearance. The breaker is 20 A. The rest is fine. Photo 2 shows the meter.',
      'Photo 2 shows the meter.', 3],
    ['every sentence of a three-sentence answer after a stray quotation mark (the turn then says why)',
      'Photo 1 shows the label "NEC 110.26 clearance. The breaker is 20 A. The rest is fine.',
      '', 3],
    ['nothing past the line break after a stray quotation mark',
      'Photo 1 shows the label "NEC 110.26 clearance.\nThe breaker is 20 A. The rest is fine.',
      'The breaker is 20 A. The rest is fine.', 1],
    ['a sentence in the middle of a line, and keeps the line break it ended',
      'The photo shows IRC R312.1.1. Guards shall be provided for open sides.\nthe rail in photo 2 looks low.',
      'The photo shows IRC R312.1.1.\nthe rail in photo 2 looks low.', 1],
    ['a numbered item with its number',
      '1. IMG_1.jpg shows a deck.\n2. Spec.pdf page 3 quotes the NEC: "All 125-volt receptacles shall have GFCI protection."\n3. Nothing else.',
      '1. IMG_1.jpg shows a deck.\n3. Nothing else.', 1],
  ];
  ok('FILE_QUOTE_CARRY_SENTENCES is 2', core.FILE_QUOTE_CARRY_SENTENCES === 2);
  // Every code name the gate knows, by letters and by title.
  const NAMES = [
    'IRC', 'IBC', 'IECC', 'IEBC', 'NEC', 'NFPA', 'ICC',
    'International Residential Code', 'International Building Code', 'International Energy Conservation Code',
    'International Fire Code', 'International Plumbing Code', 'International Mechanical Code',
    'International Fuel Gas Code', 'International Existing Building Code', 'National Electrical Code',
    'Uniform Plumbing Code', 'Uniform Mechanical Code',
    '2022 NYC Building Code', 'New York City Fire Code', 'California Residential Code', 'NYS Energy Code',
  ];
  const unnamed = NAMES.filter((name) => {
    const g = core.guardFileText(`The page is from the ${name}. Guards shall be provided for open sides.`);
    return g.text !== `The page is from the ${name}.` || g.withheld !== 1;
  });
  ok(`guardFileText: every code name opens the gate for the whole answer (${NAMES.length} names)`, unnamed.length === 0, unnamed.join(', '));
  for (const [what, text, want, n] of WITHHELD) {
    const g = core.guardFileText(text);
    ok(`guardFileText withholds ${what} and keeps the rest`, g.text === want && g.withheld === n, JSON.stringify(g));
  }
  // An answer in several fields (the portal sheet): a code named in another field holds this one.
  {
    const field = 'Guards shall be provided for open sides. The rail looks low.';
    const alone = core.guardFileText(field, []);
    const withCode = core.guardFileText(field, [], ['The photo is a page of the IRC.']);
    const withPlain = core.guardFileText(field, [], ['The photo shows a deck.', 'Sheet S1.02 is the footing plan.']);
    const withLabel = core.guardFileText(field, ['E101.2 Panel.pdf'], ['E101.2 Panel.pdf is the panel schedule.']);
    ok('guardFileText sameAnswer: a code named in another field of the same answer holds this field; plain fields and a file name do not',
      alone.withheld === 0 && alone.text === field
      && withCode.withheld === 1 && withCode.text === 'The rail looks low.'
      && withPlain.withheld === 0 && withPlain.text === field
      && withLabel.withheld === 0 && withLabel.text === field,
      JSON.stringify([alone, withCode, withPlain, withLabel]));
  }
  ok('guardFileText: an empty or blank answer is empty, nothing withheld',
    JSON.stringify(core.guardFileText('')) === '{"text":"","withheld":0}' && core.guardFileText('   ').withheld === 0);
  const again = WITHHELD.filter(([, text]) => {
    const once = core.guardFileText(text);
    const twice = core.guardFileText(once.text);
    return twice.text !== once.text || twice.withheld !== 0;
  }).map(([what]) => what);
  ok('guardFileText: gating the result again changes nothing (every case above)', again.length === 0, again.join('; '));
}

// ═══ D. Source pins ══════════════════════════════════════════════════════════
console.log('\nAsk files — D. source');

const UTIL = 'utils/askFiles.ts';
const CORE = 'utils/askFilesCore.ts';
const CONV = 'components/brain/AskConversation.tsx';
const ATTACH = 'components/brain/ask/AskAttach.tsx';
const TRAY = 'components/brain/ask/AskTray.tsx';
const READ = 'components/brain/ask/WhatIRead.tsx';
const NEW_FILES = [UTIL, CORE, ATTACH, TRAY, READ];
const code: Record<string, string> = {};
for (const f of [...NEW_FILES, CONV]) code[f] = stripComments(read(f));
for (const f of [...NEW_FILES, CONV]) ok(`${f} exists`, code[f].trim().length > 0);

{
  const naming = ['app', 'components', 'utils', 'hooks', 'contexts', 'lib']
    .flatMap((d) => walk(d))
    .filter((f) => /ask-files/.test(stripComments(read(f))));
  ok("'ask-files' is named in exactly one app file: utils/askFiles.ts", naming.length === 1 && naming[0] === UTIL, naming.join(', '));
  ok("utils/askFiles.ts calls it once, through invokeWithTimeout with the app's timeout",
    (code[UTIL].match(/ask-files/g) ?? []).length === 1
    && /invokeWithTimeout<unknown>\('ask-files', \{ body, timeoutMs: ASK_CLIENT_TIMEOUT_MS \}\)/.test(code[UTIL]));
}

{
  const src = code[UTIL];
  const start = src.indexOf('export async function askFiles(');
  const end = src.indexOf('\nexport async function countAskPdfPages(');
  const body = start >= 0 && end > start ? src.slice(start, end) : '';
  const at = (needle: string) => body.indexOf(needle);
  const flag = at("const on = input.feature === 'ask' ? ASK_FILES_ENABLED : PORTAL_MESSAGE_AI_ENABLED;");
  const off = at("if (!on) return { ok: false, code: 'feature_off', message: '' };");
  const offline = at('isOfflineNow(');
  const consent = at('ensureAiConsent(');
  const readAt = at('readAsBase64(');
  const invoke = at('invokeWithTimeout');
  ok('askFiles: the flag check, then isOfflineNow(, then ensureAiConsent(, then readAsBase64(, then invokeWithTimeout(',
    flag >= 0 && off > flag && offline > off && consent > offline && readAt > consent && invoke > readAt,
    `flag ${flag}, off ${off}, offline ${offline}, consent ${consent}, read ${readAt}, invoke ${invoke}`);
  ok('askFiles: each of the five appears once in the function (no second, earlier path to the request)',
    ['isOfflineNow(', 'ensureAiConsent(', 'readAsBase64(', 'invokeWithTimeout'].every((n) => body.split(n).length === 2)
    && body.split('if (!on) return').length === 2);
  ok('askFiles: a refusal by the consent gate carries the code and the sentence, in the same statement',
    body.includes('if (!(await ensureAiConsent())) return { ok: false, code: AI_CONSENT_DECLINED_CODE, message: AI_CONSENT_OFF_MESSAGE };'));
  ok("askFiles: 'ask' reads ASK_FILES_ENABLED and sends mode 'ask'; 'portal' reads PORTAL_MESSAGE_AI_ENABLED and sends mode 'message'",
    body.includes("const mode: 'ask' | 'message' = input.feature === 'ask' ? 'ask' : 'message';")
    && body.includes("const body: AskFilesRequest = mode === 'ask' ? { mode: 'ask', files, question } : { mode: 'message', files };"));
  ok('askFiles: the request carries exactly the contract keys per file (no location for a message file, no extra key)',
    body.includes("files.push({ source: 'message', messageId: f.messageId, attachmentId: f.attachmentId });")
    && body.includes("files.push({ source: 'plan', storagePath: f.storagePath, name: f.name });")
    && body.includes("files.push({ source: 'inline', name: f.name, mime: f.mime, base64 });"));
  ok('askFiles: the device total is measured on the bytes before anything is sent',
    body.indexOf('if (deviceBytes > ASK_DEVICE_TOTAL_MAX_BYTES) return fail(\'files_too_large\', { limit: ASK_DEVICE_TOTAL_MAX_BYTES });') > readAt
    && body.indexOf('if (deviceBytes > ASK_DEVICE_TOTAL_MAX_BYTES)') < invoke);
  ok('askFiles never throws: the whole body is inside one try, and the catch answers a code',
    /export async function askFiles\(input: AskFilesInput\): Promise<AskFilesOutcome> \{\s*try \{/.test(body) && /\} catch \{\s*return fail\('internal'\);\s*\}\s*\}\s*$/.test(body.trimEnd() + '\n'));
  ok('askFiles: only the monthly cap and the hourly limit carry the server sentence',
    body.includes("const message = code === 'monthly_cap_reached' || code === 'hourly_limit' ? e.message : '';"));
  ok('askFiles is never put on the offline queue', !/offlineQueue|supabaseWrite|enqueue/.test(src));
  ok('utils/askFiles.ts: no ignoreEncryption and no countPdfPages( (a locked PDF must not get a page count)',
    !/ignoreEncryption/.test(src) && !/\bcountPdfPages\(/.test(src)
    && /PDFDocument\.load\(bytes, \{ updateMetadata: false \}\)/.test(src));
  ok('releaseAskFile: device files only; a blob URL on the web, the cache folder on a phone',
    /file\.source !== 'device'/.test(src) && /URL\.revokeObjectURL\(uri\)/.test(src)
    && /uri\.startsWith\(cache\)/.test(src) && /FileSystem\.deleteAsync\(uri, \{ idempotent: true \}\)/.test(src));
}

{
  const conv = code[CONV];
  const gated = (tag: string) => {
    const hits = [...conv.matchAll(new RegExp(`<${tag}\\b`, 'g'))];
    return hits.length > 0 && hits.every((m) => conv.slice(Math.max(0, (m.index ?? 0) - 60), m.index).includes('ASK_FILES_ENABLED &&'));
  };
  for (const tag of ['AskAttach', 'AskTray', 'WhatIRead']) {
    ok(`AskConversation: every <${tag} is behind ASK_FILES_ENABLED && (within 60 characters)`, gated(tag));
  }
  ok('AskConversation: the cut-short and code-withheld lines are behind the flag too',
    /\{ASK_FILES_ENABLED && t\.truncated && <Text/.test(conv) && /\{ASK_FILES_ENABLED && t\.codeWithheld && <Text/.test(conv));
  {
    // The cut-short line, one per surface (lane ATT3). Ask has a question to
    // narrow; the portal sheet has none, so it never borrows Ask's line.
    const ASK_LINE = "MAGE's answer stops partway. Try a narrower question.";
    const SHEET_LINE = "MAGE's reading stops partway. Open the files to check the rest.";
    const sheet = stripComments(read('components/messages/MessageAiSheet.tsx'));
    const askHook = read('hooks/useAskCopy.ts');
    const sheetHook = read('hooks/useMessageAttachmentCopy.ts');
    ok("Ask's cut-short line is Ask's own string (it tells him to narrow the question), drawn once in AskConversation",
      askHook.includes("truncated: t('ai.ask.files.truncated', 'MAGE\\'s answer stops partway. Try a narrower question.'),")
      && (conv.match(/askCopy\.files\.truncated/g) ?? []).length === 1
      && conv.includes('{ASK_FILES_ENABLED && t.truncated && <Text style={styles.fileNote}>{askCopy.files.truncated}</Text>}')
      && read('i18n/catalog/en/ai.ask.generated.ts').includes(`"ai.ask.files.truncated": "${ASK_LINE}"`));
    ok("the portal sheet's cut-short line is its own string (open the files to check the rest), and names no question",
      sheetHook.includes(`truncated: t('office.clientMessages.ai.truncated', "${SHEET_LINE}"),`)
      && !/question|narrow/i.test(SHEET_LINE)
      && read('i18n/catalog/en/office.client-messages.generated.ts').includes(`"office.clientMessages.ai.truncated": "${SHEET_LINE}"`));
    ok("the portal sheet draws its own cut-short line and never Ask's; Ask never draws the sheet's",
      sheet.includes('{reading.truncated ? <Text style={styles.note} testID="message-ai-truncated">{copy.ai.truncated}</Text> : null}')
      && (sheet.match(/\.truncated\}/g) ?? []).length === 2 && !/files\.truncated/.test(sheet)
      && !/useMessageAttachmentCopy|clientMessages/.test(conv)
      && !askHook.includes('Open the files to check the rest') && !sheetHook.includes('narrower question'));
  }
  const branch = conv.indexOf('if (ASK_FILES_ENABLED && attachedRef.current.length > 0) { await askWithFiles(q); return; }');
  const guard = conv.indexOf('if (!q || busy) return;');
  const demo = conv.indexOf('const demo =');
  const doIt = conv.indexOf('doIt.detect(q, anchorProjectId)');
  ok('AskConversation: the file branch of ask() sits after the busy guard and before the demo answers and the do-it detection',
    branch > 0 && guard > 0 && guard < branch && branch < demo && demo < doIt, `guard ${guard}, branch ${branch}, demo ${demo}, doIt ${doIt}`);
  ok('AskConversation: the text path is not sent the file turns',
    conv.includes('const prior = withoutFileTurns(turnsRef.current).map(t => ({ role: t.role, text: t.text }));'));
  ok('AskConversation: askOneMind(q, prior, bundle, { anchorProjectId }) is intact',
    conv.includes('const res = await askOneMind(q, prior, bundle, { anchorProjectId });'));
  ok('AskConversation: the file path sends the files and the question, and nothing else',
    conv.includes("const out = await askFiles({ feature: 'ask', files: files.map(toSendFile), question: q });"));
  ok('AskConversation: a turn keeps only what attachedTurnFiles / toTurnFiles give it',
    conv.includes('files: attachedTurnFiles(files)') && conv.includes('read: toTurnFiles(out.data.read)'));
  ok('AskConversation: the file answer goes through the own-words gate before it is shown',
    conv.includes('const g = guardFileText(out.data.answer, out.data.read.map(r => r.name));')
    && conv.includes('text: allWithheld ? askCopy.files.codeWithheld : g.text,') && !conv.includes('out.data.answer,\n'));
  ok('AskConversation: an answer the gate took whole says why as its text, once (no empty bubble, no second line)',
    conv.includes('const allWithheld = g.withheld > 0 && g.text.length === 0;')
    && conv.includes('codeWithheld: g.withheld > 0 && !allWithheld,'));
  ok('AskConversation: a cut-short answer is marked on its turn (the line under it reads this)',
    conv.includes('truncated: out.data.truncated === true,'));
  ok('AskConversation: a failed file question is marked as a file turn (read: []), so the text model is never sent it',
    conv.includes("setTurns(prev => [...prev, { key: kc, role: 'assistant', text, error: true, read: [], ...extra }]);"));
  ok('AskConversation: the file path spends the same daily allowance as a text ask, and meters only an answer',
    (conv.match(/await checkAILimit\(tier, 'smart', 'askMage'\)/g) ?? []).length === 2
    && (conv.match(/void recordAIUsage\('smart', 'askMage'\);/g) ?? []).length === 2);
  {
    // The file path, statement by statement: the daily limiter refuses before
    // the request, and the meter runs only inside the success branch after it.
    const from = conv.indexOf('const askWithFiles = useCallback(async (question: string) => {');
    const to = conv.indexOf('const ask = useCallback(async (', from);
    const fn = from >= 0 && to > from ? conv.slice(from, to) : '';
    const iLimit = fn.indexOf("const limit = await checkAILimit(tier, 'smart', 'askMage');");
    const iRefuse = fn.indexOf('if (!limit.allowed) {');
    const iCall = fn.indexOf("const out = await askFiles({ feature: 'ask', files: files.map(toSendFile), question: q });");
    const iOk = fn.indexOf("if (out.ok && out.data.mode === 'ask') {");
    const iMeter = fn.indexOf("void recordAIUsage('smart', 'askMage');");
    ok('AskConversation askWithFiles: the daily limiter refuses before the request (if (!limit.allowed) { … return; })',
      iLimit > 0 && iRefuse > iLimit && iCall > iRefuse
      && /if \(!limit\.allowed\) \{[\s\S]*?\n {8}return;\n {6}\}/.test(fn.slice(iRefuse, iCall))
      && (conv.match(/if \(!limit\.allowed\) \{/g) ?? []).length === 2,
      `limit ${iLimit}, refuse ${iRefuse}, call ${iCall}`);
    ok('AskConversation askWithFiles: the meter runs only after the request, inside the success branch (a failed read spends no daily call)',
      iCall > 0 && iOk > iCall && iMeter > iOk && fn.split("recordAIUsage(").length === 2
      && fn.slice(iOk, iMeter).trim() === "if (out.ok && out.data.mode === 'ask') {",
      `call ${iCall}, ok ${iOk}, meter ${iMeter}`);
  }
  ok('AskConversation: a failed read carries what the See plans and Sign in buttons read (the monthly cap, the hourly limit and a plan refusal; signed out)',
    conv.includes("bad.code === 'monthly_cap_reached' || bad.code === 'hourly_limit' || bad.code === 'tier_required'\n          ? { errorKind: 'monthly_cap', errorCode: bad.code }\n          : bad.code === 'unauthenticated' ? { errorKind: 'unauthenticated' } : undefined;")
    && conv.includes("if (t.errorKind === 'monthly_cap' && t.errorCode !== 'hourly_limit' && (tier === 'free' || tier === 'pro')) {"));
  ok('AskConversation: an offline refusal also says the files are still attached, and the turn carries the button fields',
    conv.includes("failed(bad.code === 'offline' ? `${sentence} ${askCopy.files.errOfflineKept}` : sentence, extra);"));
  ok('AskConversation: the tray lets every local copy go on unmount, on remove and on a recall',
    conv.includes('useEffect(() => () => { for (const f of attachedRef.current) releaseAskFile(f); }, []);')
    && conv.includes('if (gone) releaseAskFile(gone);')
    && (conv.match(/for \(const f of attachedRef\.current\) releaseAskFile\(f\);/g) ?? []).length === 2
    && conv.includes('for (const f of files.slice(room)) releaseAskFile(f);'));
  ok('AskConversation: new props on the composer input are conditional spreads (the goldens copy every prop key)',
    conv.includes('{...(hasFiles ? { maxLength: ASK_QUESTION_MAX } : null)}')
    && conv.includes('const hasFiles = ASK_FILES_ENABLED && attached.length > 0;')
    && conv.includes('placeholder={hasFiles ? askCopy.files.placeholder : askCopy.lookPlaceholder}'));
  ok('AskConversation: the tray is never cleared by an answer (only remove, a recalled thread and unmount let files go)',
    (conv.match(/setAttached\(/g) ?? []).length === 3 && (conv.match(/\bclearFiles\(\)/g) ?? []).length === 1
    && conv.includes('const recallThread = useCallback((thread: AskThread) => {\n    clearFiles();'));
  ok('AskConversation: no "Try again tomorrow", no t() of its own, no dock import',
    !/Try again tomorrow/.test(conv) && !/(?<![\w$.])t\(/.test(conv) && !/from '@\/hooks\/useAskDock'/.test(conv));
}

{
  const a = code[ATTACH];
  ok('AskAttach: photos are picked at quality 0.4, twice (camera and library)', (a.match(/quality: 0\.4\b/g) ?? []).length === 2);
  ok('AskAttach: exif: false, twice', (a.match(/exif: false\b/g) ?? []).length === 2);
  ok('AskAttach never calls the message picker (pickAttachments)', !/pickAttachments/.test(a));
  ok('AskAttach uses <Sheet and no <Modal', /<Sheet\b/.test(a) && !/<Modal\b/.test(a) && !/\bModal\b/.test(a));
  ok('AskAttach: a Free account gets the locked alert before any sheet opens',
    a.indexOf('if (!isProOrAbove) {') > 0 && a.indexOf('if (!isProOrAbove) {') < a.indexOf('setOpen(true);')
    && /showAlert\(copy\.lockedTitle, copy\.lockedBody, \[/.test(a));
  ok('AskAttach: the plan list offers only paths the server will take',
    a.includes('current.filter((s) => isAskablePlanPath(s.storagePath))') && a.includes('.filter((s) => !s.superseded)'));
  ok('AskAttach: a PDF is counted with countAskPdfPages (never the renderer\'s counter)',
    a.includes('await countAskPdfPages(p.localUri)') && !/\bcountPdfPages\(/.test(a) && !/pdfRenderClient/.test(a));
  ok('AskAttach: a PDF that will not open or runs past the page limit is refused at the pick, and its copy let go',
    a.includes('if (pages === null) { refusals.push(copy.refusePdfUnreadable(p.name)); releaseAskFile(file); continue; }')
    && a.includes('if (pages > ASK_PDF_MAX_PAGES) { refusals.push(copy.refusePages(p.name, pages, ASK_PDF_MAX_PAGES)); releaseAskFile(file); continue; }'));
  ok('AskAttach: every refused pick lets its cache copy go (the type check, then Ask\'s own limits)',
    a.includes('for (const c of cands) if (!keptUris.has(c.uri)) releaseAskFile(localCopy(c.uri));')
    && a.includes('if (p) releaseAskFile(localCopy(p.localUri));'));
  {
    const from = a.indexOf('const pickPlan = useCallback((sheet: PlanSheet) => {');
    const fn = from >= 0 ? a.slice(from, a.indexOf('}, [copy, onAdd, close, planBlock]);', from)) : '';
    const iFull = fn.indexOf('if (now.length >= ASK_MAX_FILES) {');
    const iAdd = fn.indexOf('onAdd([');
    ok('AskAttach pickPlan: a page whose path the server would refuse is never added (checked again at the tap)',
      fn.includes('if (!storagePath || !isAskablePlanPath(storagePath)) return;') && fn.indexOf('isAskablePlanPath(storagePath)') < iAdd);
    ok('AskAttach pickPlan: a full tray refuses the page with its sentence before anything is added',
      iFull > 0 && iAdd > iFull
      && /if \(now\.length >= ASK_MAX_FILES\) \{\s*close\(\);\s*showRefusals\(\[copy\.refuseCount\(ASK_MAX_FILES\)\], copy\.refuseTitle\);\s*return;\s*\}/.test(fn));
  }
  {
    const from = a.indexOf('const pickPlan = useCallback((sheet: PlanSheet) => {');
    const fn = from >= 0 ? a.slice(from, a.indexOf('}, [copy, onAdd, close, planBlock]);', from)) : '';
    ok('AskAttach: the Plan page row is for the job\'s owner (the server reads a plan page for nobody else): the role state, loading and error included, decides it',
      a.includes('const { role, isLoading, isError, isPaused } = useProjectRoleState(anchorProjectId ?? undefined);')
      && a.includes('const planBlock = askPlanRowBlock({ hasJob: !!anchorProjectId, role, isLoading, isError, isPaused });')
      && a.includes('{ off: !!planBlock, why: planWhy, chevron: !planBlock });'));
    ok('AskAttach: every reason the row is off has its own sentence, and the list is drawn and a page added only while it is not off',
      ['noJob', 'notOwner', 'notOnJob', 'checking', 'unknown'].every((r) => a.includes(`planBlock === '${r}' ? copy.menuPlanPage`))
      && a.includes("planBlock === 'notOnJob' ? copy.menuPlanPageNotOnJob") && a.includes("planBlock === 'unknown' ? copy.menuPlanPageUnknown")
      && a.includes("planBlock === 'checking' ? copy.menuPlanPageChecking") && a.includes("planBlock === 'notOwner' ? copy.menuPlanPageNotOwner")
      && a.includes("planBlock === 'noJob' ? copy.menuPlanPageNoJob")
      && a.includes("const showPlan = view === 'plan' && !planBlock;") && a.includes('{!showPlan ? (')
      && fn.indexOf('if (planBlock) return;') > 0 && fn.indexOf('if (planBlock) return;') < fn.indexOf('onAdd(['));
    {
      // The sentences (lane ATT3): only "couldn't check" asks him to try again.
      const hook = read('hooks/useAskCopy.ts');
      const line = (key: string) => (hook.match(new RegExp(`t\\('ai\\.ask\\.files\\.menu\\.${key}', '((?:[^'\\\\]|\\\\.)*)'\\)`))?.[1] ?? '').replace(/\\'/g, "'");
      const notOnJob = line('planPageNotOnJob');
      const unknown = line('planPageUnknown');
      ok("the 'notOnJob' sentence says he is not on the job and that its plan pages can't be read here, and never asks him to try again",
        notOnJob === "You are not on this job, so its plan pages can't be read here."
        && !/try again|couldn't check|in a minute|retry/i.test(notOnJob)
        && read('i18n/catalog/en/ai.ask.generated.ts').includes(`"ai.ask.files.menu.planPageNotOnJob": "${notOnJob}"`));
      ok("the 'unknown' sentence is the only plan-row sentence that says the check failed and to try again",
        unknown === "MAGE couldn't check your access to this job. Try again in a minute."
        && ['planPageNoJob', 'planPageNotOwner', 'planPageNotOnJob', 'planPageChecking'].every((k) => line(k) !== '' && !/try again|couldn't check/i.test(line(k))));
    }
    if (server) {
      ok('parity: the server still reads plan pages for the owner only (PLAN_PAGES_OWNER_ONLY). If that is ever turned off, the row may open to collaborators too',
        server.PLAN_PAGES_OWNER_ONLY === true);
    } else if (SOLO) {
      console.log('  SKIP  parity: skipped (ATT_SOLO)');
    }
  }
  ok('AskAttach: the plan list has a way back to the menu',
    a.includes("{row('ask-plan-back', ChevronLeft, copy.planBack, () => setView('menu'))}"));
  const launchAt = a.indexOf('const launch = useCallback(async (kind: PickKind) => {');
  const docAt = a.indexOf('DocumentPicker.getDocumentAsync(', launchAt);
  ok('AskAttach: nothing is awaited before the document picker (a browser opens a file chooser only inside the tap)',
    launchAt > 0 && docAt > launchAt && !/\bawait\b/.test(a.slice(launchAt, docAt).replace('const r = await ', '')));
  ok('AskAttach: every testID the spec names',
    ['ask-attach', 'ask-attach-menu', 'ask-attach-camera', 'ask-attach-photos', 'ask-attach-pdf', 'ask-attach-files', 'ask-attach-plan', 'ask-plan-list']
      .every((id) => a.includes(`'${id}'`) || a.includes(`"${id}"`)) && a.includes('testID={`ask-plan-${s.id}`}'));
}

{
  const noStorage = NEW_FILES.filter((f) => /async-storage|AsyncStorage/.test(code[f]));
  ok('no AsyncStorage in any new file (no new key, nothing stored)', noStorage.length === 0, noStorage.join(', '));
  const logs = NEW_FILES.filter((f) => /\bconsole\s*\./.test(code[f]) || /(?<![\w$.])track\(/.test(code[f]));
  ok('LOGS: no console. and no track( in the five new files (a file name must never ride a breadcrumb)', logs.length === 0, logs.join(', '));
  const coreImports = [...code[CORE].matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  ok('utils/askFilesCore.ts imports only types, the own-words gate and (type only) the copy hook',
    coreImports.every((m) => m === '@/types' || m === '@/utils/codeCard/echoCheck' || m === '@/hooks/useAskCopy')
    && /import type \{ AskCopy \} from '@\/hooks\/useAskCopy';/.test(code[CORE])
    && /import type \{[^}]*\} from '@\/types';/.test(code[CORE]),
    coreImports.join(', '));
  ok('utils/askFilesCore.ts: nothing from react-native, the i18n layer or storage',
    !/react-native|expo-|@\/i18n|LanguageContext|async-storage|supabase/.test(code[CORE]));
  const noT = [ATTACH, TRAY, READ].filter((f) => /(?<![\w$.])t\(/.test(code[f]) || /\buseT\(/.test(code[f]));
  ok('the three Ask file components call no t() and no useT() (strings come from useAskCopy)', noT.length === 0, noT.join(', '));
  ok('WhatIRead takes its strings as a prop and is not tappable',
    /copy: AskCopy\['files'\];/.test(code[READ]) && !/Pressable|TouchableOpacity|onPress/.test(code[READ])
    && /testID="ask-what-i-read"/.test(code[READ]) && /if \(!Array\.isArray\(files\) \|\| files\.length === 0\) return null;/.test(code[READ]));
  ok('AskTray: wrapping chips (no ScrollView), the note line, a remove target per chip',
    !/ScrollView/.test(code[TRAY]) && /copy\.trayNote/.test(code[TRAY]) && /testID="ask-tray"/.test(code[TRAY])
    && /testID=\{`ask-tray-remove-\$\{f\.id\}`\}/.test(code[TRAY]) && /accessibilityLabel=\{copy\.trayRemoveA11y\(f\.name\)\}/.test(code[TRAY]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
