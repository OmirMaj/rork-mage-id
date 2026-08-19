// data-import.tsx — bring a MAGE ID export file back in. NON-DESTRUCTIVE:
// merges records by id (never overwrites or deletes), so it's safe for backup
// restore, moving to a new device, or pulling your book of business over when
// you switch from another tool. v1 imports projects + contacts + subs (the
// collections ProjectContext.importData syncs durably); anything else in the
// file is detected and shown as "not imported yet" so nothing is silent.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import {
  FolderInput, Upload, FileJson, CheckCircle2, AlertTriangle, Info, ShieldCheck, ArrowRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import {
  parseMageExport, partitionNew, IMPORTABLE_COLLECTIONS, DEFERRED_COLLECTIONS,
  type ParsedImport, type ImportableKey,
} from '@/utils/dataImport';

interface PlanRow { key: ImportableKey; label: string; incoming: number; toAdd: number; duplicates: number }
interface DeferredRow { label: string; count: number }

export default function DataImportScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projects, contacts, subcontractors, importData } = useProjects();

  const [busy, setBusy] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [result, setResult] = useState<{ projects: number; contacts: number; subcontractors: number } | null>(null);

  const existingIds = useMemo(() => ({
    projects: new Set(projects.map(p => p.id)),
    contacts: new Set(contacts.map(c => c.id)),
    subcontractors: new Set(subcontractors.map(s => s.id)),
  }), [projects, contacts, subcontractors]);

  const plan: PlanRow[] = useMemo(() => {
    if (!parsed) return [];
    return IMPORTABLE_COLLECTIONS.map(({ key, label }) => {
      const incoming = ((parsed.data[key] as { id: string }[]) ?? []);
      const { toAdd, duplicates } = partitionNew(incoming, existingIds[key]);
      return { key, label, incoming: incoming.length, toAdd: toAdd.length, duplicates };
    });
  }, [parsed, existingIds]);

  const deferredFound: DeferredRow[] = useMemo(() => {
    if (!parsed) return [];
    return DEFERRED_COLLECTIONS
      .map(({ key, label }) => ({ label, count: ((parsed.data[key] as unknown[]) ?? []).length }))
      .filter(r => r.count > 0);
  }, [parsed]);

  const totalToAdd = useMemo(() => plan.reduce((s, r) => s + r.toAdd, 0), [plan]);

  const readText = useCallback(async (uri: string): Promise<string> => {
    if (Platform.OS === 'web') {
      const res = await fetch(uri);
      return await res.text();
    }
    return await FileSystem.readAsStringAsync(uri, { encoding: 'utf8' });
  }, []);

  const pickFile = useCallback(async () => {
    try {
      setBusy(true);
      setResult(null);
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/json', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      setFileName(asset.name ?? 'export.json');
      const text = await readText(asset.uri);
      const res = parseMageExport(text);
      if (!res.ok) {
        setParsed(null);
        showAlert('Could not read that file', res.error);
        return;
      }
      setParsed(res.result);
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
    } catch (err) {
      console.error('[DataImport] pick failed', err);
      showAlert('Import error', err instanceof Error ? err.message : 'Could not open that file.');
    } finally {
      setBusy(false);
    }
  }, [readText]);

  const runImport = useCallback(() => {
    if (!parsed || totalToAdd === 0) return;
    showAlert(
      'Import these records?',
      `${totalToAdd} new record(s) will be added. Nothing already in your account is changed or removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: () => {
            try {
              setImporting(true);
              if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              const r = importData({
                projects: parsed.data.projects ?? [],
                contacts: parsed.data.contacts ?? [],
                subcontractors: parsed.data.subcontractors ?? [],
              });
              setResult(r);
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err) {
              console.error('[DataImport] import failed', err);
              showAlert('Import failed', err instanceof Error ? err.message : 'Please try again.');
            } finally {
              setImporting(false);
            }
          },
        },
      ],
    );
  }, [parsed, totalToAdd, importData]);

  const importedTotal = result ? result.projects + result.contacts + result.subcontractors : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView {...fabScroll} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><FolderInput size={24} color={themeColors.accent} strokeWidth={1.75} /></View>
          <Text style={styles.heroTitle}>Import data</Text>
          <Text style={styles.heroSub}>
            Bring in a MAGE ID export (.json) to move to a new device or carry your book of business
            over when you switch tools. Restore currently brings back your projects, contacts, and
            subcontractors — the rest of the file is preserved and read but not re-imported yet.
          </Text>
          <View style={styles.roBadge}>
            <ShieldCheck size={13} color={themeColors.success} strokeWidth={1.75} />
            <Text style={styles.roBadgeText}>Non-destructive: records are merged by id. Nothing you already have is overwritten or deleted.</Text>
          </View>
        </View>

        {/* Pick */}
        <TouchableOpacity style={styles.pickBtn} onPress={pickFile} disabled={busy} activeOpacity={0.85} testID="pick-import-file">
          {busy ? <ActivityIndicator color={themeColors.accent} /> : <><Upload size={18} color={themeColors.accent} strokeWidth={1.75} /><Text style={styles.pickBtnText}>{parsed ? 'Choose a different file' : 'Choose export file (.json)'}</Text></>}
        </TouchableOpacity>

        {parsed && (
          <>
            <View style={styles.fileRow}>
              <FileJson size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
              {parsed.exportedAt && <Text style={styles.fileMeta}>{parsed.exportedAt.slice(0, 10)}</Text>}
            </View>

            <Text style={styles.sectionLabel}>WILL IMPORT</Text>
            <View style={styles.card}>
              {plan.map((row, i) => (
                <View key={row.key} style={[styles.planRow, i === plan.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={styles.planLabel}>{row.label}</Text>
                  <Text style={styles.planCount}>
                    {row.toAdd > 0 ? <Text style={styles.planAdd}>+{row.toAdd} new</Text> : <Text style={styles.planNone}>nothing new</Text>}
                    {row.duplicates > 0 ? <Text style={styles.planDup}>  ·  {row.duplicates} already have</Text> : null}
                  </Text>
                </View>
              ))}
            </View>

            {deferredFound.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>IN THE FILE, NOT IMPORTED YET</Text>
                <View style={styles.hintCard}>
                  <Info size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
                  <Text style={styles.hintText}>
                    {deferredFound.map(d => `${d.label} (${d.count})`).join(', ')}.{'\n'}
                    These stay safely in your file. Importing them losslessly is a follow-up — projects, contacts and subs come in now.
                  </Text>
                </View>
              </>
            )}

            {result ? (
              <View style={styles.resultCard}>
                <CheckCircle2 size={22} color={themeColors.success} strokeWidth={1.75} />
                <Text style={styles.resultTitle}>Imported {importedTotal} record(s)</Text>
                <Text style={styles.resultDetail}>
                  {result.projects} project(s) · {result.contacts} contact(s) · {result.subcontractors} sub(s)
                </Text>
                <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()} activeOpacity={0.85}>
                  <Text style={styles.doneBtnText}>Done</Text>
                  <ArrowRight size={16} color={Colors.textOnAccent} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.importBtn, (totalToAdd === 0 || importing) && styles.importBtnDisabled]}
                onPress={runImport}
                disabled={totalToAdd === 0 || importing}
                activeOpacity={0.85}
                testID="run-import"
              >
                {importing ? <ActivityIndicator color={Colors.textOnAccent} /> : (
                  <><FolderInput size={18} color={Colors.textOnAccent} strokeWidth={1.75} /><Text style={styles.importBtnText}>{totalToAdd > 0 ? `Import ${totalToAdd} record(s)` : 'Nothing new to import'}</Text></>
                )}
              </TouchableOpacity>
            )}
          </>
        )}

        {!parsed && !busy && (
          <View style={styles.hintCard}>
            <AlertTriangle size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.hintText}>
              Need a file? On any device with your data, go to Settings → Export my data → JSON, then bring that .json here.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  scroll: { padding: 16 },

  hero: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel, padding: 20,
    borderWidth: 1, borderColor: t.line, marginBottom: 20, gap: 10,
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: Tokens.radius.card,
    backgroundColor: `${t.accent}15`, alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '700', color: t.text },
  heroSub: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, lineHeight: 20 },
  roBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: `${t.success}12`, padding: 10, borderRadius: Tokens.radius.md, marginTop: 4,
  },
  roBadgeText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 16 },

  pickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: `${t.accent}12`, borderWidth: 1, borderColor: `${t.accent}30`,
    paddingVertical: 14, borderRadius: Tokens.radius.card, marginBottom: 16,
  },
  pickBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.accent },

  fileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
  },
  fileName: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' },
  fileMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary },

  sectionLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary,
    letterSpacing: 0.8, marginBottom: 8, marginTop: 4,
  },
  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line,
    overflow: 'hidden', marginBottom: 16,
  },
  planRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  planLabel: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' },
  planCount: { fontSize: Type.footnote.fontSize },
  planAdd: { color: t.success, fontWeight: '700' },
  planNone: { color: t.textMuted },
  planDup: { color: t.textSecondary },

  hintCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: `${t.accent}08`, padding: 12, borderRadius: Tokens.radius.md, marginBottom: 16,
  },
  hintText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  importBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accentFill, paddingVertical: 16, borderRadius: Tokens.radius.card,
  },
  importBtnDisabled: { opacity: 0.5 },
  importBtnText: { color: Colors.textOnAccent, fontWeight: '700', fontSize: Type.subhead.fontSize },

  resultCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line,
    padding: 20, alignItems: 'center', gap: 8,
  },
  resultTitle: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text },
  resultDetail: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center' },
  doneBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    backgroundColor: t.accentFill, paddingVertical: 12, paddingHorizontal: 24, borderRadius: Tokens.radius.card,
  },
  doneBtnText: { color: Colors.textOnAccent, fontWeight: '700', fontSize: Type.subhead.fontSize },
});
