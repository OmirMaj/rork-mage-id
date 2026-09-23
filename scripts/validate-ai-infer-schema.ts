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
// THE RULE (2026-09-23, after the wave-6a union rule was rolled back live —
// docs/deploy/2026-09-23-ai-relay-rollback.md): an array of object examples
// whose key sets differ becomes items.anyOf, one closed alternative per shape
// (every key required, propertyOrdering, `op` pinned by enum). The union rule
// left an OPTIONAL FREE-FORM STRING in the item (addDependency's `type`), and
// Gemini degenerated inside it on an addTask until MAX_TOKENS. This validator
// pins that no inferred schema anywhere contains one.
//
// Hints are evaluated TWICE: once normalised (every string 'x' — the hash the
// snapshot keys on) and once RAW (the real example strings; a runtime-built
// `.map` example gets distinct strings per element, as it does at runtime).
// The rule is judged on the RAW value: a discriminator reads string VALUES, so
// a normalised walk would never see one (oacEngine's actionItems carry prose
// that differs in every key; bid leveling's map carries a distinct bidId).
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
{
  const code = shared.replace(/\/\/.*$/gm, '');
  ok('anyOf / enum / propertyOrdering are built ONLY inside alternativeSchemas (the multi-shape path)',
    (code.match(/anyOf:|enum:|propertyOrdering:/g) ?? []).length >= 3
      && !/anyOf:|enum:|propertyOrdering:/.test(code.slice(0, code.indexOf('function alternativeSchemas')).replace(/export interface InferredSchema[\s\S]*?\n\}/, '')));
  ok('the union rule is gone (no unionItemSchema, no "required = shared keys")', !/unionItemSchema|examples\.every\(ex => hasOwn\(ex, k\)\)\);\s*return \{ type: "object", properties, required \}/.test(code));
}

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
type Found = { where: string; key: string; value: unknown; raw: unknown };
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
  // RAW mode keeps real string literals; a runtime value inside a `.map`
  // example becomes a DISTINCT string each time (as real rows are).
  let raw = false;
  let runtimeN = 0;
  const str = (e: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral) => (raw ? e.text : 'x');
  const evalExpr = (e: ts.Expression, depth = 0, loose = false): unknown => {
    const r = evalStrict(e, depth, loose);
    return r === UNRESOLVED && loose ? (raw ? `runtime-${++runtimeN}` : 'x') : r;
  };
  const evalStrict = (e: ts.Expression, depth: number, loose: boolean): unknown => {
    if (depth > 40) return UNRESOLVED;
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e) || ts.isTypeAssertionExpression(e)) {
      return evalExpr((e as ts.ParenthesizedExpression).expression, depth + 1, loose);
    }
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return str(e);
    if (ts.isTemplateExpression(e)) return raw ? `template-${++runtimeN}` : 'x';
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
      // Normalised: two identical copies. Raw: the body evaluated again, so
      // runtime values differ between the two rows.
      return [el, raw ? evalExpr(body, depth + 1, true) : JSON.parse(JSON.stringify(el))];
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
      if (typeof l === 'string' || typeof r === 'string') return raw ? `concat-${++runtimeN}` : 'x';
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
      raw = false;
      const v = evalExpr(expr);
      raw = true;
      const r = evalExpr(expr);
      raw = false;
      if (v === UNRESOLVED) { if (!forwarded) unresolved.push(where); }
      else if (v !== undefined) found.push({ where, key, value: JSON.parse(JSON.stringify(v)), raw: JSON.parse(JSON.stringify(r)) });
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
  // Judged on BOTH evaluations; the raw one carries the real example strings.
  const same = J(legacyInferSchema(h.value)) === J(inferSchema(h.value)) && J(legacyInferSchema(h.raw)) === J(inferSchema(h.raw));
  if (same) identical++; else { changed.push(h.where); if (!isIntendedHint(h)) unexpected.push(h.where); }
}
ok(`${identical} hints infer byte-identically to the old relay`, identical + changed.length === found.length);
ok('the ONLY hints the RULE change alters are the intended op-shape hints (same hint, old rule vs new)', unexpected.length === 0, unexpected.join('; '));
ok('the three intended hints are among those found and did change', ['scheduleEditCapability', 'estimateEditCapability', 'BULK_EDIT_SCHEMA_HINT'].every(k => changed.some(w => w.includes(k))), changed.join('; '));
// The relay's extra prompt sentence fires only for hints with differing shapes.
const withSentence = found.filter(h => hintHasMultiShapeArray(h.value) || hintHasMultiShapeArray(h.raw));
ok('the "alternative shapes" prompt sentence is added only for the intended hints', withSentence.every(isIntendedHint), withSentence.filter(h => !isIntendedHint(h)).map(h => h.where).join('; '));
{
  const bid = found.find(h => h.where.startsWith('utils/bidLevelingEngine.ts'));
  const adj = (bid?.raw as any)?.adjustments;
  ok('a runtime-built identical-key example array (bid leveling) is found and unchanged',
    !!bid && !changed.includes(bid.where));
  ok('…evaluated RAW with a distinct bidId per row (so a value-based discriminator WOULD fire on it)',
    Array.isArray(adj) && adj.length === 2 && adj[0].bidId !== adj[1].bidId && J(legacyInferSchema(bid!.raw)) === J(inferSchema(bid!.raw)), J(adj));
  const oac = found.find(h => h.where.startsWith('utils/oacEngine.ts') && Array.isArray((h.raw as any)?.actionItems));
  const ai = (oac?.raw as any)?.actionItems;
  ok('oacEngine actionItems: same keys, different PROSE in every key → still val[0], every key required, no enum',
    !!oac && Array.isArray(ai) && ai.length === 2 && ai[0].description !== ai[1].description
      && J(inferSchema(oac!.raw)) === J(legacyInferSchema(oac!.raw)) && !/"enum"|anyOf/.test(J(inferSchema(oac!.raw))), J(ai));
}

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
// hintSha keys on the normalised literal (no churn when an example's prose is
// reworded); `schema` is what the relay derives from the RAW literal, so a
// changed op name (a discriminator) still moves it.
for (const h of found) current[h.key] = { hintSha: sha(h.value), schema: J(inferSchema(h.raw)), schemaAt6065: null };
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
  const baseByKey = new Map(baseFound.map(h => [h.key, J(legacyInferSchema(h.raw))]));
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
    if (isIntendedHint(h)) continue;
    for (const v of [h.value, h.raw]) {
      if (build('P', true, v, hintHasMultiShapeArray) !== 'P' + matchLine + JSON.stringify(v, null, 2)) { singleOk = false; leaked.push(h.where); }
    }
  }
  ok('every non-shape hint gets exactly the pre-change prompt (no sentence, nothing else)', singleOk, leaked.join('; '));
  ok('the three shape hints DO get the sentence', ['SCHEDULE_EDIT_SCHEMA_HINT', 'ESTIMATE_EDIT_SCHEMA_HINT', 'BULK_EDIT_SCHEMA_HINT'].every(c => SENTENCE.test(build('P', true, found.find(h => h.where.endsWith(`const ${c}`))?.value, hintHasMultiShapeArray))));
  ok('no hint, or jsonMode off → the prompt is untouched', build('P', true, undefined, hintHasMultiShapeArray) === 'P' && build('P', false, { a: 1 }, hintHasMultiShapeArray) === 'P');
}

console.log('\ndeploy-order safety — an OLD relay reads the rewritten hints exactly as before');
// The rewritten hints, as the walk evaluated them from source (importing the
// capability modules under bun would pull React Native in).
const hintByConst = (name: string) => found.find(h => h.where.endsWith(`const ${name}`))?.raw;
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

console.log('\nthe anyOf rule — what the three shape hints now infer');
type Alt = { type: string; properties: Record<string, any>; required: string[]; propertyOrdering: string[] };
const alts = (h: unknown, field: string): Alt[] => (inferSchema(h) as any).properties?.[field]?.items?.anyOf ?? [];
const schedAlts = alts(SCHEDULE_EDIT_SCHEMA_HINT, 'ops');
const estAlts = alts(ESTIMATE_EDIT_SCHEMA_HINT, 'ops');
const bulkAlts = alts(BULK_EDIT_SCHEMA_HINT, 'updates');
const opOf = (a: Alt) => a.properties.op?.enum?.[0];
ok('schedule edit: ops.items is anyOf, one alternative per example shape (11)', schedAlts.length === 11, `${schedAlts.length}`);
ok('schedule edit: the alternatives follow example order', J(schedAlts.map(opOf)) === J((SCHEDULE_EDIT_SCHEMA_HINT as any).ops.map((o: any) => o.op)));
ok('the founder\'s addTask alternative is EXACTLY {op∈[addTask], title, durationDays, after, isMilestone}, all required, in order — no `type`',
  J(schedAlts.find(a => opOf(a) === 'addTask')) === J({ type: 'object', properties: { op: { type: 'string', enum: ['addTask'] }, title: { type: 'string' }, durationDays: { type: 'number' }, after: { type: 'string' }, isMilestone: { type: 'boolean' } }, required: ['op', 'title', 'durationDays', 'after', 'isMilestone'], propertyOrdering: ['op', 'title', 'durationDays', 'after', 'isMilestone'] }),
  J(schedAlts.find(a => opOf(a) === 'addTask')));
ok('an unanchored add has its own shape {op∈[addTask], title, durationDays, isMilestone} — never forced to invent `after`',
  J(schedAlts.filter(a => opOf(a) === 'addTask')[1]) === J({ type: 'object', properties: { op: { type: 'string', enum: ['addTask'] }, title: { type: 'string' }, durationDays: { type: 'number' }, isMilestone: { type: 'boolean' } }, required: ['op', 'title', 'durationDays', 'isMilestone'], propertyOrdering: ['op', 'title', 'durationDays', 'isMilestone'] }),
  J(schedAlts.filter(a => opOf(a) === 'addTask')));
ok('the two move shapes are two alternatives (deltaDays | toStartDay), both op∈[move]',
  J(schedAlts.filter(a => opOf(a) === 'move').map(a => a.propertyOrdering)) === J([['op', 'task', 'deltaDays'], ['op', 'task', 'toStartDay']]));
ok('`type` (the free-form string Gemini looped in) is declared ONLY on addDependency, and required there',
  J(schedAlts.filter(a => 'type' in a.properties).map(opOf)) === '["addDependency"]' && schedAlts.find(a => opOf(a) === 'addDependency')!.required.includes('type'));
ok('estimate edit: 5 alternatives, op pinned per alternative, in example order',
  J(estAlts.map(opOf)) === '["setUnitPrice","setQuantity","setGlobalMarkup","addLine","removeLine"]');
ok('estimate edit: setGlobalMarkup is exactly {op, markupPct}', J(estAlts[2]?.propertyOrdering) === '["op","markupPct"]' && J(estAlts[2]?.required) === '["op","markupPct"]');
ok('bulk edit: 6 alternatives; alias (one value, \'<alias>\', in every example) is a plain string, never an enum',
  bulkAlts.length === 6 && bulkAlts.every(a => J(a.properties.alias) === '{"type":"string"}'));
ok('bulk edit: EVERY field of the full shape has a single-field {alias, field} shape — a one-field change never forces progressPercent',
  (() => { const fields = Object.keys(bulkAlts[0]?.properties ?? {}).filter(k => k !== 'alias' && k !== 'rationale');
    return fields.length === 5 && fields.every(k => bulkAlts.some(a => J(a.required) === J(['alias', k]))); })(),
  J(bulkAlts.map(a => a.required)));
ok('every alternative of every shape hint: required === propertyOrdering === its own keys (closed shape)',
  [...schedAlts, ...estAlts, ...bulkAlts].every(a => J(a.required) === J(Object.keys(a.properties)) && J(a.propertyOrdering) === J(Object.keys(a.properties))));

// Every op the editor's PROMPT offers must be an alternative, or the decoder
// cannot emit it at all (a closed anyOf has no free `op`).
const opsInPrompt = (rel: string) => {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  return [...new Set([...src.matchAll(/\{op:"([A-Za-z]+)"/g)].map(m => m[1]))];
};
{
  const sPrompt = opsInPrompt('utils/copilot/scheduleEdit/scheduleEditCapability.ts');
  const ePrompt = opsInPrompt('utils/copilot/estimateEdit/estimateEditCapability.ts');
  const sEnum = new Set(schedAlts.map(opOf)), eEnum = new Set(estAlts.map(opOf));
  ok('estimate edit: every op the prompt offers has an alternative', ePrompt.length >= 5 && ePrompt.every(o => eEnum.has(o)), J(ePrompt.filter(o => !eEnum.has(o))));
  // The prompt offers {op:"level"}; the old val[0] rule let it through as
  // {op:'level', task:'', deltaDays:0}. A closed anyOf can only emit it if the
  // hint lists it — without the example, the anyOf relay would lose re-level.
  ok('schedule edit: every op the prompt offers has an alternative (incl. level)', sPrompt.length >= 9 && sPrompt.every(o => sEnum.has(o)),
    `MISSING from SCHEDULE_EDIT_SCHEMA_HINT: ${J(sPrompt.filter(o => !sEnum.has(o)))}`);
  const lv = schedAlts.find(a => opOf(a) === 'level');
  ok('…level is exactly the closed alternative {op∈[level]}',
    J(lv) === J({ type: 'object', properties: { op: { type: 'string', enum: ['level'] } }, required: ['op'], propertyOrdering: ['op'] }), J(lv));
}

// ── The degeneration class, pinned. ──
// An optional free-form string property (type string, no enum, not required)
// is where Gemini looped live. No schema the relay derives may carry one.
function optionalFreeStrings(s: any, path = '$'): string[] {
  if (!s || typeof s !== 'object') return [];
  const out: string[] = [];
  if (s.type === 'object' && s.properties) {
    for (const [k, p] of Object.entries<any>(s.properties)) {
      if (p?.type === 'string' && !Array.isArray(p.enum) && !(s.required ?? []).includes(k)) out.push(`${path}.${k}`);
      out.push(...optionalFreeStrings(p, `${path}.${k}`));
    }
  }
  if (s.items) out.push(...optionalFreeStrings(s.items, `${path}[]`));
  if (Array.isArray(s.anyOf)) s.anyOf.forEach((a: any, i: number) => out.push(...optionalFreeStrings(a, `${path}|${i}`)));
  return out;
}
// The wave-6a union rule, frozen from 29fd92b1, so the pin is proven to have teeth.
function unionRule(val: unknown): any {
  if (val === null || val === undefined) return { type: 'string' };
  if (Array.isArray(val)) {
    if (val.length >= 2 && val.every(v => v !== null && typeof v === 'object' && !Array.isArray(v))) {
      const properties: Record<string, any> = {};
      for (const ex of val as Record<string, unknown>[]) for (const [k, v] of Object.entries(ex)) if (!(k in properties)) properties[k] = unionRule(v);
      return { type: 'array', items: { type: 'object', properties, required: Object.keys(properties).filter(k => (val as Record<string, unknown>[]).every(ex => k in ex)) } };
    }
    return { type: 'array', items: val.length > 0 ? unionRule(val[0]) : { type: 'string' } };
  }
  if (typeof val === 'object') {
    const properties: Record<string, any> = {}; const required: string[] = [];
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) { properties[k] = unionRule(v); required.push(k); }
    return { type: 'object', properties, required };
  }
  return { type: typeof val === 'number' ? 'number' : typeof val === 'boolean' ? 'boolean' : 'string' };
}
console.log('\nthe degeneration class — no optional free-form string anywhere');
{
  const bad = found.flatMap(h => optionalFreeStrings(inferSchema(h.raw)).map(p => `${h.where} ${p}`));
  ok(`no schema derived from any of the ${found.length} hints has an optional free-form string property`, bad.length === 0, bad.join('; '));
  ok('none in the three multi-shape schemas specifically', [SCHEDULE_EDIT_SCHEMA_HINT, ESTIMATE_EDIT_SCHEMA_HINT, BULK_EDIT_SCHEMA_HINT].every(h => optionalFreeStrings(inferSchema(h)).length === 0));
  const unionBad = optionalFreeStrings(unionRule(SCHEDULE_EDIT_SCHEMA_HINT));
  ok('the pin has teeth: the rolled-back union rule on the schedule hint FAILS it (…ops[].type among the offenders)', unionBad.includes('$.ops[].type'), J(unionBad));
  ok('…and the union rule\'s item was the live shape (15 properties, required [op])',
    (() => { const it = unionRule(SCHEDULE_EDIT_SCHEMA_HINT).properties.ops.items; return Object.keys(it.properties).length === 15 && J(it.required) === '["op"]'; })());
}

console.log('\nedge cases');
ok('two object examples with different keys → anyOf of closed shapes',
  J(inferSchema([{ a: 1, b: 'x' }, { a: 2, c: true }])) === '{"type":"array","items":{"anyOf":[{"type":"object","properties":{"a":{"type":"number"},"b":{"type":"string"}},"required":["a","b"],"propertyOrdering":["a","b"]},{"type":"object","properties":{"a":{"type":"number"},"c":{"type":"boolean"}},"required":["a","c"],"propertyOrdering":["a","c"]}]}}');
ok('a discriminator becomes a one-value enum per alternative',
  J(inferSchema([{ op: 'a', x: 1 }, { op: 'b', y: 2 }])) === '{"type":"array","items":{"anyOf":[{"type":"object","properties":{"op":{"type":"string","enum":["a"]},"x":{"type":"number"}},"required":["op","x"],"propertyOrdering":["op","x"]},{"type":"object","properties":{"op":{"type":"string","enum":["b"]},"y":{"type":"number"}},"required":["op","y"],"propertyOrdering":["op","y"]}]}}');
ok('a shared key with ONE value stays a plain string', J((inferSchema([{ k: 'same', a: 1 }, { k: 'same', b: 2 }]) as any).items.anyOf[0].properties.k) === '{"type":"string"}');
ok('a shared key with PROSE values is not a discriminator (no enum pinning a sentence)',
  !/enum/.test(J(inferSchema([{ note: 'first thing', a: 1 }, { note: 'second thing', b: 2 }]))));
ok('a `<placeholder>` is not a discriminator value', !/enum/.test(J(inferSchema([{ t: '<a>', a: 1 }, { t: '<b>', b: 2 }]))));
ok('a shared key that is a number in some example is not a discriminator', !/enum/.test(J(inferSchema([{ op: 'a', a: 1 }, { op: 2, b: 2 }]))));
ok('duplicate shapes (same keys, same discriminator value) collapse to one alternative, first kept',
  (inferSchema([{ op: 'a', x: 1 }, { op: 'b', y: 1 }, { op: 'a', x: 9 }]) as any).items.anyOf.length === 2);
ok('same keys, different discriminator values → still one alternative each',
  (inferSchema([{ op: 'a', x: 1 }, { op: 'b', x: 1 }, { op: 'c', y: 1 }]) as any).items.anyOf.map((a: any) => a.properties.op.enum[0]).join() === 'a,b,c');
ok('examples sharing ONE key set (even with differing op-like values) infer exactly like the old rule',
  J(inferSchema({ xs: [{ op: 'a', b: 'x' }, { op: 'c', b: 'y' }] })) === J(legacyInferSchema({ xs: [{ op: 'a', b: 'x' }, { op: 'c', b: 'y' }] })));
ok('empty array → array of strings (unchanged)', J(inferSchema([])) === '{"type":"array","items":{"type":"string"}}');
ok('one-example array unchanged', J(inferSchema([{ a: 1 }])) === J(legacyInferSchema([{ a: 1 }])));
ok('array of primitives reads val[0] (unchanged)', J(inferSchema([1, 'x'])) === '{"type":"array","items":{"type":"number"}}');
ok('mixed object/primitive array reads val[0] (unchanged)', J(inferSchema([{ a: 1 }, 'x'])) === J(legacyInferSchema([{ a: 1 }, 'x'])));
ok('null / undefined → string', J(inferSchema(null)) === '{"type":"string"}' && J(inferSchema(undefined)) === '{"type":"string"}');
ok('nested multi-shape array inside an object → anyOf there, recursive inference inside each alternative',
  (inferSchema({ o: { xs: [{ a: 1 }, { b: [{ c: 1 }, { d: 's' }] }] } }) as any).properties.o.properties.xs.items.anyOf[1].properties.b.items.anyOf.length === 2);
ok('hintHasMultiShapeArray: identical-key examples do not trigger the prompt sentence', !hintHasMultiShapeArray({ xs: [{ a: 1 }, { a: 2 }] }) && hintHasMultiShapeArray({ xs: [{ a: 1 }, { b: 2 }] }));
ok('hintHasMultiShapeArray reads a single-shape array from val[0] only, as inferSchema does (a multi-shape array in a LATER same-key row reaches neither)',
  (() => { const h = { xs: [{ a: [1] }, { a: [{ b: 1 }, { c: 2 }] }] }; return !hintHasMultiShapeArray(h) && !/anyOf/.test(J(inferSchema(h))); })()
    && hintHasMultiShapeArray({ xs: [{ a: [{ b: 1 }, { c: 2 }] }, { a: [1] }] }));
ok('hintHasMultiShapeArray fires exactly where inferSchema emits anyOf (every hint, raw)',
  found.every(h => hintHasMultiShapeArray(h.raw) === /"anyOf"/.test(J(inferSchema(h.raw)))));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
