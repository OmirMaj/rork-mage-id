// /shared-photos?t=<token>
//
// Read-only chronological photo timeline shared via URL. Same magic-link
// pattern as /shared-schedule — base64-encoded payload in the URL, no login
// required for the viewer.
//
// v2 links (wave 5, #62) carry photo ids, not image URLs: on every load this
// page asks the public shared-photos-sign edge function for fresh 1 h signed
// URLs, and the function re-checks each id against the project (stored, not
// drafted / recalled). So the link never goes blank a day later, and a photo
// the GC recalls from the portal drops out of links already sent. v1 links
// (embedded URLs, 24 h fuse) still render; tiles whose URL has died are
// hidden rather than shown broken, and the page says how many.
//
// CompanyCam's wedge is the per-project chronological photo feed. This
// is the same idea, but the GC can hand a client (or insurance adjuster,
// or homeowner mid-renovation) a single link instead of asking them to
// install yet another app. URL alone is the entitlement.
//
// Web first — on iMessage / email previews this opens straight in the
// recipient's browser. On native, expo-router still resolves the route
// in case someone deep-links from the app itself.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Image, ScrollView, useWindowDimensions, Platform, TouchableOpacity, ActivityIndicator,
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
  readSignedSharePhotos,
  type PhotoSharePayload,
  type PhotoShareV2Photo,
} from '@/utils/photoShareToken';
import { invokeWithTimeout } from '@/utils/invokeWithTimeout';
import { readEdgeError } from '@/utils/edgeError';

/** A tile ready to render: the payload's metadata plus a URL to show. */
type ShareTile = PhotoShareV2Photo & { u: string };
type SignState = 'idle' | 'loading' | 'ok' | 'denied' | 'error';

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

  // v2: sign the ids on every load (CONTRACT 11). Nothing is trusted from the
  // response beyond https URLs for ids this link asked for.
  const [signed, setSigned] = useState<Map<string, string>>(new Map());
  const [signState, setSignState] = useState<SignState>('idle');
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const loadSigned = useCallback(async () => {
    if (!payload || payload.v !== 2) return;
    const ids = payload.photos.map(p => p.id);
    if (ids.length === 0) { setSignState('ok'); return; }
    setSignState('loading');
    const { data, error } = await invokeWithTimeout<unknown>('shared-photos-sign', {
      body: { projectId: payload.pid, photoIds: ids },
      timeoutMs: 20_000,
    });
    if (error) {
      const info = await readEdgeError(error, 'Photos could not be loaded');
      setSignState(info.code === 'http_401' || info.code === 'denied' || info.message === 'denied' ? 'denied' : 'error');
      return;
    }
    setSigned(readSignedSharePhotos(data, ids));
    setSignState('ok');
  }, [payload]);
  useEffect(() => { void loadSigned(); }, [loadSigned]);

  // What can actually be shown: v2 tiles the server signed; v1 tiles whose
  // embedded URL has not failed to load.
  const tiles: ShareTile[] = useMemo(() => {
    if (!payload) return [];
    if (payload.v === 2) {
      return payload.photos
        .filter(p => signed.has(p.id) && !broken.has(p.id))
        .map(p => ({ ...p, u: signed.get(p.id) as string }));
    }
    return payload.photos.filter(p => !!p.u && !broken.has(p.id));
  }, [payload, signed, broken]);
  const markBroken = useCallback((id: string) => {
    setBroken(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  // Group by day, newest first. Each day is a section header + a wrapping
  // photo grid below it. Designed to scan top-to-bottom on a phone.
  const days = useMemo(() => groupPhotosByDay(tiles), [tiles]);

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
        <AlertCircle size={28} color={Colors.warningLabel} strokeWidth={1.75} />
        <Text style={styles.errorTitle}>No share token</Text>
        <Text style={styles.errorBody}>This link is missing the data it needs. Ask the contractor for a fresh share link.</Text>
      </View>
    );
  }

  if (!payload) {
    return (
      <View style={[styles.errorRoot, { paddingTop: insets.top + 32 }]} testID="shared-photos-bad-token">
        <Stack.Screen options={{ title: 'Photo timeline', headerShown: false }} />
        <AlertCircle size={28} color={themeColors.danger} strokeWidth={1.75} />
        <Text style={styles.errorTitle}>Couldn&apos;t open this link</Text>
        <Text style={styles.errorBody}>The share data is corrupted or this link is from an older version of MAGE ID. Ask the contractor for a fresh link.</Text>
      </View>
    );
  }

  const photoCount = payload.photos.length;
  const signing = payload.v === 2 && (signState === 'idle' || signState === 'loading');
  // Photos in the link that this page cannot show: not uploaded yet, recalled
  // or deleted by the contractor (v2), or an embedded URL that expired (v1).
  const unavailable = signing || signState === 'denied' || signState === 'error' ? 0 : photoCount - tiles.length;
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
            <CameraIcon size={22} color={themeColors.accent} strokeWidth={1.75} />
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
          <Lock size={14} color={themeColors.info} strokeWidth={1.75} />
          <Text style={styles.bannerText}>
            Read-only photo timeline shared by {payload.gc ?? 'your contractor'}. No account needed.
          </Text>
        </View>

        {signing && (
          <View style={styles.emptyCard} testID="shared-photos-loading">
            <ActivityIndicator color={themeColors.accent} />
            <Text style={styles.emptyBody}>Loading photos…</Text>
          </View>
        )}
        {signState === 'denied' && (
          <View style={styles.emptyCard} testID="shared-photos-denied">
            <ImageIcon size={22} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>These photos aren&apos;t shared anymore</Text>
            <Text style={styles.emptyBody}>The contractor may have withdrawn or deleted them, or they haven&apos;t finished uploading. Ask the contractor for a fresh link.</Text>
          </View>
        )}
        {signState === 'error' && (
          <View style={styles.emptyCard} testID="shared-photos-error">
            <AlertCircle size={22} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>Couldn&apos;t load the photos</Text>
            <Text style={styles.emptyBody}>No connection, or the server didn&apos;t answer.</Text>
            <TouchableOpacity onPress={() => void loadSigned()} accessibilityRole="button">
              <Text style={styles.footerLink}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}
        {unavailable > 0 && (
          <View style={styles.banner} testID="shared-photos-unavailable">
            <AlertCircle size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.bannerText}>
              {unavailable} photo{unavailable === 1 ? '' : 's'} in this link can&apos;t be shown — not uploaded yet, withdrawn by the contractor, or the link has expired.
            </Text>
          </View>
        )}

        {/* Empty */}
        {photoCount === 0 && (
          <View style={styles.emptyCard}>
            <ImageIcon size={22} color={themeColors.textMuted} strokeWidth={1.75} />
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
                        onError={() => markBroken(p.id)}
                      />
                      {p.t ? (
                        <View style={styles.tileTagBadge}>
                          <Text style={styles.tileTagText} numberOfLines={1}>{p.t}</Text>
                        </View>
                      ) : null}
                      {caption ? (
                        <View style={styles.tileCaptionWrap}>
                          {p.loc ? (
                            <MapPin size={10} color={'#FFFFFF'} style={{ marginRight: 4 }} strokeWidth={1.75} />
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
    maxWidth: 1400,
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
    ...Type.serifHeadline,
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
