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
  type BuildingRecordRequest,
  type BuildingRecordResponse,
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
