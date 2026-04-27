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
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, MapPin, Inbox, ChevronRight, Clock, DollarSign, Crosshair,
  ShieldCheck, AlertTriangle, Trophy, Layers, Compass, Hammer,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles } from '@/utils/location';
import { formatMoney } from '@/utils/formatters';

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
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        )}

        {/* BROWSE mode */}
        {mode === 'browse' && !isLoading && filteredBrowse.length === 0 && (
          <View style={styles.emptyCard}>
            <Inbox size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No projects within {radius} miles yet</Text>
            <Text style={styles.emptyBody}>
              {!location
                ? 'Allow location access to see projects nearby, or expand your radius.'
                : 'New projects show up here as homeowners post them. Try a wider radius.'}
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
            <Stat label="Posted" value={String(myStats.total)} />
            <View style={styles.statDiv} />
            <Stat label="Open" value={String(myStats.open)} />
            <View style={styles.statDiv} />
            <Stat label="Awarded" value={String(myStats.awarded)} accent={myStats.awarded > 0 ? Colors.success : undefined} />
            <View style={styles.statDiv} />
            <Stat label="New bids" value={String(myStats.unread)} accent={myStats.unread > 0 ? Colors.primary : undefined} />
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

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandIcon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  eyebrow: { fontSize: 10, fontWeight: '800', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: 18, fontWeight: '800', color: Colors.text, letterSpacing: -0.3, marginTop: 2 },
  postCta: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9,
    backgroundColor: Colors.primary,
  },
  postCtaText: { fontSize: 12, fontWeight: '800', color: '#FFF' },

  segmentRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  segment: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: 10,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  segmentActive: { backgroundColor: Colors.primary + '12', borderColor: Colors.primary },
  segmentText:  { fontSize: 13, fontWeight: '700', color: Colors.textMuted },
  segmentTextActive: { color: Colors.primary },
  unreadDot: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: Colors.primary, minWidth: 18, alignItems: 'center' },
  unreadDotText: { fontSize: 10, fontWeight: '800', color: '#FFF' },

  controls: {
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  locBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    alignSelf: 'flex-start',
  },
  locBtnText: { fontSize: 11, color: Colors.text, fontWeight: '600' },
  radiusRow: { flexDirection: 'row', gap: 5 },
  radiusChip: {
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  radiusChipActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  radiusChipText:  { fontSize: 11, fontWeight: '700', color: Colors.text },
  radiusChipTextActive: { color: '#FFF' },

  loading: { padding: 30, alignItems: 'center' },
  emptyCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 28,
    alignItems: 'center', gap: 8, marginTop: 22,
    borderWidth: 1, borderColor: Colors.border,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: Colors.text, marginTop: 4, textAlign: 'center' },
  emptyBody: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 340 },
  bigCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 11,
    backgroundColor: Colors.primary, marginTop: 10,
  },
  bigCtaText: { color: '#FFF', fontSize: 14, fontWeight: '800' },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 12,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  statLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 },
  statDiv: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.border, marginVertical: 4 },

  rfpCard: {
    backgroundColor: Colors.card, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border, marginBottom: 12,
  },
  rfpHero: { width: '100%', height: 130, backgroundColor: Colors.background },
  rfpBody: { padding: 14, gap: 6 },
  rfpHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rfpTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text, lineHeight: 21 },
  verifyDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.success + '15', alignItems: 'center', justifyContent: 'center' },
  rfpScope: { fontSize: 12, color: Colors.textMuted, lineHeight: 17 },
  rfpMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rfpMetaText: { flex: 1, fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  rfpBudget: { fontSize: 12, color: Colors.text, fontWeight: '600' },
  rfpFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.border, gap: 8 },
  footChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
  },
  footChipText: { fontSize: 11, fontWeight: '700', color: Colors.text },

  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  responseChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  responseChipText: { fontSize: 12, fontWeight: '700', color: Colors.text },
  unreadDotSm: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: Colors.primary, minWidth: 18, alignItems: 'center' },
  unreadDotSmText: { fontSize: 10, fontWeight: '800', color: '#FFF' },
});
