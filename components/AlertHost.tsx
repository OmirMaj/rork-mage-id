// components/AlertHost.tsx — renders alerts on web.
//
// Mounted once in app/_layout.tsx. utils/alert.ts dispatches here on web
// (native keeps using the real RN Alert), so every confirmation, error and
// destructive-action prompt in the app finally appears in the browser.
//
// Queued, not stacked: if two alerts fire back to back the second waits, which
// matches how native Alert behaves.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, TouchableOpacity, Platform } from 'react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { registerAlertHost, type AlertRequest } from '@/utils/alert';
import { cancelButtonIndex, type AlertButton } from '@/utils/alertCore';

export default function AlertHost() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [queue, setQueue] = useState<AlertRequest[]>([]);
  const [text, setText] = useState('');

  const current = queue[0] ?? null;

  useEffect(() => {
    registerAlertHost((req) => setQueue((q) => [...q, req]));
    return () => registerAlertHost(null);
  }, []);

  // Seed the input whenever a prompt becomes current.
  useEffect(() => {
    setText(current?.prompt?.defaultValue ?? '');
  }, [current?.id, current?.prompt?.defaultValue]);

  const close = useCallback((btn?: AlertButton) => {
    const value = text;
    setQueue((q) => q.slice(1));
    // Fire after dismissal so a handler that opens another alert doesn't race
    // the one we're closing.
    if (btn?.onPress) setTimeout(() => btn.onPress?.(value), 0);
  }, [text]);

  const onDismiss = useCallback(() => {
    if (!current) return;
    const idx = cancelButtonIndex(current.buttons);
    // No cancel button → backdrop tap does nothing, same as native.
    if (idx >= 0) close(current.buttons[idx]);
  }, [current, close]);

  if (!current) return null;

  const stacked = current.buttons.length > 2;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Dismiss">
        <Pressable style={styles.card} onPress={() => undefined} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">{current.title}</Text>
          {current.message ? <Text style={styles.message}>{current.message}</Text> : null}

          {current.prompt ? (
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={current.prompt.placeholder}
              placeholderTextColor={t.textMuted}
              secureTextEntry={current.prompt.secure}
              style={styles.input}
              autoFocus
              onSubmitEditing={() => {
                const confirm = current.buttons.find((b) => b.style !== 'cancel');
                close(confirm ?? current.buttons[0]);
              }}
            />
          ) : null}

          <View style={[styles.row, stacked && styles.rowStacked]}>
            {current.buttons.map((b, i) => {
              const destructive = b.style === 'destructive';
              const cancel = b.style === 'cancel';
              return (
                <TouchableOpacity
                  key={`${b.text}-${i}`}
                  style={[
                    styles.btn,
                    stacked && styles.btnStacked,
                    cancel ? styles.btnGhost : destructive ? styles.btnDanger : styles.btnPrimary,
                  ]}
                  onPress={() => close(b)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={b.text}
                  testID={`alert-btn-${i}`}
                >
                  <Text
                    style={[
                      styles.btnText,
                      cancel ? { color: t.text } : destructive ? { color: '#FFFFFF' } : { color: '#FFFFFF' },
                    ]}
                  >
                    {b.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
      ...(Platform.OS === 'web' ? { boxShadow: '0 12px 40px rgba(0,0,0,0.25)' as never } : {}),
    },
    title: { ...Type.headline, color: t.text },
    message: { ...Type.subhead, color: t.textSecondary, marginTop: 6, lineHeight: 21 },
    input: {
      marginTop: Tokens.spacing.md,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: t.text,
      backgroundColor: t.surfaceAlt,
      ...Type.subhead,
    },
    row: { flexDirection: 'row', gap: Tokens.spacing.sm, marginTop: Tokens.spacing.lg },
    rowStacked: { flexDirection: 'column-reverse' },
    btn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 11,
      borderRadius: Tokens.radius.md,
    },
    btnStacked: { flex: 0, width: '100%' },
    btnPrimary: { backgroundColor: t.accentFill },
    btnDanger: { backgroundColor: t.danger },
    btnGhost: { backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line },
    btnText: { ...Type.subheadEmphasized },
  });
