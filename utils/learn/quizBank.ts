// utils/learn/quizBank.ts — the skills check for each of the fifteen topics.
// OWNER: LEARNBANK. Pure data: one `import type` and no runtime imports.
//
// WHAT A CHECK IS. Five questions about USING THE APP: where a thing is, what
// a control does, what happens on a sample, what a status means. Never code
// compliance, safety, licensing, trade technique, pricing judgement or law.
// It is "a short check on using the app" (CERT_SCOPE_NOTE), never an exam.
// The right answers ship in the bundle (the screen marks each answer at once),
// so the server's grading stops forged certificates, not someone reading the
// answers.
//
// DOCUMENTS LIE; CODE DOESN'T. Every question names the repo file and a literal
// (a testID, a constant or a user-facing string) whose presence makes its right
// answer true. scripts/validate-skill-quiz-bank.ts reads the file and fails
// when the literal is gone, so a renamed control fails the build instead of
// shipping a wrong answer. When a question changes, bump the topic's
// quizVersion in utils/learn/topics.ts AND `version` here, then regenerate the
// server key: bun run scripts/gen-skill-quiz-key.ts.
//
// COPY. Rendered from this data, never through t() (scripts/i18n-extract.ts
// fails a non-literal key). `key` / `whyKey` are catalog ids for a later i18n
// phase: 'settings.learn.quiz.<topic>.<qid>', '.<qid>.<choiceId>', '.<qid>.why'.
// docs/VOICE.md: sentence case, plain, American spelling, no emoji, "you" or
// "they" (never he/his), no developer words.

import type { QuizBank, QuizChoice, QuizQuestion, SkillTopicId } from './types';

type ChoiceSpec = readonly [id: 'a' | 'b' | 'c' | 'd', en: string];

interface QuestionSpec {
  id: 'q1' | 'q2' | 'q3' | 'q4' | 'q5';
  en: string;
  choices: readonly ChoiceSpec[];
  correctId: 'a' | 'b' | 'c' | 'd';
  why: string;
  source: { file: string; mustContain: string };
}

function bank(topic: SkillTopicId, version: number, specs: readonly QuestionSpec[]): QuizBank {
  const base = `settings.learn.quiz.${topic}` as const;
  const questions: QuizQuestion[] = specs.map(s => {
    const choices: QuizChoice[] = s.choices.map(([id, en]) => ({ id, en, key: `${base}.${s.id}.${id}` }));
    return {
      id: s.id,
      en: s.en,
      key: `${base}.${s.id}`,
      choices,
      correctId: s.correctId,
      why: s.why,
      whyKey: `${base}.${s.id}.why`,
      source: s.source,
    };
  });
  return { topic, version, questions };
}

const DFR = 'app/daily-report.tsx';
const WALK = 'app/punch-walk.tsx';
const INVOICE = 'app/invoice.tsx';
const DIFF = 'components/copilot/ScheduleDiffView.tsx';
const EDIT_PANEL = 'components/copilot/ScheduleEditPanel.tsx';
const WIZARD = 'app/estimate-wizard.tsx';
const TAKEOFF = 'app/takeoff.tsx';
const CAI_TAB = 'app/(tabs)/construction-ai/index.tsx';
const CAI_ASK = 'components/construction/AskConstructionMode.tsx';
const CO = 'app/change-order.tsx';
const AIA = 'app/aia-pay-app.tsx';
const TICKET = 'app/field-ticket.tsx';
const CLOCK = 'app/time-tracking.tsx';
const PUNCH = 'app/punch-list.tsx';
const ASK_PLANS = 'components/plans/AskPlansPanel.tsx';
const CONTRACT = 'app/contract.tsx';
const BINDER = 'app/closeout-binder.tsx';

export const QUIZ_BANKS: Record<SkillTopicId, QuizBank> = {
  'daily-report-voice': bank('daily-report-voice', 2, [
    {
      id: 'q1',
      en: 'On a sample job, where does a submitted daily report go?',
      choices: [['a', 'To the client on file'], ['b', 'Only to you, not a client'], ['c', 'Nowhere until you connect email']],
      correctId: 'b',
      why: "A sample job's report is locked to your own address, so nothing reaches a client.",
      source: { file: DFR, mustContain: 'this goes to you, not a client.' },
    },
    {
      id: 'q2',
      en: 'What does the Copy from button on a new report do?',
      choices: [['a', 'Fills today’s report from your last one'], ['b', 'Copies the report to another project'], ['c', 'Puts yesterday’s photos on today’s report']],
      correctId: 'a',
      why: 'It carries your last report’s crew, work and materials forward, so you only change what is new.',
      source: { file: DFR, mustContain: 'onPress={handleCarryForward}' },
    },
    {
      id: 'q3',
      en: 'Nothing happened on site today. What can you do?',
      choices: [['a', 'Skip the day and fill it in later'], ['b', 'Copy the last report and delete the crew'], ['c', 'File it as a no-work day with a reason']],
      correctId: 'c',
      why: 'A no-work day is saved with a reason and no crew or photos, so the record has no gap.',
      source: { file: DFR, mustContain: 'saved with no crew and no photos' },
    },
    {
      id: 'q4',
      en: 'How does the weather get onto a daily report?',
      choices: [['a', 'You type it, or say it in your voice note'], ['b', 'It is copied from the last report'], ['c', 'The app looks it up from a weather service']],
      correctId: 'a',
      why: 'You type what you saw, or say it in your voice note and it fills in. Copy from does not carry old weather forward.',
      source: { file: DFR, mustContain: "t('field.dfr.topic.weather', 'Weather on site')" },
    },
    {
      id: 'q5',
      en: 'After you submit a report, what can you still do with it?',
      choices: [['a', 'Edit the crew and submit it again'], ['b', 'Print or share its PDF'], ['c', 'Change its date']],
      correctId: 'b',
      why: 'A submitted report is read-only. You can still print or share the PDF.',
      source: { file: DFR, mustContain: "t('field.dfr.printSharePdf', 'Print / Share PDF')" },
    },
  ]),

  'punch-walk': bank('punch-walk', 1, [
    {
      id: 'q1',
      en: 'Which list is never shown to your client?',
      choices: [['a', 'The punch list'], ['b', 'The crew list'], ['c', 'Both lists, until you share them']],
      correctId: 'b',
      why: 'The crew list is internal. Punch items can be shown in the client portal.',
      source: { file: WALK, mustContain: 'Crew list, internal, never shown to your client' },
    },
    {
      id: 'q2',
      en: 'With Pin first on, what do you do first for each item?',
      choices: [['a', 'Take the photo'], ['b', 'Say what’s wrong'], ['c', 'Tap the spot on the plan']],
      correctId: 'c',
      why: 'Pin first means you tap the plan, then the camera opens.',
      source: { file: WALK, mustContain: 'Pin first is on: tap the plan before the photo' },
    },
    {
      id: 'q3',
      en: 'You save an item without picking a sub. What happens?',
      choices: [['a', 'It saves unassigned'], ['b', 'The save is blocked until you pick one'], ['c', 'It goes to the first sub on the project']],
      correctId: 'a',
      why: 'With no sub picked, the item saves unassigned. You can assign it later.',
      source: { file: WALK, mustContain: 'No sub · Saves unassigned' },
    },
    {
      id: 'q4',
      en: 'You save one item and start the next. What does Location show?',
      choices: [['a', 'It is blank again'], ['b', 'The room from the last item'], ['c', 'The room nearest your phone']],
      correctId: 'b',
      why: 'The room carries over from the last item, so a room-by-room walk takes fewer taps.',
      source: { file: WALK, mustContain: 'Carried from last item' },
    },
    {
      id: 'q5',
      en: 'You describe the problem out loud. What does the app pick from your words?',
      choices: [['a', 'The due date'], ['b', 'The trade'], ['c', 'The sub’s phone number']],
      correctId: 'b',
      why: 'It picks the trade from what you said. You can fix the trade later on the punch list.',
      source: { file: WALK, mustContain: 'inferTradeFromText' },
    },
  ]),

  'invoice-to-self': bank('invoice-to-self', 1, [
    {
      id: 'q1',
      en: 'On a sample job, what does Send to me do?',
      choices: [['a', 'Emails the client and makes a pay link'], ['b', 'Sends the invoice to you, with no pay link'], ['c', 'Saves it without sending anything']],
      correctId: 'b',
      why: 'A sample invoice goes only to you, so you see what a client gets. No pay link is made.',
      source: { file: 'utils/sampleGuard.ts', mustContain: 'this goes to you, not a client. No pay link is made.' },
    },
    {
      id: 'q2',
      en: 'On a progress invoice you type 15 in Billing percentage. It is 15% of what?',
      choices: [['a', 'The contract total'], ['b', 'What is left unbilled'], ['c', 'The last invoice’s amount']],
      correctId: 'a',
      why: 'The percentage is taken of the contract total shown beside the box.',
      source: { file: INVOICE, mustContain: '% of {formatCurrency(contractTotal)}' },
    },
    {
      id: 'q3',
      en: 'The invoice says Net 30 is the app default. What does that mean?',
      choices: [['a', 'Your client asked for 30 days'], ['b', 'The contract sets 30 days'], ['c', 'Your cash flow setup has no payment terms yet']],
      correctId: 'c',
      why: 'Set your terms in Cash Flow and new invoices use them instead.',
      source: { file: INVOICE, mustContain: 'Net 30 is the app default, not your setting' },
    },
    {
      id: 'q4',
      en: 'Your client paid by check. How do you show it on the invoice?',
      choices: [['a', 'Make a new pay link'], ['b', 'Record payment with the amount'], ['c', 'Send a reminder']],
      correctId: 'b',
      why: 'Record payment logs the money received against the invoice.',
      source: { file: INVOICE, mustContain: '>Record payment</Text>' },
    },
    {
      id: 'q5',
      en: 'A bank asks for a lien waiver after a payment. Where can you start one?',
      choices: [['a', 'Collect a lien waiver on the invoice'], ['b', 'Only from the contract screen'], ['c', 'From the daily report']],
      correctId: 'a',
      why: 'It opens a waiver already filled in with the invoice’s amount and through-date.',
      source: { file: INVOICE, mustContain: 'Generate the waiver pre-filled with this invoice' },
    },
  ]),

  'schedule-say-it': bank('schedule-say-it', 1, [
    {
      id: 'q1',
      en: 'You type a schedule change in plain words. When does the schedule actually change?',
      choices: [['a', 'As soon as you send it'], ['b', 'Only when you tap Apply'], ['c', 'Overnight, when it saves']],
      correctId: 'b',
      why: 'First you see the ripple of what moves. Nothing changes until you apply it.',
      source: { file: DIFF, mustContain: 'testID="schedule-edit-apply"' },
    },
    {
      id: 'q2',
      en: 'The ripple shows Finish +2d. What does that mean?',
      choices: [['a', 'Two tasks were added'], ['b', 'The change takes 2 days to apply'], ['c', 'The project finish moves 2 days later']],
      correctId: 'c',
      why: 'The finish line shows how far the end date moves, with the old and new day.',
      source: { file: DIFF, mustContain: 'Finish {dd(diff.finishDeltaDays)}' },
    },
    {
      id: 'q3',
      en: 'The ripple lists a task under Now critical. What does that tell you?',
      choices: [['a', 'A delay to that task now moves the finish date'], ['b', 'The task is late today'], ['c', 'The task was removed']],
      correctId: 'a',
      why: 'A task that turns critical now drives the finish date.',
      source: { file: DIFF, mustContain: 'Now critical: ' },
    },
    {
      id: 'q4',
      en: 'The ripple is not what you meant. What do you do?',
      choices: [['a', 'Apply it, then fix it by hand'], ['b', 'Ask again tomorrow'], ['c', 'Tap Not that and discard it']],
      correctId: 'c',
      why: 'Discard drops the proposal. The schedule stays as it was.',
      source: { file: DIFF, mustContain: 'Not that — discard' },
    },
    {
      id: 'q5',
      en: 'Right after you apply a change, what can Undo do?',
      choices: [['a', 'Undo every change made this week'], ['b', 'Put the schedule back, if nothing changed since'], ['c', 'Nothing, applied changes are final']],
      correctId: 'b',
      why: 'Undo restores the schedule from before the change, unless it was changed again since.',
      source: { file: EDIT_PANEL, mustContain: 'Undone. The schedule is back to how it was.' },
    },
  ]),

  'estimate-first': bank('estimate-first', 1, [
    {
      id: 'q1',
      en: 'The result says This number is your cost. What does that mean?',
      choices: [['a', 'Your markup is already included'], ['b', 'No markup is set, so nothing is on top of cost'], ['c', 'It is a rough guess you cannot change']],
      correctId: 'b',
      why: 'Set what you charge on top and the price carries your overhead and profit.',
      source: { file: WIZARD, mustContain: 'This number is your cost' },
    },
    {
      id: 'q2',
      en: 'You set a 20% markup. What does the wizard show beside it?',
      choices: [['a', 'The gross margin that markup gives you'], ['b', 'Your client’s budget'], ['c', 'Sales tax on the total']],
      correctId: 'a',
      why: 'Markup on cost and gross margin are different numbers, so it shows both.',
      source: { file: WIZARD, mustContain: '% gross margin' },
    },
    {
      id: 'q3',
      en: 'Contingency shows your default in Settings. Where does that rate come from?',
      choices: [['a', 'MAGE picks it for each estimate'], ['b', 'Your client’s request'], ['c', 'Your own Settings']],
      correctId: 'c',
      why: 'The contingency rate is your default from Settings, and you can change it there.',
      source: { file: WIZARD, mustContain: '(your default in Settings)' },
    },
    {
      id: 'q4',
      en: 'Payment terms say not set yet. When will you be asked for them?',
      choices: [['a', 'Never, they stay blank'], ['b', 'Before this goes to your client'], ['c', 'When the client pays']],
      correctId: 'b',
      why: 'The app asks for your terms before the estimate goes to a client.',
      source: { file: WIZARD, mustContain: 'be asked before this goes to your client' },
    },
    {
      id: 'q5',
      en: 'What does Build by voice instead do?',
      choices: [['a', 'Reads the estimate out loud'], ['b', 'Saves a voice memo on the project'], ['c', 'You say the scope and MAGE prices it from your past jobs']],
      correctId: 'c',
      why: 'It opens a voice build where MAGE prices what you say from your past jobs.',
      source: { file: WIZARD, mustContain: 'MAGE prices it from your past jobs' },
    },
  ]),

  'takeoff-to-estimate': bank('takeoff-to-estimate', 1, [
    {
      id: 'q1',
      en: 'What do you upload to start a takeoff?',
      choices: [['a', 'A drawings PDF, up to 16 pages'], ['b', 'A photo of the site'], ['c', 'A spreadsheet of quantities']],
      correctId: 'a',
      why: 'The takeoff reads dimensions, schedules and callouts from a drawings PDF of up to 16 pages.',
      source: { file: TAKEOFF, mustContain: 'Up to 16 pages' },
    },
    {
      id: 'q2',
      en: 'You change a count by hand. What does the row show?',
      choices: [['a', 'Nothing, it looks the same'], ['b', 'An edited tag and a Reset to AI link'], ['c', 'A warning that the count is wrong']],
      correctId: 'b',
      why: 'Edited rows are tagged, and Reset to AI puts the original count back.',
      source: { file: TAKEOFF, mustContain: 'Reset to AI' },
    },
    {
      id: 'q3',
      en: 'A row lists pages like pp. 3. What does tapping them do?',
      choices: [['a', 'Prints the page'], ['b', 'Removes the page from the set'], ['c', 'Opens that drawing page']],
      correctId: 'c',
      why: 'The page link opens the drawing the count came from, so you can check it.',
      source: { file: TAKEOFF, mustContain: 'onInspectPage(sourcePages[0])' },
    },
    {
      id: 'q4',
      en: 'What does Clean up low-confidence rows let you do?',
      choices: [['a', 'Run the whole takeoff again for free'], ['b', 'Drop rows you don’t trust, and restore them later'], ['c', 'Send the rows to a sub']],
      correctId: 'b',
      why: 'Dropping weak rows keeps them out of your buyout. Restore all brings them back.',
      source: { file: TAKEOFF, mustContain: 'Restore all' },
    },
    {
      id: 'q5',
      en: 'The counts look right. Which button turns them into estimate lines?',
      choices: [['a', 'Convert to estimate'], ['b', 'Run again'], ['c', 'Generate sub-trade buyout packages']],
      correctId: 'a',
      why: 'Convert to estimate carries the counts into an estimate.',
      source: { file: TAKEOFF, mustContain: '>Convert to estimate</Text>' },
    },
  ]),

  'construction-ai-ask': bank('construction-ai-ask', 1, [
    {
      id: 'q1',
      en: 'Which Construction AI mode takes a question in your own words?',
      choices: [['a', 'Plan review'], ['b', 'Project roadmap'], ['c', 'Ask']],
      correctId: 'c',
      why: 'Ask answers what you type. The other modes each run their own flow.',
      source: { file: CAI_TAB, mustContain: 'testID="mode-toggle-ask"' },
    },
    {
      id: 'q2',
      en: 'Under an answer, what is the difference between Sources and Also checked?',
      choices: [['a', 'They mean the same thing'], ['b', 'Sources back the answer. Also checked were read, not used'], ['c', 'Also checked are paid sources']],
      correctId: 'b',
      why: 'Only Sources are what the answer rests on.',
      source: { file: CAI_ASK, mustContain: 'Also checked' },
    },
    {
      id: 'q3',
      en: 'You link a project before asking. What gets added to your question?',
      choices: [['a', 'That project’s building record, once it loads'], ['b', 'Every email about the project'], ['c', 'Nothing, linking is only a label']],
      correctId: 'a',
      why: 'With a project linked, its building record is added to your question when it loads.',
      source: { file: CAI_ASK, mustContain: 'It is added to your question once it loads.' },
    },
    {
      id: 'q4',
      en: 'Which sources under an answer open when you tap them?',
      choices: [['a', 'None of them'], ['b', 'Web links and plan sheets'], ['c', 'Only the first source']],
      correctId: 'b',
      why: 'Web and plan sources open on tap. The others are listed for reference.',
      source: { file: CAI_ASK, mustContain: "(c.kind === 'plan' && !!c.ref)" },
    },
    {
      id: 'q5',
      en: 'Which plan includes Construction AI answers?',
      choices: [['a', 'Free'], ['b', 'Pro'], ['c', 'Business']],
      correctId: 'c',
      why: 'Construction answers come with the Business plan.',
      source: { file: CAI_ASK, mustContain: 'Construction answers are on the Business plan.' },
    },
  ]),

  'change-order-draft': bank('change-order-draft', 1, [
    {
      id: 'q1',
      en: 'You saved a change order with Save to Project. Where is it now?',
      choices: [['a', 'Emailed to the client for signature'], ['b', 'In the project’s change orders as a draft, not sent'], ['c', 'Added to the next invoice automatically']],
      correctId: 'b',
      why: 'Save to Project keeps it as a draft. Sending is a separate step.',
      source: { file: CO, mustContain: "withConfirmedImpactDays(() => handleSave('draft'))" },
    },
    {
      id: 'q2',
      en: 'What goes in the schedule impact field?',
      choices: [['a', 'Days the change adds to the project, 0 if none'], ['b', 'The date the work starts'], ['c', 'Hours your crew will spend']],
      correctId: 'a',
      why: 'It is the number of days the change adds. Enter 0 when it adds none.',
      source: { file: CO, mustContain: 'Additional days added to project (0 if none)' },
    },
    {
      id: 'q3',
      en: 'The days field says AI estimate: +3 days. What should you do?',
      choices: [['a', 'Nothing, AI numbers are final'], ['b', 'Clear it so the client decides'], ['c', 'Check it before sending, since it’s the number the client signs']],
      correctId: 'c',
      why: 'An AI or voice estimate of days is a starting point, and the client signs that number.',
      source: { file: CO, mustContain: 'This is the number the client signs.' },
    },
    {
      id: 'q4',
      en: 'Your client declined a change order. What does Revise & re-issue do?',
      choices: [['a', 'Starts a new draft with the next number, linked to the old one'], ['b', 'Edits the declined one in place'], ['c', 'Sends the same one again']],
      correctId: 'a',
      why: 'The declined change order stays as it is. The new draft carries its lines and days.',
      source: { file: CO, mustContain: 'Starts a new draft change order with the next number' },
    },
    {
      id: 'q5',
      en: 'What does Client approved without signing record?',
      choices: [['a', 'A signature the client drew on your phone'], ['b', 'Approval the client gave in the portal'], ['c', 'Approval with no signature attached']],
      correctId: 'c',
      why: 'It marks the change order approved with no signature, the weakest record you can keep.',
      source: { file: CO, mustContain: 'This records approval with no signature' },
    },
  ]),

  'pay-app-period': bank('pay-app-period', 1, [
    {
      id: 'q1',
      en: 'On the G703 continuation sheet, where do you enter this period’s work for a line?',
      choices: [['a', 'Column C, Scheduled'], ['b', 'Column E, This period'], ['c', 'Column I, Retainage']],
      correctId: 'b',
      why: 'Column E is this period’s work. Completed and stored adds it to the work before it.',
      source: { file: AIA, mustContain: "label: 'E This period'" },
    },
    {
      id: 'q2',
      en: 'You need to change a line’s scheduled value. What do you turn on first?',
      choices: [['a', 'Edit lines'], ['b', 'Print as saved'], ['c', 'Renumber']],
      correctId: 'a',
      why: 'Item, description and scheduled value can be typed only while Edit lines is on.',
      source: { file: AIA, mustContain: "{sovEditing ? 'Done' : 'Edit lines'}" },
    },
    {
      id: 'q3',
      en: 'You open a pay app you saved earlier. How does it open?',
      choices: [['a', 'As a new blank pay app'], ['b', 'Straight into editing every line'], ['c', 'As the saved record, with editing the draft as its own tap']],
      correctId: 'c',
      why: 'A saved pay app opens as stored. Tap to edit it while it is still a draft.',
      source: { file: AIA, mustContain: 'Edit this draft pay app' },
    },
    {
      id: 'q4',
      en: 'What does a pay app need before it can fill in progress from your schedule?',
      choices: [['a', 'A schedule and a linked estimate on the project'], ['b', 'A signed contract and a pay link'], ['c', 'Your client’s approval']],
      correctId: 'a',
      why: 'Progress comes from your schedule’s task progress, so the project needs both.',
      source: { file: AIA, mustContain: 'This project needs a schedule and a linked estimate' },
    },
    {
      id: 'q5',
      en: 'Where do the schedule of values lines come from?',
      choices: [['a', 'You always type them from scratch'], ['b', 'The estimate and approved change orders'], ['c', 'The last invoice’s line items']],
      correctId: 'b',
      why: 'Refresh brings the lines back in line with the estimate and approved change orders.',
      source: { file: AIA, mustContain: 'Refresh the schedule of values from the estimate and approved change orders' },
    },
  ]),

  'field-ticket-log': bank('field-ticket-log', 1, [
    {
      id: 'q1',
      en: 'Can an unsigned field ticket become a change order?',
      choices: [['a', 'Yes, any time'], ['b', 'No, it needs a signature first'], ['c', 'Only if it has photos']],
      correctId: 'b',
      why: 'An unsigned ticket is a note. Get it signed before the crew leaves.',
      source: { file: TICKET, mustContain: 'an unsigned ticket cannot become a change order' },
    },
    {
      id: 'q2',
      en: 'After a ticket is signed, what can still change?',
      choices: [['a', 'Only the rates'], ['b', 'The hours and quantities'], ['c', 'Nothing at all']],
      correctId: 'a',
      why: 'The hours, quantities and descriptions are what the signer put their name on.',
      source: { file: TICKET, mustContain: 'Only the rates can change after a signature.' },
    },
    {
      id: 'q3',
      en: 'A signed ticket has hours but no rates. Which button gets it to a dollar amount?',
      choices: [['a', 'Get signature'], ['b', 'Void ticket'], ['c', 'Price this ticket']],
      correctId: 'c',
      why: 'Price this ticket adds the rates, so the ticket can be billed.',
      source: { file: TICKET, mustContain: "'Price this ticket'" },
    },
    {
      id: 'q4',
      en: 'The field tickets list shows tickets already signed on site. What does it ask you to do?',
      choices: [['a', 'Sign them again'], ['b', 'Convert them before closeout'], ['c', 'Delete them after a week']],
      correctId: 'b',
      why: 'Converting a signed ticket turns it into a change order you can bill.',
      source: { file: TICKET, mustContain: 'Convert them before closeout.' },
    },
    {
      id: 'q5',
      en: 'What happens when you void a ticket?',
      choices: [['a', 'It stays on the record but can never be billed'], ['b', 'It is deleted for good'], ['c', 'It goes back to unsigned']],
      correctId: 'a',
      why: 'A void ticket stays on file, so the history is kept.',
      source: { file: TICKET, mustContain: 'The ticket stays on the record but can never be billed.' },
    },
  ]),

  'time-clock-in': bank('time-clock-in', 1, [
    {
      id: 'q1',
      en: 'Where do the people you clock in come from?',
      choices: [['a', 'Your phone’s contacts'], ['b', 'Your crew, added in the Crew screen'], ['c', 'Anyone with the project link']],
      correctId: 'b',
      why: 'Add your crew in the Crew screen first, then clock them in here.',
      source: { file: CLOCK, mustContain: 'then clock them in here.' },
    },
    {
      id: 'q2',
      en: 'What do labor rates on the time clock do?',
      choices: [['a', 'Set what your client pays per hour'], ['b', 'Decide who gets overtime'], ['c', 'Turn clocked hours into cost in your cost book']],
      correctId: 'c',
      why: 'Clocked hours times these rates feed your cost book, so estimates price labor from your numbers.',
      source: { file: CLOCK, mustContain: 'these rates feed your cost book' },
    },
    {
      id: 'q3',
      en: 'Someone is still on the clock from an earlier shift. What does the app need?',
      choices: [['a', 'The time they left'], ['b', 'Nothing, it clocks them out at midnight'], ['c', 'A new clock-in for today']],
      correctId: 'a',
      why: 'An open shift is not counted as on site until the time they left is entered.',
      source: { file: CLOCK, mustContain: 'Still on the clock from an earlier shift' },
    },
    {
      id: 'q4',
      en: 'You need hours for payroll. What do you use?',
      choices: [['a', 'Print the daily report'], ['b', 'Export payroll CSV for a pay period'], ['c', 'Share the project link']],
      correctId: 'b',
      why: 'The payroll export gives you the shifts for a pay period as a CSV file.',
      source: { file: CLOCK, mustContain: 'Export payroll CSV for a pay period' },
    },
    {
      id: 'q5',
      en: 'An entry’s hours are wrong. How do you fix them?',
      choices: [['a', 'Tap the entry and correct its hours'], ['b', 'Clock them in again'], ['c', 'Edit the daily report']],
      correctId: 'a',
      why: 'Tap an entry to correct its hours. Only the person who logged it can delete it.',
      source: { file: CLOCK, mustContain: 'Tap an entry to correct its hours or delete it.' },
    },
  ]),

  'punch-list-close': bank('punch-list-close', 1, [
    {
      id: 'q1',
      en: 'With punch list sharing on, how long does your client see an item in their portal?',
      choices: [['a', 'Only after it is closed'], ['b', 'Until it is closed'], ['c', 'Never']],
      correctId: 'b',
      why: 'Open items show in the client portal with their status until you close them.',
      source: { file: PUNCH, mustContain: 'Shown to your client in their portal until it is closed.' },
    },
    {
      id: 'q2',
      en: 'How do you start selecting several items at once?',
      choices: [['a', 'Double-tap the list title'], ['b', 'Swipe left on each item'], ['c', 'Long press an item']],
      correctId: 'c',
      why: 'A tap opens an item for editing. A long press starts selecting.',
      source: { file: PUNCH, mustContain: 'Long press to start selecting.' },
    },
    {
      id: 'q3',
      en: 'What does a sub see of an item in their sub portal?',
      choices: [['a', 'Your photo and your markup'], ['b', 'The description, location and plan sheet'], ['c', 'Only the item number']],
      correctId: 'b',
      why: 'The sub portal shows no photo or mark, so describe the mark in words.',
      source: { file: PUNCH, mustContain: 'The sub portal shows the description, location and plan sheet' },
    },
    {
      id: 'q4',
      en: 'What is Photo walk for?',
      choices: [['a', 'Shooting now and describing later'], ['b', 'Sending photos to the client'], ['c', 'Closing items with a photo']],
      correctId: 'a',
      why: 'Photo walk keeps the camera open. Pin the items afterward with Pin items.',
      source: { file: PUNCH, mustContain: 'Photo walk: shoot now, describe later' },
    },
    {
      id: 'q5',
      en: 'An item went on the crew list, but your client should see it. What do you do?',
      choices: [['a', 'Delete it and type it again'], ['b', 'Share the crew list'], ['c', 'Move it to the punch list']],
      correctId: 'c',
      why: 'Moving it to the punch list keeps the item and its details.',
      source: { file: PUNCH, mustContain: 'Moved to the punch list' },
    },
  ]),

  'ask-your-plans': bank('ask-your-plans', 1, [
    {
      id: 'q1',
      en: 'An answer shows a chip like Sheet A-101. What does tapping it do?',
      choices: [['a', 'Downloads the whole set'], ['b', 'Jumps to that sheet'], ['c', 'Emails the sheet to your client']],
      correctId: 'b',
      why: 'Each citation opens the sheet the answer came from.',
      source: { file: ASK_PLANS, mustContain: 'jumpToSheet(sheetId)' },
    },
    {
      id: 'q2',
      en: 'The answer says Weak match. What should you do?',
      choices: [['a', 'Open the cited sheet and check it before you build to it'], ['b', 'Trust it, it came from your plans'], ['c', 'Ask again until it changes']],
      correctId: 'a',
      why: 'No sheet scored as a close match, so treat the answer as a lead to check.',
      source: { file: ASK_PLANS, mustContain: 'Open the cited sheet and verify before you build to this.' },
    },
    {
      id: 'q3',
      en: 'It says it couldn’t find that in the indexed plans. What can you do?',
      choices: [['a', 'Nothing, the plans don’t have it'], ['b', 'Upgrade to see the answer'], ['c', 'Rephrase it, or index new sheets']],
      correctId: 'c',
      why: 'Try other words, or add sheets that have not been indexed yet.',
      source: { file: ASK_PLANS, mustContain: 'try rephrasing, or index new sheets below' },
    },
    {
      id: 'q4',
      en: 'It says it couldn’t search your plans just now. What does that mean?',
      choices: [['a', 'Your plans don’t hold the answer'], ['b', 'The search failed, and your plans may still hold the answer'], ['c', 'Your plans were removed']],
      correctId: 'b',
      why: 'A failed search is not the same as an answer that is not there.',
      source: { file: ASK_PLANS, mustContain: 'Your plans may still hold the answer.' },
    },
    {
      id: 'q5',
      en: 'MAGE suggests sheet numbers read from the title blocks. What should you do?',
      choices: [['a', 'Check each against the sheet, then tick the ones to use'], ['b', 'Accept them all at once'], ['c', 'Type every number by hand']],
      correctId: 'a',
      why: 'The numbers are read by AI, so you confirm each one before it is used.',
      source: { file: ASK_PLANS, mustContain: 'check each against the sheet' },
    },
  ]),

  'contract-from-estimate': bank('contract-from-estimate', 1, [
    {
      id: 'q1',
      en: 'What does Use my schedule fill in on a contract?',
      choices: [['a', 'The payment schedule'], ['b', 'The start date and length, from your schedule'], ['c', 'The scope of work']],
      correctId: 'b',
      why: 'It fills the start date and duration from your project schedule.',
      source: { file: CONTRACT, mustContain: 'Use my schedule' },
    },
    {
      id: 'q2',
      en: 'The payment schedule says not set yet. Can you sign the contract?',
      choices: [['a', 'No, it can’t be signed without one'], ['b', 'Yes, terms are optional'], ['c', 'Yes, but only on the web']],
      correctId: 'a',
      why: 'Set your deposit, progress and final split, and the schedule fills in.',
      source: { file: CONTRACT, mustContain: 'be signed without one' },
    },
    {
      id: 'q3',
      en: 'Your client is with you in person. Which button lets you both sign on your phone?',
      choices: [['a', 'Sign & send'], ['b', 'Save draft'], ['c', 'Sign together now']],
      correctId: 'c',
      why: 'Sign together now has you both sign on this phone, with no email.',
      source: { file: CONTRACT, mustContain: 'label="Sign together now"' },
    },
    {
      id: 'q4',
      en: 'Change orders have been approved. What does the contract screen show?',
      choices: [['a', 'Only the original amount'], ['b', 'A request to sign a new contract'], ['c', 'The original contract, each approved CO and the new total']],
      correctId: 'c',
      why: 'The revised contract sum adds each approved change order to the original.',
      source: { file: CONTRACT, mustContain: 'testID="revised-contract-sum"' },
    },
    {
      id: 'q5',
      en: 'You sent the contract with Sign & send. Can you still edit it?',
      choices: [['a', 'Yes, until they open it'], ['b', 'No, it is read-only until they sign'], ['c', 'Yes, and your edits reach the client live']],
      correctId: 'b',
      why: 'Once sent, the contract is read-only, and you are notified when they sign.',
      source: { file: CONTRACT, mustContain: 'Until then this contract is read-only.' },
    },
  ]),

  'closeout-binder': bank('closeout-binder', 1, [
    {
      id: 'q1',
      en: 'Where does the closeout binder’s content come from?',
      choices: [['a', 'You type all of it in'], ['b', 'Your client fills it in'], ['c', 'It is compiled from the project’s records']],
      correctId: 'c',
      why: 'Finishes, trades and warranties on file are pulled in from the project.',
      source: { file: BINDER, mustContain: 'Auto-compiled from this project' },
    },
    {
      id: 'q2',
      en: 'You deliver the binder. Where does your client find it?',
      choices: [['a', 'In their portal under Closeout, with an email'], ['b', 'Only as a printed copy'], ['c', 'In your Files tab']],
      correctId: 'a',
      why: 'Delivery puts it in the client portal under Closeout and emails them where to find it.',
      source: { file: BINDER, mustContain: 'portal under Closeout, and they get an email' },
    },
    {
      id: 'q3',
      en: 'Not everything is logged yet. Can you deliver the binder?',
      choices: [['a', 'No, every section must be full'], ['b', 'Yes, deliver it now and re-deliver later'], ['c', 'Only after the final invoice is paid']],
      correctId: 'b',
      why: 'A partial binder can go out now and be re-delivered as the project closes out.',
      source: { file: BINDER, mustContain: 'Deliver a partial binder now and re-deliver' },
    },
    {
      id: 'q4',
      en: 'What does the maintenance schedule start with?',
      choices: [['a', 'Nothing, it starts empty'], ['b', 'Common defaults you can edit, add to or remove'], ['c', 'Your client’s own list']],
      correctId: 'b',
      why: 'It starts with common tasks, so you only adjust what fits.',
      source: { file: BINDER, mustContain: 'Starts with common defaults you can edit, add to or remove.' },
    },
    {
      id: 'q5',
      en: 'Where does A note to the client appear?',
      choices: [['a', 'At the top of the binder'], ['b', 'In an email only'], ['c', 'On the last page']],
      correctId: 'a',
      why: 'The note goes at the top: a thank-you, a sign-off, anything they should know.',
      source: { file: BINDER, mustContain: 'Goes at the top of the binder' },
    },
  ]),
};
