// components/PropertyManagerHome.tsx — home hub for the Property Manager
// persona. Renders inside the (home) tab when userRole === 'property_manager'
// (see app/(tabs)/(home)/index.tsx).
//
// This is a portfolio dashboard: a time-aware greeting + a live one-liner,
// a gradient "Add a property" hero, portfolio stat tiles (properties,
// open work orders, out-for-bids), and a list of managed-property cards
// each showing its open work-order count. Tapping a card opens
// /managed-property. All data is local (PropertyContext) — no network.
//
// Visual language deliberately mirrors ClientHome so the two non-contractor
// personas feel like one product family (same FadeRise entrance, gradient
// hero, stat tiles, card treatment).

import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput,
  Platform, Animated, Easing, KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Plus, Building2, ChevronRight, MapPin, Wrench, ClipboardList, Send,
  Sun, Moon, Sunrise, Sunset, X,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProperties } from '@/contexts/PropertyContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function greetingFor(d: Date = new Date()): { text: string; Icon: React.ComponentType<any> } {
  const h = d.getHours();
  if (h < 6)  return { text: 'Working late', Icon: Moon };
  if (h < 12) return { text: 'Good morning', Icon: Sunrise };
  if (h < 17) return { text: 'Good afternoon', Icon: Sun };
  if (h < 21) return { text: 'Good evening', Icon: Sunset };
  return { text: 'Working late', Icon: Moon };
}

function FadeRise({ delay = 0, children, style }: {
  delay?: number; children: React.ReactNode; style?: any;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 380, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 380, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY, delay]);
  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

export default function PropertyManagerHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { properties, workOrders, addProperty, getOpenWorkOrderCount } = useProperties();

  const [addOpen, setAddOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftAddress, setDraftAddress] = useState('');
  const [draftType, setDraftType] = useState('');

  const totals = useMemo(() => {
    const openWO = workOrders.filter(w => w.status !== 'done' && w.status !== 'cancelled').length;
    const outForBids = workOrders.filter(w => w.status === 'posted_for_bids').length;
    return { properties: properties.length, openWO, outForBids };
  }, [properties.length, workOrders]);

  const subtitle = useMemo(() => {
    if (properties.length === 0) return 'Add your first property to start tracking maintenance.';
    const parts: string[] = [`${properties.length} propert${properties.length === 1 ? 'y' : 'ies'}`];
    if (totals.openWO > 0) parts.push(`${totals.openWO} open work order${totals.openWO === 1 ? '' : 's'}`);
    if (totals.outForBids > 0) parts.push(`${totals.outForBids} out for bids`);
    return parts.join('  ·  ');
  }, [properties.length, totals]);

  const greeting = useMemo(() => greetingFor(), []);
  const firstName = useMemo(() => (user?.name || '').trim().split(/\s+/)[0] || '', [user?.name]);
  const GreetingIcon = greeting.Icon;

  const resetDraft = useCallback(() => { setDraftName(''); setDraftAddress(''); setDraftType(''); }, []);

  const handleAdd = useCallback(() => {
    const name = draftName.trim();
    if (!name) return;
    const created = addProperty({
      name,
      address: draftAddress.trim() || undefined,
      propertyType: draftType.trim() || undefined,
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAddOpen(false);
    resetDraft();
    router.push({ pathname: '/managed-property' as never, params: { propertyId: created.id } as never });
  }, [draftName, draftAddress, draftType, addProperty, router, resetDraft]);

  const isEmpty = properties.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      >
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

        <FadeRise delay={80}>
          <TouchableOpacity onPress={() => setAddOpen(true)} activeOpacity={0.9} testID="pm-home-add-property">
            <View style={[styles.heroCta, { backgroundColor: themeColors.accent }]}>
              <View style={styles.heroCtaBg} pointerEvents="none">
                <Building2 size={140} color="rgba(255,255,255,0.12)" strokeWidth={1.2} />
              </View>
              <View style={styles.heroCtaIcon}>
                <Plus size={20} color="#FFF" strokeWidth={2.6} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroCtaTitle}>Add a property</Text>
                <Text style={styles.heroCtaBody}>
                  Track maintenance, log work orders, and dispatch them to your contractors.
                </Text>
              </View>
              <ChevronRight size={18} color="#FFF" strokeWidth={1.75} />
            </View>
          </TouchableOpacity>
        </FadeRise>

        {!isEmpty && (
          <FadeRise delay={140}>
            <View style={styles.statsRow}>
              <StatTile icon={Building2} label="Properties" value={totals.properties} accent={themeColors.text} lit={totals.properties > 0} />
              <StatTile icon={Wrench} label="Open" value={totals.openWO} accent={themeColors.accent} lit={totals.openWO > 0} />
              <StatTile icon={Send} label="Out for bids" value={totals.outForBids} accent={themeColors.success} lit={totals.outForBids > 0} />
            </View>
          </FadeRise>
        )}

        {isEmpty && (
          <FadeRise delay={200}>
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconWrap}>
                <ClipboardList size={28} color={themeColors.accent} strokeWidth={1.75} />
              </View>
              <Text style={styles.emptyTitle}>Your portfolio starts here</Text>
              <Text style={styles.emptyBody}>
                Add the buildings and units you manage. Every leak, turnover, and service call
                becomes a work order you can track and hand to a contractor in seconds.
              </Text>
            </View>
          </FadeRise>
        )}

        {!isEmpty && (
          <View style={styles.section}>
            <FadeRise delay={180}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Properties</Text>
                <View style={styles.sectionCountPill}>
                  <Text style={styles.sectionCountText}>{properties.length}</Text>
                </View>
              </View>
            </FadeRise>
            {properties.map((p, i) => {
              const openCount = getOpenWorkOrderCount(p.id);
              return (
                <FadeRise key={p.id} delay={220 + i * 60}>
                  <TouchableOpacity
                    style={styles.propCard}
                    onPress={() => router.push({ pathname: '/managed-property' as never, params: { propertyId: p.id } as never })}
                    activeOpacity={0.88}
                    testID={`pm-property-${p.id}`}
                  >
                    <View style={styles.propIcon}>
                      <Building2 size={22} color={themeColors.accent} strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.propName} numberOfLines={1}>{p.name}</Text>
                      {!!p.address && (
                        <View style={styles.propMeta}>
                          <MapPin size={11} color={themeColors.textMuted} strokeWidth={1.75} />
                          <Text style={styles.propMetaText} numberOfLines={1}>{p.address}</Text>
                        </View>
                      )}
                      <Text style={styles.propSub} numberOfLines={1}>
                        {p.propertyType || 'Property'}
                        {openCount > 0 ? `  ·  ${openCount} open work order${openCount === 1 ? '' : 's'}` : '  ·  no open work'}
                      </Text>
                    </View>
                    {openCount > 0 && (
                      <View style={styles.openBadge}><Text style={styles.openBadgeText}>{openCount}</Text></View>
                    )}
                    <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </FadeRise>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Add-property modal — minimal: name (required) + address + type.
          Everything else (owner contact, notes, units) is editable on the
          property detail screen. */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHead}>
              <View style={styles.modalHeadIcon}><Building2 size={16} color="#FFF" strokeWidth={1.75} /></View>
              <Text style={styles.modalTitle}>Add a property</Text>
              <TouchableOpacity onPress={() => { setAddOpen(false); resetDraft(); }} hitSlop={8}>
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.input}
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Maple Court Apartments"
              placeholderTextColor={themeColors.textMuted}
              autoFocus
              testID="pm-add-name"
            />
            <Text style={styles.fieldLabel}>Address</Text>
            <TextInput
              style={styles.input}
              value={draftAddress}
              onChangeText={setDraftAddress}
              placeholder="123 Oak St, Springfield"
              placeholderTextColor={themeColors.textMuted}
            />
            <Text style={styles.fieldLabel}>Type</Text>
            <TextInput
              style={styles.input}
              value={draftType}
              onChangeText={setDraftType}
              placeholder="Single-family rental · 12-unit multifamily · Office"
              placeholderTextColor={themeColors.textMuted}
            />
            <TouchableOpacity
              style={[styles.modalCta, !draftName.trim() && styles.modalCtaDisabled]}
              onPress={handleAdd}
              disabled={!draftName.trim()}
              activeOpacity={0.85}
              testID="pm-add-submit"
            >
              <MageAIMark size={15} color="#FFF" />
              <Text style={styles.modalCtaText}>Add property</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function StatTile({ icon: Icon, label, value, accent, lit }: {
  icon: React.ComponentType<any>; label: string; value: number; accent: string; lit: boolean;
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  header: { marginBottom: 16 },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 },
  greetingIconWrap: { width: 22, height: 22, borderRadius: 11, backgroundColor: t.accent + '14', alignItems: 'center', justifyContent: 'center' },
  greetingEyebrow: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 0.4 },
  title: { fontSize: Type.title1.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.7 },
  subtitle: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.textSecondary, marginTop: 4, lineHeight: 19 },

  heroCta: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 18, borderRadius: Tokens.radius.lg, marginBottom: 18,
    shadowColor: t.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 20, elevation: 6,
    overflow: 'hidden',
  },
  heroCtaBg: { position: 'absolute', right: -28, bottom: -34, transform: [{ rotate: '-8deg' }] },
  heroCtaIcon: {
    width: 40, height: 40, borderRadius: Tokens.radius.md, backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  heroCtaTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: '#FFF', letterSpacing: -0.2 },
  heroCtaBody: { fontSize: Type.caption1.fontSize, fontWeight: '500', color: 'rgba(255,255,255,0.92)', marginTop: 2, lineHeight: 17 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  statTile: {
    flex: 1, backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    paddingTop: 12, paddingBottom: 0, paddingHorizontal: 8, borderWidth: 1, borderColor: t.line,
    alignItems: 'center', overflow: 'hidden',
  },
  statIconWrap: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: t.line + '60',
    alignItems: 'center', justifyContent: 'center', marginBottom: 6, borderColor: t.textMuted,
  },
  statValue: { fontSize: 22, fontWeight: '800', color: t.textMuted, letterSpacing: -0.5, lineHeight: 26 },
  statLabel: { fontSize: 9.5, fontWeight: '800', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 2, marginBottom: 8 },
  statAccentBar: { height: 3, width: '100%', backgroundColor: 'transparent' },

  emptyCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.panel, padding: 28,
    borderWidth: 1, borderColor: t.line, alignItems: 'center', gap: 8, marginTop: 4,
  },
  emptyIconWrap: { width: 64, height: 64, borderRadius: Tokens.radius.xl, backgroundColor: t.accent + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, marginTop: 4 },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.text, textAlign: 'center', lineHeight: 19, maxWidth: 340 },

  section: { marginTop: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginTop: 6 },
  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  sectionCountPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: Tokens.radius.full, backgroundColor: t.accent + '18', minWidth: 26, alignItems: 'center' },
  sectionCountText: { fontSize: 11, fontWeight: '800', color: t.accent, letterSpacing: 0.3 },

  propCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.line, marginBottom: 10,
  },
  propIcon: { width: 44, height: 44, borderRadius: Tokens.radius.md, backgroundColor: t.accent + '12', alignItems: 'center', justifyContent: 'center' },
  propName: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  propMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  propMetaText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' },
  propSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 3, fontWeight: '600' },
  openBadge: { backgroundColor: t.accentFill, borderRadius: Tokens.radius.full, minWidth: 22, height: 22, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  openBadgeText: { fontSize: 11, fontWeight: '800', color: '#FFF' },

  // Add-property modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 34 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center', marginBottom: 14 },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  modalHeadIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text },
  fieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.textMuted, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  modalCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accentFill, paddingVertical: 14, borderRadius: Tokens.radius.card, marginTop: 18,
  },
  modalCtaDisabled: { opacity: 0.5 },
  modalCtaText: { color: '#FFF', fontSize: Type.subhead.fontSize, fontWeight: '800' },
});
