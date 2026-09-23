// app/construction-news.tsx — Construction News: the latest industry headlines
// from a curated set of publisher feeds.
//
// Founder request (2026-09-22): "a construction news place on the app that
// has all the latest up to date construction news happening."
//
// What the screen promises, and keeps:
//   * Every card names its publisher and shows only what that publisher's own
//     feed hands out — headline, the feed's summary, the link. Tapping opens
//     the story on the publisher's site (in-app browser on the phone, a new
//     tab on the web). Nothing is rewritten or summarised by us.
//   * The header says when the news was gathered and from how many
//     publishers, and names any publisher that didn't answer — so a missing
//     source never reads as a quiet day.
//   * Offline, the last good copy opens with a banner saying so and how old
//     it is (hooks/useConstructionNews.ts keeps it under a mageid_ key).
//
// Layout: one column of cards on the phone; two on a wide web screen.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, Pressable, ScrollView,
  ActivityIndicator, Platform,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Newspaper, WifiOff, CloudOff, ExternalLink, RefreshCw } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, Button } from '@/components/ui';
import EmptyState from '@/components/EmptyState';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useConstructionNews } from '@/hooks/useConstructionNews';
import {
  topicChips, filterByTopic, newsHeaderLine, failedSourcesLine, staleBannerText,
  newsMetaLine, type NewsChip, type NewsItem,
} from '@/utils/constructionNews';

/** Re-render the relative times once a minute so "just now" doesn't sit on
 *  screen for an hour. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

async function openArticle(link: string): Promise<void> {
  // coerceNewsPayload already refused anything that isn't http(s); checked
  // again here because this is the line that actually opens it.
  if (!/^https?:\/\//i.test(link)) return;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // A new tab keeps the news list where the reader left it. noopener so the
    // publisher's page cannot reach back into the app's window.
    window.open(link, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    await WebBrowser.openBrowserAsync(link);
  } catch {
    // Nothing useful to add: the in-app browser failing to open is rare and
    // the card stays tappable for another try.
  }
}

export default function ConstructionNewsScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { isDesktop, isTablet } = useResponsiveLayout();
  const columns = isDesktop || (Platform.OS === 'web' && isTablet) ? 2 : 1;
  const now = useNow();
  // Scrolling down slides the global Brain FAB away, and the list pads past
  // it, so the last card is never under the button.
  const fabScroll = useBrainFabScroll();

  const { payload, staleReason, errorMessage, isLoading, isRefreshing, refresh } = useConstructionNews();
  const [chip, setChip] = useState<NewsChip>('All');

  const items = useMemo(() => payload?.items ?? [], [payload]);
  const chips = useMemo(() => topicChips(items), [items]);
  // A chip whose topic vanished after a refresh falls back to All rather than
  // showing an empty list for a filter the reader can no longer see.
  const activeChip: NewsChip = chips.includes(chip) ? chip : 'All';
  const visible = useMemo(() => filterByTopic(items, activeChip), [items, activeChip]);

  const onRefresh = useCallback(() => { void refresh(); }, [refresh]);

  const renderItem = useCallback(({ item }: { item: NewsItem }) => (
    <View style={columns > 1 ? styles.cellTwoUp : styles.cellOne}>
      <Card
        pressable
        onPress={() => { void openArticle(item.link); }}
        accessibilityLabel={`${item.title}. ${newsMetaLine(item, now)}. Opens the story on ${item.source}'s site.`}
        testID={`news-card-${item.id}`}
        style={styles.card}
      >
        <Text style={styles.meta} numberOfLines={1}>{newsMetaLine(item, now)}</Text>
        <Text style={styles.title} numberOfLines={3}>{item.title}</Text>
        {item.summary ? <Text style={styles.summary} numberOfLines={2}>{item.summary}</Text> : null}
        <View style={styles.cardFoot}>
          <Text style={styles.topic}>{item.topic}</Text>
          <ExternalLink size={14} color={colors.textMuted} strokeWidth={1.75} />
        </View>
      </Card>
    </View>
  ), [columns, styles, now, colors.textMuted]);

  // ── Nothing on screen yet ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]} testID="news-loading">
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.loadingText}>Loading the latest construction news…</Text>
      </View>
    );
  }

  if (!payload) {
    return (
      <View style={styles.container} testID="news-error">
        <EmptyState
          icon={<CloudOff size={32} color={colors.textSecondary} strokeWidth={1.75} />}
          title="The news didn't load"
          message={errorMessage ?? 'The news could not load.'}
          actionLabel="Retry"
          onAction={onRefresh}
        />
      </View>
    );
  }

  const failedLine = failedSourcesLine(payload);

  const header = (
    <View style={styles.headerBlock}>
      {staleReason ? (
        <View style={styles.banner} testID="news-stale-banner">
          {staleReason === 'offline'
            ? <WifiOff size={16} color={colors.warningLabel} strokeWidth={2} />
            : <CloudOff size={16} color={colors.warningLabel} strokeWidth={2} />}
          <Text style={styles.bannerText}>{staleBannerText(staleReason, payload.fetchedAt, now)}</Text>
        </View>
      ) : null}
      <View style={styles.statusRow}>
        <Newspaper size={16} color={colors.textSecondary} strokeWidth={1.75} />
        <Text style={styles.statusText} testID="news-updated-line">{newsHeaderLine(payload, now)}</Text>
      </View>
      {failedLine ? (
        <Text style={styles.failedText} testID="news-failed-sources">{failedLine}</Text>
      ) : null}
      {chips.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.chipScroll}
        >
          {chips.map(c => {
            const on = c === activeChip;
            return (
              <Pressable
                key={c}
                onPress={() => setChip(c)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                testID={`news-chip-${c}`}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  const empty = (
    <EmptyState
      icon={<Newspaper size={32} color={colors.textSecondary} strokeWidth={1.75} />}
      title="No stories right now"
      message="None of the publishers had a story from the last 30 days that the app could read. Pull down or tap Retry to check again."
      actionLabel="Retry"
      onAction={onRefresh}
    />
  );

  const footer = items.length > 0 ? (
    <View style={styles.footer}>
      <Text style={styles.footerText}>
        Headlines and summaries come from each publisher's own feed. Tap a story to read it on their site.
      </Text>
      <Button
        label="Check for newer stories"
        variant="ghost"
        size="sm"
        onPress={onRefresh}
        loading={isRefreshing}
        iconLeft={<RefreshCw size={14} color={colors.accentLabel} strokeWidth={2} />}
        testID="news-refresh-btn"
      />
    </View>
  ) : null;

  return (
    <View style={styles.container} testID="construction-news-screen">
      <FlatList
        {...fabScroll}
        // numColumns cannot change on a mounted FlatList; the key remounts it.
        key={`news-cols-${columns}`}
        data={visible}
        keyExtractor={it => it.id}
        numColumns={columns}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
        columnWrapperStyle={columns > 1 ? styles.columnWrap : undefined}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      />
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    center: { alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.sm },
    loadingText: { ...Type.footnote, color: c.textSecondary },
    list: {
      paddingHorizontal: Tokens.spacing.md,
      paddingTop: Tokens.spacing.sm,
      width: '100%',
      maxWidth: 1100,
      alignSelf: 'center',
    },
    headerBlock: { gap: Tokens.spacing.xs, marginBottom: Tokens.spacing.sm },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Tokens.spacing.xs,
      paddingVertical: Tokens.spacing.xs,
      paddingHorizontal: Tokens.spacing.sm,
      borderRadius: Tokens.radius.md,
      backgroundColor: c.warningSoft,
    },
    bannerText: { ...Type.footnoteEmphasized, color: c.warningLabel, flex: 1 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
    statusText: { ...Type.footnote, color: c.textSecondary, flex: 1 },
    failedText: { ...Type.caption1, color: c.textSecondary },
    chipScroll: { marginHorizontal: -Tokens.spacing.md, marginTop: Tokens.spacing.xxs },
    chipRow: { paddingHorizontal: Tokens.spacing.md, gap: Tokens.spacing.xs },
    chip: {
      paddingVertical: Tokens.spacing.xs - 2,
      paddingHorizontal: Tokens.spacing.sm,
      borderRadius: Tokens.radius.full,
      borderWidth: 1,
      borderColor: c.line,
      backgroundColor: 'transparent',
      minHeight: 32,
      justifyContent: 'center',
    },
    // Selected = soft accent tint with accent ink; the accent itself never
    // becomes a background (house rule).
    chipOn: { backgroundColor: c.accentSoft, borderColor: c.accent },
    chipText: { ...Type.footnote, color: c.textSecondary },
    chipTextOn: { ...Type.footnoteEmphasized, color: c.accentLabel },
    cellOne: { marginBottom: Tokens.spacing.sm },
    cellTwoUp: { flex: 1, marginBottom: Tokens.spacing.sm },
    columnWrap: { gap: Tokens.spacing.sm },
    card: { gap: Tokens.spacing.xxs, flexGrow: 1 },
    meta: { ...Type.caption1, color: c.textSecondary },
    title: { ...Type.headline, color: c.text },
    summary: { ...Type.footnote, color: c.textSecondary },
    cardFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: Tokens.spacing.xxs,
    },
    topic: { ...Type.caption2, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    footer: { alignItems: 'center', gap: Tokens.spacing.xs, paddingTop: Tokens.spacing.md },
    footerText: { ...Type.caption1, color: c.textMuted, textAlign: 'center', maxWidth: 520 },
  });
}
