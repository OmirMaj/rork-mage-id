// ============================================================================
// components/search/CommandPalette.tsx — Cmd+K on desktop web (wave 6d
// restore, lane K2).
//
// UniversalSearch renders this instead of its phone sheet when
// useIsDesktopWeb() is true (after its last hook, so crossing 900 px never
// changes the hook count). A 720 px card, 12% down the window, centred in the
// content column, over a scrim that dims the sidebar too. Lanes, in order —
//   with a query:  Projects · Actions · Ask · Go to · Records
//   empty:         Actions for {job} · Recent jobs · MAGE Brain · Go to · Recent searches
// — decided by utils/paletteRows (pure; validate-feature-search proves it).
// ArrowUp / ArrowDown move one highlighted 40 px row (wrapping), Enter runs it,
// Esc closes the palette and nothing behind it (a dialog to the shortcut
// registry). Desktop web only: a phone never mounts this file.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TextInput, Pressable, ScrollView, useWindowDimensions,
  type NativeSyntheticEvent, type TextInputKeyPressEventData, type LayoutChangeEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Search as SearchIcon, Building2, Clock, HelpCircle, Mic, Keyboard, FolderPlus,
  CornerDownLeft,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { Layout, Shadow, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useCoreData } from '@/contexts/ProjectContext';
import { useActiveProject } from '@/contexts/ActiveProjectContext';
import { useAskDock } from '@/hooks/useAskDock';
import { openShortcutSheet } from '@/components/desktop/ShortcutSheet';
import { cardSurface, webMotion } from '@/components/ui';
import { useSheetDialogScope } from '@/components/ui/Sheet';
import { useDesktopShellInset } from '@/components/ui/desktop';
import { routeHref } from '@/components/desktop/RowLink';
import {
  CREATE_OPTIONS, pushCreateOption, pushUnscopedCreateOption, type CreateOption,
} from '@/components/CreateMenu';
import {
  buildPaletteRows, featureHitsForRole, movePaletteSelection, paletteLaneLabel,
  popularHits, popularIdsForRole, type BrainAction, type PaletteFeatureHit, type PaletteRow,
} from '@/utils/paletteRows';
import { jobSwitcherList } from '@/utils/activeProject';
import {
  GROUP_LABELS, POPULAR_CLIENT_FEATURE_IDS, POPULAR_FEATURE_IDS, getFeature,
  type FeatureEntry, type FeatureIcon,
} from '@/utils/featureRegistry';
import type { FeatureKey } from '@/utils/featureTiers';
import type { SearchResult } from '@/hooks/useUniversalSearch';
import type { EntityKind, SubscriptionTier } from '@/types';

type IconCmp = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  setQuery: (q: string) => void;
  inputRef: React.RefObject<TextInput | null>;
  tier: SubscriptionTier;
  /** Entity search results, flattened in UniversalSearch's KIND_ORDER. */
  records: readonly SearchResult[];
  isSearching: boolean;
  recent: readonly string[];
  /** UniversalSearch's handlers — each closes search itself. */
  onFeature: (entry: FeatureEntry) => void;
  onResult: (r: SearchResult) => void;
  onRecent: (q: string) => void;
  /** Saves the query to Recent searches — called by the rows that close the
   *  palette themselves (jobs, creating, Ask), so every row type records it
   *  the way onFeature / onResult already do. */
  onRan: (q: string) => void;
  onVoice: () => void;
  onHelp: () => void;
  canAccess: (k: FeatureKey) => boolean;
  requiredTierFor: (k: FeatureKey) => string;
  featureIcon: Record<FeatureIcon, IconCmp>;
  kindIcon: Record<EntityKind, React.FC<{ size: number; color: string }>>;
  kindLabel: Record<EntityKind, string>;
}

type Row = PaletteRow<CreateOption, PaletteFeatureHit, SearchResult>;

const BRAIN_ICON: Record<BrainAction, IconCmp> = {
  ask: MageAIMark, voice: Mic, help: HelpCircle, shortcuts: Keyboard,
};

export default function CommandPalette({
  isOpen, onClose, query, setQuery, inputRef, tier, records, isSearching, recent,
  onFeature, onResult, onRecent, onRan, onVoice, onHelp, canAccess, requiredTierFor,
  featureIcon, kindIcon, kindLabel,
}: CommandPaletteProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { userRole, projects } = useCoreData();
  const { activeProject, recentProjectIds } = useActiveProject();
  const { openAsk } = useAskDock();
  const { height: winH } = useWindowDimensions();
  const shellInset = useDesktopShellInset(isOpen);
  // The card centres in the content column (516-1236 at 1512 with the 240
  // sidebar, like the CreateMenu popover and the shortcut sheet): the scrim's
  // StyleSheet gutter pads the right, so the left is the sidebar plus that gutter.
  const scrimPadLeft = shellInset + Layout.gutter;
  // A dialog to the shortcut registry: an Esc typed here closes the palette
  // (the Modal's onRequestClose / UniversalSearch's listener) and never a
  // page-scope record behind it.
  useSheetDialogScope(isOpen);

  // Client and property manager: the minimal app — no job lanes, no creating.
  const minimal = userRole === 'client' || userRole === 'property_manager';
  const activeJob = minimal ? null : activeProject;

  const featureHits = useMemo(() => featureHitsForRole(query, tier, userRole), [query, tier, userRole]);
  const popular = useMemo(
    () => popularHits(
      popularIdsForRole(userRole, POPULAR_FEATURE_IDS, POPULAR_CLIENT_FEATURE_IDS)
        .map(getFeature)
        .filter((e): e is FeatureEntry => e !== undefined),
      (e) => (e.requires ? !canAccess(e.requires) : false),
      (e) => (e.requires ? requiredTierFor(e.requires) : 'free'),
    ),
    [userRole, canAccess, requiredTierFor],
  );
  const recentJobs = useMemo(() => jobSwitcherList(projects, recentProjectIds, ''), [projects, recentProjectIds]);
  const projectHits = useMemo(
    () => (query.trim() ? jobSwitcherList(projects, recentProjectIds, query) : []),
    [projects, recentProjectIds, query],
  );

  const rows: Row[] = useMemo(() => buildPaletteRows<CreateOption, PaletteFeatureHit, SearchResult>({
    query,
    minimal,
    activeJob: activeJob ? { id: activeJob.id, name: activeJob.name } : null,
    recentJobs,
    projectHits,
    createOptions: CREATE_OPTIONS,
    featureHits: query.trim() ? featureHits : popular,
    records,
    recentSearches: recent,
  }), [query, minimal, activeJob, recentJobs, projectHits, featureHits, popular, records, recent]);

  // The selection belongs to the query it was made under: typing resets it to
  // the first row. Records land later (debounced) and append at the end, so
  // they never move it.
  const [sel, setSel] = useState<{ q: string; i: number }>({ q: '', i: 0 });
  const selected = sel.q === query ? Math.min(sel.i, Math.max(rows.length - 1, 0)) : 0;

  const run = useCallback((row: Row | undefined) => {
    if (!row) return;
    const ref = row.ref;
    switch (ref.kind) {
      case 'project':
        onRan(query);
        onClose();
        router.push(routeHref('/project-detail', { id: ref.id }));
        return;
      case 'create':
        onRan(query);
        onClose();
        if (ref.projectId) pushCreateOption(router, ref.option, ref.projectId, true);
        else pushUnscopedCreateOption(router, ref.option);
        return;
      case 'needs-project':
        onRan(query);
        onClose();
        router.push(routeHref('/', { openCreate: '1' }));
        return;
      case 'ask':
        onRan(query);
        onClose();
        openAsk({ seed: ref.seed });
        return;
      case 'feature':
        // 'Go to → Ask MAGE' means the same as every other Ask row: open the
        // dock beside the page (openAsk falls back to /ask where it can't show).
        if (ref.hit.entry.id === 'ask-mage') { onRan(query); onClose(); openAsk(); return; }
        onFeature(ref.hit.entry);
        return;
      case 'record':
        onResult(ref.result);
        return;
      case 'brain':
        if (ref.action === 'ask') { onClose(); openAsk(); }
        else if (ref.action === 'voice') onVoice();
        else if (ref.action === 'help') onHelp();
        else { onClose(); openShortcutSheet(); }
        return;
      case 'recent-search':
        onRecent(ref.query);
        inputRef.current?.focus();
        return;
    }
  }, [onClose, onRan, query, router, openAsk, onFeature, onResult, onVoice, onHelp, onRecent, inputRef]);

  const runSelected = useCallback(() => run(rows[selected]), [run, rows, selected]);

  const onKeyPress = useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = e.nativeEvent.key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
    // RN-web hands onKeyPress the React keydown event; stop the caret jump.
    e.preventDefault?.();
    setSel({ q: query, i: movePaletteSelection(selected, key === 'ArrowDown' ? 1 : -1, rows.length) });
  }, [query, selected, rows.length]);

  // Keep the highlighted row in view as the arrows walk past the fold.
  const scrollRef = useRef<ScrollView | null>(null);
  const rowY = useRef<Record<number, { y: number; h: number }>>({});
  const scrollTop = useRef(0);
  const viewH = useRef(0);
  useEffect(() => {
    const r = rowY.current[selected];
    if (!r || viewH.current === 0) return;
    if (r.y < scrollTop.current) scrollRef.current?.scrollTo({ y: r.y, animated: false });
    else if (r.y + r.h > scrollTop.current + viewH.current) {
      scrollRef.current?.scrollTo({ y: r.y + r.h - viewH.current, animated: false });
    }
  }, [selected]);

  const pop = webMotion('popIn');
  const cardMaxH = Math.round(winH * 0.7);
  const q = query.trim();
  const showNothing = q.length > 0 && rows.length === 0 && !isSearching;

  const iconFor = (row: Row): React.ReactNode => {
    const ref = row.ref;
    const color = row.lane === 'ask' || row.lane === 'brain' ? t.accent : t.textSecondary;
    if (ref.kind === 'record') {
      const KindIcon = kindIcon[ref.result.ref.kind];
      return <KindIcon size={16} color={color} />;
    }
    const Icon: IconCmp = ref.kind === 'project' ? Building2
      : ref.kind === 'create' ? ref.option.Icon
      : ref.kind === 'needs-project' ? FolderPlus
      : ref.kind === 'ask' ? MageAIMark
      : ref.kind === 'feature' ? featureIcon[ref.hit.entry.icon]
      : ref.kind === 'brain' ? BRAIN_ICON[ref.action]
      : Clock;
    return <Icon size={16} color={color} strokeWidth={1.75} />;
  };

  const trailing = (row: Row): React.ReactNode => {
    const ref = row.ref;
    if (ref.kind === 'feature') {
      return (
        <>
          {ref.hit.locked ? (
            <View style={styles.lockChip}><Text style={styles.lockChipText}>{ref.hit.requiredTier}</Text></View>
          ) : null}
          <Text style={styles.rowMeta} numberOfLines={1}>{GROUP_LABELS[ref.hit.entry.group]}</Text>
        </>
      );
    }
    if (ref.kind === 'record') {
      const where = ref.result.projectName ? `${ref.result.projectName} · ` : '';
      return <Text style={styles.rowMeta} numberOfLines={1}>{`${where}${kindLabel[ref.result.ref.kind]}`}</Text>;
    }
    return row.sublabel ? <Text style={styles.rowMeta} numberOfLines={1}>{row.sublabel}</Text> : null;
  };

  const a11yLabel = (row: Row): string => {
    const ref = row.ref;
    if (ref.kind === 'feature' && ref.hit.locked) return `${row.label}, requires ${ref.hit.requiredTier}`;
    return row.sublabel ? `${row.label}, ${row.sublabel}` : row.label;
  };

  let lastLane: string | null = null;

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[StyleSheet.absoluteFill, styles.scrim, { paddingLeft: scrimPadLeft, paddingTop: Math.round(winH * 0.12) }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close search"
          testID="command-palette-scrim"
        />
        <View
          style={[styles.card, { maxHeight: cardMaxH }, ...(pop ? [pop] : [])]}
          role="dialog"
          aria-label="Search"
          testID="command-palette"
        >
          <View style={styles.inputRow}>
            <SearchIcon size={18} color={t.textSecondary} strokeWidth={1.75} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Jump to a job, create something, ask MAGE"
              placeholderTextColor={t.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              autoFocus
              returnKeyType="go"
              onKeyPress={onKeyPress}
              onSubmitEditing={runSelected}
              testID="command-palette-input"
            />
            <View style={styles.kbd}><Text style={styles.kbdText}>esc</Text></View>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            onLayout={(e: LayoutChangeEvent) => { viewH.current = e.nativeEvent.layout.height; }}
            onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => { scrollTop.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={32}
            testID="command-palette-list"
          >
            {showNothing ? (
              <Text style={styles.nothing}>
                Nothing by that name. Try a job, “rfi”, “gantt”, “g702” — or ask MAGE.
              </Text>
            ) : null}
            {rows.map((row, i) => {
              const header = row.lane !== lastLane
                ? (
                  <Text key={`h:${row.lane}`} style={styles.laneLabel} testID={`command-palette-lane-${row.lane}`}>
                    {paletteLaneLabel(row.lane, activeJob?.name)}
                  </Text>
                )
                : null;
              lastLane = row.lane;
              const isSel = i === selected;
              return (
                <React.Fragment key={row.key}>
                  {header}
                  <Pressable
                    onPress={() => run(row)}
                    onHoverIn={() => setSel({ q: query, i })}
                    onLayout={(e: LayoutChangeEvent) => {
                      rowY.current[i] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height };
                    }}
                    style={[styles.row, isSel && styles.rowSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSel }}
                    aria-selected={isSel}
                    accessibilityLabel={a11yLabel(row)}
                    testID={`command-palette-row-${row.key}`}
                  >
                    {iconFor(row)}
                    <Text style={styles.rowLabel} numberOfLines={1}>{row.label}</Text>
                    {trailing(row)}
                    {isSel ? <CornerDownLeft size={14} color={t.textMuted} strokeWidth={1.75} /> : null}
                  </Pressable>
                </React.Fragment>
              );
            })}
            {q.length > 0 && isSearching ? <Text style={styles.searching}>Searching your records…</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.footerText}>↑ ↓ to move · ↵ to open · esc to close</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  scrim: {
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    paddingHorizontal: Layout.gutter,
  },
  card: {
    ...cardSurface(t, { radius: 'xl', pad: 'none' }),
    width: '100%',
    maxWidth: Layout.sheet.wide,
    overflow: 'hidden',
    ...Shadow.heavy,
  },
  inputRow: {
    height: Layout.control.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: Type.body.fontSize,
    color: t.text,
    paddingVertical: 0,
  },
  kbd: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Tokens.radius.xs,
    backgroundColor: t.surfaceAlt,
  },
  kbdText: { ...Type.monoLabel, color: t.textMuted },
  body: { flexShrink: 1 },
  bodyContent: { paddingVertical: 6 },
  laneLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: t.textMuted,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  row: {
    minHeight: Layout.control.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  rowSelected: { backgroundColor: t.surfaceAlt },
  rowLabel: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    fontWeight: '600',
    color: t.text,
  },
  rowMeta: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    maxWidth: Layout.menu.maxWidth,
  },
  lockChip: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: Tokens.radius.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.accentLabel,
  },
  lockChipText: { ...Type.monoLabel, color: t.accentLabel, textTransform: 'capitalize' },
  nothing: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  searching: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.line,
  },
  footerText: { fontSize: Type.caption1.fontSize, color: t.textMuted },
});
