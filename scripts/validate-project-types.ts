// scripts/validate-project-types.ts — fixq lane Q6.
//
// THE FOUNDER: "maybe add 'Other' section? I did a repiping project so not
// sure what category that would go under here". His live "piping" job is typed
// plumbing, but its scope answer reads "Bathroom Remodel": the "What kind of
// project?" chips had no trade jobs and no way out, the wizard seeded the raw
// id 'plumbing' (which lit no chip), and the AI was then told "Project type:
// Bathroom Remodel" and grounded Tile level with Plumbing.
//
// What this pins:
//   A. projectTypeLabel — people and the AI read a label or his words, never a
//      raw id ('new_build') and never the word "other" when he typed words.
//   B. the Other description: cleaned, capped at the column CHECK by CODE
//      POINTS, sent as NULL unless the type is 'other'.
//   C. the scope chips: the ten originals unchanged and in order, Plumbing /
//      Repipe and Electrical / Rewire added, every chip mapped, the old
//      substring mapper's answer kept for every original chip.
//   D. free text: repipe / PEX / copper → plumbing; rewire / panel upgrade →
//      electrical; HVAC and windows & doors → 'other' with his words.
//   E. the seed round-trips: every type opens the scope step on an answer
//      that maps back to it ('renovation' opens blank, as before).
//   F. grounding: a repipe reaches his Plumbing rate; the Plumbing chip does
//      not tie Tile any more.
//   G. wiring (source + pure calls): row mappers, the retry INSERT, the
//      migration's CHECK, the portal snapshot + page, data export, the job
//      list, JUDGES / portfolio treatment of 'other', no raw ids on screens.
//
// Run: bun run scripts/validate-project-types.ts

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (spec: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-project-types must run under bun (needs Bun.plugin to stub native modules)\n');
  process.exit(1);
}
Bun.plugin({
  name: 'project-types-stubs',
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source with line comments and JSX block comments removed. */
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail); }
}

const types = await import('../types');
const pt = await import('../utils/projectTypes');
const sq = await import('../utils/scopeQuestions');
const gc = await import('../utils/groundingChip');
const pure = await import('../utils/projectContextPure');
const hyd = await import('../utils/portalSnapshotHydrate');
const tm = await import('../utils/judges/typeMargin');
const prof = await import('../utils/portfolio/typeProfitability');
const bid = await import('../utils/autoBid');
const ex = await import('../utils/dataExport');

const { PROJECT_TYPES } = types;
const { projectTypeLabel, cleanProjectTypeOther, projectTypeOtherColumn, projectTypeOtherFromRow, projectTypeBlockReason, PROJECT_TYPE_OTHER_MAX } = pt;
const { projectTypeFromScopeAnswer, scopeAnswerForProject, isScopeTypeChip } = sq;
const CHIPS = sq.PROJECT_TYPES as readonly string[];

// ── A. labels ────────────────────────────────────────────────────────────────
console.log('\nA. projectTypeLabel');
ok('"other" is a real type with a label and a description', PROJECT_TYPES.some(t => t.id === 'other' && t.label === 'Other' && !!t.description));
ok('every type reads its own label — never the raw id', PROJECT_TYPES.filter(t => t.id !== 'other').every(t => projectTypeLabel({ type: t.id }) === t.label && !projectTypeLabel({ type: t.id }).includes('_')));
ok('new_build → "New Build" (the raw id the schedule wizard, reports and closeout used to print)', projectTypeLabel({ type: 'new_build' }) === 'New Build');
ok('an Other job reads HIS words', projectTypeLabel({ type: 'other', projectTypeOther: 'Whole-house repipe' }) === 'Whole-house repipe');
ok('…cleaned (whitespace collapsed and trimmed)', projectTypeLabel({ type: 'other', projectTypeOther: '  Whole-house \n repipe ' }) === 'Whole-house repipe');
ok('an Other job with no words (an old client) reads "Other", never "other"', projectTypeLabel({ type: 'other' }) === 'Other' && projectTypeLabel({ type: 'other', projectTypeOther: '   ' }) === 'Other');
ok('words on a NON-other job are ignored (stale description never shows)', projectTypeLabel({ type: 'roofing', projectTypeOther: 'Whole-house repipe' }) === 'Roofing');
ok('award_rfp\'s off-union id reads "Awarded bid"', projectTypeLabel({ type: 'awarded_rfp' }) === 'Awarded bid');
ok('an unknown id is title-cased, not printed raw', projectTypeLabel({ type: 'solar_carport' }) === 'Solar Carport');
ok('no type / no project → ""', projectTypeLabel({ type: '' }) === '' && projectTypeLabel(null) === '' && projectTypeLabel(undefined) === '');

// ── B. the description ───────────────────────────────────────────────────────
console.log('\nB. the Other description');
ok('cap is the column CHECK (60)', PROJECT_TYPE_OTHER_MAX === 60);
ok('non-string → ""', cleanProjectTypeOther(42) === '' && cleanProjectTypeOther(null) === '' && cleanProjectTypeOther(undefined) === '');
const long = 'x'.repeat(80);
ok('over-long is capped at 60', cleanProjectTypeOther(long).length === 60);
const emoji = 'a'.repeat(59) + '🔧🔧';
const cappedEmoji = cleanProjectTypeOther(emoji);
ok('the cap counts CODE POINTS (Postgres char_length) and never splits an emoji into a lone surrogate',
  Array.from(cappedEmoji).length === 60 && cappedEmoji.endsWith('🔧') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cappedEmoji), JSON.stringify(cappedEmoji));
ok('column: his words when the type is other', projectTypeOtherColumn({ type: 'other', projectTypeOther: ' Whole-house repipe ' }) === 'Whole-house repipe');
ok('column: NULL for every other type, even with stale words (leaving Other clears them)', PROJECT_TYPES.filter(t => t.id !== 'other').every(t => projectTypeOtherColumn({ type: t.id, projectTypeOther: 'stale' }) === null));
ok('column: NULL for other with blank words (never an empty string)', projectTypeOtherColumn({ type: 'other', projectTypeOther: '  ' }) === null);
ok('column: never longer than the CHECK', (projectTypeOtherColumn({ type: 'other', projectTypeOther: long }) ?? '').length <= 60);
ok('row: NULL / blank read as absent, words read cleaned', projectTypeOtherFromRow(null) === undefined && projectTypeOtherFromRow('') === undefined && projectTypeOtherFromRow(' Repipe ') === 'Repipe');
ok('picker block: Other with no words is blocked, and the reason says what to type', (projectTypeBlockReason('other', ' ') ?? '').includes('Whole-house repipe'));
ok('picker block: Other with words, or any other type, saves', projectTypeBlockReason('other', 'Repipe') === null && projectTypeBlockReason('roofing', '') === null);

// ── C. scope chips ───────────────────────────────────────────────────────────
console.log('\nC. "What kind of project?" chips');
const ORIGINAL = ['New Build', 'Full Remodel', 'Kitchen Remodel', 'Bathroom Remodel', 'Addition', 'Basement Finish', 'ADU / Backyard Build', 'Commercial TI', 'Roof Replacement', 'Deck / Outdoor'];
ok('the ten original chips are unchanged and in order', JSON.stringify(CHIPS.slice(0, 10)) === JSON.stringify(ORIGINAL));
ok('Plumbing / Repipe and Electrical / Rewire are added after them', CHIPS[10] === 'Plumbing / Repipe' && CHIPS[11] === 'Electrical / Rewire' && CHIPS.length === 12);
// The wizard's mapper before Q6, verbatim, as the reference for the originals.
function oldMapProjectType(answer: string): string {
  const a = answer.toLowerCase();
  if (a.includes('new build') || a.includes('new construction') || a.includes('adu')) return 'new_build';
  if (a.includes('addition')) return 'addition';
  if (a.includes('commercial') || a.includes(' ti')) return 'commercial';
  if (a.includes('roof')) return 'roofing';
  if (a.includes('deck') || a.includes('outdoor') || a.includes('landscap')) return 'landscape';
  if (a.includes('remodel')) return 'remodel';
  return 'renovation';
}
ok('every original chip maps exactly as it did before', ORIGINAL.every(c => projectTypeFromScopeAnswer(c).type === oldMapProjectType(c)),
  ORIGINAL.map(c => `${c}:${projectTypeFromScopeAnswer(c).type}/${oldMapProjectType(c)}`).join(' '));
ok('Plumbing / Repipe → plumbing, Electrical / Rewire → electrical (ids the app already has)', projectTypeFromScopeAnswer('Plumbing / Repipe').type === 'plumbing' && projectTypeFromScopeAnswer('Electrical / Rewire').type === 'electrical');
ok('a chip carries no description', CHIPS.every(c => projectTypeFromScopeAnswer(c).projectTypeOther === undefined));
ok('BEFORE: the old mapper sent a repipe to renovation (the repro)', oldMapProjectType('Plumbing / Repipe') === 'renovation' && oldMapProjectType('Whole-house repipe') === 'renovation');
ok('step 0 is still blocked on a blank or whitespace answer, and says what to do', !sq.stepCanAdvance(0, { ...sq.INITIAL_SCOPE, projectType: '   ' }) && /tap Other/.test(sq.stepBlockReason(0, { ...sq.INITIAL_SCOPE }) ?? ''));
ok('step 0 advances on his own words', sq.stepCanAdvance(0, { ...sq.INITIAL_SCOPE, projectType: 'Whole-house repipe' }));

// ── D. free text ─────────────────────────────────────────────────────────────
console.log('\nD. free text → type');
const map = (s: string) => projectTypeFromScopeAnswer(s);
for (const [s, want] of [
  ['Whole-house repipe', 'plumbing'], ['PEX repipe', 'plumbing'], ['Copper repipe', 'plumbing'], ['Re-pipe the house', 'plumbing'],
  ['piping', 'plumbing'], ['Sewer line replacement', 'plumbing'],
  ['Rewire', 'electrical'], ['Whole house rewire', 'electrical'], ['Panel upgrade', 'electrical'], ['Service upgrade to 200A', 'electrical'],
  ['Kitchen remodel with new plumbing', 'remodel'], ['Hardwood flooring', 'flooring'], ['Exterior paint', 'painting'], ['Driveway', 'concrete'],
  ['Flooring', 'flooring'], ['plumbing', 'plumbing'], ['new_build', 'new_build'], ['Landscaping', 'landscape'], ['Renovation', 'renovation'],
] as const) ok(`"${s}" → ${want}`, map(s).type === want && map(s).projectTypeOther === undefined, JSON.stringify(map(s)));
ok('"Bathroom tile" is NOT commercial any more (the old " ti" substring bug)', map('Bathroom tile job').type !== 'commercial' && oldMapProjectType('Bathroom tile job') === 'commercial');
ok('HVAC goes through Other with his words', JSON.stringify(map('HVAC changeout')) === JSON.stringify({ type: 'other', projectTypeOther: 'HVAC changeout' }));
ok('Windows & Doors goes through Other with his words', JSON.stringify(map('Windows & Doors')) === JSON.stringify({ type: 'other', projectTypeOther: 'Windows & Doors' }));
ok('an Other answer is capped for the column', (map('Z'.repeat(90)).projectTypeOther ?? '').length === 60);
ok('blank → renovation (the app default, unchanged)', map('').type === 'renovation' && map('  ').type === 'renovation');

// ── E. seeds round-trip ──────────────────────────────────────────────────────
console.log('\nE. the scope step opens on the job\'s own type');
ok('the founder\'s "piping" job (type plumbing) opens on the Plumbing / Repipe CHIP', scopeAnswerForProject({ type: 'plumbing' }) === 'Plumbing / Repipe' && isScopeTypeChip(scopeAnswerForProject({ type: 'plumbing' })));
ok('BEFORE: the wizard seeded the raw id, which lit no chip', !isScopeTypeChip('plumbing'.replace(/_/g, ' ')));
const roundTrip = PROJECT_TYPES.filter(t => t.id !== 'renovation' && t.id !== 'other').map(t => {
  const seed = scopeAnswerForProject({ type: t.id });
  return { id: t.id, seed, back: projectTypeFromScopeAnswer(seed).type };
});
ok('every type but renovation seeds an answer that maps back to it', roundTrip.every(r => r.seed !== '' && r.back === r.id), JSON.stringify(roundTrip.filter(r => r.back !== r.id)));
ok('an Other job opens on HIS words and maps back to other + the same words', (() => {
  const seed = scopeAnswerForProject({ type: 'other', projectTypeOther: 'HVAC changeout' });
  const back = projectTypeFromScopeAnswer(seed);
  return seed === 'HVAC changeout' && back.type === 'other' && back.projectTypeOther === 'HVAC changeout';
})());
ok('renovation (the New Project default) and unknown ids open blank, as the wizard always did', scopeAnswerForProject({ type: 'renovation' }) === '' && scopeAnswerForProject({ type: 'awarded_rfp' }) === '' && scopeAnswerForProject(null) === '');
const wizard = code(read('app/estimate-wizard.tsx'));
ok('the wizard seeds through scopeAnswerForProject, not the raw id', /const seedType = scopeAnswerForProject\(scopedProject\);/.test(wizard) && !/type\.replace\(\/_\/g, ' '\)/.test(wizard));
ok('the wizard writes a new project through projectTypeFromScopeAnswer (type + his words)', /\.\.\.projectTypeFromScopeAnswer\(answers\.projectType\),/.test(wizard) && !/function mapProjectType/.test(wizard));
const scopeScreen = code(read('app/project-scope.tsx'));
ok('the scope screen seeds a job with no scope from its type', /setAnswers\(\{ \.\.\.INITIAL_SCOPE, projectType: scopeAnswerForProject\(project\) \}\)/.test(scopeScreen));

// ── F. grounding ─────────────────────────────────────────────────────────────
console.log('\nF. which of his rates reach the prompt');
const rel = (trade: string, projectType: string, scope = '') => gc.scopeRelevance({ trade }, { projectType, scope });
ok('a repipe reaches his Plumbing rate (type + scope: was 0)', rel('Plumbing', 'Repipe', 'Repipe whole house with PEX') === 3, String(rel('Plumbing', 'Repipe', 'Repipe whole house with PEX')));
ok('"Whole-house repipe" as the type alone reaches Plumbing', rel('Plumbing', 'Whole-house repipe') === 1);
ok('the Plumbing / Repipe chip: Plumbing 1, Tile 0 (no more tie)', rel('Plumbing', 'Plumbing / Repipe') === 1 && rel('Tile', 'Plumbing / Repipe') === 0);
ok('the Electrical / Rewire chip reaches Electrical; "rewire" in the scope names it', rel('Electrical', 'Electrical / Rewire') === 1 && rel('Electrical', '', 'Rewire the upstairs') === 2);
ok('"new PEX lines" in a bathroom scope names Plumbing', rel('Plumbing', 'Bathroom Remodel', 'new PEX lines to the vanity') === 3);
ok('unchanged: a bathroom remodel still grounds Plumbing and Tile', rel('Plumbing', 'Bathroom Remodel') === 1 && rel('Tile', 'Bathroom Remodel') === 1);
ok('unchanged: "waterproofing" still does not reach Roofing', rel('Roofing', '', 'waterproofing the shower pan') === 0);

// ── G. wiring ────────────────────────────────────────────────────────────────
console.log('\nG. wiring');
const PC = code(read('contexts/ProjectContext.tsx'));
const base = PC.slice(PC.indexOf('const base = {'), PC.indexOf('};', PC.indexOf('const base = {')));
ok('the sync\'s base row sends project_type_other through projectTypeOtherColumn', /project_type_other: projectTypeOtherColumn\(project\),/.test(base));
ok('the loader reads it back through projectTypeOtherFromRow', /projectTypeOther: projectTypeOtherFromRow\(r\.project_type_other\),/.test(PC));
const baseProject = { id: 'p1', name: 'Piping', location: '', squareFootage: 0, quality: 'standard', description: '', createdAt: '', updatedAt: '', estimate: null, schedule: null, status: 'draft' } as const;
ok('the Retry INSERT carries his words for an Other job', pure.localOnlyProjectInsertRow({ ...baseProject, type: 'other', projectTypeOther: 'Whole-house repipe' } as never, 'u1').project_type_other === 'Whole-house repipe');
ok('…and NULL for a typed job', pure.localOnlyProjectInsertRow({ ...baseProject, type: 'plumbing', projectTypeOther: 'stale' } as never, 'u1').project_type_other === null);
const migName = readdirSync(join(ROOT, 'supabase/migrations')).find(f => /_project_type_other\.sql$/.test(f));
const mig = migName ? read(`supabase/migrations/${migName}`) : '';
ok('the migration adds the nullable column', /add column if not exists project_type_other text;/.test(mig));
ok('the migration\'s CHECK is the client cap', /char_length\(project_type_other\) <= 60/.test(mig) && PROJECT_TYPE_OTHER_MAX === 60);
ok('the migration adds no enum / CHECK on projects.type', !/check \(type\b/i.test(mig) && !/create type/i.test(mig));
ok('the code names the migration it needs', read('utils/projectTypes.ts').includes(migName ?? '<none>'));

const snap = code(read('utils/portalSnapshot.ts'));
ok('the portal snapshot sends the label beside the id', /type: project\.type,\s*typeLabel: projectTypeLabel\(project\) \|\| undefined,/.test(snap));
const page = read('marketing/portal/index.html');
ok('the portal page prints the label, falling back to the id only for an old snapshot', /text: project\.typeLabel \|\| statusLabel\(project\.type\)/.test(page) && !/if \(project\.type\) metaItems\.push\(\{ icon: 'home', text: statusLabel\(project\.type\) \}\)/.test(page));
const hydrated = hyd.hydratePortalSnapshot({ project: { id: 'p1', name: 'Piping', type: 'other', typeLabel: 'Whole-house repipe' }, company: { name: 'X' } } as never, 'portal-1');
ok('the in-app portal keeps an Other job as other + his words (was coerced to renovation)', hydrated.project.type === 'other' && projectTypeLabel(hydrated.project) === 'Whole-house repipe');

const payload = ex.buildExportPayload({ projects: [{ ...baseProject, type: 'other', projectTypeOther: 'Whole-house repipe' }, { ...baseProject, id: 'p2', type: 'new_build' }] } as never, { format: 'csv' } as never);
const csv = ex.payloadToCsvs(payload).projects ?? '';
const [head, row1, row2] = csv.trim().split('\n');
ok('data export: a typeLabel column beside the machine id', /^id,name,type,typeLabel,/.test(head ?? ''), head);
ok('data export: his words for the Other job, "New Build" (not new_build) for the other', (row1 ?? '').includes(',other,Whole-house repipe,') && (row2 ?? '').includes(',new_build,New Build,'), `${row1} | ${row2}`);

// A closed job with a real margin basis (validate-judges-type-margin's
// fixture): estimate 100k, one traced 70k commitment → 30% realized.
const closedJob = (id: string, type: string) => ({
  id, name: id, type, status: 'closed',
  linkedEstimate: { id: `${id}-e`, items: [
    { materialId: 'm1', name: 'Framing', category: 'Framing', unit: 'sf', quantity: 100, unitPrice: 100, bulkPrice: 100, markup: 0, usesBulk: false, lineTotal: 10000, supplier: '' },
  ], globalMarkup: 20, baseTotal: 100000, markupTotal: 0, grandTotal: 100000, createdAt: '2026-01-01' },
});
const tracedCommitment = (projectId: string) => ({
  id: `${projectId}-c1`, projectId, number: 'C-001', type: 'subcontract', description: 'Sub', amount: 70000,
  changeAmount: 0, paidToDate: 70000, signedDate: '2026-01-15', linkedEstimateItems: ['m1'], status: 'active',
});
ok('JUDGES: the same closed job DOES count as history when typed (fixture has a margin basis)', (() => {
  const r = tm.aggregateTypeMargin([closedJob('r1', 'plumbing')] as never, 'plumbing', [tracedCommitment('r1')] as never, []);
  return r.jobCount === 1 && r.avgMarginPct !== null;
})());
ok('JUDGES: an "other" type margin is never a verdict basis (no history, like a new type)', (() => {
  const r = tm.aggregateTypeMargin([closedJob('o1', 'other'), closedJob('o2', 'other')] as never, 'other', [tracedCommitment('o1'), tracedCommitment('o2')] as never, []);
  return r.avgMarginPct === null && r.jobCount === 0;
})());
ok('portfolio: the Other row is labelled "Other (mixed)"', prof.buildTypeProfitability([], [], []).rows.some((r: { type: string; label: string }) => r.type === 'other' && r.label === 'Other (mixed)'));
ok('an Other job is a residential bid category (not dropped from bid history)', bid.PROJECT_TYPE_TO_BID_CATEGORY.other === 'residential');

// Surfaces that printed the raw id ("new_build") now print the label.
const RAW: Array<[string, RegExp]> = [
  ['app/schedule-wizard.tsx', /· \{p\.type\}/],
  ['app/data-export.tsx', /\{p\.type\}\{displayText/],
  ['app/client-update.tsx', /\{p\.type\}\{displayText/],
  ['components/AIProjectReport.tsx', /\{project\.type\}\{displayText/],
  ['utils/closeoutPacketGenerator.ts', /escapeHtml\(project\.type\)/],
  ['utils/pdfGenerator.ts', /project\.type\.replace\(/],
  ['utils/aiService.ts', /Type: \$\{p(roject)?\.type\}/],
  ['utils/autoScheduleFromEstimate.ts', /Type: \$\{project\.type\}/],
  ['utils/copilot/scheduleBuilder/buildAnswersPrompt.ts', /line\('TYPE', project\?\.type\)/],
  ['utils/copilot/estimate/estimateGrounding.ts', /`, \$\{project\.type\}`/],
  // Fix round 1 (review): the sites the investigation's list missed.
  ['app/scope-sheet.tsx', /\{project\.type \|\| 'Project'\}/],
  ['utils/scopeSheet.ts', /Project type: \$\{project\.type/],
  ['utils/permitRoadmap.ts', /PROJECT TYPE: \$\{project\.type/],
  ['app/budget-dashboard.tsx', /for a \$\{project\.type\} project/],
  ['utils/profitLeak/scopeSummary.ts', /meta\.push\(String\(project\.type\)\)/],
  ['utils/voiceActionParser.ts', /`Type: \$\{project\.type\}`/],
  ['utils/voiceFormParsers.ts', /` \(\$\{project\.type\}\)`/],
  // Edge functions print projectType straight into their prompts
  // (analyze-takeoff/-drawings/-photos, analyze-plan-code), so the client
  // sends the label — no function change needed.
  ['app/takeoff.tsx', /projectType: project\?\.type\b/],
  ['app/cost-xray.tsx', /projectType: project\?\.type\b/],
  ['app/ai-punch.tsx', /projectType: project\?\.type\b/],
  ['app/photo-triage.tsx', /projectType: project\?\.type\b/],
  ['app/drawing-analyzer.tsx', /projectType: project\?\.type\b/],
  ['app/plan-intelligence.tsx', /projectType: project\?\.type\b/],
  ['app/(tabs)/construction-ai/index.tsx', /projectType: planProject\.type\b/],
  // Fix round 2 (review): pages the owner / a prospect reads, and the
  // weekly-summary JSON the AI reads.
  ['utils/publicProfileSnapshot.ts', /type: project\.type,/],
  ['utils/aiService.ts', /\btype: p\.type,/],
  ['utils/passport/passportInputs.ts', /type: String\(p\.type/],
];
for (const [f, re] of RAW) ok(`${f}: no raw type id printed`, !re.test(code(read(f))) && /projectTypeLabel\(/.test(read(f)));
const quick = code(read('components/AIQuickEstimate.tsx'));
ok('Quick Estimate shows every type (Painting, Plumbing, Electrical, Concrete were cut by slice(0, 8))', !/PROJECT_TYPES\.slice\(0, 8\)/.test(quick) && /PROJECT_TYPES\.map\(pt =>/.test(quick));
ok('Quick Estimate sends the AI the label (his words for Other), not the id', /const typeText = projectTypeLabel\(\{ type: projectType, projectTypeOther \}\);/.test(quick) && /\n\s*typeText,\n/.test(quick));
const judgesSrc = code(read('app/judges.tsx'));
ok('JUDGES describe mode sends the AI the label (his words for Other), not the id', /projectType: projectTypeLabel\(\{ type: projectType, projectTypeOther \}\),/.test(judgesSrc));
// Review: both standalone pickers showed Other with no box, so the AI got
// the bare word "Other". Now: a box, and the button is blocked (and says why)
// until it has words.
for (const [name, src, disabledRe] of [
  ['JUDGES', judgesSrc, /disabled=\{!scope\.trim\(\) \|\| loading \|\| markupUnset \|\| !!typeBlock\}/],
  ['Quick Estimate', quick, /disabled=\{!description\.trim\(\) \|\| !!typeBlock\}/],
] as const) {
  ok(`${name}: Other opens a "describe the job" box capped at the column`, /projectType === 'other' \? \(/.test(src) && /maxLength=\{PROJECT_TYPE_OTHER_MAX\}/.test(src) && /value=\{projectTypeOther\}/.test(src));
  ok(`${name}: Other with no words blocks the button, and the reason is shown under the box`, /const typeBlock = projectTypeBlockReason\(projectType, projectTypeOther, 'ai'\);/.test(src) && disabledRe.test(src) && /\{typeBlock \? <Text/.test(src));
}
ok('Quick Estimate grounds an Other job on his words', /projectType: projectType === 'other' \? typeText : projectType/.test(quick));
ok('the AI-only block reason names what to type and promises no job-list / PDF / portal', (() => {
  const r = projectTypeBlockReason('other', '', 'ai') ?? '';
  return r.includes('Whole-house repipe') && !/job list|PDF|portal/.test(r);
})());

const home = code(read('app/(tabs)/(home)/index.tsx'));
ok('New Project: Other opens a description box capped at the column', /projectType === 'other' \? \(/.test(home) && /maxLength=\{PROJECT_TYPE_OTHER_MAX\}/.test(home));
ok('New Project: Create refuses Other with no words, and says why', /const typeBlock = projectTypeBlockReason\(projectType, projectTypeOther\);\s*if \(typeBlock\) \{\s*showAlert\('Describe the job', typeBlock\);\s*return;/.test(home));
ok('New Project: the words are saved only for Other', /\.\.\.\(projectType === 'other' \? \{ projectTypeOther: cleanProjectTypeOther\(projectTypeOther\) \} : \{\}\),/.test(home));
const detail = code(read('app/project-detail.tsx'));
ok('Edit project: Other opens a description box, seeded from the job', /editType === 'other' \? \(/.test(detail) && /setEditTypeOther\(project\.projectTypeOther \?\? ''\);/.test(detail));
ok('Edit project: Save refuses Other with no words, and says why', /const typeBlock = projectTypeBlockReason\(editType, editTypeOther\);\s*if \(typeBlock\) \{\s*showAlert\('Describe the job', typeBlock\);\s*return;/.test(detail));
ok('Edit project: leaving Other drops the words', /projectTypeOther: editType === 'other' \? cleanProjectTypeOther\(editTypeOther\) : undefined,/.test(detail));
const row = code(read('components/ProjectRow.tsx'));
const card = code(read('components/ProjectCard.tsx'));
ok('job list (row + card): an Other job shows his words, with a wrench icon', /project\.type === 'other' \? \(/.test(row) && /projectTypeLabel\(project\)/.test(row) && /project\.type === 'other' \? projectTypeLabel\(project\) : 'Project'/.test(card) && /other: 'Wrench'/.test(row) && /other: 'Wrench'/.test(card));
const stepper = code(read('components/ScopeQuestionStepper.tsx'));
ok('scope stepper: an Other chip whose box is capped at the column', /Other \(describe it\)/.test(stepper) && /maxLength=\{SCOPE_TYPE_OTHER_MAX\}/.test(stepper) && sq.SCOPE_TYPE_OTHER_MAX === PROJECT_TYPE_OTHER_MAX);

// ── H. voice and copilot pickers ─────────────────────────────────────────────
// Review: the copilot interview and both voice parsers still forced a closed
// 12-id enum with .catch('renovation'), so a spoken "HVAC changeout" silently
// became a renovation. They now take an id OR his words, resolved by one rule.
console.log('\nH. voice / copilot: an off-list job lands on Other, never silently on renovation');
const { projectTypeFromParsedType } = sq;
const parsed = (v: unknown) => JSON.stringify(projectTypeFromParsedType(v));
ok('"HVAC changeout" → other + his words', parsed('HVAC changeout') === JSON.stringify({ type: 'other', projectTypeOther: 'HVAC changeout' }));
ok('"Windows & doors" → other + his words', parsed('Windows & doors') === JSON.stringify({ type: 'other', projectTypeOther: 'Windows & doors' }));
ok('"whole-house repipe" → plumbing; "panel upgrade" → electrical', parsed('whole-house repipe') === JSON.stringify({ type: 'plumbing' }) && parsed('panel upgrade') === JSON.stringify({ type: 'electrical' }));
ok('an id still maps to itself (new_build, landscape, renovation)', ['new_build', 'landscape', 'renovation', 'concrete'].every(id => projectTypeFromParsedType(id)?.type === id));
ok('nothing / junk / a bare "other" names no job → null (caller asks or keeps its default)', [undefined, null, 42, '', '  ', 'other', 'Other', 'none', 'unknown', 'null'].every(v => projectTypeFromParsedType(v) === null));
const vap = code(read('utils/voiceActionParser.ts'));
const vfp = code(read('utils/voiceFormParsers.ts'));
const CLOSED_ENUM = /z\.enum\(\['new_build','renovation'/;
ok('voice action parser: projectType is no longer a closed enum', !CLOSED_ENUM.test(vap) && /projectType: z\.string\(\)\.catch\('renovation'\)\.default\('renovation'\),/.test(vap));
ok('voice form parser: type is no longer a closed enum', !CLOSED_ENUM.test(vfp) && /type: z\.string\(\)\.catch\('renovation'\)\.default\('renovation'\),/.test(vfp));
ok('both voice prompts tell the model to write his words when no type fits', /write the kind of job in 2-5 of his words instead/.test(vap) && /write the kind of job in 2-5 of his words instead/.test(vfp));
const mic = code(read('components/UniversalMicButton.tsx'));
ok('mic: the voice project is created through projectTypeFromParsedType (type + his words), not a cast', /const voiceType = projectTypeFromParsedType\(parsed\.projectType\) \?\? \{ type: 'renovation' as const \};/.test(mic) && /type: voiceType\.type,/.test(mic) && !/type: \(parsed\.projectType \|\| 'renovation'\) as never/.test(mic));
ok('mic: the preview shows the resolved label, not the raw id', /value=\{projectTypeLabel\(projectTypeFromParsedType\(parsed\.projectType\)/.test(mic));
ok('New Project voice fill: resolved type + his words', /const heardType = projectTypeFromParsedType\(partial\.type\)/.test(home) && /setProjectType\(heardType\.type\)/.test(home) && /setProjectTypeOther\(heardType\.projectTypeOther \?\? ''\)/.test(home));

const npc = (await import('../utils/copilot/newProject/newProjectCapability')).newProjectCapability;
const npGround = (await import('../utils/copilot/newProject/newProjectGrounding')).buildNewProjectGrounding;
const merged = npc.mergeDraft!({}, { name: 'Lee HVAC', type: 'HVAC changeout' } as never, { transcript: 'HVAC changeout at the Lee house' } as never);
ok('copilot: "HVAC changeout" becomes type other with his words in the draft', merged.type === 'other' && merged.typeOther === 'HVAC changeout', JSON.stringify(merged));
ok('copilot: "whole-house repipe" becomes plumbing', npc.mergeDraft!({}, { type: 'whole-house repipe' } as never, {} as never).type === 'plumbing');
ok('copilot: a bare "other" / null leaves the type unset, so the gap still asks', npc.mergeDraft!({}, { type: 'other' } as never, {} as never).type == null && npc.mergeDraft!({}, { type: null } as never, {} as never).type == null);
ok('copilot: a later turn without a type keeps the words', npc.mergeDraft!(merged, { type: null } as never, {} as never).typeOther === 'HVAC changeout');
const added: Array<Record<string, unknown>> = [];
const npCtx = (projects: unknown[]) => ({ ctx: { projects, addProject: (p: Record<string, unknown>) => added.push(p) } }) as never;
await npc.apply!(merged, npCtx([]));
const made = added[0] ?? {};
ok('copilot apply: the project is created as other + his words', made.type === 'other' && made.projectTypeOther === 'HVAC changeout', JSON.stringify({ type: made.type, other: made.projectTypeOther }));
ok('copilot apply: the scope answer is his words (the scope screen opens on Other with them)', (made.scope as { projectType?: string } | undefined)?.projectType === 'HVAC changeout');
added.length = 0;
await npc.apply!({ name: 'X', type: 'other', typeOther: null } as never, npCtx([]));
ok('copilot apply: Other with no words falls back to renovation (never a wordless Other job)', added[0]?.type === 'renovation' && added[0]?.projectTypeOther === undefined);
added.length = 0;
await npc.apply!({ name: 'Y', type: 'new_build' } as never, npCtx([]));
ok('copilot apply: a typed job carries no words; its scope answer lights the chip', added[0]?.type === 'new_build' && added[0]?.projectTypeOther === undefined && (added[0]?.scope as { projectType?: string }).projectType === 'New Build');
const g = await npGround(npCtx([{ type: 'other' }, { type: 'other' }, { type: 'roofing' }]));
ok('copilot grounding: pooled Other jobs are never "what you usually build"', (g.data as { usualType?: string | null }).usualType === 'roofing' && !g.facts.some(f => /other/i.test(f)), JSON.stringify(g));

console.log('\nI. what a prospect / homeowner / the AI reads (fix round 2)');
{
  const pps = await import('../utils/publicProfileSnapshot');
  const pin = await import('../utils/passport/passportInputs');
  const cp = await import('../utils/passport/consumerPassport');
  const base = { id: 'p1', name: 'Lee house', location: '1 Elm St', status: 'closed', createdAt: '2026-01-01', squareFootage: 0,
    closedAt: '2026-04-30', publicProfile: { enabled: true } };
  const repipe = { ...base, type: 'other', projectTypeOther: 'Whole-house repipe' };
  const nb = { ...base, id: 'p2', type: 'new_build' };
  const snap = (p: unknown) => pps.buildPublicProfileSnapshot({ project: p as never, settings: {} as never }).project.type;
  ok('public portfolio: an Other job shows his words, not "other"', snap(repipe) === 'Whole-house repipe', String(snap(repipe)));
  ok('public portfolio: a typed job shows its label, not "new_build"', snap(nb) === 'New Build', String(snap(nb)));
  ok('public portfolio: no type → no field (the page skips it)', snap({ ...base, type: undefined }) === undefined);
  const jobs = pin.passportJobsFromProjects([repipe, nb] as never, undefined);
  ok('Home Passport jobs carry the label / his words', jobs[0].type === 'Whole-house repipe' && jobs[1].type === 'New Build', JSON.stringify(jobs.map(j => j.type)));
  const passport = cp.buildConsumerPassport({ projects: jobs, nowMs: Date.parse('2026-09-24T00:00:00Z') });
  const share = cp.buildPassportHandoff(passport);
  ok('Home Passport share text prints "(Whole-house repipe)" and never a raw id', /\(Whole-house repipe\)/.test(share) && /\(New Build\)/.test(share) && !/\((other|new_build)\)/.test(share), share);
  const ai = code(read('utils/aiService.ts'));
  ok('weekly summary: the project JSON sends the label', /type: projectTypeLabel\(p\) \|\| p\.type,/.test(ai));
  const gaps = await import('../utils/copilot/newProject/newProjectGaps');
  const tg = gaps.newProjectGaps({}, { data: {} } as never).find(x => x.field === 'type');
  const vals = (tg?.choices ?? []).map(c => c.value);
  ok('copilot type question: Plumbing and Electrical are tap choices', vals.includes('plumbing') && vals.includes('electrical'), JSON.stringify(vals));
  ok('copilot type question: no wordless tap "other" (it would build a renovation)', !vals.includes('other'));
  ok('copilot type question: says how to name something else (the mic, which mergeDraft turns into Other + his words)', /Something else — tap the mic and say it/.test(tg?.question ?? ''), tg?.question);
  const go = await import('../utils/copilot/gapOptions');
  const shown = go.optionsForGap(tg!).map(o => o.label);
  ok('the shell\'s tap buttons (optionsForGap) show Plumbing and Electrical', shown.includes('Plumbing') && shown.includes('Electrical'), JSON.stringify(shown));
  const tgPl = gaps.newProjectGaps({}, { data: { usualType: 'plumbing' } } as never).find(x => x.field === 'type');
  ok('a plumbing shop gets Plumbing as the SUGGESTED choice (there was no box to suggest before)', !!tgPl?.choices?.find(c => c.value === 'plumbing')?.recommended);
  const shell = read('components/copilot/CopilotShell.tsx');
  ok('the mic that question points at is on screen during every question', /accessibilityLabel="Answer by voice"/.test(shell));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
