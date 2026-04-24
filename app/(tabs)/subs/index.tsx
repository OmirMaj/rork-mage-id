import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal,
  Alert, Platform, ScrollView, KeyboardAvoidingView, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, Search, X, Phone, Mail, MapPin, Shield, FileText,
  AlertTriangle, CheckCircle, Clock, Trash2, Users, ShieldCheck, ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import AISubEvaluator from '@/components/AISubEvaluator';
import type { Subcontractor, SubTrade, ComplianceStatus } from '@/types';
import { SUB_TRADES } from '@/types';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getComplianceStatus(sub: Subcontractor): ComplianceStatus {
  const now = new Date();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const licExpiry = sub.licenseExpiry ? new Date(sub.licenseExpiry) : null;
  const coiExpiry = sub.coiExpiry ? new Date(sub.coiExpiry) : null;

  if ((licExpiry && licExpiry < now) || (coiExpiry && coiExpiry < now)) return 'expired';
  if ((licExpiry && licExpiry.getTime() - now.getTime() < thirtyDays) ||
      (coiExpiry && coiExpiry.getTime() - now.getTime() < thirtyDays)) return 'expiring_soon';
  return 'compliant';
}

function getStatusColor(status: ComplianceStatus): string {
  if (status === 'compliant') return Colors.success;
  if (status === 'expiring_soon') return Colors.warning;
  return Colors.error;
}

function getStatusLabel(status: ComplianceStatus): string {
  if (status === 'compliant') return 'Compliant';
  if (status === 'expiring_soon') return 'Expiring Soon';
  return 'Expired';
}

export default function SubsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subcontractors, addSubcontractor, updateSubcontractor, deleteSubcontractor, projects, prequalPackets } = useProjects();
  const { tier } = useSubscription();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTrade, setFilterTrade] = useState<SubTrade | 'All'>('All');
  const [showForm, setShowForm] = useState(false);
  const [editingSub, setEditingSub] = useState<Subcontractor | null>(null);
  const [showDetail, setShowDetail] = useState<Subcontractor | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [trade, setTrade] = useState<SubTrade>('General');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [coiExpiry, setCoiExpiry] = useState('');
  const [w9OnFile, setW9OnFile] = useState(false);
  const [notes, setNotes] = useState('');

  const resetForm = useCallback(() => {
    setCompanyName(''); setContactName(''); setPhone(''); setEmail('');
    setAddress(''); setTrade('General'); setLicenseNumber('');
    setLicenseExpiry(''); setCoiExpiry(''); setW9OnFile(false); setNotes('');
    setEditingSub(null);
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setShowForm(true);
  }, [resetForm]);

  const openEdit = useCallback((sub: Subcontractor) => {
    setEditingSub(sub);
    setCompanyName(sub.companyName);
    setContactName(sub.contactName);
    setPhone(sub.phone);
    setEmail(sub.email);
    setAddress(sub.address);
    setTrade(sub.trade);
    setLicenseNumber(sub.licenseNumber);
    setLicenseExpiry(sub.licenseExpiry);
    setCoiExpiry(sub.coiExpiry);
    setW9OnFile(sub.w9OnFile);
    setNotes(sub.notes);
    setShowForm(true);
    setShowDetail(null);
  }, []);

  const handleSave = useCallback(() => {
    const name = companyName.trim();
    if (!name) {
      Alert.alert('Missing Name', 'Please enter the company name.');
      return;
    }

    if (editingSub) {
      updateSubcontractor(editingSub.id, {
        companyName: name, contactName: contactName.trim(), phone: phone.trim(),
        email: email.trim(), address: address.trim(), trade, licenseNumber: licenseNumber.trim(),
        licenseExpiry, coiExpiry, w9OnFile, notes: notes.trim(),
      });
      Alert.alert('Updated', `${name} has been updated.`);
    } else {
      const sub: Subcontractor = {
        id: createId('sub'), companyName: name, contactName: contactName.trim(),
        phone: phone.trim(), email: email.trim(), address: address.trim(), trade,
        licenseNumber: licenseNumber.trim(), licenseExpiry, coiExpiry, w9OnFile,
        bidHistory: [], assignedProjects: [], notes: notes.trim(),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      addSubcontractor(sub);
      Alert.alert('Added', `${name} has been added.`);
    }

    setShowForm(false);
    resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [companyName, contactName, phone, email, address, trade, licenseNumber, licenseExpiry, coiExpiry, w9OnFile, notes, editingSub, addSubcontractor, updateSubcontractor, resetForm]);

  const handleDelete = useCallback((sub: Subcontractor) => {
    Alert.alert('Delete Subcontractor', `Delete ${sub.companyName}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          deleteSubcontractor(sub.id);
          setShowDetail(null);
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  }, [deleteSubcontractor]);

  const filtered = useMemo(() => {
    let result = subcontractors;
    if (filterTrade !== 'All') result = result.filter(s => s.trade === filterTrade);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        s.companyName.toLowerCase().includes(q) ||
        s.contactName.toLowerCase().includes(q) ||
        s.trade.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [subcontractors, filterTrade, searchQuery]);

  const stats = useMemo(() => {
    const compliant = subcontractors.filter(s => getComplianceStatus(s) === 'compliant').length;
    const expiring = subcontractors.filter(s => getComplianceStatus(s) === 'expiring_soon').length;
    const expired = subcontractors.filter(s => getComplianceStatus(s) === 'expired').length;
    return { compliant, expiring, expired, total: subcontractors.length };
  }, [subcontractors]);

  // Prequal compliance summary for the banner. We surface this above the
  // legacy COI/license stats so the user notices the Pro-tier feature
  // without it feeling like an upsell — it's a real CTA that gets OSHA
  // controlling-employer coverage in one tap.
  const prequalSummary = useMemo(() => {
    const approved = prequalPackets.filter(p => p.status === 'approved').length;
    const pending = prequalPackets.filter(p => p.status === 'submitted' || p.status === 'in_progress' || p.status === 'invited').length;
    const issues = prequalPackets.filter(p => p.status === 'rejected' || p.status === 'needs_changes' || p.status === 'expired').length;
    return { approved, pending, issues, total: prequalPackets.length };
  }, [prequalPackets]);

  const renderSub = useCallback(({ item }: { item: Subcontractor }) => {
    const status = getComplianceStatus(item);
    const statusColor = getStatusColor(status);
    return (
      <TouchableOpacity
        style={styles.subCard}
        onPress={() => setShowDetail(item)}
        activeOpacity={0.7}
        testID={`sub-${item.id}`}
      >
        <View style={styles.subCardTop}>
          <View style={[styles.tradeIcon, { backgroundColor: statusColor + '15' }]}>
            <Users size={16} color={statusColor} />
          </View>
          <View style={styles.subCardInfo}>
            <Text style={styles.subName}>{item.companyName}</Text>
            <Text style={styles.subContact}>{item.contactName} · {item.trade}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '15' }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{getStatusLabel(status)}</Text>
          </View>
        </View>
        {item.phone || item.email ? (
          <View style={styles.subCardMeta}>
            {item.phone ? (
              <View style={styles.metaItem}>
                <Phone size={11} color={Colors.textMuted} />
                <Text style={styles.metaText}>{item.phone}</Text>
              </View>
            ) : null}
            {item.email ? (
              <View style={styles.metaItem}>
                <Mail size={11} color={Colors.textMuted} />
                <Text style={styles.metaText} numberOfLines={1}>{item.email}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </TouchableOpacity>
    );
  }, []);

  return (
    <View style={styles.container}>
      <FlatList
        data={filtered}
        renderItem={renderSub}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 110 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <Text style={styles.largeTitle}>Subs</Text>
              <TouchableOpacity style={styles.addBtn} onPress={openCreate} activeOpacity={0.7} testID="add-sub">
                <Plus size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.prequalBanner}
              onPress={() => router.push('/prequal-manager' as never)}
              activeOpacity={0.8}
              testID="open-prequal-manager"
            >
              <View style={styles.prequalIcon}>
                <ShieldCheck size={18} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.prequalTitle}>Prequal + COI tracking</Text>
                <Text style={styles.prequalSub}>
                  {prequalSummary.total === 0
                    ? 'Invite subs to complete prequalification via magic link'
                    : `${prequalSummary.approved} approved · ${prequalSummary.pending} pending${prequalSummary.issues > 0 ? ` · ${prequalSummary.issues} issue${prequalSummary.issues === 1 ? '' : 's'}` : ''}`}
                </Text>
              </View>
              <ChevronRight size={16} color={Colors.textMuted} />
            </TouchableOpacity>

            {stats.total > 0 && (
              <View style={styles.statsRow}>
                <View style={[styles.statCard, { borderLeftColor: Colors.success }]}>
                  <Text style={[styles.statNum, { color: Colors.success }]}>{stats.compliant}</Text>
                  <Text style={styles.statLabel}>Compliant</Text>
                </View>
                <View style={[styles.statCard, { borderLeftColor: Colors.warning }]}>
                  <Text style={[styles.statNum, { color: Colors.warning }]}>{stats.expiring}</Text>
                  <Text style={styles.statLabel}>Expiring</Text>
                </View>
                <View style={[styles.statCard, { borderLeftColor: Colors.error }]}>
                  <Text style={[styles.statNum, { color: Colors.error }]}>{stats.expired}</Text>
                  <Text style={styles.statLabel}>Expired</Text>
                </View>
              </View>
            )}

            <View style={styles.searchWrap}>
              <View style={styles.searchBar}>
                <Search size={15} color={Colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search subcontractors..."
                  placeholderTextColor={Colors.textMuted}
                  testID="subs-search"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <View style={styles.clearBtn}><X size={10} color={Colors.textMuted} /></View>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              <TouchableOpacity
                style={[styles.filterChip, filterTrade === 'All' && styles.filterChipActive]}
                onPress={() => setFilterTrade('All')}
              >
                <Text style={[styles.filterChipText, filterTrade === 'All' && styles.filterChipTextActive]}>All ({stats.total})</Text>
              </TouchableOpacity>
              {SUB_TRADES.map(t => {
                const count = subcontractors.filter(s => s.trade === t).length;
                if (count === 0) return null;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.filterChip, filterTrade === t && styles.filterChipActive]}
                    onPress={() => setFilterTrade(t)}
                  >
                    <Text style={[styles.filterChipText, filterTrade === t && styles.filterChipTextActive]}>{t} ({count})</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Users size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>{searchQuery ? 'No Results' : 'No Subcontractors'}</Text>
            <Text style={styles.emptyDesc}>
              {searchQuery ? 'Try a different search.' : 'Add your first subcontractor to start tracking compliance.'}
            </Text>
            {!searchQuery && (
              <TouchableOpacity style={styles.emptyBtn} onPress={openCreate} activeOpacity={0.7}>
                <Plus size={16} color="#fff" />
                <Text style={styles.emptyBtnText}>Add Subcontractor</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>{editingSub ? 'Edit Subcontractor' : 'Add Subcontractor'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }}>
                    <X size={20} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Company Name *</Text>
                <TextInput style={styles.input} value={companyName} onChangeText={setCompanyName} placeholder="Company name" placeholderTextColor={Colors.textMuted} testID="sub-company-input" />

                <Text style={styles.fieldLabel}>Contact Name</Text>
                <TextInput style={styles.input} value={contactName} onChangeText={setContactName} placeholder="Primary contact" placeholderTextColor={Colors.textMuted} />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Phone</Text>
                    <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="(555) 123-4567" placeholderTextColor={Colors.textMuted} keyboardType="phone-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Email</Text>
                    <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="email@co.com" placeholderTextColor={Colors.textMuted} keyboardType="email-address" autoCapitalize="none" />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Address</Text>
                <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Street, City, State" placeholderTextColor={Colors.textMuted} />

                <Text style={styles.fieldLabel}>Trade Specialty</Text>
                <View style={styles.tradeGrid}>
                  {SUB_TRADES.map(t => (
                    <TouchableOpacity key={t} style={[styles.tradeChip, trade === t && styles.tradeChipActive]} onPress={() => setTrade(t)}>
                      <Text style={[styles.tradeChipText, trade === t && styles.tradeChipTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.sectionDivider}>COMPLIANCE</Text>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>License #</Text>
                    <TextInput style={styles.input} value={licenseNumber} onChangeText={setLicenseNumber} placeholder="GC-12345" placeholderTextColor={Colors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>License Expiry</Text>
                    <TextInput style={styles.input} value={licenseExpiry} onChangeText={setLicenseExpiry} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>COI Expiry</Text>
                    <TextInput style={styles.input} value={coiExpiry} onChangeText={setCoiExpiry} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} />
                  </View>
                  <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                    <Text style={styles.fieldLabel}>W-9 On File</Text>
                    <View style={styles.switchRow}>
                      <Text style={styles.switchLabel}>{w9OnFile ? 'Yes' : 'No'}</Text>
                      <Switch value={w9OnFile} onValueChange={setW9OnFile} trackColor={{ false: Colors.border, true: Colors.primary }} thumbColor={Colors.surface} />
                    </View>
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Notes</Text>
                <TextInput style={[styles.input, { minHeight: 70, paddingTop: 12, textAlignVertical: 'top' as const }]} value={notes} onChangeText={setNotes} placeholder="Additional notes..." placeholderTextColor={Colors.textMuted} multiline />

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-sub">
                    <Text style={styles.saveBtnText}>{editingSub ? 'Update' : 'Add Subcontractor'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showDetail !== null} transparent animationType="slide" onRequestClose={() => setShowDetail(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.detailCard, { paddingBottom: insets.bottom + 20 }]}>
            {showDetail && (() => {
              const sub = showDetail;
              const status = getComplianceStatus(sub);
              const statusColor = getStatusColor(status);
              return (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={styles.formHeader}>
                    <Text style={styles.formTitle}>{sub.companyName}</Text>
                    <TouchableOpacity onPress={() => setShowDetail(null)}>
                      <X size={20} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.detailStatusBar, { backgroundColor: statusColor + '12', borderLeftColor: statusColor }]}>
                    {status === 'compliant' ? <CheckCircle size={16} color={statusColor} /> : status === 'expiring_soon' ? <Clock size={16} color={statusColor} /> : <AlertTriangle size={16} color={statusColor} />}
                    <Text style={[styles.detailStatusText, { color: statusColor }]}>{getStatusLabel(status)}</Text>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>CONTACT</Text>
                    {sub.contactName ? <View style={styles.detailRow}><Users size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>{sub.contactName}</Text></View> : null}
                    {sub.phone ? <View style={styles.detailRow}><Phone size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>{sub.phone}</Text></View> : null}
                    {sub.email ? <View style={styles.detailRow}><Mail size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>{sub.email}</Text></View> : null}
                    {sub.address ? <View style={styles.detailRow}><MapPin size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>{sub.address}</Text></View> : null}
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>COMPLIANCE</Text>
                    <View style={styles.detailRow}><Shield size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>License: {sub.licenseNumber || 'Not set'}</Text></View>
                    <View style={styles.detailRow}><FileText size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>License Expiry: {sub.licenseExpiry || 'Not set'}</Text></View>
                    <View style={styles.detailRow}><FileText size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>COI Expiry: {sub.coiExpiry || 'Not set'}</Text></View>
                    <View style={styles.detailRow}><CheckCircle size={14} color={sub.w9OnFile ? Colors.success : Colors.textMuted} /><Text style={styles.detailRowText}>W-9: {sub.w9OnFile ? 'On File' : 'Missing'}</Text></View>
                  </View>

                  {sub.bidHistory.length > 0 && (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionTitle}>BID HISTORY</Text>
                      {sub.bidHistory.map(bid => (
                        <View key={bid.id} style={styles.bidRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.bidProject}>{bid.projectName}</Text>
                            <Text style={styles.bidDate}>{new Date(bid.date).toLocaleDateString()}</Text>
                          </View>
                          <Text style={styles.bidAmount}>${bid.bidAmount.toLocaleString()}</Text>
                          <View style={[styles.bidOutcome, { backgroundColor: bid.outcome === 'won' ? Colors.successLight : bid.outcome === 'lost' ? Colors.errorLight : Colors.warningLight }]}>
                            <Text style={[styles.bidOutcomeText, { color: bid.outcome === 'won' ? Colors.success : bid.outcome === 'lost' ? Colors.error : Colors.warning }]}>
                              {bid.outcome.charAt(0).toUpperCase() + bid.outcome.slice(1)}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {sub.notes ? (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionTitle}>NOTES</Text>
                      <Text style={styles.detailNotes}>{sub.notes}</Text>
                    </View>
                  ) : null}

                  <AISubEvaluator
                    sub={sub}
                    projectContext={`Active projects: ${projects.length}. Trades needed: ${[...new Set(projects.flatMap(p => p.schedule?.tasks?.map(t => t.crew) ?? []).filter(Boolean))].join(', ') || 'Various'}`}
                    subscriptionTier={tier as any}
                  />

                  <View style={styles.detailActions}>
                    <TouchableOpacity style={styles.editDetailBtn} onPress={() => openEdit(sub)} activeOpacity={0.7}>
                      <Text style={styles.editDetailBtnText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteDetailBtn} onPress={() => handleDelete(sub)} activeOpacity={0.7}>
                      <Trash2 size={16} color={Colors.error} />
                      <Text style={styles.deleteDetailBtnText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 4, marginBottom: 16 },
  largeTitle: { fontSize: 34, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.5 },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  prequalBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  prequalIcon: {
    width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: `${Colors.primary}15`,
  },
  prequalTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  prequalSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderLeftWidth: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statNum: { fontSize: 24, fontWeight: '800' as const },
  statLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, marginTop: 2 },
  searchWrap: { paddingHorizontal: 16, marginBottom: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.fillTertiary, borderRadius: 12, paddingHorizontal: 12, gap: 8, height: 40 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },
  clearBtn: { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  filterRow: { paddingHorizontal: 16, gap: 6, marginBottom: 16 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.fillTertiary },
  filterChipActive: { backgroundColor: Colors.primary },
  filterChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: '#fff' },
  subCard: { marginHorizontal: 16, marginBottom: 8, backgroundColor: Colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder, gap: 10 },
  subCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tradeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  subCardInfo: { flex: 1, gap: 2 },
  subName: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  subContact: { fontSize: 13, color: Colors.textSecondary },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  subCardMeta: { flexDirection: 'row', gap: 16, paddingLeft: 52 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: Colors.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 22 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  emptyBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  formCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8, maxHeight: '90%' },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 4 },
  input: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 15, color: Colors.text },
  tradeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tradeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  tradeChipActive: { backgroundColor: Colors.primary },
  tradeChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  tradeChipTextActive: { color: '#fff' },
  sectionDivider: { fontSize: 11, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5, marginTop: 12, marginBottom: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 14, backgroundColor: Colors.surfaceAlt, borderRadius: 12 },
  switchLabel: { fontSize: 15, color: Colors.text },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#fff' },
  detailCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, maxHeight: '85%' },
  detailStatusBar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, borderLeftWidth: 3, marginBottom: 16 },
  detailStatusText: { fontSize: 14, fontWeight: '700' as const },
  detailSection: { marginBottom: 20, gap: 8 },
  detailSectionTitle: { fontSize: 11, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailRowText: { fontSize: 15, color: Colors.text },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  bidProject: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  bidDate: { fontSize: 12, color: Colors.textMuted },
  bidAmount: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  bidOutcome: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  bidOutcomeText: { fontSize: 10, fontWeight: '700' as const },
  detailNotes: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  editDetailBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  editDetailBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#fff' },
  deleteDetailBtn: { flexDirection: 'row', minHeight: 48, paddingHorizontal: 20, borderRadius: 14, backgroundColor: Colors.errorLight, alignItems: 'center', justifyContent: 'center', gap: 6 },
  deleteDetailBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.error },
});
