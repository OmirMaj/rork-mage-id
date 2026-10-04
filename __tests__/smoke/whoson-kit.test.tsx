/**
 * Smoke — "who is on this project", the kit (lane WHOKIT): components/whoson,
 * hooks/useProjectPeople, hooks/useSharePresence, utils/whoson/peopleClient.
 *
 * Fixtures only, no network: the people RPC is a spy on the supabase mock and
 * the online-only door (utils/offlineQueue supabaseRpcOnline) is a jest.fn.
 * The pure rules (model, slots, ticks, leaves) are run under bun by
 * scripts/validate-whoson.ts; this file proves what the SCREEN does with them.
 *
 * THE FLAG. The feature ships dark: constants/featureFlags.ts WHOS_ON_ENABLED
 * is false. It is mocked ON for the feature's own tests and left OFF for the
 * last block, which proves that with it off every component renders null and
 * nothing is ever sent, even with a populated server behind it.
 *
 * GOLDENS (new files, recorded once, then run with --ci), phone 390 wide:
 *   a  owner + three team members, one has it open (hero stack), light
 *   b  the same, dark
 *   c  seven team members, a hidden one has it open (chip with the dot)
 *   d  a Field viewer's two-row payload (hero stack + the question card)
 *   e  the Team block, owner viewing
 *   f  the Team block, team member viewing
 *   g  roster row extras: has it open / last seen / nothing
 *
 * BEHAVIOUR:
 *   1  owner alone: "No team members yet" + "Invite"
 *   2  owner alone on a portal-enabled project: no "Invite" word
 *   3  owner + one open: "1 has it open", a dot on that avatar, none on his own
 *   4  seven team members, a hidden open one: 4 avatars + "+4" carrying the dot
 *   5  a 40-row roster: 4 avatars + "+36"
 *   6  a Field viewer: two avatars, no chip, no count, no "@" anywhere, even
 *      when the payload carried more than it should
 *   7  an expired read draws no dot and no "has it open" text
 *   8  unknown (zero rows, an error, not settled) renders null: the stack,
 *      the block, the row extras, the Settings row
 *   9  the question card shows for a null choice on a shared project, not on
 *      a solo one, and never for someone who answered
 *  10  a switch write that does not land goes back and says so; one that
 *      lands stays
 *  11  "Needs a connection." only when Platform.OS is web
 *  12  the desktop header variant: text at 1280 and up only, 3 slots below
 *  13  the client: single flight, a mark only for an account that said yes,
 *      a result dropped when the account changed, one pause after a refusal
 *  14  the beacon: reads on arrival, marks once the answer says yes, leaves
 *      when the route leaves the project
 *  15  FLAG OFF: null everywhere, no request, no listener
 *
 * REVIEW ROUND 1 (each of these failed on the code as first reviewed):
 *   - an answer with rows nobody can use (the viewer's own row dropped, two
 *     owners) is read ONCE, not every five seconds (was 121 reads in 10 min);
 *   - plain reads never push the next mark out (a read every 50 s used to
 *     stop marks entirely, and the dot lapsed for someone using the project);
 *   - a read in flight when the choice is saved does not bring the question
 *     back;
 *   - a pause set by a refused leave still ends with a look;
 *   - the hook's `people` is the model's list, never the raw payload.
 */

import React from 'react';
import { AppState, Platform } from 'react-native';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { supabaseRpcOnline, currentSessionUserId } from '@/utils/offlineQueue';
import {
  PersonAvatar, PersonRowExtras, PresenceDot, ProjectPeopleBlock, ProjectPeopleStack, ProjectPresenceBeacon, SharePresenceSettingRow,
} from '@/components/whoson';
import { useProjectPeople } from '@/hooks/useProjectPeople';
import { __resetPeopleClientForTest, callPeople, heartbeatState, knownChoice, rememberChoice } from '@/utils/whoson/peopleClient';
import { mapPeopleRow, WHOSON } from '@/utils/whoson/people';
import type { ProjectPerson } from '@/types';

let mockFlagOn = true;
jest.mock('@/constants/featureFlags', () => {
  // defineProperty, not `{ ...actual, get X() {} }`: the object-spread helper
  // would read the getter once, at factory time, and freeze its value.
  const mod = { ...jest.requireActual('@/constants/featureFlags') };
  Object.defineProperty(mod, 'WHOS_ON_ENABLED', { enumerable: true, get: () => mockFlagOn });
  return mod;
});

let mockUserId: string | null = 'owner-0000';
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUserId ? { id: mockUserId, email: 'x', name: 'x' } : null, isAuthenticated: !!mockUserId, isLoading: false }),
}));

jest.mock('@/utils/offlineQueue', () => {
  const actual = jest.requireActual('@/utils/offlineQueue');
  return { ...actual, supabaseRpcOnline: jest.fn(), currentSessionUserId: jest.fn() };
});

let mockDark = false;
jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const light = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const dark = { ...actual.Theme.dark, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'dark') };
  const lightValue = { colors: light, resolved: 'light', pref: 'light', setPref: () => {} };
  const darkValue = { colors: dark, resolved: 'dark', pref: 'dark', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => (mockDark ? darkValue : lightValue),
  };
});

jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, useReducedMotion: () => true, reducedMotion: () => true };
});

let mockLayout = { width: 390, sidebarWidth: 0, isDesktop: false };
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({
    screenSize: mockLayout.isDesktop ? 'desktop' : 'phone', isPhone: !mockLayout.isDesktop, isTablet: false, isDesktop: mockLayout.isDesktop,
    width: mockLayout.width, height: 844, contentMaxWidth: mockLayout.width, sidebarWidth: mockLayout.sidebarWidth,
    showSidebar: mockLayout.isDesktop, ganttRowHeight: 32,
  }),
}));

let mockPathname = '/';
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, usePathname: () => mockPathname, useGlobalSearchParams: () => mockParams };
});

const mockDoor = supabaseRpcOnline as jest.MockedFunction<typeof supabaseRpcOnline>;
const mockSessionUser = currentSessionUserId as jest.MockedFunction<typeof currentSessionUserId>;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT = '11111111-2222-4333-8444-555555555555';
const OWNER = 'owner-0000';
const FIELD = 'member-0002';
type Row = Record<string, unknown>;

function ownerRow(over: Row = {}): Row {
  return {
    user_id: OWNER, kind: 'owner', role: 'owner', display_name: 'Omar Majeed', company_name: 'Majeed Builders',
    is_self: true, invited_by_viewer: false, invited_email: null, joined_at: null,
    open_expires_s: null, last_seen_at: null, seen_age_s: null, shares_presence: true, ...over,
  };
}
function memberRow(n: number, over: Row = {}): Row {
  return {
    user_id: `member-${String(n).padStart(4, '0')}`, kind: 'member', role: 'field',
    display_name: 'Dana Ruiz', company_name: `Ruiz Electric ${n}`,
    is_self: false, invited_by_viewer: true, invited_email: `sub${n}@example.com`,
    // Midday UTC: the same calendar day in every American time zone and in CI.
    joined_at: `2026-09-${String(n > 28 ? 28 : n).padStart(2, '0')}T16:00:${String(n).padStart(2, '0')}Z`,
    open_expires_s: null, last_seen_at: null, seen_age_s: null, shares_presence: null, ...over,
  };
}
function ownerPayload(members: number, over: (n: number) => Row = () => ({}), self: Row = {}): Row[] {
  const rows = [ownerRow(self)];
  for (let n = 1; n <= members; n++) rows.push(memberRow(n, over(n)));
  return rows;
}
/** What a Field team member receives: the owner and himself. */
function fieldPayload(over: { owner?: Row; self?: Row } = {}): Row[] {
  return [
    ownerRow({ is_self: false, shares_presence: null, ...over.owner }),
    memberRow(2, { is_self: true, invited_by_viewer: false, invited_email: null, shares_presence: null, ...over.self }),
  ];
}

// ── The server, stubbed ──────────────────────────────────────────────────────

type RpcAnswer = { data: unknown; error: null | { message: string; code?: string } };
let serverRows: Row[] = [];
let serverAnswer: (() => Promise<RpcAnswer>) | null = null;
let profileRow: Row | null = null;
let rpcSpy: jest.SpyInstance;
let fromSpy: jest.SpyInstance;

function installServer() {
  // `as never`: tsc sees the real supabase-js types here; jest maps the module
  // to __tests__/mocks/supabase.ts, where rpc / from are plain functions.
  rpcSpy = jest.spyOn(supabase, 'rpc').mockImplementation((() => ({
    abortSignal: () => (serverAnswer ? serverAnswer() : Promise.resolve({ data: serverRows, error: null })),
  })) as never);
  const realFrom = supabase.from as unknown as (table?: string) => unknown;
  fromSpy = jest.spyOn(supabase, 'from').mockImplementation(((table?: string) => {
    if (table !== 'profiles') return realFrom(table);
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.abortSignal = () => b;
    b.maybeSingle = async () => ({ data: profileRow, error: null });
    return b;
  }) as never);
  mockSessionUser.mockImplementation(async () => mockUserId);
  mockDoor.mockImplementation(async (_fn: string, args: Record<string, unknown>) => {
    if (_fn === 'set_share_presence') return { status: 'synced', data: args.p_on } as never;
    return { status: 'synced', data: serverRows } as never;
  });
}

const peopleCalls = () => rpcSpy.mock.calls.filter(c => c[0] === 'project_people');
const doorCalls = (fn: string) => mockDoor.mock.calls.filter(c => c[0] === fn);

// No host wrapper: the root of the tree is whatever the component renders, so
// "renders null" can be asserted as toJSON() === null.
let client: QueryClient;
function Wrap({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: Wrap });
// react-query hands a result to its observers on a 0 ms timer, so a settle
// made only of setImmediate turns can finish before the screen has re-rendered.
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise<void>(r => setTimeout(r, 4)); });
};
async function mount(ui: React.ReactElement) {
  const r = render(ui);
  await settle();
  return r;
}

const heroStack = (inviteNudge = true, onOpen: () => void = () => {}) => (
  <ProjectPeopleStack projectId={PROJECT} variant="hero" inviteNudge={inviteNudge} onOpen={onOpen} />
);
const headerStack = () => <ProjectPeopleStack projectId={PROJECT} variant="header" inviteNudge onOpen={() => {}} />;

function textOf(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach(n => textOf(n, out)); return out; }
  textOf((node as { children?: unknown }).children, out);
  return out;
}
const shownText = () => textOf(screen.toJSON());
// Avatars and dots are decorative (hidden from a screen reader), so the
// queries must be told to look at hidden elements.
const HIDDEN = { includeHiddenElements: true } as const;
const avatarIds = () => screen.queryAllByTestId(/^whoson-avatar-/, HIDDEN).map(n => String(n.props.testID).replace('whoson-avatar-', ''));
const dotIds = () => screen.queryAllByTestId(/^whoson-dot-/, HIDDEN).map(n => String(n.props.testID).replace('whoson-dot-', ''));

/** What a screen that calls the hook is handed as `people`. */
let probed: ProjectPerson[] = [];
function PeopleProbe() {
  probed = useProjectPeople(PROJECT).people;
  return null;
}

let restoreOS: (() => void) | null = null;
function setOS(os: 'ios' | 'web') {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
}

beforeEach(() => {
  mockFlagOn = true;
  mockUserId = OWNER;
  mockDark = false;
  mockLayout = { width: 390, sidebarWidth: 0, isDesktop: false };
  mockPathname = '/';
  mockParams = {};
  probed = [];
  serverRows = [];
  serverAnswer = null;
  profileRow = null;
  __resetPeopleClientForTest();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  installServer();
});

afterEach(() => {
  restoreOS?.();
  restoreOS = null;
  onlineManager.setOnline(true);
  jest.useRealTimers();
  jest.restoreAllMocks();
  client.clear();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the stack on the phone', () => {
  it('1  owner alone: "No team members yet" and the word Invite', async () => {
    serverRows = ownerPayload(0);
    const onOpen = jest.fn();
    await mount(heroStack(true, onOpen));
    const stack = screen.getByTestId('whoson-stack');
    expect(avatarIds()).toEqual([OWNER]);
    expect(shownText()).toEqual(['OM', 'No team members yet', 'Invite']);
    expect(stack.props.accessibilityRole).toBe('button');
    expect(stack.props.accessibilityLabel).toBe('No team members yet. Open the Team section. Invite.');
    expect(dotIds()).toEqual([]);
    expect(screen.queryByTestId('whoson-choice')).toBeNull();
    fireEvent.press(stack);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(peopleCalls()).toHaveLength(1);
    expect(peopleCalls()[0][1]).toEqual({ p_project_id: PROJECT, p_mark: 'none' });
  });

  it('2  owner alone on a project whose client portal is on: no Invite word', async () => {
    serverRows = ownerPayload(0);
    await mount(heroStack(false));
    expect(shownText()).toEqual(['OM', 'No team members yet']);
    expect(screen.getByTestId('whoson-stack').props.accessibilityLabel).toBe('No team members yet. Open the Team section.');
  });

  it('3  owner plus one who has it open: the text, a dot on that avatar, none on his own', async () => {
    serverRows = ownerPayload(3, n => (n === 2 ? { open_expires_s: 120 } : {}));
    await mount(heroStack());
    // Owner first, then the open one, then by joined date.
    expect(avatarIds()).toEqual([OWNER, 'member-0002', 'member-0001', 'member-0003']);
    expect(dotIds()).toEqual(['member-0002']);
    expect(shownText()).toContain('1 has it open');
    expect(screen.getByTestId('whoson-stack').props.accessibilityLabel).toBe('Team on this project: 4. 1 has it open now.');
    expect(screen.queryByTestId('whoson-overflow', HIDDEN)).toBeNull();
    expect(screen.toJSON()).toMatchSnapshot('a owner + three, one open, light');
  });

  it('golden b: the same stack in the dark theme', async () => {
    mockDark = true;
    serverRows = ownerPayload(3, n => (n === 2 ? { open_expires_s: 120 } : {}));
    await mount(heroStack());
    expect(screen.toJSON()).toMatchSnapshot('b owner + three, one open, dark');
  });

  it('3b nobody open: avatars, and no text at all', async () => {
    serverRows = ownerPayload(2);
    await mount(heroStack());
    expect(shownText()).toEqual(['OM', 'DR', 'DR']);
    expect(screen.getByTestId('whoson-stack').props.accessibilityLabel).toBe('Team on this project: 3.');
  });

  it('4  seven team members, a hidden one has it open: four avatars and a +4 carrying the dot', async () => {
    serverRows = ownerPayload(7, n => (n >= 2 && n <= 6 ? { open_expires_s: 120 } : {}));
    await mount(heroStack());
    expect(avatarIds()).toEqual([OWNER, 'member-0002', 'member-0003', 'member-0004']);
    expect(shownText()).toContain('+4');
    expect(shownText()).toContain('5 have it open');
    expect(dotIds()).toEqual(['member-0002', 'member-0003', 'member-0004', 'overflow']);
    expect(screen.toJSON()).toMatchSnapshot('c seven team members, a hidden one open');
  });

  it('4b seven team members, the open one is in front: the chip carries no dot', async () => {
    serverRows = ownerPayload(7, n => (n === 7 ? { open_expires_s: 120 } : {}));
    await mount(heroStack());
    expect(avatarIds()).toEqual([OWNER, 'member-0007', 'member-0001', 'member-0002']);
    expect(dotIds()).toEqual(['member-0007']);
  });

  it('5  a 40-row roster: four avatars and +36', async () => {
    serverRows = ownerPayload(39);
    await mount(heroStack());
    expect(avatarIds()).toHaveLength(4);
    expect(shownText()).toContain('+36');
    expect(screen.getByTestId('whoson-stack').props.accessibilityLabel).toBe('Team on this project: 40.');
  });

  it('6  a Field viewer: the owner and himself, no chip, no count, no @ anywhere', async () => {
    mockUserId = FIELD;
    serverRows = fieldPayload({ owner: { open_expires_s: 90 } });
    await mount(heroStack());
    expect(avatarIds()).toEqual([OWNER, FIELD]);
    expect(dotIds()).toEqual([OWNER]);
    expect(screen.queryByTestId('whoson-overflow', HIDDEN)).toBeNull();
    const stack = screen.getByTestId('whoson-stack');
    expect(stack.props.accessibilityLabel).toBe('Team on this project. The project owner has it open.');
    expect(shownText()).toContain('The project owner has it open');
    expect(shownText().some(s => /\d+ (has|have) it open/.test(s))).toBe(false);
    expect(JSON.stringify(screen.toJSON())).not.toContain('@');
    // He has not answered the question: it sits under the row.
    expect(screen.getByTestId('whoson-choice')).toBeTruthy();
    expect(screen.toJSON()).toMatchSnapshot('d a Field viewer, the owner has it open, the question');
  });

  it('6b a Field viewer whose payload carried more than it should still sees two people and no email', async () => {
    mockUserId = FIELD;
    serverRows = [
      ownerRow({ is_self: false, shares_presence: null, invited_email: 'owner@example.com', last_seen_at: '2026-10-04T14:00:00Z', seen_age_s: 600 }),
      memberRow(1, { open_expires_s: 120 }),
      memberRow(2, { is_self: true, shares_presence: true }),
      memberRow(3), memberRow(4), memberRow(5), memberRow(6),
    ];
    await mount(<>{heroStack()}<ProjectPeopleBlock projectId={PROJECT} /><PeopleProbe /></>);
    expect(avatarIds()).toEqual([OWNER, FIELD]);
    expect(dotIds()).toEqual([]);
    expect(screen.queryByTestId('whoson-overflow', HIDDEN)).toBeNull();
    const all = JSON.stringify(screen.toJSON());
    expect(all).not.toContain('@');
    expect(all).not.toContain('Last seen');
    expect(all).not.toContain('Ruiz Electric 1');
    // The hook's own `people` is the model's list, not the seven raw rows: a
    // caller that looks a row up in it cannot show what the model would not.
    expect(probed.map(p => p.userId)).toEqual([OWNER, FIELD]);
    expect(probed.every(p => p.invitedEmail === null && p.lastSeenAt === null && p.seenAgeS === null && p.invitedByViewer === false)).toBe(true);
    expect(JSON.stringify(probed)).not.toContain('@');
  });

  it('6c the hook hands the owner everyone, emails included', async () => {
    serverRows = ownerPayload(3, n => (n === 3 ? { open_expires_s: 120 } : {}));
    await mount(<PeopleProbe />);
    // The owner, then the open one, then by joined date: the model's order.
    expect(probed.map(p => p.userId)).toEqual([OWNER, 'member-0003', 'member-0001', 'member-0002']);
    expect(probed.filter(p => p.kind === 'member').map(p => p.invitedEmail)).toEqual(['sub3@example.com', 'sub1@example.com', 'sub2@example.com']);
  });

  it('6d the hook hands out nobody from a read it cannot use', async () => {
    serverRows = [ownerRow({ is_self: false }), memberRow(1), memberRow(2)];
    await mount(<PeopleProbe />);
    expect(probed).toEqual([]);
    expect(peopleCalls()).toHaveLength(1);
  });

  it('7  an expired read draws no dot and no "has it open" text', async () => {
    serverRows = ownerPayload(3, n => (n === 2 ? { open_expires_s: 40 } : {}));
    const r = await mount(heroStack());
    expect(dotIds()).toEqual(['member-0002']);
    const sent = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(sent + 41_000);
    r.rerender(heroStack());
    expect(dotIds()).toEqual([]);
    expect(shownText().some(s => /it open/.test(s))).toBe(false);
    // The avatars stay, back in joined order.
    expect(avatarIds()).toEqual([OWNER, 'member-0001', 'member-0002', 'member-0003']);
    now.mockRestore();
  });
});

describe('8  unknown renders null', () => {
  const everything = () => (
    <>
      {heroStack()}
      {headerStack()}
      <ProjectPeopleBlock projectId={PROJECT} />
      <PersonRowExtras person={undefined} fetchedAtMs={null} />
      <PersonAvatar person={undefined} />
      <SharePresenceSettingRow />
    </>
  );

  it('zero rows (no access, or not on the server yet)', async () => {
    serverRows = [];
    await mount(everything());
    expect(screen.toJSON()).toBeNull();
    expect(peopleCalls().length).toBeGreaterThan(0);
  });

  it('a server error', async () => {
    serverAnswer = async () => ({ data: null, error: { message: 'function public.project_people does not exist', code: 'PGRST202' } });
    await mount(everything());
    expect(screen.toJSON()).toBeNull();
    // One refusal pauses every later call for ten minutes.
    expect(heartbeatState().pausedUntilMs).toBeGreaterThan(Date.now() + WHOSON.SERVER_PAUSE_MS - 5_000);
    const before = peopleCalls().length;
    expect((await callPeople(OWNER, PROJECT, 'none')).outcome).toBe('dropped');
    expect(peopleCalls()).toHaveLength(before);
  });

  it('a read that has not settled', async () => {
    serverAnswer = () => new Promise<RpcAnswer>(() => {});
    await mount(everything());
    expect(screen.toJSON()).toBeNull();
  });

  it('a payload with no row for the viewer', async () => {
    serverRows = [ownerRow({ is_self: false }), memberRow(1)];
    await mount(everything());
    expect(screen.toJSON()).toBeNull();
  });

  it.each([
    ['a role this build does not know', 'manager'],
    ['the owner role on a team member\'s row', 'owner'],
  ])('the viewer\'s own row carries %s: null, and the answer is kept as "nothing usable"', async (_name, role) => {
    mockUserId = FIELD;
    serverRows = fieldPayload({ self: { role } });
    await mount(everything());
    expect(screen.toJSON()).toBeNull();
    expect(client.getQueryData(['project_people', FIELD, PROJECT])).toEqual({ people: [], fetchedAtMs: expect.any(Number) });
    // The three hook instances shared one request, and nothing asked again.
    expect(peopleCalls()).toHaveLength(1);
    expect(heartbeatState().stoppedProjectId).toBe(PROJECT);
  });

  it('nobody signed in: nothing is asked', async () => {
    mockUserId = null;
    serverRows = ownerPayload(3);
    await mount(everything());
    expect(screen.toJSON()).toBeNull();
    expect(peopleCalls()).toHaveLength(0);
    expect(fromSpy.mock.calls.filter(c => c[0] === 'profiles')).toHaveLength(0);
  });

  it.each([
    ['the hero stack', () => heroStack()],
    ['the header stack', () => headerStack()],
    ['the Team block', () => <ProjectPeopleBlock projectId={PROJECT} />],
    ['the row extras', () => <PersonRowExtras person={null} fetchedAtMs={null} />],
    ['the Settings row', () => <SharePresenceSettingRow />],
  ])('%s alone is exactly null', async (_name, ui) => {
    serverRows = [];
    const r = await mount(ui());
    expect(r.toJSON()).toBeNull();
  });
});

describe('9  the question', () => {
  it('shows for a null choice on a shared project, under the stack and at the top of the Team block', async () => {
    serverRows = ownerPayload(2, () => ({}), { shares_presence: null });
    await mount(<>{heroStack()}<ProjectPeopleBlock projectId={PROJECT} /></>);
    expect(screen.getAllByTestId('whoson-choice')).toHaveLength(2);
    expect(shownText()).toContain('Show when you have a project open?');
    expect(shownText()).toContain('Show it');
    expect(shownText()).toContain('Don\'t show it');
  });

  it('does not show on a solo project', async () => {
    serverRows = ownerPayload(0, () => ({}), { shares_presence: null });
    await mount(<>{heroStack()}<ProjectPeopleBlock projectId={PROJECT} /></>);
    expect(screen.queryByTestId('whoson-choice')).toBeNull();
    // Nobody joined: one sentence, no switch, no footnotes.
    expect(screen.getByTestId('whoson-people-empty')).toBeTruthy();
    expect(screen.queryByTestId('whoson-share-row')).toBeNull();
  });

  it('does not show for someone who answered, yes or no', async () => {
    serverRows = ownerPayload(2, () => ({}), { shares_presence: false });
    await mount(<>{heroStack()}<ProjectPeopleBlock projectId={PROJECT} /></>);
    expect(screen.queryByTestId('whoson-choice')).toBeNull();
  });

  it('either button saves the choice through the online-only door; the card goes when the answer comes back', async () => {
    serverRows = ownerPayload(2, () => ({}), { shares_presence: null });
    await mount(heroStack());
    serverRows = ownerPayload(2, () => ({}), { shares_presence: false });
    await act(async () => { fireEvent.press(screen.getByTestId('whoson-choice-no')); });
    await settle();
    expect(doorCalls('set_share_presence').map(c => c[1])).toEqual([{ p_on: false }]);
    expect(screen.queryByTestId('whoson-choice')).toBeNull();
  });

  it('a read that was in flight when the choice was saved does not bring the question back', async () => {
    serverRows = ownerPayload(2, () => ({}), { shares_presence: null });
    await mount(heroStack());
    expect(screen.getByTestId('whoson-choice')).toBeTruthy();
    // A slow read goes out. It will answer with the picture from BEFORE the save.
    let release!: () => void;
    let asked = 0;
    serverAnswer = () => {
      asked++;
      if (asked === 1) return new Promise<RpcAnswer>(res => { release = () => res({ data: ownerPayload(2, () => ({}), { shares_presence: null }), error: null }); });
      return Promise.resolve({ data: ownerPayload(2, () => ({}), { shares_presence: true }), error: null });
    };
    const slow = callPeople(OWNER, PROJECT, 'none');
    await settle();
    expect(asked).toBe(1);
    await act(async () => { fireEvent.press(screen.getByTestId('whoson-choice-yes')); });
    await settle();
    expect(doorCalls('set_share_presence').map(c => c[1])).toEqual([{ p_on: true }]);
    // The read after the save did not join the one sent before it.
    expect(asked).toBe(1);
    await act(async () => { release(); });
    await settle();
    // The old read's answer carries the SAVED choice, not its own stale one...
    const old = await slow;
    expect(old.outcome === 'ok' && old.people.find(p => p.isSelf)?.sharesPresence).toBe(true);
    expect(knownChoice(OWNER)).toBe(true);
    // ...a fresh read followed it, and the question is gone for good.
    expect(asked).toBe(2);
    expect(screen.queryByTestId('whoson-choice')).toBeNull();
  });

  it('a read sent AFTER the save is believed: the server is the newer truth', async () => {
    serverRows = ownerPayload(2, () => ({}), { shares_presence: null });
    await mount(heroStack());
    // The save lands, and every read sent from now on says "no" (it was switched off on another device).
    serverRows = ownerPayload(2, () => ({}), { shares_presence: false });
    await act(async () => { fireEvent.press(screen.getByTestId('whoson-choice-yes')); });
    await settle();
    expect(doorCalls('set_share_presence').map(c => c[1])).toEqual([{ p_on: true }]);
    expect(knownChoice(OWNER)).toBe(false);
    expect(screen.queryByTestId('whoson-choice')).toBeNull();
  });

  it('a save that does not land leaves the question up and says so', async () => {
    serverRows = ownerPayload(2, () => ({}), { shares_presence: null });
    await mount(heroStack());
    mockDoor.mockImplementation(async () => ({ status: 'unknown', error: 'Network request failed' }) as never);
    await act(async () => { fireEvent.press(screen.getByTestId('whoson-choice-yes')); });
    await settle();
    expect(screen.getByTestId('whoson-choice')).toBeTruthy();
    expect(screen.getByTestId('whoson-choice-note').props.children).toBe('Couldn\'t save that. Try again.');
  });
});

describe('the Team block', () => {
  it('golden e: the owner sees the switch and three footnotes', async () => {
    serverRows = ownerPayload(2);
    await mount(<ProjectPeopleBlock projectId={PROJECT} />);
    expect(screen.getByTestId('whoson-people')).toBeTruthy();
    expect(screen.getByTestId('whoson-share-switch').props.value).toBe(true);
    const text = shownText();
    expect(text).toContain('Show when I have a project open');
    expect(text.filter(s => /^"Has it open" means|^Work done without|^Clients and subs/.test(s))).toHaveLength(3);
    expect(screen.toJSON()).toMatchSnapshot('e the Team block, owner viewing');
  });

  it('golden f: a team member sees the owner line with the dot, the switch, and the first footnote only', async () => {
    mockUserId = FIELD;
    serverRows = fieldPayload({ owner: { open_expires_s: 90 }, self: { shares_presence: false } });
    await mount(<ProjectPeopleBlock projectId={PROJECT} />);
    const text = shownText();
    expect(text).toContain('Project owner: Omar Majeed, Majeed Builders');
    expect(text).toContain('Has it open now');
    expect(screen.getByTestId('whoson-people-owner-dot', HIDDEN)).toBeTruthy();
    expect(screen.getByTestId('whoson-share-switch').props.value).toBe(false);
    expect(text.filter(s => /^"Has it open" means/.test(s))).toHaveLength(1);
    expect(text.some(s => /^Work done without|^Clients and subs/.test(s))).toBe(false);
    expect(JSON.stringify(screen.toJSON())).not.toContain('@');
    expect(screen.toJSON()).toMatchSnapshot('f the Team block, team member viewing');
  });

  it('a team member whose owner typed no name and is not on it: no owner line at all', async () => {
    mockUserId = FIELD;
    serverRows = fieldPayload({ owner: { display_name: null, company_name: null }, self: { shares_presence: true } });
    await mount(<ProjectPeopleBlock projectId={PROJECT} />);
    expect(screen.queryByTestId('whoson-people-owner')).toBeNull();
    expect(shownText().some(s => /Project owner/.test(s))).toBe(false);
  });

  it('a team member whose owner typed no name and HAS it open: the dot row names its subject', async () => {
    mockUserId = FIELD;
    serverRows = fieldPayload({ owner: { display_name: null, company_name: null, open_expires_s: 90 }, self: { shares_presence: true } });
    await mount(<ProjectPeopleBlock projectId={PROJECT} />);
    expect(screen.getByTestId('whoson-people-owner-dot', HIDDEN)).toBeTruthy();
    const text = shownText();
    expect(text).toContain('The project owner has it open');
    // Never a bare "Has it open now" directly over the member's own switch.
    expect(text).not.toContain('Has it open now');
    expect(text.indexOf('The project owner has it open')).toBeLessThan(text.indexOf('Show when I have a project open'));
  });
});

describe('roster row extras', () => {
  const person = (over: Row) => mapPeopleRow(memberRow(1, over))!;

  it('golden g: has it open / last seen / nothing', async () => {
    const now = Date.now();
    render(
      <>
        <PersonRowExtras person={person({ user_id: 'open', open_expires_s: 100 })} fetchedAtMs={now} />
        <PersonRowExtras person={person({ user_id: 'seen', last_seen_at: '2026-10-04T14:00:00Z', seen_age_s: 720, invited_by_viewer: false })} fetchedAtMs={now} />
        <PersonRowExtras person={person({ user_id: 'quiet', display_name: null, company_name: null })} fetchedAtMs={now} />
      </>,
    );
    const text = shownText();
    expect(text).toEqual([
      'Dana Ruiz · Ruiz Electric 1', 'Joined from your invite · Sep 1, 2026', 'Has it open now',
      'Dana Ruiz · Ruiz Electric 1', 'Joined Sep 1, 2026', 'Last seen online here 12 min ago',
      'Joined from your invite · Sep 1, 2026',
    ]);
    expect(screen.getByTestId('whoson-row-dot-open', HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId('whoson-row-dot-seen', HIDDEN)).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain('@');
    expect(screen.toJSON()).toMatchSnapshot('g roster row extras');
  });

  it('a read older than the window: an absolute date and time, never a relative phrase', () => {
    const now = Date.now();
    render(<PersonRowExtras person={person({ last_seen_at: '2026-10-01T16:00:00Z', seen_age_s: 720 })} fetchedAtMs={now - 151_000} />);
    const line = shownText().find(s => s.startsWith('Last seen online here'))!;
    expect(line).toMatch(/^Last seen online here Oct 1, 2026, \d{1,2}:\d{2}\s?[AP]M$/);
    expect(line).not.toMatch(/ago/);
  });

  it('an hour and a day: hr, then the date', () => {
    const now = Date.now();
    render(
      <>
        <PersonRowExtras person={person({ user_id: 'hr', last_seen_at: '2026-10-04T12:00:00Z', seen_age_s: 3 * 3600 + 5 })} fetchedAtMs={now} />
        <PersonRowExtras person={person({ user_id: 'day', last_seen_at: '2026-10-01T16:00:00Z', seen_age_s: 3 * 86_400 })} fetchedAtMs={now} />
      </>,
    );
    expect(shownText()).toContain('Last seen online here 3 hr ago');
    expect(shownText()).toContain('Last seen online here Oct 1, 2026');
  });

  it('an avatar with nothing typed and no email shows no letters', () => {
    render(<PersonAvatar person={{ userId: 'x', displayName: null, companyName: null, invitedEmail: null }} />);
    expect(shownText()).toEqual([]);
    expect(screen.getByTestId('whoson-avatar-x', HIDDEN)).toBeTruthy();
  });
});

describe('10 / 11  the switch', () => {
  const memberBlock = async (choice: boolean | null) => {
    mockUserId = FIELD;
    serverRows = fieldPayload({ self: { shares_presence: choice } });
    await mount(<ProjectPeopleBlock projectId={PROJECT} />);
  };

  it('a write that does not land: the switch goes back and says so', async () => {
    await memberBlock(false);
    mockDoor.mockImplementation(async () => ({ status: 'unknown', error: 'Network request failed' }) as never);
    await act(async () => { fireEvent(screen.getByTestId('whoson-share-switch'), 'valueChange', true); });
    await settle();
    expect(doorCalls('set_share_presence').map(c => c[1])).toEqual([{ p_on: true }]);
    expect(screen.getByTestId('whoson-share-switch').props.value).toBe(false);
    expect(screen.getByTestId('whoson-share-note').props.children).toBe('Couldn\'t save that. Try again.');
  });

  it('a refused write: the same', async () => {
    await memberBlock(true);
    mockDoor.mockImplementation(async () => ({ status: 'refused', code: 'server', error: 'permission denied' }) as never);
    await act(async () => { fireEvent(screen.getByTestId('whoson-share-switch'), 'valueChange', false); });
    await settle();
    expect(screen.getByTestId('whoson-share-switch').props.value).toBe(true);
    expect(screen.getByTestId('whoson-share-note').props.children).toBe('Couldn\'t save that. Try again.');
  });

  it('a write that lands: the switch stays, no note, and the people are read again', async () => {
    await memberBlock(false);
    const before = peopleCalls().length;
    serverRows = fieldPayload({ self: { shares_presence: true } });
    await act(async () => { fireEvent(screen.getByTestId('whoson-share-switch'), 'valueChange', true); });
    await settle();
    expect(screen.getByTestId('whoson-share-switch').props.value).toBe(true);
    expect(screen.queryByTestId('whoson-share-note')).toBeNull();
    expect(peopleCalls().length + doorCalls('project_people').length).toBeGreaterThan(before);
  });

  it('offline on an iPhone: no reason line, the switch stays enabled', async () => {
    await memberBlock(false);
    await act(async () => { onlineManager.setOnline(false); });
    expect(screen.queryByTestId('whoson-share-note')).toBeNull();
    expect(screen.getByTestId('whoson-share-switch').props.disabled).toBe(false);
    expect(shownText()).not.toContain('Needs a connection.');
  });

  it('offline on web: "Needs a connection." and the switch is disabled', async () => {
    await memberBlock(false);
    setOS('web');
    await act(async () => { onlineManager.setOnline(false); });
    expect(screen.getByTestId('whoson-share-note').props.children).toBe('Needs a connection.');
    expect(screen.getByTestId('whoson-share-switch').props.disabled).toBe(true);
    await act(async () => { onlineManager.setOnline(true); });
    expect(screen.queryByTestId('whoson-share-note')).toBeNull();
  });

  it('the Settings row draws once the choice read has answered, with its own separator', async () => {
    profileRow = { share_presence: true };
    await mount(<SharePresenceSettingRow />);
    expect(screen.getByTestId('whoson-setting')).toBeTruthy();
    expect(screen.getByTestId('whoson-share-switch').props.value).toBe(true);
    expect(shownText()).toContain('Show when I have a project open');
    // The Settings row reads the caller's own profile row, never the people RPC.
    expect(peopleCalls()).toHaveLength(0);
  });

  it('the Settings row for an account that was never asked: off, not hidden', async () => {
    profileRow = { share_presence: null };
    await mount(<SharePresenceSettingRow />);
    expect(screen.getByTestId('whoson-share-switch').props.value).toBe(false);
  });
});

describe('12  the desktop header variant', () => {
  it('content width 1280 and up: four slots and the text', async () => {
    mockLayout = { width: 1512, sidebarWidth: 64, isDesktop: true };
    serverRows = ownerPayload(6, n => (n === 4 ? { open_expires_s: 120 } : {}));
    await mount(headerStack());
    expect(avatarIds()).toEqual([OWNER, 'member-0004', 'member-0001']);
    expect(shownText()).toEqual(expect.arrayContaining(['+4', '1 has it open']));
    expect(screen.queryByTestId('whoson-choice')).toBeNull();
  });

  it('below 1280: three slots, the text only in the label', async () => {
    mockLayout = { width: 1512, sidebarWidth: 240, isDesktop: true };
    serverRows = ownerPayload(6, n => (n === 4 ? { open_expires_s: 120 } : {}));
    await mount(headerStack());
    expect(avatarIds()).toEqual([OWNER, 'member-0004']);
    expect(shownText()).toContain('+5');
    expect(shownText()).not.toContain('1 has it open');
    expect(screen.getByTestId('whoson-stack').props.accessibilityLabel).toBe('Team on this project: 7. 1 has it open now.');
  });

  it('someone who has not answered sees "Choose what\'s shown", and no card in the header', async () => {
    mockLayout = { width: 1512, sidebarWidth: 64, isDesktop: true };
    serverRows = ownerPayload(2, () => ({}), { shares_presence: null });
    await mount(headerStack());
    expect(shownText()).toContain('Choose what\'s shown');
    expect(screen.queryByTestId('whoson-choice')).toBeNull();
  });
});

describe('13  the client', () => {
  it('single flight: the hook\'s read and a tick at the same moment are one request', async () => {
    serverRows = ownerPayload(1);
    const [a, b] = await Promise.all([callPeople(OWNER, PROJECT, 'none'), callPeople(OWNER, PROJECT, 'open')]);
    expect(peopleCalls()).toHaveLength(1);
    expect(doorCalls('project_people')).toHaveLength(0);
    expect(a).toBe(b);
  });

  it('a mark is a plain read until the account is known to have said yes', async () => {
    serverRows = ownerPayload(1, () => ({}), { shares_presence: null });
    const first = await callPeople(OWNER, PROJECT, 'open');
    expect(first.outcome).toBe('ok');
    expect(first.outcome === 'ok' && first.marked).toBe(false);
    expect(doorCalls('project_people')).toHaveLength(0);
    // Not asked: a leave is not sent either.
    expect((await callPeople(OWNER, PROJECT, 'closed')).outcome).toBe('dropped');
    expect(doorCalls('project_people')).toHaveLength(0);
  });

  it('said yes: the mark and the leave go through the online-only door, never the queue', async () => {
    serverRows = ownerPayload(1, () => ({}), { shares_presence: true });
    await callPeople(OWNER, PROJECT, 'none'); // learns the choice from the self row
    const marked = await callPeople(OWNER, PROJECT, 'open');
    expect(marked.outcome === 'ok' && marked.marked).toBe(true);
    await callPeople(OWNER, PROJECT, 'closed');
    expect(doorCalls('project_people').map(c => c[1])).toEqual([
      { p_project_id: PROJECT, p_mark: 'open' },
      { p_project_id: PROJECT, p_mark: 'closed' },
    ]);
    // The door was called with no `record`: nothing to order behind, nothing queued.
    expect(mockDoor.mock.calls.every(c => c.length === 2)).toBe(true);
  });

  it('the answer is stamped with when the request was sent, not when it arrived', async () => {
    serverRows = ownerPayload(1);
    let release!: () => void;
    serverAnswer = () => new Promise<RpcAnswer>(res => { release = () => res({ data: serverRows, error: null }); });
    const sentAt = Date.now();
    const pending = callPeople(OWNER, PROJECT, 'none');
    await new Promise(r => setTimeout(r, 60));
    release();
    const result = await pending;
    expect(result.outcome).toBe('ok');
    if (result.outcome === 'ok') {
      expect(result.fetchedAtMs).toBeGreaterThanOrEqual(sentAt);
      expect(result.fetchedAtMs).toBeLessThan(sentAt + 50);
    }
  });

  it('another account signed in while the request was in flight: the result is dropped', async () => {
    serverRows = ownerPayload(1);
    serverAnswer = async () => { mockUserId = 'someone-else'; return { data: serverRows, error: null }; };
    expect((await callPeople(OWNER, PROJECT, 'none')).outcome).toBe('dropped');
  });

  it('a request for an account that is not the signed-in one is never sent', async () => {
    serverRows = ownerPayload(1);
    rememberChoice('ghost', true);
    expect((await callPeople('ghost', PROJECT, 'open')).outcome).toBe('dropped');
    expect(peopleCalls()).toHaveLength(0);
    expect(doorCalls('project_people')).toHaveLength(0);
  });

  it('no answer raises the back-off; an answer resets it', async () => {
    serverAnswer = async () => ({ data: null, error: { message: 'Network request failed' } });
    expect((await callPeople(OWNER, PROJECT, 'none')).outcome).toBe('unknown');
    expect(heartbeatState().backoffLevel).toBe(1);
    serverAnswer = null;
    serverRows = ownerPayload(1);
    expect((await callPeople(OWNER, PROJECT, 'none')).outcome).toBe('ok');
    expect(heartbeatState().backoffLevel).toBe(0);
  });

  it('rows came back but none this build can use: the zero-rows answer, and the project stops', async () => {
    mockUserId = FIELD;
    serverRows = fieldPayload({ self: { role: 'manager' } });
    const res = await callPeople(FIELD, PROJECT, 'none');
    expect(res.outcome).toBe('empty');
    expect(heartbeatState().stoppedProjectId).toBe(PROJECT);
    // Nothing was learned about the choice from an answer nobody can use.
    expect(knownChoice(FIELD)).toBeUndefined();
  });

  it('web offline: nothing is sent and it is not a failure', async () => {
    onlineManager.setOnline(false);
    expect((await callPeople(OWNER, PROJECT, 'none')).outcome).toBe('offline');
    expect(peopleCalls()).toHaveLength(0);
    expect(heartbeatState().backoffLevel).toBe(0);
  });
});

describe('14  the beacon', () => {
  const onProject = () => { mockPathname = '/project-detail'; mockParams = { id: PROJECT }; };

  it('reads on arrival, marks once the answer says yes, and leaves when the route leaves', async () => {
    jest.useFakeTimers();
    serverRows = ownerPayload(2, () => ({}), { shares_presence: true });
    onProject();
    const r = render(<ProjectPresenceBeacon />);
    expect(r.toJSON()).toBeNull();
    await act(async () => { await jest.advanceTimersByTimeAsync(50); });
    // Arrival: one read (the choice is not known yet).
    expect(peopleCalls()).toHaveLength(1);
    expect(doorCalls('project_people')).toHaveLength(0);
    // The answer went into the cache under the hook's key.
    expect(client.getQueryData(['project_people', OWNER, PROJECT])).toBeTruthy();
    // The answer said yes on a shared project: the first mark within seconds.
    await act(async () => { await jest.advanceTimersByTimeAsync(WHOSON.MIN_GAP_MS + 100); });
    expect(doorCalls('project_people').map(c => c[1])).toEqual([{ p_project_id: PROJECT, p_mark: 'open' }]);
    // Then once a minute, not sooner.
    await act(async () => { await jest.advanceTimersByTimeAsync(WHOSON.TICK_MS - 10_000); });
    expect(doorCalls('project_people')).toHaveLength(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(11_000); });
    expect(doorCalls('project_people')).toHaveLength(2);
    // Back to Home: one leave, and no more ticks.
    mockPathname = '/';
    mockParams = {};
    r.rerender(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(100); });
    expect(doorCalls('project_people').map(c => (c[1] as Row).p_mark)).toEqual(['open', 'open', 'closed']);
    await act(async () => { await jest.advanceTimersByTimeAsync(5 * WHOSON.TICK_MS); });
    expect(doorCalls('project_people')).toHaveLength(3);
    expect(peopleCalls()).toHaveLength(1);
  });

  it('someone who has not said yes is never marked: reads only', async () => {
    jest.useFakeTimers();
    serverRows = ownerPayload(2, () => ({}), { shares_presence: null });
    onProject();
    render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(3 * WHOSON.TICK_MS + 500); });
    expect(doorCalls('project_people')).toHaveLength(0);
    expect(peopleCalls().length).toBeGreaterThanOrEqual(3);
    expect(peopleCalls().every(c => (c[1] as Row).p_mark === 'none')).toBe(true);
  });

  it('an owner alone with nothing pending reads once and then stays quiet', async () => {
    jest.useFakeTimers();
    serverRows = ownerPayload(0);
    onProject();
    render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(10 * WHOSON.TICK_MS); });
    expect(peopleCalls()).toHaveLength(1);
    expect(doorCalls('project_people')).toHaveLength(0);
  });

  it('an owner alone with an invite out looks every two minutes', async () => {
    jest.useFakeTimers();
    serverRows = ownerPayload(0);
    client.setQueryData(['project_collaborators', PROJECT], [{ status: 'pending' }]);
    onProject();
    render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(50); });
    expect(peopleCalls()).toHaveLength(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(WHOSON.SLOW_TICK_MS - 5_000); });
    expect(peopleCalls()).toHaveLength(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(6_000); });
    expect(peopleCalls()).toHaveLength(2);
  });

  it('background sends one leave and stops; inactive does neither', async () => {
    jest.useFakeTimers();
    const listeners: ((s: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (s: string) => void) => {
      listeners.push(fn);
      return { remove: () => {} };
    }) as never);
    serverRows = ownerPayload(2, () => ({}), { shares_presence: true });
    onProject();
    render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(WHOSON.MIN_GAP_MS + 200); });
    expect(doorCalls('project_people').map(c => (c[1] as Row).p_mark)).toEqual(['open']);
    await act(async () => { listeners.forEach(fn => fn('inactive')); await jest.advanceTimersByTimeAsync(100); });
    expect(doorCalls('project_people')).toHaveLength(1);
    await act(async () => { listeners.forEach(fn => fn('background')); await jest.advanceTimersByTimeAsync(100); });
    expect(doorCalls('project_people').map(c => (c[1] as Row).p_mark)).toEqual(['open', 'closed']);
    await act(async () => { await jest.advanceTimersByTimeAsync(3 * WHOSON.TICK_MS); });
    expect(doorCalls('project_people')).toHaveLength(2);
    // Back in front: it marks again.
    await act(async () => { listeners.forEach(fn => fn('active')); await jest.advanceTimersByTimeAsync(WHOSON.MIN_GAP_MS + 200); });
    expect(doorCalls('project_people').map(c => (c[1] as Row).p_mark)).toEqual(['open', 'closed', 'open']);
  });

  it('web: five minutes with no input sends one leave and stops; the next input marks again', async () => {
    jest.useFakeTimers();
    setOS('web');
    const handlers: (() => void)[] = [];
    const names: string[] = [];
    const g = globalThis as unknown as { document?: unknown };
    const hadDocument = 'document' in g;
    const realDocument = g.document;
    g.document = {
      addEventListener: (name: string, fn: () => void, opts: { capture?: boolean; passive?: boolean }) => {
        names.push(`${name}:${String(opts?.capture)}:${String(opts?.passive)}`);
        handlers.push(fn);
      },
      removeEventListener: () => {},
    };
    try {
      serverRows = ownerPayload(2, () => ({}), { shares_presence: true });
      onProject();
      render(<ProjectPresenceBeacon />);
      expect(names).toEqual(['pointerdown:true:true', 'keydown:true:true', 'wheel:true:true', 'touchstart:true:true']);
      // Marks at about 5 s, 65 s, 125 s, 185 s, 245 s; the tick at 305 s finds nobody at the computer.
      await act(async () => { await jest.advanceTimersByTimeAsync(WHOSON.WEB_IDLE_MS + 10_000); });
      const marks = doorCalls('project_people').map(c => (c[1] as Row).p_mark);
      expect(marks.filter(m => m === 'closed')).toHaveLength(1);
      expect(marks[marks.length - 1]).toBe('closed');
      expect(marks.filter(m => m === 'open')).toHaveLength(5);
      // Idle: nothing more, however long the tab sits there.
      await act(async () => { await jest.advanceTimersByTimeAsync(10 * WHOSON.TICK_MS); });
      expect(doorCalls('project_people')).toHaveLength(marks.length);
      // Somebody touches the keyboard.
      await act(async () => { handlers[1](); await jest.advanceTimersByTimeAsync(200); });
      expect((doorCalls('project_people').pop()?.[1] as Row).p_mark).toBe('open');
      expect(doorCalls('project_people')).toHaveLength(marks.length + 1);
    } finally {
      if (hadDocument) g.document = realDocument; else delete g.document;
    }
  });

  it('an iPhone left on the project never idles: it keeps marking', async () => {
    jest.useFakeTimers();
    serverRows = ownerPayload(2, () => ({}), { shares_presence: true });
    onProject();
    render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(WHOSON.WEB_IDLE_MS + 3 * WHOSON.TICK_MS); });
    const marks = doorCalls('project_people').map(c => (c[1] as Row).p_mark);
    expect(marks.every(m => m === 'open')).toBe(true);
    expect(marks.length).toBeGreaterThanOrEqual(8);
  });

  it('no signal: the wait grows, and there is never a burst', async () => {
    jest.useFakeTimers();
    serverAnswer = async () => ({ data: null, error: { message: 'Network request failed' } });
    onProject();
    render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    expect(peopleCalls()).toHaveLength(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(10 * 60_000); });
    // 0 s, +60 s, +120 s, +300 s, (+300 s lands past this window).
    expect(peopleCalls().length).toBeLessThanOrEqual(4);
    expect(peopleCalls().length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ['the viewer\'s own row has a role this build does not know', () => fieldPayload({ self: { role: 'manager' } })],
    ['the viewer\'s own row is a member row with the owner role', () => fieldPayload({ self: { role: 'owner' } })],
    ['there is no row for the viewer', () => [ownerRow({ is_self: false }), memberRow(1)]],
    ['there are two owner rows', () => [ownerRow({ is_self: false }), ownerRow({ user_id: 'owner-0002', is_self: false }), memberRow(2, { is_self: true })]],
  ])('an answer nobody can use (%s) is read once in ten minutes, not every five seconds', async (_name, rows) => {
    jest.useFakeTimers();
    mockUserId = FIELD;
    serverRows = rows();
    onProject();
    render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(10 * WHOSON.TICK_MS); });
    expect(peopleCalls()).toHaveLength(1);
    expect(doorCalls('project_people')).toHaveLength(0);
    expect(heartbeatState().stoppedProjectId).toBe(PROJECT);
    expect(client.getQueryData(['project_people', FIELD, PROJECT])).toEqual({ people: [], fetchedAtMs: expect.any(Number) });
  });

  it('an answer nobody can use: coming back to the project asks once more, and only once', async () => {
    jest.useFakeTimers();
    mockUserId = FIELD;
    serverRows = fieldPayload({ self: { role: 'manager' } });
    onProject();
    const r = render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(3 * WHOSON.TICK_MS); });
    expect(peopleCalls()).toHaveLength(1);
    mockPathname = '/';
    mockParams = {};
    r.rerender(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(WHOSON.TICK_MS); });
    onProject();
    r.rerender(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(10 * WHOSON.TICK_MS); });
    expect(peopleCalls()).toHaveLength(2);
  });

  it('plain reads never push the mark out: a read every 50 s for five minutes, a mark every minute', async () => {
    jest.useFakeTimers();
    serverRows = ownerPayload(2, () => ({}), { shares_presence: true });
    const markAt: number[] = [];
    mockDoor.mockImplementation(async (_fn: string, args: Record<string, unknown>) => {
      if (args.p_mark === 'open') markAt.push(Date.now());
      return { status: 'synced', data: serverRows } as never;
    });
    onProject();
    render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(WHOSON.MIN_GAP_MS + 500); });
    expect(markAt).toHaveLength(1);
    const readsBefore = peopleCalls().length;
    // What a screen does each time the Team section opens: one plain read.
    for (let i = 0; i < 6; i++) {
      await act(async () => { await jest.advanceTimersByTimeAsync(50_000); });
      await act(async () => { void callPeople(OWNER, PROJECT, 'none'); await jest.advanceTimersByTimeAsync(10); });
    }
    expect(peopleCalls().length - readsBefore).toBe(6);
    const gaps = markAt.slice(1).map((t, i) => t - markAt[i]);
    expect(gaps.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(WHOSON.TICK_MS);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(WHOSON.TICK_MS + WHOSON.MIN_GAP_MS + 50);
    // Every gap is inside the server's window, so the dot never lapses.
    expect(Math.max(...gaps)).toBeLessThan(WHOSON.OPEN_WINDOW_S * 1000);
  });

  it('a read just before a mark is due delays it by the 5 s gap and no more', async () => {
    jest.useFakeTimers();
    serverRows = ownerPayload(2, () => ({}), { shares_presence: true });
    const markAt: number[] = [];
    mockDoor.mockImplementation(async (_fn: string, args: Record<string, unknown>) => {
      if (args.p_mark === 'open') markAt.push(Date.now());
      return { status: 'synced', data: serverRows } as never;
    });
    onProject();
    render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(WHOSON.MIN_GAP_MS + 500); });
    expect(markAt).toHaveLength(1);
    // Two reads: one 7 s before the second mark is due, one 2 s before the third.
    await act(async () => { await jest.advanceTimersByTimeAsync(52_500); });
    await act(async () => { void callPeople(OWNER, PROJECT, 'none'); await jest.advanceTimersByTimeAsync(10); });
    await act(async () => { await jest.advanceTimersByTimeAsync(55_000); });
    expect(markAt).toHaveLength(2);
    await act(async () => { await jest.advanceTimersByTimeAsync(9_990); });
    await act(async () => { void callPeople(OWNER, PROJECT, 'none'); await jest.advanceTimersByTimeAsync(10); });
    await act(async () => { await jest.advanceTimersByTimeAsync(2_500); });
    // 60 s after the second mark, but only 2.5 s after that read: the gap holds.
    expect(markAt).toHaveLength(2);
    await act(async () => { await jest.advanceTimersByTimeAsync(3_000); });
    expect(markAt).toHaveLength(3);
    expect(markAt[1] - markAt[0]).toBe(WHOSON.TICK_MS);
    expect(markAt[2] - markAt[1]).toBeGreaterThan(WHOSON.TICK_MS);
    expect(markAt[2] - markAt[1]).toBeLessThanOrEqual(WHOSON.TICK_MS + WHOSON.MIN_GAP_MS);
  });

  it('a leave the server refuses pauses everything, and the look at the end of the pause still happens', async () => {
    jest.useFakeTimers();
    const OTHER = '99999999-2222-4333-8444-555555555555';
    serverRows = ownerPayload(2, () => ({}), { shares_presence: true });
    mockDoor.mockImplementation(async (_fn: string, args: Record<string, unknown>) => {
      // The leave is refused by the server; no listener is told about a leave.
      if (args.p_mark === 'closed') return { status: 'refused', code: 'server', error: 'boom' } as never;
      return { status: 'synced', data: serverRows } as never;
    });
    onProject();
    const r = render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(WHOSON.MIN_GAP_MS + 500); });
    expect(doorCalls('project_people').map(c => (c[1] as Row).p_mark)).toEqual(['open']);
    // On to another project: one leave for the first (refused), and a timer for the second.
    mockParams = { id: OTHER };
    r.rerender(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(100); });
    expect(doorCalls('project_people').map(c => (c[1] as Row).p_mark)).toEqual(['open', 'closed']);
    const pausedUntil = heartbeatState().pausedUntilMs;
    expect(pausedUntil).toBeGreaterThan(Date.now() + WHOSON.SERVER_PAUSE_MS - 1_000);
    const forOther = () => peopleCalls().filter(c => (c[1] as Row).p_project_id === OTHER).length;
    // The timer set before the refusal fires into the pause: nothing is sent...
    await act(async () => { await jest.advanceTimersByTimeAsync(WHOSON.SERVER_PAUSE_MS - 5_000); });
    expect(forOther()).toBe(0);
    // ...and when the pause ends the second project is read, with no event to prompt it.
    await act(async () => { await jest.advanceTimersByTimeAsync(10_000); });
    expect(forOther()).toBe(1);
  });

  it('a route with no project: nothing is asked', async () => {
    jest.useFakeTimers();
    serverRows = ownerPayload(2);
    mockPathname = '/invoice';
    mockParams = { id: 'an-invoice-id' };
    render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(3 * WHOSON.TICK_MS); });
    expect(peopleCalls()).toHaveLength(0);
    expect(doorCalls('project_people')).toHaveLength(0);
  });

  it('a session that is not this account\'s: nothing is sent, and it does not spin', async () => {
    jest.useFakeTimers();
    serverRows = ownerPayload(2);
    mockSessionUser.mockImplementation(async () => null);
    onProject();
    render(<ProjectPresenceBeacon />);
    await act(async () => { await jest.advanceTimersByTimeAsync(3 * WHOSON.TICK_MS + 500); });
    expect(peopleCalls()).toHaveLength(0);
    // One look a minute at most, not a tight loop.
    expect(mockSessionUser.mock.calls.length).toBeLessThanOrEqual(5);
  });
});

describe('15  WHOS_ON_ENABLED false: the feature does not exist', () => {
  beforeEach(() => { mockFlagOn = false; });

  it('every component renders null and nothing is sent, with a populated server behind it', async () => {
    jest.useFakeTimers();
    const addListener = jest.spyOn(AppState, 'addEventListener');
    serverRows = ownerPayload(5, n => (n === 1 ? { open_expires_s: 120, last_seen_at: '2026-10-04T14:00:00Z', seen_age_s: 60 } : {}), { shares_presence: null });
    profileRow = { share_presence: true };
    mockPathname = '/project-detail';
    mockParams = { id: PROJECT };
    const person = mapPeopleRow(memberRow(1, { open_expires_s: 120 }))!;
    const r = render(
      <>
        <ProjectPresenceBeacon />
        {heroStack()}
        {headerStack()}
        <ProjectPeopleBlock projectId={PROJECT} />
        <PersonRowExtras person={person} fetchedAtMs={Date.now()} />
        <PersonAvatar person={person} open />
        <PresenceDot />
        <PresenceDot ground="bg" testID="a-dot-used-directly" />
        <SharePresenceSettingRow />
      </>,
    );
    await act(async () => { await jest.advanceTimersByTimeAsync(5 * WHOSON.TICK_MS); });
    expect(r.toJSON()).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(mockDoor).not.toHaveBeenCalled();
    expect(fromSpy.mock.calls.filter(c => c[0] === 'profiles')).toHaveLength(0);
    expect(mockSessionUser).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('a screen that calls the hook directly is handed nobody, and nothing is sent', async () => {
    serverRows = ownerPayload(5, () => ({}), { shares_presence: true });
    const r = await mount(<PeopleProbe />);
    expect(r.toJSON()).toBeNull();
    expect(probed).toEqual([]);
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(mockDoor).not.toHaveBeenCalled();
    expect(mockSessionUser).not.toHaveBeenCalled();
    // The query exists (a hook cannot be skipped) but is disabled and never fetched.
    expect(client.getQueryCache().getAll().every(q => q.state.fetchStatus === 'idle' && q.state.dataUpdateCount === 0 && q.state.errorUpdateCount === 0)).toBe(true);
  });

  it('the client itself refuses to send', async () => {
    serverRows = ownerPayload(2);
    rememberChoice(OWNER, true);
    for (const mark of ['none', 'open', 'closed'] as const) {
      expect((await callPeople(OWNER, PROJECT, mark)).outcome).toBe('dropped');
    }
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(mockDoor).not.toHaveBeenCalled();
  });

  it('the real flag is false', () => {
    const real = jest.requireActual('@/constants/featureFlags') as typeof import('@/constants/featureFlags');
    expect(real.WHOS_ON_ENABLED).toBe(false);
  });
});
