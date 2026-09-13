// utils/permitInspectionHistory.ts — the codec for a permit's inspection
// history, and nothing else. PURE: no React, no RN, no storage, no Expo
// Router. scripts/validate-field-capture.ts imports this module directly and
// runs the REAL functions.
//
// WHY THIS FILE EXISTS AT ALL, AND WHY IT USED TO LIVE IN app/permits.tsx.
// The codec was born inside the permits route, fenced off by
// `// --- BEGIN permitInspectionCodec ---` sentinels, because an Expo Router
// route cannot be imported outside Metro and the sentinels were the guard's
// only handle on the shipped code. That fence also fenced the DATA in: the
// decoder was module-private to a screen, so the contractor's own inspection
// record — the inspector's words, the failure, the date — was readable by
// exactly one screen and by nothing else in the app. Construction AI needed
// it (utils/permitInspectionFacts.ts) and could not have it, and the
// alternative was a SECOND decoder carrying a second copy of the sentinel
// constants: two readers of one on-disk format, free to drift. So the codec
// moved here, whole, and the guard now imports the real module instead of
// transpiling a slice of a route file. The sentinels are gone because the
// reason for them is gone.
//
// WHY THE HISTORY LIVES IN A TEXT COLUMN (audit 2026-09-07 "worth doing" #14).
// A permit had ONE inspectionDate and ONE inspectionNotes, so booking the
// framing inspection overwrote the footing's result and the correction note
// that came with it. On a job with 8–15 inspections the failed rough-electrical
// — one of the most common causes of a two-week slip — was the first thing the
// app forgot, and closeout could not assemble a history that was never kept.
//
// `public.permits` has no jsonb column (supabase/schema.sql:1234) and a client
// release cannot add one. The alternatives were both worse: a local-only
// AsyncStorage collection dies on the next device, and writing an unmapped
// field is DATA LOSS — ProjectContext's permits query overwrites the local copy
// with the server's rows on the next launch, so the history would vanish on any
// synced account. So the rows ride inside `inspection_notes`, which round-trips
// verbatim through the existing column mapping, behind a sentinel block that
// the encoder puts on and the decoder takes off. When the column lands, the
// migration reads the block out and this whole file goes with it.
//
// The invariant that makes it safe: NOTHING may display `inspectionNotes` raw.
// Every read goes through decodePermitInspectionNotes first.
//
// The one place that used to break it was universal search:
// hooks/useUniversalSearch.ts put `p.inspectionNotes` in the permit haystack
// and rendered `matchSnippet` as a window into that same raw string, so a
// search landing inside the block printed JSON at the GC. Closed 2026-09-08 —
// that file now reads through `permitInspectionSearchText`, which decodes the
// block AND additionally truncates at machine-text SHAPE (a `{"` object
// opener, or a `[[word:` namespaced sentinel). The shape test is what makes
// this invariant hold across files: renaming the sentinel constant here can no
// longer silently restore the leak, because the reader does not depend on
// knowing its value. Nothing else in the repo reads the column —
// mocks/permits.ts and the two dev seeders only WRITE plain notes, which the
// decoder handles as plain notes with an empty history.

import type { PermitInspection, PermitInspectionResult, PermitStatus } from '@/types';

const PERMIT_INSPECTIONS_OPEN = '[[mage:inspections]]';
const PERMIT_INSPECTIONS_CLOSE = '[[/mage:inspections]]';

const PERMIT_INSPECTION_RESULTS: PermitInspectionResult[] = ['scheduled', 'passed', 'failed', 'cancelled'];

/** A row survives the round-trip only if it still has the fields the UI reads.
 *  Anything else is dropped rather than rendered as a half-inspection. */
function isPermitInspectionRow(v: unknown): v is PermitInspection {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string' && r.id.length > 0
    && typeof r.name === 'string'
    && typeof r.scheduledFor === 'string'
    && typeof r.result === 'string'
    && (PERMIT_INSPECTION_RESULTS as string[]).includes(r.result);
}

/** Newest first: by calendar day, then by when the row was written, so two
 *  inspections called on the same morning keep the order they were logged. */
export function sortPermitInspections(rows: PermitInspection[]): PermitInspection[] {
  return [...rows].sort((a, b) => {
    if (a.scheduledFor !== b.scheduledFor) return a.scheduledFor < b.scheduledFor ? 1 : -1;
    return (b.recordedAt ?? '') < (a.recordedAt ?? '') ? -1 : 1;
  });
}

/**
 * Split a stored `inspectionNotes` into the notes a human wrote and the
 * inspection history riding behind them.
 *
 * A permit written before this shipped — or by the seeders, or by hand in the
 * Supabase console — has no sentinel and comes back as plain notes with an
 * empty history, which is exactly right. A sentinel with unreadable JSON drops
 * the history rather than showing the user a block of machine text: losing a
 * history we cannot parse is bad, but printing `[[mage:inspections]]` into the
 * failed-inspection alert on the permit card is worse and is the failure the
 * user would actually see.
 */
export function decodePermitInspectionNotes(raw: string | undefined | null): { notes: string; inspections: PermitInspection[] } {
  const text = typeof raw === 'string' ? raw : '';
  const open = text.indexOf(PERMIT_INSPECTIONS_OPEN);
  if (open < 0) return { notes: text.trim(), inspections: [] };
  const notes = text.slice(0, open).trim();
  const close = text.indexOf(PERMIT_INSPECTIONS_CLOSE, open);
  if (close < 0) return { notes, inspections: [] };
  const json = text.slice(open + PERMIT_INSPECTIONS_OPEN.length, close);
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return { notes, inspections: [] };
    return { notes, inspections: sortPermitInspections(parsed.filter(isPermitInspectionRow)) };
  } catch {
    return { notes, inspections: [] };
  }
}

/**
 * The value to store in `inspectionNotes`. `undefined` when there is neither a
 * note nor a history — the column is nullable and an empty sentinel block is
 * just noise waiting to confuse the next reader.
 */
export function encodePermitInspectionNotes(notes: string, inspections: PermitInspection[]): string | undefined {
  const clean = (notes ?? '').trim();
  if (inspections.length === 0) return clean || undefined;
  const block = `${PERMIT_INSPECTIONS_OPEN}${JSON.stringify(sortPermitInspections(inspections))}${PERMIT_INSPECTIONS_CLOSE}`;
  return clean ? `${clean}\n\n${block}` : block;
}

/** The status values that mean the permit's single inspection fields describe
 *  a real inspection, and which result each one records. */
export function inspectionResultForStatus(status: PermitStatus): PermitInspectionResult | null {
  if (status === 'inspection_scheduled') return 'scheduled';
  if (status === 'inspection_passed') return 'passed';
  if (status === 'inspection_failed') return 'failed';
  return null;
}

/**
 * Fold the permit's single "current inspection" fields into the history, so
 * that booking the next one cannot erase the last one.
 *
 * This is the half that fixes the bug without asking the GC to do extra work:
 * he schedules and resolves inspections exactly the way he already does, and
 * the act of doing it leaves a row behind. It has to be idempotent, because it
 * runs on every save of the permit form:
 *
 *   - same day, same result already recorded  → nothing (a re-save is not a
 *     second inspection)
 *   - same day, previously 'scheduled', now passed/failed → the SAME row is
 *     resolved in place; a called inspection is one inspection, not two
 *   - a new day → a new row
 *
 * `name` comes from the permit's phase ("Foundation", "Rough-in", "Final") when
 * the GC has set one, because that is the only name the record actually has.
 * Never invented from the permit type — "Electrical inspection" on a plumbing
 * rough-in is the kind of confident wrong label that gets a record distrusted.
 */
export function foldCurrentInspection(args: {
  inspections: PermitInspection[];
  status: PermitStatus;
  /** Calendar day 'YYYY-MM-DD'. Empty = nothing to fold. */
  inspectionDate: string;
  inspectionNotes: string;
  phase?: string;
  inspectorName?: string;
  now: string;
  /** Injected so the guard can pin ids; the screen passes generateUUID. */
  newId: () => string;
}): PermitInspection[] {
  const { inspections, status, inspectionDate, inspectionNotes, phase, inspectorName, now, newId } = args;
  const day = (inspectionDate ?? '').slice(0, 10);
  if (!day) return inspections;
  const result = inspectionResultForStatus(status);
  if (!result) return inspections;

  const notes = (inspectionNotes ?? '').trim() || undefined;
  const name = (phase ?? '').trim() || 'Inspection';
  // Which row, if any, this head actually describes.
  //
  // Matching on the DAY alone was the finding's own bug narrowed to a day
  // (review 2026-09-08). Two inspections on one permit on one calendar day is
  // ordinary — a re-inspection called the morning a new trade is booked, a
  // combined permit with rough plumbing and rough mechanical on the same
  // Thursday, or any row the GC logged by hand in the history editor below —
  // and a bare day match folded the head onto whichever one it found, quietly
  // replacing that inspection's result and its correction notes.
  //
  // A row still `scheduled` has no verdict to lose, so the head resolving it in
  // place is exactly the intended behaviour. A row that has already been CALLED
  // is a verdict, and the head only lands on it when this is plainly the same
  // inspection being re-saved or corrected — same day, same name. Everything
  // else gets its own row: a duplicate row is something the GC can delete, an
  // erased failed footing is not something he can get back.
  const existingIdx = inspections.findIndex(i => {
    if (i.scheduledFor.slice(0, 10) !== day) return false;
    if (i.result === 'scheduled') return true;
    return (i.name || 'Inspection') === name;
  });

  if (existingIdx >= 0) {
    const existing = inspections[existingIdx];
    // Nothing new happened — same day, same verdict, same note.
    if (existing.result === result && (existing.notes ?? undefined) === notes) return inspections;
    // A scheduled visit that has now been called resolves in place. A verdict
    // that CHANGES (passed → failed) also lands on the same row: it is a
    // correction of one inspection, not a second one on the same day.
    const next = [...inspections];
    next[existingIdx] = {
      ...existing,
      result,
      notes: notes ?? existing.notes,
      name: existing.name || name,
      inspectorName: inspectorName?.trim() || existing.inspectorName,
      recordedAt: now,
    };
    return sortPermitInspections(next);
  }

  return sortPermitInspections([
    ...inspections,
    {
      id: newId(),
      name,
      scheduledFor: day,
      result,
      notes,
      inspectorName: inspectorName?.trim() || undefined,
      recordedAt: now,
    },
  ]);
}

/** What the history says happened, in one line, for the permit card. */
export function inspectionHistorySummary(rows: PermitInspection[]): string | null {
  if (rows.length === 0) return null;
  const failed = rows.filter(r => r.result === 'failed').length;
  const passed = rows.filter(r => r.result === 'passed').length;
  const parts: string[] = [];
  if (passed > 0) parts.push(`${passed} passed`);
  if (failed > 0) parts.push(`${failed} failed`);
  const called = passed + failed;
  if (called === 0) return `${rows.length} inspection${rows.length === 1 ? '' : 's'} scheduled`;
  return `${called} inspection${called === 1 ? '' : 's'} called — ${parts.join(', ')}`;
}
