// components/InfoBubble.tsx
//
// The reusable "what is this / why it matters" explainer. Drop a small "?" next
// to any jargon — tap it for a plain-English definition. Especially for owners
// and new users who bounce off terms like "retainage" or "pay app".
//
// Usage:
//   <InfoBubble term="change_order" />                 // from the glossary
//   <InfoBubble title="Foo" what="..." why="..." />    // one-off inline
//
// Renders nothing if there's nothing to explain (unknown term, no inline text).

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { HelpCircle, X } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { getGlossaryEntry } from '@/constants/glossary';

export function InfoBubble({
  term,
  title,
  what,
  why,
  size = 14,
  color,
}: {
  term?: string;
  title?: string;
  what?: string;
  why?: string;
  size?: number;
  color?: string;
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);

  const entry = term ? getGlossaryEntry(term) : null;
  const resolvedTitle = title ?? entry?.term;
  const resolvedWhat = what ?? entry?.what;
  const resolvedWhy = why ?? entry?.why;
  if (!resolvedTitle || !resolvedWhat) return null; // nothing to explain

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={`What is ${resolvedTitle}?`}
        testID={`info-${term ?? 'inline'}`}
      >
        <HelpCircle size={size} color={color ?? t.textMuted} strokeWidth={2} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close definition">
          {/* Inner Pressable swallows taps so they don't dismiss the modal. */}
          <Pressable style={styles.card} onPress={() => undefined}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>{resolvedTitle}</Text>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X size={18} color={t.textMuted} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>What it is</Text>
            <Text style={styles.body}>{resolvedWhat}</Text>
            {resolvedWhy ? (
              <>
                <Text style={[styles.label, styles.labelSpaced]}>Why it matters</Text>
                <Text style={styles.body}>{resolvedWhy}</Text>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: t.surface,
      borderRadius: Tokens.radius.panel,
      borderWidth: 1,
      borderColor: t.line,
      padding: Tokens.spacing.lg,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: Tokens.spacing.md,
    },
    title: { ...Type.title3, color: t.text, flex: 1 },
    label: {
      ...Type.caption1,
      color: t.accent,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      fontWeight: '700',
      marginBottom: 4,
    },
    labelSpaced: { marginTop: Tokens.spacing.md },
    body: { ...Type.subhead, color: t.textSecondary, lineHeight: 21 },
  });

export default InfoBubble;
