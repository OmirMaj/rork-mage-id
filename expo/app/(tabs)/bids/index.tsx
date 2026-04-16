import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, ActivityIndicator, RefreshControl, Platform, Modal, TextInput, Alert, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Clock, DollarSign, Navigation, AlertCircle, Crosshair, ChevronDown, X, Search, ChevronRight, Plus, MoreVertical, Sparkles, Trash2, Edit3, Home as HomeIcon, Building2, Users, Bookmark, Filter, RefreshCw, Send, Camera, MessageCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles, formatDistance } from '@/utils/location';
import { getNaicsLabel, extractValueFromDescription, parseLocationFromDepartment, parseLocationFromDescription } from '@/constants/naicsLabels';
import { getCategoryLabel, getCategoryIcon } from '@/constants/projectCategories';
import { getStateCentroid } from '@/constants/zipCodes';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';

type BidSegment = 'near_me' | 'federal' | 'requests' | 'my';

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
  description?: string;
  bid_type: string;
  category?: string;
  bond_required?: number;
  contact_email?: string;
  contact_phone?: string;
  source_name?: string;
  posted_by?: string;
  posted_date?: string;
  naics_code?: string;
  solicitation_number?: string;
  user_id?: string;
  metadata?: Record<string, unknown>;
  photos?: string[];
  status?: string;
}

interface BidWithDistance extends CachedBid {
  distance: number | null;
  matchScore?: number;
  responseCount?: number;
}

interface CompanyProfile {
  specialties: string[];
  trades: string[];
  naicsCodes: string[];
  state: string;
  certifications: string[];
  minProjectSize: number;
  maxProjectSize: number;
}

const TRACKED_BIDS_KEY = 'mageid_tracked_bids';
const COMPANY_PROFILE_KEY = 'mageid_company_profile';
const RADIUS_OPTIONS = [10, 25, 50, 100, 250] as const;

interface TrackedBid {
  bidId: string;
  status: 'saved' | 'interested' | 'preparing' | 'submitted' | 'won' | 'lost';
  notes: string;
  proposalAmount: number | null;
  savedAt: string;
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null || amount === 0) return '';
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
  return `$${amount.toLocaleString()}`;
}

function getDeadlineInfo(deadline: string | null | undefined): { text: string; color: string; bgColor: string } {
  if (!deadline) return { text: 'No deadline', color: '#9E9E9E', bgColor: '#F5F5F5' };
  const diff = new Date(deadline).getTime() - Date.now();
  if (isNaN(diff)) return { text: 'No deadline', color: '#9E9E9E', bgColor: '#F5F5F5' };
  if (diff <= 0) return { text: 'Expired', color: '#9E9E9E', bgColor: '#F5F5F5' };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 3) return { text: `${days}d left`, color: '#D32F2F', bgColor: '#FFEBEE' };
  if (days <= 7) return { text: `${days} days`, color: '#F57F17', bgColor: '#FFF8E1' };
  if (days > 30) return { text: `${Math.floor(days / 7)}w`, color: '#2E7D32', bgColor: '#E8F5E9' };
  return { text: `${days}d`, color: '#2E7D32', bgColor: '#E8F5E9' };
}

function getDisplayLocation(bid: CachedBid): string {
  if (bid.city && bid.state) return `${bid.city}, ${bid.state}`;
  if (bid.state) return bid.state;
  if (bid.city) return bid.city;
  const fromDept = parseLocationFromDepartment(bid.department);
  if (fromDept) return fromDept;
  const fromDesc = parseLocationFromDescription(bid.description);
  if (fromDesc) return fromDesc;
  return 'Nationwide';
}

function getDisplayValue(bid: CachedBid): { text: string; color: string } {
  if (bid.bid_type === 'homeowner_request') {
    const meta = bid.metadata as Record<string, unknown> | undefined;
    const budgetMin = meta?.budget_min as number | undefined;
    const budgetMax = meta?.budget_max as number | undefined;
    if (budgetMin && budgetMax) return { text: `${formatCurrency(budgetMin)} - ${formatCurrency(budgetMax)}`, color: Colors.homeowner };
    if (budgetMax) return { text: `Up to ${formatCurrency(budgetMax)}`, color: Colors.homeowner };
    return { text: 'Budget TBD', color: Colors.textMuted };
  }
  if (bid.estimated_value && bid.estimated_value > 0) return { text: formatCurrency(bid.estimated_value), color: Colors.primary };
  const fromDesc = extractValueFromDescription(bid.description);
  if (fromDesc) return { text: fromDesc, color: '#B45309' };
  return { text: 'Contact Agency', color: Colors.textMuted };
}

function scoreBid(bid: BidWithDistance, profile: CompanyProfile | null): number {
  if (!profile) return 0;
  let score = 0;
  if (profile.naicsCodes.length > 0 && bid.naics_code) {
    const bidNaics = bid.naics_code.replace(/\D/g, '').slice(0, 6);
    if (profile.naicsCodes.some(n => bidNaics.startsWith(n.slice(0, 4)))) score += 40;
    else if (profile.naicsCodes.some(n => bidNaics.startsWith(n.slice(0, 3)))) score += 20;
  }
  const bidState = bid.state?.toUpperCase() || '';
  if (profile.state && bidState && profile.state.toUpperCase() === bidState) score += 30;
  if (profile.certifications.length > 0 && bid.set_aside) {
    const sa = bid.set_aside.toLowerCase();
    if (profile.certifications.some(c => sa.includes(c.toLowerCase()))) score += 20;
  }
  if (bid.estimated_value && bid.estimated_value > 0) {
    if (bid.estimated_value >= profile.minProjectSize && bid.estimated_value <= profile.maxProjectSize) score += 10;
  }
  return Math.min(100, score);
}

function isHomeownerRequest(bid: CachedBid): boolean {
  return bid.bid_type === 'homeowner_request';
}

function isFederalBid(bid: CachedBid): boolean {
  return bid.bid_type === 'federal' || (bid.source_name?.toLowerCase().includes('sam') ?? false) || (!bid.bid_type && !isHomeownerRequest(bid) && bid.source_name !== 'MAGE ID Community');
}

function isCommunityBid(bid: CachedBid): boolean {
  return bid.bid_type === 'community' || bid.source_name === 'MAGE ID Community';
}

function isExpiredOrClosed(bid: CachedBid): boolean {
  if (bid.status === 'closed') return true;
  if (bid.bid_type === 'homeowner_request') {
    const posted = new Date(bid.posted_date ?? bid.fetched_at).getTime();
    if (Date.now() - posted > 60 * 24 * 60 * 60 * 1000) return true;
  }
  if (bid.deadline) {
    const diff = new Date(bid.deadline).getTime() - Date.now();
    if (!isNaN(diff) && diff <= 0) return true;
  }
  return false;
}

function HomeownerRequestCard({ bid, onPress }: { bid: BidWithDistance; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const meta = (bid.metadata ?? {}) as Record<string, unknown>;
  const timeline = meta.timeline as string | undefined;
  const propertyType = meta.property_type as string | undefined;
  const photos = (bid.photos ?? []) as string[];
  const preferences = (meta.preferences ?? []) as string[];
  const closed = isExpiredOrClosed(bid);

  return (
    <Animated.View style={[styles.requestCard, closed && styles.closedCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        testID={`request-card-${bid.id}`}
      >
        <View style={styles.requestHeader}>
          <View style={styles.requestTypeBadge}>
            <HomeIcon size={12} color={Colors.homeowner} />
            <Text style={styles.requestTypeText}>HOMEOWNER REQUEST</Text>
          </View>
          {closed && (
            <View style={styles.closedBadge}>
              <Text style={styles.closedBadgeText}>CLOSED</Text>
            </View>
          )}
          {bid.distance !== null && (
            <View style={styles.distancePill}>
              <Navigation size={10} color={Colors.info} />
              <Text style={styles.distancePillText}>{formatDistance(bid.distance)}</Text>
            </View>
          )}
        </View>

        <Text style={styles.requestTitle} numberOfLines={2}>
          {getCategoryIcon(bid.category ?? '')} {bid.title ?? getCategoryLabel(bid.category ?? 'other')} — {getDisplayLocation(bid)}
        </Text>

        {photos.length > 0 && (
          <View style={styles.photoRow}>
            {photos.slice(0, 3).map((uri, idx) => (
              <View key={idx} style={styles.photoThumb}>
                <Camera size={16} color={Colors.textMuted} />
              </View>
            ))}
            {bid.description ? (
              <Text style={styles.requestDescSnippet} numberOfLines={3}>{bid.description}</Text>
            ) : null}
          </View>
        )}

        {!photos.length && bid.description ? (
          <Text style={styles.requestDesc} numberOfLines={2}>{bid.description}</Text>
        ) : null}

        <View style={styles.requestMeta}>
          <View style={styles.metaChip}>
            <DollarSign size={12} color={Colors.homeowner} />
            <Text style={styles.metaChipText}>{getDisplayValue(bid).text}</Text>
          </View>
          {timeline && (
            <View style={styles.metaChip}>
              <Clock size={12} color={Colors.textSecondary} />
              <Text style={styles.metaChipText}>{timeline === 'asap' ? 'ASAP' : timeline.replace(/_/g, ' ')}</Text>
            </View>
          )}
          {propertyType && (
            <View style={styles.metaChip}>
              <Building2 size={12} color={Colors.textSecondary} />
              <Text style={styles.metaChipText}>{propertyType}</Text>
            </View>
          )}
        </View>

        {preferences.includes('licensed_required') && (
          <View style={styles.prefRow}>
            <Text style={styles.prefText}>Licensed & insured required</Text>
          </View>
        )}

        <View style={styles.requestFooter}>
          <Text style={styles.requestPostedAt}>
            Posted {getTimeAgo(bid.posted_date ?? bid.fetched_at)}
            {bid.responseCount != null ? ` · ${bid.responseCount} response${bid.responseCount !== 1 ? 's' : ''}` : ''}
          </Text>
          <View style={styles.requestActions}>
            <View style={styles.submitBidBtn}>
              <Send size={12} color="#FFF" />
              <Text style={styles.submitBidBtnText}>Submit a Bid</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

function FederalBidCard({ bid, onPress, tracked, userId, onDelete, onEdit }: {
  bid: BidWithDistance;
  onPress: () => void;
  tracked?: TrackedBid;
  userId: string | null;
  onDelete?: () => void;
  onEdit?: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const deadlineInfo = getDeadlineInfo(bid.deadline);
  const displayLocation = getDisplayLocation(bid);
  const displayValue = getDisplayValue(bid);
  const naicsLabel = getNaicsLabel(bid.naics_code);
  const isOwnPost = bid.user_id === userId && !!userId;
  const isCommunity = isCommunityBid(bid);
  const isFederal = isFederalBid(bid);
  const [showMenu, setShowMenu] = useState(false);

  const sourceBadge = isFederal
    ? { label: 'Federal — SAM.gov', icon: '🏛', bg: Colors.federalLight, color: Colors.federal }
    : isOwnPost
      ? { label: 'Your Post', icon: '📋', bg: '#E8F5E9', color: '#2E7D32' }
      : isCommunity
        ? { label: `Community${bid.posted_by ? ' — ' + bid.posted_by : ''}`, icon: '👥', bg: Colors.communityLight, color: Colors.community }
        : null;

  return (
    <Animated.View style={[styles.bidCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        testID={`bid-card-${bid.id}`}
      >
        <View style={styles.bidHeader}>
          <View style={styles.bidHeaderLeft}>
            {bid.set_aside ? (
              <View style={styles.setAsideBadge}>
                <Text style={styles.setAsideText}>{bid.set_aside}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.bidHeaderRight}>
            {tracked && (
              <View style={[styles.trackedDot, { backgroundColor: tracked.status === 'won' ? Colors.success : Colors.info }]} />
            )}
            {isOwnPost && (
              <TouchableOpacity onPress={() => setShowMenu(!showMenu)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MoreVertical size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
            <View style={[styles.countdownBadge, { backgroundColor: deadlineInfo.bgColor }]}>
              <Clock size={10} color={deadlineInfo.color} />
              <Text style={[styles.countdownText, { color: deadlineInfo.color }]}>{deadlineInfo.text}</Text>
            </View>
          </View>
        </View>

        {showMenu && isOwnPost && (
          <View style={styles.ownPostMenu}>
            <TouchableOpacity style={styles.ownPostMenuItem} onPress={() => { setShowMenu(false); onEdit?.(); }}>
              <Edit3 size={14} color={Colors.primary} />
              <Text style={styles.menuItemText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ownPostMenuItem} onPress={() => { setShowMenu(false); onDelete?.(); }}>
              <Trash2 size={14} color={Colors.error} />
              <Text style={[styles.menuItemText, { color: Colors.error }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}

        {sourceBadge && (
          <View style={[styles.sourceBadge, { backgroundColor: sourceBadge.bg }]}>
            <Text style={styles.sourceBadgeIcon}>{sourceBadge.icon}</Text>
            <Text style={[styles.sourceBadgeText, { color: sourceBadge.color }]}>{sourceBadge.label}</Text>
          </View>
        )}

        <Text style={styles.bidTitle} numberOfLines={2}>{bid.title ?? 'Untitled Bid'}</Text>
        <Text style={styles.bidDepartment} numberOfLines={1}>{bid.department ?? 'Department not listed'}</Text>

        <View style={styles.bidValueRow}>
          <View style={styles.metaItem}>
            <DollarSign size={13} color={displayValue.color} />
            <Text style={[styles.metaText, { color: displayValue.color, fontWeight: '600' as const }]}>{displayValue.text}</Text>
          </View>
          <View style={styles.metaItem}>
            <MapPin size={13} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{displayLocation}</Text>
          </View>
        </View>

        {naicsLabel ? (
          <View style={styles.naicsRow}>
            <Text style={styles.naicsCode}>{bid.naics_code}</Text>
            <Text style={styles.naicsLabel} numberOfLines={1}>— {naicsLabel}</Text>
          </View>
        ) : null}

        {(bid.matchScore ?? 0) > 0 && (
          <View style={[styles.matchBadge, {
            backgroundColor: (bid.matchScore ?? 0) >= 70 ? '#E8F5E9' : (bid.matchScore ?? 0) >= 40 ? '#FFF8E1' : '#FFF3E0',
          }]}>
            <Text style={[styles.matchText, {
              color: (bid.matchScore ?? 0) >= 70 ? '#2E7D32' : (bid.matchScore ?? 0) >= 40 ? '#F57F17' : '#E65100',
            }]}>
              AI Match: {bid.matchScore}% {(bid.matchScore ?? 0) >= 70 ? '🟢' : (bid.matchScore ?? 0) >= 40 ? '🟡' : '🟠'}
            </Text>
          </View>
        )}

        <View style={styles.bidFooter}>
          {bid.distance !== null && (
            <View style={styles.distancePill}>
              <Navigation size={10} color={Colors.info} />
              <Text style={styles.distancePillText}>{formatDistance(bid.distance)}</Text>
            </View>
          )}
          <ChevronRight size={16} color={Colors.textMuted} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

function RecommendedCard({ bid, onPress }: { bid: BidWithDistance; onPress: () => void }) {
  const displayValue = getDisplayValue(bid);
  return (
    <TouchableOpacity style={styles.recCard} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.recScoreBadge, {
        backgroundColor: (bid.matchScore ?? 0) >= 70 ? '#2E7D32' : (bid.matchScore ?? 0) >= 40 ? '#F57F17' : '#E65100',
      }]}>
        <Text style={styles.recScoreText}>{bid.matchScore}%</Text>
      </View>
      <Text style={styles.recTitle} numberOfLines={2}>{bid.title}</Text>
      <Text style={styles.recMeta} numberOfLines={1}>{displayValue.text} · {getDisplayLocation(bid)}</Text>
      {bid.distance !== null && <Text style={styles.recDistance}>{formatDistance(bid.distance)}</Text>}
    </TouchableOpacity>
  );
}

function getTimeAgo(dateStr: string | undefined): string {
  if (!dateStr) return 'recently';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff)) return 'recently';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export default function BidsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { tier } = useSubscription();
  const userId = user?.id ?? null;
  const { location, radius, updateRadius, refresh: refreshLocation } = useUserLocation();
  const [activeSegment, setActiveSegment] = useState<BidSegment>('near_me');
  const [searchQuery, setSearchQuery] = useState('');
  const [showRadiusPicker, setShowRadiusPicker] = useState(false);
  const [trackedBids, setTrackedBids] = useState<TrackedBid[]>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(TRACKED_BIDS_KEY).then(data => {
      if (data) { try { setTrackedBids(JSON.parse(data)); } catch { /* */ } }
    }).catch(() => {});
    AsyncStorage.getItem(COMPANY_PROFILE_KEY).then(data => {
      if (data) { try { setCompanyProfile(JSON.parse(data)); } catch { /* */ } }
    }).catch(() => {});
  }, []);

  const { data: allBids, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['marketplace_bids'],
    queryFn: async () => {
      console.log('[Bids] Fetching all bids from cached_bids + public_bids...');
      const [cachedRes, publicRes] = await Promise.all([
        supabase.from('cached_bids').select('*').order('posted_date', { ascending: false }),
        supabase.from('public_bids').select('*').order('created_at', { ascending: false }),
      ]);
      const cached = ((cachedRes.data ?? []) as CachedBid[]).map(b => ({
        ...b,
        bid_type: b.bid_type || 'federal',
      }));
      const pubBids = ((publicRes.data ?? []) as Record<string, unknown>[]).map(r => ({
        id: r.id as string,
        title: (r.title as string) ?? '',
        department: (r.issuing_agency as string) ?? (r.department as string) ?? '',
        deadline: (r.deadline as string) ?? '',
        estimated_value: Number(r.estimated_value) || 0,
        city: (r.city as string) ?? '',
        state: (r.state as string) ?? '',
        latitude: Number(r.latitude) || 0,
        longitude: Number(r.longitude) || 0,
        source_url: (r.source_url as string) ?? '',
        set_aside: (r.set_aside as string) ?? null,
        fetched_at: (r.created_at as string) ?? new Date().toISOString(),
        description: (r.description as string) ?? '',
        bid_type: ((r.bid_type as string) ?? 'state') as string,
        category: (r.category as string) ?? '',
        bond_required: Number(r.bond_required) || 0,
        contact_email: (r.contact_email as string) ?? '',
        contact_phone: (r.contact_phone as string) ?? '',
        source_name: (r.source_name as string) ?? '',
        posted_by: (r.posted_by as string) ?? '',
        posted_date: (r.posted_date as string) ?? (r.created_at as string) ?? '',
        naics_code: (r.naics_code as string) ?? '',
        solicitation_number: (r.solicitation_number as string) ?? '',
        user_id: (r.user_id as string) ?? '',
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        photos: (r.photos as string[]) ?? [],
        status: (r.status as string) ?? 'open',
      })) as CachedBid[];

      const existingIds = new Set(cached.map(b => b.id));
      const combined = [...cached];
      for (const pub of pubBids) {
        if (!existingIds.has(pub.id)) {
          combined.push(pub);
        }
      }
      console.log('[Bids] Total bids loaded:', combined.length);
      return combined;
    },
    retry: 1,
  });

  const bidsWithDistance = useMemo<BidWithDistance[]>(() => {
    if (!allBids) return [];
    return allBids.map(bid => {
      let dist: number | null = null;
      if (location && bid.latitude && bid.longitude) {
        dist = getDistanceMiles(location.latitude, location.longitude, bid.latitude, bid.longitude);
      } else if (location && bid.state) {
        const centroid = getStateCentroid(bid.state);
        if (centroid) dist = getDistanceMiles(location.latitude, location.longitude, centroid.lat, centroid.lon);
      }
      const ms = scoreBid({ ...bid, distance: dist } as BidWithDistance, companyProfile);
      return { ...bid, distance: dist, matchScore: ms };
    }).filter(b => !isExpiredOrClosed(b) || b.user_id === userId);
  }, [allBids, location, companyProfile, userId]);

  const recommendedBids = useMemo<BidWithDistance[]>(() => {
    if (!companyProfile) return [];
    return bidsWithDistance
      .filter(b => (b.matchScore ?? 0) >= 30 && !isHomeownerRequest(b))
      .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
      .slice(0, 5);
  }, [bidsWithDistance, companyProfile]);

  const trackedBidMap = useMemo(() => {
    const map = new Map<string, TrackedBid>();
    for (const tb of trackedBids) map.set(tb.bidId, tb);
    return map;
  }, [trackedBids]);

  const filteredBids = useMemo(() => {
    let result = [...bidsWithDistance];
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      result = result.filter(b =>
        (b.title ?? '').toLowerCase().includes(q) ||
        (b.department ?? '').toLowerCase().includes(q) ||
        (b.city ?? '').toLowerCase().includes(q) ||
        (b.description ?? '').toLowerCase().includes(q) ||
        (b.naics_code ?? '').toLowerCase().includes(q) ||
        (b.category ?? '').toLowerCase().includes(q)
      );
    }

    switch (activeSegment) {
      case 'near_me':
        result = result.filter(b => b.distance === null || b.distance <= radius);
        result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
        break;
      case 'federal':
        result = result.filter(b => isFederalBid(b));
        if (location) result = result.filter(b => b.distance === null || b.distance <= radius);
        result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
        break;
      case 'requests':
        result = result.filter(b => isHomeownerRequest(b));
        result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
        break;
      case 'my':
        result = result.filter(b =>
          b.user_id === userId ||
          trackedBidMap.has(b.id)
        );
        result.sort((a, b) => new Date(b.posted_date ?? b.fetched_at).getTime() - new Date(a.posted_date ?? a.fetched_at).getTime());
        break;
    }

    return result;
  }, [bidsWithDistance, activeSegment, searchQuery, radius, location, userId, trackedBidMap]);

  const sectionCounts = useMemo(() => ({
    near_me: bidsWithDistance.filter(b => b.distance !== null && b.distance <= radius).length,
    federal: bidsWithDistance.filter(b => isFederalBid(b)).length,
    requests: bidsWithDistance.filter(b => isHomeownerRequest(b)).length,
    my: bidsWithDistance.filter(b => b.user_id === userId || trackedBidMap.has(b.id)).length,
  }), [bidsWithDistance, radius, userId, trackedBidMap]);

  const handleBidPress = useCallback((bid: CachedBid) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isHomeownerRequest(bid)) {
      if (bid.user_id === userId) {
        router.push({ pathname: '/bid-responses', params: { bidId: bid.id } });
      } else {
        router.push({ pathname: '/bid-detail', params: { id: bid.id, source: 'cached' } });
      }
    } else {
      router.push({ pathname: '/bid-detail', params: { id: bid.id, source: 'cached' } });
    }
  }, [router, userId]);

  const handleSubmitBid = useCallback((bid: CachedBid) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({ pathname: '/submit-bid-response', params: { bidId: bid.id } });
  }, [router]);

  const handleDeleteBid = useCallback((bidId: string) => {
    Alert.alert('Delete', 'Are you sure you want to delete this?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await Promise.all([
              supabase.from('cached_bids').delete().eq('id', bidId).eq('user_id', userId),
              supabase.from('public_bids').delete().eq('id', bidId).eq('user_id', userId),
            ]);
            void refetch();
          } catch (err) {
            console.log('[Bids] Delete failed:', err);
            Alert.alert('Error', 'Could not delete.');
          }
        },
      },
    ]);
  }, [userId, refetch]);

  const handleSegmentChange = useCallback((seg: BidSegment) => {
    setActiveSegment(seg);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const locationLabel = location?.cityName
    ? `${location.cityName}${location.stateName ? ', ' + location.stateName : ''}`
    : location?.stateName ?? 'Detecting...';

  const renderItem = useCallback(({ item }: { item: BidWithDistance }) => {
    if (isHomeownerRequest(item)) {
      return <HomeownerRequestCard bid={item} onPress={() => {
        if (item.user_id === userId) {
          handleBidPress(item);
        } else {
          handleSubmitBid(item);
        }
      }} />;
    }
    return (
      <FederalBidCard
        bid={item}
        onPress={() => handleBidPress(item)}
        tracked={trackedBidMap.get(item.id)}
        userId={userId}
        onDelete={() => handleDeleteBid(item.id)}
        onEdit={() => router.push({ pathname: '/post-bid', params: { editId: item.id } })}
      />
    );
  }, [handleBidPress, handleSubmitBid, trackedBidMap, userId, handleDeleteBid, router]);

  const renderListHeader = useCallback(() => {
    if (activeSegment !== 'near_me') return null;
    return (
      <>
        {recommendedBids.length > 0 && (
          <View style={styles.recSection}>
            <View style={styles.recSectionHeader}>
              <Sparkles size={16} color="#FF9500" />
              <Text style={styles.recSectionTitle}>Recommended for You</Text>
            </View>
            <Text style={styles.recSectionSubtitle}>Based on your company profile</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recScroll}>
              {recommendedBids.map(bid => (
                <RecommendedCard key={bid.id} bid={bid} onPress={() => handleBidPress(bid)} />
              ))}
            </ScrollView>
          </View>
        )}
        {!companyProfile && (
          <TouchableOpacity style={styles.profilePrompt} onPress={() => router.push('/settings' as any)} activeOpacity={0.8}>
            <Sparkles size={18} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.profilePromptTitle}>Get Personalized Recommendations</Text>
              <Text style={styles.profilePromptSub}>Set up your company profile in Settings</Text>
            </View>
            <ChevronRight size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </>
    );
  }, [activeSegment, recommendedBids, companyProfile, handleBidPress, router]);

  const segments: { key: BidSegment; label: string; count: number }[] = [
    { key: 'near_me', label: 'Near Me', count: sectionCounts.near_me },
    { key: 'federal', label: 'Federal', count: sectionCounts.federal },
    { key: 'requests', label: 'Requests', count: sectionCounts.requests },
    { key: 'my', label: 'My', count: sectionCounts.my },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.locationBar}>
          <TouchableOpacity style={styles.locationInfo} onPress={() => refreshLocation()} activeOpacity={0.7}>
            <MapPin size={16} color={Colors.primary} />
            <Text style={styles.locationText} numberOfLines={1}>{locationLabel}</Text>
            <RefreshCw size={12} color={Colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.radiusButton}
            onPress={() => setShowRadiusPicker(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.radiusText}>{radius} mi</Text>
            <ChevronDown size={14} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.bidCountLabel}>
          Showing {filteredBids.length} bid{filteredBids.length !== 1 ? 's' : ''}{activeSegment === 'near_me' ? ` within ${radius} miles` : ''}
        </Text>

        <View style={styles.segmentBar}>
          {segments.map(seg => (
            <TouchableOpacity
              key={seg.key}
              style={[styles.segmentItem, activeSegment === seg.key && styles.segmentItemActive]}
              onPress={() => handleSegmentChange(seg.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.segmentLabel, activeSegment === seg.key && styles.segmentLabelActive]} numberOfLines={1}>
                {seg.label}
              </Text>
              {seg.count > 0 && (
                <View style={[styles.segmentCountBadge, activeSegment === seg.key && styles.segmentCountBadgeActive]}>
                  <Text style={[styles.segmentCount, activeSegment === seg.key && styles.segmentCountActive]}>{seg.count}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.searchBar}>
          <Search size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search bids, projects, trades..."
            placeholderTextColor={Colors.textMuted}
            autoCorrect={false}
            returnKeyType="search"
            testID="bid-search-input"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Modal visible={showRadiusPicker} transparent animationType="fade" onRequestClose={() => setShowRadiusPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowRadiusPicker(false)}>
          <View style={styles.radiusModal}>
            <Text style={styles.radiusModalTitle}>Search Radius</Text>
            {RADIUS_OPTIONS.map(r => (
              <TouchableOpacity
                key={r}
                style={[styles.radiusOption, radius === r && styles.radiusOptionActive]}
                onPress={() => { void updateRadius(r); setShowRadiusPicker(false); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
              >
                <Text style={[styles.radiusOptionText, radius === r && styles.radiusOptionTextActive]}>{r} miles</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.radiusOption, radius === 99999 && styles.radiusOptionActive]}
              onPress={() => { void updateRadius(99999); setShowRadiusPicker(false); }}
            >
              <Text style={[styles.radiusOptionText, radius === 99999 && styles.radiusOptionTextActive]}>Nationwide</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading marketplace...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredBids}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} tintColor={Colors.primary} />}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AlertCircle size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No bids found</Text>
              <Text style={styles.emptySubtitle}>
                {activeSegment === 'requests'
                  ? 'No homeowner requests in your area yet'
                  : activeSegment === 'my'
                    ? 'You haven\'t posted or tracked any bids yet'
                    : 'Try expanding your search radius or removing filters'}
              </Text>
            </View>
          }
        />
      )}

      <View style={[styles.fabContainer, { bottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.fab, styles.fabSecondary]}
          onPress={() => router.push('/post-project')}
          activeOpacity={0.85}
          testID="post-project-fab"
        >
          <HomeIcon size={18} color={Colors.homeowner} />
          <Text style={styles.fabSecondaryText}>Post Project</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.fab, styles.fabPrimary]}
          onPress={() => router.push('/post-bid')}
          activeOpacity={0.85}
          testID="post-bid-fab"
        >
          <Plus size={20} color="#FFF" />
          <Text style={styles.fabPrimaryText}>Post Bid</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight, paddingHorizontal: 16, paddingBottom: 8 },
  locationBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, marginBottom: 4 },
  locationInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  locationText: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, flex: 1 },
  radiusButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primaryLight, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  radiusText: { fontSize: 13, fontWeight: '700' as const, color: Colors.primary },
  bidCountLabel: { fontSize: 12, color: Colors.textMuted, marginBottom: 8 },
  segmentBar: { flexDirection: 'row', backgroundColor: Colors.fillTertiary, borderRadius: 12, padding: 3, marginBottom: 8 },
  segmentItem: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: 8, borderRadius: 10 },
  segmentItemActive: { backgroundColor: Colors.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  segmentLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, textAlign: 'center' as const },
  segmentLabelActive: { color: Colors.primary },
  segmentCountBadge: { backgroundColor: Colors.fillSecondary, borderRadius: 8, paddingHorizontal: 4, paddingVertical: 1, minWidth: 16, alignItems: 'center' as const, marginTop: 2 },
  segmentCountBadgeActive: { backgroundColor: Colors.primaryLight },
  segmentCount: { fontSize: 9, fontWeight: '700' as const, color: Colors.textMuted },
  segmentCountActive: { color: Colors.primary },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.fillTertiary, borderRadius: 12, paddingHorizontal: 12, height: 38, gap: 8 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },
  list: { padding: 16, paddingBottom: 120 },

  requestCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: Colors.homeowner, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  closedCard: { opacity: 0.6 },
  requestHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  requestTypeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.homeownerLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  requestTypeText: { fontSize: 10, fontWeight: '800' as const, color: Colors.homeowner, letterSpacing: 0.5 },
  closedBadge: { backgroundColor: '#F5F5F5', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  closedBadgeText: { fontSize: 9, fontWeight: '700' as const, color: '#9E9E9E' },
  requestTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, marginBottom: 6, lineHeight: 22 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  photoThumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: Colors.fillTertiary, alignItems: 'center' as const, justifyContent: 'center' as const },
  requestDescSnippet: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  requestDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18, marginBottom: 8 },
  requestMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.fillSecondary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  metaChipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  prefRow: { marginBottom: 8 },
  prefText: { fontSize: 11, color: Colors.primary, fontWeight: '600' as const },
  requestFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  requestPostedAt: { fontSize: 12, color: Colors.textMuted },
  requestActions: { flexDirection: 'row', gap: 8 },
  submitBidBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.homeowner, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  submitBidBtnText: { fontSize: 12, fontWeight: '700' as const, color: '#FFF' },

  bidCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  bidHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  bidHeaderLeft: { flexDirection: 'row', gap: 6, alignItems: 'center', flex: 1 },
  bidHeaderRight: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  setAsideBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  setAsideText: { fontSize: 10, fontWeight: '700' as const, color: '#2E7D32', textTransform: 'uppercase' as const },
  trackedDot: { width: 8, height: 8, borderRadius: 4 },
  countdownBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  countdownText: { fontSize: 11, fontWeight: '600' as const },
  ownPostMenu: { flexDirection: 'row', gap: 8, paddingVertical: 6, marginBottom: 4 },
  ownPostMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: Colors.fillTertiary },
  menuItemText: { fontSize: 12, fontWeight: '600' as const, color: Colors.text },
  sourceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' as const, marginBottom: 6 },
  sourceBadgeIcon: { fontSize: 11 },
  sourceBadgeText: { fontSize: 10, fontWeight: '700' as const },
  bidTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, marginBottom: 4, lineHeight: 22 },
  bidDepartment: { fontSize: 13, color: Colors.textSecondary, marginBottom: 6 },
  bidValueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: Colors.textSecondary },
  naicsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  naicsCode: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted, backgroundColor: Colors.fillSecondary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  naicsLabel: { fontSize: 11, color: Colors.textSecondary, flex: 1 },
  matchBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' as const, marginBottom: 6 },
  matchText: { fontSize: 12, fontWeight: '700' as const },
  bidFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  distancePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.infoLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  distancePillText: { fontSize: 11, fontWeight: '600' as const, color: Colors.info },

  recSection: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#FF950020' },
  recSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  recSectionTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  recSectionSubtitle: { fontSize: 12, color: Colors.textSecondary, marginBottom: 12 },
  recScroll: { marginHorizontal: -6 },
  recCard: { width: 160, backgroundColor: Colors.background, borderRadius: 12, padding: 12, marginHorizontal: 6 },
  recScoreBadge: { alignSelf: 'flex-start' as const, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginBottom: 6 },
  recScoreText: { fontSize: 12, fontWeight: '800' as const, color: '#FFF' },
  recTitle: { fontSize: 13, fontWeight: '600' as const, color: Colors.text, marginBottom: 4, lineHeight: 18 },
  recMeta: { fontSize: 11, color: Colors.textSecondary, marginBottom: 2 },
  recDistance: { fontSize: 11, color: Colors.info, fontWeight: '600' as const },

  profilePrompt: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: Colors.primary + '20' },
  profilePromptTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  profilePromptSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  radiusModal: { width: '70%', backgroundColor: Colors.surface, borderRadius: 16, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10 },
  radiusModalTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, marginBottom: 12, textAlign: 'center' as const },
  radiusOption: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, marginBottom: 4 },
  radiusOptionActive: { backgroundColor: Colors.primaryLight },
  radiusOptionText: { fontSize: 15, color: Colors.text, fontWeight: '500' as const, textAlign: 'center' as const },
  radiusOptionTextActive: { color: Colors.primary, fontWeight: '700' as const },

  fabContainer: { position: 'absolute' as const, right: 16, flexDirection: 'column', gap: 10 },
  fab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 28, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  fabPrimary: { backgroundColor: Colors.primary },
  fabPrimaryText: { fontSize: 13, fontWeight: '700' as const, color: '#FFF' },
  fabSecondary: { backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.homeowner },
  fabSecondaryText: { fontSize: 13, fontWeight: '700' as const, color: Colors.homeowner },
});

