// validate-co-proof-packet.ts — pins the change order proof packet
// (utils/coProofPacket.ts, the pure model) and its print HTML
// (utils/coProofPacketHtml.ts).
//
// WHY: the packet is what a GC hands an owner, a lender or a lawyer when a
// change order is disputed. Each rule below is one way it could quietly lie:
// an evidence window off by a day, "CO #120" read as CO 12, an incident photo
// or an internal note printed, a float leaking into money, "not checked"
// shown as "none", unescaped record text, or a weak reason hiding a real link.
// Planted mutations (each must turn a named check red; see the lane report):
//   1 window end <= → <          2 trailing \b dropped from coMentionPattern
//   3 incident exclusion removed 4 isPrivate comm events included
//   5 toCents → identity         6 empty instead of notChecked (photos)
//   7 daily-log excerpt not escaped   8 in_window before field_ticket
//
// The modules are EXECUTED under bun; react-native / expo are stubbed because
// utils/pdfGenerator.ts (DFR_PDF_MAX_PHOTOS, dfrMarkupSvg) imports them.
// Runs itself again under Denver and Tokyo so a day boundary cannot pass here
// and fail on a phone in another timezone.
// Run: bun run scripts/validate-co-proof-packet.ts
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  ChangeOrder, CommunicationEvent, CompanyBranding, DailyFieldReport, DelayEvent, FieldTicket,
  PortalMessage, ProjectPhoto, RFI, ScheduleAuditEntry,
} from '../types';

const __dirnameSafe = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirnameSafe, '..');
const SELF = fileURLToPath(import.meta.url);
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const TZ_CHILD_FLAG = 'CO_PROOF_PACKET_TZ_CHILD';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  ok(name, same, same ? undefined : `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}

// ── stubs ────────────────────────────────────────────────────────────────────
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-co-proof-packet must run under bun (needs Bun.plugin to stub native modules)\n');
  process.exit(1);
}
const Platform = { OS: 'ios' as string, select: (o: Record<string, unknown>) => o.ios ?? o.default };
Bun.plugin({
  name: 'co-proof-packet-stubs',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform }, loader: 'object' }));
    build.module('expo-print', () => ({ exports: { printToFileAsync: async () => ({ uri: '' }), printAsync: async () => {} }, loader: 'object' }));
    build.module('expo-sharing', () => ({ exports: { isAvailableAsync: async () => false, shareAsync: async () => {} }, loader: 'object' }));
    build.module('expo-mail-composer', () => ({ exports: {}, loader: 'object' }));
    build.module('expo-file-system/legacy', () => ({ exports: {}, loader: 'object' }));
    build.module('@/lib/supabase', () => ({ exports: { supabase: {}, isSupabaseConfigured: false }, loader: 'object' }));
  },
});

const P = await import('../utils/coProofPacket');
const H = await import('../utils/coProofPacketHtml');
const G = await import('../utils/pdfGenerator');
const FT = await import('../utils/fieldTicketCore');
const NC = await import('../utils/noticeClock');
type Input = import('../utils/coProofPacket').CoProofInput;

const TZ = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
console.log(`\nco proof packet (TZ ${TZ}):`);

// ── fixtures ─────────────────────────────────────────────────────────────────
// Instants at 12:00Z land on the same calendar day from Denver to Tokyo.
const at = (day: string, hh = '12:00') => `${day}T${hh}:00Z`;
const as = <T,>(v: unknown) => v as T;

const photo = (id: string, timestamp: string, extra: Partial<ProjectPhoto> = {}): ProjectPhoto => as<ProjectPhoto>({
  id, projectId: 'p1', uri: `https://cdn.example/${id}.jpg`, storagePath: `u/p1/${id}.jpg`, timestamp, createdAt: timestamp, ...extra,
});
const dfr = (id: string, date: string, workPerformed: string, extra: Partial<DailyFieldReport> = {}): DailyFieldReport => as<DailyFieldReport>({
  id, projectId: 'p1', date, workPerformed, issuesAndDelays: '', photos: [], status: 'sent',
  weather: {}, manpower: [], materialsDelivered: [], createdAt: at(date), updatedAt: at(date), ...extra,
});
const rfi = (id: string, number: number, subject: string, question: string, extra: Partial<RFI> = {}): RFI => as<RFI>({
  id, projectId: 'p1', number, subject, question, submittedBy: 'GC', assignedTo: 'Architect',
  dateSubmitted: at('2026-09-11'), dateRequired: '2026-09-20', status: 'open', priority: 'normal', attachments: [], ...extra,
});
const pmsg = (id: string, createdAt: string, body: string): PortalMessage => ({
  id, projectId: 'p1', portalId: 'portal1', authorType: 'client', authorName: 'Dana Client', body, createdAt, readByGc: true, readByClient: true,
});
const cev = (id: string, isPrivate: boolean, summary: string, timestamp: string): CommunicationEvent => ({
  id, projectId: 'p1', type: isPrivate ? 'internal_note' : 'co_submitted', summary, actor: 'Sam GC', isPrivate, timestamp,
});

function baseCo(): ChangeOrder {
  return as<ChangeOrder>({
    id: 'co12', number: 12, projectId: 'p1', date: '2026-09-10',
    description: 'Add a steel beam over the kitchen opening',
    reason: 'Owner request',
    lineItems: [
      { id: 'li1', name: 'Steel beam', description: '', quantity: 1, unit: 'ea', unitPrice: 1200.1, total: 1200.1, isNew: true },
      { id: 'li2', name: 'Labor', description: '', quantity: 1, unit: 'ls', unitPrice: 799.9, total: 799.9, isNew: true },
    ],
    originalContractValue: 50000, changeAmount: 2000, newContractTotal: 52000,
    scheduleImpactDays: 3, scheduleImpactApplied: true,
    scheduleImpactTaskIds: ['t2', 'tGone'], scheduleAnchorTaskId: 't2',
    status: 'approved',
    approvers: [{
      id: 'a1', name: 'Dana Client', email: 'dana.secret@example.com', role: 'Client', required: true, order: 1,
      status: 'approved', responseDate: at('2026-09-15'), counterAmount: 19.99,
    }],
    auditTrail: [
      { id: 'au3', action: 'emailed_pdf', actor: 'Sam GC', timestamp: at('2026-09-11', '13:00'), detail: 'Sent by email' },
      { id: 'au2', action: 'schedule_reflow_applied', actor: 'Sam GC', timestamp: at('2026-09-15', '12:30'), detail: '+3 days applied to "Framing" (named by the impact analysis); finish 40 → 43.' },
      { id: 'au1', action: 'client_signed_via_portal', actor: 'Dana Client', timestamp: at('2026-09-15'), detail: 'Signed in the portal. record SHA-256 0123456789abcdef…' },
    ],
    createdAt: at('2026-09-10'), updatedAt: at('2026-09-15'),
    portalState: { status: 'sent', sentAt: at('2026-09-11'), viewedAt: at('2026-09-12') },
  });
}

function fixture(): Input {
  const tickets: FieldTicket[] = [
    as<FieldTicket>({
      id: 'ft1', number: 7, projectId: 'p1', date: '2026-09-10', workDescription: 'Shored the opening for the beam',
      reasonExtra: 'Not in contract', sourceDailyReportId: 'd_ticketsrc', labor: [], materials: [], equipment: [],
      photos: [
        { id: 'ph_ticket', uri: 'https://cdn.example/ph_ticket.jpg', timestamp: at('2026-09-12') },
        { id: 'ph_ticket_only', uri: 'https://cdn.example/ph_ticket_only.jpg', timestamp: at('2026-06-01') },
      ],
      status: 'converted', convertedChangeOrderId: 'co12', createdAt: at('2026-09-10'), updatedAt: at('2026-09-10'),
    }),
    as<FieldTicket>({
      id: 'ft2', number: 8, projectId: 'p1', date: '2026-09-12', workDescription: 'Unrelated', reasonExtra: '',
      labor: [], materials: [], equipment: [], status: 'signed', createdAt: at('2026-09-12'), updatedAt: at('2026-09-12'),
    }),
  ];
  const delays: DelayEvent[] = [
    as<DelayEvent>({
      id: 'de1', projectId: 'p1', number: 4, cause: 'owner_directed_change', firstObservedDate: '2026-09-11',
      description: 'Waiting on the beam decision',
      evidence: [
        { kind: 'photo', id: 'ph_delay', capturedAt: at('2026-08-01') },
        { kind: 'daily_report', id: 'd_delay', capturedAt: at('2026-07-02') },
      ],
      impactedTaskIds: ['t2'], claimedDays: 3, notices: [], classification: 'excusable_compensable', changeOrderId: 'co12',
    }),
  ];
  const audit: ScheduleAuditEntry[] = [
    { id: 's1', at: at('2026-09-15', '12:30'), user: 'sam@gc.example', changeOrderId: 'co12', kind: 'reflow', summary: 'CO #12 approved: +3 days on "Framing"' },
    { id: 's2', at: at('2026-09-15', '12:30'), user: 'sam@gc.example', kind: 'task_edit', summary: 'Edited Drywall' },
  ];
  return {
    co: baseCo(),
    project: { id: 'p1', name: 'Henderson remodel', location: 'Glen Ridge NJ', schedule: { tasks: [
      { id: 't1', title: 'Demo' }, { id: 't2', title: 'Framing' }, { id: 't3', title: 'Drywall' },
    ] } },
    photos: [
      photo('ph_ticket', at('2026-09-12')),                      // field ticket AND in window
      photo('ph_delay', at('2026-08-01')),                       // delay evidence, outside window
      photo('ph_task', at('2026-09-13'), { linkedTaskId: 't2' }),  // affected task, in window
      photo('ph_start', at('2026-09-07'), { location: 'Kitchen' }), // first day of the window
      photo('ph_end', at('2026-09-15')),                         // last day of the window
      photo('ph_after', at('2026-09-16')),                       // day after the window
      photo('ph_before', at('2026-09-06')),                      // day before the window
      photo('ph_incident', at('2026-09-12', '13:00')),           // in window, but incident evidence
      photo('ph_rfi', at('2026-05-01')),                         // source of an included RFI
    ],
    photosLoaded: true,
    dailyReports: [
      dfr('d_mention', '2026-08-20', 'Poured footing. Owner approved CO-012 for the extra beam. Cleaned up.'),
      dfr('d_window', '2026-09-12', 'Framing continued.', { issuesAndDelays: '<script>alert(1)</script>', status: 'draft' }),
      dfr('d_outside', '2026-09-25', 'Painting.'),
      dfr('d_incident', '2026-09-01', 'Cut hand.', { photos: [{ id: 'ph_incident', uri: 'x', timestamp: at('2026-09-12', '13:00'), incidentPhoto: true }] }),
      dfr('d_ticketsrc', '2026-07-01', 'Found the opening undersized.'),
      dfr('d_delay', '2026-07-02', 'Stopped framing, waiting on owner.'),
    ],
    dailyReportsLoaded: true,
    rfis: [
      rfi('r3', 3, 'Beam size for change order 12', 'What size beam?', { sourcePhotoId: 'ph_rfi', response: 'W8x18', dateResponded: at('2026-09-13') }),
      rfi('r4', 4, 'Window swap', 'See CO #120 for the window swap'),
      rfi('r5', 5, 'Header detail', 'Header at the opening?', { linkedTaskId: 't2' }),
      rfi('r6', 6, 'Paint color', 'Which white?'),
    ],
    portalMessages: [
      pmsg('m_mention', at('2026-08-01'), 'Approving CO #12 now'),
      pmsg('m_before_send', at('2026-09-10', '18:00'), 'Hello'),
      pmsg('m_window', at('2026-09-13'), 'Can we talk Tuesday'),
      pmsg('m_after', at('2026-09-20'), 'Thanks'),
    ],
    commEvents: [
      cev('ce_private', true, 'Internal: CO #12 margin is thin PRIVATE-SENTINEL', at('2026-09-12')),
      cev('ce_public', false, 'CO #12 sent to client', at('2026-09-11', '12:05')),
    ],
    fieldTickets: tickets,
    delayEvents: delays,
    scheduleAudit: { entries: audit, source: 'cloud', truncated: false },
    declineLine: null,
    generatedAt: at('2026-09-30'),
  };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

const input = deepFreeze(fixture());
let packet: ReturnType<typeof P.buildCoProofPacket>;
let threw = '';
try { packet = P.buildCoProofPacket(input); } catch (e) { threw = String(e); packet = P.buildCoProofPacket(fixture()); }
const ids = <T extends { id: string }>(xs: T[]) => xs.map(x => x.id);
const reasonOf = (id: string) => packet.photos.items.find(p => p.id === id)?.reason ?? null;
const json = JSON.stringify(packet);

// ── contract constants ───────────────────────────────────────────────────────
console.log('\ncontract:');
expect('window constants 3 and 14', [P.COPROOF_WINDOW_BEFORE_DAYS, P.COPROOF_WINDOW_AFTER_DAYS], [3, 14]);
expect('COPROOF_MAX_EMBEDDED_PHOTOS = DFR_PDF_MAX_PHOTOS', P.COPROOF_MAX_EMBEDDED_PHOTOS, G.DFR_PDF_MAX_PHOTOS);
expect('every reason has a label', Object.keys(P.COPROOF_REASON_LABEL).sort(),
  ['affected_task', 'decision_window', 'delay_event', 'field_ticket', 'in_window', 'linked', 'mentions_co', 'rfi_source']);
ok('audit labels cover every action with a writer', [
  'client_signed_via_portal', 'client_declined_via_portal', 'approved_via_portal', 'declined_via_portal',
  'portal_decision_applied', 'marked_approved', 'schedule_reflow_applied', 'schedule_reflow_no_anchor',
  'converted_from_field_ticket', 'revision_of_declined',
].every(a => !!P.COPROOF_AUDIT_LABELS[a]));
ok('each labelled audit action still has a writer outside this lane', [
  ['app/client-view.tsx', "'client_signed_via_portal' : 'client_declined_via_portal'"],
  ['hooks/usePortalApprovalReconciler.ts', "'approved_via_portal' : 'declined_via_portal'"],
  ['hooks/usePortalApprovalReconciler.ts', "action: 'portal_decision_applied'"],
  ['utils/projectContextPure.ts', "action: 'marked_approved'"],
  ['utils/coScheduleReflowCore.ts', 'action: CO_REFLOW_UNANCHORED_ACTION'],
  ['utils/coScheduleReflowCore.ts', 'action: CO_REFLOW_ACTION'],
  ['utils/fieldTicketCore.ts', 'action: FIELD_TICKET_CO_ACTION'],
  ['app/change-order.tsx', "action: 'revision_of_declined'"],
].every(([f, needle]) => read(f).includes(needle)));

// ── purity ───────────────────────────────────────────────────────────────────
console.log('\npurity:');
ok('deep-frozen input does not throw', threw === '', threw);
ok('two runs are deep-equal', JSON.stringify(P.buildCoProofPacket(input)) === json);

// ── window ───────────────────────────────────────────────────────────────────
console.log('\nwindow:');
expect('window = 2026-09-07 .. 2026-09-15 (decided on the 15th)', packet.window,
  { startDay: '2026-09-07', endDay: '2026-09-15', decisionDay: '2026-09-15' });
ok('boundary photos on both ends included', reasonOf('ph_start') === 'in_window' && reasonOf('ph_end') === 'in_window',
  `start=${reasonOf('ph_start')} end=${reasonOf('ph_end')}`);
ok('day after the window excluded', reasonOf('ph_after') === null);
ok('day before the window excluded', reasonOf('ph_before') === null);
{
  const early = fixture();
  early.fieldTickets = early.fieldTickets.map(t => (t.id === 'ft1' ? { ...t, date: '2026-09-02' } : t));
  expect('a linked field ticket dated earlier opens the window 3 days before it', P.coProofWindow(early).startDay, '2026-08-30');
  const open = fixture();
  open.co = { ...open.co, status: 'submitted', auditTrail: [] };
  expect('undecided: the window ends 14 days after the CO', P.coProofWindow(open), { startDay: '2026-09-07', endDay: '2026-09-24', decisionDay: null });
  const young = fixture();
  young.co = { ...young.co, status: 'submitted', auditTrail: [] };
  young.generatedAt = at('2026-09-12');
  expect('undecided and young: the window ends on the generated day', P.coProofWindow(young).endDay, '2026-09-12');
  const bad = fixture();
  bad.co = { ...bad.co, createdAt: 'not a date' };
  expect('an unparseable createdAt is skipped, never read as today', P.coProofWindow(bad).startDay, '2026-09-07');
  const declined = fixture();
  declined.co = { ...declined.co, status: 'rejected', auditTrail: [] };
  declined.declineLine = { who: 'Dana Client', when: at('2026-09-13'), reason: 'Too much' };
  expect('declined: the window ends on the decline day', P.coProofWindow(declined), { startDay: '2026-09-07', endDay: '2026-09-13', decisionDay: '2026-09-13' });
}

// ── mention matcher ──────────────────────────────────────────────────────────
console.log('\nmention matcher (n = 12):');
const re12 = P.coMentionPattern(12);
for (const s of ['CO #12', 'CO 12', 'CO-12', 'CO-012', 'co#12', 'change order 12', 'Change Order #12', 'change order no. 12', 'per CO #12.']) {
  ok(`matches "${s}"`, re12.test(s));
}
for (const s of ['CO #120', 'CO #112', 'COVID 12', 'CO2', 'CO #1', 'ECO 12', 'CO #12a']) {
  ok(`does not match "${s}"`, !re12.test(s));
}
ok('a bad number matches nothing', !P.coMentionPattern(Number.NaN).test('CO #NaN') && !P.coMentionPattern(0).test('CO 0'));

// ── photos ───────────────────────────────────────────────────────────────────
console.log('\nphotos:');
ok('reason precedence: field ticket beats in window', reasonOf('ph_ticket') === 'field_ticket', `got ${reasonOf('ph_ticket')}`);
expect('delay evidence outside the window is included', reasonOf('ph_delay'), 'delay_event');
expect('a photo on a task this CO moves', reasonOf('ph_task'), 'affected_task');
{
  const outTask = fixture();
  outTask.photos = [...outTask.photos, photo('ph_task_out', at('2026-08-20'), { linkedTaskId: 't2' })];
  ok('a photo on a task this CO moves but outside the window is left out',
    !P.buildCoProofPacket(outTask).photos.items.some(p => p.id === 'ph_task_out'));
}
expect('the source photo of an included RFI', reasonOf('ph_rfi'), 'rfi_source');
expect('a ticket photo not in the gallery is still included', reasonOf('ph_ticket_only'), 'field_ticket');
ok('incident photo excluded', reasonOf('ph_incident') === null && !json.includes('ph_incident'));
expect('incident photo counted', packet.photos.excludedIncidentCount, 1);
expect('photos sorted by time, ties by id', ids(packet.photos.items),
  ['ph_rfi', 'ph_ticket_only', 'ph_delay', 'ph_start', 'ph_ticket', 'ph_task', 'ph_end']);
expect('photo item keeps the caption and storage path', packet.photos.items.find(p => p.id === 'ph_start')
  && { caption: packet.photos.items.find(p => p.id === 'ph_start')!.caption, storagePath: packet.photos.items.find(p => p.id === 'ph_start')!.storagePath },
  { caption: 'Kitchen', storagePath: 'u/p1/ph_start.jpg' });
{
  const notLoaded = fixture();
  notLoaded.photosLoaded = false;
  const pk = P.buildCoProofPacket(notLoaded);
  ok('photosLoaded=false -> photos.notChecked set, photos.empty null, items empty',
    pk.photos.notChecked === 'Photos had not finished loading on this device, so they were not checked.'
      && pk.photos.empty === null && pk.photos.items.length === 0,
    JSON.stringify({ notChecked: pk.photos.notChecked, empty: pk.photos.empty, n: pk.photos.items.length }));
  const logsOut = fixture();
  logsOut.dailyReportsLoaded = false;
  const pk2 = P.buildCoProofPacket(logsOut);
  ok('daily logs not loaded -> no photo can be cleared of incident status, so none print',
    pk2.photos.items.length === 0 && !!pk2.photos.notChecked && pk2.photos.empty === null);
  ok('dailyReportsLoaded=false -> dailyLogs.notChecked set, empty null',
    pk2.dailyLogs.notChecked === 'Daily logs had not finished loading on this device, so they were not checked.' && pk2.dailyLogs.empty === null);
}

// ── daily logs ───────────────────────────────────────────────────────────────
console.log('\ndaily logs:');
expect('daily logs included by link, mention and window, sorted by day', packet.dailyLogs.items.map(d => [d.id, d.reason]),
  [['d_ticketsrc', 'field_ticket'], ['d_delay', 'delay_event'], ['d_mention', 'mentions_co'], ['d_window', 'in_window']]);
expect('a mention prints the sentence that names the CO', packet.dailyLogs.items.find(d => d.id === 'd_mention')?.excerpt,
  'Owner approved CO-012 for the extra beam.');
expect('status is copied', packet.dailyLogs.items.find(d => d.id === 'd_window')?.status, 'draft');
{
  const long = fixture();
  long.dailyReports = [dfr('d_long', '2026-09-12', `${'word '.repeat(200)}end`)];
  const ex = P.buildCoProofPacket(long).dailyLogs.items[0]?.excerpt ?? '';
  ok('a long log is clipped near 400 characters on a word boundary with an ellipsis',
    ex.endsWith('word…') && ex.length <= 'Work performed: '.length + 401, ex.slice(-20));
  const none = fixture();
  none.dailyReports = [dfr('d_far', '2026-01-01', 'Nothing related.')];
  expect('no daily reports in window -> the empty sentence', P.buildCoProofPacket(none).dailyLogs.empty, 'No daily logs in this window.');
}

// ── RFIs ─────────────────────────────────────────────────────────────────────
console.log('\nRFIs:');
const rfiIds = packet.rfis.items.map(r => [r.number, r.reason]);
ok('RFI #4 ("CO #120") NOT included', !packet.rfis.items.some(r => r.number === 4));
ok('RFI #3 included as mentions_co', rfiIds.some(([n, r]) => n === 3 && r === 'mentions_co'));
ok('RFI #5 on a task the CO moves is included', rfiIds.some(([n, r]) => n === 5 && r === 'affected_task'));
ok('RFI #6 is never included by date alone', !packet.rfis.items.some(r => r.number === 6));

// ── messages ─────────────────────────────────────────────────────────────────
console.log('\nmessages:');
expect('messages: mention, activity, decision window, by time', packet.messages.items.map(m => [m.id, m.reason, m.kind]),
  [['m_mention', 'mentions_co', 'portal'], ['ce_public', 'mentions_co', 'activity'], ['m_window', 'decision_window', 'portal']]);
ok('private comm event absent and not counted anywhere in the output',
  !json.includes('PRIVATE-SENTINEL') && !json.includes('ce_private') && packet.messages.items.length === 3);
ok('no approver email in the packet', !json.includes('dana.secret@example.com'));

// ── linked ───────────────────────────────────────────────────────────────────
console.log('\nlinked records:');
expect('only the ticket and delay that point to this CO', packet.linked.items.map(l => [l.kind, l.label, l.day]),
  [['field_ticket', 'Field ticket T&M-007', '2026-09-10'], ['delay_event', 'Delay DE-004', '2026-09-11']]);
ok('linked labels match the app handles (fieldTicketLabel, formatDelayEventNumber)',
  packet.linked.items[0]?.label === `Field ticket ${FT.fieldTicketLabel(7)}` && packet.linked.items[1]?.label === `Delay ${NC.formatDelayEventNumber(4)}`);
{
  // A delay that points at ANOTHER change order: not linked, does not open the
  // window, and its evidence photo does not come in as delay evidence.
  const other = fixture();
  other.delayEvents = [...other.delayEvents, as<DelayEvent>({
    id: 'de_other', projectId: 'p1', number: 9, cause: 'owner_directed_change', firstObservedDate: '2026-07-20',
    description: 'Another CO', evidence: [{ kind: 'photo', id: 'ph_other_delay', capturedAt: at('2026-07-21') }],
    impactedTaskIds: [], claimedDays: 1, notices: [], classification: 'excusable_compensable', changeOrderId: 'co99',
  })];
  other.photos = [...other.photos, photo('ph_other_delay', at('2026-07-21'))];
  const pkOther = P.buildCoProofPacket(other);
  ok('a delay on another CO is not a linked record', !pkOther.linked.items.some(l => l.id === 'de_other'),
    JSON.stringify(pkOther.linked.items.map(l => l.id)));
  expect('a delay on another CO does not open the window', P.coProofWindow(other).startDay, '2026-09-07');
  ok('a delay on another CO brings in none of its photos', !pkOther.photos.items.some(p => p.id === 'ph_other_delay'));
}

// ── money ────────────────────────────────────────────────────────────────────
console.log('\nmoney:');
const moneyInts = (pk: typeof packet) => [
  pk.money.changeCents, pk.money.lineSumCents, pk.money.contractBeforeCents, pk.money.newContractCents,
  ...pk.approval.approvers.map(a => a.counterCents ?? 0),
].every(Number.isInteger);
ok('money: all fields Number.isInteger', moneyInts(packet), JSON.stringify(packet.money));
expect('cents on the fixture', [packet.money.changeCents, packet.money.lineSumCents, packet.approval.approvers[0]?.counterCents],
  [200000, 200000, 1999]);
ok('mismatch null on the fixture', packet.money.lineMismatch === null);
{
  const off = fixture();
  off.co = { ...off.co, lineItems: off.co.lineItems.map((li, i) => (i === 0 ? { ...li, total: 1200.11 } : li)) };
  expect('mismatch non-null when one line is changed by 1 cent', P.buildCoProofPacket(off).money.lineMismatch,
    { lineSumCents: 200001, recordedCents: 200000 });
  const tax = fixture();
  tax.co = { ...tax.co, taxAmount: 0.1 + 0.2, totalWithTax: 2000.3 };
  const pk = P.buildCoProofPacket(tax);
  ok('tax converts to whole cents', pk.money.taxCents === 30 && pk.money.totalWithTaxCents === 200030);
  expect('tax absent or 0 -> null', [packet.money.taxCents, packet.money.totalWithTaxCents], [null, null]);
  expect('toCents: non-finite -> 0, float noise rounded', [P.toCents(Number.NaN), P.toCents(undefined), P.toCents(0.1 + 0.2), P.toCents(-0.004)], [0, 0, 30, 0]);
}

// ── approval ─────────────────────────────────────────────────────────────────
console.log('\napproval:');
ok('approval line is coApprovalLine (signed in the portal, with the hash)',
  packet.approval.line?.kind === 'client_signed' && packet.approval.line?.hash === '0123456789abcdef');
expect('timeline sorted ascending with plain labels, unknown -> Other record', packet.approval.timeline.map(t => t.label), [
  'Other record', 'Signed by the client in the portal', 'Schedule moved for this change order',
]);
expect('unknown action keeps its detail', packet.approval.timeline[0]?.detail, 'Sent by email');
expect('portal times copied', packet.approval.portal, { sentAt: at('2026-09-11'), viewedAt: at('2026-09-12') });

// ── schedule ─────────────────────────────────────────────────────────────────
console.log('\nschedule:');
expect('applied statement', packet.schedule.statement, 'This change order added 3 days to the schedule.');
expect('anchor and affected titles resolve; a gone task says so', [packet.schedule.anchorTaskTitle, packet.schedule.affectedTaskTitles],
  ['Framing', ['Framing', 'A task that is no longer on the schedule']]);
expect('reflows: the CO entry and the schedule history entry for this CO', packet.schedule.reflows.length, 2);
expect('preview note always present', packet.schedule.previewNote, 'The preview shown before approval is not saved. This is the change as recorded.');
expect('cloud, complete history -> no audit note', packet.schedule.auditNote, null);
{
  const s = (patch: Partial<ChangeOrder>, audit?: Input['scheduleAudit']) => {
    const f = fixture();
    f.co = { ...f.co, ...patch };
    if (audit !== undefined) f.scheduleAudit = audit;
    return P.buildCoProofPacket(f).schedule;
  };
  expect('no days recorded', s({ scheduleImpactDays: undefined, scheduleImpactApplied: false }).statement,
    'No schedule impact is recorded on this change order.');
  expect('days, not applied', s({ scheduleImpactApplied: false }).statement,
    'This change order records +3 days. The schedule has not been moved for it yet.');
  expect('one day reads as a real singular', s({ scheduleImpactDays: 1 }).statement, 'This change order added 1 day to the schedule.');
  expect('audit null -> could not be read', s({}, null).auditNote, 'The schedule history could not be read for this packet.');
  expect('local-only -> device copy note', s({}, { entries: [], source: 'local-only', truncated: false }).auditNote,
    'Schedule history is this device’s copy. The server copy could not be read.');
  expect('truncated -> older history note', s({}, { entries: [], source: 'cloud', truncated: true }).auditNote,
    'Older schedule history exists beyond what was read.');
}

// ── button gate + title ──────────────────────────────────────────────────────
console.log('\nbutton gate:');
expect('unsaved -> disabled', P.coProofPacketAction({ saved: false, dirty: false, numberHold: null, busy: false }), { enabled: false, reason: 'unsaved' });
expect('number pending -> disabled', P.coProofPacketAction({ saved: true, dirty: false, numberHold: 'pending', busy: false }), { enabled: false, reason: 'number_pending' });
expect('busy -> disabled', P.coProofPacketAction({ saved: true, dirty: false, numberHold: null, busy: true }), { enabled: false, reason: 'busy' });
expect('dirty -> enabled with a note', P.coProofPacketAction({ saved: true, dirty: true, numberHold: null, busy: false }), { enabled: true, reason: 'dirty' });
expect('clean -> enabled', P.coProofPacketAction({ saved: true, dirty: false, numberHold: null, busy: false }), { enabled: true, reason: null });
expect('file title', P.coProofPacketFileTitle(12, 'Henderson remodel'), 'Henderson remodel · CO #12 proof packet');

// ── HTML ─────────────────────────────────────────────────────────────────────
console.log('\nhtml:');
const branding = as<CompanyBranding>({ companyName: 'Sam GC LLC', contactName: '', email: '', phone: '', address: '', licenseNumber: '' });
const SENTINEL = '<!--co-body-sentinel-->';
const resolvedFor = (pk: typeof packet) => pk.photos.items.map(p => ({ id: p.id, src: p.uri, timestamp: p.timestamp }));
const evil = '<script>alert(1)</script>';
{
  const f = fixture();
  f.co = { ...f.co, description: evil };
  f.portalMessages = [...f.portalMessages, pmsg('m_evil', at('2026-09-14'), evil)];
  f.rfis = [...f.rfis, rfi('r9', 9, `CO #12 ${evil}`, evil)];
  const pk = P.buildCoProofPacket(f);
  const html = H.buildCoProofPacketHtml(pk, { project: { name: `Henderson ${evil}` }, branding, coBodyHtml: SENTINEL, photos: resolvedFor(pk) });
  ok('a description of "<script>alert(1)</script>" appears escaped', !html.includes('<script>') && html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  ok('the daily-log excerpt is escaped', html.includes('Issues and delays: &lt;script&gt;'));
  for (const src of Object.values(P.COPROOF_COPY.sources)) ok(`source sentence present: "${src.slice(0, 40)}…"`, html.includes(H_esc(src)));
  ok('the coBodyHtml sentinel appears exactly once', html.split(SENTINEL).length === 2);
  const order = ['Proof Packet', SENTINEL, '>Approval record<', '>Money check<', '>Schedule impact<', '>Photos<', '>Daily logs<', '>RFIs<', '>Messages<', '>Linked records<', 'Change order #12 proof packet'];
  const pos = order.map(s => html.indexOf(s));
  ok('sections print in the contract order', pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), JSON.stringify(pos));
  ok('the how-built box says no AI', html.includes(H_esc('Nothing in it was written by AI.')));
  ok('evidence window line', html.includes('Evidence window: Sep 7, 2026 to Sep 15, 2026'));
  ok('incident count sentence (singular)', html.includes('1 incident photo from this window is kept off this packet.'));
  ok('approved pill on the cover', html.includes('&#10003;&nbsp;Approved'));
  ok('money printed through fmtMoney in cents', html.includes('Line items add to $2,000.00.') && html.includes('Counter offer $19.99'));
  ok('every included photo states its reason', pk.photos.items.every(p => html.includes(H_esc(P.COPROOF_REASON_LABEL[p.reason]))));
  ok('<title> is the file title', html.includes(`<title>${H_esc(P.coProofPacketFileTitle(12, `Henderson ${evil}`))}</title>`));
}
{
  const empty = fixture();
  empty.photos = []; empty.dailyReports = []; empty.rfis = []; empty.portalMessages = []; empty.commEvents = [];
  empty.fieldTickets = []; empty.delayEvents = [];
  const pk = P.buildCoProofPacket(empty);
  const html = H.buildCoProofPacketHtml(pk, { project: { name: 'Empty job' }, branding, coBodyHtml: SENTINEL, photos: [] });
  for (const e of Object.values(P.COPROOF_COPY.empty)) ok(`empty sentence present when empty: "${e.slice(0, 40)}…"`, html.includes(H_esc(e)));
  ok('empty sections never print "none"', !/>\s*none\s*</i.test(html));
  const nc = fixture(); nc.photosLoaded = false;
  const pkNc = P.buildCoProofPacket(nc);
  const htmlNc = H.buildCoProofPacketHtml(pkNc, { project: { name: 'Job' }, branding, coBodyHtml: SENTINEL, photos: [] });
  ok('not-checked prints its own sentence, not the empty one',
    htmlNc.includes(H_esc(P.COPROOF_COPY.notChecked.photos)) && !htmlNc.includes(H_esc(P.COPROOF_COPY.empty.photos)));
}
{
  const many = fixture();
  many.photos = Array.from({ length: 13 }, (_, i) => photo(`pm${String(i).padStart(2, '0')}`, at('2026-09-12', `${String(i + 1).padStart(2, '0')}:00`)));
  many.fieldTickets = []; many.delayEvents = []; many.rfis = [];
  const pk = P.buildCoProofPacket(many);
  const html = H.buildCoProofPacketHtml(pk, { project: { name: 'Job' }, branding, coBodyHtml: SENTINEL, photos: resolvedFor(pk) });
  expect('13 photos with src -> 12 <img>', (html.match(/<img /g) ?? []).length, 12);
  ok('…plus "12 of 13 photos are shown"', html.includes('12 of 13 photos are shown. The rest are listed below.'));
  // The REAL resolver shape: resolveDfrPhotosForDocument only loads the first
  // DFR_PDF_MAX_PHOTOS and returns every later photo with src null (never
  // attempted). Those must be listed, never tiled as "could not be loaded".
  const big = fixture();
  big.photos = Array.from({ length: 30 }, (_, i) => photo(`pb${String(i).padStart(2, '0')}`,
    at('2026-09-12', `${String(Math.floor(i / 2) + 1).padStart(2, '0')}:${i % 2 ? '30' : '00'}`),
    i === 29 ? { location: '<b>Attic</b>' } : {}));
  big.fieldTickets = []; big.delayEvents = []; big.rfis = [];
  const pkBig = P.buildCoProofPacket(big);
  const realShape = pkBig.photos.items.map((p, i) => i < P.COPROOF_MAX_EMBEDDED_PHOTOS
    ? { id: p.id, src: p.uri, timestamp: p.timestamp, notUploaded: false }
    : { id: p.id, src: null, timestamp: p.timestamp, notUploaded: false });
  const htmlBig = H.buildCoProofPacketHtml(pkBig, { project: { name: 'Job' }, branding, coBodyHtml: SENTINEL, photos: realShape });
  expect('real resolver shape: 30 items in the section', pkBig.photos.items.length, 30);
  expect('real resolver shape: 12 <img>', (htmlBig.match(/<img /g) ?? []).length, 12);
  ok('real resolver shape: no "could not be loaded" tile past the cap', !htmlBig.includes('This photo could not be loaded for the packet.'));
  ok('real resolver shape: "12 of 30 photos are shown"', htmlBig.includes('12 of 30 photos are shown. The rest are listed below.'));
  ok('overflow list escapes the caption', htmlBig.includes('&lt;b&gt;Attic&lt;/b&gt;') && !htmlBig.includes('<b>Attic</b>'));
  // Text tiles count as shown: 12 tiles where some are stated gaps still say 12.
  const gapShape = realShape.map((r, i) => (i < 3 ? { ...r, src: null, notUploaded: true } : r));
  const htmlGap = H.buildCoProofPacketHtml(pkBig, { project: { name: 'Job' }, branding, coBodyHtml: SENTINEL, photos: gapShape });
  ok('stated-gap tiles count as shown ("12 of 30")', htmlGap.includes('12 of 30 photos are shown.') && (htmlGap.match(/<img /g) ?? []).length === 9);
  const pk2 = { ...pk, photos: { ...pk.photos, items: pk.photos.items.slice(0, 3) } };
  const html2 = H.buildCoProofPacketHtml(pk2, { project: { name: 'Job' }, branding, coBodyHtml: SENTINEL, photos: [
    { id: pk2.photos.items[0].id, src: null, notUploaded: true },
    { id: pk2.photos.items[1].id, src: null },
    { id: pk2.photos.items[2].id, src: 'https://cdn.example/x.jpg', overBudget: true },
  ] });
  ok('src null + notUploaded prints the not-uploaded sentence', html2.includes('Not uploaded yet. It is only on the phone that took it.'));
  ok('src null prints the could-not-load sentence', html2.includes('This photo could not be loaded for the packet.'));
  ok('overBudget prints the size-limit sentence, no image', html2.includes('Not printed. This packet reached its size limit.') && !html2.includes('<img '));
}

// ── source scans ─────────────────────────────────────────────────────────────
console.log('\nsource:');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
for (const f of ['utils/coProofPacket.ts', 'utils/coProofPacketHtml.ts']) {
  const code = stripComments(read(f));
  ok(`${f}: no '$' + concatenation`, !/'\$'\s*\+/.test(code) && !/"\$"\s*\+/.test(code));
  const literals = [
    ...(code.match(/'(?:[^'\\\n]|\\.)*'/g) ?? []),
    ...(code.match(/"(?:[^"\\\n]|\\.)*"/g) ?? []),
    ...((code.match(/`(?:[^`\\]|\\.)*`/g) ?? []).map(t => t.replace(/\$\{[^}]*\}/g, ''))),
  ];
  const bang = literals.filter(l => l.includes('!'));
  ok(`${f}: no "!" in copy strings`, bang.length === 0, bang.slice(0, 3).join(' | '));
  ok(`${f}: no AI, storage, network or clock`, !/supabase|AsyncStorage|fetch\(|Date\.now\(|new Date\(\)|from 'react'/.test(code));
}

function H_esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ── other timezones ──────────────────────────────────────────────────────────
if (!process.env[TZ_CHILD_FLAG]) {
  for (const tz of ['America/Denver', 'Asia/Tokyo']) {
    const r = spawnSync(process.execPath, ['run', SELF], { env: { ...process.env, TZ: tz, [TZ_CHILD_FLAG]: '1' }, encoding: 'utf8' });
    const last = (r.stdout ?? '').trim().split('\n').pop() ?? '';
    ok(`same result under TZ ${tz}`, r.status === 0, `${last}\n${(r.stdout ?? '').split('\n').filter(l => l.includes('✗')).slice(0, 5).join('\n')}${r.stderr ?? ''}`);
  }
}

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-co-proof-packet: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
