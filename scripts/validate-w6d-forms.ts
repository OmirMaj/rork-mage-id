// validate-w6d-forms.ts — wave 6d, lane P2: the estimate wizard on one page,
// Settings as two panes, the Paywall as a centred web card.
//
// WHY. The founder, on a 1512x945 MacBook: "the website app… really isn't
// utilizing the space a computer screen gives you". Three forms were the worst
// of it: the wizard's question view spanned the whole window, Settings was 6.1
// screens tall, and the web Paywall was an opaque full-window page with a
// ~1,470 px "Open in App Store" button. The fixes rest on a few pure rules and
// a few source facts; this pins both.
//
//   1. utils/estimateWizardDesktop — the rail's fit width, each step's state,
//      the first blocked step Generate names, and the FIELD_SPAN table.
//   2. utils/settingsSections — all 22 section ids in exactly one group, the
//      PM / web filters, ?section= resolution and the visible index.
//   3. Source pins — the Paywall web Modal's desktop-only transparency, its two
//      {practiceBlock}s and the SheetOverlay; the wizard's Cmd+Enter-only
//      binding (Cmd+S must never spend a metered AI run); the one-page wizard
//      behind isDesktopWeb with an uncast desktop Cancel and no new `as never`;
//      Settings' four persona OPENs and 22 SettingsSection ids.
//
// bun cannot parse react-native, so it is stubbed (designTokens reads Platform
// at import time). Run via: bun run test:w6d-forms

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: {
  plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void;
};

if (typeof Bun === 'undefined') {
  console.error('\nvalidate-w6d-forms must run under bun (needs Bun.plugin to stub react-native)\n');
  process.exit(1);
}

Bun.plugin({
  name: 'w6d-forms-stubs',
  setup(build) {
    build.module('react-native', () => ({
      exports: {
        Platform: { OS: 'web', select: (o: Record<string, unknown>) => ('web' in o ? o.web : o.default) },
        Dimensions: { get: () => ({ width: 1512, height: 945 }), addEventListener: () => ({ remove() {} }) },
        StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
      },
      loader: 'object',
    }));
  },
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const W = await import('../utils/estimateWizardDesktop');
const S = await import('../utils/settingsSections');
const Q = await import('../utils/scopeQuestions');

let failures = 0;
let passes = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passes += 1; return; }
  failures += 1;
  console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ═══ 1. The one-page wizard's rules ═════════════════════════════════════════
{
  ok('WIZARD_RAIL_MIN is 220 + 360 + 560 + 2 × 24 = 1188', W.WIZARD_RAIL_MIN === 1188, String(W.WIZARD_RAIL_MIN));
  ok('wizardRailFits: 1188 fits, 1187 does not', W.wizardRailFits(1188) && !W.wizardRailFits(1187));

  const EMPTY = Q.INITIAL_SCOPE;
  const FULL = {
    ...Q.INITIAL_SCOPE, projectType: 'Kitchen Remodel', sizeSqft: '1,500 sqft', location: 'Austin, TX', quality: 'high_end' as const,
    scope: 'Gut the kitchen and add an island', timelineWeeks: '6', specialRequirements: 'HOA review', targetBudget: '75000',
  };
  ok('stepStates(INITIAL_SCOPE): 3 needed, quality done (standard is an answer), 1 needed, 3 optional',
    eq(W.stepStates(EMPTY), ['needed', 'needed', 'needed', 'done', 'needed', 'optional', 'optional', 'optional']),
    JSON.stringify(W.stepStates(EMPTY)));
  ok('stepStates(fully answered): all done', W.stepStates(FULL).every((s) => s === 'done'), JSON.stringify(W.stepStates(FULL)));
  ok('stepStates: one per SCOPE_STEPS', W.stepStates(EMPTY).length === Q.SCOPE_STEPS.length);
  ok('firstBlockedStep(INITIAL_SCOPE) is 0 (project type)', W.firstBlockedStep(EMPTY) === 0);
  ok('firstBlockedStep(fully answered) is -1', W.firstBlockedStep(FULL) === -1);
  ok('firstBlockedStep: optional steps never block (0-4 answered, 5-7 empty)',
    W.firstBlockedStep({ ...FULL, timelineWeeks: '', specialRequirements: '', targetBudget: '' }) === -1);
  ok('firstBlockedStep: a too-short scope blocks at step 4',
    W.firstBlockedStep({ ...FULL, scope: 'ab' }) === 4);
  ok('firstBlockedStep: an unparseable size blocks at step 1 (before the empty location)',
    W.firstBlockedStep({ ...FULL, sizeSqft: 'big', location: '' }) === 1);
  ok('the block reason Generate prints for step 0 is the stepper\'s own',
    Q.stepBlockReason(W.firstBlockedStep(EMPTY), EMPTY) === Q.stepBlockReason(0, EMPTY) && !!Q.stepBlockReason(0, EMPTY));
  const keys = Q.SCOPE_STEPS.map((s) => s.key);
  ok('every SCOPE_STEPS key is in FIELD_SPAN', keys.every((k) => k in W.FIELD_SPAN), keys.filter((k) => !(k in W.FIELD_SPAN)).join(', '));
  ok('FIELD_SPAN names no key outside SCOPE_STEPS', Object.keys(W.FIELD_SPAN).every((k) => keys.includes(k as never)));
  ok('FIELD_SPAN: size, location, timeline, budget half; the rest full',
    eq(Object.entries(W.FIELD_SPAN).filter(([, v]) => v === 'half').map(([k]) => k).sort(), ['location', 'sizeSqft', 'targetBudget', 'timelineWeeks']));
}

// ═══ 2. The Settings map ════════════════════════════════════════════════════
{
  const ALL = [
    'account-type', 'ai-usage', 'location-units', 'estimate-defaults', 'pdf-naming', 'theme', 'security', 'notifications',
    'payments', 'integrations', 'project-pages', 'your-costs', 'contacts-email', 'your-data', 'developer',
    'supplier-marketplace', 'subscription', 'help', 'faq', 'about', 'legal', 'danger',
  ];
  const listed = S.SETTINGS_GROUPS.flatMap((g) => [...g.sections]);
  ok('settingsSections: 22 section ids', listed.length === 22 && new Set(listed).size === 22, String(listed.length));
  ok('settingsSections: exactly the 22 ids', eq([...listed].sort(), [...ALL].sort()));
  ok('settingsSections: each id in exactly one group',
    ALL.every((id) => S.SETTINGS_GROUPS.filter((g) => g.sections.includes(id as never)).length === 1));
  ok('settingsSections: a label for every id', ALL.every((id) => typeof S.SECTION_LABEL[id as never] === 'string'));
  ok('settingsSections: group order', eq(S.SETTINGS_GROUPS.map((g) => g.key), ['account', 'workspace', 'money', 'sharing', 'help', 'danger', 'developer']));
  ok('settingsSections: developer is the only owner-only group',
    eq(S.SETTINGS_GROUPS.filter((g) => g.ownerOnly).map((g) => g.key), ['developer']));
  ok('PM_HIDDEN ⊂ ids, and exactly the four pinned 6c blocks',
    S.PM_HIDDEN.every((id) => ALL.includes(id)) && eq([...S.PM_HIDDEN].sort(), ['estimate-defaults', 'pdf-naming', 'supplier-marketplace', 'your-costs']));
  ok('WEB_HIDDEN is security', eq(S.WEB_HIDDEN, ['security']));
  ok('groupOf: payments → money, danger → danger, account-type → account',
    S.groupOf('payments') === 'money' && S.groupOf('danger') === 'danger' && S.groupOf('account-type') === 'account');

  const r = (raw: unknown, isOwner = false) => S.resolveSettingsParam(raw as string, { isOwner });
  ok('resolveSettingsParam: a group key', eq(r('money'), { group: 'money', sectionId: null }));
  ok('resolveSettingsParam: a section id', eq(r('payments'), { group: 'money', sectionId: 'payments' }));
  ok('resolveSettingsParam: junk → account', eq(r('nope'), { group: 'account', sectionId: null }));
  ok('resolveSettingsParam: missing → account', eq(r(undefined), { group: 'account', sectionId: null }));
  ok('resolveSettingsParam: an array → account', eq(r(['money']), { group: 'account', sectionId: null }));
  ok('resolveSettingsParam: developer for a non-owner → account', eq(r('developer'), { group: 'account', sectionId: null }));
  // 'developer', 'help' and 'danger' are both a group key and a section id: the group wins.
  ok('resolveSettingsParam: developer for the owner', eq(r('developer', true), { group: 'developer', sectionId: null }));
  ok('resolveSettingsParam: a section id inside its group (faq → help)', eq(r('faq'), { group: 'help', sectionId: 'faq' }));

  const ids = (v: ReturnType<typeof S.visibleIndex>) => v.flatMap((g) => g.sections);
  const pm = S.visibleIndex({ role: 'property_manager', isOwner: false, web: true });
  const gc = S.visibleIndex({ role: 'contractor', isOwner: false, web: true });
  const own = S.visibleIndex({ role: 'contractor', isOwner: true, web: true });
  const nat = S.visibleIndex({ role: 'contractor', isOwner: false, web: false });
  ok('visibleIndex(PM): none of the four contractor-only sections', !ids(pm).some((id) => S.PM_HIDDEN.includes(id)));
  ok('visibleIndex(PM): 16 sections (22 − 4 PM − security − developer)', ids(pm).length === 16, String(ids(pm).length));
  ok('visibleIndex(contractor, web): 20 (no security, no developer)', ids(gc).length === 20 && !ids(gc).includes('security') && !ids(gc).includes('developer'), String(ids(gc).length));
  ok('visibleIndex(owner, web): developer group shown, 21 sections', own.some((g) => g.key === 'developer') && ids(own).length === 21);
  ok('visibleIndex(native): security shown', ids(nat).includes('security'));
  ok('visibleIndex drops an empty group', S.visibleIndex({ role: 'contractor', isOwner: false, web: true }).every((g) => g.sections.length > 0)
    && !gc.some((g) => g.key === 'developer'));
}

// ═══ 3. Source pins ═════════════════════════════════════════════════════════
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
{
  const pw = read('components/Paywall.tsx');
  ok('Paywall: the web Modal is transparent on desktop only (`transparent={pw.isDesktop || undefined}`)',
    pw.includes('transparent={pw.isDesktop || undefined}'));
  ok('Paywall: the web Modal keeps pageSheet off desktop', pw.includes("presentationStyle={pw.isDesktop ? undefined : 'pageSheet'}"));
  ok('Paywall: exactly two {practiceBlock}', (pw.match(/\{practiceBlock\}/g) ?? []).length === 2);
  const play = pw.indexOf('testID="paywall-open-play-store"');
  const firstPractice = pw.indexOf('{practiceBlock}');
  ok('Paywall: the web {practiceBlock} still follows paywall-open-play-store', play > 0 && firstPractice > play);
  ok('Paywall: the web card sits in a SheetOverlay', /<SheetOverlay frame=\{pw\}>/.test(pw) && /<\/SheetOverlay>/.test(pw));
  ok("Paywall: the frame is useSheetFrame('form', { visible, animationType: 'slide' })",
    pw.includes("const pw = useSheetFrame('form', { visible, animationType: 'slide' });"));
  ok('Paywall: the props signature is unchanged',
    pw.includes('export default function Paywall({ visible, onClose, feature, requiredTier, practiceTutorialId, source }: PaywallProps)'));
}
{
  const d = strip(read('components/estimate/EstimateWizardDesktop.tsx'));
  const combos = [...d.matchAll(/combo:\s*'([^']+)'/g)].map((m) => m[1]);
  ok("EstimateWizardDesktop binds mod+enter only", eq(combos, ['mod+enter']), combos.join(', '));
  ok("EstimateWizardDesktop never binds 'mod+s' nor uses usePrimaryAction", !/mod\+s\b/.test(d) && !/usePrimaryAction/.test(d));
  ok('EstimateWizardDesktop returns null off desktop', /if \(!isDesktop\) return null;/.test(d));
  ok('EstimateWizardDesktop: a blocked Generate names the step (stepBlockReason) — never a silent no-op',
    /if \(blocked >= 0\) \{[\s\S]{0,120}setStepHint\(stepBlockReason\(blocked, answers\)\)[\s\S]{0,60}scrollTo\(blocked\)/.test(d));
  ok('EstimateWizardDesktop: the questions use the compact stepper', d.includes('density="compact"'));
}
{
  const wz = read('app/estimate-wizard.tsx');
  ok('estimate-wizard: the one-page wizard sits behind isDesktopWeb',
    /\{isDesktopWeb \? \(\s*<EstimateWizardDesktop/.test(wz) && /const isDesktopWeb = useIsDesktopWeb\(\);/.test(wz));
  ok('estimate-wizard: the desktop Cancel is uncast',
    wz.includes("onCancel={() => (isOnboarding ? router.replace('/(tabs)/(home)') : safeBack())}"));
  ok('estimate-wizard: the phone Cancel line is byte-identical',
    wz.includes("? () => (isOnboarding ? router.replace('/(tabs)/(home)' as never) : safeBack())"));
  // $BASE is 124dc7c4 (wave 6d phase 2 + smoothness), where the file held 11.
  const BASE_AS_NEVER = 11;
  const asNever = (wz.match(/as never/g) ?? []).length;
  ok(`estimate-wizard: no new \`as never\` (${asNever} ≤ ${BASE_AS_NEVER})`, asNever <= BASE_AS_NEVER);
  let baseCount: number | null = null;
  try {
    baseCount = (execFileSync('git', ['-C', ROOT, 'show', '124dc7c4:app/estimate-wizard.tsx'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .match(/as never/g) ?? []).length;
  } catch { /* shallow clone: the literal above holds */ }
  if (baseCount !== null) ok('estimate-wizard: the base count literal matches git', baseCount === BASE_AS_NEVER, String(baseCount));
  ok('estimate-wizard: the result view caps at Layout.page.form', /contentDesktop: \{[^}]*maxWidth: Layout\.page\.form/.test(wz));
  ok('estimate-wizard: both sheets are framed', /const fSave = useSheetFrame\('form', \{ visible: showSaveModal, animationType: 'slide' \}\);/.test(wz)
    && /const fMarkup = useSheetFrame\('form', \{ visible: showMarkupSheet, animationType: 'slide' \}\);/.test(wz));
  ok('estimate-wizard: only the save sheet has a primary shortcut',
    (wz.match(/useSheetPrimaryHotkey\(/g) ?? []).length === 1 && wz.includes('useSheetPrimaryHotkey(showSaveModal, createFromEstimate);'));
}
{
  const st = read('app/(tabs)/settings/index.tsx');
  const OPEN = "{userRole !== 'property_manager' && (<>";
  ok('settings: keeps its four persona OPENs', st.split(OPEN).length - 1 === 4);
  const sectionIds = [...st.matchAll(/<SettingsSection id="([a-z-]+)">/g)].map((m) => m[1]);
  ok('settings: 22 SettingsSection ids, each once', sectionIds.length === 22 && new Set(sectionIds).size === 22, sectionIds.join(','));
  ok('settings: the SettingsSection ids are the 22 of utils/settingsSections',
    eq([...sectionIds].sort(), [...S.SETTINGS_SECTION_IDS].sort()));
  ok('settings: 22 closing tags', (st.match(/<\/SettingsSection>/g) ?? []).length === 22);
  for (const [header, id] of [['ESTIMATE DEFAULTS', 'estimate-defaults'], ['PDF NAMING', 'pdf-naming'], ['YOUR COSTS', 'your-costs'], ['SUPPLIER MARKETPLACE', 'supplier-marketplace']] as const) {
    const at = st.indexOf(`<Text style={styles.sectionHeader}>${header}</Text>`);
    const open = st.lastIndexOf(OPEN, at);
    const sec = st.indexOf(`<SettingsSection id="${id}">`, open);
    ok(`settings: SettingsSection "${id}" sits INSIDE its persona gate`, open > 0 && sec > open && sec < at);
  }
  ok('settings: the two panes sit behind isDesktopWeb', /<SettingsPanes\s+enabled=\{isDesktopWeb\}/.test(st));
  ok('settings: contentDesktop has no numeric maxWidth', /contentDesktop: \{[^}]*maxWidth: Layout\.page\.form/.test(st)
    && !/contentDesktop: \{[^}]*maxWidth: \d/.test(st));
  ok('settings: the theme chips are a TileGrid with the phone style', st.includes('<TileGrid preset="action" phoneStyle={styles.themeGrid}>'));
  ok('settings: the supplier form is a dialog scope', st.includes('useSheetDialogScope(showSupplierForm);'));
}
{
  const panes = strip(read('components/settings/SettingsPanes.tsx'));
  ok('SettingsPanes: a Fragment when not enabled', /if \(!enabled\) return <>\{children\}<\/>;/.test(panes));
  ok('SettingsSection: a Fragment with no pane context', /if \(!ctx\) return <>\{children\}<\/>;/.test(panes));
  ok('SettingsPanes: a selected row is a surfaceAlt fill, never an accent fill',
    /rowSelected: \{ backgroundColor: t\.surfaceAlt \}/.test(panes) && !/backgroundColor: t\.accent/.test(panes));
}

console.log(`\n${failures === 0 ? '✓' : '✗'} validate-w6d-forms: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
