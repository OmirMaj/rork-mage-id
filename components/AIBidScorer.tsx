import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal,
  ScrollView, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { X, CheckCircle2, Settings } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { saveCompanyProfile, type CompanyAIProfile } from '@/utils/aiService';

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
      <MageAIMark size={10} color={badge.color} />
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
  const { colors: themeColors } = useTheme();
  // Built per theme rather than at module load: this sheet's StyleSheet used to
  // be module-scope, so `Colors.text` / `Colors.surface` baked their LIGHT
  // values once at import and dark mode painted near-black ink on the dark
  // container this component already themed inline (audit 2026-09-07).
  const setupStyles = useThemedStyles(makeSetupStyles);
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
      <View style={[setupStyles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
        <View style={setupStyles.header}>
          <Text style={setupStyles.title}>Company AI Profile</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={themeColors.textSecondary} strokeWidth={1.75} /></TouchableOpacity>
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

const makeSetupStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5,
    borderBottomColor: t.line, backgroundColor: t.surface,
  },
  title: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
  },
  // accentFill, not the brand hue: white on #FF6A1A is 2.87:1 and fails AA —
  // #BC440C clears it at 5.29:1 (founder decision #1, constants/colors.ts).
  chipActive: { backgroundColor: t.accentFill, borderColor: t.accentFill },
  chipText: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '500' as const },
  // textOnAccent, not the themed `surface` — a dark-theme surface here would
  // put near-black text on the orange chip.
  chipTextActive: { color: Colors.textOnAccent, fontWeight: '600' as const },
  saveBtn: {
    backgroundColor: t.accentFill, paddingVertical: 14, borderRadius: Tokens.radius.card,
    alignItems: 'center', marginTop: 8,
  },
  saveBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
});

// NOTE: an uncalled getBidScore(bidId, bid) helper used to live here. It
// wrote the same `bidscore_` cache namespace as AIBidScorecard WITHOUT the
// facts/profile salt (any future caller would silently poison the grounded
// cache) and scored without bid-history facts. Deleted — score through
// AIBidScorecard, which owns the salted cache key.
