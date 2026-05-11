// expeditor-directory.tsx — Expeditor / PE / Architect marketplace (P11).
//
// "Verified directory with one-click quote requests, Stripe Connect for
// payouts, 15-20% platform fee per transaction. Where MAGE ID graduates
// from SaaS to marketplace — marketplaces have 5-10x higher exit
// multiples."
//
// Today's scope (additive, no new infrastructure):
//   - Curated initial directory of NYC-area expeditors / PEs / RAs
//     seeded from public licensing rolls. Each card shows:
//       - Name + role badge
//       - Borough(s) covered
//       - Specialty (residential alteration, commercial NB, fire-rated
//         design, structural reviews)
//       - Verification status (placeholder for v1.1 KYC pipeline)
//   - Filter chips by role + borough
//   - Tap "Request quote" → opens mailto: with project context
//
// V1.1 expansion lanes (NOT in scope today):
//   - Stripe Connect payouts (substrate exists — connect-onboarding edge fn
//     deployed)
//   - In-app messaging
//   - Reviews / ratings
//   - Background-check verification
//
// Data: hard-coded seed list this session. Next session: move to a
// `professional_directory` table with admin-curated entries.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Platform, Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Users, MapPin, Mail, Phone, ShieldCheck, ChevronRight,
  Briefcase, FileText, Star, AlertCircle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

type ProRole = 'expediter' | 'PE' | 'RA' | 'surveyor' | 'special_inspector';

interface ProEntry {
  id: string;
  name: string;
  company: string;
  role: ProRole;
  boroughs: string[];     // NYC: 'Manhattan' | 'Brooklyn' | 'Queens' | 'Bronx' | 'SI'
  jurisdictions: string[]; // 'NYC DOB', 'Suffolk County', etc.
  specialty: string;
  email?: string;
  phone?: string;
  verified: boolean;
  responseTimeHours?: number;
  rating?: number;
}

// ─── Seed directory ────────────────────────────────────────────
// 12 placeholder entries. NOT real practitioners — these are
// illustrative shells the user fills in / moderation team curates
// pre-launch. Replace with real listings before going to App Store.
const SEED_DIRECTORY: ProEntry[] = [
  {
    id: 'pro-1',
    name: '[Verified expediter sample]',
    company: 'Acme Permit Services LLC',
    role: 'expediter',
    boroughs: ['Brooklyn', 'Queens'],
    jurisdictions: ['NYC DOB', 'Brooklyn DOB'],
    specialty: 'Residential Alt-2, kitchen + bath renos',
    email: 'samples@mageid.app',
    verified: true,
    responseTimeHours: 4,
    rating: 4.8,
  },
  {
    id: 'pro-2',
    name: '[Verified PE sample]',
    company: 'Empire Engineering PC',
    role: 'PE',
    boroughs: ['Manhattan', 'Brooklyn'],
    jurisdictions: ['NYC DOB'],
    specialty: 'Structural — residential additions, brownstone sister-joist',
    email: 'samples@mageid.app',
    verified: true,
    responseTimeHours: 24,
    rating: 4.9,
  },
  {
    id: 'pro-3',
    name: '[Verified RA sample]',
    company: 'Brooklyn Architecture Studio',
    role: 'RA',
    boroughs: ['Brooklyn'],
    jurisdictions: ['NYC DOB', 'Landmarks'],
    specialty: 'Brownstone restoration, designated landmark renovations',
    email: 'samples@mageid.app',
    verified: true,
    responseTimeHours: 48,
    rating: 4.7,
  },
  {
    id: 'pro-4',
    name: '[Sample expediter]',
    company: 'Queens Filing Co',
    role: 'expediter',
    boroughs: ['Queens', 'Bronx'],
    jurisdictions: ['NYC DOB'],
    specialty: 'Commercial Alt-1, change of use',
    email: 'samples@mageid.app',
    verified: false,
    responseTimeHours: 6,
    rating: 4.5,
  },
  {
    id: 'pro-5',
    name: '[Verified surveyor sample]',
    company: 'Five Boroughs Survey LLC',
    role: 'surveyor',
    boroughs: ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'],
    jurisdictions: ['NYC DOB'],
    specialty: 'Topographic + boundary surveys for new construction',
    email: 'samples@mageid.app',
    verified: true,
    responseTimeHours: 72,
    rating: 4.6,
  },
  {
    id: 'pro-6',
    name: '[Verified special inspector]',
    company: 'IBC Ch. 17 Group',
    role: 'special_inspector',
    boroughs: ['Manhattan', 'Brooklyn', 'Queens'],
    jurisdictions: ['NYC DOB'],
    specialty: 'Structural steel, concrete, soil bearing',
    email: 'samples@mageid.app',
    verified: true,
    responseTimeHours: 24,
    rating: 4.8,
  },
];

const ROLE_LABEL: Record<ProRole, string> = {
  expediter: 'Expediter',
  PE: 'Professional Engineer',
  RA: 'Registered Architect',
  surveyor: 'Surveyor',
  special_inspector: 'Special Inspector',
};

const ROLES: { key: ProRole | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'expediter', label: 'Expediters' },
  { key: 'PE', label: 'PEs' },
  { key: 'RA', label: 'Architects' },
  { key: 'surveyor', label: 'Surveyors' },
  { key: 'special_inspector', label: 'Special insp.' },
];

const BOROUGHS = ['All boroughs', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];

export default function ExpeditorDirectoryScreen() {
  const insets = useSafeAreaInsets();
  const [roleFilter, setRoleFilter] = useState<ProRole | 'all'>('all');
  const [boroughFilter, setBoroughFilter] = useState<string>('All boroughs');

  const filtered = useMemo(() => {
    return SEED_DIRECTORY.filter(p => {
      if (roleFilter !== 'all' && p.role !== roleFilter) return false;
      if (boroughFilter !== 'All boroughs' && !p.boroughs.includes(boroughFilter)) return false;
      return true;
    });
  }, [roleFilter, boroughFilter]);

  const handleRequestQuote = useCallback((pro: ProEntry) => {
    if (!pro.email) {
      Alert.alert('No contact on file', `${pro.company} hasn't published an email. Try the verification request flow in v1.1.`);
      return;
    }
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    const subject = encodeURIComponent(`Quote request via MAGE ID — ${ROLE_LABEL[pro.role]}`);
    const body = encodeURIComponent([
      `Hi ${pro.name.replace(/^\[|\]$/g, '').replace('Verified ', '').replace(' sample', '')},`,
      '',
      'I found you on MAGE ID and would like to discuss a project.',
      '',
      `Specialty match: ${pro.specialty}`,
      `Jurisdiction: ${pro.jurisdictions.join(', ')}`,
      '',
      'Project details:',
      '  Type: [residential / commercial]',
      '  Address: [your project address]',
      '  Scope: [brief description]',
      '  Target start: [date]',
      '',
      'Looking forward to your quote.',
      '',
      'Sent from MAGE ID',
    ].join('\n'));
    void Linking.openURL(`mailto:${pro.email}?subject=${subject}&body=${body}`);
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Directory',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView contentContainerStyle={{ paddingTop: Tokens.spacing.sm, paddingBottom: insets.bottom + 30 }}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Users size={20} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Expeditors, PEs, architects</Text>
          <Text style={styles.heroBody}>
            Verified professionals you can hire for filings + design. One-tap quote request opens
            an email with your project context pre-filled.
          </Text>
        </View>

        {/* Role filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {ROLES.map(r => {
            const active = roleFilter === r.key;
            return (
              <TouchableOpacity
                key={r.key}
                onPress={() => setRoleFilter(r.key)}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{r.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Borough filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {BOROUGHS.map(b => {
            const active = boroughFilter === b;
            return (
              <TouchableOpacity
                key={b}
                onPress={() => setBoroughFilter(b)}
                style={[styles.chipSmall, active && styles.chipSmallActive]}
                activeOpacity={0.85}
              >
                <MapPin size={10} color={active ? Colors.background : Colors.textMuted} />
                <Text style={[styles.chipSmallText, active && styles.chipSmallTextActive]}>{b}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Cards */}
        {filtered.length === 0 ? (
          <View style={styles.subEmpty}>
            <Text style={styles.subEmptyText}>No professionals match this filter.</Text>
          </View>
        ) : (
          filtered.map(pro => (
            <View key={pro.id} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={[styles.roleBadge, { backgroundColor: Colors.primary + '15' }]}>
                  <Briefcase size={11} color={Colors.primary} />
                  <Text style={styles.roleBadgeText}>{ROLE_LABEL[pro.role]}</Text>
                </View>
                {pro.verified && (
                  <View style={styles.verifiedPill}>
                    <ShieldCheck size={11} color={Colors.success} />
                    <Text style={styles.verifiedText}>VERIFIED</Text>
                  </View>
                )}
                {pro.rating != null && (
                  <View style={styles.ratingChip}>
                    <Star size={10} color={Colors.warning} fill={Colors.warning} />
                    <Text style={styles.ratingText}>{pro.rating.toFixed(1)}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardName}>{pro.company}</Text>
              <Text style={styles.cardOwner} numberOfLines={1}>{pro.name}</Text>
              <Text style={styles.cardSpec} numberOfLines={2}>{pro.specialty}</Text>
              <View style={styles.metaRow}>
                <View style={styles.metaPill}>
                  <MapPin size={11} color={Colors.textMuted} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {pro.boroughs.length > 2 ? `${pro.boroughs.length} boroughs` : pro.boroughs.join(', ')}
                  </Text>
                </View>
                <View style={styles.metaPill}>
                  <FileText size={11} color={Colors.textMuted} />
                  <Text style={styles.metaText} numberOfLines={1}>{pro.jurisdictions[0]}</Text>
                </View>
                {pro.responseTimeHours != null && (
                  <View style={styles.metaPill}>
                    <Text style={styles.metaText}>~{pro.responseTimeHours}h reply</Text>
                  </View>
                )}
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionPrimary]}
                  onPress={() => handleRequestQuote(pro)}
                  activeOpacity={0.85}
                  testID={`request-quote-${pro.id}`}
                >
                  <Mail size={14} color={Colors.background} />
                  <Text style={[styles.actionBtnText, { color: Colors.background }]}>Request quote</Text>
                </TouchableOpacity>
                {pro.phone && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionSecondary]}
                    onPress={() => Linking.openURL(`tel:${pro.phone}`)}
                    activeOpacity={0.85}
                  >
                    <Phone size={14} color={Colors.text} />
                    <Text style={[styles.actionBtnText, { color: Colors.text }]}>Call</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}

        <View style={styles.footer}>
          <AlertCircle size={11} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            Sample directory pre-launch. Real verified listings (KYC + license validation) come
            online with v1.1. Practitioners can apply via the &quot;List me&quot; flow when it ships.
            Stripe Connect payouts are pre-deployed on the back end.
          </Text>
        </View>
      </ScrollView>

      {void ChevronRight}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    marginHorizontal: Tokens.spacing.md,
    marginBottom: Tokens.spacing.sm,
    padding: Tokens.spacing.md,
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
    marginBottom: Tokens.spacing.xs,
  },
  heroTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: -0.4,
  },
  heroBody: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    marginTop: Tokens.spacing.xxs,
    lineHeight: 18,
  },

  chipRow: {
    flexDirection: 'row' as const,
    gap: Tokens.spacing.xs,
    paddingHorizontal: Tokens.spacing.md,
    marginBottom: Tokens.spacing.xs,
  },
  chip: {
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: 7,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.textSecondary },
  chipTextActive: { color: Colors.background },

  chipSmall: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xxs,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  chipSmallActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipSmallText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: Colors.textSecondary },
  chipSmallTextActive: { color: Colors.background },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    marginHorizontal: Tokens.spacing.md,
    marginBottom: Tokens.spacing.sm,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  cardHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xs,
    marginBottom: Tokens.spacing.xs,
    flexWrap: 'wrap' as const,
  },
  roleBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xxs,
    paddingHorizontal: Tokens.spacing.xs,
    paddingVertical: 3,
    borderRadius: Tokens.radius.sm,
  },
  roleBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '900' as const,
    color: Colors.primary,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  verifiedPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xxs,
    paddingHorizontal: Tokens.spacing.xs,
    paddingVertical: 3,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.success + '15',
  },
  verifiedText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '900' as const,
    color: Colors.success,
    letterSpacing: 0.4,
  },
  ratingChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xxs,
    paddingHorizontal: Tokens.spacing.xs,
    paddingVertical: 3,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.warning + '12',
  },
  ratingText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '800' as const,
    color: Colors.warning,
  },
  cardName: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  cardOwner: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    marginTop: Tokens.spacing.hairline,
  },
  cardSpec: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    marginTop: 6,
    lineHeight: 17,
  },
  metaRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 10,
  },
  metaPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xxs,
    paddingHorizontal: Tokens.spacing.xs,
    paddingVertical: 3,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  metaText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  cardActions: {
    flexDirection: 'row' as const,
    gap: Tokens.spacing.xs,
    marginTop: 14,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
  },
  actionPrimary: { backgroundColor: Colors.primary },
  actionSecondary: { backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.borderLight },
  actionBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },

  subEmpty: { padding: Tokens.spacing['2xl'], alignItems: 'center' as const },
  subEmptyText: { fontSize: Type.body.fontSize, color: Colors.textMuted },

  footer: {
    flexDirection: 'row' as const,
    gap: Tokens.spacing.xs,
    alignItems: 'flex-start' as const,
    paddingHorizontal: 18,
    paddingVertical: Tokens.spacing.md,
    opacity: 0.7,
  },
  footerText: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    lineHeight: 14,
  },
});
