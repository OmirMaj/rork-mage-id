// utils/permitPath/readiness.ts — the pre-filing check ("Ready to file?") and
// its plain-text share. PURE.
//
// An item MAGE does not know (certainty 'unknown') reads "Not known yet" even
// when the GC marked it "have": the department has not said it is needed, so
// nobody can say it is in hand. It moves once a department answer is saved.

import { PP_COPY, ppDay } from '@/utils/permitPath/copy';
import { STATION_ORDER, type PermitRoute, type ReadinessMark, type ReadinessMarks, type RouteItem } from '@/utils/permitPath/types';

export type ReadinessState = 'have' | 'missing' | 'n_a' | 'unknown';
export interface ReadinessRow { item: RouteItem; mark: ReadinessMark | null; state: ReadinessState }
export interface ReadinessTally { have: number; missing: number; unknown: number; n_a: number; total: number }

const GROUP_ORDER: readonly ReadinessState[] = ['missing', 'unknown', 'have', 'n_a'];

export function readinessFor(route: PermitRoute, marks: ReadinessMarks): { rows: ReadinessRow[]; tally: ReadinessTally } {
  const ordered: ReadinessRow[] = [];
  for (const sid of STATION_ORDER) {
    const st = route.stations.find((s) => s.id === sid);
    if (!st || st.state === 'not_needed') continue;
    for (const item of st.items) {
      if (!item.readiness) continue;
      const mark = marks[item.id] ?? null;
      const state: ReadinessState = item.certainty === 'unknown' ? 'unknown' : mark ? mark.state : 'missing';
      ordered.push({ item, mark, state });
    }
  }
  const rows = GROUP_ORDER.flatMap((g) => ordered.filter((r) => r.state === g));
  const count = (g: ReadinessState) => rows.filter((r) => r.state === g).length;
  const tally = { have: count('have'), missing: count('missing'), unknown: count('unknown'), n_a: count('n_a'), total: 0 };
  tally.total = tally.have + tally.missing + tally.unknown;
  return { rows, tally };
}

/** Where a line's claim comes from, as plain text (a URL or a dated answer). */
export function itemSourceText(item: RouteItem): string {
  switch (item.certainty) {
    case 'verified':
      return item.source ? `${item.source.label} · ${item.source.url} · checked ${ppDay(item.source.checkedOn)}` : PP_COPY.chips.unknown;
    case 'department_said': {
      const a = item.answer;
      if (!a) return PP_COPY.chips.unknown;
      return [PP_COPY.chips.departmentSaid(a.answeredOn, a.saidBy), a.channel, a.sourceUrl].filter((x): x is string => !!x && !!x.trim()).join(' · ');
    }
    case 'your_records': return PP_COPY.chips.yourRecords;
    case 'measured': return 'NYC DOB data';
    case 'your_answer': return PP_COPY.chips.yourAnswer;
    case 'ai_draft': return PP_COPY.chips.aiDraft;
    default: return PP_COPY.chips.unknown;
  }
}

const STATE_HEAD: Readonly<Record<ReadinessState, string>> = {
  missing: PP_COPY.readiness.missing,
  unknown: PP_COPY.readiness.unknown,
  have: PP_COPY.readiness.have,
  n_a: PP_COPY.readiness.notNeeded,
};

/** The checklist as plain text for the architect, engineer or expediter. */
export function shareText(route: PermitRoute, rows: readonly ReadinessRow[], opts: { company: string; address: string; today: string }): string {
  const tally = {
    have: rows.filter((r) => r.state === 'have').length,
    missing: rows.filter((r) => r.state === 'missing').length,
    unknown: rows.filter((r) => r.state === 'unknown').length,
  };
  const total = tally.have + tally.missing + tally.unknown;
  const lines: string[] = [];
  lines.push(`${PP_COPY.readiness.title} · ${opts.address.trim()}`);
  lines.push(route.jurisdiction.officeTitle ?? route.jurisdiction.name);
  lines.push(tally.unknown ? `${PP_COPY.readiness.inHand(tally.have, total)} · ${PP_COPY.readiness.notKnown(tally.unknown)}` : PP_COPY.readiness.inHand(tally.have, total));
  for (const g of GROUP_ORDER) {
    const group = rows.filter((r) => r.state === g);
    if (!group.length) continue;
    lines.push('');
    lines.push(STATE_HEAD[g]);
    for (const r of group) {
      const title = route.stations.find((s) => s.id === r.item.station)?.title ?? r.item.station;
      lines.push(`- ${r.item.text} (${title}) · ${itemSourceText(r.item)}`);
    }
  }
  lines.push('');
  lines.push(PP_COPY.readiness.footer(opts.company, opts.today));
  lines.push(PP_COPY.confirmLine('filing', route.jurisdiction.officeTitle));
  return lines.join('\n');
}

/** S2: a grounding block for construction-answer. Department answers are quoted
 *  with their date; unknowns are named as unknown. */
export function routeSummaryForAsk(route: PermitRoute): string {
  const j = route.jurisdiction;
  const lines: string[] = [`PERMIT PATH (${j.officeTitle ?? j.name}; key ${j.key}; family ${j.family})`];
  for (const s of route.stations) {
    lines.push(`${s.title}: ${PP_COPY.stateLabel(s.state)}${s.notNeededBecause ? ` (${s.notNeededBecause})` : ''} · duration ${s.duration.label}`);
    for (const i of s.items) lines.push(`  - ${i.text} [${itemSourceText(i)}]`);
  }
  lines.push(`Not known yet: ${route.unknownCount}. Treat every line marked "${PP_COPY.chips.unknown}" as unknown; never fill it in.`);
  return lines.join('\n');
}
