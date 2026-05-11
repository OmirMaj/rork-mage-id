// whats-new.tsx — in-app changelog viewer.
//
// Reads from utils/changelog.ts. On open, persists the latest read
// version to AsyncStorage so the Settings "What's new" row stops
// showing the unread badge. Bump LATEST_VERSION in changelog.ts to
// re-trigger the badge on the next release.

import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { CHANGELOG, LATEST_VERSION } from '@/utils/changelog';

const READ_KEY = 'changelog_last_read_version';

export default function WhatsNewScreen() {
  const insets = useSafeAreaInsets();

  // Mark as read on mount so the badge clears.
  useEffect(() => {
    void AsyncStorage.setItem(READ_KEY, LATEST_VERSION).catch(() => {});
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: "What's new" }} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.eyebrow}>RELEASE NOTES</Text>
        <Text style={styles.heading}>
          What's <Text style={styles.headingItalic}>new</Text>
        </Text>
        <Text style={styles.subheading}>
          The latest from the MAGE ID team. Bump back here whenever you see the dot on Settings.
        </Text>

        {CHANGELOG.map(entry => (
          <View key={entry.version} style={styles.release}>
            <View style={styles.releaseHeader}>
              <Text style={styles.releaseVersion}>v{entry.version}</Text>
              <View style={styles.releaseDateWrap}>
                <Text style={styles.releaseDate}>{formatDate(entry.date)}</Text>
              </View>
            </View>
            {entry.tags && entry.tags.length > 0 && (
              <View style={styles.tagRow}>
                {entry.tags.map(t => (
                  <View key={t} style={styles.tag}>
                    <Text style={styles.tagText}>{t.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={styles.releaseSummary}>{entry.summary}</Text>
            <View style={styles.itemList}>
              {entry.items.map((item, i) => (
                <View key={i} style={styles.item}>
                  <View style={styles.itemBullet} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    {item.body ? <Text style={styles.itemBody}>{item.body}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Hook for Settings + other surfaces to show "unread changelog" badge.
 * Returns true if the user hasn't viewed the LATEST_VERSION yet.
 */
export function useUnreadChangelog(): boolean {
  const [unread, setUnread] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const last = await AsyncStorage.getItem(READ_KEY);
        if (cancelled) return;
        setUnread(last !== LATEST_VERSION);
      } catch { /* never block UI on storage failure */ }
    })();
    return () => { cancelled = true; };
  }, []);
  return unread;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  eyebrow: {
    ...Type.monoSm,
    color: Colors.accent,
    fontWeight: '600' as const,
    marginBottom: 8,
  },
  heading: {
    ...Type.display,
    color: Colors.ink,
    marginBottom: 4,
  },
  headingItalic: {
    ...Type.displayItalic,
    color: Colors.accent,
  },
  subheading: {
    fontSize: Type.subhead.fontSize,
    color: Colors.textSecondary,
    marginBottom: 28,
    lineHeight: 21,
  },
  release: {
    marginBottom: 28,
    paddingBottom: 22,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  releaseHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginBottom: 6,
  },
  releaseVersion: {
    ...Type.displaySm,
    color: Colors.ink,
    fontSize: 22,
    lineHeight: 26,
  },
  releaseDateWrap: {
    flex: 1,
  },
  releaseDate: {
    ...Type.monoSm,
    color: Colors.textMuted,
  },
  tagRow: {
    flexDirection: 'row' as const,
    gap: 6,
    marginBottom: 12,
  },
  tag: {
    backgroundColor: Colors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Tokens.radius.xs,
  },
  tagText: {
    ...Type.monoSm,
    color: Colors.accent,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.6,
  },
  releaseSummary: {
    fontSize: Type.bodyCompact.fontSize,
    color: Colors.textSecondary,
    marginBottom: 14,
    lineHeight: 18,
  },
  itemList: { gap: 14 },
  item: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  itemBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.accent,
    marginTop: 8,
  },
  itemTitle: {
    fontSize: Type.bodyEmphasized.fontSize,
    fontWeight: '700' as const,
    color: Colors.ink,
    marginBottom: 3,
  },
  itemBody: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});
