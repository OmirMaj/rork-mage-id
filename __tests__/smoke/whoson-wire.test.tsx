/**
 * Smoke — "who is on this project", the wiring (lane WHOWIRE): where the kit
 * (components/whoson, hooks/useProjectPeople) is mounted in the real app.
 *
 *   app/project-detail.tsx                       the stack in the phone hero and in the
 *                                                desktop header slot, the people block at
 *                                                the top of the Team card
 *   components/project/ProjectWorkspaceHeader    the `peopleSlot`
 *   components/collaborators/CollaboratorsManager  the avatar and the row extras on an
 *                                                accepted roster row, "Joined" for "Active"
 *   hooks/useProjectCollaborators.ts             invite / revoke / role change also
 *                                                refresh the people read
 *   app/(tabs)/settings/index.tsx                one row in the Legal group
 *   app/_layout.tsx                              the beacon, once, at the root
 *
 * THE FLAG. The feature ships dark: constants/featureFlags.ts WHOS_ON_ENABLED is
 * false. This file runs BOTH states: the flag is a getter on the mocked module
 * and `mockFlagOn` steers it.
 *
 * PART 1, GOLDENS. Recorded on the UNTOUCHED files (before any lane WHOWIRE
 * edit), with the flag off, a roster of two accepted team members and one
 * pending invite, and the people hook answering as if the server had rows.
 * They are run with --ci and never re-recorded: a diff here means that a
 * contractor with the feature off no longer sees what he saw before the lane.
 *   a  phone 390 x 844: the hero card
 *   b  phone 390 x 844: the Team section (owner, roster of three)
 *   c  desktop 1512 x 945: the workspace header
 *   d  desktop 1512 x 945: the Team section in the side panel
 *   e  phone 390 x 844: Settings, the Legal group
 *
 * PART 2, FLAG OFF: with the people hook answering, no whoson node anywhere,
 * the roster still says "Active", and the root beacon sends nothing.
 *
 * PART 3, FLAG ON, the server has not answered (the jest default: an empty
 * rpc answer): the hero, the header and Settings are the SAME trees as with
 * the flag off, and the Team section differs by one word per accepted row
 * ("Joined" where it said "Active"). Nothing else moves.
 *
 * PART 4, FLAG ON, the hook mocked to return an owner with three people:
 * where each node lands, what a press opens, and that exactly one modal is up.
 *
 * PART 5, the invalidation and the beacon mount.
 *
 * PART 6, END TO END: the REAL people hook, the REAL roster read and the real
 * beacon, against a server whose answers the test changes. Parts 2 to 5 pin
 * where things land with fixtures that never change, so they cannot see the
 * two reads disagree. Part 6 can:
 *   - the server answers rows: the stack, and the roster rows with their
 *     initials and lines, from one people read per open;
 *   - THE HEADLINE CASE: the owner sits on the project page, the sub accepts,
 *     the stack shows him, the owner taps it. The people read is fresh every
 *     minute and the roster read is kept five minutes, so the Team section
 *     used to say "Invited" under a stack that showed his initials. The
 *     roster is read again, once, and the row says "Joined";
 *   - a disagreement a fresh roster cannot settle costs ONE roster read in
 *     ten minutes, not one a minute;
 *   - a confirmed removal takes the person out of the stack and the roster,
 *     for one roster read;
 *   - a throw in the people read leaves the roster standing, without the
 *     feature, and the page never reaches the error boundary.
 *
 * PART 7, the desktop header at a narrow width: the people slot is left out
 * before it can squeeze the project's name away.
 *
 * The goldens of the feature ON (the hero title block, the header title block,
 * the people block, one accepted roster row) are new nodes, recorded once after
 * the build.
 */

import React from 'react';
import { Alert, Dimensions } from 'react-native';
import { router } from 'expo-router';
import { fireEvent, act } from 'expo-router/testing-library';
import { cleanup, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID, SMOKE_USER, world } from '@/__tests__/fixtures/world';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';
import { supabase } from '@/lib/supabase';
import type { ProjectCollaborator } from '@/types';
import { useProjectCollaborators } from '@/hooks/useProjectCollaborators';
import { __resetPeopleClientForTest } from '@/utils/whoson/peopleClient';

// ── Environment steering (mock-prefixed so jest's hoisted factories may read them)

let mockFlagOn = false;
jest.mock('@/constants/featureFlags', () => {
  // defineProperty, not `{ ...actual, get X() {} }`: the object-spread helper
  // would read the getter once, at factory time, and freeze its value.
  const mod = { ...jest.requireActual('@/constants/featureFlags') };
  Object.defineProperty(mod, 'WHOS_ON_ENABLED', { enumerable: true, get: () => mockFlagOn });
  return mod;
});

/** The people rows the hook answers with, as the server sends them. null = the REAL hook. */
let mockPeopleRows: Record<string, unknown>[] | null = null;
/** The people hook throws while rendering (a bug in the feature, simulated). */
let mockPeopleThrows = false;
jest.mock('@/hooks/useProjectPeople', () => {
  const actual = jest.requireActual('@/hooks/useProjectPeople');
  const P = jest.requireActual('@/utils/whoson/people');
  // The fixture is set before a mount and never changes during it, so each
  // mount keeps one hook order.
  const useProjectPeople = (projectId: string | null | undefined) => {
    if (mockPeopleThrows) throw new Error('the people read threw (simulated)');
    if (!mockPeopleRows) return actual.useProjectPeople(projectId);
    const now = Date.now();
    const model = P.peopleModel(P.mapPeopleRows(mockPeopleRows), { fetchedAtMs: now, nowMs: now });
    return {
      people: model.known && model.owner ? [model.owner, ...model.members] : [],
      model,
      view: model.known ? 'list' : 'none',
      fetchedAtMs: now,
      nowMs: now,
      refetch: () => {},
    };
  };
  return { ...actual, useProjectPeople, default: useProjectPeople };
});

/** The roster the Team section lists. null = the real read (an empty mock answer). */
let mockRoster: ProjectCollaborator[] | null = null;
jest.mock('@/hooks/useProjectCollaborators', () => {
  const actual = jest.requireActual('@/hooks/useProjectCollaborators');
  return {
    ...actual,
    useProjectCollaborators: (projectId: string | undefined) => {
      const real = actual.useProjectCollaborators(projectId);
      return mockRoster
        ? { ...real, collaborators: mockRoster, isLoading: false, isError: false, isPaused: false, hasData: true }
        : real;
    },
  };
});

/** This account's saved choice, for the Settings row. undefined = the real read. */
let mockChoice: { choice: boolean | null; known: boolean } | undefined;
jest.mock('@/hooks/useSharePresence', () => {
  const actual = jest.requireActual('@/hooks/useSharePresence');
  const useSharePresence = (opts?: { read?: boolean }) => {
    const real = actual.useSharePresence(opts);
    return mockChoice ? { ...real, ...mockChoice } : real;
  };
  return { ...actual, useSharePresence, default: useSharePresence };
});

let mockDeskWeb = false;
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

// The seat's role. null = the real resolution (the populated world's owner).
let mockRole: 'owner' | 'field' | null = null;
jest.mock('@/hooks/useProjectRole', () => {
  const actual = jest.requireActual('@/hooks/useProjectRole');
  return {
    ...actual,
    useProjectRoleState: (pid: string | undefined) => {
      const real = actual.useProjectRoleState(pid);
      return mockRole ? { ...real, role: mockRole, isLoading: false, isError: false } : real;
    },
    useProjectRole: (pid: string | undefined) => {
      const real = actual.useProjectRole(pid);
      return mockRole ?? real;
    },
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const DANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const LUIS = 'aaaaaaaa-0000-4000-8000-000000000002';
const PRIYA = 'aaaaaaaa-0000-4000-8000-000000000003';
type Row = Record<string, unknown>;

function ownerRow(over: Row = {}): Row {
  return {
    user_id: SMOKE_USER.id, kind: 'owner', role: 'owner', display_name: 'Dana Ortiz', company_name: 'Ridgeline Builders',
    is_self: true, invited_by_viewer: false, invited_email: null, joined_at: null,
    open_expires_s: null, last_seen_at: null, seen_age_s: null, shares_presence: true, ...over,
  };
}
function memberRow(userId: string, over: Row = {}): Row {
  return {
    user_id: userId, kind: 'member', role: 'field', display_name: null, company_name: null,
    is_self: false, invited_by_viewer: true, invited_email: null,
    // Midday UTC: the same calendar day in every American time zone and in CI.
    joined_at: '2026-09-12T16:00:00Z',
    open_expires_s: null, last_seen_at: null, seen_age_s: null, shares_presence: null, ...over,
  };
}

/** The owner's read: himself and three team members. One has it open, one was seen 12 minutes ago. */
const OWNER_AND_THREE: Row[] = [
  ownerRow(),
  memberRow(DANA, { display_name: 'Dana Ruiz', company_name: 'Ruiz Electric', invited_email: 'dana@ruizelectric.test', open_expires_s: 120, last_seen_at: '2026-10-04T15:59:30Z', seen_age_s: 30 }),
  memberRow(LUIS, { role: 'editor', display_name: 'Luis Peña', invited_email: 'luis@penaplumbing.test', joined_at: '2026-09-14T16:00:00Z', last_seen_at: '2026-10-04T15:48:00Z', seen_age_s: 720 }),
  memberRow(PRIYA, { role: 'viewer', invited_email: 'priya@harlowarchitects.test', invited_by_viewer: false, joined_at: '2026-09-20T16:00:00Z' }),
];

/** A Field team member's read: the owner and himself. Nobody else. */
const THE_OWNER = 'bbbbbbbb-0000-4000-8000-000000000009';
const FIELD_VIEW: Row[] = [
  ownerRow({ user_id: THE_OWNER, display_name: 'Omar Haddad', company_name: 'Haddad Construction', is_self: false, shares_presence: null, open_expires_s: 90 }),
  memberRow(SMOKE_USER.id, { is_self: true, invited_by_viewer: false, display_name: 'Dana Ortiz', shares_presence: true }),
];

function rosterRow(id: string, email: string, role: ProjectCollaborator['role'], status: ProjectCollaborator['status'], userId: string | null, acceptedAt: string | null): ProjectCollaborator {
  return { id, email, name: '', role, status, invitedAt: '2026-09-10T16:00:00Z', projectId: PROJECT_ID, userId, acceptedAt };
}
/** What project_collaborators holds: two accepted, one still pending. */
const ROSTER: ProjectCollaborator[] = [
  rosterRow('c-dana', 'dana@ruizelectric.test', 'field', 'accepted', DANA, '2026-09-12T16:00:00Z'),
  rosterRow('c-luis', 'luis@penaplumbing.test', 'editor', 'accepted', LUIS, '2026-09-14T16:00:00Z'),
  rosterRow('c-sam', 'sam@samsdrywall.test', 'field', 'pending', null, null),
];
/** The roster that goes with OWNER_AND_THREE: the same three people accepted, and Sam still pending.
 *  (ROSTER is the goldens' fixture and stays as recorded.) */
const ROSTER_OF_THREE: ProjectCollaborator[] = [
  ROSTER[0],
  ROSTER[1],
  rosterRow('c-priya', 'priya@harlowarchitects.test', 'viewer', 'accepted', PRIYA, '2026-09-20T16:00:00Z'),
  ROSTER[2],
];

// ── Tree helpers ─────────────────────────────────────────────────────────────

type J = { type: string; props: Record<string, unknown>; children: (J | string)[] | null };

function viewport(width: number, height: number) {
  Dimensions.set({
    window: { width, height, scale: 3, fontScale: 1 },
    screen: { width, height, scale: 3, fontScale: 1 },
  });
}

function roots(json: unknown): J[] {
  return (Array.isArray(json) ? json : [json]).filter(Boolean) as J[];
}

/** Every testID in a rendered tree. */
function testIds(n: unknown, out: string[] = []): string[] {
  if (Array.isArray(n)) { for (const c of n) testIds(c, out); return out; }
  if (!n || typeof n === 'string') return out;
  const node = n as J;
  if (typeof node.props?.testID === 'string') out.push(node.props.testID as string);
  for (const c of node.children ?? []) testIds(c, out);
  return out;
}
const whosonIds = (n: unknown): string[] => testIds(n).filter((t) => t.startsWith('whoson-'));

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
function pathIn(json: unknown, testID: string): J[] {
  for (const r of roots(json)) {
    const hit = pathTo(r, testID);
    if (hit) return hit;
  }
  throw new Error(`no node with testID ${testID}`);
}
const nodeIn = (json: unknown, testID: string): J => pathIn(json, testID).slice(-1)[0];
const parentIn = (json: unknown, testID: string): J => pathIn(json, testID).slice(-2)[0];

/** Every string a subtree prints. */
function texts(n: unknown, out: string[] = []): string[] {
  if (typeof n === 'string') { out.push(n); return out; }
  if (Array.isArray(n)) { for (const c of n) texts(c, out); return out; }
  if (!n || typeof n !== 'object') return out;
  for (const c of (n as J).children ?? []) texts(c, out);
  return out;
}
const says = (n: unknown, text: string): boolean => texts(n).includes(text);

/** The hero card: the lowest ancestor of the hero total that also prints the project's name. */
function heroCard(json: unknown): J {
  const path = pathIn(json, 'hero-total-tap');
  for (let i = path.length - 1; i >= 0; i--) {
    if (says(path[i], world.project.name)) return path[i];
  }
  throw new Error('no hero card');
}

/**
 * project-detail's own subtree: the parent of the main ScrollView that holds
 * the hero. Everything outside it (the navigator, whose screen ids are random
 * per mount, the providers' banners, the brain FAB) belongs to other files.
 */
function screenRoot(json: unknown): J {
  const path = pathIn(json, 'hero-total-tap');
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i].type === 'RCTScrollView') return path[i - 1];
  }
  throw new Error('project-detail screen root not found (no hero-total-tap under a ScrollView)');
}

/** The Team section: the block that holds its header. */
const teamSection = (json: unknown): J => parentIn(json, 'collaborators-section');

/** Modals that are UP. React Native's jest Modal keeps a closed one in the tree with visible=false. */
function openModals(n: unknown, out: J[] = []): J[] {
  if (Array.isArray(n)) { for (const c of n) openModals(c, out); return out; }
  if (!n || typeof n === 'string') return out;
  const node = n as J;
  if (node.type === 'Modal' && node.props?.visible === true) out.push(node);
  for (const c of node.children ?? []) openModals(c, out);
  return out;
}

const URL = `/project-detail?id=${PROJECT_ID}`;
const TEAM_URL = `${URL}&tile=collaborators`;

function peopleCalls(spy: jest.SpyInstance): unknown[][] {
  return spy.mock.calls.filter((c) => c[0] === 'project_people' || c[0] === 'set_share_presence');
}

beforeEach(() => {
  mockFlagOn = false;
  mockPeopleRows = null;
  mockPeopleThrows = false;
  mockRoster = null;
  mockChoice = undefined;
  mockDeskWeb = false;
  mockRole = null;
  // The client keeps its back-off, its pause and each account's choice in memory.
  __resetPeopleClientForTest();
});

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

jest.setTimeout(120000);

// ── PART 1: the goldens, recorded on the untouched files ─────────────────────

describe('GOLDEN, flag off: what the screens rendered before lane WHOWIRE', () => {
  beforeEach(() => {
    mockPeopleRows = OWNER_AND_THREE;
    mockRoster = ROSTER;
    mockChoice = { choice: true, known: true };
  });

  it('a  phone 390 x 844: the hero card', async () => {
    viewport(390, 844);
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    expect(heroCard(stripSanctioned(tree.toJSON()))).toMatchSnapshot();
  });

  it('b  phone 390 x 844: the Team section, an owner with a roster of three', async () => {
    viewport(390, 844);
    await primeWorld('populated');
    const tree = await mountRouteChecked(TEAM_URL);
    const section = teamSection(tree.toJSON());
    // The fixture is really on screen: both accepted rows and the pending one.
    expect(says(section, 'dana@ruizelectric.test')).toBe(true);
    expect(says(section, 'sam@samsdrywall.test')).toBe(true);
    expect(section).toMatchSnapshot();
  });

  it('c  desktop 1512 x 945: the workspace header', async () => {
    viewport(1512, 945);
    mockDeskWeb = true;
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    expect(nodeIn(tree.toJSON(), 'project-workspace-header')).toMatchSnapshot();
  });

  it('d  desktop 1512 x 945: the Team section in the side panel', async () => {
    viewport(1512, 945);
    mockDeskWeb = true;
    await primeWorld('populated');
    const tree = await mountRouteChecked(TEAM_URL);
    const panel = nodeIn(tree.toJSON(), 'project-section-panel');
    const section = teamSection(panel);
    expect(says(section, 'dana@ruizelectric.test')).toBe(true);
    expect(section).toMatchSnapshot();
  });

  it('e  phone 390 x 844: Settings, the Legal group', async () => {
    viewport(390, 844);
    await primeWorld('populated');
    const tree = await mountRouteChecked('/settings');
    expect(parentIn(tree.toJSON(), 'settings-do-not-sell')).toMatchSnapshot();
  });
});

// ── PART 2: flag off ─────────────────────────────────────────────────────────

/** Let three minutes pass: three of the beacon's ticks, if it were ticking. */
async function threeMinutes(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      jest.advanceTimersByTime(61_000);
      await Promise.resolve();
    });
  }
}

describe('flag OFF: nothing of the feature exists, even with the server answering', () => {
  beforeEach(() => {
    mockPeopleRows = OWNER_AND_THREE;
    mockRoster = ROSTER;
    mockChoice = { choice: true, known: true };
  });

  it('phone: no whoson node on the project page or in the Team section; the roster says "Active"', async () => {
    const rpc = jest.spyOn(supabase, 'rpc');
    viewport(390, 844);
    await primeWorld('populated');
    const tree = await mountRouteChecked(TEAM_URL);
    const json = tree.toJSON();
    expect(whosonIds(json)).toEqual([]);
    const section = teamSection(json);
    expect(texts(section).filter((t) => t === 'Active')).toHaveLength(2);
    expect(says(section, 'Joined')).toBe(false);
    await threeMinutes();
    expect(whosonIds(tree.toJSON())).toEqual([]);
    expect(peopleCalls(rpc)).toEqual([]);
  });

  it('Settings: no row, though this account\'s choice is known', async () => {
    const rpc = jest.spyOn(supabase, 'rpc');
    viewport(390, 844);
    await primeWorld('populated');
    const tree = await mountRouteChecked('/settings');
    expect(tree.getByTestId('settings-do-not-sell')).toBeTruthy();
    expect(whosonIds(tree.toJSON())).toEqual([]);
    expect(peopleCalls(rpc)).toEqual([]);
  });

  it('desktop: no whoson node in the header or the side panel', async () => {
    const rpc = jest.spyOn(supabase, 'rpc');
    viewport(1512, 945);
    mockDeskWeb = true;
    await primeWorld('populated');
    const tree = await mountRouteChecked(TEAM_URL);
    expect(tree.getByTestId('project-workspace-header')).toBeTruthy();
    expect(tree.getByTestId('project-section-panel')).toBeTruthy();
    expect(whosonIds(tree.toJSON())).toEqual([]);
    expect(peopleCalls(rpc)).toEqual([]);
  });

  it('the real hooks and the root beacon send nothing: three minutes on the project page, no request', async () => {
    mockPeopleRows = null; // the real useProjectPeople
    mockChoice = undefined; // the real useSharePresence
    const rpc = jest.spyOn(supabase, 'rpc');
    viewport(390, 844);
    await primeWorld('populated');
    const tree = await mountRouteChecked(TEAM_URL);
    await threeMinutes();
    expect(whosonIds(tree.toJSON())).toEqual([]);
    expect(peopleCalls(rpc)).toEqual([]);
  });
});

// ── PART 3: flag on, the server has not answered ─────────────────────────────

describe('flag ON, default jest mock (an empty answer): nothing renders and nothing else moves', () => {
  /** Mount `url` with the flag as given and return the picked subtree, as text. */
  async function shot(flag: boolean, url: string, pick: (json: unknown) => unknown): Promise<{ text: string; ids: string[] }> {
    mockFlagOn = flag;
    __resetPeopleClientForTest();
    await primeWorld('populated');
    const tree = await mountRouteChecked(url);
    const json = tree.toJSON();
    const out = { text: JSON.stringify(pick(json)), ids: whosonIds(json) };
    cleanup();
    return out;
  }

  beforeEach(() => {
    mockRoster = ROSTER; // the roster read answers; the people read does not
  });

  it('phone: the whole project page (the screen\'s own subtree) is the same tree as with the flag off', async () => {
    viewport(390, 844);
    const off = await shot(false, URL, screenRoot);
    const on = await shot(true, URL, screenRoot);
    expect(off.text).toContain('hero-total-tap');
    expect(off.text).toContain('section-tile-dailyReports');
    expect(on.ids).toEqual([]);
    expect(on.text === off.text).toBe(true);
  });

  it('phone: the Team section differs by one word per accepted row, "Joined" for "Active"', async () => {
    viewport(390, 844);
    const off = await shot(false, TEAM_URL, teamSection);
    const on = await shot(true, TEAM_URL, teamSection);
    expect(on.ids).toEqual([]);
    expect(off.text.split('"Active"').length - 1).toBe(2);
    expect(off.text).not.toContain('"Joined"');
    expect(on.text).not.toContain('"Active"');
    expect(on.text).toBe(off.text.replace(/"Active"/g, '"Joined"'));
  });

  it('desktop: the workspace header is the same tree as with the flag off, and the panel differs by the same word', async () => {
    viewport(1512, 945);
    mockDeskWeb = true;
    const offHeader = await shot(false, URL, (j) => nodeIn(j, 'project-workspace-header'));
    const onHeader = await shot(true, URL, (j) => nodeIn(j, 'project-workspace-header'));
    expect(onHeader.ids).toEqual([]);
    expect(onHeader.text).toBe(offHeader.text);
    const offPanel = await shot(false, TEAM_URL, (j) => teamSection(nodeIn(j, 'project-section-panel')));
    const onPanel = await shot(true, TEAM_URL, (j) => teamSection(nodeIn(j, 'project-section-panel')));
    expect(onPanel.ids).toEqual([]);
    expect(onPanel.text).toBe(offPanel.text.replace(/"Active"/g, '"Joined"'));
  });

  it('Settings: the Legal group is the same tree as with the flag off (the choice has not been read)', async () => {
    viewport(390, 844);
    const off = await shot(false, '/settings', (j) => parentIn(j, 'settings-do-not-sell'));
    const on = await shot(true, '/settings', (j) => parentIn(j, 'settings-do-not-sell'));
    expect(on.ids).toEqual([]);
    expect(on.text).toBe(off.text);
  });
});

// ── PART 4: flag on, the hook answers with an owner and three people ─────────

describe('flag ON, phone 390 x 844: an owner with three people on the project', () => {
  beforeEach(() => {
    mockFlagOn = true;
    mockPeopleRows = OWNER_AND_THREE;
    mockRoster = ROSTER_OF_THREE;
    mockChoice = { choice: true, known: true };
    viewport(390, 844);
  });

  it('the stack is the last child of the hero title block, under the name, the address and the description', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    const json = stripSanctioned(tree.toJSON());
    const hero = heroCard(json);
    const path = pathIn(hero, 'whoson-stack');
    const titleBlock = path[path.length - 2];
    const kids = (titleBlock.children ?? []) as J[];
    // name, address row, description, then the stack: nothing after it.
    expect(texts(kids[0])).toEqual([world.project.name]);
    expect(kids[kids.length - 1].props.testID).toBe('whoson-stack');
    expect(kids).toHaveLength(4);
    // One avatar each for the owner and the three team members, one dot (Dana has it open).
    const ids = whosonIds(hero);
    expect(ids.filter((t) => t.startsWith('whoson-avatar-'))).toEqual([
      `whoson-avatar-${SMOKE_USER.id}`, `whoson-avatar-${DANA}`, `whoson-avatar-${LUIS}`, `whoson-avatar-${PRIYA}`,
    ]);
    expect(ids.filter((t) => t.startsWith('whoson-dot-'))).toEqual([`whoson-dot-${DANA}`]);
    expect(says(hero, '1 has it open')).toBe(true);
    // The fixture project has its client portal on: no "Invite" word (spec D10), and no email anywhere in the hero.
    expect(says(hero, 'Invite')).toBe(false);
    expect(texts(hero).filter((t) => t.includes('@'))).toEqual([]);
    expect(String(nodeIn(hero, 'whoson-stack').props.accessibilityLabel)).not.toContain('@');
    // Nowhere else on the page: the navigator header and the tiles carry no whoson node.
    expect(whosonIds(json).filter((t) => t === 'whoson-stack')).toHaveLength(1);
    expect(openModals(tree.toJSON())).toHaveLength(0);
    expect(titleBlock).toMatchSnapshot();
  });

  it('an owner nobody has joined: "No team members yet", and no "Invite" word while the client portal is on (D10)', async () => {
    mockPeopleRows = [ownerRow()];
    mockRoster = [];
    await primeWorld('populated');
    expect(world.project.clientPortal?.enabled).toBe(true);
    const tree = await mountRouteChecked(URL);
    const hero = heroCard(tree.toJSON());
    expect(says(hero, 'No team members yet')).toBe(true);
    expect(says(hero, 'Invite')).toBe(false);
    expect(String(nodeIn(hero, 'whoson-stack').props.accessibilityLabel)).not.toContain('Invite');
  });

  it('…and with the client portal off the same owner is offered "Invite"', async () => {
    mockPeopleRows = [ownerRow()];
    mockRoster = [];
    await primeWorld('populated');
    const stored = JSON.parse((await AsyncStorage.getItem('mageid_projects')) ?? '[]') as { id: string; clientPortal?: { enabled: boolean } }[];
    const mine = stored.find((p) => p.id === PROJECT_ID);
    expect(mine?.clientPortal?.enabled).toBe(true);
    if (mine?.clientPortal) mine.clientPortal.enabled = false;
    await AsyncStorage.setItem('mageid_projects', JSON.stringify(stored));
    const tree = await mountRouteChecked(URL);
    const hero = heroCard(tree.toJSON());
    expect(says(hero, 'No team members yet')).toBe(true);
    expect(says(hero, 'Invite')).toBe(true);
  });

  it('pressing the stack opens the Team section this page already has: one modal, the people block first, no URL write', async () => {
    const setParams = jest.spyOn(router, 'setParams');
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    expect(tree.queryByTestId('section-modal-back')).toBeNull();
    expect(tree.queryByTestId('whoson-people')).toBeNull();
    fireEvent.press(tree.getByTestId('whoson-stack'));
    await settle();
    const json = tree.toJSON();
    expect(tree.getByTestId('section-modal-back')).toBeTruthy();
    expect(setParams).not.toHaveBeenCalled();
    // Exactly one modal is up, and the Team section is inside it.
    const up = openModals(json);
    expect(up).toHaveLength(1);
    const section = teamSection(up[0]);
    // The people block is the FIRST child of the Team card, ahead of the owner's own row.
    const card = parentIn(section, 'whoson-people');
    const kids = (card.children ?? []) as J[];
    expect(kids[0].props.testID).toBe('whoson-people');
    expect(kids[1].props.testID).toBe('team-owner-row-self');
    // The block itself (the kit's node), not the whole card: the invite form
    // and the seat line under it belong to other lanes.
    expect(kids[0]).toMatchSnapshot();
  });

  it('the roster: an accepted row gains the avatar and its lines, a pending row gains nothing, and the word is "Joined"', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked(TEAM_URL);
    const section = teamSection(tree.toJSON());
    const ids = whosonIds(section);
    expect(ids).toContain(`whoson-avatar-${DANA}`);
    expect(ids).toContain(`whoson-row-${DANA}`);
    expect(ids).toContain(`whoson-row-dot-${DANA}`);
    expect(ids).toContain(`whoson-avatar-${LUIS}`);
    expect(ids).toContain(`whoson-row-${LUIS}`);
    expect(ids).toContain(`whoson-avatar-${PRIYA}`);
    // Three accepted rows, three people. Sam is pending: no avatar, no lines, nothing claimed.
    expect(ids.filter((t) => t.startsWith('whoson-avatar-'))).toHaveLength(3);
    expect(ids.filter((t) => t.startsWith('whoson-row-') && !t.startsWith('whoson-row-dot-'))).toHaveLength(3);
    // Priya typed no name and was invited by someone else: one line, the date. Never her email again.
    expect(texts(nodeIn(section, `whoson-row-${PRIYA}`))).toEqual(['Joined Sep 20, 2026']);
    // The avatar sits to the LEFT of the text column that carries the email.
    const row = pathIn(section, `whoson-avatar-${DANA}`).slice(-3)[0];
    const rowKids = (row.children ?? []) as J[];
    expect(whosonIds(rowKids[0])).toContain(`whoson-avatar-${DANA}`);
    expect(texts(rowKids[1])[0]).toBe('dana@ruizelectric.test');
    // The lines sit right after the role line, ahead of the role chips.
    const column = parentIn(section, `whoson-row-${DANA}`);
    const colKids = (column.children ?? []) as J[];
    expect(texts(colKids[1])).toEqual(['Field', ' · ', 'Joined']);
    expect(colKids[2].props.testID).toBe(`whoson-row-${DANA}`);
    expect(texts(colKids[2])).toEqual(['Dana Ruiz · Ruiz Electric', 'Joined from your invite · Sep 12, 2026', 'Has it open now']);
    expect(texts(nodeIn(section, `whoson-row-${LUIS}`))).toEqual(['Luis Peña', 'Joined from your invite · Sep 14, 2026', 'Last seen online here 12 min ago']);
    // The pending row is what it was.
    expect(says(section, 'sam@samsdrywall.test')).toBe(true);
    expect(texts(section).filter((t) => t === 'Invited')).toHaveLength(1);
    expect(says(section, 'Active')).toBe(false);
    // One accepted row, whole: the avatar, the email, the role line, the three lines, the role picker, Remove.
    expect(row).toMatchSnapshot();
  });

  it('a roster row for the owner\'s own address never borrows the owner row', async () => {
    // He invited his own email and accepted: the server lists him once, as the owner.
    // (The roster would otherwise resolve this seat as an editor: the role is pinned to what the server says.)
    mockRole = 'owner';
    mockRoster = [...ROSTER_OF_THREE, rosterRow('c-self', SMOKE_USER.email, 'editor', 'accepted', SMOKE_USER.id, '2026-09-11T16:00:00Z')];
    await primeWorld('populated');
    const tree = await mountRouteChecked(TEAM_URL);
    const section = teamSection(tree.toJSON());
    expect(says(section, SMOKE_USER.email)).toBe(true);
    expect(whosonIds(section).filter((t) => t.includes(SMOKE_USER.id))).toEqual([]);
  });

  it('a Field team member: the people block leads the Team card, the roster is not there, and nobody else is named', async () => {
    mockRole = 'field';
    mockPeopleRows = FIELD_VIEW;
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    // Two avatars, never a chip.
    const hero = heroCard(tree.toJSON());
    expect(whosonIds(hero).filter((t) => t.startsWith('whoson-avatar-'))).toHaveLength(2);
    expect(whosonIds(hero)).not.toContain('whoson-overflow');
    fireEvent.press(tree.getByTestId('whoson-stack'));
    await settle();
    const up = openModals(tree.toJSON());
    expect(up).toHaveLength(1);
    const card = parentIn(up[0], 'whoson-people');
    const kids = (card.children ?? []) as J[];
    expect(kids[0].props.testID).toBe('whoson-people');
    expect(kids[1].props.testID).toBe('team-owner-row-other');
    expect(tree.queryByTestId('collab-email')).toBeNull();
    const all = texts(card);
    expect(all.filter((t) => t.includes('@'))).toEqual([]);
    for (const name of ['Dana Ruiz', 'Ruiz Electric', 'Luis Peña']) expect(all.join(' ')).not.toContain(name);
  });

  it('Settings: the row is the last of the Legal group, right after "Do not sell my info"', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked('/settings');
    const group = parentIn(tree.toJSON(), 'settings-do-not-sell');
    const kids = (group.children ?? []) as J[];
    expect(kids[kids.length - 2].props.testID).toBe('settings-do-not-sell');
    expect(kids[kids.length - 1].props.testID).toBe('whoson-setting');
    expect(says(group, 'Show when I have a project open')).toBe(true);
  });

  it('Settings: no row until the server has answered what this account chose', async () => {
    mockChoice = { choice: null, known: false };
    await primeWorld('populated');
    const tree = await mountRouteChecked('/settings');
    expect(tree.getByTestId('settings-do-not-sell')).toBeTruthy();
    expect(whosonIds(tree.toJSON())).toEqual([]);
  });
});

describe('flag ON, desktop web 1512 x 945: an owner with three people on the project', () => {
  beforeEach(() => {
    mockFlagOn = true;
    mockPeopleRows = OWNER_AND_THREE;
    mockRoster = ROSTER_OF_THREE;
    mockChoice = { choice: true, known: true };
    viewport(1512, 945);
    mockDeskWeb = true;
  });

  it('the stack sits in Row A of the workspace header, right after the name block; the KPI strip keeps its 8 cells', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    const json = tree.toJSON();
    const header = nodeIn(json, 'project-workspace-header');
    const path = pathIn(header, 'whoson-stack');
    const titleBlock = path[path.length - 2];
    const kids = (titleBlock.children ?? []) as J[];
    // breadcrumb, name block, the stack.
    expect(kids).toHaveLength(3);
    expect(kids[0].props.testID).toBe('project-breadcrumb-projects');
    expect(texts(kids[1])[0]).toBe(world.project.name);
    expect(kids[2].props.testID).toBe('whoson-stack');
    expect(whosonIds(json).filter((t) => t === 'whoson-stack')).toHaveLength(1);
    // 1512 less the 240 sidebar is under 1280: three slots (two people and a
    // "+2" chip for the other two), and the words live in the accessibility
    // label only.
    expect(whosonIds(header).filter((t) => t.startsWith('whoson-avatar-'))).toEqual([`whoson-avatar-${SMOKE_USER.id}`, `whoson-avatar-${DANA}`]);
    expect(texts(nodeIn(header, 'whoson-overflow'))).toEqual(['+2']);
    expect(says(header, '1 has it open')).toBe(false);
    expect(nodeIn(header, 'whoson-stack').props.accessibilityLabel).toBe('Team on this project: 4. 1 has it open now.');
    const cells = testIds(json).filter((t) => /^project-kpi-strip-[a-z]+$/.test(t));
    expect(cells).toHaveLength(8);
    // The toolbar is still there, after the title block.
    expect(tree.getByTestId('project-toolbar')).toBeTruthy();
    expect(titleBlock).toMatchSnapshot();
  });

  it('at 1728 wide there is room: four avatars and the words beside them', async () => {
    viewport(1728, 1117);
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    const header = nodeIn(tree.toJSON(), 'project-workspace-header');
    expect(whosonIds(header).filter((t) => t.startsWith('whoson-avatar-'))).toHaveLength(4);
    expect(whosonIds(header)).not.toContain('whoson-overflow');
    expect(says(header, '1 has it open')).toBe(true);
  });

  it('pressing the stack opens the Team section in the side panel through ?tile=, never a modal', async () => {
    const setParams = jest.spyOn(router, 'setParams');
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    expect(tree.queryByTestId('project-section-panel')).toBeNull();
    fireEvent.press(tree.getByTestId('whoson-stack'));
    await settle();
    expect(setParams).toHaveBeenCalledWith({ tile: 'collaborators' });
    const panel = nodeIn(tree.toJSON(), 'project-section-panel');
    const card = parentIn(panel, 'whoson-people');
    expect(((card.children ?? []) as J[])[0].props.testID).toBe('whoson-people');
    expect(whosonIds(panel)).toContain(`whoson-row-${DANA}`);
    expect(tree.queryByTestId('section-modal-back')).toBeNull();
    expect(openModals(tree.toJSON())).toHaveLength(0);
  });
});

// ── PART 5: the beacon at the root, and the invalidation ─────────────────────

describe('flag ON: the beacon is mounted once at the root and reads the project from the route', () => {
  beforeEach(() => {
    mockFlagOn = true;
    // The hook is mocked, so it sends nothing: any request below is the beacon's.
    mockPeopleRows = OWNER_AND_THREE;
    mockRoster = ROSTER;
    mockChoice = { choice: true, known: true };
    viewport(390, 844);
  });

  it('on the project page: one read for THIS project', async () => {
    const rpc = jest.spyOn(supabase, 'rpc');
    await primeWorld('populated');
    await mountRouteChecked(URL);
    const calls = peopleCalls(rpc);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const c of calls) expect(c).toEqual(['project_people', { p_project_id: PROJECT_ID, p_mark: 'none' }]);
    // The default answer is empty, so the beacon stops for this project: it does not ask again.
    const before = calls.length;
    await threeMinutes();
    expect(peopleCalls(rpc)).toHaveLength(before);
    expect(before).toBe(1);
  });

  it('on Home: no project is in front, so nothing is sent', async () => {
    const rpc = jest.spyOn(supabase, 'rpc');
    await primeWorld('populated');
    await mountRouteChecked('/');
    await threeMinutes();
    expect(peopleCalls(rpc)).toEqual([]);
  });
});

describe('the roster mutations also refresh the people read', () => {
  it('a revoke that the server confirms invalidates [project_people] along with the roster', async () => {
    jest.useRealTimers();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const peopleKey = ['project_people', SMOKE_USER.id, PROJECT_ID];
    const otherKey = ['whoson_choice', SMOKE_USER.id];
    qc.setQueryData(peopleKey, { people: [], fetchedAtMs: 1 });
    qc.setQueryData(otherKey, { choice: true });
    expect(qc.getQueryState(peopleKey)?.isInvalidated).toBe(false);
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(() => useProjectCollaborators(PROJECT_ID), { wrapper });
    await act(async () => { await result.current.revoke.mutateAsync('c-dana'); });
    expect(qc.getQueryState(peopleKey)?.isInvalidated).toBe(true);
    // Only the people read: this account's saved choice is not touched.
    expect(qc.getQueryState(otherKey)?.isInvalidated).toBe(false);
    unmount();
    qc.clear();
  });
});

// ── PART 6: end to end, the real hooks against a server whose answers change ─

/** What the server holds. The test changes it; every read after that sees the change. */
const live = {
  /** project_people() rows, as this viewer receives them. */
  people: [] as Row[],
  /** project_collaborators rows, as RLS lets this viewer read them. */
  roster: [] as Record<string, unknown>[],
  rosterReads: 0,
  /** How long the roster table takes to answer. 0 = at once. */
  rosterDelayMs: 0,
  /** The `p_mark` of every project_people call, in order. */
  marks: [] as string[],
};

const dbRow = (id: string, email: string, role: string, status: string, userId: string | null, acceptedAt: string | null): Record<string, unknown> => ({
  id, project_id: PROJECT_ID, invited_email: email, user_id: userId, role, status,
  invited_at: '2026-09-10T16:00:00Z', accepted_at: acceptedAt,
});
const DANA_PERSON = memberRow(DANA, { display_name: 'Dana Ruiz', company_name: 'Ruiz Electric', invited_email: 'dana@ruizelectric.test' });
const LUIS_PERSON = memberRow(LUIS, { role: 'editor', display_name: 'Luis Peña', invited_email: 'luis@penaplumbing.test', joined_at: '2026-09-14T16:00:00Z' });
const DANA_PENDING = dbRow('c-dana', 'dana@ruizelectric.test', 'field', 'pending', null, null);
const DANA_ACCEPTED = dbRow('c-dana', 'dana@ruizelectric.test', 'field', 'accepted', DANA, '2026-09-12T16:00:00Z');
const LUIS_ACCEPTED = dbRow('c-luis', 'luis@penaplumbing.test', 'editor', 'accepted', LUIS, '2026-09-14T16:00:00Z');

/** Answer the people function and the roster table from `live`; everything else stays the jest default. */
function liveServer(): void {
  live.rosterReads = 0;
  live.rosterDelayMs = 0;
  live.marks = [];
  const realRpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: unknown) => unknown;
  jest.spyOn(supabase, 'rpc').mockImplementation(((fn: string, args?: { p_mark?: string }) => {
    if (fn !== 'project_people') return realRpc(fn, args);
    live.marks.push(String(args?.p_mark));
    const answer = Promise.resolve({ data: live.people, error: null }) as Promise<unknown> & { abortSignal: () => unknown };
    answer.abortSignal = () => answer;
    return answer;
  }) as never);
  const realFrom = supabase.from.bind(supabase) as unknown as (table: string) => unknown;
  jest.spyOn(supabase, 'from').mockImplementation(((table: string) => {
    if (table !== 'project_collaborators') return realFrom(table);
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'order', 'abortSignal', 'limit']) b[m] = () => b;
    b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
      live.rosterReads++;
      const delay = live.rosterDelayMs;
      // The rows are read when the answer LEAVES the server, not when it was asked.
      const answer = delay > 0
        ? new Promise<void>((res) => { setTimeout(res, delay); }).then(() => ({ data: live.roster, error: null }))
        : Promise.resolve({ data: live.roster, error: null });
      return answer.then(ok, bad);
    };
    return b;
  }) as never);
}

/** Let `n` seconds pass (the timers due in them fire in order), then let what they started land. */
async function seconds(n: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(n * 1000);
    await Promise.resolve();
  });
  await settle();
}

/**
 * Let about `n` minutes pass, ONE MINUTE AT A TIME. A single long advance
 * fires every timer due in it before any request is answered, so the beacon
 * finds its first request still in flight and skips the rest: ten minutes
 * would hold two people reads, not ten, and a loop would have nothing to loop
 * on. Minute by minute, each read is answered before the next one is due.
 */
async function minuteByMinute(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await seconds(60);
}

/** The Team section that is up on a phone: inside the one open modal. */
function openTeam(json: unknown): J {
  const up = openModals(json);
  expect(up).toHaveLength(1);
  return teamSection(up[0]);
}
const teamTitle = (section: J): string => texts(nodeIn(section, 'collaborators-section')).join('');

describe('END TO END, flag ON: the real people read, the real roster read, a server that changes', () => {
  beforeEach(() => {
    mockFlagOn = true;
    // Everything real: the hook, the roster read, the choice read, the beacon.
    mockPeopleRows = null;
    mockRoster = null;
    mockChoice = undefined;
    viewport(390, 844);
  });

  it('the server answers rows: the stack in the hero, and in the Team section each accepted row with its initials and lines', async () => {
    live.people = [ownerRow(), { ...DANA_PERSON, open_expires_s: 120, last_seen_at: '2026-10-04T15:59:30Z', seen_age_s: 30 }, LUIS_PERSON];
    live.roster = [DANA_ACCEPTED, LUIS_ACCEPTED, dbRow('c-sam', 'sam@samsdrywall.test', 'field', 'pending', null, null)];
    liveServer();
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    const hero = heroCard(tree.toJSON());
    expect(whosonIds(hero).filter((t) => t.startsWith('whoson-avatar-'))).toEqual([
      `whoson-avatar-${SMOKE_USER.id}`, `whoson-avatar-${DANA}`, `whoson-avatar-${LUIS}`,
    ]);
    expect(whosonIds(hero)).toContain(`whoson-dot-${DANA}`);
    const rosterReadsBefore = live.rosterReads;
    const peopleCallsBefore = live.marks.length;

    fireEvent.press(tree.getByTestId('whoson-stack'));
    await act(async () => { await Promise.resolve(); });
    const section = openTeam(tree.toJSON());
    expect(teamTitle(section)).toBe('Team (3 + 1 pending)');
    const ids = whosonIds(section);
    expect(ids).toContain('whoson-people');
    expect(ids.filter((t) => t.startsWith('whoson-avatar-'))).toEqual([`whoson-avatar-${DANA}`, `whoson-avatar-${LUIS}`]);
    expect(texts(nodeIn(section, `whoson-row-${DANA}`)).slice(0, 2)).toEqual(['Dana Ruiz · Ruiz Electric', 'Joined from your invite · Sep 12, 2026']);
    expect(texts(nodeIn(section, `whoson-row-${LUIS}`))[0]).toBe('Luis Peña');
    expect(texts(section).filter((t) => t === 'Joined')).toHaveLength(2);
    expect(texts(section).filter((t) => t === 'Invited')).toHaveLength(1);
    // Opening the Team section is ONE people read (the block and the roster share it),
    // and the two reads agree, so the roster is not read again.
    expect(live.marks.length - peopleCallsBefore).toBe(1);
    expect(live.rosterReads).toBe(rosterReadsBefore);
  });

  it('THE HEADLINE CASE: the sub accepts while the owner is on the page; the stack shows him; the Team section it opens says "Joined", not "Invited"', async () => {
    // The owner invited Dana and is looking at the project.
    live.people = [ownerRow()];
    live.roster = [DANA_PENDING];
    liveServer();
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    expect(says(heroCard(tree.toJSON()), 'No team members yet')).toBe(true);
    const rosterReadsAtOpen = live.rosterReads;

    // Dana accepts on her own phone.
    live.people = [ownerRow(), DANA_PERSON];
    live.roster = [DANA_ACCEPTED];
    // Within two minutes the owner's slow read brings her into the stack.
    await seconds(125);
    expect(whosonIds(heroCard(tree.toJSON()))).toContain(`whoson-avatar-${DANA}`);
    // Nothing has asked for the roster again: the app keeps it five minutes.
    expect(live.rosterReads).toBe(rosterReadsAtOpen);

    // He taps the stack.
    fireEvent.press(tree.getByTestId('whoson-stack'));
    await settle();
    const section = openTeam(tree.toJSON());
    // The people read (newer than the roster) names a team member the roster
    // shows as pending: the roster is read again, and the row agrees with the stack.
    expect(live.rosterReads).toBe(rosterReadsAtOpen + 1);
    expect(teamTitle(section)).toBe('Team (2)');
    expect(says(section, 'Invited')).toBe(false);
    expect(texts(section).filter((t) => t === 'Joined')).toHaveLength(1);
    const ids = whosonIds(section);
    expect(ids).toContain(`whoson-avatar-${DANA}`);
    expect(texts(nodeIn(section, `whoson-row-${DANA}`))).toEqual(['Dana Ruiz · Ruiz Electric', 'Joined from your invite · Sep 12, 2026']);

    // And that was the only one: ten more minutes with the section open, a
    // people read every minute, no further roster read.
    const peopleReads = live.marks.length;
    await minuteByMinute(10);
    expect(live.marks.length - peopleReads).toBeGreaterThanOrEqual(8);
    expect(live.rosterReads).toBe(rosterReadsAtOpen + 1);
    expect(says(openTeam(tree.toJSON()), 'Invited')).toBe(false);
  });

  it('a disagreement a fresh roster cannot settle (a team member this build cannot show) costs ONE roster read in ten minutes', async () => {
    const GHOST = 'aaaaaaaa-0000-4000-8000-0000000000ff';
    // The roster holds an accepted row whose role this build does not know;
    // the people read drops such a row, so it never names that person.
    live.people = [ownerRow(), DANA_PERSON, memberRow(GHOST, { role: 'inspector' })];
    live.roster = [DANA_ACCEPTED, dbRow('c-ghost', 'ghost@elsewhere.test', 'inspector', 'accepted', GHOST, '2026-09-13T16:00:00Z')];
    liveServer();
    await primeWorld('populated');
    const tree = await mountRouteChecked(TEAM_URL);
    const before = live.rosterReads;
    // The first people read newer than the roster disagrees with it: the roster is asked once.
    await minuteByMinute(3);
    expect(live.rosterReads - before).toBe(1);
    // The roster still lists both rows; only Dana has a person behind hers.
    const section = openTeam(tree.toJSON());
    expect(says(section, 'ghost@elsewhere.test')).toBe(true);
    expect(whosonIds(section).filter((t) => t.startsWith('whoson-avatar-'))).toEqual([`whoson-avatar-${DANA}`]);
    // The people read keeps coming every minute and keeps disagreeing. The roster is not asked again.
    const peopleReads = live.marks.length;
    await minuteByMinute(10);
    expect(live.marks.length - peopleReads).toBeGreaterThanOrEqual(8);
    expect(live.rosterReads - before).toBe(1);
  });

  /** The owner removes Dana from the Team section; the server confirms. Returns the roster reads it cost. */
  async function removeDana(rosterDelayMs: number): Promise<number> {
    live.people = [ownerRow(), DANA_PERSON, LUIS_PERSON];
    live.roster = [DANA_ACCEPTED, LUIS_ACCEPTED];
    liveServer();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(supabase.functions, 'invoke').mockImplementation((async (_fn: string, opts?: { body?: { action?: string; collaboratorId?: string } }) => {
      if (opts?.body?.action === 'revoke' && opts.body.collaboratorId === 'c-dana') {
        // The server removes her: the roster row is revoked and the people function stops naming her.
        live.roster = [LUIS_ACCEPTED];
        live.people = [ownerRow(), LUIS_PERSON];
        return { data: { success: true }, error: null };
      }
      return { data: null, error: null };
    }) as never);
    await primeWorld('populated');
    const tree = await mountRouteChecked(TEAM_URL);
    expect(whosonIds(openTeam(tree.toJSON()))).toContain(`whoson-avatar-${DANA}`);
    expect(whosonIds(heroCard(tree.toJSON()))).toContain(`whoson-avatar-${DANA}`);
    const before = live.rosterReads;
    live.rosterDelayMs = rosterDelayMs;

    fireEvent.press(tree.getByTestId('collab-revoke-c-dana'));
    const buttons = (alert.mock.calls[alert.mock.calls.length - 1]?.[2] ?? []) as { text?: string; onPress?: () => void }[];
    const remove = buttons.find((b) => b.text === 'Remove');
    expect(remove).toBeTruthy();
    await act(async () => { remove?.onPress?.(); await Promise.resolve(); });
    // Twice: a roster answer that arrives late in the first lands in the
    // cache there, and reaches the screen in the second.
    await settle();
    await settle();

    const section = openTeam(tree.toJSON());
    expect(says(section, 'dana@ruizelectric.test')).toBe(false);
    expect(says(section, 'luis@penaplumbing.test')).toBe(true);
    expect(whosonIds(section).filter((t) => t.includes(DANA))).toEqual([]);
    expect(whosonIds(heroCard(tree.toJSON())).filter((t) => t.includes(DANA))).toEqual([]);
    expect(teamTitle(section)).toBe('Team (2)');
    return live.rosterReads - before;
  }

  it('a removal the server confirms: the person leaves the roster and the stack, for one roster read', async () => {
    // The roster answers at once, ahead of the people read: that people read
    // (still naming her) is the OLDER picture and does not send the roster round again.
    expect(await removeDana(0)).toBe(1);
  });

  it('…and when the people read answers FIRST, the roster read already on its way is waited for, not started over', async () => {
    // The roster takes three seconds. The people read lands first and no
    // longer names her, while the roster on screen still does.
    expect(await removeDana(3000)).toBe(1);
  });
});

describe('flag ON: a failure in the people read never takes the roster down', () => {
  it('the people hook throws: the Team section still lists the roster, without initials or lines, and the page is not the error screen', async () => {
    mockFlagOn = true;
    mockPeopleThrows = true;
    mockRoster = ROSTER_OF_THREE;
    mockChoice = { choice: true, known: true };
    viewport(390, 844);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await primeWorld('populated');
    // mountRouteChecked fails if the app's error boundary caught anything.
    const tree = await mountRouteChecked(TEAM_URL);
    const json = tree.toJSON();
    expect(tree.getByTestId('hero-total-tap')).toBeTruthy();
    const section = teamSection(json);
    for (const email of ['dana@ruizelectric.test', 'luis@penaplumbing.test', 'priya@harlowarchitects.test', 'sam@samsdrywall.test']) {
      expect(says(section, email)).toBe(true);
    }
    expect(texts(section).filter((t) => t === 'Joined')).toHaveLength(3);
    expect(tree.getByTestId('collab-revoke-c-dana')).toBeTruthy();
    expect(tree.getByTestId('collab-email')).toBeTruthy();
    // Nothing of the feature anywhere: every block of it drew nothing.
    expect(whosonIds(json)).toEqual([]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('the roster is shown without its people'))).toBe(true);
  });
});

// ── PART 7: the desktop header at a narrow width ─────────────────────────────

describe('flag ON, desktop web: the people slot gives way before the project\'s name does', () => {
  beforeEach(() => {
    mockFlagOn = true;
    mockPeopleRows = OWNER_AND_THREE;
    mockRoster = ROSTER_OF_THREE;
    mockChoice = { choice: true, known: true };
    mockDeskWeb = true;
  });

  it('1030 wide (790 beside the sidebar): no stack in the header; the name, the toolbar and the Team tile are all still there', async () => {
    viewport(1030, 800);
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    const header = nodeIn(tree.toJSON(), 'project-workspace-header');
    expect(whosonIds(header)).toEqual([]);
    expect(says(header, world.project.name)).toBe(true);
    expect(tree.getByTestId('project-toolbar')).toBeTruthy();
    // The title block is what it is with the feature off: breadcrumb, name block.
    const titleBlock = parentIn(header, 'project-breadcrumb-projects');
    expect((titleBlock.children ?? []) as J[]).toHaveLength(2);
  });

  it('1041 wide (801 beside the sidebar): the stack is back', async () => {
    viewport(1041, 800);
    await primeWorld('populated');
    const tree = await mountRouteChecked(URL);
    const header = nodeIn(tree.toJSON(), 'project-workspace-header');
    expect(whosonIds(header)).toContain('whoson-stack');
    expect(says(header, world.project.name)).toBe(true);
  });
});
