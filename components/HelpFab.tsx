// HelpFab — floating "?" button users can tap when they're stuck.
//
// Renders a small circular button at bottom-right, above the tab bar.
// Tapping opens a half-sheet with three options:
//   1. Watch demo videos    → opens mageid.app/demo in the system browser
//   2. Replay the tutorial  → reopens the in-app interactive Tutorial
//   3. Email support        → mailto: with prefilled subject
//
// Render only on the screens where stuck users actually look — currently
// just the home tab. Easy to mount elsewhere later by including the
// component in any screen that wants it. Stays out of modals / full-
// screen takeovers to avoid covering primary controls.
//
// Why a FAB and not a tab item? The /demo.html research shows every
// credible competitor (Bluebeam, Buildxact, JobTread, Togal, Handoff)
// has either an in-app help icon or an Intercom widget; the FAB is
// the smallest possible footprint that still catches the eye when a
// user is staring at the screen wondering what to do next.

import React, { memo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Linking, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { HelpCircle, X, Play, Mail, BookOpen, ExternalLink } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TUTORIAL_SEEN_KEY } from '@/components/Tutorial';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const SUPPORT_EMAIL = 'support@mageid.app';
const DEMO_URL = 'https://mageid.app/demo.html';

export interface HelpFabProps {
  /** Optional offset from the bottom — bump up by tab bar height
   *  on screens that have one. Defaults to 0. */
  bottomOffset?: number;
  /** Called when the user taps "Replay the tutorial". Allows the
   *  parent to set its own `showTutorial` state without us reaching
   *  across screens. */
  onReplayTutorial?: () => void;
}

function HelpFabImpl({ bottomOffset = 0, onReplayTutorial }: HelpFabProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => setOpen(false), []);

  const handleVideos = useCallback(() => {
    setOpen(false);
    Linking.openURL(DEMO_URL).catch(() => {/* ignore */});
  }, []);

  const handleEmail = useCallback(() => {
    setOpen(false);
    const subject = encodeURIComponent('MAGE ID — need help with…');
    const body = encodeURIComponent(
      'What screen are you on?\n\nWhat were you trying to do?\n\nWhat happened instead?\n\n— sent from MAGE ID iOS / Android / Web',
    );
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {/* ignore */});
  }, []);

  const handleReplayTutorial = useCallback(async () => {
    setOpen(false);
    // Clear the seen flag so the auto-open path on home picks it up
    // as a fresh trigger if the user navigates back. Also call the
    // parent's hook if provided so they can reopen immediately.
    try { await AsyncStorage.removeItem(TUTORIAL_SEEN_KEY); } catch {}
    onReplayTutorial?.();
  }, [onReplayTutorial]);

  return (
    <>
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + bottomOffset + 16 }]}
        onPress={handleOpen}
        activeOpacity={0.8}
        accessibilityLabel="Help"
        testID="help-fab"
      >
        <HelpCircle size={20} color="#FFF" strokeWidth={2.4} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={handleClose}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title}>Need a hand?</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={8} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={Colors.text} /></TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            We answer fast. Pick whichever&apos;s easiest.
          </Text>

          <TouchableOpacity style={styles.row} onPress={handleVideos} activeOpacity={0.85} testID="help-fab-videos">
            <View style={[styles.rowIcon, { backgroundColor: Colors.primary + '14' }]}>
              <Play size={16} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Watch the demo videos</Text>
              <Text style={styles.rowSub}>90-second tour, full walkthrough, and a clip per feature.</Text>
            </View>
            <ExternalLink size={14} color={Colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.row} onPress={handleReplayTutorial} activeOpacity={0.85} testID="help-fab-tutorial">
            <View style={[styles.rowIcon, { backgroundColor: Colors.warning + '14' }]}>
              <BookOpen size={16} color={Colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Replay the tutorial</Text>
              <Text style={styles.rowSub}>The interactive walkthrough you saw on first launch.</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.row} onPress={handleEmail} activeOpacity={0.85} testID="help-fab-email">
            <View style={[styles.rowIcon, { backgroundColor: Colors.success + '14' }]}>
              <Mail size={16} color={Colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Email support</Text>
              <Text style={styles.rowSub}>{SUPPORT_EMAIL} — usually under 4 hours.</Text>
            </View>
            <ExternalLink size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

export const HelpFab = memo(HelpFabImpl);

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
    zIndex: 50,
  },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 10,
    gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18, shadowRadius: 16, elevation: 8,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  subtitle: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, marginBottom: 12, lineHeight: 18 },
  closeBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
  },
  rowIcon: {
    width: 38, height: 38, borderRadius: Tokens.radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: Colors.text },
  rowSub: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: 2, lineHeight: 16 },
});
