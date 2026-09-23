// _shared/inferSchema.ts — turn a client's plain-JS `schemaHint` example into
// the JSON Schema the `ai` relay hands Gemini as `responseSchema`.
//
// NO Deno imports, on purpose (same rule as _shared/paymentMath.ts): the relay
// (Deno) imports this file, and scripts/validate-ai-infer-schema.ts plus
// scripts/validate-copilot-edit-relay-contract.ts run the SAME function under
// bun, so the schema Gemini decodes against is tested exactly as it runs.
//
// Why the schema matters so much: constrained decoding can only emit the keys
// the schema declares, and it always emits the `required` ones. The old rule
// built an array's item schema from `val[0]` alone and marked every key of it
// required. The schedule editor's hint had one example op — a move — so every
// op Gemini could return was exactly {op, task, deltaDays}: "add three tasks"
// could not be expressed at all. That is the "only 1 acknowledged" bug.
//
// WHAT WENT WRONG WITH THE FIRST FIX (wave 6a, rolled back in production —
// docs/deploy/2026-09-23-ai-relay-rollback.md): it merged the alternative
// shapes into ONE item schema — the union of every example's keys, only the
// shared keys required. For the schedule editor that is 15 optional fields and
// required [op]. Gemini then filled addDependency's free-form `type` string on
// an addTask and looped inside it until MAX_TOKENS (7,760 output tokens, 33 s;
// the app timed out at 60 s), 2 of 2 times. An OPTIONAL FREE-FORM STRING in a
// multi-shape item is the degeneration class; this rule never emits one.
//
// THE RULE (candidate C2, passed live: 2.5 s, STOP, 113 output tokens):
// an array hint with 2+ plain-object examples whose KEY SETS DIFFER is a list
// of alternative item shapes and becomes
//   items: { anyOf: [ one alternative per distinct (key set + discriminator
//                     values) example, in example order ] }
// where each alternative is
//   { type: 'object',
//     properties: that example's keys only (inferred recursively, this rule),
//     required: ALL of that example's keys,
//     propertyOrdering: that example's key order }.
// A DISCRIMINATOR is a key every example carries whose values are all
// identifier-like strings (op names — no spaces, not a `<placeholder>`) and
// not all equal: the schedule/estimate editors' `op`. In each alternative it
// becomes { type: 'string', enum: [that example's value] }. A shared key with
// one value for every example (bulk edit's alias: '<alias>') stays a plain
// string. Prose values are never a discriminator: an enum would pin the
// model to the example's sentence.
//
// Everything else is byte-identical to the relay production ran at 6065b326:
// a one-example array, an empty array, an array of primitives, a mixed array,
// objects, scalars — and an array whose object examples all share ONE key set,
// which reads val[0] with every key required even when the example VALUES
// differ. That last case is deliberate and wider than "no discriminator":
// runtime-built example arrays (utils/bidLevelingEngine.ts' `bids.map(b =>
// ({ bidId: b.id, … }))`) and literal lists of sample rows
// (utils/oacEngine.ts' actionItems) carry differing strings in every key; an
// enum there would lock the model to the sample data.
// scripts/validate-ai-infer-schema.ts proves every other hint site infers
// exactly what 6065b326 inferred, with the real example strings.

export interface InferredSchema {
  type: string;
  properties?: Record<string, InferredSchema>;
  required?: string[];
  items?: InferredSchema | { anyOf: InferredSchema[] };
  enum?: string[];
  propertyOrdering?: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const keySig = (o: Record<string, unknown>) => Object.keys(o).sort().join("\u0000");

/** An op-name-like value: a discriminator must name a shape, never carry
 *  prose or a `<placeholder>`. */
const DISCRIMINATOR_VALUE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** True when `val` is an array of 2+ plain-object examples whose key sets
 *  DIFFER — the case read as alternative item shapes (anyOf). Examples that
 *  all share one key set are NOT, whatever their values. */
export function isMultiShapeArray(val: unknown): val is Record<string, unknown>[] {
  return Array.isArray(val) && val.length >= 2 && val.every(isPlainObject)
    && new Set(val.map(keySig)).size > 1;
}

/** True when some array in the hint lists alternative item shapes. The relay
 *  uses it to add one sentence telling the model the examples are
 *  alternatives, not a list to copy. Every other hint's prompt stays
 *  byte-identical. It walks the hint exactly as inferSchema does — a
 *  single-shape array is read from val[0] only — so the sentence fires exactly
 *  when the schema carries an anyOf (a nested multi-shape array in a LATER
 *  same-key row reaches neither). */
export function hintHasMultiShapeArray(val: unknown): boolean {
  if (isMultiShapeArray(val)) return true;
  if (Array.isArray(val)) return val.length > 0 && hintHasMultiShapeArray(val[0]);
  if (isPlainObject(val)) return Object.values(val).some(hintHasMultiShapeArray);
  return false;
}

/** Keys that tell the shapes apart: in every example, identifier-like string
 *  values, not all equal. In example 0's key order. */
export function discriminatorKeys(examples: Record<string, unknown>[]): string[] {
  const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  return Object.keys(examples[0]).filter(k =>
    examples.every(ex => hasOwn(ex, k) && typeof ex[k] === "string" && DISCRIMINATOR_VALUE.test(ex[k] as string))
    && new Set(examples.map(ex => ex[k])).size > 1);
}

function alternativeSchemas(examples: Record<string, unknown>[]): InferredSchema[] {
  const disc = discriminatorKeys(examples);
  const seen = new Set<string>();
  const out: InferredSchema[] = [];
  for (const ex of examples) {
    const id = keySig(ex) + "\u0001" + disc.map(k => String(ex[k])).join("\u0000");
    if (seen.has(id)) continue;
    seen.add(id);
    const keys = Object.keys(ex);
    const properties: Record<string, InferredSchema> = {};
    for (const k of keys) {
      properties[k] = disc.includes(k) ? { type: "string", enum: [ex[k] as string] } : inferSchema(ex[k]);
    }
    out.push({ type: "object", properties, required: [...keys], propertyOrdering: [...keys] });
  }
  return out;
}

export function inferSchema(val: unknown): InferredSchema {
  if (val === null || val === undefined) return { type: "string" };
  if (Array.isArray(val)) {
    if (isMultiShapeArray(val)) return { type: "array", items: { anyOf: alternativeSchemas(val) } };
    return { type: "array", items: val.length > 0 ? inferSchema(val[0]) : { type: "string" } };
  }
  if (typeof val === "object") {
    const properties: Record<string, InferredSchema> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      properties[k] = inferSchema(v);
      required.push(k);
    }
    return { type: "object", properties, required };
  }
  if (typeof val === "number") return { type: "number" };
  if (typeof val === "boolean") return { type: "boolean" };
  return { type: "string" };
}
