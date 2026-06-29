import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Download, FileJson, FileSpreadsheet, FolderDown, Image as ImageIcon,
  Package, CheckCircle2, Share2, Info,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  buildExportPayload, exportUserData, shareExportedFile, summarizeExport,
  type DataExportOptions, type DataExportSummary,
} from '@/utils/dataExport';

type Scope = 'all' | 'project';

export default function DataExportScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const {
    projects, invoices, changeOrders, punchItems,
    projectPhotos, contacts, rfis, submittals, equipment, warranties,
    subcontractors, commEvents, getDailyReportsForProject, settings,
  } = useProjects();

  const dailyReports = useMemo(
    () => projects.flatMap(p => getDailyReportsForProject(p.id)),
    [projects, getDailyReportsForProject],
  );

  const [scope, setScope] = useState<Scope>(params.projectId ? 'project' : 'all');
  const [projectId, setProjectId] = useState<string | undefined>(params.projectId);
  const [format, setFormat] = useState<'json' | 'csv' | 'both'>('both');
  const [includePhotoUrls, setIncludePhotoUrls] = useState<boolean>(true);
  // Closeout PDF + README — only shown when scope === 'project'. Defaults
  // off because they slow down generation (PDF rendering takes a few
  // seconds) and most "give me my data" exports don't need them.
  const [includeCloseoutPacket, setIncludeCloseoutPacket] = useState<boolean>(false);
  const [includeReadme, setIncludeReadme] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<DataExportSummary | null>(null);

  // One-tap "full archive" preset — flips the right toggles for the
  // typical handoff use case (single project + every file type the
  // homeowner / accountant might want).
  const applyArchivePreset = useCallback(() => {
    if (scope !== 'project' || !projectId) {
      Alert.alert('Pick a project first', 'The archive preset bundles a single project. Switch scope to "Single project" and pick one above.');
      return;
    }
    setFormat('both');
    setIncludeCloseoutPacket(true);
    setIncludeReadme(true);
    setIncludePhotoUrls(true);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [scope, projectId]);

  const allData = useMemo(() => ({
    projects,
    invoices,
    changeOrders,
    dailyReports,
    punchItems,
    photos: projectPhotos,
    contacts,
    rfis,
    submittals,
    equipment,
    warranties,
    subcontractors,
    communications: commEvents,
  }), [projects, invoices, changeOrders, dailyReports, punchItems, projectPhotos,
      contacts, rfis, submittals, equipment, warranties, subcontractors, commEvents]);

  const options: DataExportOptions = useMemo(() => ({
    projectId: scope === 'project' ? projectId : undefined,
    format,
    includePhotoUrls,
    includeCloseoutPacket: scope === 'project' ? includeCloseoutPacket : false,
    includeReadme,
  }), [scope, projectId, format, includePhotoUrls, includeCloseoutPacket, includeReadme]);

  const previewPayload = useMemo(() => buildExportPayload(allData, options), [allData, options]);

  const totals = useMemo(() => ({
    projects: previewPayload.projects.length,
    invoices: previewPayload.invoices.length,
    changeOrders: previewPayload.changeOrders.length,
    dailyReports: previewPayload.dailyReports.length,
    punchItems: previewPayload.punchItems.length,
    photos: previewPayload.photos.length,
    contacts: previewPayload.contacts.length,
    rfis: previewPayload.rfis.length,
    submittals: previewPayload.submittals.length,
  }), [previewPayload]);

  const handleGenerate = useCallback(async () => {
    if (scope === 'project' && !projectId) {
      Alert.alert('Pick a project', 'Select which project to export first.');
      return;
    }
    try {
      setGenerating(true);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await exportUserData(allData, options, settings.branding);
      setLastResult(result);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (result.fileUris.length === 1) {
        await shareExportedFile(result.fileUris[0], 'MAGE ID Data Export');
      } else {
        Alert.alert(
          'Export ready',
          `${summarizeExport(result)}\n\nTap a file below to share it.`,
        );
      }
    } catch (err) {
      console.error('[DataExport] failed', err);
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setGenerating(false);
    }
  }, [allData, options, scope, projectId]);

  const handleShareOne = useCallback(async (uri: string) => {
    try {
      await shareExportedFile(uri, 'MAGE ID Data Export');
    } catch (err) {
      console.error('[DataExport] share failed', err);
    }
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}><FolderDown size={24} color={themeColors.accent} strokeWidth={1.75} /></View>
          <Text style={styles.heroTitle}>Export my data</Text>
          <Text style={styles.heroSub}>
            Bundle every project, invoice, RFI, photo, and daily report into a portable file you own.
            Hand it to your accountant, your lawyer, or a competing tool — no lock-in.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>SCOPE</Text>
        <View style={styles.segment}>
          <TouchableOpacity
            style={[styles.segmentBtn, scope === 'all' && styles.segmentBtnActive]}
            onPress={() => { setScope('all'); setProjectId(undefined); }}
            activeOpacity={0.8}
          >
            <Package size={14} color={scope === 'all' ? '#FFFFFF' : themeColors.text} strokeWidth={1.75} />
            <Text style={[styles.segmentTxt, scope === 'all' && styles.segmentTxtActive]}>All projects</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, scope === 'project' && styles.segmentBtnActive]}
            onPress={() => setScope('project')}
            activeOpacity={0.8}
          >
            <CheckCircle2 size={14} color={scope === 'project' ? '#FFFFFF' : themeColors.text} strokeWidth={1.75} />
            <Text style={[styles.segmentTxt, scope === 'project' && styles.segmentTxtActive]}>Single project</Text>
          </TouchableOpacity>
        </View>

        {scope === 'project' && (
          <View style={styles.projectList}>
            {projects.length === 0 ? (
              <Text style={styles.emptyTxt}>No projects yet — switch to &quot;All projects&quot; to export reference data only.</Text>
            ) : (
              projects.map(p => {
                const active = p.id === projectId;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.projectRow, active && styles.projectRowActive]}
                    onPress={() => setProjectId(p.id)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.projectRowName, active && styles.projectRowNameActive]}>{p.name}</Text>
                      <Text style={styles.projectRowMeta}>{p.type} · {p.location}</Text>
                    </View>
                    {active && <CheckCircle2 size={18} color={themeColors.accent} strokeWidth={1.75} />}
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        <Text style={styles.sectionLabel}>FORMAT</Text>
        <View style={styles.segment}>
          <TouchableOpacity
            style={[styles.segmentBtn, format === 'json' && styles.segmentBtnActive]}
            onPress={() => setFormat('json')}
            activeOpacity={0.8}
          >
            <FileJson size={14} color={format === 'json' ? '#FFFFFF' : themeColors.text} strokeWidth={1.75} />
            <Text style={[styles.segmentTxt, format === 'json' && styles.segmentTxtActive]}>JSON</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, format === 'csv' && styles.segmentBtnActive]}
            onPress={() => setFormat('csv')}
            activeOpacity={0.8}
          >
            <FileSpreadsheet size={14} color={format === 'csv' ? '#FFFFFF' : themeColors.text} strokeWidth={1.75} />
            <Text style={[styles.segmentTxt, format === 'csv' && styles.segmentTxtActive]}>CSV</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, format === 'both' && styles.segmentBtnActive]}
            onPress={() => setFormat('both')}
            activeOpacity={0.8}
          >
            <Download size={14} color={format === 'both' ? '#FFFFFF' : themeColors.text} strokeWidth={1.75} />
            <Text style={[styles.segmentTxt, format === 'both' && styles.segmentTxtActive]}>Both</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hintCard}>
          <Info size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
          <Text style={styles.hintTxt}>
            JSON is a single complete bundle (lossless). CSV is one file per entity, great for Excel and Google Sheets.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>OPTIONS</Text>
        <View style={styles.row}>
          <View style={styles.rowIcon}><ImageIcon size={16} color={themeColors.accent} strokeWidth={1.75} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Include photo URLs</Text>
            <Text style={styles.rowSub}>Turn off if local file:// paths bloat the export.</Text>
          </View>
          <Switch
            value={includePhotoUrls}
            onValueChange={setIncludePhotoUrls}
            trackColor={{ false: themeColors.line, true: themeColors.accent }}
            thumbColor={themeColors.surface}
          />
        </View>

        {/* Closeout PDF toggle — only valid when scope is single-project,
            since the packet is per-project. We disable + dim if scope is
            "all" so the user understands why it's unavailable. */}
        <View style={[styles.row, scope !== 'project' && { opacity: 0.5 }]}>
          <View style={styles.rowIcon}><FileJson size={16} color={themeColors.accent} strokeWidth={1.75} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Closeout PDF (handoff packet)</Text>
            <Text style={styles.rowSub}>
              {scope === 'project'
                ? 'Includes contract, COs, payments, warranties, finishes, punch list. ~5s to render.'
                : 'Pick a single project above to enable this option.'}
            </Text>
          </View>
          <Switch
            value={includeCloseoutPacket && scope === 'project'}
            onValueChange={setIncludeCloseoutPacket}
            disabled={scope !== 'project'}
            trackColor={{ false: themeColors.line, true: themeColors.accent }}
            thumbColor={themeColors.surface}
          />
        </View>

        <View style={styles.row}>
          <View style={styles.rowIcon}><Info size={16} color={themeColors.accent} strokeWidth={1.75} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>README.txt orientation file</Text>
            <Text style={styles.rowSub}>Plain-text file describing what each export piece is — useful for non-technical recipients.</Text>
          </View>
          <Switch
            value={includeReadme}
            onValueChange={setIncludeReadme}
            trackColor={{ false: themeColors.line, true: themeColors.accent }}
            thumbColor={themeColors.surface}
          />
        </View>

        {/* "Full archive" preset — flips every relevant switch for the
            handoff use case in one tap. */}
        <TouchableOpacity
          onPress={applyArchivePreset}
          activeOpacity={0.85}
          style={styles.presetBtn}
        >
          <Package size={14} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.presetText}>Use &quot;Full project archive&quot; preset</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>WHAT'S INCLUDED</Text>
        <View style={styles.summaryCard}>
          <SummaryLine label="Projects" value={totals.projects} />
          <SummaryLine label="Invoices" value={totals.invoices} />
          <SummaryLine label="Change Orders" value={totals.changeOrders} />
          <SummaryLine label="Daily Reports" value={totals.dailyReports} />
          <SummaryLine label="Punch Items" value={totals.punchItems} />
          <SummaryLine label="RFIs" value={totals.rfis} />
          <SummaryLine label="Submittals" value={totals.submittals} />
          <SummaryLine label="Photos" value={totals.photos} />
          <SummaryLine label="Contacts" value={totals.contacts} last />
        </View>

        {lastResult && (
          <>
            <Text style={styles.sectionLabel}>LAST EXPORT</Text>
            <View style={styles.resultCard}>
              <Text style={styles.resultHeader}>{summarizeExport(lastResult)}</Text>
              {lastResult.fileUris.map((uri) => {
                const name = uri.split('/').pop() ?? uri;
                return (
                  <TouchableOpacity
                    key={uri}
                    style={styles.fileRow}
                    onPress={() => handleShareOne(uri)}
                    activeOpacity={0.7}
                  >
                    {uri.endsWith('.csv')
                      ? <FileSpreadsheet size={16} color={themeColors.accent} strokeWidth={1.75} />
                      : <FileJson size={16} color={themeColors.accent} strokeWidth={1.75} />}
                    <Text style={styles.fileName} numberOfLines={1}>{name}</Text>
                    <Share2 size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, generating && styles.primaryBtnDisabled]}
          onPress={handleGenerate}
          disabled={generating}
          activeOpacity={0.85}
        >
          {generating ? (
            <ActivityIndicator color={'#FFFFFF'} />
          ) : (
            <>
              <Download size={18} color={'#FFFFFF'} strokeWidth={1.75} />
              <Text style={styles.primaryBtnTxt}>Generate & share</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SummaryLine({ label, value, last }: { label: string; value: number; last?: boolean }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.summaryRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value.toLocaleString()}</Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  scroll: { padding: 16, gap: 0 },
  hero: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 20,
    borderWidth: 1,
    borderColor: t.line,
    marginBottom: 20,
    gap: 10,
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: Tokens.radius.card,
    backgroundColor: `${t.accent}15`,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '700', color: t.text },
  heroSub: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, lineHeight: 20 },

  sectionLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary,
    letterSpacing: 0.8, marginBottom: 8, marginTop: 20,
  },

  segment: {
    flexDirection: 'row', backgroundColor: t.surface,
    borderRadius: Tokens.radius.card, padding: 4, borderWidth: 1, borderColor: t.line,
    gap: 4,
  },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: Tokens.radius.sm, gap: 6,
  },
  segmentBtnActive: { backgroundColor: t.accent },
  segmentTxt: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  segmentTxtActive: { color: '#FFFFFF' },

  projectList: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
    marginTop: 8, overflow: 'hidden',
  },
  projectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  projectRowActive: { backgroundColor: `${t.accent}08` },
  projectRowName: { fontSize: Type.subhead.fontSize, fontWeight: '600', color: t.text },
  projectRowNameActive: { color: t.accent },
  projectRowMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2 },
  emptyTxt: { fontSize: Type.footnote.fontSize, color: t.textSecondary, padding: 14, textAlign: 'center' },

  hintCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: `${t.accent}08`, padding: 12,
    borderRadius: Tokens.radius.md, marginTop: 8,
  },
  hintTxt: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    padding: 14, borderWidth: 1, borderColor: t.line,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    backgroundColor: `${t.accent}12`,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },
  rowSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2 },

  summaryCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  summaryLabel: { fontSize: Type.bodyCompact.fontSize, color: t.text },
  summaryValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },

  resultCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
    padding: 14, gap: 10,
  },
  resultHeader: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text, marginBottom: 4 },
  fileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: t.bg, borderRadius: Tokens.radius.sm,
  },
  fileName: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },

  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: t.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accent, paddingVertical: 16, borderRadius: Tokens.radius.card,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnTxt: { color: '#FFFFFF', fontWeight: '700', fontSize: Type.subhead.fontSize },

  presetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 11, paddingHorizontal: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '12',
    borderWidth: 1, borderColor: t.accent + '30',
    alignSelf: 'flex-start',
    marginVertical: 6,
  },
  presetText: { fontSize: Type.footnote.fontSize, color: t.accent, fontWeight: '700' },
});
