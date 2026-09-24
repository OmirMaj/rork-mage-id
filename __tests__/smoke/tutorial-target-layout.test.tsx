/**
 * Render diff — a tutorial wrapper changes nothing a user can see.
 *
 * The tutorials (utils/tutorial) spotlight REAL controls by wrapping them:
 *
 *   <TutorialTarget id="punch.save"><TouchableOpacity testID="walk-save" …/></TutorialTarget>
 *
 * The wrapper is a real View in the layout (a measurable native node is the
 * point of it), and tsc cannot see layout drift. So this mounts the three
 * wave-A screens that carry wrappers — the daily report, the punch walk and
 * the project hub — inside the REAL app (mountRoute: the real _layout, the
 * real providers, the populated world) twice:
 *
 *   OLD — every <TutorialTarget> renders what the source had before it: its
 *         children in place (or, where the wrapper REPLACED a styled View —
 *         PlanPinStep's flex:2 Next cell — that same View). Every
 *         <TutorialScrollAnchor> renders its children in place.
 *   NEW — the real <TutorialTarget>, and the anchor's View.
 *
 * and asserts:
 *   (a) NEW with each unstyled wrapper spliced out (and each styled one reduced
 *       to its style) is the OLD tree, node for node, prop for prop — so the
 *       wrappers are the ONLY difference;
 *   (b) every unstyled wrapper is layout-neutral where it sits: the wrapped
 *       child carries no style that resolves against its PARENT (flex*,
 *       absolute position, a % height; alignSelf and a % width too, unless
 *       the parent is a stretching column, where the wrapper spans exactly
 *       the parent's content width and they land in the same box) — those
 *       would now resolve against the wrapper — and the parent is not a row
 *       that stretches its children on the cross axis (the wrapper would
 *       stretch, the child not).
 *   (c) the wrappers it expected are actually there (a diff of zero wrappers
 *       proves nothing);
 *   (d) nothing tutorial-only renders while no tutorial runs: no sample chip
 *       and no blocker sentinel. (The diff cannot see these — a chip lives
 *       INSIDE its wrapper, so OLD renders it too, and a childless sentinel
 *       splices to nothing — so they are looked for by name.)
 *
 * Idle state only: that is the state every user is in almost all the time.
 */

import { primeWorld, mountRouteChecked } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { StyleSheet } from 'react-native';
import { cleanup } from '@testing-library/react-native';

type Mode = 'old' | 'new';
const g = globalThis as unknown as { __TT_MODE?: Mode };

jest.mock('@/components/tutorial/TutorialTarget', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const actual = jest.requireActual<typeof import('@/components/tutorial/TutorialTarget')>('@/components/tutorial/TutorialTarget');
  function TutorialTarget(props: import('@/components/tutorial/TutorialTarget').TutorialTargetProps) {
    const mode = (globalThis as { __TT_MODE?: string }).__TT_MODE;
    const hasChildren = React.Children.count(props.children) > 0;
    if (mode === 'old') {
      if (!hasChildren) return null; // a blocker sentinel did not exist before
      // A row-only wrapper (the desktop hub tile) did not replace a View: the
      // tile sat in the grid directly. See rowOnlyStyle.
      const { StyleSheet: SS } = jest.requireActual<typeof import('react-native')>('react-native');
      const st = (SS.flatten(props.style) ?? {}) as Record<string, unknown>;
      const rowOnly = Object.keys(st).length === 1 && st.flexDirection === 'row';
      return props.style && !rowOnly
        ? React.createElement(View, { style: props.style }, props.children)
        : React.createElement(React.Fragment, null, props.children);
    }
    // The real wrapper, tagged so the diff can find it.
    return React.createElement(actual.TutorialTarget, { ...props, testID: `__tt:${props.id}` });
  }
  return { __esModule: true, TutorialTarget, default: TutorialTarget };
});

jest.mock('@/components/tutorial/TutorialScrollAnchor', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const actual = jest.requireActual<typeof import('@/components/tutorial/TutorialScrollAnchor')>('@/components/tutorial/TutorialScrollAnchor');
  function TutorialScrollAnchor(props: { children: React.ReactNode; style?: import('react-native').StyleProp<import('react-native').ViewStyle>; scrollRef: unknown }) {
    const mode = (globalThis as { __TT_MODE?: string }).__TT_MODE;
    if (mode === 'old') return React.createElement(React.Fragment, null, props.children);
    // The anchor's own render is Provider > View(collapsable={false}, style).
    // Its context only feeds target registration; the View is the layout
    // fact, reproduced here with a tag the diff can find.
    return React.createElement(View, { collapsable: false, style: props.style, testID: '__anchor' }, props.children);
  }
  return { __esModule: true, TutorialScrollAnchor, default: TutorialScrollAnchor, useTutorialScrollAnchor: actual.useTutorialScrollAnchor };
});

type J = { type: string; props: Record<string, unknown>; children: (J | string)[] | null };
type Node = J | string;

interface WrapperFact {
  tag: string;
  styled: boolean;
  /** Style is exactly { flexDirection: 'row' }: a NEW wrapper whose only job
   *  is to keep stretching its child on the cross axis inside a stretching
   *  row (the desktop hub grid). Spliced out like an unstyled wrapper; (b)
   *  holds it to its own rule. */
  rowOnly?: boolean;
  parentStyle: Record<string, unknown>;
  childStyles: Record<string, unknown>[];
  siblings: number;
}

const flat = (st: unknown): Record<string, unknown> => (StyleSheet.flatten(st as never) ?? {}) as Record<string, unknown>;

/** Functions differ per render by identity, and the native stack mints a
 *  random screenId per mount; neither is layout. */
function cleanProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) out[k] = typeof v === 'function' ? '[fn]' : k === 'screenId' ? '[id]' : v;
  return out;
}

function isTag(n: J): boolean {
  return typeof n.props?.testID === 'string'
    && ((n.props.testID as string).startsWith('__tt:') || n.props.testID === '__anchor');
}

/** Splice the tagged wrappers out, recording where each one sat. */
function norm(n: Node, facts: WrapperFact[] | null, parent: J | null): Node[] {
  if (typeof n === 'string') return [n];
  const kids: Node[] = [];
  for (const c of n.children ?? []) kids.push(...norm(c, facts, n));
  if (isTag(n)) {
    const style = flat(n.props.style);
    const rowOnly = Object.keys(style).length === 1 && style.flexDirection === 'row';
    const styled = Object.keys(style).length > 0 && !rowOnly;
    facts?.push({
      tag: n.props.testID as string,
      styled,
      rowOnly,
      parentStyle: parent ? flat(parent.props.style) : {},
      childStyles: (n.children ?? []).filter((c): c is J => typeof c !== 'string').map(c => flat(c.props.style)),
      siblings: parent?.children?.length ?? 1,
    });
    if (kids.length === 0) return [];
    if (!styled) return kids;
    return [{ type: n.type, props: { style: n.props.style }, children: kids }];
  }
  return [{ type: n.type, props: cleanProps(n.props), children: kids.length ? kids : null }];
}

/** Every testID in a rendered tree. */
function testIds(n: Node, out: string[] = []): string[] {
  if (typeof n === 'string') return out;
  if (typeof n.props?.testID === 'string') out.push(n.props.testID as string);
  for (const c of n.children ?? []) testIds(c, out);
  return out;
}

// The tutorial-only nodes: the sample chips (shown only during their step, on
// the sample) and every childless target (blocker sentinels, the pin marker).
const IDLE_FORBIDDEN = /^(dfr-sample-note|walk-sample-photo|walk-sample-line)$|^__tt:.*\.modalUp$|^__tt:punch\.pinMarker$/;

function toJ(tree: { toJSON: () => unknown }): Node[] {
  const j = tree.toJSON() as Node | Node[] | null;
  if (!j) return [];
  return Array.isArray(j) ? j : [j];
}

async function render(url: string, mode: Mode) {
  g.__TT_MODE = mode;
  await primeWorld('populated');
  return mountRouteChecked(url);
}

// Main-axis and out-of-flow props always resolve against the wrapper now.
const ALWAYS_PARENT_RELATIVE = ['flex', 'flexGrow', 'flexShrink', 'flexBasis'] as const;

function neutralityProblems(facts: WrapperFact[]): string[] {
  const out: string[] = [];
  for (const f of facts) {
    if (f.styled) continue; // a styled wrapper IS the old View (checked by the diff)
    const dir = f.parentStyle.flexDirection;
    const align = f.parentStyle.alignItems;
    const parentIsRow = dir === 'row' || dir === 'row-reverse';
    const stretches = align === undefined || align === 'stretch';
    if (f.rowOnly) {
      // Neutral only where it is needed: the parent stretches its items on
      // the cross axis (a row with align stretch), the wrapper is stretched,
      // and as a row it stretches the child to the same height the child had
      // as the grid item. Its width is the child's content width, as before —
      // unless the child has a main-axis flex prop or a % size to resolve
      // against it instead of the grid.
      if (!(parentIsRow && stretches)) out.push(`${f.tag}: row wrapper outside a stretching row`);
      for (const cs of f.childStyles) {
        for (const k of ALWAYS_PARENT_RELATIVE) if (cs[k] !== undefined) out.push(`${f.tag}: child has ${k}=${String(cs[k])}`);
        if (cs.position === 'absolute') out.push(`${f.tag}: child is absolutely positioned`);
        if (cs.alignSelf !== undefined) out.push(`${f.tag}: child has alignSelf=${String(cs.alignSelf)}`);
        for (const k of ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight']) {
          if (typeof cs[k] === 'string' && (cs[k] as string).endsWith('%')) out.push(`${f.tag}: child ${k} is a percentage`);
        }
      }
      continue;
    }
    // An unstyled wrapper in a stretching COLUMN spans exactly the parent's
    // content width, so the cross-axis props a child resolves against its
    // container — alignSelf, a % width — land in the same box as before.
    const crossAxisSame = !parentIsRow && stretches;
    for (const cs of f.childStyles) {
      for (const k of ALWAYS_PARENT_RELATIVE) if (cs[k] !== undefined) out.push(`${f.tag}: child has ${k}=${String(cs[k])}`);
      if (cs.position === 'absolute') out.push(`${f.tag}: child is absolutely positioned`);
      if (!crossAxisSame && cs.alignSelf !== undefined) out.push(`${f.tag}: child has alignSelf=${String(cs.alignSelf)}`);
      const pctKeys = crossAxisSame ? ['height', 'minHeight', 'maxHeight'] : ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'];
      for (const k of pctKeys) {
        if (typeof cs[k] === 'string' && (cs[k] as string).endsWith('%')) out.push(`${f.tag}: child ${k} is a percentage`);
      }
    }
    if (parentIsRow && stretches && f.siblings > 1) {
      out.push(`${f.tag}: parent is a stretching row (the wrapper would stretch, the child would not)`);
    }
  }
  return out;
}

const SCREENS: { name: string; url: string; expect: string[] }[] = [
  {
    name: 'daily report',
    url: `/daily-report?projectId=${PROJECT_ID}`,
    expect: ['__tt:dfr.voice', '__tt:dfr.saveDraft', '__tt:dfr.workPerformed', '__anchor'],
  },
  {
    name: 'punch walk',
    url: `/punch-walk?projectId=${PROJECT_ID}`,
    expect: ['__tt:punch.back', '__tt:punch.description', '__tt:punch.camera', '__tt:punch.save', '__anchor'],
  },
  {
    name: 'project hub',
    url: `/project-detail?id=${PROJECT_ID}`,
    expect: ['__tt:hub.group.field', '__tt:hub.tile.dailyReports', '__tt:hub.tile.punchList', '__anchor'],
  },
];

describe('tutorial wrappers are layout-neutral (render diff, idle)', () => {
  afterAll(() => { delete g.__TT_MODE; });

  it.each(SCREENS)('$name: the wrappers are the only difference', async ({ url, expect: expected }) => {
    const oldTree = await render(url, 'old');
    const oldJ = toJ(oldTree).flatMap(n => norm(n, null, null));
    cleanup();

    const newTree = await render(url, 'new');
    const facts: WrapperFact[] = [];
    const rawNew = toJ(newTree);
    const newJ = rawNew.flatMap(n => norm(n, facts, null));

    // (d) nothing tutorial-only at idle.
    expect(rawNew.flatMap(n => testIds(n)).filter(id => IDLE_FORBIDDEN.test(id))).toEqual([]);

    // (c) the wrappers are really there.
    const tags = new Set(facts.map(f => f.tag));
    for (const t of expected) expect(tags.has(t) ? t : `missing ${t}`).toBe(t);

    // (a) node for node, prop for prop.
    expect(newJ).toEqual(oldJ);

    // (b) and where each unstyled wrapper sits, it cannot move anything.
    expect(neutralityProblems(facts)).toEqual([]);
  });

  // Desktop (integration review): the hub's tile body is a row-wrap grid that
  // stretches its items, so an unstyled wrapper would have let each tile keep
  // its own height. The desktop wrappers are row-only; this runs the same
  // diff and neutrality rule at a desktop window.
  it('project hub at a desktop window (1512 x 982): the tile wrappers are neutral in the grid', async () => {
    const { Dimensions } = jest.requireActual<typeof import('react-native')>('react-native');
    const size = { width: 1512, height: 982, scale: 2, fontScale: 1 };
    const spy = jest.spyOn(Dimensions, 'get').mockReturnValue(size);
    try {
      const url = `/project-detail?id=${PROJECT_ID}`;
      const oldTree = await render(url, 'old');
      const oldJ = toJ(oldTree).flatMap(n => norm(n, null, null));
      cleanup();
      const newTree = await render(url, 'new');
      const facts: WrapperFact[] = [];
      const newJ = toJ(newTree).flatMap(n => norm(n, facts, null));
      const tiles = facts.filter(f => f.tag.startsWith('__tt:hub.tile.'));
      expect(tiles.length).toBeGreaterThan(0);
      // Really the desktop grid: every tile wrapper is row-only, in a row-wrap parent.
      expect(tiles.filter(f => !f.rowOnly || f.parentStyle.flexWrap !== 'wrap').map(f => f.tag)).toEqual([]);
      expect(newJ).toEqual(oldJ);
      expect(neutralityProblems(facts)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('the row-only rule flags a row wrapper where it is not needed, and a child that resolves against it', () => {
    expect(neutralityProblems([
      { tag: 'r1', styled: false, rowOnly: true, parentStyle: { flexDirection: 'row', flexWrap: 'wrap' }, childStyles: [{}], siblings: 5 },
      { tag: 'r2', styled: false, rowOnly: true, parentStyle: {}, childStyles: [{}], siblings: 2 },
      { tag: 'r3', styled: false, rowOnly: true, parentStyle: { flexDirection: 'row' }, childStyles: [{ flexGrow: 1 }], siblings: 2 },
    ])).toEqual([
      'r2: row wrapper outside a stretching row',
      'r3: child has flexGrow=1',
    ]);
  });

  // The rule in (b) is only as good as its detector: prove it flags the
  // drifts it exists for, and passes the one case that is provably the same box.
  it('the neutrality rule flags a flex child, a stretching row, and cross-axis props outside a stretching column', () => {
    expect(neutralityProblems([
      { tag: 'a', styled: false, parentStyle: {}, childStyles: [{ flex: 1 }], siblings: 1 },
      { tag: 'b', styled: false, parentStyle: { flexDirection: 'row' }, childStyles: [{}], siblings: 2 },
      { tag: 'c', styled: false, parentStyle: { flexDirection: 'row', alignItems: 'center' }, childStyles: [{ padding: 4 }], siblings: 3 },
      // alignSelf / % width in a stretching column: same box, allowed …
      { tag: 'd', styled: false, parentStyle: {}, childStyles: [{ alignSelf: 'center', width: '50%' }], siblings: 4 },
      // … but not in a centring column, and never a % height.
      { tag: 'e', styled: false, parentStyle: { alignItems: 'center' }, childStyles: [{ alignSelf: 'stretch', height: '10%' }], siblings: 2 },
    ])).toEqual([
      'a: child has flex=1',
      'b: parent is a stretching row (the wrapper would stretch, the child would not)',
      'e: child has alignSelf=stretch',
      'e: child height is a percentage',
    ]);
  });
});
