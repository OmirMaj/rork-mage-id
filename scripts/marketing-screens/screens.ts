// scripts/marketing-screens/screens.ts: what gets shot.
import type { WorldOptions } from './world';

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
];
