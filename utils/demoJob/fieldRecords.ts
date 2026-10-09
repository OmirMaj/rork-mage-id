// utils/demoJob/fieldRecords.ts — what the field and the office type on the Demo Job (pure).
//
// Daily reports, RFIs, submittals, punch items, permits, meetings, warranties,
// safety, deliveries, building access, delays, equipment, field tickets, lien
// waivers, a draft contract, selections, crew and time. Dated from the clock
// and tied to schedule tasks by key, so every reference resolves.
//
// THE SAME LIABILITY RULES AS records.ts, plus:
//   - weather on a daily report is TYPED (isManual: true) and never carries a
//     live-source stamp; the schedule's weather delay log is left empty;
//   - no safety incident record (a job with one cannot be deleted, by design:
//     injury records are kept five years). The one first-aid event lives in a
//     daily report's own incident section, with no name and no OSHA answer;
//   - toolbox talk attendees are listed without a sign-in time;
//   - a lien waiver is "received" with a note that it is on paper, a field
//     ticket is a draft with no authorization, the contract is a draft.
import type {
  DailyFieldReport, DelayEvent, Equipment, FieldTicket, Hazard, LienWaiver, ManpowerEntry, OACMeeting, Permit,
  ProjectContract, PunchItem, RFI, SelectionCategory, SelectionOption, Submittal, ToolboxTalk, Warranty, CrewMember,
} from '@/types';
import type { AccessReservation, BuildingAccessRules } from '@/utils/buildingAccess';
import type { Delivery } from '@/utils/deliverySchedule';
import { parseCalendarDay } from '@/utils/calendarDate';
import { DATA_DAY, type DemoClock } from './clock';
import { DEMO_PROJECT_NAME } from './marker';
import { COMMITMENTS, ORIGINAL_CONTRACT_SUM, PAID_PAY_APPS, PAY_APP_PERIOD_END } from './money';
import { TASK_SPECS, currentPlan } from './schedule';
import { CREW, JOB, SUPER_NAME, fullName, person, sub } from './world';
import { subId, type IdOf } from './records';

const NOTE = 'Made-up demo record.';

/** A clock day as a Date. The clock only hands out real days, so anything else is a bug and says so. */
function dayDate(day: string): Date {
  const d = parseCalendarDay(day);
  if (!d) throw new Error(`not a calendar day: ${day}`);
  return d;
}

// ── Daily reports ───────────────────────────────────────────────────────────

export const DAILY_REPORT_DAYS = 30;

/** Baltimore's usual afternoon high by month, in whole degrees F. Typed into the report by hand. */
const USUAL_HIGH = [42, 46, 55, 66, 75, 84, 88, 86, 79, 68, 57, 46];
const SKY = ['Clear', 'Partly cloudy', 'Overcast', 'Clear', 'Light rain in the morning', 'Partly cloudy', 'Clear', 'Breezy and clear'];

const ISSUES: Readonly<Record<number, string>> = {
  2: 'Level 5 to 7 window shipment is still not on site. Supplier now says two weeks. Glaziers moved to Level 4 punch-out.',
  5: 'Hoist was down for 90 minutes in the morning for a limit-switch reset. Drywall stocking on Level 5 slipped to the afternoon.',
  9: 'Sprinkler main at Level 6 corridor clashes with a duct. RFI written, waiting on the engineer.',
  13: 'Failed first rough-in inspection item at Level 5: two nail plates missing at kitchen walls. Fixed same day, re-inspection passed.',
  18: 'Short one drywall finisher for the day. No change to the floor turnover date.',
  22: 'Brick delivery arrived a day early with no dock slot. Unloaded at the north gate, sidewalk reopened by 10:30.',
  27: 'Level 6 deck pour pushed one day for pump truck availability.',
};

export function buildDailyReports(id: IdOf, clock: DemoClock, contractorName: string): DailyFieldReport[] {
  const plan = currentPlan();
  const out: DailyFieldReport[] = [];
  for (let i = DAILY_REPORT_DAYS; i >= 1; i -= 1) {
    const day = DATA_DAY - i;
    const active = TASK_SPECS.filter((s) => {
      const p = plan.get(s.key)!;
      return !s.milestone && p.start <= day && day < p.end;
    });
    const byCompany = new Map<string, ManpowerEntry>();
    for (const s of active) {
      const company = s.sub ? sub(s.sub).company : contractorName;
      const hit = byCompany.get(company);
      if (hit) hit.headcount += s.crewSize;
      else byCompany.set(company, { id: id(`dfr:${day}:mp:${byCompany.size}`), trade: s.crew, company, headcount: s.crewSize, hoursWorked: 8 });
    }
    const manpower = [...byCompany.values()].map((m) => ({ ...m, hoursWorked: m.headcount * 8 }));
    const date = clock.dayOf(day);
    const month = dayDate(date).getMonth();
    const firstAid = i === 11;
    out.push({
      id: id(`dfr:${day}`),
      projectId: id('project'),
      date,
      weather: { temperature: `${USUAL_HIGH[month] - (day % 5)} F`, conditions: SKY[day % SKY.length], wind: `${4 + (day % 4) * 3} mph`, isManual: true },
      manpower,
      workPerformed: active.length
        ? `${active.map((s) => s.title).join('. ')}.`
        : 'Site cleanup and material stocking.',
      materialsDelivered: day % 3 === 0 ? ['Drywall and metal trim, two trucks', 'Mechanical unit curbs'] : day % 4 === 0 ? ['Cabinet boxes for Level 3'] : [],
      issuesAndDelays: ISSUES[i] ?? '',
      photos: [],
      // 'sent' is the app's word for a filed report. Nothing is emailed: this is a sample job.
      status: i <= 2 ? 'draft' : 'sent',
      ...(firstAid ? {
        incident: {
          hasIncident: true,
          severity: 'minor' as const,
          description: 'First aid only. A carpenter cut the back of a hand on a metal stud edge while stocking Level 5. Cleaned and bandaged on site and went back to work. (Made-up demo entry. No name is recorded.)',
          injuriesReported: true,
          medicalTreatment: false,
          correctiveAction: 'Cut-resistant gloves required for stud handling. Covered at the next toolbox talk.',
          reportedBy: SUPER_NAME,
          reportedAt: clock.at(day, 11),
        },
      } : {}),
      ...(day % 5 === 0 ? { safetyToolboxTalk: { topic: TOOLBOX_TOPICS[(day / 5) % TOOLBOX_TOPICS.length], durationMinutes: 15, attendees: manpower.reduce((s, m) => s + m.headcount, 0), conductedBy: SUPER_NAME } } : {}),
      createdAt: clock.at(day, 16),
      updatedAt: clock.at(day, 16, 30),
    });
  }
  return out;
}

// ── RFIs ────────────────────────────────────────────────────────────────────

interface RfiSpec { subject: string; question: string; to: 'architect' | 'engineer' | 'mep' | 'owner'; day: number; needDays: number; answerDay?: number; response?: string; closed?: boolean; urgent?: boolean; drawing: string; task?: string }

const RFIS: readonly RfiSpec[] = [
  { subject: 'Footing Elevation at Gridline 7', question: 'Top of footing at gridline 7 conflicts with the storm line invert. Please confirm the footing can step down 8 inches.', to: 'engineer', day: 30, needDays: 5, answerDay: 34, response: 'Step the footing 8 inches as sketched. Add two dowels at the step.', closed: true, drawing: 'S-101', task: 'ftg' },
  { subject: 'Unsuitable Fill at East Footings', question: 'Loose fill and debris found below footing subgrade along the east line. Please advise on over-excavation depth and fill.', to: 'engineer', day: 33, needDays: 3, answerDay: 35, response: 'Over-excavate to firm natural soil, about 4 feet, and replace with compacted structural fill. Test every lift.', closed: true, urgent: true, drawing: 'S-101', task: 'exc' },
  { subject: 'Elevator Pit Waterproofing Detail', question: 'Detail 5 on A-501 shows sheet membrane. The specification calls for a fluid-applied system at the pits. Which governs?', to: 'architect', day: 52, needDays: 7, answerDay: 58, response: 'Fluid-applied per the specification. The detail will be revised.', closed: true, drawing: 'A-501', task: 'wproof' },
  { subject: 'Podium Slab Edge at Storefront', question: 'Slab edge dimension at the storefront differs between A-201 and S-201 by 2 inches.', to: 'architect', day: 96, needDays: 5, answerDay: 100, response: 'Hold the structural dimension. The storefront shop drawings will follow it.', closed: true, drawing: 'A-201', task: 'pod-deck' },
  { subject: 'Transfer Beam at Gridline C', question: 'Level 2 wall panel layout puts a bearing wall with no support below at gridline C. Please advise.', to: 'engineer', day: 99, needDays: 5, answerDay: 103, response: 'Add a transfer beam at gridline C per the attached sketch. Treat as a change.', closed: true, urgent: true, drawing: 'S-201', task: 'pod-deck' },
  { subject: 'Shaft Wall Rating at Trash Chute', question: 'Is the trash chute enclosure a 1-hour or a 2-hour shaft wall above Level 4?', to: 'architect', day: 150, needDays: 7, answerDay: 155, response: '2-hour for the full height.', closed: true, drawing: 'A-401', task: 'stairs' },
  { subject: 'Unit Entry Door Hardware Function', question: 'Hardware schedule lists passage sets at unit entries. Please confirm entry function locksets.', to: 'architect', day: 165, needDays: 10, answerDay: 172, response: 'Entry function with deadbolt at all unit entries. Schedule to be reissued.', drawing: 'A-601' },
  { subject: 'Kitchen Exhaust Routing at Level 2', question: 'Kitchen exhaust in the 01 and 08 units cannot reach the exterior wall within the joist depth. Can it drop into a soffit?', to: 'mep', day: 170, needDays: 7, answerDay: 176, response: 'A 10 inch soffit over the upper cabinets is acceptable. Keep it 12 inches clear of the sprinkler head.', closed: true, drawing: 'M-201', task: 'l2-hvac' },
  { subject: 'Corridor Ceiling Height', question: 'With the sprinkler main and duct stacked, the corridor ceiling lands at 7 feet 10 inches. Drawings call for 8 feet 0 inches.', to: 'architect', day: 188, needDays: 7, answerDay: 195, response: '7 feet 10 inches is accepted in corridors only.', drawing: 'A-301', task: 'l2-spk' },
  { subject: 'Window Head Flashing at Brick', question: 'Please confirm end dams are required at window head flashing where brick meets fiber cement.', to: 'architect', day: 200, needDays: 7, answerDay: 206, response: 'Yes. End dams at every head. See revised detail.', drawing: 'A-502', task: 'cladding' },
  // Open and already past the date an answer was needed.
  { subject: 'Sprinkler Main and Duct Clash at Level 6', question: 'The sprinkler main and the corridor supply duct want the same space at the Level 6 east corridor. Which one offsets?', to: 'mep', day: 219, needDays: 5, urgent: true, drawing: 'FP-206', task: 'l6-spk' },
  { subject: 'Roof Drain Location at Elevator Overrun', question: 'Roof drain RD-3 sits under the elevator overrun curb. Please relocate.', to: 'architect', day: 218, needDays: 6, drawing: 'A-110', task: 'roofing' },
  // Open, not yet due.
  { subject: 'Lobby Tile Pattern', question: 'The lobby floor pattern on A-701 does not close at the mail alcove. Please provide a layout point.', to: 'architect', day: 224, needDays: 10, drawing: 'A-701', task: 'l1-fin' },
  { subject: 'Retail Tenant Electrical Stub Size', question: 'Please confirm the conduit size for the future retail tenant panels.', to: 'owner', day: 226, needDays: 10, drawing: 'E-101', task: 'l1-mep' },
];

const RFI_TO = { architect: 'architect', engineer: 'engineer', mep: 'mep', owner: 'ownerrep' } as const;
const RFI_COURT = { architect: 'architect', engineer: 'engineer', mep: 'engineer', owner: 'owner' } as const;

export function buildRfis(id: IdOf, clock: DemoClock, contractorName: string): RFI[] {
  return RFIS.map((r, i) => {
    const to = person(RFI_TO[r.to]);
    const status: RFI['status'] = r.closed ? 'closed' : r.answerDay ? 'answered' : 'open';
    return {
      id: id(`rfi:${i + 1}`),
      projectId: id('project'),
      number: i + 1,
      subject: r.subject,
      question: `${r.question} (${NOTE})`,
      submittedBy: contractorName,
      assignedTo: `${fullName(to)}, ${to.company}`,
      ballInCourt: status === 'closed' ? 'closed' : status === 'answered' ? 'gc' : RFI_COURT[r.to],
      dateSubmitted: clock.dayOf(r.day),
      dateRequired: clock.dayOf(r.day + r.needDays),
      ...(r.answerDay ? { dateResponded: clock.dayOf(r.answerDay), response: `${r.response} (Answer typed in by the contractor.)` } : {}),
      status,
      priority: r.urgent ? 'urgent' : 'normal',
      linkedDrawing: r.drawing,
      ...(r.task ? { linkedTaskId: id(`task:${r.task}`) } : {}),
      attachments: [],
      createdAt: clock.at(r.day, 10),
      updatedAt: clock.at(r.answerDay ?? r.day, 15),
    };
  });
}

// ── Submittals ──────────────────────────────────────────────────────────────

type SubmittalInput = Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>;
interface SubmittalSpec { title: string; spec: string; by: string; day: number; back?: number; status: Submittal['currentStatus']; note?: string; resubmit?: { day: number; back?: number; status: Submittal['currentStatus'] }; task?: string; type: string }

const SUBMITTALS: readonly SubmittalSpec[] = [
  { title: 'Concrete Mix Designs', spec: '03 30 00', by: 'concrete', day: 8, back: 16, status: 'approved', task: 'ftg', type: 'Product Data' },
  { title: 'Foundation Rebar Shop Drawings', spec: '03 20 00', by: 'concrete', day: 10, back: 20, status: 'approved_as_noted', note: 'Add bars at the elevator pit corners as marked.', task: 'ftg', type: 'Shop Drawings' },
  { title: 'Shear Wall Rebar Shop Drawings', spec: '03 20 00', by: 'concrete', day: 70, back: 82, status: 'revise_resubmit', note: 'Lap lengths at Level 1 do not match S-301.', resubmit: { day: 86, back: 93, status: 'approved' }, task: 'pod-col', type: 'Shop Drawings' },
  { title: 'Below-Grade Waterproofing', spec: '07 14 00', by: 'roofing', day: 40, back: 50, status: 'approved', task: 'wproof', type: 'Product Data' },
  { title: 'Light-Gauge Wall Panel Shop Drawings', spec: '05 40 00', by: 'framing', day: 80, back: 98, status: 'approved_as_noted', note: 'Coordinate hold-downs with the podium embeds.', task: 'l2-frame', type: 'Shop Drawings' },
  { title: 'Floor Deck and Topping', spec: '05 31 00', by: 'framing', day: 84, back: 96, status: 'approved', task: 'l2-frame', type: 'Product Data' },
  { title: 'Windows, Levels 2 to 7', spec: '08 53 13', by: 'glazing', day: 110, back: 124, status: 'approved', task: 'windows', type: 'Shop Drawings' },
  { title: 'Storefront System, Thermally Broken', spec: '08 41 13', by: 'glazing', day: 126, back: 140, status: 'approved_as_noted', note: 'Per Change Order 2. Confirm sill pan at the retail entries.', task: 'storefront', type: 'Shop Drawings' },
  { title: 'Roof Membrane System', spec: '07 54 23', by: 'roofing', day: 150, back: 162, status: 'approved', task: 'roofing', type: 'Product Data' },
  { title: 'Fire Sprinkler Shop Drawings', spec: '21 13 13', by: 'fire', day: 120, back: 138, status: 'approved', task: 'l2-spk', type: 'Shop Drawings' },
  { title: 'Unit Heat Pumps', spec: '23 81 26', by: 'hvac', day: 118, back: 130, status: 'approved', task: 'l2-hvac', type: 'Product Data' },
  { title: 'Switchgear and Panelboards', spec: '26 24 13', by: 'electrical', day: 112, back: 128, status: 'approved', task: 'underslab', type: 'Product Data' },
  { title: 'Elevator Shop Drawings', spec: '14 21 00', by: 'elevator', day: 130, back: 150, status: 'approved_as_noted', note: 'Confirm pit ladder location.', task: 'elev', type: 'Shop Drawings' },
  { title: 'Kitchen Cabinets and Quartz Tops', spec: '06 41 00', by: 'millwork', day: 166, back: 180, status: 'revise_resubmit', note: 'Top edge profile does not match the approved sample. Resubmit.', task: 'l2-cab', type: 'Samples' },
  { title: 'Brick Veneer Mockup', spec: '04 20 00', by: 'masonry', day: 190, back: 202, status: 'approved', task: 'cladding', type: 'Mockup' },
  { title: 'Corridor Plank Flooring', spec: '09 65 19', by: 'drywall', day: 216, status: 'pending', task: 'common', type: 'Samples' },
  { title: 'Lobby Light Fixtures', spec: '26 51 00', by: 'electrical', day: 220, status: 'in_review', task: 'l1-fin', type: 'Product Data' },
  { title: 'Fire Alarm Shop Drawings', spec: '28 31 00', by: 'fire', day: 222, status: 'pending', task: 'fa-test', type: 'Shop Drawings' },
];

export function buildSubmittals(id: IdOf, clock: DemoClock): SubmittalInput[] {
  const reviewer = `${fullName(person('architect2'))}, ${JOB.architect}`;
  return SUBMITTALS.map((s) => {
    const cycles: Submittal['reviewCycles'] = [];
    if (s.status !== 'pending') {
      cycles.push({ cycleNumber: 1, sentDate: clock.dayOf(s.day), ...(s.back ? { returnDate: clock.dayOf(s.back) } : {}), reviewer, status: s.status, ...(s.note ? { comments: `${s.note} (Typed in by the contractor.)` } : {}) });
    }
    if (s.resubmit) {
      cycles.push({ cycleNumber: 2, sentDate: clock.dayOf(s.resubmit.day), ...(s.resubmit.back ? { returnDate: clock.dayOf(s.resubmit.back) } : {}), reviewer, status: s.resubmit.status });
    }
    return {
      projectId: id('project'),
      title: s.title,
      specSection: s.spec,
      submittedBy: sub(s.by).company,
      submittedDate: clock.dayOf(s.day),
      requiredDate: clock.dayOf(s.day + 14),
      ...(s.task ? { linkedTaskId: id(`task:${s.task}`) } : {}),
      submittalType: s.type,
      trade: sub(s.by).trade,
      requiredDateSource: 'manual',
      reviewCycles: cycles,
      currentStatus: s.resubmit ? s.resubmit.status : s.status,
      attachments: [],
    };
  });
}

// ── Punch items (Levels 2 and 3, the floors at finishes) ────────────────────

const PUNCH: readonly [string, string, string, 'low' | 'medium' | 'high'][] = [
  ['Kitchen', 'Cabinet door at the sink base is out of alignment', 'millwork', 'low'],
  ['Kitchen', 'Outlet cover plate missing at the counter', 'electrical', 'medium'],
  ['Bath', 'Caulk joint open at the tub surround', 'drywall', 'medium'],
  ['Bedroom', 'Paint touch-up at the closet return', 'drywall', 'low'],
  ['Living Room', 'Window does not latch', 'glazing', 'high'],
  ['Bath', 'Toilet supply stop drips', 'plumbing', 'high'],
  ['Entry', 'Door closer slams, adjust', 'glazing', 'medium'],
  ['Living Room', 'Thermostat not mounted level', 'hvac', 'low'],
  ['Kitchen', 'Quartz top seam is proud at the range', 'millwork', 'medium'],
  ['Bedroom', 'Base trim gap at the corner', 'millwork', 'low'],
  ['Corridor', 'Sprinkler escutcheon missing', 'fire', 'medium'],
  ['Bath', 'Exhaust fan rattles', 'hvac', 'medium'],
];
const PUNCH_STATUS: readonly PunchItem['status'][] = ['closed', 'closed', 'ready_for_review', 'open', 'in_progress', 'closed', 'open', 'ready_for_review', 'open', 'closed', 'in_progress', 'open'];

export function buildPunchItems(id: IdOf, clock: DemoClock): PunchItem[] {
  const out: PunchItem[] = [];
  const units = ['201', '203', '204', '206', '208', '302', '305'];
  let n = 0;
  for (const unit of units) {
    const level = unit[0];
    for (let k = 0; k < 5; k += 1) {
      const [room, text, subKey, priority] = PUNCH[(n * 5 + k * 7) % PUNCH.length];
      const status = PUNCH_STATUS[(n + k * 3) % PUNCH_STATUS.length];
      const made = DATA_DAY - 9 + (n % 6);
      const s = sub(subKey);
      n += 1;
      out.push({
        id: id(`punch:${n}`),
        projectId: id('project'),
        description: text,
        location: room === 'Corridor' ? `Level ${level}, Corridor outside Unit ${unit}` : `Level ${level}, Unit ${unit}, ${room}`,
        assignedSub: s.company,
        assignedSubId: subId(id, subKey),
        linkedTaskId: id(`task:l${level}-punch`),
        linkedTaskName: `Level ${level} Punch List`,
        dueDate: clock.dayOf(DATA_DAY + 4 + (n % 5)),
        priority,
        status,
        listType: 'punch',
        ...(status === 'closed' ? { closedAt: clock.at(DATA_DAY - 1 - (n % 3), 14) } : {}),
        createdAt: clock.at(made, 9),
        updatedAt: clock.at(status === 'open' ? made : DATA_DAY - 1 - (n % 3), 14),
      });
    }
  }
  return out;
}

// ── Permits and inspections ─────────────────────────────────────────────────

type PermitInput = Omit<Permit, 'id' | 'createdAt' | 'updatedAt'>;

export function buildPermits(id: IdOf, clock: DemoClock): PermitInput[] {
  const insp = fullName(person('inspector'));
  const mk = (type: Permit['type'], number: string, status: Permit['status'], applied: number, approved: number | null, fee: number, phase: string, notes: string, inspections: [string, number, 'passed' | 'failed' | 'scheduled', string?][]): PermitInput => ({
    projectId: id('project'),
    projectName: DEMO_PROJECT_NAME,
    type,
    permitNumber: number,
    jurisdiction: JOB.jurisdiction,
    status,
    appliedDate: clock.dayOf(applied),
    ...(approved !== null ? { approvedDate: clock.dayOf(approved) } : {}),
    inspections: inspections.map(([name, day, result, note], i) => ({
      id: id(`permit:${number}:insp:${i}`),
      name,
      scheduledFor: clock.dayOf(day),
      result,
      notes: `${note ?? ''} ${NOTE} Result typed in by the contractor.`.trim(),
      inspectorName: insp,
      recordedAt: clock.at(Math.min(day, DATA_DAY), 15),
    })),
    fee,
    notes: `${notes} ${NOTE} The permit number is invented.`,
    phase,
  });
  return [
    mk('building', 'DEMO-BLD-0001', 'approved', -40, -6, 86_400, 'General', 'New seven-storey mixed-use building.', [['Footing and foundation', 67, 'passed'], ['Podium structural', 132, 'passed'], ['Structural framing', 232, 'scheduled']]),
    mk('grading', 'DEMO-GRD-0002', 'inspection_passed', -38, -8, 6_200, 'Site Work', 'Grading and sediment control.', [['Sediment control', 9, 'passed']]),
    mk('electrical', 'DEMO-ELE-0003', 'approved', 60, 74, 18_500, 'Electrical', 'Building electrical.', [['Level 2 rough-in', 174, 'passed'], ['Level 3 rough-in', 186, 'passed'], ['Level 4 rough-in', 198, 'passed'], ['Level 5 rough-in', 210, 'failed', 'Two nail plates missing at kitchen walls.'], ['Level 5 rough-in, re-inspection', 211, 'passed']]),
    mk('plumbing', 'DEMO-PLB-0004', 'approved', 60, 72, 14_200, 'Plumbing', 'Building plumbing.', [['Under-slab', 87, 'passed'], ['Level 2 rough-in', 174, 'passed'], ['Level 3 rough-in', 186, 'passed'], ['Level 4 rough-in', 198, 'passed']]),
    mk('mechanical', 'DEMO-MEC-0005', 'approved', 62, 76, 12_800, 'HVAC', 'Building mechanical.', [['Level 2 rough-in', 174, 'passed'], ['Level 3 rough-in', 186, 'passed']]),
    mk('fire', 'DEMO-FIR-0006', 'inspection_scheduled', 118, 140, 9_600, 'MEP', 'Sprinkler and fire alarm.', [['Level 2 and 3 hydrostatic test', 190, 'passed'], ['Level 4 and 5 hydrostatic test', 231, 'scheduled']]),
    mk('occupancy', 'DEMO-OCC-0007', 'applied', 220, null, 0, 'Inspections', 'Certificate of occupancy, applied for early.', []),
  ];
}

// ── OAC meetings ────────────────────────────────────────────────────────────

export function buildOacMeetings(id: IdOf, clock: DemoClock, contractorName: string): OACMeeting[] {
  const days = [158, 172, 186, 200, 214, 227];
  const topics = [
    ['Topping out sequence for Levels 5 to 7', 'Framing is one floor ahead of rough-in. Hoist stays until Level 7 drywall is stocked.'],
    ['Storefront upgrade (Change Order 2)', 'Shop drawings approved as noted. Glass is ordered.'],
    ['Quartz countertop sample', 'Owner picked the color. Cabinet submittal to be resubmitted with the new edge.'],
    ['Electric vehicle charging rough-in', 'Owner approved Change Order 7. Conduit goes in with the Level 1 rough-in.'],
    ['Upper-floor window delay', 'Supplier pushed Levels 5 to 7 by two weeks. Contractor to re-sequence cladding from the south.'],
    ['Corridor flooring and lobby feature wall pricing', 'Change Orders 8 and 9 are with the owner for review.'],
  ];
  return days.map((d, i) => {
    const concluded = d < DATA_DAY - 1;
    const mid = (k: string) => id(`oac:${i + 1}:${k}`);
    return {
      id: id(`oac:${i + 1}`),
      projectId: id('project'),
      number: 12 + i,
      scheduledAt: clock.at(d, 10),
      durationMinutes: 60,
      location: 'Site trailer',
      // Names only. No email on any attendee, so minutes cannot be sent to anyone from this record.
      attendees: [
        { id: mid('a1'), name: fullName(person('ownerrep')), company: JOB.owner, role: 'owner', attended: concluded },
        { id: mid('a2'), name: fullName(person('architect2')), company: JOB.architect, role: 'architect', attended: concluded },
        { id: mid('a3'), name: SUPER_NAME, company: contractorName, role: 'gc', attended: concluded },
      ],
      agenda: [
        { id: mid('g1'), section: 'safety', title: 'Safety', detail: 'No lost-time events this period.', status: 'info', covered: concluded },
        { id: mid('g2'), section: 'schedule', title: 'Three-week look-ahead', detail: 'Drywall crew moves up one floor every 18 working days.', status: 'info', covered: concluded },
        { id: mid('g3'), section: 'decisions', title: topics[i][0], detail: topics[i][1], status: i === 4 ? 'warn' : 'info', covered: concluded },
      ],
      actionItems: [
        { id: mid('x1'), description: `Follow up: ${topics[i][0].toLowerCase()}`, ballInCourt: i % 2 ? JOB.architect : contractorName, dueBy: clock.dayOf(d + 10), status: i < 4 ? 'done' : 'open', createdAt: clock.at(d, 11), ...(i < 4 ? { closedAt: clock.at(d + 9, 11) } : {}), source: 'manual' },
      ],
      ...(concluded ? { minutes: `Meeting ${12 + i}. ${topics[i][0]}: ${topics[i][1]} (Made-up demo minutes, typed by the contractor. Not distributed.)` } : {}),
      status: concluded ? 'concluded' : 'scheduled',
      createdAt: clock.at(d - 3, 9),
      updatedAt: clock.at(Math.min(d, DATA_DAY), 12),
    };
  });
}

// ── Warranties (started, not complete) ──────────────────────────────────────

type WarrantyInput = Omit<Warranty, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'claims'> & { id: string };

export function buildWarranties(id: IdOf, clock: DemoClock): WarrantyInput[] {
  const mk = (key: string, title: string, category: Warranty['category'], subKey: string, startDay: number, months: number, coverage: string): WarrantyInput => {
    const start = clock.dayOf(startDay);
    const d = dayDate(start);
    const end = new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      id: id(`warranty:${key}`),
      projectId: id('project'),
      projectName: DEMO_PROJECT_NAME,
      title,
      category,
      description: `${NOTE} Entered early so closeout has a head start. No warranty document is attached.`,
      provider: sub(subKey).company,
      startDate: start,
      durationMonths: months,
      endDate: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
      coverageDetails: coverage,
    };
  };
  return [
    mk('wproof', 'Below-Grade Waterproofing', 'foundation', 'roofing', 80, 120, 'Material and labor, ten years from installation.'),
    mk('podium', 'Podium Concrete', 'structural', 'concrete', 143, 12, 'Workmanship, one year.'),
    mk('windows', 'Windows, Levels 2 to 4', 'windows', 'glazing', 215, 120, 'Glass seal and frame finish, ten years. Levels 5 to 7 to be added when set.'),
    mk('sprinkler', 'Sprinkler System, Levels 2 and 3', 'plumbing', 'fire', 190, 12, 'Workmanship, one year from the passed hydrostatic test.'),
  ];
}

// ── Safety ──────────────────────────────────────────────────────────────────

export const TOOLBOX_TOPICS = [
  'Fall protection at open floor edges', 'Ladder setup and three points of contact', 'Hoist loading and landing gates', 'Cut-resistant gloves for stud handling',
  'Housekeeping in corridors', 'Silica control when cutting fiber cement', 'Hot work and fire watch', 'Lifting and moving drywall',
  'Extension cords and ground-fault protection', 'Working around the telehandler',
] as const;

export function buildToolboxTalks(id: IdOf, clock: DemoClock): ToolboxTalk[] {
  return TOOLBOX_TOPICS.map((topic, i) => {
    const day = DATA_DAY - 3 - (TOOLBOX_TOPICS.length - 1 - i) * 5;
    return {
      id: id(`toolbox:${i + 1}`),
      projectId: id('project'),
      topic,
      date: clock.dayOf(day),
      presenter: SUPER_NAME,
      notes: `Fifteen minutes at the hoist before the start of work. ${NOTE}`,
      // Listed, not signed in: no sign-in time is stored for anyone.
      attendees: CREW.slice(1).map((c) => ({ name: c.name })),
      aiTopicSource: 'manual',
      createdBy: SUPER_NAME,
      createdAt: clock.at(day, 7),
      updatedAt: clock.at(day, 7),
    };
  });
}

export function buildHazards(id: IdOf, clock: DemoClock): Hazard[] {
  const mk = (n: number, description: string, location: string, severity: 1 | 2 | 3 | 4 | 5, likelihood: 1 | 2 | 3 | 4 | 5, status: Hazard['status'], subKey: string, action: string, daysAgo: number): Hazard => ({
    id: id(`hazard:${n}`),
    projectId: id('project'),
    description: `${description} (${NOTE})`,
    location,
    severity,
    likelihood,
    riskScore: severity * likelihood,
    assignedTo: sub(subKey).company,
    dueDate: clock.dayOf(DATA_DAY - daysAgo + 2),
    correctiveAction: action,
    status,
    createdBy: SUPER_NAME,
    createdAt: clock.at(DATA_DAY - daysAgo, 8),
    updatedAt: clock.at(DATA_DAY - daysAgo + (status === 'open' ? 0 : 1), 15),
  });
  return [
    mk(1, 'Guardrail removed at the Level 6 east floor edge for material loading and not put back', 'Level 6, east elevation', 5, 3, 'closed', 'framing', 'Guardrail reinstalled the same hour. Loading zone now uses a gate.', 14),
    mk(2, 'Extension cords run through standing water at the Level 1 retail slab', 'Level 1, retail bay 2', 4, 3, 'mitigated', 'electrical', 'Cords raised on stands. Slab squeegeed. Ground-fault protection checked.', 6),
    mk(3, 'Drywall stacks block the Level 4 corridor to Stair 2', 'Level 4, corridor', 3, 4, 'open', 'drywall', 'Restack along one wall and keep 36 inches clear to both stairs.', 1),
  ];
}

// ── Deliveries and building access ──────────────────────────────────────────

export function buildDeliveries(id: IdOf, clock: DemoClock): Delivery[] {
  const mk = (n: number, description: string, supplier: string, dayOffset: number, status: Delivery['status'], window: string, location: string, commitmentKey?: string): Delivery => {
    const day = DATA_DAY + dayOffset;
    return {
      id: id(`delivery:${n}`),
      projectId: id('project'),
      description,
      supplier,
      ...(commitmentKey ? { commitmentId: id(`commitment:${commitmentKey}`), poNumber: COMMITMENTS.find((c) => c.key === commitmentKey)?.number } : {}),
      expectedDate: clock.dayOf(day),
      window,
      status,
      ...(status !== 'scheduled' ? { confirmedAt: clock.at(day - 2, 10) } : {}),
      ...(status === 'delivered' ? { deliveredAt: clock.at(day, 9), receivedBy: SUPER_NAME } : {}),
      location,
      notes: NOTE,
      createdAt: clock.at(day - 8, 9),
      updatedAt: clock.at(Math.min(day, DATA_DAY), 9),
    };
  };
  return [
    mk(1, 'Drywall, Level 5, four trucks', 'Sample Building Supply', -9, 'delivered', '7:00 to 9:00', 'Hoist, north gate'),
    mk(2, 'Windows, Level 4', 'Sample Window Supply', -12, 'delivered', '7:00 to 10:00', 'North gate'),
    mk(3, 'Cabinets, Level 3', sub('millwork').company, -6, 'delivered', '8:00 to 10:00', 'Loading dock', 'sc-millwork'),
    mk(4, 'Brick, pallets for the south elevation', sub('masonry').company, -4, 'delivered', '6:30 to 8:00', 'North gate', 'sc-masonry'),
    mk(5, 'Roof insulation and membrane', sub('roofing').company, -1, 'delivered', '7:00 to 9:00', 'Crane pick, alley', 'sc-roofing'),
    mk(6, 'Appliances, Level 2', 'Sample Appliance Supply', 2, 'confirmed', '9:00 to 11:00', 'Loading dock', 'po-appliances'),
    mk(7, 'Drywall, Level 6, four trucks', 'Sample Building Supply', 4, 'confirmed', '7:00 to 9:00', 'Hoist, north gate'),
    mk(8, 'Windows, Levels 5 to 7 (late)', 'Sample Window Supply', 9, 'scheduled', '7:00 to 10:00', 'North gate'),
    mk(9, 'Elevator rails and car frames', sub('elevator').company, 12, 'scheduled', '6:00 to 8:00', 'Loading dock', 'sc-elevator'),
    mk(10, 'Cabinets, Level 4', sub('millwork').company, 14, 'scheduled', '8:00 to 10:00', 'Loading dock', 'sc-millwork'),
  ];
}

export function buildBuildingAccess(id: IdOf, clock: DemoClock): BuildingAccessRules {
  return {
    projectId: id('project'),
    buildingContact: `${SUPER_NAME} (site superintendent, made-up)`,
    buildingPhone: CREW[0].phone,
    requiresFreightElevator: false,
    requiresDockReservation: true,
    requiresCoiOnFile: true,
    requiresBadging: false,
    workHours: '7:00 AM to 3:30 PM, Monday to Friday',
    afterHoursRequiresApproval: true,
    notes: `Deliveries by the north gate on Example Wharf Street. One truck at the dock at a time. ${NOTE}`,
    updatedAt: clock.at(DATA_DAY - 30, 9),
  };
}

export function buildReservations(id: IdOf, clock: DemoClock): AccessReservation[] {
  const mk = (n: number, kind: AccessReservation['kind'], dayOffset: number, window: string, status: AccessReservation['status'], deliveryN?: number, notes?: string): AccessReservation => ({
    id: id(`reservation:${n}`),
    projectId: id('project'),
    kind,
    date: clock.dayOf(DATA_DAY + dayOffset),
    window,
    status,
    ...(status === 'confirmed' ? { confirmationRef: `DEMO-${100 + n}`, confirmedAt: clock.at(DATA_DAY + dayOffset - 3, 10) } : {}),
    ...(deliveryN ? { deliveryId: id(`delivery:${deliveryN}`) } : {}),
    requestedAt: clock.at(DATA_DAY + dayOffset - 5, 10),
    notes: `${notes ?? ''} ${NOTE}`.trim(),
    createdAt: clock.at(DATA_DAY + dayOffset - 5, 10),
    updatedAt: clock.at(DATA_DAY - 1, 10),
  });
  return [
    mk(1, 'dock', 2, '9:00 to 11:00', 'confirmed', 6, 'Appliances for Level 2.'),
    mk(2, 'dock', 12, '6:00 to 8:00', 'requested', 9, 'Elevator rails. Needs the whole dock.'),
    mk(3, 'hot_work', 3, '7:00 to 12:00', 'confirmed', undefined, 'Roof drain brazing at the roof. Fire watch for one hour after.'),
    mk(4, 'after_hours', 6, '4:00 PM to 8:00 PM', 'requested', undefined, 'Crane pick for rooftop units.'),
  ];
}

// ── Delays (no weather delay: the app only logs one from a live reading) ─────

export function buildDelayEvents(id: IdOf, clock: DemoClock, contractorName: string): DelayEvent[] {
  const mk = (n: number, cause: DelayEvent['cause'], from: number, to: number | null, description: string, taskKeys: string[], days: number, classification: DelayEvent['classification'], coN?: number, rfiN?: number): DelayEvent => ({
    id: id(`delay:${n}`),
    projectId: id('project'),
    number: n,
    cause,
    firstObservedDate: clock.dayOf(from),
    ...(to !== null ? { endedDate: clock.dayOf(to) } : {}),
    description: `${description} (${NOTE})`,
    evidence: [
      ...(rfiN ? [{ kind: 'rfi' as const, id: id(`rfi:${rfiN}`), capturedAt: clock.at(from, 12), note: `RFI ${rfiN}` }] : []),
      ...(coN ? [{ kind: 'change_order' as const, id: id(`co:${coN}`), capturedAt: clock.at(from + 3, 12), note: `Change Order ${coN}` }] : []),
    ],
    impactedTaskIds: taskKeys.map((k) => id(`task:${k}`)),
    claimedDays: days,
    // No notice is recorded: none was sent to anyone.
    notices: [],
    classification,
    ...(coN ? { changeOrderId: id(`co:${coN}`) } : {}),
    auditTrail: [{ id: id(`delay:${n}:a1`), action: 'created', actor: contractorName, timestamp: clock.at(from, 12), detail: 'Made-up demo delay, typed by the contractor.' }],
    createdAt: clock.at(from, 12),
    updatedAt: clock.at(to ?? DATA_DAY - 1, 12),
  });
  return [
    mk(1, 'differing_site_condition', 33, 39, 'Unsuitable fill at the east footings. Excavation ran 4 working days over.', ['exc'], 4, 'excusable_compensable', 1, 2),
    mk(2, 'design_revision', 99, 115, 'Transfer beam added at gridline C. Podium deck ran 3 working days over.', ['pod-deck'], 3, 'excusable_compensable', 3, 5),
    mk(3, 'other', 214, null, 'Supplier pushed the Level 5 to 7 window shipment by two weeks. Window install is running 12 working days over.', ['windows'], 12, 'unclassified'),
  ];
}

// ── Equipment ───────────────────────────────────────────────────────────────

type EquipmentInput = Omit<Equipment, 'id' | 'createdAt'>;
/** Demo equipment is found again by this serial-number prefix (the app makes the id). */
export const equipmentSerialPrefix = (projectId: string): string => `DEMO-${projectId.slice(0, 8)}-`;

export function buildEquipment(id: IdOf, clock: DemoClock): EquipmentInput[] {
  const prefix = equipmentSerialPrefix(id('project'));
  const mk = (n: number, name: string, type: Equipment['type'], category: Equipment['category'], make: string, rate: number, days: number[]): EquipmentInput => ({
    name: `Demo: ${name}`,
    type,
    category,
    make,
    model: 'Demo Model',
    serialNumber: `${prefix}${n}`,
    dailyRate: rate,
    currentProjectId: id('project'),
    maintenanceSchedule: [],
    utilizationLog: days.map((off, i) => ({ id: id(`equip:${n}:use:${i}`), equipmentId: '', projectId: id('project'), date: clock.dayOf(DATA_DAY - off), hoursUsed: 8, operatorName: CREW[2 + (i % 3)].name })),
    status: 'in_use',
    notes: NOTE,
  });
  return [
    mk(1, 'Material Hoist', 'rented', 'lifting', 'Sample Hoist Rental', 420, []),
    mk(2, 'Telehandler', 'rented', 'lifting', 'Sample Equipment Rental', 380, [9, 8, 4, 3, 1]),
    mk(3, 'Skid Steer', 'owned', 'excavation', 'Sample Machine Works', 260, [6, 2]),
  ];
}

// ── Field tickets (drafts, never authorized) ────────────────────────────────

export function buildFieldTickets(id: IdOf, clock: DemoClock): FieldTicket[] {
  const mk = (n: number, daysAgo: number, work: string, reason: string, hours: number, material: [string, number, string, number][]): FieldTicket => ({
    id: id(`ticket:${n}`),
    number: n,
    projectId: id('project'),
    date: clock.dayOf(DATA_DAY - daysAgo),
    workDescription: work,
    reasonExtra: `${reason} (${NOTE} Draft only: nobody has authorized it.)`,
    labor: [
      { id: id(`ticket:${n}:l1`), workerName: CREW[2].name, trade: 'Carpenter', hours, rate: 78 },
      { id: id(`ticket:${n}:l2`), workerName: CREW[4].name, trade: 'Laborer', hours, rate: 52 },
    ],
    materials: material.map(([description, quantity, unit, unitCost], i) => ({ id: id(`ticket:${n}:m${i}`), description, quantity, unit, unitCost })),
    equipment: [],
    markupPercent: 15,
    status: 'draft',
    createdAt: clock.at(DATA_DAY - daysAgo, 15),
    updatedAt: clock.at(DATA_DAY - daysAgo, 15),
  });
  return [
    mk(1, 12, 'Opened and re-framed the Unit 304 kitchen wall for a relocated range hood duct', 'Owner walk-through request', 6, [['Metal studs and track', 14, 'EA', 9.5], ['Drywall patch', 2, 'SHT', 18]]),
    mk(2, 7, 'Temporary protection at the retail storefront openings', 'Requested by the owner\'s representative ahead of the glass delivery', 4, [['Plywood, 3/4 inch', 12, 'SHT', 46]]),
    mk(3, 2, 'Moved stored cabinets out of Units 305 and 306 for an owner tour', 'Owner tour of the model unit', 3, []),
  ];
}

// ── Lien waivers, contract, selections (written through their engines) ──────

type LienWaiverInput = Pick<LienWaiver, 'id' | 'projectId' | 'subName' | 'waiverType' | 'throughDate' | 'paidAmount' | 'status' | 'notes'> & { commitmentId?: string; subCompanyId?: string; invoiceId?: string };

export function buildLienWaivers(id: IdOf, clock: DemoClock, paidToDate: (commitmentKey: string) => number): LienWaiverInput[] {
  const through = clock.dayOf(PAY_APP_PERIOD_END[PAID_PAY_APPS - 1]);
  return ['concrete', 'earthwork', 'framing', 'plumbing', 'electrical', 'hvac'].map((key) => ({
    id: id(`waiver:${key}`),
    projectId: id('project'),
    commitmentId: id(`commitment:sc-${key}`),
    subCompanyId: subId(id, key),
    invoiceId: id(`invoice:${PAID_PAY_APPS}`),
    waiverType: 'conditional_partial',
    subName: sub(key).company,
    throughDate: through,
    paidAmount: paidToDate(`sc-${key}`),
    // "received" is the app's status for a waiver the contractor says he holds.
    status: 'received',
    notes: 'Waiver received on paper, recorded by the contractor. Made-up demo record: no signature is stored and no signing request was sent.',
  }));
}

type ContractInput = Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt' | 'userId'> & { id: string };

export function buildContract(id: IdOf, clock: DemoClock, finishDay: number): ContractInput {
  return {
    id: id('contract'),
    projectId: id('project'),
    version: 1,
    kind: 'contract',
    title: 'Demo: Prime Contract Summary (Draft)',
    contractValue: ORIGINAL_CONTRACT_SUM,
    startDate: clock.startDate,
    durationDays: Math.round((finishDay * 7) / 5),
    scopeText: `${JOB.description} General construction of the whole building under one stipulated-sum contract.`,
    termsText: 'Made-up demo draft. The real agreement would be signed on paper outside the app. Monthly pay applications, 10 percent retainage, payment net 30 days.',
    warrantyText: 'One year from substantial completion, plus the manufacturer warranties listed under Warranties.',
    paymentSchedule: [],
    allowances: [
      { id: id('contract:allow:1'), category: 'Lobby Light Fixtures', amount: 45_000, description: 'Allowance. Selection pending.' },
      { id: id('contract:allow:2'), category: 'Building Signage', amount: 30_000, description: 'Allowance.' },
    ],
    // A draft. No signature of any party is set, and it is not sent.
    status: 'draft',
  };
}

export interface DemoSelection { category: Partial<SelectionCategory> & { id: string; projectId: string; category: string; budget: number; styleBrief: string }; options: (Partial<SelectionOption> & { id: string; categoryId: string; productName: string; unitPrice: number })[] }

export function buildSelections(id: IdOf, clock: DemoClock): DemoSelection[] {
  const mk = (n: number, category: string, brief: string, budget: number, dueOffset: number, opts: [string, string, number, string, number, boolean][]): DemoSelection => {
    const cid = id(`selection:${n}`);
    const chosen = opts.some((o) => o[5]);
    return {
      category: { id: cid, projectId: id('project'), category, styleBrief: `${brief} (${NOTE})`, budget, dueDate: clock.dayOf(DATA_DAY + dueOffset), status: chosen ? 'chosen' : 'browsing', notes: '', displayOrder: n },
      options: opts.map(([productName, description, unitPrice, unit, quantity, isChosen], i) => ({
        id: id(`selection:${n}:opt:${i}`),
        categoryId: cid,
        source: 'gc_added',
        productName,
        brand: 'Sample Brand',
        sku: `DEMO-${n}${i}`,
        description,
        unitPrice,
        unit,
        quantity,
        total: unitPrice * quantity,
        highlights: [],
        isChosen,
        ...(isChosen ? { chosenAt: clock.at(DATA_DAY - 40, 11), chosenByRole: 'gc' as const } : {}),
      })),
    };
  };
  return [
    mk(1, 'Unit Kitchen Countertops', 'Quartz, light and warm, eased edge. All 48 units.', 290_000, -40, [['Sample Quartz, Warm White', 'Three centimeter quartz with an eased edge', 5_900, 'unit', 48, true], ['Sample Quartz, Soft Gray', 'Three centimeter quartz with an eased edge', 6_150, 'unit', 48, false]]),
    mk(2, 'Unit Plank Flooring', 'Wood-look plank, mid tone, 20 mil wear layer.', 210_000, 6, [['Sample Plank, Natural Oak', 'Rigid core plank, 7 inch', 4.6, 'SF', 42_000, false], ['Sample Plank, Smoked Oak', 'Rigid core plank, 7 inch', 4.9, 'SF', 42_000, false], ['Sample Plank, Honey Maple', 'Rigid core plank, 9 inch', 5.4, 'SF', 42_000, false]]),
    mk(3, 'Lobby Light Fixtures', 'Warm, simple pendants over the lobby seating and the mail alcove.', 45_000, 15, [['Sample Pendant, Brass Dome', 'Sixteen inch dome pendant', 1_450, 'EA', 14, false], ['Sample Pendant, Linen Drum', 'Twenty inch drum pendant', 1_180, 'EA', 14, false]]),
  ];
}

// ── Crew and time ───────────────────────────────────────────────────────────

export function buildCrew(id: IdOf, clock: DemoClock, userId: string): CrewMember[] {
  return CREW.map((c, i) => ({
    id: id(`crew:${c.key}`),
    companyUserId: userId,
    createdAt: clock.at(-10 + i, 9),
    updatedAt: clock.at(-10 + i, 9),
    fullName: c.name,
    trades: c.trades,
    phone: c.phone,
    email: c.email,
    status: 'active',
    // No ID was scanned, and the person is not listed anywhere public.
    idVerified: false,
    isPublic: false,
    projectIds: [id('project')],
  }));
}

export interface DemoTimeEntry { workerName: string; trade: string; hours: number; date: string; notes: string }
export const TIME_ENTRY_DAYS = 10;

export function buildTimeEntries(clock: DemoClock): DemoTimeEntry[] {
  const out: DemoTimeEntry[] = [];
  for (let i = TIME_ENTRY_DAYS; i >= 1; i -= 1) {
    const day = DATA_DAY - i;
    for (const c of CREW.slice(2)) {
      out.push({ workerName: c.name, trade: c.trades[0], hours: (day + c.name.length) % 7 === 0 ? 9 : 8, date: clock.dayOf(day), notes: 'Made-up demo shift.' });
    }
  }
  return out;
}

// ── Photos (the one bundled sample photo, used a few times) ─────────────────

export const PHOTO_SPECS: readonly { key: string; tag: string; location: string; task: string; daysAgo: number }[] = [
  { key: '1', tag: 'Electrical', location: 'Level 4, Unit 402, Kitchen (sample photo)', task: 'l4-elec', daysAgo: 20 },
  { key: '2', tag: 'Electrical', location: 'Level 5, Unit 506, Bedroom (sample photo)', task: 'l5-elec', daysAgo: 14 },
  { key: '3', tag: 'Punch', location: 'Level 2, Unit 204, Kitchen (sample photo)', task: 'l2-punch', daysAgo: 3 },
  { key: '4', tag: 'Electrical', location: 'Level 6, Unit 601, Living Room (sample photo)', task: 'l6-elec', daysAgo: 1 },
];
