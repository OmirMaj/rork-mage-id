// ============================================================================
// components/UniversalSearch.tsx
//
// Modal wrapper around the two search lanes:
//   * FEATURES — utils/featureRegistry.ts, matched synchronously on every
//     keystroke (no debounce; the registry is ~90 rows). "gantt" → Pro
//     Scheduler, "g702" → AIA Pay Apps. Tier-locked rows still list, with
//     the required tier as a chip; the destination renders its own paywall.
//   * ENTITIES — useUniversalSearch over ProjectContext (debounced), results
//     grouped by entity kind, handed to useEntityNavigation().navigateTo.
// One autofocused input, Cmd+K / Ctrl+K on web, ESC closes. Empty query
// shows the popular-destinations shortlist + the last 5 searches from
// AsyncStorage (mageid_recent_searches).
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Search as SearchIcon, X, ChevronRight, Building2, CalendarDays, Camera,
  HelpCircle, ClipboardCheck, Receipt, Repeat, FileText, CheckSquare, Shield,
  UserRound, Wrench, Clock, HardHat, Briefcase, Layers, MessageSquare, Mail,
  MapPin, PenTool, ClipboardList, Bell,
  Newspaper, CalendarCheck, BellRing, ScanEye, Mic, Gavel, ScrollText, Store,
  Scale, BarChart3, Target, Zap, FileSignature, UserPlus, Users, IdCard,
  Award, ShieldCheck, Handshake, FileSearch, FileDiff, BookOpen, ScanLine,
  Upload, ListChecks, Stamp, Presentation, Package, PieChart, TrendingUp,
  Coins, LineChart, Wallet, CalendarClock, Banknote, Droplets,
  SlidersHorizontal, Plug, KeyRound, Inbox, Download, Settings, CreditCard,
  BadgeCheck, AlertTriangle, Brain, Truck,
} from 'lucide-react-native';
import {
  MageAIMark, MageProject, MageSummary, MageEstimate, MageSchedule,
  MageRFI, MageSubmittal, MagePayApp, MageChangeOrder, MageTakeoff,
  MagePunch, MageMargin, MagePlans, MageCostDb, MageEquipment,
  MageDailyReport, MageInvoice, MageContract,
} from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useSearch } from '@/contexts/SearchContext';
import { useUniversalSearch, type SearchResult } from '@/hooks/useUniversalSearch';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useCoreData } from '@/contexts/ProjectContext';
import {
  searchFeatures, getFeature, GROUP_LABELS,
  POPULAR_FEATURE_IDS, POPULAR_CLIENT_FEATURE_IDS,
  type FeatureEntry, type FeatureIcon,
} from '@/utils/featureRegistry';
import type { EntityKind } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const RECENT_KEY = 'mageid_recent_searches';
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
  delayEvent: CalendarDays,
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
  delayEvent: 'Delay Events',
};

const KIND_ORDER: EntityKind[] = [
  'project', 'task', 'rfi', 'submittal', 'changeOrder', 'invoice',
  'dailyReport', 'punchItem', 'photo', 'permit', 'subcontractor',
  'commitment', 'planSheet', 'drawingPin', 'planMarkup',
  'warranty', 'equipment', 'prequalPacket', 'priceAlert',
  'contact', 'commEvent', 'portalMessage', 'document', 'payment',
];

// ---------------------------------------------------------------------------
// Feature icons — exhaustive against the registry's FeatureIcon union, so a
// typo in the registry or a missing entry here is a compile error. Mage
// bespoke marks where they exist; lucide for the rest.
// ---------------------------------------------------------------------------

type FeatureIconCmp = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

const FEATURE_ICON: Record<FeatureIcon, FeatureIconCmp> = {
  MageSummary, MageProject, MageAIMark, MageEstimate, MageSchedule,
  MageRFI, MageSubmittal, MagePayApp, MageChangeOrder, MageTakeoff,
  MagePunch, MageMargin, MagePlans, MageCostDb, MageEquipment,
  MageDailyReport, MageInvoice, MageContract,
  Briefcase, Newspaper, CalendarCheck, BellRing, ScanEye, Mic, Gavel,
  ScrollText, MapPin, Store, Scale, Layers, BarChart3, Target, Zap,
  FileSignature, UserPlus, Users, IdCard, HardHat, Building2, Award,
  ClipboardList, ShieldCheck, Handshake, FileSearch, Camera, FileDiff,
  BookOpen, ScanLine, Upload, ListChecks, FileText, Clock, PenTool, Stamp,
  Presentation, Package, PieChart, TrendingUp, Coins, LineChart, Wallet,
  CalendarClock, Banknote, Receipt, Droplets, SlidersHorizontal, Plug,
  KeyRound, Shield, Bell, Inbox, Download, Settings, CreditCard, BadgeCheck,
  AlertTriangle, Brain, Truck,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UniversalSearch() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isOpen, closeSearch, openVoice, openHelp } = useSearch();
  const insets = useSafeAreaInsets();
  const { navigateTo } = useEntityNavigation();
  const router = useRouter();
  const { tier, canAccess, requiredTierFor } = useTierAccess();
  const { userRole } = useCoreData();

  // MAGE Brain quick actions — the surface does more than navigate: ask it
  // (chat), speak to it (voice capture), get help. Close the search sheet
  // first, then present, so iOS never stacks two modals mid-dismiss (the same
  // 350ms guard the nav handlers use).
  const handleAskMage = useCallback(() => {
    closeSearch();
    setTimeout(() => router.push('/ask'), Platform.OS === 'ios' ? 350 : 0);
  }, [closeSearch, router]);
  const handleVoice = useCallback(() => {
    closeSearch();
    setTimeout(() => openVoice(), Platform.OS === 'ios' ? 350 : 0);
  }, [closeSearch, openVoice]);
  const handleHelp = useCallback(() => {
    closeSearch();
    setTimeout(() => openHelp(), Platform.OS === 'ios' ? 350 : 0);
  }, [closeSearch, openHelp]);

  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<TextInput | null>(null);

  const { grouped, isSearching } = useUniversalSearch(query);

  // Feature lane — synchronous on the raw query, results land on the same
  // keystroke. Mirrors the tab bar / sidebar persona split.
  const persona = userRole === 'client' || userRole === 'property_manager'
    ? ('client' as const)
    : ('contractor' as const);
  const featureHits = useMemo(
    () => searchFeatures(query, tier, { persona }),
    [query, tier, persona],
  );
  const popularEntries = useMemo(() => {
    const ids = persona === 'client' ? POPULAR_CLIENT_FEATURE_IDS : POPULAR_FEATURE_IDS;
    return ids
      .map(getFeature)
      .filter((e): e is FeatureEntry => e !== undefined);
  }, [persona]);

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

  const handleFeaturePress = useCallback((entry: FeatureEntry) => {
    void persistRecent(query);
    closeSearch();
    // Same pageSheet-dismiss timing as entity results. Routes are plain
    // strings validated against app/ by scripts/validate-feature-search.ts.
    setTimeout(() => router.push(entry.route as never), Platform.OS === 'ios' ? 350 : 0);
  }, [persistRecent, query, closeSearch, router]);

  // Return key / Enter takes the top feature hit — type "gantt", hit enter.
  const handleSubmit = useCallback(() => {
    if (featureHits.length > 0) handleFeaturePress(featureHits[0].entry);
  }, [featureHits, handleFeaturePress]);

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
  const showNoResults =
    !showEmptyPrompt && !isSearching && totalCount === 0 && featureHits.length === 0;

  // Row for a feature destination — dense, one line: icon, title, lock chip
  // when the tier doesn't unlock it (tap still routes; the destination
  // renders its own paywall), group tag on the right edge.
  const renderFeatureRow = (entry: FeatureEntry, locked: boolean, lockTier: string) => {
    const Icon = FEATURE_ICON[entry.icon];
    return (
      <TouchableOpacity
        key={entry.id}
        style={styles.featureRow}
        onPress={() => handleFeaturePress(entry)}
        activeOpacity={0.7}
        testID={`universal-search-feature-${entry.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${entry.title}${locked ? `, requires ${lockTier}` : ''}`}
      >
        <Icon size={17} color={themeColors.textSecondary} strokeWidth={1.75} />
        <Text style={styles.featureTitle} numberOfLines={1}>{entry.title}</Text>
        {locked ? (
          <View style={styles.lockChip}>
            <Text style={styles.lockChipText}>{lockTier}</Text>
          </View>
        ) : null}
        <Text style={styles.featureGroup}>{GROUP_LABELS[entry.group]}</Text>
      </TouchableOpacity>
    );
  };

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
          <View style={styles.headerInner}>
          <View style={styles.searchBar}>
            <SearchIcon size={18} color={themeColors.textSecondary} strokeWidth={1.75} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Find a tool, a screen, a number"
              placeholderTextColor={themeColors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={handleSubmit}
              testID="universal-search-input"
            />
            {query.length > 0 ? (
              <TouchableOpacity
                onPress={() => setQuery('')}
                accessibilityLabel="Clear"
                style={styles.clearBtn}
              >
                <X size={16} color={themeColors.textMuted} strokeWidth={1.75} />
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
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Empty prompt: popular destinations + recents */}
          {showEmptyPrompt ? (
            <View>
              {/* MAGE Brain — the surface does more than navigate: ask, speak, help. */}
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>MAGE Brain</Text>
              </View>
              <TouchableOpacity style={styles.brainActionRow} onPress={handleAskMage} activeOpacity={0.7} testID="brain-action-ask">
                <View style={styles.brainActionIcon}><MageAIMark size={18} color={themeColors.accent} /></View>
                <View style={styles.brainActionBody}>
                  <Text style={styles.brainActionText}>Ask MAGE anything</Text>
                  <Text style={styles.brainActionSub}>Your projects, costs, schedule — answered</Text>
                </View>
                <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.brainActionRow} onPress={handleVoice} activeOpacity={0.7} testID="brain-action-voice">
                <View style={styles.brainActionIcon}><Mic size={18} color={themeColors.accent} strokeWidth={1.75} /></View>
                <View style={styles.brainActionBody}>
                  <Text style={styles.brainActionText}>Voice capture</Text>
                  <Text style={styles.brainActionSub}>Speak a log, a punch item, an update</Text>
                </View>
                <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.brainActionRow} onPress={handleHelp} activeOpacity={0.7} testID="brain-action-help">
                <View style={styles.brainActionIcon}><HelpCircle size={18} color={themeColors.accent} strokeWidth={1.75} /></View>
                <View style={styles.brainActionBody}>
                  <Text style={styles.brainActionText}>Help &amp; tips</Text>
                </View>
                <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>Go to</Text>
              </View>
              {popularEntries.map(e => renderFeatureRow(
                e,
                e.requires ? !canAccess(e.requires) : false,
                e.requires ? requiredTierFor(e.requires) : 'free',
              ))}
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
                        <Clock size={16} color={themeColors.textSecondary} strokeWidth={1.75} />
                      </View>
                      <Text style={styles.recentText} numberOfLines={1}>{r}</Text>
                      <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <Text style={styles.hintText}>
                  Type what you need — a screen, a tool, or anything in your
                  projects. Trade terms work: “gantt”, “g702”, “osha”.
                </Text>
              )}
            </View>
          ) : null}

          {/* No results */}
          {showNoResults ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Nothing by that name</Text>
              <Text style={styles.emptyBody}>
                Try the trade term — “gantt”, “punch”, “g702” — or the name of
                a project, an invoice, an RFI.
              </Text>
            </View>
          ) : null}

          {/* Feature hits — instant, above the entity lanes */}
          {!showEmptyPrompt && featureHits.length > 0 ? (
            <View style={styles.group}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>
                  Go to · {featureHits.length}
                </Text>
              </View>
              {featureHits.map(h => renderFeatureRow(h.entry, h.locked, h.requiredTier))}
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
                          <Icon size={18} color={themeColors.textSecondary} />
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
                        <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
    backgroundColor: t.bg,
  },
  // Content column caps at a readable width on desktop web; full-bleed on
  // phones. The hairline + bg above stay edge-to-edge.
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 10,
    gap: 8,
    height: 40,
  },
  input: {
    flex: 1,
    fontSize: Type.callout.fontSize,
    color: t.text,
    paddingVertical: 0,
  } as any,
  clearBtn: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.line,
  },
  cancelBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  cancelText: { fontSize: Type.subhead.fontSize, color: t.accent, fontWeight: '500' },

  body: { flex: 1 },
  bodyContent: {
    paddingTop: 8,
    paddingBottom: 32,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  // Mono uppercase eyebrow — the app's section-label idiom (Type.monoEyebrow,
  // see components/ui/EyebrowLabel.tsx).
  sectionHeader: {
    ...Type.monoEyebrow,
    color: t.textSecondary,
  },
  sectionAction: {
    fontSize: Type.footnote.fontSize,
    color: t.accent,
    fontWeight: '500',
  },

  group: { marginBottom: 4 },

  // Feature rows — dense, one line each: plain icon (no fill chip), title,
  // optional required-tier chip (amber as accent mark only), group tag.
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    gap: 12,
  },
  featureTitle: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    fontWeight: '600',
    color: t.text,
  },
  featureGroup: {
    ...Type.monoLabel,
    color: t.textMuted,
  },
  lockChip: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: Tokens.radius.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.accentLabel,
  },
  lockChipText: {
    ...Type.monoLabel,
    color: t.accentLabel,
  },
  hintText: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    lineHeight: 19,
    paddingHorizontal: 16,
    paddingTop: 10,
  },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  // Plain icon, no tinted fill — amber stays reserved for accent marks
  // (lock chips, actions), and the rows read as an index, not a feed.
  resultIcon: {
    width: 24, height: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  resultBody: { flex: 1 },
  resultTitle: { fontSize: Type.subhead.fontSize, fontWeight: '600', color: t.text },
  resultSubtitle: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2 },
  resultSnippet: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },

  brainActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 12,
  },
  brainActionIcon: {
    width: 34, height: 34, borderRadius: Tokens.radius.sm,
    backgroundColor: t.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  brainActionBody: { flex: 1 },
  brainActionText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  brainActionSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 1 },

  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  recentIcon: {
    width: 30, height: 30, borderRadius: Tokens.radius.sm,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  recentText: { flex: 1, fontSize: Type.subhead.fontSize, color: t.text },

  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
    gap: 10,
  },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '700', color: t.text, textAlign: 'center' },
  emptyBody: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 20 },
});

