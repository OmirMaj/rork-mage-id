// passportStore — persists the baked Home Passport (pre-answered FAQ +
// summary) per project, so the portal snapshot builders in
// app/client-portal-setup.tsx and app/project-detail.tsx can bake it into
// snapshot v9 on their next push. Kept OUT of buildHomePassport.ts so the
// engine stays pure (the validator runs it under bun, where AsyncStorage
// does not resolve).
//
// Key mageid_home_passport is registered in LOCAL_USER_CACHE_KEYS
// (contexts/AuthContext.tsx) — required for every per-user mageid_* key or
// it leaks across tenants on shared devices.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BakedHomePassport } from './types';

const STORE_KEY = 'mageid_home_passport';

type PassportStoreShape = Record<string, BakedHomePassport>;

async function readStore(): Promise<PassportStoreShape> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as PassportStoreShape) : {};
  } catch {
    return {};
  }
}

export async function loadBakedPassport(projectId: string): Promise<BakedHomePassport | null> {
  if (!projectId) return null;
  const store = await readStore();
  return store[projectId] ?? null;
}

export async function saveBakedPassport(projectId: string, baked: BakedHomePassport): Promise<void> {
  if (!projectId) return;
  try {
    const store = await readStore();
    store[projectId] = baked;
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Non-fatal — the GC can re-generate anytime; the binder is unaffected.
  }
}
