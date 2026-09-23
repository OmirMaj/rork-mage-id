// utils/copilot/scheduleEdit/addIntent.ts — does this sentence ask to ADD work
// to the schedule? Pure, React/RN-free, validator-driven.
//
// Why it exists: the Schedule Pro "AI" drawer (Ask / Bulk / As-built) can only
// EDIT the rows it is shown — its prompts say "never add or remove tasks". An
// "add three tasks after rough-in" typed there came back as "1 change(s)
// proposed" against the selected row, which is one of the two routes to the
// founder's "I asked for several new tasks and only 1 was acknowledged". The
// drawer now hands such a request to the schedule editor (ScheduleEditPanel),
// which can add tasks, instead of answering it itself.
//
// Deliberately narrow: "add 2 days to framing" / "add a crew" are EDITS, not
// new tasks, and stay in the drawer.

const ADD_VERB = /\b(add|adding|create|creating|insert|inserting|schedule in|put in)\b/i;
const TASK_NOUN = /\b(tasks?|milestones?|activit(?:y|ies)|steps?|inspections?|items?|phases?)\b/i;
const NEW_TASK = /\bnew\s+(tasks?|milestones?|activit(?:y|ies)|steps?|inspections?)\b/i;
// An amount added TO an existing task: "add 2 days to framing", "add a week",
// "add a crew / 2 people / 10%".
const ADD_AMOUNT = /\badd(?:ing)?\s+(?:another\s+|an?\s+extra\s+|\d+(?:\.\d+)?\s*|(?:a|an|one|two|three|four|five|a couple of|a few)\s+)?(?:more\s+)?(?:(?:days?|weeks?|months?|hours?|crews?|people|workers?|guys|men|percent|buffer|float|lag)\b|%)/i;

/** True when the text asks to add new task(s) to the schedule. */
export function isAddTaskRequest(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  if (NEW_TASK.test(t)) return true;
  if (!ADD_VERB.test(t)) return false;
  if (ADD_AMOUNT.test(t)) return false;
  // "insert X between A and B" / "add X after Y" name a position — that is new work.
  if (/\b(insert|inserting)\b/i.test(t)) return true;
  if (/\b(add|create)\b[^.?!]*\b(after|before|between)\b/i.test(t)) return true;
  return TASK_NOUN.test(t);
}

/** The editor's seed: his words, plus the rows he had selected so the editor
 *  knows where "after these" points. */
export function editorSeedFor(text: string, selectedTitles: string[]): string {
  const t = text.trim();
  if (selectedTitles.length === 0) return t;
  const shown = selectedTitles.slice(0, 5).join(', ') + (selectedTitles.length > 5 ? `, +${selectedTitles.length - 5} more` : '');
  return `${t} (selected: ${shown})`;
}
