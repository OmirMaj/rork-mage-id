// ============================================================================
// components/EntityActionSheet.tsx
//
// Cross-platform action sheet for an EntityRef. Long-press any list row, set
// the ref in state, and render <EntityActionSheet ref={ref} onClose={...} />.
//
// - iOS:     native ActionSheetIOS (inherits system look + destructive style).
// - Android/web: modal with a button list (+ dim backdrop).
//
// The sheet reads the action catalog from `utils/entityActions.ts` and wires
// the verbs itself (Open → navigate; Copy link → clipboard; Share → Share API;
// Mark complete / Duplicate / Delete → caller-provided `onAction` callback).
// Consumers that don't need state mutations can omit `onAction` — the sheet
// still handles Open / Copy / Share on its own.
// ============================================================================

import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, Pressable,
  ActionSheetIOS, Platform, Share, Alert,
} from 'react-native';
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
  getEntityActions, getEntityDeepLink, getEntityShareBody,
  type EntityAction, type EntityActionId,
} from '@/utils/entityActions';
import { formatEntityLabel } from '@/utils/entityResolver';
import { useProjects } from '@/contexts/ProjectContext';
import type { EntityRef } from '@/types';
import type { EntityStore } from '@/utils/entityResolver';
import { copyToClipboard } from '@/utils/clipboard';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface EntityActionSheetProps {
  /** The ref to act on. Pass `null` to hide the sheet. */
  entityRef: EntityRef | null;
  /** Called whenever the sheet is dismissed (after action or cancel). */
  onClose: () => void;
  /**
   * Optional callback for actions the sheet can't wire itself.
   * Called with the action id and the ref. Open / Copy / Share are handled
   * internally and do NOT invoke this — set `onAction` only to handle
   * markComplete / duplicate / delete.
   */
  onAction?: (id: EntityActionId, ref: EntityRef) => void;
  /** Optional filter — drop any actions whose id isn't in the allowlist. */
  allowed?: EntityActionId[];
}

const ICONS: Record<NonNullable<EntityAction['icon']>, React.FC<{ size: number; color: string }>> = {
  ExternalLink, Link, Share2, CheckCircle2, Copy, Trash2,
};

export default function EntityActionSheet({
  entityRef,
  onClose,
  onAction,
  allowed,
}: EntityActionSheetProps) {
  const store = useProjects() as unknown as EntityStore;
  const { navigateTo } = useEntityNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const actions = useMemo<EntityAction[]>(() => {
    if (!entityRef) return [];
    const all = getEntityActions(entityRef);
    return allowed ? all.filter(a => allowed.includes(a.id)) : all;
  }, [entityRef, allowed]);

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
        const link = getEntityDeepLink(entityRef);
        if (!link) {
          Alert.alert('No link', 'This item doesn\u2019t have a shareable link yet.');
          return;
        }
        const ok = await copyToClipboard(link);
        if (ok && Platform.OS !== 'web') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        if (!ok) {
          Alert.alert('Copy failed', 'Could not copy link to clipboard.');
        }
        return;
      }

      case 'share': {
        const body = getEntityShareBody(entityRef, title);
        try {
          if (Platform.OS === 'web') {
            if (typeof navigator !== 'undefined' && (navigator as any).share) {
              await (navigator as any).share({ title, text: body });
            } else {
              const ok = await copyToClipboard(body);
              Alert.alert(
                ok ? 'Copied' : 'Copy failed',
                ok ? 'Share text copied to clipboard.' : 'Could not copy share text.',
              );
            }
          } else {
            await Share.share({ message: body, title });
          }
        } catch (err) {
          console.log('[EntityActionSheet] share failed:', err);
        }
        return;
      }

      case 'markComplete':
      case 'duplicate':
      case 'delete':
        onAction?.(id, entityRef);
        return;

      default: {
        const _exhaustive: never = id;
        void _exhaustive;
      }
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

  // iOS renders nothing — the native sheet owns the UI.
  if (Platform.OS === 'ios') return null;

  // ---- Android / web: JS modal ---------------------------------------------
  return (
    <Modal
      visible={entityRef !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 12, 16) }]}
          onPress={e => e.stopPropagation()}
        >
          <View style={styles.handle} />
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
                style={styles.row}
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
