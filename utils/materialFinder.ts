// materialFinder.ts — AI material lookup for the estimator's search box.
//
// WHAT THIS IS, EXACTLY. `mageAI` relays to Gemini with NO browsing tool, no
// supplier feed and no price file. Every number that comes back is model
// recall. This file used to open its prompt with "You are a construction
// materials pricing expert with access to current US construction supply
// pricing" and ask for "2025-2026 US pricing from major suppliers like Home
// Depot, Lowe's" — a premise that is false at the relay, and an instruction
// that made the model NAME a store it never checked. The store name then rode
// into the material's `supplier` field (app/(tabs)/estimate/full.tsx) and out
// onto a bid PDF the GC signs, so the client read "3/4" copper Type L — Home
// Depot — $4.85/ft" with neither the price nor the store ever verified
// (audit 2026-09-07, money-trust). Removed 2026-09-07: the premise, the store
// names, and the model-filled `priceSource` field they landed in.
//
// Deleted with them: `getPriceComparison` (schema fields `homeDepotPrice`,
// `lowesPrice`, `rsmeansPrice`, `rsmeansYear`) and `suggestMaterialsForPhase`.
// Both fabricated named-source pricing, both had zero callers anywhere in the
// tree, and both were one import away from putting an "RSMeans price" the
// model made up in front of a contractor.

import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';

/**
 * The one true thing about where these prices come from. Constant, never
 * model-supplied — a field the model fills is a field the model can put a
 * store name in.
 */
export const AI_PRICE_SOURCE = 'AI estimate — not a supplier quote';

const materialSearchSchema = z.object({
  materials: z.array(z.object({
    name: z.string(),
    description: z.string(),
    unit: z.string(),
    unitPrice: z.number(),
    category: z.string(),
    brand: z.string().optional(),
    size: z.string().optional(),
    specifications: z.string().optional(),
    commonUses: z.array(z.string()),
    alternateNames: z.array(z.string()),
    relatedItems: z.array(z.string()),
    priceConfidence: z.enum(['high', 'medium', 'low']),
    laborToInstall: z.object({
      hoursPerUnit: z.number(),
      crew: z.string(),
      crewSize: z.number(),
    }).optional(),
  })),
  searchTips: z.string().optional(),
});

export type AIMaterialResult = z.infer<typeof materialSearchSchema>['materials'][number] & {
  /** Always AI_PRICE_SOURCE. Stamped here, never parsed from the response. */
  priceSource: string;
};
export type AIMaterialSearchResponse =
  Omit<z.infer<typeof materialSearchSchema>, 'materials'> & { materials: AIMaterialResult[] };

export async function findMaterials(
  searchQuery: string,
  category?: string,
  zipCode?: string,
): Promise<AIMaterialSearchResponse> {
  console.log('[MaterialFinder] Searching for:', searchQuery, 'category:', category, 'zip:', zipCode);

  const aiResult = await mageAI({
    prompt: `You are a construction estimator. From general knowledge only, list materials matching this search query with a plausible order-of-magnitude US retail price for each.

SEARCH: "${searchQuery}"
${category ? `CATEGORY: ${category}` : ''}
${zipCode ? `LOCATION: ${zipCode} (adjust for regional cost differences)` : ''}

You have NO price feed, NO catalog and NO browsing. Do not name a store, a supplier or a distributor, and do not claim a price was looked up — these are recalled estimates the contractor will verify.

Return 3-8 matching materials with:
1. A recalled retail price, realistic for the US — not wholesale, not inflated
2. The correct unit of measure for how this material is typically purchased
3. Common construction uses
4. Alternate names contractors might search for
5. Related items they might also need
6. If applicable, estimated labor hours to install per unit
7. priceConfidence: how sure you are of the price from memory alone

Be SPECIFIC with product names (e.g., "2" Schedule 40 PVC 90° Elbow" not just "PVC fitting"). Include manufacturer brand names where they identify the product.

If the search is vague, return the most common variants. For example, if someone searches "copper pipe", return 1/2", 3/4", and 1" in Type M and Type L.`,
    schema: materialSearchSchema,
    tier: 'fast',
  });

  if (!aiResult.success) {
    console.log('[MaterialFinder] AI failed:', aiResult.error);
    throw new Error(aiResult.error || 'Material search unavailable');
  }

  const result: z.infer<typeof materialSearchSchema> = aiResult.data;
  console.log('[MaterialFinder] Found', result.materials.length, 'materials');
  return {
    ...result,
    materials: result.materials.map(m => ({ ...m, priceSource: AI_PRICE_SOURCE })),
  };
}
