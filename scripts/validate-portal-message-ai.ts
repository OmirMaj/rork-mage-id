// scripts/validate-portal-message-ai.ts — "Read with MAGE" on a client's portal
// message (lane ATTPORTAL, part B of the AI-readable attachments wave).
//
//   A  switches: the client flag and the cut-off date ship dark, and the flag
//      can only be truthy when both server switches are on and the same valid
//      date sits on both sides (compared with supabase/functions/ask-files).
//   B  canReadWithAi, the whole truth table: the button is for the owner, on a
//      phone, on a client's sent message with a stored file, written at or
//      after the cut-off, with the flag on. Nobody else.
//   C  aiReadableFiles: which files are sent and which are listed "Not read".
//   D  the three draft routes carry exactly their params (no amount, no text
//      for the RFI and punch forms); draftText clips, and never clips the
//      "(n more not read)" note.
//   E  utils/draftHandoff: in memory, clipped, three entries, ten minutes.
//   F  isAfterNotice (the cut-off is held to the server's pattern),
//      messageAiBlock, refusalToNotRead.
//   H  guardMessageReading: the own-words gate is asked once for the whole
//      reading, so a code named in the summary holds code text in the draft.
//   G  source pins: the dark state, the conditional spread, nothing posted or
//      saved or logged, the gates in the sheet, the flag in front of every
//      draft read in /rfi and /punch-list, the copy keys.
//
// Pure bun: the three modules imported here touch no react-native.
//
// Run inside the lane:   ATT_SOLO=1 bun run scripts/validate-portal-message-ai.ts
// Run by the integrator: bun run scripts/validate-portal-message-ai.ts
// (ATT_SOLO only lets part A pass while the server lane's file is not on the
// branch yet; it is never set in the ship-check chain.)

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AskFilesSuccess, MessageAttachment } from '../types';
import { PORTAL_MESSAGE_AI_ENABLED } from '../constants/featureFlags';
import {
  ASK_MAX_FILES, ASK_MESSAGE_FILE_MAX_BYTES, ASK_TOTAL_MAX_BYTES,
} from '../utils/askFilesCore';
import {
  MESSAGE_AI_NOT_BEFORE, DRAFT_TEXT_MAX, aiReadableFiles, canReadWithAi, coDraftRoute, draftText, guardMessageReading,
  isAfterNotice, messageAiBlock, noticeTimeMs, punchDraftRoute, refusalToNotRead, rfiDraftRoute, type NotReadReason,
} from '../utils/messageAiCore';
import {
  DRAFT_HANDOFF_DESCRIPTION_MAX, DRAFT_HANDOFF_MAX_ENTRIES, DRAFT_HANDOFF_TITLE_MAX, DRAFT_HANDOFF_TTL_MS,
  clearDraftHandoffs, readDraftHandoff, stashDraftHandoff,
} from '../utils/draftHandoff';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Comments blanked (block and line), so a scan reads code only. */
const code = (p: string) => read(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra ? `\n     ${extra}` : ''); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const SHEET = 'components/messages/MessageAiSheet.tsx';
const CORE = 'utils/messageAiCore.ts';
const HANDOFF = 'utils/draftHandoff.ts';
const SCREEN = 'app/client-messages.tsx';
const SERVER_CORE = 'supabase/functions/ask-files/core.ts';

// ─── A. switches ────────────────────────────────────────────────────────────

/** The server's pattern for the cut-off (ISO_TIME_RE in supabase/functions/ask-files/core.ts),
 *  typed here a second time on purpose: an ISO time that names its zone. */
const SERVER_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const validIso = (s: string) => typeof s === 'string' && SERVER_TIME_RE.test(s) && Number.isFinite(Date.parse(s));

/** The rule the two sides are held to. Returns what is wrong, or []. */
function parityProblems(i: { flag: boolean; clientDate: string; serverAll: boolean; serverMessage: boolean; serverDate: string }): string[] {
  const out: string[] = [];
  if (i.clientDate !== i.serverDate) out.push('the cut-off date differs between the app and the server');
  if (i.flag) {
    if (!i.serverAll) out.push('the flag is on while ASK_FILES_SERVER_ENABLED is off');
    if (!i.serverMessage) out.push('the flag is on while MESSAGE_SOURCE_ENABLED is off');
    if (!validIso(i.clientDate)) out.push('the flag is on with no valid cut-off date in the app');
    if (!validIso(i.serverDate)) out.push('the flag is on with no valid cut-off date on the server');
  }
  return out;
}

function partA() {
  console.log('\nA. switches:');
  const flags = read('constants/featureFlags.ts');
  const core = read(CORE);
  ok('PORTAL_MESSAGE_AI_ENABLED ships false (source and value)',
    /^export const PORTAL_MESSAGE_AI_ENABLED = false;$/m.test(flags) && (PORTAL_MESSAGE_AI_ENABLED as boolean) === false);
  ok("MESSAGE_AI_NOT_BEFORE ships '' (source and value)",
    /^export const MESSAGE_AI_NOT_BEFORE = '';$/m.test(core) && MESSAGE_AI_NOT_BEFORE === '');

  // The rule itself, case by case, so it is proven even while everything is dark.
  const D = '2026-11-01T12:00:00.000Z';
  const on = { flag: true, clientDate: D, serverAll: true, serverMessage: true, serverDate: D };
  ok('parity rule: everything dark is fine', parityProblems({ flag: false, clientDate: '', serverAll: false, serverMessage: false, serverDate: '' }).length === 0);
  ok('parity rule: everything on with one valid date is fine', parityProblems(on).length === 0);
  ok('parity rule: the flag on with the whole function off is refused', parityProblems({ ...on, serverAll: false }).length === 1);
  ok('parity rule: the flag on with the message source off is refused', parityProblems({ ...on, serverMessage: false }).length === 1);
  ok('parity rule: the flag on with no date is refused (both sides)', parityProblems({ ...on, clientDate: '', serverDate: '' }).length === 2);
  ok('parity rule: the flag on with a date that is not a time is refused', parityProblems({ ...on, clientDate: 'soon', serverDate: 'soon' }).length === 2);
  const ZONELESS = ['2026-10-10', '2026-10-10T15:00:00', 'October 10, 2026', '2026-10-10 15:00:00+00'];
  ok(`parity rule: the flag on with a cut-off the server would not accept is refused, on both sides (${ZONELESS.length} values: a date alone, no zone, not ISO)`,
    ZONELESS.every((d) => parityProblems({ ...on, clientDate: d, serverDate: d }).length === 2)
      && ['2026-10-10T15:00:00Z', '2026-10-10T11:00:00-04:00', '2026-10-10T15:00Z'].every((d) => parityProblems({ ...on, clientDate: d, serverDate: d }).length === 0));
  ok('parity rule: two different dates are refused, flag on or off',
    parityProblems({ ...on, serverDate: '2026-11-02T12:00:00.000Z' }).length === 1
      && parityProblems({ flag: false, clientDate: D, serverAll: false, serverMessage: false, serverDate: '' }).length === 1);
  ok('parity rule: the server may be on ahead of the app', parityProblems({ flag: false, clientDate: '', serverAll: true, serverMessage: false, serverDate: '' }).length === 0);

  if (!existsSync(join(ROOT, SERVER_CORE))) {
    if (process.env.ATT_SOLO === '1') {
      pass++;
      console.log('  ✓ parity: skipped (ATT_SOLO)');
    } else {
      ok(`${SERVER_CORE} is on the branch (set ATT_SOLO=1 only inside the lane)`, false, 'the server switches cannot be compared without it');
    }
    return;
  }
  const server = code(SERVER_CORE);
  const bool = (name: string): boolean | null => {
    const m = server.match(new RegExp(`^export const ${name}(?:: boolean)? = (true|false);`, 'm'));
    return m ? m[1] === 'true' : null;
  };
  const dateM = server.match(/^export const MESSAGE_SOURCE_NOT_BEFORE(?:: string)? = '([^']*)';/m);
  const serverAll = bool('ASK_FILES_SERVER_ENABLED');
  const serverMessage = bool('MESSAGE_SOURCE_ENABLED');
  ok('the server file declares ASK_FILES_SERVER_ENABLED, MESSAGE_SOURCE_ENABLED and MESSAGE_SOURCE_NOT_BEFORE as plain literals',
    serverAll !== null && serverMessage !== null && !!dateM);
  if (serverAll === null || serverMessage === null || !dateM) return;
  const problems = parityProblems({
    flag: !!(PORTAL_MESSAGE_AI_ENABLED as boolean), clientDate: MESSAGE_AI_NOT_BEFORE, serverAll, serverMessage, serverDate: dateM[1],
  });
  ok('parity: the app flag and cut-off date agree with the server switches and date', problems.length === 0, problems.join('; '));
}

// ─── B. canReadWithAi: the whole truth table ────────────────────────────────

function partB() {
  console.log('\nB. canReadWithAi:');
  const CUT = '2026-11-01T12:00:00.000Z';
  const cutMs = Date.parse(CUT);
  const DATES: Array<{ name: string; createdAt: string; notBefore: string; after: boolean }> = [
    { name: 'no cut-off', createdAt: new Date(cutMs + 60_000).toISOString(), notBefore: '', after: false },
    { name: 'before', createdAt: new Date(cutMs - 1).toISOString(), notBefore: CUT, after: false },
    { name: 'equal', createdAt: CUT, notBefore: CUT, after: true },
    { name: 'after', createdAt: new Date(cutMs + 1).toISOString(), notBefore: CUT, after: true },
  ];
  const ROLES: Array<string | null | undefined> = ['owner', 'editor', 'viewer', 'field', null, undefined];
  const AUTHORS = ['client', 'gc'];
  const FILES: Array<{ name: string; attachments: { path?: string }[]; stored: boolean }> = [
    { name: 'with a path', attachments: [{ path: 'p/m/a.jpg' }], stored: true },
    { name: 'without a path', attachments: [{}], stored: false },
  ];
  let rows = 0;
  let trueRows = 0;
  const wrong: string[] = [];
  for (const flag of [true, false]) for (const isWeb of [true, false]) for (const role of ROLES)
    for (const authorType of AUTHORS) for (const pending of [true, false]) for (const f of FILES) for (const d of DATES) {
      rows++;
      const want = flag && !isWeb && role === 'owner' && authorType === 'client' && !pending && f.stored && d.after;
      const got = canReadWithAi({ flag, isWeb, role, authorType, pending, attachments: f.attachments, createdAt: d.createdAt, notBefore: d.notBefore });
      if (got) trueRows++;
      if (got !== want) wrong.push(`flag=${flag} web=${isWeb} role=${String(role)} author=${authorType} pending=${pending} ${f.name} ${d.name}: got ${got}`);
    }
  ok(`the truth table holds on all ${rows} rows`, rows === 2 * 2 * 6 * 2 * 2 * 2 * 4 && wrong.length === 0, wrong.slice(0, 6).join('\n     '));
  ok('exactly two rows are true: the owner, a phone, a client, sent, a stored file, at or after the cut-off', trueRows === 2, String(trueRows));

  const base = { flag: true, isWeb: false, role: 'owner', authorType: 'client', pending: false, attachments: [{ path: 'p/m/a.jpg' }], createdAt: CUT, notBefore: CUT };
  ok('the base case is true', canReadWithAi(base) === true);
  ok('no attachments: false', canReadWithAi({ ...base, attachments: [] }) === false);
  ok("an empty path '': false", canReadWithAi({ ...base, attachments: [{ path: '' }] }) === false);
  ok('one stored file among device copies is enough', canReadWithAi({ ...base, attachments: [{}, { path: 'p/m/b.pdf' }] }) === true);
  ok("role 'Owner' or ' owner' is not the owner (exact match)",
    canReadWithAi({ ...base, role: 'Owner' }) === false && canReadWithAi({ ...base, role: ' owner' }) === false);
  ok("author 'Client' is not a client row (exact match)", canReadWithAi({ ...base, authorType: 'Client' }) === false);
  ok('a flag that is truthy but not true is off', canReadWithAi({ ...base, flag: 1 as unknown as boolean }) === false);
  ok('a cut-off that is not a time, or a message time that is not a time: false',
    canReadWithAi({ ...base, notBefore: 'soon' }) === false && canReadWithAi({ ...base, createdAt: 'yesterday' }) === false
      && canReadWithAi({ ...base, createdAt: '' }) === false);
}

// ─── C. aiReadableFiles ─────────────────────────────────────────────────────

let fileSeq = 0;
function file(size: number, opts: { path?: string | null; name?: string } = {}): MessageAttachment {
  fileSeq++;
  const id = `f${fileSeq}`;
  const att: MessageAttachment = { id, name: opts.name ?? `${id}.jpg`, mime: 'image/jpeg', size, kind: 'image' };
  if (opts.path !== null) att.path = opts.path ?? `proj/msg/${id}.jpg`;
  return att;
}
const ids = (list: { id: string }[]) => list.map((a) => a.id).join(',');
const whys = (r: ReturnType<typeof aiReadableFiles>) => r.notRead.map((n) => `${n.att.id}:${n.reason}`).join(',');

function partC() {
  console.log('\nC. aiReadableFiles:');
  const MB = Math.floor(ASK_TOTAL_MAX_BYTES / 8);
  ok('the limits come from utils/askFilesCore (4 files, 4 MB a file, 8 MB together)',
    ASK_MAX_FILES === 4 && ASK_MESSAGE_FILE_MAX_BYTES === 4194304 && ASK_TOTAL_MAX_BYTES === 8388608);

  {
    const a = [file(10), file(20), file(30)];
    const r = aiReadableFiles(a);
    ok('message order is kept', ids(r.read) === ids(a) && r.notRead.length === 0);
  }
  {
    const a = [file(1), file(1), file(1), file(1), file(1), file(1)];
    const r = aiReadableFiles(a);
    ok("the fifth and sixth files are 'count'", ids(r.read) === ids(a.slice(0, 4)) && whys(r) === `${a[4].id}:count,${a[5].id}:count`, whys(r));
  }
  {
    const at = file(ASK_MESSAGE_FILE_MAX_BYTES);
    const over = file(ASK_MESSAGE_FILE_MAX_BYTES + 1);
    const r = aiReadableFiles([at, over]);
    ok("a file at the limit is read; one byte over is 'size'", ids(r.read) === at.id && whys(r) === `${over.id}:size`, whys(r));
  }
  {
    const a = [file(4 * MB), file(3 * MB), file(2 * MB), file(1 * MB)];
    const r = aiReadableFiles(a);
    ok("the total rule: a file that would pass the total is 'total', a later one that fits is read",
      ids(r.read) === [a[0].id, a[1].id, a[3].id].join(',') && whys(r) === `${a[2].id}:total`, `${ids(r.read)} | ${whys(r)}`);
    const exact = [file(4 * MB), file(4 * MB), file(1)];
    const r2 = aiReadableFiles(exact);
    ok("exactly the total is read; one more byte is 'total'", ids(r2.read) === ids(exact.slice(0, 2)) && whys(r2) === `${exact[2].id}:total`, whys(r2));
  }
  {
    const gone = file(5, { path: null });
    const empty = file(5, { path: '' });
    const a = [gone, empty, file(1), file(1), file(1), file(1)];
    const r = aiReadableFiles(a);
    ok("no path is 'missing', and takes no slot", ids(r.read) === ids(a.slice(2)) && whys(r) === `${gone.id}:missing,${empty.id}:missing`, whys(r));
  }
  {
    const big = file(ASK_MESSAGE_FILE_MAX_BYTES + 1);
    const a = [big, file(1), file(1), file(1), file(1)];
    const r = aiReadableFiles(a);
    ok('a file that is too big takes no slot and no share of the total', ids(r.read) === ids(a.slice(1)) && whys(r) === `${big.id}:size`, whys(r));
  }
  {
    const a = [file(1), file(1), file(1), file(1), file(1)];
    const excluded = new Map<string, NotReadReason>([[a[1].id, 'pages']]);
    const r = aiReadableFiles(a, excluded);
    ok('an excluded id keeps its reason and frees its slot for the next file',
      ids(r.read) === [a[0].id, a[2].id, a[3].id, a[4].id].join(',') && whys(r) === `${a[1].id}:pages`, `${ids(r.read)} | ${whys(r)}`);
    const r2 = aiReadableFiles(a, new Map<string, NotReadReason>([[a[0].id, 'unreadable'], [a[4].id, 'size']]));
    ok('two excluded ids keep their own reasons, in message order', whys(r2) === `${a[0].id}:unreadable,${a[4].id}:size`, whys(r2));
    const lost = file(1, { path: null });
    const r3 = aiReadableFiles([lost], new Map<string, NotReadReason>([[lost.id, 'pages']]));
    ok('the excluded reason outranks a missing path', whys(r3) === `${lost.id}:pages`, whys(r3));
  }
  {
    const r = aiReadableFiles([]);
    ok('an empty message reads nothing', r.read.length === 0 && r.notRead.length === 0);
    const odd = [file(Number.NaN), file(-5)];
    const r2 = aiReadableFiles(odd);
    ok('a size that is not a positive number is counted as 0 (the server measures the bytes)', ids(r2.read) === ids(odd));
  }

  const src = code(CORE);
  const body = src.slice(src.indexOf('export function aiReadableFiles'), src.indexOf('export function refusalToNotRead'));
  ok('aiReadableFiles names the three askFilesCore constants',
    /ASK_MESSAGE_FILE_MAX_BYTES/.test(body) && /ASK_MAX_FILES/.test(body) && /ASK_TOTAL_MAX_BYTES/.test(body)
      && /import \{ ASK_MAX_FILES, ASK_MESSAGE_FILE_MAX_BYTES, ASK_TOTAL_MAX_BYTES, guardFileText \} from '@\/utils\/askFilesCore';/.test(src));
  ok('aiReadableFiles holds no number of its own (only 0)', body.length > 200 && !/[1-9]/.test(body), (body.match(/.*[1-9].*/) ?? [''])[0]);
  ok('utils/messageAiCore.ts holds no size literal', !/4194304|8388608|6291456|1048576|\b1024\b|\bMB\b/.test(src));
}

// ─── D. routes and draftText ────────────────────────────────────────────────

function partD() {
  console.log('\nD. draft routes:');
  const co = coDraftRoute('P1', 'Client asks to move the light.');
  ok('change order: /change-order with exactly projectId, prefillReason client_request, prefillDescription',
    same(co, { pathname: '/change-order', params: { projectId: 'P1', prefillReason: 'client_request', prefillDescription: 'Client asks to move the light.' } })
      && Object.keys(co.params).sort().join(',') === 'prefillDescription,prefillReason,projectId');
  ok('change order: never an amount, lines or schedule days',
    !('prefillAmount' in co.params) && !('prefillLines' in co.params) && !('prefillScheduleDays' in co.params));
  const rfi = rfiDraftRoute('P1', 'draft-id-1');
  ok('RFI: /rfi with exactly projectId and prefillDraft (an id, never the text)',
    same(rfi, { pathname: '/rfi', params: { projectId: 'P1', prefillDraft: 'draft-id-1' } })
      && Object.keys(rfi.params).sort().join(',') === 'prefillDraft,projectId');
  const punch = punchDraftRoute('P1', 'draft-id-2');
  ok("punch item: /punch-list with exactly projectId, new '1' and prefillDraft",
    same(punch, { pathname: '/punch-list', params: { projectId: 'P1', new: '1', prefillDraft: 'draft-id-2' } })
      && Object.keys(punch.params).sort().join(',') === 'new,prefillDraft,projectId');

  ok('draftText: the description, a newline, the files line', draftText('Client asks to move the light.', 'Files: a.jpg') === 'Client asks to move the light.\nFiles: a.jpg');
  ok('draftText: trimmed', draftText('  Move it.  ', '') === 'Move it.' && draftText('', '  Files: a  ') === 'Files: a');
  const long = draftText('x'.repeat(1500), 'Files: a.jpg');
  ok('draftText: cut to 1,000 characters', DRAFT_TEXT_MAX === 1000 && long.length === 1000 && long === 'x'.repeat(1000));
  ok('draftText: exactly 1,000 is kept whole', draftText('y'.repeat(990), 'Files: ab').length === 1000);

  // The "(n more not read)" note is never what gets cut.
  const NOTE = '(2 more not read)';
  ok('draftText: a short draft ends with the note, one space after the files line',
    draftText('Client asks to move the outlet.', 'Files: IMG_1.jpg, IMG_2.jpg', NOTE) === 'Client asks to move the outlet.\nFiles: IMG_1.jpg, IMG_2.jpg (2 more not read)');
  ok('draftText: no note, or a blank one, is the two-argument text exactly',
    draftText('Move it.', 'Files: a.jpg', '') === draftText('Move it.', 'Files: a.jpg') && draftText('Move it.', 'Files: a.jpg', '   ') === 'Move it.\nFiles: a.jpg');
  {
    // The server's limits: an 800-character description, four names of about 195 characters.
    const names = [1, 2, 3, 4].map((i) => `${i}-${'n'.repeat(190)}.jpg`).join(', ');
    const t = draftText('D'.repeat(800), `Files: ${names}`, NOTE);
    ok('draftText: long file names give way, the note stays whole at the end, and the cut is marked',
      t.length === DRAFT_TEXT_MAX && t.endsWith(`… ${NOTE}`) && t.startsWith(`${'D'.repeat(800)}\nFiles: 1-n`), `${t.length} | ${JSON.stringify(t.slice(-30))}`);
    const exact = draftText('y'.repeat(1000 - 'Files: ab'.length - 1 - NOTE.length - 1), 'Files: ab', NOTE);
    ok('draftText: exactly 1,000 with the note is kept whole, with no cut mark',
      exact.length === DRAFT_TEXT_MAX && exact.endsWith(`Files: ab ${NOTE}`) && !exact.includes('…'));
    const over = draftText('y'.repeat(1000 - 'Files: ab'.length - 1 - NOTE.length), 'Files: ab', NOTE);
    ok('draftText: one character over is cut before the note, never in it',
      over.length <= DRAFT_TEXT_MAX && over.endsWith(`… ${NOTE}`), `${over.length} | ${JSON.stringify(over.slice(-30))}`);
    const longOnly = draftText('x'.repeat(1500), 'Files: a.jpg', NOTE);
    ok('draftText: a description alone over the limit still ends with the note',
      longOnly.length === DRAFT_TEXT_MAX && longOnly === `${'x'.repeat(DRAFT_TEXT_MAX - NOTE.length - 2)}… ${NOTE}`);
  }
  ok('draftText: the note alone is the note', draftText('', '', NOTE) === NOTE && draftText('  ', '', ` ${NOTE} `) === NOTE);
}

// ─── E. the in-memory hand-over ─────────────────────────────────────────────

function partE() {
  console.log('\nE. draftHandoff:');
  clearDraftHandoffs();
  const T0 = 1_800_000_000_000;
  ok('the limits are 3 entries, 10 minutes, 80 and 1,000 characters',
    DRAFT_HANDOFF_MAX_ENTRIES === 3 && DRAFT_HANDOFF_TTL_MS === 600000 && DRAFT_HANDOFF_TITLE_MAX === 80 && DRAFT_HANDOFF_DESCRIPTION_MAX === 1000);

  const id = stashDraftHandoff({ title: 'T'.repeat(200), description: 'D'.repeat(3000) }, T0);
  const got = readDraftHandoff(id, T0 + 1);
  ok('stash then read returns the clipped copy (title 80, description 1,000)',
    !!got && got.title === 'T'.repeat(80) && got.description === 'D'.repeat(1000));
  ok('reading twice works (a form can remount)', same(readDraftHandoff(id, T0 + 2), got));
  ok('a read hands out a copy, not the held object', (() => {
    const a = readDraftHandoff(id, T0 + 3);
    if (!a) return false;
    a.title = 'changed';
    return readDraftHandoff(id, T0 + 4)?.title === 'T'.repeat(80);
  })());
  ok('an unknown id is null', readDraftHandoff('00000000-0000-4000-8000-000000000000', T0) === null);
  ok('a non-string id is null', [undefined, null, 7, {}, [id], true].every((v) => readDraftHandoff(v, T0) === null) && readDraftHandoff('', T0) === null);
  ok('one millisecond short of ten minutes is still held', readDraftHandoff(id, T0 + DRAFT_HANDOFF_TTL_MS - 1) !== null);
  ok('at ten minutes it is null', readDraftHandoff(id, T0 + DRAFT_HANDOFF_TTL_MS) === null);
  ok('and it stays null afterwards, even for an earlier clock', readDraftHandoff(id, T0 + 1) === null);

  clearDraftHandoffs();
  const a = stashDraftHandoff({ title: 'a', description: 'one' }, T0);
  const b = stashDraftHandoff({ title: 'b', description: 'two' }, T0 + 1);
  ok('two stashes give two different ids of at least 16 characters', a !== b && a.length >= 16 && b.length >= 16);
  const c = stashDraftHandoff({ title: 'c', description: 'three' }, T0 + 2);
  ok('three are held', [a, b, c].every((x) => readDraftHandoff(x, T0 + 3) !== null));
  const d = stashDraftHandoff({ title: 'd', description: 'four' }, T0 + 3);
  ok('a fourth stash drops the oldest and keeps the other three',
    readDraftHandoff(a, T0 + 4) === null && [b, c, d].every((x) => readDraftHandoff(x, T0 + 4) !== null)
      && readDraftHandoff(d, T0 + 4)?.description === 'four');
  ok('a stash with fields that are not text keeps empty text, never the value',
    same(readDraftHandoff(stashDraftHandoff({ title: 5, description: null } as unknown as { title: string; description: string }, T0), T0), { title: '', description: '' }));
  clearDraftHandoffs();
  ok('clearDraftHandoffs drops everything', readDraftHandoff(d, T0 + 5) === null);

  const src = read(HANDOFF);
  ok('utils/draftHandoff.ts keeps nothing on disk: no storage of any kind',
    !/AsyncStorage|localStorage|sessionStorage|SecureStore|FileSystem|setItem\(|supabase/.test(src));
  ok("the id is generateUUID from '@/utils/generateId'",
    /import \{ generateUUID \} from '@\/utils\/generateId';/.test(src) && /const id = generateUUID\(\);/.test(src));
}

// ─── F. the small rules ─────────────────────────────────────────────────────

function partF() {
  console.log('\nF. isAfterNotice, messageAiBlock, refusalToNotRead:');
  const CUT = '2026-11-01T12:00:00.000Z';
  const ms = Date.parse(CUT);
  ok("isAfterNotice: '' cut-off is false for every message", isAfterNotice(new Date(ms + 1).toISOString(), '') === false && isAfterNotice(CUT, '') === false);
  ok('isAfterNotice: a cut-off that is not a time is false', isAfterNotice(CUT, 'not a date') === false);
  ok('isAfterNotice: a message time that is not a time is false', isAfterNotice('not a date', CUT) === false && isAfterNotice('', CUT) === false);
  ok('isAfterNotice: equal is true', isAfterNotice(CUT, CUT) === true);
  ok('isAfterNotice: one millisecond before is false', isAfterNotice(new Date(ms - 1).toISOString(), CUT) === false);
  ok('isAfterNotice: one millisecond after is true', isAfterNotice(new Date(ms + 1).toISOString(), CUT) === true);
  ok('isAfterNotice: values that are not strings are false',
    isAfterNotice(undefined as unknown as string, CUT) === false && isAfterNotice(CUT, undefined as unknown as string) === false
      && isAfterNotice(CUT, null as unknown as string) === false);
  // The cut-off is held to the server's pattern: a date alone or a time with no
  // zone is a different instant on every phone, so it is read as no cut-off.
  const LATER = ['2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00+00:00', '2026-10-11T00:00:00.123456+00:00'];
  const REFUSED_CUTS = ['2026-10-10', '2026-10-10T15:00:00', 'October 10, 2026', '2026-10-10 15:00:00+00'];
  const badCut = REFUSED_CUTS.filter((nb) => LATER.some((at) => isAfterNotice(at, nb)) || Number.isFinite(noticeTimeMs(nb)));
  ok(`isAfterNotice: a cut-off the server would not accept shows no button (${REFUSED_CUTS.length} values: a date alone, no zone, not ISO, a space for the T)`,
    badCut.length === 0, badCut.join(' | '));
  const GOOD_CUTS = ['2026-10-10T15:00:00Z', '2026-10-10T15:00:00.000Z', '2026-10-10T11:00:00-04:00', '2026-10-10T15:00Z'];
  ok(`isAfterNotice: a cut-off that names its zone is read (${GOOD_CUTS.length} values), and they are one instant`,
    GOOD_CUTS.every((nb) => LATER.every((at) => isAfterNotice(at, nb)) && noticeTimeMs(nb) === Date.parse('2026-10-10T15:00:00Z'))
      && GOOD_CUTS.every((nb) => isAfterNotice('2026-10-10T14:59:59.999Z', nb) === false));
  ok('noticeTimeMs: a value that is not a string, a leading space and an impossible date are not a time',
    [1791644400000, null, undefined, ' 2026-10-10T15:00:00Z', '2026-13-45T00:00:00Z', ''].every((v) => !Number.isFinite(noticeTimeMs(v))));
  {
    const serverSrc = existsSync(join(ROOT, SERVER_CORE)) ? read(SERVER_CORE) : '';
    const mine = read(CORE).match(/^const NOTICE_TIME_RE = (\/.*\/);$/m)?.[1] ?? 'app pattern not found';
    const theirs = serverSrc.match(/^const ISO_TIME_RE = (\/.*\/);$/m)?.[1] ?? 'server pattern not found';
    ok("the app's cut-off pattern is the server's ISO_TIME_RE, character for character (and this script's copy too)",
      mine === String(SERVER_TIME_RE) && (mine === theirs || (serverSrc === '' && process.env.ATT_SOLO === '1')), `${mine} vs ${theirs}`);
  }

  ok("messageAiBlock: Free is 'plan', even offline (the plan comes first)",
    messageAiBlock({ isPro: false, offline: false }) === 'plan' && messageAiBlock({ isPro: false, offline: true }) === 'plan');
  ok("messageAiBlock: Pro and offline is 'offline'; Pro and online is null",
    messageAiBlock({ isPro: true, offline: true }) === 'offline' && messageAiBlock({ isPro: true, offline: false }) === null);

  ok("refusalToNotRead: file_too_large 'size', too_many_pages 'pages', unreadable_file 'unreadable'",
    refusalToNotRead('file_too_large') === 'size' && refusalToNotRead('too_many_pages') === 'pages' && refusalToNotRead('unreadable_file') === 'unreadable');
  ok('refusalToNotRead: every other code is null',
    ['files_too_large', 'too_many_files', 'unsupported_type', 'blocked', 'file_unavailable', 'before_notice', 'account_ai_off', 'no_answer', '', 'toString']
      .every((c) => refusalToNotRead(c) === null));
}

// ─── G. source pins ─────────────────────────────────────────────────────────

function partG() {
  console.log('\nG. source pins:');
  const cm = code(SCREEN);

  // The dark state: the button's props are passed only through the spread,
  // and the sheet is mounted only inside the flag.
  ok('client-messages: `readable` is the flag AND canReadWithAi, called with flag, isWeb, role, the row and the cut-off',
    /const readable = PORTAL_MESSAGE_AI_ENABLED && canReadWithAi\(\{\s*flag: PORTAL_MESSAGE_AI_ENABLED, isWeb: Platform\.OS === 'web', role,\s*authorType: item\.message\.authorType, pending: !!item\.pending,\s*attachments: item\.message\.attachments \?\? \[\], createdAt: item\.message\.createdAt,\s*notBefore: MESSAGE_AI_NOT_BEFORE \}\);/.test(cm));
  ok('client-messages: `role` is still useProjectRole(project?.id)', /const role = useProjectRole\(project\?\.id\);/.test(cm));
  ok('client-messages: onReadWithAi reaches the bubble only inside the conditional spread',
    count(cm, /\{\.\.\.\(readable \? \{ onReadWithAi: \(\) => setAiMessage\(/g) === 1
      && count(cm, /onReadWithAi=\{/g) === 0 && count(cm, /readAiLabel=\{/g) === 0 && count(cm, /readAiA11y=\{/g) === 0
      && /readAiLabel: copy\.ai\.read, readAiA11y: copy\.ai\.readA11y \} : null\)\}/.test(cm));
  ok('client-messages: setAiMessage is called only by the spread and by the sheet closing',
    count(cm, /setAiMessage\(/g) === 2 && /onClose=\{\(\) => setAiMessage\(null\)\}/.test(cm));
  const mounts = [...cm.matchAll(/<MessageAiSheet/g)];
  ok('client-messages: exactly one <MessageAiSheet, within 80 characters after `PORTAL_MESSAGE_AI_ENABLED &&`',
    mounts.length === 1 && cm.slice(Math.max(0, (mounts[0].index ?? 0) - 80), mounts[0].index).includes('PORTAL_MESSAGE_AI_ENABLED &&'));
  ok('client-messages: the button is one conditional sibling between the bubble and the time label, with no wrapper',
    /\) : bubble\}\s*\{onReadWithAi \? \(\s*<Pressable\s+onPress=\{onReadWithAi\}[\s\S]{0,260}accessibilityRole="button"\s+accessibilityLabel=\{readAiA11y\}\s+testID=\{`message-read-ai-\$\{m\.id\}`\}\s*>[\s\S]{0,260}<\/Pressable>\s*\) : null\}\s*\{isLastInRun && !pending \? \(/.test(cm));
  ok('client-messages: the long-press convert is as it was (the message body, every file name)',
    /prefillDescription: `Client request from portal message:\\n\\n"\$\{messageBody\}"\$\{filesLine\}`,/.test(cm)
      && /\{ text: 'Convert to change order', onPress: \(\) => handleConvertToCO\(messageBody, fileNames\) \}/.test(cm));
  ok('client-messages: the screen itself never calls askFiles and never guards or stashes a draft',
    !/askFiles\(|guardFileText\(|stashDraftHandoff\(|readDraftHandoff\(/.test(cm));

  // Nothing posted, saved or logged from the three new files (raw source, comments included).
  const BANNED = ['sendMessage', 'sendWithAttachments', 'writePortalMessage', 'supabaseWrite', 'setComposeBody', 'supabase.from(',
    'AsyncStorage', 'console.', 'track(', 'prefillAmount'];
  for (const f of [SHEET, CORE, HANDOFF]) {
    const raw = read(f);
    const hit = BANNED.filter((w) => raw.includes(w));
    ok(`${f}: no thread write, no saved record, no storage, no log, no amount`, hit.length === 0, hit.join(', '));
  }
  const noSupabase = [SHEET, CORE, HANDOFF].filter((f) => /@\/lib\/supabase|offlineQueue|functions\.invoke|invokeWithTimeout|fetch\(/.test(read(f)));
  ok('the three new files open no connection of their own (the request is inside utils/askFiles)', noSupabase.length === 0, noSupabase.join(', '));

  // The function's name lives in utils/askFiles only.
  const LANE = [SCREEN, SHEET, CORE, HANDOFF, 'hooks/useMessageAttachmentCopy.ts', 'i18n/catalog/en/office.client-messages.generated.ts',
    'app/rfi.tsx', 'app/punch-list.tsx', 'scripts/validate-portal-message-ai.ts', '__tests__/smoke/client-messages-ai.test.tsx'];
  const fnLiteral = new RegExp(`['"\`]ask${'-'}files['"\`]`);
  const named = LANE.filter((f) => existsSync(join(ROOT, f)) && fnLiteral.test(read(f)));
  ok('no file of this lane names the edge function as a literal', named.length === 0, named.join(', '));
  ok('every file of this lane is on the branch', LANE.every((f) => existsSync(join(ROOT, f))), LANE.filter((f) => !existsSync(join(ROOT, f))).join(', '));

  // The sheet.
  const sheet = code(SHEET);
  ok('MessageAiSheet: built on <Sheet>, never a <Modal>', /<Sheet\b/.test(sheet) && !/<Modal\b/.test(sheet) && !/\bModal\b/.test(sheet));
  ok('MessageAiSheet: the punch gate is useProjectAccess(project.id).canAccess(\'punch_list_closeout\')',
    /useProjectAccess\(project\.id\)\.canAccess\('punch_list_closeout'\)/.test(sheet));
  ok('MessageAiSheet: no t() of its own (strings come from the two copy hooks)',
    !/useT\(/.test(sheet) && !/\b(?:t|tn)\(\s*['"`]/.test(sheet) && /useMessageAttachmentCopy\(\)/.test(sheet) && /useAskCopy\(\)/.test(sheet));
  const readFiles = sheet.slice(sheet.indexOf('const readFiles = useCallback'), sheet.indexOf('const retry = useCallback'));
  const iBlock = readFiles.indexOf('if (messageAiBlock({ isPro: isProOrAbove, offline })) return;');
  const iAsk1 = readFiles.indexOf("out = await askFiles({ feature: 'portal', files });");
  const iSettle = readFiles.indexOf('await settleAiConsentSync();');
  const iAsk2 = readFiles.indexOf("out = await askFiles({ feature: 'portal', files });", iSettle);
  ok('MessageAiSheet: the plan and connection check comes before the first askFiles',
    iBlock > 0 && iAsk1 > iBlock);
  ok('MessageAiSheet: files are sent as message ids only (no name, no path, no bytes)',
    /const files = sent\.map\(\(a\) => \(\{ source: 'message' as const, messageId: message\.id, attachmentId: a\.id \}\)\);/.test(readFiles)
      && !/source: '(?:device|plan|inline)'/.test(sheet));
  ok("MessageAiSheet: on account_ai_off (the code the server sends) it waits for settleAiConsentSync() and asks once more, no more",
    /if \(!out\.ok && out\.code === 'account_ai_off'\) \{\s*await settleAiConsentSync\(\);\s*out = await askFiles\(\{ feature: 'portal', files \}\);\s*\}/.test(readFiles)
      && iAsk1 > 0 && iSettle > iAsk1 && iAsk2 > iSettle && count(sheet, /askFiles\(/g) === 2);
  ok('MessageAiSheet: a second tap while a read is in flight starts nothing (each read is counted)',
    /if \(running\.current\) return;\s*running\.current = true;/.test(readFiles)
      && readFiles.indexOf('if (running.current) return;') < iAsk1 && readFiles.indexOf('running.current = false;') > iAsk2
      && /\} finally \{\s*running\.current = false;\s*\}/.test(readFiles));
  ok("MessageAiSheet: the account refusal shows accountOff, and the old code is quoted nowhere in the sheet",
    /if \(out\.code === 'account_ai_off'\) \{\s*setFailure\(\{ sentence: copy\.ai\.accountOff, retry: true, plans: false \}\);/.test(readFiles)
      && !/['"`]ai_off['"`]/.test(read(SHEET)));
  const coreSrc = code(CORE);
  const guardBody = coreSrc.slice(coreSrc.indexOf('export function guardMessageReading'), coreSrc.indexOf('export const DRAFT_TEXT_MAX'));
  ok('MessageAiSheet: every model text goes through guardMessageReading before it is stored, and the sheet gates nothing itself',
    /setReading\(guardMessageReading\(out\.data\)\);/.test(readFiles) && count(sheet, /setReading\(/g) === 2
      && !/guardFileText/.test(sheet) && count(sheet, /out\.data\.(?:summary|asks|draft)/g) === 0);
  ok('guardMessageReading: the summary, every ask, the title and the description each pass the gate, with the whole reading as the third argument',
    count(guardBody, /guardFileText\(/g) === 1 && /const g = guardFileText\(text, labels, whole\);/.test(guardBody)
      && /const whole = \[str\(data\.summary\), \.\.\.rawAsks, str\(data\.draft\?\.title\), str\(data\.draft\?\.description\)\];/.test(guardBody)
      && /const summary = gate\(str\(data\.summary\)\);/.test(guardBody) && /rawAsks\.map\(gate\)\.filter\(/.test(guardBody)
      && /const title = gate\(str\(data\.draft\.title\)\);/.test(guardBody) && /const description = gate\(str\(data\.draft\.description\)\);/.test(guardBody));
  ok('MessageAiSheet: a refusal that names a file moves it to "Not read" and returns to the list',
    /const reason = refusalToNotRead\(out\.code\);/.test(readFiles) && /setExcluded\(\(prev\) => new Map\(prev\)\.set\(refused\.id, reason\)\);/.test(readFiles));
  ok('MessageAiSheet: the Files line is built from the server\'s read list',
    /copy\.coPrefillFiles\(reading\.read\.map\(\(r\) => r\.name\)\.join\(', '\)\)/.test(sheet) && !/coPrefillFiles\(message\.attachments/.test(sheet));
  ok('MessageAiSheet: the "(n more not read)" note goes to draftText on its own, so a long text cannot cut it off',
    /return draftText\(reading\.draft\.description, filesLine, left > 0 \? copy\.ai\.moreNotRead\(left\) : ''\);/.test(sheet)
      && count(sheet, /draftText\(/g) === 1 && count(sheet, /moreNotRead\(/g) === 1);
  ok('MessageAiSheet: the "What I read" block is fed from the server\'s read list',
    /<WhatIRead files=\{toTurnFiles\(reading\.read\)\} partial=\{reading\.truncated\} copy=\{askCopy\.files\} \/>/.test(sheet));
  ok('MessageAiSheet: the change order goes through coDraftRoute; the RFI and punch item carry a stashed id',
    /router\.push\(coDraftRoute\(project\.id, draftBody\)\);/.test(sheet)
      && /const id = stashDraftHandoff\(\{ title: reading\.draft\.title, description: draftBody \}\);\s*router\.push\(rfiDraftRoute\(project\.id, id\)\);/.test(sheet)
      && /const id = stashDraftHandoff\(\{ title: reading\.draft\.title, description: draftBody \}\);\s*router\.push\(punchDraftRoute\(project\.id, id\)\);/.test(sheet)
      && count(sheet, /router\.push\(/g) === 4);
  ok('MessageAiSheet: it cannot be dismissed while the read runs', /dismissible=\{phase !== 'reading'\}/.test(sheet));
  ok('MessageAiSheet: no raw hex, no fontWeight 800, no screen-title style name',
    !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(sheet) && !/fontWeight: '800'/.test(sheet) && !/\b(?:title|screenTitle|pageTitle|headerTitle): \{/.test(sheet));
  ok('MessageAiSheet: the draft block is a cardSurface, not a hand-rolled card',
    /cardSurface\(t, /.test(sheet) && !/backgroundColor: t\.surface/.test(sheet));

  // /rfi and /punch-list read the draft only behind the flag.
  const rfi = code('app/rfi.tsx');
  const punch = code('app/punch-list.tsx');
  const rfiCalls = rfi.split('\n').filter((l) => l.includes('readDraftHandoff('));
  ok('rfi.tsx: the one readDraftHandoff( sits in an expression that starts with PORTAL_MESSAGE_AI_ENABLED, for a new RFI only',
    rfiCalls.length === 1
      && /const \[aiDraft\] = useState\(\(\) => \(PORTAL_MESSAGE_AI_ENABLED && !rfiId \? readDraftHandoff\(prefillDraft\) : null\)\);/.test(rfiCalls[0]),
    rfiCalls.join(' | '));
  ok('rfi.tsx: the draft only seeds the subject and the question of a new RFI, after the saved values',
    /useState\(existingRFI\?\.subject \?\? aiDraft\?\.title \?\? ''\)/.test(rfi) && /useState\(existingRFI\?\.question \?\? aiDraft\?\.description \?\? ''\)/.test(rfi)
      && count(rfi, /aiDraft/g) === 3);
  const punchCalls = punch.split('\n').filter((l) => l.includes('readDraftHandoff('));
  ok('punch-list.tsx: the one readDraftHandoff( sits in an expression that starts with PORTAL_MESSAGE_AI_ENABLED',
    punchCalls.length === 1
      && /^\s*if \(PORTAL_MESSAGE_AI_ENABLED\) \{ const d = readDraftHandoff\(prefillDraft\); if \(d\) setDescription\(d\.description\); \}\s*$/.test(punchCalls[0]),
    punchCalls.join(' | '));
  ok('punch-list.tsx: the read is inside the new=1 effect, right after setShowForm(true), and the effect depends on prefillDraft',
    /setShowForm\(true\);\s*if \(PORTAL_MESSAGE_AI_ENABLED\) \{ const d = readDraftHandoff\(prefillDraft\);[^\n]*\n\s*\}, \[openNew, project, prefillPhotoUri, prefillPhotoId, recordWriteBlock, t, prefillDraft\]\);/.test(punch));
  ok('neither form gains a text param (no prefillSubject, prefillQuestion or prefillDescription)',
    !/prefillSubject|prefillQuestion|prefillDescription/.test(rfi) && !/prefillSubject|prefillQuestion|prefillDescription/.test(punch));
  ok('both forms import the flag and the reader, and no location is prefilled from a draft',
    [rfi, punch].every((s) => /import \{ PORTAL_MESSAGE_AI_ENABLED \} from '@\/constants\/featureFlags';/.test(s)
      && /import \{ readDraftHandoff \} from '@\/utils\/draftHandoff';/.test(s))
      && !/setLocation\(d\./.test(punch));

  // The copy.
  const hook = read('hooks/useMessageAttachmentCopy.ts');
  const start = hook.indexOf('      ai: {');
  const end = hook.indexOf('\n      },', start);
  const block = start > 0 && end > start ? hook.slice(start, end) : '';
  const blockKeys = [...block.matchAll(/\b(?:t|tn)\(\s*'([^']+)'/g)].map((m) => m[1]);
  const allAiKeys = [...hook.matchAll(/\b(?:t|tn)\(\s*'(office\.clientMessages\.ai\.[^']+)'/g)].map((m) => m[1]);
  ok(`every key of the ai block starts with office.clientMessages.ai. (${blockKeys.length} keys)`,
    blockKeys.length === 34 && blockKeys.every((k) => k.startsWith('office.clientMessages.ai.')) && new Set(blockKeys).size === 34,
    blockKeys.filter((k) => !k.startsWith('office.clientMessages.ai.')).join(', '));
  ok('no office.clientMessages.ai.* key sits outside the ai block', allAiKeys.length === blockKeys.length);
  const shard = read('i18n/catalog/en/office.client-messages.generated.ts');
  const missing = blockKeys.filter((k) => !shard.includes(`"${k}`));
  ok('the generated shard carries every ai key', missing.length === 0, missing.join(', '));
  ok('the copy says where the files go and that nothing reaches the client',
    /'The files and the message text go to Google Gemini to be read\. Nothing is sent to your client\.'/.test(block)
      && /'Nothing here is posted to the thread or sent to your client\.'/.test(block)
      && /'This reading is not saved\. Close it and it is gone\.'/.test(block));
  ok('no limit number is typed into an ai string (they are variables)',
    !/'[^'\n]*\b(?:4|8|20) (?:MB|files|pages)[^'\n]*'/.test(block) && /'more than \{count\} files'/.test(block) && /'over \{mb\} MB'/.test(block)
      && /'over \{mb\} MB together'/.test(block) && /'more than \{limit\} pages'/.test(block));
  ok('the sheet fills those variables from the askFilesCore constants',
    /copy\.ai\.notReadCount\(ASK_MAX_FILES\)/.test(sheet) && /copy\.ai\.notReadSize\(mbOf\(ASK_MESSAGE_FILE_MAX_BYTES\)\)/.test(sheet)
      && /copy\.ai\.notReadTotal\(mbOf\(ASK_TOTAL_MAX_BYTES\)\)/.test(sheet) && /copy\.ai\.notReadPages\(ASK_PDF_MAX_PAGES\)/.test(sheet));
}

// ─── H. the gate over a whole reading ───────────────────────────────────────

type MessageData = Extract<AskFilesSuccess, { mode: 'message' }>;
function messageData(over: Partial<MessageData>): MessageData {
  return {
    success: true, mode: 'message', summary: '', asks: [], draft: null, truncated: false,
    read: [{ index: 0, name: 'IMG_1.jpg', kind: 'image' }], usage: { used: 1, cap: 200 },
    ...over,
  };
}

function partH() {
  console.log('\nH. guardMessageReading:');
  // Made-up code-shaped text for the test: long, with the phrasing the gate looks for.
  const BODY = 'Guards shall be provided for those portions of open-sided walking surfaces, including stairs, ramps and landings, '
    + 'that are located more than 30 inches measured vertically to the floor or grade below at any point within 36 inches '
    + 'horizontally to the edge of the open side.';
  const NAMES_CODE = 'The client sent a photo of the stair guard and a page from IRC R312.1 about guards.';
  const PLAIN = 'The client sent a photo of the stair guard.';
  const OWN = 'Client asks to confirm the guard.';

  {
    const r = guardMessageReading(messageData({ summary: NAMES_CODE, asks: ['Confirm the guard height.'], draft: { title: 'Stair guard', description: `${OWN} ${BODY}` } }));
    ok('a code named in the summary, its text in the draft: the draft keeps his own sentence and loses the code text',
      r.draft?.description === OWN && r.withheld === true && r.summary === NAMES_CODE && r.draft?.title === 'Stair guard', JSON.stringify(r.draft));
  }
  {
    const r = guardMessageReading(messageData({ summary: NAMES_CODE, asks: [BODY, 'Confirm the guard height.'], draft: null }));
    ok('a code named in the summary, its text as an ask: that ask is dropped, the other stays',
      same(r.asks, ['Confirm the guard height.']) && r.withheld === true, JSON.stringify(r.asks));
  }
  {
    const r = guardMessageReading(messageData({ summary: NAMES_CODE, asks: [], draft: { title: 'Stair guard', description: BODY } }));
    ok('a draft whose description is all code text is no draft', r.draft === null && r.withheld === true);
  }
  {
    const r = guardMessageReading(messageData({ summary: PLAIN, asks: ['Confirm the guard height.'], draft: { title: 'Guard per IRC R312.1', description: `${OWN} ${BODY}` } }));
    ok('a code named only in the draft title holds the description too', r.draft?.description === OWN && r.withheld === true, JSON.stringify(r.draft));
  }
  {
    const r = guardMessageReading(messageData({ summary: PLAIN, asks: ['The client wants the page from NEC 210.8 checked.'], draft: { title: 'Outlet', description: `${OWN} ${BODY}` } }));
    ok('a code named only in an ask holds the draft too', r.draft?.description === OWN && r.withheld === true, JSON.stringify(r.draft));
  }
  {
    const data = messageData({ summary: PLAIN, asks: ['Move the outlet 12 inches left.'], draft: { title: 'Move outlet', description: 'Client asks to move the outlet 12 inches to the left of the sink.' } });
    const r = guardMessageReading(data);
    ok('a reading that names no code passes unchanged, nothing withheld',
      r.withheld === false && r.summary === PLAIN && same(r.asks, data.asks) && same(r.draft, data.draft) && r.read === data.read && r.truncated === false);
  }
  {
    const r = guardMessageReading(messageData({
      summary: 'A-101.2 Stair.pdf shows the stair.', read: [{ index: 0, name: 'A-101.2 Stair.pdf', kind: 'pdf', pages: 1 }],
      draft: { title: 'Stair', description: 'Client asks to move the stair shown on A-101.2 Stair.pdf.' },
    }));
    ok('a sheet number in a file name the server read is not a code: nothing withheld',
      r.withheld === false && r.draft?.description === 'Client asks to move the stair shown on A-101.2 Stair.pdf.');
  }
  {
    const odd = { success: true, mode: 'message', summary: 7, asks: 'no', draft: { title: null, description: undefined }, truncated: 1, read: null, usage: null } as unknown as MessageData;
    const r = guardMessageReading(odd);
    ok('fields that are not text are read as empty, never drawn as a value',
      same(r, { summary: '', asks: [], draft: null, read: [], truncated: true, withheld: false }), JSON.stringify(r));
    const mixed = guardMessageReading(messageData({ asks: ['Confirm the height.', 5 as unknown as string, '   '] }));
    ok('an ask that is not text, or is blank, is dropped', same(mixed.asks, ['Confirm the height.']));
  }
}

partA();
partB();
partC();
partD();
partE();
partF();
partG();
partH();

if (fail > 0) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed\n`);
