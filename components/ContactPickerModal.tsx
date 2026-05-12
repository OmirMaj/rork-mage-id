import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  FlatList, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, X, User, Mail } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { Contact, ContactRole } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface ContactPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (contact: Contact) => void;
  contacts: Contact[];
  title?: string;
  filterRoles?: ContactRole[];
}

function getRoleColor(role: ContactRole): string {
  switch (role) {
    case 'Client': return '#FF6A1A';
    case 'Architect': return '#1565C0';
    case "Owner's Rep": return '#FF6A1A';
    case 'Engineer': return '#6B7280';
    case 'Sub': return '#2E7D44';
    case 'Supplier': return '#8B5CF6';
    case 'Lender': return '#EC4899';
    case 'Inspector': return '#F59E0B';
    default: return '#9AA3AD';
  }
}

export default function ContactPickerModal({
  visible,
  onClose,
  onSelect,
  contacts,
  title = 'Select Recipient',
  filterRoles,
}: ContactPickerModalProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = contacts;
    if (filterRoles && filterRoles.length > 0) {
      list = list.filter(c => filterRoles.includes(c.role));
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(c =>
        c.firstName.toLowerCase().includes(q) ||
        c.lastName.toLowerCase().includes(q) ||
        c.companyName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [contacts, query, filterRoles]);

  const handleSelect = useCallback((contact: Contact) => {
    onSelect(contact);
    setQuery('');
  }, [onSelect]);

  const handleClose = useCallback(() => {
    setQuery('');
    onClose();
  }, [onClose]);

  const renderItem = useCallback(({ item }: { item: Contact }) => {
    const roleColor = getRoleColor(item.role);
    const displayName = `${item.firstName} ${item.lastName}`.trim() || item.companyName;
    return (
      <TouchableOpacity
        style={styles.contactRow}
        onPress={() => handleSelect(item)}
        activeOpacity={0.7}
        testID={`pick-contact-${item.id}`}
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
          <View style={styles.contactMeta}>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + '15' }]}>
              <Text style={[styles.roleBadgeText, { color: roleColor }]}>{item.role}</Text>
            </View>
            {item.email ? (
              <View style={styles.emailRow}>
                <Mail size={10} color={themeColors.textMuted} />
                <Text style={styles.contactEmail} numberOfLines={1}>{item.email}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [handleSelect]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.overlayTouch} onPress={handleClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.headerTitle}>{title}</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={themeColors.textMuted} /></TouchableOpacity>
          </View>

          <View style={styles.searchBar}>
            <Search size={16} color={themeColors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search contacts..."
              placeholderTextColor={themeColors.textMuted}
              autoFocus={false}
              testID="contact-picker-search"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Close">
                <X size={14} color={themeColors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <User size={32} color={themeColors.textMuted} />
                <Text style={styles.emptyTitle}>
                  {query ? 'No contacts found' : 'No contacts yet'}
                </Text>
                <Text style={styles.emptyDesc}>
                  {query ? 'Try a different search term' : 'Add contacts from the Contacts screen'}
                </Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  overlayTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: t.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '75%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.surfaceAlt,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
  },
  headerTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.card,
    marginHorizontal: 22,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    gap: 8,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    color: t.text,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 12,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
  },
  contactInfo: {
    flex: 1,
    gap: 2,
  },
  contactName: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  contactCompany: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
  },
  contactMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  roleBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flex: 1,
  },
  contactEmail: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyTitle: {
    fontSize: Type.callout.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  emptyDesc: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    textAlign: 'center' as const,
  },
});
