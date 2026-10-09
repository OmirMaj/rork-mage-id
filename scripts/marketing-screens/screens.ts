// scripts/marketing-screens/screens.ts: what gets shot.
import type { WorldOptions } from './world';
import { P, PORTAL_ID } from './world';

export type Selector = { testID?: string; text?: string; label?: string; css?: string; exact?: boolean; nth?: number };
export type Step =
  | { wait: number }
  | { click: Selector; then?: number }
  | { type: Selector; value: string }
  | { scroll: number; to?: Selector; block?: 'start' | 'center' | 'end' }
  | { js: string };

export interface Shot {
  steps?: Step[];
  world?: WorldOptions;
  theme?: 'light' | 'dark';
  settle?: number;
  /** Glyph colour of the status bar when the app's header is not the theme's page colour. */
  statusBar?: 'light' | 'dark';
  noStatusBar?: boolean;
}

export interface Screen {
  id: string;
  set: 'shipped' | 'in-testing';
  title: string;
  about: string;
  plan: 'Free' | 'Pro' | 'Business';
  source: string;
  route: string;
  world?: WorldOptions;
  settle?: number;
  steps?: Step[];
  shot?: Shot;
  sequence?: Shot[];
  dark?: boolean;
}

export const SCREENS: Screen[] = [
  { id: 'home', set: 'shipped', title: 'Home', about: 'The Home tab with the contractor\'s jobs.', plan: 'Free', source: 'app/(tabs)/(home)/index.tsx', route: '/' },
  ...(['project-detail?id=' + P.alder, 'daily-report?projectId=' + P.alder, 'punch-list?projectId=' + P.alder, 'change-order?projectId=' + P.alder, 'change-order?projectId=' + P.alder + '&coId=e5e00000-0000-4000-8000-000000000002', 'invoice?projectId=' + P.alder, 'aia-pay-app?projectId=' + P.alder, 'client-view?portalId=' + PORTAL_ID, 'schedule?projectId=' + P.alder, 'schedule-pro?projectId=' + P.alder, 'estimate', 'estimate/full?projectId=' + P.alder, 'construction-ai', 'ask', 'estimate-wizard?projectId=' + P.birch, 'summary'] as const).map((r, i) => ({ id: 'x' + i, set: 'shipped' as const, title: r, about: '', plan: 'Free' as const, source: '', route: '/' + r })),
];
