import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList,
  Alert, Platform, Modal, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Search, Plus, X, User, Mail, Phone, MapPin,
  ChevronRight, Trash2, Edit3, Briefcase,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import EmptyState from '@/components/EmptyState';
import type { Contact, ContactRole } from '@/types';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const CONTACT_ROLES: { value: ContactRole; label: string }[] = [
  { value: 'Client', label: 'Client' },
  { value: 'Architect', label: 'Architect' },
  { value: "Owner's Rep", label: "Owner's Rep" },
  { value: 'Engineer', label: 'Engineer' },
  { value: 'Sub', label: 'Subcontractor' },
  { value: 'Supplier', label: 'Supplier' },
  { value: 'Lender', label: 'Lender' },
  { value: 'Inspector', label: 'Inspector' },
  { value: 'Other', label: 'Other' },
];

function getRoleColor(role: ContactRole): string {
  switch (role) {
    case 'Client': return Colors.primary;
    case 'Architect': return Colors.info;
    case "Owner's Rep": return Colors.accent;
    case 'Engineer': return '#6B7280';
    case 'Sub': return Colors.success;
    case 'Supplier': return '#8B5CF6';
    case 'Lender': return '#EC4899';
    case 'Inspector': return '#F59E0B';
    default: return Colors.textSecondary;
  }
}

export default function ContactsScreen() {
  const insets = useSafeAreaInsets();
  const { navigateTo } = useEntityNavigation();
  const { contacts, addContact, updateContact, deleteContact, projects, getInvoicesForProject } = useProjects();

  const [query, setQuery] = useState('');
  const [filterRole, setFilterRole] = useState<ContactRole | 'all'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState<ContactRole>('Client');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const filteredContacts = useMemo(() => {
    let results = contacts;
    if (filterRole !== 'all') {
      results = results.filter(c => c.role === filterRole);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(c =>
        c.firstName.toLowerCase().includes(q) ||
        c.lastName.toLowerCase().includes(q) ||
        c.companyName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q)
      );
    }
    return results.sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [contacts, query, filterRole]);

  const resetForm = useCallback(() => {
    setFirstName('');
    setLastName('');
    setCompanyName('');
    setRole('Client');
    setEmail('');
    setPhone('');
    setAddress('');
    setNotes('');
    setEditingContact(null);
  }, []);

  const openAddModal = useCallback(() => {
    resetForm();
    setShowAddModal(true);
  }, [resetForm]);

  const openEditModal = useCallback((contact: Contact) => {
    setFirstName(contact.firstName);
    setLastName(contact.lastName);
    setCompanyName(contact.companyName);
    setRole(contact.role);
    setEmail(contact.email);
    setPhone(contact.phone);
    setAddress(contact.address);
    setNotes(contact.notes);
    setEditingContact(contact);
    setShowAddModal(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!firstName.trim() && !lastName.trim() && !companyName.trim()) {
      Alert.alert('Missing Info', 'Please enter at least a name or company.');
      return;
    }

    const now = new Date().toISOString();

    if (editingContact) {
      updateContact(editingContact.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        companyName: companyName.trim(),
        role,
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        notes: notes.trim(),
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowAddModal(false);
      resetForm();
    } else {
      const contact: Contact = {
        id: createId('con'),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        companyName: companyName.trim(),
        role,
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        notes: notes.trim(),
        linkedProjectIds: [],
        createdAt: now,
        updatedAt: now,
      };
      addContact(contact);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowAddModal(false);
      resetForm();
    }
  }, [firstName, lastName, companyName, role, email, phone, address, notes, editingContact, addContact, updateContact, resetForm]);

  const handleDelete = useCallback((contact: Contact) => {
    Alert.alert('Delete Contact', `Remove ${contact.firstName} ${contact.lastName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => {
          deleteContact(contact.id);
          setShowDetailModal(false);
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  }, [deleteContact]);

  const openDetail = useCallback((contact: Contact) => {
    setSelectedContact(contact);
    setShowDetailModal(true);
  }, []);

  const getContactFinancials = useCallback((contact: Contact) => {
    if (contact.role !== 'Client') return null;
    let totalInvoiced = 0;
    let totalPaid = 0;
    contact.linkedProjectIds.forEach(pid => {
      const invoices = getInvoicesForProject(pid);
      invoices.forEach(inv => {
        totalInvoiced += inv.totalDue;
        totalPaid += inv.amountPaid;
      });
    });
    return { totalInvoiced, totalPaid, outstanding: totalInvoiced - totalPaid };
  }, [getInvoicesForProject]);

  const renderContact = useCallback(({ item }: { item: Contact }) => {
    const roleColor = getRoleColor(item.role);
    const displayName = `${item.firstName} ${item.lastName}`.trim() || item.companyName;
    return (
      <TouchableOpacity
        style={styles.contactCard}
        onPress={() => openDetail(item)}
        activeOpacity={0.7}
        testID={`contact-${item.id}`}
      >
        <View style={[styles.avatar, { backgroundColor: roleColor + '18' }]}>
          <Text style={[styles.avatarText, { color: roleColor }]}>
            {(item.firstName[0] || item.companyName[0] || '?').toUpperCase()}
          </Text>
        </View>
        <View style={styles.contactInfo}>
          <Text style={styles.contactName} numberOfLines={1}>{displayName}</Text>
          {item.companyName && item.firstName ? (
            <Text style={styles.contactCompany} numberOfLines={1}>{item.companyName}</Text>
          ) : null}
          <View style={styles.contactMetaRow}>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + '15' }]}>
              <Text style={[styles.roleBadgeText, { color: roleColor }]}>{item.role}</Text>
            </View>
            {item.email ? (
              <Text style={styles.contactEmail} numberOfLines={1}>{item.email}</Text>
            ) : null}
          </View>
        </View>
        <ChevronRight size={16} color={Colors.textMuted} />
      </TouchableOpacity>
    );
  }, [openDetail]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Contacts',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        headerRight: () => (
          <TouchableOpacity onPress={openAddModal} style={styles.headerAddBtn}>
            <Plus size={20} color={Colors.primary} />
          </TouchableOpacity>
        ),
      }} />

      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Search size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search contacts..."
            placeholderTextColor={Colors.textMuted}
            testID="contacts-search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <X size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, filterRole === 'all' && styles.filterChipActive]}
            onPress={() => setFilterRole('all')}
          >
            <Text style={[styles.filterChipText, filterRole === 'all' && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {CONTACT_ROLES.map(r => (
            <TouchableOpacity
              key={r.value}
              style={[styles.filterChip, filterRole === r.value && styles.filterChipActive]}
              onPress={() => setFilterRole(r.value)}
            >
              <Text style={[styles.filterChipText, filterRole === r.value && styles.filterChipTextActive]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filteredContacts}
        keyExtractor={item => item.id}
        renderItem={renderContact}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={{ minHeight: 360 }}>
            <EmptyState
              icon={<User size={36} color={Colors.primary} />}
              title={query || filterRole !== 'all' ? 'No contacts match' : 'No contacts yet'}
              message={query || filterRole !== 'all'
                ? 'Try a different search term or clear the role filter to see everyone.'
                : 'Add your owners, architects, engineers, inspectors, and lenders here. Every RFI, daily report, and invoice can pull from this list automatically.'}
              actionLabel={!query && filterRole === 'all' ? 'Add first contact' : undefined}
              onAction={!query && filterRole === 'all' ? openAddModal : undefined}
            />
          </View>
        }
      />

      {/* Add/Edit Modal */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editingContact ? 'Edit Contact' : 'New Contact'}</Text>
                <TouchableOpacity onPress={() => { setShowAddModal(false); resetForm(); }}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>First Name</Text>
                    <TextInput style={styles.formInput} value={firstName} onChangeText={setFirstName} placeholder="John" placeholderTextColor={Colors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Last Name</Text>
                    <TextInput style={styles.formInput} value={lastName} onChangeText={setLastName} placeholder="Smith" placeholderTextColor={Colors.textMuted} />
                  </View>
                </View>

                <Text style={styles.formLabel}>Company</Text>
                <TextInput style={styles.formInput} value={companyName} onChangeText={setCompanyName} placeholder="Company name" placeholderTextColor={Colors.textMuted} />

                <Text style={styles.formLabel}>Role</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roleChipsRow}>
                  {CONTACT_ROLES.map(r => (
                    <TouchableOpacity
                      key={r.value}
                      style={[styles.roleChip, role === r.value && styles.roleChipActive]}
                      onPress={() => setRole(r.value)}
                    >
                      <Text style={[styles.roleChipText, role === r.value && styles.roleChipTextActive]}>{r.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.formLabel}>Email</Text>
                <TextInput style={styles.formInput} value={email} onChangeText={setEmail} placeholder="email@example.com" placeholderTextColor={Colors.textMuted} keyboardType="email-address" autoCapitalize="none" />

                <Text style={styles.formLabel}>Phone</Text>
                <TextInput style={styles.formInput} value={phone} onChangeText={setPhone} placeholder="(555) 123-4567" placeholderTextColor={Colors.textMuted} keyboardType="phone-pad" />

                <Text style={styles.formLabel}>Address</Text>
                <TextInput style={styles.formInput} value={address} onChangeText={setAddress} placeholder="123 Main St, City, State" placeholderTextColor={Colors.textMuted} />

                <Text style={styles.formLabel}>Notes</Text>
                <TextInput style={[styles.formInput, { minHeight: 70 }]} value={notes} onChangeText={setNotes} placeholder="Additional notes..." placeholderTextColor={Colors.textMuted} multiline textAlignVertical="top" />

                <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
                  <Text style={styles.saveBtnText}>{editingContact ? 'Save Changes' : 'Add Contact'}</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Detail Modal */}
      <Modal visible={showDetailModal} transparent animationType="slide" onRequestClose={() => setShowDetailModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16, maxHeight: '85%' }]}>
            {selectedContact && (() => {
              const displayName = `${selectedContact.firstName} ${selectedContact.lastName}`.trim() || selectedContact.companyName;
              const roleColor = getRoleColor(selectedContact.role);
              const financials = getContactFinancials(selectedContact);
              const linkedProjects = projects.filter(p => selectedContact.linkedProjectIds.includes(p.id));

              return (
                <>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{displayName}</Text>
                    <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                      <X size={20} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView showsVerticalScrollIndicator={false}>
                    <View style={[styles.detailRoleBadge, { backgroundColor: roleColor + '15' }]}>
                      <Briefcase size={14} color={roleColor} />
                      <Text style={[styles.detailRoleText, { color: roleColor }]}>{selectedContact.role}</Text>
                      {selectedContact.companyName && selectedContact.firstName ? (
                        <Text style={styles.detailCompany}> · {selectedContact.companyName}</Text>
                      ) : null}
                    </View>

                    <View style={styles.detailSection}>
                      {selectedContact.email ? (
                        <View style={styles.detailRow}>
                          <Mail size={14} color={Colors.textMuted} />
                          <Text style={styles.detailText}>{selectedContact.email}</Text>
                        </View>
                      ) : null}
                      {selectedContact.phone ? (
                        <View style={styles.detailRow}>
                          <Phone size={14} color={Colors.textMuted} />
                          <Text style={styles.detailText}>{selectedContact.phone}</Text>
                        </View>
                      ) : null}
                      {selectedContact.address ? (
                        <View style={styles.detailRow}>
                          <MapPin size={14} color={Colors.textMuted} />
                          <Text style={styles.detailText}>{selectedContact.address}</Text>
                        </View>
                      ) : null}
                    </View>

                    {financials && (
                      <View style={styles.financialCard}>
                        <Text style={styles.financialTitle}>Financial Summary</Text>
                        <View style={styles.financialRow}>
                          <Text style={styles.financialLabel}>Total Invoiced</Text>
                          <Text style={styles.financialValue}>${financials.totalInvoiced.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                        </View>
                        <View style={styles.financialRow}>
                          <Text style={styles.financialLabel}>Total Paid</Text>
                          <Text style={[styles.financialValue, { color: Colors.success }]}>${financials.totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                        </View>
                        <View style={styles.financialDivider} />
                        <View style={styles.financialRow}>
                          <Text style={styles.financialLabelBold}>Outstanding</Text>
                          <Text style={[styles.financialValueBold, { color: financials.outstanding > 0 ? Colors.error : Colors.success }]}>
                            ${financials.outstanding.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Text>
                        </View>
                      </View>
                    )}

                    {linkedProjects.length > 0 && (
                      <View style={styles.linkedSection}>
                        <Text style={styles.linkedTitle}>Linked Projects</Text>
                        {linkedProjects.map(p => (
                          <TouchableOpacity
                            key={p.id}
                            style={styles.linkedProjectRow}
                            onPress={() => {
                              navigateTo(
                                { kind: 'project', id: p.id, label: p.name },
                                { onBeforeNavigate: () => setShowDetailModal(false) },
                              );
                            }}
                          >
                            <Text style={styles.linkedProjectName}>{p.name}</Text>
                            <ChevronRight size={14} color={Colors.textMuted} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {selectedContact.notes ? (
                      <View style={styles.notesSection}>
                        <Text style={styles.notesTitle}>Notes</Text>
                        <Text style={styles.notesText}>{selectedContact.notes}</Text>
                      </View>
                    ) : null}

                    <View style={styles.detailActions}>
                      <TouchableOpacity
                        style={styles.editBtn}
                        onPress={() => {
                          setShowDetailModal(false);
                          setTimeout(() => openEditModal(selectedContact), 350);
                        }}
                      >
                        <Edit3 size={14} color={Colors.primary} />
                        <Text style={styles.editBtnText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        onPress={() => handleDelete(selectedContact)}
                      >
                        <Trash2 size={14} color={Colors.error} />
                        <Text style={styles.deleteBtnText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                </>
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
  headerAddBtn: { marginRight: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary + '12', alignItems: 'center', justifyContent: 'center' },
  searchSection: { backgroundColor: Colors.surface, paddingBottom: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.fillTertiary, borderRadius: 12, marginHorizontal: 16, paddingHorizontal: 12, gap: 8, height: 42 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },
  filterRow: { paddingHorizontal: 16, gap: 6, marginTop: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: Colors.fillTertiary },
  filterChipActive: { backgroundColor: Colors.primary },
  filterChipText: { fontSize: 12, fontWeight: '500' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.textOnPrimary, fontWeight: '600' as const },
  listContent: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  contactCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 12, borderWidth: 1, borderColor: Colors.cardBorder },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700' as const },
  contactInfo: { flex: 1, gap: 2 },
  contactName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  contactCompany: { fontSize: 12, color: Colors.textSecondary },
  contactMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  roleBadgeText: { fontSize: 10, fontWeight: '700' as const },
  contactEmail: { fontSize: 11, color: Colors.textMuted, flex: 1 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' as const },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  formRow: { flexDirection: 'row', gap: 10 },
  formLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 10, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  formInput: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: 15, color: Colors.text, borderWidth: 1, borderColor: Colors.cardBorder },
  roleChipsRow: { gap: 6, paddingVertical: 2 },
  roleChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  roleChipActive: { backgroundColor: Colors.primary },
  roleChipText: { fontSize: 13, fontWeight: '500' as const, color: Colors.textSecondary },
  roleChipTextActive: { color: Colors.textOnPrimary, fontWeight: '600' as const },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveBtnText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
  detailRoleBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, marginBottom: 12 },
  detailRoleText: { fontSize: 13, fontWeight: '700' as const },
  detailCompany: { fontSize: 12, color: Colors.textSecondary },
  detailSection: { gap: 10, marginBottom: 16 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailText: { fontSize: 14, color: Colors.text },
  financialCard: { backgroundColor: Colors.surfaceAlt, borderRadius: 14, padding: 14, gap: 8, marginBottom: 16 },
  financialTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 },
  financialRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  financialLabel: { fontSize: 14, color: Colors.textSecondary },
  financialValue: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  financialDivider: { height: 1, backgroundColor: Colors.borderLight },
  financialLabelBold: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  financialValueBold: { fontSize: 17, fontWeight: '800' as const },
  linkedSection: { marginBottom: 16 },
  linkedTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 8 },
  linkedProjectRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.surfaceAlt, borderRadius: 10, padding: 12, marginBottom: 4 },
  linkedProjectName: { fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  notesSection: { marginBottom: 16 },
  notesTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 },
  notesText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary + '12', borderRadius: 12, paddingVertical: 12 },
  editBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },
  deleteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.errorLight, borderRadius: 12, paddingVertical: 12 },
  deleteBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.error },
});
