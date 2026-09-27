/**
 * UX wave, Lane D ("the doors") — GOLDEN PHONE SNAPSHOTS.
 *
 * Recorded FIRST, on the untouched base (a102ff73, Lane 0 committed), before a
 * single Lane D edit. The spec says draft and estimated jobs KEEP the office
 * quick row (This Week, Cash Flow, Estimate, Schedule, Forecast); only
 * `in_progress` jobs get the field row. So the job page for an ESTIMATED job
 * is the pin for "the office row survives".
 *
 * The in_progress job page is already pinned by
 * project-workspace-desktop.test.tsx (its phone half); the Lane D field row is
 * a named delta there, reported to the orchestrator, never `jest -u`'d here.
 *
 * Harness: the project-workspace-desktop one (the real app, the populated
 * world, 390 x 844 native), with the fixture project's status patched after
 * primeWorld.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';
import { cleanup } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID, world } from '@/__tests__/fixtures/world';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';

type J = { type: string; props: Record<string, unknown>; children: (J | string)[] | null };

function viewport(width: number, height: number) {
  Dimensions.set({
    window: { width, height, scale: 3, fontScale: 1 },
    screen: { width, height, scale: 3, fontScale: 1 },
  });
}

function pathTo(n: J | string, testID: string, trail: J[] = []): J[] | null {
  if (typeof n === 'string') return null;
  const here = [...trail, n];
  if (n.props?.testID === testID) return here;
  for (const c of n.children ?? []) {
    const hit = pathTo(c, testID, here);
    if (hit) return hit;
  }
  return null;
}

function screenRoot(json: unknown): J {
  const roots = (Array.isArray(json) ? json : [json]) as J[];
  for (const r of roots) {
    const path = pathTo(r, 'hero-total-tap');
    if (!path) continue;
    for (let i = path.length - 1; i > 0; i--) {
      if (path[i].type === 'RCTScrollView') return path[i - 1];
    }
  }
  throw new Error('project-detail screen root not found');
}

async function primeWithStatus(status: string) {
  await primeWorld('populated');
  await AsyncStorage.setItem('mageid_projects', JSON.stringify([{ ...world.project, status }]));
}

afterEach(() => { cleanup(); });

describe('Lane D golden: the job page of a job that is not live keeps the office row', () => {
  beforeEach(() => viewport(390, 844));

  it('estimated job, 390 x 844 native', async () => {
    await primeWithStatus('estimated');
    const tree = await mountRouteChecked(`/project-detail?id=${PROJECT_ID}`);
    expect(screenRoot(stripSanctioned(tree.toJSON()))).toMatchSnapshot();
  });
});
