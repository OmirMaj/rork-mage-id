// my-rfps — homeowner dashboard. Lists every RFP the signed-in user has
// posted, with response counts and quick links to review/award.

import React, { useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft, Plus, Sparkles, Inbox, MapPin, ChevronRight,
  CheckCircle2, Clock, Trophy,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { formatMoney } from '@/utils/formatters';

interface MyRfpRow {
  id: string;
  title: string;
  city: string;
  state: string;
  status: string;
  budget_min: number | null;
  budget_max: number | null;
  photo_urls: string[] | null;
  scope_description: string | null;
  posted_date: string;
  awarded_response_id: string | null;
  awarded_at: string | null;
  response_count: number;
  unreviewed_count: number;
}

export default function MyRfpsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const enabled = !!user?.id && isSupabaseConfigured;

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['my-rfps', user?.id],
    enabled,
    queryFn: async (): Promise<MyRfpRow[]> => {
      if (!user?.id) return [];
      // Pull every RFP the user posted + count responses per row.
      const { data: rfps, error } = await supabase
        .from('public_bids')
        .select('id,title,city,state,status,budget_min,budget_max,photo_urls,scope_description,posted_date,awarded_response_id,awarded_at')
        .eq('user_id', user.id)
        .eq('is_homeowner_rfp', true)
        .order('posted_date', { ascending: false });
      if (error) {
        console.warn('[my-rfps] fetch error', error);
        return [];
      }
      if (!rfps || rfps.length === 0) return [];

      // Count responses per RFP. One round-trip rather than N+1.
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

  const rfps = data ?? [];

  const handleNew = useCallback(() => {
    router.push('/post-rfp' as never);
  }, [router]);

  const totals = useMemo(() => ({
    rfps: rfps.length,
    open: rfps.filter(r => r.status === 'open').length,
    awarded: rfps.filter(r => !!r.awarded_response_id).length,
    inbox: rfps.reduce((s, r) => s + r.unreviewed_count, 0),
  }), [rfps]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Your projects</Text>
          <Text style={styles.title}>My posted projects</Text>
        </View>
        <TouchableOpacity style={styles.headerCta} onPress={handleNew}>
          <Plus size={16} color="#FFF" />
          <Text style={styles.headerCtaText}>New</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => { void refetch(); }}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Summary strip */}
        {rfps.length > 0 && (
          <View style={styles.statsRow}>
            <Stat label="Posted" value={String(totals.rfps)} />
            <View style={styles.statDivider} />
            <Stat label="Open" value={String(totals.open)} />
            <View style={styles.statDivider} />
            <Stat label="Awarded" value={String(totals.awarded)} accent={totals.awarded > 0 ? Colors.success : undefined} />
            <View style={styles.statDivider} />
            <Stat label="New bids" value={String(totals.inbox)} accent={totals.inbox > 0 ? Colors.primary : undefined} />
          </View>
        )}

        {isLoading && rfps.length === 0 && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading your projects…</Text>
          </View>
        )}

        {!isLoading && rfps.length === 0 && (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <Sparkles size={28} color={Colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>Post your first project</Text>
            <Text style={styles.emptyBody}>
              Tell us what you want done — kitchen remodel, roof replacement, anything. Verified
              contractors near you get notified, and you pick the bid you like best. No fees.
            </Text>
            <TouchableOpacity style={styles.emptyCta} onPress={handleNew}>
              <Plus size={14} color="#FFF" />
              <Text style={styles.emptyCtaText}>Post a project</Text>
            </TouchableOpacity>
          </View>
        )}

        {rfps.map(r => {
          const heroPhoto = (r.photo_urls && r.photo_urls.length > 0) ? r.photo_urls[0] : null;
          const isAwarded = !!r.awarded_response_id;
          const isOpen = r.status === 'open' && !isAwarded;
          return (
            <TouchableOpacity
              key={r.id}
              style={styles.rfpCard}
              onPress={() => router.push({ pathname: '/rfp-responses-review' as never, params: { bidId: r.id } as never })}
              activeOpacity={0.85}
            >
              {heroPhoto ? (
                <Image source={{ uri: heroPhoto }} style={styles.rfpHero} resizeMode="cover" />
              ) : (
                <View style={[styles.rfpHero, styles.rfpHeroPlaceholder]}>
                  <Inbox size={24} color={Colors.textMuted} />
                </View>
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
                    Budget: {r.budget_min ? formatMoney(r.budget_min) : '?'}
                    {' – '}
                    {r.budget_max ? formatMoney(r.budget_max) : '?'}
                  </Text>
                )}
                <View style={styles.rfpFoot}>
                  <View style={styles.rfpResponseChip}>
                    <Text style={styles.rfpResponseChipText}>
                      {r.response_count} bid{r.response_count === 1 ? '' : 's'}
                    </Text>
                    {r.unreviewed_count > 0 && (
                      <View style={styles.unreadDot}>
                        <Text style={styles.unreadDotText}>{r.unreviewed_count}</Text>
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
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  eyebrow: { fontSize: 11, fontWeight: '700', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: 22, fontWeight: '800', color: Colors.text, letterSpacing: -0.4, marginTop: 4 },
  headerCta: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9,
    backgroundColor: Colors.primary,
  },
  headerCtaText: { fontSize: 13, fontWeight: '700', color: '#FFF' },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: 14,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.border, marginVertical: 6 },

  loadingCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 18, justifyContent: 'center' },
  loadingText: { fontSize: 13, color: Colors.textMuted },

  emptyCard: {
    backgroundColor: Colors.card, borderRadius: 16, padding: 28,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', gap: 8, marginTop: 22,
  },
  emptyIconWrap: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, marginTop: 4 },
  emptyBody: { fontSize: 13, color: Colors.text, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12,
    backgroundColor: Colors.primary, marginTop: 12,
  },
  emptyCtaText: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  rfpCard: {
    backgroundColor: Colors.card, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: 12,
  },
  rfpHero: { width: '100%', height: 140, backgroundColor: Colors.background },
  rfpHeroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rfpBody: { padding: 14, gap: 6 },
  rfpHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rfpTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text, lineHeight: 21 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  rfpMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rfpMetaText: { flex: 1, fontSize: 12, color: Colors.textMuted, fontWeight: '600' },
  rfpBudget: { fontSize: 12, color: Colors.text, fontWeight: '600' },
  rfpFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  rfpResponseChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rfpResponseChipText: { fontSize: 12, fontWeight: '700', color: Colors.text },
  unreadDot: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: Colors.primary, minWidth: 18, alignItems: 'center' },
  unreadDotText: { fontSize: 10, fontWeight: '800', color: '#FFF' },
});
