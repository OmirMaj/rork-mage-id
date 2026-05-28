// components/ClientHome.tsx — home dashboard for the property-owner / real-
// estate-client persona. Renders inside the (home) tab when ProjectContext
// reports userRole === 'client' (see app/(tabs)/(home)/index.tsx).
//
// The contractor home is dense with operations surfaces (estimate, schedule,
// daily report, RFIs, change orders, AI briefings). The client home is the
// opposite — a focused hub that answers four questions a property owner
// actually has every time they open the app:
//   1. Where do I start? → big "Post a Project" hero
//   2. What's happening with my postings? → Active RFPs list with bid counts
//   3. What's underway? → In-Progress (awarded) projects
//   4. What needs my attention? → Empty for MVP, will be inbox/messages later
//
// Data comes from the same `public_bids` + `bid_responses` tables as
// /my-rfps — duplicated as its own query here so the hub can grow its own
// derived stats (e.g. "ending soon", "no bids yet") without entangling
// my-rfps's row shape.

import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Sparkles, MapPin, ChevronRight, Inbox, Trophy, Clock,
} from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { formatMoney } from '@/utils/formatters';

interface ClientRfpRow {
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
  awarded_at: string | null;
  response_count: number;
  unreviewed_count: number;
}

export default function ClientHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const enabled = !!user?.id && isSupabaseConfigured;

  // Pulls the user's RFPs + per-row response counts in two queries. Same
  // shape my-rfps.tsx uses, kept local so future client-side derived stats
  // (e.g. "no bids in 7 days", "ending soon") can live without forcing
  // a wider shared shape.
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['client-home-rfps', user?.id],
    enabled,
    queryFn: async (): Promise<ClientRfpRow[]> => {
      if (!user?.id) return [];
      const { data: rfps, error } = await supabase
        .from('public_bids')
        .select('id,title,city,state,status,budget_min,budget_max,photo_urls,posted_date,awarded_response_id,awarded_at')
        .eq('user_id', user.id)
        .eq('is_homeowner_rfp', true)
        .order('posted_date', { ascending: false });
      if (error) {
        console.warn('[client-home] fetch error', error);
        return [];
      }
      if (!rfps || rfps.length === 0) return [];

      const ids = rfps.map(r => r.id);
      const { data: responses } = await supabase
        .from('bid_responses')
        .select('bid_id,status')
        .in('bid_id', ids);

      const counts = new Map<string, { total: number; unreviewed: number }>();
      for (const r of (responses ?? [])) {
        const c = counts.get(r.bid_id) ?? { total: 0, unreviewed: 0 };
        c.total += 1;
        // 'submitted' = the homeowner hasn't shortlisted/declined yet. This
        // is what drives the "needs your attention" badge on the card.
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

  // Stable reference for the rfps list — the query returns a new array
  // identity on every refetch which would invalidate the partition + totals
  // useMemos. The `?? []` fallback also creates a fresh empty array each
  // render without this wrap.
  const rfps = useMemo(() => data ?? [], [data]);

  // Partition once for the two list sections + the stats strip. Single
  // pass through the data — easier to reason about than three filter()
  // calls scattered across the JSX.
  const partitioned = useMemo(() => {
    const open: ClientRfpRow[] = [];
    const awarded: ClientRfpRow[] = [];
    for (const r of rfps) {
      if (r.awarded_response_id) awarded.push(r);
      else if (r.status === 'open') open.push(r);
    }
    return { open, awarded };
  }, [rfps]);

  const totals = useMemo(() => ({
    posted: rfps.length,
    open: partitioned.open.length,
    awarded: partitioned.awarded.length,
    newBids: rfps.reduce((s, r) => s + r.unreviewed_count, 0),
  }), [rfps, partitioned.open.length, partitioned.awarded.length]);

  const handlePostProject = useCallback(() => {
    router.push('/post-rfp' as never);
  }, [router]);

  const handleOpenRfp = useCallback((rfpId: string) => {
    router.push({ pathname: '/rfp-responses-review' as never, params: { bidId: rfpId } as never });
  }, [router]);

  const isEmpty = !isLoading && rfps.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => { void refetch(); }}
            tintColor={themeColors.accent}
          />
        }
      >
        {/* Header — mirrors the eyebrow/title pattern used in /my-rfps so
            the two surfaces feel like the same product. No back button —
            this is a tab root. */}
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Property owner</Text>
          <Text style={styles.title}>Your projects</Text>
        </View>

        {/* Hero CTA — the single most important action on this screen.
            Big, branded, always visible. Stays even when the user has
            existing RFPs because property owners typically have multiple
            ongoing projects (a flipper has 3 houses; a PM has 50 units). */}
        <TouchableOpacity
          style={styles.heroCta}
          onPress={handlePostProject}
          activeOpacity={0.85}
          testID="client-home-post-cta"
        >
          <View style={styles.heroCtaIcon}>
            <Plus size={20} color="#FFF" strokeWidth={2.4} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroCtaTitle}>Post a project</Text>
            <Text style={styles.heroCtaBody}>
              Describe what you want done. Verified contractors near you will bid.
            </Text>
          </View>
          <ChevronRight size={18} color="#FFF" />
        </TouchableOpacity>

        {/* Stats strip — same look as /my-rfps so the visual language stays
            consistent when users tap from hub → list. Hidden when the user
            has zero RFPs (no stats to show). */}
        {rfps.length > 0 && (
          <View style={styles.statsRow}>
            <Stat label="Posted" value={String(totals.posted)} />
            <View style={styles.statDivider} />
            <Stat label="Open" value={String(totals.open)} />
            <View style={styles.statDivider} />
            <Stat
              label="Awarded"
              value={String(totals.awarded)}
              accent={totals.awarded > 0 ? themeColors.success : undefined}
            />
            <View style={styles.statDivider} />
            <Stat
              label="New bids"
              value={String(totals.newBids)}
              accent={totals.newBids > 0 ? themeColors.accent : undefined}
            />
          </View>
        )}

        {isLoading && rfps.length === 0 && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="small" color={themeColors.accent} />
            <Text style={styles.loadingText}>Loading your projects…</Text>
          </View>
        )}

        {/* Empty state — first-impression copy. Same recipe as /my-rfps
            but tightened: the hero CTA above is already the call to
            action, so we keep this purely informational. */}
        {isEmpty && (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <Sparkles size={28} color={themeColors.accent} />
            </View>
            <Text style={styles.emptyTitle}>Welcome to MAGE ID</Text>
            <Text style={styles.emptyBody}>
              When you post a project, verified contractors get notified and send you bids.
              Compare side-by-side, pick the one you like, and track the work — all in one place.
            </Text>
          </View>
        )}

        {/* Active RFPs — only RFPs that are open AND not yet awarded.
            Sorted newest first by the query. */}
        {partitioned.open.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Active RFPs</Text>
              <Text style={styles.sectionCount}>{partitioned.open.length}</Text>
            </View>
            {partitioned.open.map(r => (
              <RfpCard
                key={r.id}
                row={r}
                onPress={() => handleOpenRfp(r.id)}
                accent={themeColors.accent}
                styles={styles}
                themeColors={themeColors}
              />
            ))}
          </View>
        )}

        {/* In Progress — RFPs that have been awarded. These should
            eventually link into the awarded project's portal, but for
            this commit they still link to the responses-review screen
            which shows the awarded bid + lets the user message the
            contractor. */}
        {partitioned.awarded.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>In progress</Text>
              <Text style={styles.sectionCount}>{partitioned.awarded.length}</Text>
            </View>
            {partitioned.awarded.map(r => (
              <RfpCard
                key={r.id}
                row={r}
                onPress={() => handleOpenRfp(r.id)}
                accent={themeColors.success}
                styles={styles}
                themeColors={themeColors}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function RfpCard({
  row,
  onPress,
  accent,
  styles,
  themeColors,
}: {
  row: ClientRfpRow;
  onPress: () => void;
  accent: string;
  styles: ReturnType<typeof makeStyles>;
  themeColors: ThemeColors;
}) {
  const heroPhoto = (row.photo_urls && row.photo_urls.length > 0) ? row.photo_urls[0] : null;
  const isAwarded = !!row.awarded_response_id;
  const isOpen = row.status === 'open' && !isAwarded;
  return (
    <TouchableOpacity
      style={styles.rfpCard}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityLabel={`${row.title}, ${row.response_count} bids${row.unreviewed_count > 0 ? `, ${row.unreviewed_count} new` : ''}`}
      accessibilityRole="button"
    >
      {heroPhoto ? (
        <Image source={{ uri: heroPhoto }} style={styles.rfpHero} resizeMode="cover" />
      ) : (
        <View style={[styles.rfpHero, styles.rfpHeroPlaceholder]}>
          <Inbox size={24} color={themeColors.textMuted} />
        </View>
      )}
      <View style={styles.rfpBody}>
        <View style={styles.rfpHead}>
          <Text style={styles.rfpTitle} numberOfLines={2}>{row.title}</Text>
          {isAwarded && (
            <View style={[styles.statusPill, { backgroundColor: themeColors.success + '20' }]}>
              <Trophy size={10} color={themeColors.success} />
              <Text style={[styles.statusPillText, { color: themeColors.success }]}>AWARDED</Text>
            </View>
          )}
          {isOpen && (
            <View style={[styles.statusPill, { backgroundColor: accent + '20' }]}>
              <Clock size={10} color={accent} />
              <Text style={[styles.statusPillText, { color: accent }]}>OPEN</Text>
            </View>
          )}
        </View>
        <View style={styles.rfpMeta}>
          <MapPin size={11} color={themeColors.textMuted} />
          <Text style={styles.rfpMetaText} numberOfLines={1}>
            {[row.city, row.state].filter(Boolean).join(', ') || 'Address pending'}
          </Text>
        </View>
        {(row.budget_min || row.budget_max) && (
          <Text style={styles.rfpBudget}>
            Budget: {row.budget_min ? formatMoney(row.budget_min) : '?'}
            {' – '}
            {row.budget_max ? formatMoney(row.budget_max) : '?'}
          </Text>
        )}
        <View style={styles.rfpFoot}>
          <View style={styles.rfpResponseChip}>
            <Text style={styles.rfpResponseChipText}>
              {row.response_count} bid{row.response_count === 1 ? '' : 's'}
            </Text>
            {row.unreviewed_count > 0 && (
              <View style={[styles.unreadDot, { backgroundColor: accent }]}>
                <Text style={styles.unreadDotText}>{row.unreviewed_count}</Text>
              </View>
            )}
          </View>
          <ChevronRight size={14} color={themeColors.textMuted} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  header: {
    marginBottom: 14,
  },
  eyebrow: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700',
    color: t.accent,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: Type.title1.fontSize,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.6,
    marginTop: 4,
  },

  // ── Hero CTA: the single most-tapped affordance for the persona.
  //    Branded fill (accent), white iconography, generous height. Big
  //    enough to read at-a-glance, restrained enough not to compete with
  //    actual project cards below.
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.accent,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: Tokens.radius.lg,
    marginBottom: 16,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 4,
  },
  heroCtaIcon: {
    width: 38,
    height: 38,
    borderRadius: Tokens.radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCtaTitle: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: -0.2,
  },
  heroCtaBody: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.86)',
    marginTop: 2,
    lineHeight: 17,
  },

  // ── Stats strip (4 cells) — same visual language as /my-rfps so
  //    transitions between hub and list don't feel like different apps.
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: t.line,
    marginBottom: 14,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700',
    color: t.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 4,
  },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: t.line, marginVertical: 6 },

  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 18,
    justifyContent: 'center',
  },
  loadingText: { fontSize: Type.footnote.fontSize, color: t.textMuted },

  emptyCard: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.panel,
    padding: 28,
    borderWidth: 1,
    borderColor: t.line,
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: Tokens.radius.xl,
    backgroundColor: t.accent + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800',
    color: t.text,
    marginTop: 4,
  },
  emptyBody: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 340,
  },

  // ── Section grouping: "Active RFPs" + "In progress" reuse the same
  //    head bar; the count chip on the right hints at length without
  //    forcing the user to scan.
  section: { marginTop: 18 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.2,
  },
  sectionCount: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700',
    color: t.textMuted,
    letterSpacing: 0.4,
  },

  // ── RFP cards — same shape as /my-rfps so users see continuity when
  //    they go from hub → drill-down. Photo on top, body below, footer
  //    with bid count + chevron.
  rfpCard: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.line,
    marginBottom: 12,
  },
  rfpHero: { width: '100%', height: 140, backgroundColor: t.bg },
  rfpHeroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rfpBody: { padding: 14, gap: 6 },
  rfpHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rfpTitle: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    fontWeight: '700',
    color: t.text,
    lineHeight: 21,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Tokens.radius.full,
  },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  rfpMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rfpMetaText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
    fontWeight: '600',
  },
  rfpBudget: { fontSize: Type.caption1.fontSize, color: t.text, fontWeight: '600' },
  rfpFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: t.line,
  },
  rfpResponseChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rfpResponseChipText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700',
    color: t.text,
  },
  unreadDot: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Tokens.radius.full,
    minWidth: 18,
    alignItems: 'center',
  },
  unreadDotText: { fontSize: 10, fontWeight: '800', color: '#FFF' },
});
