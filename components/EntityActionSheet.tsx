// ============================================================================
// components/EntityActionSheet.tsx
//
// Cross-platform action sheet for an EntityRef. Long-press any list row, set
// the ref in state, and render <EntityActionSheet ref={ref} onClose={...} />.
//
// - iOS:     native ActionSheetIOS (inherits system look + destructive style).
// - Android/web: modal with a button list (+ dim backdrop).
// - Desktop web (wave 6d, B1): with an `anchor` (the pointer, a ⋯ press) a
//   220–280 px popover at that point, no dim, flipped up near the bottom edge
//   and clamped at the right (utils/popoverPosition); without one, the
//   centred 440 dialog (useSheetFrame 'dialog'). Esc and an outside click close
//   both; the open menu is a dialog to the shortcut registry.
//
// The sheet reads the action catalog from `utils/entityActions.ts` and wires
// the verbs itself: Open → navigate; Copy link / Share → an https link on the
// web-app origin; Mark complete / Delete → the ProjectContext mutator for the
// kinds listed in entityActions SHEET_WIRED (RFI close, punch close + delete).
// Any other mutating verb is shown ONLY when the caller names it in
// `callerVerbs` and handles it in `onAction`. A verb nobody performs is not
// offered — audit round 2 #34 found Duplicate, Mark complete and a red Delete
// that closed the sheet and did nothing on the project page and activity feed.
// ============================================================================

import React, { useMemo, useState } from 'react';
import {View, Text, StyleSheet, Modal, TouchableOpacity, Pressable, ActionSheetIOS, Platform, Dimensions, type LayoutChangeEvent} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ExternalLink, Link, Share2, CheckCircle2, Copy, Trash2, X,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import {
  getRunnableEntityActions, getEntityDeepLink, getEntityShareBody,
  sheetWiresVerb, rfiClosePatch, punchClosePatch,
  type EntityAction, type EntityActionId,
} from '@/utils/entityActions';
import { shareText } from '@/utils/shareText';
import { formatEntityLabel } from '@/utils/entityResolver';
import { useProjects } from '@/contexts/ProjectContext';
import type { EntityRef, PunchItem, RFI } from '@/types';
import type { EntityStore } from '@/utils/entityResolver';
import { copyToClipboard } from '@/utils/clipboard';
import { Type } from '@/constants/typography';
import { Layout, Shadow, Tokens } from '@/constants/designTokens';
import { cardSurface, useIsDesktopWeb, useSheetFrame } from '@/components/ui';
import { popoverPosition } from '@/utils/popoverPosition';
import { showAlert } from '@/utils/alert';

export interface EntityActionSheetProps {
  /** The ref to act on. Pass `null` to hide the sheet. */
  entityRef: EntityRef | null;
  /** Called whenever the sheet is dismissed (after action or cancel). */
  onClose: () => void;
  /**
   * Callback for the mutating verbs the sheet can't wire itself. It is only
   * ever called for a verb listed in `callerVerbs` — and only those verbs are
   * shown — so passing `onAction` can no longer surface a menu item that the
   * handler quietly ignores. Open / Copy / Share never reach it.
   */
  onAction?: (id: EntityActionId, ref: EntityRef) => void;
  /** The verbs `onAction` really performs for the current `entityRef`. */
  callerVerbs?: EntityActionId[];
  /** Optional filter — drop any actions whose id isn't in the allowlist. */
  allowed?: EntityActionId[];
  /**
   * Desktop web: open as a popover at this page point (a ⋯ press or a
   * right-click). Without it desktop gets the centred dialog; ignored on
   * native and on a phone-width web window.
   */
  anchor?: { x: number; y: number } | null;
}

/** The window a popover must stay inside (ScheduleRowMenu's windowViewport). */
function windowViewport(): { width: number; height: number } {
  const w = typeof window !== 'undefined' ? (window as { innerWidth?: number; innerHeight?: number }) : undefined;
  const d = Dimensions.get('window');
  return { width: w?.innerWidth || d.width, height: w?.innerHeight || d.height };
}

/** window.location.origin on web (so a deploy preview links to itself); null elsewhere. */
function runtimeOrigin(): string | null {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null;
}

const ICONS: Record<NonNullable<EntityAction['icon']>, React.FC<{ size: number; color: string }>> = {
  ExternalLink, Link, Share2, CheckCircle2, Copy, Trash2,
};

export default function EntityActionSheet({
  entityRef,
  onClose,
  onAction,
  callerVerbs,
  allowed,
  anchor,
}: EntityActionSheetProps) {
  const projectsCtx = useProjects();
  const store = projectsCtx as unknown as EntityStore;
  const { rfis, punchItems, updateRFI, updatePunchItem, deletePunchItem } = projectsCtx;
  const { navigateTo } = useEntityNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // The live record, for the kinds the sheet mutates itself — its status
  // decides whether "Mark complete" is still meaningful, and RFI close needs
  // its ball-in-court + hand-off log.
  const record = useMemo<RFI | PunchItem | undefined>(() => {
    if (!entityRef) return undefined;
    if (entityRef.kind === 'rfi') return (rfis as RFI[]).find(r => r.id === entityRef.id);
    if (entityRef.kind === 'punchItem') return (punchItems as PunchItem[]).find(p => p.id === entityRef.id);
    return undefined;
  }, [entityRef, rfis, punchItems]);

  const actions = useMemo<EntityAction[]>(() => {
    if (!entityRef) return [];
    const all = getRunnableEntityActions(entityRef, {
      callerVerbs: onAction ? callerVerbs : [],
      status: record?.status,
    }).filter(a => {
      // A self-wired verb needs the record in the store; a ref whose row is
      // not loaded (another device's, or just deleted) cannot be closed here.
      if (a.id === 'open' || a.id === 'copyLink' || a.id === 'share') return true;
      if (onAction && callerVerbs?.includes(a.id)) return true;
      return sheetWiresVerb(entityRef.kind, a.id) && !!record;
    });
    return allowed ? all.filter(a => allowed.includes(a.id)) : all;
  }, [entityRef, allowed, onAction, callerVerbs, record]);

  const title = useMemo(
    () => (entityRef ? formatEntityLabel(entityRef, store) : ''),
    [entityRef, store],
  );

  const run = async (id: EntityActionId) => {
    if (!entityRef) return;
    onClose();

    if (Platform.OS !== 'web') void Haptics.selectionAsync();

    switch (id) {
      case 'open':
        navigateTo(entityRef);
        return;

      case 'copyLink': {
        const link = getEntityDeepLink(entityRef, runtimeOrigin());
        if (!link) {
          showAlert('No link', 'This item doesn\u2019t have a shareable link yet.');
          return;
        }
        const ok = await copyToClipboard(link);
        if (ok && Platform.OS !== 'web') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        if (!ok) {
          showAlert('Copy failed', 'Could not copy link to clipboard.');
        }
        return;
      }

      case 'share': {
        const body = getEntityShareBody(entityRef, title, runtimeOrigin());
        try {
          if (Platform.OS === 'web') {
            if (typeof navigator !== 'undefined' && (navigator as any).share) {
              await (navigator as any).share({ title, text: body });
            } else {
              const ok = await copyToClipboard(body);
              showAlert(
                ok ? 'Copied' : 'Copy failed',
                ok ? 'Share text copied to clipboard.' : 'Could not copy share text.',
              );
            }
          } else {
            await shareText({ message: body, title });
          }
        } catch (err) {
          console.log('[EntityActionSheet] share failed:', err);
        }
        return;
      }

      case 'markComplete':
      case 'duplicate':
      case 'delete': {
        // The caller's handler wins for the verbs it claims (Home's project
        // Duplicate). Everything else offered here is self-wired — the
        // `actions` memo never lists a verb neither side performs.
        if (onAction && callerVerbs?.includes(id)) {
          onAction(id, entityRef);
          return;
        }
        runSelfWired(id, entityRef);
        return;
      }

      default: {
        const _exhaustive: never = id;
        void _exhaustive;
      }
    }
  };

  const runSelfWired = (id: EntityActionId, ref: EntityRef) => {
    const now = new Date().toISOString();
    if (ref.kind === 'rfi' && id === 'markComplete') {
      const rfi = record as RFI | undefined;
      if (!rfi) return;
      // #31: one tap closed an unanswered RFI with no confirm. Closing with an
      // answer on record goes straight through; closing with none asks first
      // (it can be reopened from the RFI screen, but a closed RFI drops off
      // the chase list and the architect's reply link stops taking answers).
      if (!(rfi.response ?? '').trim()) {
        showAlert(
          'Close this RFI without a response?',
          `${title} has no response on record. Closed, it drops off the chase list and the reply link stops taking answers. You can reopen it from the RFI screen.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Close RFI', style: 'destructive', onPress: () => updateRFI(ref.id, rfiClosePatch(rfi, new Date().toISOString())) },
          ],
        );
        return;
      }
      updateRFI(ref.id, rfiClosePatch(rfi, now));
      return;
    }
    if (ref.kind === 'punchItem' && id === 'markComplete') {
      if (!record) return;
      updatePunchItem(ref.id, punchClosePatch(now));
      return;
    }
    if (ref.kind === 'punchItem' && id === 'delete') {
      if (!record) return;
      // A red Delete deletes — after a confirm, like app/punch-list.tsx,
      // because the delete syncs to every device and cannot be undone.
      showAlert('Delete punch item?', `${title} will be removed from the punch list on every device. This can't be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deletePunchItem(ref.id) },
      ]);
      return;
    }
  };

  // ---- iOS: native action sheet --------------------------------------------
  React.useEffect(() => {
    if (Platform.OS !== 'ios') return;
    if (!entityRef) return;

    const options = [...actions.map(a => a.label), 'Cancel'];
    const destructiveButtonIndex = actions.findIndex(a => a.destructive);
    const cancelButtonIndex = options.length - 1;

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex,
        destructiveButtonIndex: destructiveButtonIndex >= 0 ? destructiveButtonIndex : undefined,
        title,
      },
      (buttonIndex) => {
        if (buttonIndex === cancelButtonIndex) {
          onClose();
          return;
        }
        const picked = actions[buttonIndex];
        if (picked) void run(picked.id);
      },
    );
    // `actions` reference changes when entityRef changes — effect re-runs as
    // expected. We intentionally don't re-subscribe on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityRef]);

  // Desktop web: the popover (anchor) or the centred dialog (no anchor). The
  // frame also makes the open menu a dialog-scope entry for Esc; the Modal's
  // onRequestClose closes it. Every hook sits above the iOS return.
  const isDesktopWeb = useIsDesktopWeb();
  const f = useSheetFrame('dialog', { visible: entityRef !== null, animationType: 'fade' });
  const [menuH, setMenuH] = useState<number | null>(null);
  const pop = isDesktopWeb && anchor
    ? popoverPosition(anchor, { height: menuH ?? 40 + actions.length * Layout.control.row + 8 }, windowViewport())
    : null;
  const onMenuLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    setMenuH((prev) => (prev === next ? prev : next));
  };

  // iOS renders nothing — the native sheet owns the UI.
  if (Platform.OS === 'ios') return null;

  // ---- Android / web: JS modal ---------------------------------------------
  return (
    <Modal
      visible={entityRef !== null}
      transparent
      animationType={pop ? 'none' : f.animationType}
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, isDesktopWeb && pop ? styles.popoverBackdropDesktop : f.overlay]}
        onPress={onClose}
        // A right-click outside the popover closes it instead of opening the
        // browser's own menu over it (ScheduleRowMenu does the same).
        {...(isDesktopWeb ? ({ onContextMenu: (e: { preventDefault?: () => void }) => { e?.preventDefault?.(); onClose(); } } as object) : null)}
      >
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 12, 16) }, isDesktopWeb && pop ? styles.popoverDesktop : f.card, pop && { left: pop.left, top: pop.top }]}
          onPress={e => e.stopPropagation()}
          {...(pop ? { onLayout: onMenuLayout, accessibilityRole: 'menu' as const, testID: 'entity-action-popover' } : null)}
        >
          {f.showHandle && <View style={styles.handle} />}
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close" style={styles.closeBtn}>
              <X size={18} color={colors.textSecondary} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          {actions.map(action => {
            const Icon = action.icon ? ICONS[action.icon] : null;
            return (
              <TouchableOpacity
                key={action.id}
                style={[styles.row, isDesktopWeb && pop && styles.rowPopoverDesktop]}
                onPress={() => run(action.id)}
                activeOpacity={0.7}
                testID={`entity-action-${action.id}`}
              >
                {Icon ? (
                  <View style={[styles.rowIcon, action.destructive && styles.rowIconDestructive]}>
                    <Icon size={18} color={action.destructive ? colors.danger : colors.text} />
                  </View>
                ) : null}
                <Text style={[styles.rowLabel, action.destructive && styles.rowLabelDestructive]}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  // Desktop web popover: no dim behind a pointer menu.
  popoverBackdropDesktop: { backgroundColor: 'transparent' },
  popoverDesktop: {
    ...cardSurface(t, { radius: 'md', pad: 'none' }),
    position: 'absolute' as const,
    minWidth: Layout.menu.minWidth,
    maxWidth: Layout.menu.maxWidth,
    // The sheet's own corner radii and paddings are longhands, which beat a
    // shorthand whatever the order — so the popover restates them.
    borderTopLeftRadius: Tokens.radius.md,
    borderTopRightRadius: Tokens.radius.md,
    paddingTop: 4,
    paddingBottom: 4,
    paddingHorizontal: 4,
    ...Shadow.heavy,
  },
  rowPopoverDesktop: { height: Layout.control.row, paddingVertical: 0 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end' as const,
  },
  sheet: {
    backgroundColor: t.bg,
    borderTopLeftRadius: Tokens.radius.xl,
    borderTopRightRadius: Tokens.radius.xl,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center' as const,
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.line,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  title: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  closeBtn: {
    width: 30, height: 30,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    gap: 12,
  },
  rowIcon: {
    width: 34, height: 34,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rowIconDestructive: {
    backgroundColor: t.danger + '1F',
  },
  rowLabel: {
    fontSize: Type.callout.fontSize,
    color: t.text,
    fontWeight: '500' as const,
  },
  rowLabelDestructive: {
    color: t.danger,
  },
});
