// validate-shell-i18n — Spanish Phase 1b, the shell a foreman moves through
// (wave-next W3, lane ESSHELL).
//
// WHAT IT PROVES
//   S1  The app half of the confetti close-out: components/animations/
//       Confetti.tsx is gone and app/_layout.tsx mounts no <ConfettiHost />.
//   S2  The native header titles (and so the back labels) of the Phase 1 field
//       screens go through t('nav.title.<slug>', '<exact English>') — in
//       app/_layout.tsx's useFieldScreenTitles() hook, read by each
//       <Stack.Screen name="<route>"> as `title: fieldTitle.<slug>` — with
//       Spanish for each key. EVERY OTHER Stack.Screen title is unchanged:
//       the table of all 84 titles captured before the edit is compared route
//       by route (app/_layout.tsx is a PARTIAL file: office titles stay
//       English until Phase 2).
//   S3  The tab bar titles go through t('nav.tab.<key>', '<English the UI
//       shows>'), that English equals the seed (i18n/catalog/en/seed.ts), no
//       raw `title: '…'` is left in app/(tabs)/_layout.tsx, and every Spanish
//       tab label is 10 characters or fewer (docs/I18N.md §10.4).
//   S4  Home's field rows (TODAY ON SITE) and the quick field update render
//       through t()/tn() with the table's English, and Spanish exists.
//   S5  The date picker's month names come from i18n/format (English exactly
//       toLocaleDateString('en-US', { month: 'long' }); Spanish never
//       English), and its old hard-coded MONTHS table is gone.
//   ALL Every key resolves in Spanish at runtime (t(key, en, vars, 'es')) to
//       the catalog's text with its placeholders filled, and in English to
//       the English byte for byte; the Spanish `src` hash matches the English.
//
// Each check is a pure function over source text + catalogs, and is run a
// second time against a planted defect (red, then the real source green).
//
// Run: bun run scripts/validate-shell-i18n.ts

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, tn } from '../i18n/core';
import { sourceHash } from '../i18n/hash';
import { formatDateOptsL } from '../i18n/format';
import { EN_SEED } from '../i18n/catalog/en/seed';
import { EN as EN_SHELL } from '../i18n/catalog/en/field.shell.generated';
import { EN as EN_HOME } from '../i18n/catalog/en/field.home.generated';
import { ES_CATALOG } from '../i18n/catalog/es';
import type { EsCatalog, I18nKey, PluralForms } from '../i18n/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS  ' + name); return; }
  fail++;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A string literal in either quote style, as the source would write it. */
const litRe = (en: string) => `(?:'${esc(en.replace(/'/g, "\\'"))}'|"${esc(en)}")`;

// ── The tables ───────────────────────────────────────────────────────────

/** S2 — the Phase 1 field screens that carry a Stack.Screen title. */
const FIELD_TITLES: { route: string; slug: string; en: string }[] = [
  { route: 'daily-report', slug: 'dailyReport', en: 'Daily Report' },
  { route: 'punch-list', slug: 'punchList', en: 'Punch List' },
  { route: 'time-tracking', slug: 'timeTracking', en: 'Time Tracking' },
  { route: 'crew', slug: 'crew', en: 'Crew' },
  { route: 'safety', slug: 'safety', en: 'Safety' },
  { route: 'safety-jha', slug: 'safetyJha', en: 'JHAs' },
  { route: 'safety-toolbox', slug: 'safetyToolbox', en: 'Toolbox Talks' },
  { route: 'safety-incidents', slug: 'safetyIncidents', en: 'Incidents' },
  { route: 'safety-hazards', slug: 'safetyHazards', en: 'Hazard Log' },
  { route: 'safety-inspections', slug: 'safetyInspections', en: 'Inspections' },
  { route: 'safety-certifications', slug: 'safetyCertifications', en: 'Certifications' },
  { route: 'safety-forms', slug: 'safetyForms', en: 'Forms Library' },
  { route: 'safety-osha', slug: 'safetyOsha', en: 'OSHA 300 Log' },
  { route: 'photo-triage', slug: 'photoTriage', en: 'Photo Triage' },
  { route: 'material-receipt', slug: 'materialReceipt', en: 'Material Receipt' },
  { route: 'deliveries', slug: 'deliveries', en: 'Deliveries' },
  { route: 'tomorrow-lineup', slug: 'tomorrowLineup', en: "Tomorrow's Lineup" },
];

/** Every Stack.Screen title in app/_layout.tsx BEFORE the W3 edit (base
 *  616842c8), route → English. The Phase 1 rows above must now read
 *  fieldTitle.<slug>; every other row must still be this literal. */
const TITLES_BEFORE: Record<string, string> = {
  'leads': 'Pipeline', 'lead-detail': 'Lead', 'buyout': 'Buyout', 'buyout-package': 'Bid Package',
  'bid-leveling': 'Bid Leveling', 'win-optimizer': 'Win Optimizer', 'smart-proposal': 'Smart Proposal',
  'material-receipt': 'Material Receipt', 'last-planner': 'Last Planner', 'plan-intelligence': 'Plan Intelligence',
  'photo-triage': 'Photo Triage', 'tax-1099-export': '1099-NEC Export', 'insurance-audit': 'Insurance Audit Pack',
  'tomorrow-lineup': "Tomorrow's Lineup", 'warranty-walk': '11-month walk', 'project-detail': 'Project Details',
  'invoice': 'Invoice', 'bill-from-estimate': 'Bill from Estimate', 'daily-report': 'Daily Report',
  'punch-list': 'Punch List', 'safety': 'Safety', 'safety-jha': 'JHAs', 'safety-toolbox': 'Toolbox Talks',
  'safety-incidents': 'Incidents', 'safety-hazards': 'Hazard Log', 'safety-inspections': 'Inspections',
  'safety-certifications': 'Certifications', 'safety-forms': 'Forms Library', 'safety-osha': 'OSHA 300 Log',
  'warranties': 'Warranties', 'retention': 'Retainage', 'payment-predictions': 'Payment Forecast',
  'contacts': 'Contacts', 'crew': 'Crew', 'rfi': 'RFI', 'submittal': 'Submittal', 'oac-meeting': 'OAC Meetings',
  'coi-vault': 'COI Vault', 'budget-dashboard': 'Budget Dashboard', 'wip-report': 'WIP Report',
  'construction-news': 'Construction News', 'sub-scorecard': 'Sub Scorecard', 'estimate-scorecard': 'Estimate Scorecard',
  'deliveries': 'Deliveries', 'building-access': 'Building Access', 'estimate-calibration': 'Estimate Calibration',
  'sub-portal-setup': 'Sub Portal', 'public-profile-setup': 'Public Profile', 'notifications-settings': 'Notifications',
  'tutorials': 'Tutorials', 'equipment-detail': 'Equipment', 'bid-detail': 'Bid Details', 'post-bid': 'Post a Bid',
  'company-detail': 'Company', 'company-profile': 'Company Profile', 'job-detail': 'Job Details',
  'worker-detail': 'Crew Member Profile', 'post-job': 'Post a Job', 'messages': 'Messages', 'cash-flow': 'Cash Flow',
  'integrations': 'Integrations', 'time-tracking': 'Time Tracking', 'documents': 'Documents', 'permits': 'Permits',
  'weekly-snapshot': 'This Week', 'payments-setup': 'Payments', 'qbo-setup': 'QuickBooks', 'qbo-review': 'QuickBooks Costs',
  'integrations/qbo/callback': 'QuickBooks Connection', 'dev-seeder': 'Demo Seeder', 'dev-flagship-seeder': 'Flagship Seeder',
  'dev-ar-measure': 'AR Measure (Dev)', 'report-inbox': 'Report Inbox', 'profit-leak-history': 'Profit Leak History',
  'payments': 'Payments', 'aia-pay-app': 'Pay App', 'data-export': 'Export My Data', 'scope-sheet': 'Scope Sheet',
  'connect-claude': 'Connect Claude', 'data-import': 'Import Data', 'client-update': 'Weekly Client Update',
  'client-messages': 'Messages', 'estimate-wizard': 'Quick Estimate', 'client-view': 'Client Portal',
  // LEARN wave (LEARNQUIZ): the skills check.
  'skills-check': 'Skills Check',
  'skills-certificates': 'Certificates',
  // Permit Path wave (PPUI): the job's permit route; headerShown false, the title names the web tab.
  'permit-path': 'Permit Path',
  'scan-room': 'Scan the Room',
  // Lane PROOFPACK: dark behind PROOF_PACK_ENABLED; headerShown false, the title names the web tab.
  'proof-pack': 'Pay Period Record',
  'living-model': 'Living Model',
};

/** S3 — the tab bar. Keys are the seed's (exact); English = what the UI shows. */
const TAB_TITLES: { key: I18nKey; en: string }[] = [
  { key: 'nav.tab.summary', en: 'Summary' },
  { key: 'nav.tab.home', en: 'Home' },
  { key: 'nav.tab.yourProjects', en: 'Projects' },
  { key: 'nav.tab.discover', en: 'Discover' },
  { key: 'nav.tab.settings', en: 'Settings' },
  { key: 'nav.tab.mageIdBids', en: 'MAGE ID Bids' },
];

/** S4 — Home's field rows (partial file) and the quick field update. */
const HOME_ROWS: { key: I18nKey; en: string | PluralForms }[] = [
  { key: 'field.home.todayOnSite', en: 'TODAY ON SITE' },
  { key: 'field.home.moreTasks', en: '+{count} more' },
  { key: 'field.home.moreOnSite', en: '+{todayOnSiteHidden} more on site today' },
  { key: 'field.home.moreOnSiteA11y', en: { one: '{count} more project on site today. Opens summary.', other: '{count} more projects on site today. Opens summary.' } },
];
const QFU_KEYS: I18nKey[] = [
  'field.home.qfu.title', 'field.home.qfu.placeholder', 'field.home.qfu.project', 'field.home.qfu.taskCount',
  'field.home.qfu.viewOnly', 'field.home.qfu.taskGone', 'field.home.qfu.markedComplete', 'field.home.qfu.inProgress',
  'field.home.qfu.noteAdded', 'field.home.qfu.issueLogged', 'field.home.qfu.noSchedule', 'field.home.qfu.pickProject',
];

// ── Pure checks (each returns a list of problems) ────────────────────────

type Stack = Map<string, string>;
/** route → the body of its <Stack.Screen name="route" …/>. */
function stackScreens(layout: string): Stack {
  const out: Stack = new Map();
  for (const m of layout.matchAll(/<Stack\.Screen\s+name=["']([^"']+)["']([\s\S]*?)\/>/g)) out.set(m[1], m[2]);
  return out;
}

function checkFieldTitles(layout: string): string[] {
  const probs: string[] = [];
  const screens = stackScreens(layout);
  const hookAt = layout.indexOf('function useFieldScreenTitles()');
  const hook = hookAt < 0 ? '' : layout.slice(hookAt, layout.indexOf('\n}\n', hookAt));
  if (!hook) probs.push('app/_layout.tsx has no useFieldScreenTitles() hook');
  if (!/const \{ t \} = useT\(\);/.test(hook)) probs.push('useFieldScreenTitles() does not read t from useT()');
  if (!/function RootLayoutNav\(\) \{\s*const router = useRouter\(\);\s*const fieldTitle = useFieldScreenTitles\(\);/.test(layout)) {
    probs.push('RootLayoutNav does not call useFieldScreenTitles() at its top');
  }
  for (const row of FIELD_TITLES) {
    const call = new RegExp(`\\b${row.slug}: t\\('nav\\.title\\.${row.slug}', ${litRe(row.en)}\\),`);
    if (!call.test(hook)) probs.push(`${row.route}: no \`${row.slug}: t('nav.title.${row.slug}', ${JSON.stringify(row.en)})\` in useFieldScreenTitles()`);
    const body = screens.get(row.route);
    if (body === undefined) { probs.push(`${row.route}: no <Stack.Screen name="${row.route}">`); continue; }
    if (!new RegExp(`\\btitle:\\s*fieldTitle\\.${row.slug}\\b`).test(body)) probs.push(`${row.route}: its Stack.Screen title is not fieldTitle.${row.slug}`);
  }
  // No t() at module scope in the hook's table: every call sits inside the hook.
  const tCalls = (layout.match(/\bt\('nav\.title\./g) ?? []).length;
  const inHook = (hook.match(/\bt\('nav\.title\./g) ?? []).length;
  if (tCalls !== inHook) probs.push(`${tCalls - inHook} nav.title t() call(s) outside useFieldScreenTitles()`);
  return probs;
}

function checkOtherTitlesUnchanged(layout: string): string[] {
  const probs: string[] = [];
  const screens = stackScreens(layout);
  const phase1 = new Set(FIELD_TITLES.map(r => r.route));
  let titled = 0;
  for (const [route, body] of screens) {
    const lit = /\btitle:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(body);
    const viaHook = /\btitle:\s*fieldTitle\.\w+/.test(body);
    if (lit || viaHook) titled++;
    if (phase1.has(route)) continue;
    const before = TITLES_BEFORE[route];
    if (before === undefined) {
      if (lit || viaHook) probs.push(`${route}: a title that was not there before (${lit?.[1] ?? 'fieldTitle'})`);
      continue;
    }
    const now = lit ? JSON.parse(lit[1].startsWith("'") ? `"${lit[1].slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"` : lit[1]) : null;
    if (now !== before) probs.push(`${route}: title ${JSON.stringify(now)} ≠ ${JSON.stringify(before)} before the edit`);
  }
  for (const route of Object.keys(TITLES_BEFORE)) if (!screens.has(route)) probs.push(`${route}: its Stack.Screen is gone`);
  if (titled !== Object.keys(TITLES_BEFORE).length) probs.push(`${titled} titled Stack.Screens, want ${Object.keys(TITLES_BEFORE).length}`);
  return probs;
}

function checkConfettiGone(layout: string, confettiExists: boolean): string[] {
  const probs: string[] = [];
  if (confettiExists) probs.push('components/animations/Confetti.tsx still exists');
  if (/<ConfettiHost\b/.test(layout)) probs.push('app/_layout.tsx still mounts <ConfettiHost />');
  if (/animations\/Confetti['"]/.test(layout)) probs.push('app/_layout.tsx still imports components/animations/Confetti');
  return probs;
}

function checkTabs(tabs: string, seed: Record<string, unknown>, es: EsCatalog): string[] {
  const probs: string[] = [];
  if (!/const \{ t \} = useT\(\);/.test(tabs)) probs.push('app/(tabs)/_layout.tsx does not read t from useT()');
  for (const row of TAB_TITLES) {
    const call = new RegExp(`\\bt\\('${esc(row.key)}', ${litRe(row.en)}\\)`);
    if (!call.test(tabs)) probs.push(`${row.key}: no t('${row.key}', ${JSON.stringify(row.en)}) in app/(tabs)/_layout.tsx`);
    if (seed[row.key] !== row.en) probs.push(`${row.key}: seed English ${JSON.stringify(seed[row.key])} ≠ the UI's ${JSON.stringify(row.en)}`);
    const e = es[row.key];
    if (!e || typeof e.s !== 'string' || !e.s.trim()) { probs.push(`${row.key}: no Spanish`); continue; }
    if (e.s.length > 10) probs.push(`${row.key}: Spanish ${JSON.stringify(e.s)} is over 10 characters`);
    if (e.src !== sourceHash(row.en)) probs.push(`${row.key}: Spanish src ${e.src} is not the hash of ${JSON.stringify(row.en)} (stale)`);
  }
  // No raw title literal left in a Tabs.Screen.
  for (const m of tabs.matchAll(/\btitle:\s*(?:[^,}\n]*\?\s*)?(['"])([^'"]+)\1/g)) probs.push(`raw tab title ${JSON.stringify(m[2])}`);
  return probs;
}

function checkRows(src: string, file: string, rows: { key: I18nKey; en: string | PluralForms }[]): string[] {
  const probs: string[] = [];
  for (const row of rows) {
    const re = typeof row.en === 'string'
      ? new RegExp(`\\bt\\('${esc(row.key)}', ${litRe(row.en)}`)
      : new RegExp(`\\btn\\('${esc(row.key)}', [^,]+, \\{ one: ${litRe(row.en.one)}, other: ${litRe(row.en.other)} \\}`);
    if (!re.test(src)) probs.push(`${file}: ${row.key} does not render through ${typeof row.en === 'string' ? 't' : 'tn'}() with its English`);
  }
  return probs;
}

/** Spanish exists, is current (src), and t()/tn() resolve it — English byte-identical. */
function checkSpanish(keys: I18nKey[], en: Record<string, unknown>, es: EsCatalog): string[] {
  const probs: string[] = [];
  for (const key of keys) {
    const src = en[key] as string | PluralForms | undefined;
    const e = es[key];
    if (src === undefined) { probs.push(`${key}: not in the English catalog`); continue; }
    if (!e) { probs.push(`${key}: no Spanish`); continue; }
    if (e.src !== sourceHash(src)) probs.push(`${key}: Spanish is stale (src ${e.src})`);
    const vars: Record<string, string | number> = {};
    for (const m of JSON.stringify(src).matchAll(/\{([A-Za-z_]\w*)\}/g)) vars[m[1]] = m[1] === 'count' ? 3 : `«${m[1]}»`;
    if (typeof src === 'string') {
      const got = t(key, src, vars, 'es');
      if (got === t(key, src, vars, 'en')) probs.push(`${key}: Spanish renders as the English`);
      if (/\{[A-Za-z_]\w*\}/.test(got)) probs.push(`${key}: an unfilled placeholder in ${JSON.stringify(got)}`);
      const plain = src.replace(/\{([A-Za-z_]\w*)\}/g, (_m, k: string) => String(vars[k]));
      if (t(key, src, vars, 'en') !== plain) probs.push(`${key}: English is not byte-identical`);
    } else {
      delete vars.count; // tn injects {count} itself
      const got = tn(key, 3, src, vars, 'es');
      if (got === tn(key, 3, src, vars, 'en')) probs.push(`${key}: Spanish renders as the English`);
      if (tn(key, 1, src, vars, 'en') !== src.one.replace(/\{([A-Za-z_]\w*)\}/g, (_m, k: string) => (k === 'count' ? '1' : String(vars[k])))) probs.push(`${key}: English one-form is not byte-identical`);
    }
  }
  return probs;
}

function checkDatePicker(dpm: string): string[] {
  const probs: string[] = [];
  if (/'January', 'February'/.test(dpm)) probs.push('DatePickerModal still hard-codes the English month names');
  if (!/formatDateOptsL\(new Date\(2000, i, 1\), \{ month: 'long' \}, lang\)/.test(dpm)) probs.push('DatePickerModal month names do not come from i18n/format');
  for (let i = 0; i < 12; i++) {
    const d = new Date(2000, i, 1);
    if (formatDateOptsL(d, { month: 'long' }, 'en') !== d.toLocaleDateString('en-US', { month: 'long' })) probs.push(`month ${i}: English differs`);
    const es = formatDateOptsL(d, { month: 'long' }, 'es');
    if (es === d.toLocaleDateString('en-US', { month: 'long' }) || /\d/.test(es)) probs.push(`month ${i}: Spanish ${JSON.stringify(es)}`);
  }
  return probs;
}

// ── Run ──────────────────────────────────────────────────────────────────

const LAYOUT = read('app/_layout.tsx');
const TABS = read('app/(tabs)/_layout.tsx');
const HOME = read('app/(tabs)/(home)/index.tsx');
const QFU = read('components/QuickFieldUpdate.tsx');
const DPM = read('components/DatePickerModal.tsx');
const CONFETTI = existsSync(join(ROOT, 'components/animations/Confetti.tsx'));
const SEED = EN_SEED as Record<string, unknown>;
const EN_ALL = { ...SEED, ...EN_SHELL, ...EN_HOME } as Record<string, unknown>;

const show = (p: string[]) => p.slice(0, 8).join('\n        ');

console.log('\nS1 confetti (app half):');
ok('Confetti.tsx is deleted and nothing mounts or imports it', checkConfettiGone(LAYOUT, CONFETTI).length === 0, show(checkConfettiGone(LAYOUT, CONFETTI)));

console.log('\nS2 Phase 1 header titles:');
ok(`${FIELD_TITLES.length} field screens title through t('nav.title.…') with their exact English`, checkFieldTitles(LAYOUT).length === 0, show(checkFieldTitles(LAYOUT)));
ok(`every other Stack.Screen title is unchanged (${Object.keys(TITLES_BEFORE).length} titled screens before the edit)`, checkOtherTitlesUnchanged(LAYOUT).length === 0, show(checkOtherTitlesUnchanged(LAYOUT)));
ok('each nav.title key has current Spanish that renders', checkSpanish(FIELD_TITLES.map(r => `nav.title.${r.slug}` as I18nKey), EN_ALL, ES_CATALOG).length === 0, show(checkSpanish(FIELD_TITLES.map(r => `nav.title.${r.slug}` as I18nKey), EN_ALL, ES_CATALOG)));
ok("'OSHA 300 log' keeps the form name in Spanish (Registro OSHA 300)", ES_CATALOG['nav.title.safetyOsha']?.s === 'Registro OSHA 300');

console.log('\nS3 tab bar:');
ok('tab titles through t(nav.tab.*), seed English = the UI, Spanish ≤ 10 characters, no raw title', checkTabs(TABS, SEED, ES_CATALOG).length === 0, show(checkTabs(TABS, SEED, ES_CATALOG)));
ok('the tab VoiceOver position label is one key with Spanish', checkRows(TABS, 'tabs', [{ key: 'nav.title.tabA11yPosition', en: '{label}, tab, {position} of {count}' }]).length === 0
  && checkSpanish(['nav.title.tabA11yPosition'], EN_ALL, ES_CATALOG).length === 0);

console.log('\nS4 Home field rows + quick field update:');
ok("Home's TODAY ON SITE rows render through t()/tn()", checkRows(HOME, 'home', HOME_ROWS).length === 0, show(checkRows(HOME, 'home', HOME_ROWS)));
ok('…with Spanish present', checkSpanish(HOME_ROWS.map(r => r.key), EN_ALL, ES_CATALOG).length === 0, show(checkSpanish(HOME_ROWS.map(r => r.key), EN_ALL, ES_CATALOG)));
ok('…and no raw TODAY ON SITE / "more on site today" left in the rows', !/>\s*TODAY ON SITE/.test(HOME) && !/^\s*\+\{todayOnSiteHidden\} more on site today\s*$/m.test(HOME));
const qfuRows = QFU_KEYS.map(key => ({ key, en: EN_HOME[key] as string | PluralForms }));
ok('the quick field update renders its strings through t()/tn()', checkRows(QFU, 'QuickFieldUpdate', qfuRows).length === 0, show(checkRows(QFU, 'QuickFieldUpdate', qfuRows)));
ok('…with Spanish present', checkSpanish(QFU_KEYS, EN_ALL, ES_CATALOG).length === 0, show(checkSpanish(QFU_KEYS, EN_ALL, ES_CATALOG)));

console.log('\nS5 date picker:');
ok('month names through i18n/format (English exact, Spanish never English)', checkDatePicker(DPM).length === 0, show(checkDatePicker(DPM)));

// ── Planted defects: every check goes red on a broken copy ────────────────
console.log('\nplanted defects (each must be caught):');
const red = (name: string, probs: string[]) => ok(`RED on planted: ${name}`, probs.length > 0);
red('a Phase 1 title back to a raw literal',
  checkFieldTitles(LAYOUT.replace('title: fieldTitle.punchList,', 'title: "Punch list",')));
red('a Phase 1 key with the wrong English',
  checkFieldTitles(LAYOUT.replace("t('nav.title.safetyToolbox', 'Toolbox Talks')", "t('nav.title.safetyToolbox', 'Toolbox talks')")));
red('an office title changed in passing',
  checkOtherTitlesUnchanged(LAYOUT.replace("title: 'Building Access'", "title: t('nav.title.buildingAccess', 'Building Access')")));
red('an office title reworded',
  checkOtherTitlesUnchanged(LAYOUT.replace('title: "Cash Flow"', 'title: "Cash flow"')));
red('a Stack.Screen dropped', checkOtherTitlesUnchanged(LAYOUT.replace(/<Stack\.Screen name="leads"[\s\S]*?\/>/, '')));
red('ConfettiHost mounted again', checkConfettiGone(LAYOUT.replace('<NailItToastHost />', '<NailItToastHost />\n<ConfettiHost />'), false));
red('Confetti.tsx back on disk', checkConfettiGone(LAYOUT, true));
red('a raw tab title', checkTabs(TABS.replace("title: t('nav.tab.discover', 'Discover')", "title: 'Discover'"), SEED, ES_CATALOG));
red('a tab label over 10 characters in Spanish', checkTabs(TABS, SEED, { ...ES_CATALOG, 'nav.tab.settings': { s: 'Configuración', src: sourceHash('Settings') } }));
red('seed English behind the UI', checkTabs(TABS, { ...SEED, 'nav.tab.yourProjects': 'Your Projects' }, ES_CATALOG));
red('a Home row back to raw text', checkRows(HOME.replace("{t('field.home.todayOnSite', 'TODAY ON SITE')}", 'TODAY ON SITE'), 'home', HOME_ROWS));
const noSpanish = { ...ES_CATALOG } as EsCatalog;
delete noSpanish['field.home.qfu.title'];
red('a key with no Spanish', checkSpanish(QFU_KEYS, EN_ALL, noSpanish));
red('stale Spanish (English changed under it)', checkSpanish(['nav.title.crew'], { ...EN_ALL, 'nav.title.crew': 'Crew list' }, ES_CATALOG));
red('hard-coded English months', checkDatePicker(DPM.replace('const MONTH_INDEXES', "const MONTHS = ['January', 'February'];\nconst MONTH_INDEXES")));

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-shell-i18n: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
