// utils/planSheetMetadata.ts — client helper that calls the
// extract-plan-metadata edge function to auto-name uploaded plan
// sheets. Pre-fix every uploaded plan came in as "Sheet 1", "Sheet 2",
// "Sheet 3" — the GC had to retype "A-101 Floor Plan" / "S-201
// Foundation Plan" by hand for every page in the set. Buildxact's
// Takeoff Assistant does this automatically; we ship the same.
//
// Usage:
//   const meta = await extractPlanSheetMetadata(uploadedImageUrl);
//   if (meta?.sheetNumber) updatePlanSheet(id, { sheetNumber, name: ... });
//
// Failure modes (returns null in all of these):
//   - Supabase not configured
//   - Edge function unreachable / 5xx
//   - User not signed in (the auth gate rejects the call)
//   - Gemini returned low-confidence extraction (we surface the
//     fields anyway but the caller should ask the user to confirm)

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface PlanSheetMetadata {
  sheetNumber: string | null;
  sheetTitle: string | null;
  scaleNotation: string | null;
  confidence: 'low' | 'medium' | 'high';
}

export async function extractPlanSheetMetadata(imageUrl: string): Promise<PlanSheetMetadata | null> {
  if (!isSupabaseConfigured) return null;
  if (!imageUrl) return null;

  try {
    const { data, error } = await supabase.functions.invoke('extract-plan-metadata', {
      body: { imageUrl },
    });
    if (error) {
      console.log('[planSheetMetadata] edge function error', error.message);
      return null;
    }
    if (!data?.success || !data?.data) return null;
    const d = data.data as PlanSheetMetadata;
    return d;
  } catch (err) {
    console.log('[planSheetMetadata] error', err);
    return null;
  }
}

/**
 * Compose a human-readable plan-sheet `name` from extracted metadata.
 * Prefers "A-101 Floor Plan" format when both fields are present;
 * falls back to whichever single field we got. Returns null when
 * neither is usable so the caller can retain the GC's original name.
 */
export function composePlanSheetName(meta: PlanSheetMetadata): string | null {
  const num = meta.sheetNumber?.trim();
  const title = meta.sheetTitle?.trim();
  if (num && title) return `${num} ${title}`;
  if (num) return num;
  if (title) return title;
  return null;
}
