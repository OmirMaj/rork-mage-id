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
// could not be expressed at all (no title, no duration), and the review showed
// whatever move-shaped op survived. That is the "only 1 acknowledged" bug.
//
// THE ONE RULE THAT CHANGED: an array hint holding TWO OR MORE object examples
// is read as a list of alternative item SHAPES and becomes ONE item schema —
//   properties = the union of every example's keys (first occurrence wins, in
//                first-seen order, so example 0's keys lead in its own order);
//   required   = only the keys EVERY example carries.
// Everything else is byte-identical to the old relay: a one-example array, an
// empty array, an array of primitives, objects, scalars. Held fixed, every hint
// in the repo infers the same under this rule as under the old one except the
// three rewritten to list shapes (validate-ai-infer-schema compares both rules
// on every hint). Hints whose LITERAL was edited are a separate question: that
// validator also pins each site against a committed snapshot
// (scripts/validate-ai-infer-schema.snapshot.json) that records the schema
// production ran at 6065b326, and names every site that moved since — the
// three shape hints plus the schedule builder's typed placeholders.
//
// Emits only `type`, `properties`, `required` and `items` — no propertyOrdering,
// no anyOf — the subset every Gemini model version has accepted.

export interface InferredSchema {
  type: string;
  properties?: Record<string, InferredSchema>;
  required?: string[];
  items?: InferredSchema;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** True when `val` is an array of 2+ plain-object examples — the case the
 *  union rule reads as alternative item shapes. */
export function isMultiShapeArray(val: unknown): val is Record<string, unknown>[] {
  return Array.isArray(val) && val.length >= 2 && val.every(isPlainObject);
}

/** True when some array in the hint lists 2+ object examples whose key sets
 *  DIFFER — i.e. it really is showing alternative shapes. The relay uses it to
 *  add one sentence telling the model the examples are alternatives, not a
 *  list to copy. Examples that all share one key set (utils/oacEngine.ts'
 *  actionItems) do not trigger it, so that prompt stays byte-identical. */
export function hintHasMultiShapeArray(val: unknown): boolean {
  if (isMultiShapeArray(val)) {
    const sig = (o: Record<string, unknown>) => Object.keys(o).sort().join("\u0000");
    if (new Set(val.map(sig)).size > 1) return true;
  }
  if (Array.isArray(val)) return val.some(hintHasMultiShapeArray);
  if (isPlainObject(val)) return Object.values(val).some(hintHasMultiShapeArray);
  return false;
}

function unionItemSchema(examples: Record<string, unknown>[]): InferredSchema {
  const properties: Record<string, InferredSchema> = {};
  for (const ex of examples) {
    for (const [k, v] of Object.entries(ex)) {
      if (!hasOwn(properties, k)) properties[k] = inferSchema(v);
    }
  }
  // Order follows example 0 (then first-seen), so a union whose examples all
  // share example 0's keys lists `required` exactly as the old rule did.
  const required = Object.keys(properties).filter(k => examples.every(ex => hasOwn(ex, k)));
  return { type: "object", properties, required };
}

export function inferSchema(val: unknown): InferredSchema {
  if (val === null || val === undefined) return { type: "string" };
  if (Array.isArray(val)) {
    if (isMultiShapeArray(val)) return { type: "array", items: unionItemSchema(val) };
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
