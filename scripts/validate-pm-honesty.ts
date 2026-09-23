// validate-pm-honesty.ts — Phase 0, lane D1: the Property Manager screens say
// what is true and keep what he typed.
//
// Before this: "Post for bids" promised "MAGE ID contractors who cover your
// area" while RFP_BROWSE_ENABLED and SERVICE_AREA_SETUP_ENABLED were both off
// and no post could reach anyone; the assignee vanished once a job left
// 'assigned'; dispatch texts were signed from contractor branding a PM never
// fills in; an empty send sheet said "Add … in the Contacts screen" with no
// way there; owner email, units and notes were columns nothing could enter;
// budgets lost their cents; the portfolio was missing from "Export my data";
// comments still said "all data is local"; the open status was the
// pre-rebrand orange; a plain Add button wore the AI mark.
//
// This runs the real pure helpers (utils/propertyMirror, utils/dataExport with
// native modules stubbed) and pins the screens that use them.
//
// Run: bun run scripts/validate-pm-honesty.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (spec: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-pm-honesty must run under bun (needs Bun.plugin to stub native modules)\n');
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
// Source with line comments and JSX block comments removed.
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail); }
}

Bun.plugin({
  name: 'pm-honesty-stubs',
  setup(build) {
    const inert: VirtualModule = {
      exports: {
        Platform: { OS: 'web' }, supabase: {}, isSupabaseConfigured: false, cacheDirectory: '',
        deliverTextFile: async () => null, generateCloseoutPacketUri: async () => null,
        isAvailableAsync: async () => false, shareAsync: async () => undefined,
      },
      loader: 'object',
    };
    for (const spec of ['react-native', 'expo-file-system/legacy', 'expo-sharing', '@/utils/platformFile',
      '@/utils/closeoutPacketGenerator', '@/lib/supabase']) {
      build.module(spec, () => inert);
    }
  },
});

const pm = await import('../utils/propertyMirror');
const ex = await import('../utils/dataExport');
const flags = await import('../constants/featureFlags');

const wo = read('app/work-order.tsx');
const woCode = code(wo);
const mp = read('app/managed-property.tsx');
const mpCode = code(mp);
const home = read('components/PropertyManagerHome.tsx');
const homeCode = code(home);

console.log('\n── "Post for bids" says what really happens ──');
{
  const closed = pm.postForBidsGate(false, false);
  ok('both flags off: the tile is closed with "No contractor can see posts on MAGE yet. Send it to one you know."',
    closed.open === false && closed.reason === 'No contractor can see posts on MAGE yet. Send it to one you know.');
  ok('service areas live but browsing off: still closed (an alerted contractor cannot read the post)',
    pm.postForBidsGate(false, true).open === false);
  const browseOnly = pm.postForBidsGate(true, false);
  ok('browsing on but nobody matched: closed, and it does not claim "no contractor can see posts"',
    browseOnly.open === false && !!browseOnly.reason && !/can see posts/.test(browseOnly.reason));
  ok('both on: open, no reason', pm.postForBidsGate(true, true).open === true && pm.postForBidsGate(true, true).reason === null);
  ok('anything but true counts as off', pm.postForBidsGate(undefined as unknown as boolean, 1 as unknown as boolean).open === false);
  ok('the reach promise is the old subtitle, word for word, kept for when the gate opens',
    /const POST_FOR_BIDS_REACH_SUBTITLE = 'Post it to MAGE ID contractors who cover your area';/.test(woCode));

  ok('work-order gates on BOTH real flags',
    /const BIDS_GATE = postForBidsGate\(RFP_BROWSE_ENABLED, SERVICE_AREA_SETUP_ENABLED\);/.test(woCode)
    && /import \{ RFP_BROWSE_ENABLED, SERVICE_AREA_SETUP_ENABLED \} from '@\/constants\/featureFlags';/.test(woCode));
  const tileAt = woCode.indexOf('testID="wo-post-bids"');
  const tile = woCode.slice(woCode.lastIndexOf('<TouchableOpacity', tileAt), woCode.indexOf('</TouchableOpacity>', tileAt));
  ok('the tile is disabled while the gate is closed', /disabled=\{!BIDS_GATE\.open\}/.test(tile)
    && /accessibilityState=\{\{ disabled: !BIDS_GATE\.open \}\}/.test(tile));
  ok('...and its subtitle is the reason, the reach promise only when open',
    /\{BIDS_GATE\.open \? POST_FOR_BIDS_REACH_SUBTITLE : BIDS_GATE\.reason\}/.test(tile));
  ok('the promise is never hard-coded as JSX text any more', !/>\s*Post it to MAGE ID contractors who cover your area\s*</.test(woCode));
  ok('postForBids itself refuses while closed', /if \(!wo \|\| !BIDS_GATE\.open\) return;/.test(woCode));
  const sendAt = woCode.indexOf('testID="wo-dispatch"');
  ok('"Send to a contractor" is the main action (primary style) and comes first',
    sendAt > -1 && sendAt < tileAt && /styles\.bridgeBtnPrimary/.test(woCode.slice(woCode.lastIndexOf('<TouchableOpacity', sendAt), sendAt)));
  ok('an order already Out for bids says the same and offers "Send to a contractor instead"',
    /const outForBidsGoesNowhere = wo\.status === 'posted_for_bids' && !BIDS_GATE\.open;/.test(woCode)
    && /\{outForBidsGoesNowhere && \([\s\S]{0,400}\{BIDS_GATE\.reason\}[\s\S]{0,600}Send to a contractor instead/.test(woCode)
    && /testID="wo-send-instead"/.test(woCode));
  // The flags really are off today, so the closed branch is what ships.
  ok('(today) the flags are off, so the shipped tile is the closed one',
    pm.postForBidsGate(flags.RFP_BROWSE_ENABLED, flags.SERVICE_AREA_SETUP_ENABLED).open === false);
}

console.log('\n── the assignee and the signature ──');
{
  const banner = woCode.slice(woCode.indexOf('Assigned to <Text') - 400, woCode.indexOf('Assigned to <Text'));
  ok('the assignee shows whenever a name is set, not only while status is "assigned"',
    /\{!!wo\.assignedContactName && \(/.test(banner) && !/wo\.status === 'assigned' &&/.test(banner));
  ok('branding contact name wins', pm.dispatchSenderName({ contactName: ' Pat ', companyName: 'Co' }, 'Profile') === 'Pat');
  ok('then the company', pm.dispatchSenderName({ contactName: '  ', companyName: 'Oak PM LLC' }, 'Profile') === 'Oak PM LLC');
  ok('a PM with no branding signs with his profile name', pm.dispatchSenderName({}, ' Dana Reyes ') === 'Dana Reyes'
    && pm.dispatchSenderName(undefined, 'Dana Reyes') === 'Dana Reyes');
  ok('nothing at all: unsigned, not "undefined"', pm.dispatchSenderName(null, '  ') === undefined);
  ok('work-order signs through dispatchSenderName(settings?.branding, user?.name)',
    /senderName: dispatchSenderName\(settings\?\.branding, user\?\.name\)/.test(woCode) && /const \{ user \} = useAuth\(\);/.test(woCode));
  const signed = pm.composeDispatchMessage({ workOrder: { title: 'Leak', priority: 'normal' }, senderName: pm.dispatchSenderName({}, 'Dana Reyes') });
  ok('the composed text carries the profile name', /— Dana Reyes$/.test(signed.body));
}

console.log('\n── an empty contractor list is not a dead end ──');
{
  ok('the send sheet has an "Add a contractor" button', /testID="wo-add-contractor"/.test(woCode) && />Add a contractor</.test(woCode));
  ok('...rendered whether or not the list is empty (after the list/empty ternary)',
    woCode.indexOf('testID="wo-add-contractor"') > woCode.indexOf('No contacts yet.'));
  ok('the empty text no longer points at a screen with no link to it', !/in the Contacts screen/.test(woCode));
  const save = woCode.slice(woCode.indexOf('const saveNewContractor'), woCode.indexOf('const closeDispatch'));
  ok('saving creates a Sub contact through ProjectContext.addContact', /addContact\(\{/.test(save) && /role: 'Sub',/.test(save)
    && /phone: ncPhone\.trim\(\)/.test(save) && /email: ncEmail\.trim\(\)/.test(save));
  ok('...then returns to the list (form reset, sheet stays open)', /resetNewContractor\(\);\s*\}, \[/.test(save) && !/setDispatchOpen\(false\)/.test(save));
  ok('the save button is blocked with a reason until there is a name and a way to reach them',
    /disabled=\{!!ncBlockedWhy\}/.test(woCode) && /\{!!ncBlockedWhy && <Text style=\{styles\.blockedWhy\}>\{ncBlockedWhy\}<\/Text>\}/.test(woCode));
}

console.log('\n── the new buttons do what they say (review round 1) ──');
{
  // The opening tag of the element carrying `testID`: from its '<' to the
  // tag's closing '>' (attributes may sit on either side of the testID).
  const tagOf = (src: string, testId: string): string => {
    const at = src.indexOf(`testID="${testId}"`);
    if (at < 0) return '';
    const start = src.lastIndexOf('<', at);
    const end = src.indexOf('>', at);
    return src.slice(start, end + 1);
  };
  const addTag = tagOf(woCode, 'wo-add-contractor');
  ok('"Add a contractor" opens the inline form', /onPress=\{\(\) => setAddingContractor\(true\)\}/.test(addTag) && !/disabled/.test(addTag), addTag);
  ok('...and that flag is what swaps the send sheet to the form',
    /\{addingContractor \? \(/.test(woCode) && /const \[addingContractor, setAddingContractor\] = useState\(false\);/.test(woCode));
  const insteadTag = tagOf(woCode, 'wo-send-instead');
  ok('"Send to a contractor instead" opens the send sheet', /onPress=\{\(\) => setDispatchOpen\(true\)\}/.test(insteadTag) && !/disabled/.test(insteadTag), insteadTag);
  const dispatchTag = tagOf(woCode, 'wo-dispatch');
  ok('"Send to a contractor" opens the send sheet', /onPress=\{\(\) => setDispatchOpen\(true\)\}/.test(dispatchTag) && !/disabled/.test(dispatchTag), dispatchTag);
  ok('...which is the modal that flag shows', /<Modal visible=\{dispatchOpen\}/.test(woCode));
  const rcAt = homeCode.indexOf('<RefreshControl');
  const rc = rcAt < 0 ? '' : homeCode.slice(rcAt, homeCode.indexOf('/>', rcAt) + 2);
  ok('PM home pull-to-refresh is enabled and calls onPull', /onRefresh=\{onPull\}/.test(rc) && /refreshing=\{pulling\}/.test(rc) && !/enabled=/.test(rc), rc);
  const onPull = homeCode.slice(homeCode.indexOf('const onPull'), homeCode.indexOf('}, [refresh]);', homeCode.indexOf('const onPull')));
  ok('...and onPull re-reads the server', /await refresh\(\);/.test(onPull));
}

console.log('\n── owner email, units, notes ──');
{
  ok('the edit sheet has Owner email, Units and Notes inputs',
    /testID="pm-owner-email"/.test(mpCode) && /testID="pm-units"/.test(mpCode) && /testID="pm-notes"/.test(mpCode));
  // Review round 2: an input whose onChangeText is a no-op still "exists".
  // Each input's own opening tag must feed its state setter.
  const inputTag = (testId: string): string => {
    const at = mpCode.indexOf(`testID="${testId}"`);
    return at < 0 ? '' : mpCode.slice(mpCode.lastIndexOf('<TextInput', at), mpCode.indexOf('/>', at) + 2);
  };
  for (const [id, setter, value] of [['pm-owner-email', 'setEOwnerEmail', 'eOwnerEmail'], ['pm-units', 'setEUnits', 'eUnits'], ['pm-notes', 'setENotes', 'eNotes']] as const) {
    const tag = inputTag(id);
    ok(`${id} is a live input: value={${value}} onChangeText={${setter}}`,
      tag.startsWith('<TextInput') && tag.includes(`value={${value}}`) && tag.includes(`onChangeText={${setter}}`) && !/editable=\{false\}/.test(tag), tag);
  }
  const save = mpCode.slice(mpCode.indexOf('const saveEdit'), mpCode.indexOf('const handleDelete'));
  // Review round 1: the save sends only what changed since the sheet opened
  // (propertyMirror.propertyEditUpdates), so the three fields are pinned by
  // running that function, plus the wiring that feeds it.
  const opened = pm.propertyEditForm({ name: 'Maple' });
  const three = pm.propertyEditUpdates(opened, { ...opened, ownerEmail: ' o@x.com ', units: '12', notes: ' Gate 4 ' });
  ok('saveEdit writes ownerEmail, units and notes',
    three.ownerEmail === 'o@x.com' && three.units === 12 && three.notes === 'Gate 4'
    && /ownerEmail: eOwnerEmail, units: eUnits, notes: eNotes/.test(save), JSON.stringify(three));
  const loaded = pm.propertyEditForm({ name: 'M', ownerEmail: 'o@x.com', units: 3, notes: 'n' });
  ok('openEdit loads all three from the property',
    loaded.ownerEmail === 'o@x.com' && loaded.units === '3' && loaded.notes === 'n'
    && /setEOwnerEmail\(f\.ownerEmail\)/.test(mpCode) && /setEUnits\(f\.units\)/.test(mpCode) && /setENotes\(f\.notes\)/.test(mpCode));
  ok('the sheet says the owner email grants nothing', /MAGE does not email the owner or give them access to anything/.test(mpCode));
  ok('the owner email reaches no invite, portal or grant from this screen',
    !/project-invite|addCollaborator|client_portal|invites|functions\.invoke|sendInvite/.test(mpCode));
  ok('units: whole numbers only', pm.parseUnitsInput('12') === 12 && pm.parseUnitsInput(' 1,200 ') === 1200
    && pm.parseUnitsInput('') === undefined && pm.parseUnitsInput('2.5') === undefined && pm.parseUnitsInput('-3') === undefined
    && pm.parseUnitsInput('abc') === undefined);
  ok('a bad unit count blocks Save (not silently dropped)',
    /const unitsInvalid = eUnits\.trim\(\) !== '' && parseUnitsInput\(eUnits\) === undefined;/.test(mpCode)
    && /disabled=\{!eName\.trim\(\) \|\| unitsInvalid\}/.test(mpCode));
  ok('the "{units} units" tag can now render', /\{!!property\.units && <View style=\{styles\.tag\}><Text style=\{styles\.tagText\}>\{property\.units\} units/.test(mpCode));
  // And the mirror carries them (a column nobody could fill is now filled).
  const row = pm.propertyToRow({ id: 'p', name: 'n', ownerEmail: 'o@x.com', units: 12, notes: 'gate 1234', createdAt: 'a', updatedAt: 'b' }, 'u');
  ok('owner email, units and notes reach their columns', row.owner_email === 'o@x.com' && row.units === 12 && row.notes === 'gate 1234');
}

console.log('\n── budget keeps its cents ──');
{
  ok('"$1,234.56" -> 1234.56', pm.parseBudgetInput('$1,234.56') === 1234.56);
  ok('"99.999" rounds to the cent, not the dollar', pm.parseBudgetInput('99.999') === 100 && pm.parseBudgetInput('12.345') === 12.35
    && pm.parseBudgetInput('450.5') === 450.5);
  ok('blank / zero / junk -> no budget', pm.parseBudgetInput('') === undefined && pm.parseBudgetInput('0') === undefined
    && pm.parseBudgetInput('abc') === undefined);
  // Review round 2: the handler passes parseBudgetInput's result straight
  // through; wrapping it (Math.round, toFixed, parseInt) would drop cents.
  const addWo = mpCode.slice(mpCode.indexOf('const handleAddWo'), mpCode.indexOf('});', mpCode.indexOf('const handleAddWo')));
  ok('managed-property uses it, unwrapped, and no longer rounds to whole dollars',
    /^\s*budget: parseBudgetInput\(woBudget\),$/m.test(addWo) && (addWo.match(/parseBudgetInput\(/g) ?? []).length === 1
    && !/Math\.(round|floor|trunc|ceil)|toFixed|parseInt/.test(addWo) && !/Math\.round\(budgetNum\)/.test(mpCode), addWo);
}

console.log('\n── the portfolio is in "Export my data" ──');
{
  const stamp = { createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' };
  const all = {
    managedProperties: [{ id: 'mp1', name: 'Maple Court', address: '12 Maple St', units: 12, ownerName: 'Oak LLC', ownerEmail: 'o@x.com', ...stamp }],
    workOrders: [{ id: 'wo1', propertyId: 'mp1', title: 'Sink, "leaking"', priority: 'high', status: 'assigned', budget: 1234.5,
      assignedContactName: 'ABC Electric', ...stamp }],
  } as unknown as Parameters<typeof ex.buildExportPayload>[0];
  const payload = ex.buildExportPayload(all, { format: 'both' });
  ok('an all-projects export carries managed properties and work orders',
    payload.managedProperties.length === 1 && payload.workOrders.length === 1);
  const single = ex.buildExportPayload(all, { format: 'both', projectId: 'p1' });
  ok('a single-project export does not (a portfolio belongs to no project)',
    single.managedProperties.length === 0 && single.workOrders.length === 0);
  const csvs = ex.payloadToCsvs(payload);
  ok('CSV: managedProperties and workOrders files are written', typeof csvs.managedProperties === 'string' && typeof csvs.workOrders === 'string');
  const woLine = (csvs.workOrders ?? '').trim().split('\n')[1] ?? '';
  ok('work-order CSV names the property, escapes quotes and keeps the budget to the cent',
    woLine.includes('Maple Court') && woLine.includes('"Sink, ""leaking"""') && woLine.includes('1234.50'), woLine);
  ok('the CSV line in the README names them', /managed properties/.test(ex.csvEntityLine(csvs)) && /work orders/.test(ex.csvEntityLine(csvs)));
  const none = ex.payloadToCsvs(ex.buildExportPayload({}, { format: 'csv' }));
  ok('no portfolio -> no empty portfolio files for a contractor', !('managedProperties' in none) && !('workOrders' in none));
  const readme = ex.buildReadmeText(payload, { format: 'both' });
  ok('README counts them', /Managed properties: 1/.test(readme) && /Work orders:\s+1/.test(readme));
  const screen = code(read('app/data-export.tsx'));
  ok('the export screen reads PropertyContext and passes the portfolio in',
    /const \{ properties: managedProperties, workOrders \} = useProperties\(\);/.test(screen)
    && /managedProperties,\s*workOrders,\s*aiaPayApps,/.test(screen));
  ok('the screen lists them under WHAT\'S INCLUDED when there is a portfolio',
    /<SummaryLine label="Managed properties" value=\{totals\.managedProperties\} \/>/.test(screen)
    && /<SummaryLine label="Work orders" value=\{totals\.workOrders\} \/>/.test(screen));
}

console.log('\n── stale comments, colours, the AI mark ──');
{
  const types = read('types/index.ts');
  // Review round 2: judged on the PM comment block itself, in any wording.
  const pmBlockAt = types.indexOf('export interface ManagedProperty');
  const pmBlock = types.slice(types.lastIndexOf('\n\n', types.lastIndexOf('// A WorkOrder bridges', pmBlockAt)), pmBlockAt);
  ok('types/index.ts no longer says the portfolio is local-first with sync to follow',
    pmBlock.includes('// A WorkOrder bridges') && /Server-backed: both collections mirror/.test(pmBlock)
    && !/local-first|sync\s*(\n\/\/\s*)?can follow|server sync/i.test(pmBlock)
    && !/server sync\s*\n?\/\/\s*can follow/.test(types), pmBlock.slice(0, 200));
  ok('PropertyManagerHome no longer says "All data is local"', !/All data is local/.test(home));
  for (const [f, src] of [['app/work-order.tsx', woCode], ['app/managed-property.tsx', mpCode]] as const) {
    ok(`${f}: no hard-coded status/priority colour map, no pre-rebrand orange`,
      !/STATUS_COLORS|PRIORITY_COLORS/.test(src) && !/#FF6A1A/i.test(src)
      && !/#(0D6CB1|7A3FF2|C99700|16A34A|9CA3AF|DC2626)/i.test(src));
  }
  ok('both screens take status colours from theme tokens',
    /workOrderStatusTone\(themeColors,/.test(woCode) && /workOrderStatusTone\(themeColors,/.test(mpCode) && /workOrderPriorityTone\(themeColors,/.test(mpCode));
  // The tones are token pairs from the theme, in both themes.
  const colors = await import('../constants/colors');
  for (const mode of ['light', 'dark'] as const) {
    const t = { ...colors.Theme[mode], accent: '#2F6B3A', accentHot: '#2F6B3A', accentSoft: 'rgba(47,107,58,0.12)', accentLabel: '#2F6B3A', accentFill: '#2F6B3A' };
    const tones = (['open', 'posted_for_bids', 'assigned', 'in_progress', 'done', 'cancelled'] as const).map(st => pm.workOrderStatusTone(t, st));
    const tokenValues = new Set(Object.values(t));
    ok(`${mode}: every status tone is a theme token`, tones.every(x => tokenValues.has(x.fg) && tokenValues.has(x.bg)));
    ok(`${mode}: open is the warning pair, done the success pair`,
      pm.workOrderStatusTone(t, 'open').fg === t.warningLabel && pm.workOrderStatusTone(t, 'done').fg === t.successLabel);
    ok(`${mode}: emergency is the danger pair`, pm.workOrderPriorityTone(t, 'emergency').fg === t.dangerLabel);
  }
  ok('"Add property" uses the Plus icon, not the AI mark',
    !/MageAIMark/.test(homeCode) && /<Plus size=\{15\} color=\{Colors\.textOnAccent\}[^>]*\/>\s*<Text style=\{styles\.modalCtaText\}>Add property<\/Text>/.test(homeCode));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
if (fail) process.exit(1);
