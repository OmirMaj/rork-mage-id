import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, ActivityIndicator, TextInput, RefreshControl, Platform, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Search, ArrowLeft, Star, UserPlus, Filter, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useProfile, useFilteredDirectory } from '@/contexts/ProfileContext';
import { TRADE_CATEGORIES, getTradeLabel } from '@/constants/trades';
import type { ContractorProfile, ProfileAvailability } from '@/types';

const AVAIL_COLORS: Record<ProfileAvailability, string> = {
  available: '#34C759',
  busy: '#FF9500',
  not_taking_work: '#FF3B30',
};

const AVAIL_LABELS: Record<ProfileAvailability, string> = {
  available: 'Available',
  busy: 'Busy',
  not_taking_work: 'Not available',
};

const TRADE_QUICK = ['All', 'General Laborer', 'Electrician', 'Plumber', 'Carpenter', 'HVAC Technician', 'Project Manager'];

function ProfileCard({ profile, onPress }: { profile: ContractorProfile; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const availColor = AVAIL_COLORS[profile.availability] ?? '#34C759';

  return (
    <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        testID={`profile-card-${profile.id}`}
      >
        <View style={styles.cardTop}>
          {profile.profilePhotoUri ? (
            <Image source={{ uri: profile.profilePhotoUri }} style={styles.cardAvatar} />
          ) : (
            <View style={styles.cardAvatarPlaceholder}>
              <Text style={styles.cardAvatarLetter}>{profile.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.cardInfo}>
            <View style={styles.cardNameRow}>
              <Text style={styles.cardName} numberOfLines={1}>{profile.name}</Text>
              {profile.rating > 0 && (
                <View style={styles.ratingBadge}>
                  <Star size={10} color="#FFB800" fill="#FFB800" />
                  <Text style={styles.ratingBadgeText}>{profile.rating.toFixed(1)}</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardHeadline} numberOfLines={1}>
              {profile.headline || getTradeLabel(profile.tradeCategory)}
            </Text>
            {profile.companyName ? <Text style={styles.cardCompany} numberOfLines={1}>{profile.companyName}</Text> : null}
          </View>
        </View>

        <View style={styles.cardMeta}>
          <View style={[styles.availChip, { backgroundColor: availColor + '12' }]}>
            <View style={[styles.availDotSmall, { backgroundColor: availColor }]} />
            <Text style={[styles.availChipText, { color: availColor }]}>{AVAIL_LABELS[profile.availability]}</Text>
          </View>
          {(profile.city || profile.state) && (
            <View style={styles.locationChip}>
              <MapPin size={11} color={Colors.textSecondary} />
              <Text style={styles.locationChipText}>{[profile.city, profile.state].filter(Boolean).join(', ')}</Text>
            </View>
          )}
        </View>

        {(profile.skills || []).length > 0 && (
          <View style={styles.skillsRow}>
            {(profile.skills || []).slice(0, 3).map(s => (
              <View key={s} style={styles.skillMiniTag}>
                <Text style={styles.skillMiniText}>{s}</Text>
              </View>
            ))}
            {(profile.skills || []).length > 3 && (
              <Text style={styles.moreSkills}>+{(profile.skills || []).length - 3}</Text>
            )}
          </View>
        )}

        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.viewBtn} onPress={onPress} activeOpacity={0.7}>
            <Text style={styles.viewBtnText}>View Profile</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function HireDirectoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { myProfile, isDirectoryLoading, refetchDirectory } = useProfile();
  const [searchText, setSearchText] = useState('');
  const [selectedTrade, setSelectedTrade] = useState<string | undefined>();
  const [showFilters, setShowFilters] = useState(false);

  const tradeFilter = useMemo(() => {
    if (!selectedTrade || selectedTrade === 'All') return undefined;
    const found = TRADE_CATEGORIES.find(t => t.label === selectedTrade);
    return found?.id;
  }, [selectedTrade]);

  const filteredProfiles = useFilteredDirectory({
    search: searchText,
    trade: tradeFilter,
  });

  const handleProfilePress = useCallback((profile: ContractorProfile) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/profile-view' as any, params: { id: profile.id } });
  }, [router]);

  const renderProfile = useCallback(({ item }: { item: ContractorProfile }) => (
    <ProfileCard profile={item} onPress={() => handleProfilePress(item)} />
  ), [handleProfilePress]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Contractor Directory</Text>
          <TouchableOpacity
            style={styles.createProfileBtn}
            onPress={() => {
              if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/contractor-profile' as any);
            }}
            activeOpacity={0.7}
          >
            <UserPlus size={16} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        {!myProfile && (
          <TouchableOpacity
            style={styles.createBanner}
            onPress={() => router.push('/contractor-profile' as any)}
            activeOpacity={0.85}
          >
            <UserPlus size={18} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.createBannerTitle}>Create Your Profile</Text>
              <Text style={styles.createBannerSub}>Get discovered by other contractors and clients</Text>
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.searchBar}>
          <Search size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search name, company, trade..."
            placeholderTextColor={Colors.textMuted}
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')}>
              <X size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={{ gap: 6 }}>
          {TRADE_QUICK.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tradeChip, (selectedTrade === t || (!selectedTrade && t === 'All')) && styles.tradeChipActive]}
              onPress={() => {
                setSelectedTrade(t === 'All' ? undefined : t);
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.tradeChipText, (selectedTrade === t || (!selectedTrade && t === 'All')) && styles.tradeChipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {isDirectoryLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading profiles...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredProfiles}
          renderItem={renderProfile}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => { void refetchDirectory(); }}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <UserPlus size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No profiles yet</Text>
              <Text style={styles.emptySubtitle}>Be the first to create a professional profile</Text>
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => router.push('/contractor-profile' as any)}
                activeOpacity={0.85}
              >
                <Text style={styles.emptyBtnText}>Create Profile</Text>
              </TouchableOpacity>
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
  headerTitle: { flex: 1, fontSize: 22, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  createProfileBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary + '12', alignItems: 'center', justifyContent: 'center' },
  createBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.primary + '08', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.primary + '20' },
  createBannerTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.primary },
  createBannerSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.background, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },
  chipRow: { flexDirection: 'row', marginBottom: 4 },
  tradeChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background },
  tradeChipActive: { backgroundColor: Colors.primary },
  tradeChipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  tradeChipTextActive: { color: '#FFF' },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardTop: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  cardAvatar: { width: 52, height: 52, borderRadius: 26 },
  cardAvatarPlaceholder: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  cardAvatarLetter: { fontSize: 22, fontWeight: '800' as const, color: Colors.primary },
  cardInfo: { flex: 1, justifyContent: 'center' },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardName: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, flex: 1 },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FFB800' + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  ratingBadgeText: { fontSize: 12, fontWeight: '700' as const, color: '#B8860B' },
  cardHeadline: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
  cardCompany: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  cardMeta: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  availChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  availDotSmall: { width: 6, height: 6, borderRadius: 3 },
  availChipText: { fontSize: 11, fontWeight: '600' as const },
  locationChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 4 },
  locationChipText: { fontSize: 12, color: Colors.textSecondary },
  skillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  skillMiniTag: { backgroundColor: Colors.fillTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  skillMiniText: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  moreSkills: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, alignSelf: 'center' as const },
  cardActions: { flexDirection: 'row', gap: 8 },
  viewBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primary + '10' },
  viewBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32 },
  emptyBtn: { marginTop: 12, backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  emptyBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' as const },
});

