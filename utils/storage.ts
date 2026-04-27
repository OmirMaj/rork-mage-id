import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export async function uploadProjectPhoto(
  userId: string,
  projectId: string,
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const fileName = `${userId}/${projectId}/${Date.now()}.jpg`;
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const { error } = await supabase.storage
      .from('project-photos')
      .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) {
      console.log('[Storage] Photo upload error:', error.message);
      return null;
    }
    const { data: signedData } = await supabase.storage
      .from('project-photos')
      .createSignedUrl(fileName, 60 * 60 * 24 * 7);
    console.log('[Storage] Photo uploaded:', fileName);
    return signedData?.signedUrl ?? null;
  } catch (err) {
    console.log('[Storage] Photo upload failed:', err);
    return null;
  }
}

export async function uploadDocument(
  userId: string,
  fileName: string,
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const path = `${userId}/${Date.now()}_${fileName}`;
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const { error } = await supabase.storage
      .from('documents')
      .upload(path, blob, { contentType: 'application/pdf', upsert: false });
    if (error) {
      console.log('[Storage] Document upload error:', error.message);
      return null;
    }
    const { data: signedData } = await supabase.storage
      .from('documents')
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    console.log('[Storage] Document uploaded:', path);
    return signedData?.signedUrl ?? null;
  } catch (err) {
    console.log('[Storage] Document upload failed:', err);
    return null;
  }
}

export async function uploadBrandingAsset(
  userId: string,
  type: 'logo' | 'signature',
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const ext = type === 'logo' ? 'png' : 'png';
    const path = `${userId}/${type}_${Date.now()}.${ext}`;
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const { error } = await supabase.storage
      .from('branding')
      .upload(path, blob, { contentType: `image/${ext}`, upsert: true });
    if (error) {
      console.log('[Storage] Branding upload error:', error.message);
      return null;
    }
    const { data: signedData } = await supabase.storage
      .from('branding')
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    console.log('[Storage] Branding asset uploaded:', path);
    return signedData?.signedUrl ?? null;
  } catch (err) {
    console.log('[Storage] Branding upload failed:', err);
    return null;
  }
}

export async function uploadProfileImage(
  userId: string,
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const path = `${userId}/avatar_${Date.now()}.jpg`;
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const { error } = await supabase.storage
      .from('profiles')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.log('[Storage] Profile image upload error:', error.message);
      return null;
    }
    const { data: urlData } = supabase.storage.from('profiles').getPublicUrl(path);
    console.log('[Storage] Profile image uploaded:', path);
    return urlData.publicUrl;
  } catch (err) {
    console.log('[Storage] Profile image upload failed:', err);
    return null;
  }
}

// Upload a homeowner-RFP attachment (photo or drawing PDF) to the
// public rfp-attachments bucket. Returns the public URL — the bucket is
// public-read so contractors browsing the listing can fetch directly.
// Path convention is <userId>/<rfpId>/<timestamp>_<filename> which the
// RLS policy on storage.objects expects (folder[1] must equal auth.uid()).
export async function uploadRfpAttachment(
  userId: string,
  rfpId: string,
  fileUri: string,
  fileName: string,
  contentType: string,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${userId}/${rfpId}/${Date.now()}_${safeName}`;
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const { error } = await supabase.storage
      .from('rfp-attachments')
      .upload(path, blob, { contentType, upsert: false });
    if (error) {
      console.log('[Storage] RFP attachment upload error:', error.message);
      return null;
    }
    const { data } = supabase.storage.from('rfp-attachments').getPublicUrl(path);
    return data.publicUrl ?? null;
  } catch (err) {
    console.log('[Storage] RFP attachment upload failed:', err);
    return null;
  }
}

export async function deleteStorageFile(
  bucket: string,
  path: string,
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) {
      console.log('[Storage] Delete error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.log('[Storage] Delete failed:', err);
    return false;
  }
}
