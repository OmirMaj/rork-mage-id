# Discover, Marketplace, Equipment & Integrations


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

Discover tab (unified search across bids/companies/hire/estimate/
schedule/materials), Marketplace tab, Equipment tracking, and third-party
integrations screen.


## Files in this bundle

- `app/(tabs)/discover/index.tsx`
- `app/(tabs)/discover/bids.tsx`
- `app/(tabs)/discover/companies.tsx`
- `app/(tabs)/discover/hire.tsx`
- `app/(tabs)/discover/estimate.tsx`
- `app/(tabs)/discover/schedule.tsx`
- `app/(tabs)/discover/materials.tsx`
- `app/(tabs)/discover/_layout.tsx`
- `app/(tabs)/marketplace/index.tsx`
- `app/(tabs)/equipment/index.tsx`
- `app/(tabs)/construction-ai/index.tsx`
- `app/(tabs)/summary/index.tsx`
- `app/equipment-detail.tsx`
- `app/integrations.tsx`
- `components/AIEquipmentAdvice.tsx`
- `components/AIHomeBriefing.tsx`
- `components/AIProjectReport.tsx`
- `components/AIWeeklySummary.tsx`


---

### `app/(tabs)/discover/index.tsx`

```tsx
import React, { useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Linking, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Gavel, Building2, Briefcase, ExternalLink,
  Plus, Search, Award, Sparkles, CalendarDays, ChevronRight, DollarSign,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface BidSource {
  name: string;
  description: string;
  url: string;
  color: string;
  type: string;
  hideCount?: boolean;
}

const LIVE_BID_SOURCES: BidSource[] = [
  {
    name: 'SAM.gov',
    description: 'Federal contract opportunities — all US government bids',
    url: 'https://sam.gov/search/?index=opp&sort=-modifiedDate&page=1&pageSize=25',
    color: '#1565C0',
    type: 'Federal',
    hideCount: true,
  },
  {
    name: 'NY State Contract Reporter',
    description: 'All NYS agency procurement notices & bids',
    url: 'https://nyspro.ogs.ny.gov/content/nys-contract-reporter',
    color: '#2E7D32',
    type: 'State',
  },
  {
    name: 'NYC PASSPort',
    description: 'New York City procurement portal — municipal bids',
    url: 'https://passport.cityofnewyork.us/page.aspx/en/rfp/request_browse_public',
    color: '#E65100',
    type: 'Municipal',
  },
  {
    name: 'BidNet Direct',
    description: 'State & local government bids across all 50 states',
    url: 'https://www.bidnetdirect.com/public/solicitations/open',
    color: '#6A1B9A',
    type: 'Multi-State',
  },
  {
    name: 'Dodge Construction Network',
    description: 'Private & public construction project leads',
    url: 'https://www.construction.com/',
    color: '#00695C',
    type: 'Private + Public',
  },
  {
    name: 'NYS ESD MWBE',
    description: 'Empire State Development MWBE directory & opportunities',
    url: 'https://ny.newnycontracts.com/',
    color: '#AD1457',
    type: 'MWBE',
  },
  {
    name: 'NYC SBS M/WBE',
    description: 'NYC Small Business Services — certified M/WBE opportunities',
    url: 'https://www1.nyc.gov/nycbusiness/mwbe',
    color: '#FF6F00',
    type: 'MWBE',
  },
  {
    name: 'USASpending.gov',
    description: 'Track federal spending & find awarded contracts',
    url: 'https://www.usaspending.gov/search',
    color: '#37474F',
    type: 'Federal',
    hideCount: true,
  },
];

type DiscoverTab = 'overview' | 'bids' | 'companies' | 'hire' | 'estimate' | 'schedule' | 'materials';

interface TabDef {
  id: DiscoverTab;
  label: string;
  icon?: React.ElementType;
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'bids', label: 'Public Bids', icon: Gavel },
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'hire', label: 'Direct Hire', icon: Briefcase },
  { id: 'estimate', label: 'Estimator', icon: Sparkles },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'materials', label: 'Materials', icon: DollarSign },
];

function NavigationCard({
  icon: Icon,
  iconColor,
  iconBg,
  title,
  subtitle,
  count,
  countColor,
  onPress,
}: {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  count?: number;
  countColor?: string;
  onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={[styles.navCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.navCardInner}
      >
        <View style={[styles.navIconWrap, { backgroundColor: iconBg }]}>
          <Icon size={22} color={iconColor} />
        </View>
        <View style={styles.navInfo}>
          <Text style={styles.navTitle}>{title}</Text>
          <Text style={styles.navSubtitle}>{subtitle}</Text>
        </View>
        <View style={styles.navRight}>
          {count !== undefined && countColor && (
            <View style={[styles.navCountBadge, { backgroundColor: countColor + '12' }]}>
              <Text style={[styles.navCountText, { color: countColor }]}>{count}</Text>
            </View>
          )}
          <ChevronRight size={18} color={Colors.textMuted} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tabScrollRef = useRef<ScrollView>(null);

  console.log('[Discover] Rendering DiscoverScreen v2');

  const handleTabPress = useCallback((tab: DiscoverTab) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (tab === 'overview') return;
    const routes: Record<string, string> = {
      bids: '/(tabs)/discover/bids',
      companies: '/(tabs)/discover/companies',
      hire: '/(tabs)/discover/hire',
      estimate: '/(tabs)/discover/estimate',
      schedule: '/(tabs)/discover/schedule',
      materials: '/(tabs)/discover/materials',
    };
    if (routes[tab]) router.push(routes[tab] as any);
  }, [router]);

  const openBidSource = useCallback((url: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(url).catch(() => {});
  }, []);

  const navigateTo = useCallback((path: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(path as any);
  }, [router]);

  return (
    <View style={styles.container}>
      <View style={[styles.headerArea, { paddingTop: insets.top }]}>
        <Text style={styles.largeTitle}>Discover</Text>
        <Text style={styles.headerSubtitle}>Bids, companies, tools & more</Text>

        <ScrollView
          ref={tabScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
          style={styles.tabBarScroll}
        >
          {TABS.map((tab) => {
            const isActive = tab.id === 'overview';
            const TabIcon = tab.icon;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tabPill, isActive && styles.tabPillActive]}
                onPress={() => handleTabPress(tab.id)}
                activeOpacity={0.7}
                testID={`discover-tab-${tab.id}`}
              >
                {TabIcon && <TabIcon size={14} color={isActive ? '#FFF' : Colors.textSecondary} />}
                <Text style={[styles.tabPillText, isActive && styles.tabPillTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => navigateTo('/post-bid')}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: '#1565C015' }]}>
              <Plus size={16} color="#1565C0" />
            </View>
            <Text style={styles.quickActionLabel}>Post Bid</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => navigateTo('/post-job')}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: Colors.primary + '15' }]}>
              <Plus size={16} color={Colors.primary} />
            </View>
            <Text style={styles.quickActionLabel}>Post Job</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => navigateTo('/(tabs)/settings')}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: Colors.accent + '15' }]}>
              <Search size={16} color={Colors.accent} />
            </View>
            <Text style={styles.quickActionLabel}>My Profile</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeaderRow}>
          <View style={[styles.sectionAccent, { backgroundColor: '#0A84FF' }]} />
          <View>
            <Text style={styles.sectionLabel}>SMART TOOLS</Text>
            <Text style={styles.sectionHint}>AI estimates, schedules, code checks & pricing</Text>
          </View>
        </View>

        <NavigationCard
          icon={Sparkles}
          iconColor="#0A84FF"
          iconBg="#0A84FF15"
          title="Estimator"
          subtitle="AI-powered quick estimates & templates"
          onPress={() => navigateTo('/(tabs)/discover/estimate')}
        />

        <NavigationCard
          icon={Award}
          iconColor="#5E5CE6"
          iconBg="#5E5CE615"
          title="Quick Estimate Wizard"
          subtitle="Answer 8 questions, get an AI-generated estimate"
          onPress={() => navigateTo('/estimate-wizard')}
        />

        <NavigationCard
          icon={Gavel}
          iconColor="#AF52DE"
          iconBg="#AF52DE15"
          title="Construction AI"
          subtitle="Ask building code questions, get instant answers"
          onPress={() => navigateTo('/(tabs)/construction-ai')}
        />

        <NavigationCard
          icon={CalendarDays}
          iconColor="#FF9F0A"
          iconBg="#FF9F0A15"
          title="Schedule Maker"
          subtitle="AI-generate or template-based schedules"
          onPress={() => navigateTo('/(tabs)/discover/schedule')}
        />

        <NavigationCard
          icon={DollarSign}
          iconColor="#34C759"
          iconBg="#34C75915"
          title="Materials Pricing"
          subtitle="Live prices, regional rates & cost tracking"
          onPress={() => navigateTo('/(tabs)/discover/materials')}
        />

        <View style={[styles.sectionHeaderRow, { marginTop: 24 }]}>
          <View style={[styles.sectionAccent, { backgroundColor: '#1565C0' }]} />
          <View>
            <Text style={styles.sectionLabel}>ONLINE JOBS & BIDS</Text>
            <Text style={styles.sectionHint}>Government contracts, private bids & company listings</Text>
          </View>
        </View>

        <NavigationCard
          icon={Gavel}
          iconColor="#1565C0"
          iconBg="#1565C015"
          title="Public Bids"
          subtitle="Government & private bid opportunities"
          count={1317}
          countColor="#1565C0"
          onPress={() => navigateTo('/(tabs)/discover/bids')}
        />

        <NavigationCard
          icon={Building2}
          iconColor={Colors.primary}
          iconBg={Colors.primary + '15'}
          title="Companies"
          subtitle="Bond capacity & certifications"
          count={2957}
          countColor={Colors.primary}
          onPress={() => navigateTo('/(tabs)/discover/companies')}
        />

        <NavigationCard
          icon={Briefcase}
          iconColor={Colors.accent}
          iconBg={Colors.accent + '15'}
          title="Job Listings"
          subtitle="Construction jobs & direct hire openings"
          count={869}
          countColor={Colors.accent}
          onPress={() => navigateTo('/(tabs)/discover/hire')}
        />

        <View style={[styles.sectionHeaderRow, { marginTop: 24 }]}>
          <View style={[styles.sectionAccent, { backgroundColor: '#6A1B9A' }]} />
          <View>
            <Text style={styles.sectionLabel}>LIVE BID DATABASES</Text>
            <Text style={styles.sectionHint}>Browse real government & private bid portals — updated daily</Text>
          </View>
        </View>

        <View style={styles.bidSourcesGrid}>
          {LIVE_BID_SOURCES.map((source) => (
            <TouchableOpacity
              key={source.name}
              style={styles.bidSourceCard}
              onPress={() => openBidSource(source.url)}
              activeOpacity={0.7}
            >
              <View style={styles.bidSourceTop}>
                <View style={[styles.bidSourceDot, { backgroundColor: source.color }]} />
                <View style={[styles.bidSourceTypeBadge, { backgroundColor: source.color + '14' }]}>
                  <Text style={[styles.bidSourceTypeText, { color: source.color }]}>{source.type}</Text>
                </View>
              </View>
              <Text style={styles.bidSourceName}>{source.name}</Text>
              <Text style={styles.bidSourceDesc} numberOfLines={2}>{source.description}</Text>
              <View style={styles.bidSourceFooter}>
                <ExternalLink size={12} color={source.color} />
                <Text style={[styles.bidSourceLink, { color: source.color }]}>Open Portal</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.tipCard}>
          <View style={styles.tipHeader}>
            <Award size={16} color={Colors.primary} />
            <Text style={styles.tipTitle}>Pro Tip</Text>
          </View>
          <Text style={styles.tipText}>
            Register your company certifications (MWBE, DBE, etc.) in the Companies section to get matched with bids that require your qualifications.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerArea: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    paddingBottom: 0,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  largeTitle: { fontSize: 34, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.5, marginTop: 8 },
  headerSubtitle: { fontSize: 15, color: Colors.textSecondary, marginTop: 2, marginBottom: 14 },
  tabBarScroll: { marginHorizontal: -20 },
  tabBar: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  tabPillActive: {
    backgroundColor: Colors.text,
    borderColor: Colors.text,
  },
  tabPillText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  tabPillTextActive: {
    color: '#FFF',
  },
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginTop: 18,
    marginBottom: 8,
  },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  quickActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 18,
    marginBottom: 12,
  },
  sectionAccent: {
    width: 4,
    height: 36,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 0.6,
  },
  sectionHint: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginTop: 1,
  },
  navCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  navCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  navIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navInfo: { flex: 1, gap: 2 },
  navTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  navSubtitle: { fontSize: 13, color: Colors.textSecondary },
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navCountBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  navCountText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  bidSourcesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 20,
  },
  bidSourceCard: {
    width: '47.5%' as any,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  bidSourceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  bidSourceDot: { width: 8, height: 8, borderRadius: 4 },
  bidSourceTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bidSourceTypeText: { fontSize: 9, fontWeight: '700' as const, textTransform: 'uppercase' as const },
  bidSourceName: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, marginBottom: 4 },
  bidSourceDesc: { fontSize: 11, color: Colors.textSecondary, lineHeight: 15, marginBottom: 10 },
  bidSourceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bidSourceLink: { fontSize: 11, fontWeight: '600' as const },
  tipCard: {
    marginHorizontal: 16,
    backgroundColor: Colors.primary + '08',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '18',
    marginBottom: 20,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  tipTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.primary },
  tipText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
});

```


---

### `app/(tabs)/discover/bids.tsx`

```tsx
import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, Linking, RefreshControl, Platform, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Clock, DollarSign, ArrowLeft, Navigation, AlertCircle, Crosshair, ChevronDown, X, Filter, Building } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { supabase } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles } from '@/utils/location';
import { US_STATES } from '@/constants/states';

interface CachedBid {
  id: string;
  title: string;
  department: string;
  deadline: string;
  estimated_value: number;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  source_url: string;
  set_aside: string | null;
  fetched_at: string;
}

interface BidWithDistance extends CachedBid {
  distance: number | null;
}

interface NearbyCity {
  city: string;
  state: string;
  distance: number;
  count: number;
}

const RADIUS_OPTIONS = [10, 25, 50, 100, 250] as const;

const SET_ASIDE_TYPES = [
  'Small Business', 'MWBE', 'SDVOSB', 'HUBZone', '8(a)', 'WOSB', 'None',
] as const;

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return 'Not specified';
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  return `$${amount.toLocaleString()}`;
}

function getDeadlineInfo(deadline: string | null | undefined): { text: string; color: string; bgColor: string } {
  if (!deadline) return { text: 'No deadline', color: '#9E9E9E', bgColor: '#F5F5F5' };
  const diff = new Date(deadline).getTime() - Date.now();
  if (isNaN(diff)) return { text: 'No deadline', color: '#9E9E9E', bgColor: '#F5F5F5' };
  if (diff <= 0) return { text: 'Expired', color: '#9E9E9E', bgColor: '#F5F5F5' };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 3) return { text: `${days}d ${Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))}h left`, color: '#D32F2F', bgColor: '#FFEBEE' };
  if (days <= 7) return { text: `${days} days left`, color: '#F57F17', bgColor: '#FFF8E1' };
  if (days > 30) return { text: `${Math.floor(days / 30)}mo ${days % 30}d left`, color: '#2E7D32', bgColor: '#E8F5E9' };
  return { text: `${days} days left`, color: '#2E7D32', bgColor: '#E8F5E9' };
}

function BidCard({ bid, onPress }: { bid: BidWithDistance; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const deadlineInfo = getDeadlineInfo(bid.deadline);

  return (
    <Animated.View style={[styles.bidCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        testID={`cached-bid-${bid.id}`}
      >
        <View style={styles.bidHeader}>
          {bid.set_aside ? (
            <View style={styles.setAsideBadge}>
              <Text style={styles.setAsideText}>{bid.set_aside}</Text>
            </View>
          ) : (
            <View style={styles.openBadge}>
              <Text style={styles.openBadgeText}>Open</Text>
            </View>
          )}
          <View style={[styles.countdownBadge, { backgroundColor: deadlineInfo.bgColor }]}>
            <Clock size={11} color={deadlineInfo.color} />
            <Text style={[styles.countdownText, { color: deadlineInfo.color }]}>{deadlineInfo.text}</Text>
          </View>
        </View>

        <Text style={styles.bidTitle} numberOfLines={2}>{bid.title ?? 'Untitled Bid'}</Text>
        <Text style={styles.bidDepartment} numberOfLines={1}>{bid.department ?? 'Department not listed'}</Text>

        <View style={styles.bidMeta}>
          <View style={styles.metaItem}>
            <MapPin size={13} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{bid.city && bid.state ? `${bid.city}, ${bid.state}` : bid.city || bid.state || 'Location not available'}</Text>
          </View>
          <View style={styles.metaItem}>
            <DollarSign size={13} color={Colors.primary} />
            <Text style={[styles.metaText, { color: Colors.primary, fontWeight: '600' as const }]}>
              {formatCurrency(bid.estimated_value)}
            </Text>
          </View>
        </View>

        <View style={styles.bidFooter}>
          <View style={styles.footerLeft}>
            {bid.distance !== null && (
              <View style={styles.distanceBadge}>
                <Navigation size={11} color={Colors.info} />
                <Text style={styles.distanceText}>{bid.distance} mi</Text>
              </View>
            )}
            {bid.city ? (
              <View style={styles.cityBadge}>
                <Building size={10} color={Colors.textSecondary} />
                <Text style={styles.cityBadgeText}>{bid.city}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.deadlineDate}>
            {bid.deadline ? `Due: ${new Date(bid.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No deadline'}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function CachedBidsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { location } = useUserLocation();
  const [selectedRadius, setSelectedRadius] = useState<number | null>(null);
  const [selectedSetAside, setSelectedSetAside] = useState<string | undefined>();
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [locationMode, setLocationMode] = useState<'all' | 'nearby' | 'state' | 'city'>('all');
  const [showStateList, setShowStateList] = useState(false);
  const [showSetAsideDropdown, setShowSetAsideDropdown] = useState(false);

  const { data: bids, isLoading, refetch, isRefetching, error: bidsQueryError } = useQuery({
    queryKey: ['cached_bids'],
    queryFn: async () => {
      console.log('[CachedBids] === START FETCH ===');
      try {
        const { data, error, status, statusText } = await supabase
          .from('cached_bids')
          .select('*')
          .order('fetched_at', { ascending: false });
        console.log('[CachedBids] Response status:', status, statusText);
        console.log('[CachedBids] Error:', error ? JSON.stringify(error) : 'none');
        console.log('[CachedBids] Data count:', data?.length ?? 'null');
        if (error) {
          console.log('[CachedBids] Supabase error, returning empty:', error.message);
          return [];
        }
        return (data ?? []) as CachedBid[];
      } catch (err: any) {
        console.log('[CachedBids] Network/fetch error:', err?.message);
        return [];
      }
    },
    retry: 1,
  });

  const bidsWithDistance = useMemo<BidWithDistance[]>(() => {
    if (!bids) return [];
    return bids.map(bid => ({
      ...bid,
      distance: location && bid.latitude && bid.longitude
        ? getDistanceMiles(location.latitude, location.longitude, bid.latitude, bid.longitude)
        : null,
    }));
  }, [bids, location]);

  const nearbyCities = useMemo<NearbyCity[]>(() => {
    if (!bidsWithDistance.length) return [];
    const cityMap = new Map<string, { city: string; state: string; distance: number; count: number }>();
    for (const bid of bidsWithDistance) {
      if (!bid.city) continue;
      const key = `${bid.city}_${bid.state ?? ''}`.toLowerCase();
      const existing = cityMap.get(key);
      if (existing) {
        existing.count += 1;
        if (bid.distance !== null && bid.distance < existing.distance) {
          existing.distance = bid.distance;
        }
      } else {
        cityMap.set(key, {
          city: bid.city,
          state: bid.state ?? '',
          distance: bid.distance ?? 99999,
          count: 1,
        });
      }
    }
    return Array.from(cityMap.values())
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 20);
  }, [bidsWithDistance]);

  const filteredBids = useMemo(() => {
    let result = bidsWithDistance;

    if (selectedSetAside) {
      if (selectedSetAside === 'None') {
        result = result.filter(b => !b.set_aside);
      } else {
        result = result.filter(b => b.set_aside?.toLowerCase().includes(selectedSetAside.toLowerCase()));
      }
    }

    if (locationMode === 'nearby' && location && selectedRadius !== null) {
      result = result.filter(b => b.distance === null || b.distance <= selectedRadius);
    }

    if (locationMode === 'state' && selectedState) {
      result = result.filter(b => b.state?.toUpperCase() === selectedState.toUpperCase());
    }

    if (locationMode === 'city' && selectedCity) {
      result = result.filter(b => b.city?.toLowerCase() === selectedCity.toLowerCase());
    }

    if (location) {
      result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
    }

    return result;
  }, [bidsWithDistance, selectedRadius, selectedSetAside, location, locationMode, selectedState, selectedCity]);

  const handleBidPress = useCallback((bid: CachedBid) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (bid.source_url) {
      Linking.openURL(bid.source_url).catch(() => {
        console.log('[CachedBids] Failed to open URL:', bid.source_url);
      });
    }
  }, []);

  const handleLocationModeChange = useCallback((mode: 'all' | 'nearby' | 'state' | 'city') => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setLocationMode(mode);
    if (mode === 'nearby' && selectedRadius === null) {
      setSelectedRadius(50);
    }
    if (mode !== 'state') {
      setShowStateList(false);
    }
    if (mode === 'state') {
      setShowStateList(true);
    }
    if (mode !== 'city') {
      setSelectedCity(null);
    }
  }, [selectedRadius]);

  const handleSetAsideSelect = useCallback((value: string | undefined) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setSelectedSetAside(value);
    setShowSetAsideDropdown(false);
  }, []);

  const renderBid = useCallback(({ item }: { item: BidWithDistance }) => (
    <BidCard bid={item} onPress={() => handleBidPress(item)} />
  ), [handleBidPress]);

  const loading = isLoading;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Public Bids</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{filteredBids.length}</Text>
          </View>
        </View>

        <View style={styles.filterRow}>
          <View style={styles.filterBlock}>
            <Text style={styles.filterSectionLabel}>LOCATION</Text>
            <View style={styles.locationRow}>
              <TouchableOpacity
                style={[styles.locationChip, locationMode === 'all' && styles.locationChipActive]}
                onPress={() => handleLocationModeChange('all')}
              >
                <Text style={[styles.locationChipText, locationMode === 'all' && styles.locationChipTextActive]}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locationChip, locationMode === 'nearby' && styles.locationChipActive]}
                onPress={() => handleLocationModeChange('nearby')}
              >
                <Crosshair size={12} color={locationMode === 'nearby' ? '#FFF' : Colors.textSecondary} />
                <Text style={[styles.locationChipText, locationMode === 'nearby' && styles.locationChipTextActive]}>Near Me</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locationChip, locationMode === 'city' && styles.locationChipActive]}
                onPress={() => handleLocationModeChange('city')}
              >
                <Building size={12} color={locationMode === 'city' ? '#FFF' : Colors.textSecondary} />
                <Text style={[styles.locationChipText, locationMode === 'city' && styles.locationChipTextActive]}>City</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locationChip, locationMode === 'state' && styles.locationChipActive]}
                onPress={() => handleLocationModeChange('state')}
              >
                <ChevronDown size={12} color={locationMode === 'state' ? '#FFF' : Colors.textSecondary} />
                <Text style={[styles.locationChipText, locationMode === 'state' && styles.locationChipTextActive]}>
                  {selectedState ? selectedState : 'State'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.filterBlock}>
            <Text style={styles.filterSectionLabel}>SET-ASIDE</Text>
            <TouchableOpacity
              style={styles.dropdownButton}
              onPress={() => { setShowSetAsideDropdown(true); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            >
              <Filter size={13} color={selectedSetAside ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.dropdownButtonText, selectedSetAside && styles.dropdownButtonTextActive]}>
                {selectedSetAside ?? 'All Types'}
              </Text>
              <ChevronDown size={14} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {locationMode === 'nearby' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {RADIUS_OPTIONS.map(r => (
              <TouchableOpacity
                key={r}
                style={[styles.chip, selectedRadius === r && styles.chipActive]}
                onPress={() => { setSelectedRadius(r); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
              >
                <Text style={[styles.chipText, selectedRadius === r && styles.chipTextActive]}>{r} mi</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {locationMode === 'city' && nearbyCities.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {nearbyCities.map(c => (
              <TouchableOpacity
                key={`${c.city}_${c.state}`}
                style={[styles.cityChip, selectedCity?.toLowerCase() === c.city.toLowerCase() && styles.chipActive]}
                onPress={() => {
                  setSelectedCity(selectedCity?.toLowerCase() === c.city.toLowerCase() ? null : c.city);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
              >
                <Text style={[styles.cityChipText, selectedCity?.toLowerCase() === c.city.toLowerCase() && styles.chipTextActive]} numberOfLines={1}>
                  {c.city}{c.state ? `, ${c.state}` : ''}
                </Text>
                {c.distance < 99999 && (
                  <Text style={[styles.cityChipMeta, selectedCity?.toLowerCase() === c.city.toLowerCase() && { color: 'rgba(255,255,255,0.7)' }]}>
                    {c.distance}mi · {c.count}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {locationMode === 'state' && showStateList && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {US_STATES.map(s => (
              <TouchableOpacity
                key={s.abbr}
                style={[styles.stateChip, selectedState === s.abbr && styles.chipActive]}
                onPress={() => {
                  setSelectedState(selectedState === s.abbr ? null : s.abbr);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
              >
                <Text style={[styles.chipText, selectedState === s.abbr && styles.chipTextActive]}>{s.abbr}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      <Modal
        visible={showSetAsideDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSetAsideDropdown(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowSetAsideDropdown(false)}
        >
          <View style={styles.dropdownModal}>
            <View style={styles.dropdownHeader}>
              <Text style={styles.dropdownTitle}>Set-Aside Type</Text>
              <TouchableOpacity onPress={() => setShowSetAsideDropdown(false)}>
                <X size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.dropdownItem, !selectedSetAside && styles.dropdownItemActive]}
              onPress={() => handleSetAsideSelect(undefined)}
            >
              <Text style={[styles.dropdownItemText, !selectedSetAside && styles.dropdownItemTextActive]}>All Types</Text>
              {!selectedSetAside && <View style={styles.dropdownCheck} />}
            </TouchableOpacity>
            {SET_ASIDE_TYPES.map(sa => (
              <TouchableOpacity
                key={sa}
                style={[styles.dropdownItem, selectedSetAside === sa && styles.dropdownItemActive]}
                onPress={() => handleSetAsideSelect(selectedSetAside === sa ? undefined : sa)}
              >
                <Text style={[styles.dropdownItemText, selectedSetAside === sa && styles.dropdownItemTextActive]}>{sa}</Text>
                {selectedSetAside === sa && <View style={styles.dropdownCheck} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {bidsQueryError ? (
        <View style={styles.loadingContainer}>
          <AlertCircle size={40} color="#D32F2F" />
          <Text style={styles.emptyTitle}>Query Error</Text>
          <Text style={styles.emptySubtitle}>{bidsQueryError.message}</Text>
          <TouchableOpacity onPress={() => { void refetch(); }} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={styles.loadingContainer}>
          <ConstructionLoader size="lg" label="Loading bids..." />
        </View>
      ) : (
        <FlatList
          data={filteredBids}
          renderItem={renderBid}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AlertCircle size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No bids found</Text>
              <Text style={styles.emptySubtitle}>
                Try changing your location or removing filters
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight, paddingHorizontal: 16, paddingBottom: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginTop: 8, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 24, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  countPill: { backgroundColor: Colors.primary + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  countPillText: { fontSize: 13, fontWeight: '700' as const, color: Colors.primary },
  filterRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  filterBlock: { flex: 1 },
  filterSectionLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  locationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  locationChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: Colors.background },
  locationChipActive: { backgroundColor: Colors.primary },
  locationChipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  locationChipTextActive: { color: '#FFF' },
  dropdownButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.borderLight,
  },
  dropdownButtonText: { flex: 1, fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  dropdownButtonTextActive: { color: Colors.primary, fontWeight: '600' as const },
  chipRow: { flexDirection: 'row', marginTop: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  cityChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18,
    backgroundColor: Colors.background, marginRight: 6, alignItems: 'center',
  },
  cityChipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' as const },
  cityChipMeta: { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  stateChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
  list: { padding: 16, paddingBottom: 100 },
  bidCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  bidHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  setAsideBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  setAsideText: { fontSize: 11, fontWeight: '700' as const, color: '#2E7D32', textTransform: 'uppercase' as const },
  openBadge: { backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  openBadgeText: { fontSize: 11, fontWeight: '700' as const, color: '#1565C0', textTransform: 'uppercase' as const },
  countdownBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  countdownText: { fontSize: 11, fontWeight: '600' as const },
  bidTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, marginBottom: 4, lineHeight: 22 },
  bidDepartment: { fontSize: 13, color: Colors.textSecondary, marginBottom: 10 },
  bidMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: Colors.textSecondary },
  bidFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  distanceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.infoLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  distanceText: { fontSize: 12, fontWeight: '600' as const, color: Colors.info },
  cityBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.fillSecondary, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  cityBadgeText: { fontSize: 11, fontWeight: '500' as const, color: Colors.textSecondary },
  deadlineDate: { fontSize: 12, color: Colors.textMuted },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32 },
  retryButton: { marginTop: 12, backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryButtonText: { color: '#FFF', fontWeight: '600' as const },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center',
  },
  dropdownModal: {
    width: '80%', backgroundColor: Colors.surface, borderRadius: 16, paddingVertical: 8, maxHeight: 400,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
  },
  dropdownHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight,
  },
  dropdownTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  dropdownItemActive: { backgroundColor: Colors.primary + '08' },
  dropdownItemText: { fontSize: 15, color: Colors.text, fontWeight: '400' as const },
  dropdownItemTextActive: { color: Colors.primary, fontWeight: '600' as const },
  dropdownCheck: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
});

```


---

### `app/(tabs)/discover/companies.tsx`

```tsx
import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, Linking, RefreshControl, Platform, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Star, ArrowLeft, Navigation, AlertCircle, Phone, Globe } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { supabase } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles } from '@/utils/location';

interface CachedCompany {
  id: string;
  name: string;
  trade_specialty: string;
  rating: number;
  review_count: number;
  total_reviews: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  phone: string;
  website: string;
  photo_url: string | null;
  fetched_at: string;
}

interface CompanyWithDistance extends CachedCompany {
  distance: number | null;
}

const RADIUS_OPTIONS = [10, 25, 50, 100] as const;

const SPECIALTY_FILTERS = [
  'General Contractor', 'Electrical', 'Plumbing', 'HVAC',
  'Roofing', 'Building Materials Supply', 'Concrete Supply', 'Lumber Supply',
] as const;

function renderStars(rating: number | null | undefined): string {
  if (rating == null) return '☆☆☆☆☆';
  const full = Math.floor(rating);
  const half = rating - full >= 0.5 ? 1 : 0;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - half);
}

function CompanyCard({ company, onPress }: { company: CompanyWithDistance; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handleCall = useCallback(() => {
    if (!company.phone) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const tel = `tel:${company.phone.replace(/[^\d+]/g, '')}`;
    Linking.openURL(tel).catch(() => {
      console.log('[Companies] Failed to open phone:', tel);
    });
  }, [company.phone]);

  const handleWebsite = useCallback(() => {
    if (!company.website) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let url = company.website;
    if (url && !url.startsWith('http')) url = 'https://' + url;
    Linking.openURL(url).catch(() => {
      console.log('[Companies] Failed to open website:', url);
    });
  }, [company.website]);

  const formattedAddress = useMemo(() => {
    const parts = [company.address, company.city, company.state, company.zip].filter(Boolean);
    return parts.join(', ');
  }, [company.address, company.city, company.state, company.zip]);

  return (
    <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        testID={`cached-company-${company.id}`}
      >
        {company.photo_url ? (
          <Image source={{ uri: company.photo_url }} style={styles.companyPhoto} resizeMode="cover" />
        ) : null}

        <View style={styles.cardTop}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{company.name ? company.name.charAt(0) : '?'}</Text>
          </View>
          <View style={styles.cardTopInfo}>
            <Text style={styles.companyName} numberOfLines={1}>{company.name ?? 'Unknown Company'}</Text>
            <Text style={styles.specialtyText}>{company.trade_specialty ?? 'Specialty not listed'}</Text>
          </View>
        </View>

        <View style={styles.ratingRow}>
          <Star size={14} color="#F5A623" fill="#F5A623" />
          <Text style={styles.ratingValue}>{company.rating != null ? company.rating.toFixed(1) : 'N/A'}</Text>
          <Text style={styles.ratingStars}>{renderStars(company.rating)}</Text>
          <Text style={styles.reviewCount}>({company.total_reviews ?? company.review_count ?? 0} reviews)</Text>
        </View>

        <View style={styles.addressRow}>
          <MapPin size={13} color={Colors.textSecondary} />
          <Text style={styles.addressText} numberOfLines={2}>{formattedAddress || 'Address not available'}</Text>
        </View>

        <View style={styles.cardFooter}>
          {company.distance !== null && (
            <View style={styles.distanceBadge}>
              <Navigation size={11} color={Colors.info} />
              <Text style={styles.distanceText}>{company.distance} mi</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          {company.phone ? (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={(e) => { e.stopPropagation(); handleCall(); }}
              activeOpacity={0.7}
            >
              <Phone size={14} color="#FFF" />
              <Text style={styles.actionBtnText}>Call</Text>
            </TouchableOpacity>
          ) : null}
          {company.website ? (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnOutline]}
              onPress={(e) => { e.stopPropagation(); handleWebsite(); }}
              activeOpacity={0.7}
            >
              <Globe size={14} color={Colors.primary} />
              <Text style={[styles.actionBtnText, { color: Colors.primary }]}>Website</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function CachedCompaniesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { location, loading: locationLoading } = useUserLocation();
  const [selectedRadius, setSelectedRadius] = useState<number>(50);
  const [selectedSpecialty, setSelectedSpecialty] = useState<string | undefined>();

  const { data: companies, isLoading, refetch, isRefetching, error: _companiesQueryError } = useQuery({
    queryKey: ['cached_companies'],
    queryFn: async () => {
      console.log('[CachedCompanies] === START FETCH ===');
      console.log('[CachedCompanies] Supabase URL:', process.env.EXPO_PUBLIC_SUPABASE_URL?.substring(0, 40));
      try {
        const { data, error, status, statusText } = await supabase
          .from('cached_companies')
          .select('*')
          .order('fetched_at', { ascending: false });
        console.log('[CachedCompanies] Response status:', status, statusText);
        console.log('[CachedCompanies] Error:', error ? JSON.stringify(error) : 'none');
        console.log('[CachedCompanies] Data count:', data?.length ?? 'null');
        if (data && data.length > 0) {
          console.log('[CachedCompanies] First row sample:', JSON.stringify(data[0]).substring(0, 200));
        }
        if (error) {
          console.log('[CachedCompanies] Supabase error, returning empty:', error.message);
          return [];
        }
        return (data ?? []) as CachedCompany[];
      } catch (err: any) {
        console.log('[CachedCompanies] Network/fetch error:', err?.message);
        return [];
      }
    },
    retry: 1,
  });

  const companiesWithDistance = useMemo<CompanyWithDistance[]>(() => {
    if (!companies) return [];
    return companies.map(c => ({
      ...c,
      distance: location && c.latitude && c.longitude
        ? getDistanceMiles(location.latitude, location.longitude, c.latitude, c.longitude)
        : null,
    }));
  }, [companies, location]);

  const filteredCompanies = useMemo(() => {
    let result = companiesWithDistance;

    if (selectedSpecialty) {
      result = result.filter(c =>
        c.trade_specialty?.toLowerCase().includes(selectedSpecialty.toLowerCase())
      );
    }

    if (location) {
      result = result.filter(c => c.distance === null || c.distance <= selectedRadius);
      result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
    }

    return result;
  }, [companiesWithDistance, selectedRadius, selectedSpecialty, location]);

  const handleCompanyPress = useCallback((_company: CachedCompany) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const renderCompany = useCallback(({ item }: { item: CompanyWithDistance }) => (
    <CompanyCard company={item} onPress={() => handleCompanyPress(item)} />
  ), [handleCompanyPress]);

  const loading = isLoading || locationLoading;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Companies</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{filteredCompanies.length}</Text>
          </View>
        </View>

        <Text style={styles.filterSectionLabel}>RADIUS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {RADIUS_OPTIONS.map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.chip, selectedRadius === r && styles.chipActive]}
              onPress={() => { setSelectedRadius(r); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            >
              <Text style={[styles.chipText, selectedRadius === r && styles.chipTextActive]}>{r} mi</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={[styles.filterSectionLabel, { marginTop: 8 }]}>SPECIALTY</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chip, !selectedSpecialty && styles.chipActive]}
            onPress={() => { setSelectedSpecialty(undefined); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
          >
            <Text style={[styles.chipText, !selectedSpecialty && styles.chipTextActive]}>All</Text>
          </TouchableOpacity>
          {SPECIALTY_FILTERS.map(s => (
            <TouchableOpacity
              key={s}
              style={[styles.chip, selectedSpecialty === s && styles.chipActive]}
              onPress={() => { setSelectedSpecialty(selectedSpecialty === s ? undefined : s); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            >
              <Text style={[styles.chipText, selectedSpecialty === s && styles.chipTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ConstructionLoader size="lg" label="Finding companies near you..." />
        </View>
      ) : (
        <FlatList
          data={filteredCompanies}
          renderItem={renderCompany}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AlertCircle size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No companies found</Text>
              <Text style={styles.emptySubtitle}>
                Try increasing the radius or changing the specialty filter
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight, paddingHorizontal: 16, paddingBottom: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, marginTop: 8, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 24, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  countPill: { backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  countPillText: { fontSize: 13, fontWeight: '700' as const, color: '#2E7D32' },
  filterSectionLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  chipRow: { flexDirection: 'row', marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 14, marginBottom: 12, overflow: 'hidden' as const,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  companyPhoto: { width: '100%', height: 140 },
  cardTop: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 8 },
  avatarCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: 18, fontWeight: '800' as const, color: Colors.primary },
  cardTopInfo: { flex: 1 },
  companyName: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  specialtyText: { fontSize: 12, color: Colors.accent, fontWeight: '600' as const, marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, marginBottom: 8 },
  ratingValue: { fontSize: 14, fontWeight: '700' as const, color: '#F5A623' },
  ratingStars: { fontSize: 12, color: '#F5A623', letterSpacing: 1 },
  reviewCount: { fontSize: 12, color: Colors.textMuted },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, paddingHorizontal: 16, marginBottom: 8 },
  addressText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.borderLight, gap: 8 },
  distanceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.infoLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  distanceText: { fontSize: 12, fontWeight: '600' as const, color: Colors.info },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  actionBtnOutline: { backgroundColor: Colors.primary + '12', borderWidth: 1, borderColor: Colors.primary + '30' },
  actionBtnText: { fontSize: 12, fontWeight: '600' as const, color: '#FFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32 },
});

```


---

### `app/(tabs)/discover/hire.tsx`

```tsx
import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, Linking, RefreshControl, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, DollarSign, ArrowLeft, Navigation, AlertCircle, Briefcase } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { supabase } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles } from '@/utils/location';

interface CachedJob {
  id: string;
  title: string;
  company_name: string;
  salary_min: number;
  salary_max: number;
  trade_category: string;
  contract_type: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  apply_url: string;
  fetched_at: string;
}

interface JobWithDistance extends CachedJob {
  distance: number | null;
}

const RADIUS_OPTIONS = [10, 25, 50, 100] as const;

const TRADE_FILTERS = [
  'Electrical', 'Plumbing', 'Carpentry', 'HVAC', 'Welding',
  'Masonry', 'Roofing', 'Management', 'Labor', 'General Construction',
] as const;

const TRADE_BADGE_COLORS: Record<string, string> = {
  'Electrical': '#F57F17',
  'Plumbing': '#1565C0',
  'Carpentry': '#6D4C41',
  'HVAC': '#00838F',
  'Welding': '#E65100',
  'Masonry': '#78909C',
  'Roofing': '#AD1457',
  'Management': '#4527A0',
  'Labor': '#2E7D32',
  'General Construction': '#37474F',
};

function formatSalary(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null && max == null) return 'Salary not listed';
  const fmtVal = (v: number) => {
    if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
    return `${v.toLocaleString()}`;
  };
  if (min != null && max != null) return `${fmtVal(min)} – ${fmtVal(max)}`;
  if (min != null) return `From ${fmtVal(min)}`;
  return `Up to ${fmtVal(max!)}`;
}

function getTradeColor(trade: string | null | undefined): string {
  if (!trade) return Colors.primary;
  const key = Object.keys(TRADE_BADGE_COLORS).find(
    k => trade.toLowerCase().includes(k.toLowerCase())
  );
  return key ? TRADE_BADGE_COLORS[key] : Colors.primary;
}

function JobCard({ job, onPress }: { job: JobWithDistance; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const tradeColor = getTradeColor(job.trade_category);

  return (
    <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        testID={`cached-job-${job.id}`}
      >
        <View style={styles.cardTopRow}>
          {job.trade_category ? (
            <View style={[styles.tradeBadge, { backgroundColor: tradeColor + '15' }]}>
              <Text style={[styles.tradeBadgeText, { color: tradeColor }]}>{job.trade_category}</Text>
            </View>
          ) : null}
          {job.contract_type ? (
            <View style={styles.contractBadge}>
              <Text style={styles.contractBadgeText}>{job.contract_type}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.cardTitle} numberOfLines={2}>{job.title ?? 'Untitled Job'}</Text>
        <Text style={styles.cardCompany}>{job.company_name ?? 'Company not listed'}</Text>

        <View style={styles.cardMeta}>
          <View style={styles.metaItem}>
            <MapPin size={13} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{job.city && job.state ? `${job.city}, ${job.state}` : job.city || job.state || 'Location not available'}</Text>
          </View>
          <View style={styles.metaItem}>
            <DollarSign size={13} color={Colors.primary} />
            <Text style={[styles.metaText, { color: Colors.primary, fontWeight: '600' as const }]}>
              {formatSalary(job.salary_min, job.salary_max)}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          {job.distance !== null && (
            <View style={styles.distanceBadge}>
              <Navigation size={11} color={Colors.info} />
              <Text style={styles.distanceText}>{job.distance} mi</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <View style={styles.applyHint}>
            <Briefcase size={12} color={Colors.primary} />
            <Text style={styles.applyHintText}>Tap to Apply</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function CachedHireScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { location, loading: locationLoading } = useUserLocation();
  const [selectedRadius, setSelectedRadius] = useState<number>(50);
  const [selectedTrade, setSelectedTrade] = useState<string | undefined>();

  const { data: jobs, isLoading, refetch, isRefetching, error: _jobsQueryError } = useQuery({
    queryKey: ['cached_jobs'],
    queryFn: async () => {
      console.log('[CachedJobs] === START FETCH ===');
      console.log('[CachedJobs] Supabase URL:', process.env.EXPO_PUBLIC_SUPABASE_URL?.substring(0, 40));
      try {
        const { data, error, status, statusText } = await supabase
          .from('cached_jobs')
          .select('*')
          .order('fetched_at', { ascending: false });
        console.log('[CachedJobs] Response status:', status, statusText);
        console.log('[CachedJobs] Error:', error ? JSON.stringify(error) : 'none');
        console.log('[CachedJobs] Data count:', data?.length ?? 'null');
        if (data && data.length > 0) {
          console.log('[CachedJobs] First row sample:', JSON.stringify(data[0]).substring(0, 200));
        }
        if (error) {
          console.log('[CachedJobs] Supabase error, returning empty:', error.message);
          return [];
        }
        return (data ?? []) as CachedJob[];
      } catch (err: any) {
        console.log('[CachedJobs] Network/fetch error:', err?.message);
        return [];
      }
    },
    retry: 1,
  });

  const jobsWithDistance = useMemo<JobWithDistance[]>(() => {
    if (!jobs) return [];
    return jobs.map(job => ({
      ...job,
      distance: location && job.latitude && job.longitude
        ? getDistanceMiles(location.latitude, location.longitude, job.latitude, job.longitude)
        : null,
    }));
  }, [jobs, location]);

  const filteredJobs = useMemo(() => {
    let result = jobsWithDistance;

    if (selectedTrade) {
      result = result.filter(j =>
        j.trade_category?.toLowerCase().includes(selectedTrade.toLowerCase())
      );
    }

    if (location) {
      result = result.filter(j => j.distance === null || j.distance <= selectedRadius);
      result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
    }

    return result;
  }, [jobsWithDistance, selectedRadius, selectedTrade, location]);

  const handleJobPress = useCallback((job: CachedJob) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (job.apply_url) {
      Linking.openURL(job.apply_url).catch(() => {
        console.log('[CachedJobs] Failed to open URL:', job.apply_url);
      });
    }
  }, []);

  const renderJob = useCallback(({ item }: { item: JobWithDistance }) => (
    <JobCard job={item} onPress={() => handleJobPress(item)} />
  ), [handleJobPress]);

  const loading = isLoading || locationLoading;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Direct Hire</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{filteredJobs.length}</Text>
          </View>
        </View>

        <Text style={styles.filterSectionLabel}>RADIUS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {RADIUS_OPTIONS.map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.chip, selectedRadius === r && styles.chipActive]}
              onPress={() => { setSelectedRadius(r); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            >
              <Text style={[styles.chipText, selectedRadius === r && styles.chipTextActive]}>{r} mi</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={[styles.filterSectionLabel, { marginTop: 8 }]}>TRADE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chip, !selectedTrade && styles.chipActive]}
            onPress={() => { setSelectedTrade(undefined); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
          >
            <Text style={[styles.chipText, !selectedTrade && styles.chipTextActive]}>All</Text>
          </TouchableOpacity>
          {TRADE_FILTERS.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, selectedTrade === t && styles.chipActive]}
              onPress={() => { setSelectedTrade(selectedTrade === t ? undefined : t); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            >
              <Text style={[styles.chipText, selectedTrade === t && styles.chipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ConstructionLoader size="lg" label="Finding jobs near you..." />
        </View>
      ) : (
        <FlatList
          data={filteredJobs}
          renderItem={renderJob}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AlertCircle size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No jobs found</Text>
              <Text style={styles.emptySubtitle}>
                Try increasing the radius or changing the trade filter
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight, paddingHorizontal: 16, paddingBottom: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, marginTop: 8, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 24, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  countPill: { backgroundColor: Colors.accent + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  countPillText: { fontSize: 13, fontWeight: '700' as const, color: Colors.accent },
  filterSectionLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  chipRow: { flexDirection: 'row', marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  tradeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tradeBadgeText: { fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  contractBadge: { backgroundColor: Colors.fillTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  contractBadgeText: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  cardTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, marginBottom: 2, lineHeight: 22 },
  cardCompany: { fontSize: 13, color: Colors.textSecondary, marginBottom: 10 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: Colors.textSecondary },
  cardFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 6, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  distanceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.infoLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  distanceText: { fontSize: 12, fontWeight: '600' as const, color: Colors.info },
  applyHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  applyHintText: { fontSize: 12, fontWeight: '600' as const, color: Colors.primary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32 },
});

```


---

### `app/(tabs)/discover/estimate.tsx`

```tsx
export { default } from '../../(tabs)/estimate/index';

```


---

### `app/(tabs)/discover/schedule.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Sparkles, CalendarDays, ChevronRight, FileText, X,
  CheckCircle2, Clock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { SCHEDULE_TEMPLATES } from '@/constants/scheduleTemplates';
import type { ScheduleTemplate } from '@/constants/scheduleTemplates';
import type { Project, ScheduleTask, DependencyLink, DependencyType } from '@/types';
import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import {
  createId,
  buildScheduleFromTasks,
} from '@/utils/scheduleEngine';

export default function DiscoverScheduleTool() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, addProject, updateProject } = useProjects();

  const [aiPrompt, setAiPrompt] = useState('');
  const [isAILoading, setIsAILoading] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [pendingAction, setPendingAction] = useState<'ai' | 'template' | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const projectsWithSchedules = projects.filter(p => p.schedule && p.schedule.tasks.length > 0);

  const handleAIGenerate = useCallback(async (targetProject?: Project | null) => {
    if (!aiPrompt.trim()) {
      Alert.alert('Describe your project', 'Enter a description to generate a schedule.');
      return;
    }
    setIsAILoading(true);
    try {
      const responseSchema = z.object({
        tasks: z.array(z.object({
          id: z.string(),
          name: z.string(),
          phase: z.string(),
          duration: z.number(),
          predecessorIds: z.array(z.string()),
          isMilestone: z.boolean(),
          isCriticalPath: z.boolean(),
          crewSize: z.number(),
          wbs: z.string(),
        })),
      });

      console.log('[Discover Schedule] AI generation starting:', aiPrompt.trim().substring(0, 60));

      const aiResult = await mageAI({
        prompt: `You are a professional construction scheduler. Generate a complete construction schedule for this project. Return a JSON object with a "tasks" array.

Project description: ${aiPrompt.trim()}

Each task in the tasks array must have: id (string like "t1", "t2"), name (string), phase (one of: Site Work, Demo, Foundation, Framing, Roofing, MEP, Plumbing, Electrical, HVAC, Insulation, Drywall, Interior, Finishes, Landscaping, Inspections, General), duration (number of working days), predecessorIds (array of id strings referencing other task ids), isMilestone (boolean), isCriticalPath (boolean), crewSize (number 1-8), wbs (string like "1.1", "2.3").

Include a Project Start milestone (duration 0) and Project Complete milestone (duration 0). Group tasks into logical phases with realistic durations and dependencies. Generate 15-40 tasks depending on project size.`,
        schema: responseSchema,
        tier: 'smart',
        maxTokens: 2000,
      });

      if (!aiResult.success) {
        Alert.alert('AI Unavailable', aiResult.error || 'Try again.');
        setIsAILoading(false);
        return;
      }

      let parsed: any = aiResult.data;
      console.log('[Discover Schedule] AI response type:', typeof parsed);

      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          let cleaned = parsed.trim();
          if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
          if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
          if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
          try {
            parsed = JSON.parse(cleaned.trim());
          } catch {
            console.log('[Discover Schedule] Could not parse AI string response');
            Alert.alert('Generation Failed', 'AI returned invalid data. Please try again.');
            setIsAILoading(false);
            return;
          }
        }
      }

      let taskArray: any[] | null = null;
      if (Array.isArray(parsed)) {
        taskArray = parsed;
      } else if (parsed && Array.isArray(parsed.tasks)) {
        taskArray = parsed.tasks;
      } else if (parsed && typeof parsed === 'object') {
        const firstArrayKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
        if (firstArrayKey) taskArray = parsed[firstArrayKey];
      }

      console.log('[Discover Schedule] Parsed tasks count:', taskArray?.length);

      if (!taskArray || taskArray.length === 0) {
        Alert.alert('Generation Failed', 'AI returned no tasks. Please try a more detailed description.');
        setIsAILoading(false);
        return;
      }

      const safeResult = taskArray.map((t: any, idx: number) => ({
        id: t.id || `t${idx + 1}`,
        name: t.name || t.title || `Task ${idx + 1}`,
        phase: t.phase || 'General',
        duration: typeof t.duration === 'number' ? t.duration : (typeof t.durationDays === 'number' ? t.durationDays : 5),
        predecessorIds: Array.isArray(t.predecessorIds) ? t.predecessorIds : (Array.isArray(t.dependencies) ? t.dependencies : []),
        isMilestone: !!t.isMilestone,
        isCriticalPath: !!t.isCriticalPath,
        crewSize: typeof t.crewSize === 'number' ? t.crewSize : 2,
        wbs: t.wbs || t.wbsCode || `${idx + 1}.0`,
      }));

      const tasks: ScheduleTask[] = safeResult.map((t: any, idx: number) => ({
        id: createId('task'),
        title: t.name,
        phase: t.phase,
        durationDays: Math.max(t.isMilestone ? 0 : 1, t.duration),
        startDay: 1,
        progress: 0,
        crew: `Crew ${idx + 1}`,
        crewSize: t.crewSize,
        dependencies: [],
        dependencyLinks: [],
        notes: '',
        status: 'not_started' as const,
        isMilestone: t.isMilestone,
        wbsCode: t.wbs,
        isCriticalPath: t.isCriticalPath,
        isWeatherSensitive: false,
      }));

      const idMap = new Map<string, string>();
      safeResult.forEach((t: any, idx: number) => {
        idMap.set(t.id, tasks[idx].id);
      });

      for (let i = 0; i < tasks.length; i++) {
        const original = safeResult[i];
        tasks[i].dependencyLinks = (original.predecessorIds ?? [])
          .filter((pid: string) => idMap.has(pid))
          .map((pid: string) => ({
            taskId: idMap.get(pid)!,
            type: 'FS' as DependencyType,
            lagDays: 0,
          }));
        tasks[i].dependencies = tasks[i].dependencyLinks!.map((l: DependencyLink) => l.taskId);
      }

      if (targetProject) {
        const scheduleName = `${targetProject.name} Schedule`;
        const schedule = buildScheduleFromTasks(scheduleName, targetProject.id, tasks);
        updateProject(targetProject.id, {
          schedule: { ...schedule, projectId: targetProject.id, updatedAt: new Date().toISOString() },
        });
      } else {
        const now = new Date().toISOString();
        const projectName = aiPrompt.trim().substring(0, 60);
        const newProject: Project = {
          id: createId('project'),
          name: projectName,
          type: 'renovation',
          location: 'United States',
          squareFootage: 0,
          quality: 'standard',
          description: aiPrompt.trim(),
          createdAt: now,
          updatedAt: now,
          estimate: null,
          status: 'draft',
        };
        const scheduleName = `${projectName} Schedule`;
        const schedule = buildScheduleFromTasks(scheduleName, newProject.id, tasks);
        newProject.schedule = { ...schedule, projectId: newProject.id, updatedAt: now };
        addProject(newProject);
      }

      setAiPrompt('');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Schedule Created!',
        `Generated ${tasks.length} tasks. View it now?`,
        [
          { text: 'Later', style: 'cancel' },
          { text: 'View Schedule', onPress: () => router.replace('/(tabs)/schedule' as any) },
        ]
      );
    } catch (err) {
      console.log('[Discover Schedule] AI generation failed:', err);
      Alert.alert('Generation Failed', 'Could not generate schedule. Please try again.');
    } finally {
      setIsAILoading(false);
    }
  }, [aiPrompt, addProject, updateProject, router]);

  const handleTemplateSelect = useCallback((template: ScheduleTemplate, targetProject?: Project | null) => {
    const tasks: ScheduleTask[] = [];
    const idMap = new Map<string, string>();

    template.tasks.forEach(tt => {
      const newId = createId('task');
      idMap.set(tt.id, newId);
    });

    template.tasks.forEach(tt => {
      const newId = idMap.get(tt.id)!;
      const depLinks: DependencyLink[] = tt.predecessorIds
        .filter(pid => idMap.has(pid))
        .map(pid => ({ taskId: idMap.get(pid)!, type: 'FS' as DependencyType, lagDays: 0 }));

      tasks.push({
        id: newId, title: tt.name, phase: tt.phase,
        durationDays: tt.isMilestone ? 0 : Math.max(1, tt.duration),
        startDay: 1, progress: 0, crew: 'Crew', crewSize: tt.crewSize || 1,
        dependencies: depLinks.map(l => l.taskId), dependencyLinks: depLinks,
        notes: '', status: 'not_started', isMilestone: tt.isMilestone,
        isCriticalPath: tt.isCriticalPath, isWeatherSensitive: false,
      });
    });

    if (targetProject) {
      const scheduleName = `${targetProject.name} Schedule`;
      const schedule = buildScheduleFromTasks(scheduleName, targetProject.id, tasks);
      updateProject(targetProject.id, {
        schedule: { ...schedule, projectId: targetProject.id, updatedAt: new Date().toISOString() },
      });
    } else {
      const now = new Date().toISOString();
      const newProject: Project = {
        id: createId('project'),
        name: template.name,
        type: 'renovation',
        location: 'United States',
        squareFootage: 0,
        quality: 'standard',
        description: `Created from ${template.name} template`,
        createdAt: now,
        updatedAt: now,
        estimate: null,
        status: 'draft',
      };
      const schedule = buildScheduleFromTasks(template.name, newProject.id, tasks);
      newProject.schedule = { ...schedule, projectId: newProject.id, updatedAt: now };
      addProject(newProject);
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      'Schedule Created!',
      `Created from "${template.name}" template with ${tasks.length} tasks.`,
      [
        { text: 'Later', style: 'cancel' },
        { text: 'View Schedule', onPress: () => router.replace('/(tabs)/schedule' as any) },
      ]
    );
  }, [addProject, updateProject, router]);

  const handleProjectSelected = useCallback((project: Project) => {
    setShowProjectPicker(false);
    if (pendingAction === 'ai') {
      handleAIGenerate(project);
    } else if (pendingAction === 'template' && selectedTemplateId) {
      const template = SCHEDULE_TEMPLATES.find(t => t.id === selectedTemplateId);
      if (template) handleTemplateSelect(template, project);
    }
    setPendingAction(null);
    setSelectedTemplateId(null);
  }, [pendingAction, selectedTemplateId, handleAIGenerate, handleTemplateSelect]);

  return (
    <View style={s.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Schedule Builder' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.heroSection}>
            <View style={s.heroIconWrap}>
              <CalendarDays size={28} color="#FF9F0A" />
            </View>
            <Text style={s.heroTitle}>Quick Schedule Builder</Text>
            <Text style={s.heroDesc}>
              Create a construction schedule in seconds — no project required.
            </Text>
          </View>

          <View style={s.aiSection}>
            <View style={s.aiHeader}>
              <Sparkles size={18} color="#FF9F0A" />
              <Text style={s.aiTitle}>Generate with AI</Text>
            </View>
            <Text style={s.aiDesc}>
              Describe your project and AI will create a complete schedule with tasks, phases, dependencies, and milestones.
            </Text>
            <TextInput
              style={s.aiInput}
              value={aiPrompt}
              onChangeText={setAiPrompt}
              placeholder="e.g. 2,500 sq ft kitchen and bathroom renovation, gut to studs, new cabinets, tile, fixtures..."
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
              testID="discover-schedule-ai-prompt"
            />
            <View style={s.aiActions}>
              <TouchableOpacity
                style={[s.aiBtn, isAILoading && s.aiBtnDisabled]}
                onPress={() => handleAIGenerate(null)}
                activeOpacity={0.85}
                disabled={isAILoading}
                testID="discover-schedule-ai-generate"
              >
                {isAILoading ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Sparkles size={16} color="#FFF" />
                    <Text style={s.aiBtnText}>Generate (New Project)</Text>
                  </>
                )}
              </TouchableOpacity>
              {projects.length > 0 && (
                <TouchableOpacity
                  style={[s.aiBtnSecondary, isAILoading && s.aiBtnDisabled]}
                  onPress={() => {
                    if (!aiPrompt.trim()) {
                      Alert.alert('Describe your project first.');
                      return;
                    }
                    setPendingAction('ai');
                    setShowProjectPicker(true);
                  }}
                  activeOpacity={0.85}
                  disabled={isAILoading}
                >
                  <Text style={s.aiBtnSecondaryText}>Add to Existing Project</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>OR</Text>
            <View style={s.dividerLine} />
          </View>

          <Text style={s.sectionTitle}>Start from Template</Text>
          {SCHEDULE_TEMPLATES.map(template => (
            <TouchableOpacity
              key={template.id}
              style={s.templateCard}
              onPress={() => {
                Alert.alert(
                  template.name,
                  `${template.tasks.length} tasks. Create as new project or add to existing?`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'New Project',
                      onPress: () => handleTemplateSelect(template, null),
                    },
                    ...(projects.length > 0 ? [{
                      text: 'Existing Project',
                      onPress: () => {
                        setPendingAction('template');
                        setSelectedTemplateId(template.id);
                        setShowProjectPicker(true);
                      },
                    }] : []),
                  ]
                );
              }}
              activeOpacity={0.7}
            >
              <View style={s.templateIconWrap}>
                <FileText size={20} color={Colors.primary} />
              </View>
              <View style={s.templateInfo}>
                <Text style={s.templateName}>{template.name}</Text>
                <Text style={s.templateMeta}>{template.tasks.length} tasks · {template.tasks.filter(t => t.isMilestone).length} milestones</Text>
              </View>
              <ChevronRight size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}

          {projectsWithSchedules.length > 0 && (
            <>
              <Text style={[s.sectionTitle, { marginTop: 24 }]}>Existing Schedules</Text>
              {projectsWithSchedules.map(project => (
                <TouchableOpacity
                  key={project.id}
                  style={s.existingCard}
                  onPress={() => router.replace('/(tabs)/schedule' as any)}
                  activeOpacity={0.7}
                >
                  <View style={s.existingIconWrap}>
                    <CheckCircle2 size={18} color={Colors.success} />
                  </View>
                  <View style={s.templateInfo}>
                    <Text style={s.templateName}>{project.name}</Text>
                    <View style={s.existingMeta}>
                      <Clock size={12} color={Colors.textMuted} />
                      <Text style={s.templateMeta}>
                        {project.schedule?.tasks.length} tasks · {project.schedule?.totalDurationDays}d
                      </Text>
                      {project.schedule?.healthScore && (
                        <View style={[s.healthBadge, { backgroundColor: (project.schedule.healthScore > 70 ? Colors.success : Colors.warning) + '18' }]}>
                          <Text style={[s.healthText, { color: project.schedule.healthScore > 70 ? Colors.success : Colors.warning }]}>
                            {project.schedule.healthScore}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <ChevronRight size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={showProjectPicker} transparent animationType="fade" onRequestClose={() => setShowProjectPicker(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowProjectPicker(false)}>
          <Pressable style={s.modalCard} onPress={() => undefined}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Select Project</Text>
              <TouchableOpacity onPress={() => setShowProjectPicker(false)}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {projects.map(project => (
                <TouchableOpacity
                  key={project.id}
                  style={s.pickerOption}
                  onPress={() => handleProjectSelected(project)}
                  activeOpacity={0.7}
                >
                  <Text style={s.pickerName}>{project.name}</Text>
                  <Text style={s.pickerMeta}>
                    {project.schedule ? `${project.schedule.tasks.length} tasks (will replace)` : 'No schedule yet'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
  heroIconWrap: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: '#FF9F0A' + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: { fontSize: 22, fontWeight: '700' as const, color: Colors.text, marginBottom: 6 },
  heroDesc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  aiSection: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  aiTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
  aiDesc: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12, lineHeight: 18 },
  aiInput: {
    minHeight: 100,
    borderRadius: 14,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 15,
    color: Colors.text,
    marginBottom: 14,
    textAlignVertical: 'top' as const,
  },
  aiActions: { gap: 10 },
  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FF9F0A',
    borderRadius: 14,
    paddingVertical: 15,
    shadowColor: '#FF9F0A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 3,
  },
  aiBtnDisabled: { opacity: 0.6 },
  aiBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#FFF' },
  aiBtnSecondary: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  aiBtnSecondaryText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginVertical: 24,
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.cardBorder },
  dividerText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.5 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  templateIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  templateInfo: { flex: 1, gap: 2 },
  templateName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  templateMeta: { fontSize: 12, color: Colors.textSecondary },
  existingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  existingIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.success + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  existingMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  healthBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  healthText: { fontSize: 11, fontWeight: '700' as const },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    maxHeight: '80%' as any,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  pickerOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.surfaceAlt,
    marginBottom: 8,
  },
  pickerName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  pickerMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
});

```


---

### `app/(tabs)/discover/materials.tsx`

```tsx
export { default } from '../../(tabs)/materials/index';

```


---

### `app/(tabs)/discover/_layout.tsx`

```tsx
import { Stack } from 'expo-router';
export default function DiscoverLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

```


---

### `app/(tabs)/marketplace/index.tsx`

```tsx
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Modal, Pressable, Alert, Platform, FlatList, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Search, X, Star, Truck, Clock, MapPin, Phone, Mail, Globe,
  ChevronRight, Package, CheckCircle,
  Store, Award, DollarSign,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { MOCK_SUPPLIERS, MOCK_LISTINGS, SUPPLIER_CATEGORIES } from '@/mocks/suppliers';
import type { Supplier, SupplierListing } from '@/types';

type ViewMode = 'suppliers' | 'listings';

export default function MarketplaceScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [viewMode, setViewMode] = useState<ViewMode>('suppliers');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [selectedListing, setSelectedListing] = useState<SupplierListing | null>(null);
  const [orderQty, setOrderQty] = useState('1');

  const filteredSuppliers = useMemo(() => {
    let results = MOCK_SUPPLIERS;
    if (activeCategory !== 'all') {
      results = results.filter(s => s.categories.includes(activeCategory));
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(s =>
        s.companyName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.categories.some(c => c.toLowerCase().includes(q))
      );
    }
    return results.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.rating - a.rating);
  }, [query, activeCategory]);

  const filteredListings = useMemo(() => {
    let results = MOCK_LISTINGS;
    if (activeCategory !== 'all') {
      results = results.filter(l => l.category === activeCategory);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q)
      );
    }
    return results;
  }, [query, activeCategory]);

  const getSupplier = useCallback((id: string) => MOCK_SUPPLIERS.find(s => s.id === id), []);

  const supplierListings = useMemo(() => {
    if (!selectedSupplier) return [];
    return MOCK_LISTINGS.filter(l => l.supplierId === selectedSupplier.id);
  }, [selectedSupplier]);

  const handleContactSupplier = useCallback((supplier: Supplier, method: 'email' | 'phone' | 'website') => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (method === 'email') {
      const url = `mailto:${supplier.email}?subject=Inquiry from Tertiary - ${supplier.companyName}`;
      Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open email client.'));
    } else if (method === 'phone') {
      Linking.openURL(`tel:${supplier.phone}`).catch(() => Alert.alert('Error', 'Could not open phone.'));
    } else {
      Linking.openURL(`https://${supplier.website}`).catch(() => Alert.alert('Error', 'Could not open browser.'));
    }
  }, []);

  const handleRequestQuote = useCallback((listing: SupplierListing) => {
    const qty = parseInt(orderQty, 10);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid quantity.');
      return;
    }
    const supplier = getSupplier(listing.supplierId);
    if (!supplier) return;
    const usesBulk = qty >= listing.bulkMinQty;
    const unitPrice = usesBulk ? listing.bulkPrice : listing.price;
    const total = unitPrice * qty;

    const subject = `Tertiary Quote Request - ${listing.name}`;
    const body = `Hi ${supplier.contactName},\n\nI'd like to request a quote for:\n\nItem: ${listing.name}\nQuantity: ${qty} ${listing.unit}\nUnit Price: $${unitPrice.toFixed(2)}${usesBulk ? ' (bulk rate)' : ''}\nEstimated Total: $${total.toFixed(2)}\n\nPlease confirm availability and delivery timeline.\n\nThank you,\nSent via Tertiary`;
    const url = `mailto:${supplier.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open email client.'));
    setSelectedListing(null);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [orderQty, getSupplier]);

  const renderStars = useCallback((rating: number) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Star
          key={i}
          size={12}
          color={i <= Math.round(rating) ? '#FFB800' : Colors.borderLight}
          fill={i <= Math.round(rating) ? '#FFB800' : 'transparent'}
        />
      );
    }
    return stars;
  }, []);

  const renderSupplierCard = useCallback(({ item }: { item: Supplier }) => {
    const listingCount = MOCK_LISTINGS.filter(l => l.supplierId === item.id).length;
    return (
      <TouchableOpacity
        style={styles.supplierCard}
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelectedSupplier(item);
        }}
        activeOpacity={0.7}
        testID={`supplier-${item.id}`}
      >
        {item.featured && (
          <View style={styles.featuredBadge}>
            <Award size={10} color="#FFB800" />
            <Text style={styles.featuredText}>Featured</Text>
          </View>
        )}
        <View style={styles.supplierTop}>
          <View style={styles.supplierAvatar}>
            <Store size={20} color={Colors.primary} />
          </View>
          <View style={styles.supplierInfo}>
            <Text style={styles.supplierName} numberOfLines={1}>{item.companyName}</Text>
            <View style={styles.ratingRow}>
              {renderStars(item.rating)}
              <Text style={styles.ratingText}>{item.rating}</Text>
            </View>
          </View>
          <ChevronRight size={18} color={Colors.textMuted} />
        </View>
        <Text style={styles.supplierDesc} numberOfLines={2}>{item.description}</Text>
        <View style={styles.supplierMeta}>
          <View style={styles.supplierChip}>
            <Package size={10} color={Colors.info} />
            <Text style={styles.supplierChipText}>{listingCount} products</Text>
          </View>
          <View style={styles.supplierChip}>
            <MapPin size={10} color={Colors.textMuted} />
            <Text style={styles.supplierChipText}>{item.address.split(',').pop()?.trim()}</Text>
          </View>
          <View style={styles.supplierChip}>
            <DollarSign size={10} color={Colors.success} />
            <Text style={styles.supplierChipText}>Min ${item.minOrderAmount}</Text>
          </View>
        </View>
        <View style={styles.supplierCats}>
          {item.categories.map(cat => {
            const catInfo = SUPPLIER_CATEGORIES.find(c => c.id === cat);
            return (
              <View key={cat} style={styles.catTag}>
                <Text style={styles.catTagText}>{catInfo?.emoji} {catInfo?.label ?? cat}</Text>
              </View>
            );
          })}
        </View>
      </TouchableOpacity>
    );
  }, [renderStars]);

  const renderListingCard = useCallback(({ item }: { item: SupplierListing }) => {
    const supplier = getSupplier(item.supplierId);
    const savings = item.price > 0 ? Math.round(((item.price - item.bulkPrice) / item.price) * 100) : 0;
    return (
      <TouchableOpacity
        style={styles.listingCard}
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelectedListing(item);
          setOrderQty('1');
        }}
        activeOpacity={0.7}
        testID={`listing-${item.id}`}
      >
        <View style={styles.listingTop}>
          <View style={styles.listingInfo}>
            <Text style={styles.listingName} numberOfLines={2}>{item.name}</Text>
            <Text style={styles.listingDesc} numberOfLines={1}>{item.description}</Text>
          </View>
          {item.inStock && (
            <View style={styles.stockBadge}>
              <CheckCircle size={10} color={Colors.success} />
              <Text style={styles.stockText}>In Stock</Text>
            </View>
          )}
        </View>
        <View style={styles.listingPriceRow}>
          <View style={styles.listingPriceBlock}>
            <Text style={styles.listingPriceLabel}>RETAIL</Text>
            <Text style={styles.listingRetail}>${item.price.toFixed(2)}</Text>
            <Text style={styles.listingUnit}>/{item.unit}</Text>
          </View>
          <View style={styles.listingPriceDivider} />
          <View style={styles.listingPriceBlock}>
            <Text style={[styles.listingPriceLabel, { color: Colors.success }]}>BULK</Text>
            <Text style={styles.listingBulk}>${item.bulkPrice.toFixed(2)}</Text>
            <Text style={styles.listingUnit}>/{item.unit}</Text>
          </View>
          {savings > 0 && (
            <View style={styles.listingSaveBadge}>
              <Text style={styles.listingSaveText}>-{savings}%</Text>
              <Text style={styles.listingMinText}>min {item.bulkMinQty}</Text>
            </View>
          )}
        </View>
        <View style={styles.listingBottom}>
          {supplier && (
            <View style={styles.listingSupplierRow}>
              <Store size={10} color={Colors.textMuted} />
              <Text style={styles.listingSupplierText}>{supplier.companyName}</Text>
            </View>
          )}
          <View style={styles.listingLeadRow}>
            <Clock size={10} color={Colors.info} />
            <Text style={styles.listingLeadText}>{item.leadTimeDays}d lead</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [getSupplier]);

  const orderTotal = useMemo(() => {
    if (!selectedListing) return 0;
    const qty = parseInt(orderQty, 10) || 0;
    const usesBulk = qty >= selectedListing.bulkMinQty;
    return (usesBulk ? selectedListing.bulkPrice : selectedListing.price) * qty;
  }, [selectedListing, orderQty]);

  return (
    <View style={styles.container}>
      <FlatList
        data={viewMode === 'suppliers' ? [] : []}
        renderItem={() => null}
        ListHeaderComponent={
          <View>
            <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
              <Text style={styles.largeTitle}>Marketplace</Text>
              <Text style={styles.subtitle}>Buy materials directly from suppliers</Text>

              <View style={styles.searchBar}>
                <Search size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search suppliers, materials..."
                  placeholderTextColor={Colors.textMuted}
                  autoCorrect={false}
                  selectionColor={Colors.primary}
                  underlineColorAndroid="transparent"
                  testID="marketplace-search"
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <X size={16} color={Colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.modeRow}>
                <TouchableOpacity
                  style={[styles.modeBtn, viewMode === 'suppliers' && styles.modeBtnActive]}
                  onPress={() => setViewMode('suppliers')}
                  activeOpacity={0.7}
                >
                  <Store size={14} color={viewMode === 'suppliers' ? Colors.textOnPrimary : Colors.textSecondary} />
                  <Text style={[styles.modeBtnText, viewMode === 'suppliers' && styles.modeBtnTextActive]}>Suppliers</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, viewMode === 'listings' && styles.modeBtnActive]}
                  onPress={() => setViewMode('listings')}
                  activeOpacity={0.7}
                >
                  <Package size={14} color={viewMode === 'listings' ? Colors.textOnPrimary : Colors.textSecondary} />
                  <Text style={[styles.modeBtnText, viewMode === 'listings' && styles.modeBtnTextActive]}>Products</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.categoriesWrapper}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesContent}>
                {SUPPLIER_CATEGORIES.map(cat => {
                  const isActive = activeCategory === cat.id;
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                      onPress={() => {
                        setActiveCategory(cat.id);
                        if (Platform.OS !== 'web') void Haptics.selectionAsync();
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                      <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.resultsHeader}>
              <Text style={styles.resultsCount}>
                {viewMode === 'suppliers'
                  ? `${filteredSuppliers.length} supplier${filteredSuppliers.length !== 1 ? 's' : ''}`
                  : `${filteredListings.length} product${filteredListings.length !== 1 ? 's' : ''}`
                }
              </Text>
            </View>
          </View>
        }
        ListFooterComponent={
          <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, gap: 10 }}>
            {viewMode === 'suppliers'
              ? filteredSuppliers.map(supplier => (
                  <View key={supplier.id}>
                    {renderSupplierCard({ item: supplier })}
                  </View>
                ))
              : filteredListings.map(listing => (
                  <View key={listing.id}>
                    {renderListingCard({ item: listing })}
                  </View>
                ))
            }
            {viewMode === 'suppliers' && filteredSuppliers.length === 0 && (
              <View style={styles.emptyState}>
                <Store size={40} color={Colors.textMuted} />
                <Text style={styles.emptyTitle}>No suppliers found</Text>
                <Text style={styles.emptyDesc}>Try a different search or category</Text>
              </View>
            )}
            {viewMode === 'listings' && filteredListings.length === 0 && (
              <View style={styles.emptyState}>
                <Package size={40} color={Colors.textMuted} />
                <Text style={styles.emptyTitle}>No products found</Text>
                <Text style={styles.emptyDesc}>Try a different search or category</Text>
              </View>
            )}
          </View>
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />

      <Modal
        visible={selectedSupplier !== null}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => setSelectedSupplier(null)}
      >
        {selectedSupplier && (
          <View style={[styles.modalContainer, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>{selectedSupplier.companyName}</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setSelectedSupplier(null)}
                activeOpacity={0.7}
              >
                <X size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
              <View style={styles.supplierDetailHeader}>
                <View style={styles.supplierDetailAvatar}>
                  <Store size={32} color={Colors.primary} />
                </View>
                <View style={styles.ratingRowLarge}>
                  {renderStars(selectedSupplier.rating)}
                  <Text style={styles.ratingTextLarge}>{selectedSupplier.rating}</Text>
                </View>
                <Text style={styles.supplierDetailDesc}>{selectedSupplier.description}</Text>
              </View>

              <View style={styles.contactGrid}>
                <TouchableOpacity
                  style={styles.contactBtn}
                  onPress={() => handleContactSupplier(selectedSupplier, 'email')}
                  activeOpacity={0.7}
                >
                  <Mail size={18} color={Colors.info} />
                  <Text style={styles.contactBtnText}>Email</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.contactBtn}
                  onPress={() => handleContactSupplier(selectedSupplier, 'phone')}
                  activeOpacity={0.7}
                >
                  <Phone size={18} color={Colors.success} />
                  <Text style={styles.contactBtnText}>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.contactBtn}
                  onPress={() => handleContactSupplier(selectedSupplier, 'website')}
                  activeOpacity={0.7}
                >
                  <Globe size={18} color={Colors.accent} />
                  <Text style={styles.contactBtnText}>Website</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.detailInfoCard}>
                <View style={styles.detailInfoRow}>
                  <MapPin size={14} color={Colors.textMuted} />
                  <Text style={styles.detailInfoText}>{selectedSupplier.address}</Text>
                </View>
                <View style={styles.detailInfoDivider} />
                <View style={styles.detailInfoRow}>
                  <Truck size={14} color={Colors.textMuted} />
                  <Text style={styles.detailInfoText}>{selectedSupplier.deliveryOptions.join(' · ')}</Text>
                </View>
                <View style={styles.detailInfoDivider} />
                <View style={styles.detailInfoRow}>
                  <DollarSign size={14} color={Colors.textMuted} />
                  <Text style={styles.detailInfoText}>Min order: ${selectedSupplier.minOrderAmount}</Text>
                </View>
              </View>

              <Text style={styles.detailSectionLabel}>
                PRODUCTS ({supplierListings.length})
              </Text>
              <View style={styles.detailListingsCard}>
                {supplierListings.map((listing, idx) => {
                  const savings = listing.price > 0 ? Math.round(((listing.price - listing.bulkPrice) / listing.price) * 100) : 0;
                  return (
                    <View key={listing.id}>
                      <TouchableOpacity
                        style={styles.detailListingRow}
                        onPress={() => {
                          setSelectedListing(listing);
                          setOrderQty('1');
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={styles.detailListingInfo}>
                          <Text style={styles.detailListingName}>{listing.name}</Text>
                          <Text style={styles.detailListingMeta}>
                            ${listing.bulkPrice.toFixed(2)}/{listing.unit} bulk · {listing.leadTimeDays}d lead
                          </Text>
                        </View>
                        <View style={styles.detailListingRight}>
                          <Text style={styles.detailListingPrice}>${listing.price.toFixed(2)}</Text>
                          {savings > 0 && (
                            <View style={styles.detailSaveBadge}>
                              <Text style={styles.detailSaveText}>-{savings}%</Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                      {idx < supplierListings.length - 1 && <View style={styles.detailListingDivider} />}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>

      <Modal
        visible={selectedListing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedListing(null)}
      >
        <Pressable style={styles.popupOverlay} onPress={() => setSelectedListing(null)}>
          <Pressable style={styles.popupCard} onPress={() => undefined}>
            {selectedListing && (() => {
              const supplier = getSupplier(selectedListing.supplierId);
              const qty = parseInt(orderQty, 10) || 0;
              const usesBulk = qty >= selectedListing.bulkMinQty;
              const savings = selectedListing.price > 0 ? Math.round(((selectedListing.price - selectedListing.bulkPrice) / selectedListing.price) * 100) : 0;

              return (
                <>
                  <View style={styles.popupHeader}>
                    <Text style={styles.popupTitle} numberOfLines={2}>{selectedListing.name}</Text>
                    <TouchableOpacity onPress={() => setSelectedListing(null)} style={styles.popupCloseBtn}>
                      <X size={18} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.popupDesc}>{selectedListing.description}</Text>

                  {supplier && (
                    <View style={styles.popupSupplierRow}>
                      <Store size={12} color={Colors.primary} />
                      <Text style={styles.popupSupplierName}>{supplier.companyName}</Text>
                      {selectedListing.inStock && (
                        <View style={styles.popupStockBadge}>
                          <CheckCircle size={10} color={Colors.success} />
                          <Text style={styles.popupStockText}>In Stock</Text>
                        </View>
                      )}
                    </View>
                  )}

                  <View style={styles.popupPriceRow}>
                    <View style={styles.popupPriceBlock}>
                      <Text style={styles.popupPriceLabel}>RETAIL</Text>
                      <Text style={styles.popupRetail}>${selectedListing.price.toFixed(2)}</Text>
                      <Text style={styles.popupPriceUnit}>/{selectedListing.unit}</Text>
                    </View>
                    <View style={styles.popupPriceBlock}>
                      <Text style={[styles.popupPriceLabel, { color: Colors.success }]}>BULK</Text>
                      <Text style={styles.popupBulk}>${selectedListing.bulkPrice.toFixed(2)}</Text>
                      <Text style={styles.popupPriceUnit}>/{selectedListing.unit}</Text>
                    </View>
                  </View>

                  <Text style={styles.popupFieldLabel}>Quantity ({selectedListing.unit})</Text>
                  <View style={styles.popupQtyRow}>
                    <TouchableOpacity
                      style={styles.popupQtyBtn}
                      onPress={() => {
                        const q = Math.max(1, (parseInt(orderQty, 10) || 1) - 1);
                        setOrderQty(String(q));
                      }}
                    >
                      <Text style={styles.popupQtyBtnText}>−</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={styles.popupQtyInput}
                      value={orderQty}
                      onChangeText={setOrderQty}
                      keyboardType="number-pad"
                      textAlign="center"
                      testID="order-qty-input"
                    />
                    <TouchableOpacity
                      style={styles.popupQtyBtn}
                      onPress={() => {
                        const q = (parseInt(orderQty, 10) || 0) + 1;
                        setOrderQty(String(q));
                      }}
                    >
                      <Text style={styles.popupQtyBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>

                  {usesBulk && (
                    <View style={styles.popupBulkBanner}>
                      <CheckCircle size={14} color={Colors.success} />
                      <Text style={styles.popupBulkText}>Bulk pricing applied! Save {savings}%</Text>
                    </View>
                  )}

                  <View style={styles.popupTotalRow}>
                    <Text style={styles.popupTotalLabel}>Estimated Total</Text>
                    <Text style={styles.popupTotalValue}>${orderTotal.toFixed(2)}</Text>
                  </View>

                  <View style={styles.popupLeadRow}>
                    <Clock size={12} color={Colors.info} />
                    <Text style={styles.popupLeadText}>
                      Estimated lead time: {selectedListing.leadTimeDays} business day{selectedListing.leadTimeDays !== 1 ? 's' : ''}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.popupRequestBtn}
                    onPress={() => handleRequestQuote(selectedListing)}
                    activeOpacity={0.85}
                    testID="request-quote-btn"
                  >
                    <Mail size={18} color={Colors.textOnPrimary} />
                    <Text style={styles.popupRequestBtnText}>Request Quote via Email</Text>
                  </TouchableOpacity>

                  {supplier && (
                    <TouchableOpacity
                      style={styles.popupCallBtn}
                      onPress={() => handleContactSupplier(supplier, 'phone')}
                      activeOpacity={0.7}
                    >
                      <Phone size={16} color={Colors.primary} />
                      <Text style={styles.popupCallBtnText}>Call {supplier.companyName}</Text>
                    </TouchableOpacity>
                  )}
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: -4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 14,
    paddingHorizontal: 12,
    gap: 8,
    height: 44,
    marginTop: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.fillTertiary,
  },
  modeBtnActive: {
    backgroundColor: Colors.primary,
  },
  modeBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  modeBtnTextActive: {
    color: Colors.textOnPrimary,
  },
  categoriesWrapper: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  categoriesContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.fillTertiary,
  },
  categoryChipActive: {
    backgroundColor: Colors.primary,
  },
  categoryEmoji: {
    fontSize: 13,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  categoryChipTextActive: {
    color: Colors.textOnPrimary,
    fontWeight: '600' as const,
  },
  resultsHeader: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  resultsCount: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.2,
  },
  supplierCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  featuredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  featuredText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#FFB800',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  supplierTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  supplierAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplierInfo: {
    flex: 1,
    gap: 4,
  },
  supplierName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginLeft: 3,
  },
  supplierDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  supplierMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  supplierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  supplierChipText: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  supplierCats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  catTag: {
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  catTagText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  listingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  listingTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  listingInfo: {
    flex: 1,
    gap: 3,
  },
  listingName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    lineHeight: 20,
  },
  listingDesc: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  stockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.successLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  stockText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  listingPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  listingPriceBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  listingPriceLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    marginRight: 4,
    letterSpacing: 0.5,
  },
  listingRetail: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textDecorationLine: 'line-through' as const,
  },
  listingBulk: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.success,
    letterSpacing: -0.3,
  },
  listingUnit: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  listingPriceDivider: {
    width: 0.5,
    height: 24,
    backgroundColor: Colors.border,
  },
  listingSaveBadge: {
    alignItems: 'flex-end',
  },
  listingSaveText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  listingMinText: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  listingBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listingSupplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  listingSupplierText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  listingLeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  listingLeadText: {
    fontSize: 11,
    color: Colors.info,
    fontWeight: '500' as const,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  emptyDesc: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center' as const,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  modalTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.3,
    marginRight: 12,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplierDetailHeader: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 10,
  },
  supplierDetailAvatar: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  ratingRowLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingTextLarge: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginLeft: 4,
  },
  supplierDetailDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  contactGrid: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  contactBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  contactBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  detailInfoCard: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  detailInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailInfoText: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
  },
  detailInfoDivider: {
    height: 0.5,
    backgroundColor: Colors.borderLight,
    marginLeft: 24,
  },
  detailSectionLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  detailListingsCard: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  detailListingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  detailListingInfo: {
    flex: 1,
    gap: 2,
  },
  detailListingName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  detailListingMeta: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  detailListingRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  detailListingPrice: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  detailSaveBadge: {
    backgroundColor: Colors.successLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  detailSaveText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  detailListingDivider: {
    height: 0.5,
    backgroundColor: Colors.borderLight,
    marginLeft: 14,
  },
  popupOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  popupCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 20,
    gap: 12,
    maxHeight: '85%',
  },
  popupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  popupTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    lineHeight: 24,
  },
  popupCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  popupSupplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  popupSupplierName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
    flex: 1,
  },
  popupStockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.successLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  popupStockText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  popupPriceRow: {
    flexDirection: 'row',
    gap: 10,
  },
  popupPriceBlock: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  popupPriceLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    letterSpacing: 0.5,
    marginRight: 4,
  },
  popupRetail: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textDecorationLine: 'line-through' as const,
  },
  popupBulk: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  popupPriceUnit: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  popupFieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  popupQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  popupQtyBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupQtyBtnText: {
    fontSize: 22,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  popupQtyInput: {
    flex: 1,
    height: 48,
    backgroundColor: Colors.background,
    borderRadius: 12,
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  popupBulkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.successLight,
    borderRadius: 10,
    padding: 10,
  },
  popupBulkText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  popupTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.primary + '08',
    borderRadius: 12,
    padding: 14,
  },
  popupTotalLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  popupTotalValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  popupLeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  popupLeadText: {
    fontSize: 12,
    color: Colors.info,
    fontWeight: '500' as const,
  },
  popupRequestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 4,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  popupRequestBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  popupCallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '10',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  popupCallBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
});

```


---

### `app/(tabs)/equipment/index.tsx`

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Modal,
  TextInput, Alert, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Truck, Plus, AlertTriangle, X, ChevronDown, Crown,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import type { EquipmentCategory } from '@/types';
import { EQUIPMENT_CATEGORIES } from '@/types';
import { formatMoney } from '@/utils/formatters';

type FilterType = 'all' | 'available' | 'in_use' | 'maintenance';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  available: { label: 'Available', color: Colors.success },
  in_use: { label: 'In Use', color: Colors.info },
  maintenance: { label: 'Maintenance', color: Colors.warning },
  retired: { label: 'Retired', color: Colors.textMuted },
};

export default function EquipmentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { equipment, addEquipment, getProject } = useProjects();
  const { isProOrAbove } = useSubscription();
  const { canAccess } = useTierAccess();

  const [filter, setFilter] = useState<FilterType>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMake, setNewMake] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newType, setNewType] = useState<'owned' | 'rented'>('owned');
  const [newCategory, setNewCategory] = useState<EquipmentCategory>('other');
  const [newDailyRate, setNewDailyRate] = useState('');
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  const stats = useMemo(() => ({
    total: equipment.length,
    inUse: equipment.filter(e => e.status === 'in_use').length,
    overdueCount: equipment.filter(e =>
      e.maintenanceSchedule.some(m => m.isOverdue)
    ).length,
  }), [equipment]);

  const filteredEquipment = useMemo(() => {
    if (filter === 'all') return equipment;
    return equipment.filter(e => e.status === filter);
  }, [equipment, filter]);

  const handleAdd = useCallback(() => {
    if (!newName.trim()) {
      Alert.alert('Missing Name', 'Please enter an equipment name.');
      return;
    }
    addEquipment({
      name: newName.trim(),
      type: newType,
      category: newCategory,
      make: newMake.trim(),
      model: newModel.trim(),
      dailyRate: parseFloat(newDailyRate) || 0,
      maintenanceSchedule: [],
      utilizationLog: [],
      status: 'available',
    });
    setShowAddModal(false);
    setNewName('');
    setNewMake('');
    setNewModel('');
    setNewDailyRate('');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [newName, newType, newCategory, newMake, newModel, newDailyRate, addEquipment]);

  if (!canAccess('equipment_rental') || !isProOrAbove) {
    return (
      <Paywall
        visible={true}
        feature="Equipment Tracking"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.largeTitle}>Equipment</Text>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.total}</Text>
          <Text style={styles.statLabel}>Total Fleet</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: Colors.info }]}>{stats.inUse}</Text>
          <Text style={styles.statLabel}>In Use</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: stats.overdueCount > 0 ? Colors.error : Colors.success }]}>{stats.overdueCount}</Text>
          <Text style={styles.statLabel}>Overdue</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {(['all', 'available', 'in_use', 'maintenance'] as FilterType[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>
              {f === 'all' ? 'All' : f === 'in_use' ? 'In Use' : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        {filteredEquipment.length === 0 ? (
          <View style={styles.emptyState}>
            <Truck size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No Equipment</Text>
            <Text style={styles.emptyDesc}>Add your first piece of equipment to start tracking.</Text>
          </View>
        ) : (
          filteredEquipment.map(equip => {
            const statusConfig = STATUS_CONFIG[equip.status] ?? STATUS_CONFIG.available;
            const hasOverdue = equip.maintenanceSchedule.some(m => m.isOverdue);
            const projectName = equip.currentProjectId ? getProject(equip.currentProjectId)?.name : null;

            return (
              <TouchableOpacity
                key={equip.id}
                style={styles.equipCard}
                onPress={() => router.push({ pathname: '/equipment-detail' as any, params: { equipmentId: equip.id } })}
                activeOpacity={0.7}
              >
                <View style={styles.equipCardHeader}>
                  <View style={styles.equipIconWrap}>
                    <Truck size={20} color={Colors.primary} />
                  </View>
                  <View style={styles.equipCardInfo}>
                    <Text style={styles.equipName} numberOfLines={1}>{equip.name}</Text>
                    <Text style={styles.equipMeta}>{equip.make} {equip.model}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + '20' }]}>
                    <Text style={[styles.statusBadgeText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
                  </View>
                </View>
                <View style={styles.equipCardFooter}>
                  {projectName && (
                    <Text style={styles.equipProject} numberOfLines={1}>{projectName}</Text>
                  )}
                  <Text style={styles.equipRate}>{formatMoney(equip.dailyRate)}/day</Text>
                  {hasOverdue && (
                    <View style={styles.overdueBadge}>
                      <AlertTriangle size={12} color={Colors.error} />
                      <Text style={styles.overdueText}>Overdue</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => setShowAddModal(true)}
        activeOpacity={0.85}
        testID="add-equipment"
      >
        <Plus size={24} color="#fff" />
      </TouchableOpacity>

      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Equipment</Text>
                <TouchableOpacity onPress={() => setShowAddModal(false)}>
                  <X size={22} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Name *</Text>
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Cat 320 Excavator"
                placeholderTextColor={Colors.textMuted}
              />

              <View style={styles.typeRow}>
                <TouchableOpacity
                  style={[styles.typeChip, newType === 'owned' && styles.typeChipActive]}
                  onPress={() => setNewType('owned')}
                >
                  <Text style={[styles.typeChipText, newType === 'owned' && styles.typeChipTextActive]}>Owned</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeChip, newType === 'rented' && styles.typeChipActive]}
                  onPress={() => setNewType('rented')}
                >
                  <Text style={[styles.typeChipText, newType === 'rented' && styles.typeChipTextActive]}>Rented</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Category</Text>
              <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowCategoryPicker(!showCategoryPicker)}>
                <Text style={styles.pickerBtnText}>
                  {EQUIPMENT_CATEGORIES.find(c => c.id === newCategory)?.label ?? 'Other'}
                </Text>
                <ChevronDown size={16} color={Colors.textMuted} />
              </TouchableOpacity>
              {showCategoryPicker && (
                <View style={styles.categoryGrid}>
                  {EQUIPMENT_CATEGORIES.map(cat => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.catChip, newCategory === cat.id && styles.catChipActive]}
                      onPress={() => { setNewCategory(cat.id); setShowCategoryPicker(false); }}
                    >
                      <Text style={[styles.catChipText, newCategory === cat.id && styles.catChipTextActive]}>{cat.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.rowFields}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Make</Text>
                  <TextInput style={styles.input} value={newMake} onChangeText={setNewMake} placeholder="Caterpillar" placeholderTextColor={Colors.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Model</Text>
                  <TextInput style={styles.input} value={newModel} onChangeText={setNewModel} placeholder="320GC" placeholderTextColor={Colors.textMuted} />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Daily Rate ($)</Text>
              <TextInput
                style={styles.input}
                value={newDailyRate}
                onChangeText={setNewDailyRate}
                placeholder="350"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
              />

              <TouchableOpacity style={styles.saveBtn} onPress={handleAdd} activeOpacity={0.85}>
                <Text style={styles.saveBtnText}>Add Equipment</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    paddingTop: 4,
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.fillTertiary,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: '#fff',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  emptyDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  equipCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    gap: 10,
  },
  equipCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  equipIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  equipCardInfo: {
    flex: 1,
    gap: 2,
  },
  equipName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  equipMeta: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  equipCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 52,
  },
  equipProject: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
  },
  equipRate: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  overdueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: Colors.errorLight,
  },
  overdueText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.error,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  typeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
  },
  typeChipActive: {
    backgroundColor: Colors.primary,
  },
  typeChipText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  typeChipTextActive: {
    color: '#fff',
  },
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerBtnText: {
    fontSize: 15,
    color: Colors.text,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
  },
  catChipActive: {
    backgroundColor: Colors.primary,
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  catChipTextActive: {
    color: '#fff',
  },
  rowFields: {
    flexDirection: 'row',
    gap: 10,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  saveBtnText: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: '#fff',
  },
  lockedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 16,
  },
  lockedIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.accent + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  lockedTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  lockedDesc: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  upgradeBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  upgradeBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#fff',
  },
});

```


---

### `app/(tabs)/construction-ai/index.tsx`

```tsx
// DOB / Building Code Check — Pro+ feature
//
// Users describe a construction scenario (e.g. "finishing a basement in
// Brooklyn with an egress window"), pick a location and a category, and
// mageAISmart returns the relevant code sections, required permits,
// inspection checkpoints and common violations. Response is cached per
// unique prompt for 24h via mageAI's cacheKey mechanism so rapid
// re-queries don't hammer the edge function.
//
// Tier gating is enforced at the top; AI daily-call limits piggyback on
// the existing `ai_code_check_daily` FEATURE_LIMITS entry (free: 3,
// pro: 20, business: unlimited). Local counter lives in AsyncStorage so
// a fresh install resets the quota — acceptable for a lightweight gate.
//
// UX: the result is rendered in a full-screen Modal with accordion
// sections (summary first, everything else collapsed) so users don't
// have to scroll through a wall of text. A second Modal overlays while
// the AI request is in flight, with an animated loader that actually
// communicates what's happening ("Scanning IRC…", "Checking local
// amendments…") so the spinner doesn't feel dead.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal, Animated, Easing,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Gavel, MapPin, Hammer, AlertTriangle, CheckCircle, Sparkles,
  ClipboardCheck, BookOpen, X, ChevronDown, ChevronUp, Zap,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { z } from 'zod';
import { Colors } from '@/constants/colors';
import { mageAISmart } from '@/utils/mageAI';
import { useTierAccess, FEATURE_LIMITS } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';

const CATEGORIES = [
  { key: 'residential', label: 'Residential', icon: Hammer },
  { key: 'commercial', label: 'Commercial', icon: Hammer },
  { key: 'electrical', label: 'Electrical', icon: Hammer },
  { key: 'plumbing', label: 'Plumbing', icon: Hammer },
  { key: 'structural', label: 'Structural', icon: Hammer },
  { key: 'egress_fire', label: 'Egress / Fire', icon: AlertTriangle },
  { key: 'accessibility', label: 'ADA / Accessibility', icon: CheckCircle },
  { key: 'zoning', label: 'Zoning / Land Use', icon: BookOpen },
] as const;

type CategoryKey = typeof CATEGORIES[number]['key'];

// Curated "typical questions" per category. Tapping one autofills the
// scenario textarea so users get a structured, well-framed prompt instead
// of a vague one-liner — which in turn yields a better AI response.
const PRESET_QUESTIONS: Record<CategoryKey, string[]> = {
  residential: [
    'Finishing a basement into a livable bedroom with an egress window and new HVAC branch.',
    'Converting a detached garage into an ADU with full kitchen and bathroom.',
    'Adding a second story over a single-story ranch — existing foundation and framing.',
    'Replacing a roof on a 1960s home — tear-off to sheathing plus new underlayment.',
  ],
  commercial: [
    'Tenant fit-out for a 1,500 sq ft coffee shop in an existing retail shell.',
    'Converting a warehouse into a small office — new bathrooms, HVAC and lighting.',
    'Restaurant grease hood exhaust install and make-up air requirements.',
    'Interior demo of a 2,500 sq ft retail bay down to the shell.',
  ],
  electrical: [
    'Upgrading a 100A panel to a 200A service with a new meter socket.',
    'Adding a 60A sub-panel in a detached garage with a 100ft underground feeder.',
    'Installing a Level-2 EV charger on an existing residential panel.',
    'Bringing knob-and-tube wiring up to code in a pre-war apartment.',
  ],
  plumbing: [
    'Adding a full bathroom in a basement — new stack, pump-up ejector and vent.',
    'Replacing a 50-gallon atmospheric water heater with a tankless gas unit.',
    'Re-piping a house from galvanized to PEX with a new main shutoff.',
    'Installing a backflow preventer on an irrigation line to a public water main.',
  ],
  structural: [
    'Removing a load-bearing wall between kitchen and living room — new LVL beam.',
    'Cutting a new 6ft wide door opening in an exterior 2x6 load-bearing wall.',
    'Adding a rooftop deck over an existing flat roof — checking framing capacity.',
    'Underpinning a foundation to add a basement below an existing slab on grade.',
  ],
  egress_fire: [
    'Basement bedroom egress window — sizing, well and ladder requirements.',
    'Multi-family building — common-path-of-travel and second means of egress.',
    'Fire-rated wall assembly between an attached garage and living space.',
    'Fire sprinkler retrofit triggers for a major residential renovation.',
  ],
  accessibility: [
    'ADA-compliant bathroom in a new small commercial tenant fit-out.',
    'Accessible route from a public sidewalk to a small-business entrance.',
    'Single-user restroom minimum dimensions and grab-bar placement.',
    'Accessible parking count and van-accessible spaces for a 20-space lot.',
  ],
  zoning: [
    'Building a new deck at the rear setback line of a R4 zoning lot.',
    'Adding an ADU to a single-family lot — checking parking and lot coverage.',
    'Home-based contracting business — zoning restrictions and permit needs.',
    'Building height and FAR limits for a proposed 3-story addition.',
  ],
};

const codeCheckSchema = z.object({
  summary: z.string().catch('').default(''),
  applicableCodes: z.array(z.object({
    code: z.string().catch('').default(''),
    section: z.string().catch('').default(''),
    requirement: z.string().catch('').default(''),
  })).default([]),
  permitsRequired: z.array(z.string()).default([]),
  inspections: z.array(z.string()).default([]),
  commonViolations: z.array(z.string()).default([]),
  disclaimer: z.string().catch('').default(''),
});

type CodeCheckResult = z.infer<typeof codeCheckSchema>;

const USAGE_KEY = 'mageid_code_check_usage_v1';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function getTodayUsage(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { day: string; count: number };
    if (parsed.day !== todayKey()) return 0;
    return parsed.count ?? 0;
  } catch { return 0; }
}

async function bumpTodayUsage(): Promise<void> {
  try {
    const current = await getTodayUsage();
    await AsyncStorage.setItem(USAGE_KEY, JSON.stringify({ day: todayKey(), count: current + 1 }));
  } catch { /* ignore */ }
}

export default function ConstructionAITab() {
  const { canAccess } = useTierAccess();
  const [showPaywall, setShowPaywall] = useState(false);
  const insets = useSafeAreaInsets();

  if (!canAccess('ai_code_check')) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingHorizontal: 24 }]}>
        <View style={styles.lockedHero}>
          <View style={styles.lockedIconWrap}>
            <Gavel size={36} color={Colors.primary} />
          </View>
          <Text style={styles.lockedTitle}>Construction AI</Text>
          <Text style={styles.lockedBody}>
            Describe a project and Construction AI flags the likely building codes, required permits,
            inspections and common violations to avoid. Part of Pro and Business plans.
          </Text>
          <TouchableOpacity
            style={styles.lockedCta}
            onPress={() => setShowPaywall(true)}
            activeOpacity={0.85}
            testID="construction-ai-upgrade"
          >
            <Sparkles size={18} color="#FFF" />
            <Text style={styles.lockedCtaText}>Upgrade to Pro</Text>
          </TouchableOpacity>
        </View>
        <Paywall
          visible={showPaywall}
          feature="Construction AI"
          requiredTier="pro"
          onClose={() => setShowPaywall(false)}
        />
      </View>
    );
  }
  return <CodeCheckScreenInner />;
}

function CodeCheckScreenInner() {
  const insets = useSafeAreaInsets();
  const { tier } = useTierAccess();

  const [location, setLocation] = useState<string>('');
  const [category, setCategory] = useState<CategoryKey>('residential');
  const [scenario, setScenario] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CodeCheckResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [overLimit, setOverLimit] = useState(false);

  const dailyCap = useMemo(() => FEATURE_LIMITS.ai_code_check_daily[tier], [tier]);

  const canSubmit = location.trim().length > 0 && scenario.trim().length > 10 && !loading;

  const runCheck = useCallback(async () => {
    if (!canSubmit) return;
    const used = await getTodayUsage();
    if (used >= dailyCap) {
      setOverLimit(true);
      return;
    }

    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    setResult(null);
    setResultOpen(false);

    const categoryLabel = CATEGORIES.find((c) => c.key === category)?.label ?? category;
    const prompt = `You are a licensed code-compliance advisor for US construction. A contractor is working on the following project and needs a building-code sanity check.

Location: ${location.trim()}
Category: ${categoryLabel}
Scenario: ${scenario.trim()}

Return a JSON object with:
- summary: one paragraph explaining the key code implications
- applicableCodes: array of { code (e.g. "IRC 2021", "NYC BC 2022"), section (e.g. "R310.1"), requirement (plain English) }
- permitsRequired: array of permit names the contractor should pull before work
- inspections: array of inspections this project will likely need
- commonViolations: array of the most common code violations for this type of work
- disclaimer: a one-sentence reminder that this is AI guidance, not legal advice, and the AHJ governs

Be specific to the cited location if possible. If the location is not in the US, note that and give the closest applicable model code guidance.`;

    const cacheKey = `code_check::${location.trim().toLowerCase()}::${category}::${scenario.trim().toLowerCase().slice(0, 120)}`;

    try {
      const res = await mageAISmart(prompt, codeCheckSchema, cacheKey);
      if (!res.success || !res.data) {
        setLoading(false);
        Alert.alert('Code check failed', res.error ?? 'The AI returned an unexpected response. Please try again.');
        return;
      }
      setResult(res.data as CodeCheckResult);
      if (!res.cached) await bumpTodayUsage();
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // iOS can't present two Modals at once. Dismiss the loading modal
      // first, then open the result modal after the dismissal animation
      // has had time to finish — otherwise the second modal silently
      // refuses to present and the screen appears frozen.
      setLoading(false);
      const openDelay = Platform.OS === 'ios' ? 450 : 80;
      setTimeout(() => setResultOpen(true), openDelay);
    } catch (err) {
      setLoading(false);
      Alert.alert('Code check failed', err instanceof Error ? err.message : 'Unknown error.');
    }
  }, [canSubmit, category, dailyCap, location, scenario]);

  const presets = PRESET_QUESTIONS[category];

  if (overLimit) {
    return (
      <Paywall
        visible={true}
        feature={`Code Check Daily Limit (${dailyCap}/day on ${tier})`}
        requiredTier={tier === 'free' ? 'pro' : 'business'}
        onClose={() => setOverLimit(false)}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen
        options={{
          title: 'Construction AI',
          headerShown: false,
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <View style={styles.heroIconWrap}>
              <Gavel size={28} color={Colors.primary} />
            </View>
            <Text style={styles.heroTitle}>Construction AI</Text>
            <Text style={styles.heroSubtitle}>
              Describe your project and Construction AI flags the likely codes, permits and common violations to watch for.
            </Text>
          </View>

          <Text style={styles.label}>Location (city, state)</Text>
          <View style={styles.inputRow}>
            <MapPin size={16} color={Colors.textMuted} />
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="e.g. Brooklyn, NY"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
              testID="code-check-location"
            />
          </View>

          <Text style={styles.label}>Category</Text>
          <View style={styles.chipWrap}>
            {CATEGORIES.map((c) => {
              const active = c.key === category;
              return (
                <TouchableOpacity
                  key={c.key}
                  onPress={() => setCategory(c.key)}
                  activeOpacity={0.8}
                  style={[styles.chip, active && styles.chipActive]}
                  testID={`code-check-cat-${c.key}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.presetHeader}>
            <Zap size={14} color={Colors.primary} />
            <Text style={styles.presetHeaderText}>Popular questions</Text>
          </View>
          <View style={styles.presetList}>
            {presets.map((q) => (
              <TouchableOpacity
                key={q}
                onPress={() => {
                  setScenario(q);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
                activeOpacity={0.7}
                style={[
                  styles.presetPill,
                  scenario === q && styles.presetPillActive,
                ]}
                testID={`code-check-preset-${q.slice(0, 20)}`}
              >
                <Text style={[
                  styles.presetPillText,
                  scenario === q && styles.presetPillTextActive,
                ]} numberOfLines={2}>
                  {q}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Describe the work</Text>
          <TextInput
            value={scenario}
            onChangeText={setScenario}
            placeholder="Tap a popular question above, or write your own (e.g. converting a garage into a livable bedroom with a new egress window)."
            placeholderTextColor={Colors.textMuted}
            style={styles.textArea}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            testID="code-check-scenario"
          />

          <TouchableOpacity
            style={[styles.runBtn, !canSubmit && styles.runBtnDisabled]}
            onPress={runCheck}
            disabled={!canSubmit}
            activeOpacity={0.85}
            testID="code-check-run"
          >
            <Sparkles size={18} color="#FFF" />
            <Text style={styles.runBtnText}>Run Code Check</Text>
          </TouchableOpacity>

          <Text style={styles.quotaText}>
            {dailyCap === Infinity ? 'Unlimited code checks today' : `Daily limit: ${dailyCap} checks`}
          </Text>

          {result && !resultOpen ? (
            <TouchableOpacity
              style={styles.reopenBtn}
              onPress={() => setResultOpen(true)}
              activeOpacity={0.8}
              testID="code-check-reopen"
            >
              <BookOpen size={16} color={Colors.primary} />
              <Text style={styles.reopenText}>View last result</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <LoadingModal visible={loading} />
      <ResultModal
        visible={resultOpen && !!result}
        result={result}
        onClose={() => setResultOpen(false)}
      />
    </View>
  );
}

// ── Animated loading modal ─────────────────────────────────────────────
// Shows a rotating gavel + a rotating status line so the wait feels
// like something is actually happening rather than a dead spinner.

const LOADING_STEPS = [
  'Scanning applicable codes…',
  'Checking local amendments…',
  'Flagging required permits…',
  'Reviewing common violations…',
  'Drafting inspection checklist…',
];

function LoadingModal({ visible }: { visible: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (!visible) {
      setStepIdx(0);
      return;
    }
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    spinLoop.start();
    pulseLoop.start();
    const interval = setInterval(() => {
      setStepIdx((i) => (i + 1) % LOADING_STEPS.length);
    }, 1500);
    return () => {
      spinLoop.stop();
      pulseLoop.stop();
      clearInterval(interval);
      spin.setValue(0);
      pulse.setValue(0);
    };
  }, [visible, spin, pulse]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] });

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.loadingBackdrop}>
        <View style={styles.loadingCard}>
          <View style={styles.loadingIconStack}>
            <Animated.View
              style={[
                styles.loadingPulse,
                { transform: [{ scale }], opacity },
              ]}
            />
            <Animated.View style={{ transform: [{ rotate }] }}>
              <Gavel size={44} color={Colors.primary} />
            </Animated.View>
          </View>
          <Text style={styles.loadingTitle}>Running Code Check</Text>
          <Text style={styles.loadingStep}>{LOADING_STEPS[stepIdx]}</Text>
          <View style={styles.loadingDots}>
            {LOADING_STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.loadingDot,
                  i <= stepIdx && styles.loadingDotActive,
                ]}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Result modal ───────────────────────────────────────────────────────
// Summary is always expanded. The other four sections collapse into
// chevrons so the result fits in one screen for a typical response.

type SectionKey = 'codes' | 'permits' | 'inspections' | 'violations';

function ResultModal({
  visible, result, onClose,
}: { visible: boolean; result: CodeCheckResult | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState<SectionKey | null>('codes');

  if (!result) return null;

  const toggle = (k: SectionKey) => setExpanded((cur) => cur === k ? null : k);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.resultContainer, { paddingTop: Platform.OS === 'ios' ? 8 : insets.top + 8 }]}>
        <View style={styles.resultHeader}>
          <View style={styles.resultHeaderIcon}>
            <Gavel size={20} color={Colors.primary} />
          </View>
          <Text style={styles.resultHeaderTitle}>Code Check Result</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.resultCloseBtn}
            testID="code-check-close"
            activeOpacity={0.7}
          >
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {result.summary ? (
            <View style={[styles.resultCard, styles.resultSummaryCard]}>
              <View style={styles.resultCardHeader}>
                <BookOpen size={16} color={Colors.primary} />
                <Text style={styles.resultCardTitle}>Summary</Text>
              </View>
              <Text style={styles.resultBody}>{result.summary}</Text>
            </View>
          ) : null}

          {result.applicableCodes.length > 0 && (
            <AccordionSection
              keyName="codes"
              title="Applicable Codes"
              count={result.applicableCodes.length}
              Icon={Gavel}
              iconColor={Colors.primary}
              expanded={expanded === 'codes'}
              onToggle={toggle}
            >
              {result.applicableCodes.map((c, i) => (
                <View key={i} style={styles.codeRow}>
                  <Text style={styles.codeLabel}>{[c.code, c.section].filter(Boolean).join(' · ')}</Text>
                  <Text style={styles.codeReq}>{c.requirement}</Text>
                </View>
              ))}
            </AccordionSection>
          )}

          {result.permitsRequired.length > 0 && (
            <AccordionSection
              keyName="permits"
              title="Permits Required"
              count={result.permitsRequired.length}
              Icon={ClipboardCheck}
              iconColor={Colors.primary}
              expanded={expanded === 'permits'}
              onToggle={toggle}
            >
              {result.permitsRequired.map((p, i) => (
                <Text key={i} style={styles.bulletRow}>• {p}</Text>
              ))}
            </AccordionSection>
          )}

          {result.inspections.length > 0 && (
            <AccordionSection
              keyName="inspections"
              title="Inspections"
              count={result.inspections.length}
              Icon={CheckCircle}
              iconColor={Colors.success}
              expanded={expanded === 'inspections'}
              onToggle={toggle}
            >
              {result.inspections.map((ins, i) => (
                <Text key={i} style={styles.bulletRow}>• {ins}</Text>
              ))}
            </AccordionSection>
          )}

          {result.commonViolations.length > 0 && (
            <AccordionSection
              keyName="violations"
              title="Common Violations"
              count={result.commonViolations.length}
              Icon={AlertTriangle}
              iconColor={Colors.warning}
              expanded={expanded === 'violations'}
              onToggle={toggle}
            >
              {result.commonViolations.map((v, i) => (
                <Text key={i} style={styles.bulletRow}>• {v}</Text>
              ))}
            </AccordionSection>
          )}

          <Text style={styles.disclaimer}>
            {result.disclaimer ||
              'AI guidance only — verify with the local Authority Having Jurisdiction (AHJ) before work begins.'}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function AccordionSection({
  keyName, title, count, Icon, iconColor, expanded, onToggle, children,
}: {
  keyName: SectionKey;
  title: string;
  count: number;
  Icon: typeof Gavel;
  iconColor: string;
  expanded: boolean;
  onToggle: (k: SectionKey) => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.resultCard}>
      <TouchableOpacity
        onPress={() => onToggle(keyName)}
        activeOpacity={0.7}
        style={styles.accordionHeader}
        testID={`code-check-accordion-${keyName}`}
      >
        <Icon size={16} color={iconColor} />
        <Text style={styles.resultCardTitle}>{title}</Text>
        <View style={styles.accordionCount}>
          <Text style={styles.accordionCountText}>{count}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {expanded
          ? <ChevronUp size={16} color={Colors.textMuted} />
          : <ChevronDown size={16} color={Colors.textMuted} />
        }
      </TouchableOpacity>
      {expanded ? <View style={styles.accordionBody}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { alignItems: 'center' as const, marginBottom: 20, gap: 6 },
  heroIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 6,
  },
  heroTitle: { fontSize: 24, fontWeight: '700' as const, color: Colors.text },
  heroSubtitle: {
    fontSize: 14, color: Colors.textMuted, textAlign: 'center' as const,
    paddingHorizontal: 20, lineHeight: 20,
  },
  label: {
    fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted,
    marginTop: 16, marginBottom: 8, letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.cardBorder, paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  input: { flex: 1, fontSize: 15, color: Colors.text, padding: 0 },
  chipWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  chipTextActive: { color: '#FFF' },
  presetHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 16,
    marginBottom: 8,
  },
  presetHeaderText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.primary,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  presetList: {
    gap: 8,
  },
  presetPill: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  presetPillActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
  },
  presetPillText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },
  presetPillTextActive: {
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  textArea: {
    backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.cardBorder, padding: 12, minHeight: 100,
    fontSize: 15, color: Colors.text,
  },
  runBtn: {
    marginTop: 20, flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14,
  },
  runBtnDisabled: { opacity: 0.5 },
  runBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
  quotaText: {
    fontSize: 12, color: Colors.textMuted, textAlign: 'center' as const,
    marginTop: 8,
  },
  reopenBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.primary + '10',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  reopenText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },

  // Loading modal
  loadingBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: 24,
  },
  loadingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center' as const,
    minWidth: 260,
    gap: 12,
  },
  loadingIconStack: {
    width: 96,
    height: 96,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  loadingPulse: {
    position: 'absolute' as const,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.primary + '22',
  },
  loadingTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 8,
  },
  loadingStep: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    minHeight: 20,
  },
  loadingDots: {
    flexDirection: 'row' as const,
    gap: 6,
    marginTop: 4,
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.cardBorder,
  },
  loadingDotActive: {
    backgroundColor: Colors.primary,
  },

  // Result modal
  resultContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  resultHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  resultHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  resultHeaderTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  resultCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  resultCard: {
    backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1,
    borderColor: Colors.cardBorder, padding: 14,
  },
  resultSummaryCard: {
    borderColor: Colors.primary + '40',
    backgroundColor: Colors.primary + '08',
  },
  resultCardHeader: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    gap: 8, marginBottom: 10,
  },
  resultCardTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  resultBody: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  codeRow: { marginBottom: 10 },
  codeLabel: { fontSize: 13, fontWeight: '700' as const, color: Colors.primary, marginBottom: 2 },
  codeReq: { fontSize: 13, color: Colors.text, lineHeight: 19 },
  bulletRow: { fontSize: 13, color: Colors.text, lineHeight: 20, marginBottom: 4 },
  disclaimer: {
    fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' as const,
    textAlign: 'center' as const, paddingHorizontal: 20, marginTop: 4,
  },

  // Accordion
  accordionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  accordionCount: {
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 22,
    alignItems: 'center' as const,
  },
  accordionCountText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
  },
  accordionBody: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
  },

  lockedHero: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingBottom: 80,
    gap: 12,
  },
  lockedIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 8,
  },
  lockedTitle: {
    fontSize: 26, fontWeight: '700' as const, color: Colors.text,
    textAlign: 'center' as const,
  },
  lockedBody: {
    fontSize: 15, color: Colors.textMuted,
    textAlign: 'center' as const, lineHeight: 22,
    paddingHorizontal: 12, marginBottom: 12,
  },
  lockedCta: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 28,
  },
  lockedCtaText: {
    fontSize: 16, fontWeight: '700' as const, color: '#FFF',
  },
});

```


---

### `app/(tabs)/summary/index.tsx`

```tsx
import React, { useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ClipboardList, DollarSign, AlertTriangle, CheckCircle2, ChevronRight,
  Receipt, Wrench, Calendar, TrendingUp, FolderOpen,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import ConstructionLoader from '@/components/ConstructionLoader';
import EmptyState from '@/components/EmptyState';
import { formatMoney, formatMoneyShort } from '@/utils/formatters';
import type { Project } from '@/types';

// Summary tab: a bird's-eye "what's happening across all my projects" view.
// Each card collapses the key operational numbers (budget, outstanding invoices,
// open punch items, next milestone) so a GC running 6+ projects doesn't have
// to drill into every project to see what needs attention. Tapping a card
// navigates to the full project-detail screen.

interface ProjectSummaryStats {
  project: Project;
  budget: number;
  outstandingInvoices: number;
  paidInvoices: number;
  openPunchItems: number;
  urgentPunchItems: number;
  nextMilestone: { title: string; date: string } | null;
  pendingChangeOrders: number;
  healthScore: 'good' | 'watch' | 'risk';
  healthReason: string;
}

function daysFromNow(iso: string): number {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

function computeStats(
  project: Project,
  invoices: ReturnType<typeof useProjects>['invoices'],
  punchItems: ReturnType<typeof useProjects>['punchItems'],
  changeOrders: ReturnType<typeof useProjects>['changeOrders'],
): ProjectSummaryStats {
  const projInvoices = invoices.filter(i => i.projectId === project.id);
  const projPunch = punchItems.filter(pi => pi.projectId === project.id);
  const projCOs = changeOrders.filter(co => co.projectId === project.id);

  const outstandingInvoices = projInvoices
    .filter(i => i.status !== 'paid')
    .reduce((sum, i) => sum + Math.max(0, (i.totalDue ?? 0) - (i.amountPaid ?? 0)), 0);
  const paidInvoices = projInvoices
    .reduce((sum, i) => sum + (i.amountPaid ?? 0), 0);

  const openPunch = projPunch.filter(pi => pi.status !== 'closed');
  const urgentPunch = openPunch.filter(pi => pi.priority === 'high');

  const pendingCOs = projCOs.filter(co =>
    co.status === 'submitted' || co.status === 'under_review',
  ).length;

  // Next scheduled milestone: next task marked isMilestone with a future startDay,
  // measured against the schedule.startDate (fall back to project.createdAt).
  let nextMilestone: { title: string; date: string } | null = null;
  if (project.schedule) {
    const startBase = project.schedule.startDate
      ? new Date(project.schedule.startDate)
      : new Date(project.createdAt);
    const candidates = project.schedule.tasks
      .filter(t => t.isMilestone && t.status !== 'done')
      .map(t => {
        const d = new Date(startBase);
        d.setDate(d.getDate() + (t.startDay ?? 0));
        return { title: t.title, dateObj: d };
      })
      .filter(c => c.dateObj.getTime() >= Date.now() - 24 * 60 * 60 * 1000)
      .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
    if (candidates.length > 0) {
      nextMilestone = {
        title: candidates[0].title,
        date: candidates[0].dateObj.toISOString(),
      };
    }
  }

  const budget = project.linkedEstimate?.grandTotal
    ?? project.estimate?.grandTotal
    ?? 0;

  // Health score — simple rollup. Risk = high-priority punch items open OR an
  // invoice is more than 30 days past due. Watch = any open change orders or
  // any overdue invoice under 30 days. Good otherwise.
  let health: ProjectSummaryStats['healthScore'] = 'good';
  let reason = 'On track';
  const overdueInvoices = projInvoices.filter(i => {
    if (i.status === 'paid') return false;
    const dueDiff = daysFromNow(i.dueDate);
    return dueDiff < 0;
  });
  if (urgentPunch.length > 0) {
    health = 'risk';
    reason = `${urgentPunch.length} high-priority punch item${urgentPunch.length === 1 ? '' : 's'}`;
  } else if (overdueInvoices.some(i => daysFromNow(i.dueDate) < -30)) {
    health = 'risk';
    reason = 'Invoice 30+ days overdue';
  } else if (overdueInvoices.length > 0) {
    health = 'watch';
    reason = `${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? '' : 's'}`;
  } else if (pendingCOs > 0) {
    health = 'watch';
    reason = `${pendingCOs} change order${pendingCOs === 1 ? '' : 's'} awaiting approval`;
  }

  return {
    project,
    budget,
    outstandingInvoices,
    paidInvoices,
    openPunchItems: openPunch.length,
    urgentPunchItems: urgentPunch.length,
    nextMilestone,
    pendingChangeOrders: pendingCOs,
    healthScore: health,
    healthReason: reason,
  };
}

export default function SummaryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, invoices, punchItems, changeOrders, isLoading } = useProjects();

  const active = useMemo(
    () => projects.filter(p => p.status !== 'closed' && p.status !== 'completed'),
    [projects],
  );

  const stats = useMemo<ProjectSummaryStats[]>(
    () => active.map(p => computeStats(p, invoices, punchItems, changeOrders)),
    [active, invoices, punchItems, changeOrders],
  );

  const portfolio = useMemo(() => {
    return stats.reduce(
      (acc, s) => ({
        budget: acc.budget + s.budget,
        outstanding: acc.outstanding + s.outstandingInvoices,
        punch: acc.punch + s.openPunchItems,
        risks: acc.risks + (s.healthScore === 'risk' ? 1 : 0),
      }),
      { budget: 0, outstanding: 0, punch: 0, risks: 0 },
    );
  }, [stats]);

  const openProject = useCallback((projectId: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/project-detail', params: { id: projectId } } as any);
  }, [router]);

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ConstructionLoader size="lg" />
      </View>
    );
  }

  if (projects.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.heading}>Summary</Text>
        <EmptyState
          icon={<FolderOpen size={36} color={Colors.primary} />}
          title="No projects yet"
          message="Create a project from the Projects tab and its summary will show up here."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>Summary</Text>
        <Text style={styles.subheading}>
          {active.length} active project{active.length === 1 ? '' : 's'}
        </Text>

        <View style={styles.portfolioRow}>
          <PortfolioStat label="Total Budget" value={formatMoneyShort(portfolio.budget)} tint={Colors.primary} />
          <PortfolioStat label="Outstanding" value={formatMoneyShort(portfolio.outstanding)} tint={Colors.warning} />
          <PortfolioStat label="Open Punch" value={`${portfolio.punch}`} tint={Colors.info} />
          <PortfolioStat label="At Risk" value={`${portfolio.risks}`} tint={portfolio.risks > 0 ? Colors.error : Colors.success} />
        </View>

        {stats.length === 0 ? (
          <View style={styles.emptyCard}>
            <CheckCircle2 size={32} color={Colors.success} />
            <Text style={styles.emptyTitle}>All projects wrapped</Text>
            <Text style={styles.emptyDesc}>
              Every project is marked completed or closed. Kick off a new one to see it here.
            </Text>
          </View>
        ) : (
          stats.map(s => <SummaryCard key={s.project.id} stats={s} onPress={() => openProject(s.project.id)} />)
        )}
      </ScrollView>
    </View>
  );
}

function PortfolioStat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View style={styles.portfolioStat}>
      <Text style={[styles.portfolioValue, { color: tint }]}>{value}</Text>
      <Text style={styles.portfolioLabel}>{label}</Text>
    </View>
  );
}

function SummaryCard({ stats, onPress }: { stats: ProjectSummaryStats; onPress: () => void }) {
  const { project, budget, outstandingInvoices, paidInvoices, openPunchItems,
    urgentPunchItems, nextMilestone, pendingChangeOrders, healthScore, healthReason } = stats;

  const healthTint = healthScore === 'good'
    ? Colors.success
    : healthScore === 'watch' ? Colors.warning : Colors.error;

  const percentBilled = budget > 0 ? Math.min(100, Math.round(((paidInvoices + outstandingInvoices) / budget) * 100)) : 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75} testID={`summary-card-${project.id}`}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{project.name}</Text>
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {project.location || 'No location'} · {project.status.replace('_', ' ')}
          </Text>
        </View>
        <View style={[styles.healthPill, { backgroundColor: healthTint + '18' }]}>
          {healthScore === 'good'
            ? <CheckCircle2 size={12} color={healthTint} />
            : <AlertTriangle size={12} color={healthTint} />}
          <Text style={[styles.healthPillText, { color: healthTint }]}>
            {healthScore === 'good' ? 'On track' : healthScore === 'watch' ? 'Watch' : 'At risk'}
          </Text>
        </View>
      </View>

      <Text style={styles.healthReason} numberOfLines={1}>{healthReason}</Text>

      <View style={styles.statGrid}>
        <Stat icon={DollarSign} label="Budget" value={formatMoneyShort(budget)} tint={Colors.primary} />
        <Stat icon={Receipt} label="Outstanding" value={formatMoney(outstandingInvoices)} tint={outstandingInvoices > 0 ? Colors.warning : Colors.textMuted} />
        <Stat
          icon={Wrench}
          label="Punch"
          value={`${openPunchItems}${urgentPunchItems > 0 ? ` · ${urgentPunchItems}!` : ''}`}
          tint={urgentPunchItems > 0 ? Colors.error : openPunchItems > 0 ? Colors.info : Colors.textMuted}
        />
        <Stat
          icon={ClipboardList}
          label="COs pending"
          value={`${pendingChangeOrders}`}
          tint={pendingChangeOrders > 0 ? Colors.warning : Colors.textMuted}
        />
      </View>

      {budget > 0 && (
        <View style={styles.billedRow}>
          <Text style={styles.billedLabel}>
            <TrendingUp size={11} color={Colors.textMuted} /> Billed {percentBilled}% of budget
          </Text>
          <View style={styles.billedBar}>
            <View style={[styles.billedFill, { width: `${percentBilled}%` }]} />
          </View>
        </View>
      )}

      {nextMilestone && (
        <View style={styles.milestoneRow}>
          <Calendar size={13} color={Colors.primary} />
          <Text style={styles.milestoneText} numberOfLines={1}>
            Next: {nextMilestone.title}
          </Text>
          <Text style={styles.milestoneDate}>
            {new Date(nextMilestone.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      )}

      <View style={styles.cardFooter}>
        <Text style={styles.openDetailText}>Open project</Text>
        <ChevronRight size={16} color={Colors.primary} />
      </View>
    </TouchableOpacity>
  );
}

function Stat({ icon: Icon, label, value, tint }: { icon: typeof DollarSign; label: string; value: string; tint: string }) {
  return (
    <View style={styles.stat}>
      <Icon size={14} color={tint} />
      <Text style={[styles.statValue, { color: tint }]} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 34, fontWeight: '800' as const, color: Colors.text, paddingHorizontal: 20, letterSpacing: -0.5 },
  subheading: { fontSize: 14, color: Colors.textMuted, paddingHorizontal: 20, marginTop: 2, marginBottom: 16 },
  portfolioRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 8, marginBottom: 16 },
  portfolioStat: { flex: 1, minWidth: '46%' as any, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, paddingVertical: 12, paddingHorizontal: 14, gap: 4 },
  portfolioValue: { fontSize: 20, fontWeight: '800' as const, letterSpacing: -0.3 },
  portfolioLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  card: { marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.surface, borderRadius: 18, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.2 },
  cardSubtitle: { fontSize: 12, color: Colors.textMuted, marginTop: 2, textTransform: 'capitalize' as const },
  healthPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  healthPillText: { fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  healthReason: { fontSize: 12, color: Colors.textSecondary, marginTop: -4 },
  statGrid: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, gap: 2, alignItems: 'flex-start' as const },
  statValue: { fontSize: 14, fontWeight: '800' as const },
  statLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '500' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  billedRow: { gap: 6 },
  billedLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' as const },
  billedBar: { height: 5, backgroundColor: Colors.fillTertiary, borderRadius: 3, overflow: 'hidden' as const },
  billedFill: { height: '100%' as any, backgroundColor: Colors.primary, borderRadius: 3 },
  milestoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary + '10', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  milestoneText: { flex: 1, fontSize: 12, fontWeight: '600' as const, color: Colors.text },
  milestoneDate: { fontSize: 12, fontWeight: '700' as const, color: Colors.primary },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: -2 },
  openDetailText: { fontSize: 12, fontWeight: '600' as const, color: Colors.primary },
  emptyCard: { marginHorizontal: 16, padding: 24, alignItems: 'center' as const, gap: 10, backgroundColor: Colors.surface, borderRadius: 18, borderWidth: 1, borderColor: Colors.cardBorder },
  emptyTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' as const, lineHeight: 18 },
});

```


---

### `app/equipment-detail.tsx`

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Truck, Wrench, Clock, Trash2, X, AlertTriangle,
  Save, ChevronDown,
} from 'lucide-react-native';
import Svg, { Rect } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import AIEquipmentAdvice from '@/components/AIEquipmentAdvice';
import type { EquipmentCategory } from '@/types';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  available: { label: 'Available', color: Colors.success },
  in_use: { label: 'In Use', color: Colors.info },
  maintenance: { label: 'Maintenance', color: Colors.warning },
  retired: { label: 'Retired', color: Colors.textMuted },
};

export default function EquipmentDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { equipmentId } = useLocalSearchParams<{ equipmentId: string }>();
  const { equipment, updateEquipment, deleteEquipment, logUtilization, projects } = useProjects();
  const { tier } = useSubscription();

  const equip = useMemo(() => equipment.find(e => e.id === equipmentId) ?? null, [equipment, equipmentId]);

  const [editName, setEditName] = useState(equip?.name ?? '');
  const [editMake, setEditMake] = useState(equip?.make ?? '');
  const [editModel, setEditModel] = useState(equip?.model ?? '');
  const [editDailyRate, setEditDailyRate] = useState(equip?.dailyRate?.toString() ?? '');
  const [editStatus, setEditStatus] = useState(equip?.status ?? 'available');
  const [editCategory, _setEditCategory] = useState<EquipmentCategory>(equip?.category ?? 'other');
  const [editSerialNumber, setEditSerialNumber] = useState(equip?.serialNumber ?? '');
  const [editNotes, setEditNotes] = useState(equip?.notes ?? '');
  const [editProjectId, setEditProjectId] = useState(equip?.currentProjectId ?? '');
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [logHours, setLogHours] = useState('8');
  const [logOperator, setLogOperator] = useState('');
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  const last30Days = useMemo(() => {
    if (!equip) return [];
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 86400000;
    return equip.utilizationLog
      .filter(u => new Date(u.date).getTime() >= thirtyDaysAgo)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [equip]);

  const maxHours = useMemo(() => Math.max(...last30Days.map(u => u.hoursUsed), 1), [last30Days]);

  const handleSave = useCallback(() => {
    if (!equip || !editName.trim()) {
      Alert.alert('Missing Name', 'Please enter an equipment name.');
      return;
    }
    updateEquipment(equip.id, {
      name: editName.trim(),
      make: editMake.trim(),
      model: editModel.trim(),
      dailyRate: parseFloat(editDailyRate) || 0,
      status: editStatus,
      category: editCategory,
      serialNumber: editSerialNumber.trim() || undefined,
      notes: editNotes.trim() || undefined,
      currentProjectId: editProjectId || undefined,
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Saved', 'Equipment updated successfully.');
  }, [equip, editName, editMake, editModel, editDailyRate, editStatus, editCategory, editSerialNumber, editNotes, editProjectId, updateEquipment]);

  const handleDelete = useCallback(() => {
    if (!equip) return;
    Alert.alert('Delete Equipment', `Delete ${equip.name}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          deleteEquipment(equip.id);
          router.back();
        },
      },
    ]);
  }, [equip, deleteEquipment, router]);

  const handleLogUse = useCallback(() => {
    if (!equip) return;
    const hours = parseFloat(logHours) || 0;
    if (hours <= 0) {
      Alert.alert('Invalid Hours', 'Please enter valid hours.');
      return;
    }
    logUtilization({
      equipmentId: equip.id,
      projectId: editProjectId || '',
      date: new Date().toISOString(),
      hoursUsed: hours,
      operatorName: logOperator.trim() || undefined,
    });
    setShowLogModal(false);
    setLogHours('8');
    setLogOperator('');
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [equip, logHours, logOperator, editProjectId, logUtilization]);

  if (!equip) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <Text style={styles.emptyText}>Equipment not found</Text>
      </View>
    );
  }

  const statusConfig = STATUS_CONFIG[equip.status] ?? STATUS_CONFIG.available;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Stack.Screen options={{
        title: equip.name,
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100, padding: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerCard}>
          <View style={styles.equipIconWrap}>
            <Truck size={28} color={Colors.primary} />
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + '20' }]}>
            <Text style={[styles.statusBadgeText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
          </View>
          <Text style={styles.rateText}>${equip.dailyRate}/day</Text>
        </View>

        <Text style={styles.fieldLabel}>Name *</Text>
        <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Equipment name" placeholderTextColor={Colors.textMuted} />

        <View style={styles.rowFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Make</Text>
            <TextInput style={styles.input} value={editMake} onChangeText={setEditMake} placeholder="Make" placeholderTextColor={Colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Model</Text>
            <TextInput style={styles.input} value={editModel} onChangeText={setEditModel} placeholder="Model" placeholderTextColor={Colors.textMuted} />
          </View>
        </View>

        <Text style={styles.fieldLabel}>Serial Number</Text>
        <TextInput style={styles.input} value={editSerialNumber} onChangeText={setEditSerialNumber} placeholder="Optional" placeholderTextColor={Colors.textMuted} />

        <Text style={styles.fieldLabel}>Daily Rate ($)</Text>
        <TextInput style={styles.input} value={editDailyRate} onChangeText={setEditDailyRate} placeholder="350" placeholderTextColor={Colors.textMuted} keyboardType="numeric" />

        <Text style={styles.fieldLabel}>Status</Text>
        <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowStatusPicker(!showStatusPicker)}>
          <View style={[styles.statusDot, { backgroundColor: (STATUS_CONFIG[editStatus] ?? STATUS_CONFIG.available).color }]} />
          <Text style={styles.pickerBtnText}>{(STATUS_CONFIG[editStatus] ?? STATUS_CONFIG.available).label}</Text>
          <ChevronDown size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        {showStatusPicker && (
          <View style={styles.optionsRow}>
            {Object.entries(STATUS_CONFIG).map(([key, val]) => (
              <TouchableOpacity
                key={key}
                style={[styles.optionChip, editStatus === key && { backgroundColor: val.color }]}
                onPress={() => { setEditStatus(key as any); setShowStatusPicker(false); }}
              >
                <Text style={[styles.optionChipText, editStatus === key && { color: '#fff' }]}>{val.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.fieldLabel}>Assigned Project</Text>
        <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowProjectPicker(!showProjectPicker)}>
          <Text style={styles.pickerBtnText}>
            {editProjectId ? (projects.find(p => p.id === editProjectId)?.name ?? 'Unknown') : 'None'}
          </Text>
          <ChevronDown size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        {showProjectPicker && (
          <View style={styles.projectList}>
            <TouchableOpacity style={styles.projectItem} onPress={() => { setEditProjectId(''); setShowProjectPicker(false); }}>
              <Text style={styles.projectItemText}>None</Text>
            </TouchableOpacity>
            {projects.map(p => (
              <TouchableOpacity key={p.id} style={styles.projectItem} onPress={() => { setEditProjectId(p.id); setShowProjectPicker(false); }}>
                <Text style={[styles.projectItemText, editProjectId === p.id && { color: Colors.primary, fontWeight: '600' as const }]}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.fieldLabel}>Notes</Text>
        <TextInput
          style={[styles.input, { minHeight: 70, paddingTop: 12 }]}
          value={editNotes}
          onChangeText={setEditNotes}
          placeholder="Notes..."
          placeholderTextColor={Colors.textMuted}
          multiline
          textAlignVertical="top"
        />

        <Text style={styles.sectionTitle}>Maintenance Schedule</Text>
        {equip.maintenanceSchedule.length === 0 ? (
          <Text style={styles.noDataText}>No maintenance items scheduled.</Text>
        ) : (
          equip.maintenanceSchedule.map((item) => (
            <View key={item.id} style={[styles.maintCard, item.isOverdue && styles.maintCardOverdue]}>
              <View style={styles.maintHeader}>
                <Wrench size={14} color={item.isOverdue ? Colors.error : Colors.textSecondary} />
                <Text style={styles.maintDesc}>{item.description}</Text>
                {item.isOverdue && <AlertTriangle size={14} color={Colors.error} />}
              </View>
              <Text style={styles.maintDetail}>
                Every {item.intervalDays} days | Next: {new Date(item.nextDue).toLocaleDateString()}
              </Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Utilization (Last 30 Days)</Text>
        {last30Days.length === 0 ? (
          <Text style={styles.noDataText}>No utilization logged yet.</Text>
        ) : (
          <View style={styles.chartCard}>
            <Svg width={last30Days.length * 20 + 20} height={100}>
              {last30Days.map((entry, i) => {
                const barHeight = (entry.hoursUsed / maxHours) * 70;
                return (
                  <Rect
                    key={entry.id}
                    x={i * 20 + 10}
                    y={90 - barHeight}
                    width={14}
                    height={barHeight}
                    rx={4}
                    fill={Colors.primary}
                    opacity={0.8}
                  />
                );
              })}
            </Svg>
          </View>
        )}

        <TouchableOpacity style={styles.logBtn} onPress={() => setShowLogModal(true)} activeOpacity={0.7}>
          <Clock size={16} color={Colors.primary} />
          <Text style={styles.logBtnText}>Log Today's Use</Text>
        </TouchableOpacity>

        {equip && (
          <AIEquipmentAdvice
            equipment={equip}
            subscriptionTier={tier as any}
          />
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-equipment">
          <Save size={18} color="#fff" />
          <Text style={styles.saveBtnText}>Save Changes</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.7}>
          <Trash2 size={16} color={Colors.error} />
          <Text style={styles.deleteBtnText}>Delete Equipment</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showLogModal} transparent animationType="fade" onRequestClose={() => setShowLogModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log Usage</Text>
              <TouchableOpacity onPress={() => setShowLogModal(false)}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Hours Used</Text>
            <TextInput style={styles.input} value={logHours} onChangeText={setLogHours} keyboardType="numeric" placeholder="8" placeholderTextColor={Colors.textMuted} />
            <Text style={styles.fieldLabel}>Operator Name</Text>
            <TextInput style={styles.input} value={logOperator} onChangeText={setLogOperator} placeholder="Optional" placeholderTextColor={Colors.textMuted} />
            <TouchableOpacity style={styles.saveBtn} onPress={handleLogUse} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>Log Usage</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  headerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  equipIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  rateText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  rowFields: {
    flexDirection: 'row',
    gap: 10,
  },
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  pickerBtnText: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
  },
  optionChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  projectList: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginTop: 6,
    overflow: 'hidden',
    maxHeight: 200,
  },
  projectItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  projectItemText: {
    fontSize: 14,
    color: Colors.text,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 24,
    marginBottom: 12,
  },
  noDataText: {
    fontSize: 14,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  maintCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 4,
  },
  maintCardOverdue: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
  },
  maintHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  maintDesc: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  maintDetail: {
    fontSize: 12,
    color: Colors.textSecondary,
    paddingLeft: 22,
  },
  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  logBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    marginTop: 8,
  },
  logBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 24,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  saveBtnText: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: '#fff',
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 12,
  },
  deleteBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.error,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    gap: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
});

```


---

### `app/integrations.tsx`

```tsx
import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  Platform, Alert, Linking,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Plug, Check, Clock, Lock, ExternalLink, ChevronRight,
  Wifi, WifiOff, Search, X,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { MOCK_INTEGRATIONS, INTEGRATION_CATEGORIES } from '@/mocks/integrations';
import type { Integration, IntegrationCategory } from '@/types';

function IntegrationCard({ item, onConnect }: { item: Integration; onConnect: (item: Integration) => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const statusConfig = useMemo(() => {
    switch (item.status) {
      case 'connected':
        return { label: 'Connected', color: '#2E7D32', bgColor: '#E8F5E9', icon: Check };
      case 'disconnected':
        return { label: item.tier === 'link' ? 'Open' : 'Connect', color: Colors.primary, bgColor: Colors.primary + '14', icon: Plug };
      case 'coming_soon':
        return { label: 'Coming Soon', color: '#9E9E9E', bgColor: '#F5F5F5', icon: Lock };
      case 'error':
        return { label: 'Error', color: '#C62828', bgColor: '#FFEBEE', icon: WifiOff };
      default:
        return { label: 'Connect', color: Colors.primary, bgColor: Colors.primary + '14', icon: Plug };
    }
  }, [item.status, item.tier]);

  const StatusIcon = statusConfig.icon;

  return (
    <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={() => onConnect(item)}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.cardInner}
        disabled={item.status === 'coming_soon'}
      >
        <View style={[styles.cardIcon, { backgroundColor: item.iconBg }]}>
          <Text style={[styles.cardIconLetter, { color: item.iconColor }]}>
            {item.name.charAt(0)}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <View style={styles.cardNameRow}>
            <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
            {item.tier === 'link' && (
              <ExternalLink size={12} color={Colors.textMuted} style={{ marginLeft: 4 }} />
            )}
          </View>
          <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
          {item.connectedAt && (
            <Text style={styles.cardConnectedDate}>
              Since {new Date(item.connectedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            </Text>
          )}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor }]}>
          <StatusIcon size={12} color={statusConfig.color} />
          <Text style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function IntegrationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [integrations, setIntegrations] = useState<Integration[]>(MOCK_INTEGRATIONS);
  const [paywallFeature, setPaywallFeature] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = integrations;
    if (selectedCategory !== 'all') {
      result = result.filter(i => i.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [integrations, selectedCategory, searchQuery]);

  const connectedCount = useMemo(() => integrations.filter(i => i.status === 'connected').length, [integrations]);
  const availableCount = useMemo(() => integrations.filter(i => i.status !== 'coming_soon').length, [integrations]);

  const handleConnect = useCallback((item: Integration) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Deep integrations (accounting/CRM sync like QuickBooks) are Business-tier only.
    const nameLower = item.name.toLowerCase();
    const isQuickbooks = nameLower.includes('quickbooks') || nameLower.includes('quick books');
    if (item.status !== 'connected' && (isQuickbooks || item.tier === 'deep') && !canAccess('quickbooks_sync')) {
      setPaywallFeature(item.name);
      return;
    }

    if (item.status === 'connected') {
      Alert.alert(
        `Disconnect ${item.name}?`,
        'This will remove the connection. You can reconnect anytime.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disconnect',
            style: 'destructive',
            onPress: () => {
              setIntegrations(prev =>
                prev.map(i => i.id === item.id ? { ...i, status: 'disconnected' as const, connectedAt: undefined } : i)
              );
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            },
          },
        ]
      );
      return;
    }

    if (item.externalUrl) {
      Linking.openURL(item.externalUrl).catch(() => {
        Alert.alert('Error', 'Could not open the link.');
      });
      return;
    }

    if (item.tier === 'deep') {
      Alert.alert(
        `Connect ${item.name}`,
        'This will open a secure authentication flow. Once connected, data will sync automatically.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Connect',
            onPress: () => {
              setIntegrations(prev =>
                prev.map(i => i.id === item.id ? { ...i, status: 'connected' as const, connectedAt: new Date().toISOString() } : i)
              );
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Connected!', `${item.name} has been connected successfully.`);
            },
          },
        ]
      );
    }
  }, [canAccess]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Integrations', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <View style={styles.heroIconWrap}>
            <Wifi size={28} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Integrations Hub</Text>
          <Text style={styles.heroSubtitle}>Connect your favorite tools and services</Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatValue, { color: Colors.primary }]}>{connectedCount}</Text>
              <Text style={styles.heroStatLabel}>Connected</Text>
            </View>
            <View style={[styles.heroStatDivider]} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{availableCount}</Text>
              <Text style={styles.heroStatLabel}>Available</Text>
            </View>
            <View style={[styles.heroStatDivider]} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatValue, { color: '#9E9E9E' }]}>
                {integrations.filter(i => i.status === 'coming_soon').length}
              </Text>
              <Text style={styles.heroStatLabel}>Coming Soon</Text>
            </View>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRow}
        >
          {INTEGRATION_CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat.id}
              style={[styles.categoryChip, selectedCategory === cat.id && styles.categoryChipActive]}
              onPress={() => {
                setSelectedCategory(cat.id);
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.categoryChipText, selectedCategory === cat.id && styles.categoryChipTextActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Search size={32} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No integrations found</Text>
            <Text style={styles.emptyDesc}>Try a different category or search term</Text>
          </View>
        ) : (
          <View style={styles.listSection}>
            {filtered.filter(i => i.status === 'connected').length > 0 && (
              <>
                <Text style={styles.sectionLabel}>ACTIVE CONNECTIONS</Text>
                {filtered.filter(i => i.status === 'connected').map(item => (
                  <IntegrationCard key={item.id} item={item} onConnect={handleConnect} />
                ))}
              </>
            )}

            {filtered.filter(i => i.status === 'disconnected' || i.status === 'error').length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 12 }]}>AVAILABLE</Text>
                {filtered.filter(i => i.status === 'disconnected' || i.status === 'error').map(item => (
                  <IntegrationCard key={item.id} item={item} onConnect={handleConnect} />
                ))}
              </>
            )}

            {filtered.filter(i => i.status === 'coming_soon').length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 12 }]}>COMING SOON</Text>
                {filtered.filter(i => i.status === 'coming_soon').map(item => (
                  <IntegrationCard key={item.id} item={item} onConnect={handleConnect} />
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>
      {paywallFeature ? (
        <Paywall
          visible={true}
          feature={`${paywallFeature} Sync`}
          requiredTier="business"
          onClose={() => setPaywallFeature(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  heroSection: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 6,
  },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  heroStats: {
    flexDirection: 'row',
    marginTop: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  heroStat: { alignItems: 'center', flex: 1 },
  heroStatValue: { fontSize: 22, fontWeight: '700' as const, color: Colors.text },
  heroStatLabel: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  heroStatDivider: { width: 1, backgroundColor: Colors.borderLight },
  categoryRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 16,
  },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  categoryChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  categoryChipTextActive: {
    color: '#fff',
  },
  listSection: {
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  card: {
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconLetter: {
    fontSize: 20,
    fontWeight: '700' as const,
  },
  cardInfo: { flex: 1, gap: 2 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center' },
  cardName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  cardDesc: { fontSize: 12, color: Colors.textSecondary, lineHeight: 16 },
  cardConnectedDate: { fontSize: 11, color: Colors.primary, fontWeight: '500' as const, marginTop: 2 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusText: { fontSize: 11, fontWeight: '600' as const },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textSecondary },
});

```


---

### `components/AIEquipmentAdvice.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, RefreshCw, TrendingUp, ArrowRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  analyzeEquipmentRentVsBuy, getCachedResult, setCachedResult,
  type EquipmentAdviceResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { Equipment } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';

interface Props {
  equipment: Equipment;
  subscriptionTier: SubscriptionTierKey;
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

const REC_STYLES = {
  rent: { label: 'Keep Renting', icon: '🔄', color: Colors.info, bg: Colors.infoLight },
  buy: { label: 'Buy It', icon: '🏷️', color: Colors.success, bg: Colors.successLight },
  lease: { label: 'Consider Leasing', icon: '📋', color: Colors.warning, bg: Colors.warningLight },
} as const;

export default React.memo(function AIEquipmentAdvice({ equipment, subscriptionTier }: Props) {
  const [result, setResult] = useState<EquipmentAdviceResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleAnalyze = useCallback(async () => {
    if (isLoading) return;

    const cacheKey = `equip_advice_${equipment.id}`;
    const cached = await getCachedResult<EquipmentAdviceResult>(cacheKey, SEVEN_DAYS);
    if (cached) {
      setResult(cached);
      return;
    }

    const limit = await checkAILimit(subscriptionTier, 'fast');
    if (!limit.allowed) {
      Alert.alert('AI Limit Reached', limit.message ?? 'Try again tomorrow.');
      return;
    }

    setIsLoading(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const uniqueProjects = new Set(equipment.utilizationLog.map(u => u.projectId)).size;
      const avgDays = equipment.utilizationLog.length > 0
        ? Math.round(equipment.utilizationLog.reduce((s, u) => s + u.hoursUsed, 0) / (uniqueProjects || 1) / 8)
        : 12;

      const data = await analyzeEquipmentRentVsBuy(equipment, Math.max(uniqueProjects, 2), avgDays);
      await recordAIUsage('fast');
      await setCachedResult(cacheKey, data);
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('[AI Equipment] Analysis failed:', err);
      Alert.alert('AI Error', 'Could not analyze equipment. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, equipment, subscriptionTier]);

  if (!result) {
    return (
      <TouchableOpacity style={styles.triggerBtn} onPress={handleAnalyze} activeOpacity={0.7} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Sparkles size={16} color={Colors.primary} />
        )}
        <Text style={styles.triggerText}>{isLoading ? 'Analyzing...' : 'AI Rent vs Buy Advice'}</Text>
      </TouchableOpacity>
    );
  }

  const rec = REC_STYLES[result.recommendation] ?? REC_STYLES.rent;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Sparkles size={12} color={Colors.primary} />
        <Text style={styles.headerTitle}>Rent vs Buy: {equipment.name}</Text>
        <Text style={styles.aiTag}>AI-generated</Text>
      </View>

      <View style={[styles.recBadge, { backgroundColor: rec.bg }]}>
        <Text style={styles.recIcon}>{rec.icon}</Text>
        <Text style={[styles.recLabel, { color: rec.color }]}>RECOMMENDATION: {rec.label.toUpperCase()}</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Annual rental</Text>
          <Text style={styles.statValue}>${result.annualRentalCost.toLocaleString()}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Purchase price</Text>
          <Text style={styles.statValue}>{result.purchasePrice}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Break-even</Text>
          <Text style={styles.statValue}>{result.breakEvenProjects}+ projects/yr</Text>
        </View>
      </View>

      <Text style={styles.reasoning}>{result.reasoning}</Text>

      <View style={styles.reconsiderRow}>
        <ArrowRight size={12} color={Colors.textSecondary} />
        <Text style={styles.reconsiderText}>{result.reconsiderWhen}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  triggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
  },
  triggerText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
  },
  aiTag: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  recIcon: {
    fontSize: 18,
  },
  recLabel: {
    fontSize: 13,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  statItem: {
    flex: 1,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    gap: 2,
  },
  statLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  statValue: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center' as const,
  },
  reasoning: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 19,
    marginBottom: 8,
  },
  reconsiderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 8,
    padding: 10,
  },
  reconsiderText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 17,
    fontStyle: 'italic' as const,
  },
});

```


---

### `components/AIHomeBriefing.tsx`

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Animated,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, AlertTriangle, CheckCircle2, ChevronRight, TrendingDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  generateHomeBriefing, getCachedResult, setCachedResult,
  type HomeBriefingResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage, getAIUsageStats } from '@/utils/aiRateLimiter';
import type { Project, Invoice } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';

interface Props {
  projects: Project[];
  invoices: Invoice[];
  subscriptionTier: SubscriptionTierKey;
  onViewFull?: () => void;
}

const FOUR_HOURS = 4 * 60 * 60 * 1000;

const STATUS_ICONS = {
  on_track: { Icon: CheckCircle2, color: '#34C759', bg: '#E8F5E9' },
  at_risk: { Icon: AlertTriangle, color: '#FF9500', bg: '#FFF3E0' },
  behind: { Icon: TrendingDown, color: '#FF3B30', bg: '#FFF0EF' },
  ahead: { Icon: CheckCircle2, color: '#30B0C7', bg: '#E1F5FA' },
} as const;

export default React.memo(function AIHomeBriefing({ projects, invoices, subscriptionTier, onViewFull }: Props) {
  const [result, setResult] = useState<HomeBriefingResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [usageText, setUsageText] = useState('');
  const shimmerAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLoading) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(shimmerAnim, { toValue: 0, duration: 1000, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [isLoading, shimmerAnim]);

  const loadUsage = useCallback(async () => {
    const stats = await getAIUsageStats(subscriptionTier);
    setUsageText(`${stats.used}/${stats.limit} today`);
  }, [subscriptionTier]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const fetchBriefing = useCallback(async () => {
    if (projects.length === 0 || isLoading) return;

    const today = new Date().toISOString().split('T')[0];
    const cacheKey = `home_briefing_${today}`;
    const cached = await getCachedResult<HomeBriefingResult>(cacheKey, FOUR_HOURS);
    if (cached) {
      setResult(cached);
      return;
    }

    const limit = await checkAILimit(subscriptionTier, 'fast');
    if (!limit.allowed) return;

    setIsLoading(true);
    try {
      const data = await generateHomeBriefing(projects, invoices);
      await recordAIUsage('fast');
      await setCachedResult(cacheKey, data);
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      void loadUsage();
    } catch (err) {
      console.log('[AI Briefing] Failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [projects, invoices, subscriptionTier, isLoading, loadUsage]);

  useEffect(() => {
    if (projects.length > 0) {
      void fetchBriefing();
    }
  }, [projects.length]);

  if (projects.length === 0) return null;

  if (isLoading && !result) {
    const shimmerOpacity = shimmerAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.4, 0.8],
    });
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Sparkles size={14} color={Colors.primary} />
            <Text style={styles.headerTitle}>MAGE AI Daily Briefing</Text>
          </View>
        </View>
        <Animated.View style={[styles.skeletonLine, { opacity: shimmerOpacity }]} />
        <Animated.View style={[styles.skeletonLine, styles.skeletonShort, { opacity: shimmerOpacity }]} />
        <Animated.View style={[styles.skeletonLine, styles.skeletonMedium, { opacity: shimmerOpacity }]} />
      </View>
    );
  }

  if (!result) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Sparkles size={14} color={Colors.primary} />
          <Text style={styles.headerTitle}>MAGE AI Daily Briefing</Text>
        </View>
        <Text style={styles.aiLabel}>AI-generated</Text>
      </View>

      <Text style={styles.briefingText}>{result.briefing}</Text>

      {(result.projects ?? []).map((proj, idx) => {
        const config = STATUS_ICONS[proj.status] ?? STATUS_ICONS.on_track;
        const StatusIcon = config.Icon;
        return (
          <View key={idx} style={styles.projectRow}>
            <View style={[styles.statusDot, { backgroundColor: config.bg }]}>
              <StatusIcon size={12} color={config.color} />
            </View>
            <View style={styles.projectInfo}>
              <Text style={styles.projectName}>{proj.name}</Text>
              <Text style={styles.projectInsight}>{proj.keyInsight}</Text>
              {proj.actionItem ? (
                <Text style={styles.actionItem}>→ {proj.actionItem}</Text>
              ) : null}
            </View>
          </View>
        );
      })}

      {(result.urgentItems ?? []).length > 0 && (
        <View style={styles.urgentSection}>
          {result.urgentItems.map((item, idx) => (
            <View key={idx} style={styles.urgentRow}>
              <AlertTriangle size={12} color="#FF3B30" />
              <Text style={styles.urgentText}>{item}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.footer}>
        {onViewFull ? (
          <TouchableOpacity
            onPress={onViewFull}
            style={styles.viewFullBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.viewFullText}>View Full Analysis</Text>
            <ChevronRight size={14} color={Colors.primary} />
          </TouchableOpacity>
        ) : <View />}
        <Text style={styles.usageText}>{usageText}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 0.2,
  },
  aiLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  briefingText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
    marginBottom: 12,
  },
  projectRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
  },
  statusDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  projectInfo: {
    flex: 1,
    gap: 2,
  },
  projectName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  projectInsight: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  actionItem: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '500' as const,
    marginTop: 2,
  },
  urgentSection: {
    backgroundColor: '#FFF0EF',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    gap: 6,
  },
  urgentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  urgentText: {
    fontSize: 13,
    color: '#D32F2F',
    flex: 1,
    lineHeight: 18,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
  },
  viewFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewFullText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  usageText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  skeletonLine: {
    height: 12,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 6,
    marginBottom: 8,
    width: '100%',
  },
  skeletonShort: {
    width: '60%',
  },
  skeletonMedium: {
    width: '80%',
  },
});

```


---

### `components/AIProjectReport.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
  ScrollView, Modal, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Sparkles, X, CheckCircle2, AlertTriangle, Target, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  generateProjectReport, getCachedResult, setCachedResult,
  type ProjectReportResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { Project, Invoice, ChangeOrder } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';

interface Props {
  project: Project;
  invoices: Invoice[];
  changeOrders: ChangeOrder[];
  subscriptionTier: SubscriptionTierKey;
}

const TWO_HOURS = 2 * 60 * 60 * 1000;

export default React.memo(function AIProjectReport({ project, invoices, changeOrders, subscriptionTier }: Props) {
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<ProjectReportResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (isLoading) return;

    const cacheKey = `proj_report_${project.id}`;
    const cached = await getCachedResult<ProjectReportResult>(cacheKey, TWO_HOURS);
    if (cached) {
      setResult(cached);
      setShowModal(true);
      return;
    }

    const limit = await checkAILimit(subscriptionTier, 'smart');
    if (!limit.allowed) {
      Alert.alert('AI Limit Reached', limit.message ?? 'Try again tomorrow.');
      return;
    }

    setIsLoading(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await generateProjectReport(project, invoices, changeOrders);
      await recordAIUsage('smart');
      await setCachedResult(cacheKey, data);
      setResult(data);
      setShowModal(true);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('[AI Report] Generation failed:', err);
      Alert.alert('AI Error', 'Could not generate report. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, project, invoices, changeOrders, subscriptionTier]);

  return (
    <>
      <TouchableOpacity style={styles.triggerBtn} onPress={handleGenerate} activeOpacity={0.7} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Sparkles size={16} color={Colors.primary} />
        )}
        <Text style={styles.triggerText}>{isLoading ? 'Generating Report...' : 'AI Project Report'}</Text>
      </TouchableOpacity>

      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => setShowModal(false)}
      >
        <View style={[styles.modalContainer, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={styles.headerLeft}>
              <Sparkles size={16} color={Colors.primary} />
              <Text style={styles.modalTitle}>Project Status Report</Text>
            </View>
            <TouchableOpacity onPress={() => setShowModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {result && (
            <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 30 }]}>
              <View style={styles.projectBanner}>
                <Text style={styles.projectName}>{project.name}</Text>
                <Text style={styles.projectMeta}>{project.type} · {project.location}</Text>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Executive Summary</Text>
                <Text style={styles.sectionText}>{result.executiveSummary}</Text>
              </View>

              <View style={styles.twoCol}>
                <View style={[styles.statusCard, { borderLeftColor: Colors.info }]}>
                  <FileText size={14} color={Colors.info} />
                  <Text style={styles.statusLabel}>Schedule Status</Text>
                  <Text style={styles.statusText}>{result.scheduleStatus}</Text>
                </View>
                <View style={[styles.statusCard, { borderLeftColor: Colors.success }]}>
                  <FileText size={14} color={Colors.success} />
                  <Text style={styles.statusLabel}>Budget Status</Text>
                  <Text style={styles.statusText}>{result.budgetStatus}</Text>
                </View>
              </View>

              {(result.keyAccomplishments ?? []).length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Key Accomplishments</Text>
                  {(result.keyAccomplishments ?? []).map((item, idx) => (
                    <View key={idx} style={styles.listRow}>
                      <CheckCircle2 size={13} color={Colors.success} />
                      <Text style={styles.listText}>{item}</Text>
                    </View>
                  ))}
                </View>
              )}

              {(result.issuesAndRisks ?? []).length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Issues & Risks</Text>
                  {(result.issuesAndRisks ?? []).map((item, idx) => (
                    <View key={idx} style={styles.listRow}>
                      <AlertTriangle size={13} color={Colors.warning} />
                      <Text style={styles.listText}>{item}</Text>
                    </View>
                  ))}
                </View>
              )}

              {(result.nextMilestones ?? []).length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Next Milestones</Text>
                  {(result.nextMilestones ?? []).map((item, idx) => (
                    <View key={idx} style={styles.listRow}>
                      <Target size={13} color={Colors.primary} />
                      <Text style={styles.listText}>{item}</Text>
                    </View>
                  ))}
                </View>
              )}

              {(result.recommendations ?? []).length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Recommendations</Text>
                  {(result.recommendations ?? []).map((item, idx) => (
                    <View key={idx} style={styles.listRow}>
                      <Sparkles size={13} color={Colors.primary} />
                      <Text style={[styles.listText, { color: Colors.primary, fontWeight: '500' as const }]}>{item}</Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.disclaimer}>Generated by MAGE AI · AI-generated</Text>
            </ScrollView>
          )}
        </View>
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  triggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
  },
  triggerText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  projectBanner: {
    backgroundColor: Colors.primary + '0A',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
  },
  projectName: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  projectMeta: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  section: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sectionText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 21,
  },
  twoCol: {
    flexDirection: 'row',
    gap: 10,
  },
  statusCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    gap: 4,
  },
  statusLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
  },
  statusText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  listText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
    flex: 1,
  },
  disclaimer: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});

```


---

### `components/AIWeeklySummary.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Sparkles, X, TrendingUp, AlertTriangle, CheckCircle2, Share2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { generateWeeklySummary, type WeeklySummaryResult } from '@/utils/aiService';
import type { Project } from '@/types';

interface Props {
  projects: Project[];
  visible: boolean;
  onClose: () => void;
}

const STATUS_CONFIG = {
  on_track: { icon: CheckCircle2, color: '#34C759', label: 'ON TRACK', bg: '#E8F5E9' },
  at_risk: { icon: AlertTriangle, color: '#FF9500', label: 'AT RISK', bg: '#FFF3E0' },
  behind: { icon: AlertTriangle, color: '#FF3B30', label: 'BEHIND', bg: '#FFF0EF' },
  ahead: { icon: TrendingUp, color: '#007AFF', label: 'AHEAD', bg: '#EBF3FF' },
} as const;

function formatCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export default function AIWeeklySummary({ projects, visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<WeeklySummaryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (isLoading || projects.length === 0) return;
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await generateWeeklySummary(projects);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(data);
    } catch (err) {
      console.error('[AI Weekly] Failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, projects]);

  React.useEffect(() => {
    if (visible && !result && !isLoading && projects.length > 0) {
      handleGenerate();
    }
  }, [visible, result, isLoading, projects.length, handleGenerate]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Sparkles size={18} color={Colors.primary} />
            <Text style={styles.headerTitle}>Weekly Executive Summary</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {isLoading && !result ? (
          <View style={styles.loadingState}>
            <ConstructionLoader size="lg" label="Analyzing your portfolio..." />
            <Text style={styles.loadingSubtext}>Reviewing {projects.length} project(s)</Text>
          </View>
        ) : result ? (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <View style={styles.weekBadge}>
              <Text style={styles.weekText}>{result.weekRange}</Text>
            </View>

            <View style={styles.overviewCard}>
              <Text style={styles.sectionLabel}>PORTFOLIO OVERVIEW</Text>
              <View style={styles.overviewGrid}>
                <View style={styles.overviewItem}>
                  <Text style={styles.overviewValue}>{result.portfolioSummary?.totalProjects ?? 0}</Text>
                  <Text style={styles.overviewLabel}>Active</Text>
                </View>
                <View style={styles.overviewItem}>
                  <Text style={[styles.overviewValue, { color: Colors.success }]}>{result.portfolioSummary?.onTrack ?? 0}</Text>
                  <Text style={styles.overviewLabel}>On Track</Text>
                </View>
                <View style={styles.overviewItem}>
                  <Text style={[styles.overviewValue, { color: Colors.warning }]}>{result.portfolioSummary?.atRisk ?? 0}</Text>
                  <Text style={styles.overviewLabel}>At Risk</Text>
                </View>
                <View style={styles.overviewItem}>
                  <Text style={styles.overviewValue}>{result.portfolioSummary?.tasksCompletedThisWeek ?? 0}</Text>
                  <Text style={styles.overviewLabel}>Completed</Text>
                </View>
              </View>
              <View style={styles.combinedValue}>
                <Text style={styles.combinedLabel}>Combined portfolio value</Text>
                <Text style={styles.combinedAmount}>{formatCurrency(result.portfolioSummary?.combinedValue ?? 0)}</Text>
              </View>
            </View>

            {(result.projects ?? []).map((proj, idx) => {
              const config = STATUS_CONFIG[proj.status] ?? STATUS_CONFIG.on_track;
              const StatusIcon = config.icon;
              return (
                <View key={idx} style={styles.projectCard}>
                  <View style={styles.projectHeader}>
                    <Text style={styles.projectName}>{proj.name}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
                      <StatusIcon size={12} color={config.color} />
                      <Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text>
                    </View>
                  </View>

                  <View style={styles.progressRow}>
                    <Text style={styles.progressLabel}>Progress:</Text>
                    <Text style={styles.progressValue}>
                      {proj.progressStart}% → {proj.progressEnd}%{' '}
                      <Text style={{ color: Colors.success }}>
                        (+{proj.progressEnd - proj.progressStart}% this week)
                      </Text>
                    </Text>
                  </View>

                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${Math.min(proj.progressEnd, 100)}%` }]} />
                  </View>

                  <Text style={styles.keyLabel}>Key: {proj.keyAccomplishment}</Text>
                  {proj.primaryRisk !== 'None' && (
                    <Text style={styles.riskLabel}>Risk: {proj.primaryRisk}</Text>
                  )}
                  {proj.recommendation ? (
                    <Text style={styles.recLabel}>→ {proj.recommendation}</Text>
                  ) : null}
                </View>
              );
            })}

            {result.overallRecommendation ? (
              <View style={styles.overallRec}>
                <Sparkles size={14} color={Colors.primary} />
                <Text style={styles.overallRecText}>{result.overallRecommendation}</Text>
              </View>
            ) : null}

            <Text style={styles.aiDisclaimer}>Generated by MAGE AI</Text>
          </ScrollView>
        ) : (
          <View style={styles.loadingState}>
            <Text style={styles.loadingText}>No projects to analyze</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  loadingSubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  weekBadge: {
    alignSelf: 'center',
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
  },
  weekText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  overviewCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    letterSpacing: 1,
  },
  overviewGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  overviewItem: {
    flex: 1,
    alignItems: 'center',
    padding: 10,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 10,
  },
  overviewValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  overviewLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  combinedValue: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
  },
  combinedLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  combinedAmount: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  projectCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
    gap: 8,
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  projectName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 4,
  },
  progressLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  progressValue: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '600' as const,
  },
  progressBar: {
    height: 6,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 3,
  },
  progressFill: {
    height: 6,
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  keyLabel: {
    fontSize: 13,
    color: Colors.text,
  },
  riskLabel: {
    fontSize: 13,
    color: Colors.warning,
  },
  recLabel: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  overallRec: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    backgroundColor: `${Colors.primary}08`,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${Colors.primary}15`,
  },
  overallRecText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
    flex: 1,
  },
  aiDisclaimer: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});

```
