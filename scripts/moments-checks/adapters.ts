// adapters.ts: moments Step 0, item 0.4 (lane MOMSTEP0).
//
// Loaded by scripts/validate-moments.ts. Runs the REAL utils/moments/commitAdapters.ts
// under bun and proves plan rule 1 for it: success only on a real server
// confirmation.
//
//   A1  fromWriteOutcome: synced -> confirmed; queued -> queued (default label,
//       or the site's own sentence); failed -> refused(site sentence);
//       local -> queued "Saved on this phone only" / "Sign in to send it to
//       your account." and NEVER confirmed; anything else -> refused.
//   A2  fromOnlineOutcome: synced -> confirmed; refused -> refused(site sentence,
//       or the code's own sentence when the site passed one); unknown -> timeout.
//   A3  resolvePlan over every non-synced answer is never 'success' (with and
//       without legal), and runCommit turns a legal site's 'local'/'queued'
//       into refused.
//   A4  the Step 0 constants lint clean (lintMomentCopy) and carry no
//       developer words.
//   A5  mutation proof: 'local -> confirmed', 'unknown -> confirmed' and
//       'queued -> confirmed' planted on scratch copies each turn A1-A3 red.
//   A6  every data-layer online answer (signFieldTicket / saveAIAPayAppOnline's
//       OnlineRecordResult incl. code 'sealed', supabaseWriteOnlineDetailed /
//       supabaseRpcOnline's OnlineWriteResult, supabaseWriteOnline /
//       setContractStatusDetailed's bare status, saveCloseoutBinderDetailed's
//       CloseoutBinderSaveResult) passes straight into fromOnlineOutcome: a
//       compile-time proof under strict tsc (passStraightIn's signature), run
//       here too so a 'sealed' refusal reads the site's sealed sentence.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MomentsCtx } from '../validate-moments';
import * as adaptersReal from '../../utils/moments/commitAdapters';
import * as commitReal from '../../utils/moments/commitResult';
import * as copyReal from '../../utils/moments/copy';
// Type-only (erased under bun): the data layer's own answer types, so strict
// tsc proves every one of them passes STRAIGHT into fromOnlineOutcome (A6).
import type { OnlineRecordResult } from '../../contexts/ProjectContext';
import type { OnlineWriteResult, OnlineWriteStatus } from '../../utils/offlineQueue';
import type { CloseoutBinderSaveResult } from '../../utils/closeoutBinderEngine';
import type { CommitResult } from '../../utils/moments/commitResult';

type AdaptersMod = typeof adaptersReal;
type Fails = string[];

const OK = { title: 'CO #4 approved · contract $52,400.00', detail: 'Finish moves to Nov 14, 2026', next: 'It will show on the next pay application.' };
const WORDS = { refused: 'Not approved. Something went wrong on our side.' };
const ONLINE_WORDS = { refused: 'Not signed. Something went wrong on our side. The signature is kept.', timeout: 'No answer yet. Check FT-12 before trying again.' };
const DEV_WORDS = /\b(sync|synced|syncing|queue|queued|payload|tenant|seat|upsert|rpc)\b/i;

function checkAdapters(m: AdaptersMod): Fails {
  const f: Fails = [];
  const J = (x: unknown) => JSON.stringify(x);
  // A1
  const synced = m.fromWriteOutcome('synced', OK, WORDS);
  if (synced.status !== 'confirmed' || synced.title !== OK.title || synced.detail !== OK.detail || synced.next !== OK.next) f.push(`A1 synced -> ${J(synced)}`);
  const queued = m.fromWriteOutcome('queued', OK, WORDS);
  if (queued.status !== 'queued' || 'title' in queued) f.push(`A1 queued (no site words) -> ${J(queued)}`);
  const queuedOwn = m.fromWriteOutcome('queued', OK, { ...WORDS, queued: 'Approved on this phone · sends when online' });
  if (queuedOwn.status !== 'queued' || queuedOwn.title !== 'Approved on this phone · sends when online') f.push(`A1 queued (site words) -> ${J(queuedOwn)}`);
  const failed = m.fromWriteOutcome('failed', OK, WORDS);
  if (failed.status !== 'refused' || failed.reason !== WORDS.refused) f.push(`A1 failed -> ${J(failed)}`);
  const local = m.fromWriteOutcome('local', OK, WORDS);
  if (local.status === 'confirmed') f.push(`A1 local is CONFIRMED (plan rule 1): ${J(local)}`);
  if (local.status !== 'queued' || local.title !== copyReal.LOCAL_ONLY_TITLE || local.next !== copyReal.LOCAL_ONLY_NEXT) f.push(`A1 local -> ${J(local)}`);
  const junk = m.fromWriteOutcome('already' as never, OK, WORDS);
  if (junk.status !== 'refused') f.push(`A1 an unknown answer -> ${J(junk)} (must be refused)`);
  // A2
  const on = m.fromOnlineOutcome('synced', OK, ONLINE_WORDS);
  if (on.status !== 'confirmed' || on.title !== OK.title) f.push(`A2 synced -> ${J(on)}`);
  const onObj = m.fromOnlineOutcome({ status: 'synced' }, OK, ONLINE_WORDS);
  if (onObj.status !== 'confirmed') f.push(`A2 {status: synced} -> ${J(onObj)}`);
  const ref = m.fromOnlineOutcome('refused', OK, ONLINE_WORDS);
  if (ref.status !== 'refused' || ref.reason !== ONLINE_WORDS.refused) f.push(`A2 refused -> ${J(ref)}`);
  const unk = m.fromOnlineOutcome('unknown', OK, ONLINE_WORDS);
  if (unk.status !== 'timeout' || unk.message !== ONLINE_WORDS.timeout) f.push(`A2 unknown -> ${J(unk)}`);
  const pend = m.fromOnlineOutcome({ status: 'refused', code: 'earlier_change_pending' }, OK, { ...ONLINE_WORDS, earlierPending: copyReal.EARLIER_CHANGE_PENDING_REASON });
  if (pend.status !== 'refused' || pend.reason !== copyReal.EARLIER_CHANGE_PENDING_REASON) f.push(`A2 earlier_change_pending with the site's sentence -> ${J(pend)}`);
  const pendNoWords = m.fromOnlineOutcome({ status: 'refused', code: 'earlier_change_pending' }, OK, ONLINE_WORDS);
  if (pendNoWords.status !== 'refused' || pendNoWords.reason !== ONLINE_WORDS.refused) f.push(`A2 earlier_change_pending without a sentence -> ${J(pendNoWords)}`);
  const off = m.fromOnlineOutcome({ status: 'refused', code: 'offline' }, OK, { ...ONLINE_WORDS, offline: "You're offline. Signing needs a connection." });
  if (off.status !== 'refused' || off.reason !== "You're offline. Signing needs a connection.") f.push(`A2 offline -> ${J(off)}`);
  const pendingSynced = m.fromOnlineOutcome({ status: 'synced', code: 'earlier_change_pending' }, OK, ONLINE_WORDS);
  if (pendingSynced.status !== 'confirmed') f.push(`A2 a code never changes a synced answer -> ${J(pendingSynced)}`);
  // 'sealed' (signFieldTicket: a signed ticket's content cannot change)
  const sealedRec: OnlineRecordResult<{ id: string }> = { status: 'refused', code: 'sealed', message: 'hours' };
  const sealed = m.fromOnlineOutcome(sealedRec, OK, { ...ONLINE_WORDS, sealed: 'Not saved. A signed ticket cannot change.' });
  if (sealed.status !== 'refused' || sealed.reason !== 'Not saved. A signed ticket cannot change.') f.push(`A2 sealed with the site's sentence -> ${J(sealed)}`);
  const sealedNoWords = m.fromOnlineOutcome(sealedRec, OK, ONLINE_WORDS);
  if (sealedNoWords.status !== 'refused' || sealedNoWords.reason !== ONLINE_WORDS.refused) f.push(`A2 sealed without a sentence -> ${J(sealedNoWords)}`);
  const onJunk = m.fromOnlineOutcome('maybe' as never, OK, ONLINE_WORDS);
  if (onJunk.status !== 'refused') f.push(`A2 an unknown status -> ${J(onJunk)} (must be refused)`);
  // A3: nothing but synced ever plays success
  for (const legal of [false, true]) {
    for (const o of ['queued', 'failed', 'local'] as const) {
      const plan = commitReal.resolvePlan(m.fromWriteOutcome(o, OK, WORDS), { legal, resultIcon: 'check' });
      if (plan === 'success') f.push(`A3 resolvePlan(fromWriteOutcome('${o}'), legal ${legal}) === 'success'`);
    }
    for (const o of ['refused', 'unknown'] as const) {
      const plan = commitReal.resolvePlan(m.fromOnlineOutcome(o, OK, ONLINE_WORDS), { legal, resultIcon: 'check' });
      if (plan === 'success') f.push(`A3 resolvePlan(fromOnlineOutcome('${o}'), legal ${legal}) === 'success'`);
    }
  }
  if (commitReal.resolvePlan(m.fromWriteOutcome('synced', OK, WORDS), { resultIcon: 'check' }) !== 'success') f.push('A3 synced does not play success');
  return f;
}

/** A3 end to end: a legal site that (wrongly) hands runCommit a local or queued answer is refused with its own sentence. */
async function checkLegalRunCommit(m: AdaptersMod): Promise<Fails> {
  const f: Fails = [];
  const legalQueued = 'Not certified. Certifying needs a connection, so nothing was certified.';
  for (const o of ['local', 'queued'] as const) {
    const r = await commitReal.runCommit(async () => m.fromWriteOutcome(o, OK, WORDS), {
      idempotent: false, legal: true, copy: { legalQueued, refused: 'Not certified. Something went wrong on our side.', timeout: 'No answer yet. Check pay app #6 before trying again.' },
    });
    if (r.status !== 'refused' || r.reason !== legalQueued) f.push(`A3 legal + ${o} through runCommit -> ${JSON.stringify(r)}`);
  }
  return f;
}

/**
 * A6: the contract W2 was handed ("pass the result straight in"). This
 * signature is the proof: if any data-layer answer type drifts from what
 * fromOnlineOutcome accepts (a code outside OnlineRefusalCode, a status
 * outside OnlineOutcome), strict tsc fails on this file.
 */
function passStraightIn(
  m: AdaptersMod,
  a: {
    ticket: OnlineRecordResult<{ id: string }>;
    payApp: OnlineRecordResult<{ id: string }>;
    write: OnlineWriteResult<unknown>;
    status: OnlineWriteStatus;
    binder: CloseoutBinderSaveResult;
  },
): CommitResult[] {
  return [
    m.fromOnlineOutcome(a.ticket, OK, ONLINE_WORDS),
    m.fromOnlineOutcome(a.payApp, OK, ONLINE_WORDS),
    m.fromOnlineOutcome(a.write, OK, ONLINE_WORDS),
    m.fromOnlineOutcome(a.status, OK, ONLINE_WORDS),
    m.fromOnlineOutcome(a.binder, OK, ONLINE_WORDS),
  ];
}

function checkStraightIn(m: AdaptersMod): Fails {
  const f: Fails = [];
  const got = passStraightIn(m, {
    ticket: { status: 'refused', code: 'sealed', message: 'hours' },
    payApp: { status: 'synced', record: { id: 'pa-6' } },
    write: { status: 'refused', code: 'no_row' },
    status: 'unknown',
    binder: { status: 'refused', error: 'permission denied' },
  }).map((r) => r.status);
  const want = ['refused', 'confirmed', 'refused', 'timeout', 'refused'];
  if (JSON.stringify(got) !== JSON.stringify(want)) f.push(`A6 data-layer answers -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  return f;
}

function checkConstants(): Fails {
  const f: Fails = [];
  const consts: [string, string][] = [
    ['LOCAL_ONLY_TITLE', copyReal.LOCAL_ONLY_TITLE],
    ['LOCAL_ONLY_NEXT', copyReal.LOCAL_ONLY_NEXT],
    ['EARLIER_CHANGE_PENDING_REASON', copyReal.EARLIER_CHANGE_PENDING_REASON],
    ['EARLIER_CHANGE_UNSAVED_REASON', copyReal.EARLIER_CHANGE_UNSAVED_REASON],
  ];
  for (const [name, text] of consts) {
    if (typeof text !== 'string' || !text) { f.push(`${name} missing`); continue; }
    const lint = copyReal.lintMomentCopy(text);
    if (lint.length) f.push(`${name} "${text}": ${lint.join(', ')}`);
    if (DEV_WORDS.test(text)) f.push(`${name} "${text}" uses a developer word`);
  }
  if (copyReal.LOCAL_ONLY_TITLE !== 'Saved on this phone only') f.push(`LOCAL_ONLY_TITLE drifted: "${copyReal.LOCAL_ONLY_TITLE}"`);
  if (copyReal.LOCAL_ONLY_NEXT !== 'Sign in to send it to your account.') f.push(`LOCAL_ONLY_NEXT drifted: "${copyReal.LOCAL_ONLY_NEXT}"`);
  return f;
}

export default async function run(ctx: MomentsCtx): Promise<void> {
  const { ok } = ctx;
  const a = checkAdapters(adaptersReal);
  ok('A1-A3 fromWriteOutcome / fromOnlineOutcome: only synced confirms; local is "Saved on this phone only", never confirmed; nothing else plays success', a.length === 0, a.join('\n'));
  const l = await checkLegalRunCommit(adaptersReal);
  ok('A3 a legal site handed a local/queued answer is refused with its own legalQueued sentence (runCommit)', l.length === 0, l.join('\n'));
  const st = checkStraightIn(adaptersReal);
  ok('A6 every data-layer online answer (incl. signFieldTicket code \'sealed\') passes straight into fromOnlineOutcome', st.length === 0, st.join('\n'));
  const c = checkConstants();
  ok('A4 Step 0 copy constants lint clean and carry no developer words', c.length === 0, c.join('\n'));

  // A5 mutation proof: each planted defect must turn the check red.
  const dir = mkdtempSync(join(tmpdir(), 'moments-adapters-mut-'));
  const results: [string, boolean][] = [];
  try {
    const copyAbs = join(ctx.root, 'utils', 'moments', 'copy.ts');
    const src = readFileSync(join(ctx.root, 'utils/moments/commitAdapters.ts'), 'utf8')
      .replace("from '@/utils/moments/copy'", `from ${JSON.stringify(copyAbs)}`);
    const mutate = (from: string | RegExp, to: string, label: string): string => {
      const out = src.replace(from, to);
      if (out === src) throw new Error(`mutant ${label}: anchor not found`);
      return out;
    };
    const mutants: [string, string, string][] = [
      ['local -> confirmed', 'a5-local-confirmed', mutate(
        "return { status: 'queued', title: LOCAL_ONLY_TITLE, next: LOCAL_ONLY_NEXT };",
        "return confirmed(ok);", 'local')],
      ['queued -> confirmed', 'a5-queued-confirmed', mutate(
        /case 'queued':\s*return \{/,
        "case 'queued':\n      return confirmed(ok);\n      return {", 'queued')],
      ['unknown -> confirmed', 'a5-unknown-confirmed', mutate(
        "return { status: 'timeout', message: words.timeout };",
        'return confirmed(ok);', 'unknown')],
    ];
    for (const [, name, code] of mutants) writeFileSync(join(dir, `${name}.ts`), code);
    for (const [label, name] of mutants) {
      const mod = (await import(pathToFileURL(join(dir, `${name}.ts`)).href)) as AdaptersMod;
      results.push([label, checkAdapters(mod).length > 0]);
    }
  } catch (e) {
    results.push([`mutants built (${String(e)})`, false]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const [name, red] of results) ok(`A5 red on mutant: ${name}`, red, 'The check stayed green on a planted defect: it does not bite.');
}
