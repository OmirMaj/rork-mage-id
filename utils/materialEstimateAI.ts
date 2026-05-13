// materialEstimateAI.ts — AI helper for the materials cart.
//
// User-facing flow:
//   1) User has built up a cart by adding materials (browser tab or Estimate).
//   2) They tap "Ask AI" on the cart and type a one-line project description
//      ("Kitchen remodel, 200sf, mid-grade finishes").
//   3) AI returns per-item suggested quantity + markup, a labor estimate
//      range, and a few overall recommendations.
//   4) UI shows the suggestions as cards the user can tap to apply.
//
// Pattern matches utils/scheduleAI.ts: serialize cart into a compact view,
// alias each row, ask Gemini for typed JSON, map aliases back to material
// ids on return. Caller wires "Apply" buttons to updateQuantity/updateMarkup
// from MaterialCartContext.
//
// AI output is SUGGESTIONS. The user always commits the change — we never
// mutate the cart automatically.

import { mageAI } from '@/utils/mageAI';
import type { MaterialCartItem } from '@/contexts/MaterialCartContext';

export interface AIMaterialSuggestion {
  /** Original material id (resolved from alias). */
  materialId: string;
  /** Original name (for display when material may not be in lookup). */
  materialName: string;
  /** Suggested quantity given the project description. */
  suggestedQuantity: number;
  /** Suggested markup percent (0-100). */
  suggestedMarkup: number;
  /** One-sentence rationale ("typical for 200sf kitchen"). */
  rationale: string;
}

export interface AILaborEstimateRange {
  low: number;
  high: number;
  rationale: string;
}

export interface AIMaterialEstimateResult {
  perItem: AIMaterialSuggestion[];
  laborEstimateRange: AILaborEstimateRange;
  overallRecommendations: string[];
  summary: string;
  fromCache?: boolean;
  errorKind?: 'timeout' | 'network' | 'http' | 'model' | 'validation' | 'unauthenticated' | 'monthly_cap' | 'unknown';
  errorDetail?: string;
}

// ---------------------------------------------------------------------------
// Internal: alias-based serialization. We pass aliases (M1, M2, ...) to the
// model rather than internal ids so it has a stable, short handle it can
// echo back without paraphrasing.
// ---------------------------------------------------------------------------
function buildAliasMap(cart: MaterialCartItem[]): {
  byAlias: Map<string, MaterialCartItem>;
  byId: Map<string, string>;
} {
  const byAlias = new Map<string, MaterialCartItem>();
  const byId = new Map<string, string>();
  cart.forEach((item, i) => {
    const alias = `M${i + 1}`;
    byAlias.set(alias, item);
    byId.set(item.material.id, alias);
  });
  return { byAlias, byId };
}

function serializeCart(cart: MaterialCartItem[]): string {
  const lines: string[] = [];
  lines.push('Materials in cart (alias | name | category | unit | qty | retail | bulk | bulkMin | current markup%):');
  cart.forEach((item, i) => {
    const alias = `M${i + 1}`;
    const m = item.material;
    lines.push(
      `${alias} | ${m.name} | ${m.category} | ${m.unit} | qty=${item.quantity} | retail=$${m.baseRetailPrice.toFixed(2)} | bulk=$${m.baseBulkPrice.toFixed(2)} | bulkMin=${m.bulkMinQty} | markup=${item.markup}%`,
    );
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public: suggest a tuned cart for a project description.
// ---------------------------------------------------------------------------
export async function aiSuggestMaterialEstimate(
  cart: MaterialCartItem[],
  projectDescription: string,
): Promise<AIMaterialEstimateResult> {
  if (cart.length === 0) {
    return {
      perItem: [],
      laborEstimateRange: { low: 0, high: 0, rationale: 'No materials in cart yet — add items first.' },
      overallRecommendations: [],
      summary: 'Cart is empty.',
    };
  }
  const desc = projectDescription.trim();
  if (!desc) {
    return {
      perItem: [],
      laborEstimateRange: { low: 0, high: 0, rationale: 'Add a project description so the AI can tune the estimate.' },
      overallRecommendations: [],
      summary: 'Description required.',
    };
  }

  const { byAlias } = buildAliasMap(cart);
  const serialized = serializeCart(cart);

  // schemaHint is a plain JSON example so Gemini knows the shape. mageAI
  // serializes this directly to the edge function and sets jsonMode=true.
  const schemaHint = {
    summary: 'one-line takeaway for the user',
    overallRecommendations: ['short bullet 1', 'short bullet 2'],
    laborEstimateRange: {
      low: 0,
      high: 0,
      rationale: 'why labor lands in this range for this project',
    },
    perItem: [
      {
        alias: 'M1',
        suggestedQuantity: 0,
        suggestedMarkup: 15,
        rationale: 'one sentence justifying the change',
      },
    ],
  };

  const prompt = `You are a construction estimator. The user has built up a cart
of materials and described their project. Tune the cart for that project:

For EACH cart item (cited by alias), suggest:
  - suggestedQuantity: the realistic quantity for this project (NOT a delta —
    the absolute number). May match or differ from current quantity.
  - suggestedMarkup: percent markup (0-100) appropriate for the item's risk,
    waste, and category. Higher for specialty / volatile items; lower for
    commodities the customer can price-check.
  - rationale: ONE sentence, plain English. No filler.

Also return:
  - laborEstimateRange: low/high dollars for labor on this project, with a
    one-sentence rationale referencing the cart contents.
  - overallRecommendations: 1-3 short bullets the user should know (e.g.
    "consider switching to bulk pricing", "add waste factor on framing",
    "this scope needs a permit").

Rules:
  - Cite material aliases EXACTLY as listed below — do not invent new ones.
  - Cover EVERY item in the cart, even if your suggestion matches the
    current quantity (the user wants confirmation either way).
  - Quantities are whole numbers when the unit is countable ("each", "sheet",
    "stud"); fractional only for things sold by length / volume / area.
  - Suggested markup must be between 0 and 100.
  - Be concrete — assume the user is a contractor, not a homeowner.

Project description:
${desc}

${serialized}`;

  const res = await mageAI({
    prompt,
    schemaHint,
    tier: 'smart',
    maxTokens: 1200,
    // Don't cache — the same cart with the same description could legitimately
    // be re-requested if the user wants a fresh take. Cache hits would feel
    // broken ("I asked again and it gave me the same thing").
  });

  if (!res.success || !res.data) {
    return {
      perItem: [],
      laborEstimateRange: {
        low: 0,
        high: 0,
        rationale: res.error || 'AI could not generate suggestions.',
      },
      overallRecommendations: [],
      summary: res.error || 'AI suggestions unavailable.',
      fromCache: res.fromCache,
      errorKind: res.errorKind,
      errorDetail: res.error,
    };
  }

  const raw = res.data as {
    summary?: string;
    overallRecommendations?: string[];
    laborEstimateRange?: { low?: number; high?: number; rationale?: string };
    perItem?: {
      alias?: string;
      suggestedQuantity?: number;
      suggestedMarkup?: number;
      rationale?: string;
    }[];
  };

  const perItem: AIMaterialSuggestion[] = [];
  for (const row of raw.perItem ?? []) {
    if (!row.alias) continue;
    const item = byAlias.get(row.alias);
    if (!item) continue;
    const qty = Number(row.suggestedQuantity);
    const markup = Number(row.suggestedMarkup);
    perItem.push({
      materialId: item.material.id,
      materialName: item.material.name,
      suggestedQuantity: Number.isFinite(qty) && qty > 0 ? qty : item.quantity,
      suggestedMarkup: Number.isFinite(markup)
        ? Math.max(0, Math.min(100, markup))
        : item.markup,
      rationale: typeof row.rationale === 'string' ? row.rationale : '',
    });
  }

  const laborRaw = raw.laborEstimateRange ?? {};
  const laborLow = Number(laborRaw.low);
  const laborHigh = Number(laborRaw.high);
  const laborEstimateRange: AILaborEstimateRange = {
    low: Number.isFinite(laborLow) && laborLow >= 0 ? laborLow : 0,
    high: Number.isFinite(laborHigh) && laborHigh >= 0 ? laborHigh : 0,
    rationale: typeof laborRaw.rationale === 'string' ? laborRaw.rationale : '',
  };

  const overallRecommendations = Array.isArray(raw.overallRecommendations)
    ? raw.overallRecommendations
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .slice(0, 3)
    : [];

  return {
    perItem,
    laborEstimateRange,
    overallRecommendations,
    summary: raw.summary || `${perItem.length} suggestion(s).`,
    fromCache: res.fromCache,
    errorKind: res.errorKind,
    errorDetail: res.error,
  };
}
