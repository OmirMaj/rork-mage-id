/**
 * Wave 6c, lane E — the project workspace (app/project-detail.tsx).
 *
 * Part 1 is the PHONE-IDENTICAL proof. The snapshot below was written from the
 * PRE-lane-E source (main 77c00f3d, project-detail / ProjectHero / NextStepHero
 * untouched) BEFORE the desktop workspace existed, at 390 x 844 on the native
 * platform, with the populated fixture. It must never be regenerated to make a
 * change pass: a diff here means an iPhone no longer renders what it rendered
 * before the lane. (`jest -u` on this file is a design decision, not a fix.)
 * The fixture's project has no schedule, so ProjectHero's Schedule stat reads
 * '—' under both the old done-count ratio and computeProjectProgress — the one
 * phone delta the spec allows is therefore a zero diff here.
 *
 * Part 2 is the same screen at the founder's 1512 x 945 MacBook: the KPI strip,
 * the side-panel section host with ?tile= in the URL, and the job becoming the
 * active one. Desktop WEB is simulated by forcing useIsDesktopWeb() on (the
 * whole 16-provider app cannot run under a mocked Platform.OS 'web' in the
 * jest-expo native environment); the width gate is the real one.
 */

import React from 'react';
import { Dimensions } from 'react-native';
import { router } from 'expo-router';
import { fireEvent, act } from 'expo-router/testing-library';
import { cleanup } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';

// ── Environment steering (mock-prefixed so jest's hoisted factories may read them)
let mockDeskWeb = false;
const mockSetActive = jest.fn();

jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return {
    ...actual,
    // The width gate stays real; only the "and it is the web" half is forced.
    useIsDesktopWeb: () => {
      const desk = actual.useIsDesktop();
      return desk && (mockDeskWeb || require('react-native').Platform.OS === 'web');
    },
  };
});

jest.mock('@/contexts/ActiveProjectContext', () => {
  const actual = jest.requireActual('@/contexts/ActiveProjectContext');
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useActiveProject: () => {
      const v = actual.useActiveProject();
      const real = v.setActiveProject;
      const setActiveProject = R.useCallback((pid: string | null) => { mockSetActive(pid); real(pid); }, [real]);
      return R.useMemo(() => ({ ...v, setActiveProject }), [v, setActiveProject]);
    },
  };
});

type J = { type: string; props: Record<string, unknown>; children: (J | string)[] | null };

function viewport(width: number, height: number) {
  Dimensions.set({
    window: { width, height, scale: 3, fontScale: 1 },
    screen: { width, height, scale: 3, fontScale: 1 },
  });
}

/** Every testID in a rendered tree. */
function testIds(n: J | string | null, out: string[] = []): string[] {
  if (!n || typeof n === 'string') return out;
  if (typeof n.props?.testID === 'string') out.push(n.props.testID as string);
  for (const c of n.children ?? []) testIds(c, out);
  return out;
}

/** The path from `n` to the node with `testID`, root first. */
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

/**
 * project-detail's own subtree: the parent of the main ScrollView that holds
 * the hero. Everything outside it (the navigator's header, the providers'
 * banners, the brain FAB) belongs to other files and other lanes.
 */
function screenRoot(json: unknown): J {
  const roots = (Array.isArray(json) ? json : [json]) as J[];
  for (const r of roots) {
    const path = pathTo(r, 'hero-total-tap');
    if (!path) continue;
    for (let i = path.length - 1; i > 0; i--) {
      if (path[i].type === 'RCTScrollView') return path[i - 1];
    }
  }
  throw new Error('project-detail screen root not found (no hero-total-tap under a ScrollView)');
}

const URL = `/project-detail?id=${PROJECT_ID}`;

afterEach(() => {
  mockDeskWeb = false;
  mockSetActive.mockClear();
  jest.restoreAllMocks();
  cleanup();
});

describe('phone at 390 x 844 (native): project-detail renders exactly what it rendered before lane E', () => {
  beforeEach(() => viewport(390, 844));

  it('the job page, populated', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    expect(screenRoot(stripSanctioned(tree.toJSON()))).toMatchSnapshot();
  });

  it('keeps every phone control and draws no desktop workspace', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    const ids = new Set(testIds(screenRoot(tree.toJSON())));
    const present = [
      'hero-total-tap',
      'stage-chip-precon', 'stage-chip-construction', 'stage-chip-postcon', 'stage-chip-closeout',
      'project-copilot-hub-btn',
      'project-weekly-snapshot-btn', 'project-cash-flow-btn', 'project-payment-forecast-btn', 'project-closeout-packet-btn',
      'section-tile-dailyReports', 'tile-group-field',
      'open-share-modal', 'edit-project-bottom-btn', 'delete-project-btn',
    ];
    expect(present.filter(t => !ids.has(t))).toEqual([]);
    const absent = ['project-kpi-strip', 'project-section-panel', 'project-workspace-header', 'project-overview-columns', 'project-section-index'];
    expect(absent.filter(t => ids.has(t))).toEqual([]);
    expect(mockSetActive).not.toHaveBeenCalled();
  });

  it('a section tile opens the section sheet in place — no URL write', async () => {
    const setParams = jest.spyOn(router, 'setParams');
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    expect(tree.queryByTestId('section-modal-back')).toBeNull();
    // RFIs sit in Documentation, collapsed by default on a phone.
    fireEvent.press(tree.getByTestId('tile-group-docs'));
    await settle();
    fireEvent.press(tree.getByTestId('section-tile-rfis'));
    await settle();
    expect(tree.getByTestId('section-modal-back')).toBeTruthy();
    expect(setParams).not.toHaveBeenCalled();
  });
});

describe('desktop web at 1512 x 945: the workspace', () => {
  beforeEach(() => {
    viewport(1512, 945);
    mockDeskWeb = true;
  });

  it('draws the header, an 8-cell KPI strip, the overview and the section index, and makes the job active', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    expect(tree.getByTestId('project-workspace-header')).toBeTruthy();
    const ids = testIds(tree.toJSON() as J);
    const cells = ids.filter(t => /^project-kpi-strip-[a-z]+$/.test(t));
    expect(tree.getByTestId('project-kpi-strip')).toBeTruthy();
    expect(cells).toHaveLength(8);
    expect(tree.getByTestId('project-overview-columns')).toBeTruthy();
    expect(tree.getByTestId('project-section-index')).toBeTruthy();
    // The phone-only column is gone: no hero card, no stage chips row, no bottom buttons.
    for (const t of ['hero-total-tap', 'edit-project-bottom-btn', 'delete-project-btn', 'project-closeout-packet-btn']) {
      expect(ids.includes(t) ? t : null).toBeNull();
    }
    // The header carries the actions.
    for (const t of ['project-copilot-hub-btn', 'open-share-modal', 'edit-project-btn', 'project-scan-btn']) {
      expect(ids.includes(t) ? t : `missing ${t}`).toBe(t);
    }
    // Stage switch, same testIDs as the phone chips.
    for (const k of ['precon', 'construction', 'postcon', 'closeout']) {
      expect(ids.includes(`stage-chip-${k}`) ? k : `missing ${k}`).toBe(k);
    }
    expect(mockSetActive).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('a panel section opens in the side panel through ?tile=, never the full-window sheet', async () => {
    const setParams = jest.spyOn(router, 'setParams');
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    expect(tree.queryByTestId('project-section-panel')).toBeNull();
    fireEvent.press(tree.getByTestId('section-tile-photos'));
    await settle();
    expect(setParams).toHaveBeenCalledWith({ tile: 'photos' });
    expect(tree.getByTestId('project-section-panel')).toBeTruthy();
    expect(tree.queryByTestId('section-modal-back')).toBeNull();
    // The X closes it and clears the param.
    await act(async () => { fireEvent.press(tree.getByTestId('project-section-panel-close')); });
    await settle();
    expect(setParams).toHaveBeenLastCalledWith({ tile: undefined });
    expect(tree.queryByTestId('project-section-panel')).toBeNull();
  });

  it('a deep link with ?tile= opens the panel on load', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked(`${URL}&tile=photos`);
    expect(tree.getByTestId('project-section-panel')).toBeTruthy();
    expect(tree.queryByTestId('section-modal-back')).toBeNull();
  });
});
