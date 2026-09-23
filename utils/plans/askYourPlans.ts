// utils/plans/askYourPlans.ts — orchestrates "ask your plans": index a project's
// plan sheets into project-memory (via plan-extract vision -> project-memory-embed),
// and answer a question (project-memory-search -> mageAI grounded answer). Cloud is
// the source of truth (per project); this only wires cloud calls.
//
// AUDIT ROUND 2 (#19). On the web app this indexed NOTHING and said so in green:
// the local image→base64 copy here had dropped planCodeReviewer's web branch, so
// FileSystem.downloadAsync (a shim on web) threw for every signed-URL sheet, each
// sheet was skipped into console.warn, the run returned 0, and the panel showed
// "Indexing complete" in success colour. Tier-cap and hourly-limit refusals went
// the same way. Now:
//   • a sheet with a storage path is read by plan-extract ITSELF with the service
//     role (no bytes through the client, same as compare-drawings / spec book);
//     anything else goes through planCodeReviewer.imageUriToBase64, the one copy
//     that has the web branch;
//   • the run returns what happened per sheet (PlanIndexResult) and the panel
//     words it with summarizePlanIndex — never green at 0;
//   • it is incremental: a sheet already indexed with the same drawing and number
//     is not re-extracted (plan_extract is 100/month on Business), superseded and
//     deleted sheets are left out and removed from the index;
//   • the question searches plan sheets only, inside the top-K.
import { supabase } from '@/lib/supabase';
import { mageAI } from '@/utils/mageAI';
import { imageUriToBase64 } from '@/utils/planCodeReviewer';
// The function's own `{ error, code }` — a monthly cap stops the run, a single
// unreadable sheet does not. Shared with Compare and PDF import (audit #79).
import { readEdgeError } from '@/utils/edgeError';
import { sheetToDocs, PLAN_SOURCE } from './planChunk';
import { buildAskPrompt, citedSheetRefs, type PlanMatch } from './planAnswer';
import {
  batchGroups, confidentMatches, planSheetFingerprint, PLAN_DOC_PREFIX, PLAN_EXTRACT_STOP_CODES,
  type PlanIndexResult,
} from './memoryIndexCore';
import { titleBlockSuggestions, splitMatchesByCurrentSheet, type TitleBlockSuggestion } from './revisionActions';
import type { PlanSheet } from '@/types';

export type { PlanIndexResult, PlanIndexSkip } from './memoryIndexCore';

const sheetLabel = (s: PlanSheet) => s.sheetNumber || s.name || 'Sheet';

/** What plan-extract read off the title block (#75). Every field optional:
 *  the function drops what it could not read rather than guess. */
export interface ExtractedTitleBlock { sheetNumber?: string; sheetTitle?: string; revisionMark?: string }

export type ExtractOutcome =
  | { ok: true; text: string; titleBlock: ExtractedTitleBlock | null }
  | { ok: false; code: string; reason: string };

/** The title block as the function returned it, or null. Defensive: a function
 *  deployed before the field existed sends none. */
function readTitleBlock(data: unknown): ExtractedTitleBlock | null {
  const tb = (data as { titleBlock?: unknown } | null)?.titleBlock as Record<string, unknown> | undefined;
  if (!tb || typeof tb !== 'object') return null;
  const field = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const out: ExtractedTitleBlock = {
    sheetNumber: field(tb.sheetNumber), sheetTitle: field(tb.sheetTitle), revisionMark: field(tb.revisionMark),
  };
  return out.sheetNumber || out.sheetTitle || out.revisionMark ? out : null;
}

/**
 * One metered plan-extract read of one sheet: its text, and — #75 — the title
 * block, which this used to throw away. Exported for the Plans import's
 * optional "read the sheet numbers" pass; each call counts against the
 * caller's plan_extract allowance.
 */
export async function extractSheet(s: PlanSheet): Promise<ExtractOutcome> {
  // Storage-backed sheet: let the function download it (DB-F11 pattern). The
  // client never touches the bytes, so web and native take the same path.
  if (s.storagePath) {
    const { data, error } = await supabase.functions.invoke('plan-extract', {
      body: { storagePath: s.storagePath, sheetNumber: s.sheetNumber },
    });
    if (!error) {
      if (data?.success && typeof data.text === 'string') return { ok: true, text: data.text, titleBlock: readTitleBlock(data) };
      return { ok: false, code: 'empty', reason: data?.error ?? 'The AI read nothing legible on this sheet.' };
    }
    const e = await readEdgeError(error, 'Plan extract failed');
    // One-release fallback: a plan-extract deployed before it accepted
    // storagePath answers 400 "Missing imageBase64". Send the bytes instead.
    if (!/missing imagebase64/i.test(e.message)) return { ok: false, code: e.code, reason: e.message };
  }

  let b64 = '';
  let mime = 'image/jpeg';
  try {
    ({ base64: b64, mimeType: mime } = await imageUriToBase64(s.imageUri));
  } catch (err) {
    return { ok: false, code: 'unreadable', reason: String((err as Error)?.message ?? 'The sheet image could not be read.') };
  }
  if (!b64) return { ok: false, code: 'unreadable', reason: 'The sheet image could not be read.' };
  const { data, error } = await supabase.functions.invoke('plan-extract', {
    body: { imageBase64: b64, mimeType: mime, sheetNumber: s.sheetNumber },
  });
  if (error) {
    const e = await readEdgeError(error, 'Plan extract failed');
    return { ok: false, code: e.code, reason: e.message };
  }
  if (!data?.success || typeof data.text !== 'string') {
    return { ok: false, code: 'empty', reason: data?.error ?? 'The AI read nothing legible on this sheet.' };
  }
  return { ok: true, text: data.text, titleBlock: readTitleBlock(data) };
}

/** An indexing run's report, plus the sheet numbers its title-block reads
 *  OFFER for unnumbered sheets (#75). The caller shows them as "Title block
 *  reads A-201 — use it?" and applies the accepted ones with planBatchRenumber
 *  through the offlineQueue patch path; nothing here writes a number. */
export type PlanIndexRun = PlanIndexResult & {
  titleBlockSuggestions: TitleBlockSuggestion[];
  /** #115: each sheet's transcription from THIS run (sheetId → text), kept in
   *  memory only so accepting a title-block number can re-embed the sheet
   *  under its new citation without paying plan-extract to read it again. */
  extractedText: Record<string, string>;
};

/**
 * Embed transcriptions as plan-sheet docs, a whole sheet per batch, each
 * carrying `hashFor(sheet)` so the next run can skip it. Embeddings only — no
 * plan-extract read. Shared by the Index run and the post-renumber re-embed.
 */
async function embedSheetTexts(
  projectId: string,
  items: readonly { sheet: PlanSheet; text: string }[],
  hashFor: (s: PlanSheet) => string,
): Promise<{ embedded: string[]; failed: { sheetId: string; label: string; code: string; reason: string }[] }> {
  const embedded: string[] = [];
  const failed: { sheetId: string; label: string; code: string; reason: string }[] = [];
  const groups = items.map(({ sheet, text }) =>
    sheetToDocs({ sheetId: sheet.id, sheetNumber: sheetLabel(sheet), text })
      .map(d => ({ ...d, content_hash: hashFor(sheet) })));
  for (const batch of batchGroups(groups)) {
    const sheetIds = [...new Set(batch.map(d => d.doc_id.slice(PLAN_DOC_PREFIX.length).split('#')[0]))];
    const { data, error } = await supabase.functions.invoke('project-memory-embed', { body: { projectId, docs: batch } });
    if (!error && data?.success) { embedded.push(...sheetIds); continue; }
    const e = error ? await readEdgeError(error, 'Indexing failed') : { message: data?.error ?? 'Indexing failed', code: '' };
    for (const id of sheetIds) {
      const s = items.find(x => x.sheet.id === id)?.sheet;
      failed.push({ sheetId: id, label: s ? sheetLabel(s) : 'Sheet', code: e.code, reason: e.message });
    }
  }
  return { embedded, failed };
}

/**
 * #115: re-embed renumbered sheets under their NEW citation from text this
 * run already holds (renumberReembedPlan). Resolves the failure reason, if
 * any, in the function's own words with no trailing full stop.
 */
export async function reembedRenumberedSheets(
  projectId: string,
  items: readonly { sheet: PlanSheet; text: string }[],
): Promise<{ reembedded: number; failed: string | null }> {
  if (items.length === 0) return { reembedded: 0, failed: null };
  try {
    const out = await embedSheetTexts(projectId, items, planSheetFingerprint);
    return {
      reembedded: out.embedded.length,
      failed: out.failed.length > 0 ? out.failed[0].reason.replace(/\s*[.!]+\s*$/, '') : null,
    };
  } catch (err) {
    return { reembedded: 0, failed: String((err as Error)?.message ?? 'the index could not be reached').replace(/\s*[.!]+\s*$/, '') };
  }
}

/**
 * Which current sheets the index does NOT hold with this drawing + number
 * (#78). One helper for the indexing run and the panel's on-open check, so the
 * fingerprint rule lives in one place (planSheetFingerprint). A manifest spends
 * no embedding call and no monthly cap. `prune` deletes rows for superseded and
 * deleted sheets — only the explicit Index tap passes it, so opening the panel
 * never deletes anything. Resolves null when the manifest could not be read
 * (offline, function not redeployed, a refusal): the caller must then not
 * claim the index is up to date.
 */
export async function readPlanIndexManifest(
  projectId: string,
  sheets: PlanSheet[],
  prune: boolean,
): Promise<{ staleIds: Set<string>; pruneRefused: boolean } | null> {
  const current = sheets.filter(s => !s.superseded);
  const { data: man, error: manErr } = await supabase.functions.invoke('project-memory-embed', {
    body: {
      projectId,
      action: 'manifest',
      manifest: current.map(s => ({ doc_id: `${PLAN_DOC_PREFIX}${s.id}`, hash: planSheetFingerprint(s) })),
      scopePrefixes: [PLAN_DOC_PREFIX],
      prune,
    },
  });
  if (manErr || !man?.success || !Array.isArray(man.stale)) return null;
  return {
    staleIds: new Set((man.stale as string[]).map(id => id.slice(PLAN_DOC_PREFIX.length))),
    pruneRefused: man.pruneNotAllowed === true,
  };
}

/** Index (or re-index) a project's plan sheets. Extract text per sheet (vision),
 *  then embed as project-memory docs (source 'Plan Sheet'). Returns what happened
 *  to every current sheet — never a bare count the UI can mistake for success. */
export async function indexPlanSheets(
  projectId: string,
  sheets: PlanSheet[],
  onProgress?: (done: number, total: number) => void,
): Promise<PlanIndexRun> {
  const current = sheets.filter(s => !s.superseded);
  const titleReads: { sheetId: string; sheetNumber?: string }[] = [];
  const result: PlanIndexRun = {
    titleBlockSuggestions: [],
    extractedText: {},
    total: current.length,
    alreadyIndexed: 0,
    newlyIndexed: 0,
    skipped: [],
    supersededExcluded: sheets.length - current.length,
  };
  if (current.length === 0) return result;

  // 1. Which sheets does the index already hold with this drawing + number?
  //    The manifest also names the whole plan scope, so rows for deleted and
  //    superseded sheets are pruned server-side — a citation chip can no longer
  //    open a sheet that is gone. If the manifest call fails (function not yet
  //    redeployed, offline), treat every sheet as stale and prune nothing.
  const hashById = new Map(current.map(s => [s.id, planSheetFingerprint(s)]));
  let staleIds = new Set(current.map(s => s.id));
  const man = await readPlanIndexManifest(projectId, sheets, true);
  if (man) {
    staleIds = man.staleIds;
    result.alreadyIndexed = current.length - current.filter(s => staleIds.has(s.id)).length;
  }

  // 2. Extract the stale sheets, one at a time (plan-extract is metered per call
  //    and hourly-limited — parallel calls would just race into the limit).
  const stale = current.filter(s => staleIds.has(s.id));
  const extracted: { sheet: PlanSheet; text: string }[] = [];
  onProgress?.(0, stale.length);
  for (let i = 0; i < stale.length; i++) {
    const s = stale[i];
    const out = await extractSheet(s);
    onProgress?.(i + 1, stale.length);
    if (out.ok && out.titleBlock?.sheetNumber) titleReads.push({ sheetId: s.id, sheetNumber: out.titleBlock.sheetNumber });
    if (out.ok && out.text.trim()) { extracted.push({ sheet: s, text: out.text }); continue; }
    if (out.ok) {
      result.skipped.push({ sheetId: s.id, label: sheetLabel(s), code: 'empty', reason: 'The AI read nothing legible on this sheet.' });
      continue;
    }
    result.skipped.push({ sheetId: s.id, label: sheetLabel(s), code: out.code, reason: out.reason });
    if (PLAN_EXTRACT_STOP_CODES.has(out.code)) {
      // Every remaining sheet would get the same refusal — say so for each of
      // them instead of spending the hourly bucket to hear it again.
      for (const rest of stale.slice(i + 1)) {
        result.skipped.push({ sheetId: rest.id, label: sheetLabel(rest), code: out.code, reason: out.reason });
      }
      onProgress?.(stale.length, stale.length);
      break;
    }
  }

  // 3. Embed, a whole sheet per batch, carrying the fingerprint so the next run
  //    can skip it. A failed batch marks its sheets skipped with the reason.
  const embedOut = await embedSheetTexts(projectId, extracted, s => hashById.get(s.id) ?? planSheetFingerprint(s));
  result.newlyIndexed += embedOut.embedded.length;
  result.skipped.push(...embedOut.failed);
  for (const { sheet, text } of extracted) result.extractedText[sheet.id] = text;
  // Offered only for sheets that still have no number; one he typed wins.
  result.titleBlockSuggestions = titleBlockSuggestions(current, titleReads);
  return result;
}

export interface PlanAnswer {
  answer: string;
  citations: { ref: string; sheetId: string }[];
  noneFound: boolean;
  /** The answer was grounded in sheets that all scored below
   *  MIN_MEMORY_SIMILARITY — the panel says so instead of presenting it flat. */
  weakGrounding: boolean;
  /** The SEARCH itself failed or was refused (tier, monthly cap, hourly limit,
   *  embedding upstream, offline) — in the function's own words, no trailing
   *  full stop. Not the same thing as "your plans don't say": the panel must
   *  never turn a server error into #19's headline sentence. */
  searchFailed: string | null;
  /** #117: the search WORKED (and was metered on the owner's plan) but the
   *  answer step failed or was refused — a collaborator's own AI cap, a tier
   *  refusal, a timeout. In mageAI's own words, no trailing full stop. Never
   *  shown as an answer, never as "couldn't search". */
  answerFailed: string | null;
  /** #117: why the answer step failed, so the panel only says "try again"
   *  when trying again can help (network / timeout), not after a cap. */
  answerFailedKind: 'retry' | 'final' | null;
  /** #78: matches on a superseded or deleted sheet, left out BEFORE the model
   *  read anything. The panel says so; > 0 with noneFound means only older
   *  revisions matched — the current set is not indexed, not "not in the plans". */
  staleDropped: number;
}

/** How many below-floor neighbours are worth showing the model when nothing
 *  clears the floor. Three: enough for the right sheet to be among them,
 *  few enough that the prompt is not padded with noise. */
const WEAK_FALLBACK_MATCHES = 3;

/** Answer a question about the project's plans. `sheets` is the plan set as
 *  it is NOW: only matches on its current sheets reach the prompt (#78). */
export async function askPlans(projectId: string, question: string, sheets: PlanSheet[]): Promise<PlanAnswer> {
  // `sources` scopes the vector search to plan sheets INSIDE the top-K. Without
  // it the 8 nearest were usually daily reports, which the filter below then
  // discarded, and the prompt got "(no matching plan sheets found)".
  const { data: sr, error: searchErr } = await supabase.functions.invoke('project-memory-search', {
    body: { projectId, query: question, matchCount: 8, sources: [PLAN_SOURCE] },
  });
  // B5 review: this `error` used to be discarded. supabase-js sets data = null
  // on ANY non-2xx, so a 402/403 tier refusal, a 429 cap or hourly limit, a 503
  // limiter outage or a 502 from the embedding upstream all arrived here as
  // "zero matches" — and the panel printed finding #19's exact sentence, "I
  // couldn't find that in the indexed plans", over a plan set that holds the
  // answer. Worse, the model was paid to write it: the prompt was still built
  // with "(no matching plan sheets found)". A failed search is not an answer,
  // so say what happened and spend nothing.
  if (searchErr || sr?.success !== true) {
    const e = searchErr
      ? await readEdgeError(searchErr, 'the plan search could not be reached')
      : { message: typeof sr?.error === 'string' && sr.error.trim() ? sr.error.trim() : 'the plan search could not be reached', code: '' };
    return {
      answer: '',
      citations: [],
      noneFound: false,
      weakGrounding: false,
      staleDropped: 0,
      answerFailed: null,
      answerFailedKind: null,
      // Trailing full stop stripped: the panel sets this reason inside its own
      // sentence, and "…upgrade.. Your plans may still hold it" reads broken.
      searchFailed: e.message.replace(/\s*[.!]+\s*$/, ''),
    };
  }
  // Keep the source filter: a function not yet redeployed ignores `sources`.
  const sourced: PlanMatch[] = ((sr?.matches ?? []) as PlanMatch[])
    .filter(m => m.source === PLAN_SOURCE);
  // #78: the index still holds a superseded sheet until the next Index tap, so
  // "header over door 104" was answered from Rev 1 after Rev 2 was filed. Drop
  // every match whose sheet is superseded or gone BEFORE the floor and the
  // prompt — filtering only the chips is too late, the model has read it.
  const { current: planMatches, staleDropped } = splitMatchesByCurrentSheet(sourced, sheets);
  // The floor DEGRADES, it never empties the prompt. Project Memory can drop
  // weak matches because it falls through to TF-IDF keyword search; askPlans
  // has no such path, so dropping everything here would reproduce the exact
  // symptom of #19 — "I couldn't find that in your plans" over a plan set that
  // does contain the answer — on a threshold that is a heuristic, not a
  // measured one (MIN_MEMORY_SIMILARITY's own docstring says so), against
  // dense OCR transcriptions of drawings, the worst case for query-document
  // cosine. So: prefer the confident neighbours; if none clear the floor, show
  // the model the nearest few anyway and TELL the reader the match was weak.
  const confident = confidentMatches(planMatches);
  const weakGrounding = confident.length === 0 && planMatches.length > 0;
  const matches: PlanMatch[] = weakGrounding ? planMatches.slice(0, WEAK_FALLBACK_MATCHES) : confident;
  if (matches.length === 0 && staleDropped > 0) {
    // Only older revisions matched. Paying the model to say "I couldn't find
    // that in your plans" would be false — the current set is not indexed.
    return { answer: '', citations: [], noneFound: true, weakGrounding: false, searchFailed: null, answerFailed: null, answerFailedKind: null, staleDropped };
  }
  const res = await mageAI({ prompt: buildAskPrompt(question, matches), tier: 'smart', maxTokens: 400, feature: 'planAsk' });
  // For non-schema mageAI calls the ai relay returns { data: rawText, raw: rawText }.
  // res.data holds the text string directly (not res.data?.text).
  // #117: a failed answer step is NOT an answer. This used to print "I
  // couldn't reach the plan brain just now — try again." as the answer —
  // hiding a real refusal (a collaborator's own AI cap) behind a connectivity
  // excuse, and inviting a retry that charges the owner's search meter again.
  const text = (res.success ? (typeof res.data === 'string' ? res.data : res.raw ?? '') : '').trim();
  if (!res.success || !text) {
    const reason = (!res.success && typeof res.error === 'string' && res.error.trim())
      ? res.error.trim()
      : 'the answer came back empty';
    const kind = res.errorKind === 'network' || res.errorKind === 'timeout' || (res.success && !text) ? 'retry' : 'final';
    return {
      answer: '', citations: [], noneFound: false, weakGrounding: false, searchFailed: null,
      answerFailed: reason.replace(/\s*[.!]+\s*$/, ''), answerFailedKind: kind, staleDropped,
    };
  }
  const answer = text;
  const citations = citedSheetRefs(answer, matches);
  return { answer, citations, noneFound: matches.length === 0, weakGrounding, searchFailed: null, answerFailed: null, answerFailedKind: null, staleDropped };
}
