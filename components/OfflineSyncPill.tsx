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
// Tapping still does not force a flush of the QUEUE — OfflineSyncManager
// already retries on AppState wake and cold boot, and a manual button creates
// ambiguity ("did I press it? is it stuck?"). Tapping explains.
//
// #1 (wave 4): on the failed state it opens a sheet, one row per record that
// is NOT saved to MAGE, with the reason. A row whose payload the ledger kept
// offers Retry (it is resent exactly as it was, through the normal write path)
// and Discard (removed from this phone for good, after a confirm that says
// so). Nothing is ever resent without that tap. A row the ledger cannot resend
// (a photo, a dictation, a note from before payloads were kept) offers only
// Dismiss — an ACKNOWLEDGEMENT, not a recovery, and the prompt says exactly
// that.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CloudOff, CircleAlert, CircleHelp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { Button } from '@/components/ui';
import { discardConfirmBody, type UnsavedLine } from '@/utils/syncStatusCore';
import { onSyncSheetRequested } from '@/utils/syncLedger';

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
  const { tone, visible, title, detail, unsaved, retryUnsaved, discardUnsaved } = status;
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetOpenRef = useRef(false);
  sheetOpenRef.current = sheetOpen;
  const [busyId, setBusyId] = useState<string | null>(null);
  // Every ask for the sheet PRESENTS it, even when it is already marked open.
  // iOS shows one Modal at a time: a request made while another Modal was up
  // (the invoice's Record Payment sheet) was silently refused, sheetOpen stayed
  // true, and every later request or badge tap was a no-op — the only Retry /
  // Discard surface wedged until the app was killed. Marked open → close it,
  // then open it again on the next tick so the Modal presents afresh.
  const presentSheet = useCallback(() => {
    if (!sheetOpenRef.current) { setSheetOpen(true); return; }
    setSheetOpen(false);
    setTimeout(() => setSheetOpen(true), 0);
  }, []);
  // Another screen can ask for the sheet (the sign-out confirm offers "Review
  // unsaved first"). It still opens only while something is unsaved. Only the
  // app-wide floating pill answers — Home's header pill may be mounted in the
  // tab behind, and two sheets would stack.
  useEffect(() => (floating ? onSyncSheetRequested(presentSheet) : undefined), [floating, presentSheet]);

  const onPress = useCallback(() => {
    if (!visible) return;
    if (tone === 'failed') {
      presentSheet();
      return;
    }
    showAlert(title, detail);
  }, [visible, tone, title, detail, presentSheet]);

  const onRetry = useCallback(async (line: UnsavedLine) => {
    setBusyId(line.id);
    try {
      const out = await retryUnsaved(line.id);
      if (out === 'queued') {
        showAlert('Saved on this device', `${line.label} will be sent the next time you have signal.`);
      }
      // 'failed': the line stays exactly as it was (the replay removes a line
      // only once its resend lands or queues) — the row stays on the phone.
    } finally {
      setBusyId(null);
    }
  }, [retryUnsaved]);

  const onDiscard = useCallback((line: UnsavedLine) => {
    showAlert(
      line.canRetry ? `Discard this ${line.label.toLowerCase()}?` : 'Dismiss this notice?',
      line.canRetry
        // Worded per operation: a failed edit or delete is not a lost record.
        ? discardConfirmBody(line.discards)
        : `${line.line}.\n\nDismissing this notice does NOT recover the data — you need to re-enter it.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: line.canRetry ? 'Discard' : 'Dismiss',
          style: 'destructive',
          onPress: () => { void discardUnsaved(line.id); },
        },
      ],
    );
  }, [discardUnsaved]);

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
    <>
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
      <Modal
        visible={sheetOpen && failedTone}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet} testID="offline-sync-sheet">
            <Text style={styles.sheetTitle}>{title}</Text>
            {/* The rows below ARE the "What failed" list — not repeated. */}
            <Text style={styles.sheetDetail}>
              {detail.split('\n\n').filter((p) => !p.startsWith('What failed')).join('\n\n')}
            </Text>
            <ScrollView style={styles.rows}>
              {unsaved.map((line) => (
                <View key={line.id} style={styles.row}>
                  <Text style={styles.rowLabel}>
                    {line.writes > 1 ? `${line.label} (${line.writes} changes)` : line.label}
                  </Text>
                  <Text style={styles.rowReason}>{line.line}</Text>
                  <View style={styles.rowActions}>
                    {line.canRetry ? (
                      <Button
                        label="Retry"
                        variant="secondary"
                        size="sm"
                        loading={busyId === line.id}
                        disabled={busyId !== null && busyId !== line.id}
                        onPress={() => { void onRetry(line); }}
                        testID={`offline-sync-retry-${line.id}`}
                      />
                    ) : null}
                    <Button
                      label={line.canRetry ? 'Discard' : 'Dismiss'}
                      variant="ghost"
                      size="sm"
                      disabled={busyId !== null}
                      onPress={() => onDiscard(line)}
                      testID={`offline-sync-discard-${line.id}`}
                    />
                  </View>
                </View>
              ))}
            </ScrollView>
            <Button label="Close" variant="ghost" onPress={() => setSheetOpen(false)} fullWidth />
          </View>
        </View>
      </Modal>
    </>
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
  backdrop: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: Colors.overlay,
  },
  sheet: {
    backgroundColor: t.surface,
    borderTopLeftRadius: Tokens.radius.panel, borderTopRightRadius: Tokens.radius.panel,
    padding: Tokens.spacing.md, paddingBottom: Tokens.spacing.xl,
    maxHeight: '80%', gap: Tokens.spacing.sm,
  },
  sheetTitle: { ...Type.headline, color: t.text },
  sheetDetail: { ...Type.footnote, color: t.textSecondary },
  rows: { flexGrow: 0 },
  row: {
    paddingVertical: Tokens.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
    gap: Tokens.spacing.xxs,
  },
  rowLabel: { ...Type.subheadEmphasized, color: t.text },
  rowReason: { ...Type.footnote, color: t.dangerLabel },
  rowActions: { flexDirection: 'row', gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xxs },
});
