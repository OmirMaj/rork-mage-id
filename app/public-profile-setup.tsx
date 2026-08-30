import React, { useCallback, useMemo, useState } from 'react';
import {View, Text, StyleSheet, ScrollView, TextInput, Switch, TouchableOpacity, Platform} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Globe, Copy, Send, Eye, Quote,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import type { PublicProfileSettings } from '@/types';
import {
  buildPublicProfileSnapshot, buildPublicProfileUrl, slugify,
} from '@/utils/publicProfileSnapshot';
import { shareText } from '@/utils/shareText';
import { formatMoney } from '@/utils/formatters';
import { copyToClipboard } from '@/utils/clipboard';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

const PUBLIC_BASE = 'https://mageid.app/builders';

export default function PublicProfileSetupScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getProject, updateProject, settings, getPhotosForProject } = useProjects();

  const project = useMemo(() => id ? getProject(id) : undefined, [id, getProject]);
  const photos = useMemo(() => id ? getPhotosForProject(id) : [], [id, getPhotosForProject]);

  const [profile, setProfile] = useState<PublicProfileSettings>(() => {
    return project?.publicProfile ?? {
      enabled: false,
      slug: slugify(project?.name),
      publicHeadline: '',
      publicBody: '',
    };
  });

  const persist = useCallback((updates: Partial<PublicProfileSettings>) => {
    if (!id || !project) return;
    const next: PublicProfileSettings = { ...profile, ...updates };
    setProfile(next);
    updateProject(id, { publicProfile: next });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [id, project, profile, updateProject]);

  const snapshot = useMemo(() => {
    if (!project) return null;
    return buildPublicProfileSnapshot({
      project: { ...project, publicProfile: profile },
      settings,
      photos,
    });
  }, [project, profile, settings, photos]);

  const publicUrl = useMemo(() => {
    if (!snapshot) return '';
    const companySlug = slugify(settings?.branding?.companyName);
    return buildPublicProfileUrl(PUBLIC_BASE, companySlug, snapshot.project.slug, snapshot);
  }, [snapshot, settings?.branding?.companyName]);

  const handleCopy = useCallback(async () => {
    if (!publicUrl) return;
    const ok = await copyToClipboard(publicUrl);
    if (Platform.OS !== 'web' && ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(
      ok ? 'Copied' : 'Copy failed',
      ok ? 'The public profile link has been copied.' : 'Could not copy the link.',
    );
  }, [publicUrl]);

  const handleShare = useCallback(async () => {
    if (!publicUrl) return;
    try {
      await shareText({
        message: `Check out our recent project: ${project?.name}\n\n${publicUrl}`,
        url: publicUrl,
      });
      persist({ publishedAt: new Date().toISOString() });
    } catch { /* user cancelled */ }
  }, [publicUrl, project, persist]);

  if (!project) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Public Profile' }} />
        <Text style={styles.muted}>Project not found.</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Public Profile',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back">
              <ChevronLeft size={24} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        {...fabScroll}
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Globe size={20} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={styles.heroEyebrow}>Free portfolio page</Text>
          <Text style={styles.heroTitle}>{project.name}</Text>
          <Text style={styles.heroBody}>
            Showcase this project on a public page at{' '}
            <Text style={{ color: themeColors.accent, fontWeight: '700' }}>
              mageid.app/builders/…/{profile.slug || slugify(project.name)}
            </Text>{' '}
            — perfect to link from your website, Google Business profile, or send to prospective clients.
          </Text>
        </View>

        {/* Toggle */}
        <View style={styles.section}>
          <View style={styles.togglesCard}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleLeft}>
                <MageAIMark size={18} color={themeColors.accent} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>Publish project page</Text>
                  <Text style={styles.toggleDesc}>Anyone with the link can view it; you can unpublish anytime.</Text>
                </View>
              </View>
              <Switch
                value={profile.enabled}
                onValueChange={val => persist({ enabled: val, publishedAt: val ? new Date().toISOString() : profile.publishedAt })}
                trackColor={{ false: themeColors.line, true: themeColors.accent }}
                thumbColor="#FFF"
              />
            </View>
          </View>
        </View>

        {profile.enabled && (
          <>
            {/* Share link */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Share link</Text>
              <View style={styles.linkBox}>
                <Globe size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={styles.linkText} numberOfLines={1}>{publicUrl}</Text>
              </View>
              <View style={styles.shareRow}>
                <TouchableOpacity style={styles.shareBtn} onPress={handleCopy}>
                  <Copy size={16} color={themeColors.text} strokeWidth={1.75} />
                  <Text style={styles.shareBtnText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.shareBtn, styles.shareBtnPrimary]} onPress={handleShare}>
                  <Send size={16} color="#FFF" strokeWidth={1.75} />
                  <Text style={[styles.shareBtnText, { color: '#FFF' }]}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.shareBtn}
                  onPress={() => publicUrl && Platform.OS === 'web' && (window as unknown as { open: (url: string, target: string) => void }).open(publicUrl, '_blank')}
                >
                  <Eye size={16} color={themeColors.text} strokeWidth={1.75} />
                  <Text style={styles.shareBtnText}>Preview</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Headline + body */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Public copy</Text>
              <Text style={styles.label}>Headline</Text>
              <TextInput
                style={styles.input}
                value={profile.publicHeadline ?? ''}
                onChangeText={v => persist({ publicHeadline: v })}
                placeholder="e.g. Brownstone gut renovation, Park Slope"
                placeholderTextColor={themeColors.textMuted}
              />
              <Text style={[styles.label, { marginTop: 12 }]}>Story (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={profile.publicBody ?? ''}
                onChangeText={v => persist({ publicBody: v })}
                placeholder="A few sentences about scope, design challenges, or what made this project special."
                placeholderTextColor={themeColors.textMuted}
                multiline
              />
            </View>

            {/* Slug */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>URL slug</Text>
              <Text style={styles.sectionSubtitle}>Lowercase, hyphens only — keeps the link friendly.</Text>
              <TextInput
                style={styles.input}
                value={profile.slug ?? ''}
                onChangeText={v => persist({ slug: slugify(v) })}
                placeholder={slugify(project.name)}
                placeholderTextColor={themeColors.textMuted}
                autoCapitalize="none"
              />
            </View>

            {/* Testimonial */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Client testimonial (optional)</Text>
              <Text style={styles.sectionSubtitle}>Shows up as a pull-quote on the public page if you fill both.</Text>
              <View style={styles.quoteRow}>
                <Quote size={14} color={themeColors.accent} strokeWidth={1.75} />
                <TextInput
                  style={[styles.input, styles.inputMulti, { flex: 1 }]}
                  value={profile.testimonialQuote ?? ''}
                  onChangeText={v => persist({ testimonialQuote: v })}
                  placeholder='"They were on time, clean, and called the shots before we even knew to ask."'
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                />
              </View>
              <TextInput
                style={[styles.input, { marginTop: 8 }]}
                value={profile.testimonialAuthor ?? ''}
                onChangeText={v => persist({ testimonialAuthor: v })}
                placeholder="— Sarah Patel, Owner"
                placeholderTextColor={themeColors.textMuted}
              />
            </View>

            {/* Stats preview */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Stats shown publicly</Text>
              {[
                { key: 'value' as const, label: 'Contract value', value: snapshot?.project.contractValue ? formatMoney(snapshot.project.contractValue) : '—' },
                { key: 'duration' as const, label: 'Duration', value: snapshot?.project.durationDays ? `${snapshot.project.durationDays} days` : '—' },
                { key: 'sqft' as const, label: 'Square footage', value: project.squareFootage ? project.squareFootage.toLocaleString() + ' sf' : '—' },
              ].map(stat => {
                const isHidden = (profile.hideStats ?? []).includes(stat.key);
                return (
                  <View key={stat.key} style={styles.statRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.statLabel}>{stat.label}</Text>
                      <Text style={[styles.statValue, isHidden && { color: themeColors.textMuted, textDecorationLine: 'line-through' }]}>{stat.value}</Text>
                    </View>
                    <Switch
                      value={!isHidden}
                      onValueChange={val => {
                        const set = new Set(profile.hideStats ?? []);
                        if (val) set.delete(stat.key); else set.add(stat.key);
                        persist({ hideStats: Array.from(set) });
                      }}
                      trackColor={{ false: themeColors.line, true: themeColors.accent }}
                      thumbColor="#FFF"
                    />
                  </View>
                );
              })}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Photos</Text>
              <Text style={styles.sectionSubtitle}>
                {photos.length > 0
                  ? `Showing the ${Math.min(photos.length, 18)} most recent photos by default.`
                  : 'Add photos to this project to populate the public page.'}
              </Text>
              <Text style={styles.muted}>
                Tip: take strong before/after shots — the public page renders them as a gallery.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: t.textMuted, fontSize: Type.footnote.fontSize, lineHeight: 18, fontStyle: 'italic' },

  hero: {
    margin: 16, padding: 18, borderRadius: Tokens.radius.panel,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '20',
  },
  heroIcon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroEyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', letterSpacing: 1.5, color: t.accent, textTransform: 'uppercase', marginBottom: 4 },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, marginBottom: 8 },
  heroBody: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },

  section: { marginHorizontal: 16, marginBottom: 22 },
  sectionTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: Type.footnote.fontSize, color: t.textMuted, marginBottom: 10, lineHeight: 18 },

  togglesCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, overflow: 'hidden',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  toggleLabels: { flex: 1 },
  toggleLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },
  toggleDesc: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 1 },

  label: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  input: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  inputMulti: { minHeight: 90, textAlignVertical: 'top' as const },

  linkBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: t.line, marginBottom: 10,
  },
  linkText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text },
  shareRow: { flexDirection: 'row', gap: 8 },
  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  shareBtnPrimary: { backgroundColor: t.accentFill, borderColor: t.accent },
  shareBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },

  quoteRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },

  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  statLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  statValue: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text },
});
