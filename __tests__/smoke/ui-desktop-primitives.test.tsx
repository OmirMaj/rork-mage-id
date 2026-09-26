/**
 * Smoke — the wave-6b desktop primitives (components/ui/{Button, SegmentedControl,
 * Sheet, ActionBar, TileGrid, ChipRail, desktop} + components/FilterChipRow).
 *
 * THE PROMISE THIS PROVES: "phone identical". Button and FilterChipRow are
 * GLOBAL — ~135 Button call sites in ~36 files and every filter rail inherit
 * the change the moment it lands — so "it looks the same on my phone" is not
 * good enough. At the bottom of this file are the two components EXACTLY as
 * they were at 480c8710 (pulled verbatim with `git show`, only renamed to
 * Legacy*). Each is rendered next to today's component at 390 pt native with
 * the same props, and the two rendered trees must be equal — element for
 * element, style for style. The new primitives (ActionBar, TileGrid, ChipRail)
 * must equal the plain View / ScrollView the screens hand-roll today, and
 * useSheetFrame must hand a phone nothing but nulls.
 *
 * Then each primitive is rendered at 1512 web (the founder's MacBook) and the
 * desktop rules are asserted on the rendered styles.
 *
 * The desktop gate is useResponsiveLayout().isDesktop; it is mocked here to the
 * real rule (web >= 900, anything >= 1024) over a width the test sets.
 */

import React, { useCallback, useRef } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  Animated,
  ActivityIndicator,
  View,
  Platform,
  ScrollView,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
// react-test-renderer ships no .d.ts here (RNTL wraps it); only the two
// calls this file makes are typed.
type TestRendererInstance = { toJSON(): unknown; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer: { create(el: React.ReactElement): TestRendererInstance } = require('react-test-renderer');
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Plus } from 'lucide-react-native';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import {
  Button,
  SegmentedControl,
  Sheet,
  SheetOverlay,
  SheetScrim,
  useSheetFrame,
  ActionBar,
  ActionBarReadout,
  TileGrid,
  ChipRail,
  segmentedDesktop,
  type SheetFrame,
} from '@/components/ui';
import FilterChipRow, { type FilterChip } from '@/components/FilterChipRow';
import { useCommitFeedback } from '@/components/ui/Button';

let mockWidth = 390;
let mockWeb = false;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => {
    const isDesktop = mockWidth >= 1024 || (mockWeb && mockWidth >= 900);
    return {
      screenSize: isDesktop ? 'desktop' : 'phone',
      isPhone: !isDesktop,
      isTablet: false,
      isDesktop,
      width: mockWidth,
      height: 945,
      contentMaxWidth: isDesktop ? 1400 : mockWidth,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: 32,
    };
  },
}));

// The real light palette, without ThemeProvider's AsyncStorage hydrate: that
// async setState lands between the dozens of back-to-back renders this file
// does and trips "overlapping act() calls". Both sides of every comparison
// (today's component and the pre-change copy) read the same hook, so the
// palette is identical on both sides by construction.
jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>{children}</ThemeProvider>
    </SafeAreaProvider>
  );
}
/**
 * Mount, read the tree, unmount — through react-test-renderer directly, not
 * RNTL's render(). RNTL queues an `unmountAsync` for every render and the
 * shared after-env cleanup fires them all at once without awaiting, so a test
 * that renders dozens of trees (every Button variant, twice) leaves dozens of
 * overlapping async act() scopes behind and the NEXT test's render never
 * commits. The comparisons only need toJSON(); the interaction tests below use
 * RNTL's render once each, like every other smoke file.
 */
function tree(el: React.ReactElement) {
  let r: TestRendererInstance | null = null;
  act(() => {
    r = TestRenderer.create(<Wrap>{el}</Wrap>);
  });
  const inst = r as unknown as TestRendererInstance;
  const json = inst.toJSON();
  act(() => {
    inst.unmount();
  });
  return json;
}
/** The rendered tree as text. Handlers are fresh closures on every render, so
 *  they compare by NAME (onPress/onClick/…) — everything else, styles
 *  included, compares by value. */
const serialize = (el: React.ReactElement) =>
  JSON.stringify(tree(el), (_k, v) => (typeof v === 'function' ? `[fn ${v.name || 'anonymous'}]` : v === undefined ? '__undefined__' : v), 1);

function phone() {
  mockWidth = 390;
  mockWeb = false;
}
/** 1512 web. Platform.OS is flipped for the rules that also need the DOM /
 *  CSS-only values (Button's fit-content); restored after each test. (Not
 *  jest.restoreAllMocks — that also strips the preset's Appearance mock.) */
let restoreOS: (() => void) | null = null;
function desktopWeb() {
  mockWidth = 1512;
  mockWeb = true;
  restoreOS = jest.replaceProperty(Platform, 'OS', 'web').restore;
}
afterEach(() => {
  restoreOS?.();
  restoreOS = null;
  phone();
});

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
function all(n: unknown, pred: (x: Node) => boolean, out: Node[] = []): Node[] {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => all(c, pred, out)); return out; }
  const node = n as Node;
  if (pred(node)) out.push(node);
  (node.children ?? []).forEach((c) => all(c, pred, out));
  return out;
}
const flat = (s: unknown) => (StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;
const noop = () => {};
/** The nearest HOST ancestor (the Animated.View wrapper around a Button's
 *  Pressable), skipping composite components. */
type Inst = { type: unknown; parent: Inst | null; props: Record<string, unknown> };
function hostParent(n: unknown): Inst {
  let p = (n as Inst).parent;
  while (p && typeof p.type !== 'string') p = p.parent;
  return p as Inst;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('phone (390 native): byte-identical to today', () => {
  beforeEach(phone);

  const variants = ['primary', 'secondary', 'ghost', 'destructive'] as const;
  const sizes = ['sm', 'md', 'lg'] as const;
  it.each(variants.flatMap((v) => sizes.map((s) => [v, s] as const)))('Button %s/%s equals the pre-change Button', (variant, size) => {
    for (const extra of [
      {},
      { fullWidth: true },
      { style: { flex: 1 } },
      { style: { marginTop: 8, alignSelf: 'flex-start' as const } },
      { disabled: true },
      // { loading: true } left this loop in round 2: the phone now keeps the
      // label row under the spinner (see 'the commit morph' below).
      { iconLeft: <Plus size={16} />, iconRight: <Plus size={14} /> },
      { fullWidth: true, style: { paddingHorizontal: 10 }, testID: 'b' },
    ]) {
      const now = serialize(<Button label="Save to Project" onPress={noop} variant={variant} size={size} {...extra} />);
      const then = serialize(<LegacyButton label="Save to Project" onPress={noop} variant={variant} size={size} {...extra} />);
      expect(now).toBe(then);
    }
  });

  it('Button inside an ActionBar on a phone is still the pre-change Button', () => {
    const now = serialize(
      <ActionBar style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="Save" onPress={noop} fullWidth style={{ flex: 1 }} />
        <Button label="Send" onPress={noop} style={{ flex: 1 }} />
      </ActionBar>,
    );
    const then = serialize(
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <LegacyButton label="Save" onPress={noop} fullWidth style={{ flex: 1 }} />
        <LegacyButton label="Send" onPress={noop} style={{ flex: 1 }} />
      </View>,
    );
    expect(now).toBe(then);
  });

  const CHIPS: FilterChip[] = [
    { value: 'all', label: 'All', count: 12 },
    { value: 'open', label: 'Open', count: 3 },
    { value: 'closed', label: 'Closed' },
    { value: 'late', label: 'Late', color: 'crimson' },
  ];
  const MANY: FilterChip[] = Array.from({ length: 15 }, (_, i) => ({ value: `p${i}`, label: `Project ${i}` }));
  it.each([
    ['plain', { chips: CHIPS, value: 'open' }],
    ['noPadding + testID', { chips: CHIPS, value: 'all', noPadding: true, testID: 'co-status-filter' }],
    ['scroll indicator shown', { chips: CHIPS, value: 'late', hideScrollIndicator: false }],
    ['15 chips (the desktop fold must not touch the phone)', { chips: MANY, value: 'p14' }],
  ])('FilterChipRow (%s) equals the pre-change rail', (_label, props) => {
    const now = serialize(<FilterChipRow onChange={noop} {...(props as { chips: FilterChip[]; value: string })} />);
    const then = serialize(<LegacyFilterChipRow onChange={noop} {...(props as { chips: FilterChip[]; value: string })} />);
    expect(now).toBe(then);
  });

  it('ActionBar = <View style={style}> with the children untouched', () => {
    const style = { flexDirection: 'row' as const, paddingHorizontal: 20, gap: 10 };
    const kids = (
      <>
        <ActionBarReadout><Text>Total $1,200</Text></ActionBarReadout>
        <TouchableOpacity style={{ flex: 1, minHeight: 48 }} onPress={noop} accessibilityRole="button"><Text>Save</Text></TouchableOpacity>
      </>
    );
    const plain = (
      <View style={style}>
        <Text>Total $1,200</Text>
        <TouchableOpacity style={{ flex: 1, minHeight: 48 }} onPress={noop} accessibilityRole="button"><Text>Save</Text></TouchableOpacity>
      </View>
    );
    expect(serialize(<ActionBar style={style}>{kids}</ActionBar>)).toBe(serialize(plain));
  });

  it('TileGrid = <View style={phoneStyle}> with the 47% tiles untouched', () => {
    const phoneStyle = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10 };
    const tile = { width: '47%' as const, minHeight: 56 };
    const tiles = [0, 1, 2].map((i) => <View key={i} style={tile}><Text>{`Tile ${i}`}</Text></View>);
    expect(serialize(<TileGrid preset="action" phoneStyle={phoneStyle}>{tiles}</TileGrid>)).toBe(
      serialize(<View style={phoneStyle}>{tiles}</View>),
    );
  });

  it('ChipRail = the hand-rolled horizontal ScrollView with its indicator hidden', () => {
    const row = { gap: 8, paddingHorizontal: 16 };
    const chips = ['A', 'B', 'C'].map((c) => <Text key={c}>{c}</Text>);
    expect(serialize(<ChipRail contentContainerStyle={row}>{chips}</ChipRail>)).toBe(
      serialize(<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={row}>{chips}</ScrollView>),
    );
  });

  it('useSheetFrame hands a phone only nulls, so [styles.sheet, f.card] is today’s sheet', () => {
    let frame: SheetFrame | null = null;
    function Probe() {
      frame = useSheetFrame('form', { visible: true, animationType: 'slide' });
      return null;
    }
    tree(<Probe />);
    const f = frame as unknown as SheetFrame;
    expect(f.overlay).toBeNull();
    expect(f.scrollContent).toBeNull();
    expect(f.card).toBeNull();
    expect(f.footer).toBeNull();
    expect(f.footerButton).toBeNull();
    // Wave 6c: the filler-touchable scrim is desktop-only too.
    expect(f.backdrop).toBeNull();
    expect(f.showHandle).toBe(true);
    expect(f.animationType).toBe('slide');
    expect(f.transparent).toBeUndefined();
    const sheet = { backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 };
    expect(StyleSheet.flatten([sheet, f.card])).toEqual(sheet);
  });

  it('SheetOverlay on a phone renders its children only — no wrapper node (wave 6c)', () => {
    let frame: SheetFrame | null = null;
    function Probe({ children }: { children?: React.ReactNode }) {
      frame = useSheetFrame('form', { visible: true, animationType: 'slide' });
      return <SheetOverlay frame={frame}>{children}</SheetOverlay>;
    }
    const kids = (
      <>
        <Pressable testID="scrim" style={{ flex: 1 }} onPress={() => {}} accessibilityRole="button" />
        <View testID="card" style={{ padding: 20 }} />
      </>
    );
    expect(serialize(<Probe>{kids}</Probe>)).toBe(serialize(kids));
    expect((frame as unknown as SheetFrame).isDesktop).toBe(false);
  });

  it('SheetScrim on a phone renders null — no host node (wave 6d)', () => {
    let frame: SheetFrame | null = null;
    function Probe() {
      frame = useSheetFrame('form', { visible: true, animationType: 'slide' });
      return <SheetScrim frame={frame} onPress={noop} />;
    }
    function Empty() {
      return null;
    }
    expect(serialize(<Probe />)).toBe(serialize(<Empty />));
    expect((frame as unknown as SheetFrame).isDesktop).toBe(false);
  });

  it('segmentedDesktop behind `isDesktop &&` drops out on a phone', () => {
    const isDesktop = false;
    const seg = { flex: 1, minHeight: 44 };
    expect(StyleSheet.flatten([seg, isDesktop && segmentedDesktop.segment])).toEqual(seg);
  });

  it('SegmentedControl and Sheet render and work on a phone', () => {
    const onChange = jest.fn();
    const r = render(
      <Wrap>
        <SegmentedControl
          testID="seg"
          value="punch"
          onChange={onChange}
          options={[{ value: 'punch', label: 'Punch' }, { value: 'crew', label: 'Crew list', count: 4 }]}
        />
        <Sheet visible onClose={noop} title="Edit task" primaryAction={{ label: 'Save', onPress: noop, disabled: true, disabledReason: 'Add a duration first.' }}>
          <Text>Body</Text>
        </Sheet>
      </Wrap>,
    );
    fireEvent.press(r.getByTestId('seg-crew'));
    expect(onChange).toHaveBeenCalledWith('crew');
    // Phone segments share the row (flex:1), exactly like the hand-rolled rows.
    expect(flat(r.getByTestId('seg-punch').props.style).flex).toBe(1);
    // A blocked button says why.
    expect(r.getByText('Add a duration first.')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('desktop (1512 web): the desktop rules', () => {
  beforeEach(desktopWeb);

  it('Button hugs its label; fullWidth caps at 400; desktop sizes', () => {
    const r = render(
      <Wrap>
        <Button label="Save" onPress={noop} testID="hug" />
        <Button label="Save" onPress={noop} fullWidth testID="full" size="lg" />
        <Button label="Go" onPress={noop} size="sm" testID="sm" containerStyle={{ marginTop: 4 }} />
      </Wrap>,
    );
    const hug = r.getByTestId('hug');
    const hugWrapper = flat(hostParent(hug).props.style);
    expect(hugWrapper.width).toBe('fit-content');
    expect(hugWrapper.maxWidth).toBe('100%');
    expect(flat(hug.props.style)).toMatchObject({ height: 40, paddingHorizontal: 20, minWidth: 96 });
    const full = r.getByTestId('full');
    expect(flat(hostParent(full).props.style)).toMatchObject({ width: '100%', maxWidth: 400 });
    expect(flat(full.props.style)).toMatchObject({ height: 48, paddingHorizontal: 24, minWidth: 120, width: '100%' });
    const sm = r.getByTestId('sm');
    expect(flat(sm.props.style)).toMatchObject({ height: 32, paddingHorizontal: 14, minWidth: 72 });
    expect(flat(hostParent(sm).props.style).marginTop).toBe(4);
  });

  it('ActionBar: inner row capped at the form column, children hug, fullWidth ignored, readout left', () => {
    const r = render(
      <Wrap>
        <ActionBar style={{ flexDirection: 'row', paddingHorizontal: 20 }} testID="bar">
          <ActionBarReadout><Text testID="total">Total $1,200</Text></ActionBarReadout>
          <>
            <Button label="Save to Project" onPress={noop} variant="secondary" fullWidth style={{ flex: 1 }} testID="save" />
          </>
          <Button label="Send" onPress={noop} style={{ flex: 1 }} testID="send" />
        </ActionBar>
      </Wrap>,
    );
    const bar = r.getByTestId('bar');
    const inner = bar.children[0] as unknown as { props: { style: unknown } };
    expect(flat(inner.props.style)).toMatchObject({ maxWidth: 760, alignSelf: 'center', justifyContent: 'flex-end', flexDirection: 'row' });
    for (const id of ['save', 'send']) {
      const b = r.getByTestId(id);
      expect(flat(b.props.style)).toMatchObject({ flexGrow: 0, flexShrink: 0, flexBasis: 'auto', minWidth: 120, maxWidth: 280, height: 40 });
      // fullWidth ignored inside the bar: the wrapper hugs, it does not fill.
      expect(flat(hostParent(b).props.style).width).toBe('fit-content');
      expect(flat(b.props.style).width).toBeUndefined();
    }
    expect(flat(hostParent(r.getByTestId('total')).props.style).flex).toBe(1);
  });

  it('TileGrid: columns from its own measured width; an orphan keeps the column width', () => {
    const r = render(
      <Wrap>
        <TileGrid preset="kpi" phoneStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 0 }} testID="grid">
          {[0, 1, 2, 3, 4].map((i) => <View key={i} testID={`t${i}`} style={{ width: '47%', flexGrow: 1 }} />)}
        </TileGrid>
      </Wrap>,
    );
    // First paint, before onLayout: the preset minimum.
    expect(flat(r.getByTestId('t0').props.style).width).toBe(220);
    act(() => {
      fireEvent(r.getByTestId('grid'), 'layout', { nativeEvent: { layout: { width: 1232, height: 300, x: 0, y: 0 } } });
    });
    for (const i of [0, 1, 2, 3, 4]) {
      // 4 columns of 299 — and the fifth (the orphan) is 299 too, not 1232.
      expect(flat(r.getByTestId(`t${i}`).props.style)).toMatchObject({ width: 299, flexGrow: 0, flexShrink: 0, flexBasis: 'auto' });
    }
    expect(flat(r.getByTestId('grid').props.style)).toMatchObject({ flexWrap: 'wrap', columnGap: 12, rowGap: 12 });
  });

  it('FilterChipRow wraps instead of scrolling, and folds an unbounded rail', () => {
    const many: FilterChip[] = Array.from({ length: 15 }, (_, i) => ({ value: `p${i}`, label: `Project ${i}` }));
    const r = render(
      <Wrap>
        <FilterChipRow chips={many} value="p14" onChange={noop} testID="rail" />
      </Wrap>,
    );
    expect(r.UNSAFE_queryAllByType(ScrollView)).toHaveLength(0);
    expect(flat(r.getByTestId('rail').props.style)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 });
    // 11 + the selected chip past the fold + "3 more".
    expect(r.queryByTestId('rail-p10')).toBeTruthy();
    expect(r.queryByTestId('rail-p11')).toBeNull();
    expect(r.queryByTestId('rail-p14')).toBeTruthy();
    expect(flat(r.getByTestId('rail-p0').props.style)).toMatchObject({ height: 32, maxWidth: 240 });
    fireEvent.press(r.getByText('3 more'));
    expect(r.queryByTestId('rail-p11')).toBeTruthy();
    expect(r.getByText('Show fewer')).toBeTruthy();
  });

  it('ChipRail wraps; mode="scroll" keeps a VISIBLE scrollbar', () => {
    const r = render(
      <Wrap>
        <ChipRail contentContainerStyle={{ paddingHorizontal: 16 }} testID="wrap"><Text>A</Text></ChipRail>
        <ChipRail mode="scroll" testID="canvas"><Text>B</Text></ChipRail>
      </Wrap>,
    );
    expect(flat(r.getByTestId('wrap').props.style)).toMatchObject({ flexWrap: 'wrap', paddingHorizontal: 16, gap: 8 });
    expect(r.getByTestId('canvas').props.showsHorizontalScrollIndicator).toBe(true);
  });

  it('SegmentedControl: top-left, intrinsic, capped; >6 options become underline tabs', () => {
    const r = render(
      <Wrap>
        <SegmentedControl testID="two" value="a" onChange={noop} options={[{ value: 'a', label: 'Punch' }, { value: 'b', label: 'Crew list' }]} />
        <SegmentedControl
          testID="many"
          value="o0"
          onChange={noop}
          options={Array.from({ length: 7 }, (_, i) => ({ value: `o${i}`, label: `Tab ${i}` }))}
        />
        <SegmentedControl testID="pct" variant="numeric" value="0" onChange={noop} options={['0', '25', '50', '75', '100'].map((v) => ({ value: v, label: v }))} />
      </Wrap>,
    );
    expect(flat(r.getByTestId('two').props.style)).toMatchObject({ alignSelf: 'flex-start', maxWidth: 640, flexGrow: 0 });
    expect(flat(r.getByTestId('two-b').props.style)).toMatchObject({ flexGrow: 0, flexShrink: 0, flexBasis: 'auto', minWidth: 88, maxWidth: 200, height: 32 });
    const tab = flat(r.getByTestId('many-o0').props.style);
    expect(tab.borderBottomWidth).toBe(2);
    expect(tab.backgroundColor).toBe('transparent');
    expect(tab.borderBottomColor).not.toBe('transparent');
    expect(flat(r.getByTestId('pct-25').props.style).width).toBe(56);
  });

  it('useSheetFrame: centred card at Layout.sheet[size], fade, no handle, transparent', () => {
    let frame: SheetFrame | null = null;
    function Probe() {
      frame = useSheetFrame('form', { visible: true, animationType: 'slide' });
      return null;
    }
    tree(<Probe />);
    const f = frame as unknown as SheetFrame;
    expect(f.card).toMatchObject({ maxWidth: 560, maxHeight: '85%', borderBottomLeftRadius: 18, padding: 24 });
    expect(f.overlay).toMatchObject({ justifyContent: 'center', alignItems: 'center' });
    // Wave 6c: the scrim covers the whole window; only the card is inset.
    expect(f.overlay?.marginLeft).toBeUndefined();
    expect(f.backdrop).toEqual({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 });
    expect(f.showHandle).toBe(false);
    expect(f.animationType).toBe('fade');
    expect(f.transparent).toBe(true);
  });

  it('SheetOverlay on desktop: one flex:1 View carrying the frame overlay around both children', () => {
    function Probe() {
      const f = useSheetFrame('form', { visible: true, animationType: 'slide' });
      return (
        <SheetOverlay frame={f}>
          <View testID="scrim" />
          <View testID="card" />
        </SheetOverlay>
      );
    }
    type Node = { type: string; props: { style?: unknown; testID?: string }; children?: Node[] | null };
    // The parent of the two children (below the test's SafeAreaProvider wrapper).
    const find = (n: Node | null | undefined): Node | null => {
      if (!n || typeof n !== 'object') return null;
      if (n.children?.some((c) => c?.props?.testID === 'scrim')) return n;
      for (const c of n.children ?? []) { const hit = find(c); if (hit) return hit; }
      return null;
    };
    const root = find(tree(<Probe />) as unknown as Node) as Node;
    expect(root.type).toBe('View');
    expect(flat(root.props.style)).toMatchObject({ flex: 1, justifyContent: 'center', alignItems: 'center' });
    expect((root.children ?? []).map((c) => c.props.testID)).toEqual(['scrim', 'card']);
  });

  it('SheetScrim on desktop: an absoluteFill Pressable in Colors.overlay (wave 6d)', () => {
    const onPress = jest.fn();
    function Probe() {
      const f = useSheetFrame('form', { visible: true, animationType: 'slide' });
      return <SheetScrim frame={f} onPress={onPress} label="Close sheet" />;
    }
    const r = render(<Wrap><Probe /></Wrap>);
    const scrim = r.getByLabelText('Close sheet');
    expect(scrim.props.accessibilityRole).toBe('button');
    expect(flat(scrim.props.style)).toEqual({
      backgroundColor: Colors.overlay, position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    });
    fireEvent.press(scrim);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Sheet: destructive far left, primary rightmost, card capped', () => {
    const r = render(
      <Wrap>
        <Sheet
          visible
          onClose={noop}
          title="Edit task"
          size="form"
          testID="sheet"
          destructiveAction={{ label: 'Delete', onPress: noop, testID: 'del' }}
          secondaryAction={{ label: 'Cancel', onPress: noop, testID: 'cancel' }}
          primaryAction={{ label: 'Save', onPress: noop, testID: 'save' }}
        >
          <Text>Body</Text>
        </Sheet>
      </Wrap>,
    );
    const ids = all(r.toJSON(), (n) => ['del', 'cancel', 'save'].includes(String(n.props?.testID))).map((n) => n.props.testID);
    expect(ids).toEqual(['del', 'cancel', 'save']);
    expect(flat(r.getByTestId('save').props.style)).toMatchObject({ minWidth: 104, height: 40 });
    const card = all(r.toJSON(), (n) => flat(n.props?.style).maxWidth === 560)[0];
    expect(card).toBeTruthy();
    expect(r.queryByText('Body')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round 2 ('slicker'): the commit morph. A Button whose loading/done never
// CHANGES renders the static tree; the morph arms only on a phase change.
// ─────────────────────────────────────────────────────────────────────────────
type HostInst = { type: unknown; parent: HostInst | null; props: Record<string, unknown> };
/** Every host ancestor of an instance, nearest first. */
function hostAncestors(n: unknown): HostInst[] {
  const out: HostInst[] = [];
  let p = (n as HostInst).parent;
  while (p) {
    if (typeof p.type === 'string') out.push(p);
    p = p.parent;
  }
  return out;
}
const a11yHidden = (n: { props: Record<string, unknown> }) =>
  n.props.accessibilityElementsHidden === true && n.props.importantForAccessibility === 'no-hide-descendants';

describe('the commit morph (round 2)', () => {
  it('phone loading at mount holds the width: label row hidden under an overlay spinner, no Animated layers', () => {
    phone();
    const r = render(<Wrap><Button label="Save" onPress={noop} loading testID="b" /></Wrap>);
    const row = hostParent(r.getByText('Save'));
    expect(flat(row.props.style)).toMatchObject({ flexDirection: 'row', opacity: 0 });
    const spinners = r.UNSAFE_getAllByType(ActivityIndicator);
    expect(spinners).toHaveLength(1);
    expect(flat(hostParent(spinners[0]).props.style)).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 });
    // Only the press-scale wrapper is animated: nothing armed at mount.
    expect(r.UNSAFE_queryAllByType(Animated.View)).toHaveLength(1);
    // Static a11y state, and the at-rest disabled fade.
    const b = r.getByTestId('b');
    expect(b.props.accessibilityState).toEqual({ disabled: true });
    expect(flat(b.props.style).opacity).toBe(0.5);
  });

  it('desktop loading at mount is unchanged: held-width row + overlay, 0.5 disabled, no busy, nothing armed', () => {
    desktopWeb();
    const r = render(<Wrap><Button label="Save" onPress={noop} loading testID="b" /></Wrap>);
    const b = r.getByTestId('b');
    expect(flat(b.props.style)).toMatchObject({ height: 40, paddingHorizontal: 20, minWidth: 96, opacity: 0.5 });
    expect(b.props.accessibilityState).toEqual({ disabled: true });
    expect(flat(hostParent(r.getByText('Save')).props.style)).toMatchObject({ flexDirection: 'row', opacity: 0 });
    expect(r.UNSAFE_getAllByType(ActivityIndicator)).toHaveLength(1);
    expect(r.UNSAFE_queryAllByType(Animated.View)).toHaveLength(1);
    // Same shape as the phone's static tree, which is today's desktop tree.
    const hidden = all(r.toJSON(), (n) => n.props?.accessibilityElementsHidden === true);
    expect(hidden).toHaveLength(0);
  });

  it('a phase change arms the morph: seeded from idle, spinner layer, full opacity, busy', () => {
    phone();
    const r = render(<Wrap><Button label="Save" onPress={noop} testID="b" /></Wrap>);
    expect(r.UNSAFE_queryAllByType(Animated.View)).toHaveLength(1);
    r.rerender(<Wrap><Button label="Save" onPress={noop} loading testID="b" /></Wrap>);
    const b = r.getByTestId('b');
    // styles.disabled (opacity 0.5) is dropped while morphing; the press is
    // still blocked by the Pressable's disabled prop.
    expect(flat(b.props.style).opacity).toBeUndefined();
    expect(b.props.accessibilityState).toEqual({ disabled: true, busy: true });
    // First armed frame = the idle frame: the label row starts at opacity 1.
    const row = hostParent(r.getByText('Save'));
    expect(flat(row.props.style).opacity).toBe(1);
    expect(a11yHidden(row)).toBe(false);
    const spinners = r.UNSAFE_getAllByType(ActivityIndicator);
    expect(spinners).toHaveLength(1);
    expect(a11yHidden(hostParent(spinners[0]))).toBe(true);
    expect(flat(hostParent(spinners[0]).props.style).opacity).toBe(0);
    // wrapper + teal tint (primary) + label row + spinner + check
    expect(r.UNSAFE_queryAllByType(Animated.View)).toHaveLength(5);
    // The tint, spinner and check layers are the ONLY a11y-hidden nodes.
    expect(all(r.toJSON(), (n) => n.props?.accessibilityElementsHidden === true)).toHaveLength(3);
  });

  it('mount loading → done arms from loading and shows the check; the label row stays readable', () => {
    phone();
    const r = render(<Wrap><Button label="Send" onPress={noop} variant="secondary" loading testID="b" /></Wrap>);
    r.rerender(<Wrap><Button label="Send" onPress={noop} variant="secondary" loading={false} done testID="b" /></Wrap>);
    const b = r.getByTestId('b');
    expect(b.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(flat(b.props.style).opacity).toBeUndefined();
    const label = r.getByText('Send');
    const row = hostParent(label);
    // Seeded from 'loading': the label is invisible, but still in the tree
    // and NOT hidden from VoiceOver anywhere up to the button.
    expect(flat(row.props.style).opacity).toBe(0);
    expect(hostAncestors(label).some((n) => a11yHidden(n))).toBe(false);
    // The check layer: a11y-hidden, absolute, scale seeded at 0.6 (secondary: no tint).
    const layers = all(r.toJSON(), (n) => n.props?.accessibilityElementsHidden === true);
    expect(layers).toHaveLength(2);
    const check = layers.find((n) => Array.isArray(flat(n.props.style).transform));
    expect(check).toBeTruthy();
    expect(flat(check!.props.style)).toMatchObject({ position: 'absolute', transform: [{ scale: 0.6 }] });
  });

  it('a Button that never changes phase is never armed (done=false, loading=false)', () => {
    phone();
    const r = render(<Wrap><Button label="Save" onPress={noop} testID="b" /></Wrap>);
    r.rerender(<Wrap><Button label="Save 2" onPress={noop} disabled testID="b" /></Wrap>);
    expect(r.UNSAFE_queryAllByType(Animated.View)).toHaveLength(1);
    expect(r.getByTestId('b').props.accessibilityState).toEqual({ disabled: true });
    expect(flat(r.getByTestId('b').props.style).opacity).toBe(0.5);
  });

  describe('useCommitFeedback', () => {
    let c!: ReturnType<typeof useCommitFeedback>;
    function Probe() {
      c = useCommitFeedback();
      return <Text testID="phase">{c.done ? 'done' : c.loading ? 'loading' : 'idle'}</Text>;
    }
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());
    const phaseOf = (r: ReturnType<typeof render>) => r.getByTestId('phase').props.children;

    it('resolve → done → idle after the 900 ms hold', async () => {
      const r = render(<Probe />);
      let release!: (v: number) => void;
      let result!: Promise<number | undefined>;
      act(() => {
        result = c.run(() => new Promise<number>((res) => { release = res; }));
      });
      expect(phaseOf(r)).toBe('loading');
      expect(c.busy).toBe(true);
      await act(async () => {
        release(7);
        await result;
      });
      await expect(result).resolves.toBe(7);
      expect(phaseOf(r)).toBe('done');
      expect(c.busy).toBe(true);
      act(() => { jest.advanceTimersByTime(899); });
      expect(phaseOf(r)).toBe('done');
      act(() => { jest.advanceTimersByTime(1); });
      expect(phaseOf(r)).toBe('idle');
      expect(c.busy).toBe(false);
    });

    it('reject → idle, and the error is rethrown', async () => {
      const r = render(<Probe />);
      let result!: Promise<unknown>;
      await act(async () => {
        result = c.run(() => Promise.reject(new Error('offline')));
        await result.catch(() => {});
      });
      await expect(result).rejects.toThrow('offline');
      expect(phaseOf(r)).toBe('idle');
      // …and the guard is released: the next run goes through.
      const work = jest.fn(() => Promise.resolve(1));
      await act(async () => { await c.run(work); });
      expect(work).toHaveBeenCalledTimes(1);
    });

    it('two run() calls in the same tick run the work ONCE', async () => {
      render(<Probe />);
      const work = jest.fn(() => Promise.resolve('ok'));
      let a!: Promise<string | undefined>;
      let b!: Promise<string | undefined>;
      await act(async () => {
        a = c.run(work);
        b = c.run(work);
        await Promise.all([a, b]);
      });
      expect(work).toHaveBeenCalledTimes(1);
      await expect(a).resolves.toBe('ok');
      await expect(b).resolves.toBeUndefined();
    });

    it('unmount mid-run: the work still resolves, nothing is set afterwards', async () => {
      const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const r = render(<Probe />);
        let release!: (v: string) => void;
        let result!: Promise<string | undefined>;
        act(() => {
          result = c.run(() => new Promise<string>((res) => { release = res; }));
        });
        r.unmount();
        await act(async () => {
          release('late');
          await result;
        });
        await expect(result).resolves.toBe('late');
        act(() => { jest.advanceTimersByTime(2000); });
        expect(errors).not.toHaveBeenCalled();
      } finally {
        errors.mockRestore();
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The pre-change components, verbatim from 480c8710 (renamed only). Do not
// "tidy" these: they are the phone baseline the tests above compare against.
// ─────────────────────────────────────────────────────────────────────────────

type LegacyButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type LegacyButtonSize = 'sm' | 'md' | 'lg';

interface LegacyButtonProps {
  label: string;
  onPress: () => void;
  variant?: LegacyButtonVariant;
  size?: LegacyButtonSize;
  disabled?: boolean;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const LEGACY_SIZE_MAP: Record<LegacyButtonSize, { height: number; px: number; fontSize: number }> = {
  sm: { height: 36, px: 16, fontSize: 13 },
  md: { height: Tokens.touchTarget.comfortable, px: 24, fontSize: 14 },
  lg: { height: 56, px: 28, fontSize: 15 },
};

function LegacyButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  iconLeft,
  iconRight,
  fullWidth = false,
  style,
  testID,
}: LegacyButtonProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(legacyButtonStyles);
  const scale = useRef(new Animated.Value(1)).current;

  const sz = LEGACY_SIZE_MAP[size];
  const isDisabled = disabled || loading;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
      ...Tokens.motion.spring.snap,
    }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      ...Tokens.motion.spring.snap,
    }).start();
  };
  const handlePress = () => {
    if (Platform.OS === 'ios') {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress();
  };

  const containerStyle: StyleProp<ViewStyle> = [
    styles.base,
    styles[variant],
    { height: sz.height, paddingHorizontal: sz.px },
    fullWidth && styles.fullWidth,
    isDisabled && styles.disabled,
    style,
  ];

  const textColor =
    variant === 'primary' || variant === 'destructive'
      ? '#FFFFFF'
      : colors.text;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDisabled}
        style={containerStyle}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
      >
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <View style={styles.row}>
            {iconLeft ? <View style={styles.iconLeft}>{iconLeft}</View> : null}
            <Text style={[styles.label, { fontSize: sz.fontSize, color: textColor }]}>
              {label}
            </Text>
            {iconRight ? <View style={styles.iconRight}>{iconRight}</View> : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const legacyButtonStyles = (t: ThemeColors) =>
  StyleSheet.create({
    base: {
      borderRadius: Tokens.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      ...Tokens.continuousCorners,
    },
    primary: {
      // White label sits on this fill (textColor === '#FFFFFF' above), so the
      // fill must clear 4.5:1 for white — brand accent #FF6A1A is only 2.87:1.
      // accentFill (#BC440C, white 5.29:1) is the accessible button fill; the
      // brand hue still reads (HSL 19°). Shadow stays the brighter accent — a
      // shadow carries no text, so the 4.5:1 rule does not apply to it.
      backgroundColor: t.accentFill,
      shadowColor: t.accent,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 4,
    },
    secondary: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
    },
    ghost: {
      backgroundColor: 'transparent',
    },
    destructive: {
      backgroundColor: t.danger,
    },
    fullWidth: { width: '100%' },
    disabled: { opacity: 0.5 },
    label: {
      fontWeight: '600' as const,
      letterSpacing: -0.15,
    },
    row: { flexDirection: 'row', alignItems: 'center' },
    iconLeft: { marginRight: 8 },
    iconRight: { marginLeft: 8 },
  });


interface LegacyFilterChip<T extends string = string> {
  /** Stable identifier — what gets passed back via onChange. */
  value: T;
  /** Visible label. Keep short ("All", "Open", "Last 30d", "$5k+"). */
  label: string;
  /** Optional count to render inside the chip ("Open · 3"). */
  count?: number;
  /** Optional accent color override for selected state. Defaults to theme accent. */
  color?: string;
}

interface LegacyFilterChipRowProps<T extends string = string> {
  chips: LegacyFilterChip<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Hide the horizontal scroll indicator. Default true. */
  hideScrollIndicator?: boolean;
  /** Render with no horizontal padding (caller controls spacing). */
  noPadding?: boolean;
  testID?: string;
}

function LegacyFilterChipRow<T extends string = string>({
  chips,
  value,
  onChange,
  hideScrollIndicator = true,
  noPadding = false,
  testID,
}: LegacyFilterChipRowProps<T>) {
  const { colors } = useTheme();
  const styles = useThemedStyles(legacyChipStyles);

  const handlePress = useCallback((next: T) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    onChange(next);
  }, [onChange]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={!hideScrollIndicator}
      contentContainerStyle={[styles.row, noPadding && { paddingHorizontal: 0 }]}
      testID={testID}
    >
      {chips.map(chip => {
        const selected = chip.value === value;
        const accent = chip.color ?? colors.accent;
        return (
          <TouchableOpacity
            key={chip.value}
            onPress={() => handlePress(chip.value)}
            style={[
              styles.chip,
              selected && {
                backgroundColor: accent + '18',
                borderColor: accent,
              },
            ]}
            activeOpacity={0.7}
            testID={`${testID ?? 'chip'}-${chip.value}`}
          >
            <Text style={[styles.label, { color: selected ? accent : colors.textSecondary }]}>
              {chip.label}
            </Text>
            {chip.count !== undefined && (
              <View style={[styles.countBubble, selected && { backgroundColor: accent + '33' }]}>
                <Text style={[styles.countText, { color: selected ? accent : colors.textSecondary }]}>
                  {chip.count}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const legacyChipStyles = (t: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row' as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center' as const,
  },
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  label: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
  },
  countBubble: {
    backgroundColor: t.line,
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  countText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
  },
});
