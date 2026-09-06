/**
 * __tests__/sync/auth-marker-backfill.test.tsx — the AuthProvider mount effect
 * that stamps the last-user marker on an install that pre-dates it.
 *
 * Review 2026-09-05, round 5 (A8). The backfill narrows both write queues to
 * the arriving user BEFORE it stamps the marker, because stamping is exactly
 * what makes an UNTAGGED entry adoptable by the next flush. That ordering is
 * pinned as source text by scripts/validate-storage-hygiene.ts §3; what is
 * executed here is the part text cannot show — WHICH entries survive, on which
 * platform, and what happens when storage refuses to hand the queue over.
 *
 * The platform gate is the finding this file exists for. Narrowing costs a real
 * day of field work on a marker-less install (queued DFRs deleted, queued photo
 * bytes unlinked), and it only buys anything on the web: `detectSessionInUrl`
 * lets supabase-js swap the session to a DIFFERENT user at client construction,
 * before a line of app code runs. On native a session present at mount is
 * whoever last signed in THROUGH the app, and every one of those paths writes
 * the marker — so "no marker" means nobody has signed in since the marker
 * shipped, and the untagged entries are this user's own.
 *
 * It drives the REAL provider (mounted for real, talking to the repo's Supabase
 * mock) rather than a copy of its logic, because the defect being guarded
 * against is an ORDERING between three calls in one continuation.
 */

import React from 'react';
import { Platform, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { __setSmokeSession } from '@/__tests__/mocks/supabase';
import { getOfflineQueue, type OfflineMutation } from '@/utils/offlineQueue';
import { getPhotoUploadQueue } from '@/utils/photoUploadQueue';

const QUEUE_KEY = 'mageid_offline_queue';
const PHOTO_KEY = 'mageid_photo_upload_queue';
const LAST_USER_ID_KEY = 'mageid_last_user_id';

const USER_A = 'user-a';
const USER_B = 'user-b';

/** `Platform.OS` is read at CALL time inside the backfill, so a plain override
 *  before the mount is enough — no module reset, no react-native factory mock
 *  (which would take the whole renderer down with it). */
const realOS = Platform.OS;
function setPlatform(os: 'web' | 'ios'): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

type Seed = Partial<OfflineMutation> & Pick<OfflineMutation, 'id' | 'table' | 'operation'>;

async function seedQueues(entries: Seed[], photos: { id: string; userId?: string }[] = []): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(entries.map((e, i) => ({
    timestamp: 1000 + i,
    retryCount: 0,
    data: { id: e.id },
    ...e,
  }))));
  if (photos.length > 0) {
    await AsyncStorage.setItem(PHOTO_KEY, JSON.stringify(photos.map((p, i) => ({
      id: p.id,
      photoId: p.id,
      ...(p.userId ? { userId: p.userId } : {}),
      projectId: 'p1',
      localUri: `file:///tmp/${p.id}.jpg`,
      storagePath: `${p.userId ?? 'unknown'}/p1/${p.id}.jpg`,
      contentType: 'image/jpeg',
      queuedAt: 1000 + i,
      retryCount: 0,
    }))));
  }
}

type AuthValue = ReturnType<typeof useAuth>;

/** Mounts the real provider. `onAuth` receives the live context value on every
 *  render, which is how the second caller (onNewSessionEstablished) is reached
 *  — it is exposed on the context, not exported. */
async function mountAuth(onAuth?: (value: AuthValue) => void): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Probe() {
    const value = useAuth();
    onAuth?.(value);
    return <Text>mounted</Text>;
  }
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        {onAuth ? <Probe /> : <Text>mounted</Text>}
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** Make one AsyncStorage key unreadable for the duration of `fn`. */
async function withUnreadableKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // The community AsyncStorage mock IS a jest.fn, so its own implementation has
  // to be borrowed rather than re-entered — `AsyncStorage.getItem` after the
  // override is the override.
  const getItem = AsyncStorage.getItem as unknown as jest.Mock;
  const real = getItem.getMockImplementation()!;
  getItem.mockImplementation(async (k: string) => {
    if (k === key) throw new Error('SQLITE_FULL: database or disk is full');
    return real(k);
  });
  try {
    return await fn();
  } finally {
    getItem.mockImplementation(real);
  }
}

/** The backfill's last step. Waiting on it is what proves the whole
 *  continuation ran — every assertion about the queues is made after it. */
async function waitForMarker(expected: string | null): Promise<void> {
  await waitFor(async () => {
    expect(await AsyncStorage.getItem(LAST_USER_ID_KEY)).toBe(expected);
  });
}

const queueIds = async () => (await getOfflineQueue()).map((m) => m.id);
const photoIds = async () => (await getPhotoUploadQueue()).map((t) => t.photoId);

beforeEach(async () => {
  await AsyncStorage.clear();
  __setSmokeSession({ user: { id: USER_A, email: 'a@example.com' }, access_token: `tok-${USER_A}` });
});

afterEach(() => {
  setPlatform(realOS as 'ios');
  __setSmokeSession(null);
});

describe('last-user backfill — WEB narrows hardest (the detectSessionInUrl door)', () => {
  test('an untagged entry is dropped before the marker is stamped', async () => {
    // The leak this pays for: on a shared browser profile the queue can hold
    // user A's untagged writes while supabase-js has already swapped the
    // session to user B. Nothing here can tell those apart, so nothing untagged
    // survives the stamp.
    setPlatform('web');
    await seedQueues(
      [
        { id: 'mine', table: 'rfis', operation: 'insert', userId: USER_A },
        { id: 'legacy', table: 'rfis', operation: 'insert' },
        { id: 'theirs', table: 'rfis', operation: 'insert', userId: USER_B },
      ],
      [{ id: 'ph-mine', userId: USER_A }, { id: 'ph-legacy' }, { id: 'ph-theirs', userId: USER_B }],
    );

    await mountAuth();
    await waitForMarker(USER_A);

    expect(await queueIds()).toEqual(['mine']);
    expect(await photoIds()).toEqual(['ph-mine']);
  });
});

describe('last-user backfill — NATIVE keeps the untagged field work', () => {
  test('an untagged entry survives, and a foreign-tagged one still does not', async () => {
    // No native path can put a session in front of this effect without having
    // written the marker, so "no marker + a session" means these entries are
    // the session user's own. Dropping them deleted a day of DFRs and unlinked
    // the photo bytes behind them for nothing.
    setPlatform('ios');
    await seedQueues(
      [
        { id: 'mine', table: 'rfis', operation: 'insert', userId: USER_A },
        { id: 'legacy', table: 'rfis', operation: 'insert' },
        { id: 'theirs', table: 'rfis', operation: 'insert', userId: USER_B },
      ],
      [{ id: 'ph-mine', userId: USER_A }, { id: 'ph-legacy' }, { id: 'ph-theirs', userId: USER_B }],
    );

    await mountAuth();
    await waitForMarker(USER_A);

    // The untagged entry stays; the marker stamped a line later is what vouches
    // for it (utils/offlineQueue.partitionQueueForSession adopts it then).
    expect(await queueIds()).toEqual(['mine', 'legacy']);
    expect(await photoIds()).toEqual(['ph-mine', 'ph-legacy']);
  });

  test('a queue that is ALL another user\'s is still emptied, marker and all', async () => {
    setPlatform('ios');
    await seedQueues([{ id: 'theirs', table: 'rfis', operation: 'insert', userId: USER_B }]);

    await mountAuth();
    await waitForMarker(USER_A);

    expect(await AsyncStorage.getItem(QUEUE_KEY)).toBeNull();
  });
});

describe('last-user backfill — a marker that already exists is never re-stamped', () => {
  test('the queues are left exactly as they are', async () => {
    setPlatform('web');
    await AsyncStorage.setItem(LAST_USER_ID_KEY, USER_B);
    await seedQueues([{ id: 'legacy', table: 'rfis', operation: 'insert' }]);

    await mountAuth();
    // The backfill short-circuits, so there is no write to wait for. Wait for
    // proof that it RAN (readLastUser's multiGet) and then let the continuation
    // that would have narrowed the queue have its turn. A marker of B over a
    // session of A is the tenant switch's business, not the backfill's.
    await waitFor(() => {
      expect(AsyncStorage.multiGet).toHaveBeenCalledWith([LAST_USER_ID_KEY, 'mageid_last_user_email']);
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(await AsyncStorage.getItem(LAST_USER_ID_KEY)).toBe(USER_B);
    expect(await queueIds()).toEqual(['legacy']);
  });
});

describe('last-user backfill — an unreadable queue must not be stamped over', () => {
  test('the marker is left unwritten and the queue untouched', async () => {
    // A8: retainOfflineQueueForUser used to swallow this and report
    // {kept: 0, dropped: 0} — indistinguishable from "there was nothing to
    // keep" — so the marker went down over a queue nobody could read, and every
    // untagged entry in it became adoptable by the session that just arrived.
    setPlatform('web');
    await seedQueues([
      { id: 'legacy', table: 'rfis', operation: 'insert' },
      { id: 'theirs', table: 'rfis', operation: 'insert', userId: USER_B },
    ]);

    await withUnreadableKey(QUEUE_KEY, async () => {
      await mountAuth();
      // Give the whole continuation room to run — this asserts something did
      // NOT happen, so it has to outlive the path that would have done it.
      await waitFor(() => {
        expect(AsyncStorage.getItem).toHaveBeenCalledWith(QUEUE_KEY);
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(await AsyncStorage.multiGet([LAST_USER_ID_KEY])).toEqual([[LAST_USER_ID_KEY, null]]);
    });

    // …and the queue is exactly as it was: not narrowed, not removed. Even
    // USER_B's entry survives — nothing was proven about it either.
    expect(await queueIds()).toEqual(['legacy', 'theirs']);
  });

  test('the OTHER caller — onNewSessionEstablished — refuses the same way', async () => {
    // The marker-less narrowing path of onNewSessionEstablished (app/
    // reset-password.tsx and the magic-link handler reach it with no handoff).
    // Same defect, worse consequence: a swallowed read error there reported
    // "nothing of theirs" and the queue was DROPPED as well as the marker
    // stamped.
    setPlatform('web');
    await seedQueues([
      { id: 'legacy', table: 'rfis', operation: 'insert' },
      { id: 'mine', table: 'rfis', operation: 'insert', userId: USER_A },
    ]);
    let auth: AuthValue | null = null;
    await mountAuth((value) => { auth = value; });
    await waitForMarker(USER_A);            // the backfill runs first, as it does in the app
    await AsyncStorage.multiRemove([LAST_USER_ID_KEY, 'mageid_last_user_email']);
    const before = await AsyncStorage.getItem(QUEUE_KEY);

    await withUnreadableKey(QUEUE_KEY, async () => {
      await (auth as unknown as AuthValue).onNewSessionEstablished();
    });

    expect(await AsyncStorage.multiGet([LAST_USER_ID_KEY])).toEqual([[LAST_USER_ID_KEY, null]]);
    expect(await AsyncStorage.getItem(QUEUE_KEY)).toBe(before);
  });
});
