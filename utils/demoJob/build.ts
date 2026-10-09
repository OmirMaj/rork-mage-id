// utils/demoJob/build.ts — the whole Demo Job as plain data (pure).
//
// `buildDemoJob` takes the account, the demo project's id, the local day and
// the contractor's name, and returns every record the builder will write.
// Same inputs, same job, to the byte: that is what makes creation resumable.
import type {
  CertificateOfInsurance, ChangeOrder, Commitment, Contact, CrewMember, DailyFieldReport, DelayEvent, FieldTicket, Hazard,
  Invoice, OACMeeting, Project, PunchItem, RFI, SavedAIAPayApp, Subcontractor, ToolboxTalk,
} from '@/types';
import type { AccessReservation, BuildingAccessRules } from '@/utils/buildingAccess';
import type { Delivery } from '@/utils/deliverySchedule';
import type { JobModel } from '@/utils/livingModel/types';
import { buildBilling } from './billing';
import { makeDemoClock, type DemoClock } from './clock';
import {
  buildBuildingAccess, buildContract, buildCrew, buildDailyReports, buildDelayEvents, buildDeliveries, buildEquipment,
  buildFieldTickets, buildHazards, buildLienWaivers, buildOacMeetings, buildPermits, buildPunchItems, buildReservations,
  buildRfis, buildSelections, buildSubmittals, buildTimeEntries, buildToolboxTalks, buildWarranties, PHOTO_SPECS,
  type DemoSelection, type DemoTimeEntry,
} from './fieldRecords';
import { childIds } from './ids';
import { buildDemoModel } from './model';
import { COMMITMENTS } from './money';
import { buildChangeOrders, buildCois, buildCommitments, buildContacts, buildProject, buildSubcontractors } from './records';

export interface DemoJobInput {
  userId: string;
  projectId: string;
  /** The device's local day, 'YYYY-MM-DD'. */
  today: string;
  /** The contractor's company name, as his settings have it. */
  contractorName: string;
}

export interface DemoJob {
  input: DemoJobInput;
  clock: DemoClock;
  id: (key: string) => string;
  project: Project;
  finishDay: number;
  subcontractors: Subcontractor[];
  contacts: Contact[];
  cois: CertificateOfInsurance[];
  commitments: Commitment[];
  changeOrders: ChangeOrder[];
  invoices: Invoice[];
  payApps: SavedAIAPayApp[];
  dailyReports: DailyFieldReport[];
  rfis: RFI[];
  submittals: ReturnType<typeof buildSubmittals>;
  punchItems: PunchItem[];
  permits: ReturnType<typeof buildPermits>;
  oacMeetings: OACMeeting[];
  warranties: ReturnType<typeof buildWarranties>;
  toolboxTalks: ToolboxTalk[];
  hazards: Hazard[];
  deliveries: Delivery[];
  buildingAccess: BuildingAccessRules;
  reservations: AccessReservation[];
  delayEvents: DelayEvent[];
  equipment: ReturnType<typeof buildEquipment>;
  fieldTickets: FieldTicket[];
  lienWaivers: ReturnType<typeof buildLienWaivers>;
  contract: ReturnType<typeof buildContract>;
  selections: DemoSelection[];
  crew: CrewMember[];
  timeEntries: DemoTimeEntry[];
  photos: typeof PHOTO_SPECS;
  model: JobModel;
}

export function buildDemoJob(input: DemoJobInput): DemoJob {
  const clock = makeDemoClock(input.today);
  const ids = childIds(input.projectId);
  // The project's own id is the one handed in; every other id hangs off it.
  const id = (key: string): string => (key === 'project' ? input.projectId : ids(key));
  const name = input.contractorName.trim() || 'Your Company';
  const { project, schedule } = buildProject(id, clock, input.userId);
  const billing = buildBilling(id, clock, name);
  const commitments = buildCommitments(id, clock);
  const paid = (key: string): number => commitments.find((c) => c.id === id(`commitment:${key}`))?.paidToDate ?? 0;
  if (!COMMITMENTS.length) throw new Error('no commitments');
  return {
    input,
    clock,
    id,
    project,
    finishDay: schedule.finishDay,
    subcontractors: buildSubcontractors(id, clock),
    contacts: buildContacts(id, clock),
    cois: buildCois(id, clock),
    commitments,
    changeOrders: buildChangeOrders(id, clock, name),
    invoices: billing.invoices,
    payApps: billing.payApps,
    dailyReports: buildDailyReports(id, clock, name),
    rfis: buildRfis(id, clock, name),
    submittals: buildSubmittals(id, clock),
    punchItems: buildPunchItems(id, clock),
    permits: buildPermits(id, clock),
    oacMeetings: buildOacMeetings(id, clock, name),
    warranties: buildWarranties(id, clock),
    toolboxTalks: buildToolboxTalks(id, clock),
    hazards: buildHazards(id, clock),
    deliveries: buildDeliveries(id, clock),
    buildingAccess: buildBuildingAccess(id, clock),
    reservations: buildReservations(id, clock),
    delayEvents: buildDelayEvents(id, clock, name),
    equipment: buildEquipment(id, clock),
    fieldTickets: buildFieldTickets(id, clock),
    lienWaivers: buildLienWaivers(id, clock, paid),
    contract: buildContract(id, clock, schedule.finishDay),
    selections: buildSelections(id, clock),
    crew: buildCrew(id, clock, input.userId),
    timeEntries: buildTimeEntries(clock),
    photos: PHOTO_SPECS,
    model: buildDemoModel(id),
  };
}
