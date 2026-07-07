// components/ClientHome.tsx — home hub for the property-owner / real-estate
// persona. Renders inside the (home) tab when ProjectContext reports
// userRole === 'client' (see app/(tabs)/(home)/index.tsx).
//
// Visual direction: this surface is the first thing a real-estate operator
// sees when they open the app. The contractor home is a tool; this one is
// a *portfolio dashboard*. Time-aware greeting up top, live one-liner that
// summarises what's moving, a gradient hero CTA with an embedded building
// silhouette, animated stat tiles (Plus → Clock → Trophy → Sparkles), and
// project cards that fill their hero void with a soft accent-tinted
// blueprint gradient + Building silhouette when no photo is set, plus a
// "Posted Xh ago" chip overlay so every card carries momentum.
//
// Data still comes from `public_bids` + `bid_responses` — same shape
// /my-rfps uses. Animations are RN's built-in Animated API (no reanimated
// dependency) running on the native driver where possible.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
  Animated,
  Easing,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Plus, MapPin, ChevronRight, Building2, Trophy, Clock,
  LayoutGrid, Sun, Moon, Sunrise, Sunset,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';

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

// Time-of-day greeting. Keeps the header personal without leaning on
// per-user data we don't have yet (last login, weather, etc).
function greetingFor(d: Date = new Date()): { text: string; Icon: React.ComponentType<any> } {
  const h = d.getHours();
  if (h < 6)  return { text: 'Working late', Icon: Moon };
  if (h < 12) return { text: 'Good morning', Icon: Sunrise };
  if (h < 17) return { text: 'Good afternoon', Icon: Sun };
  if (h < 21) return { text: 'Good evening', Icon: Sunset };
  return { text: 'Working late', Icon: Moon };
}

// Compact relative time. Used in the per-card "Posted Xh ago" chip plus
// the activity micro-line. Kept inline so we don't pull date-fns just for
// six branches.
//
// Boundary handling: at d=28-29, the old `w < 4` check let us fall through
// to months even though `Math.floor(d/30)` is still 0 — producing the
// awkward "0mo ago". We now explicitly cap weeks at 30 days and clamp
// months to ≥1.
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const ms = Date.now() - t;
  if (ms < 0) return 'just now';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

// Tiny entrance wrapper — fade + 12px rise, native driver, no extra
// packages. Stagger by passing `delay`. Reset by remounting (we don't try
// to replay on data change; one-shot on initial render is the intent).
function FadeRise({ delay = 0, children, style }: {
  delay?: number;
  children: React.ReactNode;
  style?: any;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 380,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 380,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY, delay]);
  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
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

  // The "live one-liner" under the greeting. Composes from real numbers
  // so it never lies. Empty state gets its own copy.
  const subtitle = useMemo(() => {
    if (totals.posted === 0) return 'Ready when you are — post your first project below.';
    const parts: string[] = [];
    if (totals.open > 0)    parts.push(`${totals.open} out for bid`);
    if (totals.awarded > 0) parts.push(`${totals.awarded} in progress`);
    if (totals.newBids > 0) parts.push(`${totals.newBids} new bid${totals.newBids === 1 ? '' : 's'}`);
    if (parts.length === 0) return `${totals.posted} project${totals.posted === 1 ? '' : 's'} tracked`;
    return parts.join('  ·  ');
  }, [totals]);

  const greeting = useMemo(() => greetingFor(), []);
  const firstName = useMemo(() => {
    const raw = (user?.name || '').trim();
    if (!raw) return '';
    return raw.split(/\s+/)[0];
  }, [user?.name]);

  const handlePostProject = useCallback(() => {
    router.push('/post-rfp' as never);
  }, [router]);

  const handleOpenRfp = useCallback((rfpId: string) => {
    router.push({ pathname: '/rfp-responses-review' as never, params: { bidId: rfpId } as never });
  }, [router]);

  const isEmpty = !isLoading && rfps.length === 0;
  const GreetingIcon = greeting.Icon;

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
        {/* Greeting — time-aware glyph + first name + live subtitle.
            Replaces the "PROPERTY OWNER / Your projects" eyebrow which
            felt institutional. Personal but not gimmicky. */}
        <FadeRise delay={0}>
          <View style={styles.header}>
            <View style={styles.greetingRow}>
              <View style={styles.greetingIconWrap}>
                <GreetingIcon size={14} color={themeColors.accent} strokeWidth={2.4} />
              </View>
              <Text style={styles.greetingEyebrow}>
                {greeting.text}{firstName ? `, ${firstName}` : ''}
              </Text>
            </View>
            <Text style={styles.title}>Your portfolio</Text>
            <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
          </View>
        </FadeRise>

        {/* Hero CTA — flat amber fill, decorative Building silhouette in
            the bottom-right. The single most-tapped affordance on this
            screen. One flat accent, no gradient. */}
        <FadeRise delay={80}>
          <TouchableOpacity
            onPress={handlePostProject}
            activeOpacity={0.9}
            testID="client-home-post-cta"
          >
            <View style={[styles.heroCta, { backgroundColor: themeColors.accent }]}>
              {/* Decorative bg — a stylised multi-unit building, signals
                  real-estate without being a literal home icon. */}
              <View style={styles.heroCtaBg} pointerEvents="none">
                <Building2 size={140} color="rgba(255,255,255,0.12)" strokeWidth={1.2} />
              </View>
              <View style={styles.heroCtaIcon}>
                <Plus size={20} color="#FFF" strokeWidth={2.6} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroCtaTitle}>Post a project</Text>
                <Text style={styles.heroCtaBody}>
                  From a kitchen remodel to a full gut — verified contractors will bid on your scope.
                </Text>
              </View>
              <ChevronRight size={18} color="#FFF" strokeWidth={1.75} />
            </View>
          </TouchableOpacity>
        </FadeRise>

        {/* Stats tiles — icon + value + label + accent bar. The bar lights
            up when value > 0 so the eye can scan "what's live" in a half-
            second. Hidden when there are no projects (nothing to count). */}
        {rfps.length > 0 && (
          <FadeRise delay={140}>
            <View style={styles.statsRow}>
              <StatTile
                icon={LayoutGrid}
                label="Posted"
                value={totals.posted}
                accent={themeColors.text}
                lit={totals.posted > 0}
              />
              <StatTile
                icon={Clock}
                label="Open"
                value={totals.open}
                accent={themeColors.accent}
                lit={totals.open > 0}
              />
              <StatTile
                icon={Trophy}
                label="Awarded"
                value={totals.awarded}
                accent={themeColors.success}
                lit={totals.awarded > 0}
              />
              <StatTile
                icon={MageAIMark}
                label="New bids"
                value={totals.newBids}
                accent={themeColors.accent}
                lit={totals.newBids > 0}
              />
            </View>
          </FadeRise>
        )}

        {isLoading && rfps.length === 0 && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="small" color={themeColors.accent} />
            <Text style={styles.loadingText}>Loading your projects…</Text>
          </View>
        )}

        {/* Empty state — first impression copy. Same recipe as /my-rfps
            but tightened: the hero CTA above is already the call to
            action, so we keep this purely informational. */}
        {isEmpty && (
          <FadeRise delay={200}>
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconWrap}>
                <MageAIMark size={28} color={themeColors.accent} />
              </View>
              <Text style={styles.emptyTitle}>Welcome to MAGE ID</Text>
              <Text style={styles.emptyBody}>
                Post your scope and verified contractors near the property send you bids.
                Compare side-by-side, pick the build you like, and track the work — one app, your whole portfolio.
              </Text>
            </View>
          </FadeRise>
        )}

        {/* Active RFPs — only RFPs that are open AND not yet awarded.
            Sorted newest first by the query. Staggered entrance so the
            list lands as a wave, not a slam. */}
        {partitioned.open.length > 0 && (
          <View style={styles.section}>
            <FadeRise delay={200}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Out for bid</Text>
                <View style={styles.sectionCountPill}>
                  <Text style={styles.sectionCountText}>{partitioned.open.length}</Text>
                </View>
              </View>
            </FadeRise>
            {partitioned.open.map((r, i) => (
              <FadeRise key={r.id} delay={240 + i * 60}>
                <RfpCard
                  row={r}
                  onPress={() => handleOpenRfp(r.id)}
                  accent={themeColors.accent}
                  styles={styles}
                  themeColors={themeColors}
                />
              </FadeRise>
            ))}
          </View>
        )}

        {/* In Progress — RFPs that have been awarded. */}
        {partitioned.awarded.length > 0 && (
          <View style={styles.section}>
            <FadeRise delay={240}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>In progress</Text>
                <View style={[styles.sectionCountPill, { backgroundColor: themeColors.success + '20' }]}>
                  <Text style={[styles.sectionCountText, { color: themeColors.success }]}>
                    {partitioned.awarded.length}
                  </Text>
                </View>
              </View>
            </FadeRise>
            {partitioned.awarded.map((r, i) => (
              <FadeRise key={r.id} delay={280 + i * 60}>
                <RfpCard
                  row={r}
                  onPress={() => handleOpenRfp(r.id)}
                  accent={themeColors.success}
                  styles={styles}
                  themeColors={themeColors}
                />
              </FadeRise>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
  lit,
}: {
  icon: React.ComponentType<any>;
  label: string;
  value: number;
  accent: string;
  lit: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.statTile}>
      <View style={[styles.statIconWrap, lit ? { backgroundColor: accent + '18' } : null]}>
        <Icon size={14} color={lit ? accent : styles.statIconWrap.borderColor || '#999'} strokeWidth={2.2} />
      </View>
      <Text style={[styles.statValue, lit ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={[styles.statAccentBar, lit ? { backgroundColor: accent } : null]} />
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
  const posted = timeAgo(row.posted_date);
  // Fall back to the gradient placeholder if the photo URL fails to load
  // (broken link, expired signed URL, offline, etc.). Without this the
  // Image silently renders nothing and the hero looks like a blank cream
  // strip instead of the branded placeholder.
  const [photoFailed, setPhotoFailed] = React.useState(false);
  const showPhoto = !!heroPhoto && !photoFailed;

  return (
    <TouchableOpacity
      style={styles.rfpCard}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityLabel={`${row.title}, ${row.response_count} bids${row.unreviewed_count > 0 ? `, ${row.unreviewed_count} new` : ''}`}
      accessibilityRole="button"
    >
      {/* Hero — photo if we have one, otherwise a soft accent-tinted
          gradient with a Building2 silhouette. The void in the old design
          looked unfinished; here it carries identity. */}
      <View style={styles.rfpHeroWrap}>
        {showPhoto ? (
          <Image
            source={{ uri: heroPhoto as string }}
            style={styles.rfpHero}
            resizeMode="cover"
            onError={() => setPhotoFailed(true)}
          />
        ) : (
          <LinearGradient
            colors={[themeColors.accent + '1A', themeColors.accent + '08', themeColors.accent + '12']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.rfpHero, styles.rfpHeroPlaceholder]}
          >
            <Building2 size={64} color={themeColors.accent + '55'} strokeWidth={1.3} />
          </LinearGradient>
        )}
        {/* Timestamp chip — bottom-left, always visible, glass background
            so it reads on both photos and the placeholder gradient. */}
        <View style={[
          styles.rfpTimestampChip,
          showPhoto ? styles.rfpTimestampChipDark : styles.rfpTimestampChipLight,
        ]}>
          <Clock size={10} color={showPhoto ? '#FFF' : themeColors.textSecondary} strokeWidth={2.4} />
          <Text style={[
            styles.rfpTimestampText,
            showPhoto ? { color: '#FFF' } : { color: themeColors.textSecondary },
          ]}>
            {posted}
          </Text>
        </View>
        {/* Status pill — top-right, mirrors the live state. */}
        {(isAwarded || isOpen) && (
          <View style={[
            styles.rfpStatusPillFloating,
            { backgroundColor: isAwarded ? themeColors.success : accent },
          ]}>
            {isAwarded ? (
              <Trophy size={10} color="#FFF" strokeWidth={2.4} />
            ) : (
              <Clock size={10} color="#FFF" strokeWidth={2.4} />
            )}
            <Text style={styles.rfpStatusPillFloatingText}>
              {isAwarded ? 'AWARDED' : 'OPEN'}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.rfpBody}>
        <Text style={styles.rfpTitle} numberOfLines={2}>{row.title}</Text>

        <View style={styles.rfpMeta}>
          <MapPin size={11} color={themeColors.textMuted} strokeWidth={1.75} />
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

        {/* Activity micro-line — reads like a feed entry. Tightens the
            "marketplace pulse" feel without lying about numbers. */}
        <Text style={styles.rfpActivity} numberOfLines={1}>
          {row.response_count === 0
            ? 'Awaiting first bid'
            : `${row.response_count} bid${row.response_count === 1 ? '' : 's'} in`}
          {row.unreviewed_count > 0 ? `  ·  ${row.unreviewed_count} need review` : ''}
        </Text>

        <View style={styles.rfpFoot}>
          <View style={styles.rfpResponseChip}>
            <MageAIMark size={11} color={row.unreviewed_count > 0 ? accent : themeColors.textMuted} />
            <Text style={[
              styles.rfpResponseChipText,
              row.unreviewed_count > 0 ? { color: accent } : null,
            ]}>
              {row.unreviewed_count > 0 ? 'Review bids' : 'View details'}
            </Text>
            {row.unreviewed_count > 0 && (
              <View style={[styles.unreadDot, { backgroundColor: accent }]}>
                <Text style={styles.unreadDotText}>{row.unreviewed_count}</Text>
              </View>
            )}
          </View>
          <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  // ── Greeting header ─────────────────────────────────────────────────
  header: { marginBottom: 16 },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 },
  greetingIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: t.accent + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetingEyebrow: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700',
    color: t.accent,
    letterSpacing: 0.4,
  },
  title: {
    fontSize: Type.title1.fontSize,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.7,
  },
  subtitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600',
    color: t.textSecondary,
    marginTop: 4,
    lineHeight: 19,
  },

  // ── Hero CTA: gradient fill, embedded silhouette, soft glow. The single
  //    most-tapped affordance for this persona.
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: Tokens.radius.lg,
    marginBottom: 18,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 6,
    overflow: 'hidden',
  },
  heroCtaBg: {
    position: 'absolute',
    right: -28,
    bottom: -34,
    transform: [{ rotate: '-8deg' }],
  },
  heroCtaIcon: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.md,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
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
    color: 'rgba(255,255,255,0.92)',
    marginTop: 2,
    lineHeight: 17,
  },

  // ── Stat tiles: 4 cards in a row, each with icon + value + label + a
  //    thin accent bar that lights up when value > 0.
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
  },
  statTile: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.md,
    paddingTop: 12,
    paddingBottom: 0,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: t.line,
    alignItems: 'center',
    overflow: 'hidden',
  },
  statIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: t.line + '60',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    borderColor: t.textMuted,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: t.textMuted,
    letterSpacing: -0.5,
    lineHeight: 26,
  },
  statLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: t.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: 2,
    marginBottom: 8,
  },
  statAccentBar: {
    height: 3,
    width: '100%',
    backgroundColor: 'transparent',
  },

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

  // ── Section grouping
  section: { marginTop: 8 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.2,
  },
  sectionCountPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.accent + '18',
    minWidth: 26,
    alignItems: 'center',
  },
  sectionCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: t.accent,
    letterSpacing: 0.3,
  },

  // ── RFP cards
  rfpCard: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.line,
    marginBottom: 14,
  },
  rfpHeroWrap: { position: 'relative' },
  rfpHero: { width: '100%', height: 140, backgroundColor: t.bg },
  rfpHeroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rfpTimestampChip: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.full,
  },
  rfpTimestampChipDark: { backgroundColor: 'rgba(0,0,0,0.55)' },
  rfpTimestampChipLight: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: t.line,
  },
  rfpTimestampText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.2 },
  rfpStatusPillFloating: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.full,
  },
  rfpStatusPillFloatingText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: 0.6,
  },

  rfpBody: { padding: 14, gap: 5 },
  rfpTitle: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '800',
    color: t.text,
    lineHeight: 21,
    letterSpacing: -0.2,
  },
  rfpMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  rfpMetaText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
    fontWeight: '600',
  },
  rfpBudget: { fontSize: Type.caption1.fontSize, color: t.text, fontWeight: '700', marginTop: 2 },
  rfpActivity: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600',
    color: t.textSecondary,
    marginTop: 4,
    letterSpacing: 0.1,
  },
  rfpFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 10,
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
    marginLeft: 4,
  },
  unreadDotText: { fontSize: 10, fontWeight: '800', color: '#FFF' },
});
