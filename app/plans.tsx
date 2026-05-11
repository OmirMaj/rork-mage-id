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

import React, { useCallback, useState, useMemo } from 'react';
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
 
// @ts-ignore — types resolve after `bun install`
import * as DocumentPicker from 'expo-document-picker';
import {
  ChevronLeft, Plus, MapPin, Trash2, Image as ImageIcon,
  ChevronRight, AlertTriangle, FileImage, X, Check, FileText, Sparkles,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { uploadAndRenderPdf, countPdfPages } from '@/utils/pdfRenderClient';
import { confirmQuotaFits } from '@/utils/quotaPrecheck';
import { TakeoffQuotaBadge } from '@/components/TakeoffQuotaBadge';
import { useUsageStatus } from '@/hooks/useUsageStatus';
import type { PlanSheet } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import CloudFilePicker from '@/components/CloudFilePicker';
import type { CloudFileRef } from '@/utils/cloudStorage';

export default function PlansScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const projectId = typeof params.projectId === 'string' ? params.projectId : undefined;
  const { canAccess } = useTierAccess();
  const { refresh: refreshQuota } = useUsageStatus();
  const {
    projects, getProject, getPlanSheetsForProject, addPlanSheet, updatePlanSheet, deletePlanSheet,
    getPinsForPlan,
  } = useProjects();

  const [importing, setImporting] = useState<boolean>(false);
  const [pdfImporting, setPdfImporting] = useState<boolean>(false);
  const [pdfStatus, setPdfStatus] = useState<string>('');
  const [newSheet, setNewSheet] = useState<{ uri: string; name: string; sheetNumber: string; width?: number; height?: number } | null>(null);

  const project = projectId ? getProject(projectId) : null;
  // Hide superseded sheets by default — when a sheet number gets
  // re-uploaded, the prior copy is marked superseded but remains in
  // the project for audit history. The "Show N superseded" pill below
  // the list lets the GC bring them back into view.
  const allSheets = projectId ? getPlanSheetsForProject(projectId) : [];
  const [showSuperseded, setShowSuperseded] = useState(false);
  const sheets = useMemo(
    () => showSuperseded ? allSheets : allSheets.filter(s => !s.superseded),
    [allSheets, showSuperseded],
  );
  const supersededCount = useMemo(() => allSheets.filter(s => s.superseded).length, [allSheets]);

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

      // Quota precheck \u2014 count pages locally with pdf-lib (~150ms even on
      // 200-page sets) and confirm with the user when their takeoff
      // pages quota is tight. The edge function enforces the same check
      // server-side; doing it client-side is purely UX (fail fast, no
      // long upload + 429).
      setPdfImporting(true);
      setPdfStatus('Reading PDF\u2026');
      const pageCount = await countPdfPages(asset.uri);
      if (pageCount != null) {
        const fits = await confirmQuotaFits(pageCount, asset.name ?? 'PDF', router);
        if (!fits) {
          setPdfImporting(false);
          setPdfStatus('');
          return;
        }
      }

      setPdfStatus('Uploading PDF\u2026');

      const pages = await uploadAndRenderPdf({
        fileUri: asset.uri,
        fileName: asset.name,
        projectId,
      });

      setPdfStatus(`Saving ${pages.length} sheet${pages.length === 1 ? '' : 's'}\u2026`);

      const baseName = asset.name?.replace(/\.[^/.]+$/, '') ?? 'Plan set';
      // Add the sheets first with the fallback name so the user sees
      // something land immediately. Then fire-and-forget a vision
      // call per page to extract the title-block metadata; when each
      // returns we updatePlanSheet with the real sheetNumber + name.
      // Pre-fix every page came in as "Plan set \u2014 Page 4" and the GC
      // had to retype "A-101 Floor Plan" for each one. Buildxact's
      // Takeoff Assistant does this automatically; we ship the same.
      const created = pages.map((p) => addPlanSheet({
        projectId,
        name: pages.length === 1 ? baseName : `${baseName} \u2014 Page ${p.pageNumber}`,
        sheetNumber: undefined,
        imageUri: p.publicUrl,
        width: p.width,
        height: p.height,
        pageNumber: p.pageNumber,
      }));

      // Async metadata extraction. Cap concurrency at 2 so a 60-page
      // set doesn't stampede the edge function. Failures fall back to
      // the original "Plan set \u2014 Page N" name silently.
      void (async () => {
        try {
          const { extractPlanSheetMetadata, composePlanSheetName } = await import('@/utils/planSheetMetadata');
          const queue = pages.map((p, i) => ({ page: p, sheet: created[i] }));
          const concurrency = 2;
          for (let i = 0; i < queue.length; i += concurrency) {
            const batch = queue.slice(i, i + concurrency);
            await Promise.all(batch.map(async ({ page, sheet }) => {
              if (!sheet?.id) return;
              const meta = await extractPlanSheetMetadata(page.publicUrl);
              if (!meta) return;
              const name = composePlanSheetName(meta);
              if (!name && !meta.sheetNumber) return;
              updatePlanSheet(sheet.id, {
                ...(name ? { name } : {}),
                ...(meta.sheetNumber ? { sheetNumber: meta.sheetNumber } : {}),
              });
            }));
          }
        } catch (err) {
          console.log('[plans] metadata extract pass failed', err);
        }
      })();

      setPdfStatus('');
      // Refresh the usage badge so the user sees the new "X of Y pages
      // remaining" reflecting the just-charged pages without remounting.
      refreshQuota();
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
  }, [projectId, addPlanSheet, router, refreshQuota]);

  // Cloud import — wires the unified CloudFilePicker into Plans.
  // For v1, the cloud file's webUrl is opened (Drive/Dropbox/OneDrive
  // preview) and an Alert offers two paths:
  //   - "Open in browser" — user downloads + uses Import PDF below
  //   - "Coming soon" — full cloud→render pipeline (v2: fetch file
  //                     bytes via the provider API + feed to
  //                     uploadAndRenderPdf without local download)
  // This ships the connector + verifies the OAuth credentials work
  // without taking on the multi-day v2 ingestion plumbing.
  const handleCloudPick = useCallback(async (ref: CloudFileRef) => {
    Alert.alert(
      'Picked from ' + (ref.source === 'gdrive' ? 'Google Drive' : ref.source === 'dropbox' ? 'Dropbox' : ref.source === 'onedrive' ? 'OneDrive' : 'Box'),
      `${ref.name}\n\n${ref.mimeType ?? 'Unknown type'}${ref.size ? ` · ${(ref.size / 1024 / 1024).toFixed(1)} MB` : ''}\n\nFull cloud → import pipeline is coming. For now you can open the file in your browser, save locally, then use Import PDF below.`,
      [
        ref.webUrl ? {
          text: 'Open in browser',
          onPress: () => {
            if (typeof window !== 'undefined') {
              window.open(ref.webUrl, '_blank', 'noopener,noreferrer');
            }
          },
        } : { text: 'OK' },
        { text: 'OK', style: 'cancel' as const },
      ].filter(Boolean) as { text: string; onPress?: () => void; style?: 'cancel' }[],
    );
  }, []);

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
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
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

      {/* Cloud picker — Google Drive / Dropbox / OneDrive / Box.
          Only renders providers whose env-var credentials are
          configured. v1: picks a file, shows ref info + opens in
          browser. v2: ingests via the existing PDF render pipeline. */}
      <View style={styles.cloudPickerWrap}>
        <CloudFilePicker
          onPick={handleCloudPick}
          label="Or pick from cloud storage"
        />
      </View>

      {/* Takeoff quota badge — shows the user's current month usage so
          they can budget how many pages to upload before they pick a
          file. Tapping the upgrade pill (when over cap) routes to the
          paywall. Always visible above the sheet list. */}
      <View style={{ paddingHorizontal: Tokens.spacing.md, paddingTop: Tokens.spacing.xs }}>
        <TakeoffQuotaBadge variant="inline" onUpgrade={() => router.push('/paywall' as never)} />
      </View>

      <ScrollView contentContainerStyle={{ padding: Tokens.spacing.md, paddingBottom: Tokens.spacing['3xl'] }}>
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {s.sheetNumber ? <Text style={styles.sheetNumber}>{s.sheetNumber}</Text> : null}
                    {s.revision && s.revision > 1 && (
                      <View style={[styles.revPill, s.superseded && { backgroundColor: Colors.fillTertiary }]}>
                        <Text style={[styles.revPillText, s.superseded && { color: Colors.textMuted }]}>
                          Rev {s.revision}{s.superseded ? ' · superseded' : ''}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.sheetName} numberOfLines={2}>{s.name}</Text>
                  <View style={styles.sheetMetaRow}>
                    <View style={styles.metaPill}>
                      <MapPin size={11} color={Colors.primary} />
                      <Text style={styles.metaPillText}>{pinCount} {pinCount === 1 ? 'pin' : 'pins'}</Text>
                    </View>
                    <Text style={styles.sheetDate}>{new Date(s.updatedAt).toLocaleDateString()}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={(e) => { e.stopPropagation(); handleDelete(s); }} style={styles.iconBtn} hitSlop={10} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={16} color={Colors.error} />
                </TouchableOpacity>
                <ChevronRight size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            );
          })
        )}

        {/* Toggle to bring superseded revisions back into view. Only
            renders when there's something to toggle. */}
        {supersededCount > 0 && (
          <TouchableOpacity
            onPress={() => setShowSuperseded(v => !v)}
            style={styles.supersededToggle}
            activeOpacity={0.7}
          >
            <Text style={styles.supersededToggleText}>
              {showSuperseded
                ? `Hide ${supersededCount} superseded revision${supersededCount === 1 ? '' : 's'}`
                : `Show ${supersededCount} superseded revision${supersededCount === 1 ? '' : 's'}`}
            </Text>
          </TouchableOpacity>
        )}

        {sheets.length > 0 && (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/compare-drawings' as never, params: { projectId: projectId ?? '' } as never })}
            activeOpacity={0.85}
            style={styles.compareBtn}
            testID="compare-drawings-cta"
          >
            <Sparkles size={16} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.compareBtnTitle}>AI compare to revision</Text>
              <Text style={styles.compareBtnSub}>Pick a sheet + upload its new rev — AI flags every change</Text>
            </View>
            <ChevronRight size={16} color={Colors.primary} />
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* New-sheet naming modal */}
      <Modal visible={!!newSheet} transparent animationType="slide" onRequestClose={() => setNewSheet(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New sheet</Text>
              <TouchableOpacity onPress={() => setNewSheet(null)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
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
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"><ChevronLeft size={22} color={Colors.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Plans</Text>
          <Text style={styles.headerTitle}>Pick a project</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: Tokens.spacing.md }}>
        {projects.length === 0 ? (
          <View style={styles.emptyCard}>
            <ImageIcon size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No projects yet</Text>
            <Text style={styles.emptyText}>Plans attach to a project so every pin (punch items, photos, RFIs) ties back to a job. Create a project first, then come back here to import drawings.</Text>
            <TouchableOpacity onPress={onBack} style={[styles.primaryBtn, { marginTop: Tokens.spacing.sm }]}>
              <Text style={styles.primaryBtnText}>Open Projects</Text>
            </TouchableOpacity>
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
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"><ChevronLeft size={22} color={Colors.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Plans</Text>
          <Text style={styles.headerTitle}>Pro feature</Text>
        </View>
      </View>
      <View style={{ padding: Tokens.spacing.xl }}>
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
  headerBtn: { padding: 6, borderRadius: Tokens.radius.sm },
  headerEyebrow: { color: Colors.textSecondary, fontSize: Type.caption2.fontSize, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  headerTitle: { color: Colors.text, fontSize: Type.subheadline.fontSize, fontWeight: '700' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.md,
  },
  primaryBtnText: { color: Colors.textOnPrimary, fontSize: Type.footnote.fontSize, fontWeight: '700' },

  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceAlt, paddingHorizontal: Tokens.spacing.sm, paddingVertical: 9, borderRadius: Tokens.radius.md,
    borderColor: Colors.borderLight, borderWidth: 1,
  },
  ghostBtnText: { color: Colors.text, fontSize: Type.footnote.fontSize, fontWeight: '600' },

  emptyBtnRow: { flexDirection: 'row', gap: Tokens.spacing.xs, marginTop: 14 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs,
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: Colors.surfaceAlt, borderBottomColor: Colors.borderLight, borderBottomWidth: 1,
  },
  statusBarText: { color: Colors.text, fontSize: Type.caption1.fontSize, fontWeight: '600' },

  // Cloud picker wrapper — sits below the import action bar with a
  // light divider so it reads as a secondary action path.
  cloudPickerWrap: {
    paddingHorizontal: Tokens.spacing.md, paddingVertical: Tokens.spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.background,
  },

  sheetCard: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
    backgroundColor: Colors.surface, padding: Tokens.spacing.sm, borderRadius: Tokens.radius.lg,
    borderColor: Colors.borderLight, borderWidth: 1, marginBottom: 10,
  },
  sheetThumbWrap: {
    width: 72, height: 72, borderRadius: Tokens.radius.md, overflow: 'hidden',
    backgroundColor: Colors.surfaceAlt, justifyContent: 'center', alignItems: 'center',
  },
  sheetThumb: { width: '100%', height: '100%' },
  sheetNumber: { color: Colors.primary, fontSize: Type.caption2.fontSize, fontWeight: '700', letterSpacing: 0.4 },
  revPill: {
    paddingHorizontal: 6, paddingVertical: Tokens.spacing.hairline,
    borderRadius: 8,
    backgroundColor: Colors.primary + '14',
  },
  revPillText: {
    fontSize: 9, fontWeight: '700' as const, color: Colors.primary,
    letterSpacing: 0.3, textTransform: 'uppercase' as const,
  },
  supersededToggle: {
    paddingVertical: 10, paddingHorizontal: Tokens.spacing.md,
    alignItems: 'center' as const,
  },
  supersededToggleText: {
    fontSize: Type.caption1.fontSize, color: Colors.textSecondary,
    fontWeight: '600' as const,
  },
  sheetName: { color: Colors.text, fontSize: Type.subhead.fontSize, fontWeight: '600', marginTop: Tokens.spacing.hairline },
  sheetMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs, marginTop: 6 },
  metaPill: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs,
    backgroundColor: Colors.surfaceAlt, paddingHorizontal: Tokens.spacing.xs, paddingVertical: 3, borderRadius: Tokens.radius.sm,
  },
  metaPillText: { color: Colors.text, fontSize: Type.caption2.fontSize, fontWeight: '600' },
  sheetDate: { color: Colors.textMuted, fontSize: Type.caption2.fontSize },
  iconBtn: { padding: 6, borderRadius: Tokens.radius.sm },

  emptyCard: {
    backgroundColor: Colors.surface, padding: Tokens.spacing.xl, borderRadius: Tokens.radius.lg, alignItems: 'center',
    borderColor: Colors.borderLight, borderWidth: 1, gap: 6,
  },
  emptyTitle: { color: Colors.text, fontSize: Type.callout.fontSize, fontWeight: '700', marginTop: Tokens.spacing.xs },
  emptyText: { color: Colors.textSecondary, fontSize: Type.footnote.fontSize, textAlign: 'center', lineHeight: 19 },
  helperText: { color: Colors.textMuted, fontSize: Type.caption2.fontSize, textAlign: 'center', marginTop: Tokens.spacing.sm, lineHeight: 16 },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, padding: Tokens.spacing.sm, borderRadius: Tokens.radius.md,
    borderColor: Colors.borderLight, borderWidth: 1, marginBottom: Tokens.spacing.xs,
  },
  pickerRowTitle: { color: Colors.text, fontSize: Type.bodyCompact.fontSize, fontWeight: '600' },
  pickerRowSub: { color: Colors.textSecondary, fontSize: Type.caption1.fontSize, marginTop: Tokens.spacing.hairline },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.surface, padding: Tokens.spacing.md, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    gap: Tokens.spacing.xs,
    ...Platform.select({ web: { maxWidth: 520, alignSelf: 'center', width: '100%', borderRadius: Tokens.radius.panel, marginBottom: Tokens.spacing.lg } as object, default: {} as object }),
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  modalTitle: { color: Colors.text, fontSize: Type.callout.fontSize, fontWeight: '700' },
  previewImg: { width: '100%', height: 180, backgroundColor: Colors.surfaceAlt, borderRadius: Tokens.radius.md, marginBottom: Tokens.spacing.xs },
  label: { color: Colors.textSecondary, fontSize: Type.caption1.fontSize, fontWeight: '600', marginTop: Tokens.spacing.xxs },
  input: {
    backgroundColor: Colors.surfaceAlt, borderRadius: Tokens.radius.md, paddingHorizontal: Tokens.spacing.sm, paddingVertical: 10,
    color: Colors.text, fontSize: Type.bodyCompact.fontSize, borderColor: Colors.borderLight, borderWidth: 1,
  },

  compareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
    marginTop: Tokens.spacing.md, padding: 14,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  compareBtnTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: Colors.text },
  compareBtnSub: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline },
});

