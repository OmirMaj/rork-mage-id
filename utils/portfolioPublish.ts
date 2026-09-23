// utils/portfolioPublish.ts: the server half of publishing a portfolio page
// (audit wave 5, #47 / #75 / #77 / #81; migration 20260923200000).
//
// The public page is a snapshot in a URL hash, so everything it links to has
// to be reachable by a stranger for as long as the link sits on his website.
// His project photos live in the PRIVATE project-photos bucket and the app only
// ever holds file:// paths or 24-hour signed URLs for them. This module copies
// the chosen photos (and a data:/file: logo) into the public `portfolio` bucket
// at deterministic paths, so republishing is stable, and hands back the
// permanent public URLs. It also writes and reads the page's public_profiles
// row, which the page checks before it renders.
//
// No expo-image-manipulator (a native module means no OTA). The logo is kept
// small at pick time instead (app/company-profile.tsx lowers its quality).

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWriteDetailed, type WriteOutcome } from '@/utils/offlineQueue';
import { readFileBytes } from '@/utils/fileBytes';
import { base64ToBytes } from '@/utils/base64Bytes';
import { PHOTO_BUCKET } from '@/utils/photoUploadCore';
import type { ProjectPhoto } from '@/types';
import {
  PORTFOLIO_BUCKET, isDurablePublicUrl, publicProfileIdFor, sha256Hex,
} from '@/utils/publicProfileSnapshot';

/** portfolio/<ownerId>/<projectId>/<photoId>.jpg: one stable object per photo. */
export function portfolioPhotoPath(ownerId: string, projectId: string, photoId: string): string {
  return `${ownerId}/${projectId}/${photoId}.jpg`;
}

/** The public URL an object at `path` in the portfolio bucket will have. Pure string math. */
export function portfolioPublicUrl(path: string): string {
  return supabase.storage.from(PORTFOLIO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Where each chosen photo WILL be once published. Photos with no storagePath
 * haven't reached the cloud yet. They can't be copied, so they're listed
 * separately and the screen says so.
 */
export function planPortfolioPhotos(
  ownerId: string,
  projectId: string,
  chosen: ProjectPhoto[],
): { urls: Record<string, string>; notUploaded: ProjectPhoto[] } {
  const urls: Record<string, string> = {};
  const notUploaded: ProjectPhoto[] = [];
  for (const p of chosen) {
    if (p.storagePath && p.storagePath.trim()) urls[p.id] = portfolioPublicUrl(portfolioPhotoPath(ownerId, projectId, p.id));
    else notUploaded.push(p);
  }
  return { urls, notUploaded };
}

function isAlreadyExists(error: unknown): boolean {
  const e = error as { message?: string; statusCode?: string | number; status?: number } | null;
  const msg = e?.message ?? '';
  return /already exists|duplicate/i.test(msg) || String(e?.statusCode ?? '') === '409' || e?.status === 409;
}

/**
 * Bytes of one private photo, for the fallback when a server-side copy is
 * refused. Native downloads a short signed URL into the cache and reads it
 * through readFileBytes. RN's fetch().blob() uploads zero bytes (utils/fileBytes.ts).
 */
async function downloadPrivatePhoto(storagePath: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(storagePath, 120);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'could not sign the photo');
  if (Platform.OS === 'web') {
    const r = await fetch(data.signedUrl);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  const target = `${FileSystem.cacheDirectory ?? ''}portfolio-${sha256Hex(storagePath).slice(0, 16)}.jpg`;
  const res = await FileSystem.downloadAsync(data.signedUrl, target);
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  try {
    return await readFileBytes(res.uri);
  } finally {
    try { await FileSystem.deleteAsync(res.uri, { idempotent: true }); } catch { /* cache */ }
  }
}

async function copyOnePhoto(ownerId: string, projectId: string, p: ProjectPhoto): Promise<boolean> {
  const dest = portfolioPhotoPath(ownerId, projectId, p.id);
  const src = (p.storagePath ?? '').trim();
  if (!src) return false;
  // Server-side copy: no bytes through the phone. An object already at the
  // deterministic path is this same photo from an earlier publish.
  const copied = await supabase.storage.from(PHOTO_BUCKET).copy(src, dest, { destinationBucket: PORTFOLIO_BUCKET });
  if (!copied.error || isAlreadyExists(copied.error)) return true;
  try {
    const bytes = await downloadPrivatePhoto(src);
    if (bytes.byteLength === 0) return false;
    const up = await supabase.storage.from(PORTFOLIO_BUCKET)
      .upload(dest, bytes, { contentType: 'image/jpeg', upsert: true });
    return !up.error;
  } catch (e) {
    console.warn('[portfolioPublish] photo copy failed', p.id, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Where a logo copy lives: keyed by its content hash, so a new logo gets a new URL. */
function logoTarget(ownerId: string, logoUri: string): { path: string; contentType: string } {
  const m = logoUri.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  // 'image/jpg' isn't a registered type and the bucket's allow-list refuses it.
  const contentType = (m?.[1] ?? 'image/jpeg').toLowerCase().replace(/^image\/jpg$/, 'image/jpeg');
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : contentType === 'image/gif' ? 'gif' : 'jpg';
  return { path: `${ownerId}/branding/logo-${sha256Hex(logoUri).slice(0, 20)}.${ext}`, contentType: m ? contentType : `image/${ext === 'jpg' ? 'jpeg' : ext}` };
}

async function publishLogo(ownerId: string, logoUri: string | undefined): Promise<string | undefined> {
  const uri = (logoUri ?? '').trim();
  if (!uri) return undefined;
  if (isDurablePublicUrl(uri)) return uri;
  if (!/^(data:image\/|file:|content:|blob:|ph:|assets-library:)/i.test(uri)) return undefined;
  const { path, contentType } = logoTarget(ownerId, uri);
  try {
    const bytes = /^data:/i.test(uri) ? base64ToBytes(uri) : await readFileBytes(uri);
    if (bytes.byteLength === 0) return undefined;
    const { error } = await supabase.storage.from(PORTFOLIO_BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (error && !isAlreadyExists(error)) return undefined;
    return portfolioPublicUrl(path);
  } catch (e) {
    console.warn('[portfolioPublish] logo upload failed', e instanceof Error ? e.message : e);
    return undefined;
  }
}

export interface PublishAssetsResult {
  /** photo id → permanent public URL, only for copies that landed. */
  photoUrls: Record<string, string>;
  /** Photos with a storagePath whose copy failed (left out of the link). */
  failedPhotoIds: string[];
  /** The logo's public URL, or undefined (the page shows the company initial). */
  logoUrl?: string;
  /** True when he has a logo but it couldn't be published. */
  logoFailed: boolean;
}

/**
 * Copy the chosen photos (those with a storagePath) and the logo into the
 * portfolio bucket. Never throws: a photo that fails is reported, not
 * shipped as a URL that won't load.
 */
export async function publishPortfolioAssets(args: {
  ownerId: string;
  projectId: string;
  photos: ProjectPhoto[];
  logoUri?: string;
}): Promise<PublishAssetsResult> {
  const { ownerId, projectId } = args;
  const withPath = args.photos.filter(p => (p.storagePath ?? '').trim());
  // A few at a time: 18 parallel copies from a phone on one bar of signal
  // mostly time out together.
  const results: boolean[] = [];
  for (let i = 0; i < withPath.length; i += 4) {
    const batch = withPath.slice(i, i + 4);
    results.push(...await Promise.all(batch.map(p => copyOnePhoto(ownerId, projectId, p).catch(() => false))));
  }
  const photoUrls: Record<string, string> = {};
  const failedPhotoIds: string[] = [];
  withPath.forEach((p, i) => {
    if (results[i]) photoUrls[p.id] = portfolioPublicUrl(portfolioPhotoPath(ownerId, projectId, p.id));
    else failedPhotoIds.push(p.id);
  });
  const hadLogo = !!(args.logoUri ?? '').trim();
  const logoUrl = await publishLogo(ownerId, args.logoUri);
  return { photoUrls, failedPhotoIds, logoUrl, logoFailed: hadLogo && !logoUrl };
}

/**
 * Take the job's copies out of the public bucket (on unpublish). Best-effort:
 * a storage call, not a queued write. The page itself is already down,
 * because the row write IS queued.
 */
export async function removePortfolioCopies(ownerId: string, projectId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const folder = `${ownerId}/${projectId}`;
    const { data, error } = await supabase.storage.from(PORTFOLIO_BUCKET).list(folder, { limit: 100 });
    if (error || !data || data.length === 0) return;
    await supabase.storage.from(PORTFOLIO_BUCKET).remove(data.map(o => `${folder}/${o.name}`));
  } catch { /* offline: retried the next time the screen opens with the page off */ }
}

/**
 * Write the page's on/off flag (public_profiles) through the offline queue.
 * The id is derived (publicProfileIdFor) and re-derived by the server, so every
 * device writes the same row.
 */
export async function writePublicProfileFlag(
  ownerId: string,
  projectId: string,
  enabled: boolean,
): Promise<WriteOutcome> {
  const now = new Date().toISOString();
  return supabaseWriteDetailed('public_profiles', 'upsert', {
    id: publicProfileIdFor(ownerId, projectId),
    project_id: projectId,
    enabled,
    // The server trigger owns these (it keeps the first take-down time). Sent
    // so the payload is complete when read back.
    revoked_at: enabled ? null : now,
    updated_at: now,
  });
}

/**
 * The flag as the server has it. 'missing' (no row: a page published before
 * this update, or never) is told apart from 'unknown' (offline, error), because
 * the screen may create a missing row on its own but must not turn a page back
 * on when it couldn't read what another phone did to it.
 */
export type ServerFlagState = 'on' | 'off' | 'missing' | 'unknown';

export async function readPublicProfileFlag(ownerId: string, projectId: string): Promise<ServerFlagState> {
  if (!isSupabaseConfigured) return 'unknown';
  try {
    const { data, error } = await supabase
      .from('public_profiles')
      .select('enabled')
      .eq('id', publicProfileIdFor(ownerId, projectId))
      .maybeSingle();
    if (error) return 'unknown';
    if (!data) return 'missing';
    return (data as { enabled?: boolean }).enabled === true ? 'on' : 'off';
  } catch {
    return 'unknown';
  }
}

/**
 * What a stranger opening the link will be told: true (the page renders),
 * false (it reads "taken down"), or null when the check itself failed. This is
 * the same anon RPC the page calls, so a job whose projects row hasn't reached
 * the server yet, or one he doesn't own, reads false here exactly as it would
 * for the prospect.
 */
export async function readPublicProfileStatus(pid: string): Promise<boolean | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.rpc('public_profile_status', { p_id: pid });
    if (error) return null;
    return (data as { enabled?: boolean } | null)?.enabled === true;
  } catch {
    return null;
  }
}
