// components/desktop/NoticeStrip.tsx — one 40 px line instead of a wall of banners.
//
// WHY THIS EXISTS. On the web app Home stacks up to six full-width banner cards
// (team invites, Stripe setup, onboarding, Morning Brief / Week Close, the next
// step) above the work, and Schedule Pro stacks four more (earned value, stale
// references, sub updates, weather). On a 945 px-tall laptop that pushes the
// actual list below the fold. The strip shows the ONE most important notice
// with a "1 of N" pager; the rest are a click away.
//
// Each notice keeps its own gate and its own dismissal:
//   • `visible` is the screen's existing condition, unchanged;
//   • `onDismiss` hands dismissal back to the screen (so a banner that already
//     remembers "dismissed" under its own key keeps doing so);
//   • otherwise `dismissKey` persists the dismissal here under
//     `mageid_notice_dismissed::<key>` (mageid_ prefix → swept on sign-out /
//     tenant switch, utils/localCacheKeys), so one person's dismissals never
//     hide a notice from the next person on a shared laptop.
//
// PHONE IDENTICAL: on a phone each notice that brings `renderCard` renders that
// card, in the order given, exactly as the screen stacks them today. Only a
// notice without a card gets a compact strip line.

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AlertTriangle, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Info, X } from 'lucide-react-native';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';

export type NoticeTone = 'info' | 'warn' | 'bad' | 'good';

export interface Notice {
  id: string;
  message: string;
  tone?: NoticeTone;
  /** Higher shows first. Ties keep the order given. Default 0. */
  priority?: number;
  /** The notice's own gate. Default true. */
  visible?: boolean;
  /** Screen-owned dismissal (keeps the banner's existing storage key). */
  onDismiss?: () => void;
  /** Strip-owned dismissal, persisted. Ignored when onDismiss is given. */
  dismissKey?: string;
  action?: { label: string; onPress: () => void };
  /** Phone: today's banner card, rendered unchanged. */
  renderCard?: () => React.ReactNode;
  testID?: string;
}

export function noticeDismissKey(key: string): string {
  return `mageid_notice_dismissed::${key}`;
}

/** Visible, not dismissed, highest priority first; stable for ties. */
export function orderNotices(notices: readonly Notice[], dismissed: ReadonlySet<string>): Notice[] {
  return notices
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.visible !== false && !(n.dismissKey && !n.onDismiss && dismissed.has(n.dismissKey)))
    .sort((a, b) => (b.n.priority ?? 0) - (a.n.priority ?? 0) || a.i - b.i)
    .map(({ n }) => n);
}

export interface NoticeStripProps {
  notices: readonly Notice[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function NoticeStrip({ notices, style, testID }: NoticeStripProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [index, setIndex] = useState(0);

  const persistKeys = useMemo(
    () => notices.filter((n) => n.dismissKey && !n.onDismiss).map((n) => n.dismissKey as string),
    [notices],
  );
  const persistSig = persistKeys.join('|');
  useEffect(() => {
    if (persistKeys.length === 0) return undefined;
    let alive = true;
    AsyncStorage.multiGet(persistKeys.map(noticeDismissKey))
      .then((pairs) => {
        if (!alive) return;
        const hit = new Set<string>();
        pairs.forEach(([, v], i) => { if (v) hit.add(persistKeys[i]); });
        setDismissed(hit);
      })
      .catch(() => { /* show them all */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistSig]);

  const dismiss = (n: Notice) => {
    if (n.onDismiss) { n.onDismiss(); return; }
    if (!n.dismissKey) return;
    const key = n.dismissKey;
    setDismissed((prev) => new Set(prev).add(key));
    AsyncStorage.setItem(noticeDismissKey(key), new Date().toISOString()).catch(() => { /* hidden this session only */ });
  };

  const ordered = orderNotices(notices, dismissed);

  if (!isDesktop) {
    const phone = notices.filter((n) => n.visible !== false && !(n.dismissKey && !n.onDismiss && dismissed.has(n.dismissKey)));
    return (
      <>
        {phone.map((n) => (
          <React.Fragment key={n.id}>
            {n.renderCard ? n.renderCard() : <StripLine notice={n} styles={styles} t={t} onDismiss={dismiss} />}
          </React.Fragment>
        ))}
      </>
    );
  }

  if (ordered.length === 0) return null;
  const at = Math.min(index, ordered.length - 1);
  const current = ordered[at];
  return (
    <View style={style} testID={testID}>
      <StripLine
        notice={current}
        styles={styles}
        t={t}
        onDismiss={dismiss}
        pager={ordered.length > 1 ? {
          at,
          total: ordered.length,
          prev: () => setIndex((at - 1 + ordered.length) % ordered.length),
          next: () => setIndex((at + 1) % ordered.length),
        } : undefined}
        testIDPrefix={testID}
      />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function StripLine({ notice, styles, t, onDismiss, pager, testIDPrefix }: {
  notice: Notice;
  styles: Styles;
  t: ThemeColors;
  onDismiss: (n: Notice) => void;
  pager?: { at: number; total: number; prev: () => void; next: () => void };
  testIDPrefix?: string;
}) {
  const tone = notice.tone ?? 'info';
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'bad' ? CircleAlert : tone === 'good' ? CircleCheck : Info;
  const ink = tone === 'warn' ? t.warningLabel : tone === 'bad' ? t.dangerLabel : tone === 'good' ? t.successLabel : t.textSecondary;
  const fill = tone === 'warn' ? styles.warn : tone === 'bad' ? styles.bad : tone === 'good' ? styles.good : styles.info;
  const canDismiss = !!notice.onDismiss || !!notice.dismissKey;
  return (
    <View style={[styles.strip, fill]} testID={notice.testID ?? (testIDPrefix ? `${testIDPrefix}-${notice.id}` : undefined)} accessibilityRole="alert">
      <Icon {...Tokens.iconSize.small} color={ink} />
      <Text style={styles.message} numberOfLines={1}>{notice.message}</Text>
      {notice.action ? (
        <Pressable onPress={notice.action.onPress} style={styles.action} accessibilityRole="button">
          <Text style={[styles.actionText, { color: ink }]}>{notice.action.label}</Text>
        </Pressable>
      ) : null}
      {pager ? (
        <View style={styles.pager}>
          <Pressable onPress={pager.prev} accessibilityRole="button" accessibilityLabel="Previous notice" hitSlop={6} testID={testIDPrefix ? `${testIDPrefix}-prev` : undefined}>
            <ChevronLeft {...Tokens.iconSize.small} color={t.textSecondary} />
          </Pressable>
          <Text style={styles.pagerText}>{pager.at + 1} of {pager.total}</Text>
          <Pressable onPress={pager.next} accessibilityRole="button" accessibilityLabel="Next notice" hitSlop={6} testID={testIDPrefix ? `${testIDPrefix}-next` : undefined}>
            <ChevronRight {...Tokens.iconSize.small} color={t.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      {canDismiss ? (
        <Pressable
          onPress={() => onDismiss(notice)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={8}
          testID={testIDPrefix ? `${testIDPrefix}-dismiss` : undefined}
        >
          <X {...Tokens.iconSize.small} color={t.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Layout.rowGap,
    height: Layout.control.md,
    paddingHorizontal: 12,
    borderRadius: Tokens.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  info: { backgroundColor: t.neutralSoft },
  warn: { backgroundColor: t.warningSoft },
  bad: { backgroundColor: t.dangerSoft },
  good: { backgroundColor: t.successSoft },
  message: { ...Type.bodyCompact, color: t.text, flex: 1 },
  action: { height: 28, justifyContent: 'center', paddingHorizontal: 8 },
  actionText: { ...Type.footnoteEmphasized },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pagerText: { ...Type.caption1, color: t.textSecondary, fontVariant: ['tabular-nums'] },
});
