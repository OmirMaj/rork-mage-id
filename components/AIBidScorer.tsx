import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal,
  ScrollView, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Sparkles, X, CheckCircle2, Settings } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  scoreBid, getCompanyProfile, saveCompanyProfile, getCachedResult, setCachedResult,
  type CompanyAIProfile, type BidScoreResult,
} from '@/utils/aiService';

const SPECIALTIES = ['Residential', 'Commercial', 'Industrial', 'Government', 'Renovation', 'New Construction'];
const TRADES = ['General', 'Electrical', 'Plumbing', 'HVAC', 'Roofing', 'Concrete', 'Framing', 'Painting', 'Drywall', 'Flooring', 'Landscaping'];
const SIZE_OPTIONS = ['Under $100K', '$100K-$500K', '$500K-$2M', '$2M-$10M', '$10M+'];
const CERTS = ['SDVOSB', 'HUBZone', '8(a)', 'WOSB', 'MBE', 'DBE', 'MWBE', 'SBE'];

function getMatchBadge(score: number): { label: string; color: string; bg: string } {
  if (score >= 90) return { label: 'Great Match', color: Colors.successDark, bg: Colors.successLight };
  if (score >= 70) return { label: 'Good Match', color: Colors.infoDark, bg: Colors.infoLight };
  if (score >= 50) return { label: 'Partial Match', color: Colors.warningDark, bg: Colors.warningLight };
  return { label: 'Low Match', color: '#757575', bg: '#F5F5F5' };
}

export function AIMatchBadge({ score }: { score: number }) {
  const badge = getMatchBadge(score);
  return (
    <View style={[badgeStyles.container, { backgroundColor: badge.bg }]}>
      <Sparkles size={10} color={badge.color} />
      <Text style={[badgeStyles.text, { color: badge.color }]}>{badge.label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: Tokens.radius.xs,
  },
  text: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
});

interface ProfileSetupProps {
  visible: boolean;
  onClose: () => void;
  onSave: (profile: CompanyAIProfile) => void;
  initialProfile?: CompanyAIProfile | null;
}

export function AIProfileSetup({ visible, onClose, onSave, initialProfile }: ProfileSetupProps) {
  const insets = useSafeAreaInsets();
  const [specialties, setSpecialties] = useState<string[]>(initialProfile?.specialties ?? []);
  const [trades, setTrades] = useState<string[]>(initialProfile?.trades ?? []);
  const [preferredSize, setPreferredSize] = useState(initialProfile?.preferredSize ?? '$100K-$500K');
  const [location, setLocation] = useState(initialProfile?.location ?? '');
  const [certifications, setCertifications] = useState<string[]>(initialProfile?.certifications ?? []);

  const toggle = (arr: string[], item: string, setter: (v: string[]) => void) => {
    setter(arr.includes(item) ? arr.filter(s => s !== item) : [...arr, item]);
  };

  const handleSave = () => {
    const profile: CompanyAIProfile = { specialties, trades, preferredSize, location, certifications };
    saveCompanyProfile(profile).catch(() => {});
    onSave(profile);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[setupStyles.container, { paddingTop: insets.top }]}>
        <View style={setupStyles.header}>
          <Text style={setupStyles.title}>Company AI Profile</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={Colors.textSecondary} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={setupStyles.content}>
          <Text style={setupStyles.sectionTitle}>Specialties</Text>
          <View style={setupStyles.chipRow}>
            {SPECIALTIES.map(s => (
              <TouchableOpacity
                key={s}
                style={[setupStyles.chip, specialties.includes(s) && setupStyles.chipActive]}
                onPress={() => toggle(specialties, s, setSpecialties)}
              >
                <Text style={[setupStyles.chipText, specialties.includes(s) && setupStyles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={setupStyles.sectionTitle}>Trades</Text>
          <View style={setupStyles.chipRow}>
            {TRADES.map(t => (
              <TouchableOpacity
                key={t}
                style={[setupStyles.chip, trades.includes(t) && setupStyles.chipActive]}
                onPress={() => toggle(trades, t, setTrades)}
              >
                <Text style={[setupStyles.chipText, trades.includes(t) && setupStyles.chipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={setupStyles.sectionTitle}>Preferred Project Size</Text>
          <View style={setupStyles.chipRow}>
            {SIZE_OPTIONS.map(s => (
              <TouchableOpacity
                key={s}
                style={[setupStyles.chip, preferredSize === s && setupStyles.chipActive]}
                onPress={() => setPreferredSize(s)}
              >
                <Text style={[setupStyles.chipText, preferredSize === s && setupStyles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={setupStyles.sectionTitle}>Certifications</Text>
          <View style={setupStyles.chipRow}>
            {CERTS.map(c => (
              <TouchableOpacity
                key={c}
                style={[setupStyles.chip, certifications.includes(c) && setupStyles.chipActive]}
                onPress={() => toggle(certifications, c, setCertifications)}
              >
                <Text style={[setupStyles.chipText, certifications.includes(c) && setupStyles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={setupStyles.saveBtn} onPress={handleSave}>
            <Text style={setupStyles.saveBtnText}>Save Profile</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const setupStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Tokens.spacing.lg, paddingVertical: Tokens.spacing.md, borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight, backgroundColor: Colors.surface,
  },
  title: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: Colors.text },
  content: { padding: Tokens.spacing.lg, gap: Tokens.spacing.md, paddingBottom: Tokens.spacing['3xl'] },
  sectionTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Tokens.spacing.xs },
  chip: {
    paddingHorizontal: 14, paddingVertical: Tokens.spacing.xs, borderRadius: 20,
    backgroundColor: Colors.fillSecondary, borderWidth: 1, borderColor: Colors.borderLight,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: Type.footnote.fontSize, color: Colors.text, fontWeight: '500' as const },
  chipTextActive: { color: Colors.surface },
  saveBtn: {
    backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: Tokens.radius.card,
    alignItems: 'center', marginTop: Tokens.spacing.xs,
  },
  saveBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.surface },
});

export async function getBidScore(bidId: string, bid: {
  title: string; department: string; estimated_value: number;
  naics_code?: string; set_aside?: string | null; state?: string; description?: string;
}): Promise<BidScoreResult | null> {
  const cacheKey = `bidscore_${bidId}`;
  const cached = await getCachedResult<BidScoreResult>(cacheKey, 24 * 60 * 60 * 1000);
  if (cached) return cached;

  const profile = await getCompanyProfile();
  if (!profile || profile.specialties.length === 0) return null;

  try {
    const result = await scoreBid(bid, profile);
    await setCachedResult(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[AI Bid] Score failed:', err);
    return null;
  }
}
