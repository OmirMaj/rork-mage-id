import { supabase } from '@/lib/supabase';

/**
 * Resolve a product photo for a selection option. Tries og:image from `url`,
 * then a Pexels keyword search (`query`) server-side. Never throws — returns
 * null on any failure so curation/save can proceed photo-less.
 */
export async function resolveSelectionImage(opts: { url?: string; query?: string }): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke<{ success: boolean; imageUrl: string | null }>(
      'og-image', { body: opts },
    );
    if (error || !data?.success) return null;
    return data.imageUrl ?? null;
  } catch {
    return null;
  }
}
