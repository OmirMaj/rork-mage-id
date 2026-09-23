// app/home-passport.tsx — the Home Passport.
//
// What it is TODAY: a record the GC compiles from HIS OWN jobs at one address —
// warranties, permits, installed model numbers, the maintenance schedule, and
// who did the work — and shares with the homeowner as a copy (plain text via
// the share sheet). It is read from the signed-in contractor's own data on his
// own device. It is NOT an owner-kept record: the owner has no account behind
// it, another contractor's jobs never appear in it, and the portal it could
// otherwise be read through closes 30 days after handover. It used to say it
// "belongs to the OWNER and survives across contractors"; none of that is
// built (Phase 0 honesty pass, 2026-09-23). An owner-side property record is a
// separate, later feature — until it ships, the copy here says what is true.
//
// Supplier names and a trade's direct contact reach the shared copy only for a
// job whose GC switched them on in the closeout binder (utils/passport/
// ownerSharing, read per job by passportJobsFromProjects). Off by default.
//
// Homes are grouped by address (utils/passport groups on project.location), so
// this screen picks the home to show when a user has jobs at more than one.
//
// Client-safe by construction: consumerPassport can never emit the GC's cost,
// markup or margin — enforced by its own tests.

import React, { useEffect, useMemo, useState } from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable, Platform} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, House, Share2 } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { shareText } from '@/utils/shareText';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useCoreData, useFinancialsData, useDocsData, useFieldData, usePreconData } from '@/contexts/ProjectContext';
import { HomePassportCard } from '@/components/passport/HomePassportCard';
import {
  buildConsumerPassport, buildPassportHandoff,
} from '@/utils/passport/consumerPassport';
import {
  passportContractorFromBranding, passportJobsFromProjects, passportExtrasFor,
  type PassportJobExtras,
} from '@/utils/passport/passportInputs';
import { fetchSelectionsForProject } from '@/utils/selectionsEngine';
import { fetchCloseoutBinder } from '@/utils/closeoutBinderEngine';
import { showAlert } from '@/utils/alert';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

/** Group key for "one home" — address string, normalized. */
function homeKey(location?: string): string {
  return (location ?? '').trim().toLowerCase() || 'unknown';
}

export default function HomePassportScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { isDesktop } = useResponsiveLayout();
  const { projects, settings } = useCoreData();
  const { projectPhotos } = useFieldData();
  const { subcontractors } = usePreconData();
  const { invoices, commitments } = useFinancialsData();
  const { warranties, permits } = useDocsData();

  // Homes = distinct project addresses, most jobs first.
  const homes = useMemo(() => {
    const byKey = new Map<string, { label: string; jobs: typeof projects }>();
    for (const p of projects ?? []) {
      const k = homeKey(p.location);
      const entry = byKey.get(k) ?? { label: p.location?.trim() || 'Unknown address', jobs: [] };
      entry.jobs.push(p);
      byKey.set(k, entry);
    }
    return [...byKey.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.jobs.length - a.jobs.length);
  }, [projects]);

  const [selected, setSelected] = useState<string | null>(null);
  const active = homes.find((h) => h.key === selected) ?? homes[0] ?? null;

  // Selections (model numbers / SKUs) and the closeout binder's maintenance
  // schedule are not held in any context — one fetch each per job at this
  // home, the same two the closeout binder makes for its own passport. Keyed
  // by project id; a failed fetch leaves that job's sections empty rather
  // than blocking the rest of the record.
  const activeJobIds = useMemo(() => (active?.jobs ?? []).map((p) => p.id), [active]);
  const activeJobKey = activeJobIds.join('|');
  const [extras, setExtras] = useState<Record<string, PassportJobExtras | undefined>>({});
  useEffect(() => {
    let cancelled = false;
    const ids = activeJobKey ? activeJobKey.split('|') : [];
    void Promise.all(ids.map(async (id) => {
      const [selections, binder] = await Promise.all([
        fetchSelectionsForProject(id).catch(() => []),
        fetchCloseoutBinder(id).catch(() => null),
      ]);
      return [id, { selections, maintenanceSchedule: binder?.maintenanceSchedule ?? null }] as const;
    })).then((rows) => {
      if (cancelled) return;
      setExtras((prev) => ({ ...prev, ...Object.fromEntries(rows) }));
    });
    return () => { cancelled = true; };
  }, [activeJobKey]);

  const passport = useMemo(() => {
    if (!active) return null;
    // Completion dates + the GC ride on each job (audit round 2, #21): without
    // them the record printed no finish date and never named who built it.
    const jobs = passportJobsFromProjects(active.jobs, passportContractorFromBranding(settings?.branding));
    const more = passportExtrasFor(activeJobIds, extras, subcontractors, projectPhotos);
    return buildConsumerPassport({
      projects: jobs,
      warranties: warranties ?? [],
      permits: permits ?? [],
      commitments: commitments ?? [],
      invoices: invoices ?? [],
      selections: more.selections,
      maintenance: more.maintenance,
      subcontractors: more.subcontractors,
      photos: more.photos,
      nowMs: Date.now(),
    });
  }, [active, activeJobIds, extras, settings, subcontractors, projectPhotos, warranties, permits, commitments, invoices]);

  const onShare = async () => {
    if (!passport) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    try {
      await shareText({ message: buildPassportHandoff(passport) });
    } catch {
      showAlert('Could not share', 'Please try again.');
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={t.text} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <House size={15} color={t.accent} strokeWidth={2} />
          <Text style={styles.headerTitle} numberOfLines={1}>Home Passport</Text>
        </View>
        <View style={styles.backBtn} />
      </View>
      {/* What this screen is, in one line, before any of it is shared. */}
      <Text style={styles.headerNote}>
        Compiled from your jobs at this address. Share sends your client a copy.
      </Text>

      <ScrollView
        {...fabScroll}
        contentContainerStyle={[styles.scroll, isDesktop && styles.scrollDesktop, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Address switcher — only when there's more than one home on record. */}
        {homes.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.homeRow}
          >
            {homes.map((h) => {
              const on = h.key === active?.key;
              return (
                <TouchableOpacity
                  key={h.key}
                  style={[styles.homeChip, on && styles.homeChipOn]}
                  onPress={() => setSelected(h.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${h.label}`}
                >
                  <Text style={[styles.homeChipText, on && styles.homeChipTextOn]} numberOfLines={1}>
                    {h.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {passport ? (
          <>
            {/* No onShare into the card: its built-in button reads "Share with
                your next contractor", the homeowner's-record framing this
                screen no longer makes (Phase 0). The GC is the one sharing,
                and he sends his client a copy, so the button says that. */}
            <HomePassportCard
              passport={passport}
              onPressProject={(projectId) =>
                router.push({ pathname: '/project-detail', params: { projectId } } as never)
              }
            />
            <View style={styles.shareWrap}>
              <Pressable
                onPress={() => void onShare()}
                accessibilityRole="button"
                accessibilityLabel="Share a copy with your client"
                testID="passport-share"
                style={({ pressed }) => [styles.shareBtn, pressed ? styles.pressed : null]}
              >
                <Share2 size={Tokens.iconSize.small.size} color={t.accentLabel} strokeWidth={2} />
                <Text style={styles.shareBtnText}>Share a copy with your client</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.empty}>
            <House size={20} color={t.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>Nothing on record yet</Text>
            <Text style={styles.emptyText}>
              As your jobs here are completed, this fills in with the warranties, permits, model numbers
              and maintenance dates from your records, ready to share with your client as a copy.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Tokens.spacing.sm,
      paddingVertical: Tokens.spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
    headerTitle: { ...Type.serifHeadline, color: t.text },
    headerNote: {
      ...Type.caption1,
      color: t.textSecondary,
      textAlign: 'center',
      paddingHorizontal: Tokens.spacing.md,
      paddingTop: Tokens.spacing.xs,
    },
    shareWrap: { paddingHorizontal: Tokens.spacing.md, paddingBottom: Tokens.spacing.lg },
    shareBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Tokens.spacing.xs,
      minHeight: Tokens.touchTarget.min,
      paddingHorizontal: Tokens.spacing.md,
      borderRadius: Tokens.radius.md,
      ...Tokens.continuousCorners,
      borderWidth: 1,
      borderColor: t.accentSoft,
      backgroundColor: t.accentSoft,
    },
    shareBtnText: { ...Type.footnoteEmphasized, color: t.accentLabel },
    pressed: { opacity: 0.6 },
    scroll: { paddingVertical: Tokens.spacing.md, paddingBottom: 40 },
    scrollDesktop: { width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 24 },
    homeRow: { gap: Tokens.spacing.xs, paddingHorizontal: Tokens.spacing.md, paddingBottom: Tokens.spacing.sm },
    homeChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: Tokens.radius.full,
      borderWidth: 1,
      borderColor: t.line,
      backgroundColor: t.surface,
      maxWidth: 240,
    },
    homeChipOn: { backgroundColor: t.accentFill, borderColor: t.accent },
    homeChipText: { ...Type.caption1, color: t.textSecondary, fontWeight: '600' },
    homeChipTextOn: { color: '#FFFFFF' },
    empty: {
      alignItems: 'center',
      gap: 8,
      marginHorizontal: Tokens.spacing.md,
      padding: Tokens.spacing.lg,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
    },
    emptyTitle: { ...Type.subheadEmphasized, color: t.text },
    emptyText: { ...Type.footnote, color: t.textSecondary, textAlign: 'center', lineHeight: 19 },
  });
