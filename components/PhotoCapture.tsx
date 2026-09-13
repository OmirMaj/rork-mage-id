// components/PhotoCapture.tsx — burst photo capture for field screens.
//
// WHY THIS EXISTS (app-experience audit 2026-09-07, "worth doing" #35).
// All sixteen `launchCameraAsync` calls in this repo are one-shot. A punch walk
// with twenty defects is therefore twenty rounds of [tap camera] [shutter]
// [Use Photo] [tap camera again] — roughly eighty interactions with a phone
// held in a gloved hand in direct sun, and at that point the app is a worse
// tool than the phone's own camera roll for the job the super is actually
// doing. So he uses the camera roll, and the photos never reach the record.
//
// expo-camera would give a real in-app viewfinder with a shutter that stays
// put, but it needs a native build. This is the OTA-safe interim the audit
// asked for: re-open the system camera the instant a shot lands and keep going
// until the user cancels or the caller's cap is reached. The user still taps
// "Use Photo" per shot; what goes away is walking back through the app between
// shots. Twenty defects drops from ~80 interactions to ~41, on an OTA.
//
// On web there is no camera to re-open, so the "burst" is the photo library's
// own multi-select — one dialog, N photos. Same trade, one step.
//
// The caller decides what a photo MEANS (a DFR photo, a punch item, an
// incident attachment). This file only gets the bytes, one at a time, as fast
// as the OS allows, and never blocks on anything but the picker itself.

import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { X } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// --- BEGIN burstSummary ---
// scripts/validate-field-capture.ts extracts everything between these
// sentinels, transpiles it and runs the REAL function. Moving or renaming the
// sentinels fails that guard loudly rather than silently unpinning the copy.
// Same technique as the carrySourceDayLabel region in app/daily-report.tsx.

/** Why a burst ended. Only `cancelled` is the user saying "that's all of them". */
export type BurstStop = 'cancelled' | 'limit' | 'permission' | 'error' | 'unsupported';

/**
 * What to tell the user when a burst ends — or `null` when the right thing to
 * say is nothing.
 *
 * Silence is correct in the ordinary case: the thumbnails appeared one by one
 * as the shots landed, so a toast reading "Added 7 photos" only repeats what
 * the screen already shows. A message is owed when something the user did NOT
 * choose ended the run — the cap, a denied permission, a picker that died
 * mid-walk — because in every one of those the count on screen is lower than
 * the count they took, and that difference is the whole failure.
 *
 * `capLabel` is the cap as the caller words it ("10-photo", "no more room"),
 * so this stays out of the business of knowing each screen's limit.
 */
export function burstSummary(captured: number, stoppedBy: BurstStop, capLabel: string): string | null {
  if (stoppedBy === 'permission') {
    return captured > 0
      ? `Added ${captured} photo${captured === 1 ? '' : 's'}. Camera access was turned off partway through — turn it back on in Settings to keep shooting.`
      : 'Camera access is off. Turn it on in Settings to shoot a photo walk.';
  }
  if (stoppedBy === 'error') {
    return captured > 0
      ? `Added ${captured} photo${captured === 1 ? '' : 's'}, then the camera stopped responding. Tap again to carry on where you left off.`
      : 'The camera did not open. Try again, or pick from your library instead.';
  }
  if (stoppedBy === 'limit') {
    return `Added ${captured} photo${captured === 1 ? '' : 's'} — that is the ${capLabel} limit for this record. Anything else has to go somewhere else.`;
  }
  // 'cancelled' — the user ended the walk, and every shot they took is on
  // screen. 'unsupported' — web already fell through to the library picker and
  // its own dialog reported what it did.
  return null;
}
// --- END burstSummary ---

export interface BurstOptions {
  /** How many more photos the caller can accept. 0 ends the burst before it starts. */
  remaining: number;
  /** JPEG quality passed to the picker. Defaults to the repo-wide 0.7. */
  quality?: number;
  /**
   * Called once per shot, the moment it lands and BEFORE the camera re-opens.
   * Push it to state here — the point of the burst is that the record grows
   * while the user is still shooting, so a crash or a battery death mid-walk
   * costs one photo instead of all of them.
   */
  onCaptured: (asset: { uri: string }) => void;
}

export interface BurstOutcome {
  captured: number;
  stoppedBy: BurstStop;
}

/**
 * Shoot photos back-to-back until the user cancels or `remaining` is used up.
 *
 * Never throws. Never blocks on anything except the picker: geo-stamping,
 * upload staging and any AI pass belong in `onCaptured`, fired and forgotten,
 * so the camera can re-open while they run. The moment this function awaits
 * something else, the burst becomes a slideshow.
 */
export async function captureBurst(opts: BurstOptions): Promise<BurstOutcome> {
  const { remaining, quality = 0.7, onCaptured } = opts;
  if (remaining <= 0) return { captured: 0, stoppedBy: 'limit' };

  // Web has no camera to re-open. The library's multi-select IS the burst
  // there, and it caps itself, so one dialog does the whole job.
  if (Platform.OS === 'web') {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
      });
      if (result.canceled) return { captured: 0, stoppedBy: 'cancelled' };
      const assets = result.assets.slice(0, remaining);
      for (const a of assets) onCaptured({ uri: a.uri });
      return { captured: assets.length, stoppedBy: 'unsupported' };
    } catch (err) {
      console.warn('[PhotoCapture] web burst failed:', err);
      return { captured: 0, stoppedBy: 'error' };
    }
  }

  // Ask once, up front. Asking per shot would put a system dialog between
  // every pair of photos, which is the friction this whole file removes.
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { captured: 0, stoppedBy: 'permission' };
  } catch (err) {
    console.warn('[PhotoCapture] permission check failed:', err);
    return { captured: 0, stoppedBy: 'error' };
  }

  let captured = 0;
  while (captured < remaining) {
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchCameraAsync({ quality, allowsEditing: false });
    } catch (err) {
      // A picker that dies mid-walk must not discard the shots already taken —
      // they are already in the caller's state via onCaptured.
      console.warn('[PhotoCapture] camera failed mid-burst:', err);
      return { captured, stoppedBy: 'error' };
    }
    if (result.canceled || !result.assets?.[0]) {
      return { captured, stoppedBy: 'cancelled' };
    }
    onCaptured({ uri: result.assets[0].uri });
    captured++;
    // A tick per shot, not a chord: the user is holding the phone at arm's
    // length and the haptic is the only confirmation they can feel through a
    // glove that the frame was kept.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
  return { captured, stoppedBy: 'limit' };
}

/**
 * Pick several photos from the library in one dialog. The non-camera half of
 * the same problem: `allowsMultipleSelection: false` made a GC re-open the
 * picker once per photo for shots he had already taken.
 */
export async function pickPhotoBatch(opts: { remaining: number; quality?: number }): Promise<{ uri: string }[]> {
  const { remaining, quality = 0.7 } = opts;
  if (remaining <= 0) return [];
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (result.canceled) return [];
    // selectionLimit is a hint on some Android pickers — clamp so a caller's
    // cap is a cap and not a suggestion.
    return result.assets.slice(0, remaining).map(a => ({ uri: a.uri }));
  } catch (err) {
    console.warn('[PhotoCapture] library batch failed:', err);
    return [];
  }
}

export interface PhotoThumbGridProps {
  uris: string[];
  onRemove?: (index: number) => void;
  /** Thumbnail edge in points. 76 keeps a 44pt remove target off the image centre. */
  size?: number;
  testIDPrefix?: string;
}

/**
 * The strip of what you just shot. Deliberately dumb — it renders whatever URI
 * the caller hands it (a local `file://` while the bytes are still queueing, a
 * signed URL once they have landed) so a photo is visible the instant it is
 * taken and stays visible with no signal.
 */
export function PhotoThumbGrid({ uris, onRemove, size = 76, testIDPrefix = 'photo' }: PhotoThumbGridProps) {
  const styles = useThemedStyles(makeStyles);
  const remove = useCallback((idx: number) => {
    onRemove?.(idx);
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, [onRemove]);

  if (uris.length === 0) return null;
  return (
    <View style={styles.grid}>
      {uris.map((uri, idx) => (
        <View key={`${uri}-${idx}`} style={[styles.thumbWrap, { width: size, height: size }]}>
          <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
          {onRemove ? (
            <TouchableOpacity
              style={styles.thumbRemove}
              onPress={() => remove(idx)}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${idx + 1}`}
              testID={`${testIDPrefix}-remove-${idx}`}
            >
              <X size={12} color="#FFFFFF" strokeWidth={2.5} />
            </TouchableOpacity>
          ) : null}
          <View style={styles.thumbIndex}>
            <Text style={styles.thumbIndexText}>{idx + 1}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 8 },
  thumbWrap: {
    position: 'relative' as const,
    borderRadius: Tokens.radius.md,
    overflow: 'hidden' as const,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  thumb: { width: '100%' as const, height: '100%' as const },
  // Near-black disc, not the accent: the control sits ON the photograph and has
  // to stay legible over whatever the super pointed the lens at.
  thumbRemove: {
    position: 'absolute' as const, top: 3, right: 3, width: 20, height: 20, borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  thumbIndex: {
    position: 'absolute' as const, bottom: 0, left: 0, paddingHorizontal: 5, paddingVertical: 1,
    backgroundColor: 'rgba(0,0,0,0.6)', borderTopRightRadius: Tokens.radius.sm,
  },
  thumbIndexText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
});

export default PhotoThumbGrid;
