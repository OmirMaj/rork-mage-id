/**
 * ALL-CLEAR HONESTY — the app may not assert a checked negative it did not check.
 *
 * WHY THIS EXISTS. The 2026-09-10 polish audit mounted all 107 routes in a
 * brand-new account and in a seeded one and diffed the text. /brief rendered
 * BYTE-IDENTICALLY in both — 129 characters, "Quiet morning — nothing needs you
 * | Nothing overdue, nothing at risk, nothing waiting on you. Go build." — on an
 * account holding an RFI 23 days past due to the architect, an electrical permit
 * that had lapsed five days earlier, and a job the margin engine calls critical.
 * The home screen printed the same verdict plus "All clear — your jobs are on
 * track" and then, ten rows lower on the same scroll, "RFI #2 past due · 23d".
 * The desktop rail said "All caught up", and above 1280px it is the ONLY place
 * that speaks, because the inline Smart Inbox is suppressed at that width.
 *
 * Four surfaces, one root: the attention layer had no `rfi` and no `submittal`
 * kind and permitAttention had never read `expiresDate`, so three real problems
 * could not produce a single item — and every verdict above them was phrased as
 * a claim about everything.
 *
 * WHAT THIS PINS, in the two shapes the fix takes:
 *   (a) WIDEN — the builders exist and fire, so the scan sees what it claims on.
 *   (b) NARROW — every quiet sentence names its own evidence, and a quiet
 *       verdict is impossible while something outside that evidence is open.
 *
 * The rendered half seeds its own RFI relative to the REAL clock instead of
 * leaning on __tests__/fixtures/world.ts. The fixture pins TODAY to
 * 2026-08-15 while the render uses the live clock, so every relative date in it
 * drifts (the audit's own verifier caught this: the permit its comment calls
 * "expiring soon" is in fact expired). A guard that depends on that drift tests
 * the calendar, not the code.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import {
  rfiAttention, submittalAttention, permitAttention, permitExpiryState,
} from '@/utils/brainWatch';
import {
  composeBrief, briefIsEmpty, briefScope, quietBriefDetail,
  QUIET_MORNING_LINE, type ComposeBriefInput,
} from '@/utils/brief/composeBrief';
import { QUIET_CLOSE_HEADLINE } from '@/utils/weekClose/composeWeekClose';
import type { Project, RFI, Submittal, Permit } from '@/types';

// ─── Fixtures (local, real-clock relative) ──────────────────────────────────

const NOW = new Date('2026-05-20T15:00:00.000Z');
const NOW_MS = NOW.getTime();
/** `n` days before NOW as a bare calendar day — the shape these fields hold. */
const daysAgo = (n: number) =>
  new Date(NOW_MS - n * 86_400_000).toISOString().slice(0, 10);

const project = { id: 'p1', name: 'Alder Street', status: 'in_progress' } as Project;

const overdueRfi = {
  id: 'r1', projectId: 'p1', number: 7, subject: 'Shower niche detail',
  status: 'open', assignedTo: 'Kestrel Architects', dateRequired: daysAgo(23),
} as RFI;

const staleSubmittal: Submittal = {
  id: 's1', projectId: 'p1', number: 3, title: 'Window schedule',
  specSection: '08 50 00', submittedBy: 'Smoke User',
  submittedDate: daysAgo(19), requiredDate: daysAgo(2),
  reviewCycles: [], currentStatus: 'in_review', attachments: [],
  createdAt: daysAgo(19), updatedAt: daysAgo(19),
};

const lapsedPermit = {
  id: 'pm1', projectId: 'p1', projectName: 'Alder Street', type: 'electrical',
  permitNumber: 'ELE-26-02219', jurisdiction: 'City', status: 'approved',
  appliedDate: daysAgo(120), expiresDate: daysAgo(5), fee: 410,
} as Permit;

function briefInput(over: Partial<ComposeBriefInput> = {}): ComposeBriefInput {
  return {
    projects: [project], invoices: [], changeOrders: [], punchItems: [],
    permits: [], deliveries: [], buildingAccessRules: [], accessReservations: [],
    expiringCertifications: [], dailyReports: [], didForYouEntries: [],
    openLeakFlags: { count: 0, estTotal: 0 },
    now: NOW,
    ...over,
  };
}

// ─── (a) WIDEN: the scan can see the three things it was blind to ───────────

describe('the attention layer sees what the verdicts claim on', () => {
  it('an open RFI past its required-by date produces an item', () => {
    const items = rfiAttention(project, [overdueRfi], NOW_MS);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('rfi');
    expect(items[0].severity).toBe('critical'); // 23d, well past the 7d line
    expect(items[0].message).toContain('23d past due');
    expect(items[0].message).toContain('Kestrel Architects'); // says who to call
  });

  it('an RFI that is not yet due, or already answered, produces nothing', () => {
    const notYet = { ...overdueRfi, dateRequired: '2026-06-10' } as RFI;
    expect(rfiAttention(project, [notYet], NOW_MS)).toHaveLength(0);
    const answered = { ...overdueRfi, status: 'answered' } as RFI;
    expect(rfiAttention(project, [answered], NOW_MS)).toHaveLength(0);
  });

  it('a submittal stale in review produces an item; a fresh one does not', () => {
    expect(submittalAttention(project, [staleSubmittal], NOW_MS)).toHaveLength(1);
    const fresh = { ...staleSubmittal, submittedDate: daysAgo(2) } as Submittal;
    expect(submittalAttention(project, [fresh], NOW_MS)).toHaveLength(0);
  });

  it('a LAPSED permit produces a critical item — the branch that never existed', () => {
    const items = permitAttention(project, [lapsedPermit], NOW_MS);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('critical');
    expect(items[0].message).toContain('expired');
  });

  it('a permit with plenty of runway and no inspection booked stays quiet', () => {
    const healthy = { ...lapsedPermit, expiresDate: '2027-01-01' } as Permit;
    expect(permitAttention(project, [healthy], NOW_MS)).toHaveLength(0);
  });

  it('a permit expiring TODAY counts the day in words, not as "0d"', () => {
    const today = { ...lapsedPermit, expiresDate: daysAgo(0) } as Permit;
    const state = permitExpiryState(today, NOW_MS);
    expect(state).not.toBeNull();
    expect(state?.lapsed).toBe(false);
    expect(state?.daysToExpiry).toBe(0);
    const [item] = permitAttention(project, [today], NOW_MS);
    expect(item.message).toContain('expires today');
    expect(item.message).not.toContain('0d');
  });

  it('permitExpiryState is the ONE definition both surfaces read', () => {
    // Two readers: permitAttention (every "needs you" verdict) and the Smart
    // Inbox's permit_expiring rule. While only the first could see an expired
    // permit, the home screen rendered "permit has expired — work on it is
    // unpermitted" four rows above "All caught up. Nothing urgent across your
    // projects." A second copy of this decision brings that back.
    const inboxSrc = readFileSync(
      join(__dirname, '..', '..', 'hooks', 'useSmartInbox.ts'), 'utf8',
    );
    expect(inboxSrc).toMatch(/import \{[^}]*permitExpiryState[^}]*\} from '@\/utils\/brainWatch'/);
    expect(inboxSrc).toMatch(/rule: 'permit_expiring'/);
  });

  it('a permit on a DENIED application is not a renewal problem', () => {
    const denied = { ...lapsedPermit, status: 'denied' } as Permit;
    expect(permitExpiryState(denied, NOW_MS)).toBeNull();
    expect(permitAttention(project, [denied], NOW_MS)).toHaveLength(0);
  });
});

// ─── (b) NARROW: no quiet verdict over open work, and none without evidence ──

describe('the morning brief cannot call a morning quiet over an overdue RFI', () => {
  it('is quiet with nothing open', () => {
    expect(briefIsEmpty(composeBrief(briefInput({ rfis: [] })))).toBe(true);
  });

  it('is NOT quiet once an overdue RFI is handed to it', () => {
    const brief = composeBrief(briefInput({ rfis: [overdueRfi] }));
    expect(briefIsEmpty(brief)).toBe(false);
    expect(brief.needsYou.some(i => i.text.includes('RFI #7'))).toBe(true);
  });

  it('is NOT quiet once a lapsed permit is handed to it', () => {
    const brief = composeBrief(briefInput({ permits: [lapsedPermit] }));
    expect(briefIsEmpty(brief)).toBe(false);
  });
});

describe('a quiet sentence states the evidence behind it', () => {
  it('a source the caller did not pass is reported as unchecked, not claimed', () => {
    const without = briefScope(briefInput());
    expect(without.unchecked).toContain('RFIs');
    expect(without.checked).not.toContain('RFIs');

    // An empty ARRAY means "looked, found none" — that one is claimable.
    const withRfis = briefScope(briefInput({ rfis: [] }));
    expect(withRfis.checked).toContain('RFIs');
    expect(withRfis.unchecked).not.toContain('RFIs');
  });

  it('margin is never claimed — the engine behind it double-counts buyout', () => {
    expect(briefScope(briefInput({ rfis: [], submittals: [] })).unchecked)
      .toContain('job margin');
  });

  it('the quiet detail names every domain it checked and every one it did not', () => {
    const brief = composeBrief(briefInput());
    const line = quietBriefDetail(brief);
    for (const domain of [...brief.scope.checked, ...brief.scope.unchecked]) {
      expect(line).toContain(domain);
    }
  });

  it('the "where to look" pointer follows what is actually unchecked', () => {
    // Hardcoded, the tail read "see Margin Alerts and Waiting On for those" —
    // correct only while RFIs are unchecked. The day hooks/useMorningBrief.ts
    // passes them (the wiring this wave left filed), margin is the only
    // unchecked domain left and a fixed tail would still be sending the reader
    // to Waiting On to find it. The sentence widens on its own; so must its
    // directions.
    const both = quietBriefDetail(composeBrief(briefInput({ rfis: [], submittals: [] })));
    expect(both).toContain('job margin');
    expect(both).toContain('Margin Alerts');
    expect(both).not.toContain('Waiting On');

    const neither = quietBriefDetail(composeBrief(briefInput()));
    expect(neither).toContain('Waiting On');
    expect(neither).toContain('Margin Alerts');
  });

  it('no quiet headline makes an unqualified claim about everything', () => {
    // The three sentences that were the defect, and the shape of them: a
    // negative with no stated scope. Each of these substrings shipped.
    const banned = [
      'nothing at risk',
      'nothing waiting on you',
      'nothing needs you',
      'your jobs are on track',
      'nothing left on the table',
      // "Clean close on billing, collections, the plan and client updates."
      // was the FIRST narrowing of the Friday headline, and it still graded
      // legs that were empty for want of data: it called the plan clean
      // directly above "No weekly plan was tracked this week", and called
      // billing clean directly above the disclaimer the bill leg had just been
      // given ("Nothing unbilled from the costs recorded so far"). A quiet
      // headline may report that the check came back empty; it may not hand
      // out a passing grade for a measurement nobody took.
      'clean close on',
    ];
    for (const line of [QUIET_MORNING_LINE, QUIET_CLOSE_HEADLINE]) {
      for (const phrase of banned) {
        expect(line.toLowerCase()).not.toContain(phrase);
      }
    }
  });
});

// ─── The surfaces, rendered ─────────────────────────────────────────────────

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach(n => collectText(n, out)); return out; }
  const children = (node as { children?: unknown }).children;
  if (children) collectText(children, out);
  return out;
}

/**
 * The populated world with its permits and punch list emptied, and ONE RFI —
 * overdue against the live clock — left standing. That is precisely the state
 * the bug lived in: nothing the canonical nine-kind scan can see, one real
 * problem it cannot.
 */
async function primeRfiOnlyWorld(): Promise<void> {
  await primeWorld('populated');
  await AsyncStorage.multiSet([
    ['mageid_permits', '[]'],
    ['mageid_punch_items', '[]'],
    ['mageid_rfis', JSON.stringify([{
      ...overdueRfi,
      projectId: PROJECT_ID,
      // Re-based on the REAL clock so this stays overdue forever, rather than
      // on NOW above (which is a fixed instant for the pure tests).
      dateRequired: new Date(Date.now() - 23 * 86_400_000).toISOString().slice(0, 10),
      question: 'Which waterproofing assembly?',
      submittedBy: 'Smoke User',
      dateSubmitted: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      priority: 'normal',
      attachments: [],
      createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      updatedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    }])],
  ]);
}

/**
 * The seeded world with its RFIs removed and the PERMITS left in — so the only
 * open thing on the account is the lapsed electrical permit. The state that
 * caught the gap this guard's permit cases exist for: the attention card said
 * "permit has expired — work on it is unpermitted" and the Inbox card, four
 * rows down the same scroll, said "All caught up. Nothing urgent across your
 * projects."
 */
async function primePermitOnlyWorld(): Promise<void> {
  await primeWorld('populated');
  await AsyncStorage.multiSet([['mageid_rfis', '[]'], ['mageid_punch_items', '[]']]);
}

/** Same world with the RFI removed — genuinely nothing open. */
async function primeTrulyQuietWorld(): Promise<void> {
  await primeWorld('populated');
  await AsyncStorage.multiSet([
    ['mageid_permits', '[]'],
    ['mageid_punch_items', '[]'],
    ['mageid_rfis', '[]'],
  ]);
}

describe('/brief', () => {
  it('states what it checked instead of claiming everything', async () => {
    await primeTrulyQuietWorld();
    const text = collectText((await mountRouteChecked('/brief')).toJSON()).join(' | ');
    expect(text).toContain('Nothing overdue in');
    expect(text).toContain('Not checked here');
    expect(text.toLowerCase()).not.toContain('nothing at risk');
    expect(text.toLowerCase()).not.toContain('nothing waiting on you');
    expect(text).not.toContain('Go build');
  });
});

describe('the home Inbox card', () => {
  it('does not say "nothing urgent" while a permit has lapsed', async () => {
    await primePermitOnlyWorld();
    const text = collectText((await mountRouteChecked('/(tabs)/(home)')).toJSON()).join(' | ');
    // The attention card sees it...
    expect(text).toContain('permit has expired');
    // ...and so does the Inbox card, which is the one a phone user actually
    // scrolls past. Both sentences on one screen, agreeing.
    expect(text).toContain('Permit expired · ELE-26-02219');
    expect(text).not.toContain('Nothing urgent across your projects');
  });
});

describe('a finished job does not generate today\'s work', () => {
  it('no permit row for a completed project, in either counter', async () => {
    await primeWorld('populated');
    const raw = await AsyncStorage.getItem('mageid_projects');
    const projects = JSON.parse(raw ?? '[]') as { status: string }[];
    for (const p of projects) p.status = 'completed';
    await AsyncStorage.setItem('mageid_projects', JSON.stringify(projects));
    const text = collectText((await mountRouteChecked('/(tabs)/(home)')).toJSON()).join(' | ');
    // Neither the attention card nor the Inbox card may nag about a permit on
    // a job that is finished — the attention set's callers skip closed and
    // completed projects, and the Inbox rule has to skip the same ones or the
    // two counters disagree again.
    expect(text).not.toContain('Permit expired');
    expect(text).not.toContain('permit has expired');
  });
});

describe('/week-close', () => {
  it('reports that the check came back empty, not that the week was clean', async () => {
    await primeTrulyQuietWorld();
    const text = collectText((await mountRouteChecked('/week-close')).toJSON()).join(' | ');
    expect(text).toContain('Nothing open in');
    // The headline may not grade a leg that had nothing to measure. Both of
    // these render in the same viewport as the headline, and the first
    // narrowing ("Clean close on billing, collections, the plan and client
    // updates.") contradicted both of them.
    expect(text).toContain('No weekly plan was tracked this week.');
    expect(text).toContain('from the costs recorded so far');
    expect(text).not.toContain('Clean close');
    // ...and it still says what it did not look at.
    expect(text).toContain('not part of this check');
  });
});

describe('/(tabs)/(home)', () => {
  it('does not print an all-clear while an RFI is 23 days past due', async () => {
    await primeRfiOnlyWorld();
    const text = collectText((await mountRouteChecked('/(tabs)/(home)')).toJSON()).join(' | ');
    // The contradiction the audit photographed: the green line and the row
    // that falsifies it, on one scroll.
    expect(text).toContain('RFI #7 past due');
    expect(text.toLowerCase()).not.toContain('your jobs are on track');
    expect(text).not.toContain('All clear —');
    // ...and it names the thing it cannot count, rather than going mute.
    expect(text).toContain('waiting on a reply');
  });

  it('counts only the canonical set in the header, even with an RFI open', async () => {
    // The seeded account has BOTH a lapsed permit (canonical) and an RFI 23
    // days past due (not canonical yet). The header may report one, and only
    // one: hooks/useBrainWatch.ts owns that number and the Your-Projects tab
    // badge renders it beside this card. sim-audit #15 was this card showing 5
    // while the badge showed 11, and the extra categories gate the SENTENCE
    // here precisely so they can never reach the count.
    await primeWorld('populated');
    const text = collectText((await mountRouteChecked('/(tabs)/(home)')).toJSON()).join(' | ');
    expect(text).toContain('1 thing needs your attention');
    expect(text).not.toContain('2 things need your attention');
  });

  it('still gives a green all-clear when there IS nothing open — scoped', async () => {
    await primeTrulyQuietWorld();
    const text = collectText((await mountRouteChecked('/(tabs)/(home)')).toJSON()).join(' | ');
    expect(text).toContain('All clear — nothing overdue on schedules, invoices, permits or certs.');
  });
});

// ─── RT-R1, on the surfaces it never reached ────────────────────────────────
//
// ProjectContext swallows a failed read and serves this device's cache, so an
// empty attention set means EITHER "quiet" OR "every read 401'd". The home Brain
// Watch card has gated its green line on `sourceFailed` since that incident;
// grep found the flag in NONE of app/brief.tsx, app/week-close.tsx,
// hooks/useMorningBrief.ts or components/home/MorningBriefCard.tsx, so the same
// bug still shipped on three other all-clear surfaces. Source-asserted because
// the failure needs a dead network probe, which this harness cannot produce —
// and a gate that exists is the thing worth pinning.

describe('a failed read is never rendered as a quiet one', () => {
  const read = (rel: string) =>
    readFileSync(join(__dirname, '..', '..', rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it.each([
    ['app/brief.tsx', 'brief-unreachable'],
    ['app/week-close.tsx', 'week-close-unreachable'],
  ])('%s gates its quiet verdict on sourceFailed', (rel, testId) => {
    const src = read(rel);
    // Forwarded from CoreData, which owns the probe — not re-derived here, the
    // same rule hooks/useBrainWatch.ts follows. One fact, one owner.
    expect(src).toMatch(/const \{ sourceFailed \} = useCoreData\(\)/);
    expect(src).not.toMatch(/useMageReachability/);
    expect(src).toContain("Couldn't reach MAGE");
    expect(src).toContain(testId);
  });
});

// ─── The desktop rail ───────────────────────────────────────────────────────
//
// Source-asserted rather than rendered: the rail only mounts above a 1280px
// MAIN VIEWPORT, which jest's renderer does not have. Worth pinning anyway, and
// pinning here rather than nowhere, because this is the surface where the false
// all-clear does the most damage — above that width
// app/(tabs)/(home)/index.tsx suppresses the inline Smart Inbox in favour of
// the rail, so there is no second opinion on the screen.

describe('components/DesktopActionRail', () => {
  const raw = readFileSync(
    join(__dirname, '..', '..', 'components', 'DesktopActionRail.tsx'), 'utf8',
  );
  // Comments stripped first. This file's own header QUOTES the sentence the fix
  // removed ("Nothing urgent across your projects"), so a naive substring search
  // over the raw source reports the bug as still present — and, worse, a source
  // guard that matches comment text can be satisfied by a comment.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('checks RFIs and submittals before it is allowed to say "All caught up"', () => {
    expect(src).toMatch(/rfiAttention\(/);
    expect(src).toMatch(/submittalAttention\(/);
    expect(src.indexOf('outsideTheScan > 0 ?')).toBeGreaterThan(-1);
    expect(src.indexOf('outsideTheScan > 0 ?')).toBeLessThan(src.indexOf('All caught up'));
  });

  it('keeps its own claim scoped, and keeps the count canonical', () => {
    expect(src).toContain('Nothing overdue on schedules, invoices, permits or certs.');
    expect(src).not.toContain('Nothing urgent across your projects');
    // sim-audit #15: the pill is the canonical set and NOTHING else. This used
    // to be `toMatch(/countPillText.*items\.length/s)` with the dot-all flag,
    // which only asked that both strings appear somewhere in the file — it
    // passed just as happily on `{items.length + outsideTheScan}`, the exact
    // second number the incident was about (verified: that mutation escaped).
    // Pin the expression, not the vocabulary.
    expect(src).toMatch(/<Text style=\{styles\.countPillText\}>\{items\.length\}<\/Text>/);
    expect(src).not.toMatch(/countPillText[^\n]*outsideTheScan/);
  });
});
