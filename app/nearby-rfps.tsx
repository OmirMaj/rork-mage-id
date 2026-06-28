// nearby-rfps — contractor-facing feed of homeowner RFPs near them. Sorted
// by distance from the device's current location (haversine). Tapping a
// row opens rfp-detail.tsx where they can submit a bid.
//
// We keep matching client-side for now: pull all open homeowner RFPs,
// compute distance from the device, sort + filter. With a few thousand
// RFPs this stays fast. When volume grows we'll move to PostGIS server-
// side filtering via the notify-nearby-contractors edge function.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft, MapPin, Inbox, ChevronRight, Clock, DollarSign,
  Crosshair, ShieldCheck, AlertTriangle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles } from '@/utils/location';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface RfpRow {
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

interface RfpWithDistance extends RfpRow {
  distance: number | null;
}

const RADIUS_OPTIONS = [10, 25, 50, 100, 250] as const;

export default function NearbyRfpsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { location, refresh: requestLocation, loading: locLoading } = useUserLocation();
  const [radius, setRadius] = useState<number>(25);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['nearby-rfps'],
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<RfpRow[]> => {
      const { data: rfps, error } = await supabase
        .from('public_bids')
        .select('id,title,city,state,status,scope_description,budget_min,budget_max,desired_start,photo_urls,latitude,longitude,address_verified,posted_date,deadline')
        .eq('is_homeowner_rfp', true)
        .eq('status', 'open')
        .order('posted_date', { ascending: false })
        .limit(200);
      if (error) {
        console.warn('[nearby-rfps] fetch error', error);
        return [];
      }
      return (rfps ?? []).map(r => ({
        ...r,
        photo_urls: r.photo_urls as string[] | null,
      }));
    },
  });

  const filtered = useMemo<RfpWithDistance[]>(() => {
    const rfps = data ?? [];
    const enriched = rfps.map(r => {
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
  }, [data, location, radius]);

  const handleOpenRfp = useCallback((id: string) => {
    router.push({ pathname: '/rfp-detail' as never, params: { bidId: id } as never });
  }, [router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Homeowner RFPs</Text>
          <Text style={styles.title}>Projects near you</Text>
        </View>
      </View>

      {/* Location + radius controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.locBtn} onPress={() => { void requestLocation(); }}>
          <Crosshair size={14} color={location ? themeColors.success : themeColors.accent} strokeWidth={1.75} />
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
              <Text style={[styles.radiusChipText, radius === r && styles.radiusChipTextActive]}>
                {r}mi
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} tintColor={themeColors.accent} />
        }
      >
        {isLoading && filtered.length === 0 && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={themeColors.accent} />
          </View>
        )}

        {!isLoading && filtered.length === 0 && (
          <View style={styles.emptyCard}>
            <Inbox size={28} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No projects within {radius} miles yet</Text>
            <Text style={styles.emptyBody}>
              {!location ? 'Allow location access to see projects near you, or expand your radius.' : 'Try expanding the radius — new projects show up here as homeowners post them.'}
            </Text>
          </View>
        )}

        {filtered.map(r => {
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
            >
              {heroPhoto ? (
                <Image source={{ uri: heroPhoto }} style={styles.rfpHero} resizeMode="cover" />
              ) : null}
              <View style={styles.rfpBody}>
                <View style={styles.rfpHead}>
                  <Text style={styles.rfpTitle} numberOfLines={2}>{r.title}</Text>
                  {r.address_verified ? (
                    <View style={styles.verifyDot}>
                      <ShieldCheck size={10} color={themeColors.success} strokeWidth={1.75} />
                    </View>
                  ) : (
                    <View style={[styles.verifyDot, { backgroundColor: Colors.warning + '20' }]}>
                      <AlertTriangle size={10} color={Colors.warning} strokeWidth={1.75} />
                    </View>
                  )}
                </View>

                {r.scope_description ? (
                  <Text style={styles.rfpScope} numberOfLines={3}>{r.scope_description}</Text>
                ) : null}

                <View style={styles.rfpMetaRow}>
                  <View style={styles.rfpMetaItem}>
                    <MapPin size={11} color={themeColors.textMuted} strokeWidth={1.75} />
                    <Text style={styles.rfpMetaText}>
                      {[r.city, r.state].filter(Boolean).join(', ') || 'Location pending'} · {distanceText}
                    </Text>
                  </View>
                </View>

                <View style={styles.rfpFoot}>
                  {(r.budget_min || r.budget_max) ? (
                    <View style={styles.rfpFootChip}>
                      <DollarSign size={11} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.rfpFootChipText}>
                        {r.budget_min ? formatMoney(r.budget_min) : '?'} – {r.budget_max ? formatMoney(r.budget_max) : '?'}
                      </Text>
                    </View>
                  ) : <View />}
                  <View style={[styles.rfpFootChip, daysLeft < 3 ? { backgroundColor: themeColors.danger + '15' } : null]}>
                    <Clock size={11} color={daysLeft < 3 ? themeColors.danger : themeColors.textMuted} strokeWidth={1.75} />
                    <Text style={[styles.rfpFootChipText, daysLeft < 3 ? { color: themeColors.danger } : null]}>
                      {daysLeft <= 0 ? 'Closing today' : `${daysLeft}d left`}
                    </Text>
                  </View>
                  <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, marginTop: 4 },

  controls: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
    backgroundColor: t.bg,
    gap: 8,
  },
  locBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
    alignSelf: 'flex-start',
  },
  locBtnText: { fontSize: Type.caption1.fontSize, color: t.text, fontWeight: '600' },
  radiusRow: { flexDirection: 'row', gap: 6 },
  radiusChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  radiusChipActive: { backgroundColor: t.text, borderColor: t.text },
  radiusChipText:  { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },
  radiusChipTextActive: { color: '#FFF' },

  loading: { padding: 30, alignItems: 'center' },
  emptyCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 28,
    alignItems: 'center', gap: 8, marginTop: 22,
    borderWidth: 1, borderColor: t.line,
  },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, marginTop: 4 },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },

  rfpCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: t.line,
    marginBottom: 12,
  },
  rfpHero: { width: '100%', height: 130, backgroundColor: t.bg },
  rfpBody: { padding: 14, gap: 6 },
  rfpHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rfpTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text, lineHeight: 21 },
  verifyDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: t.success + '15', alignItems: 'center', justifyContent: 'center' },
  rfpScope: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },
  rfpMetaRow: { flexDirection: 'row', alignItems: 'center' },
  rfpMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rfpMetaText: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },
  rfpFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.line, gap: 8 },
  rfpFootChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full,
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.line,
  },
  rfpFootChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.text },
});
