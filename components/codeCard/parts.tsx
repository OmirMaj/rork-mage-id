// components/codeCard/parts.tsx — small shared pieces of the code-card kit:
// the action contract every button takes, the Sunlight toggle, and the
// "Confirm with your building department" block every surface ends with.
//
// BLOCKED BUTTONS SAY WHY. An action is ready, done (it says where the thing
// landed) or blocked (it says why, in plain words, when tapped). A blocked
// button is never a silent grey rectangle.

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Building2, Sun } from 'lucide-react-native';
import { setSunlight } from '@/utils/codeCard/sunlight';
import { useCodeCardPalette, useSunlight, type CodeCardPalette } from './palette';

/** What a code-card button does. */
export type CodeCardAction =
  | { kind: 'ready'; onPress: () => void; label?: string }
  | { kind: 'done'; label: string }
  | { kind: 'blocked'; reason: string };

export function readyAction(onPress: () => void, label?: string): CodeCardAction {
  return { kind: 'ready', onPress, label };
}
export function doneAction(label: string): CodeCardAction {
  return { kind: 'done', label };
}
export function blockedAction(reason: string): CodeCardAction {
  return { kind: 'blocked', reason };
}

/**
 * The Sunlight toggle: white ground, black ink, heavier rules, one size up.
 * With `value`/`onChange` it is controlled; without, it drives the stored
 * preference (utils/codeCard/sunlight.ts).
 */
export function SunlightToggle({ value, onChange, testID }: { value?: boolean; onChange?: (next: boolean) => void; testID?: string }) {
  const stored = useSunlight();
  const on = value ?? stored;
  const P = useCodeCardPalette(on);
  const styles = useMemo(() => makeStyles(P), [P]);
  return (
    <Pressable
      onPress={() => (onChange ? onChange(!on) : setSunlight(!on))}
      style={[styles.sun, on && styles.sunOn]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel="Sunlight mode: more contrast, bigger type"
      hitSlop={4}
      testID={testID}
    >
      <Sun size={22} color={on ? P.bg : P.ink} strokeWidth={2.1} />
    </Pressable>
  );
}

/** The closing block on every code-card surface. */
export function ConfirmBlock({ line, sunlight, testID }: { line: string; sunlight?: boolean; testID?: string }) {
  const P = useCodeCardPalette(sunlight);
  const styles = useMemo(() => makeStyles(P), [P]);
  return (
    <View style={styles.confirm} testID={testID}>
      <Building2 size={20} color={P.ink} strokeWidth={1.9} />
      <View style={styles.confirmText}>
        <Text style={styles.confirmHead}>Confirm with your building department.</Text>
        {line ? <Text style={styles.confirmLine}>{line}</Text> : null}
      </View>
    </View>
  );
}

/** One line saying why a tapped button could not run (live region). */
export function BlockedNote({ text, sunlight, testID }: { text: string | null; sunlight?: boolean; testID?: string }) {
  const P = useCodeCardPalette(sunlight);
  const styles = useMemo(() => makeStyles(P), [P]);
  if (!text) return null;
  return (
    <Text style={styles.note} accessibilityLiveRegion="polite" testID={testID}>{text}</Text>
  );
}

export const NOT_AFFILIATED = 'MAGE ID is not affiliated with ICC.';

const makeStyles = (P: CodeCardPalette) =>
  StyleSheet.create({
    sun: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    sunOn: { backgroundColor: P.ink },
    confirm: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 18,
      padding: 14,
      borderRadius: 14,
      backgroundColor: P.surfaceAlt,
      borderWidth: P.sunlight ? 2 : 0,
      borderColor: P.line,
    },
    confirmText: { flex: 1 },
    confirmHead: { fontSize: 15 + P.bump, lineHeight: 19 + P.bump, fontWeight: '600', color: P.ink },
    confirmLine: { fontSize: 13 + P.bump / 2, lineHeight: 18 + P.bump / 2, color: P.ink2, marginTop: 3 },
    note: { fontSize: 13 + P.bump / 2, lineHeight: 18 + P.bump / 2, color: P.ink2, paddingHorizontal: 14, paddingVertical: 8 },
  });
