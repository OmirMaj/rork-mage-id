// components/messages/AttachmentGrid.tsx — what a message bubble shows above
// its text, and the status line under a message that is not sent yet (track
// MSG, lane MSGAPP).
//
// Photos: up to 4 tiles. One photo is full width up to 240 x 240 at its own
// aspect; 2-4 sit in a 2-column grid; more than 4 put "+n" on the 4th tile.
// expo-image keys its cache on the attachment id, so a re-signed URL does not
// download the photo again. A tile with no URL yet is a neutral placeholder
// (never a broken image); a load error re-signs once, then shows
// "Couldn't load" with tap-to-retry.
//
// PDFs: one chip per file (name, "PDF · size"); a tap opens it, a long-press
// (phone) or the trailing download button (desktop) saves or shares it.
//
// MessageStatusLine replaces the time under a message the server does not
// hold yet: "Uploading 1 of 3…", the waiting line, "Sending…", "Not sent"
// with its reason and Retry / Remove, or "Waiting to send" for a text message
// queued offline. It is never drawn next to a time.

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import { FileText, Download, RotateCw } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import type { OutboxDisplay } from '@/utils/messageAttachments';
import { useMessageAttachmentCopy } from '@/hooks/useMessageAttachmentCopy';
import type { ThreadAttachment } from '@/hooks/useMessageAttachmentUrls';

const SINGLE_MAX = 240;
const TILE_PHONE = 116;
const TILE_DESK = 140;
const GAP = 4;

export function AttachmentGrid({ attachments, mine, bare, urlFor, onRefresh, onOpen, onShare, readOnly }: {
  attachments: ThreadAttachment[];
  mine: boolean;
  /** No bubble behind the grid (a message with files and no text). A
   *  contractor PDF chip then carries its own accentFill, so its white ink
   *  never sits on the page background. */
  bare?: boolean;
  /** Draw only (the in-app portal preview): nothing opens or saves. */
  readOnly?: boolean;
  urlFor: (id: string) => string | null;
  onRefresh: (id: string) => void;
  onOpen: (att: ThreadAttachment) => void;
  onShare: (att: ThreadAttachment) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const copy = useMessageAttachmentCopy();
  const tile = useIsDesktopWeb() ? TILE_DESK : TILE_PHONE;
  const [errors, setErrors] = useState<Record<string, number>>({});

  const photos = attachments.filter((a) => a.kind === 'image');
  const pdfs = attachments.filter((a) => a.kind === 'pdf');
  if (photos.length === 0 && pdfs.length === 0) return null;
  const shown = photos.slice(0, 4);
  const extra = photos.length - shown.length;

  // A server file uses its signed URL; an outbox file (or one just written,
  // whose signed URL is not back yet) uses the device copy.
  const srcFor = (a: ThreadAttachment): string | null => (a.path ? urlFor(a.id) : null) ?? a.localUri ?? null;
  const onTileError = (a: ThreadAttachment) => {
    setErrors((prev) => {
      const n = (prev[a.id] ?? 0) + 1;
      if (n === 1) onRefresh(a.id); // a URL that expired under us: re-sign once
      return { ...prev, [a.id]: n };
    });
  };
  const retryTile = (a: ThreadAttachment) => {
    setErrors((prev) => ({ ...prev, [a.id]: 0 }));
    onRefresh(a.id);
  };

  const sizeFor = (a: ThreadAttachment): { width: number; height: number } => {
    if (shown.length > 1) return { width: tile, height: tile };
    const w = a.width && a.height ? a.width : 1;
    const h = a.width && a.height ? a.height : 1;
    const scale = Math.min(SINGLE_MAX / w, SINGLE_MAX / h);
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
  };

  return (
    <View style={styles.wrap} testID="message-attachments">
      {shown.length > 0 ? (
        <View style={[styles.grid, shown.length > 1 && { width: tile * 2 + GAP }]}>
          {shown.map((a, i) => {
            const dims = sizeFor(a);
            const uri = srcFor(a);
            const failed = (errors[a.id] ?? 0) >= 2;
            const more = i === 3 && extra > 0 ? extra : 0;
            return (
              <Pressable
                key={a.id}
                onPress={() => (failed ? retryTile(a) : onOpen(a))}
                disabled={readOnly && !failed}
                style={[styles.tile, dims]}
                accessibilityRole="button"
                accessibilityLabel={failed ? copy.photoLoadFailed : copy.photoA11y(a.name)}
                testID={`message-photo-${a.id}`}
              >
                {failed ? (
                  <View style={[styles.placeholder, styles.failedTile]}>
                    <RotateCw size={16} color={colors.textMuted} strokeWidth={1.75} />
                    <Text style={styles.failedText} numberOfLines={2}>{copy.photoLoadFailed}</Text>
                  </View>
                ) : uri ? (
                  <Image
                    source={{ uri, cacheKey: a.id }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    onError={() => onTileError(a)}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View style={styles.placeholder} />
                )}
                {more > 0 ? (
                  <View style={styles.moreScrim}>
                    <Text style={styles.moreText}>{copy.photoMore(more)}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {pdfs.map((a) => (
        <View
          key={a.id}
          testID={`attachment-pdf-${a.id}`}
          style={[styles.pdfChip, mine ? (bare ? styles.pdfChipMineBare : styles.pdfChipMine) : styles.pdfChipTheirs]}
        >
          <Pressable
            onPress={() => onOpen(a)}
            onLongPress={Platform.OS === 'web' || readOnly ? undefined : () => onShare(a)}
            disabled={readOnly}
            delayLongPress={350}
            style={styles.pdfMain}
            accessibilityRole="button"
            accessibilityLabel={copy.pdfA11y(a.name, a.size)}
            testID={`message-pdf-${a.id}`}
          >
            <FileText size={20} color={mine ? Colors.textOnAccent : colors.textSecondary} strokeWidth={1.75} />
            <View style={styles.pdfText}>
              <Text style={[styles.pdfName, mine && styles.inkMine]} numberOfLines={1} ellipsizeMode="middle">{a.name}</Text>
              <Text style={[styles.pdfMeta, mine && styles.inkMineSoft]} numberOfLines={1}>{copy.pdfMeta(a.size)}</Text>
            </View>
          </Pressable>
          {Platform.OS === 'web' && !readOnly ? (
            <Pressable
              onPress={() => onShare(a)}
              style={styles.pdfDownload}
              accessibilityRole="button"
              accessibilityLabel={`${copy.download} ${a.name}`}
              testID={`message-pdf-download-${a.id}`}
            >
              <Download size={16} color={mine ? Colors.textOnAccent : colors.textSecondary} strokeWidth={1.75} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function MessageStatusLine({ display, queued, web, onRetry, onRemove, testID }: {
  display?: OutboxDisplay | null;
  queued?: boolean;
  web: boolean;
  onRetry?: () => void;
  onRemove?: () => void;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const copy = useMessageAttachmentCopy();
  if (display) {
    switch (display.state) {
      case 'uploading':
        return (
          <Text style={[styles.status, styles.statusMuted]} testID={testID}>
            {copy.uploading(Math.min(display.done + 1, display.total), display.total)}
          </Text>
        );
      case 'waiting_network':
        return <Text style={[styles.status, styles.statusWaiting]} testID={testID}>{copy.waitingNetwork(web)}</Text>;
      case 'writing':
        return <Text style={[styles.status, styles.statusMuted]} testID={testID}>{copy.sending}</Text>;
      case 'failed':
        return (
          <View style={styles.failedBox} testID={testID}>
            <Text style={styles.failedTitle}>{copy.notSent}</Text>
            <Text style={styles.failedReason}>{copy.failReason(display.reason)}</Text>
            <View style={styles.failedActions}>
              {display.retryable && onRetry ? (
                <Pressable onPress={onRetry} style={styles.actionBtn} accessibilityRole="button" testID={testID ? `${testID}-retry` : undefined}>
                  <Text style={styles.actionText}>{copy.retry}</Text>
                </Pressable>
              ) : null}
              {onRemove ? (
                <Pressable onPress={onRemove} style={styles.actionBtn} accessibilityRole="button" testID={testID ? `${testID}-remove` : undefined}>
                  <Text style={styles.actionText}>{copy.remove}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      default:
        return null;
    }
  }
  if (queued) return <Text style={[styles.status, styles.statusMuted]} testID={testID}>{copy.queued}</Text>;
  return null;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { borderRadius: Tokens.radius.card, overflow: 'hidden', backgroundColor: t.neutralSoft },
  placeholder: { flex: 1, backgroundColor: t.neutralSoft },
  failedTile: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  failedText: { fontSize: Type.caption1.fontSize, color: t.textMuted, textAlign: 'center' },
  moreScrim: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.neutralSoft,
  },
  moreText: { fontSize: Type.title3.fontSize, fontWeight: '700', color: t.text },
  pdfChip: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: Tokens.radius.card, borderWidth: StyleSheet.hairlineWidth,
    minHeight: 52, alignSelf: 'stretch', minWidth: 200,
  },
  pdfChipMine: { borderColor: t.accentSoft, backgroundColor: 'transparent' },
  pdfChipMineBare: { borderColor: t.accentFill, backgroundColor: t.accentFill },
  pdfChipTheirs: { borderColor: t.line, backgroundColor: t.surfaceAlt },
  pdfMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, minHeight: 44 },
  pdfText: { flexShrink: 1, flex: 1 },
  pdfName: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  pdfMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  inkMine: { color: Colors.textOnAccent },
  inkMineSoft: { color: Colors.textOnAccent, opacity: 0.85 },
  pdfDownload: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  status: { fontSize: Type.caption2.fontSize, marginTop: 4, marginHorizontal: 8 },
  statusMuted: { color: t.textMuted },
  statusWaiting: { color: t.warningLabel },
  failedBox: {
    marginTop: 6, paddingHorizontal: 10, paddingVertical: 8, gap: 4,
    borderRadius: Tokens.radius.md, backgroundColor: t.dangerSoft, alignSelf: 'stretch',
  },
  failedTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.dangerLabel },
  failedReason: { fontSize: Type.caption1.fontSize, color: t.dangerLabel, lineHeight: 16 },
  failedActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: {
    minHeight: 36, minWidth: 64, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
    borderRadius: Tokens.radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: t.dangerLabel,
  },
  actionText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.dangerLabel },
});
