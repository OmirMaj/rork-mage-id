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
//
// A6 (UX wave): the app-wide floating pill also says when voice notes are
// still on this phone — "1 voice note waiting" (recorded with no signal, not
// yet transcribed or not yet added to the report) and, separately and in the
// failed style, "N voice notes couldn't be transcribed". The two are never
// summed and never share a colour, the same rule as above. A tap opens
// components/VoiceBacklogSheet: each clip, its project, when it was recorded
// and where it stands. Home's header pill (not floating) does not repeat it.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CloudOff, CircleAlert, CircleHelp, Mic } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useSheetFrame } from '@/components/ui/Sheet';
import { useTheme } from '@/contexts/ThemeContext';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { Button } from '@/components/ui';
import { discardConfirmBody, type UnsavedLine } from '@/utils/syncStatusCore';
import { onSyncSheetRequested } from '@/utils/syncLedger';
import { voiceFailedLine, voiceWaitingLine } from '@/utils/audioTranscribeCore';
import VoiceBacklogSheet, { useVoiceBacklog } from '@/components/VoiceBacklogSheet';
import { useT } from '@/contexts/LanguageContext';

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
  const { t, tn, lang } = useT();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const status = useSyncStatus();
  const { tone, visible, title, detail, unsaved, retryUnsaved, discardUnsaved } = status;
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetOpenRef = useRef(false);
  sheetOpenRef.current = sheetOpen;
  const [busyId, setBusyId] = useState<string | null>(null);
  // A6: voice notes still on this phone — the floating pill only.
  const voice = useVoiceBacklog(floating);
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  // voiceWaitingLine / voiceFailedLine decide WHETHER a line shows; the words
  // are one plural key each (English identical: n === 1 → the one form).
  const voiceWaitingN = Math.max(0, voice.backlog.waiting) + Math.max(0, voice.backlog.ready);
  const voiceFailedN = Math.max(0, voice.backlog.failed);
  const voiceWaiting = floating && voiceWaitingLine(voice.backlog)
    ? tn('field.chrome.voiceWaiting', voiceWaitingN, { one: '{count} voice note waiting', other: '{count} voice notes waiting' })
    : '';
  const voiceFailed = floating && voiceFailedLine(voice.backlog)
    ? tn('field.chrome.voiceFailed', voiceFailedN, { one: "{count} voice note couldn't be transcribed", other: "{count} voice notes couldn't be transcribed" })
    : '';
  const showVoice = voiceWaiting.length > 0 || voiceFailed.length > 0;
  // Desktop web: the "what failed" sheet is a centred card beside the sidebar;
  // all-null on a phone. Above the `!visible` return, so hook order is fixed.
  const fSync = useSheetFrame('form', { visible: sheetOpen && tone === 'failed', animationType: 'slide' });
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
        // The record label is English data from the sync ledger
        // (utils/syncStatusCore), so only English grammar carries it; any
        // other language gets a label-free sentence (docs/I18N.md §3.5).
        showAlert(t('field.chrome.savedOnThisDevice', 'Saved on this device'), lang === 'en'
          // i18n-keep-english: English-only branch; the ledger label is English data, other languages read field.chrome.sendsNextSignal
          ? `${line.label} will be sent the next time you have signal.`
          : t('field.chrome.sendsNextSignal', 'It will be sent the next time you have signal.'));
      }
      // 'failed': the line stays exactly as it was (the replay removes a line
      // only once its resend lands or queues) — the row stays on the phone.
    } finally {
      setBusyId(null);
    }
  }, [retryUnsaved, t, lang]);

  const onDiscard = useCallback((line: UnsavedLine) => {
    // The record label and discardConfirmBody() are English (the sync ledger,
    // utils/syncStatusCore): English keeps them byte-identical; any other
    // language gets label-free sentences, worded per operation the same way
    // (docs/I18N.md §3.5 — no English data inside another language's grammar).
    const english = lang === 'en';
    const otherBody = (): string => {
      switch (line.discards) {
        case 'create': return t('field.chrome.discardBody.create', 'It was never saved to MAGE. Discarding removes it from this phone and it cannot be recovered.');
        case 'edit': return t('field.chrome.discardBody.edit', 'Your change was not saved to MAGE. Discarding drops the change — MAGE keeps the last saved version, and this phone goes back to it.');
        case 'delete': return t('field.chrome.discardBody.delete', 'The delete was not saved to MAGE. Discarding cancels it — the record stays on MAGE and will reappear on this phone.');
        default: return t('field.chrome.discardBody.unknown', 'This change was not saved to MAGE. Discarding drops it for good — if the record was never saved, it is removed from this phone; if it was, MAGE keeps the last saved version.');
      }
    };
    showAlert(
      line.canRetry
        ? (english
          // i18n-keep-english: English-only branch; the ledger label is English data, other languages read field.chrome.discardUnsaved
          ? `Discard this ${line.label.toLowerCase()}?`
          : t('field.chrome.discardUnsaved', 'Discard this unsaved change?'))
        : t('field.chrome.dismissThisNotice', 'Dismiss this notice?'),
      line.canRetry
        // Worded per operation: a failed edit or delete is not a lost record.
        ? (english ? discardConfirmBody(line.discards) : otherBody())
        : t('field.chrome.dismissNoticeBody', '{line}.\n\nDismissing this notice doesn’t recover the data. You need to re-enter it.', { line: line.line }),
      [
        { text: t('field.chrome.keepIt', 'Keep it'), style: 'cancel' },
        {
          text: line.canRetry ? t('field.chrome.discard', 'Discard') : t('field.chrome.dismiss', 'Dismiss'),
          style: 'destructive',
          onPress: () => { void discardUnsaved(line.id); },
        },
      ],
    );
  }, [discardUnsaved, t, lang]);

  if (!visible && !showVoice && !voiceSheetOpen) return null;

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

  const statusPill = visible ? (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={status.badge}
        accessibilityHint={failedTone ? t('field.chrome.hintFailed', 'Shows what could not be saved') : t('field.chrome.hintWaiting', 'Shows what is waiting to sync')}
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
  ) : null;

  const voicePills = showVoice ? (
    <>
      {voiceWaiting ? (
        <TouchableOpacity
          onPress={() => setVoiceSheetOpen(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={voiceWaiting}
          accessibilityHint={t('field.chrome.hintVoiceNotes', 'Shows the voice notes on this phone')}
          testID="offline-sync-voice-waiting"
          style={styles.floatingGround}
        >
          <View style={[styles.pill, styles.voicePill]}>
            <Mic size={12} color={Colors.warningLabel} strokeWidth={1.75} />
            <Text style={styles.text} numberOfLines={1}>{voiceWaiting}</Text>
          </View>
        </TouchableOpacity>
      ) : null}
      {voiceFailed ? (
        <TouchableOpacity
          onPress={() => setVoiceSheetOpen(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={voiceFailed}
          accessibilityHint={t('field.chrome.hintVoiceNotes', 'Shows the voice notes on this phone')}
          testID="offline-sync-voice-failed"
          style={styles.floatingGround}
        >
          <View style={[styles.pill, styles.voicePill, { backgroundColor: themeColors.danger + '1F', borderColor: themeColors.danger + '59' }]}>
            <CircleAlert size={12} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={[styles.text, { color: themeColors.danger }]} numberOfLines={1}>{voiceFailed}</Text>
          </View>
        </TouchableOpacity>
      ) : null}
    </>
  ) : null;

  return (
    <>
      {voicePills ? <View style={styles.voiceStack}>{statusPill}{voicePills}</View> : statusPill}
      {voiceSheetOpen ? (
        <VoiceBacklogSheet
          visible
          onClose={() => setVoiceSheetOpen(false)}
          tasks={voice.tasks}
          userId={voice.userId}
        />
      ) : null}
      <Modal
        visible={sheetOpen && failedTone}
        transparent
        animationType={fSync.animationType}
        onRequestClose={() => setSheetOpen(false)}
      >
        <View style={[styles.backdrop, fSync.overlay]}>
          <View style={[styles.sheet, fSync.card]} testID="offline-sync-sheet">
            <Text style={styles.sheetTitle}>{title}</Text>
            {/* The rows below ARE the "What failed" list — not repeated. */}
            <Text style={styles.sheetDetail}>
              {detail.split('\n\n').filter((p) => !p.startsWith('What failed')).join('\n\n')}
            </Text>
            <ScrollView style={styles.rows}>
              {unsaved.map((line) => (
                <View key={line.id} style={styles.row}>
                  <Text style={styles.rowLabel}>
                    {line.writes > 1 ? t('field.chrome.lineChanges', '{label} ({writes} changes)', { label: line.label, writes: line.writes }) : line.label}
                  </Text>
                  <Text style={styles.rowReason}>{line.line}</Text>
                  <View style={styles.rowActions}>
                    {line.canRetry ? (
                      <Button
                        label={t('field.chrome.retry', 'Retry')}
                        variant="secondary"
                        size="sm"
                        loading={busyId === line.id}
                        disabled={busyId !== null && busyId !== line.id}
                        onPress={() => { void onRetry(line); }}
                        testID={`offline-sync-retry-${line.id}`}
                      />
                    ) : null}
                    <Button
                      label={line.canRetry ? t('field.chrome.discard', 'Discard') : t('field.chrome.dismiss', 'Dismiss')}
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
            <Button label={t('field.chrome.close', 'Close')} variant="ghost" onPress={() => setSheetOpen(false)} fullWidth />
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
  voiceStack: { gap: 6, alignItems: 'flex-start' },
  // The voice lines are whole sentences; the count pill's 200 cap would cut
  // "3 voice notes couldn't be transcribed" mid-word.
  voicePill: { maxWidth: 300 },
});
