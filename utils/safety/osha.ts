// utils/safety/osha.ts — pure OSHA-recordable classifier for incidents.
//
// Mirrors the OSHA 1904 general recording criteria: a work-related injury or
// illness is recordable if it results in death, days away from work,
// restricted work / job transfer, loss of consciousness, or medical treatment
// beyond first aid. Near-misses and pure property / environmental events with
// no injury are not recordable (a fatality always is). Pure logic — no UI,
// unit-tested by scripts/validate-safety-osha.ts.

export type IncidentType = 'injury' | 'near_miss' | 'property' | 'environmental';
export type Treatment = 'none' | 'first_aid' | 'medical_beyond_first_aid';

export interface IncidentClassInput {
  type: IncidentType;
  treatment: Treatment;
  daysAway: number;
  restrictedDuty: boolean;
  lostConsciousness: boolean;
  fatality: boolean;
}

export function isOshaRecordable(input: IncidentClassInput): boolean {
  // A fatality is recordable regardless of any other field.
  if (input.fatality) return true;
  // Only actual injury/illness cases can be recordable — a near-miss,
  // property-damage, or environmental event with no injury is not.
  if (input.type !== 'injury') return false;
  if (input.daysAway > 0) return true;
  if (input.restrictedDuty) return true;
  if (input.lostConsciousness) return true;
  if (input.treatment === 'medical_beyond_first_aid') return true;
  // First-aid-only or no treatment → not recordable.
  return false;
}
