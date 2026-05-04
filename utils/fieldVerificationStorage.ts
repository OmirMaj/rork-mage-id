// fieldVerificationStorage — local persistence for "I went to the site
// and verified this takeoff number" photos.
//
// Scope: scaffolding only. The camera + GPS capture happens through
// expo-image-picker + expo-location on mobile; web shows a "this is a
// mobile-only feature" notice. No upload to Supabase yet — the photos
// stay on-device. When we add backend storage in a follow-up, this
// module is the single touch-point to swap.
//
// Storage layout:
//   tertiary_takeoff_field::<projectId>          → TakeoffFieldVerification[]
//   tertiary_takeoff_field::standalone           → TakeoffFieldVerification[]

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TakeoffFieldVerification } from '@/types';

const KEY_PREFIX = 'tertiary_takeoff_field::';
const STANDALONE_KEY = 'standalone';

function keyFor(projectId: string | undefined): string {
  return `${KEY_PREFIX}${projectId ?? STANDALONE_KEY}`;
}

export async function loadFieldVerifications(projectId?: string): Promise<TakeoffFieldVerification[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as TakeoffFieldVerification[];
  } catch (e) {
    console.log('[fieldVerificationStorage] load failed', e);
    return [];
  }
}

export async function appendFieldVerification(
  projectId: string | undefined,
  v: TakeoffFieldVerification,
): Promise<TakeoffFieldVerification[]> {
  const existing = await loadFieldVerifications(projectId);
  const next = [v, ...existing];
  try {
    await AsyncStorage.setItem(keyFor(projectId), JSON.stringify(next));
  } catch (e) {
    console.log('[fieldVerificationStorage] save failed', e);
  }
  return next;
}

export async function deleteFieldVerification(
  projectId: string | undefined,
  id: string,
): Promise<TakeoffFieldVerification[]> {
  const existing = await loadFieldVerifications(projectId);
  const next = existing.filter(v => v.id !== id);
  try {
    await AsyncStorage.setItem(keyFor(projectId), JSON.stringify(next));
  } catch (e) {
    console.log('[fieldVerificationStorage] delete failed', e);
  }
  return next;
}

export async function clearFieldVerifications(projectId?: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(projectId));
  } catch (e) {
    console.log('[fieldVerificationStorage] clear failed', e);
  }
}
