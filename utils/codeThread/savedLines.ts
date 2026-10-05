/**
 * A SAVED Code Check's lists, as they may be printed.
 *
 * COPYRIGHT. A check saved before the own-words gate existed (or synced from
 * an older build) holds the AI's raw permits / inspections / violations lines
 * and the AI's raw follow-up questions. Wherever a saved check prints, each of
 * those lines goes through the kit's list gate (utils/codeCard/echoCheck
 * ownWordsList: prose mode, a line whole or not at all), and the list says so
 * once, where the first hidden line was, with the section numbers the hidden
 * lines named.
 *
 * Unlike ownWordsList this keeps each kept line's STORED position: an action
 * taken on a saved line ("Added to punch list") is recorded against the
 * line's index in the stored list, so a line hidden above it must not move it.
 *
 * Pure. The stored record is read, never changed.
 */
import { ownWordsList } from '@/utils/codeCard/echoCheck';

export interface SavedLines {
  /** The lines that passed whole, in order. */
  items: string[];
  /** `indexes[i]` is where `items[i]` sits in the stored list. */
  indexes: number[];
  /** How many stored lines were hidden. 0 = nothing was hidden. */
  withheld: number;
  /** Section numbers the hidden lines named, in order, each once. */
  sections: string[];
  /** Where the notice prints, once: before `items[noticeAt]` (`items.length` = after the last). -1 = no notice. */
  noticeAt: number;
}

export function savedOwnWordsLines(lines: unknown): SavedLines {
  const out: SavedLines = { items: [], indexes: [], withheld: 0, sections: [], noticeAt: -1 };
  if (!Array.isArray(lines)) return out;
  lines.forEach((line: unknown, index: number) => {
    // One line at a time through the kit's own list gate, so the rule is its rule.
    const one = ownWordsList([line]);
    if (one.withheld > 0) {
      out.withheld += 1;
      for (const s of one.sections) if (!out.sections.includes(s)) out.sections.push(s);
      if (out.noticeAt < 0) out.noticeAt = out.items.length;
    } else if (one.items.length > 0) {
      out.items.push(one.items[0]);
      out.indexes.push(index);
    }
  });
  return out;
}
