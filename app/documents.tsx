import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  FileText, PenTool,
  AlertCircle, Check, X as XIcon,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { DOCUMENT_TYPE_INFO } from '@/mocks/documents';
import type { ProjectDocument, DocumentStatus } from '@/types';
import { useProjects } from '@/contexts/ProjectContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const STATUS_CONFIG: Record<DocumentStatus, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  draft: { label: 'Draft', color: '#546E7A', bgColor: '#ECEFF1', icon: FileText },
  pending_signature: { label: 'Awaiting Signature', color: Colors.warningDark, bgColor: Colors.warningLight, icon: PenTool },
  signed: { label: 'Signed', color: Colors.successDark, bgColor: Colors.successLight, icon: Check },
  expired: { label: 'Expired', color: Colors.errorDark, bgColor: Colors.errorLight, icon: AlertCircle },
  void: { label: 'Void', color: '#9E9E9E', bgColor: '#F5F5F5', icon: XIcon },
};

function DocumentCard({ doc, onPress }: { doc: ProjectDocument; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const typeInfo = DOCUMENT_TYPE_INFO[doc.type] ?? DOCUMENT_TYPE_INFO.other;
  const statusInfo = STATUS_CONFIG[doc.status];
  const StatusIcon = statusInfo.icon;

  const isExpiringSoon = doc.expiresAt && doc.status === 'signed' &&
    new Date(doc.expiresAt).getTime() - Date.now() < 30 * 86400000 &&
    new Date(doc.expiresAt).getTime() > Date.now();

  return (
    <Animated.View style={[styles.docCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.docCardInner}
      >
        <View style={[styles.docTypeTag, { backgroundColor: typeInfo.bgColor }]}>
          <Text style={[styles.docTypeTagText, { color: typeInfo.color }]}>{typeInfo.label}</Text>
        </View>

        <Text style={styles.docTitle} numberOfLines={2}>{doc.title}</Text>
        <Text style={styles.docProject}>{doc.projectName}</Text>

        {isExpiringSoon && (
          <View style={styles.expiryWarning}>
            <AlertCircle size={12} color={Colors.warningDark} strokeWidth={1.75} />
            <Text style={styles.expiryWarningText}>
              Expires {new Date(doc.expiresAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
          </View>
        )}

        <View style={styles.docFooter}>
          <View style={[styles.docStatusBadge, { backgroundColor: statusInfo.bgColor }]}>
            <StatusIcon size={10} color={statusInfo.color} />
            <Text style={[styles.docStatusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
          <Text style={styles.docDate}>
            {new Date(doc.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function DocumentsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Real aggregator. Pre-audit (May 2026) this screen rendered MOCK_DOCUMENTS
  // and had no CRUD. Audit cleanup recommendation was to either build a
  // unified document model OR turn this into a read-only view that pulls
  // from the existing tables (COIs, permits, submittals, AIA pay apps).
  // We took option B — every document type listed here exists elsewhere
  // in the app with its own write path, so duplicating the schema would
  // just create drift. This screen is now a single dashboard that links
  // OUT to each document's home screen.
  const {
    projects, cois, permits, submittals, aiaPayApps, subcontractors,
  } = useProjects();
  const [selectedFilter, setSelectedFilter] = useState<string>('all');

  const documents = useMemo<ProjectDocument[]>(() => {
    const projectById = new Map(projects.map(p => [p.id, p.name]));
    // Subcontractor display name = companyName (DBA), with legalName as a
    // fallback for entries that haven't filled DBA in yet.
    const subById = new Map(subcontractors.map(s => [s.id, s.companyName || s.legalName || s.contactName]));
    const out: ProjectDocument[] = [];

    // COIs — one per sub. Status derives from the validation result and
    // the earliest expiration in the coverages array. Empty validation
    // means "uploaded but not yet validated."
    for (const c of cois) {
      const earliestExpiration = (c.coverages ?? [])
        .map(cov => cov.expiresAt)
        .filter((d): d is string => !!d)
        .sort()[0];
      const expired = earliestExpiration && new Date(earliestExpiration).getTime() < Date.now();
      let status: DocumentStatus = 'pending_signature';
      if (expired) status = 'expired';
      else if (c.validation?.overallStatus === 'pass') status = 'signed';
      else if (c.uploadedAt) status = 'draft';
      // Resolve the sub's name from the subcontractors collection — pre-fix
      // we showed the first 8 chars of the UUID (e.g. "COI · 9f2c1aab"),
      // which the GC could not visually reconcile with their roster. Fall
      // back to "Subcontractor" only when the COI is somehow orphaned.
      const subLabel = c.subcontractorId
        ? (subById.get(c.subcontractorId) ?? 'Subcontractor')
        : 'Subcontractor';
      out.push({
        id: 'coi-' + c.id,
        projectId: c.projectId ?? 'unassigned',
        projectName: projectById.get(c.projectId ?? '') ?? 'Sub COI',
        type: 'coi',
        title: `COI · ${subLabel}`,
        status,
        createdAt: c.uploadedAt ?? new Date().toISOString(),
        expiresAt: earliestExpiration,
        signedAt: c.uploadedAt,
      });
    }

    // Permits — `expiresDate` is the actual field (not `expirationDate`).
    // Status mapping reflects the PermitStatus union values.
    for (const p of permits) {
      const expired = p.expiresDate && new Date(p.expiresDate).getTime() < Date.now();
      const status: DocumentStatus = expired ? 'expired'
        : p.status === 'approved' ? 'signed'
        : p.status === 'inspection_passed' ? 'signed'
        : p.status === 'denied' ? 'void'
        : p.status === 'expired' ? 'expired'
        : 'pending_signature';
      out.push({
        id: 'permit-' + p.id,
        projectId: p.projectId,
        projectName: projectById.get(p.projectId) ?? p.projectName ?? 'Project',
        type: 'permit',
        title: `Permit · ${p.type ?? p.permitNumber ?? 'Building Permit'}`,
        status,
        createdAt: p.appliedDate ?? new Date().toISOString(),
        expiresAt: p.expiresDate,
        notes: p.permitNumber ? `# ${p.permitNumber}` : undefined,
      });
    }

    // Submittals
    for (const s of submittals) {
      const status: DocumentStatus = s.currentStatus === 'approved' ? 'signed'
        : s.currentStatus === 'rejected' ? 'void'
        : s.currentStatus === 'pending' ? 'draft'
        : 'pending_signature';
      out.push({
        id: 'submittal-' + s.id,
        projectId: s.projectId,
        projectName: projectById.get(s.projectId) ?? 'Project',
        type: 'other',
        title: `Submittal #${s.number} · ${s.title}`,
        status,
        createdAt: s.submittedDate ?? s.createdAt ?? new Date().toISOString(),
        notes: s.specSection ? `Spec ${s.specSection}` : undefined,
      });
    }

    // AIA pay apps — count as billing documents
    for (const a of aiaPayApps) {
      out.push({
        id: 'aia-' + a.id,
        projectId: a.projectId,
        projectName: projectById.get(a.projectId) ?? a.projectName,
        type: 'aia_billing',
        title: `AIA G702 · App #${a.applicationNumber}`,
        status: 'signed',
        createdAt: a.applicationDate ?? a.savedAt ?? new Date().toISOString(),
        notes: a.payLinkUrl ? 'Pay link active' : undefined,
      });
    }

    // Newest first
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [projects, cois, permits, submittals, aiaPayApps, subcontractors]);

  const handleDocPress = useCallback((doc: ProjectDocument) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // Route to the document's home screen so the user can see / edit /
    // sign there. The aggregator screen stays read-only. COI vault and
    // permits are global lists (no id needed); AIA + submittal screens are
    // keyed by id, so we thread the underlying entity's params through —
    // routing param-less landed the user on a blank screen (dead-end).
    if (doc.type === 'coi') router.push('/coi-vault' as never);
    else if (doc.type === 'permit') router.push('/permits' as never);
    else if (doc.type === 'aia_billing') {
      // aia-pay-app is invoice-keyed. Resolve the pay app's invoiceId;
      // fall back to the project so an unlinked pay app still goes somewhere.
      const payApp = aiaPayApps.find((a) => 'aia-' + a.id === doc.id);
      if (payApp?.invoiceId) router.push(`/aia-pay-app?invoiceId=${payApp.invoiceId}` as never);
      else router.push(`/project-detail?id=${doc.projectId}` as never);
    } else if (doc.id.startsWith('submittal-')) {
      const submittalId = doc.id.slice('submittal-'.length);
      router.push(`/submittal?projectId=${doc.projectId}&submittalId=${submittalId}` as never);
    } else router.push(`/project-detail?id=${doc.projectId}` as never);
  }, [router, aiaPayApps]);

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'pending_signature', label: 'Awaiting' },
    { id: 'draft', label: 'Drafts' },
    { id: 'signed', label: 'Signed' },
    { id: 'expired', label: 'Expired' },
  ];

  const filtered = useMemo(() => {
    if (selectedFilter === 'all') return documents;
    return documents.filter(d => d.status === selectedFilter);
  }, [documents, selectedFilter]);

  const stats = useMemo(() => ({
    total: documents.length,
    pending: documents.filter(d => d.status === 'pending_signature').length,
    signed: documents.filter(d => d.status === 'signed').length,
    expired: documents.filter(d => d.status === 'expired').length,
    expiringSoon: documents.filter(d => {
      if (!d.expiresAt || d.status !== 'signed') return false;
      const diff = new Date(d.expiresAt).getTime() - Date.now();
      return diff > 0 && diff < 30 * 86400000;
    }).length,
  }), [documents]);

  // The original Edit / Resend / status-detail handler was removed when
  // this screen converted from MOCK to a read-only aggregator. Tapping a
  // doc card now routes the user to the document's home screen
  // (see `handleDocPress` defined above).

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Documents', headerStyle: { backgroundColor: themeColors.bg }, headerTintColor: themeColors.accent, headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text } }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        {/* Centered icon-circle hero — same look as Construction AI,
            AI Punch, Reports. Replaces the small explainer note that
            used to live at the top so the screen has the same visual
            anchor as the rest of the app. */}
        <View style={styles.docsHero}>
          <View style={styles.docsHeroIcon}>
            <FileText size={26} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={styles.docsHeroTitle}>Documents</Text>
          <Text style={styles.docsHeroSub}>
            Every contract, COI, permit, submittal, and pay-app across your projects — in one feed. Tap any card to open it where it lives.
          </Text>
        </View>
        <View style={styles.alertsRow}>
          {stats.pending > 0 && (
            <View style={[styles.alertCard, { backgroundColor: Colors.warningLight, borderColor: '#FFE0B2' }]}>
              <PenTool size={16} color={Colors.warningDark} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.alertTitle, { color: Colors.warningDark }]}>{stats.pending} Awaiting Signature</Text>
                <Text style={styles.alertDesc}>Documents need attention</Text>
              </View>
            </View>
          )}
          {stats.expiringSoon > 0 && (
            <View style={[styles.alertCard, { backgroundColor: Colors.errorLight, borderColor: '#FFCDD2' }]}>
              <AlertCircle size={16} color={Colors.errorDark} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.alertTitle, { color: Colors.errorDark }]}>{stats.expiringSoon} Expiring Soon</Text>
                <Text style={styles.alertDesc}>COIs expiring within 30 days</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: Colors.warningDark }]}>{stats.pending}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: Colors.successDark }]}>{stats.signed}</Text>
            <Text style={styles.statLabel}>Signed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: Colors.errorDark }]}>{stats.expired}</Text>
            <Text style={styles.statLabel}>Expired</Text>
          </View>
        </View>

        {/* "Create Document" CTA removed when this screen converted to a
            read-only aggregator. Each document type has its own home
            screen with its own create flow (coi-vault, permits, etc.). */}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {filters.map(f => (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterChip, selectedFilter === f.id && styles.filterChipActive]}
              onPress={() => {
                setSelectedFilter(f.id);
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, selectedFilter === f.id && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.listSection}>
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <FileText size={32} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyTitle}>No documents found</Text>
            </View>
          ) : (
            filtered.map(doc => (
              <DocumentCard key={doc.id} doc={doc} onPress={() => handleDocPress(doc)} />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  docsHero: { alignItems: 'center' as const, gap: 6, marginTop: 12, marginBottom: 18, paddingHorizontal: 16 },
  docsHeroIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: t.accent + '14',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 6,
  },
  docsHeroTitle: { fontSize: 24, fontWeight: '700' as const, color: t.text, letterSpacing: -0.3 },
  docsHeroSub: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, textAlign: 'center' as const, lineHeight: 20, paddingHorizontal: 8 },
  alertsRow: { paddingHorizontal: 16, paddingTop: 16, gap: 8 },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
  },
  alertTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const },
  alertDesc: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 1 },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    paddingTop: 16,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.line,
  },
  statValue: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  statLabel: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2 },
  createButton: {
    marginHorizontal: 16,
    backgroundColor: t.accent,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  createButtonText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: '#fff' },
  filterRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 16 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
  },
  filterChipActive: { backgroundColor: t.accent, borderColor: t.accent },
  filterChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  filterChipTextActive: { color: '#fff' },
  listSection: { paddingHorizontal: 16 },
  docCard: {
    marginBottom: 10,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  docCardInner: { padding: 14, gap: 6 },
  docTypeTag: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.xs },
  docTypeTagText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const },
  docTitle: { fontSize: Type.callout.fontSize, fontWeight: '600' as const, color: t.text },
  docProject: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  expiryWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.warningLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    alignSelf: 'flex-start',
  },
  expiryWarningText: { fontSize: Type.caption1.fontSize, fontWeight: '500' as const, color: Colors.warningDark },
  docFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  docStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.xs,
  },
  docStatusText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const },
  docDate: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '600' as const, color: t.text },
});
