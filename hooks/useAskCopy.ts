// hooks/useAskCopy.ts — the ONLY place new Ask MAGE strings live (lanes AIDO
// and AILOOK). Every string goes through t('ai.ask.*', english, vars) so the
// i18n registry stays in one file (surface 'ai.ask', docs/I18N.md §3). AILOOK
// imports this; it adds no t() keys of its own. Lane ATTASK adds the `files`
// block (MAGE reads a photo, a PDF or a plan page); the portal sheet reads it
// too.
//
// Copy per docs/VOICE.md: sentence case, no exclamation marks, no emoji.
// Never call t() at module scope: the object is rebuilt when the language
// changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import type { AskActionProposal } from '@/utils/oneMind/askAction';

export interface AskCopy {
  // ── lane AIDO: the do-it card ──
  /** The assistant line above the card: one workflow or several. */
  actionLead: (count: number) => string;
  howtoTitle: string;
  forJob: (job: string) => string;
  pickJobNext: string;
  honesty: string;
  start: string;
  startA11y: (label: string) => string;
  answerInstead: string;
  estimateFirst: string;
  pickTitle: string;
  scheduleLeaves: string;
  opened: (label: string) => string;
  saved: (label: string) => string;
  savedNoLabel: string;
  nothing: string;
  openAgain: string;
  openResult: string;
  /** The workflow's name on the card (a key where one exists, else its label). */
  label: (p: Pick<AskActionProposal, 'capabilityId' | 'label'>) => string;
  // ── lane AILOOK: the Ask surface ──
  lookTitle: string;
  lookPlaceholder: string;
  lookThinking: string;
  lookStillThinking: string;
  lookThinkingA11y: string;
  lookSendHintEmpty: string;
  lookSendHintBusy: string;
  lookJumpLatest: string;
  lookSources: string;
  lookEmptyTitle: string;
  lookEmptyHint: string;
  // ── lane ATTASK: MAGE reads a photo, a PDF or a plan page ──
  // Also read by the portal sheet (components/messages/MessageAiSheet), so a
  // failed read is worded once. No limit is typed into a string: every number
  // is a variable filled from utils/askFilesCore.
  files: {
    attachA11y: string;
    menuTitle: string;
    menuTakePhoto: string;
    menuChoosePhotos: string;
    menuChoosePdf: string;
    menuChooseFiles: string;
    menuPlanPage: string;
    menuPlanPageNoJob: string;
    menuPlanPageNotOwner: string;
    /** The role check completed and he has no seat on the job. No "try again": a retry gives the same answer. */
    menuPlanPageNotOnJob: string;
    menuPlanPageChecking: string;
    /** The role check did not complete (a failed read, or one waiting for a network). */
    menuPlanPageUnknown: string;
    lockedTitle: string;
    lockedBody: string;
    lockedNotNow: string;
    lockedSeePlans: string;
    planTitle: string;
    planBack: string;
    planEmpty: string;
    planOlder: (count: number) => string;
    planPickA11y: (name: string) => string;
    trayPlanLabel: string;
    trayRemoveA11y: (name: string) => string;
    trayNote: string;
    placeholder: string;
    sendHint: string;
    thinking: string;
    thinkingA11y: string;
    /** The alert's title when more than one picked file is refused (or one sentence is too long for a toast). */
    refuseTitle: string;
    fileFallback: string;
    refuseType: (name: string) => string;
    refuseEmpty: (name: string) => string;
    refuseCount: (count: number) => string;
    refuseSize: (name: string, size: string, mb: number) => string;
    refuseTotal: (size: string, mb: number) => string;
    refusePages: (name: string, pages: number, limit: number) => string;
    refusePdfUnreadable: (name: string) => string;
    refuseCameraDenied: string;
    refusePhotosDenied: string;
    errOffline: string;
    errOfflineKept: string;
    errTimeout: string;
    errNetwork: string;
    errPlan: string;
    errDaily: (reset: string) => string;
    errDailyUpgrade: string;
    errUnavailable: string;
    errTooLarge: (name: string, mb: number) => string;
    errTooLargeTogether: (mb: number) => string;
    errUnreadable: (name: string) => string;
    errBlocked: string;
    errCutOff: string;
    errNoAnswer: string;
    errService: string;
    errSignIn: string;
    errOff: string;
    errGeneric: string;
    /** Ask's own cut-short line: Ask has a question to narrow. The portal sheet has none and
     *  says its own (useMessageAttachmentCopy().ai.truncated). */
    truncated: string;
    codeWithheld: string;
    readTitle: string;
    readPhoto: string;
    readPlan: string;
    readPdf: (count: number) => string;
    readPdfNoCount: string;
    readCaution: string;
    readPartial: string;
    readA11y: (count: number) => string;
  };
}

export function useAskCopy(): AskCopy {
  const { t, tn } = useT();
  return useMemo<AskCopy>(() => ({
    actionLead: (count: number) => (count === 1
      ? t('ai.ask.action.lead.one', 'I can do that.')
      : t('ai.ask.action.lead.many', 'I can do these. Start each one when you\'re ready.')),
    howtoTitle: t('ai.ask.action.howtoTitle', 'Want me to do it?'),
    forJob: (job: string) => t('ai.ask.action.forJob', 'For {job}', { job }),
    pickJobNext: t('ai.ask.action.pickJobNext', 'You\'ll pick the job next'),
    honesty: t('ai.ask.action.honesty', 'From what you typed. Nothing is saved until you check it and tap Build it.'),
    start: t('ai.ask.action.start', 'Start'),
    startA11y: (label: string) => t('ai.ask.action.startA11y', 'Start {label}', { label }),
    answerInstead: t('ai.ask.action.answerInstead', 'Answer Instead'),
    estimateFirst: t('ai.ask.action.estimateFirst', 'Build the Estimate'),
    pickTitle: t('ai.ask.action.pickTitle', 'Which job?'),
    scheduleLeaves: t('ai.ask.action.scheduleLeaves', 'Opens the schedule. Ask closes on this phone.'),
    opened: (label: string) => t('ai.ask.action.opened', 'Opened {label}', { label }),
    saved: (label: string) => t('ai.ask.action.saved', 'Saved: {label}', { label }),
    savedNoLabel: t('ai.ask.action.savedNoLabel', 'Saved'),
    nothing: t('ai.ask.action.nothing', 'Nothing was saved.'),
    openAgain: t('ai.ask.action.openAgain', 'Open Again'),
    openResult: t('ai.ask.action.openResult', 'Open'),
    label: (p) => (p.capabilityId === 'estimateEdit'
      ? t('ai.ask.action.label.estimateEdit', 'Change the Estimate')
      : p.label),
    lookTitle: t('ai.ask.look.title', 'Ask MAGE'),
    lookPlaceholder: t('ai.ask.look.placeholder', 'Ask a question or say what to do'),
    lookThinking: t('ai.ask.look.thinking', 'Reading your records'),
    lookStillThinking: t('ai.ask.look.stillThinking', 'Still working on it'),
    lookThinkingA11y: t('ai.ask.look.thinkingA11y', 'MAGE is reading your records'),
    lookSendHintEmpty: t('ai.ask.look.sendHintEmpty', 'Type a question to send'),
    lookSendHintBusy: t('ai.ask.look.sendHintBusy', 'Wait for the answer to finish'),
    lookJumpLatest: t('ai.ask.look.jumpLatest', 'Jump to Latest'),
    lookSources: t('ai.ask.look.sources', 'Sources'),
    lookEmptyTitle: t('ai.ask.look.emptyTitle', 'What do you need?'),
    lookEmptyHint: t('ai.ask.look.emptyHint', 'Ask about your jobs, or tell MAGE to start something, like a daily report or a schedule.'),
    files: {
      attachA11y: t('ai.ask.files.attach.a11y', 'Attach a photo, PDF or plan page'),
      menuTitle: t('ai.ask.files.menu.title', 'Add to Your Question'),
      menuTakePhoto: t('ai.ask.files.menu.takePhoto', 'Take Photo'),
      menuChoosePhotos: t('ai.ask.files.menu.choosePhotos', 'Choose Photos'),
      menuChoosePdf: t('ai.ask.files.menu.choosePdf', 'Choose a PDF'),
      menuChooseFiles: t('ai.ask.files.menu.chooseFiles', 'Choose Photos or PDFs'),
      menuPlanPage: t('ai.ask.files.menu.planPage', 'Plan Page'),
      menuPlanPageNoJob: t('ai.ask.files.menu.planPageNoJob', 'Open Ask from a job to pick one of its plan pages.'),
      menuPlanPageNotOwner: t('ai.ask.files.menu.planPageNotOwner', 'Only the account that owns this job can attach its plan pages.'),
      menuPlanPageNotOnJob: t('ai.ask.files.menu.planPageNotOnJob', 'You are not on this job, so its plan pages can\'t be read here.'),
      menuPlanPageChecking: t('ai.ask.files.menu.planPageChecking', 'Checking your access to this job.'),
      menuPlanPageUnknown: t('ai.ask.files.menu.planPageUnknown', 'MAGE couldn\'t check your access to this job. Try again in a minute.'),
      lockedTitle: t('ai.ask.files.locked.title', 'Reading files is on the Pro plan'),
      lockedBody: t('ai.ask.files.locked.body', 'On Pro, MAGE reads the photos, PDFs and plan pages you attach. Each read counts as one of your monthly photo analyses.'),
      lockedNotNow: t('ai.ask.files.locked.notNow', 'Not Now'),
      lockedSeePlans: t('ai.ask.files.locked.seePlans', 'See Plans'),
      planTitle: t('ai.ask.files.plan.title', 'Pick a Plan Page'),
      planBack: t('ai.ask.files.plan.back', 'Back'),
      planEmpty: t('ai.ask.files.plan.empty', 'No plan pages on this job that MAGE can read yet. Add them in Plans.'),
      planOlder: (count: number) => tn('ai.ask.files.plan.older', count, {
        one: '1 older page is not listed. Import it again in Plans to ask about it.',
        other: '{count} older pages are not listed. Import them again in Plans to ask about them.',
      }),
      planPickA11y: (name: string) => t('ai.ask.files.plan.pickA11y', 'Attach {name}', { name }),
      trayPlanLabel: t('ai.ask.files.tray.planLabel', 'Plan Page'),
      trayRemoveA11y: (name: string) => t('ai.ask.files.tray.remove.a11y', 'Remove {name}', { name }),
      trayNote: t('ai.ask.files.tray.note', 'MAGE reads these files again with each question, and each read counts.'),
      placeholder: t('ai.ask.files.placeholder', 'Ask about these files'),
      sendHint: t('ai.ask.files.sendHint', 'Type a question about the files to send'),
      thinking: t('ai.ask.files.thinking', 'Reading your files'),
      thinkingA11y: t('ai.ask.files.thinkingA11y', 'MAGE is reading your files'),
      refuseTitle: t('ai.ask.files.refuse.title', 'Not Attached'),
      fileFallback: t('ai.ask.files.fileFallback', 'One of the files'),
      refuseType: (name: string) => t('ai.ask.files.refuse.type', '{name} can\'t be read. Attach a photo (JPG, PNG or WebP) or a PDF.', { name }),
      refuseEmpty: (name: string) => t('ai.ask.files.refuse.empty', '{name} is empty, so there is nothing to read.', { name }),
      refuseCount: (count: number) => t('ai.ask.files.refuse.count', 'MAGE reads up to {count} files at a time.', { count }),
      refuseSize: (name: string, size: string, mb: number) => t('ai.ask.files.refuse.size', '{name} is {size}. Files from this device can be up to {mb} MB in one question.', { name, size, mb }),
      refuseTotal: (size: string, mb: number) => t('ai.ask.files.refuse.total', 'These files are {size} together. One question can carry up to {mb} MB from this device. Remove one and send again.', { size, mb }),
      refusePages: (name: string, pages: number, limit: number) => t('ai.ask.files.refuse.pages', '{name} has {pages} pages. MAGE reads PDFs up to {limit} pages. Send the pages you need as a shorter PDF or as photos.', { name, pages, limit }),
      refusePdfUnreadable: (name: string) => t('ai.ask.files.refuse.pdfUnreadable', '{name} could not be opened. If it has a password, save a copy without one and attach that.', { name }),
      refuseCameraDenied: t('ai.ask.files.refuse.cameraDenied', 'MAGE ID needs camera access to take a photo. Turn it on in Settings.'),
      refusePhotosDenied: t('ai.ask.files.refuse.photosDenied', 'MAGE ID needs photo access to attach a photo. Turn it on in Settings.'),
      errOffline: t('ai.ask.files.err.offline', 'You\'re offline. MAGE needs a connection to read files.'),
      errOfflineKept: t('ai.ask.files.err.offlineKept', 'Your files are still attached.'),
      errTimeout: t('ai.ask.files.err.timeout', 'Reading the files took too long. Try again, or send fewer files.'),
      errNetwork: t('ai.ask.files.err.network', 'MAGE couldn\'t reach the server. Check your connection and try again.'),
      errPlan: t('ai.ask.files.err.plan', 'Reading files is on the Pro plan.'),
      errDaily: (reset: string) => t('ai.ask.files.err.daily', 'You\'ve used today\'s advanced AI calls. {reset}.', { reset }),
      errDailyUpgrade: t('ai.ask.files.err.dailyUpgrade', 'Today\'s advanced AI calls are used up. More are on a higher plan. Opening plans.'),
      errUnavailable: t('ai.ask.files.err.unavailable', 'That file isn\'t available to read on this account.'),
      errTooLarge: (name: string, mb: number) => t('ai.ask.files.err.tooLarge', '{name} is too large for MAGE to read. The limit is {mb} MB.', { name, mb }),
      errTooLargeTogether: (mb: number) => t('ai.ask.files.err.tooLargeTogether', 'These files are too large to read together. The limit is {mb} MB. Send fewer files.', { mb }),
      errUnreadable: (name: string) => t('ai.ask.files.err.unreadable', '{name} could not be read. It may be damaged, locked with a password, or not the type it says it is.', { name }),
      errBlocked: t('ai.ask.files.err.blocked', 'The AI service declined to read these files. This read was not counted.'),
      errCutOff: t('ai.ask.files.err.cutOff', 'MAGE ran out of room before it could answer. Ask about fewer pages or ask a shorter question. This read was not counted.'),
      errNoAnswer: t('ai.ask.files.err.noAnswer', 'MAGE couldn\'t get an answer out of these files. Try a clearer photo or fewer pages. This read was counted.'),
      errService: t('ai.ask.files.err.service', 'The AI service didn\'t answer. Try again in a minute.'),
      errSignIn: t('ai.ask.files.err.signIn', 'Sign in to have MAGE read files.'),
      errOff: t('ai.ask.files.err.off', 'This isn\'t turned on yet.'),
      errGeneric: t('ai.ask.files.err.generic', 'Something went wrong reading the files. Try again.'),
      truncated: t('ai.ask.files.truncated', 'MAGE\'s answer stops partway. Try a narrower question.'),
      codeWithheld: t('ai.ask.files.codeWithheld', 'MAGE left out a part that read like building-code text. Read the section in the code itself.'),
      readTitle: t('ai.ask.files.read.title', 'What I Read'),
      readPhoto: t('ai.ask.files.read.photo', 'photo'),
      readPlan: t('ai.ask.files.read.plan', 'plan page'),
      readPdf: (count: number) => tn('ai.ask.files.read.pdf', count, { one: 'PDF, 1 page', other: 'PDF, {count} pages' }),
      readPdfNoCount: t('ai.ask.files.read.pdfNoCount', 'PDF'),
      readCaution: t('ai.ask.files.read.caution', 'AI reading. Check the original.'),
      readPartial: t('ai.ask.files.read.partial', 'MAGE may not have got through all of it.'),
      readA11y: (count: number) => tn('ai.ask.files.read.a11y', count, { one: 'MAGE read 1 file', other: 'MAGE read {count} files' }),
    },
  }), [t, tn]);
}
