// ============================================================================
// components/desktop/JobSwitcher.tsx — "which job am I in", at the top of the
// desktop sidebar.
//
// A button showing the active job's name, a status dot and a chevron. It opens
// a 360 px popover: a type-to-filter box over the job list — recent jobs
// first, then in-progress, then the rest (utils/activeProject jobSwitcherList,
// proven by scripts/validate-active-project.ts). Arrow keys move, Enter picks,
// Escape closes. Every row is a RowLink, so Cmd-click opens the job in a new
// tab.
//
// Where a pick goes is the host's call (`hrefForJob`): on a project tool the
// sidebar swaps the job and stays on the tool; anywhere else — and with no
// host rule — it opens the job's Overview. A pick does not set the active job
// itself: the destination URL names the job and ActiveProjectContext follows
// the URL, so a Cmd-click that opens a NEW tab does not also switch the job in
// this one.
//
// Never bind Cmd+P (the browser's Print). The 'g j' chord and the command
// palette lane are wave 6c; both can render this list.
// ============================================================================

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, Modal, ScrollView, StyleSheet, Platform,
  type NativeSyntheticEvent, type TextInputKeyPressEventData,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { ChevronsUpDown, Check } from 'lucide-react-native';
import { useActiveProject } from '@/contexts/ActiveProjectContext';
import { useCoreData } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useHotkeys, type HotkeyBinding } from '@/hooks/useHotkeys';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { Project } from '@/types';
import { jobSwitcherList } from '@/utils/activeProject';
import { RowLink, routeHref } from '@/components/desktop/RowLink';
import { cardSurface } from '@/components/ui';

/** The popover width the web-PM audit specified: wide enough for a full job
 *  name ("Henderson Residence — kitchen + primary suite") on one line, which
 *  the 240 px rail is not. */
const POPOVER_WIDTH = 360;
const POPOVER_MAX_LIST = 420;

const STATUS_LABEL: Record<Project['status'], string> = {
  draft: 'Draft',
  estimated: 'Estimated',
  in_progress: 'In progress',
  completed: 'Completed',
  closed: 'Closed',
};

function statusDot(t: ThemeColors, status: Project['status']): string {
  switch (status) {
    case 'in_progress': return t.success;
    case 'estimated': return t.info;
    case 'completed': return t.accent;
    default: return t.textMuted;
  }
}

export interface JobSwitcherProps {
  /** Where picking `projectId` should go. Return null for the default, the
   *  job's Overview (project-detail). */
  hrefForJob?: (projectId: string) => Href | null;
}

/** See the dialog-scope note in JobSwitcher. */
const SWITCHER_DIALOG_BINDINGS: readonly HotkeyBinding[] = [{ combo: 'escape' }];

export function JobSwitcher({ hrefForJob }: JobSwitcherProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { projects } = useCoreData();
  const { activeProject, recentProjectIds } = useActiveProject();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; h: number } | null>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const list = useMemo(
    () => jobSwitcherList(projects, recentProjectIds, query),
    [projects, recentProjectIds, query],
  );
  const recentSet = useMemo(() => new Set(recentProjectIds), [recentProjectIds]);

  const hrefFor = useCallback(
    (id: string): Href => hrefForJob?.(id) ?? routeHref('/project-detail', { id }),
    [hrefForJob],
  );

  const close = useCallback(() => { setOpen(false); setQuery(''); setHighlight(0); }, []);
  // The open popover is a DIALOG to the shortcut registry (hooks/useHotkeys).
  // The registry hears an Esc typed in the search box BEFORE the box's own
  // onKeyPress (capture phase), so without this a page's Esc — a SplitView
  // record, a table search — would fire too and the switch would also close
  // the record behind it. The entry has no handler: the popover's own
  // onKeyPress / onRequestClose still does the closing, exactly once.
  useHotkeys(SWITCHER_DIALOG_BINDINGS, { scope: 'dialog', enabled: open });

  const openPopover = useCallback(() => {
    const node = anchorRef.current;
    const show = (x: number, y: number, h: number) => { setAnchor({ x, y, h }); setOpen(true); };
    if (node && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x, y, _w, h) => show(x, y, h));
    } else {
      show(12, 120, 40);
    }
  }, []);

  const pick = useCallback((id: string) => {
    close();
    router.push(hrefFor(id));
  }, [close, router, hrefFor]);

  const onKeyPress = useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = e.nativeEvent.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      (e as unknown as { preventDefault?: () => void }).preventDefault?.();
      setHighlight(h => {
        if (list.length === 0) return 0;
        return key === 'ArrowDown' ? (h + 1) % list.length : (h - 1 + list.length) % list.length;
      });
    } else if (key === 'Escape') {
      close();
    }
  }, [list.length, close]);

  const label = activeProject?.name ?? 'Pick a job';

  // Section headers are derived from the list order, so they can never
  // disagree with it: recent ids first, then in-progress, then the rest.
  const sectionFor = (p: Project) =>
    recentSet.has(p.id) ? 'RECENT' : p.status === 'in_progress' ? 'IN PROGRESS' : 'OTHER JOBS';

  return (
    <>
      <Pressable
        ref={anchorRef}
        onPress={open ? close : openPopover}
        style={(s) => [styles.trigger, (s as { hovered?: boolean }).hovered && styles.triggerHovered]}
        accessibilityRole="button"
        accessibilityLabel={activeProject ? `Current job: ${activeProject.name}. Switch job` : 'Pick a job'}
        accessibilityState={{ expanded: open }}
        testID="job-switcher"
      >
        <View
          style={[styles.dot, { backgroundColor: activeProject ? statusDot(t, activeProject.status) : 'transparent' }]}
        />
        <Text style={[styles.triggerText, !activeProject && styles.triggerTextEmpty]} numberOfLines={1}>
          {label}
        </Text>
        <ChevronsUpDown size={14} color={RAIL_INK.muted} strokeWidth={2} />
      </Pressable>

      <Modal visible={open} transparent animationType="none" onRequestClose={close}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close job switcher" />
        <View
          style={[styles.popover, {
            left: anchor?.x ?? 12,
            top: (anchor?.y ?? 120) + (anchor?.h ?? 40) + 4,
          }]}
          testID="job-switcher-popover"
        >
          <TextInput
            value={query}
            onChangeText={(v) => { setQuery(v); setHighlight(0); }}
            onKeyPress={onKeyPress}
            onSubmitEditing={() => { const p = list[highlight]; if (p) pick(p.id); }}
            placeholder="Find a job…"
            placeholderTextColor={t.textMuted}
            autoFocus
            style={styles.input}
            accessibilityLabel="Filter jobs"
            testID="job-switcher-filter"
          />
          <ScrollView style={{ maxHeight: POPOVER_MAX_LIST }} keyboardShouldPersistTaps="handled">
            {list.length === 0 ? (
              <Text style={styles.empty}>
                {query.trim()
                  ? `No open job matches "${query.trim()}".`
                  : 'No open jobs yet. Closed and sample jobs stay on the Projects page.'}
              </Text>
            ) : list.map((p, i) => {
              const header = i === 0 || sectionFor(list[i - 1]) !== sectionFor(p) ? sectionFor(p) : null;
              const isActive = p.id === activeProject?.id;
              return (
                <React.Fragment key={p.id}>
                  {header ? <Text style={styles.section}>{header}</Text> : null}
                  <RowLink
                    href={hrefFor(p.id)}
                    onPress={close}
                    selected={isActive}
                    style={(s) => [styles.row, (i === highlight || s.hovered) && styles.rowHighlighted]}
                    accessibilityLabel={`${p.name}, ${STATUS_LABEL[p.status]}${isActive ? ', current job' : ''}`}
                    testID={`job-switcher-row-${p.id}`}
                  >
                    <View style={[styles.dot, { backgroundColor: statusDot(t, p.status) }]} />
                    <View style={styles.rowText}>
                      <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>{STATUS_LABEL[p.status]}</Text>
                    </View>
                    {isActive ? <Check size={14} color={t.accent} strokeWidth={2.2} /> : null}
                  </RowLink>
                </React.Fragment>
              );
            })}
          </ScrollView>
          {Platform.OS === 'web' ? (
            <Text style={styles.hint}>↑ ↓ to move · Enter to open · Esc to close</Text>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

/** The trigger sits on the sidebar's own dark ground (DesktopSidebar paints
 *  it in both themes), so it takes the rail's white-alpha inks rather than
 *  theme tokens — the same self-darkening-chrome rule the sidebar follows. */
const RAIL_INK = {
  text: 'rgba(255,255,255,0.92)',
  muted: 'rgba(255,255,255,0.5)',
  fill: 'rgba(255,255,255,0.06)',
  fillHover: 'rgba(255,255,255,0.1)',
  line: 'rgba(255,255,255,0.08)',
} as const;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 40, paddingHorizontal: 12, marginBottom: 6,
    borderRadius: Tokens.radius.md, borderWidth: 1,
    borderColor: RAIL_INK.line, backgroundColor: RAIL_INK.fill,
  },
  triggerHovered: { backgroundColor: RAIL_INK.fillHover },
  triggerText: {
    flex: 1, color: RAIL_INK.text,
    fontSize: Type.bodyCompact.fontSize, fontWeight: '600',
  },
  triggerTextEmpty: { color: RAIL_INK.muted, fontWeight: '500' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  popover: {
    ...cardSurface(t, { radius: 'card', pad: 8 }),
    position: 'absolute', width: POPOVER_WIDTH,
    ...Tokens.shadow.heavy,
  },
  input: {
    height: 36, paddingHorizontal: 10, marginBottom: 6,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
    backgroundColor: t.bg, color: t.text, fontSize: Type.bodyCompact.fontSize,
  },
  section: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: t.textMuted,
    paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    minHeight: 40, paddingHorizontal: 8, borderRadius: Tokens.radius.md,
  },
  rowHighlighted: { backgroundColor: t.surfaceAlt },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },
  rowMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  empty: { fontSize: Type.footnote.fontSize, color: t.textSecondary, padding: 10, lineHeight: 18 },
  hint: { fontSize: Type.caption2.fontSize, color: t.textMuted, paddingHorizontal: 8, paddingTop: 6 },
});
