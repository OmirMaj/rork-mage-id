// scripts/validate-w6a-entry-mageai.ts — the global mic's arrays, end to end
// through the REAL utils/mageAI.ts and utils/voiceActionParser.ts (audit wave
// 6, lane A2, E8).
//
// THE BUG. parseVoiceAction's hint gives fieldScheduleUpdates / fieldTimeEntries
// / lineItems / invoiceLineItems as `[]`. The relay builds Gemini's response
// schema from the hint, and an empty array becomes `items: {type: "string"}` —
// so constrained decoding can only answer ["drywall 80%"], Zod refuses the
// strings, the per-field salvage empties the array, and "log 6 hours framing,
// drywall is 80 percent" filed no hours and no progress. Every time.
//
// THIS PROVES, with the network stubbed at fetch():
//   1. the payload mageAI sends carries an object element for each of those
//      arrays (filled from the Zod schema), under BOTH the committed relay's
//      inferSchema and lane A's supabase/functions/_shared/inferSchema.ts;
//   2. a model held to that schema (simulated strictly: declared keys only,
//      required keys forced, types coerced) comes back through the real Zod
//      parse with the hours, the progress and the line item intact;
//   3. a hint with nothing to fill is sent untouched (same object), and a
//      string array's `[]` is left alone (it already infers as strings).
//
// Run via: bun run scripts/validate-w6a-entry-mageai.ts

const BUN_TEST = 'bun:test';
const { mock } = (await import(BUN_TEST)) as {
  mock: { module: (specifier: string, factory: () => Record<string, unknown>) => void };
};

const store = new Map<string, string>();
const asyncStorage = {
  getItem: async (k: string) => store.get(k) ?? null,
  setItem: async (k: string, v: string) => { store.set(k, v); },
  removeItem: async (k: string) => { store.delete(k); },
};
mock.module('@react-native-async-storage/async-storage', () => ({ default: asyncStorage, ...asyncStorage }));
mock.module('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'smoke-jwt' } } }) } },
  SUPABASE_URL: 'https://smoke.supabase.test',
  SUPABASE_ANON_KEY: 'smoke-anon',
}));

type Schema = { type: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema };

// The COMMITTED relay's rule (supabase/functions/ai/index.ts:64-81 at 6065b326)
// — what production runs until the wave-6 relay deploys.
function oldInferSchema(val: unknown): Schema {
  if (val === null || val === undefined) return { type: 'string' };
  if (Array.isArray(val)) return { type: 'array', items: val.length > 0 ? oldInferSchema(val[0]) : { type: 'string' } };
  if (typeof val === 'object') {
    const properties: Record<string, Schema> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) { properties[k] = oldInferSchema(v); required.push(k); }
    return { type: 'object', properties, required };
  }
  if (typeof val === 'number') return { type: 'number' };
  if (typeof val === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}
let newInferSchema: ((v: unknown) => Schema) | null = null;
try {
  newInferSchema = ((await import('../supabase/functions/_shared/inferSchema')) as unknown as { inferSchema: (v: unknown) => Schema }).inferSchema;
} catch { newInferSchema = null; }

/** A model under constrained decoding: it can only emit what the schema
 *  declares, always emits the required keys, and each value takes the
 *  declared type. `intent` is what the contractor actually said. */
function decode(schema: Schema, intent: unknown): unknown {
  if (schema.type === 'array') {
    const list = Array.isArray(intent) ? intent : [];
    return list.map((el) => (schema.items?.type === 'string' && el && typeof el === 'object'
      // Held to strings, the model writes the entry as a phrase.
      ? Object.values(el as Record<string, unknown>).filter((v) => v !== '' && v != null).join(' ')
      : decode(schema.items ?? { type: 'string' }, el)));
  }
  if (schema.type === 'object') {
    const src = (intent && typeof intent === 'object' ? intent : {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(schema.properties ?? {})) {
      if (k in src) out[k] = decode(s, src[k]);
      else if ((schema.required ?? []).includes(k)) out[k] = s.type === 'number' ? 0 : s.type === 'boolean' ? false : s.type === 'array' ? [] : s.type === 'object' ? decode(s, {}) : '';
    }
    return out;
  }
  if (schema.type === 'number') return Number(intent) || 0;
  if (schema.type === 'boolean') return !!intent;
  return intent == null ? '' : typeof intent === 'string' ? intent : String(intent);
}

// What the contractor said: "log 6 hours framing, drywall is 80 percent, 40
// sheets of drywall delivered" — as the model would like to answer it.
const INTENT = {
  kind: 'field_update',
  reasoning: 'Sounds like a daily log.',
  fieldWorkPerformed: 'Framing and drywall',
  fieldTimeEntries: [{ trade: 'Framing', hours: 6, notes: '' }],
  fieldScheduleUpdates: [{ taskName: 'Drywall hang', progressPercent: 80 }],
  fieldMaterials: ['40 sheets drywall'],
  lineItems: [{ name: 'Extra blocking', description: 'Blocking for grab bars', quantity: 1, unit: 'lump', unitPrice: 450, priceStated: true }],
};

let lastPayload: Record<string, unknown> | null = null;
let activeInfer: (v: unknown) => Schema = oldInferSchema;
const realFetch = globalThis.fetch;
(globalThis as { fetch: unknown }).fetch = async (_url: string, init: { body: string }) => {
  lastPayload = JSON.parse(init.body);
  const hint = lastPayload!.schemaHint;
  const data = hint ? decode(activeInfer(hint), INTENT) : INTENT;
  return new Response(JSON.stringify({ success: true, data, raw: JSON.stringify(data), finishReason: 'STOP' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { parseVoiceAction } = await import('../utils/voiceActionParser');
const { mageAI, fillEmptyArrayHints } = await import('../utils/mageAI');
const { z } = await import('zod');

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra: unknown = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra !== '' ? `\n      ${JSON.stringify(extra)}` : ''); }
}

const project = { id: 'p1', name: 'Henderson', type: 'renovation', location: '', schedule: { tasks: [{ id: 't1', title: 'Drywall hang', phase: 'Interior', progress: 0, status: 'not_started' }] } } as never;

for (const [label, infer] of [['committed relay', oldInferSchema], ['wave-6 relay (_shared/inferSchema)', newInferSchema]] as const) {
  if (!infer) { console.log(`\n(${label} not present — skipped)`); continue; }
  activeInfer = infer;
  console.log(`\nE8 through the ${label}:`);
  const r = await parseVoiceAction({ transcript: 'log 6 hours framing, drywall is 80 percent, 40 sheets of drywall delivered', project });
  const sent = lastPayload!.schemaHint as Record<string, unknown>;
  const schema = infer(sent) as Schema;
  const itemType = (k: string) => schema.properties?.[k]?.items?.type;
  ok('the schema holds fieldScheduleUpdates to OBJECTS {taskName, progressPercent}', itemType('fieldScheduleUpdates') === 'object' && !!schema.properties?.fieldScheduleUpdates?.items?.properties?.progressPercent, schema.properties?.fieldScheduleUpdates);
  ok('…and fieldTimeEntries, lineItems, invoiceLineItems likewise', ['fieldTimeEntries', 'lineItems', 'invoiceLineItems'].every((k) => itemType(k) === 'object'));
  ok('fieldMaterials stays a string array (its `[]` is left as sent)', itemType('fieldMaterials') === 'string' && Array.isArray(sent.fieldMaterials) && (sent.fieldMaterials as unknown[]).length === 0);
  ok('the spoken progress survives: Drywall hang 80%', r.fieldScheduleUpdates.length === 1 && r.fieldScheduleUpdates[0].taskName === 'Drywall hang' && r.fieldScheduleUpdates[0].progressPercent === 80, r.fieldScheduleUpdates);
  ok('the spoken hours survive: Framing 6h', r.fieldTimeEntries.length === 1 && r.fieldTimeEntries[0].hours === 6 && r.fieldTimeEntries[0].trade === 'Framing', r.fieldTimeEntries);
  ok('the stated line item survives with its price', r.lineItems.length === 1 && r.lineItems[0].unitPrice === 450 && r.lineItems[0].priceStated === true, r.lineItems);
  ok('the materials survive', r.fieldMaterials.join() === '40 sheets drywall');
  ok('no blank example entry is filed (invoiceLineItems empty)', r.invoiceLineItems.length === 0);
}
activeInfer = oldInferSchema;

console.log('\nthe price of an example element — a blank echo is never filed:');
{
  // A model that copies the filled example verbatim into an array he never
  // mentioned (an RFI with a blank line item and a blank hours row).
  const saved = { ...INTENT };
  Object.assign(INTENT, {
    kind: 'rfi',
    fieldTimeEntries: [{ trade: '', hours: 0, notes: '' }],
    fieldScheduleUpdates: [{ taskName: '', progressPercent: 0 }],
    lineItems: [{ name: '', description: '', quantity: 1, unit: 'lump', unitPrice: 0, priceStated: false }],
    fieldMaterials: [],
  });
  const r = await parseVoiceAction({ transcript: 'ask the architect about the beam', project });
  ok('echoed blank rows are dropped before the mic can file them', r.lineItems.length === 0 && r.fieldTimeEntries.length === 0 && r.fieldScheduleUpdates.length === 0, r);
  Object.assign(INTENT, saved);
}

console.log('\nprogress lands one spoken update → one task, and the mic files it that way:');
{
  // What UniversalMicButton's field_update branch now does with the parsed
  // rows: matchFieldScheduleUpdates(schedule.tasks, rows).matched. The old
  // task-first loop gave EVERY task whose title contained the spoken name the
  // update ("drywall is done" → hang, tape and finish all done).
  const { matchFieldScheduleUpdates } = await import('../utils/voiceActionParser');
  const micFiles = (tasks: { id: string; title: string }[], ups: { taskName: string; progressPercent: number }[]) =>
    matchFieldScheduleUpdates(tasks, ups).matched.map((m) => [m.taskTitle, m.pct] as [string, number]);
  const tasks = [{ id: 'a', title: 'Drywall hang' }, { id: 'b', title: 'Drywall tape' }, { id: 'c', title: 'Drywall finish' }, { id: 'd', title: 'Paint' }];
  const proj = { id: 'p2', name: 'Henderson', schedule: { tasks: tasks.map((t) => ({ ...t, phase: 'Interior', progress: 0, status: 'not_started' })) } } as never;
  const saved = { ...INTENT };
  Object.assign(INTENT, { kind: 'field_update', fieldScheduleUpdates: [{ taskName: 'drywall', progressPercent: 100 }, { taskName: 'prime and paint', progressPercent: 50 }, { taskName: 'roofing', progressPercent: 20 }] });
  const r = await parseVoiceAction({ transcript: 'drywall is done, prime and paint halfway, roofing 20', project: proj });
  const applied = micFiles(tasks, r.fieldScheduleUpdates);
  ok('the reviewer\'s repro: the mic changes Paint only — no drywall task', JSON.stringify(applied) === JSON.stringify([['Paint', 50]]), applied);
  ok('…the kept row carries the exact task title (the preview shows the task that changes)', r.fieldScheduleUpdates.length === 1 && r.fieldScheduleUpdates[0].taskName === 'Paint', r.fieldScheduleUpdates);
  ok('…and what was NOT applied is said in the preview (reasoning): drywall fits 3, roofing is not on it', /Progress not applied/.test(r.reasoning) && /"drywall" fits Drywall hang and Drywall tape and Drywall finish/.test(r.reasoning) && /"roofing" is not on the schedule/.test(r.reasoning), r.reasoning);

  // An exact title that another title contains ("Paint" in "Prime and paint")
  // lands on exactly that task — the matcher tries the exact title first.
  const t2 = [{ id: 'x', title: 'Paint' }, { id: 'y', title: 'Prime and paint' }];
  const p2 = { id: 'p3', name: 'J', schedule: { tasks: t2.map((t) => ({ ...t, phase: 'I', progress: 0, status: 'not_started' })) } } as never;
  Object.assign(INTENT, { fieldScheduleUpdates: [{ taskName: 'Paint', progressPercent: 100 }] });
  const r2 = await parseVoiceAction({ transcript: 'paint is done', project: p2 });
  ok('"paint is done" beside "Prime and paint" marks Paint only, with no note', JSON.stringify(micFiles(t2, r2.fieldScheduleUpdates)) === JSON.stringify([['Paint', 100]]) && !/not applied/.test(r2.reasoning), { up: r2.fieldScheduleUpdates, why: r2.reasoning });

  Object.assign(INTENT, { fieldScheduleUpdates: [{ taskName: 'Drywall tape', progressPercent: 60 }] });
  const r3 = await parseVoiceAction({ transcript: 'drywall tape is 60', project: proj });
  ok('an unambiguous update still lands on exactly its task, with no note', JSON.stringify(micFiles(tasks, r3.fieldScheduleUpdates)) === JSON.stringify([['Drywall tape', 60]]) && !/not applied/.test(r3.reasoning));

  Object.assign(INTENT, { kind: 'rfi', fieldScheduleUpdates: [{ taskName: 'drywall', progressPercent: 100 }] });
  const r4 = await parseVoiceAction({ transcript: 'ask the architect about drywall', project: proj });
  ok('a non-daily-log kind is passed through untouched (no progress note on an RFI)', !/not applied/.test(r4.reasoning));
  Object.assign(INTENT, saved);

  // The replay above is the mic only while the mic calls the matcher. Pin it:
  // the old task-first loop is gone, the matcher is called, and an add-tasks
  // request is routed to the editor before EACH parse (first + clarify chip).
  const { readFileSync } = await import('node:fs');
  const mic = readFileSync(new URL('../components/UniversalMicButton.tsx', import.meta.url), 'utf8');
  const code = mic.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('the mic\'s old task-first loop is gone', !/norm\(t\.title\)\.includes\(norm\(u\.taskName\)\)/.test(code) && !/fieldScheduleUpdates\.find\(/.test(code));
  ok('…and the one-to-one matcher files the progress', /matchFieldScheduleUpdates\(\s*schedule\.tasks\s*,\s*parsed\.fieldScheduleUpdates\s*\)\.matched/.test(code));
  const parses = [...code.matchAll(/parseVoiceAction\(\{/g)].map((m) => m.index!);
  const routedBefore = parses.map((at) => {
    const before = code.slice(Math.max(0, at - 900), at);
    return /scheduleEditRouteForTranscript\(/.test(before) && /router\.push\(\s*editRoute/.test(before);
  });
  ok('an add-tasks utterance is routed to the editor before BOTH parses', parses.length === 2 && routedBefore.every(Boolean), { parses: parses.length, routedBefore });
  // The Schedule tab opens its editor as a Modal; pushing while the mic's own
  // Modal is still dismissing is the iOS stacking bug (UIKit refuses the
  // second present and RN never retries). Close first, navigate after 350ms.
  const guarded = [...code.matchAll(/handleClose\(\);\s*setTimeout\(\(\) => router\.push\(editRoute as never\), Platform\.OS === 'ios' \? 350 : 0\);/g)].length;
  ok('…each after the mic sheet has closed (iOS 350ms guard), never a push mid-dismiss', guarded === 2 && !/router\.push\(editRoute as never\);/.test(code), { guarded });
}

console.log('\nmoney only lands when he said it (integration review, wave 6):');
{
  // The mic's CO build (components/UniversalMicButton.tsx, kind 'co'): the
  // lines when there are any, else the stated changeAmount as one line.
  const micCoTotal = (r: { lineItems: { quantity: number; unitPrice: number }[]; changeAmount: number }) =>
    r.lineItems.length > 0 ? r.lineItems.reduce((s, li) => s + (li.quantity ?? 1) * (li.unitPrice ?? 0), 0) : (r.changeAmount > 0 ? r.changeAmount : 0);
  const saved = { ...INTENT };
  const blank = { fieldTimeEntries: [], fieldScheduleUpdates: [], fieldMaterials: [], invoiceLineItems: [], lineItems: [], changeAmount: 0 };

  Object.assign(INTENT, { ...blank, kind: 'co', description: 'Heat pump upgrade', lineItems: [{ name: 'Heat pump upgrade', description: '', quantity: 1, unit: 'lump', unitPrice: 8500, priceStated: false }] });
  const a = await parseVoiceAction({ transcript: 'owner wants the heat pump upgrade', project });
  ok('"owner wants the heat pump upgrade" (no $ said): the invented $8,500 is not filed', micCoTotal(a) === 0 && a.lineItems.length === 1 && a.lineItems[0].unitPrice === 0 && a.lineItems[0].priceStated === false, a.lineItems);

  Object.assign(INTENT, { ...blank, kind: 'co', description: 'Redo bath tile', changeAmount: 4500, lineItems: [{ name: 'Redo bath tile', description: '', quantity: 1, unit: 'lump', unitPrice: 0, priceStated: false }] });
  const b = await parseVoiceAction({ transcript: 'change order for forty-five hundred to redo the bath tile', project });
  ok('"…forty-five hundred to redo the bath tile" (4500 in changeAmount, line unpriced): files $4,500, not $0', micCoTotal(b) === 4500, { lines: b.lineItems, amt: b.changeAmount });

  Object.assign(INTENT, { ...blank, kind: 'co', description: 'Basement window + deck extension', changeAmount: 6000, lineItems: [{ name: 'Basement window', description: '', quantity: 1, unit: 'lump', unitPrice: 0, priceStated: false }, { name: 'Extend deck', description: '', quantity: 1, unit: 'lump', unitPrice: 1200, priceStated: false }] });
  const c = await parseVoiceAction({ transcript: 'add a window in the basement and extend the deck, six grand total', project });
  ok('"…six grand total" over two unpriced lines: files the stated $6,000', micCoTotal(c) === 6000, { lines: c.lineItems, amt: c.changeAmount });

  Object.assign(INTENT, { ...blank, kind: 'invoice', invoiceLineItems: [{ name: 'Kitchen demo', description: '', quantity: 1, unit: 'lump', unitPrice: 3200, priceStated: false }] });
  const d = await parseVoiceAction({ transcript: 'send an invoice for the kitchen demo', project });
  // The mic hands these rows to app/invoice.tsx as prefillLines verbatim.
  ok('"send an invoice for the kitchen demo": the prefill carries $0, not an invented $3,200', d.invoiceLineItems.length === 1 && d.invoiceLineItems[0].unitPrice === 0, d.invoiceLineItems);

  Object.assign(INTENT, { ...blank, kind: 'invoice', invoiceLineItems: [{ name: 'Demo', description: '', quantity: 1, unit: 'lump', unitPrice: 2800, priceStated: true }] });
  const e = await parseVoiceAction({ transcript: 'invoice them for demolition, twenty-eight hundred', project });
  ok('…while a price he DID say is kept ($2,800)', e.invoiceLineItems.length === 1 && e.invoiceLineItems[0].unitPrice === 2800);

  Object.assign(INTENT, { ...blank, kind: 'co', description: 'Blocking', changeAmount: 900, lineItems: [{ name: 'Blocking', description: '', quantity: 2, unit: 'ea', unitPrice: 450, priceStated: true }] });
  const f = await parseVoiceAction({ transcript: 'two blocking at 450 each', project });
  ok('…and stated priced lines still drive the CO (not replaced by changeAmount)', f.lineItems.length === 1 && micCoTotal(f) === 900);

  // Integration round 2: one stated line, one unpriced, and a stated total.
  Object.assign(INTENT, { ...blank, kind: 'co', description: 'Basement window + deck extension', changeAmount: 6000, lineItems: [{ name: 'Basement window', description: '', quantity: 1, unit: 'lump', unitPrice: 1200, priceStated: true }, { name: 'Deck extension', description: '', quantity: 1, unit: 'lump', unitPrice: 0, priceStated: false }] });
  const g = await parseVoiceAction({ transcript: 'basement window twelve hundred and extend the deck, six grand total', project });
  ok('mixed CO ($1,200 stated line + unpriced line + $6,000 total): files the $6,000 he said', micCoTotal(g) === 6000, { lines: g.lineItems, amt: g.changeAmount });
  ok('…keeping the $1,200 window and putting the $4,800 remainder on the deck line',
    g.lineItems.length === 2 && g.lineItems[0].name === 'Basement window' && g.lineItems[0].unitPrice === 1200
    && g.lineItems[1].name === 'Deck extension' && g.lineItems[1].unitPrice === 4800 && g.lineItems[1].priceStated === true, g.lineItems);
  Object.assign(INTENT, { ...blank, kind: 'co', description: 'Window', changeAmount: 1000, lineItems: [{ name: 'Basement window', description: '', quantity: 1, unit: 'lump', unitPrice: 1200, priceStated: true }, { name: 'Trim', description: '', quantity: 1, unit: 'lump', unitPrice: 0, priceStated: false }] });
  const h = await parseVoiceAction({ transcript: 'window twelve hundred plus trim, about a thousand', project });
  ok('…a stated total BELOW the stated lines invents no negative remainder', micCoTotal(h) === 1200 && h.lineItems.every((li) => li.unitPrice >= 0), h.lineItems);
  Object.assign(INTENT, saved);

  const { readFileSync } = await import('node:fs');
  const mic = readFileSync(new URL('../components/UniversalMicButton.tsx', import.meta.url), 'utf8');
  ok('the mic preview marks an unstated price instead of showing $0', (mic.match(/li\.priceStated \? /g) ?? []).length === 2 && /No price said/.test(mic));
  const parser = readFileSync(new URL('../utils/voiceActionParser.ts', import.meta.url), 'utf8');
  ok('the prompt no longer promises a cost-history lookup nothing implements', !/look up the rate from their cost history/.test(parser));
}

console.log('\nfillEmptyArrayHints leaves everything else alone:');
{
  const schema = z.object({ tags: z.array(z.string()).default([]), rows: z.array(z.object({ a: z.number().default(0) })).default([]), n: z.number().default(0) });
  const noFill = { tags: [], rows: [{ a: 1 }], n: 2 };
  ok('a hint with nothing to fill is returned as the SAME object (byte-identical payload)', fillEmptyArrayHints(noFill, schema) === noFill);
  const filled = fillEmptyArrayHints({ tags: [], rows: [], n: 0 }, schema) as { tags: unknown[]; rows: unknown[] };
  ok('an empty OBJECT array is filled from its Zod element; a string array is not', filled.tags.length === 0 && JSON.stringify(filled.rows) === JSON.stringify([{ a: 0 }]), filled);
  const nested = z.object({ plan: z.object({ steps: z.array(z.object({ t: z.string().default('') })).default([]) }) });
  ok('nested objects are filled too', JSON.stringify(fillEmptyArrayHints({ plan: { steps: [] } }, nested)) === JSON.stringify({ plan: { steps: [{ t: '' }] } }));
  ok('keys the schema does not know are left as sent', JSON.stringify(fillEmptyArrayHints({ extra: [] }, schema)) === JSON.stringify({ extra: [] }));
  await mageAI({ prompt: 'x', schemaHint: { actions: [] } });
  ok('with no Zod schema the hint is sent exactly as given', JSON.stringify(lastPayload!.schemaHint) === JSON.stringify({ actions: [] }));
}

(globalThis as { fetch: unknown }).fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
