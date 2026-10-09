// validate-code-look.ts — Photo code check (wave 4, lane P).
//
// Drives the REAL utils/codeLook.ts under bun, and reads the sheet, the edge
// function, the shared caps and the paywall as TEXT for the honesty and
// metering pins. The danger it guards: a vision false negative read as "the
// work is fine" — so no verdict words anywhere, an empty answer reads
// "Nothing flagged in what's visible.", and the can't-tell list is never empty.
//
// Run via: bun run test:code-look

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODE_LOOK_ALWAYS_CANT_TELL,
  CODE_LOOK_DISCLAIMER,
  CODE_LOOK_NOTHING_FLAGGED,
  CODE_LOOK_RECALL_CHIP,
  codeLookContext,
  codeLookHeadline,
  codeLookToPrepItem,
  codeLookToPunch,
  codeLookTrade,
  normalizeCodeLook,
  trustLabel,
  type CodeLookObservation,
} from '../utils/codeLook';
import { groundingFactsFor, jobsiteAddressForProject, resolveCodeJurisdiction } from '../utils/codeJurisdiction';
import type { Project } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${why ? ` — ${why}` : ''}`); }
}

const obs = (over: Record<string, unknown> = {}) => ({
  what: 'Box without a visible bonding jumper',
  whereInPhoto: 'lower left',
  family: 'electrical',
  topic: 'bonding',
  codeRef: '',
  confidence: 'high',
  ...over,
});

// ═══ 1. normalizeCodeLook ═══════════════════════════════════════════════════
console.log('\n1. normalizeCodeLook — caps, enums, routing, always can\'t-tell');
{
  const seven = Array.from({ length: 7 }, (_, i) => obs({ what: `Thing ${i}`, confidence: i === 1 ? 'low' : 'med' }));
  const r = normalizeCodeLook({ observations: seven, cantTell: [] });
  ok('at most 5 rows in total', r.observations.length + r.checkOnSite.length === 5, `${r.observations.length}+${r.checkOnSite.length}`);
  ok('low confidence → checkOnSite', r.checkOnSite.length === 1 && r.checkOnSite[0].what === 'Thing 1');
  ok('high/med stay in observations', r.observations.every((o) => o.confidence !== 'low'));
  ok('empty cantTell → the always line', r.cantTell.length === 1
    && r.cantTell[0].what === CODE_LOOK_ALWAYS_CANT_TELL.what && r.cantTell[0].betterShot === CODE_LOOK_ALWAYS_CANT_TELL.betterShot);

  const e = normalizeCodeLook({
    observations: [
      obs({ family: 'plumbing-ish', confidence: 'certain', codeRef: '' }),
      obs({ what: '   ' }),
      obs({ what: 'x'.repeat(500), whereInPhoto: 'y'.repeat(300), topic: 'z'.repeat(200), codeRef: 'NEC 2020 250.104(A)'.padEnd(90, '.') }),
      'not an object',
      null,
    ],
    cantTell: Array.from({ length: 9 }, (_, i) => ({ what: `Hidden ${i}`, betterShot: 'b'.repeat(400) })).concat([{ what: '', betterShot: 'x' }]),
  });
  const all = [...e.observations, ...e.checkOnSite];
  ok('empty `what` rows are dropped', all.length === 2, String(all.length));
  const first = all.find((o) => o.what.startsWith('Box'));
  ok('unknown family → other', first?.family === 'other');
  ok('unknown confidence → low (and so check on site)', first?.confidence === 'low' && e.checkOnSite.includes(first!));
  ok("codeRef '' → null", first?.codeRef === null);
  const long = all.find((o) => o.what.startsWith('xxx'));
  ok('what ≤ 200', long?.what.length === 200);
  ok('whereInPhoto ≤ 120', long?.whereInPhoto.length === 120);
  ok('topic ≤ 80', long?.topic.length === 80);
  ok('codeRef ≤ 60', (long?.codeRef ?? '').length === 60);
  ok('cantTell ≤ 6', e.cantTell.length === 6, String(e.cantTell.length));
  ok('cantTell betterShot ≤ 160', e.cantTell.every((c) => c.betterShot.length <= 160));
  ok('ids are cl_ + digest', all.every((o) => /^cl_[0-9a-z]+$/.test(o.id)));

  const same1 = normalizeCodeLook({ observations: [obs()] }).observations[0];
  const same2 = normalizeCodeLook({ observations: [obs()] }).observations[0];
  ok('the id is stable across runs', same1.id === same2.id);
  const dup = normalizeCodeLook({ observations: [obs(), obs()] });
  ok('a duplicate what|where is kept once', dup.observations.length === 1);

  for (const bad of [null, undefined, 'x', 42, [], { observations: 'no' }]) {
    const b = normalizeCodeLook(bad);
    ok(`non-object ${JSON.stringify(bad) ?? 'undefined'} → empty + always can't-tell`,
      b.observations.length === 0 && b.checkOnSite.length === 0 && b.cantTell.length === 1);
  }
}

// ═══ 2. headline + trust ════════════════════════════════════════════════════
console.log('\n2. headline + trust label');
{
  const none = normalizeCodeLook({ observations: [] });
  ok('0 rows → exactly the nothing-flagged line', codeLookHeadline(none) === CODE_LOOK_NOTHING_FLAGGED);
  ok("nothing-flagged text is exact", CODE_LOOK_NOTHING_FLAGGED === "Nothing flagged in what's visible.");
  const three = normalizeCodeLook({ observations: [obs({ what: 'A' }), obs({ what: 'B', confidence: 'med' }), obs({ what: 'C', confidence: 'low' })] });
  ok('2 + 1 low → "3 things … · 1 to check on site"', codeLookHeadline(three) === '3 things an inspector would look at · 1 to check on site', codeLookHeadline(three));
  const one = normalizeCodeLook({ observations: [obs()] });
  ok('1 → "1 thing an inspector would look at"', codeLookHeadline(one) === '1 thing an inspector would look at', codeLookHeadline(one));
  ok('trust high', trustLabel('high') === 'Clearly visible');
  ok('trust med', trustLabel('med') === 'Probably visible');
  ok('trust low', trustLabel('low') === 'Hard to see. Check on site.');
  ok('disclaimer is exact', CODE_LOOK_DISCLAIMER === 'Visual pre-check, not an inspection. Not a substitute for the adopted code. Confirm with your building department.');
}

// ═══ 3. punch + prep ════════════════════════════════════════════════════════
console.log('\n3. codeLookToPunch / codeLookToPrepItem');
{
  const o: CodeLookObservation = {
    id: 'cl_x', what: 'W'.repeat(120), whereInPhoto: 'top right', family: 'mechanical', topic: 'duct', codeRef: null, confidence: 'med',
  };
  const now = '2026-09-26T12:00:00.000Z';
  const p = codeLookToPunch(o, { projectId: 'proj-1', photoUri: 'https://x/photo.jpg', sourcePhotoId: 'photo-9', now, newId: () => 'punch-1' });
  ok('photoUri is THIS photo', p.photoUri === 'https://x/photo.jpg');
  ok('sourcePhotoId pinned', p.sourcePhotoId === 'photo-9');
  ok('description = what ≤ 80', p.description === 'W'.repeat(80));
  ok('location = whereInPhoto', p.location === 'top right');
  const required: (keyof typeof p)[] = ['id', 'projectId', 'description', 'location', 'assignedSub', 'dueDate', 'priority', 'status', 'createdAt', 'updatedAt'];
  ok('every required PunchItem field is set', required.every((k) => typeof p[k] === 'string'), required.filter((k) => typeof p[k] !== 'string').join(','));
  ok('id/project/stamps', p.id === 'punch-1' && p.projectId === 'proj-1' && p.createdAt === now && p.updatedAt === now);
  ok('priority medium, status open', p.priority === 'medium' && p.status === 'open');
  ok('unassigned, internal crew list', p.assignedSub === '' && p.listType === 'crew');
  const noSrc = codeLookToPunch(o, { projectId: 'proj-1', photoUri: 'file:///a.jpg', now, newId: () => 'punch-2' });
  ok('no sourcePhotoId when the photo is not a gallery photo', !('sourcePhotoId' in noSrc));
  ok('family → trade word', codeLookTrade('mechanical') === 'HVAC' && codeLookTrade('electrical') === 'Electrical'
    && codeLookTrade('fire') === 'General' && codeLookTrade('framing') === 'Framing' && codeLookTrade('plumbing') === 'Plumbing');

  const prep = codeLookToPrepItem(o);
  ok("prep group 'verify'", prep.group === 'verify');
  ok('prep id codelook_ + digest, stable', /^codelook_[0-9a-z]+$/.test(prep.id) && codeLookToPrepItem({ ...o, id: 'other' }).id === prep.id);
  ok('prep text = what', prep.text === o.what);
  ok('prep why names the photo + confidence in what was seen', prep.why === 'From a Photo Code Check · Medium confidence in what was seen', prep.why);
  ok('prep codeRef absent when null', !('codeRef' in prep));
  ok('prep codeRef kept when set', codeLookToPrepItem({ ...o, codeRef: 'IRC R302.11' }).codeRef === 'IRC R302.11');
  ok('prep confidence carried', prep.confidence === 'med');
}

// ═══ 4. context ═════════════════════════════════════════════════════════════
console.log('\n4. codeLookContext');
{
  const nowhere = { id: 'p', name: 'X', location: '' } as unknown as Project;
  const ctx = codeLookContext({ project: nowhere, trade: '  ', checklist: [' a\nb ', '', '  '] });
  const expected = groundingFactsFor(resolveCodeJurisdiction(jobsiteAddressForProject(nowhere))).promptBlock;
  ok('an unknown jurisdiction still sends its own block', ctx.jurisdictionBlock === expected && /unresolved/i.test(ctx.jurisdictionBlock));
  ok('blank trade is left out', !('trade' in ctx));
  ok('checklist lines are single-line, blanks dropped', JSON.stringify(ctx.checklist) === JSON.stringify(['a b']));
  const pdx = { id: 'p', name: 'X', location: 'Portland, OR' } as unknown as Project;
  const c2 = codeLookContext({ project: pdx, trade: 'electrical' });
  ok('a known jurisdiction sends the grounded block', c2.jurisdictionBlock === groundingFactsFor(resolveCodeJurisdiction(jobsiteAddressForProject(pdx))).promptBlock);
  ok('trade carried', c2.trade === 'electrical' && !('checklist' in c2));
}

// ═══ 5. source pins ═════════════════════════════════════════════════════════
console.log('\n5. source pins');
{
  const readySheet = read('components/inspectionPrep/InspectionReadySheet.tsx');
  const m = /export const RECALL_CHIP = '([^']*)'/.exec(readySheet);
  ok('CODE_LOOK_RECALL_CHIP === InspectionReadySheet RECALL_CHIP', !!m && m[1] === CODE_LOOK_RECALL_CHIP, m?.[1]);

  const util = read('utils/codeLook.ts');
  const sheet = read('components/codeLook/CodeLookSheet.tsx');
  const edge = read('supabase/functions/analyze-photos/index.ts');
  const RULE = 'Never say the work passes or that there are no issues.';
  const promptM = /const CODE_LOOK_PROMPT = `([\s\S]*?)`;/.exec(edge);
  ok('the edge file has CODE_LOOK_PROMPT', !!promptM);
  const prompt = promptM?.[1] ?? '';
  ok('the prompt carries the no-verdict rule', prompt.includes(RULE));
  for (const [name, text] of [['utils/codeLook.ts', util], ['CodeLookSheet.tsx', sheet], ['CODE_LOOK prompt (minus its rule line)', prompt.split(RULE).join('')]] as const) {
    ok(`${name}: no "no issues"`, !/no issues/i.test(text));
    ok(`${name}: no "passes"`, !/passes/i.test(text));
    ok(`${name}: no "compliant"`, !/compliant/i.test(text));
  }
  ok('the prompt asks for cantTell as required', /cantTell is required/.test(prompt));
  ok('confidence is about what is SEEN', /confidence is how sure you are about what you SEE/.test(prompt));

  // Edge function
  ok("allow-list gains 'codeLook'", /\['punch', 'dfr', 'rfi', 'triage', 'receipt', 'rooms', 'conditionRisk', 'coi', 'codeLook'\]\.includes\(body\.task\)/.test(edge));
  ok('unknown_task message names codeLook', edge.includes('task must be "punch", "dfr", "rfi", "triage", "receipt", "rooms", "conditionRisk", "coi", or "codeLook"'));
  ok('three-way meterKey', edge.includes("const meterKey = body.task === 'conditionRisk' ? 'cost_xray' : body.task === 'codeLook' ? 'code_look' : 'analyze_photos';"));
  ok('one-photo guard right after inputCount', /const inputCount = [^\n]*\n\s*if \(body\.task === 'codeLook' && inputCount !== 1\) return jsonResponse\(\{ success: false, error: 'Photo Code Check reads one photo at a time\.', code: 'one_photo' \}, 400\);/.test(edge));
  ok('photo code check cap sentence', edge.includes('Monthly Photo Code Check limit reached (${cap} on ${auth.tier}). Resets on the 1st.'));
  ok('bad-shape 500 says it plainly', edge.includes("error: 'The Photo Code Check came back unreadable. Try again.' }, 500)"));
  ok('maxOutputTokens 8000 kept', /maxOutputTokens: 8000\b/.test(edge));
  ok('abort signal kept', /signal: ac\.signal/.test(edge));
  ok('basePrompt routes codeLook', /body\.task === 'codeLook' \? codeLookPrompt\(body\.codeLook\) :/.test(edge));
  ok('normaliser caps observations at 5', /if \(body\.task === 'codeLook'\) \{[\s\S]*?\.slice\(0, 5\)/.test(edge));
  ok('normaliser caps cantTell at 6', /if \(body\.task === 'codeLook'\) \{[\s\S]*?\.slice\(0, 6\)/.test(edge));

  // MONTHLY_CAPS
  const auth = read('supabase/functions/_shared/auth.ts');
  const capsBlock = /export const MONTHLY_CAPS[\s\S]*?\n\};/.exec(auth)?.[0] ?? '';
  const capOf = (tier: string): number | null => {
    const block = new RegExp(`\\n  ${tier}: \\{([\\s\\S]*?)\\n  \\},`).exec(capsBlock)?.[1] ?? '';
    const v = /\n\s*code_look: (\d+),/.exec(block);
    return v ? Number(v[1]) : null;
  };
  const caps = { free: capOf('free'), pro: capOf('pro'), business: capOf('business'), enterprise: capOf('enterprise') };
  ok('code_look in all four tiers', Object.values(caps).every((v) => v !== null), JSON.stringify(caps));
  ok('free code_look is 0', caps.free === 0);
  ok('pro < business < enterprise', (caps.pro ?? 0) > 0 && (caps.pro ?? 0) < (caps.business ?? 0) && (caps.business ?? 0) < (caps.enterprise ?? 0));

  // Paywall row = MONTHLY_CAPS
  const paywall = read('app/paywall.tsx');
  const row = /const CODE_LOOK_LIMIT: AILimitRow = \{([^}]*)\};/.exec(paywall)?.[1] ?? '';
  const cell = (k: string) => new RegExp(`${k}: '([^']*)'`).exec(row)?.[1];
  ok('paywall CODE_LOOK_LIMIT exists', !!row);
  ok('paywall free is —', cell('free') === '—');
  ok('paywall pro = MONTHLY_CAPS', cell('pro') === String(caps.pro), `${cell('pro')} vs ${caps.pro}`);
  ok('paywall business = MONTHLY_CAPS', cell('business') === String(caps.business), `${cell('business')} vs ${caps.business}`);
  ok('paywall enterprise = MONTHLY_CAPS', cell('enterprise') === String(caps.enterprise), `${cell('enterprise')} vs ${caps.enterprise}`);
  ok('paywall renders the row in both tables', paywall.includes('testID="codelook-ai-limit-row"') && paywall.includes('testID="codelook-ai-limit-row-2"'));

  // The sheet
  ok("the sheet gates on canAccess('ai_code_check')", sheet.includes("canAccess('ai_code_check')"));
  const code = sheet.replace(/\/\/.*$/gm, '');
  const effects = code.match(/useEffect\(\(\) => [\s\S]*?\}, \[[^\]]*\]\);|useEffect\(\(\) => \(\) => [^;]*;/g) ?? [];
  ok('no effect calls the model (no auto-spend on mount)', effects.length > 0 && effects.every((e) => !/look\(|analyzePhotoCodeLook/.test(e)));
  ok('analyzePhotoCodeLook is called only inside look()', (code.match(/analyzePhotoCodeLook\(/g) ?? []).length === 1
    && /const look = useCallback\(async \(\) => \{[\s\S]*?analyzePhotoCodeLook\(/.test(code));
  const lookCalls = code.split('\n').filter((l) => /\blook\(\)/.test(l));
  ok('look() is only invoked from a press', lookCalls.length >= 2 && lookCalls.every((l) => /onPress=/.test(l)), lookCalls.join(' | '));
  ok('the sheet renders {CODE_LOOK_DISCLAIMER}', /<Text[^>]*>\{CODE_LOOK_DISCLAIMER\}<\/Text>/.test(sheet));
  ok('the can\'t-tell group is not conditional on its length', /testID="codelook-cant-tell"/.test(sheet)
    && !/cantTell\.length > 0 \?/.test(sheet));
  ok('the Esc binding is enabled only while visible', /scope: 'dialog', enabled: visible/.test(sheet));
  ok('the sheet root testID is codelook-sheet', sheet.includes('testID="codelook-sheet"'));
}

// ═══ 6. one name ════════════════════════════════════════════════════════════
// The feature had three names on screen ("Code look", "Photo code look",
// "Photo Code Look"). It now has ONE, "Photo Code Check": its three entry
// buttons, its sheet, the Pro gate, the plans row, the prep line and the
// server's refusals. Ids keep the old name on purpose (the Paywall feature KEY
// 'Photo Code Look' is also an analytics prop and a FEATURE_PITCH key; the
// codelook-* testIDs, field.punch.codeLook and the CODE_LOOK_* identifiers).
console.log('\n6. one name');
{
  const NAME = 'Photo Code Check';
  // Comments may keep the old name; strings may not. Strip block + line
  // comments (a `//` right after ':' or a quote is a URL, not a comment), then
  // drop the one sanctioned id literal, the Paywall feature key.
  const stripCode = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/(['"])Photo Code Look\1/g, '<feature-key>');
  const files = [
    'components/codeLook/CodeLookSheet.tsx',
    'app/punch-list.tsx',
    'app/project-detail.tsx',
    'components/inspectionPrep/InspectionReadySheet.tsx',
    'components/Paywall.tsx',
    'app/paywall.tsx',
    'utils/codeLook.ts',
    'supabase/functions/analyze-photos/index.ts',
  ];
  for (const f of files) {
    const code = stripCode(read(f));
    const old = /\bCode [Ll]ook\b|Photo code look/.exec(code);
    ok(`${f}: no "Code look" / "Photo code look" left in a string`, !old,
      old ? code.slice(Math.max(0, old.index - 60), old.index + 30).replace(/\s+/g, ' ') : undefined);
  }

  // An entry button: the element around `testID`, its accessibilityLabel and
  // its <Text> child, either a plain literal or t('key', 'English').
  const entry = (src: string, testId: string) => {
    const at = src.indexOf(testId);
    if (at < 0) return null;
    const open = Math.max(src.lastIndexOf('<TouchableOpacity', at), src.lastIndexOf('<Pressable', at));
    const close = src.indexOf('</TouchableOpacity>', at);
    if (open < 0 || close < 0) return null;
    const el = src.slice(open, close);
    const lit = (v: string | undefined) => v === undefined ? undefined
      : (/^\{t\('[^']+', '([^']*)'\)\}$/.exec(v)?.[1] ?? /^"([^"]*)"$/.exec(v)?.[1] ?? v);
    const label = lit(/accessibilityLabel=(\{t\('[^']+', '[^']*'\)\}|"[^"]*")/.exec(el)?.[1]);
    const textM = /<Text\b([^>]*)>([^<]*)<\/Text>/.exec(el);
    const text = lit(textM?.[2]);
    const oneLine = !!textM && /numberOfLines=\{1\}/.test(textM[1]);
    return { label, text, oneLine };
  };
  const sheet = read('components/codeLook/CodeLookSheet.tsx');
  const heading = /<Text style=\{s\.sheetHeading\}>([^<]*)<\/Text>/.exec(sheet)?.[1];
  ok('the sheet heading is "Photo Code Check"', heading === NAME, heading);
  for (const [f, id] of [
    ['app/punch-list.tsx', 'testID="codelook-open-punch"'],
    ['app/project-detail.tsx', 'testID="codelook-open-lightbox"'],
    ['components/inspectionPrep/InspectionReadySheet.tsx', 'testID={`codelook-prep-${item.id}`}'],
  ] as const) {
    const e = entry(read(f), id);
    ok(`${f}: the entry button's label and text are "${NAME}"`, !!e && e.label === NAME && e.text === NAME, JSON.stringify(e));
    ok(`${f}: the entry button's text stays on one line (390 pt)`, !!e && e.oneLine, JSON.stringify(e));
  }
  const pw = read('components/Paywall.tsx');
  const title = /'Photo Code Look': '([^']*)'/.exec(/const FEATURE_TITLE[\s\S]*?\n\};/.exec(pw)?.[0] ?? '')?.[1];
  ok("Paywall FEATURE_TITLE['Photo Code Look'] is \"Photo Code Check\", a heading in Title Case (the key stays)", title === 'Photo Code Check', title);
  const plansRow = /const CODE_LOOK_LIMIT: AILimitRow = \{ label: '([^']*)'/.exec(read('app/paywall.tsx'))?.[1];
  ok('the plans row reads "Photo Code Checks per Month"', plansRow === 'Photo Code Checks per Month', plansRow);
  const readySrc = read('components/inspectionPrep/InspectionReadySheet.tsx');
  ok('the prep group heading is "From Your Photo Code Check"', readySrc.includes('<Text style={s.sectionHeading}>From Your Photo Code Check</Text>'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
