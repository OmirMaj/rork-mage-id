// hooks/useJobBuildingRecord.ts — ONE building-record state for a job,
// whichever jurisdiction it is in (contract X3).
//
// NYC jobs get useBuildingRecord's state unchanged: summary, phase and the
// three strings below are byte-identical to what the Roadmap and Code Check
// printed before this file existed. Baltimore (Maryland) jobs get
// useMdBuildingRecord's state. Both inner hooks are ALWAYS called (rules of
// hooks); each is inert for the other jurisdiction, so an NYC job never reads
// the Baltimore services and a Portland job reads nothing at all.

import { useMemo } from 'react';
import type { Project } from '@/types';
import { useBuildingRecord, type BuildingRecordState } from '@/hooks/useBuildingRecord';
import { useMdBuildingRecord, type MdBuildingRecordState } from '@/hooks/useMdBuildingRecord';
import { mdRecordAsOf, type BuildingRecord, type BuildingRecordSummary } from '@/utils/buildingRecord';

export interface JobBuildingRecordState {
  /** An NYC job or a Maryland job. */
  supported: boolean;
  jurisdiction: 'nyc' | 'baltimore_city' | 'baltimore_county' | null;
  phase: BuildingRecordState['phase'];
  /** NYC: exactly useBuildingRecord(...).summary. */
  summary: BuildingRecordSummary;
  /** The record's as-of day (MD: newest dataset as-of; NYC: newest dataset as-of), null when not ready. */
  asOf: string | null;
  /** Where the record comes from, for a prompt or a label. */
  sourceLabel: string;
  /** What a check says when the record was not loaded. */
  notCheckedHeadline: string;
  /** The sentence pair the Roadmap's "Before you add this permit" alert ends with. */
  attentionNote: string;
  /** From the Baltimore side ONLY when the contractor confirmed a parcel
   *  (parcel-layer containment decided it); null for NYC and otherwise.
   *  Feeds jurisdictionQueryForProject's second argument (X4). */
  confirmedCounty: 'Baltimore city' | 'Baltimore County' | null;
  nyc: BuildingRecordState;
  md: MdBuildingRecordState;
}

// NYC — byte-identical to the literals app/(tabs)/construction-ai/index.tsx
// printed before X3 (validate-building-record reads that file and compares).
export const NYC_SOURCE_LABEL = "DOB's public records";
export const NYC_NOT_CHECKED_HEADLINE = 'DOB record not checked (building not confirmed or not loaded)';
export const NYC_ATTENTION_NOTE = "These are DOB's public records as published. Ask your expeditor or applicant of record before you price.";

export const MD_CITY_SOURCE_LABEL = "Baltimore City's open data (Open Baltimore)";
export const MD_COUNTY_SOURCE_LABEL = "Baltimore County's open data";
export const MD_UNCONFIRMED_SOURCE_LABEL = 'Baltimore City or Baltimore County open data';
export const MD_NOT_CHECKED_HEADLINE = 'Baltimore record not checked (address not confirmed or not loaded)';
export const MD_CITY_ATTENTION_NOTE = "These are Baltimore City's open data as published (open notices only). Check the notice with DHCD before you price.";
/** A Maryland job the resolver placed outside both Baltimores: there is no
 *  Baltimore record to check, which is not the same as "not loaded". */
export function mdOutsideHeadline(county: string | null): string {
  return `Building record not available for ${county ?? 'this address'} (MAGE reads Baltimore City and Baltimore County only)`;
}
export const MD_COUNTY_ATTENTION_NOTE = "These are Baltimore County's open data as published. Check with PAI before you price.";

function nycAsOf(rec: BuildingRecord | null): string | null {
  if (!rec) return null;
  const days = rec.datasets.filter((d) => d.status === 'ok' && d.asOf).map((d) => (d.asOf as string).slice(0, 10));
  return days.sort().pop() ?? null;
}

export function useJobBuildingRecord(project: Project | null | undefined): JobBuildingRecordState {
  const nyc = useBuildingRecord(project);
  const md = useMdBuildingRecord(project);

  return useMemo<JobBuildingRecordState>(() => {
    if (nyc.supported || !md.supported) {
      // NYC, or neither: today's NYC state and strings, unchanged.
      return {
        supported: nyc.supported,
        jurisdiction: nyc.supported ? 'nyc' : null,
        phase: nyc.phase,
        summary: nyc.summary,
        asOf: nyc.phase === 'ready' ? nycAsOf(nyc.record) : null,
        sourceLabel: NYC_SOURCE_LABEL,
        notCheckedHeadline: NYC_NOT_CHECKED_HEADLINE,
        attentionNote: NYC_ATTENTION_NOTE,
        confirmedCounty: null,
        nyc,
        md,
      };
    }
    const side = md.confirmed ? md.confirmed.side : null;
    return {
      supported: true,
      jurisdiction: side,
      phase: md.phase,
      summary: md.summary,
      asOf: md.phase === 'ready' ? mdRecordAsOf(md.record) : null,
      sourceLabel: side === 'baltimore_city' ? MD_CITY_SOURCE_LABEL : side === 'baltimore_county' ? MD_COUNTY_SOURCE_LABEL : MD_UNCONFIRMED_SOURCE_LABEL,
      notCheckedHeadline: md.outside ? mdOutsideHeadline(md.outside.county) : MD_NOT_CHECKED_HEADLINE,
      attentionNote: side === 'baltimore_county' ? MD_COUNTY_ATTENTION_NOTE : MD_CITY_ATTENTION_NOTE,
      confirmedCounty: side === 'baltimore_city' ? 'Baltimore city' : side === 'baltimore_county' ? 'Baltimore County' : null,
      nyc,
      md,
    };
  }, [nyc, md]);
}

export default useJobBuildingRecord;
