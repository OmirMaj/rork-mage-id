// components/desktop/ShortcutSheet.tsx — the '?' sheet: every keyboard
// shortcut that is live right now, grouped.
//
// WHY (wave 6d restore, d6r lane K1). The desktop web app grew a real keyboard
// shell — Cmd+K search, Cmd+J Ask MAGE, the 13 'g' chords, Cmd+\ for the
// sidebar, j/k in every log — and none of it was discoverable. A PM expects
// '?' to list them (Linear, GitHub, Gmail all do).
//
// It reads the ONE shortcut registry (hooks/useHotkeys hotkeys.list()), so it
// can never list a key that does not work or miss one a page registered:
//   • snapshot on open — list() returns a new array every call, so it is
//     never fed to useSyncExternalStore (that would re-render forever);
//   • dialog-scope rows are left out (they belong to whatever sheet is open —
//     this one, by the time it reads) and so are disabled ones;
//   • groups: App, Go to, Navigation, then the rest alphabetically (whatever
//     the page under it registered — Table j/k on a log).
//
// The open state is a tiny module store so ShellHotkeys' '?' (and anything
// else) can open it without a context: openShortcutSheet() /
// closeShortcutSheet() / useShortcutSheetOpen().

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { formatCombo, hotkeys, type ListedHotkey } from '@/hooks/useHotkeys';

// ── The open-state store ────────────────────────────────────────────────────

let sheetOpen = false;
const listeners = new Set<() => void>();
function emit(next: boolean): void {
  if (sheetOpen === next) return;
  sheetOpen = next;
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const snapshot = (): boolean => sheetOpen;

export function openShortcutSheet(): void { emit(true); }
export function closeShortcutSheet(): void { emit(false); }
export function useShortcutSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// ── Grouping (pure) ─────────────────────────────────────────────────────────

const GROUP_ORDER = ['App', 'Go to', 'Navigation'];

export interface ShortcutGroup { group: string; rows: ListedHotkey[] }

/** The listed rows the sheet shows, grouped in its order. Exported for tests. */
export function groupShortcuts(rows: readonly ListedHotkey[]): ShortcutGroup[] {
  const byGroup = new Map<string, ListedHotkey[]>();
  for (const r of rows) {
    if (r.scope === 'dialog' || !r.enabled) continue;
    const list = byGroup.get(r.group) ?? [];
    list.push(r);
    byGroup.set(r.group, list);
  }
  const rank = (g: string) => {
    const i = GROUP_ORDER.indexOf(g);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  return [...byGroup.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([group, list]) => ({ group, rows: list }));
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

// ── The sheet ───────────────────────────────────────────────────────────────

export function ShortcutSheet() {
  const visible = useShortcutSheetOpen();
  const styles = useThemedStyles(makeStyles);
  const [rows, setRows] = useState<ListedHotkey[]>([]);

  // Snapshot the registry each time it opens (never a live subscription:
  // list() is a fresh array per call).
  useEffect(() => {
    if (visible) setRows(hotkeys.list());
  }, [visible]);

  const groups = useMemo(() => groupShortcuts(rows), [rows]);

  return (
    <Sheet size="form" title="Keyboard shortcuts" visible={visible} onClose={closeShortcutSheet} testID="shortcut-sheet">
      {groups.map(({ group, rows: list }) => (
        <View key={group} style={styles.group} testID={`shortcut-group-${group}`}>
          <Text style={styles.groupLabel} accessibilityRole="header">{group}</Text>
          {list.map((r) => (
            <View key={`${r.scope}|${r.combo}`} style={styles.row}>
              <Text style={styles.rowLabel} numberOfLines={1}>{r.label}</Text>
              <View style={styles.kbd}>
                <Text style={styles.kbdText}>{formatCombo(r.combo, IS_MAC)}</Text>
              </View>
            </View>
          ))}
        </View>
      ))}
    </Sheet>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  group: { marginBottom: Layout.groupGap },
  groupLabel: { ...Type.footnoteEmphasized, color: t.textSecondary, letterSpacing: 0.4, marginBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Layout.rowGap,
    minHeight: Layout.control.row,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  rowLabel: { ...Type.bodyCompact, color: t.text, flex: 1 },
  // The key cap: surfaceAlt, not a themed card (validate-ui-adoption counts
  // `surface` + a radius).
  kbd: {
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.xs,
    paddingHorizontal: 6, height: 22, alignItems: 'center', justifyContent: 'center',
  },
  kbdText: { ...Type.caption1, fontWeight: '600', color: t.text },
});
