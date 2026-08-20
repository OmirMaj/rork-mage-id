/**
 * Render coverage — job-costing's phase bars and status chips, mounted for real.
 *
 * The gap this closes: __tests__/fixtures/world.ts had no `mageid_commitments`
 * key, so ProjectContext hydrated an empty commitments array. app/job-costing.tsx
 * early-returns the ToolProjectPicker until a project resolves, and even once a
 * project resolves its per-phase bars (PhaseBar) and per-commitment status chips
 * (StatusChip) only render when there is commitment cost data. So both of those
 * components — the ones whose fill/label CONTRAST the recent leak fixes repaired
 * (the `${token}22` rgba-suffix trap in StatusChip / PhaseBar) — rendered in
 * ZERO tests.
 *
 * world.ts now seeds `mageid_commitments` with a few Commitment rows against the
 * fixture project, so this test can mount /job-costing?projectId=<real> and see:
 *   - the project resolves (no picker),
 *   - the "By phase" section renders PhaseBar rows (phase names + status pills),
 *   - the Commitments list renders StatusChip labels (Active / Draft).
 *
 * Kept in the smoke suite so it runs under ship-check (bun run test:smoke).
 */

import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID, world } from '@/__tests__/fixtures/world';

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, out));
    return out;
  }
  const children = (node as { children?: unknown }).children;
  if (children) collectText(children, out);
  return out;
}

describe('job costing — phase bars and status chips render on a picked project', () => {
  it('the fixture seeds commitments for the project, so the screen has cost data', () => {
    // Premise guard — a picked project with zero commitments still renders the
    // dashboard but the chips this file asserts on would be empty.
    const forProject = world.commitments.filter((c) => c.projectId === PROJECT_ID);
    expect(forProject.length).toBeGreaterThanOrEqual(2);
    // Both StatusChip branches we assert on must actually be present.
    expect(forProject.map((c) => c.status)).toEqual(expect.arrayContaining(['active', 'draft']));
  });

  it('mounts with the project picked, not the "pick a project" chrome', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked(`/job-costing?projectId=${PROJECT_ID}`);
    const text = collectText(tree.toJSON()).join(' ');
    // The project header is only rendered on the resolved-project path; the
    // picker path shows the "pick a project at a time" message instead.
    expect(text).toContain('Harlow Residence');
    expect(text).not.toContain('one project at a time');
  });

  it('renders the by-phase section with PhaseBar rows', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked(`/job-costing?projectId=${PROJECT_ID}`);
    const text = collectText(tree.toJSON());

    // The section itself.
    expect(text).toContain('By phase');
    // PhaseBar renders a status pill whose label is one of these words. At least
    // one must be present — proof a PhaseBar actually mounted rather than the
    // "No phases yet" empty branch.
    expect(text).not.toContain('No phases yet');
    const pillLabels = ['On track', 'Watch', 'Over', 'Unbudgeted'];
    expect(text.some((s) => pillLabels.includes(s))).toBe(true);
  });

  it('renders StatusChip labels for the seeded commitments', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked(`/job-costing?projectId=${PROJECT_ID}`);
    const text = collectText(tree.toJSON());

    // The commitments list header carries the count. React splits the
    // `Commitments ({n})` node into separate string children, so assert on the
    // joined text rather than a single node.
    expect(text.join('')).toMatch(/Commitments \(\d+\)/);
    // StatusChip renders exactly these labels. The fixture seeds active + draft
    // commitments, so both chip variants must appear — 'Draft' in particular is
    // the chip whose fill/label contrast the leak fix repaired.
    expect(text).toContain('Active');
    expect(text).toContain('Draft');
  });
});
