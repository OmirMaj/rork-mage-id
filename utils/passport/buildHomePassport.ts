// buildHomePassport — pure assembly of the Home Passport from data the
// closeout binder already compiles. No I/O, no Date.now(), no randomness:
// docIds derive from entity ids so re-generation re-indexes idempotently
// (project-memory-embed upserts on (user_id, doc_id)).
//
// Consumers:
//   1. app/closeout-binder.tsx converts docs → MemoryDoc and pushes them to
//      memory_embeddings via syncMemoryEmbeddings (source 'Home Passport');
//      portal-ask-home retrieves them for homeowner questions.
//   2. faqInputs feed answerFromMemory (over these docs ONLY — homeowner-safe)
//      to pre-answer the portal FAQ.
//   3. summary drives the passport header card (portal snapshot v9).

import type {
  SelectionCategory, Warranty, Commitment, Subcontractor, ProjectPhoto, PortalState,
} from '@/types';
import type { MaintenanceItem } from '@/utils/closeoutBinderEngine';
import type { FaqInput, HomePassport, PassportDoc, PassportDocKind } from './types';

export const MAX_DOC_CHARS = 4000;
export const MAX_FAQ_INPUTS = 10;

export interface BuildHomePassportInput {
  project: { id: string; name: string; location?: string };
  /** Selection categories with options — the chosen option becomes a finish doc. */
  selections: SelectionCategory[];
  /** All warranties — filtered to project.id internally. */
  warranties: Warranty[];
  /** All commitments — filtered to project.id + non-draft internally. */
  commitments: Commitment[];
  /** Sub roster for contact enrichment (matched via commitment.subcontractorId). */
  subcontractors: Subcontractor[];
  /** All photos — filtered to project.id + shared-to-portal internally. */
  photos: ProjectPhoto[];
  /** The binder's maintenance schedule (already project-scoped). */
  maintenance: MaintenanceItem[];
  /** ISO timestamp stamped on the summary. Injected so tests are deterministic. */
  generatedAt: string;
}

function clean(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function clamp(s: string): string {
  return s.length > MAX_DOC_CHARS ? s.slice(0, MAX_DOC_CHARS) : s;
}

/** Mirror of portalSnapshot's isShared: undefined portalState is
 *  grandfathered as sent; only explicit 'sent' otherwise. */
function isShared(s?: PortalState): boolean {
  return s == null || s.status === 'sent';
}

/** Timezone-free "Mar 12, 2026" from an ISO date/timestamp prefix. */
function shortDate(iso: string | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mi = parseInt(m[2], 10) - 1;
  if (mi < 0 || mi > 11) return '';
  return `${months[mi]} ${parseInt(m[3], 10)}, ${m[1]}`;
}

// The FAQ catalog. `requires` = include the question only when at least one
// doc of ANY listed kind exists — so an empty project pre-answers nothing.
const FAQ_CATALOG: FaqInput[] = [
  { id: 'faq-finishes',       question: 'What finishes, brands, and materials were installed in my home?', requires: ['finish'] },
  { id: 'faq-paint',          question: 'What paint or finish should I buy for touch-ups?',                requires: ['finish'] },
  { id: 'faq-warranty-list',  question: 'What warranties do I have and when does each one end?',           requires: ['warranty'] },
  { id: 'faq-warranty-claim', question: 'What should I do if something breaks while under warranty?',      requires: ['warranty', 'trade'] },
  { id: 'faq-who-electrical', question: 'Who did the electrical work and how do I reach them?',            requires: ['trade'] },
  { id: 'faq-who-plumbing',   question: 'Who did the plumbing work and how do I reach them?',              requires: ['trade'] },
  { id: 'faq-who-built',      question: 'Which companies worked on my home and what did each one do?',     requires: ['trade'] },
  { id: 'faq-maint-schedule', question: 'What routine maintenance should I do, and how often?',            requires: ['maintenance'] },
  { id: 'faq-maint-seasonal', question: 'What should I check before winter and summer each year?',         requires: ['maintenance'] },
  { id: 'faq-photos',         question: 'What photos do I have of the work while it was being built?',     requires: ['photo'] },
];

export function buildHomePassport(input: BuildHomePassportInput): HomePassport {
  const { project, generatedAt } = input;
  const docs: PassportDoc[] = [];

  // ── Finishes: the chosen option in each selection category ──
  for (const cat of input.selections ?? []) {
    const chosen = (cat.options ?? []).find(o => o.isChosen);
    if (!chosen) continue;
    const parts = [
      `${clean(cat.category)} in ${clean(project.name)}: ${clean(chosen.productName)}`,
      chosen.brand && `Brand: ${clean(chosen.brand)}`,
      chosen.sku && `SKU / model: ${clean(chosen.sku)}`,
      chosen.supplier && `Supplier: ${clean(chosen.supplier)}`,
      chosen.description && `Details: ${clean(chosen.description)}`,
      (chosen.highlights ?? []).length > 0 && `Highlights: ${(chosen.highlights ?? []).map(clean).filter(Boolean).join('; ')}`,
      chosen.unitPrice > 0 && `Price: $${chosen.unitPrice} per ${clean(chosen.unit) || 'unit'}`,
    ].filter(Boolean) as string[];
    docs.push({
      docId: `passport:finish:${cat.id}`,
      kind: 'finish',
      ref: `Finish — ${clean(cat.category)}`,
      date: chosen.chosenAt || chosen.createdAt || cat.updatedAt || '',
      text: clamp(parts.join('. ')),
    });
  }

  // ── Warranties ──
  for (const w of input.warranties ?? []) {
    if (w.projectId !== project.id) continue;
    const parts = [
      `Warranty for ${clean(w.title)} (${clean(w.category)})`,
      w.provider && `Provider: ${clean(w.provider)}`,
      w.startDate && `Coverage starts ${shortDate(w.startDate)}`,
      w.endDate && `Coverage ends ${shortDate(w.endDate)}`,
      w.durationMonths > 0 && `Duration: ${w.durationMonths} months`,
      w.coverageDetails && `Covers: ${clean(w.coverageDetails)}`,
      w.exclusions && `Not covered: ${clean(w.exclusions)}`,
      w.description && `Notes: ${clean(w.description)}`,
    ].filter(Boolean) as string[];
    docs.push({
      docId: `passport:warranty:${w.id}`,
      kind: 'warranty',
      ref: `Warranty — ${clean(w.title)}`,
      date: w.endDate || w.startDate || '',
      text: clamp(parts.join('. ')),
    });
  }

  // ── Trades: commitments enriched with sub contact ("who did the electrical") ──
  const subsById = new Map((input.subcontractors ?? []).map(s => [s.id, s]));
  for (const c of input.commitments ?? []) {
    if (c.projectId !== project.id || c.status === 'draft') continue;
    const sub = c.subcontractorId ? subsById.get(c.subcontractorId) : undefined;
    const company = clean(sub?.companyName) || clean(c.vendorName) || 'Subcontractor';
    const parts = [
      `${company} worked on ${clean(project.name)}`,
      sub?.trade && `Trade: ${clean(String(sub.trade))}`,
      c.description && `Scope: ${clean(c.description)}`,
      c.phase && `Phase: ${clean(c.phase)}`,
      c.csiDivision && `CSI division: ${clean(c.csiDivision)}`,
      sub?.contactName && `Contact: ${clean(sub.contactName)}`,
      sub?.phone && `Phone: ${clean(sub.phone)}`,
      sub?.email && `Email: ${clean(sub.email)}`,
      c.signedDate && `Contracted ${shortDate(c.signedDate)}`,
    ].filter(Boolean) as string[];
    docs.push({
      docId: `passport:trade:${c.id}`,
      kind: 'trade',
      ref: `Trade — ${company}`,
      date: c.signedDate || c.createdAt || '',
      text: clamp(parts.join('. ')),
    });
  }

  // ── Maintenance schedule ──
  for (const m of input.maintenance ?? []) {
    if (!clean(m.task)) continue;
    const parts = [
      `Maintenance task: ${clean(m.task)}`,
      m.frequency && `Frequency: ${clean(m.frequency)}`,
      m.nextDate && `Next due ${shortDate(m.nextDate)}`,
      m.notes && `Notes: ${clean(m.notes)}`,
    ].filter(Boolean) as string[];
    docs.push({
      docId: `passport:maintenance:${m.id}`,
      kind: 'maintenance',
      ref: `Maintenance — ${clean(m.task)}`,
      date: m.nextDate || '',
      text: clamp(parts.join('. ')),
    });
  }

  // ── Photos: captions/locations/dates — NOT pixels (v1). Only photos the
  //    portal already shows (shared), so answers never cite an image the
  //    homeowner can't see. ──
  for (const p of input.photos ?? []) {
    if (p.projectId !== project.id || !isShared(p.portalState)) continue;
    const caption = clean(p.tag) || clean(p.location) || 'Site photo';
    const parts = [
      `Photo: ${caption}`,
      p.location && clean(p.location) !== caption && `Location: ${clean(p.location)}`,
      p.locationLabel && `Address: ${clean(p.locationLabel)}`,
      p.linkedTaskName && `During: ${clean(p.linkedTaskName)}`,
      p.timestamp && `Taken ${shortDate(p.timestamp)}`,
    ].filter(Boolean) as string[];
    docs.push({
      docId: `passport:photo:${p.id}`,
      kind: 'photo',
      ref: `Photo — ${caption}${p.timestamp ? `, ${shortDate(p.timestamp)}` : ''}`,
      date: p.timestamp || p.createdAt || '',
      text: clamp(parts.join('. ')),
    });
  }

  // ── FAQ inputs + summary ──
  const kindsPresent = new Set<PassportDocKind>(docs.map(d => d.kind));
  const faqInputs = FAQ_CATALOG
    .filter(f => f.requires.some(k => kindsPresent.has(k)))
    .slice(0, MAX_FAQ_INPUTS);

  const count = (k: PassportDocKind) => docs.filter(d => d.kind === k).length;
  return {
    docs,
    faqInputs,
    summary: {
      finishes: count('finish'),
      warranties: count('warranty'),
      trades: count('trade'),
      maintenanceItems: count('maintenance'),
      photos: count('photo'),
      docCount: docs.length,
      generatedAt,
    },
  };
}
