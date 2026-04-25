// ============================================================================
// components/UniversalSearch.tsx
//
// Modal wrapper around useUniversalSearch. One autofocused input, results
// grouped by entity kind, Cmd+K / Ctrl+K on web, ESC closes. Tapping any row
// hands the EntityRef to `useEntityNavigation().navigateTo`. Empty query
// shows the last 5 searches from AsyncStorage (tertiary_recent_searches).
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  Platform, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Search as SearchIcon, X, ChevronRight, Building2, CalendarDays, Camera,
  HelpCircle, ClipboardCheck, Receipt, Repeat, FileText, CheckSquare, Shield,
  UserRound, Wrench, Clock, HardHat, Briefcase, Layers, MessageSquare, Mail,
  MapPin, PenTool, ClipboardList, Bell,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSearch } from '@/contexts/SearchContext';
import { useUniversalSearch, type SearchResult } from '@/hooks/useUniversalSearch';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import type { EntityKind } from '@/types';

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const RECENT_KEY = 'tertiary_recent_searches';
const MAX_RECENT = 5;

// ---------------------------------------------------------------------------
// Kind display config
// ---------------------------------------------------------------------------

const KIND_ICON: Record<EntityKind, React.FC<{ size: number; color: string }>> = {
  project: Building2,
  task: CalendarDays,
  photo: Camera,
  rfi: HelpCircle,
  submittal: ClipboardCheck,
  changeOrder: Repeat,
  invoice: Receipt,
  payment: Receipt,
  dailyReport: FileText,
  punchItem: CheckSquare,
  warranty: Shield,
  contact: UserRound,
  document: FileText,
  permit: Shield,
  equipment: Wrench,
  subcontractor: HardHat,
  commitment: Briefcase,
  planSheet: Layers,
  commEvent: MessageSquare,
  portalMessage: Mail,
  drawingPin: MapPin,
  planMarkup: PenTool,
  prequalPacket: ClipboardList,
  priceAlert: Bell,
};

const KIND_LABEL: Record<EntityKind, string> = {
  project: 'Projects',
  task: 'Schedule Tasks',
  photo: 'Photos',
  rfi: 'RFIs',
  submittal: 'Submittals',
  changeOrder: 'Change Orders',
  invoice: 'Invoices',
  payment: 'Payments',
  dailyReport: 'Daily Reports',
  punchItem: 'Punch Items',
  warranty: 'Warranties',
  contact: 'Contacts',
  document: 'Documents',
  permit: 'Permits',
  equipment: 'Equipment',
  subcontractor: 'Subcontractors',
  commitment: 'Contracts & POs',
  planSheet: 'Plan Sheets',
  commEvent: 'Activity',
  portalMessage: 'Messages',
  drawingPin: 'Drawing Pins',
  planMarkup: 'Plan Markups',
  prequalPacket: 'Prequal Packets',
  priceAlert: 'Price Alerts',
};

const KIND_ORDER: EntityKind[] = [
  'project', 'task', 'rfi', 'submittal', 'changeOrder', 'invoice',
  'dailyReport', 'punchItem', 'photo', 'permit', 'subcontractor',
  'commitment', 'planSheet', 'drawingPin', 'planMarkup',
  'warranty', 'equipment', 'prequalPacket', 'priceAlert',
  'contact', 'commEvent', 'portalMessage', 'document', 'payment',
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UniversalSearch() {
  const { isOpen, closeSearch } = useSearch();
  const insets = useSafeAreaInsets();
  const { navigateTo } = useEntityNavigation();

  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<TextInput | null>(null);

  const { grouped, isSearching } = useUniversalSearch(query);

  // Load recents on first mount + every time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(RECENT_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setRecent(parsed.filter((s): s is string => typeof s === 'string'));
        }
      } catch (err) {
        console.log('[UniversalSearch] Failed to load recents:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Reset query when the modal is dismissed.
  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => setQuery(''), 200);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Autofocus once the modal mounts. Slight delay on native for presentation.
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => inputRef.current?.focus(), Platform.OS === 'ios' ? 350 : 50);
    return () => clearTimeout(t);
  }, [isOpen]);

  const persistRecent = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const next = [trimmed, ...recent.filter(r => r.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT);
    setRecent(next);
    try {
      await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch (err) {
      console.log('[UniversalSearch] Failed to persist recents:', err);
    }
  }, [recent]);

  const handleResultPress = useCallback((r: SearchResult) => {
    void persistRecent(query);
    closeSearch();
    // pageSheet dismiss on iOS needs the 350ms delay before router.push.
    setTimeout(() => navigateTo(r.ref), Platform.OS === 'ios' ? 350 : 0);
  }, [persistRecent, query, closeSearch, navigateTo]);

  const handleRecentPress = useCallback((q: string) => {
    setQuery(q);
  }, []);

  const clearRecents = useCallback(async () => {
    setRecent([]);
    try {
      await AsyncStorage.removeItem(RECENT_KEY);
    } catch (err) {
      console.log('[UniversalSearch] Failed to clear recents:', err);
    }
  }, []);

  // Total result count across all groups.
  const totalCount = useMemo(
    () => Object.values(grouped).reduce((acc, list) => acc + list.length, 0),
    [grouped],
  );

  // Web: Escape closes. Native: onRequestClose handles back.
  useEffect(() => {
    if (Platform.OS !== 'web' || !isOpen) return;
    if (typeof document === 'undefined') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, closeSearch]);

  const showEmptyPrompt = query.trim().length === 0;
  const showNoResults = !showEmptyPrompt && !isSearching && totalCount === 0;

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      transparent={Platform.OS !== 'ios'}
      onRequestClose={closeSearch}
    >
      <View style={[
        styles.container,
        Platform.OS !== 'ios' && { paddingTop: insets.top },
      ]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.searchBar}>
            <SearchIcon size={18} color={Colors.textSecondary} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Search projects, RFIs, invoices, photos…"
              placeholderTextColor={Colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              testID="universal-search-input"
            />
            {query.length > 0 ? (
              <TouchableOpacity
                onPress={() => setQuery('')}
                accessibilityLabel="Clear"
                style={styles.clearBtn}
              >
                <X size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={closeSearch}
            style={styles.cancelBtn}
            testID="universal-search-cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Empty prompt + recents */}
          {showEmptyPrompt ? (
            <View>
              {recent.length > 0 ? (
                <View>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeader}>Recent</Text>
                    <TouchableOpacity onPress={clearRecents} testID="universal-search-clear-recents">
                      <Text style={styles.sectionAction}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                  {recent.map(r => (
                    <TouchableOpacity
                      key={r}
                      style={styles.recentRow}
                      onPress={() => handleRecentPress(r)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.recentIcon}>
                        <Clock size={16} color={Colors.textSecondary} />
                      </View>
                      <Text style={styles.recentText} numberOfLines={1}>{r}</Text>
                      <ChevronRight size={14} color={Colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <View style={styles.emptyIcon}>
                    <SearchIcon size={26} color={Colors.textMuted} />
                  </View>
                  <Text style={styles.emptyTitle}>Find anything in your account</Text>
                  <Text style={styles.emptyBody}>
                    Start typing to search your projects, tasks, RFIs, invoices, photos, and more.
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          {/* Searching indicator */}
          {isSearching ? (
            <View style={styles.searchingRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.searchingText}>Searching…</Text>
            </View>
          ) : null}

          {/* No results */}
          {showNoResults ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptyBody}>
                Try a shorter or different term — search is substring-matched across fields.
              </Text>
            </View>
          ) : null}

          {/* Grouped results */}
          {!showEmptyPrompt
            ? KIND_ORDER.map(kind => {
                const rows = grouped[kind];
                if (!rows || rows.length === 0) return null;
                const Icon = KIND_ICON[kind];
                return (
                  <View key={kind} style={styles.group}>
                    <View style={styles.sectionHeaderRow}>
                      <Text style={styles.sectionHeader}>
                        {KIND_LABEL[kind]} · {rows.length}
                      </Text>
                    </View>
                    {rows.map(r => (
                      <TouchableOpacity
                        key={`${r.ref.kind}-${r.ref.id}`}
                        style={styles.resultRow}
                        onPress={() => handleResultPress(r)}
                        activeOpacity={0.7}
                        testID={`universal-search-result-${r.ref.kind}-${r.ref.id}`}
                      >
                        <View style={styles.resultIcon}>
                          <Icon size={18} color={Colors.primary} />
                        </View>
                        <View style={styles.resultBody}>
                          <Text style={styles.resultTitle} numberOfLines={1}>{r.label}</Text>
                          <Text style={styles.resultSubtitle} numberOfLines={1}>
                            {r.projectName ? `${r.projectName} · ` : ''}{r.matchField}
                          </Text>
                          {r.matchSnippet ? (
                            <Text style={styles.resultSnippet} numberOfLines={1}>{r.matchSnippet}</Text>
                          ) : null}
                        </View>
                        <ChevronRight size={16} color={Colors.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })
            : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 10,
    paddingHorizontal: 10,
    gap: 8,
    height: 40,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
    paddingVertical: 0,
  } as any,
  clearBtn: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.border,
  },
  cancelBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  cancelText: { fontSize: 15, color: Colors.primary, fontWeight: '500' },

  body: { flex: 1 },
  bodyContent: { paddingTop: 8, paddingBottom: 32 },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  sectionAction: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '500',
  },

  group: { marginBottom: 4 },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  resultIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  resultBody: { flex: 1 },
  resultTitle: { fontSize: 15, fontWeight: '600', color: Colors.text },
  resultSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  resultSnippet: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  recentIcon: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  recentText: { flex: 1, fontSize: 15, color: Colors.text },

  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  searchingText: { fontSize: 13, color: Colors.textSecondary },

  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
    gap: 10,
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
});

