// utils/jobFacts/buildJobFacts.ts — the allowlist builder for a job facts link
// (lane FACTS, M2).
//
// The GC's phone builds the page's payload from data already on the device;
// the app writes it into public.job_fact_links and the job-facts-view edge
// function serves it, unchanged, to https://mageid.app/facts/<code>. The owner
// screen previews THIS SAME payload, so what he sees is what the viewer sees.
//
// ALLOWLIST, NOT A FILTER. Every field that leaves here is named below, one by
// one. Nothing is spread from a source record, so a column added to a table
// tomorrow cannot leak through. It never emits: cost, markup, margin, fees,
// line items or contract value; notes, inspector correction notes, approvers,
// emails or user ids; attachment / document URIs (bucket paths carry the
// contractor's auth user id, types/index.ts Permit.attachmentUri).
//
// FACTS, NOT INFERENCES. Every fact carries its source record and its date. A
// fact with no date is LEFT OUT AND COUNTED (leftOut), never back-filled from
// created_at. Planned dates are never shown (a plan is a computation); a
// milestone appears only when it is done AND has a recorded finish date.
//
// PURE: no React, no React Native, no storage, no network. scripts/
// validate-job-facts.ts imports this module and runs the real function.

import type { ChangeOrder, Permit, PermitInspection, ProjectPhoto, ScheduleTask, Warranty } from '@/types';
import { decodePermitInspectionNotes } from '@/utils/permitInspectionHistory';
import { calendarDayOf, parseCalendarDay } from '@/utils/calendarDate';
import { PHOTO_SHARE_MAX, isPhotoShareable } from '@/utils/photoShareToken';
import { humanizeEnum, permitTypeLabel } from '@/utils/statusLabels';
import {
  JOB_FACT_SECTIONS,
  type JobFact,
  type JobFactLeftOut,
  type JobFactSection,
  type JobFactsPayload,
} from './types';

/** At most this many photos on one page (the photo-timeline link's cap). */
export const JOB_FACTS_PHOTO_MAX = PHOTO_SHARE_MAX;

export type JobFactsPermit = Pick<Permit, 'id' | 'type' | 'permitNumber' | 'jurisdiction' | 'status' | 'appliedDate' | 'approvedDate' | 'expiresDate' | 'inspectionNotes' | 'inspections'>;
export type JobFactsChangeOrder = Pick<ChangeOrder, 'id' | 'number' | 'description' | 'status' | 'date' | 'changeAmount' | 'auditTrail'>;
export type JobFactsPhoto = Pick<ProjectPhoto, 'id' | 'projectId' | 'timestamp' | 'tag' | 'storagePath' | 'portalState'>;
export type JobFactsWarranty = Pick<Warranty, 'id' | 'title' | 'provider' | 'category' | 'startDate' | 'endDate' | 'status' | 'portalState'>;
export type JobFactsTask = Pick<ScheduleTask, 'id' | 'title' | 'status' | 'isMilestone' | 'actualEndDate'>;
export interface JobFactsBinder { status: 'draft' | 'finalized' | 'sent'; finalizedAt?: string; sentAt?: string }

export interface BuildJobFactsInput {
  project: { id: string; name: string; schedule?: { tasks?: readonly JobFactsTask[] } | null };
  /** The GC's business name for the header, or null. */
  businessName?: string | null;
  permits: readonly JobFactsPermit[];
  changeOrders: readonly JobFactsChangeOrder[];
  photos: readonly JobFactsPhoto[];
  warranties: readonly JobFactsWarranty[];
  binder: JobFactsBinder | null;
  sections: readonly JobFactSection[];
  /** The photo ids the GC picked, in his order. */
  photoIds: readonly string[];
  /** Show change-order dollar amounts (off by default). */
  includeCoAmounts: boolean;
}

// ── dates ────────────────────────────────────────────────────────────────────

/** A CALENDAR-DAY field (permit, warranty, inspection dates): its 'YYYY-MM-DD'
 *  prefix when that is a real day, else null. Never shifted by a time zone. */
export function factDay(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value) return null;
  return parseCalendarDay(value) ? value.slice(0, 10) : null;
}

/** An INSTANT field (an audit stamp, finalized_at, a photo's timestamp): the
 *  local calendar day it fell on, on the GC's phone. A bare day passes through. */
export function factInstantDay(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value) return null;
  return calendarDayOf(value);
}

/** Dollars → integer cents, without the float drift Math.round(x * 100) has
 *  (1234.565 * 100 is 123456.49999…; this gives 123457). */
export function dollarsToFactCents(dollars: number): number {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars)) return 0;
  return Math.round(Number((dollars * 100).toFixed(6)));
}

// ── labels ───────────────────────────────────────────────────────────────────

const PERMIT_STATUS_WORDS: Record<string, string> = {
  applied: 'applied', under_review: 'under review', approved: 'approved', denied: 'denied',
  expired: 'expired', inspection_scheduled: 'inspection scheduled',
  inspection_passed: 'inspection passed', inspection_failed: 'inspection failed',
};

const INSPECTION_RESULT_LABEL: Record<string, string> = {
  scheduled: 'Scheduled', passed: 'Passed', failed: 'Failed', cancelled: 'Cancelled',
};

const CO_STATUS_LABEL: Record<string, string> = {
  submitted: 'Sent for Approval', under_review: 'Under Review', approved: 'Approved',
  rejected: 'Declined', revised: 'Revised', void: 'Void',
};

/**
 * The change-order audit actions a viewer may see, in plain words. The same
 * set utils/coProofPacket.ts COPROOF_AUDIT_LABELS names (each has a writer
 * today). Anything else — an internal note, an auto-draft marker, an action
 * added later — is left out and counted as 'internal', never printed raw.
 */
export const JOB_FACTS_CO_ACTION_LABEL: Readonly<Record<string, string>> = {
  client_signed_via_portal: 'Signed by the client in the portal',
  client_declined_via_portal: 'Declined by the client in the portal',
  approved_via_portal: 'Approved in the client portal',
  declined_via_portal: 'Declined in the client portal',
  portal_decision_applied: 'Portal decision applied',
  marked_approved: 'Marked approved',
  schedule_reflow_applied: 'Schedule moved for this change order',
  schedule_reflow_no_anchor: 'Schedule days recorded, not yet placed on a task',
  converted_from_field_ticket: 'Created from a field ticket',
  revision_of_declined: 'Started as a revision of a declined change order',
};

const BINDER_STATUS_WORDS: Record<string, string> = { finalized: 'finalized', sent: 'delivered to the owner' };

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

function permitRef(p: JobFactsPermit): string {
  return clean(p.permitNumber) || permitTypeLabel(p.type);
}

function permitTitle(p: JobFactsPermit): string {
  const n = clean(p.permitNumber);
  return n ? `${permitTypeLabel(p.type)} ${n}` : permitTypeLabel(p.type);
}

function permitDetail(p: JobFactsPermit): string {
  const where = clean(p.jurisdiction);
  const status = PERMIT_STATUS_WORDS[p.status] ?? humanizeEnum(p.status).toLowerCase();
  return [where, status ? `status: ${status}` : ''].filter(Boolean).join(' · ');
}

/** True when the row was drafted or recalled in the client portal (the
 *  shared-photos-sign rule: portal_state present and status not 'sent'). */
function portalWithdrawn(row: { portalState?: { status?: unknown } | null }): boolean {
  return !!row.portalState && row.portalState.status !== 'sent';
}

// ── builder ──────────────────────────────────────────────────────────────────

export function buildJobFacts(input: BuildJobFactsInput): JobFactsPayload {
  const on = new Set(input.sections);
  const sections = JOB_FACT_SECTIONS.filter((s) => on.has(s));
  const facts: JobFact[] = [];
  const leftOut = new Map<string, JobFactLeftOut>();
  const leave = (kind: JobFactLeftOut['kind'], reason: JobFactLeftOut['reason'], n = 1) => {
    if (n <= 0) return;
    const k = `${kind}:${reason}`;
    const cur = leftOut.get(k);
    if (cur) cur.count += n; else leftOut.set(k, { kind, count: n, reason });
  };

  // Permits: number, type, jurisdiction, status; applied / approved / expires,
  // each its own dated fact. Never the fee, notes, attachment or inspector.
  if (on.has('permits')) {
    for (const p of input.permits) {
      const dated: [JobFact['kind'], string, string | undefined][] = [
        ['permit_applied', 'Applied', p.appliedDate],
        ['permit_approved', 'Approved', p.approvedDate],
        ['permit_expires', 'Expires', p.expiresDate],
      ];
      let any = false;
      for (const [kind, value, raw] of dated) {
        const date = factDay(raw);
        if (!date) continue;
        any = true;
        const detail = permitDetail(p);
        facts.push({
          kind, section: 'permits', label: permitTitle(p), value,
          ...(detail ? { detail } : {}),
          source: { record: 'permit', ref: permitRef(p) }, date,
          ...(kind === 'permit_expires' ? { term: true as const } : {}),
        });
      }
      if (!any) leave('permit', 'no_date');
    }
  }

  // Inspections: name, result and day, through the ONE decoder. Never notes,
  // never the inspector's name.
  if (on.has('inspections')) {
    for (const p of input.permits) {
      const decoded = decodePermitInspectionNotes(p.inspectionNotes).inspections;
      const list: readonly PermitInspection[] = decoded.length > 0 ? decoded : (Array.isArray(p.inspections) ? p.inspections : []);
      for (const i of list) {
        const date = factDay(i.scheduledFor);
        if (!date) { leave('inspection', 'no_date'); continue; }
        const name = clean(i.name) || 'Inspection';
        facts.push({
          kind: 'inspection', section: 'inspections',
          label: /\binspection$/i.test(name) ? name : `${name} inspection`,
          value: INSPECTION_RESULT_LABEL[i.result] ?? humanizeEnum(i.result),
          detail: permitTitle(p),
          source: { record: 'inspection', ref: permitRef(p) }, date,
          ...(i.result === 'scheduled' ? { term: true as const } : {}),
        });
      }
    }
  }

  // Change orders: number, description, status, and each public audit entry
  // as action + day. Drafts never. Amount only behind the toggle, in cents.
  if (on.has('changeOrders')) {
    for (const co of input.changeOrders) {
      if (co.status === 'draft') { leave('change_order', 'draft'); continue; }
      const ref = String(co.number ?? '').trim() || '?';
      const label = `Change order #${ref}`;
      const date = factInstantDay(co.date);
      if (date) {
        const fact: JobFact = {
          kind: 'change_order', section: 'changeOrders', label,
          value: clean(co.description) || 'Change order',
          detail: CO_STATUS_LABEL[co.status] ?? humanizeEnum(co.status),
          source: { record: 'change_order', ref }, date,
        };
        if (input.includeCoAmounts) fact.amountCents = dollarsToFactCents(co.changeAmount);
        facts.push(fact);
      } else {
        leave('change_order', 'no_date');
      }
      for (const e of co.auditTrail ?? []) {
        const words = Object.prototype.hasOwnProperty.call(JOB_FACTS_CO_ACTION_LABEL, e?.action) ? JOB_FACTS_CO_ACTION_LABEL[e.action] : null;
        if (!words) { leave('change_order_event', 'internal'); continue; }
        const d = factInstantDay(e.timestamp);
        if (!d) { leave('change_order_event', 'no_date'); continue; }
        facts.push({
          kind: 'change_order_event', section: 'changeOrders', label, value: words,
          source: { record: 'change_order', ref }, date: d,
        });
      }
    }
  }

  // Milestones: done AND a recorded finish day. Done-without-a-day is counted.
  if (on.has('milestones')) {
    for (const t of input.project.schedule?.tasks ?? []) {
      if (!t?.isMilestone || t.status !== 'done') continue;
      const date = factInstantDay(t.actualEndDate);
      if (!date) { leave('milestone', 'no_date'); continue; }
      const title = clean(t.title) || 'Milestone';
      facts.push({
        kind: 'milestone_done', section: 'milestones', label: title, value: 'Finished',
        source: { record: 'schedule', ref: title }, date,
      });
    }
  }

  // Photos: only the ids the GC picked, at most 30, each one shareable
  // (not drafted / recalled) and stored. id, timestamp and tag. No URL.
  if (on.has('photos')) {
    const byId = new Map(input.photos.filter((p) => p.projectId === input.project.id).map((p) => [p.id, p]));
    const seen = new Set<string>();
    let kept = 0;
    for (const id of input.photoIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = byId.get(id);
      if (!p) { leave('photo', 'not_found'); continue; }
      if (!isPhotoShareable(p)) { leave('photo', 'recalled'); continue; }
      if (!clean(p.storagePath)) { leave('photo', 'not_synced'); continue; }
      const date = factInstantDay(p.timestamp);
      if (!date) { leave('photo', 'no_date'); continue; }
      if (kept >= JOB_FACTS_PHOTO_MAX) { leave('photo', 'over_cap'); continue; }
      kept++;
      const tag = clean(p.tag) || null;
      facts.push({
        kind: 'photo', section: 'photos', label: 'Photo', value: tag ?? 'Site photo',
        source: { record: 'photo', ref: p.id }, date,
        photo: { id: p.id, ts: p.timestamp, tag },
      });
    }
  }

  // Closeout: the binder's finalized / delivered days; warranties' terms.
  if (on.has('closeout')) {
    const b = input.binder;
    if (b && b.status !== 'draft') {
      const fin = factInstantDay(b.finalizedAt);
      if (fin) {
        facts.push({ kind: 'binder_finalized', section: 'closeout', label: 'Closeout Binder', value: 'Finalized', detail: `Status: ${BINDER_STATUS_WORDS[b.status] ?? b.status}`, source: { record: 'closeout_binder', ref: 'binder' }, date: fin });
      } else {
        leave('closeout_binder', 'no_date');
      }
      const sent = factInstantDay(b.sentAt);
      if (b.status === 'sent' && sent) {
        facts.push({ kind: 'binder_sent', section: 'closeout', label: 'Closeout Binder', value: 'Delivered to the owner', source: { record: 'closeout_binder', ref: 'binder' }, date: sent });
      } else if (b.status === 'sent') {
        leave('closeout_binder', 'no_date');
      }
    }
    for (const w of input.warranties) {
      if (portalWithdrawn(w)) { leave('warranty', 'recalled'); continue; }
      const title = clean(w.title) || 'Warranty';
      const detail = [clean(w.provider), humanizeEnum(w.category), w.status ? `status: ${humanizeEnum(w.status).toLowerCase()}` : '']
        .filter(Boolean).join(' · ');
      const start = factDay(w.startDate);
      const end = factDay(w.endDate);
      if (!start && !end) { leave('warranty', 'no_date'); continue; }
      if (start) facts.push({ kind: 'warranty_start', section: 'closeout', label: title, value: 'Coverage starts', ...(detail ? { detail } : {}), source: { record: 'warranty', ref: title }, date: start, term: true });
      if (end) facts.push({ kind: 'warranty_end', section: 'closeout', label: title, value: 'Coverage ends', ...(detail ? { detail } : {}), source: { record: 'warranty', ref: title }, date: end, term: true });
    }
  }

  // Fixed section order, then oldest first inside a section (stable).
  const rank = new Map(JOB_FACT_SECTIONS.map((s, i) => [s, i]));
  const ordered = facts
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (rank.get(a.f.section)! - rank.get(b.f.section)!) || a.f.date.localeCompare(b.f.date) || a.i - b.i)
    .map((x) => x.f);

  return {
    v: 1,
    job: { name: clean(input.project.name) || 'Job', business: clean(input.businessName) || null },
    sections: [...sections],
    includeCoAmounts: !!input.includeCoAmounts,
    facts: ordered,
    leftOut: [...leftOut.values()],
  };
}

/** The photo ids a payload carries (what the view function re-checks and signs). */
export function payloadPhotoIds(p: Pick<JobFactsPayload, 'facts'>): string[] {
  return p.facts.filter((f) => f.kind === 'photo' && f.photo).map((f) => f.photo!.id);
}
