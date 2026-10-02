// utils/coProofPacket.ts — the change order proof packet, as data.
//
// Given a change order and the job's records already on the device, this
// computes everything a "proof packet" prints: the CO's approval record, a
// money check in whole cents, its schedule impact, and every photo, daily log,
// RFI, message, field ticket and delay event tied to it. Each item says WHY it
// is included (CoProofReason) and each section says WHERE its rows came from.
//
// PURE. No storage, no network, no React, no clock: the caller injects
// `generatedAt`, and the same input always gives a deep-equal packet. The
// input is never mutated (scripts/validate-co-proof-packet.ts deep-freezes it).
// utils/coProofPacketHtml.ts renders the packet; the proof-screen lane does
// the I/O and the share sheet.
//
// No AI anywhere. Nothing is summarised, guessed or reworded: text is copied
// from the record (the HTML layer escapes it).
//
// HONESTY RULES this module holds (each has a planted mutation in the validator):
//   - Only field tickets (convertedChangeOrderId) and delay events
//     (changeOrderId) are real LINKS to a change order. Everything else is
//     included by a stated heuristic (named in the text, inside the evidence
//     window, tagged to a task the CO moves) and says so.
//   - An incident photo (DFRPhoto.incidentPhoto, "kept off the client portal")
//     never prints; the photos section carries how many were kept off.
//   - A private activity event (CommunicationEvent.isPrivate) is never
//     included and never counted.
//   - A section whose source had not loaded says "not checked", never "none".
//   - Money crosses into the packet as integer cents only.
//   - Approver emails are not copied.
import type {
  ChangeOrder,
  ChangeOrderStatus,
  CommunicationEvent,
  DailyFieldReport,
  DelayEvent,
  FieldTicket,
  FieldTicketPhoto,
  PortalMessage,
  ProjectPhoto,
  RFI,
  ScheduleAuditEntry,
} from '@/types';
import { coApprovalLine, type CoApprovalLine } from '@/utils/coApproval';
import { CO_REFLOW_ACTION, CO_REFLOW_UNANCHORED_ACTION } from '@/utils/coScheduleReflowCore';
import { FIELD_TICKET_CO_ACTION } from '@/utils/fieldTicketCore';
import { CAUSE_LABEL, CLASSIFICATION_LABEL, formatDelayEventNumber } from '@/utils/noticeClock';
import { DFR_PDF_MAX_PHOTOS } from '@/utils/pdfGenerator';
import {
  addCalendarDays,
  calendarDayOf,
  parseCalendarDay,
  toCalendarDayString,
} from '@/utils/calendarDate';

// ── Constants ────────────────────────────────────────────────────────────────

/** Days before the earliest of the CO's own dates the evidence window opens. */
export const COPROOF_WINDOW_BEFORE_DAYS = 3;
/** Days after the CO's date the evidence window closes at the latest. */
export const COPROOF_WINDOW_AFTER_DAYS = 14;
/** The most photos one packet embeds as images; the rest are listed. */
export const COPROOF_MAX_EMBEDDED_PHOTOS: number = DFR_PDF_MAX_PHOTOS;

/** The CO revision action app/change-order.tsx writes (not exported there,
 *  and this module never imports a route file). */
const CO_REVISION_ACTION = 'revision_of_declined';

/**
 * Plain-English labels for the CO audit actions that have a writer today
 * (each verified by grep on c5cf89fb): the portal RPC's sealed pair, the
 * reconciler's three, context-records' manual mark, the reflow core's two,
 * the field-ticket conversion and the CO screen's revision. Anything else
 * prints as 'Other record' with its detail kept.
 */
export const COPROOF_AUDIT_LABELS: Record<string, string> = {
  client_signed_via_portal: 'Signed by the client in the portal',
  client_declined_via_portal: 'Declined by the client in the portal',
  approved_via_portal: 'Approved in the client portal',
  declined_via_portal: 'Declined in the client portal',
  portal_decision_applied: 'Portal decision applied',
  marked_approved: 'Marked approved',
  [CO_REFLOW_ACTION]: 'Schedule moved for this change order',
  [CO_REFLOW_UNANCHORED_ACTION]: 'Schedule days recorded, not yet placed on a task',
  [FIELD_TICKET_CO_ACTION]: 'Created from a field ticket',
  [CO_REVISION_ACTION]: 'Started as a revision of a declined change order',
};
export const COPROOF_OTHER_AUDIT_LABEL = 'Other record';

export type CoProofReason =
  | 'field_ticket' | 'delay_event' | 'rfi_source' | 'affected_task'
  | 'mentions_co' | 'in_window' | 'decision_window' | 'linked';

export const COPROOF_REASON_LABEL: Record<CoProofReason, string> = {
  field_ticket: 'From a field ticket on this change order',
  delay_event: 'Evidence on a linked delay event',
  rfi_source: 'Photo an included RFI was raised from',
  affected_task: 'Tagged to a task this change order moves',
  mentions_co: 'Names this change order',
  in_window: 'Taken in the evidence window',
  decision_window: 'Sent while this change order waited for a decision',
  linked: 'Linked to this change order',
};

/** Section copy (exact English; the packet stays English per docs/I18N.md §PDFs). */
export const COPROOF_COPY = {
  titles: {
    approval: 'Approval record',
    money: 'Money check',
    schedule: 'Schedule impact',
    photos: 'Photos',
    dailyLogs: 'Daily logs',
    rfis: 'RFIs',
    messages: 'Messages',
    linked: 'Linked records',
  },
  sources: {
    photos: 'From this job’s photo gallery in MAGE ID, as synced to this device.',
    dailyLogs: 'From this job’s daily logs in MAGE ID, as synced to this device.',
    rfis: 'From this job’s RFI log in MAGE ID. An RFI is included only when it is linked to or names this change order.',
    messages: 'From the client portal messages on this job, and the job’s activity log. Internal notes are not included.',
    linked: 'Field tickets and delay events that point to this change order.',
    schedule: 'From this change order’s record and the job’s schedule history.',
    approval: 'From this change order’s approval record and history.',
    money: 'Computed in whole cents from the line items and the amounts recorded on this change order.',
  },
  empty: {
    photos: 'No photos in this window.',
    dailyLogs: 'No daily logs in this window.',
    rfis: 'No RFIs are linked to or name this change order.',
    messages: 'No messages name this change order or were sent while it waited for a decision.',
    linked: 'No field tickets or delay events point to this change order.',
  },
  notChecked: {
    photos: 'Photos had not finished loading on this device, so they were not checked.',
    dailyLogs: 'Daily logs had not finished loading on this device, so they were not checked.',
    /** Privacy: a gallery photo is known to be an incident photo only from the
     *  daily logs. Without them no photo can be cleared to print. */
    photosNoLogs: 'Daily logs had not finished loading on this device, so photos could not be checked for incident photos and were left out.',
  },
  schedule: {
    none: 'No schedule impact is recorded on this change order.',
    auditUnread: 'The schedule history could not be read for this packet.',
    auditLocal: 'Schedule history is this device’s copy. The server copy could not be read.',
    auditTruncated: 'Older schedule history exists beyond what was read.',
    preview: 'The preview shown before approval is not saved. This is the change as recorded.',
    taskGone: 'A task that is no longer on the schedule',
    taskNoSchedule: 'A task on a schedule this device had not loaded',
  },
} as const;

// ── Contracts ────────────────────────────────────────────────────────────────

export interface CoProofDecline { who: string; when: string | null; reason: string | null }

export interface CoProofInput {
  co: ChangeOrder;
  project: { id: string; name: string; location?: string; schedule?: { tasks?: { id: string; title: string }[] } | null };
  photos: ProjectPhoto[];          photosLoaded: boolean;
  dailyReports: DailyFieldReport[]; dailyReportsLoaded: boolean;
  rfis: RFI[];
  portalMessages: PortalMessage[];
  commEvents: CommunicationEvent[];
  fieldTickets: FieldTicket[];
  delayEvents: DelayEvent[];
  scheduleAudit: { entries: ScheduleAuditEntry[]; source: 'cloud' | 'local-only'; truncated: boolean } | null;
  declineLine: CoProofDecline | null;
  /** ISO instant, injected by the caller. */
  generatedAt: string;
}

export interface CoProofPhotoItem {
  id: string; reason: CoProofReason; timestamp: string;
  // the fields resolveDfrPhotosForDocument needs (DFRPhoto-compatible):
  uri: string; storagePath?: string; localUri?: string; locationLabel?: string;
  /** ProjectPhoto.location, else locationLabel. */
  caption?: string;
}

export interface CoProofSection<T> {
  key: 'photos' | 'dailyLogs' | 'rfis' | 'messages' | 'linked';
  title: string; source: string; items: T[];
  empty: string | null; notChecked: string | null;
}

export interface CoProofDailyLogItem { id: string; day: string; status: string; reason: CoProofReason; excerpt: string }
export interface CoProofRfiItem {
  id: string; number: number; subject: string; status: string; reason: CoProofReason;
  dateSubmitted: string; dateResponded: string | null; question: string; response: string | null;
}
export interface CoProofMessageItem { id: string; at: string; from: string; body: string; reason: CoProofReason; kind: 'portal' | 'activity' }
export interface CoProofLinkedItem { id: string; kind: 'field_ticket' | 'delay_event'; label: string; day: string; detail: string }

export interface CoProofPacket {
  coId: string; coNumber: number; status: ChangeOrderStatus; generatedAt: string;
  window: { startDay: string; endDay: string; decisionDay: string | null };
  money: { changeCents: number; lineSumCents: number; taxCents: number | null;
           totalWithTaxCents: number | null; contractBeforeCents: number;
           newContractCents: number;
           lineMismatch: { lineSumCents: number; recordedCents: number } | null };
  approval: { line: CoApprovalLine | null; decline: CoProofDecline | null;
              approvers: { name: string; role: string; status: string; responseDate: string | null;
                           rejectionReason: string | null; counterCents: number | null }[];
              portal: { sentAt: string | null; viewedAt: string | null };
              timeline: { at: string; label: string; actor: string; detail: string | null }[] };
  schedule: { impactDays: number | null; applied: boolean; anchorTaskTitle: string | null;
              affectedTaskTitles: string[]; reflows: { at: string; summary: string }[];
              statement: string; auditNote: string | null; previewNote: string };
  photos: CoProofSection<CoProofPhotoItem> & { excludedIncidentCount: number };
  dailyLogs: CoProofSection<CoProofDailyLogItem>;
  rfis: CoProofSection<CoProofRfiItem>;
  messages: CoProofSection<CoProofMessageItem>;
  linked: CoProofSection<CoProofLinkedItem>;
}

// ── Small pure helpers ───────────────────────────────────────────────────────

/** Dollars to integer cents, ONCE, at the boundary. Non-finite becomes 0. */
export function toCents(n: number | null | undefined): number {
  if (n == null) return 0;
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  // `+ 0` folds -0 into 0 so a zero never carries a sign into the packet.
  return Math.round(v * 100) + 0;
}

/**
 * "CO #12", "CO 12", "CO-12", "CO-012", "co#12", "change order 12",
 * "Change Order #12", "change order no. 12" — and never "CO #120", "CO #112",
 * "COVID 12", "CO2" or "CO #1" for n = 12. Case-insensitive, word-bounded on
 * both sides, leading zeros allowed. A fresh RegExp per call (no `g` flag, so
 * no lastIndex state leaks between tests).
 */
export function coMentionPattern(n: number): RegExp {
  if (!Number.isFinite(n) || n < 1 || Math.trunc(n) !== n) return /(?!)/;
  return new RegExp(`\\b(?:co|change[\\s-]+order)\\s*(?:no\\.?\\s*|#\\s*|-\\s*)?0*${n}\\b`, 'i');
}

/** Clip on a word boundary with an ellipsis. */
function clipWords(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  let cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  if (space > max * 0.6) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

/** Is `text` naming this change order? */
function mentions(text: string | null | undefined, re: RegExp): boolean {
  return !!text && re.test(text);
}

/** The sentence(s) of `text` that contain a mention, in order, joined. A
 *  sentence ends at . ! or ? followed by whitespace, or at a line break. */
function mentionSentences(text: string, re: RegExp): string {
  const global = new RegExp(re.source, 'gi');
  const isEnd = (i: number) =>
    text[i] === '\n' || (/[.!?]/.test(text[i]) && (i + 1 >= text.length || /\s/.test(text[i + 1])));
  const ranges: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = global.exec(text)) !== null) {
    let s = m.index;
    while (s > 0 && !isEnd(s - 1)) s--;
    let e = m.index + m[0].length;
    while (e < text.length && !isEnd(e)) e++;
    if (e < text.length && text[e] !== '\n') e++; // keep the closing punctuation
    const last = ranges[ranges.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else ranges.push([s, e]);
    if (m[0].length === 0) global.lastIndex++;
  }
  return ranges.map(([s, e]) => text.slice(s, e).trim()).filter(Boolean).join(' ');
}

/** ms of an instant; a bare calendar day reads as its local start (or end). */
function instantMs(value: string | null | undefined, endOfDay = false): number | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = parseCalendarDay(value);
    if (!d) return null;
    return endOfDay ? addCalendarDays(d, 1).getTime() - 1 : d.getTime();
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function shiftDay(day: string, days: number): string {
  const d = parseCalendarDay(day);
  return d ? toCalendarDayString(addCalendarDays(d, days)) : day;
}

const minDay = (a: string, b: string) => (a <= b ? a : b);
const maxDay = (a: string, b: string) => (a >= b ? a : b);

/** Inclusive on both ends. */
function dayInWindow(day: string | null, w: { startDay: string; endDay: string }): boolean {
  return !!day && day >= w.startDay && day <= w.endDay;
}

function sameProject<T extends { projectId?: string }>(rows: readonly T[] | null | undefined, projectId: string): T[] {
  return (rows ?? []).filter(r => !!r && (!projectId || !r.projectId || r.projectId === projectId));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function linkedTickets(input: CoProofInput): FieldTicket[] {
  return sameProject(input.fieldTickets, input.co.projectId).filter(t => t.convertedChangeOrderId === input.co.id);
}

function linkedDelays(input: CoProofInput): DelayEvent[] {
  return sameProject(input.delayEvents, input.co.projectId).filter(d => d.changeOrderId === input.co.id);
}

function delayEvidenceIds(delays: readonly DelayEvent[], kind: 'photo' | 'daily_report' | 'rfi'): Set<string> {
  const out = new Set<string>();
  for (const d of delays) for (const e of d.evidence ?? []) if (e && e.kind === kind && e.id) out.add(e.id);
  return out;
}

// ── Window ───────────────────────────────────────────────────────────────────

/**
 * The evidence window, as calendar days (both ends inclusive):
 *   start = earliest of [the CO's date, its createdAt, each linked field
 *           ticket's date, each linked delay's first-observed date] − 3 days;
 *   end   = min(the decision day, else the generated day; the CO's day + 14),
 *           never earlier than the CO's day.
 * Unparseable dates are skipped, never coerced to today.
 */
export function coProofWindow(input: CoProofInput): { startDay: string; endDay: string; decisionDay: string | null } {
  const { co } = input;
  const generatedDay = calendarDayOf(input.generatedAt) ?? '';
  const coDay = calendarDayOf(co.date) ?? calendarDayOf(co.createdAt) ?? generatedDay;

  const starts = [
    calendarDayOf(co.date),
    calendarDayOf(co.createdAt),
    ...linkedTickets(input).map(t => calendarDayOf(t.date)),
    ...linkedDelays(input).map(d => calendarDayOf(d.firstObservedDate)),
  ].filter((d): d is string => !!d);
  const earliest = starts.length ? starts.reduce(minDay) : coDay;
  const startDay = shiftDay(earliest, -COPROOF_WINDOW_BEFORE_DAYS);

  let decisionDay: string | null = null;
  if (co.status === 'approved') decisionDay = coApprovalLine(co)?.day ?? null;
  else if (co.status === 'rejected') decisionDay = calendarDayOf(input.declineLine?.when ?? null);

  const cap = shiftDay(coDay, COPROOF_WINDOW_AFTER_DAYS);
  const endDay = maxDay(coDay, minDay(decisionDay ?? (generatedDay || cap), cap));
  return { startDay, endDay, decisionDay };
}

/** The instant the decision was recorded: the evidence coApprovalLine read,
 *  or the decline's own time; null when undecided. */
function decisionInstantMs(input: CoProofInput, line: CoApprovalLine | null): number | null {
  const { co } = input;
  const newest = (action: string) => (co.auditTrail ?? [])
    .filter(e => e && e.action === action)
    .map(e => instantMs(e.timestamp))
    .filter((v): v is number => v != null)
    .reduce<number | null>((a, b) => (a == null || b > a ? b : a), null);
  if (co.status === 'approved' && line) {
    if (line.kind === 'client_signed') return newest('client_signed_via_portal');
    if (line.kind === 'client_portal') return newest('approved_via_portal');
    if (line.kind === 'manual') return newest('marked_approved') ?? instantMs(line.day ?? null, true);
    const approver = (co.approvers ?? [])
      .filter(a => a.role === 'Client' && a.status === 'approved')
      .map(a => instantMs(a.responseDate ?? null, true))
      .filter((v): v is number => v != null)
      .reduce<number | null>((a, b) => (a == null || b > a ? b : a), null);
    return approver ?? instantMs(line.day ?? null, true);
  }
  if (co.status === 'rejected') return instantMs(input.declineLine?.when ?? null, true);
  return null;
}

// ── Gate + title (the screen's button) ──────────────────────────────────────

/** The proof-packet button: disabled until the CO is saved and numbered and
 *  while a build runs; enabled with a 'dirty' note when there are unsaved
 *  edits (the packet prints the saved record). */
export function coProofPacketAction(o: { saved: boolean; dirty: boolean; numberHold: string | null; busy: boolean }):
  { enabled: boolean; reason: null | 'unsaved' | 'number_pending' | 'dirty' | 'busy' } {
  if (!o.saved) return { enabled: false, reason: 'unsaved' };
  if (o.numberHold) return { enabled: false, reason: 'number_pending' };
  if (o.busy) return { enabled: false, reason: 'busy' };
  if (o.dirty) return { enabled: true, reason: 'dirty' };
  return { enabled: true, reason: null };
}

/** "<project> · CO #N proof packet" — the share-sheet title and HTML <title>. */
export function coProofPacketFileTitle(coNumber: number, projectName: string): string {
  const name = (projectName ?? '').trim();
  const tail = `CO #${coNumber} proof packet`;
  return name ? `${name} · ${tail}` : tail;
}

// ── Sections ─────────────────────────────────────────────────────────────────

function section<T>(
  key: CoProofSection<T>['key'], items: T[], notChecked: string | null,
): CoProofSection<T> {
  return {
    key,
    title: COPROOF_COPY.titles[key],
    source: COPROOF_COPY.sources[key],
    items: notChecked ? [] : items,
    empty: notChecked ? null : items.length === 0 ? COPROOF_COPY.empty[key] : null,
    notChecked,
  };
}

const RFI_STATUS_LABEL: Record<string, string> = { open: 'Open', answered: 'Answered', closed: 'Closed', void: 'Void' };
const TICKET_STATUS_LABEL: Record<string, string> = { draft: 'Draft', signed: 'Signed', converted: 'Converted', void: 'Void' };

function buildRfis(input: CoProofInput, re: RegExp, affected: Set<string>, delays: DelayEvent[]): CoProofRfiItem[] {
  const evidence = delayEvidenceIds(delays, 'rfi');
  const out: CoProofRfiItem[] = [];
  const seen = new Set<string>();
  for (const r of sameProject(input.rfis, input.co.projectId)) {
    if (!r.id || seen.has(r.id)) continue;
    const reason: CoProofReason | null =
      evidence.has(r.id) ? 'delay_event'
      : mentions(r.subject, re) || mentions(r.question, re) || mentions(r.response, re) ? 'mentions_co'
      : r.linkedTaskId && affected.has(r.linkedTaskId) ? 'affected_task'
      : null;
    if (!reason) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      number: r.number,
      subject: r.subject ?? '',
      status: RFI_STATUS_LABEL[r.status] ?? 'Status not set',
      reason,
      dateSubmitted: r.dateSubmitted ?? '',
      dateResponded: r.dateResponded ?? null,
      question: clipWords(r.question ?? '', 600),
      response: r.response ? clipWords(r.response, 600) : null,
    });
  }
  return out.sort((a, b) =>
    String(a.dateSubmitted).localeCompare(String(b.dateSubmitted)) || a.number - b.number || a.id.localeCompare(b.id));
}

function buildPhotos(
  input: CoProofInput, window: { startDay: string; endDay: string },
  affected: Set<string>, tickets: FieldTicket[], delays: DelayEvent[], rfis: CoProofRfiItem[],
): { items: CoProofPhotoItem[]; excludedIncidentCount: number } {
  // Incident evidence is known only from the daily logs that hold it.
  const incident = new Set<string>();
  for (const r of input.dailyReports ?? []) {
    for (const p of r?.photos ?? []) if (p && p.incidentPhoto === true && p.id) incident.add(p.id);
  }
  const ticketPhotos = new Map<string, FieldTicketPhoto>();
  for (const t of tickets) for (const p of t.photos ?? []) if (p && p.id && !ticketPhotos.has(p.id)) ticketPhotos.set(p.id, p);
  const delayPhotos = delayEvidenceIds(delays, 'photo');
  const rfiPhotos = new Set<string>();
  const rfiIds = new Set(rfis.map(r => r.id));
  for (const r of input.rfis ?? []) if (r && rfiIds.has(r.id) && r.sourcePhotoId) rfiPhotos.add(r.sourcePhotoId);

  const reasonFor = (id: string, linkedTaskId: string | undefined, day: string | null): CoProofReason | null => {
    if (ticketPhotos.has(id)) return 'field_ticket';
    if (delayPhotos.has(id)) return 'delay_event';
    if (rfiPhotos.has(id)) return 'rfi_source';
    const inWindow = dayInWindow(day, window);
    if (inWindow && linkedTaskId && affected.has(linkedTaskId)) return 'affected_task';
    if (inWindow) return 'in_window';
    return null;
  };

  const byId = new Map<string, CoProofPhotoItem>();
  const excluded = new Set<string>();
  const consider = (item: Omit<CoProofPhotoItem, 'reason'>, linkedTaskId: string | undefined) => {
    if (!item.id || byId.has(item.id) || excluded.has(item.id)) return;
    const reason = reasonFor(item.id, linkedTaskId, calendarDayOf(item.timestamp));
    if (!reason) return;
    // Incident evidence never prints; the section says how many were kept off.
    if (incident.has(item.id)) {
      excluded.add(item.id);
      return;
    }
    byId.set(item.id, { ...item, reason });
  };

  for (const p of sameProject(input.photos, input.co.projectId)) {
    consider({
      id: p.id,
      timestamp: p.timestamp ?? p.createdAt ?? '',
      uri: p.uri ?? '',
      ...(p.storagePath ? { storagePath: p.storagePath } : {}),
      ...(p.localUri ? { localUri: p.localUri } : {}),
      ...(p.locationLabel ? { locationLabel: p.locationLabel } : {}),
      ...((p.location || p.locationLabel) ? { caption: (p.location || p.locationLabel) as string } : {}),
    }, p.linkedTaskId);
  }
  // A field-ticket photo that never reached the gallery is still evidence.
  for (const [, p] of ticketPhotos) {
    consider({
      id: p.id,
      timestamp: p.timestamp ?? '',
      uri: p.uri ?? '',
      ...(p.storagePath ? { storagePath: p.storagePath } : {}),
      ...(p.localUri ? { localUri: p.localUri } : {}),
      ...(p.locationLabel ? { locationLabel: p.locationLabel, caption: p.locationLabel } : {}),
    }, undefined);
  }

  const items = [...byId.values()];
  items.sort((a, b) => {
    const ta = instantMs(a.timestamp) ?? 0;
    const tb = instantMs(b.timestamp) ?? 0;
    return ta - tb || a.id.localeCompare(b.id);
  });
  return { items, excludedIncidentCount: excluded.size };
}

function buildDailyLogs(
  input: CoProofInput, re: RegExp, window: { startDay: string; endDay: string },
  tickets: FieldTicket[], delays: DelayEvent[],
): CoProofDailyLogItem[] {
  const fromDelay = delayEvidenceIds(delays, 'daily_report');
  const fromTicket = new Set(tickets.map(t => t.sourceDailyReportId).filter((v): v is string => !!v));
  const out: CoProofDailyLogItem[] = [];
  const seen = new Set<string>();
  for (const r of sameProject(input.dailyReports, input.co.projectId)) {
    if (!r.id || seen.has(r.id)) continue;
    const day = calendarDayOf(r.date);
    const named = mentions(r.workPerformed, re) || mentions(r.issuesAndDelays, re);
    const reason: CoProofReason | null =
      fromTicket.has(r.id) ? 'field_ticket'
      : fromDelay.has(r.id) ? 'delay_event'
      : named ? 'mentions_co'
      : dayInWindow(day, window) ? 'in_window'
      : null;
    if (!reason) continue;
    seen.add(r.id);
    let excerpt: string;
    if (reason === 'mentions_co') {
      excerpt = clipWords(
        [mentionSentences(r.workPerformed ?? '', re), mentionSentences(r.issuesAndDelays ?? '', re)]
          .filter(Boolean).join(' '),
        1200,
      ) || clipWords([r.workPerformed, r.issuesAndDelays].filter(Boolean).join('\n'), 400);
    } else {
      excerpt = [
        r.workPerformed?.trim() ? `Work performed: ${clipWords(r.workPerformed, 400)}` : '',
        r.issuesAndDelays?.trim() ? `Issues and delays: ${clipWords(r.issuesAndDelays, 400)}` : '',
      ].filter(Boolean).join('\n') || 'No narrative recorded.';
    }
    out.push({ id: r.id, day: day ?? String(r.date ?? ''), status: r.status, reason, excerpt });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
}

function buildMessages(input: CoProofInput, re: RegExp, coDay: string, line: CoApprovalLine | null): CoProofMessageItem[] {
  const { co } = input;
  const sendMs = instantMs(co.portalState?.sentAt ?? null) ?? instantMs(coDay) ?? Number.NEGATIVE_INFINITY;
  const decisionMs = decisionInstantMs(input, line) ?? instantMs(input.generatedAt) ?? Number.POSITIVE_INFINITY;
  const out: CoProofMessageItem[] = [];
  const seen = new Set<string>();

  for (const m of sameProject(input.portalMessages, co.projectId)) {
    if (!m.id || seen.has(`p:${m.id}`)) continue;
    const at = instantMs(m.createdAt);
    const reason: CoProofReason | null =
      mentions(m.body, re) ? 'mentions_co'
      : at != null && at >= sendMs && at <= decisionMs ? 'decision_window'
      : null;
    if (!reason) continue;
    seen.add(`p:${m.id}`);
    out.push({
      id: m.id,
      at: m.createdAt,
      from: m.authorName?.trim() || (m.authorType === 'client' ? 'Client' : 'Contractor'),
      body: clipWords(m.body ?? '', 1200),
      reason,
      kind: 'portal',
    });
  }

  // Activity log: public events that name this CO, and nothing else. A
  // private event (an internal note) is never read past this filter.
  for (const e of sameProject(input.commEvents, co.projectId)) {
    if (!e || e.isPrivate !== false) continue;
    if (!e.id || seen.has(`a:${e.id}`)) continue;
    if (!mentions(e.summary, re) && !mentions(e.detail, re)) continue;
    seen.add(`a:${e.id}`);
    out.push({
      id: e.id,
      at: e.timestamp,
      from: e.actor?.trim() || 'Not recorded',
      body: clipWords([e.summary, e.detail].filter(s => !!s && s.trim()).join(' · '), 1200),
      reason: 'mentions_co',
      kind: 'activity',
    });
  }

  return out.sort((a, b) =>
    (instantMs(a.at) ?? 0) - (instantMs(b.at) ?? 0) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

function buildLinked(tickets: FieldTicket[], delays: DelayEvent[]): CoProofLinkedItem[] {
  // Same handle as fieldTicketLabel (utils/fieldTicketCore.ts), kept local: importing
  // fieldTicketCore would pull the job-cost engine into this pure model.
  const ticketLabel = (n: number) => `T&M-${String(Math.max(0, Math.floor(Number.isFinite(n) ? n : 0))).padStart(3, '0')}`;
  const items: CoProofLinkedItem[] = [
    ...tickets.map((t): CoProofLinkedItem => ({
      id: t.id,
      kind: 'field_ticket',
      label: `Field ticket ${ticketLabel(t.number)}`,
      day: calendarDayOf(t.date) ?? String(t.date ?? ''),
      detail: [clipWords(t.workDescription ?? '', 400), TICKET_STATUS_LABEL[t.status] ?? 'Status not set']
        .filter(Boolean).join(' · '),
    })),
    ...delays.map((d): CoProofLinkedItem => ({
      id: d.id,
      kind: 'delay_event',
      label: `Delay ${formatDelayEventNumber(Number.isFinite(d.number) ? d.number : 0)}`,
      day: calendarDayOf(d.firstObservedDate) ?? String(d.firstObservedDate ?? ''),
      detail: [
        CAUSE_LABEL[d.cause] ?? 'Other',
        Number.isFinite(d.claimedDays) ? `${plural(d.claimedDays, 'day', 'days')} claimed` : '',
        CLASSIFICATION_LABEL[d.classification] ?? CLASSIFICATION_LABEL.unclassified,
      ].filter(Boolean).join(' · '),
    })),
  ];
  return items.sort((a, b) => a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

function buildSchedule(input: CoProofInput): CoProofPacket['schedule'] {
  const { co } = input;
  const tasks = input.project.schedule?.tasks;
  const titleOf = (id: string): string => {
    if (!Array.isArray(tasks)) return COPROOF_COPY.schedule.taskNoSchedule;
    const t = tasks.find(x => x && x.id === id);
    return t?.title?.trim() || COPROOF_COPY.schedule.taskGone;
  };
  const rawDays = co.scheduleImpactDays;
  const impactDays = typeof rawDays === 'number' && Number.isFinite(rawDays) ? rawDays : null;
  const applied = co.scheduleImpactApplied === true;
  const n = impactDays == null ? 0 : Math.round(impactDays);
  const abs = Math.abs(n);
  const statement = n === 0
    ? COPROOF_COPY.schedule.none
    : n > 0
      ? applied
        ? `This change order added ${plural(abs, 'day', 'days')} to the schedule.`
        : `This change order records +${plural(abs, 'day', 'days')}. The schedule has not been moved for it yet.`
      : applied
        ? `This change order took ${plural(abs, 'day', 'days')} off the schedule.`
        : `This change order records ${plural(abs, 'day', 'days')} fewer. The schedule has not been moved for it yet.`;

  const affectedTaskTitles: string[] = [];
  for (const id of co.scheduleImpactTaskIds ?? []) {
    if (!id) continue;
    const t = titleOf(id);
    if (!affectedTaskTitles.includes(t)) affectedTaskTitles.push(t);
  }

  const reflows: { at: string; summary: string }[] = [];
  const keys = new Set<string>();
  const add = (at: string, summary: string) => {
    const key = `${summary}|${calendarDayOf(at) ?? at}`;
    if (keys.has(key)) return;
    keys.add(key);
    reflows.push({ at, summary });
  };
  for (const e of co.auditTrail ?? []) {
    if (!e || (e.action !== CO_REFLOW_ACTION && e.action !== CO_REFLOW_UNANCHORED_ACTION)) continue;
    add(e.timestamp, e.detail?.trim() || COPROOF_AUDIT_LABELS[e.action]);
  }
  for (const e of input.scheduleAudit?.entries ?? []) {
    if (!e || e.changeOrderId !== co.id) continue;
    add(e.at, e.summary?.trim() || 'Schedule changed for this change order');
  }
  reflows.sort((a, b) => (instantMs(a.at) ?? 0) - (instantMs(b.at) ?? 0) || a.summary.localeCompare(b.summary));

  const sa = input.scheduleAudit;
  const auditNote = sa == null
    ? COPROOF_COPY.schedule.auditUnread
    : [
        sa.source === 'local-only' ? COPROOF_COPY.schedule.auditLocal : '',
        sa.truncated ? COPROOF_COPY.schedule.auditTruncated : '',
      ].filter(Boolean).join(' ') || null;

  return {
    impactDays,
    applied,
    anchorTaskTitle: co.scheduleAnchorTaskId ? titleOf(co.scheduleAnchorTaskId) : null,
    affectedTaskTitles,
    reflows,
    statement,
    auditNote,
    previewNote: COPROOF_COPY.schedule.preview,
  };
}

// ── The packet ───────────────────────────────────────────────────────────────

export function buildCoProofPacket(input: CoProofInput): CoProofPacket {
  const { co } = input;
  const re = coMentionPattern(co.number);
  const window = coProofWindow(input);
  const coDay = calendarDayOf(co.date) ?? calendarDayOf(co.createdAt) ?? (calendarDayOf(input.generatedAt) ?? '');
  const tickets = linkedTickets(input);
  const delays = linkedDelays(input);
  const affected = new Set<string>(
    [...(co.scheduleImpactTaskIds ?? []), co.scheduleAnchorTaskId].filter((v): v is string => !!v),
  );

  // Money, in whole cents from here on.
  const changeCents = toCents(co.changeAmount);
  const lineSumCents = (co.lineItems ?? []).reduce((s, li) => s + toCents(li?.total), 0);
  const taxCents = co.taxAmount == null || toCents(co.taxAmount) === 0 ? null : toCents(co.taxAmount);
  const totalWithTaxCents = co.totalWithTax == null ? null : toCents(co.totalWithTax);

  const line = coApprovalLine(co);
  const timeline = [...(co.auditTrail ?? [])]
    .filter(e => !!e)
    .map((e, i) => ({ e, i }))
    .sort((a, b) =>
      (instantMs(a.e.timestamp) ?? 0) - (instantMs(b.e.timestamp) ?? 0)
      || String(a.e.timestamp ?? '').localeCompare(String(b.e.timestamp ?? ''))
      || a.i - b.i)
    .map(({ e }) => ({
      at: e.timestamp ?? '',
      label: COPROOF_AUDIT_LABELS[e.action] ?? COPROOF_OTHER_AUDIT_LABEL,
      actor: e.actor?.trim() || 'Not recorded',
      detail: e.detail?.trim() ? e.detail : null,
    }));

  const rfis = buildRfis(input, re, affected, delays);
  const photosNotChecked = !input.photosLoaded
    ? COPROOF_COPY.notChecked.photos
    : !input.dailyReportsLoaded
      ? COPROOF_COPY.notChecked.photosNoLogs
      : null;
  const photoBuild: { items: CoProofPhotoItem[]; excludedIncidentCount: number } = photosNotChecked
    ? { items: [], excludedIncidentCount: 0 }
    : buildPhotos(input, window, affected, tickets, delays, rfis);
  const logsNotChecked = input.dailyReportsLoaded ? null : COPROOF_COPY.notChecked.dailyLogs;
  const logs = logsNotChecked ? [] : buildDailyLogs(input, re, window, tickets, delays);

  return {
    coId: co.id,
    coNumber: co.number,
    status: co.status,
    generatedAt: input.generatedAt,
    window,
    money: {
      changeCents,
      lineSumCents,
      taxCents,
      totalWithTaxCents,
      contractBeforeCents: toCents(co.originalContractValue),
      newContractCents: toCents(co.newContractTotal),
      lineMismatch: lineSumCents !== changeCents ? { lineSumCents, recordedCents: changeCents } : null,
    },
    approval: {
      line,
      decline: input.declineLine
        ? { who: input.declineLine.who, when: input.declineLine.when ?? null, reason: input.declineLine.reason ?? null }
        : null,
      approvers: (co.approvers ?? []).filter(a => !!a).map(a => ({
        name: a.name?.trim() || 'Not named',
        role: a.role,
        status: a.status,
        responseDate: a.responseDate ?? null,
        rejectionReason: a.rejectionReason?.trim() ? a.rejectionReason : null,
        counterCents: a.counterAmount == null || !Number.isFinite(a.counterAmount) ? null : toCents(a.counterAmount),
      })),
      portal: { sentAt: co.portalState?.sentAt ?? null, viewedAt: co.portalState?.viewedAt ?? null },
      timeline,
    },
    schedule: buildSchedule(input),
    photos: { ...section('photos', photoBuild.items, photosNotChecked), excludedIncidentCount: photoBuild.excludedIncidentCount },
    dailyLogs: section('dailyLogs', logs, logsNotChecked),
    rfis: section('rfis', rfis, null),
    messages: section('messages', buildMessages(input, re, coDay, line), null),
    linked: section('linked', buildLinked(tickets, delays), null),
  };
}
