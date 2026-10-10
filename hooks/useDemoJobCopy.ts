// hooks/useDemoJobCopy.ts — the strings of the owner's Demo Job builder
// (app/demo-job.tsx). Every string goes through t('office.demoJob.*', english),
// so the i18n registry stays in one file (surface 'office.demo-job', Spanish in
// i18n/catalog/es/office/demoJob.ts).
//
// WORDING (docs/VOICE.md): `Label` is Title Case; `Body` is one or more whole
// sentences in sentence case; `Sub` is a caption with a capital first letter
// and no period. No em dashes, no "and" sign, no arrows. The screen says what
// the builder does and what it never does, in plain words
// (scripts/validate-demo-job.ts reads both languages).
//
// Never call t() at module scope: the object is rebuilt when the language changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import type { AreaKey } from '@/utils/demoJob/writer';

export interface DemoJobCopy {
  titleLabel: string;
  ownerPreviewSub: string;
  backLabel: string;
  introBody: string;
  whatBody: string;
  modelBody: string;
  limitsBody: string;
  briefBody: string;
  offlineBody: string;
  checkingBody: string;
  createLabel: string;
  finishLabel: string;
  removeLabel: string;
  openJobLabel: string;
  /** Names the job or jobs that will be deleted, and how many. */
  confirmRemoveBody: (count: number, names: string) => string;
  confirmRemoveLabel: string;
  keepLabel: string;
  workingBody: string;
  removingBody: string;
  noneBody: string;
  partialBody: string;
  completeBody: string;
  removedBody: string;
  twoJobsBody: string;
  queueFullBody: string;
  needsConnectionSub: string;
  failedLabel: string;
  progressLabel: string;
  settingsRowLabel: string;
  settingsRowSub: string;
  areaLabel: (key: AreaKey) => string;
  /** "Daily Reports: 18 of 30". */
  countLine: (label: string, done: number, total: number) => string;
  removeRefusedBody: (reason: string) => string;
}

export function useDemoJobCopy(): DemoJobCopy {
  const { t } = useT();
  return useMemo<DemoJobCopy>(() => {
    const areas: Record<AreaKey, string> = {
      project: t('office.demoJob.area.projectLabel', 'Schedule Tasks'),
      subcontractors: t('office.demoJob.area.subcontractorsLabel', 'Subcontractors'),
      contacts: t('office.demoJob.area.contactsLabel', 'Contacts'),
      commitments: t('office.demoJob.area.commitmentsLabel', 'Subcontracts and Purchase Orders'),
      insurance: t('office.demoJob.area.insuranceLabel', 'Insurance Certificates'),
      changeOrders: t('office.demoJob.area.changeOrdersLabel', 'Change Orders'),
      invoices: t('office.demoJob.area.invoicesLabel', 'Invoices'),
      payApps: t('office.demoJob.area.payAppsLabel', 'Pay Applications'),
      dailyReports: t('office.demoJob.area.dailyReportsLabel', 'Daily Reports'),
      rfis: t('office.demoJob.area.rfisLabel', 'RFIs'),
      submittals: t('office.demoJob.area.submittalsLabel', 'Submittals'),
      punchItems: t('office.demoJob.area.punchItemsLabel', 'Punch Items'),
      permits: t('office.demoJob.area.permitsLabel', 'Permits and Inspections'),
      meetings: t('office.demoJob.area.meetingsLabel', 'Owner Meetings'),
      warranties: t('office.demoJob.area.warrantiesLabel', 'Warranties'),
      toolboxTalks: t('office.demoJob.area.toolboxTalksLabel', 'Toolbox Talks'),
      hazards: t('office.demoJob.area.hazardsLabel', 'Hazard Observations'),
      deliveries: t('office.demoJob.area.deliveriesLabel', 'Deliveries'),
      access: t('office.demoJob.area.accessLabel', 'Building Access'),
      delays: t('office.demoJob.area.delaysLabel', 'Delays'),
      equipment: t('office.demoJob.area.equipmentLabel', 'Equipment'),
      fieldTickets: t('office.demoJob.area.fieldTicketsLabel', 'Field Tickets'),
      crew: t('office.demoJob.area.crewLabel', 'Crew'),
      timeEntries: t('office.demoJob.area.timeEntriesLabel', 'Time Entries'),
      lienWaivers: t('office.demoJob.area.lienWaiversLabel', 'Lien Waivers'),
      contract: t('office.demoJob.area.contractLabel', 'Draft Contract'),
      selections: t('office.demoJob.area.selectionsLabel', 'Selections'),
      planSheet: t('office.demoJob.area.planSheetLabel', 'Plan Sheet'),
      photos: t('office.demoJob.area.photosLabel', 'Photos'),
      model: t('office.demoJob.area.modelLabel', 'Living Model'),
    };
    return {
      titleLabel: t('office.demoJob.titleLabel', 'Demo Job'),
      ownerPreviewSub: t('office.demoJob.ownerPreviewSub', 'Owner preview'),
      backLabel: t('office.demoJob.backLabel', 'Back'),
      introBody: t('office.demoJob.introBody', 'This creates a made-up job in your account so you can try every screen. Nothing is sent to anyone. Remove it any time.'),
      whatBody: t('office.demoJob.whatBody', 'The job is a seven-storey mixed-use building in Baltimore: ground-floor retail, 48 apartments, a $22,400,000 contract with $640,000 of approved change orders, in month 11 of an 18-month schedule. Every company and person on it is invented.'),
      modelBody: t('office.demoJob.modelBody', 'The job has a Living Model: one typical floor of eight apartments that Job Replay builds month by month. It is saved on this device only. Open the job here, on the phone or computer where you tapped Create, and tap Living Model.'),
      limitsBody: t('office.demoJob.limitsBody', 'The job is a sample job. It cannot email a client, make a pay link, send a reminder, open a client portal or push to QuickBooks, and your cost book never learns from it.'),
      briefBody: t('office.demoJob.briefBody', 'Your morning brief leaves this job out.'),
      offlineBody: t('office.demoJob.offlineBody', 'You are offline. The job is saved on this device and syncs when you are back online. Lien waivers, the draft contract, selections and the plan sheet need a connection.'),
      checkingBody: t('office.demoJob.checkingBody', 'Checking for a demo job.'),
      createLabel: t('office.demoJob.createLabel', 'Create Demo Job'),
      finishLabel: t('office.demoJob.finishLabel', 'Finish Creating'),
      removeLabel: t('office.demoJob.removeLabel', 'Remove Demo Job'),
      openJobLabel: t('office.demoJob.openJobLabel', 'Open the Job'),
      confirmRemoveBody: (count, names) => (count === 1
        ? t('office.demoJob.confirmRemoveOneBody', 'Remove 1 demo job and everything created with it? The job is {names}. This cannot be undone.', { names })
        : t('office.demoJob.confirmRemoveManyBody', 'Remove {count} demo jobs and everything created with them? The jobs are {names}. This cannot be undone.', { count, names })),
      confirmRemoveLabel: t('office.demoJob.confirmRemoveLabel', 'Remove Everything'),
      keepLabel: t('office.demoJob.keepLabel', 'Keep It'),
      workingBody: t('office.demoJob.workingBody', 'Creating the demo job. Keep this screen open.'),
      removingBody: t('office.demoJob.removingBody', 'Removing the demo job.'),
      noneBody: t('office.demoJob.noneBody', 'There is no demo job in your account.'),
      partialBody: t('office.demoJob.partialBody', 'A demo job was started and is not finished. Finish creating it or remove it.'),
      completeBody: t('office.demoJob.completeBody', 'The demo job is in your account.'),
      removedBody: t('office.demoJob.removedBody', 'The demo job was removed.'),
      twoJobsBody: t('office.demoJob.twoJobsBody', 'There is more than one demo job in your account. Remove them, then create one.'),
      queueFullBody: t('office.demoJob.queueFullBody', 'Too many changes are waiting to sync on this device. Go online, let them sync, then try again.'),
      needsConnectionSub: t('office.demoJob.needsConnectionSub', 'Needs a connection'),
      failedLabel: t('office.demoJob.failedLabel', 'Not Written'),
      progressLabel: t('office.demoJob.progressLabel', 'What Is in the Job'),
      settingsRowLabel: t('office.demoJob.settingsRowLabel', 'Demo Job (Owner Preview)'),
      settingsRowSub: t('office.demoJob.settingsRowSub', 'One made-up $23M job that touches every screen'),
      areaLabel: (key) => areas[key],
      countLine: (label, done, total) => t('office.demoJob.countLine', '{label}: {done} of {total}', { label, done, total }),
      removeRefusedBody: (reason) => t('office.demoJob.removeRefusedBody', 'The demo job was not removed. {reason}', { reason }),
    };
  }, [t]);
}
