// scripts/marketing-screens/screens.ts: what gets shot.
//
// Every entry is a real route of the app. `set: 'shipped'` is only for things a
// paying user can reach today (constants/featureFlags.ts, utils/featureTiers.ts).
// `set: 'in-testing'` is for features that are switched off today: those are
// shot from the second build (build.sh in-testing) and may only be shown under
// an "In Testing" label.
//
// `about` is one plain sentence saying what the screen is. No promises.
import type { WorldOptions } from './world';
import { P, PORTAL_ID, AI_CODE_CHECK, co2, estimateWith, todayReport, TODAY_WORK, TODAY_MATERIAL } from './world';

export type Selector = { testID?: string; text?: string; label?: string; css?: string; exact?: boolean; nth?: number };
export type Step =
  | { wait: number }
  | { click: Selector; then?: number }
  | { type: Selector; value: string }
  /** To an element (its top lands `scroll` px from the top of the screen), or the main list to an offset. */
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
  /** A different route for this frame; the screen's own steps are then not run. */
  route?: string;
  /** What this frame of a sequence shows (manifest). */
  caption?: string;
}

export interface Screen {
  id: string;
  set: 'shipped' | 'in-testing';
  title: string;
  about: string;
  plan: 'Free' | 'Pro' | 'Business';
  source: string;
  route: string;
  /** Open this route first, then go to `route` from it. */
  via?: string;
  world?: WorldOptions;
  settle?: number;
  steps?: Step[];
  shot?: Shot;
  sequence?: Shot[];
  /** Also shoot the dark theme as <id>-dark. */
  dark?: boolean;
}

const CO2 = 'e5e00000-0000-4000-8000-000000000002';
const INVOICE1 = 'f6e00000-0000-4000-8000-000000000001';
const REPORT_YESTERDAY = '07e00000-0000-4000-8000-000000000001';
const withCo2 = (status: 'draft' | 'submitted' | 'approved'): WorldOptions => ({ patch: (d) => { d.mageid_change_orders = (d.mageid_change_orders as { id: string }[]).map((c) => (c.id === CO2 ? co2(status) : c)); } });
const withLines = (n: number): WorldOptions => ({ patch: (d) => { const ps = d.mageid_projects as { id: string; linkedEstimate: unknown }[]; ps[0] = { ...ps[0]!, linkedEstimate: estimateWith(n) }; d.mageid_change_orders = []; d.mageid_invoices = []; } });
const withTodayFiled: WorldOptions = { patch: (d) => { d.mageid_daily_reports = [todayReport, ...(d.mageid_daily_reports as unknown[])]; } };

const alder = (path: string, more = '') => `/${path}?projectId=${P.alder}${more}`;
const coRoute = alder('change-order', `&coId=${CO2}`);
const coTop: Step[] = [{ scroll: 150, to: { text: 'Share PDF' } }, { wait: 1500 }];
const replay: Step[] = [{ click: { testID: 'living-model-tabs-replay' }, then: 1800 }];
const times = (n: number, testID: string): Step[] => Array.from({ length: n }, () => ({ click: { testID }, then: 350 }));
const toTop: Step[] = [{ scroll: 0 }, { wait: 1500 }];
const scanOpen: Step[] = [{ click: { text: 'Hall Bath' }, then: 1200 }];

export const SCREENS: Screen[] = [
  // ── Shipped ───────────────────────────────────────────────────────────────
  { id: 'home', set: 'shipped', title: 'Home', plan: 'Free', source: 'app/(tabs)/(home)/index.tsx', route: '/', dark: true,
    about: 'The Home tab: the morning brief, what needs attention, and the inbox.' },
  { id: 'projects', set: 'shipped', title: 'Your Projects', plan: 'Free', source: 'app/(tabs)/(home)/index.tsx', route: '/',
    about: 'The job cards on the Home tab, each with its stage, size and estimate total.',
    steps: [{ scroll: 118, to: { text: 'Construction', exact: false } }, { wait: 1200 }] },
  { id: 'summary', set: 'shipped', title: 'Summary', plan: 'Free', source: 'app/(tabs)/summary/index.tsx', route: '/summary', dark: true,
    about: 'The Summary tab: who is on site today, the week ahead, contract and outstanding money, and what needs you.' },
  { id: 'project', set: 'shipped', title: 'Project Page', plan: 'Free', source: 'app/project-detail.tsx', route: `/project-detail?id=${P.alder}`,
    about: 'One job\'s page: the quick actions, projected margin from the estimate, and the job\'s open items.' },
  { id: 'estimate', set: 'shipped', title: 'Estimate', plan: 'Free', source: 'app/project-detail.tsx', route: `/project-detail?id=${P.alder}&tile=linkedEstimate`,
    about: 'The job\'s estimate: each line with its quantity, markup and total, and the estimate total at the top.',
    sequence: [
      { world: withLines(3), caption: 'Three lines in.' },
      { world: withLines(6), caption: 'Six lines in.' },
      { caption: 'All ten lines, with the estimate total.' },
    ] },
  { id: 'estimate-wizard', set: 'shipped', title: 'Quick Estimate', plan: 'Pro', source: 'app/estimate-wizard.tsx', route: `/estimate-wizard?projectId=${P.birch}`,
    about: 'The first of the Quick Estimate wizard\'s eight questions, which feed an AI draft of the estimate.' },
  { id: 'schedule', set: 'shipped', title: 'Schedule', plan: 'Free', source: 'app/(tabs)/schedule/index.tsx', route: `/schedule?projectId=${P.alder}`,
    about: 'The phone schedule: this week, tomorrow\'s lineup, and the task list by phase.' },
  { id: 'schedule-timeline', set: 'shipped', title: 'Schedule Timeline', plan: 'Free', source: 'app/(tabs)/schedule/index.tsx', route: `/schedule?projectId=${P.alder}`,
    about: 'The same schedule as a timeline, with the links between tasks and a line at today.',
    steps: [{ click: { text: 'Timeline' } }, { click: { text: 'Fit' } },
      // The timeline is its own small scrolling pane on the phone: bring the work that is under way into it.
      { js: `const pane = [...document.querySelectorAll('div')].filter((d) => /auto|scroll/.test(getComputedStyle(d).overflowY) && d.scrollHeight > d.clientHeight + 200 && d.getBoundingClientRect().top > 400)[0]; if (pane) pane.scrollTop = 330;` }, { wait: 1500 }] },
  { id: 'daily-report', set: 'shipped', title: 'Daily Report', plan: 'Free', source: 'app/daily-report.tsx', route: alder('daily-report', `&reportId=${REPORT_YESTERDAY}`),
    about: 'A filed daily report: the weather reading with its source and time, work progress against the schedule, crew and hours.',
    steps: [{ scroll: 178, to: { text: 'Shared' } }, { wait: 1200 }],
    sequence: [
      { route: alder('daily-report'), steps: [{ scroll: 172, to: { text: 'DAILY REPORT' } }, { wait: 1200 }], caption: 'A new report for today. The weather is read in with its source and time.' },
      { route: alder('daily-report'), steps: [{ type: { testID: 'work-performed-input' }, value: TODAY_WORK }, { type: { css: 'input[placeholder="Material received"]' }, value: TODAY_MATERIAL }, { scroll: 170, to: { text: 'Workforce' } }, { wait: 1200 }], caption: 'The day\'s work written in.' },
      { route: alder('daily-report', `&reportId=${todayReport.id}`), steps: [{ scroll: 178, to: { text: 'Shared' } }, { wait: 1200 }], world: withTodayFiled, caption: 'The report as filed and shared with the client.' },
    ] },
  { id: 'punch-list', set: 'shipped', title: 'Punch List', plan: 'Business', source: 'app/punch-list.tsx', route: alder('punch-list'),
    about: 'The punch list by room, each item with its picture, who it is assigned to, its due date and its status. The pictures here are flat placeholder tiles, not site photos.',
    steps: [
      // On the phone the header title is cut short before the Export button; the web header lets it run underneath.
      { js: `for (const h of document.querySelectorAll('h1')) if ((h.innerText || '').startsWith('Punch List')) h.parentElement.style.maxWidth = '286px';` },
      { scroll: 150, to: { text: 'By Location' } }, { wait: 1200 },
    ] },
  { id: 'change-order', set: 'shipped', title: 'Change Order', plan: 'Pro', source: 'app/change-order.tsx', route: coRoute,
    about: 'An approved change order: its place in the approval steps, the contract sum before and after, and the client\'s approval.',
    // No draft frame: at phone width the draft footer's portal button collapses over its own hint text.
    steps: coTop,
    sequence: [
      { world: withCo2('submitted'), caption: 'Submitted to the client.' },
      { world: withCo2('approved'), caption: 'Approved by the client.' },
      { world: withCo2('approved'), steps: [{ scroll: 190, to: { text: 'Client Approval' } }, { wait: 1500 }], caption: 'The client\'s approval and the change order\'s lines.' },
    ] },
  { id: 'invoice', set: 'shipped', title: 'Progress Invoice', plan: 'Pro', source: 'app/invoice.tsx', route: alder('invoice', `&invoiceId=${INVOICE1}`),
    about: 'A progress invoice built from the estimate\'s lines, with payment terms, retainage and its sent status.' },
  { id: 'pay-app', set: 'shipped', title: 'Pay Application', plan: 'Pro', source: 'app/aia-pay-app.tsx', route: alder('aia-pay-app'),
    about: 'A draft AIA-style pay application made from the progress invoice: contract sum, percent complete and the amount due this period after retainage.',
    steps: [{ click: { text: 'I Understand' } }],
    sequence: [
      { caption: 'The pay application\'s cover figures.' },
      { steps: [{ scroll: 150, to: { text: '#1' } }, { wait: 1200 }], caption: 'The schedule of values, one line per estimate line and approved change order.' },
      { steps: [{ scroll: 150, to: { text: 'Summary (G702 Cover)' } }, { wait: 1200 }], caption: 'The summary: contract sum to date, completed work, retainage and the payment due.' },
    ] },
  { id: 'client-portal', set: 'shipped', title: 'Client View', plan: 'Pro', source: 'app/client-view.tsx', route: `/client-view?portalId=${PORTAL_ID}`, shot: { statusBar: 'light' },
    about: 'The job as the client sees it in the app: progress, contract and change totals, what has been invoiced and paid, and what is waiting on them.' },
  { id: 'code-check', set: 'shipped', title: 'Code Check', plan: 'Pro', source: 'app/(tabs)/construction-ai/index.tsx', route: '/construction-ai', world: { functions: AI_CODE_CHECK },
    about: 'A Code Check result. The answer text is a sample written for the app\'s tests, so every line says "Sample"; the notes around it are the app\'s own.',
    steps: [
      { type: { testID: 'code-check-city' }, value: 'Sampleton' }, { type: { testID: 'code-check-state' }, value: 'NY' },
      { type: { testID: 'code-check-scenario' }, value: 'Sample: a raised deck 34 in. above grade with a stair.' },
      { click: { testID: 'code-check-run' }, then: 2500 },
    ],
    sequence: [
      { caption: 'Where the answer comes from, and that section numbers are from model recall.' },
      { steps: [{ scroll: 150, to: { text: 'Summary' } }, { wait: 1200 }], caption: 'The summary and the code cards.' },
    ] },

  // ── In testing (switched off today) ───────────────────────────────────────
  { id: 'living-model-rooms', set: 'in-testing', title: 'Living Model: Room Editor', plan: 'Pro', source: 'components/livingModel/LivingModelScreen.tsx', route: alder('living-model'),
    about: 'The job drawn as rooms from typed sizes. A schematic, not to scale for building.' },
  { id: 'living-model-replay', set: 'in-testing', title: 'Living Model: Job Replay', plan: 'Pro', source: 'components/livingModel/LivingModelScreen.tsx', route: alder('living-model'),
    about: 'The schedule played over the rooms, week by week, planned against what daily reports said. The 3D view is drawn by the web build.',
    steps: replay,
    sequence: [
      { steps: [...times(4, 'lm-prev-week'), ...toTop], caption: 'Week 2, as reported.' },
      { steps: [...times(2, 'lm-prev-week'), ...toTop], caption: 'Week 4, as reported.' },
      { steps: toTop, caption: 'Week 6, today, as reported.' },
      { steps: [{ click: { testID: 'lm-mode-planned' }, then: 400 }, ...times(5, 'lm-next-week'), ...toTop], caption: 'Week 10, as planned.' },
    ] },
  { id: 'scan-floor-plan', set: 'in-testing', title: 'Scan The Room: Floor Plan', plan: 'Pro', source: 'components/roomScan/RoomScanFlow.tsx', route: alder('scan-room'),
    about: 'A room\'s floor plan with wall lengths. This room is a hand-built test fixture, not a scan from a phone.',
    steps: scanOpen },
  { id: 'scan-quantities', set: 'in-testing', title: 'Scan The Room: Quantities', plan: 'Pro', source: 'components/roomScan/RoomScanFlow.tsx', route: alder('scan-room'),
    about: 'Floor, wall, ceiling and trim quantities worked out from the room\'s outline.',
    steps: [...scanOpen, { click: { testID: 'scan-see-quantities' }, then: 1500 }, ...toTop] },
  { id: 'scan-order-list', set: 'in-testing', title: 'Scan The Room: Order List', plan: 'Pro', source: 'components/roomScan/RoomScanFlow.tsx', route: alder('scan-room'),
    about: 'The order list made from the room\'s quantities.',
    steps: [...scanOpen, { click: { testID: 'scan-see-quantities' }, then: 1500 }, { click: { testID: 'scan-order-open' }, then: 1500 }, { click: { text: 'I Understand' }, then: 2000 }, ...toTop],
    sequence: [{ steps: [{ scroll: 150, to: { text: 'Drywall Sheets 4x8, Walls' } }, { wait: 1200 }], caption: 'The drywall lines of the order list.' },
      { steps: [{ scroll: 150, to: { testID: 'scan-order-layout' } }, { wait: 1200 }], caption: 'The drywall cut layout, wall by wall.' }] },
  { id: 'pay-period-record', set: 'in-testing', title: 'Pay Period Record', plan: 'Pro', source: 'components/proofPack/ProofPackReview.tsx', route: alder('proof-pack', `&kind=invoice&payId=${INVOICE1}`),
    about: 'The first page of a Pay Period Record: what was billed in the period and how each record MAGE ID holds for it is kept.' },
];
