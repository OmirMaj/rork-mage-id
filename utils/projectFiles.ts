// projectFiles — list / upload / delete helpers for the project's
// shared-drive folder tree (the `project-documents` Supabase Storage
// bucket).
//
// Layout in the bucket:
//
//   project-documents/
//     <projectId>/
//       plans/<filename>
//       contracts/<filename>
//       photos/<filename>
//       permits/<filename>
//       closeout/<filename>
//       <custom-folder>/<filename>
//       daily-reports/<reportId>.pdf       ← auto-saved by daily-report.tsx
//       … other auto-saved doc types
//
// The default folders are baked into the client (DEFAULT_FOLDERS below)
// so a new project shows the right 5 buckets even before any file lands.
// Custom folders just exist by virtue of having a file in them — no
// "create folder" step. The folder list comes from Storage.list() so a
// folder created on the iPhone is visible on the desktop instantly.
//
// V1.1 scope: just the file browser. Per-folder permissions (share with
// homeowner / subs / owner) live in v1.2.
//
// AUTH — read this before touching any URL in here. The comment that used to
// sit at this spot claimed the bucket was "authenticated-write + public-read
// ... same pattern as plan-sheets". That is the exact opposite of production:
// `project-documents` is PRIVATE (storage.buckets.public = false) and its read
// policy is `project_docs_select: bucket_id = 'project-documents' AND owner =
// auth.uid()`. Only plan-sheets / profiles / rfp-attachments are public.
//
// Because of that wrong comment this module handed out getPublicUrl() links.
// The upload succeeded, the user got a success toast, and then every single
// filed document was dead on arrival: /storage/v1/object/public/
// project-documents/... answers 400 {"error":"Bucket not found"} for a private
// bucket, so the COI Vault tile rendered blank forever and tapping a file in
// the browser opened a JSON error blob. The bytes were in the bucket; nothing
// in the app could show them.
//
// The fix is the pattern utils/storage.ts (photos) and utils/contractSealing.ts
// (sealed PDFs) already use: persist the storage PATH, mint a short-lived
// SIGNED url at read time. Flipping the bucket public is NOT an option — these
// are a contractor's COIs, contracts and permits, and the RLS above is
// deliberately owner-scoped.

import { supabase } from '@/lib/supabase';

const BUCKET = 'project-documents';

/**
 * How long a minted project-file URL stays valid.
 *
 * 7 days, matching the `documents` bucket helper in utils/storage.ts:118. It is
 * longer than the 24h photo TTL because these URLs are also handed to the OS
 * share sheet / a browser tab, which can outlive the app session, and shorter
 * than "forever" because the bucket is owner-private and a leaked link is a
 * leaked COI.
 *
 * NOTE the expiry is the reason `ProjectFile.publicUrl` must never be written
 * to a durable store. Persist `ProjectFile.path` and re-mint through
 * resolveProjectFileUrl() on read. utils/storage.ts:11-14 documents what the
 * other outcome looks like: a 7-day URL baked into a DB row, and every photo
 * silently 400ing a week later.
 */
export const PROJECT_FILE_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

// The three shapes a Supabase Storage object URL can take. We only ever minted
// the first one, so recovering a path from already-stored rows means stripping
// `/storage/v1/object/public/project-documents/`; the other two are here so a
// signed URL that got persisted by mistake is equally recoverable.
const OBJECT_URL_MARKERS = [
  `/storage/v1/object/public/${BUCKET}/`,
  `/storage/v1/object/sign/${BUCKET}/`,
  `/storage/v1/object/${BUCKET}/`,
] as const;

// A URI that only means something on the device that produced it. Never a
// storage path, never signable — see utils/photoUploadCore.isDeviceLocalUri.
const DEVICE_LOCAL_SCHEME = /^(file|blob|data|content|ph|assets-library):/i;

/**
 * Recover the bucket-relative storage path from whatever a caller has on hand:
 * a path (returned unchanged), a legacy dead `.../object/public/...` URL, or a
 * signed URL whose token has expired.
 *
 * Returns '' when the input is not a `project-documents` reference at all — a
 * device-local file:// capture, an empty string, or a URL on some other bucket
 * or host. Callers treat '' as "leave this URI alone", which is what keeps the
 * resolvers below from mangling a local preview or a plan-sheets link.
 */
export function projectFileStoragePath(uriOrPath: string | null | undefined): string {
  if (!uriOrPath) return '';
  const raw = String(uriOrPath).trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) {
    if (DEVICE_LOCAL_SCHEME.test(raw)) return '';
    // Bucket-relative already. Leading slashes are not part of a storage key.
    return raw.replace(/^\/+/, '');
  }
  for (const marker of OBJECT_URL_MARKERS) {
    const at = raw.indexOf(marker);
    if (at < 0) continue;
    const tail = raw.slice(at + marker.length);
    const q = tail.indexOf('?');
    const key = q >= 0 ? tail.slice(0, q) : tail;
    try {
      return decodeURIComponent(key);
    } catch {
      return key; // malformed %-escape: the raw key still beats nothing
    }
  }
  return '';
}

/**
 * Mint fresh signed URLs for a batch of stored paths / legacy URLs.
 *
 * Keyed by the ORIGINAL input string so a caller holding a mix of paths and
 * dead public URLs can look each one up by exactly what it has stored. Never
 * throws — an entry that cannot be signed (offline, or an object owned by
 * someone else) is simply absent, and the caller falls back to whatever it had.
 */
export async function resolveProjectFileUrls(uris: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  // input -> storage path, dropping anything that is not a bucket reference.
  const byPath = new Map<string, string[]>();
  for (const uri of uris) {
    const path = projectFileStoragePath(uri);
    if (!path) continue;
    const existing = byPath.get(path);
    if (existing) existing.push(uri);
    else byPath.set(path, [uri]);
  }
  const paths = [...byPath.keys()];
  if (paths.length === 0) return out;
  // createSignedUrls is batched but not unbounded — chunk it, same as
  // resolvePhotoUrls in utils/storage.ts.
  const CHUNK = 100;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(chunk, PROJECT_FILE_URL_TTL_SECONDS);
      if (error || !data) continue;
      for (const entry of data) {
        const path = (entry as { path?: string | null }).path;
        const signedUrl = (entry as { signedUrl?: string | null }).signedUrl;
        if (!path || !signedUrl) continue;
        for (const original of byPath.get(path) ?? []) out.set(original, signedUrl);
      }
    } catch {/* offline — caller keeps its existing URI */}
  }
  return out;
}

/**
 * Single-URI form of resolveProjectFileUrls. Returns the input unchanged when
 * it is not a `project-documents` reference or when signing fails, so it is
 * safe to wrap any image source / open-file call with it.
 */
export async function resolveProjectFileUrl(uriOrPath: string | null | undefined): Promise<string> {
  const raw = uriOrPath ? String(uriOrPath) : '';
  if (!raw) return '';
  const resolved = await resolveProjectFileUrls([raw]);
  return resolved.get(raw) ?? raw;
}

/** Default folder layout for every new project. The keys are
 *  storage-safe (lowercase, no spaces) and the labels are what the GC
 *  sees in the UI. */
export const DEFAULT_FOLDERS = [
  { key: 'plans', label: 'Plans', icon: 'Layers' },
  { key: 'contracts', label: 'Contracts', icon: 'FileSignature' },
  { key: 'photos', label: 'Photos', icon: 'Camera' },
  { key: 'permits', label: 'Permits', icon: 'Shield' },
  { key: 'closeout', label: 'Closeout', icon: 'BookOpen' },
  { key: 'daily-reports', label: 'Daily Reports', icon: 'ClipboardList' },
  { key: 'financials', label: 'Financials', icon: 'Receipt' },
] as const;

export type DefaultFolderKey = (typeof DEFAULT_FOLDERS)[number]['key'];

export interface ProjectFile {
  /** Filename WITHOUT the folder prefix (e.g. `kitchen-elevation.pdf`). */
  name: string;
  /** Full storage path used to fetch / delete (e.g. `<projectId>/plans/kitchen-elevation.pdf`).
   *  THIS is the durable value — it is what belongs in a DB row or AsyncStorage. */
  path: string;
  /** A freshly-minted SIGNED url, good for PROJECT_FILE_URL_TTL_SECONDS.
   *
   *  Historically named `publicUrl` because this code believed the bucket was
   *  public-read; the name is kept so callers keep compiling, but the value is
   *  no longer a public URL and must NOT be persisted — store `path` and call
   *  resolveProjectFileUrl() at render time. Empty string when the URL could
   *  not be signed (offline, or an object owned by another account); the row
   *  is still returned so the file remains visible and deletable. */
  publicUrl: string;
  /** Size in bytes. */
  size: number;
  /** ISO timestamp from Storage's `created_at`. */
  uploadedAt: string;
  /** MIME type from Storage metadata, when available. */
  mimeType?: string;
}

/**
 * Metadata-only listing: everything a ProjectFile has except a usable URL.
 * Split out so countProjectFilesByFolder can count 7 folders without firing 7
 * pointless signing round-trips for URLs nobody is going to render.
 */
async function listProjectFileEntries(projectId: string, folderKey: string): Promise<ProjectFile[]> {
  if (!projectId || !folderKey) return [];
  const folder = `${projectId}/${folderKey}`;
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(folder, {
        limit: 200,
        sortBy: { column: 'created_at', order: 'desc' },
      });
    if (error || !data) return [];
    return data
      // Storage.list() returns subfolder placeholders too — drop those.
      .filter(o => !o.name.endsWith('/') && o.name !== '.emptyFolderPlaceholder')
      .map(o => ({
        name: o.name,
        path: `${folder}/${o.name}`,
        publicUrl: '',
        size: o.metadata?.size ?? 0,
        uploadedAt: o.created_at ?? new Date().toISOString(),
        mimeType: o.metadata?.mimetype,
      } as ProjectFile));
  } catch {
    return [];
  }
}

/**
 * List all files inside a project folder. Files are returned newest-first.
 * Returns an empty array on errors (network, permission, missing folder)
 * rather than throwing so the UI doesn't have to guard every render.
 *
 * URLs are signed HERE, at read time, and never persisted — that is the whole
 * point of the pattern (see the AUTH note at the top of this file). A file we
 * cannot sign is still returned with publicUrl '' rather than dropped, because
 * vanishing from the folder listing reads as data loss, while a row you can
 * still see, size and delete does not.
 */
export async function listProjectFiles(projectId: string, folderKey: string): Promise<ProjectFile[]> {
  const entries = await listProjectFileEntries(projectId, folderKey);
  if (entries.length === 0) return entries;
  const signed = await resolveProjectFileUrls(entries.map(e => e.path));
  return entries.map(e => ({ ...e, publicUrl: signed.get(e.path) ?? '' }));
}

/**
 * Count files across ALL the default folders for a project in a single
 * call. Used by the folder tile grid so each tile shows "12 files"
 * without N round trips.
 *
 * Returns a Record<folderKey, number>. Missing folders return 0.
 */
export async function countProjectFilesByFolder(projectId: string): Promise<Record<string, number>> {
  if (!projectId) return {};
  const out: Record<string, number> = {};
  await Promise.all(
    DEFAULT_FOLDERS.map(async f => {
      const files = await listProjectFileEntries(projectId, f.key);
      out[f.key] = files.length;
    }),
  );
  return out;
}

export interface UploadFileArgs {
  projectId: string;
  folderKey: string;
  /** Filename to use in storage. Sanitized (alphanumerics + ._-). */
  fileName: string;
  /** Blob to upload. Caller is responsible for fetching it from the
   *  picker URI / native file. */
  blob: Blob;
  contentType?: string;
}

/**
 * Upload a file to a project folder. Returns the saved ProjectFile
 * record on success; throws with a user-readable message on failure
 * so the caller can surface it in a toast.
 */
export async function uploadProjectFile(args: UploadFileArgs): Promise<ProjectFile> {
  const { projectId, folderKey, fileName, blob, contentType } = args;
  const session = await supabase.auth.getSession();
  if (!session.data.session) {
    throw new Error('Sign in to upload files.');
  }
  if (blob.size === 0) throw new Error('That file is empty.');
  if (blob.size > 100 * 1024 * 1024) {
    throw new Error('Files must be under 100 MB. Try splitting larger uploads.');
  }

  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const path = `${safe(projectId)}/${safe(folderKey)}/${safe(fileName)}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: contentType ?? 'application/octet-stream',
      upsert: false,  // explicit overwrite would be a separate "replace" action
    });
  if (error) {
    // Common error: same-name collision. We could auto-rename here but
    // the user will know better whether they want to replace or rename;
    // surface the error and let the UI offer a suffix.
    throw new Error(`Upload failed: ${error.message}`);
  }

  // The bytes are in the bucket now, so a signing failure must NOT throw: the
  // caller's error copy says "Nothing was saved — tap Confirm & file to retry"
  // (app/scan.tsx), which would be a lie and would strand an orphan object.
  // Fall back to the path, which resolveProjectFileUrl() can turn into a live
  // URL on the next read.
  let signedUrl = '';
  try {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, PROJECT_FILE_URL_TTL_SECONDS);
    signedUrl = signed?.signedUrl ?? '';
  } catch {/* upload landed; the path below is still resolvable later */}
  return {
    name: safe(fileName),
    path,
    publicUrl: signedUrl || path,
    size: blob.size,
    uploadedAt: new Date().toISOString(),
    mimeType: contentType,
  };
}

/**
 * Delete a file from the bucket. Throws on failure.
 */
export async function deleteProjectFile(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(`Delete failed: ${error.message}`);
}

/** Format bytes like macOS Finder — "12.3 MB" / "847 KB" / "256 B". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
