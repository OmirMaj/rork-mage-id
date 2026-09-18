// validate-invoice-send-integrity.ts — the two invoice-to-paid blockers.
//
// #3  A brand-new invoice whose email failed or was cancelled VANISHED from his
//     phone while the server kept it as 'sent'. The invoice screen's Send runs
//     addInvoice then (after awaits) updateInvoice in one callback;
//     updateInvoice mapped the render's `invoices`, which did not hold the new
//     invoice, so it queued no server write and saved the old list over state
//     and the device copy. He re-created it under the same number and dunning
//     chased both.
// #4  An invoice shared with "Send to client" read "Balance due —" with no Pay
//     button: the portal rendered the frozen RAW invoice (totalDue/amountPaid),
//     never its serializer's shape (total/balance/effectiveStatus/gated link).
//
// WHAT THIS EXECUTES
//   * The SHIPPED addInvoice / updateInvoice bodies, extracted from
//     contexts/ProjectContext.tsx and run against a fake server that, like
//     PostgREST, answers an UPDATE of a row it does not have with success and 0
//     rows — the render's `invoices` held stale on purpose.
//   * The invoice screen's send order (draft first, flip only after the email).
//   * buildPortalSnapshot on a sent invoice / change order / photo, frozen by the
//     same freezeForPortal sendToClientPortal calls.
//   * Self-mutation: each guard is re-run against a broken copy of the source
//     and must FAIL (the mutants are listed at the bottom).
//
// Run via: bun run scripts/validate-invoice-send-integrity.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Invoice, ChangeOrder, ProjectPhoto, Project, ClientPortalSettings } from '../types';
import { mergeInvoiceUpdate, invoiceUpdatePayload, invoiceInsertStillQueued, writeBehindQueuedInsert, sharedDraftIssuePatch } from '../utils/invoiceWrites';
import { freezeForPortal, MAX_PORTAL_SNAPSHOT_BYTES } from '../utils/portalFreeze';
import { buildPortalSnapshot } from '../utils/portalSnapshot';

declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
let passes = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { failures++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}

// ─── harness: the shipped addInvoice / updateInvoice ─────────────────────────
type Outcome = 'synced' | 'queued' | 'failed';
type Row = Record<string, unknown>;

function extractCallback(src: string, decl: string, depsTail: string): string {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error(`anchor not found: ${decl}`);
  const open = src.indexOf('useCallback(', start) + 'useCallback('.length;
  const end = src.indexOf(depsTail, open);
  if (end < 0) throw new Error(`deps anchor not found after ${decl}: ${depsTail}`);
  // `}, [deps]);` — keep the closing brace of the arrow body.
  return src.slice(open, end + 1);
}

interface World {
  server: Map<string, Row>;
  queue: { table: string; operation: string; data: Row }[];
  state: Invoice[];
  saved: Invoice[] | null;
  log: string[];
  settle: () => Promise<void>;
  /** The flush: replays the queue FIFO against the server, emptying it. */
  drain: () => void;
}

/**
 * Build add/update from `src` (ProjectContext source). `online` decides what a
 * direct write does; `insertDelayMs` models an insert still on the wire.
 */
function buildContext(src: string, opts: { online: boolean; insertDelayMs: number }) {
  // Mutable: a scenario can bring the network back between two writes.
  const addSrc = extractCallback(src, 'const addInvoice = useCallback(', '}, [saveInvoicesMutation, canSync, userId, initialPortalState]);');
  const updSrc = extractCallback(src, 'const updateInvoice = useCallback(', '}, [saveInvoicesMutation, canSync]);');
  const world: World = { server: new Map(), queue: [], state: [], saved: null, log: [], settle: async () => {}, drain: () => {} };
  const pending: Promise<unknown>[] = [];
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const direct = async (table: string, op: string, data: Row, delay: number): Promise<Outcome> => {
    if (!opts.online) { world.queue.push({ table, operation: op, data }); world.log.push(`queue ${op}`); return 'queued'; }
    await sleep(delay);
    const id = data.id as string;
    if (op === 'insert') { world.server.set(id, { ...data }); world.log.push('server insert'); }
    else if (op === 'update') {
      const row = world.server.get(id);
      // PostgREST: an UPDATE matching 0 rows is not an error.
      if (row) { world.server.set(id, { ...row, ...data }); world.log.push('server update'); }
      else world.log.push('server update (0 rows)');
    }
    return 'synced';
  };
  const supabaseWriteDetailed = (t: string, op: string, d: Row) => {
    const p = direct(t, op, d, op === 'insert' ? opts.insertDelayMs : 0); pending.push(p); return p;
  };
  const supabaseWrite = (t: string, op: string, d: Row) => {
    const p = direct(t, op, d, 0).then(o => o === 'synced'); pending.push(p); return p;
  };
  // The render-time list the old code read: ALWAYS stale (empty) here.
  const invoices: Invoice[] = [];
  const invoicesRef = { current: [] as Invoice[] };
  const invoiceInsertsRef = { current: new Map<string, Promise<Outcome>>() };
  const scope: Record<string, unknown> = {
    invoices, invoicesRef, invoiceInsertsRef,
    setInvoices: (l: Invoice[]) => { world.state = l; },
    saveInvoicesMutation: { mutate: (l: Invoice[]) => { world.saved = l; } },
    canSync: true, userId: 'u1',
    initialPortalState: () => ({ status: 'draft' }),
    track: () => {}, AnalyticsEvents: { INVOICE_CREATED: 'invoice_created' },
    supabaseWrite, supabaseWriteDetailed,
    getOfflineQueue: async () => world.queue,
    addToOfflineQueue: async (m: { table: string; operation: string; data: Row }) => { world.queue.push(m); world.log.push(`queue ${m.operation}`); },
    mergeInvoiceUpdate, invoiceUpdatePayload, invoiceInsertStillQueued,
    __qbo: () => Promise.resolve({ triggerQboSync: () => {} }),
  };
  const tx = new Bun.Transpiler({ loader: 'ts' });
  const compile = (fnSrc: string) => {
    const body = tx.transformSync(`const __f = ${fnSrc.replace(/import\('@\/utils\/qboSync'\)/g, '__qbo()')};`);
    return new Function(...Object.keys(scope), `${body}\nreturn __f;`)(...Object.values(scope));
  };
  const addInvoice = compile(addSrc) as (i: Invoice) => void;
  const updateInvoice = compile(updSrc) as (id: string, u: Partial<Invoice>) => void;
  // Round 4: the shipped portal-share writes and updateCommitment, run on the
  // same world. Compiled lazily — the #3 mutants only rewrite add/update.
  const commitmentsList = [{ id: 'c1', amount: 38000 }] as Row[];
  Object.assign(scope, {
    updateInvoice, writeBehindQueuedInsert, sharedDraftIssuePatch,
    changeOrderInsertsRef: { current: new Map() },
    projects: [],
    tableForKind: { invoice: 'invoices' }, itemTypeLabel: { invoice: 'Invoice' },
    findItemByKindAndId: (kind: string, id: string) => (kind === 'invoice' ? invoicesRef.current.find(i => i.id === id) : undefined),
    updateItemPortalState: (_k: string, id: string, next: unknown) => {
      invoicesRef.current = invoicesRef.current.map(i => (i.id === id ? { ...i, portalState: next } as Invoice : i));
    },
    applyPortalStates: (list: { itemId: string; next: unknown }[]) => {
      for (const u of list) invoicesRef.current = invoicesRef.current.map(i => (i.id === u.itemId ? { ...i, portalState: u.next } as Invoice : i));
    },
    captureSnapshot: (_k: string, item: unknown) => JSON.stringify(item),
    writePortalMessage: async () => {},
    commitments: commitmentsList,
    setCommitments: () => {}, saveCommitmentsMutation: { mutate: () => {} },
    commitmentToRow: (c: Row) => ({ id: c.id, amount: c.amount, updated_at: c.updatedAt }),
  });
  const portal = () => {
    const helper = compile(extractCallback(src, 'const updateBehindQueuedInsert = useCallback(', '}, []);'));
    scope.updateBehindQueuedInsert = helper;
    return {
      send: compile(extractCallback(src, 'const sendToClientPortal = useCallback(',
        '}, [canSync, userId, projects, findItemByKindAndId, updateItemPortalState, writePortalMessage, updateBehindQueuedInsert, updateInvoice]);')) as
        (a: { kind: string; itemId: string; projectId: string }) => Promise<void>,
      batch: compile(extractCallback(src, 'const batchSendToClientPortal = useCallback(',
        '}, [canSync, userId, projects, findItemByKindAndId, applyPortalStates, writePortalMessage, updateBehindQueuedInsert, updateInvoice]);')) as
        (a: { items: { kind: string; itemId: string }[]; projectId: string }) => Promise<{ sent: number }>,
      updateCommitment: compile(extractCallback(src, 'const updateCommitment = useCallback(',
        '}, [commitments, saveCommitmentsMutation, canSync, userId, commitmentToRow, updateBehindQueuedInsert]);')) as
        (id: string, u: Row) => void,
    };
  };
  world.settle = async () => {
    for (let i = 0; i < 20; i++) { await Promise.allSettled([...pending]); await sleep(5); }
  };
  world.drain = () => {
    for (const m of world.queue.splice(0)) {
      const id = m.data.id as string;
      if (m.operation === 'insert') { world.server.set(id, { ...m.data }); world.log.push('drain insert'); }
      else if (m.operation === 'update') {
        const row = world.server.get(id);
        if (row) { world.server.set(id, { ...row, ...m.data }); world.log.push('drain update'); }
        else world.log.push('drain update (0 rows)');
      }
    }
  };
  return { world, addInvoice, updateInvoice, portal };
}

const draft = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-new', number: 7, projectId: 'p1', type: 'full', issueDate: '2026-09-18T15:00:00.000Z',
  dueDate: '2026-10-18T15:00:00.000Z', paymentTerms: 'net_30', notes: '', lineItems: [],
  subtotal: 5000, taxRate: 0, taxAmount: 0, totalDue: 5000, amountPaid: 0, status: 'draft',
  payments: [], createdAt: '2026-09-18T15:00:00.000Z', updatedAt: '2026-09-18T15:00:00.000Z', ...over,
} as Invoice);

async function runSendScenarios(src: string, prefix = ''): Promise<boolean[]> {
  const results: boolean[] = [];
  const r = (label: string, cond: boolean, detail?: string) => {
    results.push(cond);
    if (!prefix) check(label, cond, detail);
  };

  // A. The blocker: new draft, pay link minted, email FAILS.
  {
    const { world, addInvoice, updateInvoice } = buildContext(src, { online: true, insertDelayMs: 30 });
    addInvoice(draft());
    updateInvoice('inv-new', { payLinkUrl: 'https://buy.stripe.com/x', payLinkId: 'plink_1', payLinkAmount: 5000 });
    await world.settle();
    const local = world.state.find(i => i.id === 'inv-new');
    r('A. email failed: the new invoice is still on his list (state)', !!local, JSON.stringify(world.state.map(i => i.id)));
    r('A. …and in the device copy', !!world.saved?.some(i => i.id === 'inv-new'));
    r('A. …as a draft, with the minted link kept locally', local?.status === 'draft' && local?.payLinkUrl === 'https://buy.stripe.com/x');
    r('A. the server row exists and is a DRAFT (nothing for dunning or A/R to chase)',
      world.server.get('inv-new')?.status === 'draft', JSON.stringify(world.server.get('inv-new')));
    r('A. a draft is not queued for QuickBooks', world.server.get('inv-new')?.qbo_sync_status === null);
  }
  // B. Email succeeds: flip to sent right after the add, insert still on the wire.
  {
    const { world, addInvoice, updateInvoice } = buildContext(src, { online: true, insertDelayMs: 40 });
    addInvoice(draft());
    updateInvoice('inv-new', { status: 'sent', dueDate: '2026-10-19T15:00:00.000Z' });
    await world.settle();
    const row = world.server.get('inv-new');
    r('B. sent: the server row reads sent even though the flip was issued while the insert was in flight',
      row?.status === 'sent', `${JSON.stringify(row)} log=${world.log.join(' > ')}`);
    r('B. …with the due date counted from the send', row?.due_date === '2026-10-19T15:00:00.000Z');
    r('B. …and it is now QuickBooks-pending', row?.qbo_sync_status === 'pending');
    r('B. the update landed AFTER the insert (no 0-row update)', !world.log.includes('server update (0 rows)'), world.log.join(' > '));
    r('B. local state reads sent', world.state.find(i => i.id === 'inv-new')?.status === 'sent');
  }
  // C. Offline: insert queued → the flip queues BEHIND it (one record, in order).
  //    Signal comes back between the two: a direct UPDATE now would hit a row
  //    the server does not have yet (0 rows) while the insert still waits.
  {
    const net = { online: false, insertDelayMs: 0 };
    const { world, addInvoice, updateInvoice } = buildContext(src, net);
    addInvoice(draft());
    net.online = true;
    updateInvoice('inv-new', { status: 'sent', dueDate: '2026-10-19T15:00:00.000Z' });
    await world.settle();
    const ops = world.queue.filter(q => (q.data.id as string) === 'inv-new').map(q => `${q.operation}:${q.data.status ?? ''}`);
    r('C. insert queued offline: the sent flip queues behind it, in order', ops.join(',') === 'insert:draft,update:sent', `${ops.join(',')} log=${world.log.join(' > ')}`);
    r('C. …and never goes direct into a row the server does not have', !world.log.includes('server update (0 rows)'));
  }
  // C′. The integration blocker: the queued insert has already REPORTED (its
  //     promise is gone from invoiceInsertsRef) when the flip is issued — the
  //     real ordering, since the flip waits on mintPayLinkFor + sendEmail. No
  //     signal → Send → email fails; he walks outside → Send again → it goes.
  //     The queue has not drained (it drains on launch / foreground / timer).
  for (const variant of ['first tap, flip after the insert reported', 'second tap on the existing draft'] as const) {
    const net = { online: false, insertDelayMs: 0 };
    const { world, addInvoice, updateInvoice } = buildContext(src, net);
    addInvoice(draft());
    await world.settle();
    net.online = true;
    updateInvoice('inv-new', variant === 'second tap on the existing draft'
      ? { lineItems: [], paymentTerms: 'net_30', notes: 'x', subtotal: 5000, taxRate: 0, taxAmount: 0, totalDue: 5000, dueDate: '2026-10-19T15:00:00.000Z', status: 'sent' }
      : { status: 'sent', dueDate: '2026-10-19T15:00:00.000Z' });
    await world.settle();
    const ops = world.queue.filter(q => (q.data.id as string) === 'inv-new').map(q => `${q.operation}:${q.data.status ?? ''}`);
    r(`C′ (${variant}): the flip queues behind the still-queued insert`, ops.join(',') === 'insert:draft,update:sent', `${ops.join(',')} log=${world.log.join(' > ')}`);
    r(`C′ (${variant}): no direct 0-row update reported as success`, !world.log.includes('server update (0 rows)'), world.log.join(' > '));
    world.drain();
    const row = world.server.get('inv-new');
    r(`C′ (${variant}): after the drain the server row is SENT and QuickBooks-pending`,
      row?.status === 'sent' && row?.qbo_sync_status === 'pending', JSON.stringify(row));
  }
  // C″. Once the queue has drained, a later edit goes direct again (the queue
  //     check never strands an ordinary update).
  {
    const net = { online: false, insertDelayMs: 0 };
    const { world, addInvoice, updateInvoice } = buildContext(src, net);
    addInvoice(draft());
    await world.settle();
    net.online = true;
    world.drain();
    updateInvoice('inv-new', { status: 'sent', dueDate: '2026-10-19T15:00:00.000Z' });
    await world.settle();
    r('C″. after the drain the flip goes direct and lands', world.server.get('inv-new')?.status === 'sent' && world.queue.length === 0,
      `${JSON.stringify(world.server.get('inv-new'))} log=${world.log.join(' > ')}`);
  }
  // E. Two creates in one tick (a batch) — the second must not drop the first.
  {
    const { world, addInvoice } = buildContext(src, { online: true, insertDelayMs: 0 });
    addInvoice(draft({ id: 'inv-a', number: 1 }));
    addInvoice(draft({ id: 'inv-b', number: 2 }));
    await world.settle();
    r('E. two adds in one tick keep both invoices', ['inv-a', 'inv-b'].every(id => world.state.some(i => i.id === id)),
      JSON.stringify(world.state.map(i => i.id)));
  }
  // D. A row that is not in memory still gets its (scoped) write.
  {
    const { world, updateInvoice } = buildContext(src, { online: true, insertDelayMs: 0 });
    world.server.set('inv-remote', { id: 'inv-remote', status: 'sent', amount_paid: 100 });
    updateInvoice('inv-remote', { status: 'draft' });
    await world.settle();
    const row = world.server.get('inv-remote');
    r('D. an id missing from memory still reaches the server', row?.status === 'draft', JSON.stringify(row));
    r('D. …scoped: columns it did not name are untouched', row?.amount_paid === 100);
    r('D. …and nothing is saved over the device copy', world.saved === null);
  }
  return results;
}

// ─── round 4: sharing to the portal, and commitment edits ───────────────────
async function runPortalScenarios(src: string, prefix = ''): Promise<boolean[]> {
  const results: boolean[] = [];
  const r = (label: string, cond: boolean, detail?: string) => {
    results.push(cond);
    if (!prefix) check(label, cond, detail);
  };
  const ps = (row: Row | undefined) => (row?.portal_state as { status?: string } | undefined)?.status;
  // P1. Made offline, shared once signal returns but BEFORE the drain: the
  //     portal write and the issue flip must queue behind the insert.
  {
    const net = { online: false, insertDelayMs: 0 };
    const { world, addInvoice, portal } = buildContext(src, net);
    const P = portal();
    addInvoice(draft());
    await world.settle();
    net.online = true;
    await P.send({ kind: 'invoice', itemId: 'inv-new', projectId: 'p1' });
    await world.settle();
    world.drain();
    const row = world.server.get('inv-new');
    r('P1. shared before the drain: the server row ends shared (portal_state sent), not reverted to the queued draft',
      ps(row) === 'sent', `${JSON.stringify(row?.portal_state)} log=${world.log.join(' > ')}`);
    r('P1. …and no write hit the server as a 0-row "success"', !world.log.includes('server update (0 rows)'), world.log.join(' > '));
  }
  // P2. Sharing a DRAFT invoice issues it: sent, due counted from today,
  //     QuickBooks-pending — never a payable draft on the server.
  {
    const { world, addInvoice, portal } = buildContext(src, { online: true, insertDelayMs: 0 });
    const P = portal();
    addInvoice(draft({ dueDate: '2026-01-01T00:00:00.000Z' }));
    await world.settle();
    const before = Date.now();
    await P.send({ kind: 'invoice', itemId: 'inv-new', projectId: 'p1' });
    await world.settle();
    const row = world.server.get('inv-new');
    const due = Date.parse(String(row?.due_date));
    r('P2. sharing a draft flips it to sent on the server', row?.status === 'sent' && ps(row) === 'sent', JSON.stringify(row));
    r('P2. …with the due date counted from today on its terms (net 30), as Mark sent does',
      due - before > 29 * 86_400_000 && due - before < 31 * 86_400_000, String(row?.due_date));
    r('P2. …and marked pending for QuickBooks', row?.qbo_sync_status === 'pending');
  }
  // P3. The batch share does the same, for every invoice in it.
  {
    const net = { online: false, insertDelayMs: 0 };
    const { world, addInvoice, portal } = buildContext(src, net);
    const P = portal();
    addInvoice(draft({ id: 'inv-a', number: 1 }));
    addInvoice(draft({ id: 'inv-b', number: 2 }));
    await world.settle();
    net.online = true;
    const out = await P.batch({ items: [{ kind: 'invoice', itemId: 'inv-a' }, { kind: 'invoice', itemId: 'inv-b' }], projectId: 'p1' });
    await world.settle();
    world.drain();
    const a = world.server.get('inv-a'), b = world.server.get('inv-b');
    r('P3. batch share before the drain: both invoices end shared AND sent on the server',
      out.sent === 2 && ps(a) === 'sent' && ps(b) === 'sent' && a?.status === 'sent' && b?.status === 'sent',
      JSON.stringify({ a, b }));
  }
  // P4. Recall of a record whose insert is still queued is not lost either.
  {
    const net = { online: false, insertDelayMs: 0 };
    const { world, addInvoice } = buildContext(src, net);
    addInvoice(draft({ status: 'sent' }));
    await world.settle();
    net.online = true;
    // recallFromClientPortal is the same write path; exercised via its source.
    r('P4. recall orders its write behind a queued insert too',
      /status: 'recalled',[\s\S]{0,400}void updateBehindQueuedInsert\(tableForKind\[kind\], \{/.test(src));
    void world;
  }
  // C1. A commitment awarded offline (insert queued) then edited in Job
  //     Costing before the drain keeps the edit.
  {
    const net = { online: true, insertDelayMs: 0 };
    const { world, portal } = buildContext(src, net);
    const P = portal();
    world.queue.push({ table: 'commitments', operation: 'insert', data: { id: 'c1', amount: 38000 } });
    P.updateCommitment('c1', { amount: 41200 });
    await world.settle();
    world.drain();
    r('C1. a commitment edited before its queued insert drains keeps the edit ($41,200, not $38,000)',
      world.server.get('c1')?.amount === 41200, `${JSON.stringify(world.server.get('c1'))} log=${world.log.join(' > ')}`);
  }
  return results;
}

async function main() {
  const ctxSrc = read('contexts/ProjectContext.tsx');
  const screen = read('app/invoice.tsx');

  console.log('\n#3 — a new invoice survives a failed send (shipped addInvoice / updateInvoice, stale render list)');
  await runSendScenarios(ctxSrc);

  console.log('\n#3 — the invoice screen sends a draft and flips it only after the email');
  const sendStart = screen.indexOf('const handleConfirmSend = useCallback(');
  const sendEnd = screen.indexOf('const handleSendPDF = useCallback(', sendStart);
  const send = sendStart >= 0 && sendEnd > sendStart ? screen.slice(sendStart, sendEnd) : '';
  const guardScreen = (s: string) => {
    const created = /workingInvoice = buildNewInvoice\('draft'\);\s*addInvoice\(workingInvoice\);/.test(s);
    const failAt = s.indexOf('if (!result.success) {');
    const flipAt = s.indexOf("updateInvoice(workingInvoice.id, { status: 'sent', dueDate });");
    const noRollback = !/updateInvoice\(workingInvoice\.id, \{ status: 'draft' \}\)/.test(s);
    const retargets = /if \(createdNew\) router\.setParams\(\{ invoiceId: workingInvoice\.id \}\);/.test(s);
    return { created, flipAfterFail: failAt >= 0 && flipAt > failAt, noRollback, retargets };
  };
  const g = guardScreen(send);
  check('a new invoice is created as a DRAFT before the email', g.created);
  check('it is flipped to sent (with the send-day due date) only after the success check', g.flipAfterFail);
  check('no rollback write remains to miss the server', g.noRollback);
  check('a failed / cancelled send points the editor at the draft, so Send again cannot make a duplicate', g.retargets);

  console.log('\n#3 — the context reads the latest list everywhere an invoice is written');
  const addBody = extractCallback(ctxSrc, 'const addInvoice = useCallback(', '}, [saveInvoicesMutation, canSync, userId, initialPortalState]);');
  const updBody = extractCallback(ctxSrc, 'const updateInvoice = useCallback(', '}, [saveInvoicesMutation, canSync]);');
  check('addInvoice / updateInvoice never read the render closure `invoices`',
    !/\binvoices\.(map|find|filter)\(/.test(addBody + updBody) && !/\.\.\.invoices\b/.test(addBody));
  check('the portal send reads and moves the ref too',
    /case 'invoice':\s*\{ const n = setNext\(invoicesRef\.current, m\); invoicesRef\.current = n;/.test(ctxSrc)
    && /case 'invoice':\s*return invoicesRef\.current\.find/.test(ctxSrc));

  console.log('\n#4 — a sent invoice reaches the portal in the portal shape, with live money');
  const project = { id: 'p1', name: 'Maple', status: 'in_progress' } as unknown as Project;
  const portal = {
    portalId: 'portal-1', enabled: true, showInvoices: true, showChangeOrders: true, showPhotos: true,
    showSchedule: false, showBudgetSummary: false, showDailyReports: false, showPunchList: false, showRFIs: false, showDocuments: false,
  } as unknown as ClientPortalSettings;
  const sentInv = draft({
    id: 'inv-9', number: 9, status: 'sent', totalDue: 10_000, subtotal: 10_000,
    lineItems: [{ id: 'l1', name: 'Framing', description: '', quantity: 1, unit: 'ls', unitPrice: 10_000, total: 10_000 }],
    payLinkUrl: 'https://buy.stripe.com/full', payLinkId: 'pl_full', payLinkAmount: 10_000,
  });
  const frozen = freezeForPortal('invoice', { ...sentInv, portalState: { status: 'sent', lastSentSnapshot: '{"old":"copy"}' } });
  check('the frozen copy leaves out the previous snapshot (no nesting on re-send)', !!frozen && !frozen.includes('lastSentSnapshot'));
  const sentState = { status: 'sent' as const, sentAt: '2026-09-18T15:00:00.000Z', sentVersion: 1, lastSentSnapshot: frozen! };
  const snapA = buildPortalSnapshot({ project, portal, invoices: [{ ...sentInv, portalState: sentState }] });
  const pi = (snapA.sections.invoices ?? [])[0] as Record<string, unknown> | undefined;
  check('the portal row has a numeric total and balance', typeof pi?.total === 'number' && typeof pi?.balance === 'number', JSON.stringify(pi));
  check('…balance $10,000.00, effectiveStatus set', pi?.balance === 10_000 && typeof pi?.effectiveStatus === 'string');
  check('…and the Pay button (link minted for exactly the balance)', pi?.payLinkUrl === 'https://buy.stripe.com/full');
  check('…with no raw domain fields leaking (totalDue / payLinkAmount-less shape)', pi != null && !('totalDue' in pi));

  // After send: he edits the line items, and the client pays $4,000.
  const live = {
    ...sentInv, portalState: sentState, amountPaid: 4_000,
    payments: [{ id: 'pay1', date: '2026-09-20', amount: 4_000, method: 'check' }],
    lineItems: [{ id: 'l1', name: 'EDITED AFTER SEND', description: '', quantity: 1, unit: 'ls', unitPrice: 12_000, total: 12_000 }],
  } as unknown as Invoice;
  const snapB = buildPortalSnapshot({ project, portal, invoices: [live] });
  const pb = (snapB.sections.invoices ?? [])[0] as Record<string, unknown> | undefined;
  check('a payment after send shows: balance $6,000.00', pb?.balance === 6_000, JSON.stringify(pb));
  check('…and the $10,000 link is gated off (charges a figure no longer owed)', pb?.payLinkUrl === undefined);
  check('an edit after send does NOT reach the client (frozen line items)',
    JSON.stringify(pb?.lineItems ?? []).includes('Framing') && !JSON.stringify(pb).includes('EDITED AFTER SEND'));
  const relinked = { ...live, payLinkUrl: 'https://buy.stripe.com/six', payLinkId: 'pl_6', payLinkAmount: 6_000 } as Invoice;
  const pc = (buildPortalSnapshot({ project, portal, invoices: [relinked] }).sections.invoices ?? [])[0] as Record<string, unknown> | undefined;
  check('a link re-minted for the live balance shows the Pay button again', pc?.payLinkUrl === 'https://buy.stripe.com/six');

  console.log('\n#4 — the other sendable kinds go through their serializers too');
  const co = {
    id: 'co1', projectId: 'p1', number: 3, description: 'Add outlet', reason: 'Owner request', changeAmount: 450,
    newContractTotal: 10_450, status: 'submitted', date: '2026-09-10', lineItems: [],
    createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
  } as unknown as ChangeOrder;
  const coState = { status: 'sent' as const, sentAt: '2026-09-10T00:00:00Z', lastSentSnapshot: freezeForPortal('change_order', co)! };
  const snapCO = buildPortalSnapshot({ project, portal, changeOrders: [{ ...co, status: 'approved', portalState: coState } as ChangeOrder] });
  const pco = (snapCO.sections.changeOrders ?? [])[0] as Record<string, unknown> | undefined;
  check('a sent change order carries dateSubmitted (the raw one had only `date`)', pco?.dateSubmitted === '2026-09-10', JSON.stringify(pco));
  check('…and its LIVE approval status', pco?.status === 'approved');
  const photo = { id: 'ph1', projectId: 'p1', uri: 'https://cdn/x.jpg', tag: 'Kitchen', timestamp: '2026-09-11T00:00:00Z' } as unknown as ProjectPhoto;
  const phState = { status: 'sent' as const, lastSentSnapshot: freezeForPortal('photo', photo)! };
  const snapPh = buildPortalSnapshot({ project, portal, photos: [{ ...photo, portalState: phState } as ProjectPhoto] });
  check('a sent photo still has its url (read live, never frozen)', (snapPh.sections.photos ?? [])[0]?.url === 'https://cdn/x.jpg');
  check('a copy over the cap is refused (null), never truncated into unparseable JSON',
    freezeForPortal('invoice', { ...sentInv, notes: 'x'.repeat(MAX_PORTAL_SNAPSHOT_BYTES + 1) }) === null);
  check('sendToClientPortal refuses a too-large record with a reason',
    /const frozen = freezeForPortal\(kind, item\);\s*if \(frozen == null\) \{\s*throw new Error\(/.test(ctxSrc)
    && /lastSentSnapshot: captureSnapshot\(kind, item\)/.test(ctxSrc) && !/raw\.slice\(0, MAX_SNAPSHOT_BYTES\)/.test(ctxSrc));

  console.log('\nintegration review — the portal due date moves with the status; big documents still send');
  // Sent to the portal as a draft on Sep 1 (net 15), emailed Oct 1: live status
  // 'sent', server due date Oct 16. The frozen copy still says Sep 16.
  {
    const frozenDraft = freezeForPortal('invoice', { ...sentInv, status: 'draft', dueDate: '2026-09-16' });
    const st = { status: 'sent' as const, sentAt: '2026-09-01T15:00:00.000Z', sentVersion: 1, lastSentSnapshot: frozenDraft! };
    const liveInv = { ...sentInv, status: 'sent', dueDate: '2099-10-16', portalState: st } as unknown as Invoice;
    const pd = (buildPortalSnapshot({ project, portal, invoices: [liveInv] }).sections.invoices ?? [])[0] as Record<string, unknown> | undefined;
    check('the portal shows the LIVE due date of a sent invoice', pd?.dueDate === '2099-10-16', JSON.stringify(pd?.dueDate));
    check('…so it is not "overdue" off a frozen date', pd?.effectiveStatus !== 'overdue', String(pd?.effectiveStatus));
  }
  {
    const manyLines = Array.from({ length: 150 }, (_, i) => ({ id: `l${i}`, name: `Line ${i} ${'d'.repeat(120)}`, description: 'x'.repeat(120), quantity: 1, unit: 'ls', unitPrice: 100, total: 100 }));
    const bigInv = { ...sentInv, lineItems: manyLines, payments: Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, date: '2026-09-20', amount: 1, method: 'check' })) };
    const f = freezeForPortal('invoice', bigInv);
    check('a 150-line invoice still freezes (lines capped to what the portal shows, payments left live)', !!f
      && (JSON.parse(f!).lineItems as unknown[]).length === 10 && !('payments' in JSON.parse(f!)));
    const aiaLines = Array.from({ length: 150 }, (_, i) => ({ id: `a${i}`, itemNo: String(i + 1), description: 'Division scope '.repeat(8), scheduledValue: 1000, fromPreviousApp: 100, thisPeriod: 50, materialsPresentlyStored: 0, retainagePercent: 10, linkedTaskId: 'task-' + i }));
    const fa = freezeForPortal('aia_pay_app', { id: 'aia1', lines: aiaLines, totals: { currentPaymentDue: 1 } });
    check('a 150-line G702/G703 still freezes, EVERY line kept (it cannot be split)', !!fa && (JSON.parse(fa!).lines as unknown[]).length === 150);
    check('…each line carrying the fields the serializer prints', !!fa && JSON.parse(fa!).lines[149].scheduledValue === 1000 && !('linkedTaskId' in JSON.parse(fa!).lines[0]));
    check('the refusal copy names a fix that exists (no "split it")', !/Split it into smaller records/.test(ctxSrc) && /Shorten its notes or line descriptions/.test(ctxSrc));
  }

  console.log('\nround 4 — portal shares and commitment edits order behind a queued insert; a shared draft is issued');
  await runPortalScenarios(ctxSrc);

  // ─── self-mutation: every guard above must catch its bug ─────────────────
  console.log('\nmutants (each must be caught)');
  const mutants: { name: string; src: string }[] = [
    { name: 'updateInvoice reads the render closure again',
      src: ctxSrc.replace('mergeInvoiceUpdate(invoicesRef.current, id, updates, now)', 'mergeInvoiceUpdate(invoices, id, updates, now)') },
    { name: 'addInvoice builds from the render closure again',
      src: ctxSrc.replace('const updated = [finalInvoice, ...invoicesRef.current];', 'const updated = [finalInvoice, ...invoices];') },
    { name: 'the update no longer waits for the insert',
      src: ctxSrc.replace('const pendingInsert = invoiceInsertsRef.current.get(id);', 'const pendingInsert = undefined as Promise<WriteOutcome> | undefined;') },
    { name: 'a missing row skips its server write again',
      src: ctxSrc.replace('const inv: Partial<Invoice> = merged ?? { ...updates, id };', 'if (!merged) return;\n      const inv: Partial<Invoice> = merged;') },
    { name: 'a new draft is queued for QuickBooks again',
      src: ctxSrc.replace("qbo_sync_status: isDraft ? null : 'pending'", "qbo_sync_status: 'pending'") },
    { name: 'a queued insert no longer holds the update behind it',
      src: ctxSrc.replace('if (!stillQueued) return send();', 'return send();') },
    // The real round-2 code: the queue was only consulted while the insert
    // promise was still in invoiceInsertsRef — C′ must catch it.
    { name: 'round-2 shape: the queue is checked only while the insert promise is pending',
      src: ctxSrc.replace(
        /const invoiceWrite: Promise<boolean> = \(async \(\) => \{[\s\S]*?\n      \}\)\(\);/,
        `const invoiceWrite: Promise<boolean> = !pendingInsert ? send() : pendingInsert.then(async (outcome) => {
        if (outcome !== 'queued') return send();
        let stillQueued = false;
        try { stillQueued = invoiceInsertStillQueued(await getOfflineQueue(), id); } catch { stillQueued = true; }
        if (!stillQueued) return send();
        try { await addToOfflineQueue({ table: 'invoices', operation: 'update', data: payload }); } catch { /* reported by addToOfflineQueue */ }
        return false;
      });`) },
  ];
  for (const m of mutants) {
    if (m.src === ctxSrc) { check(`mutant applies: ${m.name}`, false, 'anchor drifted — update the mutant'); continue; }
    const res = await runSendScenarios(m.src, 'mutant');
    check(`caught: ${m.name}`, res.some(x => !x));
  }
  // Round 4 mutants: the REAL pre-fix code for each write.
  const portalMutants: { name: string; src: string }[] = [
    { name: 'sendToClientPortal writes portal_state directly again (the old code)',
      src: ctxSrc.replace(/(const sendToClientPortal[\s\S]*?)void updateBehindQueuedInsert\(tableForKind\[kind\], \{/, "$1void supabaseWrite(tableForKind[kind], 'update', {") },
    { name: 'sharing a draft no longer issues it',
      src: ctxSrc.replace('    if (issue) updateInvoice(itemId, issue);\n', '') },
    { name: 'batch share writes portal_state directly again (the old code)',
      src: ctxSrc.replace(/(const batchSendToClientPortal[\s\S]*?)void updateBehindQueuedInsert\(tableForKind\[kind\], \{/, "$1void supabaseWrite(tableForKind[kind], 'update', {") },
    { name: 'batch share no longer issues a draft',
      src: ctxSrc.replace('      if (issue) updateInvoice(itemId, issue);\n', '') },
    { name: 'updateCommitment writes directly again (the old code)',
      src: ctxSrc.replace("void updateBehindQueuedInsert('commitments', commitmentToRow(next));", "void supabaseWrite('commitments', 'update', commitmentToRow(next));") },
    { name: 'recall writes directly again (the old code)',
      src: ctxSrc.replace(/(status: 'recalled',[\s\S]*?)void updateBehindQueuedInsert\(tableForKind\[kind\], \{/, "$1void supabaseWrite(tableForKind[kind], 'update', {") },
  ];
  for (const m of portalMutants) {
    if (m.src === ctxSrc) { check(`mutant applies: ${m.name}`, false, 'anchor drifted — update the mutant'); continue; }
    const res = await runPortalScenarios(m.src, 'mutant');
    check(`caught: ${m.name}`, res.some(x => !x));
  }
  const screenMutants: { name: string; src: string }[] = [
    { name: 'the screen inserts the new invoice as sent again', src: send.replace("buildNewInvoice('draft')", "buildNewInvoice('sent')") },
    { name: 'the draft rollback comes back instead of the flip',
      src: send.replace("updateInvoice(workingInvoice.id, { status: 'sent', dueDate });", '').replace('if (!result.success) {', "if (!result.success) {\n      if (createdNew) updateInvoice(workingInvoice.id, { status: 'draft' });") },
    { name: 'the retarget after a failed send is dropped', src: send.replace('if (createdNew) router.setParams({ invoiceId: workingInvoice.id });', '') },
  ];
  for (const m of screenMutants) {
    const gm = guardScreen(m.src);
    check(`caught: ${m.name}`, m.src !== send && !(gm.created && gm.flipAfterFail && gm.noRollback && gm.retargets));
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
