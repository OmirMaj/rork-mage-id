// app/plans.tsx — Plans library for a project.
//
// MAGE treats drawings as IMAGES, not native PDFs. The reason is pragmatic:
// every cross-platform PDF renderer in RN has its own brittle native deps
// and weird edge cases on Android/web. An image pipeline (PDF → PNG via the
// `convert-pdf-to-images` Supabase edge function, pinch-zoom + markup here)
// works identically on iOS / Android / web, ships today, and lets us render
// 200-page hospital plan sets without melting phones.
//
// Two import paths:
//   • "Import PDF"   — picks a multi-page PDF, uploads it, converts each
//                       page to a plan sheet automatically (one tap = N sheets).
//   • "Import image" — picks a single PNG/JPG (existing flow). Useful for
//                       photos of paper drawings or markup screenshots.

import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, Image, Platform, TextInput, Modal, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
// expo-document-picker provides the native PDF picker. Pinned in package.json
// at ~14.0.7 (matches Expo SDK 54). Run `bun install` after pulling this for
// the first time so the native module is linked.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — types resolve after `bun install`
import * as DocumentPicker from 'expo-document-picker';
import {
  ChevronLeft, Plus, MapPin, Trash2, Image as ImageIcon,
  ChevronRight, AlertTriangle, FileImage, X, Check, FileText,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { uploadAndRenderPdf } from '@/utils/pdfRenderClient';
import type { PlanSheet } from '@/types';

export default function PlansScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const projectId = typeof params.projectId === 'string' ? params.projectId : undefined;
  const { canAccess } = useTierAccess();
  const {
    projects, getProject, getPlanSheetsForProject, addPlanSheet, deletePlanSheet,
    getPinsForPlan,
  } = useProjects();

  const [importing, setImporting] = useState<boolean>(false);
  const [pdfImporting, setPdfImporting] = useState<boolean>(false);
  const [pdfStatus, setPdfStatus] = useState<string>('');
  const [newSheet, setNewSheet] = useState<{ uri: string; name: string; sheetNumber: string; width?: number; height?: number } | null>(null);

  const project = projectId ? getProject(projectId) : null;
  const sheets = projectId ? getPlanSheetsForProject(projectId) : [];

  const handleImport = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission needed', 'Photo library access is required to import plan sheets.');
      return;
    }
    setImporting(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1.0,
        allowsEditing: false,
        exif: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const a = result.assets[0];
      setNewSheet({
        uri: a.uri,
        name: a.fileName?.replace(/\.[^/.]+$/, '') ?? `Sheet ${sheets.length + 1}`,
        sheetNumber: '',
        width: a.width,
        height: a.height,
      });
    } finally {
      setImporting(false);
    }
  }, [sheets.length]);

  const handleImportPdf = useCallback(async () => {
    if (!projectId) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];

      // Sanity cap on the client too — the edge function caps at 50 pages
      // server-side, but stopping a 500 MB upload before it leaves the device
      // saves the user a long progress bar that ends in failure.
      if (asset.size && asset.size > 500 * 1024 * 1024) {
        Alert.alert('PDF too large', 'Plan PDFs must be under 500 MB. Try splitting it by discipline.');
        return;
      }

      setPdfImporting(true);
      setPdfStatus('Uploading PDF\u2026');

      const pages = await uploadAndRenderPdf({
        fileUri: asset.uri,
        fileName: asset.name,
        projectId,
      });

      setPdfStatus(`Saving ${pages.length} sheet${pages.length === 1 ? '' : 's'}\u2026`);

      const baseName = asset.name?.replace(/\.[^/.]+$/, '') ?? 'Plan set';
      pages.forEach((p) => {
        addPlanSheet({
          projectId,
          name: pages.length === 1 ? baseName : `${baseName} \u2014 Page ${p.pageNumber}`,
          sheetNumber: undefined,
          imageUri: p.publicUrl,
          width: p.width,
          height: p.height,
          pageNumber: p.pageNumber,
        });
      });

      setPdfStatus('');
      Alert.alert(
        'PDF imported',
        `${pages.length} sheet${pages.length === 1 ? '' : 's'} added. Open one to start dropping pins.`,
      );
    } catch (err) {
      const msg = (err as Error).message || 'Could not import that PDF.';
      Alert.alert('Import failed', msg);
    } finally {
      setPdfImporting(false);
      setPdfStatus('');
    }
  }, [projectId, addPlanSheet]);

  const confirmImport = useCallback(() => {
    if (!newSheet || !newSheet.name.trim() || !projectId) {
      Alert.alert('Name required', 'Give the sheet a name before saving.');
      return;
    }
    const created = addPlanSheet({
      projectId,
      name: newSheet.name.trim(),
      sheetNumber: newSheet.sheetNumber.trim() || undefined,
      imageUri: newSheet.uri,
      width: newSheet.width,
      height: newSheet.height,
      pageNumber: 1,
    });
    setNewSheet(null);
    router.push({ pathname: '/plan-viewer' as never, params: { sheetId: created.id } as never });
  }, [newSheet, projectId, addPlanSheet, router]);

  const handleDelete = useCallback((sheet: PlanSheet) => {
    Alert.alert('Delete sheet', `Remove \u201C${sheet.name}\u201D? All pins and markup on this sheet will also be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deletePlanSheet(sheet.id) },
    ]);
  }, [deletePlanSheet]);

  // Project picker when launched without a project
  if (!projectId || !project) {
    return <PlansProjectPicker projects={projects} onPick={(id) => router.replace({ pathname: '/plans' as never, params: { projectId: id } as never })} onBack={() => router.back()} />;
  }

  if (!canAccess('plan_markup')) {
    return <PaywallView onUpgrade={() => router.push('/paywall' as never)} onBack={() => router.back()} insets={insets} />;
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <ChevronLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>{project.name}</Text>
          <Text style={styles.headerTitle}>Plans</Text>
        </View>
        <TouchableOpacity onPress={handleImportPdf} style={styles.ghostBtn} disabled={pdfImporting || importing}>
          {pdfImporting ? <ActivityIndicator size="small" color={Colors.text} /> : <FileText size={15} color={Colors.text} />}
          <Text style={styles.ghostBtnText}>{pdfImporting ? 'Working' : 'PDF'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleImport} style={styles.primaryBtn} disabled={importing || pdfImporting}>
          {importing ? <ActivityIndicator size="small" color={Colors.textOnPrimary} /> : <Plus size={16} color={Colors.textOnPrimary} />}
          <Text style={styles.primaryBtnText}>{importing ? 'Opening' : 'Image'}</Text>
        </TouchableOpacity>
      </View>

      {pdfImporting && pdfStatus ? (
        <View style={styles.statusBar}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.statusBarText}>{pdfStatus}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {sheets.length === 0 ? (
          <View style={styles.emptyCard}>
            <FileImage size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No plan sheets yet</Text>
            <Text style={styles.emptyText}>Import a multi-page PDF and we'll convert each sheet automatically, or pick a single image (PNG/JPG).</Text>
            <View style={styles.emptyBtnRow}>
              <TouchableOpacity onPress={handleImportPdf} style={[styles.primaryBtn]} disabled={pdfImporting || importing}>
                {pdfImporting ? <ActivityIndicator size="small" color={Colors.textOnPrimary} /> : <FileText size={16} color={Colors.textOnPrimary} />}
                <Text style={styles.primaryBtnText}>{pdfImporting ? 'Working' : 'Import PDF'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleImport} style={[styles.ghostBtn]} disabled={importing || pdfImporting}>
                {importing ? <ActivityIndicator size="small" color={Colors.text} /> : <ImageIcon size={15} color={Colors.text} />}
                <Text style={styles.ghostBtnText}>{importing ? 'Opening' : 'Import image'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.helperText}>
              PDFs are rendered server-side at 144 DPI \u2014 high enough to read sheet titles on a phone, light enough to scroll without lag. Up to 50 pages per upload.
            </Text>
          </View>
        ) : (
          sheets.map((s) => {
            const pinCount = getPinsForPlan(s.id).length;
            return (
              <TouchableOpacity
                key={s.id}
                style={styles.sheetCard}
                onPress={() => router.push({ pathname: '/plan-viewer' as never, params: { sheetId: s.id } as never })}
                activeOpacity={0.7}
              >
                <View style={styles.sheetThumbWrap}>
                  <Image source={{ uri: s.imageUri }} style={styles.sheetThumb} resizeMode="cover" />
                </View>
                <View style={{ flex: 1 }}>
                  {s.sheetNumber ? <Text style={styles.sheetNumber}>{s.sheetNumber}</Text> : null}
                  <Text style={styles.sheetName} numberOfLines={2}>{s.name}</Text>
                  <View style={styles.sheetMetaRow}>
                    <View style={styles.metaPill}>
                      <MapPin size={11} color={Colors.primary} />
                      <Text style={styles.metaPillText}>{pinCount} {pinCount === 1 ? 'pin' : 'pins'}</Text>
                    </View>
                    <Text style={styles.sheetDate}>{new Date(s.updatedAt).toLocaleDateString()}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={(e) => { e.stopPropagation(); handleDelete(s); }} style={styles.iconBtn} hitSlop={10}>
                  <Trash2 size={16} color={Colors.error} />
                </TouchableOpacity>
                <ChevronRight size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* New-sheet naming modal */}
      <Modal visible={!!newSheet} transparent animationType="slide" onRequestClose={() => setNewSheet(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New sheet</Text>
              <TouchableOpacity onPress={() => setNewSheet(null)} style={styles.iconBtn}>
                <X size={18} color={Colors.text} />
              </TouchableOpacity>
            </View>
            {newSheet?.uri ? (
              <Image source={{ uri: newSheet.uri }} style={styles.previewImg} resizeMode="contain" />
            ) : null}
            <Text style={styles.label}>Sheet number</Text>
            <TextInput
              value={newSheet?.sheetNumber ?? ''}
              onChangeText={(t) => setNewSheet((d) => d ? { ...d, sheetNumber: t } : d)}
              placeholder="A-101"
              style={styles.input}
              autoCapitalize="characters"
            />
            <Text style={styles.label}>Name</Text>
            <TextInput
              value={newSheet?.name ?? ''}
              onChangeText={(t) => setNewSheet((d) => d ? { ...d, name: t } : d)}
              placeholder="Floor Plan — Level 1"
              style={styles.input}
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={confirmImport}>
              <Check size={16} color={Colors.textOnPrimary} />
              <Text style={styles.primaryBtnText}>Save & open</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Project picker when launched without a projectId

function PlansProjectPicker({ projects, onPick, onBack }: {
  projects: { id: string; name: string; status?: string }[];
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12}>
          <ChevronLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Plans</Text>
          <Text style={styles.headerTitle}>Pick a project</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {projects.length === 0 ? (
          <View style={styles.emptyCard}>
            <AlertTriangle size={18} color={Colors.warning} />
            <Text style={styles.emptyText}>No projects on file. Create one first, then import your drawings here.</Text>
          </View>
        ) : (
          projects.map(p => (
            <TouchableOpacity key={p.id} style={styles.pickerRow} onPress={() => onPick(p.id)}>
              <ImageIcon size={14} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerRowTitle}>{p.name}</Text>
                {p.status && <Text style={styles.pickerRowSub}>{p.status}</Text>}
              </View>
              <ChevronRight size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function PaywallView({ onUpgrade, onBack, insets }: { onUpgrade: () => void; onBack: () => void; insets: { top: number } }) {
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12}>
          <ChevronLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Plans</Text>
          <Text style={styles.headerTitle}>Pro feature</Text>
        </View>
      </View>
      <View style={{ padding: 24 }}>
        <View style={styles.emptyCard}>
          <FileImage size={28} color={Colors.primary} />
          <Text style={styles.emptyTitle}>Plan markup is a Pro feature</Text>
          <Text style={styles.emptyText}>Upgrade to Pro to import drawings, drop pins tied to photos and punch items, and annotate sheets with the crew.</Text>
          <TouchableOpacity onPress={onUpgrade} style={[styles.primaryBtn, { marginTop: 14 }]}>
            <Text style={styles.primaryBtnText}>See plans</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: Colors.surface, borderBottomColor: Colors.borderLight, borderBottomWidth: 1,
  },
  headerBtn: { padding: 6, borderRadius: 8 },
  headerEyebrow: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  headerTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
  },
  primaryBtnText: { color: Colors.textOnPrimary, fontSize: 13, fontWeight: '700' },

  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10,
    borderColor: Colors.borderLight, borderWidth: 1,
  },
  ghostBtnText: { color: Colors.text, fontSize: 13, fontWeight: '600' },

  emptyBtnRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: Colors.surfaceAlt, borderBottomColor: Colors.borderLight, borderBottomWidth: 1,
  },
  statusBarText: { color: Colors.text, fontSize: 12, fontWeight: '600' },

  sheetCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, padding: 12, borderRadius: 14,
    borderColor: Colors.borderLight, borderWidth: 1, marginBottom: 10,
  },
  sheetThumbWrap: {
    width: 72, height: 72, borderRadius: 10, overflow: 'hidden',
    backgroundColor: Colors.surfaceAlt, justifyContent: 'center', alignItems: 'center',
  },
  sheetThumb: { width: '100%', height: '100%' },
  sheetNumber: { color: Colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  sheetName: { color: Colors.text, fontSize: 15, fontWeight: '600', marginTop: 2 },
  sheetMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  metaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surfaceAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  metaPillText: { color: Colors.text, fontSize: 11, fontWeight: '600' },
  sheetDate: { color: Colors.textMuted, fontSize: 11 },
  iconBtn: { padding: 6, borderRadius: 8 },

  emptyCard: {
    backgroundColor: Colors.surface, padding: 24, borderRadius: 14, alignItems: 'center',
    borderColor: Colors.borderLight, borderWidth: 1, gap: 6,
  },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '700', marginTop: 8 },
  emptyText: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  helperText: { color: Colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 12, lineHeight: 16 },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, padding: 12, borderRadius: 10,
    borderColor: Colors.borderLight, borderWidth: 1, marginBottom: 8,
  },
  pickerRowTitle: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  pickerRowSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.surface, padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    gap: 8,
    ...Platform.select({ web: { maxWidth: 520, alignSelf: 'center', width: '100%', borderRadius: 16, marginBottom: 20 } as object, default: {} as object }),
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  modalTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  previewImg: { width: '100%', height: 180, backgroundColor: Colors.surfaceAlt, borderRadius: 10, marginBottom: 8 },
  label: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 4 },
  input: {
    backgroundColor: Colors.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: Colors.text, fontSize: 14, borderColor: Colors.borderLight, borderWidth: 1,
  },
});

