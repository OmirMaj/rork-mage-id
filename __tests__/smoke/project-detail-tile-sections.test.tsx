/**
 * Stage 6 — project-detail tile sections, populated state.
 *
 * The gap identified in the smoke-suite self-report:
 *
 *   "Mounting is not interacting. For a modal-in-screen app, 'renders'
 *   means the tile grid rendered, not the section modals behind it.
 *   /project-detail's ?tile= variants are untested — that is where I'd
 *   expect the next tranche of real bugs."
 *
 * How the tile-section mechanism works (app/project-detail.tsx):
 *
 *   1. The screen reads `?tile=<sectionKey>` from useLocalSearchParams.
 *   2. A useEffect fires once `project` is loaded and calls
 *      setActiveTile(tileParam). This opens the section modal.
 *   3. The <Modal visible={activeTile !== null}> renders a ScrollView
 *      whose content is gated on `activeTile === 'xxx'` conditionals.
 *
 *   ?tile= is a complete, supported deep-link — the same path the
 *   NextStepHero uses in production ("Review RFIs" → ?tile=rfis). Testing
 *   it requires no app-code changes and exercises the real render path.
 *
 * Scope — sections with dedicated content blocks inside the modal:
 *
 *   linkedEstimate   changeOrders   invoices       dailyReports
 *   punchList        rfis           submittals     budget
 *   schedule         collaborators  photos         clientPortal
 *   communications
 *
 *   Sections that navigate OUT (activity, plans, permits, contract,
 *   selections, lienWaivers, closeoutBinder, handover, oacMeetings,
 *   timeTracking, fieldTickets, projectFiles, scope) are NOT included
 *   here — a tap on those tiles pushes a new route rather than opening
 *   the inline modal, so they are already covered by every-route.*.
 *
 * World state — populated only.
 *
 *   The most interesting crashes in sections like `budget` and
 *   `linkedEstimate` require a project with a real linkedEstimate, which
 *   only exists in the populated fixture.
 *
 * Known failures follow the same convention as known-failures.ts: a listed
 * entry MUST still fail with the recorded error; a section that starts
 * passing after a fix must have its entry deleted.
 */

import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { knownTileSectionFailureFor } from '@/__tests__/smoke/known-failures';
import { PROJECT_ID, ESTIMATE_ID, PORTAL_TOKEN } from '@/__tests__/fixtures/world';

/**
 * Sections that render dedicated content blocks inside the project-detail
 * section modal (i.e. have an `activeTile === 'xxx'` conditional inside
 * the <Modal>). Derived by reading app/project-detail.tsx — not guessed.
 *
 * Each entry is [sectionKey, humanLabel] for the test reporter output.
 */
const MODAL_SECTIONS: [string, string][] = [
  ['linkedEstimate', 'Estimate Items'],
  ['schedule',       'Schedule'],
  ['collaborators',  'Team / Collaborators'],
  ['changeOrders',   'Change Orders'],
  ['invoices',       'Invoices'],
  ['dailyReports',   'Daily Reports'],
  ['punchList',      'Punch List'],
  ['rfis',           'RFIs'],
  ['submittals',     'Submittals'],
  ['budget',         'Financial Health'],
  ['photos',         'Photos'],
  ['clientPortal',   'Client Portal'],
  ['communications', 'Communications'],
];

/**
 * Base params for every section mount.
 *
 * `id` is the project id — project-detail reads it as a bare `id` param,
 * not `projectId`. Without a real project id the screen renders "Project
 * not found" and setActiveTile never fires (the useEffect gates on
 * `if (!project) return`), meaning the modal never opens.
 */
const BASE_PARAMS = new URLSearchParams({
  id: PROJECT_ID,
  estimateId: ESTIMATE_ID,
  t: PORTAL_TOKEN,
}).toString();

describe('project-detail tile sections — populated state', () => {
  it.each(MODAL_SECTIONS)('?tile=%s (%s)', async (sectionKey, _label) => {
    await primeWorld('populated');

    const url = `/project-detail?${BASE_PARAMS}&tile=${sectionKey}`;

    const known = knownTileSectionFailureFor(sectionKey);

    if (!known) {
      // The assertion: mounts without throwing.
      await mountRouteChecked(url);
      return;
    }

    // Inverted: this section is a recorded bug. It must still fail, and
    // broken in the recorded way. If it starts passing, the entry is stale.
    let thrown: Error | null = null;
    try {
      await mountRouteChecked(url);
    } catch (err) {
      thrown = err as Error;
    }

    if (!thrown) {
      throw new Error(
        `UNEXPECTED PASS: tile=${sectionKey} is listed in known-tile-failures but `
          + `mounts cleanly now. Delete its entry — the allowlist is a bug list, `
          + `not a config file.`
      );
    }
    expect(thrown.message).toMatch(new RegExp(known.error));
  });
});
