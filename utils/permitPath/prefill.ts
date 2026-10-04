// utils/permitPath/prefill.ts — suggested answers, each with where it came
// from. A pre-fill is NEVER an answer: the UI needs a Confirm tap before it is
// stored (PLAN §6.6). Null means "nothing to suggest", never a guess.

import type { BuildingParcel } from '@/utils/buildingRecord';
import { resolveBuildingYear } from '@/utils/buildingYear';
import { buildingYearChip, type BuildingYear } from '@/utils/buildingScopeTriggers';
import type { PlaceMatch } from '@/utils/permitOffices';
import { PP_COPY } from '@/utils/permitPath/copy';
import type { Question } from '@/utils/permitPath/types';

export interface PrefillInputs {
  parcel: BuildingParcel | null;
  /** The entered year and PLUTO's, as resolveBuildingYear takes them. */
  buildingYear: { entered: BuildingYear | null; pluto: BuildingYear | null } | null;
  officeTitle: string | null;
  placeMatch: PlaceMatch | null;
  /** scopeSummary(project): estimate line names joined with '; '. */
  scope: string;
  /** TRADE_HINTS from the packs: choice id → lowercase phrases. */
  tradeHints: Readonly<Record<string, readonly string[]>>;
}

export interface Prefill { value: string | string[] | number; note: string }

function choiceMatching(q: Question, re: RegExp): string | null {
  const c = (q.choices ?? []).find((ch) => re.test(ch.id) || re.test(ch.label));
  return c ? c.id : null;
}

export function prefillFor(question: Question, inputs: PrefillInputs): Prefill | null {
  switch (question.prefill) {
    case 'pluto_landmark': {
      const p = inputs.parcel;
      if (!p || p.status !== 'ok') return null;
      const names = [p.landmark, p.historicDistrict].filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim());
      if (names.length) {
        return { value: 'yes', note: PP_COPY.prefill.plutoLists(names.join(' and '), p.plutoVersion ?? p.asOf ?? 'version not given') };
      }
      return { value: 'no', note: PP_COPY.prefill.plutoNone };
    }
    case 'building_year': {
      if (!inputs.buildingYear) return null;
      const r = resolveBuildingYear(inputs.buildingYear.entered, inputs.buildingYear.pluto);
      if (!r.year) return null;
      return { value: r.year.year, note: buildingYearChip(r.year, r.pluto) };
    }
    case 'permit_office': {
      const title = inputs.officeTitle?.trim();
      if (!title) return null;
      const pin = inputs.placeMatch !== 'address';
      const note = pin ? `${title} · ${PP_COPY.prefill.fromPin}` : title;
      if (!question.choices || !question.choices.length) return { value: title, note };
      const unsure = choiceMatching(question, /not[ _-]?sure|unsure/i);
      // Village vs town is never picked for the GC off a map pin (PLAN §6.9).
      if (pin) return unsure ? { value: unsure, note } : null;
      const kind = /^village of/i.test(title) ? /village/i : /^town of/i.test(title) ? /town/i : /^city of/i.test(title) ? /city/i : null;
      const pick = (kind && choiceMatching(question, kind)) || unsure;
      return pick ? { value: pick, note } : null;
    }
    case 'scope_trades': {
      const lines = inputs.scope.split(';').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return null;
      const ids = (question.choices ?? []).map((c) => c.id);
      const picked: string[] = [];
      let firstLine: string | null = null;
      for (const id of ids) {
        const phrases = inputs.tradeHints[id] ?? [];
        const line = lines.find((l) => phrases.some((ph) => ph && l.toLowerCase().includes(ph.toLowerCase())));
        if (line) {
          picked.push(id);
          if (firstLine === null) firstLine = line;
        }
      }
      if (!picked.length || firstLine === null) return null;
      return { value: picked, note: PP_COPY.prefill.fromEstimate(firstLine) };
    }
    default:
      return null;
  }
}
