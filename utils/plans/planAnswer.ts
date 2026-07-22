// utils/plans/planAnswer.ts — pure. Build the grounded ask-prompt from retrieved
// plan chunks, and pull the cited sheet(s) back out of an answer (with the sheetId
// for jump-to-sheet). Grounding rule: answer ONLY from the given sheets; if not
// present, say so — never invent. React/RN-free.
import { sheetIdFromDocId } from './planChunk';
export interface PlanMatch { doc_id: string; source: string; ref: string; content: string; similarity: number; }

export function buildAskPrompt(question: string, matches: PlanMatch[]): string {
  const src = matches.length
    ? matches.map((m, i) => `[${i + 1}] Sheet ${m.ref}:\n${m.content}`).join('\n\n')
    : '(no matching plan sheets found)';
  return [
    'You answer questions about a construction plan set, using ONLY the plan sheets below.',
    'Rules: answer in one or two plain sentences. Cite the sheet you used by its number',
    '(e.g. "Sheet S-201"). If the answer is NOT in these sheets, say you couldn\'t find it',
    'in the indexed plans and suggest rephrasing — do NOT invent an answer.',
    '',
    'PLAN SHEETS:', src,
    '',
    'QUESTION: ' + question,
    'ANSWER:',
  ].join('\n');
}

/** Which of the retrieved sheets the answer actually names → [{ref, sheetId}]. */
export function citedSheetRefs(answer: string, matches: PlanMatch[]): { ref: string; sheetId: string }[] {
  const out: { ref: string; sheetId: string }[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    const sid = sheetIdFromDocId(m.doc_id);
    if (sid && !seen.has(m.ref) && answer.includes(m.ref)) { seen.add(m.ref); out.push({ ref: m.ref, sheetId: sid }); }
  }
  return out;
}
