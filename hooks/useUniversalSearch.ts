// ============================================================================
// hooks/useUniversalSearch.ts
//
// Client-side substring search across every domain object held in
// ProjectContext. Returns `SearchResult[]` grouped by `EntityKind` so the
// UniversalSearch modal can render them in sections. All matching is plain
// case-insensitive substring — we intentionally avoid fuse.js for the dataset
// size. If users ever complain about spelling tolerance, revisit then.
//
// Keystrokes arrive fast, so:
//   * the query is debounced 150ms inside the hook
//   * the expensive scan is memoized against the debounced query + store refs
//   * results are capped at MAX_TOTAL to keep renders cheap
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useProjects } from '@/contexts/ProjectContext';
import type {
  EntityRef, EntityKind,
  RFI, Submittal, Invoice, ChangeOrder,
  DailyFieldReport, PunchItem, ProjectPhoto, Contact, Warranty, Equipment,
  ScheduleTask, Permit, Subcontractor, Commitment, PlanSheet,
  CommunicationEvent, PortalMessage, DrawingPin, PlanMarkup,
  PrequalPacket, PriceAlert,
} from '@/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SearchResult {
  ref: EntityRef;
  /** Which field produced the match. Used by the UI for the snippet caption. */
  matchField: string;
  /** Short fragment around the match with the query highlighted by callers. */
  matchSnippet: string;
  /** 0-1 — higher is better. */
  score: number;
  /** Project label cached here so the UI doesn't re-resolve on every render. */
  projectName?: string;
  /** Pre-computed row label (entity's natural title). */
  label: string;
}

export interface UniversalSearchResult {
  results: SearchResult[];
  grouped: Record<EntityKind, SearchResult[]>;
  isSearching: boolean;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 150;
const MAX_TOTAL = 50;
const MAX_PER_GROUP = 5;
const SNIPPET_RADIUS = 32;

// Recency boost: entities updated within this window get a ×1.2 multiplier.
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENCY_BOOST = 1.2;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUniversalSearch(query: string): UniversalSearchResult {
  const store = useProjects();
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Debounce keystrokes.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setDebouncedQuery('');
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const handle = setTimeout(() => {
      setDebouncedQuery(trimmed);
      setIsSearching(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const results = useMemo<SearchResult[]>(() => {
    if (debouncedQuery.length === 0) return [];
    const q = debouncedQuery.toLowerCase();
    const now = Date.now();
    const raw: SearchResult[] = [];

    const projectNameById = new Map<string, string>();
    for (const p of store.projects) projectNameById.set(p.id, p.name);

    // --- projects --------------------------------------------------------
    for (const p of store.projects) {
      const best = bestFieldMatch(q, [
        ['name', p.name],
        ['description', p.description],
        ['location', p.location],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'project', id: p.id },
          p.name,
          best,
          recencyMultiplier(p.updatedAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- schedule tasks --------------------------------------------------
    for (const p of store.projects) {
      const tasks: ScheduleTask[] = p.schedule?.tasks ?? [];
      for (const t of tasks) {
        const best = bestFieldMatch(q, [
          ['title', t.title],
          ['notes', t.notes],
          ['crew', t.crew],
        ]);
        if (best) {
          raw.push(makeResult(
            { kind: 'task', id: t.id, projectId: p.id, label: t.title },
            t.title,
            best,
            1, // Tasks have no updatedAt of their own.
            projectNameById,
            q.length,
          ));
        }
      }
    }

    // --- RFIs ------------------------------------------------------------
    for (const r of store.rfis as RFI[]) {
      const best = bestFieldMatch(q, [
        ['subject', r.subject],
        ['question', r.question],
        ['response', r.response ?? ''],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'rfi', id: r.id, projectId: r.projectId },
          `RFI #${r.number} · ${r.subject}`,
          best,
          recencyMultiplier(r.updatedAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- submittals ------------------------------------------------------
    for (const s of store.submittals as Submittal[]) {
      const best = bestFieldMatch(q, [
        ['title', s.title],
        ['specSection', s.specSection],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'submittal', id: s.id, projectId: s.projectId },
          `Submittal #${s.number} · ${s.title}`,
          best,
          recencyMultiplier(s.updatedAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- invoices --------------------------------------------------------
    for (const inv of store.invoices as Invoice[]) {
      const clientName = projectNameById.get(inv.projectId) ?? '';
      const lineBlob = (inv.lineItems ?? []).map(l => `${l.name} ${l.description}`).join(' ');
      const best = bestFieldMatch(q, [
        ['number', String(inv.number)],
        ['client', clientName],
        ['lineItems', lineBlob],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'invoice', id: inv.id, projectId: inv.projectId },
          `Invoice #${inv.number}`,
          best,
          recencyMultiplier(inv.updatedAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- change orders ---------------------------------------------------
    for (const co of store.changeOrders as ChangeOrder[]) {
      const lineBlob = (co.lineItems ?? []).map(l => `${l.name} ${l.description}`).join(' ');
      const best = bestFieldMatch(q, [
        ['description', co.description],
        ['reason', co.reason],
        ['lineItems', lineBlob],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'changeOrder', id: co.id, projectId: co.projectId },
          `CO #${co.number} · ${co.description}`,
          best,
          recencyMultiplier(co.updatedAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- daily reports ---------------------------------------------------
    // DFRs live behind getDailyReportsForProject only; iterate per project.
    for (const p of store.projects) {
      const reports: DailyFieldReport[] = store.getDailyReportsForProject(p.id);
      for (const d of reports) {
        const matDelivered = (d.materialsDelivered ?? []).join(' ');
        const best = bestFieldMatch(q, [
          ['workPerformed', d.workPerformed],
          ['issuesAndDelays', d.issuesAndDelays],
          ['materialsDelivered', matDelivered],
        ]);
        if (best) {
          raw.push(makeResult(
            { kind: 'dailyReport', id: d.id, projectId: d.projectId },
            `Daily Report · ${d.date}`,
            best,
            recencyMultiplier(d.updatedAt, now),
            projectNameById,
            q.length,
          ));
        }
      }
    }

    // --- punch items -----------------------------------------------------
    for (const pi of store.punchItems as PunchItem[]) {
      const best = bestFieldMatch(q, [
        ['description', pi.description],
        ['location', pi.location],
        ['assignedSub', pi.assignedSub],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'punchItem', id: pi.id, projectId: pi.projectId },
          pi.description,
          best,
          recencyMultiplier(pi.updatedAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- photos ----------------------------------------------------------
    for (const ph of store.projectPhotos as ProjectPhoto[]) {
      const best = bestFieldMatch(q, [
        ['tag', ph.tag ?? ''],
        ['location', ph.location ?? ''],
        ['linkedTaskName', ph.linkedTaskName ?? ''],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'photo', id: ph.id, projectId: ph.projectId },
          ph.tag || 'Photo',
          best,
          recencyMultiplier(ph.createdAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- contacts --------------------------------------------------------
    for (const c of store.contacts as Contact[]) {
      const fullName = `${c.firstName} ${c.lastName}`.trim();
      const best = bestFieldMatch(q, [
        ['name', fullName],
        ['companyName', c.companyName],
        ['email', c.email],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'contact', id: c.id },
          fullName || c.companyName || c.email,
          best,
          recencyMultiplier(c.updatedAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- warranties ------------------------------------------------------
    for (const w of store.warranties as Warranty[]) {
      const best = bestFieldMatch(q, [
        ['title', w.title],
        ['provider', w.provider],
        ['description', w.description ?? ''],
        ['coverageDetails', w.coverageDetails ?? ''],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'warranty', id: w.id, projectId: w.projectId },
          w.title,
          best,
          recencyMultiplier(w.updatedAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- equipment -------------------------------------------------------
    for (const e of store.equipment as Equipment[]) {
      const best = bestFieldMatch(q, [
        ['name', e.name],
        ['model', e.model],
        ['make', e.make],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'equipment', id: e.id },
          e.name,
          best,
          recencyMultiplier(e.createdAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- permits ---------------------------------------------------------
    for (const p of store.permits as Permit[]) {
      const best = bestFieldMatch(q, [
        ['type', p.type],
        ['permitNumber', p.permitNumber ?? ''],
        ['jurisdiction', p.jurisdiction],
        ['phase', p.phase ?? ''],
        ['notes', p.notes ?? ''],
        ['inspectionNotes', p.inspectionNotes ?? ''],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'permit', id: p.id, projectId: p.projectId },
          `${p.type}${p.permitNumber ? ` · #${p.permitNumber}` : ''}`,
          best,
          recencyMultiplier(p.updatedAt ?? p.createdAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- subcontractors --------------------------------------------------
    for (const s of store.subcontractors as Subcontractor[]) {
      const best = bestFieldMatch(q, [
        ['companyName', s.companyName],
        ['contactName', s.contactName],
        ['trade', s.trade],
        ['licenseNumber', s.licenseNumber],
        ['email', s.email],
        ['phone', s.phone],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'subcontractor', id: s.id },
          `${s.companyName} · ${s.trade}`,
          best,
          1,
          projectNameById,
          q.length,
        ));
      }
    }

    // --- commitments (POs / subcontracts) -------------------------------
    for (const c of store.commitments as Commitment[]) {
      const best = bestFieldMatch(q, [
        ['number', c.number],
        ['type', c.type],
        ['description', c.description],
        ['vendorName', c.vendorName ?? ''],
        ['phase', c.phase ?? ''],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'commitment', id: c.id, projectId: c.projectId },
          `${c.type} #${c.number} · ${c.description.slice(0, 40)}`,
          best,
          1,
          projectNameById,
          q.length,
        ));
      }
    }

    // --- plan sheets -----------------------------------------------------
    for (const ps of store.planSheets as PlanSheet[]) {
      const best = bestFieldMatch(q, [
        ['name', ps.name],
        ['sheetNumber', ps.sheetNumber ?? ''],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'planSheet', id: ps.id, projectId: ps.projectId },
          ps.sheetNumber ? `${ps.sheetNumber} · ${ps.name}` : ps.name,
          best,
          recencyMultiplier(ps.updatedAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- communication events -------------------------------------------
    for (const ce of store.commEvents as CommunicationEvent[]) {
      const best = bestFieldMatch(q, [
        ['summary', ce.summary],
        ['detail', ce.detail ?? ''],
        ['actor', ce.actor],
        ['recipient', ce.recipient ?? ''],
        ['type', ce.type],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'commEvent', id: ce.id, projectId: ce.projectId },
          `${ce.type.replace(/_/g, ' ')} · ${ce.summary.slice(0, 40)}`,
          best,
          recencyMultiplier(ce.timestamp, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- portal messages -------------------------------------------------
    for (const pm of store.portalMessages as PortalMessage[]) {
      const best = bestFieldMatch(q, [
        ['authorName', pm.authorName],
        ['body', pm.body],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'portalMessage', id: pm.id, projectId: pm.projectId },
          `${pm.authorName}: ${pm.body.slice(0, 40)}`,
          best,
          recencyMultiplier(pm.createdAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- drawing pins ---------------------------------------------------
    for (const pin of store.drawingPins as DrawingPin[]) {
      const best = bestFieldMatch(q, [
        ['label', pin.label ?? ''],
        ['kind', pin.kind],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'drawingPin', id: pin.id, projectId: pin.projectId },
          pin.label ? `${pin.kind} pin · ${pin.label}` : `${pin.kind} pin`,
          best,
          recencyMultiplier(pin.updatedAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- plan markups ---------------------------------------------------
    for (const mk of store.planMarkups as PlanMarkup[]) {
      const best = bestFieldMatch(q, [
        ['text', mk.text ?? ''],
        ['type', mk.type],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'planMarkup', id: mk.id, projectId: mk.projectId },
          mk.text ? `${mk.type} · ${mk.text.slice(0, 40)}` : `${mk.type} markup`,
          best,
          recencyMultiplier(mk.createdAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // --- prequal packets ------------------------------------------------
    // Packets are stored per-sub, not per-project. We resolve the sub's
    // company name so the result is recognizable in the search modal.
    const subById = new Map<string, Subcontractor>();
    for (const s of store.subcontractors as Subcontractor[]) subById.set(s.id, s);
    for (const pq of store.prequalPackets as PrequalPacket[]) {
      const sub = subById.get(pq.subcontractorId);
      const best = bestFieldMatch(q, [
        ['status', pq.status],
        ['subcontractor', sub?.companyName ?? ''],
      ]);
      if (best) {
        raw.push(makeResult(
          { kind: 'prequalPacket', id: pq.id, projectId: pq.projectId },
          `Prequal · ${sub?.companyName ?? 'Unknown sub'} · ${pq.status}`,
          best,
          1,
          projectNameById,
          q.length,
        ));
      }
    }

    // --- price alerts ---------------------------------------------------
    for (const pa of store.priceAlerts as PriceAlert[]) {
      const best = bestFieldMatch(q, [
        ['materialName', pa.materialName],
        ['direction', pa.direction],
      ]);
      if (best) {
        const arrow = pa.direction === 'below' ? '↓' : '↑';
        raw.push(makeResult(
          { kind: 'priceAlert', id: pa.id },
          `Alert ${arrow} ${pa.materialName} @ $${pa.targetPrice}`,
          best,
          recencyMultiplier(pa.createdAt, now),
          projectNameById,
          q.length,
        ));
      }
    }

    // Sort global by score descending, then cap.
    raw.sort((a, b) => b.score - a.score);
    return raw.slice(0, MAX_TOTAL);
  }, [debouncedQuery, store]);

  const grouped = useMemo<Record<EntityKind, SearchResult[]>>(() => {
    const g = emptyGrouped();
    const counts = emptyCounts();
    for (const r of results) {
      if (counts[r.ref.kind] >= MAX_PER_GROUP) continue;
      g[r.ref.kind].push(r);
      counts[r.ref.kind] += 1;
    }
    return g;
  }, [results]);

  return { results, grouped, isSearching };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FieldMatch {
  field: string;
  haystack: string;
  index: number;
  score: number;
}

function bestFieldMatch(q: string, fields: [string, string][]): FieldMatch | null {
  let best: FieldMatch | null = null;
  for (const [field, value] of fields) {
    if (!value) continue;
    const hay = value.toLowerCase();
    const idx = hay.indexOf(q);
    if (idx < 0) continue;
    const score = scoreFor(hay, q, idx);
    if (!best || score > best.score) {
      best = { field, haystack: value, index: idx, score };
    }
  }
  return best;
}

function scoreFor(haystackLower: string, q: string, index: number): number {
  // Exact match (haystack === query): 1.0
  if (haystackLower.length === q.length && index === 0) return 1.0;
  // Starts-with: 0.8
  if (index === 0) return 0.8;
  // Contains: 0.5
  return 0.5;
}

function recencyMultiplier(updatedAt: string | undefined, now: number): number {
  if (!updatedAt) return 1;
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return 1;
  return now - t <= RECENCY_WINDOW_MS ? RECENCY_BOOST : 1;
}

function makeResult(
  ref: EntityRef,
  label: string,
  match: FieldMatch,
  recencyMult: number,
  projectNameById: Map<string, string>,
  queryLen: number,
): SearchResult {
  return {
    ref,
    label,
    matchField: match.field,
    matchSnippet: snippet(match.haystack, match.index, queryLen),
    score: Math.min(1, match.score * recencyMult),
    projectName: ref.projectId ? projectNameById.get(ref.projectId) : undefined,
  };
}

function snippet(haystack: string, index: number, matchLen: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(haystack.length, index + matchLen + SNIPPET_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < haystack.length ? '…' : '';
  return prefix + haystack.slice(start, end) + suffix;
}

function emptyGrouped(): Record<EntityKind, SearchResult[]> {
  return {
    project: [], task: [], photo: [], rfi: [], submittal: [],
    changeOrder: [], invoice: [], payment: [], dailyReport: [],
    punchItem: [], warranty: [], contact: [], document: [],
    permit: [], equipment: [], subcontractor: [], commitment: [],
    planSheet: [], commEvent: [], portalMessage: [],
    drawingPin: [], planMarkup: [], prequalPacket: [], priceAlert: [],
  };
}

function emptyCounts(): Record<EntityKind, number> {
  return {
    project: 0, task: 0, photo: 0, rfi: 0, submittal: 0,
    changeOrder: 0, invoice: 0, payment: 0, dailyReport: 0,
    punchItem: 0, warranty: 0, contact: 0, document: 0,
    permit: 0, equipment: 0, subcontractor: 0, commitment: 0,
    planSheet: 0, commEvent: 0, portalMessage: 0,
    drawingPin: 0, planMarkup: 0, prequalPacket: 0, priceAlert: 0,
  };
}

