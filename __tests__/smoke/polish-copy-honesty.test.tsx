/**
 * Render guard for four polish defects the 2026-09-10 rendered audit found by
 * MOUNTING every route rather than reading source. Each assertion below is
 * pinned to a string that was actually in the dump, so the guard fails on the
 * thing a contractor would see rather than on a shape in the code.
 *
 * The four:
 *
 *  1. /handover was a dead end for the only people who could reach it. Its
 *     entire render, in BOTH the empty and the populated dump, was
 *     "Project not found | Back" — 24 characters — while its Tools row carries
 *     `needsProjects: true`, i.e. it is shown ONLY to users who have a project.
 *     app/(tabs)/discover/tools.tsx pushes the bare route with no params, so a
 *     GC with a live job was told the job did not exist.
 *
 *  2. /safety-certifications printed a green "All certifications are current"
 *     directly above "No certifications yet". A compliance verdict computed
 *     from zero records, on the one screen where a false green is a liability.
 *
 *  3. /business rendered "Crew Load | Next 4 weeks | 0% | 4–8 weeks | 0% |
 *     8–12 weeks | 0%" with no schedule anywhere in the account — a rate with
 *     no denominator printed as a measurement, on a screen that gets the same
 *     thing RIGHT two rows above ("CRM Win Rate | — | 3 more decided leads
 *     needed").
 *
 *  4. /discover/tools showed a free contractor twenty rows in which roughly
 *     half are paid walls, with nothing to tell them apart. Note this route
 *     was NEVER captured by the audit's own dump — it passed the
 *     group-prefixed URL `/(tabs)/discover/tools`, which Expo Router does not
 *     match, so the block it recorded is the home screen. The URL below is the
 *     real one.
 *
 * Kept in the smoke suite so it runs under ship-check (bun run test:smoke).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { certRosterBanner } from '@/app/safety-certifications';
import { finalInvoiceState } from '@/app/handover';
import { typeComparisonColdStart } from '@/app/business';

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach(n => collectText(n, out)); return out; }
  const children = (node as { children?: unknown }).children;
  if (children) collectText(children, out);
  return out;
}

async function render(url: string, world: 'empty' | 'populated', tier?: string) {
  await primeWorld(world);
  // primeWorld seeds enterprise in both states, deliberately (see its comment).
  // The tier badge only exists for a user who is BELOW the required tier, so a
  // free-tier assertion has to overwrite the mirror before the mount.
  if (tier) await AsyncStorage.setItem('mageid_subscription_tier', tier);
  const tree = await mountRouteChecked(url);
  return collectText(tree.toJSON());
}

describe('/handover resolves its own project instead of dead-ending', () => {
  it('with no projectId and a real project on file, offers the picker', async () => {
    const text = await render('/handover', 'populated');
    expect(text).not.toContain('Project not found');
    expect(text).toContain('Pick a project');
    expect(text.join(' ')).toContain('Harlow Residence');
  });

  it('with no projects at all, names the feature and offers to create one', async () => {
    const text = await render('/handover', 'empty');
    expect(text).not.toContain('Project not found');
    expect(text).toContain('No projects yet');
    expect(text).toContain('Create a project');
  });

  it('a dead projectId says the project is gone, which is not the same as no id', async () => {
    const text = await render('/handover?projectId=deleted-last-month', 'populated');
    expect(text.join(' ')).toContain('no longer exists');
    expect(text).toContain('Pick a project');
  });

  it('a real projectId still renders the checklist, not the picker', async () => {
    const text = await render(`/handover?projectId=${PROJECT_ID}`, 'populated');
    expect(text).not.toContain('Pick a project');
    expect(text).toContain('Closeout items');
  });

  // Found while reviewing the picker fix, in the same file: the checklist's
  // "Final invoice paid" row handled two of InvoiceStatus's five members and
  // swept the other three into an else that read "Most recent invoice is still
  // draft". The fixture seeds no invoices — both dumps render "No invoices
  // yet" — so this is the only place the other branches can be observed.
  describe('finalInvoiceState', () => {
    it('never calls a sent invoice a draft', () => {
      for (const status of ['overdue', 'partially_paid', 'sent'] as const) {
        const row = finalInvoiceState({ number: 3, status });
        expect(row.detail).not.toMatch(/draft/i);
        expect(row.status).toBe('partial');
        expect(row.detail).toContain('#3');
      }
      expect(finalInvoiceState({ number: 3, status: 'overdue' }).detail).toContain('overdue');
      expect(finalInvoiceState({ number: 3, status: 'partially_paid' }).detail).toContain('part-paid');
    });

    it('still gates "done" on paid alone', () => {
      expect(finalInvoiceState({ number: 3, status: 'paid' }).status).toBe('done');
      expect(finalInvoiceState({ number: 3, status: 'draft' }).status).toBe('open');
      expect(finalInvoiceState(undefined).status).toBe('open');
      expect(finalInvoiceState(undefined).detail).toContain('No invoices yet');
    });
  });

  it('PICKING a project on a dead link actually opens it', async () => {
    // The test above proves the picker RENDERS on a dead id. It does not prove
    // the picker WORKS, and that gap was dark: flipping the resolution order to
    // `paramProjectId ?? pickedProjectId` left all four tests above green while
    // making every tap inert — the dead id keeps winning, `project` stays
    // undefined, and the picker re-renders forever. Same dead end as before the
    // fix, reached by a different route. So press the row for real.
    await primeWorld('populated');
    const tree = await mountRouteChecked('/handover?projectId=deleted-last-month');
    await act(async () => {
      fireEvent.press(tree.getByText('Harlow Residence — kitchen + primary suite'));
    });
    await waitFor(() => {
      const text = collectText(tree.toJSON());
      expect(text).not.toContain('Pick a project');
      expect(text).toContain('Closeout items');
    });
  });
});

describe('/safety-certifications issues no compliance verdict on an empty roster', () => {
  it('renders no summary banner at all when it holds no records', async () => {
    const text = await render('/safety-certifications', 'empty');
    const joined = text.join(' ');
    // Two regexes, not one string. The first version of this test asserted
    // only the absence of the literal "All certifications are current", and
    // mutation-testing showed it stayed GREEN when the zero-record guard was
    // removed — the banner came back reading "0 certifications on file", a
    // different sentence making the same unearned claim. Both shapes of the
    // banner are banned on an empty roster, because the defect is that a
    // verdict renders at all, not that it used one particular wording.
    expect(joined).not.toMatch(/certifications? (are |is )?current/i);
    expect(joined).not.toMatch(/\d+ certifications? (on file|expiring)/i);
    // The empty state is what speaks instead, and it still offers the action.
    expect(text).toContain('No certifications yet');
    expect(text).toContain('Add first certification');
  });

  // The branches a render can never reach, pinned on the pure function the
  // screen actually calls. The fixture cannot seed certifications —
  // SafetyContext.hydrateCollection reads Supabase whenever `canSync`
  // (contexts/SafetyContext.tsx:232-241), the smoke mock answers every select
  // with `data: []`, and the hydrate then saveLocal()s that empty list OVER
  // any seeded local cache. The previous version of this block asserted on the
  // file's SOURCE TEXT, which pins wording rather than behaviour and goes
  // stale the moment the copy is reworded.
  describe('certRosterBanner', () => {
    it('issues no verdict at all with no records', () => {
      expect(certRosterBanner(0, 0, 0)).toBeNull();
    });

    it('is green ONLY when every card has a date and none of them lapse', () => {
      expect(certRosterBanner(14, 0, 0)).toEqual({
        text: '14 certifications on file — none expiring in the next 30 days',
        tone: 'clean',
      });
      expect(certRosterBanner(1, 0, 0)?.text).toBe(
        '1 certification on file — none expiring in the next 30 days',
      );
    });

    it('does not claim a 30-day all-clear over cards with no expiry date', () => {
      // `expiresDate` is optional on the add form and certStatus calls a blank
      // one 'valid', so these five are invisible to expiringCount. Claiming
      // "none expiring in the next 30 days" over them is the same false green
      // the zero-record guard exists to stop, one level down.
      const all = certRosterBanner(5, 0, 5);
      expect(all?.text).toBe(
        '5 certifications on file, none with an expiry date — nothing here for us to watch.',
      );
      expect(all?.tone).toBe('attention');
      const some = certRosterBanner(5, 0, 2);
      expect(some?.text).toBe(
        '5 certifications on file — none of the 3 with a date expire in the next 30 days. 2 have no expiry date.',
      );
      expect(some?.tone).toBe('attention');
      expect(certRosterBanner(5, 0, 1)?.text).toContain('1 has no expiry date');
    });

    it('keeps the warning branch when something is lapsing', () => {
      expect(certRosterBanner(9, 1, 4)).toEqual({
        text: '1 certification expiring soon or expired',
        tone: 'attention',
      });
      expect(certRosterBanner(9, 3, 0)?.text).toBe('3 certifications expiring soon or expired');
    });
  });
});

describe('/business prints no crew-load rate it cannot measure', () => {
  it('says there is no schedule rather than three 0% bars', async () => {
    const text = await render('/business', 'populated');
    const joined = text.join(' ');
    expect(joined).toContain('Crew Load');
    // The window labels only render alongside the percentages, so their
    // absence is proof the bars are gone rather than just recoloured.
    expect(joined).not.toContain('Next 4 weeks');
    expect(joined).not.toContain('8–12 weeks');
    expect(joined).toContain('No project schedule to measure yet');
  });

  it('states the missing prerequisite as a count, not as jargon', async () => {
    const text = await render('/business', 'empty');
    const joined = text.join(' ');
    expect(joined).not.toContain('Closes feed this');
    expect(joined).toContain('Margin by job type needs 2 closed jobs of the same type. You have 0');
  });

  it('never tells a GC he needs 2 closed jobs while naming a number above 2', () => {
    // The row gate is per TYPE; the count in the sentence is across all types.
    // A GC with five closed jobs of five different types has every row gated,
    // so the "needs 2 … you have N" shape renders with N = 5. No fixture can
    // reach that state — five closed projects of distinct types — so the
    // reachable render above cannot catch it and this asserts the function.
    for (const n of [2, 3, 5, 40]) {
      const line = typeComparisonColdStart(n);
      expect(line).not.toMatch(/needs 2 closed jobs/i);
      expect(line).toContain(`${n} closed jobs are each a different type`);
    }
    expect(typeComparisonColdStart(0)).toContain('You have 0 closed');
    expect(typeComparisonColdStart(1)).toContain('You have 1 closed');
  });
});

describe('/discover/tools marks the rows a free contractor cannot open', () => {
  it('badges gated rows with the tier that unlocks them', async () => {
    const text = await render('/discover/tools', 'populated', 'free');
    // Three of the registry-declared gates, at two different tiers.
    expect(text).toContain('BUSINESS');   // Cost X-Ray, Scan Anything, WIP report…
    expect(text).toContain('PRO');        // Plan Intelligence, Smart Proposal…
    // Sanity: the rows themselves are still there. A badge that appeared
    // because the grid collapsed would satisfy the two lines above.
    expect(text).toContain('Cost X-Ray');
    expect(text).toContain('Plan Intelligence');
  });

  it('badges nothing for a user whose tier clears every gate', async () => {
    const text = await render('/discover/tools', 'populated', 'enterprise');
    expect(text).toContain('Cost X-Ray');
    expect(text).not.toContain('BUSINESS');
    expect(text).not.toContain('PRO');
    expect(text).not.toContain('ENTERPRISE');
  });
});
