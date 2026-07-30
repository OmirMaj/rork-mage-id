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
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Platform, TextInput, Modal, ActivityIndicator,
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
  ChevronRight, AlertTriangle, FileImage, X, Check, FileText,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { uploadAndRenderPdf, countPdfPages } from '@/utils/pdfRenderClient';
import { confirmQuotaFits } from '@/utils/quotaPrecheck';
import { TakeoffQuotaBadge } from '@/components/TakeoffQuotaBadge';
import { useUsageStatus } from '@/hooks/useUsageStatus';
import type { PlanSheet } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

export default function PlansScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ projectId?: string }>();
  const projectId = typeof params.projectId === 'string' ? params.projectId : undefined;
  const { canAccess } = useTierAccess();
  const { refresh: refreshQuota } = useUsageStatus();
  const {
    projects, getProject, getPlanSheetsForProject, addPlanSheet, deletePlanSheet,
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
      showAlert('Permission needed', 'Photo library access is required to import plan sheets.');
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
        showAlert('PDF too large', 'Plan PDFs must be under 500 MB. Try splitting it by discipline.');
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
      // Refresh the usage badge so the user sees the new "X of Y pages
      // remaining" reflecting the just-charged pages without remounting.
      refreshQuota();
      showAlert(
        'PDF imported',
        `${pages.length} sheet${pages.length === 1 ? '' : 's'} added. Open one to start dropping pins.`,
      );
    } catch (err) {
      const msg = (err as Error).message || 'Could not import that PDF.';
      showAlert('Import failed', msg);
    } finally {
      setPdfImporting(false);
      setPdfStatus('');
    }
  }, [projectId, addPlanSheet, router, refreshQuota]);

  const confirmImport = useCallback(() => {
    if (!newSheet || !newSheet.name.trim() || !projectId) {
      showAlert('Name required', 'Give the sheet a name before saving.');
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
    showAlert('Delete sheet', `Remove \u201C${sheet.name}\u201D? All pins and markup on this sheet will also be removed.`, [
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
    <View style={[styles.root, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>{project.name}</Text>
          <Text style={styles.headerTitle}>Plans</Text>
        </View>
        <TouchableOpacity onPress={handleImportPdf} style={styles.ghostBtn} disabled={pdfImporting || importing}>
          {pdfImporting ? <ActivityIndicator size="small" color={themeColors.text} /> : <FileText size={15} color={themeColors.text} strokeWidth={1.75} />}
          <Text style={styles.ghostBtnText}>{pdfImporting ? 'Working' : 'PDF'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleImport} style={styles.primaryBtn} disabled={importing || pdfImporting}>
          {importing ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Plus size={16} color="#FFFFFF" strokeWidth={1.75} />}
          <Text style={styles.primaryBtnText}>{importing ? 'Opening' : 'Image'}</Text>
        </TouchableOpacity>
      </View>

      {pdfImporting && pdfStatus ? (
        <View style={styles.statusBar}>
          <ActivityIndicator size="small" color={themeColors.accent} />
          <Text style={styles.statusBarText}>{pdfStatus}</Text>
        </View>
      ) : null}

      {/* Takeoff quota badge — shows the user's current month usage so
          they can budget how many pages to upload before they pick a
          file. Tapping the upgrade pill (when over cap) routes to the
          paywall. Always visible above the sheet list. */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <TakeoffQuotaBadge variant="inline" onUpgrade={() => router.push('/paywall' as never)} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {sheets.length === 0 ? (
          <View style={styles.emptyCard}>
            <FileImage size={28} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No plan sheets yet</Text>
            <Text style={styles.emptyText}>Import a multi-page PDF and we'll convert each sheet automatically, or pick a single image (PNG/JPG).</Text>
            <View style={styles.emptyBtnRow}>
              <TouchableOpacity onPress={handleImportPdf} style={[styles.primaryBtn]} disabled={pdfImporting || importing}>
                {pdfImporting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <FileText size={16} color="#FFFFFF" strokeWidth={1.75} />}
                <Text style={styles.primaryBtnText}>{pdfImporting ? 'Working' : 'Import PDF'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleImport} style={[styles.ghostBtn]} disabled={importing || pdfImporting}>
                {importing ? <ActivityIndicator size="small" color={themeColors.text} /> : <ImageIcon size={15} color={themeColors.text} strokeWidth={1.75} />}
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
                      <View style={[styles.revPill, s.superseded && { backgroundColor: themeColors.surfaceAlt }]}>
                        <Text style={[styles.revPillText, s.superseded && { color: themeColors.textMuted }]}>
                          Rev {s.revision}{s.superseded ? ' · superseded' : ''}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.sheetName} numberOfLines={2}>{s.name}</Text>
                  <View style={styles.sheetMetaRow}>
                    <View style={styles.metaPill}>
                      <MapPin size={11} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.metaPillText}>{pinCount} {pinCount === 1 ? 'pin' : 'pins'}</Text>
                    </View>
                    <Text style={styles.sheetDate}>{new Date(s.updatedAt).toLocaleDateString()}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={(e) => { e.stopPropagation(); handleDelete(s); }} style={styles.iconBtn} hitSlop={10} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={16} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
                <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
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
            <MageAIMark size={16} color={themeColors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.compareBtnTitle}>AI compare to revision</Text>
              <Text style={styles.compareBtnSub}>Pick a sheet + upload its new rev — AI flags every change</Text>
            </View>
            <ChevronRight size={16} color={themeColors.accent} strokeWidth={1.75} />
          </TouchableOpacity>
        )}

        {/* Ask Your Plans — cross-link to the plan intelligence Q&A surface.
            Previously unreachable from any plans surface; this CTA makes it
            discoverable in context (you have the sheets open, AI can answer
            questions about them). Always shown so first-time users know it
            exists even before uploading sheets. */}
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/plan-intelligence' as never, params: { projectId: projectId ?? '' } as never })}
          activeOpacity={0.85}
          style={[styles.compareBtn, { marginTop: 8 }]}
          testID="plans-ask-cta"
        >
          <MageAIMark size={16} color={themeColors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.compareBtnTitle}>Ask your plans</Text>
            <Text style={styles.compareBtnSub}>Ask anything in plain English — MAGE finds it in the sheets</Text>
          </View>
          <ChevronRight size={16} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
      </ScrollView>

      {/* New-sheet naming modal */}
      <Modal visible={!!newSheet} transparent animationType="slide" onRequestClose={() => setNewSheet(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New sheet</Text>
              <TouchableOpacity onPress={() => setNewSheet(null)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
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
              <Check size={16} color="#FFFFFF" strokeWidth={1.75} />
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.root, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"><ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Plans</Text>
          <Text style={styles.headerTitle}>Pick a project</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {projects.length === 0 ? (
          <View style={styles.emptyCard}>
            <ImageIcon size={28} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No projects yet</Text>
            <Text style={styles.emptyText}>Plans attach to a project so every pin (punch items, photos, RFIs) ties back to a job. Create a project first, then come back here to import drawings.</Text>
            <TouchableOpacity onPress={onBack} style={[styles.primaryBtn, { marginTop: 12 }]}>
              <Text style={styles.primaryBtnText}>Open Projects</Text>
            </TouchableOpacity>
          </View>
        ) : (
          projects.map(p => (
            <TouchableOpacity key={p.id} style={styles.pickerRow} onPress={() => onPick(p.id)}>
              <ImageIcon size={14} color={themeColors.accent} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerRowTitle}>{p.name}</Text>
                {p.status && <Text style={styles.pickerRowSub}>{p.status}</Text>}
              </View>
              <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function PaywallView({ onUpgrade, onBack, insets }: { onUpgrade: () => void; onBack: () => void; insets: { top: number } }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.root, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"><ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Plans</Text>
          <Text style={styles.headerTitle}>Pro feature</Text>
        </View>
      </View>
      <View style={{ padding: 24 }}>
        <View style={styles.emptyCard}>
          <FileImage size={28} color={themeColors.accent} strokeWidth={1.75} />
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: t.surface, borderBottomColor: t.line, borderBottomWidth: 1,
  },
  headerBtn: { padding: 6, borderRadius: Tokens.radius.sm },
  headerEyebrow: { color: t.textSecondary, fontSize: Type.caption2.fontSize, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  headerTitle: { color: t.text, fontSize: Type.subheadline.fontSize, fontWeight: '700' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: t.accent, paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.md,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: Type.footnote.fontSize, fontWeight: '700' },

  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: t.surfaceAlt, paddingHorizontal: 12, paddingVertical: 9, borderRadius: Tokens.radius.md,
    borderColor: t.line, borderWidth: 1,
  },
  ghostBtnText: { color: t.text, fontSize: Type.footnote.fontSize, fontWeight: '600' },

  emptyBtnRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: t.surfaceAlt, borderBottomColor: t.line, borderBottomWidth: 1,
  },
  statusBarText: { color: t.text, fontSize: Type.caption1.fontSize, fontWeight: '600' },

  sheetCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: t.surface, padding: 12, borderRadius: Tokens.radius.lg,
    borderColor: t.line, borderWidth: 1, marginBottom: 10,
  },
  sheetThumbWrap: {
    width: 72, height: 72, borderRadius: Tokens.radius.md, overflow: 'hidden',
    backgroundColor: t.surfaceAlt, justifyContent: 'center', alignItems: 'center',
  },
  sheetThumb: { width: '100%', height: '100%' },
  sheetNumber: { color: t.accent, fontSize: Type.caption2.fontSize, fontWeight: '700', letterSpacing: 0.4 },
  revPill: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: t.accent + '14',
  },
  revPillText: {
    fontSize: 9, fontWeight: '700' as const, color: t.accent,
    letterSpacing: 0.3, textTransform: 'uppercase' as const,
  },
  supersededToggle: {
    paddingVertical: 10, paddingHorizontal: 16,
    alignItems: 'center' as const,
  },
  supersededToggleText: {
    fontSize: Type.caption1.fontSize, color: t.textSecondary,
    fontWeight: '600' as const,
  },
  sheetName: { color: t.text, fontSize: Type.subhead.fontSize, fontWeight: '600', marginTop: 2 },
  sheetMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  metaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: t.surfaceAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.sm,
  },
  metaPillText: { color: t.text, fontSize: Type.caption2.fontSize, fontWeight: '600' },
  sheetDate: { color: t.textMuted, fontSize: Type.caption2.fontSize },
  iconBtn: { padding: 6, borderRadius: Tokens.radius.sm },

  emptyCard: {
    backgroundColor: t.surface, padding: 24, borderRadius: Tokens.radius.lg, alignItems: 'center',
    borderColor: t.line, borderWidth: 1, gap: 6,
  },
  emptyTitle: { color: t.text, fontSize: Type.callout.fontSize, fontWeight: '700', marginTop: 8 },
  emptyText: { color: t.textSecondary, fontSize: Type.footnote.fontSize, textAlign: 'center', lineHeight: 19 },
  helperText: { color: t.textMuted, fontSize: Type.caption2.fontSize, textAlign: 'center', marginTop: 12, lineHeight: 16 },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.surface, padding: 12, borderRadius: Tokens.radius.md,
    borderColor: t.line, borderWidth: 1, marginBottom: 8,
  },
  pickerRowTitle: { color: t.text, fontSize: Type.bodyCompact.fontSize, fontWeight: '600' },
  pickerRowSub: { color: t.textSecondary, fontSize: Type.caption1.fontSize, marginTop: 2 },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: t.surface, padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    gap: 8,
    ...Platform.select({ web: { maxWidth: 520, alignSelf: 'center', width: '100%', borderRadius: Tokens.radius.panel, marginBottom: 20 } as object, default: {} as object }),
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  modalTitle: { color: t.text, fontSize: Type.callout.fontSize, fontWeight: '700' },
  previewImg: { width: '100%', height: 180, backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, marginBottom: 8 },
  label: { color: t.textSecondary, fontSize: Type.caption1.fontSize, fontWeight: '600', marginTop: 4 },
  input: {
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 10,
    color: t.text, fontSize: Type.bodyCompact.fontSize, borderColor: t.line, borderWidth: 1,
  },

  compareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 16, padding: 14,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '30',
  },
  compareBtnTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  compareBtnSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
});

