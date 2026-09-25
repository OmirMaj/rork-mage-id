// Sheet — the frame every Modal card and bottom sheet should use.
//
// WHY. RN-web mounts every Modal `position: fixed` over the WHOLE window,
// sidebar included (react-native-web ModalContent.js). About 130 files
// hand-roll a transparent-Modal card with no width cap, so on a 1512 px
// MacBook the schedule Edit Task sheet is ~2,056 px wide with Duration and
// Crew Size boxes ~1,000 px each, and the scrim greys out the navigation.
// (The web-PM audit called this primitive "AdaptiveSheet"; it is the same
// thing and lives here, once.)
//
// TWO WAYS IN.
//
// 1. `useSheetFrame(size, { visible, animationType })` for the existing
//    hand-rolled sheets — append its styles, change nothing else:
//
//      const f = useSheetFrame('form', { visible, animationType: 'slide' });
//      <Modal visible={visible} transparent animationType={f.animationType} …>
//        <Pressable style={[styles.overlay, f.overlay]} …>
//          <View style={[styles.bottomSheet, f.card]}>
//            {f.showHandle && <View style={styles.handle} />}
//            …
//            <View style={[styles.actions, f.footer]}>
//              <TouchableOpacity style={[styles.btn, f.footerButton]} …>
//
//    PHONE: every style is null, showHandle is true, animationType is the
//    caller's own and `transparent` is undefined — so each array flattens to
//    today's sheet, byte for byte.
//
// 2. `<Sheet>` for new code: title, body, footer actions, all of the below.
//
// DESKTOP (web >= 900):
//   - a centred card: width min(Layout.sheet[size], column − 64), maxHeight
//     85%, Radius.xl on all four corners, padding 24, Shadow.heavy, a fade
//     instead of a slide, no drag handle;
//   - the scrim covers the whole window, sidebar included (a click there
//     dismisses, as on a phone), and the card centres in the CONTENT column
//     (the sidebar is measured from the DOM — see desktop.ts);
//   - footer buttons right-aligned (destructive far left, primary rightmost);
//   - Esc closes (RN-web's Modal calls onRequestClose on Escape, so this holds
//     for the hand-rolled sheets too, as long as they pass onRequestClose);
//   - Cmd/Ctrl+Enter and Cmd/Ctrl+S run the primary action (<Sheet> does it;
//     hand-rolled sheets call useSheetPrimaryHotkey); with no primary, Cmd+S
//     is still consumed so the browser's "Save page as…" never opens over it;
//   - an open sheet is a DIALOG to the app's one shortcut registry
//     (hooks/useHotkeys): while it is open, the page behind it hears no keys.
//     Without that, Cmd+Enter typed in the sheet ran the PAGE's Save, and the
//     Esc that closed the sheet also closed the SplitView record behind it.
//     Both hotkeys go through the registry, never a document listener:
//     react-native-web's TextInput stops keydown propagation, so a bubble
//     listener never heard Cmd+Enter typed in the field <Sheet> focuses on
//     open. The registry reads keys from fields in the capture phase.
//   - <Sheet> focuses its first input on open.
//   size 'panel' is right-docked and full height (880) — the project-detail
//   sections — and a non-transparent pageSheet Modal becomes `transparent` on
//   desktop only (f.transparent).

import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Radius, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useHotkeys, type HotkeyBinding } from '@/hooks/useHotkeys';
import { Button } from './Button';
import {
  desktopSheetFrame,
  useDesktopShellInset,
  useIsDesktop,
  useIsDesktopWeb,
  type SheetSize,
} from './desktop';
import { registerWithMotion, useReducedMotion, useRiseOnOpen } from './motion';

export type { SheetSize, SheetFrameStyles } from './desktop';
export { desktopSheetFrame } from './desktop';

type AnimationType = 'none' | 'slide' | 'fade';

export interface SheetFrame {
  /** The scrim / backdrop container. */
  overlay: ViewStyle | null;
  /** contentContainerStyle for a sheet wrapped in a ScrollView (Edit Task). */
  scrollContent: ViewStyle | null;
  /** The card itself. */
  card: ViewStyle | null;
  /** The action row. */
  footer: ViewStyle | null;
  /** Each button in the action row. */
  footerButton: ViewStyle | null;
  /** A flex:1 filler touchable beside the card: absoluteFill on desktop (the
   *  scrim behind the centred card). null on a phone. */
  backdrop: ViewStyle | null;
  /** Draw the drag handle? (phone only) */
  showHandle: boolean;
  /** 'fade' on desktop; the caller's own animation on a phone. */
  animationType: AnimationType | undefined;
  /** true on desktop (a pageSheet Modal must become transparent to centre);
   *  undefined on a phone so the caller's own value stands. */
  transparent: true | undefined;
  isDesktop: boolean;
  /** Phone + `rise`: the card's rise-into-place transform — append it to the
   *  card, which must then be an Animated.View. null at rest (until the first
   *  open after mount), under Reduce Motion, without `rise`, and on desktop
   *  (the desktop card carries its CSS entry in `card` itself). */
  cardMotion: ViewStyle | null;
}

export function useSheetFrame(
  size: SheetSize,
  opts: { visible?: boolean; animationType?: AnimationType; rise?: boolean } = {},
): SheetFrame {
  const isDesktop = useIsDesktop();
  const { colors } = useTheme();
  // Re-measured each time the sheet opens: the sidebar hides on shell-exempt
  // routes, and a sheet mounted once can open on either.
  const inset = useDesktopShellInset(isDesktop && opts.visible !== false);
  // An open sheet claims the registry's exclusive `dialog` scope, so the ~130
  // hand-rolled sheets that adopt this hook inherit it. `visible === true`
  // only: a caller that omits `visible` must not silence the page for as long
  // as the sheet component is merely MOUNTED. Desktop web only (useHotkeys
  // registers nothing on a phone or native).
  useSheetDialogScope(opts.visible === true);
  // Every hook runs before the phone return below, so hook order is fixed.
  // Only a phone sheet that opted in drives the spring: the ~100 adopters
  // without `rise` (and every desktop card) never start an animation.
  const rise = useRiseOnOpen(opts.visible === true && opts.rise === true && !isDesktop);
  // Desktop: the card pops in (a 'panel' slides in from the right) through a
  // registered CSS keyframe. RN-web's Modal unmounts on close, so it replays
  // on every open. Memoised: each registration is a new class. Reduce Motion
  // is a dependency so a mid-session toggle drops (or restores) the keyframe.
  const reduce = useReducedMotion();
  const desktopFrame = useMemo(() => {
    if (!isDesktop) return null;
    const d = desktopSheetFrame(size, colors.line, inset);
    return { ...d, card: d.card ? (reduce ? d.card : registerWithMotion(d.card, size === 'panel' ? 'slideInRight' : 'popIn')) : null };
  }, [isDesktop, size, colors.line, inset, reduce]);
  if (!isDesktop || !desktopFrame) {
    // `rise` opts a phone sheet in: the scrim cross-dissolves ('fade', kept
    // even under Reduce Motion) while the card rises the last 28 pt on its own
    // spring. Without it the frame is exactly today's.
    const rising = opts.rise === true && opts.animationType === 'slide';
    return {
      overlay: null,
      scrollContent: null,
      card: null,
      footer: null,
      footerButton: null,
      backdrop: null,
      showHandle: true,
      animationType: rising ? 'fade' : opts.animationType,
      transparent: undefined,
      isDesktop: false,
      cardMotion: rising ? rise : null,
    };
  }
  return {
    ...desktopFrame,
    showHandle: false,
    animationType: 'fade',
    transparent: true,
    isDesktop: true,
    cardMotion: null,
  };
}

/**
 * For sheets whose backdrop and card are DIRECT Modal children (pattern S):
 * a phone gets the children as they are (a Fragment adds no host node, so the
 * tree is identical); desktop wraps them in one full-window View carrying the
 * frame's overlay, which centres the card in the content column.
 */
export function SheetOverlay({ frame, children }: { frame: SheetFrame; children?: React.ReactNode }) {
  if (!frame.isDesktop) return <>{children}</>;
  return <View style={[{ flex: 1 }, frame.overlay]}>{children}</View>;
}

/**
 * The desktop scrim behind a centred card: a full-window Pressable carrying
 * the frame's backdrop (absoluteFill) in Colors.overlay. On a phone it returns
 * null, so no host node is added. Wave 6d.
 */
export function SheetScrim({ frame, onPress, label = 'Close' }: { frame: SheetFrame; onPress?: () => void; label?: string }) { if (!frame.isDesktop) return null; return <Pressable style={[{ backgroundColor: Colors.overlay }, frame.backdrop]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} />; }

const NOOP = () => {};

/**
 * The entries that make an open sheet a dialog.
 *  - Esc has NO handler on purpose: it is a listing entry, and a mounted
 *    dialog-scope entry is what makes the registry skip every page and global
 *    binding. The close itself stays RN-web's Modal (it calls onRequestClose
 *    on Escape); a handler here that called onClose would close it twice.
 *  - Cmd/Ctrl+S is a NOOP that CONSUMES the key: with the page's save
 *    silenced behind the dialog, the browser's "Save page as…" would otherwise
 *    open over the sheet. A sheet with a primary action outranks it
 *    (useSheetPrimaryHotkey, priority 1).
 */
const SHEET_DIALOG_BINDINGS: readonly HotkeyBinding[] = [
  { combo: 'escape' },
  { combo: 'mod+s', handler: NOOP },
];

/** Register the open sheet as a dialog with the shortcut registry. */
export function useSheetDialogScope(open: boolean): void {
  useHotkeys(SHEET_DIALOG_BINDINGS, { scope: 'dialog', enabled: open });
}

/**
 * Cmd/Ctrl+Enter AND Cmd/Ctrl+S → `onPrimary`, while `active`, on desktop web
 * only. For the hand-rolled sheets; <Sheet> wires it itself. A no-op on a
 * phone.
 *
 * `{ saveKey: false }` binds Cmd/Ctrl+Enter ONLY. Pass it when the primary
 * does something that leaves the app and cannot be taken back — it sends an
 * email or invite, or signs / records a signature: Cmd+S pressed out of habit
 * to "save" must never send the daily report to the owner (wave-6c
 * integration review). The dialog's own Cmd+S noop (SHEET_DIALOG_BINDINGS)
 * still swallows the key, so "Save page as…" never opens over the sheet.
 *
 * Registered in the DIALOG scope of hooks/useHotkeys, which reads keys typed
 * in a field in the capture phase (react-native-web's TextInput stops their
 * propagation) — so the shortcut works from inside the sheet's own fields, and
 * the page's save behind it does not also run. Priority 1 beats the dialog's
 * own Cmd+S noop (SHEET_DIALOG_BINDINGS). Cmd/Ctrl+Shift+Enter and plain Enter
 * are not this binding (parseCombo: an unstated shift must be up).
 */
export function useSheetPrimaryHotkey(
  active: boolean,
  onPrimary: (() => void) | null | undefined,
  opts?: { saveKey?: boolean },
) {
  const ref = useRef(onPrimary);
  ref.current = onPrimary;
  const saveKey = opts?.saveKey !== false;
  useHotkeys(
    [
      { combo: 'mod+enter', handler: () => ref.current?.(), enabled: !!onPrimary, priority: 1 },
      { combo: 'mod+s', handler: () => ref.current?.(), enabled: !!onPrimary && saveKey, priority: 1 },
    ],
    { scope: 'dialog', enabled: active },
  );
}

export interface SheetAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Shown under the actions when disabled: a blocked button says why. */
  disabledReason?: string;
  loading?: boolean;
  testID?: string;
}

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  size?: SheetSize;
  primaryAction?: SheetAction;
  secondaryAction?: SheetAction;
  /** Drawn far left on desktop, in the danger colour. */
  destructiveAction?: SheetAction;
  /** Replaces the built-in action row entirely. */
  footer?: React.ReactNode;
  /** Tap on the scrim closes. Default true. */
  dismissOnBackdrop?: boolean;
  children?: React.ReactNode;
  testID?: string;
}

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  size = 'form',
  primaryAction,
  secondaryAction,
  destructiveAction,
  footer,
  dismissOnBackdrop = true,
  children,
  testID,
}: SheetProps) {
  const f = useSheetFrame(size, { visible, animationType: 'slide', rise: true });
  const desktopWeb = useIsDesktopWeb();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const cardRef = useRef<View>(null);

  const primary = primaryAction && !primaryAction.disabled && !primaryAction.loading ? primaryAction.onPress : null;
  useSheetPrimaryHotkey(visible, primary);

  // Focus lands on the first field, so a desktop user can type immediately.
  useEffect(() => {
    if (!visible || !desktopWeb) return;
    const t = setTimeout(() => {
      const node = cardRef.current as unknown as { querySelector?: (s: string) => { focus?: () => void } | null } | null;
      node?.querySelector?.('input:not([disabled]), textarea:not([disabled]), select:not([disabled])')?.focus?.();
    }, 30);
    return () => clearTimeout(t);
  }, [visible, desktopWeb]);

  const blocked = [destructiveAction, secondaryAction, primaryAction]
    .filter((a): a is SheetAction => !!a && !!a.disabled && !!a.disabledReason)
    .map((a) => a.disabledReason as string);

  const actions = footer ?? (primaryAction || secondaryAction || destructiveAction ? (
    <View style={[styles.footer, f.footer]}>
      {destructiveAction ? (
        <Button
          label={destructiveAction.label}
          onPress={destructiveAction.onPress}
          variant="destructive"
          disabled={destructiveAction.disabled}
          loading={destructiveAction.loading}
          fullWidth={!f.isDesktop}
          style={f.footerButton ?? undefined}
          testID={destructiveAction.testID}
        />
      ) : null}
      {/* Desktop: the destructive action is pushed far left, the rest right. */}
      {f.isDesktop && destructiveAction ? <View style={styles.spacer} /> : null}
      {secondaryAction ? (
        <Button
          label={secondaryAction.label}
          onPress={secondaryAction.onPress}
          variant="secondary"
          disabled={secondaryAction.disabled}
          loading={secondaryAction.loading}
          fullWidth={!f.isDesktop}
          style={f.footerButton ?? undefined}
          testID={secondaryAction.testID}
        />
      ) : null}
      {primaryAction ? (
        <Button
          label={primaryAction.label}
          onPress={primaryAction.onPress}
          disabled={primaryAction.disabled}
          loading={primaryAction.loading}
          fullWidth={!f.isDesktop}
          style={f.footerButton ?? undefined}
          testID={primaryAction.testID}
        />
      ) : null}
    </View>
  ) : null);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={f.animationType}
      onRequestClose={onClose}
      testID={testID}
    >
      <View style={[styles.overlay, { backgroundColor: Colors.overlay }, f.overlay]}>
        {/* The scrim is its own layer so a click on the card never closes it. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={dismissOnBackdrop ? onClose : undefined}
          accessibilityRole="button"
          accessibilityLabel="Close"
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <Animated.View
          ref={cardRef}
          style={[
            styles.card,
            !f.isDesktop && { paddingBottom: Math.max(insets.bottom, 12) + 8 },
            f.card,
            f.cardMotion,
          ]}
        >
          {f.showHandle ? <View style={styles.handle} /> : null}
          {title || subtitle ? (
            <View style={styles.header}>
              <View style={styles.headerText}>
                {title ? <Text style={styles.title} accessibilityRole="header">{title}</Text> : null}
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={styles.close}
                testID={testID ? `${testID}-close` : undefined}
              >
                <X size={18} color={colors.textSecondary} strokeWidth={2} />
              </Pressable>
            </View>
          ) : null}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {blocked.length > 0 ? (
            <Text style={styles.blocked} accessibilityLiveRegion="polite">{blocked.join(' ')}</Text>
          ) : null}
          {actions}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    card: {
      backgroundColor: t.bg,
      borderTopLeftRadius: Radius.xl,
      borderTopRightRadius: Radius.xl,
      paddingHorizontal: 20,
      paddingTop: 8,
      maxHeight: '90%',
      ...Tokens.continuousCorners,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 5,
      borderRadius: Radius.full,
      backgroundColor: t.line,
      marginBottom: 12,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      marginBottom: 12,
    },
    headerText: { flex: 1, gap: 2 },
    title: { ...Type.headline, color: t.text },
    subtitle: { ...Type.footnote, color: t.textSecondary },
    close: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Radius.full,
      backgroundColor: t.surfaceAlt,
    },
    body: { flexGrow: 0, flexShrink: 1 },
    bodyContent: { paddingBottom: 12 },
    blocked: { ...Type.caption1, color: t.textSecondary, marginBottom: 8 },
    footer: { gap: 8, paddingTop: 8 },
    spacer: { flex: 1 },
  });

export default Sheet;
