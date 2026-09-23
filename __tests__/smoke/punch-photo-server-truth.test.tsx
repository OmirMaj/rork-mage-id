// Smoke (F1, wave 4): a punch photo changed on ANOTHER device reaches this one.
//
// The punch loader used to prefer this device's own copy of a photo
// unconditionally. After a web Replace the phone kept the old picture (and
// inlined it into its PDF export); after a web Remove it kept showing the
// removed photo; and a blob: URL from a previous browser tab — dead after a
// reload — was served forever as a broken image. The device copy is now kept
// only while it belongs to the object the server row names and can still be
// opened (utils/deviceLocalCopy).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID, SMOKE_USER } from '@/__tests__/fixtures/world';
import { supabase } from '@/lib/supabase';
import { noteSessionLocalUri, resetSessionLocalUrisForTest } from '@/utils/deviceLocalCopy';

const OLD_LOCAL = 'file:///var/mobile/Containers/Data/Documents/pending/old-photo.jpg';
const OLD_PATH = `${SMOKE_USER.id}/${PROJECT_ID}/punch-punch-1.jpg`;
const NEW_PATH = `${SMOKE_USER.id}/${PROJECT_ID}/punch-punch-1-rmfabc12.png`;
const BLOB = 'blob:https://app.mageid.app/0b1c2d3e-previous-tab';

function builder(rowsFor: () => Promise<unknown[]>) {
  const b: Record<string, unknown> = {
    then(ok: (v: unknown) => unknown, no: (e: unknown) => unknown) {
      return rowsFor().then(rows => ({ data: rows, error: null, count: rows.length, status: 200, statusText: 'OK' })).then(ok, no);
    },
  };
  const p: unknown = new Proxy(b, { get(t, k) { if (typeof k === 'symbol') return undefined; if (k in t) return t[k]; return () => p; } });
  return p;
}
const realFrom = supabase.from;

async function pump(n = 8) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { try { jest.advanceTimersByTime(300); } catch { /* real timers */ } for (let k = 0; k < 30; k++) await Promise.resolve(); });
  }
}

type Case = {
  name: string;
  local: string;
  priorPath: string;
  server: string | null;
  sameSession?: boolean;
  keepsLocal: boolean;
};
const CASES: Case[] = [
  { name: 'a web Replace reaches the phone that took the original', local: OLD_LOCAL, priorPath: OLD_PATH, server: NEW_PATH, keepsLocal: false },
  { name: 'a web Remove clears the photo on the phone (and so its export)', local: OLD_LOCAL, priorPath: OLD_PATH, server: null, keepsLocal: false },
  { name: 'a reloaded web tab signs the path instead of a dead blob', local: BLOB, priorPath: NEW_PATH, server: NEW_PATH, keepsLocal: false },
  { name: 'the phone that took it keeps its own copy while the row still names it', local: OLD_LOCAL, priorPath: OLD_PATH, server: OLD_PATH, keepsLocal: true },
  { name: 'a blob staged in THIS page session is kept', local: BLOB, priorPath: NEW_PATH, server: NEW_PATH, sameSession: true, keepsLocal: true },
];

describe('punch photo: the server row decides which picture this device shows', () => {
  jest.setTimeout(60000);
  afterEach(() => { supabase.from = realFrom; resetSessionLocalUrisForTest(); });
  for (const c of CASES) {
    it(c.name, async () => {
      await primeWorld('populated');
      if (c.sameSession) noteSessionLocalUri(c.local);
      const raw = JSON.parse((await AsyncStorage.getItem('mageid_punch_items'))!);
      const items = (Array.isArray(raw) ? raw : raw.data) as Array<Record<string, unknown>>;
      const seeded = items.map(p => (p.id === 'punch-1' ? { ...p, photoUri: c.local, photoLocalUri: c.local, photoStoragePath: c.priorPath } : p));
      await AsyncStorage.setItem('mageid_punch_items', JSON.stringify(seeded));
      supabase.from = ((table?: string) => {
        if (table !== 'punch_items') return (realFrom as (this: unknown, t?: string) => unknown).call(supabase, table);
        return builder(async () => seeded.map(p => {
          const row: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(p)) row[k.replace(/[A-Z]/g, ch => `_${ch.toLowerCase()}`)] = v;
          delete row.photo_local_uri; delete row.photo_storage_path;
          row.user_id = SMOKE_USER.id;
          if (p.id === 'punch-1') { row.photo_uri = c.server; row.description = `SERVER-READ ${c.name}`; } else row.photo_uri = null;
          return row;
        }));
      }) as unknown as typeof supabase.from;
      await mountRouteChecked(`/punch-list?projectId=${PROJECT_ID}`);
      await pump();
      await settle();
      const after = JSON.parse((await AsyncStorage.getItem('mageid_punch_items'))!);
      const list = (Array.isArray(after) ? after : after.data) as Array<Record<string, unknown>>;
      const p1 = list.find(p => p.id === 'punch-1')!;
      // The server read really landed (its description is on the stored row).
      expect(p1.description).toBe(`SERVER-READ ${c.name}`);
      if (c.server) expect(p1.photoStoragePath).toBe(c.server);
      else expect(p1.photoStoragePath).toBeUndefined();
      if (c.keepsLocal) {
        expect(p1.photoLocalUri).toBe(c.local);
        expect(p1.photoUri).toBe(c.local);
      } else {
        expect(p1.photoLocalUri).toBeUndefined();
        expect(p1.photoUri).not.toBe(c.local);
        if (!c.server) expect(p1.photoUri).toBeUndefined();
      }
    });
  }
});
