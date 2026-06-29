// CreateMenu — the "+ New…" bottom sheet that surfaces every creatable
// thing in the app with a 1-line plain-English subtitle.
//
// Inspired by Notion's `/` slash command + Linear's `Cmd+K` palette.
// Why this matters: audit found that even after the design refresh,
// users had no way to discover features they didn't know existed (e.g.,
// "I had no idea I could create an OAC meeting from this app"). A
// single bottom-sheet listing every creatable entity with a one-line
// description is the mobile analog to the desktop command palette and
// the cheapest possible feature-discoverability surface.
//
// Triggered by the (+) button on the home screen. Search box at top
// filters in real time. Tapping a row routes to the relevant screen
// in "create" mode.
//
// Each entry: icon + plain-English label + 1-sentence description +
// optional "Pro" / "Business" tier chip.

import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Search, X, ChevronRight, ChevronLeft, FolderPlus, Calculator, CalendarDays, FileText,
  Receipt, Repeat, ClipboardList, CheckSquare, ShoppingCart, Camera, Layers,
  ScrollText, Footprints, Users, Mail, Shield, BookOpen, UserPlus, Gavel,
  Wallet, MessageSquare, Ruler, Lock, FileCheck, type LucideIcon,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface CreateOption {
  /** Human label (plain English). */
  label: string;
  /** One-sentence description. */
  subtitle: string;
  /** Lucide icon. */
  Icon: LucideIcon;
  /** Route to push when tapped. */
  href: string;
  /** Optional category for grouping. */
  category: 'project' | 'money' | 'docs' | 'field' | 'people' | 'tools';
  /** Optional Pro/Business tier hint. */
  tier?: 'pro' | 'business';
  /** Search keywords beyond the label. */
  keywords?: string[];
  /** True when the destination screen needs a `projectId`. Pre-audit
   *  these routed bare and dead-ended on a "pick a project" empty state;
   *  now we interpose an in-sheet project picker and pass `projectId`. */
  scoped?: boolean;
  /** Name of the route param the destination reads the project id from.
   *  Defaults to `projectId`; a few screens read `id` instead — passing
   *  the wrong name re-creates the dead-end the picker is meant to fix. */
  param?: string;
  /** Static extra params merged into the route (e.g. `{ type:'progress' }`). */
  extraParams?: Record<string, string>;
}

const OPTIONS: CreateOption[] = [
  // Project-level
  { label: 'Project', subtitle: 'Start a new job from scratch', Icon: FolderPlus, href: '/?openCreate=1', category: 'project', keywords: ['job', 'new'] },
  { label: 'Estimate', subtitle: 'Build a line-item quote with materials + labor', Icon: Calculator, href: '/estimate-wizard', category: 'project', scoped: true },
  { label: 'Schedule', subtitle: 'Plan tasks with a Gantt or Today list', Icon: CalendarDays, href: '/schedule-wizard', category: 'project', scoped: true },
  { label: 'Lead', subtitle: 'Capture a homeowner inquiry — voice or form', Icon: UserPlus, href: '/leads', category: 'project', keywords: ['pipeline', 'sales'] },

  // Money
  { label: 'Invoice', subtitle: 'Bill the client for completed work', Icon: Receipt, href: '/invoice', category: 'money', scoped: true },
  { label: 'Change Order', subtitle: 'Add scope or cost on top of the contract', Icon: Repeat, href: '/change-order', category: 'money', keywords: ['co'], scoped: true, tier: 'pro' },
  { label: 'Progress Billing', subtitle: 'AIA G702/G703 — the bank-formatted pay app', Icon: FileText, href: '/bill-from-estimate', category: 'money', keywords: ['aia', 'pay app', 'g702', 'g703'], scoped: true, extraParams: { type: 'progress' } },
  { label: 'Buyout package', subtitle: 'Send a trade out for sub bids', Icon: Gavel, href: '/buyout', category: 'money', keywords: ['subs', 'sub bids', 'awards'], scoped: true },
  { label: 'Scope Sheet', subtitle: 'AI inclusions & exclusions from your estimate', Icon: FileCheck, href: '/scope-sheet', category: 'docs', keywords: ['scope', 'inclusions', 'exclusions', 'clarifications', 'assumptions', 'sow'], scoped: true },
  { label: 'Lien Waiver', subtitle: 'Sub sign-off — proof they\'ve been paid', Icon: ScrollText, href: '/lien-waivers', category: 'money', keywords: ['waiver', 'release'], scoped: true },

  // Documentation
  { label: 'Daily Report', subtitle: 'What got done today on site', Icon: ClipboardList, href: '/daily-report', category: 'docs', keywords: ['dfr', 'log'], scoped: true },
  { label: 'Punch Item', subtitle: 'Something to fix before final walkthrough', Icon: CheckSquare, href: '/punch-list', category: 'docs', keywords: ['punch list'], scoped: true, tier: 'business' },
  { label: 'RFI', subtitle: 'Ask the architect a formal question', Icon: MessageSquare, href: '/rfi', category: 'docs', keywords: ['request for information'], scoped: true, tier: 'business' },
  { label: 'Submittal', subtitle: 'Send a product spec for architect approval', Icon: FileText, href: '/submittal', category: 'docs', scoped: true },
  { label: 'Selection', subtitle: 'Lock in a tile, fixture, or finish', Icon: ShoppingCart, href: '/selections', category: 'docs', scoped: true },
  { label: 'Photo / markup', subtitle: 'Capture site photo, draw on it', Icon: Camera, href: '/photo-triage', category: 'docs', keywords: ['picture'], scoped: true },
  { label: 'Plan / drawing', subtitle: 'Upload a PDF set, mark it up', Icon: Layers, href: '/plans', category: 'docs', keywords: ['blueprint'], scoped: true },
  { label: 'Permit', subtitle: 'Track issued permits and inspections', Icon: Shield, href: '/permits', category: 'docs', scoped: true },
  { label: 'Sub COI', subtitle: 'Add a subcontractor\'s insurance certificate', Icon: Shield, href: '/coi-vault', category: 'docs', keywords: ['certificate', 'insurance'] },

  // People & meetings
  { label: 'OAC Meeting', subtitle: 'The owner-architect-contractor weekly', Icon: Users, href: '/oac-meeting', category: 'people', keywords: ['meeting'], scoped: true },
  { label: 'Client portal invite', subtitle: 'Give the homeowner read access', Icon: Mail, href: '/client-portal-setup', category: 'people', scoped: true, param: 'id' },
  { label: 'Sub portal invite', subtitle: 'Give a sub a private upload link', Icon: Mail, href: '/sub-portal-setup', category: 'people', scoped: true },

  // Closeout
  { label: 'Handover Checklist', subtitle: 'The walkthrough-day checklist', Icon: Footprints, href: '/handover', category: 'docs', scoped: true },
  { label: 'Closeout Binder', subtitle: 'The PDF packet you give the homeowner', Icon: BookOpen, href: '/closeout-binder', category: 'docs', scoped: true },

  // Tools
  { label: 'Cash Flow setup', subtitle: 'Forecast the next 12 weeks of money', Icon: Wallet, href: '/cash-flow', category: 'tools', scoped: true },
  { label: 'AI Takeoff', subtitle: 'Upload plans, get LF / SF / EA quantities', Icon: Ruler, href: '/takeoff', category: 'tools', tier: 'pro', keywords: ['quantity', 'measure', 'takeoff', 'plans'] },
  { label: 'AI Drawing Estimate', subtitle: 'Upload plans, get a priced starting estimate', Icon: MageAIMark as unknown as LucideIcon, href: '/drawing-analyzer', category: 'tools', tier: 'pro', keywords: ['estimate', 'plans', 'drawings'] },
];

const CATEGORY_LABELS: Record<CreateOption['category'], string> = {
  project: 'Start',
  money: 'Money',
  docs: 'Documents',
  field: 'Field',
  people: 'People',
  tools: 'Tools',
};

export interface CreateMenuProps {
  visible: boolean;
  onClose: () => void;
  /** Optional handler for the "Project" entry — if set, called instead
   *  of routing. Lets the host (typically the home tab) open its
   *  create-project modal in place. */
  onCreateProject?: () => void;
}

function CreateMenuImpl({ visible, onClose, onCreateProject }: CreateMenuProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects } = useProjects();
  const { isProOrAbove, isBusinessOrAbove } = useTierAccess();
  // A locked row keeps working (tapping still routes → the screen's own
  // Paywall is the real gate) — the chip just sets expectations so a free
  // tester sees "Business" before tapping instead of hitting a full wall.
  const lockedTier = useCallback((opt: CreateOption): 'pro' | 'business' | null => {
    if (opt.tier === 'business' && !isBusinessOrAbove) return 'business';
    if (opt.tier === 'pro' && !isProOrAbove) return 'pro';
    return null;
  }, [isProOrAbove, isBusinessOrAbove]);
  const [query, setQuery] = useState('');
  // When set, the sheet swaps from the create list to an in-sheet project
  // picker for this scoped option. Swapping content (vs. opening a nested
  // Modal) sidesteps the iOS "can't present two modals back-to-back" bug.
  const [pickFor, setPickFor] = useState<CreateOption | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return OPTIONS;
    return OPTIONS.filter(o => {
      if (o.label.toLowerCase().includes(q)) return true;
      if (o.subtitle.toLowerCase().includes(q)) return true;
      if (o.keywords?.some(k => k.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [query]);

  // Group by category, preserving display order from the source array.
  const grouped = useMemo(() => {
    const out: Array<{ key: CreateOption['category']; label: string; items: CreateOption[] }> = [];
    const order: CreateOption['category'][] = ['project', 'money', 'docs', 'people', 'tools', 'field'];
    for (const cat of order) {
      const items = filtered.filter(f => f.category === cat);
      if (items.length === 0) continue;
      out.push({ key: cat, label: CATEGORY_LABELS[cat], items });
    }
    return out;
  }, [filtered]);

  const handleClose = useCallback(() => {
    setQuery('');
    setPickFor(null);
    onClose();
  }, [onClose]);

  // Route to a scoped screen with the chosen project. Close the sheet
  // first, then navigate after the 280ms iOS modal-gap.
  const routeScoped = useCallback((opt: CreateOption, projectId: string) => {
    handleClose();
    setTimeout(() => {
      router.push({
        pathname: opt.href as never,
        // Most screens read `projectId`; a few read `id`. Passing the
        // wrong name re-creates the exact dead-end the picker fixes.
        params: { [opt.param ?? 'projectId']: projectId, ...(opt.extraParams ?? {}) },
      } as never);
    }, 280);
  }, [handleClose, router]);

  const handleSelect = useCallback((opt: CreateOption) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();

    // Scoped destinations need a projectId or they dead-end on a "pick a
    // project" empty state (the audit's #1 discovery failure). Interpose
    // a picker — but skip it when the choice is trivial/forced.
    if (opt.scoped) {
      if (projects.length === 0) {
        handleClose();
        setTimeout(() => {
          Alert.alert(
            'Create a project first',
            `Add a project, then you can attach a ${opt.label.toLowerCase()} to it.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'New project',
                onPress: () => {
                  if (onCreateProject) onCreateProject();
                  else router.push('/?openCreate=1' as never);
                },
              },
            ],
          );
        }, 280);
        return;
      }
      if (projects.length === 1) {
        routeScoped(opt, projects[0].id);
        return;
      }
      setPickFor(opt);
      return;
    }

    handleClose();
    // "Project" routes via callback when a host provides one (typically
    // the home tab passing its own setShowCreateModal). Everything else
    // routes through expo-router after the sheet animates closed (iOS
    // can't present two modals back-to-back without a gap).
    setTimeout(() => {
      if (opt.label === 'Project' && onCreateProject) {
        onCreateProject();
      } else {
        router.push(opt.href as never);
      }
    }, 280);
  }, [handleClose, router, onCreateProject, projects, routeScoped]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.handle} />

        {pickFor ? (
          <>
            <View style={styles.headerRow}>
              <TouchableOpacity onPress={() => setPickFor(null)} style={styles.closeBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Back">
                <ChevronLeft size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
              <Text style={[Type.title2, { color: themeColors.text, flex: 1, textAlign: 'center' }]} numberOfLines={1}>
                {pickFor.label} → which project?
              </Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: '70%' as any }} showsVerticalScrollIndicator={false}>
              {projects.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.row}
                  onPress={() => { if (pickFor) routeScoped(pickFor, p.id); }}
                  activeOpacity={0.55}
                  testID={`createmenu-pick-project-${p.id}`}
                >
                  <View style={styles.iconSquare}>
                    <FolderPlus size={18} color={themeColors.textSecondary} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[Type.headline, { color: themeColors.text }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={[Type.footnote, { color: themeColors.textSecondary }]} numberOfLines={1}>
                      {p.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text style={[Type.title2, { color: themeColors.text }]}>Create new…</Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
            </View>

            <View style={styles.searchRow}>
              <Search size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              <TextInput
                style={[styles.searchInput, Type.body]}
                placeholder="Search for anything you can create…"
                placeholderTextColor={themeColors.textMuted}
                value={query}
                onChangeText={setQuery}
                autoFocus={false}
                returnKeyType="search"
              />
              {!!query && (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView style={{ maxHeight: '70%' as any }} showsVerticalScrollIndicator={false}>
              {grouped.length === 0 && (
                <View style={styles.emptyResult}>
                  <Text style={[Type.subhead, { color: themeColors.textSecondary, textAlign: 'center' }]}>
                    No matches. Try &ldquo;invoice&rdquo;, &ldquo;rfi&rdquo;, &ldquo;buyout&rdquo;…
                  </Text>
                </View>
              )}
              {grouped.map(g => (
                <View key={g.key} style={styles.group}>
                  <Text style={[Type.eyebrow, { color: themeColors.textMuted, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }]}>
                    {g.label}
                  </Text>
                  {g.items.map(opt => (
                    <TouchableOpacity
                      key={opt.label}
                      style={styles.row}
                      onPress={() => handleSelect(opt)}
                      activeOpacity={0.55}
                      testID={`create-${opt.label.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <View style={styles.iconSquare}>
                        <opt.Icon size={18} color={themeColors.textSecondary} strokeWidth={2} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[Type.headline, { color: themeColors.text }]} numberOfLines={1}>
                          {opt.label}
                        </Text>
                        <Text style={[Type.footnote, { color: themeColors.textSecondary }]} numberOfLines={1}>
                          {opt.subtitle}
                        </Text>
                      </View>
                      {(() => {
                        const lt = lockedTier(opt);
                        return lt ? (
                          <View style={styles.tierChip}>
                            <Lock size={10} color={themeColors.textSecondary} strokeWidth={2.5} />
                            <Text style={styles.tierChipText}>{lt === 'pro' ? 'Pro' : 'Business'}</Text>
                          </View>
                        ) : null;
                      })()}
                      <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

export const CreateMenu = memo(CreateMenuImpl);

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: t.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 0,
    paddingTop: 8,
    maxHeight: '85%' as any,
  },
  handle: {
    alignSelf: 'center',
    width: 36, height: 5,
    borderRadius: 3,
    backgroundColor: t.line,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.panel,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surfaceAlt,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surfaceAlt,
  },
  searchInput: {
    flex: 1,
    color: t.text,
    padding: 0,
  },
  group: { marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  iconSquare: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyResult: {
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  tierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.surfaceAlt,
  },
  tierChipText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: t.textSecondary,
    letterSpacing: 0.3,
  },
});
