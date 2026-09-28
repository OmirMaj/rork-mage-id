// utils/buildingRecordClient.ts — the one door to the `building-record` edge
// function (NYC DOB / NYC Open Data, JWT on, free for every tier).
//
// Two rules this file exists to hold:
//   1. The function name is passed to functions.invoke as the STRING LITERAL
//      'building-record'. scripts/validate-edge-cors-headers.ts discovers the
//      functions the app calls only by that literal; passing the constant
//      (BUILDING_RECORD_FUNCTION) would quietly take this function outside the
//      CORS guard.
//   2. A failure never surfaces raw error text. Whatever threw — the network,
//      the gateway, a non-2xx — the caller gets one fixed sentence that says
//      NOTHING was checked, so a dropped connection can never read as "no
//      violations".

import { supabase } from '@/lib/supabase';
import {
  parseBuildingRecordResponse,
  parseNjBuildingRecordResponse,
  parseMdBuildingRecordResponse,
  type BuildingRecordRequest,
  type BuildingRecordResponse,
  type NjBuildingRecordRequest,
  type NjBuildingRecordResponse,
  type MdBuildingRecordRequest,
  type MdBuildingRecordResponse,
  type MdSide,
} from '@/utils/buildingRecord';

export const BUILDING_RECORD_NETWORK_ERROR = "Couldn't reach NYC Open Data — nothing was checked.";

function networkError(): BuildingRecordResponse {
  return { status: 'error', code: 'network', error: BUILDING_RECORD_NETWORK_ERROR };
}

export async function invokeBuildingRecord(req: BuildingRecordRequest): Promise<BuildingRecordResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('building-record', { body: req });
    if (error) return networkError();
    if (data == null) return networkError();
    return parseBuildingRecordResponse(data);
  } catch {
    return networkError();
  }
}

export function checkDobPermit(permitNumber: string): Promise<BuildingRecordResponse> {
  return invokeBuildingRecord({ mode: 'permit', permitNumber: permitNumber.trim() });
}

export function fetchReviewBenchmark(borough: string): Promise<BuildingRecordResponse> {
  return invokeBuildingRecord({ mode: 'benchmark', borough });
}

export const NJ_BUILDING_RECORD_NETWORK_ERROR = "Couldn't reach the New Jersey lookup — nothing was checked.";

/** The New Jersey modes (nj_resolve / nj_record) of the same function. Same
 *  two rules: the LITERAL name, and one fixed sentence for every failure. */
export async function fetchNjBuildingRecord(req: NjBuildingRecordRequest): Promise<NjBuildingRecordResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('building-record', { body: req });
    if (error || data == null) return { status: 'error', code: 'network', error: NJ_BUILDING_RECORD_NETWORK_ERROR };
    return parseNjBuildingRecordResponse(data);
  } catch {
    return { status: 'error', code: 'network', error: NJ_BUILDING_RECORD_NETWORK_ERROR };
  }
}

export const MD_BUILDING_RECORD_NETWORK_ERROR = "Couldn't reach the Baltimore lookup — nothing was checked.";

/** The Maryland modes (md_resolve / md_record) of the same function. Same two
 *  rules: ONE literal invoke('building-record') for both modes, and one fixed
 *  sentence for every failure. */
async function invokeMd(req: MdBuildingRecordRequest): Promise<MdBuildingRecordResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('building-record', { body: req });
    if (error || data == null) return { status: 'error', code: 'network', error: MD_BUILDING_RECORD_NETWORK_ERROR };
    return parseMdBuildingRecordResponse(data);
  } catch {
    return { status: 'error', code: 'network', error: MD_BUILDING_RECORD_NETWORK_ERROR };
  }
}

/** Parcel candidates for a Baltimore address (never auto-picked). */
export function fetchMdResolve(text: string, lat: number | null, lon: number | null): Promise<MdBuildingRecordResponse> {
  return invokeMd({ mode: 'md_resolve', text, lat, lon });
}

/** The confirmed parcel's City or County record. */
export function fetchMdRecord(side: MdSide, key: string, lat: number, lon: number): Promise<MdBuildingRecordResponse> {
  return invokeMd({ mode: 'md_record', side, key, lat, lon });
}
