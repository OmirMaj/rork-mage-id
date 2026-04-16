import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  Platform, Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  FileText, PenTool, ShieldCheck, FileSignature, Plus,
  AlertCircle, Check, Clock, X as XIcon, Eye,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { MOCK_DOCUMENTS, DOCUMENT_TYPE_INFO } from '@/mocks/documents';
import type { ProjectDocument, DocumentStatus } from '@/types';

const STATUS_CONFIG: Record<DocumentStatus, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  draft: { label: 'Draft', color: '#546E7A', bgColor: '#ECEFF1', icon: FileText },
  pending_signature: { label: 'Awaiting Signature', color: '#E65100', bgColor: '#FFF3E0', icon: PenTool },
  signed: { label: 'Signed', color: '#2E7D32', bgColor: '#E8F5E9', icon: Check },
  expired: { label: 'Expired', color: '#C62828', bgColor: '#FFEBEE', icon: AlertCircle },
  void: { label: 'Void', color: '#9E9E9E', bgColor: '#F5F5F5', icon: XIcon },
};

function DocumentCard({ doc, onPress }: { doc: ProjectDocument; onPress: () => void }) {
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
            <AlertCircle size={12} color="#E65100" />
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
  const insets = useSafeAreaInsets();
  const [documents] = useState<ProjectDocument[]>(MOCK_DOCUMENTS);
  const [selectedFilter, setSelectedFilter] = useState<string>('all');

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

  const handleDocPress = useCallback((doc: ProjectDocument) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (doc.status === 'draft') {
      Alert.alert(doc.title, 'Open document editor to complete and send for signature?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Edit Draft', onPress: () => console.log('[Documents] Edit draft:', doc.id) },
      ]);
    } else if (doc.status === 'pending_signature') {
      Alert.alert(doc.title, 'This document is waiting for signature. You can resend the signing request.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Resend', onPress: () => {
          Alert.alert('Sent', 'Signing request has been resent.');
        }},
      ]);
    } else {
      Alert.alert(doc.title, `Status: ${STATUS_CONFIG[doc.status].label}\n${doc.signedBy ? `Signed by: ${doc.signedBy}` : ''}`);
    }
  }, []);

  const handleCreateDocument = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Create Document',
      'What type of document would you like to create?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Lien Waiver', onPress: () => console.log('[Documents] Create lien waiver') },
        { text: 'Proposal', onPress: () => console.log('[Documents] Create proposal') },
        { text: 'Contract', onPress: () => console.log('[Documents] Create contract') },
      ]
    );
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Documents', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        <View style={styles.alertsRow}>
          {stats.pending > 0 && (
            <View style={[styles.alertCard, { backgroundColor: '#FFF3E0', borderColor: '#FFE0B2' }]}>
              <PenTool size={16} color="#E65100" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.alertTitle, { color: '#E65100' }]}>{stats.pending} Awaiting Signature</Text>
                <Text style={styles.alertDesc}>Documents need attention</Text>
              </View>
            </View>
          )}
          {stats.expiringSoon > 0 && (
            <View style={[styles.alertCard, { backgroundColor: '#FFEBEE', borderColor: '#FFCDD2' }]}>
              <AlertCircle size={16} color="#C62828" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.alertTitle, { color: '#C62828' }]}>{stats.expiringSoon} Expiring Soon</Text>
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
            <Text style={[styles.statValue, { color: '#E65100' }]}>{stats.pending}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: '#2E7D32' }]}>{stats.signed}</Text>
            <Text style={styles.statLabel}>Signed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: '#C62828' }]}>{stats.expired}</Text>
            <Text style={styles.statLabel}>Expired</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.createButton} onPress={handleCreateDocument} activeOpacity={0.85}>
          <Plus size={18} color="#fff" />
          <Text style={styles.createButtonText}>Create Document</Text>
        </TouchableOpacity>

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
              <FileText size={32} color={Colors.textMuted} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  alertsRow: { paddingHorizontal: 16, paddingTop: 16, gap: 8 },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  alertTitle: { fontSize: 14, fontWeight: '600' as const },
  alertDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    paddingTop: 16,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  statValue: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  createButton: {
    marginHorizontal: 16,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  createButtonText: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
  filterRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 16 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: '#fff' },
  listSection: { paddingHorizontal: 16 },
  docCard: {
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  docCardInner: { padding: 14, gap: 6 },
  docTypeTag: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  docTypeTagText: { fontSize: 11, fontWeight: '600' as const },
  docTitle: { fontSize: 16, fontWeight: '600' as const, color: Colors.text },
  docProject: { fontSize: 13, color: Colors.textSecondary },
  expiryWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  expiryWarningText: { fontSize: 12, fontWeight: '500' as const, color: '#E65100' },
  docFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  docStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  docStatusText: { fontSize: 11, fontWeight: '600' as const },
  docDate: { fontSize: 12, color: Colors.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
});

