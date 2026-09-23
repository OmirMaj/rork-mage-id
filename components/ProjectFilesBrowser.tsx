// ProjectFilesBrowser — folder tree + file list for a project's
// shared-drive bucket (project-documents). Replaces the audit-flagged
// "passive aggregator" Documents screen with a real file browser:
//
//   • Default folders (Plans / Contracts / Photos / Permits / Closeout
//     / Daily Reports) shown as tiles with live file counts.
//   • Tap a folder → reveals the file list inline (no route change so
//     the back-button-to-overview behavior is dead simple).
//   • Each file: name, size, uploaded date, View action (opens in
//     platform viewer), Delete action.
//   • "Upload" from any folder — opens the platform document picker,
//     uploads via Supabase Storage, refreshes the list.
//
// The bucket is project-documents: PRIVATE. Files here are visible to
// people on this project (storage RLS), opened through short-lived signed
// links minted on each read — not a public or "stable" URL anyone can open
// (the old header said "public-read", which was never true; see
// utils/projectFiles.ts). Same bucket the Daily Report's "save to project
// files" toggle uploads to.
//
// Honesty rules this screen keeps (wave 5, #159/#160):
//   • a folder read that FAILED says so (banner + Retry, "—" on the tile);
//     "No files in this folder yet" only after a read that answered empty;
//   • Delete below the editor role is disabled with the reason, and a delete
//     the server refused says "Not removed" instead of silently reappearing;
//   • Open re-signs the link on tap and says so when it still can't.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {
  ChevronLeft, FolderOpen, Upload, Layers, FileSignature, Camera,
  Shield, BookOpen, ClipboardList, FileText, Trash2, ExternalLink, Receipt,
  WifiOff, RefreshCw,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  DEFAULT_FOLDERS,
  listProjectFilesChecked,
  countProjectFilesByFolder,
  uploadProjectFile,
  deleteProjectFile,
  resolveProjectFileUrl,
  formatBytes,
  PROJECT_FILE_MAX_BYTES,
  PROJECT_FILE_TOO_LARGE,
  type ProjectFile,
} from '@/utils/projectFiles';
import { readFileBytes } from '@/utils/fileBytes';
import { openSavedDocument } from '@/utils/projectDocuments';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { showAlert } from '@/utils/alert';

/** The read-failure sentence, shared by the grid banner and the folder view. */
const LOAD_FAILED = "Couldn't load files — no signal or the server didn't answer.";
/** Why Delete is disabled below the editor role (storage RLS
 *  project_docs_delete requires 'editor'; the owner always passes). */
const DELETE_NEEDS_EDITOR = 'Only the job owner or an editor can delete project files.';

interface Props {
  projectId: string;
  /** Optional caption shown above the folder grid (e.g. project name). */
  projectName?: string;
}

const FOLDER_ICONS: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  plans: Layers,
  contracts: FileSignature,
  photos: Camera,
  permits: Shield,
  closeout: BookOpen,
  'daily-reports': ClipboardList,
  financials: Receipt,
};

export function ProjectFilesBrowser({ projectId, projectName }: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploading, setUploading] = useState(false);
  // True when the last grid / folder read did not answer. Drives the banner,
  // the "—" tiles and the folder view's failure state (#159).
  const [countsFailed, setCountsFailed] = useState(false);
  const [filesFailed, setFilesFailed] = useState(false);
  // Delete needs the editor role. A field or viewer seat's delete used to be
  // matched by no RLS row and "succeed" silently (#160). While the role is
  // still resolving, or the collaborator read failed, Delete stays available
  // — the server is the authority and deleteProjectFile now reports a
  // refusal. Only a KNOWN field / viewer seat is refused up front.
  const { role, isLoading: roleLoading, isError: roleError } = useProjectRoleState(projectId);
  const canDelete = roleLoading || roleError || (role !== 'viewer' && role !== 'field');

  // Reload folder counts on mount + whenever the active folder closes
  // (so the count reflects the latest upload/delete).
  const refreshCounts = useCallback(async () => {
    if (!projectId) return;
    setLoadingCounts(true);
    try {
      const c = await countProjectFilesByFolder(projectId);
      setCounts(c);
      setCountsFailed(DEFAULT_FOLDERS.some(f => c[f.key] === null));
    } finally {
      setLoadingCounts(false);
    }
  }, [projectId]);

  useEffect(() => { void refreshCounts(); }, [refreshCounts]);

  // Reload file list when the user opens a folder.
  const refreshFiles = useCallback(async () => {
    if (!projectId || !activeFolder) return;
    setLoadingFiles(true);
    try {
      const listing = await listProjectFilesChecked(projectId, activeFolder);
      setFiles(listing.files);
      setFilesFailed(listing.failed);
    } finally {
      setLoadingFiles(false);
    }
  }, [projectId, activeFolder]);

  useEffect(() => {
    if (activeFolder) void refreshFiles();
    else setFiles([]);
  }, [activeFolder, refreshFiles]);

  const handleUpload = useCallback(async () => {
    if (!projectId || !activeFolder) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      // Refuse an oversized file from the picker's reported size, BEFORE
      // readFileBytes pulls the whole thing into JS memory as base64 (several
      // times its size — a large plan set could take an older iPhone down,
      // only to be refused by uploadProjectFile's same check afterwards).
      if (typeof asset.size === 'number' && asset.size > PROJECT_FILE_MAX_BYTES) {
        showAlert('File too large', PROJECT_FILE_TOO_LARGE);
        return;
      }

      setUploading(true);
      // readFileBytes, never fetch(uri).blob(): on React Native that Blob
      // uploads as a 0-byte object while the upload "succeeds" (#5). On web
      // the picker's blob: URI goes through readFileBytes' fetch/arrayBuffer.
      const bytes = await readFileBytes(asset.uri);
      await uploadProjectFile({
        projectId,
        folderKey: activeFolder,
        fileName: asset.name,
        bytes,
        contentType: asset.mimeType ?? 'application/octet-stream',
      });
      await refreshFiles();
      await refreshCounts();
    } catch (err) {
      showAlert('Upload failed', err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }, [projectId, activeFolder, refreshFiles, refreshCounts]);

  // Open re-signs on tap: the listing's signed URL is '' when signing failed
  // (offline), and it expires. openSavedDocument throws with the reason when
  // there is still no link, instead of opening nothing.
  const handleOpen = useCallback(async (file: ProjectFile) => {
    try {
      const fresh = await resolveProjectFileUrl(file.path);
      await openSavedDocument(/^https?:\/\//i.test(fresh) ? fresh : file.publicUrl);
    } catch (err) {
      showAlert("Couldn't open file", err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleDelete = useCallback((file: ProjectFile) => {
    if (!canDelete) {
      showAlert('Can\'t delete', DELETE_NEEDS_EDITOR);
      return;
    }
    showAlert(
      'Delete file?',
      `Permanently delete "${file.name}"? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProjectFile(file.path);
              await refreshFiles();
              await refreshCounts();
            } catch (err) {
              showAlert('Delete failed', err instanceof Error ? err.message : String(err));
            }
          },
        },
      ],
    );
  }, [refreshFiles, refreshCounts, canDelete]);

  // ─── File-list view ─────────────────────────────────────────────
  if (activeFolder) {
    const folder = DEFAULT_FOLDERS.find(f => f.key === activeFolder);
    return (
      <View style={styles.container}>
        <View style={styles.fileListHeader}>
          <TouchableOpacity onPress={() => setActiveFolder(null)} style={styles.backBtn}>
            <ChevronLeft size={18} color={themeColors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.folderEyebrow}>FOLDER</Text>
            <Text style={styles.folderTitle}>{folder?.label ?? activeFolder}</Text>
          </View>
          <TouchableOpacity
            style={styles.uploadBtn}
            onPress={handleUpload}
            disabled={uploading}
            activeOpacity={0.85}
          >
            {uploading
              ? <ActivityIndicator size="small" color={themeColors.surface} />
              : <Upload size={14} color={themeColors.surface} strokeWidth={1.75} />}
            <Text style={styles.uploadBtnText}>{uploading ? 'Uploading…' : 'Upload'}</Text>
          </TouchableOpacity>
        </View>

        {loadingFiles ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={themeColors.accent} />
            <Text style={styles.muted}>Loading files…</Text>
          </View>
        ) : filesFailed ? (
          <View style={styles.emptyFolder} testID="project-files-folder-failed">
            <WifiOff size={28} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyFolderTitle}>Couldn&apos;t load this folder</Text>
            <Text style={styles.emptyFolderBody}>{LOAD_FAILED} Files already uploaded are still on the server.</Text>
            <TouchableOpacity
              style={[styles.uploadBtn, { marginTop: 16, paddingHorizontal: 18, paddingVertical: 12 }]}
              onPress={() => void refreshFiles()}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <RefreshCw size={14} color={themeColors.surface} strokeWidth={1.75} />
              <Text style={styles.uploadBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : files.length === 0 ? (
          <View style={styles.emptyFolder}>
            <FolderOpen size={28} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyFolderTitle}>No files in this folder yet</Text>
            <Text style={styles.emptyFolderBody}>
              Upload contracts, signed PDFs, photos, or anything else you want stored
              alongside this project. Files here are private to people on this project —
              to get one to the homeowner or a sub, open it and send it to them.
            </Text>
            <TouchableOpacity
              style={[styles.uploadBtn, { marginTop: 16, paddingHorizontal: 18, paddingVertical: 12 }]}
              onPress={handleUpload}
              disabled={uploading}
              activeOpacity={0.85}
            >
              {uploading
                ? <ActivityIndicator size="small" color={themeColors.surface} />
                : <Upload size={14} color={themeColors.surface} strokeWidth={1.75} />}
              <Text style={styles.uploadBtnText}>{uploading ? 'Uploading…' : 'Upload first file'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.fileList}>
            {files.map(f => (
              <View key={f.path} style={styles.fileRow}>
                <View style={styles.fileIconWrap}>
                  <FileText size={16} color={themeColors.accent} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fileName} numberOfLines={2}>{f.name}</Text>
                  <Text style={styles.fileMeta}>
                    {formatBytes(f.size)} · {new Date(f.uploadedAt).toLocaleDateString()}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => void handleOpen(f)}
                  style={styles.fileAction}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Open"
                >
                  <ExternalLink size={15} color={themeColors.textSecondary} strokeWidth={1.75} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(f)}
                  style={[styles.fileAction, !canDelete && { opacity: 0.35 }]}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={canDelete ? 'Delete' : `Delete unavailable. ${DELETE_NEEDS_EDITOR}`}
                  accessibilityState={{ disabled: !canDelete }}
                >
                  <Trash2 size={15} color={Colors.errorDark} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
            ))}
            {!canDelete && (
              <Text style={styles.roleNote}>{DELETE_NEEDS_EDITOR}</Text>
            )}
          </ScrollView>
        )}
      </View>
    );
  }

  // ─── Folder grid ───────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {projectName && (
        <Text style={styles.projectName}>{projectName}</Text>
      )}
      <Text style={styles.gridTitle}>Project Files</Text>
      <Text style={styles.gridSub}>
        Files for this project, private to the people on it. Auto-saved daily
        reports land here, plus anything you upload — contracts, signed PDFs,
        inspection photos, permits.
      </Text>
      {countsFailed && !loadingCounts && (
        <View style={styles.failBanner} testID="project-files-load-failed">
          <WifiOff size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
          <Text style={styles.failBannerText}>{LOAD_FAILED}</Text>
          <TouchableOpacity onPress={() => void refreshCounts()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry loading files">
            <Text style={styles.failBannerRetry}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {loadingCounts && Object.keys(counts).length === 0 ? (
        <ActivityIndicator color={themeColors.accent} style={{ marginVertical: 32 }} />
      ) : (
        <View style={styles.grid}>
          {DEFAULT_FOLDERS.map(f => {
            const Icon = FOLDER_ICONS[f.key] ?? FolderOpen;
            // null = this folder's read failed: "—", never a false "0 files".
            const count = counts[f.key];
            return (
              <TouchableOpacity
                key={f.key}
                style={styles.folderTile}
                onPress={() => setActiveFolder(f.key)}
                activeOpacity={0.85}
              >
                <View style={styles.folderIconWrap}>
                  <Icon size={20} color={themeColors.accent} />
                </View>
                <Text style={styles.folderLabel}>{f.label}</Text>
                <Text style={styles.folderCount}>
                  {count == null ? '—' : `${count} ${count === 1 ? 'file' : 'files'}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  projectName: {
    fontSize: 11, fontWeight: '800' as const, color: t.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase' as const,
  },
  gridTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.3 },
  gridSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginBottom: 8 },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  folderTile: {
    width: '48%' as const,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 0.5, borderColor: t.line,
    gap: 6,
  },
  folderIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: t.accent + '14',
    marginBottom: 4,
  },
  folderLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  folderCount: { fontSize: Type.caption2.fontSize, color: t.textSecondary },

  fileListHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, marginBottom: 8 },
  backBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: t.surfaceAlt,
  },
  folderEyebrow: {
    fontSize: 10, fontWeight: '800' as const, color: t.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase' as const,
  },
  folderTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.3 },
  uploadBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accentFill,
  },
  uploadBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.surface },

  loadingWrap: { padding: 32, alignItems: 'center' as const, gap: 12 },
  muted: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted },

  emptyFolder: { padding: 32, alignItems: 'center' as const, gap: 8 },
  emptyFolderTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text, marginTop: 8 },
  emptyFolderBody: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center' as const, lineHeight: 20 },

  fileList: { gap: 6, paddingBottom: 24 },
  fileRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.md,
    borderWidth: 0.5, borderColor: t.line,
  },
  fileIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: t.accent + '14',
  },
  fileName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text },
  fileMeta: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2 },
  fileAction: { padding: 6 },
  roleNote: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 6 },

  failBanner: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, marginBottom: 4,
  },
  failBannerText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary },
  failBannerRetry: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accent },
});
