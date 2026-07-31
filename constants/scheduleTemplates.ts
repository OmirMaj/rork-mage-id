// The flagship "Overlook Estate" spine is authored in flagshipProject.ts and
// re-exported here as a reusable template. flagshipProject.ts imports ONLY the
// `ScheduleTemplate` type from this file (type-only, erased at runtime), so
// there is no runtime import cycle — the value edge runs one way only.
import { FLAGSHIP_SCHEDULE_TEMPLATE } from '@/constants/flagshipProject';
// Type-only — erased at compile time, so this adds no runtime edge and cannot
// create an import cycle. types/index.ts imports nothing at all.
import type { DependencyLink, ScheduleTask } from '@/types';

export interface TemplateTask {
  id: string;
  name: string;
  phase: string;
  duration: number;
  predecessorIds: string[];
  /**
   * Lag (positive) / lead (negative) per dependency, in days, keyed by
   * PREDECESSOR ID. `{ 'kr-6': 2 }` on Drywall means "start 2 days after
   * Framing finishes"; `-2` means "start 2 days before it finishes" (an
   * overlap — schedulers call it a lead).
   *
   * Why a sparse optional map rather than turning `predecessorIds: string[]`
   * into `links: { id, lag }[]`:
   *   • ADDITIVE. Every shipped template in SCHEDULE_TEMPLATES (and the
   *     flagship spine authored in flagshipProject.ts) has no lag, so none of
   *     them changes by so much as a character, and a persisted draft written
   *     before this feature deserialises unchanged.
   *   • `predecessorIds` stays the one place the GRAPH lives. Every list
   *     operation below reasons about the graph; making the shape of an edge
   *     also the shape of the graph would mean touching all of them, and the
   *     one invariant this file defends (a predecessor exists and sits
   *     earlier) has nothing to do with lag.
   *   • Absent key === 0, and 0 is never stored (see `normaliseLags`), so
   *     there is exactly ONE representation of "no wait" — a row with no
   *     offsets is byte-identical to one authored before lag existed.
   * The cost is that the map can go stale when the graph moves, which is the
   * whole reason `normaliseLags` runs inside `repairChain`.
   *
   * Units are CALENDAR days, because that is what utils/cpm.ts adds to a
   * predecessor's EF (`required = depCpm.ef + lag + 1`). "Wait 2 days for the
   * slab to cure" is a wall-clock wait; it does not skip the weekend.
   */
  lags?: Record<string, number>;
  isMilestone: boolean;
  isCriticalPath: boolean;
  crewSize: number;
}

export interface ScheduleTemplate {
  id: string;
  name: string;
  taskCount: number;
  typicalDuration: string;
  tasks: TemplateTask[];
}

export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    id: 'kitchen-remodel',
    name: 'Kitchen Remodel',
    taskCount: 18,
    typicalDuration: '6 weeks',
    tasks: [
      { id: 'kr-1', name: 'Project Start', phase: 'General', duration: 0, predecessorIds: [], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'kr-2', name: 'Demolition', phase: 'Demo', duration: 2, predecessorIds: ['kr-1'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'kr-3', name: 'Rough Plumbing', phase: 'Plumbing', duration: 2, predecessorIds: ['kr-2'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'kr-4', name: 'Rough Electrical', phase: 'Electrical', duration: 2, predecessorIds: ['kr-2'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'kr-5', name: 'HVAC Rough-In', phase: 'HVAC', duration: 1, predecessorIds: ['kr-2'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'kr-6', name: 'Framing Modifications', phase: 'Framing', duration: 2, predecessorIds: ['kr-3', 'kr-4'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'kr-7', name: 'Rough Inspection', phase: 'Inspections', duration: 1, predecessorIds: ['kr-6'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'kr-8', name: 'Insulation', phase: 'Insulation', duration: 1, predecessorIds: ['kr-7'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'kr-9', name: 'Drywall', phase: 'Drywall', duration: 3, predecessorIds: ['kr-8'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'kr-10', name: 'Prime & Paint', phase: 'Finishes', duration: 2, predecessorIds: ['kr-9'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'kr-11', name: 'Cabinet Installation', phase: 'Interior', duration: 2, predecessorIds: ['kr-10'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'kr-12', name: 'Countertop Installation', phase: 'Interior', duration: 1, predecessorIds: ['kr-11'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'kr-13', name: 'Backsplash Tile', phase: 'Finishes', duration: 2, predecessorIds: ['kr-12'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'kr-14', name: 'Finish Plumbing', phase: 'Plumbing', duration: 1, predecessorIds: ['kr-12'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'kr-15', name: 'Finish Electrical', phase: 'Electrical', duration: 1, predecessorIds: ['kr-12'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'kr-16', name: 'Appliance Installation', phase: 'Interior', duration: 1, predecessorIds: ['kr-14', 'kr-15'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'kr-17', name: 'Final Inspection', phase: 'Inspections', duration: 1, predecessorIds: ['kr-16', 'kr-13'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'kr-18', name: 'Project Complete', phase: 'General', duration: 0, predecessorIds: ['kr-17'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
    ],
  },
  {
    id: 'bathroom-remodel',
    name: 'Bathroom Remodel',
    taskCount: 12,
    typicalDuration: '3 weeks',
    tasks: [
      { id: 'br-1', name: 'Project Start', phase: 'General', duration: 0, predecessorIds: [], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'br-2', name: 'Demolition', phase: 'Demo', duration: 1, predecessorIds: ['br-1'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'br-3', name: 'Rough Plumbing', phase: 'Plumbing', duration: 2, predecessorIds: ['br-2'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'br-4', name: 'Rough Electrical', phase: 'Electrical', duration: 1, predecessorIds: ['br-2'], isMilestone: false, isCriticalPath: false, crewSize: 1 },
      { id: 'br-5', name: 'Waterproofing', phase: 'General', duration: 1, predecessorIds: ['br-3'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'br-6', name: 'Tile Installation', phase: 'Finishes', duration: 3, predecessorIds: ['br-5'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'br-7', name: 'Vanity & Mirror', phase: 'Interior', duration: 1, predecessorIds: ['br-6'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'br-8', name: 'Finish Plumbing', phase: 'Plumbing', duration: 1, predecessorIds: ['br-7'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'br-9', name: 'Finish Electrical', phase: 'Electrical', duration: 1, predecessorIds: ['br-7'], isMilestone: false, isCriticalPath: false, crewSize: 1 },
      { id: 'br-10', name: 'Paint & Trim', phase: 'Finishes', duration: 1, predecessorIds: ['br-8', 'br-9'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'br-11', name: 'Final Inspection', phase: 'Inspections', duration: 1, predecessorIds: ['br-10'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'br-12', name: 'Project Complete', phase: 'General', duration: 0, predecessorIds: ['br-11'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
    ],
  },
  {
    id: 'basement-finish',
    name: 'Basement Finish',
    taskCount: 20,
    typicalDuration: '8 weeks',
    tasks: [
      { id: 'bf-1', name: 'Project Start', phase: 'General', duration: 0, predecessorIds: [], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'bf-2', name: 'Layout & Design Review', phase: 'General', duration: 1, predecessorIds: ['bf-1'], isMilestone: false, isCriticalPath: true, crewSize: 1 },
      { id: 'bf-3', name: 'Waterproofing & Drainage', phase: 'Site Work', duration: 3, predecessorIds: ['bf-2'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'bf-4', name: 'Framing Walls', phase: 'Framing', duration: 4, predecessorIds: ['bf-3'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'bf-5', name: 'Rough Plumbing', phase: 'Plumbing', duration: 2, predecessorIds: ['bf-4'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'bf-6', name: 'Rough Electrical', phase: 'Electrical', duration: 3, predecessorIds: ['bf-4'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'bf-7', name: 'HVAC Ductwork', phase: 'HVAC', duration: 2, predecessorIds: ['bf-4'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'bf-8', name: 'Rough Inspection', phase: 'Inspections', duration: 1, predecessorIds: ['bf-5', 'bf-6', 'bf-7'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'bf-9', name: 'Insulation', phase: 'Insulation', duration: 2, predecessorIds: ['bf-8'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'bf-10', name: 'Drywall Hang', phase: 'Drywall', duration: 3, predecessorIds: ['bf-9'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'bf-11', name: 'Drywall Tape & Mud', phase: 'Drywall', duration: 3, predecessorIds: ['bf-10'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'bf-12', name: 'Prime & Paint', phase: 'Finishes', duration: 3, predecessorIds: ['bf-11'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'bf-13', name: 'Flooring Installation', phase: 'Finishes', duration: 3, predecessorIds: ['bf-12'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'bf-14', name: 'Trim & Doors', phase: 'Interior', duration: 2, predecessorIds: ['bf-13'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'bf-15', name: 'Bathroom Tile', phase: 'Finishes', duration: 3, predecessorIds: ['bf-12'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'bf-16', name: 'Finish Plumbing', phase: 'Plumbing', duration: 1, predecessorIds: ['bf-15'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'bf-17', name: 'Finish Electrical', phase: 'Electrical', duration: 1, predecessorIds: ['bf-14'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'bf-18', name: 'Final Cleanup', phase: 'General', duration: 1, predecessorIds: ['bf-16', 'bf-17'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'bf-19', name: 'Final Inspection', phase: 'Inspections', duration: 1, predecessorIds: ['bf-18'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'bf-20', name: 'Project Complete', phase: 'General', duration: 0, predecessorIds: ['bf-19'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
    ],
  },
  {
    id: 'roof-replacement',
    name: 'Roof Replacement',
    taskCount: 8,
    typicalDuration: '1 week',
    tasks: [
      { id: 'rr-1', name: 'Project Start', phase: 'General', duration: 0, predecessorIds: [], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'rr-2', name: 'Material Delivery', phase: 'General', duration: 1, predecessorIds: ['rr-1'], isMilestone: false, isCriticalPath: true, crewSize: 1 },
      { id: 'rr-3', name: 'Tear-Off Existing Roof', phase: 'Demo', duration: 1, predecessorIds: ['rr-2'], isMilestone: false, isCriticalPath: true, crewSize: 5 },
      { id: 'rr-4', name: 'Inspect & Repair Decking', phase: 'Framing', duration: 1, predecessorIds: ['rr-3'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'rr-5', name: 'Install Underlayment & Flashing', phase: 'Roofing', duration: 1, predecessorIds: ['rr-4'], isMilestone: false, isCriticalPath: true, crewSize: 4 },
      { id: 'rr-6', name: 'Install Shingles', phase: 'Roofing', duration: 2, predecessorIds: ['rr-5'], isMilestone: false, isCriticalPath: true, crewSize: 5 },
      { id: 'rr-7', name: 'Cleanup & Final Inspection', phase: 'Inspections', duration: 1, predecessorIds: ['rr-6'], isMilestone: true, isCriticalPath: true, crewSize: 2 },
      { id: 'rr-8', name: 'Project Complete', phase: 'General', duration: 0, predecessorIds: ['rr-7'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
    ],
  },
  {
    id: 'new-home',
    name: 'New Home Construction',
    taskCount: 30,
    typicalDuration: '26 weeks',
    tasks: [
      { id: 'nh-1', name: 'Project Start', phase: 'General', duration: 0, predecessorIds: [], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'nh-2', name: 'Permits & Survey', phase: 'General', duration: 5, predecessorIds: ['nh-1'], isMilestone: false, isCriticalPath: true, crewSize: 1 },
      { id: 'nh-3', name: 'Site Clearing & Grading', phase: 'Site Work', duration: 3, predecessorIds: ['nh-2'], isMilestone: false, isCriticalPath: true, crewSize: 4 },
      { id: 'nh-4', name: 'Excavation', phase: 'Site Work', duration: 2, predecessorIds: ['nh-3'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'nh-5', name: 'Foundation Forms & Pour', phase: 'Foundation', duration: 5, predecessorIds: ['nh-4'], isMilestone: false, isCriticalPath: true, crewSize: 5 },
      { id: 'nh-6', name: 'Foundation Cure & Strip', phase: 'Foundation', duration: 5, predecessorIds: ['nh-5'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'nh-7', name: 'Foundation Inspection', phase: 'Inspections', duration: 1, predecessorIds: ['nh-6'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'nh-8', name: 'Backfill & Waterproof', phase: 'Site Work', duration: 2, predecessorIds: ['nh-7'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'nh-9', name: 'Framing — First Floor', phase: 'Framing', duration: 8, predecessorIds: ['nh-8'], isMilestone: false, isCriticalPath: true, crewSize: 6 },
      { id: 'nh-10', name: 'Framing — Second Floor', phase: 'Framing', duration: 6, predecessorIds: ['nh-9'], isMilestone: false, isCriticalPath: true, crewSize: 6 },
      { id: 'nh-11', name: 'Roof Framing & Sheathing', phase: 'Roofing', duration: 5, predecessorIds: ['nh-10'], isMilestone: false, isCriticalPath: true, crewSize: 5 },
      { id: 'nh-12', name: 'Roofing', phase: 'Roofing', duration: 3, predecessorIds: ['nh-11'], isMilestone: false, isCriticalPath: true, crewSize: 4 },
      { id: 'nh-13', name: 'Windows & Exterior Doors', phase: 'Framing', duration: 3, predecessorIds: ['nh-11'], isMilestone: false, isCriticalPath: false, crewSize: 3 },
      { id: 'nh-14', name: 'Rough Plumbing', phase: 'Plumbing', duration: 5, predecessorIds: ['nh-12'], isMilestone: false, isCriticalPath: false, crewSize: 3 },
      { id: 'nh-15', name: 'Rough Electrical', phase: 'Electrical', duration: 5, predecessorIds: ['nh-12'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'nh-16', name: 'HVAC Rough-In', phase: 'HVAC', duration: 4, predecessorIds: ['nh-12'], isMilestone: false, isCriticalPath: false, crewSize: 3 },
      { id: 'nh-17', name: 'Rough Inspection', phase: 'Inspections', duration: 1, predecessorIds: ['nh-14', 'nh-15', 'nh-16'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'nh-18', name: 'Insulation', phase: 'Insulation', duration: 3, predecessorIds: ['nh-17'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'nh-19', name: 'Drywall', phase: 'Drywall', duration: 8, predecessorIds: ['nh-18'], isMilestone: false, isCriticalPath: true, crewSize: 4 },
      { id: 'nh-20', name: 'Exterior Siding', phase: 'Finishes', duration: 5, predecessorIds: ['nh-13'], isMilestone: false, isCriticalPath: false, crewSize: 3 },
      { id: 'nh-21', name: 'Interior Paint', phase: 'Finishes', duration: 5, predecessorIds: ['nh-19'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'nh-22', name: 'Cabinets & Countertops', phase: 'Interior', duration: 4, predecessorIds: ['nh-21'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'nh-23', name: 'Flooring', phase: 'Finishes', duration: 5, predecessorIds: ['nh-21'], isMilestone: false, isCriticalPath: false, crewSize: 3 },
      { id: 'nh-24', name: 'Trim & Millwork', phase: 'Interior', duration: 4, predecessorIds: ['nh-22', 'nh-23'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'nh-25', name: 'Finish Plumbing', phase: 'Plumbing', duration: 2, predecessorIds: ['nh-24'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'nh-26', name: 'Finish Electrical', phase: 'Electrical', duration: 2, predecessorIds: ['nh-24'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'nh-27', name: 'Landscaping & Driveway', phase: 'Landscaping', duration: 5, predecessorIds: ['nh-20'], isMilestone: false, isCriticalPath: false, crewSize: 4 },
      { id: 'nh-28', name: 'Final Cleanup', phase: 'General', duration: 2, predecessorIds: ['nh-25', 'nh-26', 'nh-27'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'nh-29', name: 'Final Inspection & CO', phase: 'Inspections', duration: 1, predecessorIds: ['nh-28'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'nh-30', name: 'Project Complete', phase: 'General', duration: 0, predecessorIds: ['nh-29'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
    ],
  },
  {
    id: 'commercial-ti',
    name: 'Commercial Tenant Improvement',
    taskCount: 22,
    typicalDuration: '10 weeks',
    tasks: [
      { id: 'ct-1', name: 'Project Start', phase: 'General', duration: 0, predecessorIds: [], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'ct-2', name: 'Permits & Plan Review', phase: 'General', duration: 5, predecessorIds: ['ct-1'], isMilestone: false, isCriticalPath: true, crewSize: 1 },
      { id: 'ct-3', name: 'Demolition', phase: 'Demo', duration: 3, predecessorIds: ['ct-2'], isMilestone: false, isCriticalPath: true, crewSize: 4 },
      { id: 'ct-4', name: 'Framing', phase: 'Framing', duration: 5, predecessorIds: ['ct-3'], isMilestone: false, isCriticalPath: true, crewSize: 4 },
      { id: 'ct-5', name: 'Rough Plumbing', phase: 'Plumbing', duration: 3, predecessorIds: ['ct-4'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'ct-6', name: 'Rough Electrical', phase: 'Electrical', duration: 4, predecessorIds: ['ct-4'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'ct-7', name: 'HVAC Rough-In', phase: 'HVAC', duration: 3, predecessorIds: ['ct-4'], isMilestone: false, isCriticalPath: false, crewSize: 3 },
      { id: 'ct-8', name: 'Fire Sprinkler', phase: 'MEP', duration: 2, predecessorIds: ['ct-4'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'ct-9', name: 'Rough Inspection', phase: 'Inspections', duration: 1, predecessorIds: ['ct-5', 'ct-6', 'ct-7', 'ct-8'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'ct-10', name: 'Insulation', phase: 'Insulation', duration: 2, predecessorIds: ['ct-9'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'ct-11', name: 'Drywall', phase: 'Drywall', duration: 5, predecessorIds: ['ct-10'], isMilestone: false, isCriticalPath: true, crewSize: 4 },
      { id: 'ct-12', name: 'Ceiling Grid', phase: 'Interior', duration: 3, predecessorIds: ['ct-11'], isMilestone: false, isCriticalPath: false, crewSize: 3 },
      { id: 'ct-13', name: 'Paint', phase: 'Finishes', duration: 3, predecessorIds: ['ct-11'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'ct-14', name: 'Flooring', phase: 'Finishes', duration: 4, predecessorIds: ['ct-13'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'ct-15', name: 'Millwork & Casework', phase: 'Interior', duration: 3, predecessorIds: ['ct-14'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'ct-16', name: 'Finish Plumbing', phase: 'Plumbing', duration: 2, predecessorIds: ['ct-15'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'ct-17', name: 'Finish Electrical', phase: 'Electrical', duration: 2, predecessorIds: ['ct-15'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'ct-18', name: 'HVAC Start-Up', phase: 'HVAC', duration: 1, predecessorIds: ['ct-12'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'ct-19', name: 'Signage', phase: 'General', duration: 2, predecessorIds: ['ct-13'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'ct-20', name: 'Final Cleanup', phase: 'General', duration: 1, predecessorIds: ['ct-16', 'ct-17', 'ct-18', 'ct-19'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'ct-21', name: 'Final Inspection & CO', phase: 'Inspections', duration: 1, predecessorIds: ['ct-20'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'ct-22', name: 'Project Complete', phase: 'General', duration: 0, predecessorIds: ['ct-21'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
    ],
  },
  {
    id: 'exterior-renovation',
    name: 'Exterior Renovation',
    taskCount: 15,
    typicalDuration: '4 weeks',
    tasks: [
      { id: 'er-1', name: 'Project Start', phase: 'General', duration: 0, predecessorIds: [], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'er-2', name: 'Scaffolding Setup', phase: 'Site Work', duration: 1, predecessorIds: ['er-1'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'er-3', name: 'Remove Old Siding', phase: 'Demo', duration: 3, predecessorIds: ['er-2'], isMilestone: false, isCriticalPath: true, crewSize: 4 },
      { id: 'er-4', name: 'Repair Sheathing', phase: 'Framing', duration: 2, predecessorIds: ['er-3'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'er-5', name: 'Housewrap & Flashing', phase: 'General', duration: 1, predecessorIds: ['er-4'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'er-6', name: 'Window Replacement', phase: 'Framing', duration: 2, predecessorIds: ['er-5'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'er-7', name: 'New Siding Install', phase: 'Finishes', duration: 5, predecessorIds: ['er-6'], isMilestone: false, isCriticalPath: true, crewSize: 4 },
      { id: 'er-8', name: 'Soffit & Fascia', phase: 'Finishes', duration: 2, predecessorIds: ['er-7'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'er-9', name: 'Gutters', phase: 'Finishes', duration: 1, predecessorIds: ['er-8'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'er-10', name: 'Exterior Paint & Caulk', phase: 'Finishes', duration: 2, predecessorIds: ['er-9'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'er-11', name: 'Deck/Porch Repair', phase: 'Finishes', duration: 3, predecessorIds: ['er-5'], isMilestone: false, isCriticalPath: false, crewSize: 3 },
      { id: 'er-12', name: 'Landscaping Repair', phase: 'Landscaping', duration: 2, predecessorIds: ['er-10', 'er-11'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'er-13', name: 'Scaffolding Removal', phase: 'Site Work', duration: 1, predecessorIds: ['er-10'], isMilestone: false, isCriticalPath: false, crewSize: 3 },
      { id: 'er-14', name: 'Final Walkthrough', phase: 'Inspections', duration: 1, predecessorIds: ['er-12', 'er-13'], isMilestone: true, isCriticalPath: true, crewSize: 1 },
      { id: 'er-15', name: 'Project Complete', phase: 'General', duration: 0, predecessorIds: ['er-14'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
    ],
  },
  {
    id: 'parking-lot',
    name: 'Parking Lot',
    taskCount: 12,
    typicalDuration: '3 weeks',
    tasks: [
      { id: 'pl-1', name: 'Project Start', phase: 'General', duration: 0, predecessorIds: [], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'pl-2', name: 'Site Survey & Layout', phase: 'Site Work', duration: 1, predecessorIds: ['pl-1'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'pl-3', name: 'Demolition & Removal', phase: 'Demo', duration: 2, predecessorIds: ['pl-2'], isMilestone: false, isCriticalPath: true, crewSize: 4 },
      { id: 'pl-4', name: 'Grading & Compaction', phase: 'Site Work', duration: 2, predecessorIds: ['pl-3'], isMilestone: false, isCriticalPath: true, crewSize: 4 },
      { id: 'pl-5', name: 'Storm Drainage', phase: 'Site Work', duration: 2, predecessorIds: ['pl-4'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'pl-6', name: 'Aggregate Base', phase: 'Foundation', duration: 2, predecessorIds: ['pl-5'], isMilestone: false, isCriticalPath: true, crewSize: 4 },
      { id: 'pl-7', name: 'Curb & Gutter', phase: 'Foundation', duration: 2, predecessorIds: ['pl-6'], isMilestone: false, isCriticalPath: true, crewSize: 3 },
      { id: 'pl-8', name: 'Asphalt Paving', phase: 'Finishes', duration: 2, predecessorIds: ['pl-7'], isMilestone: false, isCriticalPath: true, crewSize: 5 },
      { id: 'pl-9', name: 'Striping & Signage', phase: 'Finishes', duration: 1, predecessorIds: ['pl-8'], isMilestone: false, isCriticalPath: true, crewSize: 2 },
      { id: 'pl-10', name: 'Lighting', phase: 'Electrical', duration: 2, predecessorIds: ['pl-7'], isMilestone: false, isCriticalPath: false, crewSize: 2 },
      { id: 'pl-11', name: 'Final Inspection', phase: 'Inspections', duration: 1, predecessorIds: ['pl-9', 'pl-10'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
      { id: 'pl-12', name: 'Project Complete', phase: 'General', duration: 0, predecessorIds: ['pl-11'], isMilestone: true, isCriticalPath: true, crewSize: 0 },
    ],
  },
  // The Overlook Estate — flagship luxury-estate spine (42 tasks). The full
  // authored definition (rationale, weather flags, crews) lives in
  // constants/flagshipProject.ts; this reusable ScheduleTemplate is derived
  // from it so a user can start a brand-new project from the flagship spine.
  FLAGSHIP_SCHEDULE_TEMPLATE,
];

// ─────────────────────────────────────────────────────────────────────────
// Task-list operations for the schedule wizard.
//
// These live here — beside the TemplateTask type, in a file with NO react /
// react-native imports — so `scripts/validate-schedule-wizard-ux.ts` can
// import and prove them under bun without dragging a bundler in.
//
// The wizard shows tasks as an ORDERED LIST, and the list order is the
// sequence. Every operation therefore ends in `repairChain`, which enforces
// one invariant: **a predecessor always exists and always sits earlier in
// the list.** That single rule kills three real bugs:
//   1. deleting a mid-list task left its successor pointing at a ghost id,
//      so CPM dropped the link and the successor silently teleported to day 1;
//   2. reordering could point a task at something below it — a cycle, which
//      runCpm reports as a conflict and refuses to schedule;
//   3. an orphaned task (all its predecessors deleted) jumped to day 1 rather
//      than staying where the user put it.
// ─────────────────────────────────────────────────────────────────────────

/**
 * How a task is sequenced relative to the row directly above it.
 *   'start'  — no predecessors; begins on day 1.
 *   'after'  — begins when the row above finishes (the default chain).
 *   'with'   — shares the row above's predecessors, so the two run in parallel.
 *   'custom' — a richer graph than the wizard's one-tap control can express
 *              (template tasks that wait on two or more upstream trades).
 */
export type TaskLinkMode = 'start' | 'after' | 'with' | 'custom';

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every(id => set.has(id));
}

/** Widest offset the wizard will store, mirroring setTaskDuration's 365. */
export const LAG_LIMIT = 365;

/** Round and bound a lag. NaN/Infinity collapse to 0 rather than poisoning CPM. */
export function clampLag(days: number): number {
  const n = Math.round(Number.isFinite(days) ? days : 0);
  return Math.max(-LAG_LIMIT, Math.min(LAG_LIMIT, n));
}

function sameLags(a?: Record<string, number>, b?: Record<string, number>): boolean {
  if (a === b) return true;
  // An empty map and `undefined` MEAN the same thing but are not the same
  // thing: treating them as equal would let a `lags: {}` husk survive, and the
  // whole point of the canonical form is that "no offsets" has one spelling.
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => a[k] === b[k]);
}

/**
 * Canonical lag map for a row that has exactly `predecessorIds` as its
 * predecessors: keys walk the predecessor list (so an entry for a task that is
 * no longer — or never was — a predecessor CANNOT survive), values are clamped,
 * and 0 is dropped. Returns `undefined` when nothing survives, so an offset-free
 * row carries no `lags` key at all.
 *
 * THE TRAP this closes: a lag is a property of a LINK, but it is stored beside
 * the task. Delete "Framing", or re-point the row at something else, and the
 * `{ framing: 2 }` entry is orphaned but still there — invisible, because the
 * link it describes is gone. Re-add Framing as a predecessor six edits later
 * and the 2-day wait silently resurrects, moving a date nobody touched. So the
 * map is never merely written to; it is re-derived from the graph on every
 * graph change.
 */
function normaliseLags(
  predecessorIds: readonly string[],
  lags: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!lags) return undefined;
  let out: Record<string, number> | undefined;
  for (const pid of predecessorIds) {
    const raw = lags[pid];
    if (typeof raw !== 'number') continue;
    const v = clampLag(raw);
    if (v === 0) continue;
    (out ??= {})[pid] = v;
  }
  return out;
}

/**
 * Rewrite a row's predecessors AND re-derive its lag map from them. The single
 * choke point for both halves of a dependency, so no caller can move the graph
 * without the offsets following.
 *
 * Returns the SAME object when nothing changed — `repairChain` is a no-op on a
 * well-formed list and React re-renders should stay cheap.
 */
function withLinks(t: TemplateTask, predecessorIds: string[]): TemplateTask {
  const lags = normaliseLags(predecessorIds, t.lags);
  const idsSame = sameIds(predecessorIds, t.predecessorIds ?? []);
  if (idsSame && sameLags(lags, t.lags)) return t;
  const { lags: _dropped, ...rest } = t;
  const next: TemplateTask = {
    ...rest,
    predecessorIds: idsSame ? t.predecessorIds : predecessorIds,
  };
  if (lags) next.lags = lags;
  return next;
}

/**
 * Drop predecessors that no longer exist or that now sit LATER in the list,
 * de-duplicate what's left, and re-anchor any task that was sequenced but lost
 * every predecessor to the row directly above it. Returns a new array; never
 * mutates the input.
 *
 * Idempotent, and a no-op on a well-formed list (every shipped template is
 * authored in topological order — pinned by the validator).
 *
 * This is the ONLY thing standing between the wizard and a corrupt graph, and
 * every mutation below funnels through it — including the multi-predecessor
 * editor (`setPredecessors`) and drag-to-reorder (`moveTask`). It already
 * handles a task with many predecessors: each id is filtered independently, so
 * `[a, b, c(a,b)]` survives, and dragging `c` above `b` keeps `a` and drops
 * `b` rather than creating a backwards edge.
 *
 * De-duplication matters now that a row's predecessors are edited as a SET:
 * a doubled id is harmless to CPM but makes a one-predecessor row read as
 * "After 2 tasks" on its sequence chip.
 *
 * It is also where per-dependency LAG is pruned. Every mutation below ends
 * here, so this one call site guarantees that a lag cannot outlive the link it
 * describes — see `normaliseLags`.
 */
export function repairChain(tasks: readonly TemplateTask[]): TemplateTask[] {
  const indexById = new Map<string, number>();
  tasks.forEach((t, i) => indexById.set(t.id, i));

  return tasks.map((t, i) => {
    const before = t.predecessorIds ?? [];
    const seen = new Set<string>();
    const kept = before.filter(pid => {
      if (seen.has(pid)) return false;
      const at = indexById.get(pid);
      if (at === undefined || at >= i) return false;
      seen.add(pid);
      return true;
    });
    // Was sequenced, now orphaned → hold its place instead of jumping to day 1.
    const next = kept.length === 0 && before.length > 0 && i > 0
      ? [tasks[i - 1].id]
      : kept;
    return withLinks(t, next);
  });
}

/** Move the task at `from` to index `to`, then repair the chain. */
export function moveTask(tasks: readonly TemplateTask[], from: number, to: number): TemplateTask[] {
  if (from === to) return tasks.slice();
  if (from < 0 || from >= tasks.length) return tasks.slice();
  const clamped = Math.max(0, Math.min(tasks.length - 1, to));
  const next = tasks.slice();
  const [moved] = next.splice(from, 1);
  next.splice(clamped, 0, moved);
  return repairChain(next);
}

/** Remove the task at `index`, then repair the chain. */
export function removeTaskAt(tasks: readonly TemplateTask[], index: number): TemplateTask[] {
  if (index < 0 || index >= tasks.length) return tasks.slice();
  return repairChain(tasks.filter((_, i) => i !== index));
}

/**
 * Insert `task` at `index` (clamped). The caller does not have to set
 * predecessorIds — an inserted task with none gets chained to the row above
 * it, which is what "add a step here" means.
 */
export function insertTaskAt(
  tasks: readonly TemplateTask[],
  index: number,
  task: TemplateTask,
): TemplateTask[] {
  const at = Math.max(0, Math.min(tasks.length, index));
  const seeded = task.predecessorIds.length === 0 && at > 0
    ? { ...task, predecessorIds: [tasks[at - 1].id] }
    : task;
  const next = tasks.slice();
  next.splice(at, 0, seeded);
  return repairChain(next);
}

/** Classify how the task at `index` is sequenced, for the row's link chip. */
export function readLinkMode(tasks: readonly TemplateTask[], index: number): TaskLinkMode {
  const t = tasks[index];
  if (!t) return 'start';
  const preds = t.predecessorIds ?? [];
  if (preds.length === 0) return 'start';
  if (index === 0) return 'custom'; // repairChain clears this; defensive only.
  const prev = tasks[index - 1];
  if (preds.length === 1 && preds[0] === prev.id) return 'after';
  const prevPreds = prev.predecessorIds ?? [];
  if (prevPreds.length > 0 && sameIds(preds, prevPreds)) return 'with';
  return 'custom';
}

/**
 * Rewrite the task at `index` to the requested sequencing. 'custom' is not
 * settable — it only ever describes what a template already had, so asking
 * for it is a no-op.
 *
 * Lag follows the link it belongs to:
 *   'start'  — no predecessors, so nothing to carry; normalisation empties it.
 *   'after'  — keeps the row's own offset ON the row above if it already had
 *              one, and drops every other entry. Re-asserting a link the user
 *              already had shouldn't quietly reset their 2-day cure wait.
 *   'with'   — copies the row above's offsets as well as its predecessors,
 *              because "alongside" that means anything else is a lie: without
 *              them this row would start earlier than the row it claims to run
 *              alongside.
 */
export function applyLinkMode(
  tasks: readonly TemplateTask[],
  index: number,
  mode: TaskLinkMode,
): TemplateTask[] {
  const t = tasks[index];
  if (!t || mode === 'custom') return tasks.slice();
  const prev = index > 0 ? tasks[index - 1] : null;
  let preds: string[];
  let lags = t.lags;
  if (!prev || mode === 'start') preds = [];
  else if (mode === 'after') preds = [prev.id];
  else {
    preds = [...(prev.predecessorIds ?? [])]; // 'with' — same upstream as prev
    lags = prev.lags;
  }
  const { lags: _own, ...bare } = t;
  const seeded: TemplateTask = lags ? { ...bare, lags: { ...lags } } : { ...bare };
  const next = tasks.slice();
  next[index] = withLinks(seeded, preds);
  return repairChain(next);
}

/**
 * One-tap sequencing: after → with → start → after. A 'custom' template link
 * normalises to 'after' on the first tap (the user asked to change this row,
 * so collapsing its graph to the simple chain is the honest response).
 */
export function cycleLinkMode(tasks: readonly TemplateTask[], index: number): TemplateTask[] {
  if (index <= 0) return tasks.slice(); // row 1 has nothing above it
  const current = readLinkMode(tasks, index);
  const next: TaskLinkMode =
    current === 'after' ? 'with' :
    current === 'with' ? 'start' :
    'after'; // 'start' and 'custom' both land on 'after'
  return applyLinkMode(tasks, index, next);
}

/** Set a duration, clamping to 0…365. 0 days is the model's milestone marker. */
export function setTaskDuration(
  tasks: readonly TemplateTask[],
  index: number,
  days: number,
): TemplateTask[] {
  const t = tasks[index];
  if (!t) return tasks.slice();
  const clamped = Math.max(0, Math.min(365, Math.round(Number.isFinite(days) ? days : 0)));
  const next = tasks.slice();
  next[index] = { ...t, duration: clamped, isMilestone: clamped === 0 };
  return next;
}

// ─────────────────────────────────────────────────────────────────────────
// Multi-predecessor editing.
//
// The one-tap chip (after / alongside / day-1) only ever talks about the row
// DIRECTLY ABOVE, which is a lie on any real job: "Rough Inspection" waits on
// plumbing AND electrical AND HVAC, not on whichever of them the user happened
// to type last. These two functions back a picker that can select any subset
// of the EARLIER rows.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every task the row at `index` is allowed to depend on — i.e. everything
 * above it. Returned in list order so a picker renders in the same order the
 * work happens, and so the selected ids come back in a stable order.
 *
 * The invariant is enforced by construction here AND again by repairChain in
 * `setPredecessors`; belt and braces, because this is the list a user taps.
 */
export function predecessorOptions(
  tasks: readonly TemplateTask[],
  index: number,
): TemplateTask[] {
  if (!Number.isFinite(index) || index <= 0) return [];
  return tasks.slice(0, Math.min(index, tasks.length));
}

/**
 * Replace the predecessors of the task at `index` with an arbitrary set of
 * ids, then repair the chain.
 *
 * Ids that are unknown or that sit at/after `index` are dropped, duplicates
 * collapse, and the survivors come back in LIST ORDER (not the order the user
 * tapped them) so the sequence chip's sentence doesn't reshuffle itself.
 *
 * An empty array means "starts on day 1" and is preserved: repairChain only
 * re-anchors a row that HAD predecessors and lost them all to filtering, and
 * by then we've already written the empty array, so there is nothing to lose.
 */
export function setPredecessors(
  tasks: readonly TemplateTask[],
  index: number,
  ids: readonly string[],
): TemplateTask[] {
  const t = tasks[index];
  if (!t) return tasks.slice();
  const wanted = new Set(ids);
  const preds = predecessorOptions(tasks, index)
    .filter(x => wanted.has(x.id))
    .map(x => x.id);
  const next = tasks.slice();
  // withLinks, not a bare spread: dropping a predecessor here must drop its
  // offset in the SAME step, or the row briefly holds a lag for a link it no
  // longer has. repairChain would catch it, but relying on a later pass to
  // undo a corruption this one just created is how the trap gets re-opened.
  next[index] = withLinks(t, preds);
  return repairChain(next);
}

// ─────────────────────────────────────────────────────────────────────────
// Lag / lead per dependency.
//
// A finish-to-start link says "B starts the day after A ends". Real jobs are
// full of links that say something slightly different:
//   • +2  concrete has to cure before anyone frames on it (a LAG);
//   • -3  the painters can move in three days before the drywallers finish
//         the last room (a LEAD — a deliberate overlap).
// Without this, both get faked by padding a duration, which lies to the crew
// list, the labor curve and the cost report to fix a date.
//
// The engine has honoured `DependencyLink.lagDays` all along (utils/cpm.ts,
// forward pass / backward pass / free float). The wizard simply never set it.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The offset on the link from `predecessorId` into `task`, in days.
 * 0 when there is no offset — and also 0 when `predecessorId` is not actually
 * a predecessor, so a stale entry is unreadable as well as unprunable-away.
 */
export function getLag(task: TemplateTask | undefined, predecessorId: string): number {
  if (!task) return 0;
  if (!(task.predecessorIds ?? []).includes(predecessorId)) return 0;
  const raw = task.lags?.[predecessorId];
  return typeof raw === 'number' ? clampLag(raw) : 0;
}

/**
 * Set the offset on ONE (task, predecessor) link. Positive waits, negative
 * overlaps, 0 removes the entry entirely (there is one representation of "no
 * wait"). A predecessorId that isn't a predecessor of this row is refused
 * rather than stored — the map may only ever describe links that exist.
 */
export function setLag(
  tasks: readonly TemplateTask[],
  index: number,
  predecessorId: string,
  days: number,
): TemplateTask[] {
  const t = tasks[index];
  if (!t || !(t.predecessorIds ?? []).includes(predecessorId)) return tasks.slice();
  const next = tasks.slice();
  next[index] = withLinks(
    { ...t, lags: { ...(t.lags ?? {}), [predecessorId]: clampLag(days) } },
    t.predecessorIds,
  );
  return next;
}

/**
 * REPLACE every offset on the row at `index` with `lags`. What the picker
 * sheet commits: its draft map is authoritative, so an id the user cleared has
 * to disappear rather than merge back in. Entries for non-predecessors are
 * dropped, exactly as in `setLag`.
 */
export function setLags(
  tasks: readonly TemplateTask[],
  index: number,
  lags: Readonly<Record<string, number>>,
): TemplateTask[] {
  const t = tasks[index];
  if (!t) return tasks.slice();
  const next = tasks.slice();
  next[index] = withLinks({ ...t, lags: { ...lags } }, t.predecessorIds);
  return next;
}

// ─────────────────────────────────────────────────────────────────────────
// The bridge to CPM.
//
// The wizard runs CPM TWICE over the same task list — once live, to draw the
// timeline and the finish date, and once on save, to persist the plan under
// fresh UUIDs. Both used to build their dependency arrays by hand, which is
// how the preview and the saved schedule are able to disagree. They go through
// these two functions now, so a lag cannot reach one path and miss the other.
// ─────────────────────────────────────────────────────────────────────────

/**
 * `task`'s predecessors as CPM dependency links, offsets included.
 * `idFor` remaps predecessor ids — identity for the live preview, and the
 * template-id → UUID map on save.
 */
export function dependencyLinksFor(
  task: TemplateTask,
  idFor: (id: string) => string = id => id,
): DependencyLink[] {
  return (task.predecessorIds ?? []).map(pid => ({
    taskId: idFor(pid),
    type: 'FS' as const,
    lagDays: getLag(task, pid),
  }));
}

/**
 * Both halves of a saved task's dependency data, remapped through `idFor`.
 * `dependencies` (bare ids) is what most of the app reads; `dependencyLinks`
 * is what carries type + lag, and is what utils/cpm.ts prefers when present.
 * Returning them together is the point: derived from ONE list, they cannot
 * drift out of agreement.
 */
export function remapDependencies(
  task: TemplateTask,
  idFor: (id: string) => string = id => id,
): { dependencies: string[]; dependencyLinks: DependencyLink[] } {
  const dependencyLinks = dependencyLinksFor(task, idFor);
  return { dependencies: dependencyLinks.map(l => l.taskId), dependencyLinks };
}

/**
 * The wizard's editable list as CPM input. Day-1 start pins, real durations,
 * and dependency links carrying lag — everything runCpm needs to answer "when
 * does this finish".
 */
export function toCpmTasks(tasks: readonly TemplateTask[]): ScheduleTask[] {
  return tasks.map(t => ({
    id: t.id,
    title: t.name,
    phase: t.phase,
    durationDays: t.duration,
    startDay: 1,
    dependencies: [...(t.predecessorIds ?? [])],
    dependencyLinks: dependencyLinksFor(t),
    crew: '',
    crewSize: t.crewSize,
    isMilestone: t.isMilestone,
    notes: '',
    status: 'not_started' as const,
    progress: 0,
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// The sentences.
//
// These live here rather than in the screen for one reason: a wrong sentence
// about a dependency is a wrong schedule that LOOKS right, and the only way to
// pin wording is to be able to import it. `scripts/validate-schedule-wizard-ux.ts`
// runs them under bun; the .tsx they used to live in can't be imported without
// a bundler.
// ─────────────────────────────────────────────────────────────────────────

/** "1 day" / "3 days" — magnitude only; direction is the caller's word. */
function dayCount(n: number): string {
  const abs = Math.abs(n);
  return `${abs} day${abs === 1 ? '' : 's'}`;
}

/** A task's display name, with the wizard's fallback for unnamed rows. */
export function taskName(t: TemplateTask | undefined): string {
  return t?.name.trim() || 'Untitled task';
}

/**
 * Plain-English caption for the picker's per-predecessor stepper. Deliberately
 * avoids "lag" and "lead" — a homeowner-facing product shouldn't require the
 * CPM vocabulary to read its own schedule.
 */
export function lagStepperLabel(days: number): string {
  const n = clampLag(days);
  if (n === 0) return 'No wait';
  return n > 0 ? `Wait ${dayCount(n)}` : `Start ${dayCount(n)} early`;
}

/**
 * Human sentence for a row's sequencing, shown on the tappable link chip.
 *
 * Must stay TRUTHFUL now that a row can wait on several upstream tasks, each
 * with its own offset: a chip can't hold four trade names, but "After 3 tasks"
 * is honest, and the full list is spelled out in the accessibility label and
 * the picker sheet.
 *
 * With no offsets anywhere on the row the wording is EXACTLY what it was
 * before lag existed — the common case must not get noisier to serve the rare
 * one.
 */
export function sequenceLabel(tasks: readonly TemplateTask[], index: number): string {
  if (index === 0) return 'Starts day 1';
  const t = tasks[index];
  if (!t) return 'Starts day 1';
  const preds = t.predecessorIds ?? [];

  if (preds.every(p => getLag(t, p) === 0)) {
    const mode = readLinkMode(tasks, index);
    const prevName = tasks[index - 1].name.trim() || 'the task above';
    if (mode === 'after') return `After ${prevName}`;
    if (mode === 'with') return `Alongside ${prevName}`;
    if (mode === 'start') return 'Starts day 1';
    // 'custom' — either several predecessors, or a single one that isn't the
    // row directly above. Name it when there's exactly one; count it otherwise.
    if (preds.length === 1) return `After ${taskName(tasks.find(x => x.id === preds[0]))}`;
    return `After ${preds.length} tasks`;
  }

  if (preds.length === 1) {
    const name = taskName(tasks.find(x => x.id === preds[0]));
    const lag = getLag(t, preds[0]);
    return lag > 0
      ? `${dayCount(lag)} after ${name}`
      : `${dayCount(lag)} before ${name} ends`;
  }
  return `After ${preds.length} tasks with offsets`;
}

/**
 * The same sentence, unabbreviated — for screen readers and the picker's live
 * summary, where there's room to say what "3 tasks" actually means.
 *
 * Takes the ids and offsets as ARGUMENTS rather than reading them off a task,
 * because the picker renders this for a draft selection the user hasn't
 * committed yet.
 *
 * Multi-predecessor rows with mixed offsets get "at the latest of:", which is
 * literally what CPM does — it takes the max over the links. Saying "starts
 * when all three have finished" would be wrong the moment one of them carries
 * a lead.
 */
export function sequenceDetail(
  tasks: readonly TemplateTask[],
  ids: readonly string[],
  lags?: Readonly<Record<string, number>>,
): string {
  if (ids.length === 0) return 'Starts on day 1';
  // List order, not tap order, so the sentence doesn't reshuffle between edits.
  const rows = tasks.filter(t => ids.includes(t.id));
  const names = rows.map(taskName);
  const lagOf = (id: string) => {
    const raw = lags?.[id];
    return typeof raw === 'number' ? clampLag(raw) : 0;
  };

  if (rows.every(r => lagOf(r.id) === 0)) {
    if (names.length === 1) return `Starts when ${names[0]} finishes`;
    if (names.length === 2) return `Starts when ${names[0]} and ${names[1]} have both finished`;
    return `Starts when all ${names.length} of ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} have finished`;
  }

  if (rows.length === 1) {
    const lag = lagOf(rows[0].id);
    return lag > 0
      ? `Starts ${dayCount(lag)} after ${names[0]} finishes`
      : `Starts ${dayCount(lag)} before ${names[0]} finishes`;
  }

  const clauses = rows.map(r => {
    const lag = lagOf(r.id);
    const n = taskName(r);
    if (lag === 0) return `when ${n} finishes`;
    return lag > 0
      ? `${dayCount(lag)} after ${n} finishes`
      : `${dayCount(lag)} before ${n} finishes`;
  });
  return `Starts at the latest of: ${clauses.join(', ')}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Drag-to-reorder geometry.
//
// Deliberately here rather than in the component: these are pure functions
// over numbers, so `scripts/validate-schedule-wizard-ux.ts` can prove them
// under bun without a bundler — the same reason the list ops live here. The
// component (components/schedule/TaskRowDrag.tsx) owns pixels and gestures;
// this owns the arithmetic that turns a finger's travel into an INDEX, which
// is then applied with `moveTask` (and therefore repairChain).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Where a dragged row lands. `from` is the row under the finger, `dy` its
 * vertical travel in px, `heights[i]` row i's laid-out height, `gap` the
 * vertical space between rows.
 *
 * A row is passed once the finger has travelled MORE THAN HALF of it — the
 * standard cross-the-midpoint rule, which is what makes a drag feel like it
 * tracks the finger instead of snapping a beat late. Rows can have different
 * heights (a wrapped chip row is taller), so we accumulate real measurements
 * rather than assuming a fixed row height.
 */
export function dropTargetIndex(
  from: number,
  dy: number,
  heights: readonly number[],
  gap = 0,
): number {
  const count = heights.length;
  if (count === 0) return 0;
  const start = Math.max(0, Math.min(count - 1, Math.trunc(from)));
  if (!Number.isFinite(dy) || dy === 0) return start;

  // A row whose onLayout hasn't run yet measures 0. Without this guard the
  // smallest twitch would "pass" every unmeasured row at once and fling a task
  // to the end of the list on the first frame after it was added.
  const span = (i: number) => {
    const h = heights[i] || 0;
    return h > 0 ? h + gap : 0;
  };

  let target = start;
  let travelled = 0;
  if (dy > 0) {
    for (let i = start + 1; i < count; i++) {
      const step = span(i);
      if (step <= 0 || dy < travelled + step / 2) break;
      target = i;
      travelled += step;
    }
  } else {
    for (let i = start - 1; i >= 0; i--) {
      const step = span(i);
      if (step <= 0 || -dy < travelled + step / 2) break;
      target = i;
      travelled += step;
    }
  }
  return target;
}

/**
 * Which way row `index` slides while row `from` is being dragged to `to`:
 * -1 = up, 1 = down, 0 = stays put (including the dragged row itself, which
 * follows the finger instead).
 *
 * Displaced rows move by exactly one dragged-row height, because that is the
 * size of the hole the dragged row left behind — so the preview lands on the
 * pixel the row will actually occupy.
 */
export function reorderShiftDirection(index: number, from: number, to: number): -1 | 0 | 1 {
  if (from === to || index === from) return 0;
  if (to > from) return index > from && index <= to ? -1 : 0;
  return index >= to && index < from ? 1 : 0;
}
