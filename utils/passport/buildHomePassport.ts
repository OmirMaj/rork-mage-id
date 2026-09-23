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
import { OWNER_SHARING_OFF, type OwnerSharing } from './ownerSharing';
import { stripMoney } from './consumerPassport';

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
  /**
   * What of the GC's own relationships this job shares with the owner
   * (ownerSharing.ownerSharingFor(project.clientPortal)). These docs are what
   * the owner's Ask Your Home box retrieves and what the portal FAQ is written
   * from, so a supplier name or a sub's phone in them reaches the owner.
   * Omitted = nothing shared (Phase 0, founder decision 5).
   */
  sharing?: OwnerSharing;
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
  const sharing = input.sharing ?? OWNER_SHARING_OFF;
  const docs: PassportDoc[] = [];

  // WHERE THE GC'S OWN RELATIONSHIPS LIVE (Phase 0, founder decision 5).
  // A supplier name and a sub's direct phone/email are never written into a
  // finish or trade doc. They get docs of their own —
  //   passport:supplier:<selection category id | purchase-order id>
  //   passport:contact:<subcontract commitment id>
  // — emitted only while the matching switch is on. portal-ask-home drops
  // both prefixes at answer time unless the job's LIVE switch is on
  // (supabase/functions/portal-ask-home/sharingFilter.ts), so a copy indexed
  // while a switch was on stops being answerable the moment it goes off,
  // whether or not this device ever re-indexes (the sync is diff-only and
  // never prunes, and a switch can be flipped from another device).

  // ── Finishes: the chosen option in each selection category ──
  // Only categories the portal shows (isShared, the portal's own rule): Ask
  // Your Home is reached with the portal link, so it must not answer about a
  // selection the GC has not sent to the client.
  for (const cat of input.selections ?? []) {
    if (!isShared(cat.portalState)) continue;
    const chosen = (cat.options ?? []).find(o => o.isChosen);
    if (!chosen) continue;
    const parts = [
      `${clean(cat.category)} in ${clean(project.name)}: ${clean(chosen.productName)}`,
      chosen.brand && `Brand: ${clean(chosen.brand)}`,
      chosen.sku && `SKU / model: ${clean(chosen.sku)}`,
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
    // The brand and model are the owner's; where the GC bought it is his.
    if (sharing.supplierNames && clean(chosen.supplier)) {
      docs.push({
        docId: `passport:supplier:${cat.id}`,
        kind: 'supplier',
        ref: `Supplier — ${clean(cat.category)}`,
        date: chosen.chosenAt || chosen.createdAt || cat.updatedAt || '',
        text: clamp(`${clean(cat.category)} in ${clean(project.name)} (${clean(chosen.productName)}) was bought from ${clean(chosen.supplier)}.`),
      });
    }
  }

  // ── Warranties ──
  // Same portal rule: a draft or recalled warranty (its notes, its
  // exclusions) is not the owner's to read yet.
  for (const w of input.warranties ?? []) {
    if (w.projectId !== project.id || !isShared(w.portalState)) continue;
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

  // ── Trades: "who did the electrical" ──
  const subsById = new Map((input.subcontractors ?? []).map(s => [s.id, s]));
  for (const c of input.commitments ?? []) {
    if (c.projectId !== project.id || c.status === 'draft') continue;
    const date = c.signedDate || c.createdAt || '';
    // A purchase order's vendor is a supplier. The trade doc never names it
    // and carries no free text (a PO description can name the vendor); the
    // name lives only in the supplier doc below.
    if (c.type === 'purchase_order') {
      docs.push({
        docId: `passport:trade:${c.id}`,
        kind: 'trade',
        ref: 'Supplier — materials',
        date,
        text: clamp(`Materials for ${clean(project.name)} were ordered by your contractor from a supplier${c.phase ? `, for the ${clean(c.phase)} phase` : ''}.`),
      });
      const vendor = clean(c.vendorName);
      if (sharing.supplierNames && vendor) {
        const what = stripMoney(c.description);
        docs.push({
          docId: `passport:supplier:${c.id}`,
          kind: 'supplier',
          ref: `Supplier — ${vendor}`,
          date,
          text: clamp(`${vendor} supplied materials for ${clean(project.name)}${what ? `: ${what}` : ''}${c.phase ? ` (${clean(c.phase)} phase)` : ''}.`),
        });
      }
      continue;
    }
    const sub = c.subcontractorId ? subsById.get(c.subcontractorId) : undefined;
    const company = clean(sub?.companyName) || clean(c.vendorName) || 'Subcontractor';
    const parts = [
      `${company} worked on ${clean(project.name)}`,
      sub?.trade && `Trade: ${clean(String(sub.trade))}`,
      // Scope is lifted off an internal subcontract; a dollar figure typed
      // into it is the sub's price, so it is scrubbed before it can be
      // indexed for (and quoted to) the owner.
      stripMoney(c.description) && `Scope: ${stripMoney(c.description)}`,
      c.phase && `Phase: ${clean(c.phase)}`,
      c.csiDivision && `CSI division: ${clean(c.csiDivision)}`,
      c.signedDate && `Contracted ${shortDate(c.signedDate)}`,
    ].filter(Boolean) as string[];
    docs.push({
      docId: `passport:trade:${c.id}`,
      kind: 'trade',
      ref: `Trade — ${company}`,
      date,
      text: clamp(parts.join('. ')),
    });
    // A sub's direct line only when the GC chose to share it; otherwise the
    // owner reaches the trade through the GC.
    const contactParts = [
      sub?.contactName && `Contact: ${clean(sub.contactName)}`,
      sub?.phone && `Phone: ${clean(sub.phone)}`,
      sub?.email && `Email: ${clean(sub.email)}`,
    ].filter(Boolean) as string[];
    if (sharing.tradeContacts && contactParts.length > 0) {
      docs.push({
        docId: `passport:contact:${c.id}`,
        kind: 'contact',
        ref: `Contact — ${company}`,
        date,
        text: clamp([`How to reach ${company}${sub?.trade ? ` (${clean(String(sub.trade))})` : ''}, who worked on ${clean(project.name)}`, ...contactParts].join('. ')),
      });
    }
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
