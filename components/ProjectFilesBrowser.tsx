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
// The bucket is project-documents (public-read, auth-only-write — see
// supabase/migrations/add_project_documents_bucket.sql). Same bucket
// the Daily Report's "save to project files" toggle uploads to.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {
  ChevronLeft, FolderOpen, Upload, Layers, FileSignature, Camera,
  Shield, BookOpen, ClipboardList, FileText, Trash2, ExternalLink,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  DEFAULT_FOLDERS,
  listProjectFiles,
  countProjectFilesByFolder,
  uploadProjectFile,
  deleteProjectFile,
  formatBytes,
  type ProjectFile,
} from '@/utils/projectFiles';
import { openSavedDocument } from '@/utils/projectDocuments';

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
};

export function ProjectFilesBrowser({ projectId, projectName }: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Reload folder counts on mount + whenever the active folder closes
  // (so the count reflects the latest upload/delete).
  const refreshCounts = useCallback(async () => {
    if (!projectId) return;
    setLoadingCounts(true);
    try {
      const c = await countProjectFilesByFolder(projectId);
      setCounts(c);
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
      const list = await listProjectFiles(projectId, activeFolder);
      setFiles(list);
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

      setUploading(true);
      const r = await fetch(asset.uri);
      const blob = await r.blob();
      await uploadProjectFile({
        projectId,
        folderKey: activeFolder,
        fileName: asset.name,
        blob,
        contentType: asset.mimeType ?? 'application/octet-stream',
      });
      await refreshFiles();
      await refreshCounts();
    } catch (err) {
      Alert.alert('Upload failed', err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }, [projectId, activeFolder, refreshFiles, refreshCounts]);

  const handleDelete = useCallback((file: ProjectFile) => {
    Alert.alert(
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
              Alert.alert('Delete failed', err instanceof Error ? err.message : String(err));
            }
          },
        },
      ],
    );
  }, [refreshFiles, refreshCounts]);

  // ─── File-list view ─────────────────────────────────────────────
  if (activeFolder) {
    const folder = DEFAULT_FOLDERS.find(f => f.key === activeFolder);
    return (
      <View style={styles.container}>
        <View style={styles.fileListHeader}>
          <TouchableOpacity onPress={() => setActiveFolder(null)} style={styles.backBtn}>
            <ChevronLeft size={18} color={themeColors.text} />
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
              : <Upload size={14} color={themeColors.surface} />}
            <Text style={styles.uploadBtnText}>{uploading ? 'Uploading…' : 'Upload'}</Text>
          </TouchableOpacity>
        </View>

        {loadingFiles ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={themeColors.accent} />
            <Text style={styles.muted}>Loading files…</Text>
          </View>
        ) : files.length === 0 ? (
          <View style={styles.emptyFolder}>
            <FolderOpen size={28} color={themeColors.textMuted} />
            <Text style={styles.emptyFolderTitle}>No files in this folder yet</Text>
            <Text style={styles.emptyFolderBody}>
              Upload contracts, signed PDFs, photos, or anything else you want stored
              alongside this project. Files live at a stable URL you can share with the
              homeowner or subs.
            </Text>
            <TouchableOpacity
              style={[styles.uploadBtn, { marginTop: 16, paddingHorizontal: 18, paddingVertical: 12 }]}
              onPress={handleUpload}
              disabled={uploading}
              activeOpacity={0.85}
            >
              {uploading
                ? <ActivityIndicator size="small" color={themeColors.surface} />
                : <Upload size={14} color={themeColors.surface} />}
              <Text style={styles.uploadBtnText}>{uploading ? 'Uploading…' : 'Upload first file'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.fileList}>
            {files.map(f => (
              <View key={f.path} style={styles.fileRow}>
                <View style={styles.fileIconWrap}>
                  <FileText size={16} color={themeColors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fileName} numberOfLines={2}>{f.name}</Text>
                  <Text style={styles.fileMeta}>
                    {formatBytes(f.size)} · {new Date(f.uploadedAt).toLocaleDateString()}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => void openSavedDocument(f.publicUrl)}
                  style={styles.fileAction}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Open"
                >
                  <ExternalLink size={15} color={themeColors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(f)}
                  style={styles.fileAction}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Delete"
                >
                  <Trash2 size={15} color={Colors.errorDark} />
                </TouchableOpacity>
              </View>
            ))}
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
        Shared drive for this project. Auto-saved daily reports land here, plus
        anything you upload — contracts, signed PDFs, inspection photos, permits.
      </Text>
      {loadingCounts && Object.keys(counts).length === 0 ? (
        <ActivityIndicator color={themeColors.accent} style={{ marginVertical: 32 }} />
      ) : (
        <View style={styles.grid}>
          {DEFAULT_FOLDERS.map(f => {
            const Icon = FOLDER_ICONS[f.key] ?? FolderOpen;
            const count = counts[f.key] ?? 0;
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
                  {count} {count === 1 ? 'file' : 'files'}
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
    backgroundColor: t.accent,
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
});
