// projectFiles — list / upload / delete helpers for the project's
// file folders (the PRIVATE `project-documents` Supabase Storage bucket —
// files here are visible to people on this project, not to anyone with a
// link; see AUTH below).
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

/** A folder read: the files, or `failed` when the read itself did not answer. */
export interface ProjectFileListing {
  files: ProjectFile[];
  /** True when Storage errored or the request never answered (offline, 5xx,
   *  permission). A MISSING folder is not a failure — Storage answers an
   *  unknown prefix with an empty list — so `failed: false, files: []` really
   *  is an empty folder, and only then may the UI say so (#159). */
  failed: boolean;
}

/**
 * Metadata-only listing: everything a ProjectFile has except a usable URL.
 * Split out so countProjectFilesByFolder can count 7 folders without firing 7
 * pointless signing round-trips for URLs nobody is going to render.
 *
 * It used to map every error to `[]`, so in airplane mode on site every
 * folder read "0 files" and "No files in this folder yet" — as if the job's
 * documents had never been uploaded (#159). A failed read now says it failed.
 */
async function listProjectFileEntries(projectId: string, folderKey: string): Promise<ProjectFileListing> {
  if (!projectId || !folderKey) return { files: [], failed: false };
  const folder = `${projectId}/${folderKey}`;
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(folder, {
        limit: 200,
        sortBy: { column: 'created_at', order: 'desc' },
      });
    if (error || !data) return { files: [], failed: true };
    const files = data
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
    return { files, failed: false };
  } catch {
    return { files: [], failed: true };
  }
}

/**
 * List a project folder and say whether the read worked. Files are returned
 * newest-first, each with a freshly SIGNED url (see the AUTH note at the top
 * of this file) — a file we cannot sign keeps publicUrl '' rather than being
 * dropped, because vanishing from the listing reads as data loss while a row
 * you can still see, size and delete does not.
 */
export async function listProjectFilesChecked(projectId: string, folderKey: string): Promise<ProjectFileListing> {
  const listing = await listProjectFileEntries(projectId, folderKey);
  if (listing.failed || listing.files.length === 0) return listing;
  const signed = await resolveProjectFileUrls(listing.files.map(e => e.path));
  return { files: listing.files.map(e => ({ ...e, publicUrl: signed.get(e.path) ?? '' })), failed: false };
}

/**
 * Array form of listProjectFilesChecked for callers that only render rows.
 * A failed read is `[]` here — anything that SAYS "empty" must use the
 * checked form, which can tell an empty folder from a read that never answered.
 */
export async function listProjectFiles(projectId: string, folderKey: string): Promise<ProjectFile[]> {
  return (await listProjectFilesChecked(projectId, folderKey)).files;
}

/**
 * Count files across ALL the default folders for a project in a single
 * call. Used by the folder tile grid so each tile shows "12 files"
 * without N round trips.
 *
 * Returns Record<folderKey, number | null>: null means THAT folder's read
 * failed (the tile shows "—", not "0 files"); the other folders keep their
 * counts. A missing folder is a real 0.
 */
export async function countProjectFilesByFolder(projectId: string): Promise<Record<string, number | null>> {
  if (!projectId) return {};
  const out: Record<string, number | null> = {};
  await Promise.all(
    DEFAULT_FOLDERS.map(async f => {
      const listing = await listProjectFileEntries(projectId, f.key);
      out[f.key] = listing.failed ? null : listing.files.length;
    }),
  );
  return out;
}

export interface UploadFileArgs {
  projectId: string;
  folderKey: string;
  /** Filename to use in storage. Sanitized (alphanumerics + ._-). */
  fileName: string;
  /**
   * The file's BYTES — read with utils/fileBytes.readFileBytes(uri) (or
   * base64ToBytes for a capture that already has base64). This used to be a
   * `Blob`, and both callers built it with `fetch(uri).blob()`: on React
   * Native that Blob carries no data supabase-js can serialize, so every file
   * uploaded from an iPhone landed in Storage at ZERO BYTES while the app said
   * "Filed" and Scan Anything cleared the only copy of the capture (#5). A
   * Uint8Array cannot be built that way, so the compiler now refuses the bug.
   */
  bytes: Uint8Array;
  contentType?: string;
}

/** Storage-safe name segment: alphanumerics + ._-, at most 80 characters. */
function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

/**
 * What Storage holds at `path`, read back through list(): 'ok' with its size,
 * 'empty' for a 0-byte object, 'missing' when the listing answered without it,
 * 'unknown' when the listing itself failed.
 */
export async function statProjectFile(path: string): Promise<{ state: 'ok'; size: number } | { state: 'empty' | 'missing' | 'unknown' }> {
  const cut = path.lastIndexOf('/');
  if (cut <= 0) return { state: 'unknown' };
  const dir = path.slice(0, cut);
  const name = path.slice(cut + 1);
  try {
    const { data, error } = await supabase.storage.from(BUCKET).list(dir, { limit: 100, search: name });
    if (error || !data) return { state: 'unknown' };
    const hit = data.find(o => o.name === name);
    if (!hit) return { state: 'missing' };
    const size = Number(hit.metadata?.size ?? 0);
    return size > 0 ? { state: 'ok', size } : { state: 'empty' };
  } catch {
    return { state: 'unknown' };
  }
}

/**
 * The upload reached the server as a 0-byte object (or an earlier attempt's
 * 0-byte object already holds the name). `removed` says whether the empty
 * copy is gone — when it is not, the SAME name can never be filed again, so
 * a retry must use a new one (app/scan.tsx rolls the page's attempt suffix).
 */
export class ProjectFileEmptyError extends Error {
  readonly removed: boolean;
  constructor(message: string, removed: boolean) {
    super(message);
    this.name = 'ProjectFileEmptyError';
    this.removed = removed;
  }
}

/**
 * Upload a file to a project folder. Returns the saved ProjectFile
 * record on success; throws with a user-readable message on failure
 * so the caller can surface it in a toast.
 *
 * Success means the object is on the server WITH BYTES: after the upload the
 * object is read back and a 0-byte result is removed and thrown, so a caller
 * (Scan Anything) keeps the capture on screen instead of discarding the only
 * copy of it. A read-back that can't answer (offline blip) does not fail an
 * upload Storage already accepted — the bytes were checked non-empty first.
 */
/** The per-file upload ceiling, and its refusal. Exported so a picker can
 *  refuse an oversized file from its reported size BEFORE reading it into
 *  memory (a base64 read + decode costs several times the file's size). */
export const PROJECT_FILE_MAX_BYTES = 100 * 1024 * 1024;
export const PROJECT_FILE_TOO_LARGE = 'Files must be under 100 MB. Try splitting larger uploads.';

export async function uploadProjectFile(args: UploadFileArgs): Promise<ProjectFile> {
  const { projectId, folderKey, fileName, bytes, contentType } = args;
  const session = await supabase.auth.getSession();
  if (!session.data.session) {
    throw new Error('Sign in to upload files.');
  }
  const size = bytes?.byteLength ?? 0;
  if (size === 0) throw new Error('That file is empty.');
  if (size > PROJECT_FILE_MAX_BYTES) {
    throw new Error(PROJECT_FILE_TOO_LARGE);
  }

  const path = `${safeSegment(projectId)}/${safeSegment(folderKey)}/${safeSegment(fileName)}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: contentType ?? 'application/octet-stream',
      upsert: false,  // explicit overwrite would be a separate "replace" action
    });
  if (error) {
    // A retry of an upload whose response was lost (Scan Anything re-targets
    // the SAME stamped name) collides with its own earlier copy. When the
    // object already there is ours — same name, same byte count — it landed;
    // anything else is a real collision the user has to resolve.
    const collided = /exist|duplicate/i.test(error.message ?? '');
    const prior = collided ? await statProjectFile(path) : null;
    if (prior && prior.state === 'empty') {
      // An earlier attempt left a 0-byte object under this exact name that
      // could not be removed (a field seat may upload but not delete —
      // project_docs_delete needs 'editor'). Retrying the same name would
      // collide forever, so say so; Scan Anything re-targets a new name.
      throw new ProjectFileEmptyError(
        `An empty (0-byte) copy of ${safeSegment(fileName)} is already in this folder — ask the job owner or an editor to delete it, or upload under another name.`,
        false,
      );
    }
    if (!(prior && prior.state === 'ok' && prior.size === size)) {
      throw new Error(`Upload failed: ${error.message}`);
    }
  } else {
    const stat = await statProjectFile(path);
    if (stat.state === 'empty') {
      // Best effort: a field seat can upload but not delete (the policy needs
      // 'editor'), and Storage then removes NOTHING without an error — so the
      // result is checked, and the caller is told whether the empty copy is
      // still there. A retry of the SAME name would then collide with it.
      let removed = false;
      try {
        const { data } = await supabase.storage.from(BUCKET).remove([path]);
        removed = Array.isArray(data) && data.length > 0;
      } catch {/* reported as not removed below */}
      throw new ProjectFileEmptyError(
        removed
          ? 'The file reached the server empty (0 bytes), so nothing was filed.'
          : 'The file reached the server empty (0 bytes), so nothing was filed. The empty copy could not be removed — ask the job owner or an editor to delete it.',
        removed,
      );
    }
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
    name: safeSegment(fileName),
    path,
    publicUrl: signedUrl || path,
    size,
    uploadedAt: new Date().toISOString(),
    mimeType: contentType,
  };
}

/** Why a delete matched nothing. Storage RLS (project_docs_delete needs the
 *  'editor' role) refuses a field or viewer seat by removing NOTHING and
 *  returning no error — the file used to reappear with no message (#160). */
export const PROJECT_FILE_DELETE_REFUSED = 'Not removed — only the job owner or an editor can delete project files.';

/** remove() matched nothing and the follow-up read couldn't answer either. */
export const PROJECT_FILE_DELETE_UNCONFIRMED = "Couldn't confirm the delete — refresh to check. Only the job owner or an editor can delete project files.";

/**
 * Delete a file from the bucket. Throws on failure — including the silent
 * one, where remove() answers an empty list because RLS matched no row.
 * An empty answer is ALSO what an already-deleted file gives (another device
 * removed it first), so the path is read back before the role is blamed:
 * gone → the delete's goal is met; still there → refused; no answer → say so.
 */
export async function deleteProjectFile(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(`Delete failed: ${error.message}`);
  if (Array.isArray(data) && data.length > 0) return;
  const after = await statProjectFile(path);
  if (after.state === 'missing') return;
  if (after.state === 'unknown') throw new Error(PROJECT_FILE_DELETE_UNCONFIRMED);
  throw new Error(PROJECT_FILE_DELETE_REFUSED);
}

/** Format bytes like macOS Finder — "12.3 MB" / "847 KB" / "256 B". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
