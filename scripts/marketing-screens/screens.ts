// scripts/marketing-screens/screens.ts: what gets shot.
import type { WorldOptions } from './world';
import { P, PORTAL_ID } from './world';

export type Selector = { testID?: string; text?: string; label?: string; css?: string; exact?: boolean; nth?: number };
export type Step =
  | { wait: number }
  | { click: Selector; then?: number }
  | { type: Selector; value: string }
  | { scroll: number; to?: Selector }
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
  /** Open this route first, then go to `route` from it (gives the header its back button). */
  via?: string;
  world?: WorldOptions;
  settle?: number;
  steps?: Step[];
  shot?: Shot;
  sequence?: Shot[];
  dark?: boolean;
}

export const SCREENS: Screen[] = [
  { id: 'home', set: 'shipped', title: 'Home', about: 'The Home tab with the contractor\'s jobs.', plan: 'Free', source: 'app/(tabs)/(home)/index.tsx', route: '/' },
  { id: 'projects', set: 'shipped', title: 'Projects', about: '', plan: 'Free', source: 'app/(tabs)/(home)/index.tsx', route: '/', steps: [{ scroll: 118, to: { text: 'Construction', exact: false } }] },
  { id: 'summary', set: 'shipped', title: 'Summary', about: '', plan: 'Free', source: 'app/(tabs)/summary/index.tsx', route: '/summary' },
  { id: 'project', set: 'shipped', title: 'Project', about: '', plan: 'Free', source: 'app/project-detail.tsx', route: '/project-detail?id=' + P.alder },
  { id: 'estimate', set: 'shipped', title: 'Estimate', about: '', plan: 'Free', source: 'app/project-detail.tsx', route: '/project-detail?id=' + P.alder + '&tile=linkedEstimate' },
  { id: 'schedule', set: 'shipped', title: 'Schedule', about: '', plan: 'Free', source: 'app/(tabs)/schedule/index.tsx', route: '/schedule?projectId=' + P.alder, steps: [{ click: { text: 'Timeline' } }, { click: { text: 'Fit' } }, { scroll: 118, to: { text: 'Timeline' } }] },
  { id: 'daily-report', set: 'shipped', title: 'Daily Report', about: '', plan: 'Free', source: 'app/daily-report.tsx', route: '/daily-report?projectId=' + P.alder + '&reportId=07e00000-0000-4000-8000-000000000001', steps: [{ scroll: 118, to: { text: 'DAILY REPORT' } }] },
  { id: 'punch-list', set: 'shipped', title: 'Punch List', about: '', plan: 'Business', source: 'app/punch-list.tsx', route: '/punch-list?projectId=' + P.alder, via: '/', steps: [{ scroll: 120, to: { text: 'By Location' } }] },
  { id: 'change-order', set: 'shipped', title: 'Change Order', about: '', plan: 'Pro', source: 'app/change-order.tsx', route: '/change-order?projectId=' + P.alder + '&coId=e5e00000-0000-4000-8000-000000000002', via: '/', steps: [{ scroll: 118, to: { text: 'Share PDF' } }] },
  { id: 'invoice', set: 'shipped', title: 'Invoice', about: '', plan: 'Pro', source: 'app/invoice.tsx', route: '/invoice?projectId=' + P.alder + '&invoiceId=f6e00000-0000-4000-8000-000000000001', via: '/' },
  { id: 'pay-app', set: 'shipped', title: 'Pay Application', about: '', plan: 'Pro', source: 'app/aia-pay-app.tsx', route: '/aia-pay-app?projectId=' + P.alder, steps: [{ click: { text: 'I Understand' } }] },
  { id: 'client-portal', set: 'shipped', title: 'Client Portal', about: '', plan: 'Pro', source: 'app/client-view.tsx', route: '/client-view?portalId=' + PORTAL_ID, shot: { statusBar: 'light' } },
];
