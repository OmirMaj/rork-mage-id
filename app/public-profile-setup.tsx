import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Switch,
  TouchableOpacity, Alert, Platform, Share, Clipboard,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Globe, Copy, Send, Sparkles, Eye, Quote,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { PublicProfileSettings } from '@/types';
import {
  buildPublicProfileSnapshot, buildPublicProfileUrl, slugify,
} from '@/utils/publicProfileSnapshot';
import { formatMoney } from '@/utils/formatters';

const PUBLIC_BASE = 'https://mageid.app/builders';

export default function PublicProfileSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  const handleCopy = useCallback(() => {
    if (!publicUrl) return;
    Clipboard.setString(publicUrl);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied', 'The public profile link has been copied.');
  }, [publicUrl]);

  const handleShare = useCallback(async () => {
    if (!publicUrl) return;
    try {
      await Share.share({
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
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }}>
              <ChevronLeft size={24} color={Colors.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Globe size={20} color={Colors.primary} />
          </View>
          <Text style={styles.heroEyebrow}>Free portfolio page</Text>
          <Text style={styles.heroTitle}>{project.name}</Text>
          <Text style={styles.heroBody}>
            Showcase this project on a public page at{' '}
            <Text style={{ color: Colors.primary, fontWeight: '700' }}>
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
                <Sparkles size={18} color={Colors.primary} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>Publish project page</Text>
                  <Text style={styles.toggleDesc}>Anyone with the link can view it; you can unpublish anytime.</Text>
                </View>
              </View>
              <Switch
                value={profile.enabled}
                onValueChange={val => persist({ enabled: val, publishedAt: val ? new Date().toISOString() : profile.publishedAt })}
                trackColor={{ false: Colors.border, true: Colors.primary }}
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
                <Globe size={14} color={Colors.textMuted} />
                <Text style={styles.linkText} numberOfLines={1}>{publicUrl}</Text>
              </View>
              <View style={styles.shareRow}>
                <TouchableOpacity style={styles.shareBtn} onPress={handleCopy}>
                  <Copy size={16} color={Colors.text} />
                  <Text style={styles.shareBtnText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.shareBtn, styles.shareBtnPrimary]} onPress={handleShare}>
                  <Send size={16} color="#FFF" />
                  <Text style={[styles.shareBtnText, { color: '#FFF' }]}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.shareBtn}
                  onPress={() => publicUrl && Platform.OS === 'web' && (window as unknown as { open: (url: string, target: string) => void }).open(publicUrl, '_blank')}
                >
                  <Eye size={16} color={Colors.text} />
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
                placeholderTextColor={Colors.textMuted}
              />
              <Text style={[styles.label, { marginTop: 12 }]}>Story (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={profile.publicBody ?? ''}
                onChangeText={v => persist({ publicBody: v })}
                placeholder="A few sentences about scope, design challenges, or what made this project special."
                placeholderTextColor={Colors.textMuted}
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
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
              />
            </View>

            {/* Testimonial */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Client testimonial (optional)</Text>
              <Text style={styles.sectionSubtitle}>Shows up as a pull-quote on the public page if you fill both.</Text>
              <View style={styles.quoteRow}>
                <Quote size={14} color={Colors.primary} />
                <TextInput
                  style={[styles.input, styles.inputMulti, { flex: 1 }]}
                  value={profile.testimonialQuote ?? ''}
                  onChangeText={v => persist({ testimonialQuote: v })}
                  placeholder='"They were on time, clean, and called the shots before we even knew to ask."'
                  placeholderTextColor={Colors.textMuted}
                  multiline
                />
              </View>
              <TextInput
                style={[styles.input, { marginTop: 8 }]}
                value={profile.testimonialAuthor ?? ''}
                onChangeText={v => persist({ testimonialAuthor: v })}
                placeholder="— Sarah Henderson, Owner"
                placeholderTextColor={Colors.textMuted}
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
                      <Text style={[styles.statValue, isHidden && { color: Colors.textMuted, textDecorationLine: 'line-through' }]}>{stat.value}</Text>
                    </View>
                    <Switch
                      value={!isHidden}
                      onValueChange={val => {
                        const set = new Set(profile.hideStats ?? []);
                        if (val) set.delete(stat.key); else set.add(stat.key);
                        persist({ hideStats: Array.from(set) });
                      }}
                      trackColor={{ false: Colors.border, true: Colors.primary }}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: Colors.textMuted, fontSize: 13, lineHeight: 18, fontStyle: 'italic' },

  hero: {
    margin: 16, padding: 18, borderRadius: 16,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1, borderColor: Colors.primary + '20',
  },
  heroIcon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: Colors.primary, textTransform: 'uppercase', marginBottom: 4 },
  heroTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  heroBody: { fontSize: 13, color: Colors.text, lineHeight: 19 },

  section: { marginHorizontal: 16, marginBottom: 22 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, color: Colors.textMuted, marginBottom: 10, lineHeight: 18 },

  togglesCard: {
    backgroundColor: Colors.card, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  toggleLabels: { flex: 1 },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },
  toggleDesc: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },

  label: { fontSize: 12, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  input: {
    backgroundColor: Colors.card, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 14, color: Colors.text,
  },
  inputMulti: { minHeight: 90, textAlignVertical: 'top' as const },

  linkBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.card, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 10,
  },
  linkText: { flex: 1, fontSize: 12, color: Colors.text },
  shareRow: { flexDirection: 'row', gap: 8 },
  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  shareBtnPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  shareBtnText: { fontSize: 14, fontWeight: '700', color: Colors.text },

  quoteRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },

  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  statLabel: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  statValue: { fontSize: 16, fontWeight: '700', color: Colors.text },
});
