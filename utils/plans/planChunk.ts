// utils/plans/planChunk.ts — pure. Turn an extracted plan sheet into embed-ready
// project-memory docs (source 'Plan Sheet'), keyed so the sheet id round-trips
// back out of the doc_id for jump-to-sheet. React/RN-free (validator drives it).
export interface ExtractedSheet { sheetId: string; sheetNumber: string; text: string; }
export interface MemoryDoc { doc_id: string; source: string; ref: string; content: string; }

const MAX = 8000; // memory_embeddings.content cap
export const PLAN_SOURCE = 'Plan Sheet';

export function sheetToDocs(sheet: ExtractedSheet): MemoryDoc[] {
  const text = (sheet.text || '').trim();
  if (!text) return [];
  const ref = sheet.sheetNumber || 'Sheet';
  if (text.length <= MAX) {
    return [{ doc_id: `plan-sheet:${sheet.sheetId}`, source: PLAN_SOURCE, ref, content: text }];
  }
  const docs: MemoryDoc[] = [];
  for (let i = 0, n = 0; i < text.length; i += MAX, n += 1) {
    docs.push({ doc_id: `plan-sheet:${sheet.sheetId}#${n}`, source: PLAN_SOURCE, ref, content: text.slice(i, i + MAX) });
  }
  return docs;
}

/** Recover the plan sheet id from a doc_id ('plan-sheet:<id>' or 'plan-sheet:<id>#<n>'). */
export function sheetIdFromDocId(docId: string): string | null {
  if (!docId.startsWith('plan-sheet:')) return null;
  return docId.slice('plan-sheet:'.length).split('#')[0];
}
