// /shared-photos?t=<token>
//
// Read-only chronological photo timeline shared via URL. Same magic-link
// pattern as /shared-schedule — base64-encoded payload in the URL, no
// backend round-trip, no login required for the viewer.
//
// CompanyCam's wedge is the per-project chronological photo feed. This
// is the same idea, but the GC can hand a client (or insurance adjuster,
// or homeowner mid-renovation) a single link instead of asking them to
// install yet another app. URL alone is the entitlement.
//
// Web first — on iMessage / email previews this opens straight in the
// recipient's browser. On native, expo-router still resolves the route
// in case someone deep-links from the app itself.

import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, Image, ScrollView, useWindowDimensions, Platform, TouchableOpacity,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Lock, Camera as CameraIcon, MapPin, AlertCircle, Image as ImageIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import {
  decodePhotoShareToken,
  groupPhotosByDay,
  type PhotoSharePayload,
} from '@/utils/photoShareToken';

export default function SharedPhotosScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { t } = useLocalSearchParams<{ t?: string }>();
  const { width } = useWindowDimensions();

  const payload: PhotoSharePayload | null = useMemo(
    () => (t ? decodePhotoShareToken(String(t)) : null),
    [t],
  );

  // Group by day, newest first. Each day is a section header + a wrapping
  // photo grid below it. Designed to scan top-to-bottom on a phone.
  const days = useMemo(
    () => (payload ? groupPhotosByDay(payload.photos) : []),
    [payload],
  );

  // Responsive grid: 2 cols on phone, 3 on tablet, 4 on desktop.
  const cols = width >= 1100 ? 4 : width >= 700 ? 3 : 2;
  const gridGap = 8;
  const horizontalPad = 16;
  const usableWidth = Math.min(width, 1100) - horizontalPad * 2;
  const tileSize = Math.floor((usableWidth - gridGap * (cols - 1)) / cols);

  // -- Error / empty states -------------------------------------------------

  if (!t) {
    return (
      <View style={[styles.errorRoot, { paddingTop: insets.top + 32 }]} testID="shared-photos-no-token">
        <Stack.Screen options={{ title: 'Photo timeline', headerShown: false }} />
        <AlertCircle size={28} color={Colors.warning} />
        <Text style={styles.errorTitle}>No share token</Text>
        <Text style={styles.errorBody}>This link is missing the data it needs. Ask the contractor for a fresh share link.</Text>
      </View>
    );
  }

  if (!payload) {
    return (
      <View style={[styles.errorRoot, { paddingTop: insets.top + 32 }]} testID="shared-photos-bad-token">
        <Stack.Screen options={{ title: 'Photo timeline', headerShown: false }} />
        <AlertCircle size={28} color={themeColors.danger} />
        <Text style={styles.errorTitle}>Couldn&apos;t open this link</Text>
        <Text style={styles.errorBody}>The share data is corrupted or this link is from an older version of MAGE ID. Ask the contractor for a fresh link.</Text>
      </View>
    );
  }

  const photoCount = payload.photos.length;
  const dateRange = (() => {
    if (photoCount === 0) return '';
    const dates = payload.photos
      .map(p => p.ts)
      .filter(Boolean)
      .sort();
    if (dates.length === 0) return '';
    const first = new Date(dates[0]);
    const last = new Date(dates[dates.length - 1]);
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return first.toDateString() === last.toDateString()
      ? fmt(first)
      : `${fmt(first)} → ${fmt(last)}`;
  })();

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Photo timeline', headerShown: false }} />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerIconCircle}>
            <CameraIcon size={22} color={themeColors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={2}>{payload.n}</Text>
            <Text style={styles.headerSub}>
              {photoCount} photo{photoCount === 1 ? '' : 's'}
              {dateRange ? ` · ${dateRange}` : ''}
            </Text>
          </View>
        </View>

        {/* Read-only banner */}
        <View style={styles.banner}>
          <Lock size={14} color={themeColors.info} />
          <Text style={styles.bannerText}>
            Read-only photo timeline shared by {payload.gc ?? 'your contractor'}. No account needed.
          </Text>
        </View>

        {/* Empty */}
        {photoCount === 0 && (
          <View style={styles.emptyCard}>
            <ImageIcon size={22} color={themeColors.textMuted} />
            <Text style={styles.emptyTitle}>No photos in this share</Text>
            <Text style={styles.emptyBody}>The contractor hasn&apos;t added any photos yet, or this share was built before any photos were taken.</Text>
          </View>
        )}

        {/* Day sections */}
        {days.map(day => {
          const headerDate = new Date(day.dayISO + 'T12:00:00');
          const isValid = !isNaN(headerDate.getTime());
          const headerLabel = isValid
            ? headerDate.toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
              })
            : day.dayISO;
          return (
            <View key={day.dayISO} style={styles.daySection}>
              <View style={styles.dayHeaderRow}>
                <View style={styles.dayDotOuter}><View style={styles.dayDotInner} /></View>
                <Text style={styles.dayHeader}>{headerLabel}</Text>
                <Text style={styles.dayCount}>{day.items.length}</Text>
              </View>
              <View style={[styles.grid, { gap: gridGap }]}>
                {day.items.map(p => {
                  // Caption: prefer free-text caption, fall back to linked
                  // task name, then GPS-derived address, then tag.
                  const caption = p.c?.trim() || p.tn?.trim() || p.loc?.trim() || p.t?.trim() || '';
                  return (
                    <View
                      key={p.id}
                      style={[styles.tile, { width: tileSize, height: tileSize }]}
                      testID={`shared-photo-${p.id}`}
                    >
                      <Image
                        source={{ uri: p.u }}
                        style={styles.tileImage}
                        resizeMode="cover"
                        accessibilityLabel={caption || 'Jobsite photo'}
                      />
                      {p.t ? (
                        <View style={styles.tileTagBadge}>
                          <Text style={styles.tileTagText} numberOfLines={1}>{p.t}</Text>
                        </View>
                      ) : null}
                      {caption ? (
                        <View style={styles.tileCaptionWrap}>
                          {p.loc ? (
                            <MapPin size={10} color={'#FFFFFF'} style={{ marginRight: 4 }} />
                          ) : null}
                          <Text style={styles.tileCaption} numberOfLines={2}>{caption}</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

        {/* Footer — gentle CTA, marketing only */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Powered by MAGE ID — jobsite-grade construction management for general contractors.
          </Text>
          {Platform.OS === 'web' && (
            <TouchableOpacity
              accessibilityRole="link"
              onPress={() => {
                if (typeof window !== 'undefined') {
                  window.open('https://mageid.app', '_blank');
                }
              }}
            >
              <Text style={styles.footerLink}>mageid.app</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: c.bg,
  },
  scroll: {
    paddingHorizontal: 16,
    maxWidth: 1100,
    width: '100%' as const,
    alignSelf: 'center' as const,
  },
  // header
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginBottom: 12,
  },
  headerIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  headerTitle: {
    ...Type.title2,
    color: c.text,
  },
  headerSub: {
    ...Type.caption1,
    color: c.textMuted,
    marginTop: 2,
  },
  // banner
  banner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: c.surfaceAlt,
    marginBottom: 20,
  },
  bannerText: {
    ...Type.caption1,
    color: c.textSecondary,
    flex: 1,
  },
  // empty
  emptyCard: {
    paddingHorizontal: 24,
    paddingVertical: 32,
    borderRadius: 16,
    backgroundColor: c.surface,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 16,
  },
  emptyTitle: {
    ...Type.callout,
    fontWeight: '700' as const,
    color: c.text,
  },
  emptyBody: {
    ...Type.caption1,
    color: c.textMuted,
    textAlign: 'center' as const,
  },
  // day section
  daySection: {
    marginBottom: 24,
  },
  dayHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginBottom: 12,
  },
  dayDotOuter: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: c.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  dayDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: c.accent,
  },
  dayHeader: {
    ...Type.callout,
    fontWeight: '700' as const,
    color: c.text,
    flex: 1,
  },
  dayCount: {
    ...Type.caption1,
    color: c.textMuted,
  },
  // grid
  grid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
  },
  tile: {
    borderRadius: 12,
    backgroundColor: c.surface,
    overflow: 'hidden' as const,
    position: 'relative' as const,
  },
  tileImage: {
    width: '100%' as const,
    height: '100%' as const,
  },
  tileTagBadge: {
    position: 'absolute' as const,
    top: 6,
    left: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    maxWidth: '70%' as const,
  },
  tileTagText: {
    ...Type.caption1,
    color: '#FFFFFF',
    fontWeight: '700' as const,
    fontSize: 10,
  },
  tileCaptionWrap: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
  },
  tileCaption: {
    ...Type.caption1,
    color: '#FFFFFF',
    flex: 1,
    fontSize: 10,
  },
  // footer
  footer: {
    marginTop: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    alignItems: 'center' as const,
    gap: 4,
  },
  footerText: {
    ...Type.caption1,
    color: c.textMuted,
    textAlign: 'center' as const,
  },
  footerLink: {
    ...Type.caption1,
    color: c.accent,
    fontWeight: '700' as const,
  },
  // error states
  errorRoot: {
    flex: 1,
    paddingHorizontal: 24,
    backgroundColor: c.bg,
    alignItems: 'center' as const,
    gap: 12,
  },
  errorTitle: {
    ...Type.title3,
    color: c.text,
    textAlign: 'center' as const,
    marginTop: 4,
  },
  errorBody: {
    ...Type.callout,
    color: c.textSecondary,
    textAlign: 'center' as const,
    maxWidth: 360,
  },
});
