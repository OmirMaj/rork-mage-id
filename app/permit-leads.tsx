// permit-leads.tsx — Public Permit Intelligence Feed (vision-doc P10).
//
// "NYC DOB filings are public. Right now a small GC has no way to know
// 'My competitor just filed an Alt-2 on a Brooklyn brownstone two blocks
// from my office.' MAGE ID becomes their organic deal flow."
//
// Today's data sources (all already in the app):
//   - public_bids — government / commercial RFPs (state, city, scope)
//   - homeowner RFPs (from nearby-rfps table)
// Tomorrow's: a DOB NOW scraper that ingests permit filings directly.
// The scraper is v1.1 work — what we ship today is the SURFACE that
// will accept that data feed later.
//
// Screen shape:
//   - Filter chips: state / category / value range
//   - Cards: source (RFP / public bid / permit filing) + project value +
//     distance + posted date
//   - Tap → existing bid-detail / rfp-detail screen

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Building, FileText, ChevronRight, MapPin, DollarSign, Calendar,
  Filter, Inbox, AlertCircle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useBids } from '@/contexts/BidsContext';
import { formatMoney, formatMoneyShort } from '@/utils/formatters';
import EmptyState from '@/components/ui/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { PublicBid } from '@/types';

type LeadSource = 'public_bid' | 'permit_filing' | 'homeowner_rfp';
type FilterKey = 'all' | 'commercial' | 'residential' | 'public';

interface LeadRow {
  id: string;
  source: LeadSource;
  title: string;
  city: string;
  state: string;
  agency?: string;
  estimatedValue: number;
  postedDate: string;
  deadline?: string;
  category: string;
  routeTo: { pathname: string; params?: Record<string, string> };
}

function publicBidToLead(b: PublicBid): LeadRow {
  return {
    id: `bid-${b.id}`,
    source: 'public_bid',
    title: b.title,
    city: b.city,
    state: b.state,
    agency: b.issuingAgency,
    estimatedValue: b.estimatedValue,
    postedDate: b.postedDate,
    deadline: b.deadline,
    category: b.category,
    routeTo: { pathname: '/bid-detail', params: { id: b.id } },
  };
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function PermitLeadsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { bids, isLoading } = useBids();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [refreshing, setRefreshing] = useState(false);

  // Today: every public bid is a "lead." Tomorrow: merge in scraped
  // permit filings + homeowner RFPs.
  const allLeads = useMemo<LeadRow[]>(() => {
    const fromBids = bids.map(publicBidToLead);
    const merged = [...fromBids].sort(
      (a, b) => Date.parse(b.postedDate) - Date.parse(a.postedDate),
    );
    return merged;
  }, [bids]);

  const filtered = useMemo(() => {
    if (filter === 'all') return allLeads;
    if (filter === 'commercial') return allLeads.filter(l => l.category === 'commercial' || l.category === 'construction');
    if (filter === 'residential') return allLeads.filter(l => l.category === 'residential');
    if (filter === 'public') return allLeads.filter(l => l.source === 'public_bid' || l.source === 'permit_filing');
    return allLeads;
  }, [allLeads, filter]);

  const counts = useMemo(() => ({
    all: allLeads.length,
    commercial: allLeads.filter(l => l.category === 'commercial' || l.category === 'construction').length,
    residential: allLeads.filter(l => l.category === 'residential').length,
    public: allLeads.filter(l => l.source === 'public_bid' || l.source === 'permit_filing').length,
  }), [allLeads]);

  const totalValueNearMe = useMemo(
    () => allLeads.reduce((s, l) => s + (l.estimatedValue ?? 0), 0),
    [allLeads],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Permit leads',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Inbox size={20} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>{counts.all} leads on the feed</Text>
          <Text style={styles.heroSub}>
            Public bids and permit filings near you.
            {totalValueNearMe > 0 ? ` ${formatMoneyShort(totalValueNearMe)} estimated total value.` : ''}
          </Text>
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {([
            { key: 'all' as const, label: `All (${counts.all})` },
            { key: 'commercial' as const, label: `Commercial (${counts.commercial})` },
            { key: 'residential' as const, label: `Residential (${counts.residential})` },
            { key: 'public' as const, label: `Public works (${counts.public})` },
          ]).map(c => {
            const active = filter === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                onPress={() => {
                  setFilter(c.key);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
                }}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.85}
                testID={`leads-filter-${c.key}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Empty / loading */}
        {isLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Building size={36} color={Colors.primary} strokeWidth={1.6} />}
            title="No leads in this filter"
            message="As public bids and permit filings come online in your jurisdictions, they show up here. Tap a row to open the detail screen and submit a response."
          />
        ) : (
          filtered.map(lead => {
            const Icon = lead.source === 'public_bid' ? Building
              : lead.source === 'permit_filing' ? FileText
              : MapPin;
            return (
              <TouchableOpacity
                key={lead.id}
                style={styles.card}
                activeOpacity={0.85}
                onPress={() => router.push({ pathname: lead.routeTo.pathname as never, params: lead.routeTo.params as never })}
                testID={`lead-${lead.id}`}
              >
                <View style={[styles.iconWrap, { backgroundColor: Colors.primary + '15' }]}>
                  <Icon size={16} color={Colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardSource} numberOfLines={1}>
                    {lead.source === 'public_bid' ? 'Public bid' : lead.source === 'permit_filing' ? 'Permit filing' : 'Homeowner RFP'}
                    {lead.agency ? ` · ${lead.agency}` : ''}
                  </Text>
                  <Text style={styles.cardTitle} numberOfLines={2}>{lead.title}</Text>
                  <View style={styles.cardMeta}>
                    <View style={styles.metaPill}>
                      <MapPin size={10} color={Colors.textMuted} />
                      <Text style={styles.metaText} numberOfLines={1}>{lead.city}, {lead.state}</Text>
                    </View>
                    {lead.estimatedValue > 0 && (
                      <View style={styles.metaPill}>
                        <DollarSign size={10} color={Colors.success} />
                        <Text style={[styles.metaText, { color: Colors.success }]} numberOfLines={1}>
                          {formatMoney(lead.estimatedValue)}
                        </Text>
                      </View>
                    )}
                    <View style={styles.metaPill}>
                      <Calendar size={10} color={Colors.textMuted} />
                      <Text style={styles.metaText} numberOfLines={1}>Posted {timeAgo(lead.postedDate)}</Text>
                    </View>
                  </View>
                </View>
                <ChevronRight size={14} color={Colors.textMuted} />
              </TouchableOpacity>
            );
          })
        )}

        <View style={styles.footer}>
          <AlertCircle size={12} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            Direct DOB / permit-filing scrapers (v1.1) will expand this feed beyond the public-bid
            corpus you see today. Geographic filtering by your office address comes in v1.1 too.
          </Text>
        </View>
      </ScrollView>

      {void Filter}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  heroIconWrap: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: -0.4,
  },
  heroSub: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  chipRow: { flexDirection: 'row' as const, gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.textSecondary },
  chipTextActive: { color: Colors.background },
  card: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cardSource: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  cardTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 2,
  },
  cardMeta: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 8,
  },
  metaPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  metaText: { fontSize: Type.caption2.fontSize, color: Colors.textSecondary, fontWeight: '600' as const },
  footer: {
    flexDirection: 'row' as const,
    gap: 8,
    alignItems: 'flex-start' as const,
    paddingHorizontal: 18,
    paddingVertical: 16,
    opacity: 0.7,
  },
  footerText: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    lineHeight: 14,
  },
});

void useEffect;
