// welcome.tsx — Roamy-inspired first-launch screen.
//
// Why a separate screen vs. directly hitting login.tsx:
//   The login.tsx screen is the form-bearing surface (Apple/Google +
//   email + magic link + biometrics). It works but the visual hero is
//   text-only. The Roamy-style "save the spots, we'll plan the trip"
//   pattern is to lead with a tilted-photo collage that does the
//   selling, then show two big sign-in pills. Power users who want
//   the email/password form tap "Sign in with email" and route to
//   login.tsx as before.
//
// Routing:
//   - First-time / unauthenticated users land here (set in
//     app/_layout.tsx auth gate).
//   - Already-authenticated users skip this screen entirely.
//   - Picking Apple or Google calls signInWithApple / signInWithGoogle
//     directly; success → /onboarding (first-time) or /(tabs)/(home)
//     (returning).
//   - Picking "Sign in with email" routes to /login for the existing
//     keyboard-heavy form.
//
// Photos:
//   We use direct Unsplash CDN URLs for the hero collage (free for
//   commercial use under the Unsplash License). Each tile has a slight
//   rotation + offset so they feel hand-stacked rather than grid-laid.
//   Swap PHOTO_URLS[*] with your own bucket assets when you have shots
//   from real MAGE ID jobs.

import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ImageBackground,
  Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface PhotoTile {
  uri: string;
  city: string;
  meta: string;
  rotation: number;
  /** Vertical offset within the column to stagger the stack. */
  offsetY: number;
}

// Hero collage tiles. Six photos spread across three columns —
// matches Roamy's pattern of an off-screen left + on-screen middle
// + off-screen right column with the middle tile dominant.
//
// All Unsplash photos, free under the Unsplash License. Captions are
// city/state pairs that read like project locations a residential GC
// would actually run, not "Bangkok / Thailand" travel destinations.
const PHOTO_URLS: PhotoTile[] = [
  // Top row (3 tiles, peeking from the top)
  { uri: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&q=80', city: 'Austin', meta: 'Custom build', rotation: -6, offsetY: -40 },
  { uri: 'https://images.unsplash.com/photo-1541971297127-c4e9d7c1b3e0?w=400&q=80', city: 'Denver', meta: 'Whole-home reno', rotation: 4, offsetY: -10 },
  { uri: 'https://images.unsplash.com/photo-1448630360428-65456885c650?w=400&q=80', city: 'Charleston', meta: 'Historic restoration', rotation: -3, offsetY: -50 },
  // Bottom row (3 tiles, larger, more centered)
  { uri: 'https://images.unsplash.com/photo-1572177812156-58036aae439c?w=400&q=80', city: 'Brooklyn', meta: 'Brownstone gut', rotation: -5, offsetY: 60 },
  { uri: 'https://images.unsplash.com/photo-1503594384566-461fe158e797?w=400&q=80', city: 'Nashville', meta: 'Kitchen + bath', rotation: 3, offsetY: 40 },
  { uri: 'https://images.unsplash.com/photo-1584622781564-1d987f7333c1?w=400&q=80', city: 'Phoenix', meta: 'Addition + ADU', rotation: -4, offsetY: 80 },
];

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signInWithApple, signInWithGoogle } = useAuth();
  const [appleLoading, setAppleLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleApple = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    setAppleLoading(true);
    try {
      await signInWithApple();
      // Auth state change in _layout's gate redirects to onboarding
      // or home — we don't navigate here directly.
    } catch (err) {
      Alert.alert('Sign in failed', err instanceof Error ? err.message : 'Try again or use email.');
    } finally {
      setAppleLoading(false);
    }
  }, [signInWithApple]);

  const handleGoogle = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      Alert.alert('Sign in failed', err instanceof Error ? err.message : 'Try again or use email.');
    } finally {
      setGoogleLoading(false);
    }
  }, [signInWithGoogle]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Sky-blue gradient backdrop — the Roamy reference uses a
          warm cyan; we tone it slightly cooler so MAGE green
          buttons read clearly against it. */}
      <LinearGradient
        colors={['#A6D7F2', '#C9E6F5', '#E8F2F9']}
        style={StyleSheet.absoluteFill}
      />

      {/* Hero photo collage. Three columns, two rows, tilted. The
          middle column's bottom tile is the dominant focal piece —
          centered, larger, and unrotated. */}
      <View style={[styles.collageWrap, { paddingTop: insets.top + 8 }]} pointerEvents="none">
        <View style={styles.collageRow}>
          {PHOTO_URLS.slice(0, 3).map((p, i) => (
            <CollageTile key={`top-${i}`} photo={p} dominant={i === 1} />
          ))}
        </View>
        <View style={styles.collageRow}>
          {PHOTO_URLS.slice(3, 6).map((p, i) => (
            <CollageTile key={`btm-${i}`} photo={p} dominant={i === 1} />
          ))}
        </View>
        {/* Soft cloud blur on the lower-right of the collage so the
            stack fades into the gradient rather than hard-cutting.
            Pure visual — non-interactive. */}
        <View style={styles.cloudBlur} />
      </View>

      {/* Brand + tagline. The user-visible app name is "MAGE ID" but
          we swap to a softer logotype here to match the welcome
          aesthetic. The tagline tells GCs what the app DOES, in two
          short lines, before they tap any button. */}
      <View style={[styles.brandWrap, { marginBottom: insets.bottom + 28 }]}>
        <Text style={styles.brandLogo}>MAGE</Text>
        <View style={styles.brandLogoUnderline} />
        <Text style={styles.tagline}>Track the work.</Text>
        <Text style={styles.tagline}>We&apos;ll handle the paperwork.</Text>

        <View style={styles.ctaStack}>
          {(Platform.OS === 'ios' || Platform.OS === 'web') && (
            <TouchableOpacity
              style={styles.ctaPill}
              onPress={handleApple}
              disabled={appleLoading || googleLoading}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Continue with Apple"
              testID="welcome-apple"
            >
              {appleLoading ? (
                <ActivityIndicator color={Colors.text} />
              ) : (
                <>
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill={Colors.text}>
                    <Path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                  </Svg>
                  <Text style={styles.ctaPillText}>Continue with Apple</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.ctaPill}
            onPress={handleGoogle}
            disabled={appleLoading || googleLoading}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            testID="welcome-google"
          >
            {googleLoading ? (
              <ActivityIndicator color={Colors.text} />
            ) : (
              <>
                <Svg width={20} height={20} viewBox="0 0 48 48">
                  <Path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#FFC107" />
                  <Path d="M5.3 14.7l7.4 5.4C14.3 16.3 18.8 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 6.1 29.6 4 24 4 16 4 9.2 8.4 5.3 14.7z" fill="#FF3D00" />
                  <Path d="M24 44c5.2 0 10-1.8 13.7-4.9l-6.7-5.5C28.9 35.5 26.6 36.5 24 36.5c-6 0-11.1-4-12.8-9.5l-7.3 5.6C7.8 38.9 15.4 44 24 44z" fill="#4CAF50" />
                  <Path d="M44.5 20H24v8.5h11.8c-1 3-3 5.5-5.8 7.1l6.7 5.5C40.6 37.5 46 31.4 46 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2" />
                </Svg>
                <Text style={styles.ctaPillText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Quiet email path — for users who don't want to use Apple/
            Google or who already have a password. Routes to the
            existing form-heavy login.tsx so we don't duplicate auth
            UI. */}
        <TouchableOpacity
          onPress={() => router.push('/login')}
          style={styles.emailLink}
          accessibilityRole="link"
          accessibilityLabel="Sign in with email"
        >
          <Text style={styles.emailLinkText}>Sign in with email</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CollageTile({ photo, dominant }: { photo: PhotoTile; dominant: boolean }) {
  return (
    <View
      style={[
        styles.tile,
        dominant && styles.tileDominant,
        {
          transform: [
            { translateY: photo.offsetY },
            { rotate: `${photo.rotation}deg` },
          ],
        },
      ]}
    >
      <ImageBackground
        source={{ uri: photo.uri }}
        style={styles.tileImage}
        imageStyle={styles.tileImageInner}
      >
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.55)']}
          style={styles.tileScrim}
        />
        <View style={styles.tileMeta}>
          <Text style={styles.tileCity} numberOfLines={1}>{photo.city}</Text>
          <Text style={styles.tileSub} numberOfLines={1}>{photo.meta}</Text>
        </View>
      </ImageBackground>
    </View>
  );
}

const TILE_WIDTH = 110;
const DOMINANT_WIDTH = 200;
const TILE_HEIGHT = 165;
const DOMINANT_HEIGHT = 250;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#A6D7F2' },

  collageWrap: { paddingHorizontal: 0, paddingBottom: Tokens.spacing.xs },
  collageRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginHorizontal: -32,  // intentional bleed past edges so first/last tiles peek
  },
  tile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: 18,
    overflow: 'hidden' as const,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 6,
  },
  tileDominant: {
    width: DOMINANT_WIDTH,
    height: DOMINANT_HEIGHT,
    borderRadius: 22,
  },
  tileImage: { flex: 1, justifyContent: 'flex-end' as const },
  tileImageInner: { borderRadius: 18 },
  tileScrim: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, height: '60%', borderBottomLeftRadius: 18, borderBottomRightRadius: 18 },
  tileMeta: { padding: 10 },
  tileCity: { color: Colors.surface, fontSize: Type.subhead.fontSize, fontWeight: '800' as const, letterSpacing: -0.2 },
  tileSub: { color: 'rgba(255,255,255,0.85)', fontSize: Type.caption2.fontSize, fontWeight: '600' as const, marginTop: 1 },

  cloudBlur: {
    position: 'absolute' as const,
    bottom: -20,
    right: 20,
    width: 220,
    height: 110,
    borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.55)',
    shadowColor: Colors.surface,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 26,
  },

  brandWrap: {
    marginTop: 'auto' as const,
    paddingHorizontal: Tokens.spacing.xl,
    alignItems: 'center' as const,
  },
  brandLogo: {
    fontSize: 56,
    fontWeight: '900' as const,
    color: Colors.surface,
    letterSpacing: -2,
    textShadowColor: 'rgba(0,0,0,0.15)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  brandLogoUnderline: {
    width: 110,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.surface,
    opacity: 0.85,
    marginTop: Tokens.spacing.xxs,
    marginBottom: Tokens.spacing.sm,
  },
  tagline: {
    fontSize: Type.title3.fontSize,
    fontWeight: '500' as const,
    color: Colors.surface,
    textAlign: 'center' as const,
    letterSpacing: -0.2,
    opacity: 0.95,
  },

  ctaStack: {
    width: '100%',
    marginTop: 28,
    gap: Tokens.spacing.sm,
  },
  ctaPill: {
    minHeight: 56,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 999,
    paddingHorizontal: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  ctaPillText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.2,
  },

  emailLink: { marginTop: 14, paddingVertical: 6 },
  emailLinkText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.surface,
    opacity: 0.9,
    textDecorationLine: 'underline' as const,
  },
});

void Tokens; // keep import live for future style references
