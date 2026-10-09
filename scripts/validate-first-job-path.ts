// validate-first-job-path — "Your First Job", the interactive starter path on
// Home (lane FIRSTJOB).
//
// WHAT IT PROVES.
//
// A. THE RULES (utils/firstJobPath.ts, run directly, no React):
//    - every answer gives all seven steps exactly once, and Add Your Prices is
//      always ahead of Price Your First Job;
//    - the answer moves ONE step to the front and nothing else;
//    - a step is done only from the account's data: nothing saved by the card
//      can tick one, a skip is not a tick, and a read that failed is "not
//      known", never "done" and never "not done";
//    - exactly one step is open on the path;
//    - Hide collapses to the one row, Remove is for good, the finish state
//      shows once, and an account that already did most of it never sees the
//      card;
//    - whose share counts as "sent": a job he owns that is not a sample, or the
//      estimate built on this phone; never a job someone else shared with him;
//    - which views retire the card for good (finished, established, finished
//      while hidden), so the mounted card stops every read;
//    - Stripe is not a step;
//    - "Show Me First" exists only where a guided tutorial exists;
//    - a paid step says its plan before the tap;
//    - who sees it: contractor and both get the path, an invited field seat
//      keeps the old card, a property owner or manager gets nothing, and with
//      the kill switch off everyone gets the old card.
//
// B. THE WIRING (source text): no react-native-reanimated, storage keys under
//    an owned prefix, no pop-ups or notifications, theme colours only, Lucide
//    icons only, the tier gate through hooks/useTierAccess, every analytics
//    event fired with no personal data, Home mounts the new card with the old
//    card's props, the old card is still reachable, the kill switch is on.
//
//    Also: the "sent" mark has one writer and it asks the ownership rule
//    first; the callers of markEstimateSent are found by reading the tree and
//    must be exactly the three shares, each naming what it shared; a retired
//    card mounts no body; the finish card goes when Home goes out of view;
//    the Create button opens Home's own sheet; the proposal read is throttled
//    on the last answer of either kind and asks for his own rows.
//
// C. THE WORDS (the English shard and the Spanish catalog): labels with every
//    word capitalised, sentences that end, no em dash, no "&", no "e.g.", no
//    arrows, never "unlimited", no accuracy promise, no bare "AIA"; English
//    and Spanish key sets equal.
//
// PLANTED MUTATIONS. Every rule above is run a second time against a planted
// break (a wrapped copy of the module, or edited text, in memory only; nothing
// on disk changes) and the run fails unless that break turns the named rule
// red. A rule that cannot catch its own break is not a rule. They run on every
// invocation; `LIST=1` prints them.
//
// Run: bun run scripts/validate-first-job-path.ts
// Pure node:fs + pure modules; no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as REAL from '../utils/firstJobPath';
import { EN as EN_REAL } from '../i18n/catalog/en/office.first-job.generated';
import { ES_OFFICE_FIRST_JOB } from '../i18n/catalog/es/office/firstJob';
import { TUTORIAL_DEFS } from '../utils/tutorial/defs';
import { isAppStorageKey, selectTenantKeysToWipe } from '../utils/localCacheKeys';
import { REQUIRED_TIER, type FeatureKey } from '../utils/featureTiers';
import { SURFACES } from '../i18n/surfaces';
import { EN_SHARDS } from '../i18n/catalog/en';
import { ES_SHARDS } from '../i18n/catalog/es';

type Core = typeof REAL;
type Check = { rule: string; name: string; pass: boolean; detail?: string };
type Words = Record<string, string | { zero?: string; one: string; many?: string; other: string }>;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const F = {
  core: 'utils/firstJobPath.ts',
  store: 'utils/firstJobStore.ts',
  card: 'components/FirstJobPath.tsx',
  views: 'components/firstJob/FirstJobViews.tsx',
  copy: 'hooks/useFirstJobCopy.ts',
  signals: 'hooks/useFirstJobSignals.ts',
  home: 'app/(tabs)/(home)/index.tsx',
  detail: 'app/project-detail.tsx',
  estFull: 'app/(tabs)/estimate/full.tsx',
  estReview: 'app/(tabs)/estimate/review.tsx',
  flags: 'constants/featureFlags.ts',
  analytics: 'utils/analytics.ts',
  old: 'components/OnboardingChecklist.tsx',
  pkg: 'package.json',
} as const;
type FileKey = keyof typeof F;
type Files = Record<FileKey, string>;

const REAL_FILES = Object.fromEntries((Object.keys(F) as FileKey[]).map((k) => [k, read(F[k])])) as Files;
const ES_REAL: Words = Object.fromEntries(Object.entries(ES_OFFICE_FIRST_JOB).map(([k, v]) => [k, (v as { s: Words[string] }).s]));

/** Every app source file that CALLS markEstimateSent (found by reading the tree, not from a list). */
function sentMarkCallers(): string[] {
  const hits: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const next = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(next); continue; }
      if (!/\.tsx?$/.test(e.name) || next === F.store) continue;
      if (/\bmarkEstimateSent\(/.test(code(read(next)))) hits.push(next);
    }
  };
  for (const top of ['app', 'components', 'hooks', 'utils', 'contexts', 'lib']) walk(top);
  return hits.sort();
}
/** The argument text of every markEstimateSent(...) call in a source. */
function sentMarkArgs(src: string): string[] {
  return [...code(src).matchAll(/\bmarkEstimateSent\(([^)]*)\)/g)].map((m) => m[1].trim());
}

/** Source with comments removed, so a rule reads code and not the prose around it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

// ── fixtures ────────────────────────────────────────────────────────────────

const STEPS: REAL.FirstJobStepId[] = ['company', 'prices', 'estimate', 'send', 'schedule', 'daily', 'invoice'];
const ANSWERS: (REAL.FirstJobAnswer | null)[] = ['price', 'schedule', 'bill', 'site', 'unsure', null];

const NOTHING: REAL.FirstJobData = {
  settingsLoaded: true, companyName: '', pricesLoaded: true, priceCount: 0, projectsLoaded: true,
  realProjectCount: 0, estimateCount: 0, sharedEstimateCount: 0, contractsRead: 'ok', sentContractCount: 0,
  sentMarker: false, scheduleCount: 0, dailyReportsLoaded: true, dailyReportCount: 0, invoicesLoaded: true, invoiceCount: 0,
};
const EVERYTHING: REAL.FirstJobData = {
  ...NOTHING, companyName: 'Acme Build', priceCount: 3, realProjectCount: 1, estimateCount: 1, sharedEstimateCount: 1,
  scheduleCount: 1, dailyReportCount: 1, invoiceCount: 1,
};
const sig = (done: REAL.FirstJobStepId[], unknown: REAL.FirstJobStepId[] = []): REAL.FirstJobSignals =>
  Object.fromEntries(STEPS.map((s) => [s, unknown.includes(s) ? undefined : done.includes(s)])) as REAL.FirstJobSignals;
const stored = (p: Partial<REAL.FirstJobStored> = {}): REAL.FirstJobStored => ({ ...REAL.EMPTY_STORED, ...p });

const PRO_ONLY = (f: FeatureKey) => REQUIRED_TIER[f] === 'free';
const ALL = () => true;
const PROGRESS = { byId: {}, chips: {}, active: null, lastChipDay: null } as never;

// ── A. the rules ────────────────────────────────────────────────────────────

function ruleChecks(core: Core): Check[] {
  const out: Check[] = [];
  const ok = (rule: string, name: string, pass: boolean, detail = '') => out.push({ rule, name, pass, detail });
  const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

  // whose share counts (behaviour)
  const mine = { name: 'Kitchen', ownerUserId: 'u1' };
  ok('own-work', 'a share from a job he owns counts', core.estimateSentCounts(mine, 'u1') === true);
  ok('own-work', 'a job made on this phone and not yet synced (no owner saved) is his', core.estimateSentCounts({ name: 'Kitchen' }, 'u1') === true);
  ok('own-work', 'a share from a job another contractor shared with him does not count',
    core.estimateSentCounts({ name: 'Their Job', ownerUserId: 'someone-else' }, 'u1') === false);
  ok('own-work', 'a share from a sample job does not count, his own or not',
    core.estimateSentCounts({ name: 'Sample — Sarah\'s Place', ownerUserId: 'u1' }, 'u1') === false
    && core.estimateSentCounts({ name: 'Sample — Sarah\'s Place' }, 'u1') === false);
  ok('own-work', 'the estimate built on this phone with no project counts', core.estimateSentCounts(null, 'u1') === true);
  ok('own-work', 'nobody signed in: nothing counts',
    core.estimateSentCounts(mine, null) === false && core.estimateSentCounts(null, undefined) === false && core.estimateSentCounts(null, '') === false);
  // which views retire the card (behaviour)
  const NONE = (reason: string) => ({ kind: 'none', reason }) as REAL.FirstJobView;
  ok('retire', 'finished, established and finished-while-hidden retire the card',
    ['finished', 'established', 'hidden-complete'].every((r) => core.viewRetiresCard(NONE(r)) === true));
  ok('retire', 'a card that is still loading, or drawn, is not retired',
    core.viewRetiresCard(NONE('loading')) === false
    && core.viewRetiresCard({ kind: 'question', done: 0, total: 7 }) === false
    && core.viewRetiresCard({ kind: 'hidden', done: 1, total: 7 }) === false
    && core.viewRetiresCard({ kind: 'finish', done: 7, skipped: 0, total: 7 }) === false);
  ok('retire', 'the views the rules really build retire as said',
    core.viewRetiresCard(core.buildView(stored({ answer: 'unsure', finishShown: true }), sig(STEPS))) === true
    && core.viewRetiresCard(core.buildView(stored(), sig(STEPS))) === true
    && core.viewRetiresCard(core.buildView(stored({ answer: 'unsure', hidden: true }), sig(STEPS))) === true
    && core.viewRetiresCard(core.buildView(stored({ answer: 'unsure' }), sig(STEPS))) === false
    && core.viewRetiresCard(core.buildView(stored({ answer: 'unsure' }), sig(['company']))) === false);

  // ordering
  ok('order', 'the usual order is the seven steps of a real job', core.USUAL_ORDER.join() === STEPS.join());
  for (const a of ANSWERS) {
    const o = safe(() => core.orderFor(a), [] as REAL.FirstJobStepId[]);
    ok('order', `answer ${a ?? 'none'}: all seven steps, each exactly once`,
      o.length === 7 && STEPS.every((s) => o.filter((x) => x === s).length === 1), o.join());
    ok('prices-first', `answer ${a ?? 'none'}: Add Your Prices is ahead of Price Your First Job`,
      o.indexOf('prices') >= 0 && o.indexOf('prices') < o.indexOf('estimate'), o.join());
    const lead = a ? core.ANSWER_LEAD[a] : null;
    const rest = lead ? STEPS.filter((s) => s !== lead) : STEPS;
    ok('order', `answer ${a ?? 'none'}: only the first step moves; the rest keep the usual order`,
      (lead ? o[0] === lead : true) && o.slice(lead ? 1 : 0).join() === rest.join(), o.join());
  }
  ok('order', 'Price A Job starts at Add Your Prices', core.orderFor('price')[0] === 'prices');
  ok('order', 'Schedule A Job starts at Build The Schedule', core.orderFor('schedule')[0] === 'schedule');
  ok('order', 'Bill A Client starts at Send Your First Invoice', core.orderFor('bill')[0] === 'invoice');
  ok('order', 'Run The Site starts at Log One Day On Site', core.orderFor('site')[0] === 'daily');
  ok('order', 'Not Sure keeps the usual order', core.orderFor('unsure').join() === STEPS.join());

  // Stripe is not a step
  ok('stripe', 'there are exactly seven steps', core.TOTAL_STEPS === 7 && Object.keys(core.STEP_META).length === 7);
  ok('stripe', 'no step is Stripe',
    !core.USUAL_ORDER.some((s) => /stripe|payments?/i.test(s)) && !Object.keys(core.STEP_META).some((s) => /stripe/i.test(s))
    && ANSWERS.every((a) => !core.orderFor(a).some((s) => /stripe/i.test(s))));
  ok('stripe', 'the four stages are Win It, Plan It, Build It, Get Paid, and the finish adds Close It',
    core.STAGE_ORDER.join() === 'win,plan,build,paid' && core.FINISH_STAGES.join() === 'win,plan,build,paid,close');
  ok('stripe', 'each step sits in its stage',
    STEPS.map((s) => core.STEP_META[s]?.stage).join() === 'win,win,win,win,plan,build,paid');

  // done only from data
  const none = safe(() => core.signalsFromData(NOTHING), sig(STEPS));
  ok('data-only', 'an account with nothing done has no step done', STEPS.every((s) => none[s] === false), JSON.stringify(none));
  const all = safe(() => core.signalsFromData(EVERYTHING), sig([]));
  ok('data-only', 'an account with the work done has every step done', STEPS.every((s) => all[s] === true), JSON.stringify(all));
  const one = (patch: Partial<REAL.FirstJobData>) => safe(() => core.signalsFromData({ ...NOTHING, ...patch }), sig(STEPS));
  const only = (s: REAL.FirstJobSignals, id: REAL.FirstJobStepId) => STEPS.every((x) => (s[x] === true) === (x === id));
  ok('data-only', 'company: a typed company name, and nothing else', only(one({ companyName: 'Acme' }), 'company') && one({ companyName: '   ' }).company === false);
  ok('data-only', 'prices: at least one saved price', only(one({ priceCount: 1 }), 'prices'));
  ok('data-only', 'estimate: a real project with an estimate', only(one({ estimateCount: 1, realProjectCount: 1 }), 'estimate'));
  ok('data-only', 'send: the wizard share stamp on a real project', only(one({ sharedEstimateCount: 1 }), 'send'));
  ok('data-only', 'send: a proposal or contract out of draft', only(one({ sentContractCount: 1 }), 'send'));
  ok('data-only', 'send: the local mark a share writes', only(one({ sentMarker: true }), 'send'));
  ok('data-only', 'schedule: a real project with a schedule', only(one({ scheduleCount: 1 }), 'schedule'));
  ok('data-only', 'daily: a saved daily report', only(one({ dailyReportCount: 1 }), 'daily'));
  ok('data-only', 'invoice: an invoice on a real project', only(one({ invoiceCount: 1, realProjectCount: 1 }), 'invoice'));
  ok('data-only', 'invoice: a sample job\'s invoice (no real project) does not count', one({ invoiceCount: 3, realProjectCount: 0 }).invoice === false);
  // not known is neither done nor not done
  const cold = safe(() => core.signalsFromData({
    ...NOTHING, settingsLoaded: false, pricesLoaded: false, projectsLoaded: false, dailyReportsLoaded: false, invoicesLoaded: false,
    contractsRead: 'loading', sentMarker: undefined,
  }), sig(STEPS));
  ok('unknown', 'before the lists load, every step is "not known"', STEPS.every((s) => cold[s] === undefined), JSON.stringify(cold));
  ok('unknown', 'a failed proposal read is "not known", never "not sent"', one({ contractsRead: 'failed' }).send === undefined);
  ok('unknown', 'a failed proposal read is never "sent"', one({ contractsRead: 'failed' }).send !== true);
  ok('unknown', 'an unread local mark is "not known"', one({ sentMarker: undefined }).send === undefined);
  ok('unknown', 'a positive mark answers even while the proposal read is out', one({ contractsRead: 'loading', sentMarker: true }).send === true);
  // nothing the card saves can tick a step
  const forged = safe(() => core.parseStored(JSON.stringify({
    v: 1, answer: 'unsure', skipped: [], hidden: false, removed: false, finishShown: false,
    done: STEPS, completed: STEPS, signals: sig(STEPS), ticked: STEPS,
  })), stored());
  const forgedView = safe(() => core.buildView(forged, sig([])), { kind: 'none', reason: 'removed' } as REAL.FirstJobView);
  ok('data-only', 'nothing saved on the device can mark a step done',
    forgedView.kind === 'path' && forgedView.done === 0 && forgedView.steps.every((s) => s.status === 'todo'));
  const skipAll = safe(() => core.buildView(stored({ answer: 'unsure', skipped: ['company', 'prices'] }), sig([])), forgedView);
  ok('data-only', 'a skipped step is not a done step',
    skipAll.kind === 'path' && skipAll.done === 0 && skipAll.filled === 0
    && skipAll.steps.filter((s) => s.status === 'skipped').length === 2 && !skipAll.steps.some((s) => s.status === 'done'));
  ok('data-only', 'the count is the number of steps the data says are done',
    safe(() => core.doneCount(sig(['company', 'daily'])), -1) === 2 && safe(() => core.doneCount(sig([], STEPS)), -1) === 0);
  const selectedDone = safe(() => core.buildView(stored({ answer: 'unsure' }), sig(['company']), { selected: 'company' }), forgedView);
  ok('data-only', 'tapping a step changes which one is open and nothing else',
    selectedDone.kind === 'path' && selectedDone.done === 1 && selectedDone.openId === 'prices');
  // ticks
  ok('data-only', 'a step that loads already done does not tick; one seen not done and then done does',
    safe(() => core.freshlyDone(sig(['company', 'prices']), new Set(), new Set<REAL.FirstJobStepId>(['prices'])).join(), 'x') === 'prices'
    && safe(() => core.freshlyDone(sig(['company']), new Set<REAL.FirstJobStepId>(['company']), new Set<REAL.FirstJobStepId>(['company'])).length, 9) === 0);

  // one open step
  for (const a of ['price', 'schedule', 'bill', 'site', 'unsure'] as REAL.FirstJobAnswer[]) {
    for (const doneSet of [[], ['company'], ['company', 'prices', 'estimate'], ['invoice', 'daily']] as REAL.FirstJobStepId[][]) {
      for (const selected of [null, 'schedule', 'invoice'] as (REAL.FirstJobStepId | null)[]) {
        const v = safe(() => core.buildView(stored({ answer: a }), sig(doneSet), { selected }), forgedView);
        const open = v.kind === 'path' ? v.steps.filter((s) => s.open) : [];
        ok('one-open', `answer ${a}, done [${doneSet.join()}], tapped ${selected ?? 'none'}: exactly one open step, and it is not a done one`,
          v.kind === 'path' && open.length === 1 && open[0].id === v.openId && open[0].status !== 'done');
        const order = core.orderFor(a);
        const firstTodo = order.find((s) => !doneSet.includes(s));
        ok('one-open', `answer ${a}, done [${doneSet.join()}]: "next" is the first step still to do`,
          v.kind === 'path' && v.nextId === firstTodo);
        if (v.kind === 'path' && selected && !doneSet.includes(selected)) {
          ok('one-open', `answer ${a}: a tapped later step opens instead of the next one`, v.openId === selected);
        }
      }
    }
  }
  const stagesView = safe(() => core.buildView(stored({ answer: 'unsure' }), sig(['company', 'prices', 'estimate', 'send'])), forgedView);
  ok('one-open', 'stage pills: Win It done, Plan It now, the rest later',
    stagesView.kind === 'path' && stagesView.stages.map((s) => s.state).join() === 'done,now,later,later' && stagesView.filled === 4);
  ok('one-open', 'done out of order is recorded as out of order, in order as in order',
    safe(() => core.isOutOfOrder('invoice', stored({ answer: 'unsure' }), sig([])), false) === true
    && safe(() => core.isOutOfOrder('company', stored({ answer: 'unsure' }), sig([])), true) === false
    && safe(() => core.isOutOfOrder('invoice', stored({ answer: 'bill' }), sig([])), true) === false);

  // hide / remove / finish / established
  const kind = (s: Partial<REAL.FirstJobStored>, g: REAL.FirstJobSignals, o: REAL.BuildViewOpts = {}) =>
    safe(() => core.buildView(stored(s), g, o).kind, 'throw' as string);
  ok('hide', 'a new account is asked the one question', kind({}, sig([])) === 'question');
  ok('hide', 'answered: the path', kind({ answer: 'price' }, sig([])) === 'path');
  ok('hide', 'Hide collapses the card to the one row', kind({ answer: 'price', hidden: true }, sig(['company'])) === 'hidden');
  const hiddenView = safe(() => core.buildView(stored({ answer: 'price', hidden: true }), sig(['company', 'prices', 'estimate'])), forgedView);
  ok('hide', 'the hidden row carries the real count', hiddenView.kind === 'hidden' && hiddenView.done === 3 && hiddenView.total === 7);
  ok('hide', 'reopening the hidden row brings the path back', kind(core.showPath(core.hidePath(stored({ answer: 'price' }))), sig([])) === 'path');
  ok('hide', 'a path finished while hidden leaves without a finish screen', kind({ answer: 'price', hidden: true }, sig(STEPS)) === 'none');
  ok('remove', 'Remove is for good, whatever else is true',
    kind({ answer: 'price', removed: true }, sig([])) === 'none' && kind({ removed: true }, sig([])) === 'none'
    && kind({ answer: 'price', removed: true, hidden: true }, sig(['company'])) === 'none'
    && kind({ answer: 'price', removed: true }, sig(STEPS), { finishLive: true }) === 'none');
  ok('remove', 'removePath sets it and nothing brings it back',
    core.removePath(stored({ answer: 'price' })).removed === true && core.showPath(core.removePath(stored())).removed === true
    && safe(() => core.parseStored(core.serializeStored(core.removePath(stored()))).removed, false) === true);
  ok('finish', 'all seven done: the finish state', kind({ answer: 'unsure' }, sig(STEPS)) === 'finish');
  ok('finish', 'done or skipped counts as finished', kind({ answer: 'unsure', skipped: ['send', 'invoice'] }, sig(['company', 'prices', 'estimate', 'schedule', 'daily'])) === 'finish');
  ok('finish', 'one step still to do is not finished', kind({ answer: 'unsure' }, sig(['company', 'prices', 'estimate', 'send', 'schedule', 'daily'])) === 'path');
  ok('finish', 'the finish state shows once: after that the card is gone', kind({ answer: 'unsure', finishShown: true }, sig(STEPS)) === 'none');
  ok('finish', 'it stays up for the visit it first appeared in', kind({ answer: 'unsure', finishShown: true }, sig(STEPS), { finishLive: true }) === 'finish');
  ok('established', `an account with ${core.ESTABLISHED_AT_DONE} of 7 done that never answered does not see the card`,
    core.ESTABLISHED_AT_DONE === 5
    && kind({}, sig(['company', 'prices', 'estimate', 'schedule', 'daily'])) === 'none'
    && kind({}, sig(STEPS)) === 'none'
    && kind({ hidden: true }, sig(['company', 'prices', 'estimate', 'schedule', 'daily'])) === 'none');
  ok('established', 'one fewer and it is asked the question', kind({}, sig(['company', 'prices', 'estimate', 'schedule'])) === 'question');
  ok('established', 'once he has answered, the card stays to the end', kind({ answer: 'unsure' }, sig(['company', 'prices', 'estimate', 'schedule', 'daily', 'invoice'])) === 'path');
  ok('established', 'the question waits for the account\'s lists to load', kind({}, sig([], ['company', 'estimate'])) === 'none' && kind({}, sig([], ['send'])) === 'question');
  ok('hide', 'someone who closed the old card starts with the one row, not a full card',
    safe(() => core.parseStored(null, true).hidden, false) === true && safe(() => core.parseStored(null, false).hidden, true) === false
    && kind(core.parseStored(null, true), sig([])) === 'hidden');
  // what is saved
  const junk = safe(() => core.parseStored('{"answer":"stripe","skipped":["stripe","company","company",7],"hidden":"yes","removed":1}'), stored({ removed: true }));
  ok('hide', 'unreadable saved state is treated as nothing saved',
    junk.answer === null && junk.skipped.join() === 'company' && junk.hidden === false && junk.removed === false
    && safe(() => core.parseStored('not json').answer, 'x' as never) === null);
  const round = core.skipStep(core.answerQuestion(stored(), 'site'), 'send');
  ok('hide', 'saved state round-trips', safe(() => JSON.stringify(core.parseStored(core.serializeStored(round))), '') === JSON.stringify(round));
  ok('hide', 'Skip is per step and can be undone',
    core.skipStep(stored(), 'send').skipped.join() === 'send' && core.skipStep(core.skipStep(stored(), 'send'), 'send').skipped.length === 1
    && core.unskipStep(core.skipStep(stored(), 'send'), 'send').skipped.length === 0);

  // Show Me First
  const showBase = { done: false, persona: 'contractor' as const, fieldOnly: false, progress: PROGRESS, canAccess: ALL, practicePass: true };
  const WITH: REAL.FirstJobStepId[] = ['estimate', 'send', 'schedule', 'daily', 'invoice'];
  const WITHOUT: REAL.FirstJobStepId[] = ['company', 'prices'];
  for (const s of WITH) {
    const m = safe(() => core.showMeFor(s, showBase), null);
    ok('show-me', `${s}: "Show Me First" opens a tutorial that exists`, !!m && m.kind === 'offer' && !!TUTORIAL_DEFS[m.tutorialId] && m.tutorialId === core.STEP_META[s].tutorial);
  }
  for (const s of WITHOUT) {
    ok('show-me', `${s}: no tutorial, no button`, core.STEP_META[s].tutorial === null && safe(() => core.showMeFor(s, showBase), { kind: 'offer' } as never) === null);
  }
  ok('show-me', 'the five tutorials are the ones named',
    WITH.map((s) => core.STEP_META[s].tutorial).join() === 'estimate-first,contract-from-estimate,schedule-say-it,daily-report-voice,invoice-to-self');
  ok('show-me', 'a done step offers nothing', WITH.every((s) => safe(() => core.showMeFor(s, { ...showBase, done: true }), { kind: 'offer' } as never) === null));
  ok('show-me', 'a property owner or manager is offered nothing',
    WITH.every((s) => safe(() => core.showMeFor(s, { ...showBase, persona: 'client' }), { kind: 'offer' } as never) === null
      && safe(() => core.showMeFor(s, { ...showBase, persona: 'property_manager' }), { kind: 'offer' } as never) === null));
  ok('show-me', 'with the practice pass off, a tutorial his plan would paywall is not offered',
    safe(() => core.showMeFor('invoice', { ...showBase, canAccess: PRO_ONLY, practicePass: false }), { kind: 'offer' } as never) === null
    && safe(() => core.showMeFor('invoice', { ...showBase, canAccess: PRO_ONLY, practicePass: true })?.kind, 'x') === 'offer');
  ok('show-me', 'practising is remembered as practised, never as done',
    safe(() => core.showMeFor('daily', { ...showBase, progress: { byId: { 'daily-report-voice': { status: 'practised' } } } as never })?.kind, 'x') === 'practised');

  // paid plans
  const cost = (s: REAL.FirstJobStepId, can: (f: FeatureKey) => boolean, left: number | null = 2) =>
    safe(() => core.stepCost(s, { canAccess: can, freeEstimatesLeft: left }), { kind: 'free' } as REAL.FirstJobCost);
  ok('paid', 'on a free plan Add Your Prices says Pro before the tap', JSON.stringify(cost('prices', PRO_ONLY)) === '{"kind":"locked","plan":"pro"}');
  ok('paid', 'on a free plan Send Your First Invoice says Pro before the tap', JSON.stringify(cost('invoice', PRO_ONLY)) === '{"kind":"locked","plan":"pro"}');
  ok('paid', 'on a free plan the proposal says Pro before the tap', JSON.stringify(cost('send', PRO_ONLY)) === '{"kind":"locked","plan":"pro"}');
  ok('paid', 'the free AI estimates show their count', JSON.stringify(cost('estimate', PRO_ONLY, 2)) === '{"kind":"metered","left":2,"plan":"pro"}'
    && JSON.stringify(cost('estimate', PRO_ONLY, null)) === '{"kind":"metered","left":null,"plan":"pro"}');
  ok('paid', 'with none left the estimate says Pro before the tap', JSON.stringify(cost('estimate', PRO_ONLY, 0)) === '{"kind":"locked","plan":"pro"}');
  ok('paid', 'free steps and paid plans show no lock',
    cost('company', PRO_ONLY).kind === 'free' && cost('schedule', PRO_ONLY).kind === 'free' && cost('daily', PRO_ONLY).kind === 'free'
    && STEPS.every((s) => cost(s, ALL).kind === 'free'));
  ok('paid', 'each gate is a real feature key, and the AI steps are marked',
    STEPS.every((s) => core.STEP_META[s].gate === null || core.STEP_META[s].gate! in REQUIRED_TIER)
    && core.STEP_META.estimate.ai === true && core.STEP_META.schedule.ai === true && core.STEP_META.company.ai === false);

  // where the button goes
  const P = (id: string, hasEstimate: boolean, hasSchedule: boolean, updatedAt: number): REAL.FirstJobProject => ({ id, hasEstimate, hasSchedule, updatedAt });
  const tgt = (s: REAL.FirstJobStepId, projects: REAL.FirstJobProject[], canProposal = true) =>
    safe(() => JSON.stringify(core.stepTarget(s, { projects, canProposal })), 'throw');
  ok('target', 'a step that lives inside a project never opens its screen without one',
    ['schedule', 'daily', 'invoice'].every((s) => tgt(s as REAL.FirstJobStepId, []) === '{"to":"createProject"}'));
  ok('target', 'Send with no estimate sends him to price a job first', tgt('send', [P('a', false, false, 1)]) === '{"to":"estimateFirst"}' && tgt('send', []) === '{"to":"estimateFirst"}');
  ok('target', 'Send with an estimate: the proposal on a paid plan, the free PDF share otherwise',
    tgt('send', [P('a', true, false, 1)], true) === '{"to":"proposal","projectId":"a"}'
    && tgt('send', [P('a', true, false, 1)], false) === '{"to":"projectEstimate","projectId":"a"}');
  ok('target', 'the schedule step picks a project that has none yet; the others pick the newest',
    tgt('schedule', [P('a', true, true, 9), P('b', true, false, 1)]) === '{"to":"schedule","projectId":"b"}'
    && tgt('daily', [P('a', true, true, 9), P('b', true, false, 1)]) === '{"to":"daily","projectId":"a"}'
    && tgt('invoice', [P('a', true, true, 1), P('b', true, false, 9)]) === '{"to":"invoice","projectId":"b"}');
  ok('target', 'the first three steps need no project', tgt('company', []) === '{"to":"company"}' && tgt('prices', []) === '{"to":"prices"}' && tgt('estimate', []) === '{"to":"estimate"}');

  // who sees it
  const aud = (enabled: boolean, persona: 'contractor' | 'both' | 'client' | 'property_manager' | null, fieldOnly = false) =>
    safe(() => core.audienceFor({ enabled, persona, fieldOnly }), 'throw' as string);
  ok('persona', 'contractor, both, and a role not chosen yet: the path', aud(true, 'contractor') === 'path' && aud(true, 'both') === 'path' && aud(true, null) === 'path');
  ok('persona', 'an invited field seat keeps the card he had', aud(true, 'contractor', true) === 'legacy' && aud(true, 'both', true) === 'legacy');
  ok('persona', 'a property owner or manager is shown no contractor steps',
    aud(true, 'client') === 'none' && aud(true, 'property_manager') === 'none' && aud(true, 'client', true) === 'none');
  ok('flag', 'kill switch off: everyone gets the old card',
    aud(false, 'contractor') === 'legacy' && aud(false, 'both') === 'legacy' && aud(false, null) === 'legacy'
    && aud(false, 'contractor', true) === 'legacy' && aud(false, 'client') === 'legacy' && aud(false, 'property_manager') === 'legacy');

  // storage keys
  const keys = [safe(() => core.firstJobStateKey('user-1'), ''), safe(() => core.firstJobSentKey('user-1'), '')];
  ok('storage', 'both keys are under a prefix the app owns', keys.every((k) => isAppStorageKey(k) && k.startsWith('mageid_')), keys.join());
  ok('storage', 'both keys are removed by the tenant-switch sweep', selectTenantKeysToWipe(keys).length === 2, keys.join());
  ok('storage', 'both keys are per user', keys.every((k) => k.endsWith('user-1')) && core.firstJobStateKey('a') !== core.firstJobStateKey('b') && keys[0] !== keys[1]);

  return out;
}

// ── B. the wiring ───────────────────────────────────────────────────────────

const EVENTS = [
  'FIRST_JOB_QUESTION_ANSWERED', 'FIRST_JOB_STEP_OPENED', 'FIRST_JOB_STEP_DONE', 'FIRST_JOB_STEP_SKIPPED',
  'FIRST_JOB_HIDDEN', 'FIRST_JOB_REMOVED', 'FIRST_JOB_FINISHED',
] as const;
const EVENT_PROPS = new Set(['answer', 'step', 'position', 'by', 'out_of_order', 'done_count', 'skipped_count']);

function wiringChecks(files: Files): Check[] {
  const out: Check[] = [];
  const ok = (rule: string, name: string, pass: boolean, detail = '') => out.push({ rule, name, pass, detail });
  const card = code(files.card);
  const views = code(files.views);
  const copy = code(files.copy);
  const signals = code(files.signals);
  const store = code(files.store);
  const core = code(files.core);
  const home = code(files.home);
  const flags = code(files.flags);
  const drawn = [['card', card], ['views', views]] as const;
  const mine = [...drawn, ['copy', copy], ['signals', signals], ['store', store], ['core', core]] as const;

  for (const [n, src] of mine) {
    ok('reanimated', `${n}: no react-native-reanimated`, !/reanimated/i.test(src));
  }
  ok('reanimated', 'the path is drawn with React Native Animated and the motion core',
    /import \{[^}]*\bAnimated\b[^}]*\} from 'react-native'/.test(card) && /from '@\/components\/ui\/motion'/.test(card)
    && /from '@\/components\/ui\/motion'/.test(views));
  ok('reanimated', 'Reduce Motion is read wherever something travels',
    /useReducedMotion\(\)/.test(card) && /useReducedMotion\(\)/.test(views)
    && /if \(reduce\) \{ enter\.setValue\(1\); return; \}/.test(card)
    && /if \(!filled \|\| !live \|\| reduce\) \{ v\.setValue\(filled \? 1 : 0\); return; \}/.test(views));
  ok('reanimated', 'every animation passes the motion core\'s driver, never a literal',
    [card, views].every((s) => !/useNativeDriver:\s*(true|false)/.test(s))
    && (card.match(/useNativeDriver: nativeDriver/g) ?? []).length >= 1 && (views.match(/useNativeDriver: nativeDriver/g) ?? []).length >= 1);

  // the pure core stays pure
  ok('pure', 'utils/firstJobPath.ts imports no React, React Native, storage or network',
    !/from ['"](react|react-native|expo-[a-z-]+|@react-native-async-storage\/async-storage|@\/lib\/supabase|@tanstack\/react-query)['"]/.test(core)
    && !/AsyncStorage|supabase|fetch\(/.test(core));

  // done only from data: nothing in the drawn card can write a signal
  for (const [n, src] of drawn) {
    ok('data-only', `${n}: never writes the "sent" mark or any storage itself`,
      !/markEstimateSent|firstJobSentKey|AsyncStorage/.test(src));
  }
  ok('data-only', 'the card takes its signals from useFirstJobSignals and its view from buildView',
    /const \{ signals, projects \} = useFirstJobSignals\(\{/.test(card)
    && /buildView\(stored, signals, \{ selected, finishLive \}\)/.test(card)
    && !/signals\[[^\]]+\]\s*=[^=]/.test(card) && !/signals\.\w+\s*=[^=]/.test(card));
  ok('data-only', 'the signals hook has no setter a tap could reach: it returns signals and projects only',
    /return useMemo\(\(\) => \(\{ signals, projects: reduced \}\), \[signals, reduced\]\);/.test(signals)
    && /signalsFromData\(\{/.test(signals));
  ok('data-only', 'sample jobs and shared jobs are left out (the same set the free-plan cap counts)',
    /projects\.filter\(\(p\) => countsTowardFreeCap\(p, userId\)\)/.test(signals));
  // Whose share counts is a rule in the core (tested by behaviour in A); here:
  // the one place that writes the mark asks that rule first, and every caller
  // says what was shared.
  const storeCode = code(store);
  const markBody = storeCode.slice(storeCode.indexOf('export async function markEstimateSent('), storeCode.indexOf('export async function readEstimateSent('));
  ok('own-work', 'the "sent" mark has one writer, and it asks estimateSentCounts before it writes',
    (storeCode.match(/setItem\(firstJobSentKey\(/g) ?? []).length === 1
    && /^export async function markEstimateSent\(project: FirstJobSharedProject \| null\)/.test(markBody)
    && markBody.indexOf('if (!userId || !estimateSentCounts(project, userId)) return;') > 0
    && markBody.indexOf('if (!userId || !estimateSentCounts(project, userId)) return;') < markBody.indexOf('setItem(firstJobSentKey('));
  const callers = sentMarkCallers();
  ok('own-work', 'the mark is written from exactly the three shares (a new caller must be added here with its ownership proof)',
    callers.join() === [F.estFull, F.estReview, F.detail].sort().join(), callers.join());
  const argsOf = { detail: sentMarkArgs(files.detail), estFull: sentMarkArgs(files.estFull), estReview: sentMarkArgs(files.estReview) };
  ok('own-work', 'no share writes the mark without saying what was shared',
    Object.values(argsOf).every((a) => a.length === 1 && a[0] !== ''), JSON.stringify(argsOf));
  ok('own-work', 'the project page hands over the project it shared, so a job shared with him or a sample writes nothing',
    argsOf.detail.join() === 'project');
  ok('own-work', 'the emailed estimate hands over the job it was opened from; a job no longer in his list counts for nothing',
    argsOf.estFull.join() === 'sharedFrom'
    && /const sharedFrom = selectedProjectId \? projects\.find\(\(p\) => p\.id === selectedProjectId\) : null;\s*if \(sharedFrom !== undefined\) void markEstimateSent\(sharedFrom\);/.test(code(files.estFull)));
  ok('own-work', 'the copied proposal link is the estimate built on this phone (no project), and the screen knows no project',
    argsOf.estReview.join() === 'null' && !/useLocalSearchParams|selectedProjectId/.test(code(files.estReview)));
  ok('data-only', 'a failed proposal read throws (so it is "could not check", not "none")',
    /if \(error\) throw new Error\(error\.message\);/.test(store) && /contractsQ\.isError && !contractsQ\.isFetching \? 'failed'/.test(signals));
  ok('quiet', 'the proposal read waits until he is on the path, and is re-asked at most once a minute',
    /active: stored\.answer !== null,/.test(card)
    && /const contractsEnabled = a\.active && !!userId && projectsLoaded && real\.length > 0 && !sentElsewhere;/.test(signals)
    && /const contractsAt = Math\.max\(contractsQ\.dataUpdatedAt \|\| 0, contractsQ\.errorUpdatedAt \|\| 0\);/.test(signals)
    && /if \(Date\.now\(\) - contractsAt > SENT_RECHECK_MS\) void refetchContracts\(/.test(signals));
  ok('quiet', 'a proposal read that failed is not asked again on every return to Home, and one on its way is never restarted',
    /if \(!contractsEnabled \|\| contractsFetching\) return;/.test(signals)
    && /void refetchContracts\(\{ cancelRefetch: false \}\);/.test(signals));
  ok('quiet', 'the proposal read asks for his own rows by name, so other rows he can see cannot use up the limit',
    /\.from\('project_contracts'\)\s*\.select\('project_id'\)\s*\.eq\('user_id', userId\)\s*\.in\('status', \['sent', 'signed'\]\)\s*\.limit\(200\)/.test(store)
    && /queryFn: \(\) => fetchSentContractProjectIds\(userId as string\),/.test(signals));
  ok('data-only', 'practising a tutorial starts the tutorial and touches nothing else',
    /void startTutorial\(openShowMe\.tutorialId, \{ entry: 'checklist' \}\);/.test(card));

  // Every hook that reads (prices, storage, the AI count, the proposal read)
  // lives in the body or in the signals hook the body calls; the outer card
  // holds none of them, so not mounting the body stops all of it.
  const cardCode = code(card);
  const outer = cardCode.slice(cardCode.indexOf('function FirstJobPathCard('), cardCode.indexOf('function FirstJobPathBody('));
  ok('remove', 'a removed card mounts nothing: no data is read and nothing is asked of the network',
    /if \(!stored \|\| stored\.removed \|\| retired\) return null;\s*return <FirstJobPathBody /.test(outer)
    && !/useFirstJobSignals|useFocusEffect|useQuery|getFreeTrialsRemaining|useCostSeeds|useTierAccess/.test(outer));
  ok('retire', 'a card that can never show again mounts nothing: finished on an earlier visit, established, or finished while hidden',
    /if \(!stored \|\| stored\.removed \|\| retired\) return null;/.test(outer)
    && /if \(s\.finishShown\) setRetired\(true\);/.test(outer)
    && /const retires = viewRetiresCard\(view\);\s*useEffect\(\(\) => \{ if \(retires\) onRetire\(\); \}, \[retires, onRetire\]\);/.test(cardCode));
  ok('retire', 'a different person signing in is looked at afresh',
    /setStored\(null\);\s*setRetired\(false\);/.test(outer));
  ok('finish', 'the finish state is retired when Home goes out of view, or when he closes it',
    /useFocusEffect\(useCallback\(\(\) => \{\s*if \(!finishLive\) return;\s*return \(\) => onRetire\(\);\s*\}, \[finishLive, onRetire\]\)\);/.test(cardCode)
    && /onClose=\{\(\) => \{ tap\(\); layoutNext\(\); onRetire\(\); \}\}/.test(cardCode));
  ok('tick-once', 'played ticks are dropped when Home goes out of view and on Hide, so a reopened card does not replay them',
    /useFocusEffect\(useCallback\(\(\) => clearTicks, \[clearTicks\]\)\);/.test(cardCode)
    && /setMenuOpen\(false\);\s*clearTicks\(\);\s*commit\(hidePath\);/.test(cardCode));
  ok('create', 'the card on Home opens Home\'s own create sheet; it does not push Home onto Home',
    /if \(target\.to === 'createProject' && onStartCreate\) \{ tap\(\); onStartCreate\(\); return; \}/.test(cardCode)
    && /onPrimary=\{\(\) => goTarget\(target\)\}/.test(cardCode)
    && /const startCreateFromFirstJob = useCallback\(\(\) => startCreate\(null\), \[startCreate\]\);/.test(files.home)
    && /onStartCreate=\{startCreateFromFirstJob\}/.test(files.home));
  ok('create', 'Home\'s /?openCreate=1 guard is re-armed once the param is cleared, so the second one of a session still opens the sheet',
    /if \(!openCreate\) \{ openCreateConsumed\.current = false; return; \}/.test(files.home));

  // storage
  ok('storage', 'the store builds its keys only from the two key functions',
    (store.match(/AsyncStorage\.(setItem|getItem|removeItem)\(/g) ?? []).length === (store.match(/AsyncStorage\.(setItem|getItem|removeItem)\((firstJobStateKey|firstJobSentKey)\(userId\)|AsyncStorage\.getItem\(LEGACY_DISMISSED_KEY\)/g) ?? []).length
    && !/AsyncStorage\.(clear|multiRemove)/.test(store));
  ok('storage', 'the old card\'s dismissed flag is read, never written',
    /const LEGACY_DISMISSED_KEY = 'mageid_onboarding_checklist_dismissed_v2';/.test(store) && !/setItem\(LEGACY_DISMISSED_KEY/.test(store));
  const literalKeys = [...core.matchAll(/'((?:mageid|mage|buildwise|tertiary)_[a-z_:]+)'/g)].map((m) => m[1]);
  ok('storage', 'every key literal in the core is under mageid_', literalKeys.length === 2 && literalKeys.every((k) => k.startsWith('mageid_first_job_')), literalKeys.join());

  // no nagging, theme only, icons, tiers
  for (const [n, src] of drawn) {
    ok('quiet', `${n}: no pop-up, no notification, no badge`,
      !/\bAlert\b|showAlert|confirmAsync|expo-notifications|Notifications\.|setBadgeCount|<Modal\b/.test(src));
    ok('look', `${n}: no hard-coded colour, no gradient, no emoji`,
      !/#[0-9a-fA-F]{3,8}\b/.test(src) && !/rgba?\(/.test(src) && !/LinearGradient|expo-linear-gradient/.test(src)
      && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(src));
    ok('look', `${n}: Lucide icons only`, !/@expo\/vector-icons/.test(src));
    ok('paid', `${n}: no raw RevenueCat or subscription read`, !/react-native-purchases|useSubscription|Purchases\./.test(src));
    ok('look', `${n}: no user-facing string outside the copy hook`,
      !/<Text[^>]*>\s*[A-Za-z][^<{]*<\/Text>/.test(src) && !/accessibilityLabel="[A-Za-z]/.test(src) && !/\bt\('|\btn\('/.test(src));
  }
  ok('look', 'the accent is never the card\'s own background', /\.\.\.cardSurface\(t, \{ pad: 14 \}\)/.test(card) && !/card: \{[^}]*backgroundColor: t\.accent/.test(card));
  ok('paid', 'the plan gate goes through hooks/useTierAccess', /const \{ canAccess, isFree \} = useTierAccess\(\);/.test(card) && /stepCost\(step\.id, \{ canAccess, freeEstimatesLeft \}\)/.test(card));
  ok('paid', 'a locked step shows the lock and the plan on the collapsed row and on the button',
    /<Lock size=\{11\}/.test(views) && /copy\.planLabel\(p\.tagPlan\)/.test(views) && /\{locked \? <Lock size=\{14\}/.test(views)
    && /if \(cost\.kind === 'locked'\) notes\.push\(copy\.lockedNote\(cost\.plan\)\);/.test(card)
    && /if \(cost\.kind === 'metered'\) notes\.push\(copy\.meteredNote\(cost\.left, cost\.plan\)\);/.test(card));
  ok('paid', 'AI steps say that MAGE drafts and the person checks', /if \(STEP_META\[step\.id\]\.ai \|\| target\.to === 'estimateFirst'\) notes\.push\(copy\.aiNote\);/.test(card));
  ok('stripe', 'Stripe is a side note under the invoice step, drawn only there', /showStripe=\{step\.open && step\.id === 'invoice'\}/.test(card) && /p\.showStripe \?/.test(views));

  // analytics
  const an = code(files.analytics);
  for (const e of EVENTS) {
    ok('analytics', `${e} is defined and fired`, new RegExp(`${e}: 'first_job_[a-z_]+'`).test(an) && card.includes(`track(AnalyticsEvents.${e},`));
  }
  const props = [...card.matchAll(/track\(AnalyticsEvents\.FIRST_JOB_[A-Z_]+,\s*\{([\s\S]*?)\}\);/g)]
    .flatMap((m) => [...m[1].matchAll(/(?:^|[,{\n])\s*([a-z_A-Z]+)(?=\s*(?::|,|$))/g)].map((k) => k[1]));
  ok('analytics', 'no personal data: every property is a step id, an answer id or a count',
    props.length >= 10 && props.every((p) => EVENT_PROPS.has(p)), props.filter((p) => !EVENT_PROPS.has(p)).join());
  ok('analytics', 'a step is counted done when Home SEES it done, inside the focus effect',
    /const fresh = freshlyDone\(signals, seenDone\.current, seenOpen\.current\);/.test(card)
    && /const outOfOrder = isOutOfOrder\(id, cur, \{ \.\.\.signals, \[id\]: false \}\);/.test(card) && /out_of_order: outOfOrder,/.test(card));

  // Home, flag, old card
  ok('flag', 'FIRST_JOB_PATH_ENABLED is true', /export const FIRST_JOB_PATH_ENABLED = true;/.test(flags));
  ok('flag', 'Home mounts the new card where the old one sat, with the old card\'s props',
    /import \{ FirstJobPath \} from '@\/components\/FirstJobPath';/.test(home)
    && /const onboardingChecklistCard = \(\s*<FirstJobPath\s/.test(home)
    && !/<OnboardingChecklist\b/.test(home)
    && (home.match(/\{onboardingChecklistCard\}/g) ?? []).length === 2
    && /projectCount=\{realProjectCount\}/.test(home) && /estimateCount=\{estimateCount\}/.test(home) && /invoiceCount=\{realInvoiceCount\}/.test(home));
  ok('flag', 'the old card is still in the repo and still what the switch falls back to',
    /export const OnboardingChecklist = memo\(OnboardingChecklistImpl\);/.test(code(files.old))
    && /audienceFor\(\{ enabled: FIRST_JOB_PATH_ENABLED, persona: userRole, fieldOnly \}\)/.test(card)
    && /if \(audience === 'legacy'\) return <OnboardingChecklist \{\.\.\.props\} \/>;/.test(card)
    && /if \(audience === 'none'\) return null;/.test(card));
  ok('persona', 'a field seat is found the way the tutorials find one', /isFieldOnlyUser\(projects, user\?\.id \?\? null\)/.test(card));

  // the gate runs this file
  const pkg = JSON.parse(files.pkg) as { scripts: Record<string, string> };
  ok('gate', 'test:first-job-path is registered and in ship-check',
    pkg.scripts['test:first-job-path'] === 'bun run scripts/validate-first-job-path.ts'
    && / && bun run test:first-job-path(?: &&|$)/.test(pkg.scripts['ship-check'] ?? ''));

  return out;
}

// ── C. the words ────────────────────────────────────────────────────────────

const forms = (v: Words[string]): string[] => (typeof v === 'string' ? [v] : [v.zero, v.one, v.many, v.other].filter((x): x is string => !!x));
const placeholders = (s: string): string => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort().join();

function wordChecks(en: Words, es: Words): Check[] {
  const out: Check[] = [];
  const ok = (rule: string, name: string, pass: boolean, detail = '') => out.push({ rule, name, pass, detail });
  const keys = Object.keys(en).sort();
  const all = keys.flatMap((k) => forms(en[k]).map((s) => [k, s] as const));
  const bad = (re: RegExp) => all.filter(([, s]) => re.test(s)).map(([k]) => k).join(', ');

  ok('words', 'every key is under office.firstJob.', keys.length >= 80 && keys.every((k) => k.startsWith('office.firstJob.')));
  ok('words', 'no em dash or en dash', bad(/[—–]/) === '', bad(/[—–]/));
  ok('words', 'no "&"', bad(/&/) === '', bad(/&/));
  ok('words', 'no "e.g." or "i.e."', bad(/\b(e\.g\.|i\.e\.)/i) === '', bad(/\b(e\.g\.|i\.e\.)/i));
  ok('words', 'no arrows', bad(/[→←↑↓➜➔]|->|=>/) === '', bad(/[→←↑↓➜➔]|->|=>/));
  ok('words', 'never "unlimited"', bad(/unlimited|no limit|limitless/i) === '', bad(/unlimited|no limit|limitless/i));
  const PROMISE = /\b(accura\w*|exact\w*|precise\w*|guarantee\w*|always right|never wrong|perfect\w*|100%)/i;
  ok('words', 'no accuracy promise', bad(PROMISE) === '', bad(PROMISE));
  ok('words', 'pay apps are never bare "AIA"', bad(/\bAIA\b(?!-style)/i) === '', bad(/\bAIA\b(?!-style)/i));
  ok('words', 'no exclamation marks, no emoji, no "..."', bad(/!|\.\.\.|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u) === '', bad(/!|\.\.\.|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u));
  ok('words', 'no filler ("just", "simply", "easily") and no "please"', bad(/\b(just|simply|easily|please)\b/i) === '', bad(/\b(just|simply|easily|please)\b/i));

  // labels: every word capitalised
  const labelKeys = keys.filter((k) => /Label$/.test(k));
  const notTitle = labelKeys.filter((k) => forms(en[k]).some((s) => s.split(/\s+/).some((w) => !/^["'(]*([A-Z0-9{]|$)/.test(w))));
  ok('words', `labels (${labelKeys.length}) have every word capitalised`, labelKeys.length >= 40 && notTitle.length === 0, notTitle.join(', '));
  const labelPeriod = labelKeys.filter((k) => forms(en[k]).some((s) => /\.\s*$/.test(s)));
  ok('words', 'a label does not end with a period', labelPeriod.length === 0, labelPeriod.join(', '));
  // sentences
  const sentenceKeys = keys.filter((k) => /(Body|Note|\.body|\.question|\.a11y)$/.test(k));
  const notSentence = sentenceKeys.filter((k) => forms(en[k]).some((s) => !/^[A-Z0-9{]/.test(s) || !/[.?]$/.test(s)));
  ok('words', `sentences (${sentenceKeys.length}) start with a capital and end with a period or a question mark`,
    sentenceKeys.length >= 20 && notSentence.length === 0, notSentence.join(', '));
  const stepBodies = keys.filter((k) => /^office\.firstJob\.step\.[a-z]+Body$/.test(k));
  const notTwo = stepBodies.filter((k) => (String(en[k]).match(/[.?](\s|$)/g) ?? []).length !== 2);
  ok('words', 'each of the seven steps says why in exactly two sentences', stepBodies.length === 7 && notTwo.length === 0, notTwo.join(', '));
  const subKeys = keys.filter((k) => /Sub$/.test(k));
  const badSub = subKeys.filter((k) => forms(en[k]).some((s) => !/^[A-Z]/.test(s) || /\.$/.test(s)));
  ok('words', 'captions start with a capital and carry no period', subKeys.length >= 9 && badSub.length === 0, badSub.join(', '));

  // the exact names the founder was shown
  const want: Record<string, string> = {
    'office.firstJob.headingLabel': 'Your First Job',
    'office.firstJob.question.titleLabel': 'What Do You Want To Do First?',
    'office.firstJob.answer.priceLabel': 'Price A Job',
    'office.firstJob.answer.scheduleLabel': 'Schedule A Job',
    'office.firstJob.answer.billLabel': 'Bill A Client',
    'office.firstJob.answer.siteLabel': 'Run The Site',
    'office.firstJob.answer.unsureLabel': 'Not Sure. Show Me The Usual Order',
    'office.firstJob.step.companyLabel': 'Add Your Company Name',
    'office.firstJob.step.pricesLabel': 'Add Your Prices',
    'office.firstJob.step.estimateLabel': 'Price Your First Job',
    'office.firstJob.step.sendLabel': 'Send It To Your Client',
    'office.firstJob.step.scheduleLabel': 'Build The Schedule',
    'office.firstJob.step.dailyLabel': 'Log One Day On Site',
    'office.firstJob.step.invoiceLabel': 'Send Your First Invoice',
    'office.firstJob.stage.winLabel': 'Win It',
    'office.firstJob.stage.planLabel': 'Plan It',
    'office.firstJob.stage.buildLabel': 'Build It',
    'office.firstJob.stage.paidLabel': 'Get Paid',
    'office.firstJob.stage.closeLabel': 'Close It',
    'office.firstJob.showMeLabel': 'Show Me First',
    'office.firstJob.skipLabel': 'Skip',
    'office.firstJob.hideLabel': 'Hide',
    'office.firstJob.removeLabel': 'Remove',
    'office.firstJob.finish.titleLabel': 'You Ran A Whole Job',
    'office.firstJob.hiddenRowLabel': 'Your First Job: {done} Of {total} Done',
    'office.firstJob.ring.text': '{done} of {total}',
  };
  const wrong = Object.keys(want).filter((k) => en[k] !== want[k]);
  ok('words', 'the names are the ones in the spec', wrong.length === 0, wrong.join(', '));
  ok('stripe', 'Stripe has no step name and no step button, only the side note',
    !keys.some((k) => /\.(step|cta|answer|stage)\.[a-z]*stripe/i.test(k))
    && keys.filter((k) => /stripe/i.test(k)).sort().join() === 'office.firstJob.note.stripeNote,office.firstJob.stripeLinkLabel'
    && all.filter(([, s]) => /stripe/i.test(s)).every(([k]) => /stripe/i.test(k)));
  ok('paid', 'the AI note says MAGE drafts and the person checks every line',
    /MAGE drafts/.test(String(en['office.firstJob.note.aiNote'])) && /you check every line/.test(String(en['office.firstJob.note.aiNote'])));
  ok('paid', 'the locked and metered notes name the plan', ['lockedNote', 'meteredNote', 'meteredUnknownNote', 'sendFreeNote']
    .every((k) => forms(en[`office.firstJob.note.${k}`] ?? '').every((s) => s.includes('{plan}'))));

  // Spanish
  const esKeys = Object.keys(es).sort();
  ok('spanish', 'English and Spanish key sets are equal', keys.join() === esKeys.join(),
    `missing: ${keys.filter((k) => !(k in es)).join(', ')} extra: ${esKeys.filter((k) => !(k in en)).join(', ')}`);
  const phBad = keys.filter((k) => k in es && forms(en[k]).length === forms(es[k]).length
    ? forms(en[k]).some((s, i) => placeholders(s) !== placeholders(forms(es[k])[i])) : k in es);
  ok('spanish', 'each Spanish string carries the same placeholders and the same plural forms', phBad.length === 0, phBad.join(', '));
  const esAll = esKeys.flatMap((k) => forms(es[k]).map((s) => [k, s] as const));
  const esBad = esAll.filter(([, s]) => /[—–&!→←]|\.\.\.|ilimitad|\bexact|\bprecis[oa]|garantiz/i.test(s) || !s.trim()).map(([k]) => k);
  ok('spanish', 'the Spanish keeps the same rules (no dash, "&", arrows, "ilimitado", accuracy promise)', esBad.length === 0, esBad.join(', '));
  const same = keys.filter((k) => k in es && JSON.stringify(es[k]) === JSON.stringify(en[k]) && !/^\{[a-z]+\} of \{[a-z]+\}$/.test(String(en[k])));
  ok('spanish', 'the Spanish is a translation, not the English copied over', same.length === 0, same.join(', '));

  return out;
}

function registryChecks(): Check[] {
  const s = SURFACES.find((x) => x.id === 'office.first-job');
  return [
    { rule: 'spanish', name: 'the surface is registered, complete, and owns office.firstJob.',
      pass: !!s && s.state === 'complete' && s.keyPrefixes.join() === 'office.firstJob.' && s.files.join() === 'hooks/useFirstJobCopy.ts' },
    { rule: 'spanish', name: 'the English shard and the Spanish file are in their indexes',
      pass: EN_SHARDS['office.first-job'] === EN_REAL && ES_SHARDS['office/firstJob'] === ES_OFFICE_FIRST_JOB },
  ];
}

function runAll(core: Core, files: Files, en: Words, es: Words): Check[] {
  return [...ruleChecks(core), ...wiringChecks(files), ...wordChecks(en, es), ...registryChecks()];
}

// ── planted mutations ───────────────────────────────────────────────────────

type Mutation = { name: string; rule: string; core?: (c: Core) => Core; file?: [FileKey, (s: string) => string]; en?: (w: Words) => Words; es?: (w: Words) => Words };
const withCore = (patch: Partial<Core>): ((c: Core) => Core) => (c) => ({ ...c, ...patch });
const editView = (fn: (v: REAL.FirstJobView, s: REAL.FirstJobStored, g: REAL.FirstJobSignals, o: REAL.BuildViewOpts) => REAL.FirstJobView): ((c: Core) => Core) =>
  (c) => ({ ...c, buildView: (s, g, o = {}) => fn(c.buildView(s, g, o), s, g, o) });
const sub = (key: FileKey, from: string | RegExp, to: string): Mutation['file'] => [key, (s) => {
  const next = s.replace(from as string, to);
  if (next === s) throw new Error(`mutation anchor not found in ${F[key]}: ${String(from)}`);
  return next;
}];
const setWord = (k: string, v: string) => (w: Words): Words => {
  if (!(k in w)) throw new Error(`mutation key not found: ${k}`);
  return { ...w, [k]: v };
};

const MUTATIONS: Mutation[] = [
  // ordering
  { name: 'Bill A Client loses the schedule step', rule: 'order', core: (c) => ({ ...c, orderFor: (a) => (a === 'bill' ? c.orderFor(a).filter((s) => s !== 'schedule') : c.orderFor(a)) }) },
  { name: 'Run The Site lists the daily report twice', rule: 'order', core: (c) => ({ ...c, orderFor: (a) => (a === 'site' ? ['daily', ...c.USUAL_ORDER] : c.orderFor(a)) }) },
  { name: 'Price A Job leads with the estimate, ahead of prices', rule: 'prices-first', core: (c) => ({ ...c, orderFor: (a) => (a === 'price' ? ['estimate', ...c.USUAL_ORDER.filter((s) => s !== 'estimate')] : c.orderFor(a)) }) },
  { name: 'Schedule A Job reorders the rest of the path as well', rule: 'order', core: (c) => ({ ...c, orderFor: (a) => (a === 'schedule' ? ['schedule', 'invoice', 'daily', 'send', 'estimate', 'prices', 'company'] : c.orderFor(a)) }) },
  { name: 'the usual order puts pricing before prices', rule: 'prices-first', core: (c) => ({ ...c, orderFor: (a) => { const o = c.orderFor(a); const i = o.indexOf('prices'); const j = o.indexOf('estimate'); const n = [...o]; n[i] = 'estimate'; n[j] = 'prices'; return n; } }) },
  // Stripe
  { name: 'Stripe comes back as an eighth step', rule: 'stripe', core: (c) => ({ ...c, TOTAL_STEPS: 8, USUAL_ORDER: [...c.USUAL_ORDER, 'stripe' as never] }) },
  { name: 'the invoice step is drawn with Stripe under every step', rule: 'stripe', file: sub('card', "showStripe={step.open && step.id === 'invoice'}", 'showStripe={step.open}') },
  { name: 'a Stripe step name is added to the words', rule: 'stripe', en: (w) => ({ ...w, 'office.firstJob.step.stripeLabel': 'Connect Stripe' }), es: (w) => ({ ...w, 'office.firstJob.step.stripeLabel': 'Conectar Stripe' }) },
  // done only from data
  { name: 'company ticks with no company name', rule: 'data-only', core: (c) => ({ ...c, signalsFromData: (d) => ({ ...c.signalsFromData(d), company: true }) }) },
  { name: 'a sample job\'s invoice ticks the invoice step', rule: 'data-only', core: (c) => ({ ...c, signalsFromData: (d) => ({ ...c.signalsFromData(d), invoice: d.invoiceCount > 0 }) }) },
  { name: 'a skip is counted as done', rule: 'data-only', core: editView((v, s) => (v.kind === 'path' ? { ...v, done: v.done + s.skipped.length, steps: v.steps.map((x) => (x.status === 'skipped' ? { ...x, status: 'done' as const } : x)) } : v)) },
  { name: 'a saved "done" list is trusted', rule: 'data-only', core: (c) => ({ ...c, buildView: (s, g, o = {}) => c.buildView(s, (s as unknown as { done?: string[] }).done ? Object.fromEntries(Object.keys(g).map((k) => [k, true])) as REAL.FirstJobSignals : g, o), parseStored: (raw, legacy) => ({ ...c.parseStored(raw, legacy), ...(raw && raw.includes('"done"') ? { done: ['company'] } : {}) }) }) },
  { name: 'tapping a done step is treated as progress', rule: 'data-only', core: editView((v, _s, _g, o) => (v.kind === 'path' && o.selected ? { ...v, done: v.done + 1 } : v)) },
  { name: 'a list that loads done ticks as if he just did it', rule: 'data-only', core: (c) => ({ ...c, freshlyDone: (g, seenDone) => c.USUAL_ORDER.filter((id) => g[id] === true && !seenDone.has(id)) }) },
  { name: 'the card writes the "sent" mark itself on a tap', rule: 'data-only', file: sub('card', "import { loadFirstJobState, saveFirstJobState } from '@/utils/firstJobStore';", "import { loadFirstJobState, saveFirstJobState, markEstimateSent } from '@/utils/firstJobStore';") },
  { name: 'the card overwrites a signal', rule: 'data-only', file: sub('card', '  const tickBeats =', '  signals.send = true;\n  const tickBeats =') },
  { name: 'sample jobs are counted', rule: 'data-only', file: sub('signals', 'projects.filter((p) => countsTowardFreeCap(p, userId))', 'projects.filter(() => true)') },
  // whose share counts
  { name: 'a share from a job someone else owns counts', rule: 'own-work', core: withCore({ estimateSentCounts: (p, u) => !!u && (p === null || !p.name.startsWith('Sample — ')) }) },
  { name: 'a share from a sample job counts', rule: 'own-work', core: withCore({ estimateSentCounts: (p, u) => !!u && (p === null || !p.ownerUserId || p.ownerUserId === u) }) },
  { name: 'a share with nobody signed in counts', rule: 'own-work', core: (c) => ({ ...c, estimateSentCounts: (p, u) => c.estimateSentCounts(p, u ?? 'anyone') }) },
  { name: 'the store writes the "sent" mark without asking whose work it was', rule: 'own-work', file: sub('store', 'if (!userId || !estimateSentCounts(project, userId)) return;', 'if (!userId) return;') },
  { name: 'the project page shares with no project named', rule: 'own-work', file: sub('detail', 'void markEstimateSent(project);', 'void markEstimateSent(null);') },
  { name: 'the emailed estimate forgets the job it was opened from', rule: 'own-work', file: sub('estFull', 'if (sharedFrom !== undefined) void markEstimateSent(sharedFrom);', 'void markEstimateSent(null);') },
  { name: 'a share writes the mark with no argument', rule: 'own-work', file: sub('estReview', 'void markEstimateSent(null);', 'void markEstimateSent();') },
  // retired / finish / create
  { name: 'a finished card keeps its body (and every read) mounted', rule: 'retire', file: sub('card', 'if (!stored || stored.removed || retired) return null;', 'if (!stored || stored.removed) return null;') },
  { name: 'a finish seen on an earlier visit is not retired on load', rule: 'retire', file: sub('card', '      if (s.finishShown) setRetired(true);\n', '') },
  { name: 'an established account is never retired', rule: 'retire', core: withCore({ viewRetiresCard: () => false }) },
  { name: 'a card that is only loading is retired', rule: 'retire', core: withCore({ viewRetiresCard: (v) => v.kind === 'none' }) },
  { name: 'the next person on the phone inherits "retired"', rule: 'retire', file: sub('card', '    setRetired(false);\n', '') },
  { name: 'the finish card stays up after Home goes out of view', rule: 'finish', file: sub('card', '    return () => onRetire();\n', '') },
  { name: 'closing the finish card only hides it for this render', rule: 'finish', file: sub('card', 'onClose={() => { tap(); layoutNext(); onRetire(); }}', 'onClose={() => { tap(); layoutNext(); }}') },
  { name: 'Hide keeps the played ticks', rule: 'tick-once', file: sub('card', '    clearTicks();\n    commit(hidePath);', '    commit(hidePath);') },
  { name: 'the Create button pushes Home onto Home again', rule: 'create', file: sub('card', 'onPrimary={() => goTarget(target)}', 'onPrimary={() => go(hrefFor(target))}') },
  { name: 'Home does not hand the card its create sheet', rule: 'create', file: sub('home', '      onStartCreate={startCreateFromFirstJob}\n', '') },
  { name: 'the openCreate guard is never re-armed', rule: 'create', file: sub('home', 'if (!openCreate) { openCreateConsumed.current = false; return; }', 'if (!openCreate) return;') },
  { name: 'the proposal read is throttled on the last success only', rule: 'quiet', file: sub('signals', 'Math.max(contractsQ.dataUpdatedAt || 0, contractsQ.errorUpdatedAt || 0)', 'contractsQ.dataUpdatedAt || 0') },
  { name: 'a proposal read on its way is cancelled and restarted', rule: 'quiet', file: sub('signals', 'void refetchContracts({ cancelRefetch: false });', 'void refetchContracts();') },
  { name: 'the proposal read is not limited to his own rows', rule: 'quiet', file: sub('store', "    .eq('user_id', userId)\n", '') },
  // unknown
  { name: 'a failed proposal read is shown as "not sent"', rule: 'unknown', core: (c) => ({ ...c, signalsFromData: (d) => { const s = c.signalsFromData(d); return { ...s, send: s.send ?? false }; } }) },
  { name: 'a failed proposal read is shown as sent', rule: 'unknown', core: (c) => ({ ...c, signalsFromData: (d) => { const s = c.signalsFromData(d); return { ...s, send: d.contractsRead === 'failed' ? true : s.send }; } }) },
  { name: 'unloaded lists read as "not done"', rule: 'unknown', core: (c) => ({ ...c, signalsFromData: (d) => { const s = c.signalsFromData(d); return { ...s, company: s.company ?? false, estimate: s.estimate ?? false }; } }) },
  // one open step
  { name: 'two steps are open at once', rule: 'one-open', core: editView((v) => (v.kind === 'path' ? { ...v, steps: v.steps.map((x, i) => (i >= v.steps.length - 2 ? { ...x, open: true } : x)) } : v)) },
  { name: 'no step is open', rule: 'one-open', core: editView((v) => (v.kind === 'path' ? { ...v, steps: v.steps.map((x) => ({ ...x, open: false })) } : v)) },
  { name: 'a tapped later step is ignored', rule: 'one-open', core: (c) => ({ ...c, buildView: (s, g) => c.buildView(s, g, {}) }) },
  { name: '"next" is the last step, not the first one to do', rule: 'one-open', core: editView((v) => (v.kind === 'path' ? { ...v, nextId: v.steps[v.steps.length - 1].id } : v)) },
  // hide / remove / finish / established
  { name: 'Hide does nothing', rule: 'hide', core: (c) => ({ ...c, buildView: (s, g, o = {}) => c.buildView({ ...s, hidden: false }, g, o) }) },
  { name: 'the hidden row cannot be reopened', rule: 'hide', core: withCore({ showPath: (s) => s }) },
  { name: 'the hidden row reports the wrong count', rule: 'hide', core: editView((v) => (v.kind === 'hidden' ? { ...v, done: 0 } : v)) },
  { name: 'a closed old card is forgotten', rule: 'hide', core: (c) => ({ ...c, parseStored: (raw) => c.parseStored(raw, false) }) },
  { name: 'saved junk is trusted', rule: 'hide', core: withCore({ parseStored: (raw) => { try { return { ...REAL.EMPTY_STORED, ...(JSON.parse(raw ?? '{}') as object) } as REAL.FirstJobStored; } catch { return REAL.EMPTY_STORED; } } }) },
  { name: 'Remove only hides', rule: 'remove', core: (c) => ({ ...c, buildView: (s, g, o = {}) => (s.removed ? c.buildView({ ...s, removed: false, hidden: true }, g, o) : c.buildView(s, g, o)) }) },
  { name: 'a removed card still mounts and reads the account', rule: 'remove', file: sub('card', 'if (!stored || stored.removed || retired) return null;', 'if (!stored || retired) return null;') },
  { name: 'Remove is not saved', rule: 'remove', core: withCore({ removePath: (s) => ({ ...s, hidden: true }) }) },
  { name: 'reopening un-removes', rule: 'remove', core: withCore({ showPath: (s) => ({ ...s, hidden: false, removed: false }) }) },
  { name: 'the finish state comes back every visit', rule: 'finish', core: (c) => ({ ...c, buildView: (s, g, o = {}) => c.buildView({ ...s, finishShown: false }, g, o) }) },
  { name: 'the finish state shows with a step still to do', rule: 'finish', core: editView((v) => (v.kind === 'path' && v.done >= 6 ? { kind: 'finish', done: v.done, skipped: 0, total: 7 } : v)) },
  { name: 'skipped steps block the finish forever', rule: 'finish', core: editView((v, s) => (v.kind === 'finish' && s.skipped.length > 0 ? { kind: 'none', reason: 'finished' } : v)) },
  { name: 'the finish state vanishes during the visit it appears in', rule: 'finish', core: (c) => ({ ...c, buildView: (s, g, o = {}) => c.buildView(s, g, { ...o, finishLive: false }) }) },
  { name: 'established accounts are asked the question', rule: 'established', core: editView((v, s, g) => (v.kind === 'none' && v.reason === 'established' && !s.removed ? { kind: 'question', done: REAL.doneCount(g), total: 7 } : v)) },
  { name: 'the card leaves an engaged account at 5 of 7', rule: 'established', core: editView((v) => (v.kind === 'path' && v.done >= 5 ? { kind: 'none', reason: 'established' } : v)) },
  { name: 'the question flashes before the lists load', rule: 'established', core: editView((v, s) => (v.kind === 'none' && v.reason === 'loading' && !s.removed ? { kind: 'question', done: 0, total: 7 } : v)) },
  // Show Me First
  { name: '"Show Me First" on a step with no tutorial', rule: 'show-me', core: (c) => ({ ...c, showMeFor: (id, a, d) => c.showMeFor(id, a, d) ?? (a.done ? null : { kind: 'offer', tutorialId: 'estimate-first' }) }) },
  { name: 'a tutorial step loses its button', rule: 'show-me', core: (c) => ({ ...c, showMeFor: (id, a, d) => (id === 'schedule' ? null : c.showMeFor(id, a, d)) }) },
  { name: 'a done step still offers practice', rule: 'show-me', core: (c) => ({ ...c, showMeFor: (id, a, d) => c.showMeFor(id, { ...a, done: false }, d) }) },
  { name: 'a step points at a tutorial that does not exist', rule: 'show-me', core: (c) => ({ ...c, STEP_META: { ...c.STEP_META, daily: { ...c.STEP_META.daily, tutorial: 'not-a-tutorial' as never } }, showMeFor: (id, a, d) => (id === 'daily' && !a.done && a.persona === 'contractor' && !(a.progress as never as { byId: Record<string, unknown> }).byId['daily-report-voice'] ? { kind: 'offer', tutorialId: 'not-a-tutorial' as never } : c.showMeFor(id, a, d)) }) },
  { name: 'practice ignores the paywall when the practice pass is off', rule: 'show-me', core: (c) => ({ ...c, showMeFor: (id, a, d) => c.showMeFor(id, { ...a, practicePass: true }, d) }) },
  // paid
  { name: 'a paid step shows no lock on a free plan', rule: 'paid', core: withCore({ stepCost: () => ({ kind: 'free' }) }) },
  { name: 'the estimate hides that the free count ran out', rule: 'paid', core: (c) => ({ ...c, stepCost: (id, a) => (id === 'estimate' && a.freeEstimatesLeft === 0 ? { kind: 'metered', left: 0, plan: 'pro' } : c.stepCost(id, a)) }) },
  { name: 'the card reads the subscription directly', rule: 'paid', file: sub('card', "import { useTierAccess } from '@/hooks/useTierAccess';", "import { useTierAccess } from '@/hooks/useTierAccess';\nimport { useSubscription } from '@/contexts/SubscriptionContext';") },
  { name: 'the locked note is dropped', rule: 'paid', file: sub('card', "if (cost.kind === 'locked') notes.push(copy.lockedNote(cost.plan));", '') },
  { name: 'the AI note is dropped', rule: 'paid', file: sub('card', "if (STEP_META[step.id].ai || target.to === 'estimateFirst') notes.push(copy.aiNote);", '') },
  { name: 'the AI note stops saying the person checks', rule: 'paid', en: setWord('office.firstJob.note.aiNote', 'MAGE drafts this with AI. It counts toward the AI allowance on your plan.') },
  // target
  { name: 'the invoice button opens the invoice screen with no project', rule: 'target', core: (c) => ({ ...c, stepTarget: (id, a) => (id === 'invoice' && a.projects.length === 0 ? { to: 'invoice', projectId: '' } : c.stepTarget(id, a)) }) },
  { name: 'a free plan is sent to the paid proposal screen', rule: 'target', core: (c) => ({ ...c, stepTarget: (id, a) => c.stepTarget(id, { ...a, canProposal: true }) }) },
  // persona / flag
  { name: 'a property owner sees the contractor path', rule: 'persona', core: (c) => ({ ...c, audienceFor: (a) => (a.enabled && a.persona === 'client' ? 'path' : c.audienceFor(a)) }) },
  { name: 'a field seat sees the contractor path', rule: 'persona', core: (c) => ({ ...c, audienceFor: (a) => c.audienceFor({ ...a, fieldOnly: false }) }) },
  { name: 'the kill switch is ignored', rule: 'flag', core: (c) => ({ ...c, audienceFor: (a) => c.audienceFor({ ...a, enabled: true }) }) },
  { name: 'the kill switch is off', rule: 'flag', file: sub('flags', 'export const FIRST_JOB_PATH_ENABLED = true;', 'export const FIRST_JOB_PATH_ENABLED = false;') },
  { name: 'Home goes back to mounting the old card', rule: 'flag', file: sub('home', '<FirstJobPath', '<OnboardingChecklist') },
  { name: 'the old card is no longer the fallback', rule: 'flag', file: sub('card', "if (audience === 'legacy') return <OnboardingChecklist {...props} />;", "if (audience === 'legacy') return null;") },
  // reanimated / motion
  { name: 'the card imports react-native-reanimated', rule: 'reanimated', file: sub('views', "import Svg, { Circle } from 'react-native-svg';", "import Svg, { Circle } from 'react-native-svg';\nimport Reanimated from 'react-native-reanimated';") },
  { name: 'the line animates under Reduce Motion', rule: 'reanimated', file: sub('views', 'if (!filled || !live || reduce) {', 'if (!filled || !live) {') },
  { name: 'an animation hard-codes the native driver', rule: 'reanimated', file: sub('card', 'useNativeDriver: nativeDriver,', 'useNativeDriver: true,') },
  // storage
  { name: 'the state key leaves the owned prefix', rule: 'storage', core: withCore({ firstJobStateKey: (id) => `first_job_path::${id}` }) },
  { name: 'the sent key is shared across users', rule: 'storage', core: withCore({ firstJobSentKey: () => 'mageid_first_job_sent' }) },
  { name: 'the store writes a key of its own', rule: 'storage', file: sub('store', 'await AsyncStorage.setItem(firstJobStateKey(userId), serializeStored(state));', "await AsyncStorage.setItem('first_job', serializeStored(state));") },
  { name: 'the store clears all of storage', rule: 'storage', file: sub('store', 'sentListeners.forEach((fn) => fn());', 'sentListeners.forEach((fn) => fn());\n    await AsyncStorage.clear();') },
  // quiet / look
  { name: 'the proposal read is asked on every visit, for everyone', rule: 'quiet', file: sub('card', 'active: stored.answer !== null,', 'active: true,') },
  { name: 'a pop-up is added', rule: 'quiet', file: sub('card', "import * as Haptics from 'expo-haptics';", "import * as Haptics from 'expo-haptics';\nimport { showAlert } from '@/utils/alert';") },
  { name: 'a colour is hard-coded', rule: 'look', file: sub('views', 'stageNow: { borderColor: t.accent },', "stageNow: { borderColor: '#2F6B3A' },") },
  { name: 'a string is typed straight into the card', rule: 'look', file: sub('views', '<Text style={styles.ghostTextQuiet}>{copy.skipLabel}</Text>', '<Text style={styles.ghostTextQuiet}>Skip</Text>') },
  { name: 'the core imports React', rule: 'pure', file: sub('core', "import type { FeatureKey } from '@/utils/featureTiers';", "import { useMemo } from 'react';\nimport type { FeatureKey } from '@/utils/featureTiers';") },
  // analytics
  { name: 'the skipped event is not fired', rule: 'analytics', file: sub('card', 'track(AnalyticsEvents.FIRST_JOB_STEP_SKIPPED, { step: id, position });', '') },
  { name: 'an event carries the company name', rule: 'analytics', file: sub('card', 'track(AnalyticsEvents.FIRST_JOB_QUESTION_ANSWERED, { answer });', 'track(AnalyticsEvents.FIRST_JOB_QUESTION_ANSWERED, { answer, company_name: userRole });') },
  // words
  { name: 'an em dash', rule: 'words', en: setWord('office.firstJob.step.invoiceBody', 'Bill from the estimate you already wrote — no typing it twice.') },
  { name: 'an "&"', rule: 'words', en: setWord('office.firstJob.finish.paidSub', 'Invoices & payments') },
  { name: 'an "e.g."', rule: 'words', en: setWord('office.firstJob.step.companyBody', 'Everything you send carries it, e.g. invoices. It takes about 30 seconds.') },
  { name: 'an arrow', rule: 'words', en: setWord('office.firstJob.line.next', 'Next → {step}') },
  { name: '"unlimited"', rule: 'words', en: setWord('office.firstJob.note.lockedNote', 'The {plan} plan gives you unlimited estimates.') },
  { name: 'an accuracy promise', rule: 'words', en: setWord('office.firstJob.step.estimateBody', 'Describe the job in your own words. MAGE writes an accurate estimate from your prices.') },
  { name: 'bare "AIA"', rule: 'words', en: setWord('office.firstJob.finish.paidSub', 'Invoices and AIA pay apps') },
  { name: 'a sentence-case label', rule: 'words', en: setWord('office.firstJob.step.sendLabel', 'Send it to your client') },
  { name: 'a label with a period', rule: 'words', en: setWord('office.firstJob.skipLabel', 'Skip.') },
  { name: 'a sentence with no end', rule: 'words', en: setWord('office.firstJob.remove.body', 'Your work stays where it is') },
  { name: 'a step explained in three sentences', rule: 'words', en: setWord('office.firstJob.step.dailyBody', 'Who was there. What got done. One report you can share with your client.') },
  { name: 'a step renamed', rule: 'words', en: setWord('office.firstJob.step.pricesLabel', 'Add Your Rates') },
  // Spanish
  { name: 'a Spanish string is missing', rule: 'spanish', es: (w) => { const n = { ...w }; delete n['office.firstJob.step.sendLabel']; return n; } },
  { name: 'a Spanish string has no English', rule: 'spanish', es: (w) => ({ ...w, 'office.firstJob.extraLabel': 'Extra' }) },
  { name: 'a Spanish string loses its placeholder', rule: 'spanish', es: setWord('office.firstJob.plan.a11y', 'Necesita un plan de pago.') },
  { name: 'the Spanish is the English copied over', rule: 'spanish', es: setWord('office.firstJob.skipLabel', 'Skip') },
  // gate
  { name: 'the validator is dropped from ship-check', rule: 'gate', file: sub('pkg', ' && bun run test:first-job-path', '') },
];

// ── run ─────────────────────────────────────────────────────────────────────

if (process.env.LIST) {
  MUTATIONS.forEach((m, i) => console.log(`${String(i + 1).padStart(3)}  [${m.rule}] ${m.name}`));
  process.exit(0);
}

let pass = 0;
let fail = 0;
const real = runAll(REAL, REAL_FILES, EN_REAL as Words, ES_REAL);
let lastRule = '';
for (const c of real) {
  if (c.rule !== lastRule) { console.log(`\n── ${c.rule}`); lastRule = c.rule; }
  if (c.pass) { pass += 1; console.log(`  ✓ ${c.name}`); } else { fail += 1; console.log(`  ✗ ${c.name}${c.detail ? `\n      ${c.detail}` : ''}`); }
}

console.log('\n── planted mutations (each must turn its own rule red)');
const rulesWithMutation = new Set<string>();
MUTATIONS.forEach((m, i) => {
  let caught = false;
  let how = '';
  try {
    const core = m.core ? m.core(REAL) : REAL;
    const files = m.file ? { ...REAL_FILES, [m.file[0]]: m.file[1](REAL_FILES[m.file[0]]) } : REAL_FILES;
    const en = m.en ? m.en(EN_REAL as Words) : (EN_REAL as Words);
    const es = m.es ? m.es(ES_REAL) : ES_REAL;
    const red = runAll(core, files, en, es).filter((c) => !c.pass);
    caught = red.some((c) => c.rule === m.rule);
    how = caught ? red.find((c) => c.rule === m.rule)!.name : `red rules: ${[...new Set(red.map((c) => c.rule))].join(', ') || 'none'}`;
  } catch (e) {
    how = `mutation could not be planted: ${e instanceof Error ? e.message : String(e)}`;
  }
  rulesWithMutation.add(m.rule);
  if (caught) { pass += 1; console.log(`  ✓ ${String(i + 1).padStart(2)} [${m.rule}] ${m.name}`); }
  else { fail += 1; console.log(`  ✗ ${String(i + 1).padStart(2)} [${m.rule}] ${m.name} SURVIVED\n      ${how}`); }
});

const rules = [...new Set(real.map((c) => c.rule))];
const unproven = rules.filter((r) => !rulesWithMutation.has(r));
if (unproven.length === 0) { pass += 1; console.log('  ✓ every rule has at least one planted mutation'); }
else { fail += 1; console.log(`  ✗ rules with no planted mutation: ${unproven.join(', ')}`); }

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-first-job-path: ${pass} checks (${MUTATIONS.length} planted mutations), ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
