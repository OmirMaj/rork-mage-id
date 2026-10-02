// components/messages/AttachmentTray.tsx — the files picked for the next
// client message, above the composer row (track MSG, lane MSGAPP).
//
// A photo is a 56 x 56 thumbnail with an X; a PDF is a file icon, its name on
// one line (middle ellipsis) and its size. Every remove target is 44 x 44.
// Nothing here is sent: the files leave the device only when he taps Send.

import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import { X, FileText } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { PickedAttachment } from '@/hooks/useAttachmentPicker';
import { useMessageAttachmentCopy } from '@/hooks/useMessageAttachmentCopy';

export default function AttachmentTray({ files, onRemove }: {
  files: PickedAttachment[];
  onRemove: (id: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const copy = useMessageAttachmentCopy();
  if (files.length === 0) return null;
  return (
    <ScrollView
      horizontal
      // A desktop mouse has no swipe: the browser's scrollbar stays.
      showsHorizontalScrollIndicator={Platform.OS === 'web'}
      style={styles.tray}
      contentContainerStyle={styles.trayContent}
      keyboardShouldPersistTaps="handled"
      testID="message-attachment-tray"
    >
      {files.map((f) => (
        <View key={f.id} style={f.mime === 'application/pdf' ? styles.pdfChip : styles.photoChip}>
          {f.mime === 'application/pdf' ? (
            <>
              <FileText size={18} color={colors.textSecondary} strokeWidth={1.75} />
              <View style={styles.pdfText}>
                <Text style={styles.pdfName} numberOfLines={1} ellipsizeMode="middle">{f.name}</Text>
                <Text style={styles.pdfMeta} numberOfLines={1}>{copy.size(f.size)}</Text>
              </View>
            </>
          ) : (
            <Image source={{ uri: f.localUri }} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
          )}
          <Pressable
            onPress={() => onRemove(f.id)}
            style={styles.removeHit}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={copy.trayRemoveA11y(f.name)}
            testID={`message-attachment-remove-${f.id}`}
          >
            <View style={styles.removeDot}>
              <X size={12} color={colors.text} strokeWidth={2} />
            </View>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const CHIP = 56;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  tray: { flexGrow: 0, marginBottom: 8 },
  trayContent: { gap: 12, paddingTop: 12, paddingRight: 12, alignItems: 'center' },
  photoChip: { width: CHIP, height: CHIP, borderRadius: Tokens.radius.md, overflow: 'visible' },
  thumb: { width: CHIP, height: CHIP, borderRadius: Tokens.radius.md, backgroundColor: t.neutralSoft },
  pdfChip: {
    height: CHIP, maxWidth: 220, minWidth: 140,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingLeft: 10, paddingRight: 36,
    borderRadius: Tokens.radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line,
    backgroundColor: t.surfaceAlt,
  },
  pdfText: { flexShrink: 1 },
  pdfName: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  pdfMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  // A 44 x 44 target over the chip's top-right corner.
  removeHit: {
    position: 'absolute', top: -12, right: -12, width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  removeDot: {
    width: 22, height: 22, borderRadius: Tokens.radius.full,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line,
  },
});
