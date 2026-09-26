/**
 * Wave 6d, lane P2 (P5-FORMS) — the estimate wizard on one page, Settings as
 * two panes, the Paywall as a centred web card. PHONE PROOF.
 *
 * Every edit in lane P2 sits behind `isDesktopWeb ? <new/> : <today's JSX>`
 * (useIsDesktopWeb() is false on iOS, Android and a narrow browser), an
 * `isDesktop && …` style append, a wrapper that renders a FRAGMENT off desktop
 * web (SettingsPanes, SettingsSection, SheetOverlay), or a Modal prop that
 * resolves to today's value off desktop. So on the iPhone NOTHING may change.
 * This file is the proof.
 *
 *  1. GOLDEN — recorded FIRST, on a pristine archive of the untouched base
 *     (124dc7c4), before a single line of this lane was written, and never
 *     regenerated. Each case mounts a real route inside the real app (the
 *     provider stack, the populated fixture world) and records the whole
 *     rendered tree. Every <Modal> renders its content, open or not, so each
 *     snapshot holds every sheet the screen owns in its phone styles.
 *
 *     'web 390' is the browser's LAYOUT gate (mockWeb: web >= 900 is desktop)
 *     with Platform.OS left native — a full route cannot mount on RN-web
 *     inside this harness (app/_layout.tsx reads window.location). The two
 *     surfaces whose phone tree BRANCHES on Platform.OS === 'web' (the
 *     <Paywall> component's web Modal and /paywall's WebPaywallView) are
 *     mounted inside the real app on iOS, then Platform.OS is flipped to 'web'
 *     and ONLY that subtree is remounted (FlipToWeb below) and read, so the
 *     snapshot is the real web branch at 390.
 *
 *  2. NATIVE TABLET (android, 1100 wide): isDesktop is TRUE on native at
 *     >= 1024, so desktop STYLES may apply there (the accepted 6c rule), but
 *     the useIsDesktopWeb() switches stay off: no wizard index, no settings
 *     index, the wizard still reads "Step 1 of 8", and the Paywall Modal is
 *     not transparent.
 *
 * What a snapshot records: every style prop FLATTENED (a `false` left by
 * `isDesktop && …` renders nothing), handler props dropped, undefined props
 * dropped; the snapshot stores the dump's line count and sha256 (set
 * P2_DUMP_DIR to write the dumps). Both clocks are pinned.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID } from '@/__tests__/fixtures/world';
import Paywall from '@/components/Paywall';
import PaywallScreen from '@/app/paywall';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';

// ── The layout gate: a width + a web flag, exactly like the app's hook ──────
let mockWidth = 390;
let mockHeight = 844;
let mockWeb = false;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => {
    const isDesktop = mockWidth >= 1024 || (mockWeb && mockWidth >= 900);
    const isTablet = !isDesktop && mockWidth >= 768;
    return {
      screenSize: isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone',
      isPhone: !isDesktop && !isTablet,
      isTablet,
      isDesktop,
      width: mockWidth,
      height: mockHeight,
      contentMaxWidth: isDesktop ? 1280 : isTablet ? 900 : mockWidth,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
    };
  },
}));

// useIsDesktopWeb(): the app's own answer (false on iOS/Android and below the
// desktop gate), unless a desktop-web case forces it on.
let mockForceDesktopWeb = false;
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => (mockForceDesktopWeb ? actual.useIsDesktop() : actual.useIsDesktopWeb()) };
});

// The owner case: the smoke user reads as an owner email (Developer shown).
let mockOwner = false;
jest.mock('@/utils/owner', () => {
  const actual = jest.requireActual('@/utils/owner');
  return { ...actual, isOwner: (email?: string | null) => (mockOwner ? true : actual.isOwner(email)) };
});

// The desktop Generate cases spy on the AI gate: a blocked Generate must never
// reach it, an allowed one reaches it once. Off those cases it is the real one.
let mockLimitSpy: jest.Mock | null = null;
jest.mock('@/utils/aiRateLimiter', () => {
  const actual = jest.requireActual('@/utils/aiRateLimiter');
  return {
    ...actual,
    checkAILimit: (...args: unknown[]) => (mockLimitSpy ? mockLimitSpy(...args) : actual.checkAILimit(...args)),
  };
});

// Every Modal renders its content, open or closed (see the header).
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const ReactActual = jest.requireActual('react');
  const { View: RNView, Text: RNText } = jest.requireActual('react-native');
  class Boundary extends ReactActual.Component<{ children?: React.ReactNode }, { threw: boolean }> {
    state = { threw: false };
    static getDerivedStateFromError() { return { threw: true }; }
    componentDidCatch() { /* recorded as a placeholder; identical before and after */ }
    render() {
      return this.state.threw
        ? ReactActual.createElement(RNText, { testID: 'modal-body-threw' }, 'modal-body-threw')
        : this.props.children;
    }
  }
  function Modal(props: Record<string, unknown> & { children?: React.ReactNode }) {
    const { children, visible, transparent, animationType, presentationStyle } = props;
    return ReactActual.createElement(
      RNView,
      {
        testID: 'p2-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      ReactActual.createElement(Boundary, null, children),
    );
  }
  return { __esModule: true, default: Modal };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
function env(os: 'ios' | 'android' | 'web', width: number, height: number) {
  restoreOS?.();
  const platform = os === 'web' ? 'ios' : os;
  restoreOS = platform === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', platform).restore;
  mockWidth = width;
  mockHeight = height;
  mockWeb = os === 'web';
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

// Two clocks, both pinned (see w6c-field-phone for why the outer realm's
// Date.now — the one renderRouter's fake timers start from — is pinned too).
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-25T16:00:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;
let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
  allowConsoleErrors();
});
afterEach(() => {
  mockForceDesktopWeb = false;
  mockOwner = false;
  mockFlip = null;
  mockLimitSpy = null;
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
});

// ── What a snapshot records (one line per host node; line count + sha256) ──
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
const KNOWN_IDS = new Set([PROJECT_ID, ESTIMATE_ID]);
const volatile = (s: string) => s
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, (m) => (KNOWN_IDS.has(m) ? m : '<uuid>'))
  .replace(/\b\d{13}[a-z0-9]{0,12}\b/g, '<ts-id>');
function small(v: unknown): string | null {
  try {
    const j = JSON.stringify(v);
    return j !== undefined && j.length <= 600 ? volatile(j) : null;
  } catch { return null; }
}
function dumpLines(node: unknown, depth: number, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) dumpLines(n, depth, out); return; }
  const pad = ' '.repeat(Math.min(depth, 200));
  if (typeof node !== 'object') { out.push(`${pad}"${volatile(String(node))}"`); return; }
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  const parts: string[] = [];
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (v === undefined || typeof v === 'function' || k === 'children' || k === 'screenId') continue;
    if (/style$/i.test(k) && v != null && typeof v === 'object') { parts.push(`${k}=${small(flat(v)) ?? '<big>'}`); continue; }
    if (typeof v === 'string') { parts.push(`${k}=${JSON.stringify(volatile(v))}`); continue; }
    if (typeof v !== 'object' || v === null) { parts.push(`${k}=${String(v)}`); continue; }
    parts.push(`${k}=${small(v) ?? '<obj>'}`);
  }
  out.push(`${pad}<${el.type} ${parts.join(' ')}>`);
  dumpLines(el.children, depth + 1, out);
}
function fingerprint(name: string, json: unknown): { lines: number; sha256: string } {
  json = stripSanctioned(json);
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = out.join('\n');
  const dir = process.env.P2_DUMP_DIR;
  if (dir) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${name.replace(/[^a-z0-9]+/gi, '_')}.txt`, text);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sha256 = require('node:crypto').createHash('sha256').update(text).digest('hex');
  return { lines: out.length, sha256 };
}

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

async function mountAt(os: 'ios' | 'android' | 'web', width: number, height: number, url: string, role?: string) {
  env(os, width, height);
  await primeWorld('populated');
  if (role) await AsyncStorage.setItem('mageid_user_role', role);
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

// ── Platform-branching surfaces: mount on iOS, flip ONE subtree to 'web' ────
// FlipToWeb re-keys its child when mockFlip() runs, so the subtree REMOUNTS
// (hook order may differ between a component's web and native branches) while
// the rest of the app, rendered on iOS, is not touched.
let mockFlip: (() => void) | null = null;
function FlipToWeb({ children }: { children: () => React.ReactElement }) {
  const [gen, setGen] = React.useState(0);
  mockFlip = () => setGen((g) => g + 1);
  return <React.Fragment key={gen}>{children()}</React.Fragment>;
}

const PAYWALL_PROPS = {
  visible: true,
  onClose: () => {},
  feature: 'Invoicing',
  requiredTier: 'pro' as const,
  practiceTutorialId: 'invoice-to-self' as const,
  source: 'tutorial_handoff',
};
const PaywallProbe = () => <FlipToWeb>{() => <Paywall {...PAYWALL_PROPS} />}</FlipToWeb>;
const PaywallScreenProbe = () => <FlipToWeb>{() => <PaywallScreen />}</FlipToWeb>;

/** Mount `probe` inside the real app on iOS; with `web`, flip Platform.OS to
 *  'web', remount only the probe's subtree, read the tree, and flip back. */
async function probeTree(route: string, probe: () => React.ReactElement, os: 'ios' | 'android' | 'web', width: number, height: number) {
  env(os, width, height);
  await primeWorld('populated');
  const tree = await mountRouteChecked(route, probe);
  await pump();
  if (os !== 'web') return tree.toJSON();
  const back = jest.replaceProperty(Platform, 'OS', 'web').restore;
  try {
    await act(async () => {
      mockFlip?.();
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
    return tree.toJSON();
  } finally {
    back();
  }
}

/** The recorded props of the Modal that holds `testID` (the app's other
 *  root-level Modals are ignored). */
type Inst = { props: Record<string, unknown>; parent: Inst | null };
function paywallModalHint(testID: string): { visible: unknown; transparent: unknown; animationType: unknown; presentationStyle: unknown } {
  let n: Inst | null = screen.getByTestId(testID) as unknown as Inst;
  while (n && n.props.testID !== 'p2-modal') n = n.parent;
  if (!n) throw new Error(`no Modal holds ${testID}`);
  return JSON.parse(String(n.props.accessibilityHint));
}

const P = `projectId=${PROJECT_ID}`;

// ── 1. GOLDEN ──────────────────────────────────────────────────────────────
describe('lane P2 — the phone is unchanged (golden)', () => {
  jest.setTimeout(180000);

  const WIZARD: [string, 'ios' | 'web', string][] = [
    ['estimate-wizard, iOS 390', 'ios', '/estimate-wizard'],
    ['estimate-wizard?projectId (voice banner), iOS 390', 'ios', `/estimate-wizard?${P}`],
    ['estimate-wizard?onboarding=1, iOS 390', 'ios', '/estimate-wizard?onboarding=1'],
    ['estimate-wizard, web 390', 'web', '/estimate-wizard'],
    ['estimate-wizard?projectId (voice banner), web 390', 'web', `/estimate-wizard?${P}`],
    ['estimate-wizard?onboarding=1, web 390', 'web', '/estimate-wizard?onboarding=1'],
  ];
  it.each(WIZARD)('%s', async (name, os, url) => {
    const tree = await mountAt(os, 390, 844, url);
    expect(screen.getByText(/Step 1 of 8/)).toBeTruthy();
    if (url.includes('projectId')) expect(screen.getByTestId('estimate-voice-entry')).toBeTruthy();
    if (url.includes('onboarding')) expect(screen.getByTestId('estimate-onboarding-banner')).toBeTruthy();
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });

  const SETTINGS: [string, 'ios' | 'web', string, boolean][] = [
    ['settings as contractor, iOS 390', 'ios', 'contractor', false],
    ['settings as property_manager, iOS 390', 'ios', 'property_manager', false],
    ['settings as an owner email (Developer shown), iOS 390', 'ios', 'contractor', true],
    ['settings as contractor, web 390', 'web', 'contractor', false],
    ['settings as property_manager, web 390', 'web', 'property_manager', false],
    ['settings as an owner email (Developer shown), web 390', 'web', 'contractor', true],
  ];
  it.each(SETTINGS)('%s', async (name, os, role, owner) => {
    mockOwner = owner;
    const tree = await mountAt(os, 390, 844, '/settings', role);
    expect(screen.getByText('AI USAGE')).toBeTruthy();
    if (owner) expect(screen.getByText('DEVELOPER (OWNER ONLY)')).toBeTruthy();
    else expect(screen.queryByText('DEVELOPER (OWNER ONLY)')).toBeNull();
    if (role === 'property_manager') expect(screen.queryByText('ESTIMATE DEFAULTS')).toBeNull();
    else expect(screen.getByText('ESTIMATE DEFAULTS')).toBeTruthy();
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });

  it('/paywall, iOS 390 (the native branch)', async () => {
    const tree = await mountAt('ios', 390, 844, '/paywall');
    expect(fingerprint('paywall route ios 390', tree.toJSON())).toMatchSnapshot();
  });

  it('/paywall, web 390 (WebPaywallView)', async () => {
    const json = await probeTree('/w6d-forms-paywall-screen', PaywallScreenProbe, 'web', 390, 844);
    expect(JSON.stringify(json)).toContain('paywall-close-web');
    expect(fingerprint('paywall route web 390', json)).toMatchSnapshot();
  });

  it('<Paywall> practiceTutorialId invoice-to-self, iOS 390', async () => {
    const json = await probeTree('/w6d-forms-paywall-sheet', PaywallProbe, 'ios', 390, 844);
    expect(JSON.stringify(json)).toContain('paywall-upgrade-btn');
    expect(fingerprint('paywall component ios 390', json)).toMatchSnapshot();
  });

  it('<Paywall> practiceTutorialId invoice-to-self, web 390 (not transparent, slide, pageSheet)', async () => {
    const json = await probeTree('/w6d-forms-paywall-sheet', PaywallProbe, 'web', 390, 844);
    const text = JSON.stringify(json);
    expect(text).toContain('paywall-open-play-store');
    // The web card's Modal at 390: no transparent, today's slide + pageSheet.
    expect(paywallModalHint('paywall-open-play-store')).toEqual({ visible: true, transparent: null, animationType: 'slide', presentationStyle: 'pageSheet' });
    expect(fingerprint('paywall component web 390', json)).toMatchSnapshot();
  });
});

// ── 2. Native tablet: desktop styles may apply, desktop-WEB switches may not ──
describe('lane P2 — android 1100 (isDesktop true, desktopWeb false)', () => {
  jest.setTimeout(180000);
  const hasTestIdPrefix = (json: unknown, prefix: string) => JSON.stringify(json).includes(`"testID":"${prefix}`);

  it('the wizard keeps one question per step', async () => {
    const tree = await mountAt('android', 1100, 800, '/estimate-wizard');
    expect(screen.getByText(/Step 1 of 8/)).toBeTruthy();
    expect(hasTestIdPrefix(tree.toJSON(), 'wizard-index-')).toBe(false);
    expect(hasTestIdPrefix(tree.toJSON(), 'wizard-q-')).toBe(false);
  });

  it('settings keeps one long list (no index)', async () => {
    const tree = await mountAt('android', 1100, 800, '/settings', 'contractor');
    expect(hasTestIdPrefix(tree.toJSON(), 'settings-index-')).toBe(false);
    expect(screen.getByText('AI USAGE')).toBeTruthy();
    expect(screen.getByText('PAYMENTS')).toBeTruthy();
  });

  it('the Paywall Modal is not transparent', async () => {
    await probeTree('/w6d-forms-paywall-sheet', PaywallProbe, 'android', 1100, 800);
    expect(paywallModalHint('paywall-upgrade-btn').transparent).toBeNull();
  });
});

// ── 3. Desktop web 1512 × 945: behaviour, not pixels (no snapshot) ──────────
// useIsDesktopWeb() is forced on (Platform.OS stays native: a full route
// cannot mount on RN-web here). Keyboard shortcuts need a DOM and are proved
// in scripts/validate-w6d-forms.ts (the binding) and the live check.
describe('lane P2 — desktop web 1512 (the one-page forms)', () => {
  jest.setTimeout(180000);
  const desk = async (url: string, role?: string) => {
    mockForceDesktopWeb = true;
    return mountAt('ios', 1512, 945, url, role);
  };

  it('wizard: all eight questions on one page, with the index, and no stepper', async () => {
    await desk('/estimate-wizard');
    for (const k of ['projectType', 'sizeSqft', 'location', 'quality', 'scope', 'timelineWeeks', 'specialRequirements', 'targetBudget']) {
      expect(screen.getByTestId(`wizard-q-${k}`)).toBeTruthy();
      expect(screen.getByTestId(`wizard-index-${k}`)).toBeTruthy();
    }
    expect(screen.queryByText(/Step 1 of 8/)).toBeNull();
    expect(screen.queryByTestId('wizard-next')).toBeNull();
  });

  it('wizard: Generate on empty answers names step 0 and never reaches the AI gate', async () => {
    mockLimitSpy = jest.fn(async () => ({ allowed: false, remaining: 0, reason: 'daily_cap' }));
    await desk('/estimate-wizard');
    await act(async () => { fireEvent.press(screen.getByTestId('wizard-generate')); });
    await pump(2);
    expect(screen.getByTestId('wizard-step-hint')).toBeTruthy();
    expect(screen.getByText('Pick a project type to continue, or tap Other and describe the job.')).toBeTruthy();
    expect(mockLimitSpy).not.toHaveBeenCalled();
  });

  it('wizard: with steps 0-4 answered, Generate runs generate() once', async () => {
    mockLimitSpy = jest.fn(async () => ({ allowed: false, remaining: 0, reason: 'daily_cap' }));
    await desk('/estimate-wizard');
    const chips = screen.getAllByTestId(/^wizard-type-(?!other)/);
    await act(async () => { fireEvent.press(chips[0]); });
    await act(async () => { fireEvent.changeText(screen.getByTestId('wizard-sizeSqft'), '1500'); });
    await act(async () => { fireEvent.changeText(screen.getByTestId('wizard-location'), 'Austin, TX'); });
    await act(async () => { fireEvent.changeText(screen.getByTestId('wizard-scope'), 'Gut the kitchen and add an island'); });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByTestId('wizard-generate')); });
    await pump(2);
    expect(mockLimitSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('wizard-step-hint')).toBeNull();
  });

  it('settings: the index renders and only Account & plan is mounted', async () => {
    await desk('/settings', 'contractor');
    expect(screen.getByTestId('settings-index')).toBeTruthy();
    expect(screen.getByTestId('settings-index-payments')).toBeTruthy();
    expect(screen.getByText('AI USAGE')).toBeTruthy();
    expect(screen.getByTestId('logout-button')).toBeTruthy();
    expect(screen.queryByText('PAYMENTS')).toBeNull();
    expect(screen.queryByText('HELP & SUPPORT')).toBeNull();
    // Web never lists the native-only security section.
    expect(screen.queryByTestId('settings-index-security')).toBeNull();
  });

  it('settings: ?section=payments mounts Money and unmounts Account & plan', async () => {
    await desk('/settings?section=payments', 'contractor');
    expect(screen.getByText('PAYMENTS')).toBeTruthy();
    expect(screen.getByText('INTEGRATIONS')).toBeTruthy();
    expect(screen.queryByText('AI USAGE')).toBeNull();
  });

  it('settings: a property manager\'s index has none of the four contractor-only rows', async () => {
    await desk('/settings', 'property_manager');
    expect(screen.getByTestId('settings-index-payments')).toBeTruthy();
    for (const id of ['estimate-defaults', 'pdf-naming', 'your-costs', 'supplier-marketplace']) {
      expect(screen.queryByTestId(`settings-index-${id}`)).toBeNull();
    }
  });

  it('settings: the Help group still reaches the Tutorials row', async () => {
    await desk('/settings?section=help', 'contractor');
    expect(screen.getByTestId('show-tutorial')).toBeTruthy();
  });

  it('Paywall: the web card is transparent and capped at the form sheet (560)', async () => {
    mockForceDesktopWeb = true;
    await probeTree('/w6d-forms-paywall-sheet', PaywallProbe, 'web', 1512, 945);
    const hint = paywallModalHint('paywall-open-play-store');
    expect(hint.transparent).toBe(true);
    expect(hint.presentationStyle).toBeNull();
    type Up = { props: Record<string, unknown>; parent: Up | null };
    let n: Up | null = screen.getByTestId('paywall-open-play-store') as unknown as Up;
    let capped = false;
    while (n) {
      if ((flat(n.props.style) as ViewStyle).maxWidth === 560) { capped = true; break; }
      n = n.parent;
    }
    expect(capped).toBe(true);
    expect(screen.getByTestId('paywall-practice-sample')).toBeTruthy();
  });
});
