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
import { useProjects } from '@/contexts/ProjectContext';
import {
  buildExportPayload, exportUserData, shareExportedFile, summarizeExport,
  type DataExportOptions, type DataExportSummary,
} from '@/utils/dataExport';

type Scope = 'all' | 'project';

export default function DataExportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const {
    projects, invoices, changeOrders, punchItems,
    projectPhotos, contacts, rfis, submittals, equipment, warranties,
    subcontractors, commEvents, getDailyReportsForProject,
  } = useProjects();

  const dailyReports = useMemo(
    () => projects.flatMap(p => getDailyReportsForProject(p.id)),
    [projects, getDailyReportsForProject],
  );

  const [scope, setScope] = useState<Scope>(params.projectId ? 'project' : 'all');
  const [projectId, setProjectId] = useState<string | undefined>(params.projectId);
  const [format, setFormat] = useState<'json' | 'csv' | 'both'>('both');
  const [includePhotoUrls, setIncludePhotoUrls] = useState<boolean>(true);
  const [generating, setGenerating] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<DataExportSummary | null>(null);

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
  }), [scope, projectId, format, includePhotoUrls]);

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
      const result = await exportUserData(allData, options);
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
          <View style={styles.heroIcon}><FolderDown size={24} color={Colors.primary} /></View>
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
            <Package size={14} color={scope === 'all' ? Colors.textOnPrimary : Colors.text} />
            <Text style={[styles.segmentTxt, scope === 'all' && styles.segmentTxtActive]}>All projects</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, scope === 'project' && styles.segmentBtnActive]}
            onPress={() => setScope('project')}
            activeOpacity={0.8}
          >
            <CheckCircle2 size={14} color={scope === 'project' ? Colors.textOnPrimary : Colors.text} />
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
                    {active && <CheckCircle2 size={18} color={Colors.primary} />}
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
            <FileJson size={14} color={format === 'json' ? Colors.textOnPrimary : Colors.text} />
            <Text style={[styles.segmentTxt, format === 'json' && styles.segmentTxtActive]}>JSON</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, format === 'csv' && styles.segmentBtnActive]}
            onPress={() => setFormat('csv')}
            activeOpacity={0.8}
          >
            <FileSpreadsheet size={14} color={format === 'csv' ? Colors.textOnPrimary : Colors.text} />
            <Text style={[styles.segmentTxt, format === 'csv' && styles.segmentTxtActive]}>CSV</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, format === 'both' && styles.segmentBtnActive]}
            onPress={() => setFormat('both')}
            activeOpacity={0.8}
          >
            <Download size={14} color={format === 'both' ? Colors.textOnPrimary : Colors.text} />
            <Text style={[styles.segmentTxt, format === 'both' && styles.segmentTxtActive]}>Both</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hintCard}>
          <Info size={14} color={Colors.textSecondary} />
          <Text style={styles.hintTxt}>
            JSON is a single complete bundle (lossless). CSV is one file per entity, great for Excel and Google Sheets.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>OPTIONS</Text>
        <View style={styles.row}>
          <View style={styles.rowIcon}><ImageIcon size={16} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Include photo URLs</Text>
            <Text style={styles.rowSub}>Turn off if local file:// paths bloat the export.</Text>
          </View>
          <Switch
            value={includePhotoUrls}
            onValueChange={setIncludePhotoUrls}
            trackColor={{ false: Colors.border, true: Colors.primary }}
            thumbColor={Colors.surface}
          />
        </View>

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
                      ? <FileSpreadsheet size={16} color={Colors.primary} />
                      : <FileJson size={16} color={Colors.primary} />}
                    <Text style={styles.fileName} numberOfLines={1}>{name}</Text>
                    <Share2 size={14} color={Colors.textSecondary} />
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
            <ActivityIndicator color={Colors.textOnPrimary} />
          ) : (
            <>
              <Download size={18} color={Colors.textOnPrimary} />
              <Text style={styles.primaryBtnTxt}>Generate & share</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SummaryLine({ label, value, last }: { label: string; value: number; last?: boolean }) {
  return (
    <View style={[styles.summaryRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value.toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 0 },
  hero: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginBottom: 20,
    gap: 10,
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: `${Colors.primary}15`,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },
  heroSub: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },

  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: Colors.textSecondary,
    letterSpacing: 0.8, marginBottom: 8, marginTop: 20,
  },

  segment: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderRadius: 12, padding: 4, borderWidth: 1, borderColor: Colors.cardBorder,
    gap: 4,
  },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 8, gap: 6,
  },
  segmentBtnActive: { backgroundColor: Colors.primary },
  segmentTxt: { fontSize: 13, fontWeight: '600', color: Colors.text },
  segmentTxtActive: { color: Colors.textOnPrimary },

  projectList: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder,
    marginTop: 8, overflow: 'hidden',
  },
  projectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight,
  },
  projectRowActive: { backgroundColor: `${Colors.primary}08` },
  projectRowName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  projectRowNameActive: { color: Colors.primary },
  projectRowMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  emptyTxt: { fontSize: 13, color: Colors.textSecondary, padding: 14, textAlign: 'center' },

  hintCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: `${Colors.primary}08`, padding: 12,
    borderRadius: 10, marginTop: 8,
  },
  hintTxt: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: `${Colors.primary}12`,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },
  rowSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  summaryCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight,
  },
  summaryLabel: { fontSize: 14, color: Colors.text },
  summaryValue: { fontSize: 14, fontWeight: '700', color: Colors.text },

  resultCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder,
    padding: 14, gap: 10,
  },
  resultHeader: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 4 },
  fileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: Colors.background, borderRadius: 8,
  },
  fileName: { flex: 1, fontSize: 12, color: Colors.text, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },

  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 12,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnTxt: { color: Colors.textOnPrimary, fontWeight: '700', fontSize: 15 },
});
