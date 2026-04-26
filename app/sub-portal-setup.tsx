import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, TextInput,
  Alert, Platform, Share, Clipboard,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Copy, Send, Link, Check, X, RefreshCw, Lock,
  HardHat, Building2, FileText, Inbox,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { SubPortalLink } from '@/types';
import { generateUUID } from '@/utils/generateId';
import { useSubSubmittedInvoices } from '@/hooks/useSubSubmittedInvoices';
import {
  buildSubPortalSnapshot, buildSubPortalUrl,
} from '@/utils/subPortalSnapshot';
import { formatMoney } from '@/utils/formatters';

const SUB_PORTAL_BASE_URL = 'https://mageid.app/sub-portal';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://nteoqhcswappxxjlpvap.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50ZW9xaGNzd2FwcHh4amxwdmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTU0MDMsImV4cCI6MjA4OTg5MTQwM30.xpz7yWhignppH-3dYD-EV4AvB4cugr7-881GKdOFado';

export default function SubPortalSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { projectId, subId } = useLocalSearchParams<{ projectId: string; subId: string }>();

  const {
    getProject, subcontractors, settings,
    getCommitmentsForProject,
    getSubPortalLinkFor, upsertSubPortalLink,
  } = useProjects();

  const project = useMemo(() => projectId ? getProject(projectId) : undefined, [projectId, getProject]);
  const sub = useMemo(() => subcontractors.find(s => s.id === subId), [subcontractors, subId]);
  const commitments = useMemo(() => projectId ? getCommitmentsForProject(projectId).filter(c => c.subcontractorId === subId) : [], [projectId, subId, getCommitmentsForProject]);

  const existing = useMemo(() =>
    projectId && subId ? getSubPortalLinkFor(projectId, subId) : undefined,
    [projectId, subId, getSubPortalLinkFor],
  );

  const [link, setLink] = useState<SubPortalLink>(() => {
    if (existing) return existing;
    return {
      id: `sub-portal-${(projectId ?? '').slice(0, 6)}-${(subId ?? '').slice(0, 6)}-${Date.now().toString(36)}`,
      projectId: projectId ?? '',
      subcontractorId: subId ?? '',
      enabled: true,
      requirePasscode: false,
      welcomeMessage: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  const submitted = useSubSubmittedInvoices({ subPortalId: link.id });

  const snapshot = useMemo(() => {
    if (!project || !sub) return null;
    return buildSubPortalSnapshot({
      link,
      project,
      sub,
      settings,
      commitments,
      submittedInvoices: submitted.invoices,
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      contactEmail: settings?.branding?.email,
      contactName: settings?.branding?.contactName ?? settings?.branding?.companyName,
    });
  }, [link, project, sub, settings, commitments, submitted.invoices]);

  const portalUrl = useMemo(() => {
    if (!snapshot) return `${SUB_PORTAL_BASE_URL}/${link.id}`;
    return buildSubPortalUrl(SUB_PORTAL_BASE_URL, link.id, snapshot);
  }, [snapshot, link.id]);

  const persist = useCallback((updates: Partial<SubPortalLink>) => {
    const next = { ...link, ...updates, updatedAt: new Date().toISOString() };
    setLink(next);
    upsertSubPortalLink(next);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [link, upsertSubPortalLink]);

  const handleCopy = useCallback(async () => {
    try {
      Clipboard.setString(portalUrl);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Copied', 'The sub portal link has been copied.');
    } catch {
      Alert.alert('Copy failed', 'Could not copy the link.');
    }
  }, [portalUrl]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message: `Hi ${sub?.contactName || sub?.companyName || ''}, here's your sub portal for ${project?.name ?? 'the project'}:\n\n${portalUrl}\n\nYou can review your scope and submit invoices from this page — no login needed.`,
        url: portalUrl,
        title: `Sub portal — ${project?.name ?? 'Project'}`,
      });
      persist({ lastSharedAt: new Date().toISOString() });
    } catch {
      // user cancelled — ignore
    }
  }, [portalUrl, sub, project, persist]);

  const handleApprove = useCallback((id: string) => {
    submitted.approve(id);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [submitted]);

  const handleReject = useCallback((id: string) => {
    submitted.reject(id, 'Rejected — please check the details and resubmit.');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [submitted]);

  const handleMarkPaid = useCallback((id: string) => {
    submitted.markPaid(id);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [submitted]);

  if (!project || !sub) {
    return (
      <View style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Sub Portal' }} />
        <Text style={styles.loadingText}>Project or sub not found.</Text>
      </View>
    );
  }

  const totalCommitment = commitments.reduce((s, c) => s + c.amount + (c.changeAmount ?? 0), 0);
  const pendingTotal = submitted.pending.reduce((s, i) => s + i.amount, 0);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Sub Portal',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }}>
              <ChevronLeft size={24} color={Colors.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <HardHat size={22} color={Colors.primary} />
          </View>
          <Text style={styles.heroEyebrow}>Sub portal</Text>
          <Text style={styles.heroTitle}>{sub.companyName}</Text>
          <Text style={styles.heroMeta}>
            {sub.trade}{sub.contactName ? ` · ${sub.contactName}` : ''}
          </Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Commitment value</Text>
              <Text style={styles.heroStatValue}>{formatMoney(totalCommitment)}</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Pending review</Text>
              <Text style={[styles.heroStatValue, submitted.pending.length > 0 && { color: Colors.primary }]}>
                {submitted.pending.length} · {formatMoney(pendingTotal)}
              </Text>
            </View>
          </View>
        </View>

        {/* Share */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Share with {sub.contactName?.split(' ')[0] || 'sub'}</Text>
          <Text style={styles.sectionSubtitle}>
            One link to review their scope, submit invoices, and track payment — no account needed.
          </Text>
          <View style={styles.linkBox}>
            <Link size={14} color={Colors.textMuted} />
            <Text style={styles.linkText} numberOfLines={1}>{portalUrl}</Text>
          </View>
          <View style={styles.shareRow}>
            <TouchableOpacity style={styles.shareBtn} onPress={handleCopy} activeOpacity={0.85}>
              <Copy size={16} color={Colors.text} />
              <Text style={styles.shareBtnText}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.shareBtn, styles.shareBtnPrimary]} onPress={handleShare} activeOpacity={0.85}>
              <Send size={16} color="#FFF" />
              <Text style={[styles.shareBtnText, { color: '#FFF' }]}>Send link</Text>
            </TouchableOpacity>
          </View>
          {link.lastSharedAt && (
            <Text style={styles.lastShared}>
              Last shared {new Date(link.lastSharedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </Text>
          )}
        </View>

        {/* Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <View style={styles.togglesCard}>
            <View style={[styles.toggleRow, styles.toggleRowBorder]}>
              <View style={styles.toggleLeft}>
                <RefreshCw size={18} color={Colors.primary} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>Portal enabled</Text>
                  <Text style={styles.toggleDesc}>Disable to revoke the link</Text>
                </View>
              </View>
              <Switch
                value={link.enabled}
                onValueChange={val => persist({ enabled: val })}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#FFF"
              />
            </View>
            <View style={[styles.toggleRow, link.requirePasscode && styles.toggleRowBorder]}>
              <View style={styles.toggleLeft}>
                <Lock size={18} color={Colors.primary} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>Require passcode</Text>
                  <Text style={styles.toggleDesc}>4-digit code shared separately</Text>
                </View>
              </View>
              <Switch
                value={!!link.requirePasscode}
                onValueChange={val => persist({ requirePasscode: val, passcode: val ? (link.passcode || String(Math.floor(1000 + Math.random() * 9000))) : undefined })}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#FFF"
              />
            </View>
            {link.requirePasscode && (
              <View style={styles.passcodeRow}>
                <Text style={styles.passcodeLabel}>Passcode</Text>
                <TextInput
                  style={styles.passcodeInput}
                  value={link.passcode ?? ''}
                  onChangeText={val => persist({ passcode: val.replace(/[^0-9]/g, '').slice(0, 4) })}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>
            )}
          </View>
        </View>

        {/* Commitments */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scope shared on portal</Text>
          {commitments.length === 0 ? (
            <View style={styles.emptyCard}>
              <Building2 size={28} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No commitments for this sub yet.</Text>
              <Text style={styles.emptySub}>Add a commitment to scope what they&apos;re billing against.</Text>
            </View>
          ) : (
            <View style={styles.cardList}>
              {commitments.map(c => {
                const total = c.amount + (c.changeAmount ?? 0);
                return (
                  <View key={c.id} style={styles.commitCard}>
                    <View style={styles.commitHead}>
                      <View style={styles.commitNumPill}>
                        <Text style={styles.commitNumText}>#{c.number}</Text>
                      </View>
                      <Text style={styles.commitDesc} numberOfLines={2}>{c.description}</Text>
                    </View>
                    <View style={styles.commitFoot}>
                      <Text style={styles.commitAmount}>{formatMoney(total)}</Text>
                      <Text style={styles.commitStatus}>{c.status}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Submitted invoices */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Invoices from {sub.companyName}</Text>
            {submitted.pending.length > 0 && (
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>{submitted.pending.length} new</Text>
              </View>
            )}
          </View>
          {submitted.invoices.length === 0 ? (
            <View style={styles.emptyCard}>
              <Inbox size={28} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No invoices submitted yet.</Text>
              <Text style={styles.emptySub}>You&apos;ll see them here as soon as they&apos;re sent through the portal.</Text>
            </View>
          ) : (
            <View style={styles.cardList}>
              {submitted.invoices.map(inv => {
                const statusColor = inv.status === 'paid' ? Colors.success
                  : inv.status === 'approved' ? Colors.primary
                  : inv.status === 'rejected' ? Colors.error
                  : Colors.warning;
                return (
                  <View key={inv.id} style={styles.invoiceCard}>
                    <View style={styles.invoiceHead}>
                      <View>
                        <Text style={styles.invoiceNum}>Invoice #{inv.invoiceNumber}</Text>
                        <Text style={styles.invoiceMeta}>
                          {new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {inv.submittedByName ? ` · ${inv.submittedByName}` : ''}
                        </Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: statusColor + '20' }]}>
                        <Text style={[styles.statusPillText, { color: statusColor }]}>{inv.status}</Text>
                      </View>
                    </View>
                    <Text style={styles.invoiceAmount}>{formatMoney(inv.amount)}</Text>
                    {inv.retentionAmount != null && inv.retentionAmount > 0 && (
                      <Text style={styles.invoiceRet}>
                        Retainage held: {formatMoney(inv.retentionAmount)}
                      </Text>
                    )}
                    {inv.description && (
                      <Text style={styles.invoiceDesc} numberOfLines={3}>{inv.description}</Text>
                    )}
                    {inv.lineItems && inv.lineItems.length > 0 && (
                      <View style={styles.invoiceLines}>
                        {inv.lineItems.slice(0, 5).map((li, idx) => (
                          <View key={idx} style={styles.invoiceLine}>
                            <Text style={styles.invoiceLineDesc} numberOfLines={1}>{li.description}</Text>
                            <Text style={styles.invoiceLineAmt}>{formatMoney(li.amount)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {inv.status === 'submitted' && (
                      <View style={styles.invoiceCtas}>
                        <TouchableOpacity
                          style={styles.invCtaReject}
                          onPress={() => handleReject(inv.id)}
                          disabled={submitted.isResponding}
                        >
                          <X size={14} color={Colors.text} />
                          <Text style={styles.invCtaText}>Reject</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.invCtaApprove}
                          onPress={() => handleApprove(inv.id)}
                          disabled={submitted.isResponding}
                        >
                          <Check size={14} color="#FFF" />
                          <Text style={[styles.invCtaText, { color: '#FFF' }]}>Approve</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {inv.status === 'approved' && (
                      <View style={styles.invoiceCtas}>
                        <TouchableOpacity
                          style={styles.invCtaApprove}
                          onPress={() => handleMarkPaid(inv.id)}
                          disabled={submitted.isResponding}
                        >
                          <Check size={14} color="#FFF" />
                          <Text style={[styles.invCtaText, { color: '#FFF' }]}>Mark paid</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {inv.notesFromGc && (
                      <Text style={styles.invoiceNotes}>Note: {inv.notesFromGc}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  loadingText: { color: Colors.textMuted, fontSize: 14 },

  hero: {
    margin: 16, padding: 18, borderRadius: 16,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1, borderColor: Colors.primary + '20',
  },
  heroIconWrap: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroEyebrow: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
    color: Colors.primary, textTransform: 'uppercase', marginBottom: 4,
  },
  heroTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  heroMeta: { fontSize: 13, color: Colors.textMuted },
  heroStats: { flexDirection: 'row', gap: 12, marginTop: 14 },
  heroStat: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  heroStatLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 },
  heroStatValue: { fontSize: 17, fontWeight: '800', color: Colors.text },

  section: { marginHorizontal: 16, marginBottom: 22 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  sectionSubtitle: { fontSize: 13, color: Colors.textMuted, marginTop: 2, marginBottom: 12, lineHeight: 18 },

  linkBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.card, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: 10,
  },
  linkText: { flex: 1, fontSize: 12, color: Colors.text },
  shareRow: { flexDirection: 'row', gap: 8 },
  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  shareBtnPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  shareBtnText: { fontSize: 14, fontWeight: '700', color: Colors.text },
  lastShared: { fontSize: 11, color: Colors.textMuted, marginTop: 8 },

  togglesCard: {
    backgroundColor: Colors.card, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  toggleRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  toggleLabels: { flex: 1 },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },
  toggleDesc: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  passcodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  passcodeLabel: { fontSize: 13, color: Colors.text, fontWeight: '600' },
  passcodeInput: {
    backgroundColor: Colors.background, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 18, fontWeight: '700', letterSpacing: 4,
    minWidth: 100, textAlign: 'center',
    color: Colors.text,
  },

  cardList: { gap: 10 },
  commitCard: {
    padding: 14, borderRadius: 12,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  commitHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  commitNumPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: Colors.primary + '15' },
  commitNumText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  commitDesc: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.text, lineHeight: 19 },
  commitFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commitAmount: { fontSize: 16, fontWeight: '800', color: Colors.text },
  commitStatus: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },

  emptyCard: {
    alignItems: 'center', padding: 26,
    backgroundColor: Colors.card, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
    gap: 6,
  },
  emptyText: { fontSize: 14, fontWeight: '600', color: Colors.text },
  emptySub: { fontSize: 12, color: Colors.textMuted, textAlign: 'center', lineHeight: 17 },

  pendingBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: Colors.primary + '15' },
  pendingBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.primary },

  invoiceCard: {
    padding: 14, borderRadius: 12,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  invoiceHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  invoiceNum: { fontSize: 14, fontWeight: '700', color: Colors.text },
  invoiceMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  invoiceAmount: { fontSize: 22, fontWeight: '800', color: Colors.text, marginVertical: 4 },
  invoiceRet: { fontSize: 12, color: Colors.textMuted, marginBottom: 4 },
  invoiceDesc: { fontSize: 13, color: Colors.text, lineHeight: 18, marginVertical: 6 },
  invoiceLines: { marginTop: 8, gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  invoiceLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  invoiceLineDesc: { flex: 1, fontSize: 12, color: Colors.textMuted },
  invoiceLineAmt: { fontSize: 12, fontWeight: '700', color: Colors.text },

  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusPillText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },

  invoiceCtas: { flexDirection: 'row', gap: 8, marginTop: 12 },
  invCtaApprove: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  invCtaReject: {
    paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 10,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  invCtaText: { fontSize: 13, fontWeight: '700', color: Colors.text },
  invoiceNotes: { marginTop: 10, fontSize: 12, color: Colors.textMuted, fontStyle: 'italic', lineHeight: 17 },
});
