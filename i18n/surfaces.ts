// i18n/surfaces.ts — the rollout map (docs/I18N.md §10, §12).
//
// A SURFACE is a set of catalog keys plus the screen files that render them.
// Its state gates the validator:
//   pending   — nothing enforced yet (the file still holds raw English).
//   migrated  — the file's strings go through t()/tn(); coverage may be partial
//               (missing Spanish shows English — safe). The raw-literal rule
//               applies to its `files` (never to its `partialFiles`).
//   complete  — every key it owns MUST have Spanish (a `.legal.` key is exempt:
//               only a human legal translator writes that Spanish);
//               validate-i18n fails otherwise. Phase gates flip surfaces here.
//
// KEY OWNERSHIP — exactly one owner per key (wave-next W2, lane ESTOOLS):
//   1. the surface whose `keys` lists the key (EXACT; the seed surfaces), else
//   2. the surface with the LONGEST matching `keyPrefixes` entry.
// Two owners at the same precedence, or none, fails validate-i18n. The
// extractor (scripts/i18n-extract.ts) writes each key to its OWNER's shard
// (i18n/catalog/en/<id>.generated.ts) by KEY, not by file — so one file may
// hold keys of two surfaces. A key no surface owns lands in
// en/unassigned.generated.ts, which `i18n-extract --check` fails on.
//
// The seed surfaces own their Phase 0 keys EXACTLY, so a NEW key under
// field. / safety. / common. / nav. / outbound. belongs to its Phase 1 surface
// (pending / migrated) and can never turn a `complete` seed surface red while
// its Spanish is still being written.
//
// FILES: every file belongs to exactly one surface (`files` or `partialFiles`).
// `partialFiles` also hold strings of a later phase: the raw-literal rule never
// applies to them; their migrated rows are proven by the owning lane's own
// validator. Only migrate a file after the copy/voice pass and the file's
// owning run have released it. PURE data.

export type SurfaceState = 'pending' | 'migrated' | 'complete';

export interface Surface {
  id: string;
  phase: 0 | 1 | 2 | 3 | 4;
  state: SurfaceState;
  /** EXACT keys this surface owns (beats any prefix). The seed surfaces only. */
  keys?: string[];
  /** Key prefixes this surface owns; the longest matching prefix wins. */
  keyPrefixes: string[];
  /** Repo-relative screen/component files that render it (raw-literal rule once migrated). */
  files: string[];
  /** Files that also hold strings of later phases: never under the raw-literal rule. */
  partialFiles?: string[];
  /** The lane that migrates it (report only). */
  lane?: string;
}

export const SURFACES: Surface[] = [
  // Phase 0 — the seed catalog (i18n/catalog/en/seed.ts). Complete: every seed
  // key has reviewed-draft Spanish. Owned by EXACT key, not by prefix.
  {
    id: 'seed.nav',
    phase: 0,
    state: 'complete',
    keys: [
      'nav.tab.home', 'nav.tab.yourProjects', 'nav.tab.summary', 'nav.tab.discover', 'nav.tab.settings',
      'nav.tab.mageIdBids', 'nav.tab.field', 'nav.tab.schedule', 'nav.tab.money', 'nav.section.thisJob',
      'nav.section.planning', 'nav.section.fieldOps', 'nav.section.financials', 'nav.section.client',
      'nav.section.workspace', 'nav.section.business', 'nav.item.overview', 'nav.item.schedule',
      'nav.item.dailyReports', 'nav.item.rfis', 'nav.item.submittals', 'nav.item.changeOrders', 'nav.item.invoices',
      'nav.item.punchList', 'nav.item.estimate', 'nav.item.plans', 'nav.item.tmTickets', 'nav.item.timeTracking',
      'nav.item.photoTriage', 'nav.item.safety', 'nav.item.deliveries', 'nav.item.equipment',
      'nav.item.tomorrowLineup', 'nav.item.projects', 'nav.item.summary', 'nav.item.inbox', 'nav.item.askMage',
      'nav.item.subs', 'nav.item.contacts', 'nav.item.crew', 'nav.item.settings',
    ],
    keyPrefixes: [],
    files: [],
  },
  {
    id: 'seed.settings-language',
    phase: 0,
    state: 'complete',
    keyPrefixes: ['settings.language.'],
    files: ['components/LanguagePicker.tsx', 'app/(tabs)/settings/language.tsx'],
  },
  {
    id: 'seed.vocabulary',
    phase: 0,
    state: 'complete',
    keys: [
      'common.action.save', 'common.action.cancel', 'common.action.done', 'common.action.next', 'common.action.back',
      'common.action.add', 'common.action.edit', 'common.action.delete', 'common.action.remove',
      'common.action.send', 'common.action.share', 'common.action.approve', 'common.action.reject',
      'common.action.sign', 'common.action.search', 'common.action.filter', 'common.action.sort',
      'common.action.takePhoto', 'common.action.upload', 'common.action.download', 'common.action.retry',
      'common.action.undo', 'common.action.close', 'common.action.open', 'common.day.today', 'common.day.tomorrow',
      'common.day.yesterday', 'common.sync.offlineSaved', 'common.error.saveFailed', 'common.count.items',
      'common.count.daysAgo', 'ai.label.draftCheck', 'ai.label.translatedFromEnglish',
      'ai.label.translatedFromSpanish', 'ai.label.showOriginal', 'ai.label.estimatedNoLearned', 'field.dfr.title',
      'field.dfr.pdfTitle', 'field.dfr.weather', 'field.dfr.workersOnSite', 'field.dfr.hoursWorked',
      'field.dfr.materialsReceived', 'field.dfr.workProgress', 'field.dfr.delays', 'field.dfr.notes',
      'field.dfr.noActivity', 'field.weather.simulated', 'field.weather.delay', 'field.punch.title',
      'field.punch.item', 'field.punch.addItem', 'field.punch.status.open', 'field.punch.status.inProgress',
      'field.punch.status.readyForReview', 'field.punch.status.closed', 'field.punch.assignedTo',
      'field.punch.openCount', 'field.time.clockIn', 'field.time.clockOut', 'field.time.timeCard',
      'field.time.overtime', 'field.time.break', 'field.time.lunch', 'field.time.shift', 'field.time.hoursToday',
      'field.delivery.title', 'field.delivery.supplier', 'field.delivery.receivedBy', 'field.delivery.promisedDate',
      'field.delivery.whatWasWrong', 'field.delivery.ticket', 'field.photo.title', 'field.photo.walk',
      'field.photo.count', 'field.lineup.title', 'field.lineup.send', 'field.crew.title', 'field.crew.foreman',
      'field.crew.crewLead', 'field.crew.superintendent', 'field.crew.laborer', 'field.crew.helper',
      'field.crew.workerCount', 'field.ticket.title', 'field.inspection.title', 'field.inspection.status.scheduled',
      'field.inspection.status.passed', 'field.inspection.status.failed', 'field.inspection.status.cancelled',
      'safety.title', 'safety.jha.title', 'safety.jha.hazard', 'safety.jha.control', 'safety.jha.addHazard',
      'safety.toolbox.title', 'safety.toolbox.presenter', 'safety.toolbox.attendees', 'safety.toolbox.attendeeCount',
      'safety.ppe', 'safety.fallProtection', 'safety.competentPerson', 'safety.lockoutTagout',
      'safety.incident.title', 'safety.incident.injury', 'safety.incident.nearMiss', 'safety.incident.firstAid',
      'safety.incident.correctiveAction', 'safety.incident.investigating', 'safety.cert.status.current',
      'safety.cert.status.expiringSoon', 'safety.cert.status.expired', 'outbound.lineup.subject',
      'outbound.lineup.confirmAsk',
    ],
    keyPrefixes: [],
    files: [],
  },

  // Phase 1 — the foreman's day. Pending until each lane migrates it; the
  // orchestrator flips states after a phase, from the lanes' reports.
  {
    id: 'field.daily-report', phase: 1, state: 'migrated', keyPrefixes: ['field.dfr.'], lane: 'W2 ESTOOLS (DailyLogCard) then W3 ESDFR',
    files: ['app/daily-report.tsx', 'components/AIDailyReportGen.tsx', 'components/AIDFRFromPhotos.tsx', 'components/home/DailyLogCard.tsx', 'utils/dailyLogCompletion.ts'],
  },
  {
    id: 'field.safety', phase: 1, state: 'migrated', keyPrefixes: ['safety.'], lane: 'W2 ESSAFETY',
    files: [
      'app/safety.tsx', 'app/safety-jha.tsx', 'app/safety-toolbox.tsx', 'app/safety-incidents.tsx',
      'app/safety-hazards.tsx', 'app/safety-inspections.tsx', 'app/safety-certifications.tsx',
      'app/safety-forms.tsx', 'app/safety-osha.tsx',
      // The safety screens' helpers that call t() (W2 ESSAFETY): every file
      // with a call site maps to one surface (validate-i18n G8).
      'utils/safety/osha.ts', 'utils/safety/crewCerts.ts', 'utils/safety/safetyRefresh.ts',
    ],
  },
  {
    id: 'field.time-clock', phase: 1, state: 'migrated', keyPrefixes: ['field.time.'], lane: 'W3 ESCLOCK',
    files: ['app/time-tracking.tsx'],
    // W3 ESCLOCK: the time clock's display-string builders take a trailing `lang`.
    partialFiles: ['utils/moments/sites/fieldCopy.ts', 'utils/crewClockBatch.ts', 'utils/timeClockPayroll.ts'],
  },
  { id: 'field.punch', phase: 1, state: 'migrated', keyPrefixes: ['field.punch.'], lane: 'W3 ESCLOCK', files: ['app/punch-list.tsx', 'app/ai-punch.tsx'] },
  {
    id: 'field.punch-walk', phase: 1, state: 'migrated', keyPrefixes: ['field.punchWalk.'], lane: 'W3 ESTICKET',
    files: [
      'app/punch-walk.tsx', 'app/punch-pin.tsx', 'components/punch/PinQueueCard.tsx', 'components/punch/PlanPinStep.tsx',
      'components/punch/PunchEditPanes.tsx', 'components/punch/PunchExportSheet.tsx', 'components/punch/PunchPhotoViewer.tsx',
    ],
  },
  {
    id: 'field.ticket', phase: 1, state: 'migrated', keyPrefixes: ['field.ticket.'], lane: 'W3 ESTICKET',
    files: ['app/field-ticket.tsx'],
    partialFiles: ['utils/moments/sites/signingCopy.ts'],
  },
  { id: 'field.crew', phase: 1, state: 'migrated', keyPrefixes: ['field.crew.'], lane: 'W3 ESTICKET', files: ['app/crew.tsx', 'app/claim-crew.tsx'] },
  {
    id: 'field.lineup', phase: 1, state: 'migrated', keyPrefixes: ['field.lineup.', 'outbound.lineup.'], lane: 'W3 ESSHELL',
    files: ['app/tomorrow-lineup.tsx', 'utils/lineupTexts.ts', 'utils/tomorrowLineup.ts', 'utils/lineupReminder.ts', 'utils/tomorrowBlock.ts'],
  },
  {
    id: 'field.home', phase: 1, state: 'migrated', keyPrefixes: ['field.home.'], lane: 'W3 ESSHELL',
    files: ['components/QuickFieldUpdate.tsx'],
    partialFiles: ['app/(tabs)/(home)/index.tsx'],
  },
  {
    id: 'field.shell', phase: 1, state: 'migrated', keyPrefixes: ['nav.tab.', 'nav.title.'], lane: 'W3 ESSHELL',
    files: ['app/(tabs)/_layout.tsx'],
    partialFiles: ['app/_layout.tsx'],
  },
  {
    id: 'field.chrome', phase: 1, state: 'migrated', keyPrefixes: ['field.chrome.'], lane: 'W2 ESTOOLS (voice/offline) + W3 ESSHELL',
    files: [
      'components/OfflineSyncPill.tsx', 'components/VoiceBacklogSheet.tsx', 'components/VoiceRecorder.tsx', 'components/VoiceCaptureModal.tsx',
      'components/DatePickerModal.tsx', 'components/PhotoCapture.tsx', 'components/SignaturePad.tsx',
    ],
  },
  { id: 'common.errors', phase: 1, state: 'pending', keyPrefixes: ['common.error.'], lane: 'W2 ESTOOLS', files: ['utils/errorCopy.ts'] },
  {
    id: 'common.moments', phase: 1, state: 'pending', keyPrefixes: ['common.moment.'], lane: 'W2 ESTOOLS',
    files: [
      'utils/moments/copy.ts', 'utils/moments/commitResult.ts', 'utils/moments/commitAdapters.ts', 'utils/moments/sealText.ts',
      'components/moments/SlideToConfirm.tsx',
      'components/moments/signing/CeremonyDocTop.tsx', 'components/moments/signing/ConsentRow.tsx',
      'components/moments/signing/HandoffTurn.tsx', 'components/moments/signing/LetterFold.tsx',
      'components/moments/signing/SealArc.tsx', 'components/moments/signing/SealStamp.tsx',
      'components/moments/signing/SignatureInk.tsx', 'components/moments/signing/SignatureLine.tsx',
      'components/moments/signing/SigningCeremony.tsx',
    ],
  },

  // Phase 1c — registered now so no key ever lands unassigned; migrated next wave.
  {
    id: 'field.deliveries', phase: 1, state: 'pending', keyPrefixes: ['field.delivery.'], lane: 'next wave',
    files: ['app/deliveries.tsx', 'app/material-receipt.tsx', 'components/registers/DeliveriesRegister.tsx'],
  },
  { id: 'field.photos', phase: 1, state: 'pending', keyPrefixes: ['field.photo.'], lane: 'next wave', files: ['app/photo-triage.tsx', 'app/photo-annotator.tsx', 'app/shared-photos.tsx'] },
  { id: 'field.voice', phase: 1, state: 'pending', keyPrefixes: ['field.voice.'], lane: 'next wave', files: ['components/UniversalMicButton.tsx'] },
  { id: 'desk.sidebar', phase: 1, state: 'pending', keyPrefixes: ['nav.item.', 'nav.section.'], lane: 'next wave', files: ['components/DesktopSidebar.tsx'] },
  { id: 'desk.crew-register', phase: 1, state: 'pending', keyPrefixes: ['field.crewRegister.'], lane: 'next wave', files: ['components/registers/CrewRegister.tsx'] },
];

/** The id of the English shard file a surface's generated keys live in. */
export function shardFileOf(surfaceId: string): string {
  return `i18n/catalog/en/${surfaceId}.generated.ts`;
}

export const UNASSIGNED_SHARD = 'i18n/catalog/en/unassigned.generated.ts';

/** Seed surfaces keep their keys in the hand-kept seed (en/seed.ts), not in a generated shard. */
export function isSeedSurface(s: Pick<Surface, 'id'>): boolean {
  return s.id.startsWith('seed.');
}

export type KeyOwner =
  | { kind: 'owned'; surface: string; by: 'key' | 'prefix' }
  | { kind: 'none' }
  | { kind: 'conflict'; surfaces: string[]; by: 'key' | 'prefix' };

/**
 * The ONE owner of a key: the surface whose `keys` lists it, else the surface
 * with the longest matching prefix. Two at the same precedence = conflict.
 */
export function ownerOfKey(key: string, surfaces: readonly Surface[] = SURFACES): KeyOwner {
  const exact = surfaces.filter((s) => s.keys?.includes(key));
  if (exact.length === 1) return { kind: 'owned', surface: exact[0].id, by: 'key' };
  if (exact.length > 1) return { kind: 'conflict', surfaces: exact.map((s) => s.id), by: 'key' };
  let best = -1;
  let at: string[] = [];
  for (const s of surfaces) {
    for (const p of s.keyPrefixes) {
      if (!key.startsWith(p)) continue;
      if (p.length > best) { best = p.length; at = [s.id]; }
      else if (p.length === best && !at.includes(s.id)) at.push(s.id);
    }
  }
  if (at.length === 1) return { kind: 'owned', surface: at[0], by: 'prefix' };
  if (at.length > 1) return { kind: 'conflict', surfaces: at, by: 'prefix' };
  return { kind: 'none' };
}

/** The surface a repo-relative file belongs to (files or partialFiles), or null. */
export function surfaceOfFile(file: string, surfaces: readonly Surface[] = SURFACES): { surface: Surface; partial: boolean } | null {
  for (const s of surfaces) {
    if (s.files.includes(file)) return { surface: s, partial: false };
    if (s.partialFiles?.includes(file)) return { surface: s, partial: true };
  }
  return null;
}

/** A key with a `.legal.` segment is LEGAL-PINNED: Spanish only from a human legal translator. */
export function isLegalKey(key: string): boolean {
  return /\.legal\./.test(key);
}
