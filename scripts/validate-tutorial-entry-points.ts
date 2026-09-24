// validate-tutorial-entry-points.ts — the doors INTO a tutorial: the
// /tutorials hub, onboarding's 'Try it on a sample job', the checklist's
// 'Show me first' rows, the Help sheet, Settings and the contextual chip.
//
// WHAT IT PINS, and why each matters to a user:
//   • the ONE auto-start: only a contractor / 'both' who just chose the sample
//     in onboarding, never over a waiting deep link, never a client persona —
//     a tour nobody asked for is the thing this whole design exists to avoid;
//   • who sees what in the hub: a field seat gets daily report + punch and NO
//     money card; a client / property manager gets an explanation, no cards;
//   • the founder's practice-pass switch: ON tags 'Business — practise free
//     on the sample'; OFF hides what his plan lacks (it would open on a
//     Paywall at step 1);
//   • the checklist: 'Show me first · 35 s' / '· 40 s', a 'Practised' tag
//     after, and practising NEVER ticks a real milestone;
//   • the chip copy and the returnTo shape the host parses;
//   • SOURCE SCANS: the old 1,012-line slideshow is gone with no import left,
//     every door routes to /tutorials or startTutorial with its own entry
//     name, the hub never starts anything on its own, and the onboarding
//     auto-start sits after completeOnboarding and the tab-shell replace.
//
// Run: bun run scripts/validate-tutorial-entry-points.ts

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ONBOARDING_TUTORIAL_ID,
  checklistShowMe,
  chipCopy,
  chipReturnTo,
  helpTutorialsRowVisible,
  hubEmptyReason,
  hubSections,
  missingTierFor,
  shouldAutoStartOnboardingTutorial,
  tierTagFor,
  type HubCtx,
} from '../utils/tutorial/entryPoints';
import { EMPTY_PROGRESS } from '../utils/tutorial/offers';
import { TUTORIAL_DEFS } from '../utils/tutorial/defs';
import type { FeatureKey } from '../utils/featureTiers';
import type { TutorialProgress } from '../utils/tutorial/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let failures = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log('  PASS  ' + name);
  else { failures += 1; console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : '')); }
}

const free = (_f: FeatureKey) => false;
const pro = (f: FeatureKey) => f === 'change_orders_invoicing';
const all = (_f: FeatureKey) => true;
const ctx = (over: Partial<HubCtx> = {}): HubCtx => ({
  persona: 'contractor', fieldOnly: false, progress: EMPTY_PROGRESS, canAccess: free, practicePass: true, ...over,
});
const ids = (c: HubCtx) => hubSections(c).flatMap(s => s.cards.map(x => x.id));
const groups = (c: HubCtx) => hubSections(c).map(s => s.group);

// ── 1. The one auto-start ───────────────────────────────────────────────────
console.log('\nonboarding auto-start:');
ok('contractor, no deep link → starts', shouldAutoStartOnboardingTutorial({ persona: 'contractor', replayTarget: null }));
ok("'both', no deep link → starts", shouldAutoStartOnboardingTutorial({ persona: 'both', replayTarget: null }));
ok('a waiting deep link always wins', !shouldAutoStartOnboardingTutorial({ persona: 'contractor', replayTarget: '/project-detail?id=x' }));
ok('client never gets a tour', !shouldAutoStartOnboardingTutorial({ persona: 'client', replayTarget: null }));
ok('property manager never gets a tour', !shouldAutoStartOnboardingTutorial({ persona: 'property_manager', replayTarget: null }));
ok('unknown persona (role read failed) does not start', !shouldAutoStartOnboardingTutorial({ persona: null, replayTarget: null }));
ok('the onboarding tutorial is the daily report by voice', ONBOARDING_TUTORIAL_ID === 'daily-report-voice');

// ── 2. Help row ─────────────────────────────────────────────────────────────
console.log('\nHelp-sheet row:');
ok('shown for contractor / both / unknown', helpTutorialsRowVisible('contractor') && helpTutorialsRowVisible('both') && helpTutorialsRowVisible(null));
ok('hidden for client and property manager', !helpTutorialsRowVisible('client') && !helpTutorialsRowVisible('property_manager'));

// ── 3. Hub ──────────────────────────────────────────────────────────────────
console.log('\nhub cards:');
ok('contractor sees all three wave-A tutorials in hub order',
  JSON.stringify(ids(ctx())) === JSON.stringify(['daily-report-voice', 'punch-walk', 'invoice-to-self']), JSON.stringify(ids(ctx())));
ok('grouped On site then Money', JSON.stringify(groups(ctx())) === JSON.stringify(['site', 'money']), JSON.stringify(groups(ctx())));
ok('section labels are the spec words', hubSections(ctx()).map(s => s.label).join('|') === 'On site|Money');
ok('field seat: daily report + punch, no money card',
  JSON.stringify(ids(ctx({ fieldOnly: true }))) === JSON.stringify(['daily-report-voice', 'punch-walk'])
  && !groups(ctx({ fieldOnly: true })).includes('money'));
ok('client: no cards, and an explanation', ids(ctx({ persona: 'client' })).length === 0 && !!hubEmptyReason('client', []));
ok('property manager: no cards, and an explanation', ids(ctx({ persona: 'property_manager' })).length === 0 && !!hubEmptyReason('property_manager', []));
ok('a hub with cards has no empty reason', hubEmptyReason('contractor', hubSections(ctx())) === null);

console.log('\npractice pass + tier tags:');
const punch = TUTORIAL_DEFS['punch-walk']!;
const invoice = TUTORIAL_DEFS['invoice-to-self']!;
const dfr = TUTORIAL_DEFS['daily-report-voice']!;
ok('punch on Free is missing Business', missingTierFor(punch, free) === 'business');
ok('invoice on Free is missing Pro', missingTierFor(invoice, free) === 'pro');
ok('invoice on Pro is missing nothing', missingTierFor(invoice, pro) === null);
ok('the daily report needs no plan', missingTierFor(dfr, free) === null);
ok("pass ON, Free: 'Business — practise free on the sample'", tierTagFor(punch, free, true) === 'Business — practise free on the sample');
ok("pass ON, Free: 'Pro — practise free on the sample'", tierTagFor(invoice, free, true) === 'Pro — practise free on the sample');
ok('owned feature: no tag', tierTagFor(punch, all, true) === null);
ok('pass OFF: never a "practise free" tag', tierTagFor(punch, free, false) === null);
ok('pass OFF, Free: only the daily report is offered',
  JSON.stringify(ids(ctx({ practicePass: false }))) === JSON.stringify(['daily-report-voice']));
ok('pass OFF, Pro: daily report + invoice (punch is Business)',
  JSON.stringify(ids(ctx({ practicePass: false, canAccess: pro }))) === JSON.stringify(['daily-report-voice', 'invoice-to-self']));
ok('pass OFF, Business: everything', ids(ctx({ practicePass: false, canAccess: all })).length === 3);

console.log('\nhub status pills:');
const progress: TutorialProgress = {
  v: 1,
  byId: { 'daily-report-voice': { status: 'practised', version: 1 } },
  active: { tutorialId: 'punch-walk', version: punch.version, stepIndex: 2, sandboxProjectId: 's', entry: 'hub', savedAt: 0 },
  chips: {},
};
const cards = hubSections(ctx({ progress })).flatMap(s => s.cards);
const card = (id: string) => cards.find(c => c.id === id)!;
ok('practised → Practised · Replay', card('daily-report-voice').status.label === 'Practised · Replay');
ok('saved run → Continue · step 3 of N', card('punch-walk').status.label === `Continue · step 3 of ${punch.steps.length}`);
ok('untouched → New', card('invoice-to-self').status.label === 'New');
ok('card carries time and Ends with', card('daily-report-voice').duration === '35 s' && card('daily-report-voice').endsWith === dfr.endsWith);

// ── 4. Checklist ────────────────────────────────────────────────────────────
console.log('\nchecklist Show me first:');
const cl = (key: string, over: Partial<Parameters<typeof checklistShowMe>[1]> = {}) => checklistShowMe(key, {
  done: false, persona: 'contractor', fieldOnly: false, progress: EMPTY_PROGRESS, canAccess: free, practicePass: true, ...over,
});
const tryit = cl('tryit');
const inv = cl('invoice');
ok("'Try it' row → Show me first · 35 s (daily report)", tryit?.kind === 'offer' && tryit.label === 'Show me first · 35 s' && tryit.tutorialId === 'daily-report-voice', JSON.stringify(tryit));
ok("'Send your first invoice' → Show me first · 40 s (invoice)", inv?.kind === 'offer' && inv.label === 'Show me first · 40 s' && inv.tutorialId === 'invoice-to-self', JSON.stringify(inv));
ok('other rows get nothing', cl('stripe') === null && cl('project') === null && cl('companyInfo') === null);
ok('a done row gets nothing', cl('tryit', { done: true }) === null);
ok("practised → a 'Practised' tag, never an offer", cl('tryit', { progress })?.kind === 'practised');
ok('field seat: no invoice offer', cl('invoice', { fieldOnly: true }) === null);
ok('client persona: nothing', cl('tryit', { persona: 'client' }) === null);
ok('pass OFF on Free: no invoice offer, daily report still offered', cl('invoice', { practicePass: false }) === null && cl('tryit', { practicePass: false })?.kind === 'offer');

// ── 5. Chip ─────────────────────────────────────────────────────────────────
console.log('\ncontextual chip:');
ok('chip copy', chipCopy(dfr) === 'New here? Practise once on a sample job · 35 s', chipCopy(dfr));
ok('returnTo: path + sorted string params', chipReturnTo('/daily-report', { projectId: 'p 1', date: '2026-09-23' }) === '/daily-report?date=2026-09-23&projectId=p%201');
ok('returnTo drops arrays and empties', chipReturnTo('/invoice', { projectId: 'p', type: ['a', 'b'], x: '' }) === '/invoice?projectId=p');
ok('returnTo with no params is the bare path', chipReturnTo('/punch-walk', {}) === '/punch-walk');

// ── 6. Source scans ─────────────────────────────────────────────────────────
console.log('\nsource scans:');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(full);
  }
  return out;
}
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

ok('components/Tutorial.tsx (the mock slideshow) is deleted', !existsSync(join(ROOT, 'components', 'Tutorial.tsx')));
const deadImports: string[] = [];
for (const dir of ['app', 'components', 'utils', 'hooks', 'contexts', '__tests__']) {
  for (const f of listFiles(join(ROOT, dir))) {
    const s = code(readFileSync(f, 'utf8'));
    if (/from ['"]@\/components\/Tutorial['"]|require\(['"]@\/components\/Tutorial['"]\)|TUTORIAL_SEEN_KEY/.test(s)) deadImports.push(relative(ROOT, f));
  }
}
ok('no import of the old Tutorial / TUTORIAL_SEEN_KEY anywhere', deadImports.length === 0, deadImports.join(', '));

// Onboarding: the auto-start, in order.
const ob = code(read('app/onboarding.tsx'));
const tourStart = ob.indexOf('const handleTourSample = useCallback(');
const tourEnd = ob.indexOf('}, [addProject', tourStart);
const tour = ob.slice(tourStart, tourEnd);
const iComplete = tour.indexOf('await completeOnboarding();');
const iReplace = tour.indexOf("router.replace('/(tabs)/(home)'");
const iGuard = tour.indexOf('shouldAutoStartOnboardingTutorial({ persona: userRole, replayTarget })');
const iStart = tour.indexOf("startTutorial(ONBOARDING_TUTORIAL_ID, { sandboxProjectId: projectId, entry: 'onboarding' })");
const iPush = tour.search(/router\.push\(\(replayTarget \?\? \{ pathname: '\/project-detail'/);
ok('onboarding: handleTourSample found', tourStart >= 0 && tourEnd > tourStart);
ok('onboarding: the auto-start is guarded by shouldAutoStartOnboardingTutorial', iGuard > 0 && iStart > iGuard);
ok('onboarding: it starts on the just-seeded sample with entry onboarding', iStart > 0);
ok('onboarding: only after completeOnboarding and the tab-shell replace', iComplete > 0 && iReplace > iComplete && iGuard > iReplace,
  `complete@${iComplete} replace@${iReplace} guard@${iGuard}`);
ok('onboarding: the plain sample-job push is still the fallback', iPush > iStart);
ok("onboarding: the button says 'Try it on a sample job'", /accessibilityLabel="Try it on a sample job"/.test(ob) && /'Try it on a sample job'\}/.test(ob) && !/Tour a sample job/.test(ob));
ok('onboarding: startTutorial appears once (no other auto-start)', (ob.match(/startTutorial\(/g) ?? []).length === 1);

// Every other door: routes to the hub or starts with its own entry name.
const help = code(read('components/HelpFab.tsx'));
ok('HelpFab: row says Tutorials — practise on a sample job', help.includes('Tutorials — practise on a sample job'));
ok('HelpFab: no AsyncStorage seen-flag dance left', !/AsyncStorage/.test(help));
const brain = code(read('components/brain/BrainSurface.tsx'));
ok("BrainSurface: the Help row pushes '/tutorials'", /router\.push\('\/tutorials'\)/.test(brain));
ok('BrainSurface: the row is gated on helpTutorialsRowVisible(userRole)', /helpTutorialsRowVisible\(userRole\) \? openTutorials : undefined/.test(brain));
ok('BrainSurface: mounts no tutorial modal', !/<Tutorial\b/.test(brain));
const settings = code(read('app/(tabs)/settings/index.tsx'));
ok("Settings: the Help & support row pushes '/tutorials'", /onPress=\{\(\) => router\.push\('\/tutorials'\)\}[\s\S]{0,400}testID="show-tutorial"/.test(settings));
ok("Settings: the row is labelled 'Tutorials'", />Tutorials<\/Text>/.test(settings) && !/Show Tutorial/.test(settings));
ok("routeTitle: '/tutorials' → 'Tutorials'", /'\/tutorials': 'Tutorials'/.test(read('utils/routeTitle.ts')));

const hub = code(read('app/tutorials.tsx'));
const hubStarts = hub.match(/startTutorial\(/g) ?? [];
ok('hub: exactly one startTutorial call, with entry hub', hubStarts.length === 1 && /startTutorial\(card\.id, \{ entry: 'hub' \}\)/.test(hub));
const onStartBody = hub.slice(hub.indexOf('const onStart = useCallback('), hub.indexOf('}, []);', hub.indexOf('const onStart = useCallback(')));
ok('hub: that call lives in the tap handler, never an effect', onStartBody.includes('startTutorial(card.id'));
ok('hub: clears the Brain FAB', /paddingBottom: insets\.bottom \+ BRAIN_FAB_CLEARANCE/.test(hub));
ok('hub: filtered through hubSections with the practice-pass switch', /hubSections\(\{ persona: userRole, fieldOnly, progress, canAccess, practicePass: TUTORIAL_PRACTICE_PASS \}\)/.test(hub));

const checklist = code(read('components/OnboardingChecklist.tsx'));
ok("checklist: 'Show me first' starts with entry checklist", /startTutorial\(offer\.tutorialId, \{ entry: 'checklist' \}\)/.test(checklist));
ok('checklist: practising never ticks a row (done expressions untouched)',
  /done: triedWowFeature \|\| estimateCount > 0,/.test(checklist)
  && /done: invoiceCount > 0 && projectCount > 0,/.test(checklist)
  && !/done:[^,\n]*(tutorial|practised)/i.test(checklist));

const chip = code(read('components/tutorial/TutorialOfferChip.tsx'));
ok('chip: decided by offers.shouldOfferChip', /shouldOfferChip\(progress, \{/.test(chip));
ok('chip: showing it is recorded (once per tutorial, one a day)', /markTutorialChipShown\(tutorialId, today\)/.test(chip));
ok('chip: × is forever', /dismissTutorialChip\(tutorialId\)/.test(chip));
ok('chip: Show me starts with entry chip and a returnTo', /startTutorial\(tutorialId, \{ entry: 'chip', returnTo:/.test(chip));
ok('chip: an unknown project counts as a sample (never offered blind)', /const projectIsSample = !project \|\| isSampleProject\(project\);/.test(chip));

// The chip is only a door if a screen mounts it (integration review: it was
// built and mounted nowhere). One mount per wave-A screen, each for its own
// tutorial, each fed the screen's real draft state.
{
  const MOUNTS: [string, string, RegExp][] = [
    ['app/daily-report.tsx', 'daily-report-voice', /midDraft=\{isDirty\}/],
    ['app/punch-walk.tsx', 'punch-walk', /midDraft=\{!!draft\.description\.trim\(\) \|\| !!draft\.photoUri \|\| session\.length > 0\}/],
    ['app/invoice.tsx', 'invoice-to-self', /screenOpened=\{!existingInvoice\}/],
  ];
  for (const [file, id, fed] of MOUNTS) {
    const src = code(read(file));
    const at = src.indexOf(`<TutorialOfferChip tutorialId="${id}"`) >= 0 ? src.indexOf(`<TutorialOfferChip tutorialId="${id}"`) : src.search(new RegExp(`<TutorialOfferChip\\s+tutorialId="${id}"`));
    ok(`chip: ${file} mounts <TutorialOfferChip tutorialId="${id}"> with its real draft state`, at >= 0 && fed.test(src.slice(at, at + 400)));
  }
  const inv = code(read('app/invoice.tsx'));
  const innerStart = inv.indexOf('function InvoiceInner()');
  ok('chip: the invoice mount is inside InvoiceInner (past both gates)', innerStart >= 0 && inv.indexOf('<TutorialOfferChip', innerStart) > innerStart);
}

// tutorial_offered for every door (spec §13): the checklist and onboarding
// had none, so offered → started had no denominator there.
{
  const cl = code(read('components/OnboardingChecklist.tsx'));
  ok('checklist: fires tutorial_offered {entry: checklist} once per offered tutorial, only while visible',
    /track\(AnalyticsEvents\.TUTORIAL_OFFERED, \{ tutorial_id: id, entry: 'checklist' \}\)/.test(cl)
      && /if \(offeredRef\.current\.has\(id\)\) continue;/.test(cl)
      && /const checklistVisible = dismissed === false && doneCount < AUTO_HIDE_AT_DONE;/.test(cl));
  const ob = code(read('app/onboarding.tsx'));
  ok('onboarding: fires tutorial_offered {entry: onboarding} once, on the sample card, for a persona that gets the tour',
    /track\(AnalyticsEvents\.TUTORIAL_OFFERED, \{ tutorial_id: ONBOARDING_TUTORIAL_ID, entry: 'onboarding' \}\)/.test(ob)
      && /if \(!onTourCard \|\| tourOfferedRef\.current\) return;/.test(ob)
      && /if \(!shouldAutoStartOnboardingTutorial\(\{ persona: userRole, replayTarget: null \}\)\) return;/.test(ob));
  // spec §16: the FAB hides while the coach is on screen.
  const fab = code(read('components/brain/BrainFab.tsx'));
  ok('BrainFab hides while a tutorial coach is up', /const coachUp = useTutorialCoachVisible\(\);\s*const hidden = fabStateHidden \|\| coachUp;/.test(fab));
  const surf = code(read('components/brain/BrainSurface.tsx'));
  ok('BrainSurface reads userRole from the narrow core slice (it is always mounted)', /const \{ userRole \} = useCoreData\(\);/.test(surf) && !/useProjects\(\)/.test(surf));
}

console.log(failures ? `\n${failures} FAILED` : '\nall tutorial entry-point checks passed');
process.exit(failures ? 1 : 0);
