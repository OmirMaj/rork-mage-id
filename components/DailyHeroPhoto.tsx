// DailyHeroPhoto — the signature Home-tab moment.
//
// What it is: a cinematic, edge-to-edge hero card at the top of the
// Home tab that surfaces the most recent jobsite photo with a Fraunces
// serif overlay. The brand voice that lives in onboarding + marketing
// now greets the user every time they open the app.
//
// Why it exists: pre-fix the Home tab opened to a generic iOS-style
// stat strip + project list. Nothing said "MAGE ID" — it could have
// been any construction app. The frontend-design audit flagged this
// as the single biggest opportunity to make the app *memorable*.
//
// Design moves:
//   - Edge-to-edge photo (expo-image for perf)
//   - Subtle Ken Burns scale (1.05 → 1.0 over 6s) so it's alive, not flat
//   - Bottom-up dark gradient scrim for text legibility
//   - Mono eyebrow (amber) → Fraunces project name → footnote context
//   - Mount fade + slide for premium "lay it down" feel
//
// Empty state: when there are no photos, render NOTHING. Don't
// inject a placeholder. The screen stays quiet for first-time users;
// the moment earns itself once real content arrives.

import React, { useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Platform,
  type GestureResponderEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useProjects } from '@/contexts/ProjectContext';
import type { ProjectPhoto, Project } from '@/types';

function formatEyebrow(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return 'JOBSITE';
  const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const hour = d.getHours();
  const part = hour < 12 ? 'MORNING' : hour < 17 ? 'AFTERNOON' : 'EVENING';
  // Compute relative day so today/yesterday read more naturally than the weekday.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const photoDay = new Date(d);
  photoDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - photoDay.getTime()) / 86_400_000);
  if (diffDays === 0) return `TODAY · ${part}`;
  if (diffDays === 1) return `YESTERDAY · ${part}`;
  if (diffDays < 7)   return `${day} · ${part}`;
  // Older — show date in mono format
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

interface DailyHeroProps {
  /** Override the auto-selected photo. Mostly for testing. */
  forcePhoto?: ProjectPhoto;
}

export default function DailyHeroPhoto({ forcePhoto }: DailyHeroProps) {
  const router = useRouter();
  const { projectPhotos: photos, projects } = useProjects();

  // Pick the single most recent photo across all projects. We use
  // `timestamp` (when the photo was taken) rather than `createdAt`
  // (when it was synced) — supers care about jobsite recency, not
  // upload recency. Photos without a parseable timestamp fall to the
  // bottom of the sort.
  const featured = useMemo<{ photo: ProjectPhoto; project?: Project } | null>(() => {
    if (forcePhoto) {
      return { photo: forcePhoto, project: projects.find(p => p.id === forcePhoto.projectId) };
    }
    if (!photos || photos.length === 0) return null;
    // Filter to photos that have a usable URI. Local file://, http(s), and
    // expo-image-compatible content:// all qualify; data URIs work too.
    const usable = photos.filter((p: ProjectPhoto) => !!p.uri && p.uri.length > 8);
    if (usable.length === 0) return null;
    const sorted = [...usable].sort((a, b) => {
      const ta = Date.parse(a.timestamp ?? a.createdAt ?? '');
      const tb = Date.parse(b.timestamp ?? b.createdAt ?? '');
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });
    const top = sorted[0];
    return { photo: top, project: projects.find(p => p.id === top.projectId) };
  }, [photos, projects, forcePhoto]);

  // Mount animations — slide + fade + Ken Burns zoom on the photo.
  // Driven by Animated; no Reanimated dep so this composes with the
  // existing Home-tab scroll handling without conflicts.
  const enter = useRef(new Animated.Value(0)).current;
  const ken = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!featured) return;
    enter.setValue(0);
    ken.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 520,
      easing: Easing.bezier(0.16, 1, 0.3, 1), // brand decelerate curve
      useNativeDriver: true,
    }).start();
    Animated.timing(ken, {
      toValue: 1,
      duration: 6800,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [featured, enter, ken]);

  // Tap routes to the project detail (the most useful destination
  // from a hero photo — gives the user the photo's full project
  // context). If no project is found, fall back to the photo triage
  // surface.
  const handlePress = (_e: GestureResponderEvent) => {
    if (!featured) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (featured.project) {
      router.push({ pathname: '/project-detail', params: { id: featured.project.id } } as never);
    } else {
      router.push('/photo-triage' as never);
    }
  };

  if (!featured) return null;

  const { photo, project } = featured;
  const titleLine = project?.name ?? photo.location ?? 'Jobsite';
  const subContext = (() => {
    const bits: string[] = [];
    if (photo.location) bits.push(photo.location);
    else if (photo.locationLabel) bits.push(photo.locationLabel);
    if (photo.tag) bits.push(photo.tag);
    if (photo.linkedTaskName) bits.push(photo.linkedTaskName);
    if (bits.length === 0 && project?.location) bits.push(project.location);
    return bits.slice(0, 2).join(' · ');
  })();

  const translate = enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const kenScale = ken.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1.0] });

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { opacity: enter, transform: [{ translateY: translate }] },
      ]}
      testID="daily-hero-photo"
    >
      <TouchableOpacity activeOpacity={0.92} onPress={handlePress}>
        <View style={styles.card}>
          <Animated.View style={[styles.imageWrap, { transform: [{ scale: kenScale }] }]}>
            <Image
              source={{ uri: photo.uri }}
              style={styles.image}
              contentFit="cover"
              transition={200}
              recyclingKey={photo.id}
              placeholder={undefined}
            />
          </Animated.View>

          {/* Gradient scrim — pure-View stack so we don't need a
              separate linear-gradient package on this surface. Three
              stacked translucent ink fills produce a believable
              gradient from transparent (top) → 60% ink (bottom). */}
          <View pointerEvents="none" style={styles.scrimStack}>
            <View style={[styles.scrim, { backgroundColor: 'rgba(11,13,16,0.0)', top: 0, bottom: '55%' }]} />
            <View style={[styles.scrim, { backgroundColor: 'rgba(11,13,16,0.30)', top: '55%', bottom: '30%' }]} />
            <View style={[styles.scrim, { backgroundColor: 'rgba(11,13,16,0.62)', top: '70%', bottom: 0 }]} />
          </View>

          {/* Tap affordance — top right corner chevron in a cream pill */}
          <View style={styles.tapHint}>
            <ChevronRight size={14} color={Colors.cream} />
          </View>

          {/* Bottom text stack — eyebrow, serif title, sub context */}
          <View style={styles.textStack}>
            <Text style={styles.eyebrow} numberOfLines={1}>
              {formatEyebrow(photo.timestamp || photo.createdAt)}
            </Text>
            <Text style={styles.title} numberOfLines={2}>{titleLine}</Text>
            {!!subContext && (
              <Text style={styles.subContext} numberOfLines={1}>{subContext}</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  card: {
    height: 220,
    borderRadius: Tokens.radius.panel,
    overflow: 'hidden' as const,
    backgroundColor: Colors.ink,
    position: 'relative' as const,
    // Premium card shadow — bigger than the design-token defaults
    // because the hero is meant to feel weightier than ordinary cards.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 6,
  },
  imageWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  image: {
    width: '100%' as const,
    height: '100%' as const,
  },
  scrimStack: { ...StyleSheet.absoluteFillObject },
  scrim: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
  },
  tapHint: {
    position: 'absolute' as const,
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(11,13,16,0.45)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: 'rgba(244,239,230,0.18)',
  },
  textStack: {
    position: 'absolute' as const,
    left: 18,
    right: 60, // leave room for the tap chevron
    bottom: 16,
    gap: 4,
  },
  eyebrow: {
    ...Type.monoSm,
    color: Colors.accent,
    fontWeight: '600' as const,
    letterSpacing: 1.4,
  },
  title: {
    ...Type.displaySm,
    color: Colors.cream,
    // Subtle dark text-shadow so the serif holds against varied photo
    // brightness without needing a stronger scrim that would mute the
    // image. Premium hero pattern (Apple Music album cards do this).
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  subContext: {
    fontSize: Type.footnote.fontSize,
    color: 'rgba(244,239,230,0.78)',
    fontWeight: '500' as const,
    marginTop: 2,
  },
});
