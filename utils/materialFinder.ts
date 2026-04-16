import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';

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
    priceSource: z.string(),
    priceConfidence: z.enum(['high', 'medium', 'low']),
    laborToInstall: z.object({
      hoursPerUnit: z.number(),
      crew: z.string(),
      crewSize: z.number(),
    }).optional(),
  })),
  searchTips: z.string().optional(),
});

export type AIMaterialResult = z.infer<typeof materialSearchSchema>['materials'][number];
export type AIMaterialSearchResponse = z.infer<typeof materialSearchSchema>;

export async function findMaterials(
  searchQuery: string,
  category?: string,
  zipCode?: string,
): Promise<AIMaterialSearchResponse> {
  console.log('[MaterialFinder] Searching for:', searchQuery, 'category:', category, 'zip:', zipCode);

  const aiResult = await mageAI({
    prompt: `You are a construction materials pricing expert with access to current US construction supply pricing. Find materials matching this search query and provide accurate current pricing.

SEARCH: "${searchQuery}"
${category ? `CATEGORY: ${category}` : ''}
${zipCode ? `LOCATION: ${zipCode} (adjust pricing for regional cost differences)` : ''}

Return 3-8 matching materials with:
1. Accurate current retail pricing (use 2025-2026 US pricing from major suppliers like Home Depot, Lowe's, or specialty distributors)
2. The correct unit of measure for how this material is typically purchased
3. Common construction uses
4. Alternate names contractors might search for
5. Related items they might also need
6. If applicable, estimated labor hours to install per unit

Be SPECIFIC with product names (e.g., "2" Schedule 40 PVC 90° Elbow" not just "PVC fitting"). Include brand names where relevant. Prices should be realistic retail pricing — not wholesale, not inflated.

If the search is vague, return the most common variants. For example, if someone searches "copper pipe", return 1/2", 3/4", and 1" in Type M and Type L.`,
    schema: materialSearchSchema,
    tier: 'fast',
  });

  if (!aiResult.success) {
    console.log('[MaterialFinder] AI failed:', aiResult.error);
    throw new Error(aiResult.error || 'Material search unavailable');
  }

  const result = aiResult.data;
  console.log('[MaterialFinder] Found', result.materials.length, 'materials');
  return result;
}

const priceComparisonSchema = z.object({
  homeDepotPrice: z.number().optional(),
  lowesPrice: z.number().optional(),
  industryAverage: z.number(),
  rsmeansPrice: z.number().optional(),
  rsmeansYear: z.string().optional(),
  priceTrend: z.enum(['rising', 'falling', 'stable']),
  trendPercentage: z.number(),
  bulkPricing: z.array(z.object({
    minQuantity: z.number(),
    pricePerUnit: z.number(),
    savings: z.string(),
  })).optional(),
  purchasedTogether: z.array(z.string()),
  priceNote: z.string().optional(),
});

export type PriceComparisonResult = z.infer<typeof priceComparisonSchema>;

export async function getPriceComparison(
  materialName: string,
  currentPrice: number,
  unit: string,
): Promise<PriceComparisonResult> {
  console.log('[MaterialFinder] Getting price comparison for:', materialName);

  const aiResult = await mageAI({
    prompt: `You are a construction materials pricing expert. Provide price comparison data for this material.

MATERIAL: "${materialName}"
CURRENT PRICE: $${currentPrice}/${unit}

Provide:
1. Estimated Home Depot price
2. Estimated Lowe's price
3. Industry average price
4. RSMeans reference price (if applicable, with year)
5. Price trend (rising/falling/stable) with percentage change over last 6 months
6. Bulk pricing tiers if applicable
7. Related items commonly purchased together (3-5 items)
8. Any price notes (e.g., "Lumber prices volatile due to tariffs")

Use realistic 2025-2026 US pricing.`,
    schema: priceComparisonSchema,
    tier: 'fast',
  });

  if (!aiResult.success) {
    console.log('[MaterialFinder] Price comparison AI failed:', aiResult.error);
    throw new Error(aiResult.error || 'Price comparison unavailable');
  }

  const result = aiResult.data;
  console.log('[MaterialFinder] Price comparison complete');
  return result;
}

const phaseSuggestionsSchema = z.object({
  phase: z.string(),
  suggestedMaterials: z.array(z.object({
    name: z.string(),
    unit: z.string(),
    unitPrice: z.number(),
    suggestedQuantity: z.number(),
    reason: z.string(),
  })),
  estimatedPhaseCost: z.number(),
  tips: z.array(z.string()),
});

export type PhaseSuggestionsResult = z.infer<typeof phaseSuggestionsSchema>;

export async function suggestMaterialsForPhase(
  phase: string,
  projectType: string,
  squareFootage: number,
): Promise<PhaseSuggestionsResult> {
  console.log('[MaterialFinder] Suggesting materials for phase:', phase, 'type:', projectType, 'sqft:', squareFootage);

  const aiResult = await mageAI({
    prompt: `You are a construction estimating expert. Suggest the essential materials needed for the "${phase}" phase of a ${projectType} project that is ${squareFootage} SF. 

Include:
1. Every material commonly needed for this phase
2. Realistic quantities based on the square footage
3. Current 2025-2026 pricing
4. Why each material is needed

Order by importance (most essential first). Include both structural materials and fasteners/connectors/adhesives that are often forgotten. Return 8-15 materials.`,
    schema: phaseSuggestionsSchema,
    tier: 'fast',
  });

  if (!aiResult.success) {
    console.log('[MaterialFinder] Phase suggestions AI failed:', aiResult.error);
    throw new Error(aiResult.error || 'Phase suggestions unavailable');
  }

  const result = aiResult.data;
  console.log('[MaterialFinder] Phase suggestions complete:', result.suggestedMaterials.length, 'items');
  return result;
}
