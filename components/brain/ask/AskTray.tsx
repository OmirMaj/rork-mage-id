// components/brain/ask/AskTray.tsx — the files attached to the next question,
// above the Ask composer row (lane ATTASK).
//
// A photo from this device is a 56 x 56 thumbnail of the local copy. A PDF is a
// file icon, its name on one line (middle ellipsis) and its page count. A plan
// page is a map icon, its name and "Plan page": no image and no signed URL in
// v1, so nothing is fetched to draw it. Every chip has a 44 x 44 remove target.
//
// The chips wrap (no sideways scroll: four files fit), and under them one line
// says what staying attached means: MAGE reads these files again with each
// question, and each read counts.
//
// Nothing here is sent. The files leave the device only when he sends a
// question. Strings come from useAskCopy().files.
import React from 'react';
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { X, FileText, Map as MapIcon } from 'lucide-react-native';
import type { AskAttachedFile } from '@/types';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useAskCopy } from '@/hooks/useAskCopy';

export interface AskTrayProps {
  files: AskAttachedFile[];
  onRemove: (id: string) => void;
  /** The desktop /ask page passes its reading column, so the tray lines up with the composer. */
  style?: StyleProp<ViewStyle>;
}

const CHIP = 56;

export function AskTray({ files, onRemove, style }: AskTrayProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const copy = useAskCopy().files;
  if (files.length === 0) return null;
  return (
    <View style={[styles.tray, style]} testID="ask-tray">
      <View style={styles.chips}>
        {files.map((f) => {
          const pdf = f.source === 'device' && f.mime === 'application/pdf';
          const photo = f.source === 'device' && !pdf;
          return (
            <View key={f.id} style={photo ? styles.photoChip : styles.fileChip}>
              {f.source === 'device' && photo ? (
                <Image source={{ uri: f.localUri }} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
              ) : (
                <>
                  {f.source === 'plan'
                    ? <MapIcon size={18} color={colors.textSecondary} strokeWidth={1.75} />
                    : <FileText size={18} color={colors.textSecondary} strokeWidth={1.75} />}
                  <View style={styles.fileText}>
                    <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">{f.name}</Text>
                    <Text style={styles.fileMeta} numberOfLines={1}>
                      {f.source === 'plan'
                        ? copy.trayPlanLabel
                        : typeof f.pages === 'number' && f.pages > 0 ? copy.readPdf(f.pages) : copy.readPdfNoCount}
                    </Text>
                  </View>
                </>
              )}
              <Pressable
                onPress={() => onRemove(f.id)}
                style={styles.removeHit}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={copy.trayRemoveA11y(f.name)}
                testID={`ask-tray-remove-${f.id}`}
              >
                <View style={styles.removeDot}>
                  <X size={12} color={colors.text} strokeWidth={2} />
                </View>
              </Pressable>
            </View>
          );
        })}
      </View>
      <Text style={styles.note}>{copy.trayNote}</Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  tray: { alignSelf: 'stretch', marginBottom: 8, paddingHorizontal: 4 },
  // Room above and to the right for the remove dot that sits on each corner.
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 12, paddingRight: 12 },
  photoChip: { width: CHIP, height: CHIP, borderRadius: Tokens.radius.md },
  thumb: { width: CHIP, height: CHIP, borderRadius: Tokens.radius.md, backgroundColor: t.neutralSoft },
  fileChip: {
    height: CHIP, maxWidth: 220, minWidth: 140,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingLeft: 10, paddingRight: 36,
    borderRadius: Tokens.radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line,
    backgroundColor: t.surfaceAlt,
  },
  fileText: { flexShrink: 1 },
  fileName: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  fileMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
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
  note: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 8 },
});
