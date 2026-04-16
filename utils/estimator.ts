import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import type { ProjectType, QualityTier, EstimateBreakdown } from '@/types';

const materialLineItemSchema = z.object({
  name: z.string(),
  category: z.string(),
  unit: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  bulkPrice: z.number(),
  bulkThreshold: z.number(),
  totalPrice: z.number(),
  savings: z.number(),
});

const laborLineItemSchema = z.object({
  role: z.string(),
  hourlyRate: z.number(),
  hours: z.number(),
  totalCost: z.number(),
});

const estimateSchema = z.object({
  materials: z.array(materialLineItemSchema),
  labor: z.array(laborLineItemSchema),
  permits: z.number(),
  overhead: z.number(),
  contingency: z.number(),
  materialTotal: z.number(),
  laborTotal: z.number(),
  bulkSavingsTotal: z.number(),
  subtotal: z.number(),
  tax: z.number(),
  grandTotal: z.number(),
  pricePerSqFt: z.number(),
  estimatedDuration: z.string(),
  notes: z.array(z.string()),
});

export async function generateEstimate(params: {
  projectType: ProjectType;
  location: string;
  squareFootage: number;
  quality: QualityTier;
  description: string;
  taxRate: number;
  contingencyRate: number;
}): Promise<EstimateBreakdown> {
  console.log('[Estimator] Generating estimate with params:', params);

  const prompt = `You are a professional construction cost estimator with access to current 2024-2025 market pricing data. Generate a detailed, realistic construction cost estimate.

Project Details:
- Type: ${params.projectType.replace('_', ' ')}
- Location: ${params.location || 'United States average'}
- Square Footage: ${params.squareFootage} sq ft
- Quality Tier: ${params.quality}
- Description: ${params.description || 'Standard project'}
- Tax Rate: ${params.taxRate}%
- Contingency Rate: ${params.contingencyRate}%

Requirements:
1. Use REAL current market prices for ${params.location || 'US average'}. Research current Home Depot, Lowe's, and wholesale supplier pricing.
2. Include bulk buy discounts - if quantity exceeds bulk threshold, use the lower bulk price. Bulk prices should be 10-25% less than retail.
3. Include at least 8-15 material line items with realistic quantities for this project size.
4. Include 3-6 labor roles with realistic hourly rates for the area.
5. Calculate permits based on local requirements.
6. Add overhead (typically 10-15% of subtotal).
7. Calculate contingency at ${params.contingencyRate}%.
8. Apply tax at ${params.taxRate}% on materials only.
9. Ensure all math is correct - totalPrice should be quantity * (bulkPrice if quantity >= bulkThreshold, else unitPrice).
10. savings = (unitPrice - bulkPrice) * quantity if bulk applies, else 0.
11. Provide practical notes about the estimate including potential cost-saving tips and important considerations.
12. estimatedDuration should be a human-readable string like "4-6 weeks".
13. pricePerSqFt = grandTotal / squareFootage.

Be thorough, realistic, and use current market data. This needs to be a professional-grade estimate.`;

  try {
    const aiResult = await mageAI({
      prompt,
      schema: estimateSchema,
      tier: 'fast',
    });

    if (!aiResult.success) {
      console.error('[Estimator] AI failed:', aiResult.error);
      throw new Error(aiResult.error || 'Failed to generate estimate. Please try again.');
    }

    console.log('[Estimator] Estimate generated successfully');
    return aiResult.data as EstimateBreakdown;
  } catch (error) {
    console.error('[Estimator] Error generating estimate:', error);
    throw new Error('Failed to generate estimate. Please try again.');
  }
}

const materialCategorySchema = z.object({
  categories: z.array(z.object({
    id: z.string(),
    name: z.string(),
    items: z.array(z.object({
      name: z.string(),
      unit: z.string(),
      retailPrice: z.number(),
      bulkPrice: z.number(),
      bulkMinQty: z.number(),
      supplier: z.string(),
      lastUpdated: z.string(),
    })),
  })),
});

export async function fetchMaterialPrices(location: string, category?: string): Promise<{
  categories: Array<{
    id: string;
    name: string;
    items: Array<{
      name: string;
      unit: string;
      retailPrice: number;
      bulkPrice: number;
      bulkMinQty: number;
      supplier: string;
      lastUpdated: string;
    }>;
  }>;
}> {
  console.log('[Estimator] Fetching material prices for:', location, category);

  const prompt = `You are a construction materials pricing database with access to current 2024-2025 wholesale and retail prices. 
  
Generate current material prices for the ${location || 'United States'} market.
${category ? `Focus on the "${category}" category.` : 'Include all major categories.'}

For each category, provide 4-6 common materials with:
- Current retail prices (Home Depot/Lowe's level)
- Bulk/wholesale prices (contractor supply pricing)
- Minimum quantity for bulk pricing
- Primary supplier name
- Last updated date (use recent dates in 2025)

Categories to include: ${category || 'Lumber & Framing, Concrete & Masonry, Roofing, Flooring, Plumbing, Electrical, Paint & Finishes, Hardware & Fasteners'}

Use realistic, current market prices. Lumber prices should reflect current market conditions.`;

  try {
    const aiResult = await mageAI({
      prompt,
      schema: materialCategorySchema,
      tier: 'fast',
    });

    if (!aiResult.success) {
      console.error('[Estimator] AI failed:', aiResult.error);
      throw new Error(aiResult.error || 'Failed to fetch material prices.');
    }

    console.log('[Estimator] Material prices fetched');
    return aiResult.data as { categories: Array<{ id: string; name: string; items: Array<{ name: string; unit: string; retailPrice: number; bulkPrice: number; bulkMinQty: number; supplier: string; lastUpdated: string; }> }> };
  } catch (error) {
    console.error('[Estimator] Error fetching materials:', error);
    throw new Error('Failed to fetch material prices.');
  }
}
