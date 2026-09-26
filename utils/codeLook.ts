// utils/codeLook.ts — Photo Code Look: point the phone at work that is about
// to be covered up (rough-in, framing, insulation, fire-stopping) and get at
// most five things an inspector would look at IN THAT PHOTO. PURE: no React,
// no network, no storage. scripts/validate-code-look.ts drives it under bun.
//
// THE DANGER THIS FILE GUARDS AGAINST
//   A vision false negative read as "it's fine". So:
//   - an empty result reads CODE_LOOK_NOTHING_FLAGGED ("Nothing flagged in
//     what's visible."), never a verdict on the work;
//   - the can't-tell list is never empty (CODE_LOOK_ALWAYS_CANT_TELL fills it);
//   - confidence describes the OBSERVATION (how clearly it is seen), never the
//     citation; a low-confidence observation is routed to "check on site"
//     (the utils/costXray routeByConfidence idea);
//   - a codeRef is model recall and is shown with CODE_LOOK_RECALL_CHIP.

import type { Project, PunchItem } from '@/types';
import {
  groundingFactsFor,
  jobsiteAddressForProject,
  resolveCodeJurisdiction,
} from '@/utils/codeJurisdiction';
import type { PrepItem } from '@/utils/inspectionPrep';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CodeLookConfidence = 'high' | 'med' | 'low';
export type CodeLookFamily = 'electrical' | 'plumbing' | 'mechanical' | 'framing' | 'fire' | 'building' | 'energy' | 'other';

export interface CodeLookObservation {
  id: string;
  what: string;
  whereInPhoto: string;
  family: CodeLookFamily;
  topic: string;
  codeRef: string | null;
  confidence: CodeLookConfidence;
}

export interface CodeLookCantTell {
  what: string;
  betterShot: string;
}

export interface CodeLookResult {
  observations: CodeLookObservation[];
  checkOnSite: CodeLookObservation[];
  cantTell: CodeLookCantTell[];
}

// ─── Fixed copy (never model text) ────────────────────────────────────────────

export const CODE_LOOK_DISCLAIMER = 'Visual pre-check, not an inspection. The inspector and the AHJ decide.';
export const CODE_LOOK_NOTHING_FLAGGED = "Nothing flagged in what's visible.";
/** The same words as InspectionReadySheet's RECALL_CHIP (validator-checked;
 *  not imported — that would be a component → util → component cycle). */
export const CODE_LOOK_RECALL_CHIP = 'From model recall — verify with your AHJ';
export const CODE_LOOK_ALWAYS_CANT_TELL: CodeLookCantTell = {
  what: 'Anything behind the finish or outside the frame',
  betterShot: 'A closer shot of each spot you want checked',
};

export const CODE_LOOK_MAX_OBSERVATIONS = 5;
export const CODE_LOOK_MAX_CANT_TELL = 6;

const FAMILIES: readonly CodeLookFamily[] = ['electrical', 'plumbing', 'mechanical', 'framing', 'fire', 'building', 'energy', 'other'];
const CONFIDENCES: readonly CodeLookConfidence[] = ['high', 'med', 'low'];

// ─── Small helpers ────────────────────────────────────────────────────────────

/** FNV-1a content fingerprint (not security). The utils/inspectionPrep digest. */
function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function str(v: unknown, cap: number): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, cap);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// ─── Normalise ────────────────────────────────────────────────────────────────

/**
 * Defensive re-normalisation of the analyze-photos 'codeLook' answer (the
 * server already caps). At most CODE_LOOK_MAX_OBSERVATIONS rows in total;
 * a 'low' row goes to checkOnSite; an empty can't-tell list becomes
 * [CODE_LOOK_ALWAYS_CANT_TELL] so the photo's blind spots are always said.
 */
export function normalizeCodeLook(raw: unknown): CodeLookResult {
  const o = asRecord(raw) ?? {};
  const rows = Array.isArray(o.observations) ? o.observations : [];
  const seen = new Set<string>();
  const all: CodeLookObservation[] = [];
  for (const r of rows) {
    if (all.length >= CODE_LOOK_MAX_OBSERVATIONS) break;
    const x = asRecord(r);
    if (!x) continue;
    const what = str(x.what, 200);
    if (!what) continue;
    const whereInPhoto = str(x.whereInPhoto, 120);
    const id = `cl_${digest(`${what}|${whereInPhoto}`)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const fam = str(x.family, 20).toLowerCase() as CodeLookFamily;
    const conf = str(x.confidence, 8).toLowerCase() as CodeLookConfidence;
    const codeRef = str(x.codeRef, 60);
    all.push({
      id,
      what,
      whereInPhoto,
      family: FAMILIES.includes(fam) ? fam : 'other',
      topic: str(x.topic, 80),
      codeRef: codeRef || null,
      confidence: CONFIDENCES.includes(conf) ? conf : 'low',
    });
  }

  const cantRows = Array.isArray(o.cantTell) ? o.cantTell : [];
  const cantTell: CodeLookCantTell[] = [];
  for (const r of cantRows) {
    if (cantTell.length >= CODE_LOOK_MAX_CANT_TELL) break;
    const x = asRecord(r);
    if (!x) continue;
    const what = str(x.what, 160);
    if (!what) continue;
    cantTell.push({ what, betterShot: str(x.betterShot, 160) });
  }

  return {
    observations: all.filter((a) => a.confidence !== 'low'),
    checkOnSite: all.filter((a) => a.confidence === 'low'),
    cantTell: cantTell.length > 0 ? cantTell : [{ ...CODE_LOOK_ALWAYS_CANT_TELL }],
  };
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

export function codeLookHeadline(r: CodeLookResult): string {
  const n = r.observations.length;
  const m = r.checkOnSite.length;
  if (n === 0 && m === 0) return CODE_LOOK_NOTHING_FLAGGED;
  const total = n + m;
  const head = `${total} ${total === 1 ? 'thing' : 'things'} an inspector would look at`;
  return m > 0 ? `${head} · ${m} to check on site` : head;
}

/** Describes how clearly the thing is SEEN — never the code citation. */
export function trustLabel(c: CodeLookConfidence): string {
  if (c === 'high') return 'Clearly visible';
  if (c === 'med') return 'Probably visible';
  return 'Hard to see — check on site';
}

// ─── Context for the model ────────────────────────────────────────────────────

/**
 * What the function is told about the job: the jurisdiction grounding block
 * (an unknown jurisdiction still sends its block — it says it is unresolved;
 * never an invented edition), the trade and the checklist lines, when given.
 */
export function codeLookContext(a: {
  project: Project;
  trade?: string | null;
  checklist?: string[];
}): { jurisdictionBlock: string; trade?: string; checklist?: string[] } {
  const grounding = groundingFactsFor(resolveCodeJurisdiction(jobsiteAddressForProject(a.project)));
  const out: { jurisdictionBlock: string; trade?: string; checklist?: string[] } = { jurisdictionBlock: grounding.promptBlock };
  const trade = (a.trade ?? '').trim();
  if (trade) out.trade = trade;
  const checklist = (a.checklist ?? []).map((l) => String(l ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (checklist.length > 0) out.checklist = checklist;
  return out;
}

// ─── Punch / prep ─────────────────────────────────────────────────────────────

const FAMILY_TRADE: Record<CodeLookFamily, string> = {
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  mechanical: 'HVAC',
  framing: 'Framing',
  fire: 'General',
  building: 'General',
  energy: 'General',
  other: 'General',
};

/** The punch trade word a family maps to (shown beside the row; PunchItem has
 *  no trade column, and a bare trade word is never put in assignedSub). */
export function codeLookTrade(f: CodeLookFamily): string {
  return FAMILY_TRADE[f] ?? 'General';
}

/**
 * "Make punch item" — an INTERNAL crew-list item pinned to THIS photo, built
 * field-for-field like utils/inspectionPrep.punchForPrepItem. Unassigned on
 * purpose (a sub sees it only once someone assigns it). PunchItem carries no
 * notes or trade column (types/index.ts), so neither is invented here; the
 * photo itself (photoUri + sourcePhotoId) is the provenance, and the location
 * is where in the photo.
 */
export function codeLookToPunch(
  o: CodeLookObservation,
  a: { projectId: string; photoUri: string; sourcePhotoId?: string; now: string; newId: () => string },
): PunchItem {
  const punch: PunchItem = {
    id: a.newId(),
    projectId: a.projectId,
    description: o.what.slice(0, 80),
    location: o.whereInPhoto,
    assignedSub: '',
    dueDate: '',
    priority: 'medium',
    status: 'open',
    listType: 'crew',
    photoUri: a.photoUri,
    createdAt: a.now,
    updatedAt: a.now,
  };
  if (a.sourcePhotoId) punch.sourcePhotoId = a.sourcePhotoId;
  return punch;
}

const CONFIDENCE_WORD: Record<CodeLookConfidence, string> = { high: 'High', med: 'Medium', low: 'Low' };

/** "Add to inspection prep" — a verify-on-site line with a stable id. */
export function codeLookToPrepItem(o: CodeLookObservation): PrepItem {
  const item: PrepItem = {
    id: `codelook_${digest(o.what)}`,
    group: 'verify',
    text: o.what,
    why: `From a Code look photo · ${CONFIDENCE_WORD[o.confidence]} confidence in what was seen`,
    confidence: o.confidence,
  };
  if (o.codeRef) item.codeRef = o.codeRef;
  return item;
}
