// MAGE ID Bids tab — the landing page for the homeowner→contractor RFP
// marketplace. Two-mode UX:
//   - "Browse" (default): nearby homeowner RFPs the signed-in user can
//     bid on. Geo-fenced to their device location with a radius picker.
//   - "My Posts": projects the signed-in user has posted (homeowner role).
//     Shows response counts + jump to review/award dashboard.
//
// A prominent "Post a project" CTA at the top is always visible so
// homeowners hit it first, regardless of which mode they're in.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  RefreshControl,
} from 'react-native';
import { SkeletonCard } from '@/components/Skeleton';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, MapPin, Inbox, ChevronRight, Clock, DollarSign, Crosshair,
  ShieldCheck, AlertTriangle, Trophy, Layers, Compass, Hammer,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles } from '@/utils/location';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface BrowseRow {
  id: string;
  title: string;
  city: string;
  state: string;
  status: string;
  scope_description: string | null;
  budget_min: number | null;
  budget_max: number | null;
  desired_start: string | null;
  photo_urls: string[] | null;
  latitude: number | null;
  longitude: number | null;
  address_verified: boolean;
  posted_date: string;
  deadline: string;
}

interface MyRow {
  id: string;
  title: string;
  city: string;
  state: string;
  status: string;
  budget_min: number | null;
  budget_max: number | null;
  photo_urls: string[] | null;
  posted_date: string;
  awarded_response_id: string | null;
  response_count: number;
  unreviewed_count: number;
}

interface BrowseWithDistance extends BrowseRow { distance: number | null; }

const RADIUS_OPTIONS = [10, 25, 50, 100, 250] as const;
type Mode = 'browse' | 'mine';

export default function MageIdBidsTabScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { location, refresh: requestLocation, loading: locLoading } = useUserLocation();
  const [radius, setRadius] = useState<number>(25);
  const [mode, setMode] = useState<Mode>('browse');

  const enabled = isSupabaseConfigured;

  // BROWSE — every open homeowner RFP except the user's own.
  const browseQ = useQuery({
    queryKey: ['mage-bids-browse', user?.id],
    enabled,
    queryFn: async (): Promise<BrowseRow[]> => {
      let q = supabase
        .from('public_bids')
        .select('id,title,city,state,status,scope_description,budget_min,budget_max,desired_start,photo_urls,latitude,longitude,address_verified,posted_date,deadline')
        .eq('is_homeowner_rfp', true)
        .eq('status', 'open')
        .order('posted_date', { ascending: false })
        .limit(200);
      if (user?.id) q = q.neq('user_id', user.id);
      const { data, error } = await q;
      if (error) {
        console.warn('[mage-id-bids/browse] fetch error', error);
        return [];
      }
      return (data ?? []).map(r => ({ ...r, photo_urls: r.photo_urls as string[] | null }));
    },
  });

  // MINE — every RFP this user has posted.
  const mineQ = useQuery({
    queryKey: ['mage-bids-mine', user?.id],
    enabled: enabled && !!user?.id,
    queryFn: async (): Promise<MyRow[]> => {
      if (!user?.id) return [];
      const { data: rfps, error } = await supabase
        .from('public_bids')
        .select('id,title,city,state,status,budget_min,budget_max,photo_urls,posted_date,awarded_response_id')
        .eq('user_id', user.id)
        .eq('is_homeowner_rfp', true)
        .order('posted_date', { ascending: false });
      if (error || !rfps || rfps.length === 0) return [];
      const ids = rfps.map(r => r.id);
      const { data: responses } = await supabase
        .from('bid_responses')
        .select('bid_id,status')
        .in('bid_id', ids);
      const counts = new Map<string, { total: number; unreviewed: number }>();
      for (const r of (responses ?? [])) {
        const c = counts.get(r.bid_id) ?? { total: 0, unreviewed: 0 };
        c.total += 1;
        if (r.status === 'submitted') c.unreviewed += 1;
        counts.set(r.bid_id, c);
      }
      return rfps.map(r => ({
        ...r,
        photo_urls: r.photo_urls as string[] | null,
        response_count: counts.get(r.id)?.total ?? 0,
        unreviewed_count: counts.get(r.id)?.unreviewed ?? 0,
      }));
    },
  });

  const filteredBrowse = useMemo<BrowseWithDistance[]>(() => {
    const rows = browseQ.data ?? [];
    const enriched = rows.map(r => {
      const distance = (location && r.latitude != null && r.longitude != null)
        ? getDistanceMiles(location.latitude, location.longitude, Number(r.latitude), Number(r.longitude))
        : null;
      return { ...r, distance };
    });
    if (!location) return enriched.sort((a, b) => +new Date(b.posted_date) - +new Date(a.posted_date));
    return enriched
      .filter(r => r.distance == null || r.distance <= radius)
      .sort((a, b) => {
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      });
  }, [browseQ.data, location, radius]);

  const handlePost = useCallback(() => router.push('/post-rfp' as never), [router]);
  const handleOpenRfp = useCallback((id: string) => {
    router.push({ pathname: '/rfp-detail' as never, params: { bidId: id } as never });
  }, [router]);
  const handleOpenReview = useCallback((id: string) => {
    router.push({ pathname: '/rfp-responses-review' as never, params: { bidId: id } as never });
  }, [router]);

  const myStats = useMemo(() => {
    const rows = mineQ.data ?? [];
    return {
      total: rows.length,
      open: rows.filter(r => r.status === 'open' && !r.awarded_response_id).length,
      awarded: rows.filter(r => !!r.awarded_response_id).length,
      unread: rows.reduce((s, r) => s + r.unreviewed_count, 0),
    };
  }, [mineQ.data]);

  const isLoading = mode === 'browse' ? browseQ.isLoading : mineQ.isLoading;
  const isRefetching = mode === 'browse' ? browseQ.isRefetching : mineQ.isRefetching;
  const refetch = mode === 'browse' ? browseQ.refetch : mineQ.refetch;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.brandIcon}><Hammer size={18} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>MAGE ID Bids</Text>
            <Text style={styles.title}>
              {mode === 'browse' ? 'Projects near you' : 'Your posted projects'}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.postCta} onPress={handlePost} activeOpacity={0.85} testID="mageid-bids-post">
          <Plus size={14} color="#FFF" />
          <Text style={styles.postCtaText}>Post project</Text>
        </TouchableOpacity>
      </View>

      {/* Mode segmented control */}
      <View style={styles.segmentRow}>
        <TouchableOpacity
          style={[styles.segment, mode === 'browse' && styles.segmentActive]}
          onPress={() => setMode('browse')}
        >
          <Compass size={13} color={mode === 'browse' ? Colors.primary : Colors.textMuted} />
          <Text style={[styles.segmentText, mode === 'browse' && styles.segmentTextActive]}>
            Browse{filteredBrowse.length > 0 ? ` · ${filteredBrowse.length}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segment, mode === 'mine' && styles.segmentActive]}
          onPress={() => setMode('mine')}
        >
          <Layers size={13} color={mode === 'mine' ? Colors.primary : Colors.textMuted} />
          <Text style={[styles.segmentText, mode === 'mine' && styles.segmentTextActive]}>
            My posts{myStats.total > 0 ? ` · ${myStats.total}` : ''}
          </Text>
          {myStats.unread > 0 && (
            <View style={styles.unreadDot}>
              <Text style={styles.unreadDotText}>{myStats.unread}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {mode === 'browse' && (
        <View style={styles.controls}>
          <TouchableOpacity style={styles.locBtn} onPress={() => { void requestLocation(); }}>
            <Crosshair size={13} color={location ? Colors.success : Colors.primary} />
            <Text style={styles.locBtnText}>
              {location ? 'Location set' : locLoading ? 'Getting location…' : 'Use my location'}
            </Text>
          </TouchableOpacity>
          <View style={styles.radiusRow}>
            {RADIUS_OPTIONS.map(r => (
              <TouchableOpacity
                key={r}
                style={[styles.radiusChip, radius === r && styles.radiusChipActive]}
                onPress={() => setRadius(r)}
              >
                <Text style={[styles.radiusChipText, radius === r && styles.radiusChipTextActive]}>{r}mi</Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* Map view link — was an orphan route until May 2026 audit
              wiring. Same RFP feed but rendered with full distance-sort
              + map visualization. */}
          <TouchableOpacity
            style={styles.mapBtn}
            onPress={() => router.push('/nearby-rfps' as never)}
            activeOpacity={0.85}
            testID="mageid-bids-nearby-map"
          >
            <MapPin size={13} color={Colors.primary} />
            <Text style={styles.mapBtnText}>Map view</Text>
            <ChevronRight size={12} color={Colors.primary} />
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} tintColor={Colors.primary} />
        }
      >
        {isLoading && (
          // Skeleton RFP cards shaped like the real cards — image strip
          // up top + 2 text lines + footer. Premium-feel during fetch
          // instead of a spinner on empty space.
          <View style={{ gap: 12, marginTop: 4 }}>
            {[0, 1, 2, 3].map(i => (
              <SkeletonCard key={i} style={{ height: 220 }} />
            ))}
          </View>
        )}

        {/* BROWSE mode */}
        {mode === 'browse' && !isLoading && filteredBrowse.length === 0 && (
          <View style={styles.emptyCard}>
            <Inbox size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No projects within {radius} miles yet</Text>
            <Text style={styles.emptyBody}>
              {!location
                ? 'Homeowners post their remodel + new-build RFPs here for verified contractors to bid on. Allow location access or expand your radius to see what\'s near you.'
                : 'New projects show up here as homeowners post them. Try a wider radius, clear your scope filters, or check back tomorrow.'}
            </Text>
          </View>
        )}

        {mode === 'browse' && filteredBrowse.map(r => {
          const heroPhoto = (r.photo_urls && r.photo_urls.length > 0) ? r.photo_urls[0] : null;
          const distanceText = r.distance != null ? `${r.distance.toFixed(1)} mi away` : 'Distance unknown';
          const deadline = new Date(r.deadline);
          const daysLeft = Math.floor((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          return (
            <TouchableOpacity
              key={r.id}
              style={styles.rfpCard}
              onPress={() => handleOpenRfp(r.id)}
              activeOpacity={0.85}
              testID={`browse-card-${r.id}`}
            >
              {heroPhoto && (
                <Image source={{ uri: heroPhoto }} style={styles.rfpHero} resizeMode="cover" />
              )}
              <View style={styles.rfpBody}>
                <View style={styles.rfpHead}>
                  <Text style={styles.rfpTitle} numberOfLines={2}>{r.title}</Text>
                  {r.address_verified ? (
                    <View style={styles.verifyDot}><ShieldCheck size={10} color={Colors.success} /></View>
                  ) : (
                    <View style={[styles.verifyDot, { backgroundColor: Colors.warning + '20' }]}>
                      <AlertTriangle size={10} color={Colors.warning} />
                    </View>
                  )}
                </View>
                {r.scope_description ? (
                  <Text style={styles.rfpScope} numberOfLines={3}>{r.scope_description}</Text>
                ) : null}
                <View style={styles.rfpMeta}>
                  <MapPin size={11} color={Colors.textMuted} />
                  <Text style={styles.rfpMetaText}>
                    {[r.city, r.state].filter(Boolean).join(', ') || 'Location pending'} · {distanceText}
                  </Text>
                </View>
                <View style={styles.rfpFoot}>
                  {(r.budget_min || r.budget_max) ? (
                    <View style={styles.footChip}>
                      <DollarSign size={11} color={Colors.primary} />
                      <Text style={styles.footChipText}>
                        {r.budget_min ? formatMoney(r.budget_min) : '?'} – {r.budget_max ? formatMoney(r.budget_max) : '?'}
                      </Text>
                    </View>
                  ) : <View />}
                  <View style={[styles.footChip, daysLeft < 3 ? { backgroundColor: Colors.error + '15' } : null]}>
                    <Clock size={11} color={daysLeft < 3 ? Colors.error : Colors.textMuted} />
                    <Text style={[styles.footChipText, daysLeft < 3 ? { color: Colors.error } : null]}>
                      {daysLeft <= 0 ? 'Closing today' : `${daysLeft}d left`}
                    </Text>
                  </View>
                  <ChevronRight size={14} color={Colors.textMuted} />
                </View>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* MINE mode */}
        {mode === 'mine' && !user && (
          <View style={styles.emptyCard}>
            <Inbox size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>Sign in to see your posts</Text>
            <Text style={styles.emptyBody}>
              Log in or create an account first, then post your project to start collecting bids.
            </Text>
          </View>
        )}

        {mode === 'mine' && user && !mineQ.isLoading && (mineQ.data ?? []).length === 0 && (
          <View style={styles.emptyCard}>
            <Hammer size={28} color={Colors.primary} />
            <Text style={styles.emptyTitle}>You haven&apos;t posted anything yet</Text>
            <Text style={styles.emptyBody}>
              Post your first project. Verified contractors near you will be notified and start submitting bids — usually within a day.
            </Text>
            <TouchableOpacity style={styles.bigCta} onPress={handlePost}>
              <Plus size={14} color="#FFF" />
              <Text style={styles.bigCtaText}>Post a project</Text>
            </TouchableOpacity>
          </View>
        )}

        {mode === 'mine' && (mineQ.data ?? []).length > 0 && (
          <View style={styles.statsRow}>
            <Stat label="Posted" value={String(myStats.total)} styles={styles} />
            <View style={styles.statDiv} />
            <Stat label="Open" value={String(myStats.open)} styles={styles} />
            <View style={styles.statDiv} />
            <Stat label="Awarded" value={String(myStats.awarded)} accent={myStats.awarded > 0 ? themeColors.success : undefined} styles={styles} />
            <View style={styles.statDiv} />
            <Stat label="New bids" value={String(myStats.unread)} accent={myStats.unread > 0 ? themeColors.accent : undefined} styles={styles} />
          </View>
        )}

        {mode === 'mine' && (mineQ.data ?? []).map(r => {
          const heroPhoto = (r.photo_urls && r.photo_urls.length > 0) ? r.photo_urls[0] : null;
          const isAwarded = !!r.awarded_response_id;
          const isOpen = r.status === 'open' && !isAwarded;
          return (
            <TouchableOpacity
              key={r.id}
              style={styles.rfpCard}
              onPress={() => handleOpenReview(r.id)}
              activeOpacity={0.85}
              testID={`mine-card-${r.id}`}
            >
              {heroPhoto && (
                <Image source={{ uri: heroPhoto }} style={styles.rfpHero} resizeMode="cover" />
              )}
              <View style={styles.rfpBody}>
                <View style={styles.rfpHead}>
                  <Text style={styles.rfpTitle} numberOfLines={2}>{r.title}</Text>
                  {isAwarded && (
                    <View style={[styles.statusPill, { backgroundColor: Colors.success + '20' }]}>
                      <Trophy size={10} color={Colors.success} />
                      <Text style={[styles.statusPillText, { color: Colors.success }]}>AWARDED</Text>
                    </View>
                  )}
                  {isOpen && (
                    <View style={[styles.statusPill, { backgroundColor: Colors.primary + '20' }]}>
                      <Clock size={10} color={Colors.primary} />
                      <Text style={[styles.statusPillText, { color: Colors.primary }]}>OPEN</Text>
                    </View>
                  )}
                </View>
                <View style={styles.rfpMeta}>
                  <MapPin size={11} color={Colors.textMuted} />
                  <Text style={styles.rfpMetaText} numberOfLines={1}>
                    {[r.city, r.state].filter(Boolean).join(', ') || 'Address pending'}
                  </Text>
                </View>
                {(r.budget_min || r.budget_max) && (
                  <Text style={styles.rfpBudget}>
                    Budget: {r.budget_min ? formatMoney(r.budget_min) : '?'} – {r.budget_max ? formatMoney(r.budget_max) : '?'}
                  </Text>
                )}
                <View style={styles.rfpFoot}>
                  <View style={styles.responseChip}>
                    <Text style={styles.responseChipText}>
                      {r.response_count} bid{r.response_count === 1 ? '' : 's'}
                    </Text>
                    {r.unreviewed_count > 0 && (
                      <View style={styles.unreadDotSm}>
                        <Text style={styles.unreadDotSmText}>{r.unreviewed_count}</Text>
                      </View>
                    )}
                  </View>
                  <ChevronRight size={14} color={Colors.textMuted} />
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Receives `styles` from the parent so it picks up the live theme. Pre-
// fix Stat referenced the module-level `styles` object — which got
// removed when we moved to the useThemedStyles pattern.
function Stat({
  label, value, accent, styles,
}: { label: string; value: string; accent?: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// Theme-aware. Pre-fix this was a module-level StyleSheet.create that
// baked the light-theme Colors at load time, so dark mode rendered
// white-on-dark with broken contrast. Migrated to useThemedStyles so
// every screen flip recomputes colors. Active-chip + title also fixed:
// the half-size subheadline title was unique to this tab and the
// radius-chip-active style was inverting to ink (#text) instead of
// the brand accent.
const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandIcon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  eyebrow: { fontSize: 10, fontWeight: '800' as const, color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' as const },
  // Page title now matches the other tabs (largeTitle, weight 700). Pre-fix
  // this was Type.subheadline.fontSize (18px, 800) — literally half the
  // size of every other tab header. The standardized recipe lives in the
  // audit doc.
  title: { fontSize: Type.largeTitle.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.5, marginTop: 2 },
  postCta: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9,
    backgroundColor: t.accent,
  },
  postCtaText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const, color: '#FFF' },

  segmentRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  segment: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: Tokens.radius.md,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
  },
  segmentActive: { backgroundColor: t.accent + '12', borderColor: t.accent },
  segmentText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.textMuted },
  segmentTextActive: { color: t.accent },
  unreadDot: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: Tokens.radius.full, backgroundColor: t.accent, minWidth: 18, alignItems: 'center' },
  unreadDotText: { fontSize: 10, fontWeight: '800' as const, color: '#FFF' },

  controls: {
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  locBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: Tokens.radius.sm,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    alignSelf: 'flex-start',
  },
  locBtnText: { fontSize: Type.caption2.fontSize, color: t.text, fontWeight: '600' as const },
  mapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: Tokens.radius.sm,
    backgroundColor: t.accent + '14', borderWidth: 1, borderColor: t.accent + '30',
    alignSelf: 'flex-start',
  },
  mapBtnText: { fontSize: Type.caption2.fontSize, color: t.accent, fontWeight: '700' as const },
  radiusRow: { flexDirection: 'row', gap: 5 },
  radiusChip: {
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
  },
  // Active radius chip now flips to the brand accent. Pre-fix it
  // inverted to t.text (black-on-cream in light, white-on-ink in dark)
  // — a pre-rebrand legacy that doesn't read as "selected" in either
  // theme.
  radiusChipActive: { backgroundColor: t.accent, borderColor: t.accent },
  radiusChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.text },
  radiusChipTextActive: { color: '#FFF' },

  loading: { padding: 30, alignItems: 'center' },
  emptyCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 28,
    alignItems: 'center', gap: 8, marginTop: 22,
    borderWidth: 1, borderColor: t.line,
  },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '800' as const, color: t.text, marginTop: 4, textAlign: 'center' as const },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center' as const, lineHeight: 19, maxWidth: 340 },
  bigCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 11,
    backgroundColor: t.accent, marginTop: 10,
  },
  bigCtaText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.line, marginBottom: 12,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.3 },
  statLabel: { fontSize: 10, fontWeight: '700' as const, color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginTop: 3 },
  statDiv: { width: 1, alignSelf: 'stretch', backgroundColor: t.line, marginVertical: 4 },

  rfpCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: t.line, marginBottom: 12,
  },
  rfpHero: { width: '100%', height: 130, backgroundColor: t.bg },
  rfpBody: { padding: 14, gap: 6 },
  rfpHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rfpTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text, lineHeight: 21 },
  verifyDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: t.success + '15', alignItems: 'center', justifyContent: 'center' },
  rfpScope: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },
  rfpMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rfpMetaText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const },
  rfpBudget: { fontSize: Type.caption1.fontSize, color: t.text, fontWeight: '600' as const },
  rfpFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.line, gap: 8 },
  footChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full,
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.line,
  },
  footChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.text },

  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: Tokens.radius.full },
  statusPillText: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.6 },
  responseChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  responseChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },
  unreadDotSm: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: Tokens.radius.full, backgroundColor: t.accent, minWidth: 18, alignItems: 'center' },
  unreadDotSmText: { fontSize: 10, fontWeight: '800' as const, color: '#FFF' },
});
