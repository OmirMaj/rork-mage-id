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

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
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
import { Motion, Radius, Tokens } from '@/constants/designTokens';
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
import {
  motionCurve,
  nativeDriver,
  reducedMotion,
  registerWithMotion,
  riseValueOf,
  useReducedMotion,
  useRiseOnOpen,
} from './motion';

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
  /** The Animated.Value behind cardMotion's translateY (null whenever
   *  cardMotion is null). Only for a card that composes its own offset with
   *  the rise — <Sheet>'s drag-to-dismiss. Adopters ignore it. */
  riseY: Animated.Value | null;
}

/** How far a phone rise frame travels when the caller does not know its card's
 *  height: 45 % of the window, capped at 420 pt — a real sheet distance (the
 *  card comes up from below the screen edge), not the old 28 pt nudge. Read at
 *  each render, so the open uses the window as it is then. */
export function defaultRiseDistance(): number {
  return Math.min(Math.round(0.45 * Dimensions.get('window').height), 420);
}

export function useSheetFrame(
  size: SheetSize,
  opts: {
    visible?: boolean;
    animationType?: AnimationType;
    rise?: boolean;
    /** Phone rise frames: how far the card travels on open (its measured
     *  height, when known). Default defaultRiseDistance(). */
    riseDistance?: number;
  } = {},
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
  // The card travels a real sheet distance on Motion.spring.sheet (ζ≈1.0, no
  // overshoot over ~400 pt) while the scrim fades in place.
  const rise = useRiseOnOpen(
    opts.visible === true && opts.rise === true && !isDesktop,
    opts.riseDistance ?? defaultRiseDistance(),
    Motion.spring.sheet,
  );
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
    // `rise` opts a phone sheet in: the scrim cross-dissolves in place ('fade',
    // kept even under Reduce Motion) while the card rises from below on its
    // own spring. Without it the frame is exactly today's.
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
      riseY: rising ? riseValueOf(rise) : null,
    };
  }
  return {
    ...desktopFrame,
    showHandle: false,
    animationType: 'fade',
    transparent: true,
    isDesktop: true,
    cardMotion: null,
    riseY: null,
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
  /**
   * Default true. false while a write is in flight (a slide's busy, through
   * its result hold): no drag-to-dismiss, the X is disabled, the scrim, Esc
   * and Android back do nothing. The sheet closes itself when the answer is in.
   */
  dismissible?: boolean;
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
  dismissible = true,
  children,
  testID,
}: SheetProps) {
  // The card's measured height: the next open travels exactly that far (the
  // first open, before any layout, uses defaultRiseDistance()).
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const f = useSheetFrame(size, { visible, animationType: 'slide', rise: true, riseDistance: cardHeight ?? undefined });
  const desktopWeb = useIsDesktopWeb();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const cardRef = useRef<View>(null);
  // A sheet that cannot be dismissed (a write in flight) has no drag at all:
  // a pull would slide the card off and then the close would be refused.
  const drag = useSheetDrag(visible, dismissible && !f.isDesktop && Platform.OS !== 'web', cardHeight, onClose);
  // Until the first drag the card carries exactly the frame's cardMotion (so
  // an untouched sheet — and every golden — is unchanged); from the first grab
  // on, its translateY is the rise PLUS the drag.
  const dragMotion = useMemo<ViewStyle | null>(
    () => (drag.armed ? { transform: [{ translateY: f.riseY ? Animated.add(f.riseY, drag.value) : drag.value }] } : null),
    [drag.armed, drag.value, f.riseY],
  );

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
      onRequestClose={dismissible ? onClose : NOOP}
      testID={testID}
    >
      <View style={[styles.overlay, { backgroundColor: Colors.overlay }, f.overlay]}>
        {/* The scrim is its own layer so a click on the card never closes it. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={dismissOnBackdrop && dismissible ? onClose : undefined}
          accessibilityRole="button"
          accessibilityLabel="Close"
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <Animated.View
          ref={cardRef}
          onLayout={f.isDesktop ? undefined : (e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h > 0 && h !== cardHeight) setCardHeight(h);
          }}
          style={[
            styles.card,
            !f.isDesktop && { paddingBottom: Math.max(insets.bottom, 12) + 8 },
            f.card,
            dragMotion ?? f.cardMotion,
          ]}
        >
          {/* The handle and the header are the drag zone (never the scrolling
              body): pull down to dismiss. */}
          {f.showHandle ? <View style={styles.handle} {...drag.handlers} /> : null}
          {title || subtitle ? (
            <View style={styles.header} {...drag.handlers}>
              <View style={styles.headerText}>
                {title ? <Text style={styles.title} accessibilityRole="header">{title}</Text> : null}
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <Pressable
                onPress={onClose}
                // Only set while busy, so a dismissible sheet renders as before.
                disabled={dismissible ? undefined : true}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={dismissible ? styles.close : [styles.close, styles.closeBusy]}
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

/**
 * Drag-to-dismiss for <Sheet>'s handle + header. A vertical pull claims the
 * gesture (a tap on the header's close button still lands); the drag writes
 * `value` directly (setValue — the JS thread is idle during a drag); an
 * upward pull rubber-bands at a third. On release, past 30 % of the card or a
 * flick (vy > 0.8) slides the card off over 180 ms eased in, then closes;
 * otherwise it springs home on Motion.spring.sheet. Reduce Motion: the
 * release closes or snaps back with no animation. `enabled` is false on
 * desktop and web (no handlers, no transform ever).
 */
function useSheetDrag(visible: boolean, enabled: boolean, cardHeight: number | null, onClose: () => void) {
  const value = useRef(new Animated.Value(0)).current;
  const [armed, setArmed] = useState(false);
  const latest = useRef({ cardHeight, onClose });
  latest.current = { cardHeight, onClose };

  // Every open starts from rest — before paint, so a card dismissed by a drag
  // never flashes at its old offset.
  useLayoutEffect(() => {
    if (visible) value.setValue(0);
  }, [visible, value]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => {
      value.stopAnimation();
      value.setValue(0);
      setArmed(true);
    },
    onPanResponderMove: (_e, g) => {
      value.setValue(g.dy >= 0 ? g.dy : g.dy * 0.3);
    },
    onPanResponderRelease: (_e, g) => {
      const h = latest.current.cardHeight ?? defaultRiseDistance();
      const dismiss = g.dy > 0.3 * h || g.vy > 0.8;
      if (reducedMotion()) {
        if (dismiss) latest.current.onClose();
        else value.setValue(0);
        return;
      }
      if (dismiss) {
        Animated.timing(value, { toValue: h, duration: 180, easing: motionCurve.in, useNativeDriver: nativeDriver })
          .start(({ finished }) => { if (finished) latest.current.onClose(); });
      } else {
        Animated.spring(value, { toValue: 0, ...Motion.spring.sheet, useNativeDriver: nativeDriver }).start();
      }
    },
    onPanResponderTerminate: () => {
      if (reducedMotion()) { value.setValue(0); return; }
      Animated.spring(value, { toValue: 0, ...Motion.spring.sheet, useNativeDriver: nativeDriver }).start();
    },
  }), [value]);

  return { value, armed, handlers: enabled ? responder.panHandlers : undefined };
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
    closeBusy: { opacity: 0.4 },
    body: { flexGrow: 0, flexShrink: 1 },
    bodyContent: { paddingBottom: 12 },
    blocked: { ...Type.caption1, color: t.textSecondary, marginBottom: 8 },
    footer: { gap: 8, paddingTop: 8 },
    spacer: { flex: 1 },
  });

export default Sheet;
