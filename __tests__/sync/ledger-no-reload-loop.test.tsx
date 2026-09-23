/**
 * Wave-4 final fix — a line under Not saved must never put a list into an
 * endless re-read (data-sync critic, round 4).
 *
 * Round 3 taught the projects and settings loaders to keep the device copy of
 * a record with a refused write under Not saved. Both loaders already OWED a
 * re-read whenever they kept a device copy, and paid it once "nothing is
 * pending" — a check that reads the QUEUE. A Not-saved line is in the LEDGER,
 * so the check always passed, the re-read was pinned by the line again and
 * owed another: 200+ projects SELECTs (the jest worker ran out of heap), and
 * a select('*') of his profile row per pass.
 *
 * The rule now (utils/projectContextPure projectsReloadOwedAfterLoad,
 * utils/settingsLoadGuard settingsAfterRead rowWriteUnsaved): a ledger-pinned
 * record keeps its device copy but never owes a re-read — only a queued or
 * in-flight write does. Retry and Discard re-read the table themselves
 * (ProjectContext rereadLedgerTables); the last cases prove they still do.
 *
 * A job named by a Not-saved line is NOT pinned whole any more (round 8):
 * the load takes the SERVER's projects row and lays the line's own row over
 * it — for a money-only line, the line's project_financials row over the
 * server's fin row (the durable copy of his refused edit, so a same-user
 * re-auth sweep of the cache cannot hand him the server's budget — R1); for a
 * projects line, the line's columns over the server's projects row. Pinning
 * it whole (round 7) made his next edit send the phone's OLD row back as a
 * whole-row write: a rename, a close-out, a portal switched off on the web
 * were reopened by a description tweak on the phone (the W1 cases below).
 *
 * Mount-level on purpose: the pure planner was pinned before and the loop
 * lived between the loader, the hydration pass and the settle.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as reactQuery from '@tanstack/react-query';
import { act } from 'expo-router/testing-library';
import { supabase } from '@/lib/supabase';
import { discardUnsavedWrite, retryUnsavedWrite } from '@/utils/syncLedger';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { SMOKE_USER, PROJECT_ID, world } from '@/__tests__/fixtures/world';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { useCoreData } from '@/contexts/ProjectContext';
import type { AppSettings, Project } from '@/types';

const P = world.project;
const SERVER_NAME = 'Harlow Residence — renamed on the web';
const SERVER_PROJECT = {
  id: PROJECT_ID, user_id: SMOKE_USER.id, name: SERVER_NAME, type: P.type, location: P.location, square_footage: P.squareFootage,
  quality: P.quality, description: P.description, status: P.status, collaborators: [], created_at: P.createdAt, updated_at: P.updatedAt,
  schedule: null, estimate: null, linked_estimate: P.linkedEstimate, target_budget: 100000, client_portal: P.clientPortal,
  handover_checklist: {}, photo_count: 0,
};
const SERVER_FIN = {
  project_id: PROJECT_ID, user_id: SMOKE_USER.id, target_budget: 100000, estimate: null, linked_estimate: P.linkedEstimate, estimate_versions: null,
  contract_mode: 'gmp', gmp_cap: 900000, contractor_fee_percent: null, contractor_fee_amount: null, retainage_percent: 10, retainage_percent_assumed: null,
};

const PROFILE_ROW = {
  id: SMOKE_USER.id, location: 'United States', units: 'imperial', tax_rate: 7.5, contingency_rate: 10,
  company_name: 'Ridgeline Builders', contact_name: 'Dana Ortiz', email: SMOKE_USER.email, phone: '555', address: '1 Main',
  license_number: 'L1', license_state: null, license_expiry: null, tagline: '', logo_uri: null, signature_data: null,
  theme_colors: null, biometrics_enabled: false, dfr_recipients: [], digest_enabled: false, digest_hour: 6,
  digest_channels: { email: true, in_app: true }, digest_timezone: 'America/New_York', financing: null,
  deposit_pct: null, progress_pct: null, final_pct: null, warranty_months: null, onboarding_complete: true, user_role: 'contractor',
};

// A hard stop so a regression fails the assertion instead of the heap: past
// this many reads the "server" never answers.
const HARD_STOP = 60;
let projectSelects = 0;
let profileSelects = 0;
let writes: string[] = [];
// Every write's payload, in order (the W1 cases read what the edit SENT).
let sent: { table: string; op: string; payload: Record<string, unknown> }[] = [];
// What the server holds for the job — a case may swap in the web's edits.
let serverProject: Record<string, unknown> = SERVER_PROJECT;
const origFrom = supabase.from;

/** Answers projects / project_financials / profiles from the rows above and
 *  counts the unfiltered projects SELECTs and the profile select('*') reads.
 *  Every other table goes to the smoke mock. */
function install(): void {
  (supabase as unknown as { from: (t?: string) => unknown }).from = (table?: string) => {
    if (table !== 'projects' && table !== 'project_financials' && table !== 'profiles') return origFrom(table as string);
    let sel = false; let star = false; let write = false; let filtered = false; let single = false; let op = ''; let payload: Record<string, unknown> = {};
    const b: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string | symbol) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
            if (write) { writes.push(`${table}.${op}`); sent.push({ table: table as string, op, payload }); }
            if (table === 'projects' && sel && !write && !filtered) {
              projectSelects += 1;
              if (projectSelects > HARD_STOP) return new Promise(() => {});
            }
            if (table === 'profiles' && star && !write) {
              profileSelects += 1;
              if (profileSelects > HARD_STOP) return new Promise(() => {});
            }
            let data: unknown = null;
            if (sel && !write) {
              const rows = table === 'projects' ? [serverProject] : table === 'project_financials' ? [SERVER_FIN] : [PROFILE_ROW];
              data = single ? rows[0] : rows;
            }
            return Promise.resolve({ data, error: null, status: 200, count: null, statusText: 'OK' }).then(ok, bad);
          };
        }
        if (typeof prop === 'symbol') return undefined;
        return (...args: unknown[]) => {
          if (prop === 'select') { sel = true; if (args[0] === '*') star = true; }
          else if (['insert', 'update', 'upsert', 'delete'].includes(prop)) { write = true; op = prop; payload = (args[0] ?? {}) as Record<string, unknown>; }
          else if (prop === 'single' || prop === 'maybeSingle') single = true;
          else if (!['order', 'limit', 'range', 'returns', 'abortSignal'].includes(prop)) filtered = true;
          return b;
        };
      },
    });
    return b;
  };
}

async function pump(rounds: number): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => { jest.advanceTimersByTime(50); for (let k = 0; k < 30; k++) await Promise.resolve(); });
  }
}

function invalidate(key: string): Promise<void> {
  const clients = (reactQuery as unknown as { __getQueryClients: () => reactQuery.QueryClient[] }).__getQueryClients();
  return act(async () => { for (const c of clients) void c.invalidateQueries({ queryKey: [key, SMOKE_USER.id] }); });
}

const FIN_LINE = {
  id: 'oq-fin-1', kind: 'write', label: 'Project budget & terms', reason: 'the server refused it', at: 1,
  userId: SMOKE_USER.id, table: 'project_financials', recordId: PROJECT_ID, operation: 'upsert',
  row: { project_id: PROJECT_ID, user_id: SMOKE_USER.id, target_budget: 150000 }, queuedAt: 1,
};
const PROJECT_LINE = {
  id: 'oq-proj-1', kind: 'write', label: 'Project', reason: 'the server refused it', at: 1,
  userId: SMOKE_USER.id, table: 'projects', recordId: PROJECT_ID, operation: 'update',
  row: { id: PROJECT_ID, user_id: SMOKE_USER.id, status: 'on_hold' }, queuedAt: 1,
};
const SETTINGS_LINE = {
  id: 'oq-settings-1', kind: 'write', label: 'Profile & settings', reason: 'the server refused it', at: 1,
  userId: SMOKE_USER.id, table: 'profiles', recordId: SMOKE_USER.id, operation: 'update',
  row: { id: SMOKE_USER.id, company_name: 'Ridgeline Builders LLC', tax_rate: 8.25 }, queuedAt: 1,
};

// What the provider hands every screen, read in memory (the R1 case).
const seen: {
  projects?: Project[]; updateProject?: (id: string, u: Partial<Project>) => void;
  settings?: AppSettings; updateSettings?: (u: Partial<AppSettings>) => void;
} = {};
function Probe(): React.ReactElement | null {
  const core = useCoreData();
  seen.projects = core.projects;
  seen.updateProject = core.updateProject;
  seen.settings = core.settings;
  seen.updateSettings = core.updateSettings as (u: Partial<AppSettings>) => void;
  return null;
}

/** Mount Home (or the in-memory probe) with `lines` under Not saved and the
 *  device's job at `deviceBudget`, owner-stamped with his contract terms. */
async function mountWith(
  lines: unknown[], deviceBudget?: number | 'none', probe = false, deviceSettings?: Partial<AppSettings> | 'none',
): Promise<{ mountProjects: number; mountProfiles: number }> {
  await primeWorld('populated');
  allowConsoleErrors();
  install();
  if (deviceSettings === 'none') await AsyncStorage.removeItem('mageid_settings');
  else if (deviceSettings) {
    const raw = await AsyncStorage.getItem('mageid_settings');
    const cur = (raw ? JSON.parse(raw) : {}) as AppSettings;
    await AsyncStorage.setItem('mageid_settings', JSON.stringify({ ...cur, ...deviceSettings, branding: { ...cur.branding, ...deviceSettings.branding } }));
  }
  projectSelects = 0;
  profileSelects = 0;
  writes = [];
  sent = [];
  if (deviceBudget === 'none') {
    // No device copy of the job at all (a swept cache on a cold launch).
    const raw = await AsyncStorage.getItem('mageid_projects');
    const list = (raw ? JSON.parse(raw) : []) as Project[];
    await AsyncStorage.setItem('mageid_projects', JSON.stringify(list.filter((p) => p.id !== PROJECT_ID)));
  } else if (deviceBudget !== undefined) {
    const raw = await AsyncStorage.getItem('mageid_projects');
    const list = (raw ? JSON.parse(raw) : []) as Project[];
    await AsyncStorage.setItem('mageid_projects', JSON.stringify(list.map((p) => (p.id === PROJECT_ID
      ? { ...p, targetBudget: deviceBudget, ownerUserId: SMOKE_USER.id, financialsLoaded: true, contractMode: 'gmp', gmpCap: 900000, retainagePercent: 10, contractTermsLoaded: true }
      : p))));
  }
  const at = Date.now();
  if (lines.length) {
    await AsyncStorage.setItem('mageid_sync_failures', JSON.stringify(lines.map((l) => ({ ...(l as object), at, queuedAt: at }))));
  }
  await mountRouteChecked(probe ? '/ledger-probe' : '/', probe ? Probe : undefined);
  await settle();
  await pump(20);
  return { mountProjects: projectSelects, mountProfiles: profileSelects };
}

async function cachedJob(): Promise<Project | undefined> {
  const raw = await AsyncStorage.getItem('mageid_projects');
  return ((raw ? JSON.parse(raw) : []) as Project[]).find((p) => p.id === PROJECT_ID);
}

afterEach(() => { (supabase as unknown as { from: unknown }).from = origFrom; serverProject = SERVER_PROJECT; });

/** The Not-saved lines on the device for the job, by table. */
async function linesFor(table: string, recordId: string = PROJECT_ID): Promise<Record<string, unknown>[]> {
  const raw = await AsyncStorage.getItem('mageid_sync_failures');
  const lines = (raw ? JSON.parse(raw) : []) as { table?: string; recordId?: string; row?: Record<string, unknown> }[];
  return lines.filter((l) => l.table === table && l.recordId === recordId).map((l) => l.row ?? {});
}

/** His next edit of the job on this phone, after a foreground re-read. */
async function editAfterReread(): Promise<void> {
  await invalidate('projects');
  await pump(40);
  sent = [];
  await act(async () => { seen.updateProject!(PROJECT_ID, { description: 'walked the site with the owner' }); });
  await pump(60);
}

// What the web (or a teammate) did to the job while his budget edit waits.
const WEB_EDITED = {
  ...SERVER_PROJECT, status: 'on_hold', client_portal: { ...(P.clientPortal as object), enabled: false }, photo_count: 7,
};
const WEB_CLOSED = { ...WEB_EDITED, status: 'closed', closed_at: '2026-09-21T15:00:00.000Z' };
// A refused budget + terms edit: his numbers differ from the server's on every key.
const FIN_TERMS_LINE = {
  ...FIN_LINE, id: 'oq-fin-terms',
  row: { project_id: PROJECT_ID, user_id: SMOKE_USER.id, target_budget: 150000, contract_mode: 'cost_plus', gmp_cap: null, retainage_percent: 5 },
};

describe('a Not-saved line never loops the projects load', () => {
  test('control: no line — mount and one re-read stay small', async () => {
    const { mountProjects } = await mountWith([]);
    expect(mountProjects).toBeLessThanOrEqual(3);
    await invalidate('projects');
    await pump(60);
    expect(projectSelects - mountProjects).toBeLessThanOrEqual(3);
  });

  test('a Not-saved project_financials line: ≤3 projects SELECTs at mount and after one re-read', async () => {
    const { mountProjects } = await mountWith([FIN_LINE], 150000);
    expect(mountProjects).toBeLessThanOrEqual(3); // round 3: 200 (the hard stop) — then heap exhaustion
    await invalidate('projects');
    await pump(60);
    expect(projectSelects - mountProjects).toBeLessThanOrEqual(3);
  });

  test('...and the job shows the SERVER row with his budget and terms from the line', async () => {
    await mountWith([FIN_TERMS_LINE], 150000, true);
    for (const job of [await cachedJob(), seen.projects?.find((p) => p.id === PROJECT_ID)]) {
      expect(job?.targetBudget).toBe(150000); // his refused edit — not the server's 100k
      expect(job?.contractMode).toBe('cost_plus'); // the line's — the server says gmp
      expect(job?.gmpCap).toBeUndefined(); // the line cleared it
      expect(job?.retainagePercent).toBe(5); // the line's — the server says 10
      expect(job?.name).toBe(SERVER_NAME); // round 7 pinned the device row: 'Harlow Residence — kitchen + primary suite'
    }
  });

  test('R1c: with no device copy of the job at all, it is shown (server row + the line), never dropped', async () => {
    await mountWith([FIN_TERMS_LINE], 'none', true);
    const job = seen.projects?.find((p) => p.id === PROJECT_ID);
    expect(job?.name).toBe(SERVER_NAME); // round 7: undefined — hidden until Retry / Discard
    expect(job?.targetBudget).toBe(150000);
    expect(job?.retainagePercent).toBe(5);
    expect(await linesFor('project_financials')).toHaveLength(1);
  });

  test.each([
    ['W1: renamed, on hold, portal off on the web', WEB_EDITED],
    ['W1-closed: closed out on the web', WEB_CLOSED],
  ])('%s — his next edit sends the SERVER\'s name, status, closed_at, portal and photo count', async (_label, server) => {
    serverProject = server;
    await mountWith([FIN_LINE], 150000, true);
    await editAfterReread();
    const up = sent.find((w) => w.table === 'projects')?.payload;
    // Round 7 sent the phone's old row: the old name, in_progress, closed_at
    // undefined, the portal back on and photo_count 0 — reopening a closed job.
    expect(up?.name).toBe(SERVER_NAME);
    expect(up?.status).toBe(server.status);
    expect(up?.closed_at).toBe((server as { closed_at?: string }).closed_at);
    expect((up?.client_portal as { enabled?: boolean } | undefined)?.enabled).toBe(false);
    expect(up?.photo_count).toBe(7);
    // The money still waits behind the line, and the line keeps HIS budget.
    expect(sent.filter((w) => w.table === 'project_financials')).toEqual([]);
    expect((await linesFor('project_financials')).map((r) => r.target_budget)).toEqual([150000]);
    expect(seen.projects?.find((p) => p.id === PROJECT_ID)?.targetBudget).toBe(150000);
  });

  test('R1: a same-user re-auth sweep of the cache keeps his budget and terms in memory, and his next edit leaves the Not-saved line his', async () => {
    await mountWith([FIN_LINE], 150000, true);
    expect(seen.projects?.find((p) => p.id === PROJECT_ID)?.targetBudget).toBe(150000);
    // AuthContext.onNewSessionEstablished for the SAME user sweeps the
    // re-fetchable caches (mageid_projects / mageid_settings) but keeps the
    // queue and the ledger (mageid_sync_failures); the lists re-read.
    await AsyncStorage.removeItem('mageid_projects');
    await AsyncStorage.removeItem('mageid_settings');
    await invalidate('projects');
    await pump(40);
    const job = seen.projects?.find((p) => p.id === PROJECT_ID);
    expect(job?.targetBudget).toBe(150000); // round-4 refinement: 100000 (the server's)
    expect(job?.contractMode).toBe('gmp'); // round-4 refinement: undefined
    expect(job?.gmpCap).toBe(900000);
    expect(job?.retainagePercent).toBe(10);
    expect(job?.contractTermsLoaded).toBe(true);
    // Any later edit of the job syncs it (800 ms debounce) and parks behind
    // the line — the line must still carry HIS budget, not the server's.
    await act(async () => { seen.updateProject!(PROJECT_ID, { description: 'walked the site' }); });
    await pump(60);
    const raw = await AsyncStorage.getItem('mageid_sync_failures');
    const lines = (raw ? JSON.parse(raw) : []) as { table?: string; recordId?: string; row?: Record<string, unknown> }[];
    const fin = lines.filter((l) => l.table === 'project_financials' && l.recordId === PROJECT_ID).map((l) => l.row?.target_budget);
    expect(fin).toEqual([150000]); // round-4 refinement: [100000]
    expect(writes.filter((w) => w.startsWith('project_financials.'))).toEqual([]); // nothing jumped the line
  });

  test('a Not-saved projects line lays its columns over the SERVER row and still does not loop', async () => {
    const { mountProjects } = await mountWith([PROJECT_LINE]);
    expect(mountProjects).toBeLessThanOrEqual(3);
    const job = await cachedJob();
    expect(job?.status).toBe('on_hold'); // the line's column wins
    expect(job?.name).toBe(SERVER_NAME); // everything else is the server's (round 7: the device row)
    await invalidate('projects');
    await pump(60);
    expect(projectSelects - mountProjects).toBeLessThanOrEqual(3);
  });

  test('...and his next edit folds the SERVER\'s other columns into that line, never the stale device row', async () => {
    serverProject = WEB_EDITED;
    await mountWith([PROJECT_LINE], undefined, true);
    await editAfterReread();
    expect(sent.filter((w) => w.table === 'projects')).toEqual([]); // parked behind the line
    // The owner's whole-row upsert parks as its own entry behind the refused
    // update (parkBehindUnsavedIn folds an upsert only into an upsert); Retry
    // replays them in order. The parked row is built on the SERVER row.
    const rows = await linesFor('projects');
    const parked = rows.filter((r) => r.description === 'walked the site with the owner');
    expect(parked).toHaveLength(1);
    expect(parked[0].name).toBe(SERVER_NAME); // round 7: the device's old name
    expect(parked[0].photo_count).toBe(7); // round 7: 0
    expect(parked[0].status).toBe('on_hold');
    expect((parked[0].client_portal as { enabled?: boolean }).enabled).toBe(false);
    expect(rows.some((r) => r.name === P.name)).toBe(false);
  });

  test('Discard still re-reads the list — and the server copy comes back', async () => {
    const { mountProjects } = await mountWith([FIN_LINE], 150000);
    await act(async () => { await discardUnsavedWrite('oq-fin-1'); });
    await pump(40);
    const reread = projectSelects - mountProjects;
    expect(reread).toBeGreaterThanOrEqual(1);
    expect(reread).toBeLessThanOrEqual(3);
    expect((await cachedJob())?.targetBudget).toBe(100000);
  });

  test('a Retry that lands still re-reads the list', async () => {
    const { mountProjects } = await mountWith([FIN_LINE], 150000);
    await act(async () => { await retryUnsavedWrite('oq-fin-1'); });
    await pump(40);
    const reread = projectSelects - mountProjects;
    expect(reread).toBeGreaterThanOrEqual(1);
    expect(reread).toBeLessThanOrEqual(3);
  });
});

describe('a Not-saved settings save never loops the profile read', () => {
  test('control: no line — one re-read is about one profile read', async () => {
    const { mountProfiles } = await mountWith([]);
    await invalidate('settings');
    await pump(60);
    expect(profileSelects - mountProfiles).toBeLessThanOrEqual(2);
  });

  test('a Not-saved profiles line: ≤2 profile reads at mount and after one re-read', async () => {
    const { mountProfiles } = await mountWith([SETTINGS_LINE]);
    expect(mountProfiles).toBeLessThanOrEqual(2); // round 3: 14, rising to 75
    await invalidate('settings');
    await pump(60);
    expect(profileSelects - mountProfiles).toBeLessThanOrEqual(2);
  });

  test('S1 (round 8): with NO device copy of his settings (a swept cache, then a cold launch) the row is read through the line', async () => {
    await mountWith([SETTINGS_LINE], undefined, true, 'none');
    expect(seen.settings?.taxRate).toBe(8.25); // round 7: 7.5 — the row alone
    expect(seen.settings?.branding?.companyName).toBe('Ridgeline Builders LLC');
    // An unrelated settings save parks behind the line — carrying HIS values.
    await act(async () => { seen.updateSettings!({ biometricsEnabled: true }); });
    await pump(60);
    const rows = await linesFor('profiles', SMOKE_USER.id);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      if ('tax_rate' in r) expect(r.tax_rate).toBe(8.25);
      if ('company_name' in r) expect(r.company_name).toBe('Ridgeline Builders LLC');
    }
  });

  test('S1b (round 8): a kept device copy is written back when a same-user sweep removed it', async () => {
    await mountWith([SETTINGS_LINE], undefined, true, { taxRate: 8.25, branding: { companyName: 'Ridgeline Builders LLC' } as AppSettings['branding'] });
    expect(seen.settings?.taxRate).toBe(8.25);
    await AsyncStorage.removeItem('mageid_settings');
    await invalidate('settings');
    await pump(40);
    const raw = await AsyncStorage.getItem('mageid_settings');
    expect(raw ? (JSON.parse(raw) as AppSettings).taxRate : null).toBe(8.25); // round 7: null until the next save
  });

  test('Discard still re-reads the profile', async () => {
    const { mountProfiles } = await mountWith([SETTINGS_LINE]);
    await act(async () => { await discardUnsavedWrite('oq-settings-1'); });
    await pump(40);
    const reread = profileSelects - mountProfiles;
    expect(reread).toBeGreaterThanOrEqual(1);
    expect(reread).toBeLessThanOrEqual(2);
  });
});
