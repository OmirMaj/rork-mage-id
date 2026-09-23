// Smoke (#59 / #133 interim, client half): a daily report or photo created
// by a FIELD seat opens as a draft on his own phone.
//
// Migration 20260920140000 stores every field/viewer-seat INSERT of a daily
// report or photo as {status:'draft'} whatever autoShare says (the GC reviews
// it first). initialPortalState used to hand those seats 'sent' under
// auto-share, so a report made by voice (UniversalMicButton's note path goes
// through addDailyReport with no portalState) read "Shared in the homeowner's
// portal by your GC" and a photo showed "Sent" with a Recall bar until the
// next server read — while nothing had reached the homeowner.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { act } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID, SMOKE_USER } from '@/__tests__/fixtures/world';

const GC_OWNER_ID = '99999999-9999-4999-8999-999999999999';
import { useProjects } from '@/contexts/ProjectContext';
import { supabase } from '@/lib/supabase';

// The seat comes from project_collaborators (the projects loader re-reads it
// and a fresh read wins over the cached stamp), so the test answers that read.
function builder(rows: unknown[]) {
  const b: Record<string, unknown> = {
    then(ok: (v: unknown) => unknown, no: (e: unknown) => unknown) {
      return Promise.resolve({ data: rows, error: null, count: rows.length, status: 200, statusText: 'OK' }).then(ok, no);
    },
  };
  const p: unknown = new Proxy(b, { get(t, k) { if (typeof k === 'symbol') return undefined; if (k in t) return t[k]; return () => p; } });
  return p;
}
const realFrom = supabase.from;

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { try { jest.advanceTimersByTime(300); } catch { /* real timers */ } for (let k = 0; k < 20; k++) await Promise.resolve(); });
  }
}

async function seatAs(role: 'field' | 'viewer' | undefined): Promise<void> {
  const raw = JSON.parse((await AsyncStorage.getItem('mageid_projects'))!);
  const list = (Array.isArray(raw) ? raw : raw.data) as Array<Record<string, unknown>>;
  // A shared job is on the server's projects list under its OWNER's id (a
  // cached shared job missing from that list reads as revoked and is dropped).
  const projectRows = list.map((p) => {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) row[k.replace(/[A-Z]/g, ch => `_${ch.toLowerCase()}`)] = v;
    row.user_id = role ? GC_OWNER_ID : SMOKE_USER.id;
    return row;
  });
  supabase.from = ((table?: string) => {
    if (table === 'project_collaborators') return builder(role ? [{ project_id: PROJECT_ID, role, status: 'accepted' }] : []);
    if (table === 'projects') return builder(projectRows);
    return (realFrom as (this: unknown, t?: string) => unknown).call(supabase, table);
  }) as unknown as typeof supabase.from;
  const next = list.map(p => (p.id === PROJECT_ID ? { ...p, myRole: role } : p));
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(Array.isArray(raw) ? next : { ...raw, data: next }));
}

const REPORT_ID = 'smoke-voice-note-report';
const PHOTO_ID = 'smoke-field-photo';

function VoiceNoteProbe() {
  const ctx = useProjects();
  const [done, setDone] = useState(false);
  const project = ctx.projects.find(p => p.id === PROJECT_ID);
  useEffect(() => {
    if (done || !project) return;
    setDone(true);
    // The UniversalMicButton note path: addDailyReport with no portalState.
    ctx.addDailyReport({
      id: REPORT_ID, projectId: PROJECT_ID, date: new Date().toISOString(),
      weather: { temperature: '', conditions: '', wind: '', isManual: true },
      manpower: [], workPerformed: 'voice note', materialsDelivered: [], issuesAndDelays: '',
      photos: [], status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as unknown as Parameters<typeof ctx.addDailyReport>[0]);
    ctx.addProjectPhoto({
      id: PHOTO_ID, projectId: PROJECT_ID, uri: 'https://example.invalid/p.jpg',
      timestamp: new Date().toISOString(), createdAt: new Date().toISOString(),
    } as unknown as Parameters<typeof ctx.addProjectPhoto>[0]);
  }, [ctx, project, done]);
  const report = ctx.dailyReports.find(r => r.id === REPORT_ID);
  const photo = ctx.projectPhotos.find(p => p.id === PHOTO_ID);
  return (
    <>
      <Text testID="seat">{project?.myRole ?? 'owner'}</Text>
      <Text testID="report-state">{report ? (report.portalState?.status ?? 'none') : 'pending'}</Text>
      <Text testID="photo-state">{photo ? (photo.portalState?.status ?? 'none') : 'pending'}</Text>
    </>
  );
}

describe('a field seat’s report and photo open as drafts on his phone', () => {
  jest.setTimeout(60000);
  afterEach(() => { supabase.from = realFrom; });
  for (const [role, expected] of [['field', 'draft'], ['viewer', 'draft'], [undefined, 'sent']] as const) {
    it(`${role ?? 'owner'} seat → ${expected}`, async () => {
      await primeWorld('populated');
      await seatAs(role);
      const tree = await mountRouteChecked('/smoke-field-seat-draft', VoiceNoteProbe);
      await pump();
      await settle();
      expect(tree.getByTestId('seat').props.children).toBe(role ?? 'owner');
      expect(tree.getByTestId('report-state').props.children).toBe(expected);
      expect(tree.getByTestId('photo-state').props.children).toBe(expected);
    });
  }
});
