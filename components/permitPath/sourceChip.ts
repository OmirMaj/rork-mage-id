// components/permitPath/sourceChip.ts — the ONE function that says where a
// Permit Path line comes from (lane PPUI; PLAN §6.1: no line without a chip).
//
// Every RouteItem the screen draws goes through sourceChipFor, and the item row
// in StationDetail takes the result as a REQUIRED prop, so a row cannot render
// without one (scripts/validate-permit-path-ui.ts pins both, and that the switch
// below covers all seven certainties).
//
// PURE (no React, no React Native): bun loads it.

import type { Certainty, Duration, RouteItem } from '@/utils/permitPath/types';
import { PP_COPY, ppDay } from '@/utils/permitPath/copy';
import { isStale, saidByLabel, STALE_LINE, type SavedDeptAnswer } from '@/utils/permitPath/deptAnswers';

export type SourceChipTone = 'source' | 'department' | 'records' | 'answer' | 'ai' | 'unknown';

export interface SourceChip {
  certainty: Certainty;
  tone: SourceChipTone;
  /** The exact chip text. */
  label: string;
  /** What a tap does: open the official page, or open the ask-the-department sheet. */
  action: { kind: 'link'; url: string } | { kind: 'ask'; questionId: string } | null;
  /** A department answer older than 365 days (PLAN F4): the chip shows STALE_LINE too. */
  stale: boolean;
  staleLabel: string | null;
}

export interface SourceChipOpts {
  /** 'YYYY-MM-DD', for the stale check. */
  today: string;
  /** The date formatter (the screen passes formatCalendarDay); defaults to the engine's. */
  formatDay?: (iso: string) => string;
  /** The saved answer behind a department_said line, for saidByLabel. */
  savedAnswer?: (id: string) => SavedDeptAnswer | undefined;
}

const NYC_DOB_DATA = 'NYC DOB data';

export function sourceChipFor(item: RouteItem, opts: SourceChipOpts): SourceChip {
  const day = opts.formatDay ?? ppDay;
  const base = { certainty: item.certainty, stale: false, staleLabel: null } as const;
  switch (item.certainty) {
    case 'verified': {
      const s = item.source;
      // The engine's shape guard makes this unreachable; if it ever is, the
      // line says it has no source rather than borrowing "checked".
      if (!s) return { ...base, tone: 'unknown', label: PP_COPY.chips.unknown, action: item.askQuestionId ? { kind: 'ask', questionId: item.askQuestionId } : null };
      return { ...base, tone: 'source', label: `${s.label} · checked ${day(s.checkedOn)}`, action: /^https:\/\//.test(s.url) ? { kind: 'link', url: s.url } : null };
    }
    case 'department_said': {
      const a = item.answer;
      if (!a) return { ...base, tone: 'unknown', label: PP_COPY.chips.unknown, action: item.askQuestionId ? { kind: 'ask', questionId: item.askQuestionId } : null };
      const saved = opts.savedAnswer?.(a.id);
      const who = saved ? saidByLabel(saved) : a.saidBy && a.saidBy.trim() ? a.saidBy.trim() : 'Building department';
      const stale = isStale({ answeredOn: a.answeredOn }, opts.today);
      return {
        certainty: item.certainty,
        tone: 'department',
        label: `Department said · ${day(a.answeredOn)} · ${who}`,
        action: a.sourceUrl && /^https:\/\//.test(a.sourceUrl) ? { kind: 'link', url: a.sourceUrl } : null,
        stale,
        staleLabel: stale ? STALE_LINE : null,
      };
    }
    case 'your_records':
      return { ...base, tone: 'records', label: PP_COPY.chips.yourRecords, action: null };
    case 'measured':
      return { ...base, tone: 'records', label: NYC_DOB_DATA, action: null };
    case 'your_answer':
      return { ...base, tone: 'answer', label: PP_COPY.chips.yourAnswer, action: null };
    case 'ai_draft':
      return { ...base, tone: 'ai', label: PP_COPY.chips.aiDraft, action: null };
    case 'unknown':
      return { ...base, tone: 'unknown', label: PP_COPY.chips.unknown, action: item.askQuestionId ? { kind: 'ask', questionId: item.askQuestionId } : null };
    default: {
      const never: never = item.certainty;
      return never;
    }
  }
}

/** Where a station's duration comes from, in one line (the detail's duration block). */
export function durationSourceLine(d: Duration, formatDay: (iso: string) => string = ppDay): string {
  switch (d.kind) {
    case 'measured':
      return d.source ? `${d.source.label} · checked ${formatDay(d.source.checkedOn)}` : NYC_DOB_DATA;
    case 'your_records':
      return PP_COPY.chips.yourRecords;
    case 'department_said':
      return d.answer ? `Department said · ${formatDay(d.answer.answeredOn)}${d.answer.saidBy ? ` · ${d.answer.saidBy}` : ''}` : PP_COPY.durations.unknown;
    case 'stated_max':
      return d.source ? `${d.source.label} · checked ${formatDay(d.source.checkedOn)}` : PP_COPY.durations.unknown;
    case 'unknown':
      return PP_COPY.durations.unknown;
    default: {
      const never: never = d.kind;
      return never;
    }
  }
}
