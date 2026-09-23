// scripts/validate-ai-infer-schema.ts — the `ai` relay's schemaHint →
// responseSchema rule (supabase/functions/_shared/inferSchema.ts), proven
// against every hint in the app.
//
// The relay change affects EVERY text-AI feature, so this does not trust a
// hand-picked list: it walks the source with the TypeScript compiler, finds
// every `schemaHint` (property, shorthand, variable or *_SCHEMA_HINT const),
// evaluates the literal, and runs it through BOTH the frozen pre-change rule
// (copied verbatim below from supabase/functions/ai/index.ts @ 6065b326) and
// the shared module the relay now imports. Every hint must infer
// byte-identically, except the ones deliberately rewritten to list op shapes
// — and for those, the OLD rule (a relay not yet redeployed) must still infer
// exactly the schema it inferred before the rewrite, so the OTA and the
// function deploy are safe in either order.
//
// Run: bun run scripts/validate-ai-infer-schema.ts
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { inferSchema, hintHasMultiShapeArray } from '../supabase/functions/_shared/inferSchema';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, why = '') => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, why); } };
const J = (v: unknown) => JSON.stringify(v);

// ── The pre-change rule, verbatim (items from val[0]; every key required). ──
function legacyInferSchema(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { type: "string" };
  if (Array.isArray(val)) {
    return { type: "array", items: val.length > 0 ? legacyInferSchema(val[0]) : { type: "string" } };
  }
  if (typeof val === "object") {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      properties[k] = legacyInferSchema(v);
      required.push(k);
    }
    return { type: "object", properties, required };
  }
  if (typeof val === "number") return { type: "number" };
  if (typeof val === "boolean") return { type: "boolean" };
  return { type: "string" };
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

console.log('relay wiring — the deployed function runs the tested module');
const relay = readFileSync(join(ROOT, 'supabase/functions/ai/index.ts'), 'utf8');
ok('ai/index.ts imports inferSchema from _shared/inferSchema.ts', /import \{[^}]*\binferSchema\b[^}]*\} from "\.\.\/_shared\/inferSchema\.ts"/.test(relay));
ok('ai/index.ts no longer defines its own inferSchema', !/function inferSchema\(/.test(relay));
ok('responseSchema is inferSchema(schemaHint)', /genConfig\.responseSchema = inferSchema\(schemaHint\)/.test(relay));
const shared = readFileSync(join(ROOT, 'supabase/functions/_shared/inferSchema.ts'), 'utf8');
ok('_shared/inferSchema.ts has no Deno/URL imports (bun + Deno both load it)', !/^import /m.test(shared));
ok('emits no propertyOrdering / anyOf', !/propertyOrdering|anyOf/.test(shared.replace(/\/\/.*$/gm, '')));

// ── Walk the source for every schemaHint literal. ──
const DIRS = ['app', 'components', 'utils', 'hooks', 'contexts', 'lib', 'services', 'backend'];
const files: string[] = [];
function walk(d: string) {
  let ents: string[] = [];
  try { ents = readdirSync(d); } catch { return; }
  for (const e of ents) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(d, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e) && !/\.d\.ts$/.test(e)) files.push(p);
  }
}
for (const d of DIRS) walk(join(ROOT, d));

const UNRESOLVED = Symbol('unresolved');
type Found = { where: string; key: string; value: unknown };
const found: Found[] = [];
const unresolved: string[] = [];

/** Every schemaHint literal in one file's source. Keys are ordinal per
 *  (file, label) — not line numbers — so an edit elsewhere in the file does
 *  not move a snapshot key. */
function scan(f: string, src: string, found: Found[], unresolved: string[]) {
  if (!/schemaHint|SCHEMA_HINT/.test(src)) return;
  const ordinals = new Map<string, number>();
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // Scope-aware: an identifier resolves to the NEAREST enclosing declaration
  // (utils/scheduleAI.ts declares `const schemaHint` in nine functions).
  const resolveIdent = (id: ts.Identifier): ts.Expression | undefined => {
    for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
      if (ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n)) {
        for (const st of n.statements) {
          if (!ts.isVariableStatement(st)) continue;
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === id.text && d.initializer) return d.initializer;
          }
        }
      }
    }
    return undefined;
  };
  // `loose`: inside a `.map(x => ({...}))` example, runtime values (x.id,
  // a ?? b) stand in as strings — only the KEYS decide byte-identity there.
  const evalExpr = (e: ts.Expression, depth = 0, loose = false): unknown => {
    const r = evalStrict(e, depth, loose);
    return r === UNRESOLVED && loose ? 'x' : r;
  };
  const evalStrict = (e: ts.Expression, depth: number, loose: boolean): unknown => {
    if (depth > 40) return UNRESOLVED;
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e) || ts.isTypeAssertionExpression(e)) {
      return evalExpr((e as ts.ParenthesizedExpression).expression, depth + 1, loose);
    }
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e)) return 'x';
    if (ts.isNumericLiteral(e)) return Number(e.text);
    if (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand)) return -Number(e.operand.text);
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (e.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(e)) {
      if (e.text === 'undefined') return undefined;
      const c = resolveIdent(e);
      return c ? evalExpr(c, depth + 1, loose) : UNRESOLVED;
    }
    // A runtime-built example array: `rows.map(r => ({ ...keys }))`. Two
    // copies of the element, so the multi-example (union) path is exercised.
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === 'map'
      && e.arguments[0] && (ts.isArrowFunction(e.arguments[0]) || ts.isFunctionExpression(e.arguments[0]))) {
      const fn = e.arguments[0] as ts.ArrowFunction;
      let body: ts.Expression | undefined = ts.isBlock(fn.body)
        ? (fn.body.statements.find(ts.isReturnStatement)?.expression)
        : fn.body;
      if (!body) return UNRESOLVED;
      const el = evalExpr(body, depth + 1, true);
      if (el === UNRESOLVED) return UNRESOLVED;
      return [el, JSON.parse(JSON.stringify(el))];
    }
    if (ts.isArrayLiteralExpression(e)) {
      const out: unknown[] = [];
      for (const el of e.elements) {
        if (ts.isSpreadElement(el)) return UNRESOLVED;
        const v = evalExpr(el, depth + 1, loose);
        if (v === UNRESOLVED) return UNRESOLVED;
        out.push(v);
      }
      return out;
    }
    if (ts.isObjectLiteralExpression(e)) {
      const out: Record<string, unknown> = {};
      for (const p of e.properties) {
        if (ts.isPropertyAssignment(p)) {
          const k = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name) ? p.name.text : null;
          if (k === null) return UNRESOLVED;
          const v = evalExpr(p.initializer, depth + 1, loose);
          if (v === UNRESOLVED) return UNRESOLVED;
          out[k] = v;
        } else if (ts.isShorthandPropertyAssignment(p)) {
          const v = evalExpr(p.name, depth + 1, loose);
          if (v === UNRESOLVED) return UNRESOLVED;
          out[p.name.text] = v;
        } else return UNRESOLVED;
      }
      return out;
    }
    // A string expression built at runtime (`a + b`, a call returning text)
    // is still a string example — the schema only reads the type.
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = evalExpr(e.left, depth + 1, loose), r = evalExpr(e.right, depth + 1, loose);
      if (typeof l === 'string' || typeof r === 'string') return 'x';
    }
    // `a ?? 'fallback'` / `a || 0`: the runtime value has the fallback's type.
    if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      const l = evalStrict(e.left, depth + 1, false);
      return l !== UNRESOLVED ? l : evalExpr(e.right, depth + 1, loose);
    }
    return UNRESOLVED;
  };
  const rel = relative(ROOT, f);
  const visit = (n: ts.Node) => {
    let expr: ts.Expression | undefined; let label = '';
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'schemaHint') { expr = n.initializer; label = 'schemaHint:'; }
    else if (ts.isShorthandPropertyAssignment(n) && n.name.text === 'schemaHint') { expr = n.name; label = 'schemaHint (shorthand)'; }
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /^(schemaHint|[A-Z0-9_]*SCHEMA_HINT)$/.test(n.name.text) && n.initializer) { expr = n.initializer; label = `const ${n.name.text}`; }
    if (expr) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      const where = `${rel}:${line} ${label}`;
      const ord = (ordinals.get(label) ?? 0) + 1;
      ordinals.set(label, ord);
      const key = `${rel} ${label} #${ord}`;
      // A hint that is just forwarded (`schemaHint: params.schemaHint`,
      // `schemaHint: hint`) is not a literal of its own.
      const forwarded = ts.isPropertyAccessExpression(expr) || (ts.isIdentifier(expr) && !resolveIdent(expr) && expr.text !== 'undefined');
      const v = evalExpr(expr);
      if (v === UNRESOLVED) { if (!forwarded) unresolved.push(where); }
      else if (v !== undefined) found.push({ where, key, value: JSON.parse(JSON.stringify(v)) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
for (const f of files) scan(f, readFileSync(f, 'utf8'), found, unresolved);

// Hints deliberately rewritten to list op shapes. Matched by VALUE, so a
// local alias of one (`const schemaHint = BULK_EDIT_SCHEMA_HINT`) counts as
// it. Everything else must infer byte-identically under the new rule.
const INTENDED_CONSTS = ['SCHEDULE_EDIT_SCHEMA_HINT', 'ESTIMATE_EDIT_SCHEMA_HINT', 'BULK_EDIT_SCHEMA_HINT'];
const intendedJson = new Set(found.filter(h => INTENDED_CONSTS.some(c => h.where.endsWith(`const ${c}`))).map(h => J(h.value)));
const isIntendedHint = (h: Found) => intendedJson.has(J(h.value));

console.log(`\nevery schemaHint in the app (${found.length} literals across ${new Set(found.map(f => f.where.split(':')[0])).size} files)`);
ok('found at least 40 hint literals (the walk actually ran)', found.length >= 40, `found ${found.length}`);
if (unresolved.length > 0) console.log('  (not literal, skipped: ' + unresolved.join('; ') + ')');
ok('every inline hint was evaluable (none silently skipped)', unresolved.length === 0, unresolved.join('; '));
let identical = 0;
const changed: string[] = [];
const unexpected: string[] = [];
for (const h of found) {
  const same = J(legacyInferSchema(h.value)) === J(inferSchema(h.value));
  if (same) identical++; else { changed.push(h.where); if (!isIntendedHint(h)) unexpected.push(h.where); }
}
ok(`${identical} hints infer byte-identically to the old relay`, identical + changed.length === found.length);
ok('the ONLY hints the RULE change alters are the intended op-shape hints (same hint, old rule vs new)', unexpected.length === 0, unexpected.join('; '));
ok('the three intended hints are among those found and did change', ['scheduleEditCapability', 'estimateEditCapability', 'BULK_EDIT_SCHEMA_HINT'].every(k => changed.some(w => w.includes(k))), changed.join('; '));
// The relay's extra prompt sentence fires only for hints with differing shapes.
const withSentence = found.filter(h => hintHasMultiShapeArray(h.value));
ok('the "alternative shapes" prompt sentence is added only for the intended hints', withSentence.every(isIntendedHint), withSentence.filter(h => !isIntendedHint(h)).map(h => h.where).join('; '));
ok('a runtime-built identical-key example array (bid leveling) is found and unchanged', found.some(h => h.where.startsWith('utils/bidLevelingEngine.ts') && !changed.includes(h.where)));

// ── The snapshot: what Gemini is held to, per hint site (integration review).
//
// The comparison above holds each hint FIXED and swaps the rule, so it cannot
// see a hint literal that was itself edited — the schedule BUILDER's hint was
// rewritten in wave 6 ({startDate:null, crewCap:null} → {startDate:'',
// crewCap:0}: crewCap string → number) and every check above stayed green.
// This pins every site: the hash of its hint literal and the schema the
// deployed relay derives from it, byte for byte, plus the schema production
// ran for the same site at 6065b326 (the legacy rule on that commit's hint).
// The sites whose schema differs from 6065b326 must be exactly the ones named
// in CHANGED_SINCE_6065 — a new change fails here until someone names it.
//
// Regenerate after a deliberate hint change:
//   bun run scripts/validate-ai-infer-schema.ts --update
// (keeps the recorded 6065b326 schema of every existing site; reads git only
// for sites it has never seen). Then name the site below if its schema moved.
const SNAPSHOT_PATH = join(ROOT, 'scripts/validate-ai-infer-schema.snapshot.json');
const BASE_COMMIT = '6065b326';
// Grouped by the change; a hint moved into a named const shows up at both the
// const and the call site that passes it.
const CHANGED_SINCE_6065_BY_FEATURE: Record<string, string[]> = {
  // the three hints rewritten to list op SHAPES (audit W6 A/B, E4)
  'schedule editor ops': [
    'utils/copilot/scheduleEdit/scheduleEditCapability.ts const SCHEDULE_EDIT_SCHEMA_HINT #1',
    'utils/copilot/scheduleEdit/scheduleEditCapability.ts schemaHint: #1',
  ],
  'estimate editor ops': [
    'utils/copilot/estimateEdit/estimateEditCapability.ts const ESTIMATE_EDIT_SCHEMA_HINT #1',
    'utils/copilot/estimateEdit/estimateEditCapability.ts schemaHint: #1',
  ],
  'AI drawer bulk edit': [
    'utils/scheduleAI.ts const BULK_EDIT_SCHEMA_HINT #1',
    'utils/scheduleAI.ts const schemaHint #6',
    'utils/scheduleAI.ts schemaHint (shorthand) #6',
  ],
  // the schedule builder's interview hint (lane A2): null placeholders became
  // typed ones, so crewCap is a number and the dates are strings
  'schedule builder interview': [
    'utils/copilot/schedule/scheduleCapability.ts schemaHint: #1',
  ],
};
const CHANGED_SINCE_6065 = Object.values(CHANGED_SINCE_6065_BY_FEATURE).flat().sort();
// NOT a source literal, so not in this snapshot: the voice parser's `[]`
// arrays are filled from its Zod schema at RUNTIME (utils/mageAI.ts
// fillEmptyArrayHints) — scripts/validate-w6a-entry-mageai.ts pins that one.
type SnapEntry = { hintSha: string; schema: string; schemaAt6065: string | null };
const sha = (v: unknown) => createHash('sha256').update(J(v)).digest('hex').slice(0, 16);
const current: Record<string, SnapEntry> = {};
for (const h of found) current[h.key] = { hintSha: sha(h.value), schema: J(inferSchema(h.value)), schemaAt6065: null };
let snapshot: Record<string, SnapEntry> = {};
try { snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')); } catch { snapshot = {}; }

if (process.argv.includes('--update')) {
  // The 6065b326 schema: recorded once per site, from git, then kept.
  const baseFound: Found[] = []; const baseUnresolved: string[] = [];
  const need = new Set(Object.keys(current).filter(k => !snapshot[k]).map(k => k.split(' ')[0]));
  for (const rel of need) {
    try {
      const src = execFileSync('git', ['show', `${BASE_COMMIT}:${rel}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      scan(join(ROOT, rel), src, baseFound, baseUnresolved);
    } catch { /* the file did not exist at the base commit */ }
  }
  const baseByKey = new Map(baseFound.map(h => [h.key, J(legacyInferSchema(h.value))]));
  const next: Record<string, SnapEntry> = {};
  for (const k of Object.keys(current).sort()) {
    next[k] = { ...current[k], schemaAt6065: snapshot[k] ? snapshot[k].schemaAt6065 : (baseByKey.get(k) ?? null) };
  }
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log(`\nsnapshot written: ${Object.keys(next).length} sites → ${relative(ROOT, SNAPSHOT_PATH)}`);
  snapshot = next;
}

console.log('\nsnapshot — every hint site, its literal and the schema the relay derives');
{
  const snapKeys = Object.keys(snapshot).sort(), curKeys = Object.keys(current).sort();
  ok('the snapshot exists and covers the walk', snapKeys.length >= 40, `${snapKeys.length} entries`);
  const added = curKeys.filter(k => !snapshot[k]), removed = snapKeys.filter(k => !current[k]);
  ok('no hint site added or removed since the snapshot', added.length === 0 && removed.length === 0, J({ added, removed }));
  const litMoved = curKeys.filter(k => snapshot[k] && snapshot[k].hintSha !== current[k].hintSha);
  ok('no hint LITERAL changed since the snapshot (regenerate with --update, and name it if its schema moved)', litMoved.length === 0, litMoved.join('; '));
  const schemaMoved = curKeys.filter(k => snapshot[k] && snapshot[k].schema !== current[k].schema);
  ok('every site infers byte-identically to its snapshot schema', schemaMoved.length === 0, schemaMoved.join('; '));
  const sinceBase = snapKeys.filter(k => snapshot[k].schemaAt6065 !== snapshot[k].schema).sort();
  ok(`the sites whose schema differs from ${BASE_COMMIT} are exactly the named ones (${Object.keys(CHANGED_SINCE_6065_BY_FEATURE).join(', ')})`, J(sinceBase) === J(CHANGED_SINCE_6065), J(sinceBase));
  const b = snapshot['utils/copilot/schedule/scheduleCapability.ts schemaHint: #1'];
  ok('…including the schedule builder: crewCap was a string at 6065b326 and is a number now',
    !!b && /"crewCap":\{"type":"string"\}/.test(b.schemaAt6065 ?? '') && /"crewCap":\{"type":"number"\}/.test(b.schema), b ? J({ was: b.schemaAt6065, now: b.schema }) : 'missing');
}

console.log('\nthe relay prompt — the "alternative shapes" sentence only for multi-shape hints');
{
  // Run the relay's OWN prompt-building block (text between `let userMsg` and
  // `const genConfig`), not a copy of it.
  const from = relay.indexOf('let userMsg = prompt;');
  const to = relay.indexOf('const genConfig', from);
  const block = relay.slice(from, to);
  ok('the prompt block is where it was', from > 0 && to > from && /hintHasMultiShapeArray\(schemaHint\)/.test(block));
  const build = new Function('prompt', 'jsonMode', 'schemaHint', 'hintHasMultiShapeArray', `${block}\nreturn userMsg;`) as (p: string, j: boolean, h: unknown, f: typeof hintHasMultiShapeArray) => string;
  const SENTENCE = /alternative item shapes/;
  const matchLine = '\n\nMatch this exact JSON structure (values shown are examples only, generate realistic data for the request):\n';
  let singleOk = true; const leaked: string[] = [];
  for (const h of found) {
    const msg = build('P', true, h.value, hintHasMultiShapeArray);
    if (isIntendedHint(h)) continue;
    if (msg !== 'P' + matchLine + JSON.stringify(h.value, null, 2)) { singleOk = false; leaked.push(h.where); }
  }
  ok('every non-shape hint gets exactly the pre-change prompt (no sentence, nothing else)', singleOk, leaked.join('; '));
  ok('the three shape hints DO get the sentence', ['SCHEDULE_EDIT_SCHEMA_HINT', 'ESTIMATE_EDIT_SCHEMA_HINT', 'BULK_EDIT_SCHEMA_HINT'].every(c => SENTENCE.test(build('P', true, found.find(h => h.where.endsWith(`const ${c}`))?.value, hintHasMultiShapeArray))));
  ok('no hint, or jsonMode off → the prompt is untouched', build('P', true, undefined, hintHasMultiShapeArray) === 'P' && build('P', false, { a: 1 }, hintHasMultiShapeArray) === 'P');
}

console.log('\ndeploy-order safety — an OLD relay reads the rewritten hints exactly as before');
// The rewritten hints, as the walk evaluated them from source (importing the
// capability modules under bun would pull React Native in).
const hintByConst = (name: string) => found.find(h => h.where.endsWith(`const ${name}`))?.value;
const SCHEDULE_EDIT_SCHEMA_HINT = hintByConst('SCHEDULE_EDIT_SCHEMA_HINT');
const ESTIMATE_EDIT_SCHEMA_HINT = hintByConst('ESTIMATE_EDIT_SCHEMA_HINT');
const BULK_EDIT_SCHEMA_HINT = hintByConst('BULK_EDIT_SCHEMA_HINT');
ok('the three rewritten hints were found as consts', !!SCHEDULE_EDIT_SCHEMA_HINT && !!ESTIMATE_EDIT_SCHEMA_HINT && !!BULK_EDIT_SCHEMA_HINT);
ok('schedule edit: old rule on the new hint === old rule on the old one-move hint',
  J(legacyInferSchema(SCHEDULE_EDIT_SCHEMA_HINT)) === J(legacyInferSchema({ ops: [{ op: 'move', task: 't1', deltaDays: 7 }] })));
ok('estimate edit: old rule on the new hint === old rule on the old setUnitPrice hint',
  J(legacyInferSchema(ESTIMATE_EDIT_SCHEMA_HINT)) === J(legacyInferSchema({ ops: [{ op: 'setUnitPrice', item: 'm1', unitPrice: 10 }] })));
ok('bulk edit: old rule on the new hint === old rule on the old full-example hint',
  J(legacyInferSchema(BULK_EDIT_SCHEMA_HINT)) === J(legacyInferSchema({ summary: 's', updates: [{ alias: 'T3', durationDays: 4, startDay: 12, crew: 'c', phase: 'p', progressPercent: 50, rationale: 'r' }] })));

console.log('\nthe new rule — what the rewritten hints now allow');
const opsItem = (h: unknown) => (inferSchema(h) as any).properties.ops.items;
ok('schedule edit: only `op` is required per op', J(opsItem(SCHEDULE_EDIT_SCHEMA_HINT).required) === '["op"]', J(opsItem(SCHEDULE_EDIT_SCHEMA_HINT).required));
ok('schedule edit: an addTask can carry title, durationDays and after',
  ['title', 'durationDays', 'after', 'toStartDay', 'days', 'crewSize', 'pct', 'from', 'to', 'type', 'lag'].every(k => k in opsItem(SCHEDULE_EDIT_SCHEMA_HINT).properties));
ok('estimate edit: only `op` is required; quantity / markupPct / name declared',
  J(opsItem(ESTIMATE_EDIT_SCHEMA_HINT).required) === '["op"]' && ['quantity', 'markupPct', 'name', 'category', 'unit'].every(k => k in opsItem(ESTIMATE_EDIT_SCHEMA_HINT).properties));
const bulkItem = (inferSchema(BULK_EDIT_SCHEMA_HINT) as any).properties.updates.items;
ok('bulk edit: only `alias` is required (crew/phase no longer forced)', J(bulkItem.required) === '["alias"]', J(bulkItem.required));

console.log('\nunion + edge cases');
ok('two object examples → one item schema, union of keys, shared keys required',
  J(inferSchema([{ a: 1, b: 'x' }, { a: 2, c: true }])) === '{"type":"array","items":{"type":"object","properties":{"a":{"type":"number"},"b":{"type":"string"},"c":{"type":"boolean"}},"required":["a"]}}');
ok('examples sharing identical keys infer exactly like the old rule',
  J(inferSchema({ xs: [{ a: 1, b: 'x' }, { a: 3, b: 'y' }] })) === J(legacyInferSchema({ xs: [{ a: 1, b: 'x' }, { a: 3, b: 'y' }] })));
ok('first occurrence wins when examples disagree on a type', J((inferSchema([{ a: 'x' }, { a: 1 }]) as any).items.properties.a) === '{"type":"string"}');
ok('empty array → array of strings (unchanged)', J(inferSchema([])) === '{"type":"array","items":{"type":"string"}}');
ok('one-example array unchanged', J(inferSchema([{ a: 1 }])) === J(legacyInferSchema([{ a: 1 }])));
ok('array of primitives reads val[0] (unchanged)', J(inferSchema([1, 'x'])) === '{"type":"array","items":{"type":"number"}}');
ok('mixed object/primitive array reads val[0] (unchanged)', J(inferSchema([{ a: 1 }, 'x'])) === J(legacyInferSchema([{ a: 1 }, 'x'])));
ok('null / undefined → string', J(inferSchema(null)) === '{"type":"string"}' && J(inferSchema(undefined)) === '{"type":"string"}');
ok('nested multi-shape array inside an object is unioned', J((inferSchema({ o: { xs: [{ a: 1 }, { b: 2 }] } }) as any).properties.o.properties.xs.items.required) === '[]');
ok('hintHasMultiShapeArray: identical-key examples do not trigger the prompt sentence', !hintHasMultiShapeArray({ xs: [{ a: 1 }, { a: 2 }] }) && hintHasMultiShapeArray({ xs: [{ a: 1 }, { b: 2 }] }));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
