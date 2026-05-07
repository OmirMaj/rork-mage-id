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
// homeowner / subs / owner) live in v1.2 — the bucket policy is
// authenticated-write + public-read for now (so URL-shared files are
// readable without a session, same pattern as plan-sheets).

import { supabase } from '@/lib/supabase';

const BUCKET = 'project-documents';

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
] as const;

export type DefaultFolderKey = (typeof DEFAULT_FOLDERS)[number]['key'];

export interface ProjectFile {
  /** Filename WITHOUT the folder prefix (e.g. `kitchen-elevation.pdf`). */
  name: string;
  /** Full storage path used to fetch / delete (e.g. `<projectId>/plans/kitchen-elevation.pdf`). */
  path: string;
  /** Public URL — bucket is public-read so this works without a signed URL. */
  publicUrl: string;
  /** Size in bytes. */
  size: number;
  /** ISO timestamp from Storage's `created_at`. */
  uploadedAt: string;
  /** MIME type from Storage metadata, when available. */
  mimeType?: string;
}

/**
 * List all files inside a project folder. Files are returned newest-first.
 * Returns an empty array on errors (network, permission, missing folder)
 * rather than throwing so the UI doesn't have to guard every render.
 */
export async function listProjectFiles(projectId: string, folderKey: string): Promise<ProjectFile[]> {
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
      .map(o => {
        const path = `${folder}/${o.name}`;
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        return {
          name: o.name,
          path,
          publicUrl: pub.publicUrl,
          size: o.metadata?.size ?? 0,
          uploadedAt: o.created_at ?? new Date().toISOString(),
          mimeType: o.metadata?.mimetype,
        } as ProjectFile;
      });
  } catch {
    return [];
  }
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
      const files = await listProjectFiles(projectId, f.key);
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

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return {
    name: safe(fileName),
    path,
    publicUrl: pub.publicUrl,
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
