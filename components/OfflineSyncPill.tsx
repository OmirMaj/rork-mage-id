// OfflineSyncPill
//
// The badge that tells a field user whether their work is saved. Renders
// nothing when the device is clear — no visual noise on the happy path.
//
// Why this matters in the field:
//   When a super dictates a daily report at the bottom of an elevator shaft,
//   the data lands in an offline queue. They want one signal: "is this saved
//   or am I going to lose it?" MAGE has always done the saving; nothing showed
//   it. NetworkErr → queued → flushed was completely invisible.
//
// ── What changed, and why the old version was not honest enough ─────────────
// This used to read hooks/useOfflineQueueDepth, which counts ONE of the three
// durable queues (text mutations) and cannot see a write that has permanently
// failed. Two consequences, both visible to a real user:
//
//   • A super with 3 queued reports, 40 unsent photos and a 90-second dictation
//     was shown "3 queued". True about one queue, false about the device.
//   • When a write exhausted its retry budget it was REMOVED from the queue, so
//     the number went DOWN. The pill got quieter as work was lost, and the only
//     trace was a toast fired during a background flush that nobody saw.
//
// It now reads hooks/useSyncStatus, which counts all three queues, reads the
// durable failure ledger (utils/syncLedger.ts), and distinguishes "we could not
// read the queue" from "the queue is empty". The words come from
// utils/syncStatusCore.computeSyncStatus so they can be pinned by a validator
// rather than drifting in JSX.
//
// Pending and failed are never summed and never share a colour: pending is
// amber and reassuring ("will sync"), failed is red and actionable ("you need
// to re-enter it"). "Sync unknown" is its own state — a badge that showed
// nothing there would be reporting an all-clear it cannot vouch for.
//
// Tapping still does not force a flush — OfflineSyncManager already retries on
// AppState wake and cold boot, and a manual button creates ambiguity ("did I
// press it? is it stuck?"). Tapping explains. On the failed state it also
// offers to dismiss the notice, which is an ACKNOWLEDGEMENT, not a recovery,
// and the prompt says exactly that.

import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CloudOff, CircleAlert, CircleHelp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

interface Props {
  /** Optional: visual variant. 'compact' shows the icon + the short count;
   *  'full' shows the whole badge sentence. */
  variant?: 'compact' | 'full';
  /**
   * Set when the pill floats over page content instead of sitting in a header
   * (app/_layout.tsx mounts it that way app-wide). The pill's own fill is a 12%
   * wash designed to composite over a solid header ground; over a scrolling
   * list the content behind it reads straight through the badge. This lays an
   * opaque surface under it so the count stays legible on any screen.
   */
  floating?: boolean;
}

export default function OfflineSyncPill({ variant = 'compact', floating = false }: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const status = useSyncStatus();
  const { tone, visible, title, detail, failed, acknowledgeFailures } = status;

  const onPress = useCallback(() => {
    if (!visible) return;
    if (tone === 'failed') {
      // Not "Retry" — there is nothing to retry. The entries are out of the
      // queue and the payloads are gone; offering a retry button would be the
      // spinner-that-lies in a different costume.
      showAlert(
        title,
        `${detail}\n\nDismissing this notice does NOT recover the data.`,
        [
          { text: 'Keep showing', style: 'cancel' },
          { text: 'Dismiss', style: 'destructive', onPress: () => { void acknowledgeFailures(); } },
        ],
      );
      return;
    }
    showAlert(title, detail);
  }, [visible, tone, title, detail, acknowledgeFailures]);

  if (!visible) return null;

  const failedTone = tone === 'failed';
  const unknownTone = tone === 'unknown';
  const label = failedTone ? themeColors.danger : Colors.warningLabel;
  const Icon = failedTone ? CircleAlert : unknownTone ? CircleHelp : CloudOff;
  // The compact form must not shorten a red badge into a bare number — "2" in
  // red beside an amber "2" for pending is the same glyph for two opposite
  // facts. Only the reassuring state gets to be a number on its own.
  const text = variant === 'full' || failedTone || unknownTone
    ? status.badge
    : String(status.pending);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={status.badge}
      accessibilityHint={failedTone ? 'Shows what could not be saved' : 'Shows what is waiting to sync'}
      testID="offline-sync-pill"
      style={floating ? styles.floatingGround : undefined}
    >
      <View style={[
        styles.pill,
        failedTone ? { backgroundColor: themeColors.danger + '1F', borderColor: themeColors.danger + '59' } : null,
      ]}>
        <Icon size={12} color={label} strokeWidth={1.75} />
        <Text style={[styles.text, failedTone ? { color: themeColors.danger } : null]} numberOfLines={1}>
          {text}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255, 159, 27, 0.12)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full,
    borderWidth: 1, borderColor: 'rgba(255, 159, 27, 0.35)',
    maxWidth: 200,
  },
  // Opaque ground UNDER the pill's 12% wash, for the app-wide floating mount
  // only. The wash was drawn to composite over a solid header; floating over a
  // scrolling list, the content behind reads straight through the count. A
  // parent layer rather than a replacement background keeps the warm tint
  // exactly as it looks in a header, with no per-theme colour arithmetic — and
  // it lives on the pill, not on a wrapper in app/_layout.tsx, so it vanishes
  // with the pill when the device is clear instead of leaving an empty chip on
  // every screen.
  floatingGround: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.full,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  text: {
    color: Colors.warningLabel,
    fontSize: Type.caption2.fontSize, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
