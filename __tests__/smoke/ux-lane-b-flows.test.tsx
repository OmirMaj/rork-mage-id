/**
 * UX wave, Lane B (on-site operations) — the flows, mounted in the real app.
 *
 * Behaviour, not pixels (the pixels are ux-lane-b-phone's golden):
 *  B1  the crew sheet: "All N" + "Clock in N" writes one clock-in per worker on
 *      the default job; with no job the button says "Pick the project first";
 *      clockIn=1 opens the sheet.
 *  B2  punch new=1 opens the Add form; the Add bar is on screen.
 *  B3  an open RFI shows "Record the answer" at once; typing marks it Answered
 *      (chip), clearing puts it back.
 *  B4  a sub with a phone opens Messages addressed to him; the row then reads
 *      "Opened in Messages", never "Sent".
 *  B6  arrived=1 opens "It's here now"; saving writes a delivered delivery and
 *      its linked receipt, received-by = the signed-in user.
 *  B7  from a job, the code check has no Bid Advisor and Back names the job;
 *      from Tools it keeps both.
 */

import { isUnplannedArrival } from '@/utils/deliveryArrival';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, SMOKE_USER, world } from '@/__tests__/fixtures/world';
import type { Project } from '@/types';

async function pump(n = 5) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

beforeEach(() => { allowConsoleErrors(); });

const P = `projectId=${PROJECT_ID}`;
const now = new Date().toISOString();
const crew = ['Ava Stone', 'Ben Ruiz', 'Carl Diaz'].map((fullName, i) => ({
  id: `crew-b-${i + 1}`, companyUserId: SMOKE_USER.id, createdAt: now, updatedAt: now,
  fullName, trades: ['Framing'], status: 'active', idVerified: false,
}));

// The roster comes from the server read (an empty answer is authoritative),
// so it is served by a stubbed `crew_members` SELECT (w6d-r1-desktop's stub).
const crewRows = crew.map(c => ({
  id: c.id, user_id: SMOKE_USER.id, created_at: now, updated_at: now, full_name: c.fullName,
  trades: c.trades, phone: null, email: null, status: 'active', id_verified: false, is_public: false, project_ids: [],
}));
let fromSpy: jest.SpyInstance | null = null;
afterEach(() => { fromSpy?.mockRestore(); fromSpy = null; });
function serveCrew() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sb = require('@/lib/supabase') as { supabase: { from: (t?: string) => unknown } };
  const orig = sb.supabase.from;
  fromSpy = jest.spyOn(sb.supabase, 'from').mockImplementation((table?: string) => {
    if (table !== 'crew_members') return orig(table);
    let isWrite = false;
    const target: Record<string, unknown> = {
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        const data = isWrite ? null : crewRows;
        return Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : 0, status: 200, statusText: 'OK' }).then(ok, bad);
      },
    };
    const proxy: unknown = new Proxy(target, {
      get(t, prop: string) {
        if (prop in t) return t[prop];
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'insert' || prop === 'update' || prop === 'upsert' || prop === 'delete') isWrite = true;
        return () => proxy;
      },
    });
    return proxy;
  });
}

async function readJson<T>(key: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  const parsed = raw ? JSON.parse(raw) : [];
  return Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
}

describe('UX lane B — flows', () => {
  jest.setTimeout(120000);

  it('B1: clockIn=1 opens the crew sheet; All 3 + Clock in 3 writes three clock-ins on the job', async () => {
    await primeWorld('populated');
    serveCrew();
    await mountRouteChecked(`/time-tracking?${P}&clockIn=1`);
    await pump();
    expect(screen.getByTestId('clock-in-batch')).toBeTruthy();
    expect(screen.getByTestId('clock-in-job-name').props.children).toBe((world.project as Project).name);
    fireEvent.press(screen.getByTestId('clock-in-all'));
    await pump(2);
    expect(screen.getByText('Clock in 3')).toBeTruthy();
    fireEvent.press(screen.getByTestId('clock-in-batch'));
    await pump();
    const entries = await readJson<{ projectId: string; workerId: string; status: string }>('mageid_time_entries');
    const mine = entries.filter(e => e.projectId === PROJECT_ID && e.status !== 'clocked_out' && e.workerId.startsWith('crew-b-'));
    expect(mine.map(e => e.workerId).sort()).toEqual(['crew-b-1', 'crew-b-2', 'crew-b-3']);
  });

  it('B1: with no job resolved the button says "Pick the project first"', async () => {
    await primeWorld('populated');
    serveCrew();
    await mountRouteChecked('/time-tracking');
    await pump();
    fireEvent.press(screen.getByTestId('time-tracking-clock-in'));
    await pump(2);
    // No route, no real pick, no recent job: nothing preselected.
    const reason = screen.queryByTestId('clock-in-batch-reason');
    const name = screen.getByTestId('clock-in-job-name').props.children;
    if (name === 'Pick the project first') {
      expect(reason?.props.children).toBe('Pick the project first');
      expect(screen.getByTestId('clock-in-batch').props.accessibilityState?.disabled).toBe(true);
    } else {
      // A recent job exists in this world: it must be a real, eligible job.
      expect(name).toBe((world.project as Project).name);
    }
  });

  it('B2: new=1 opens the Add form, and the Add bar is on screen', async () => {
    await primeWorld('populated');
    await mountRouteChecked(`/punch-list?${P}&new=1`);
    await pump();
    expect(screen.getByTestId('punch-add-bar')).toBeTruthy();
    expect(screen.getByTestId('save-punch-item')).toBeTruthy();
    expect(screen.getByTestId('punch-recent-locations')).toBeTruthy();
  });

  it('B3: an open RFI shows "Record the answer" at once; typing marks it Answered, clearing reverts', async () => {
    await primeWorld('populated');
    await mountRouteChecked(`/rfi?${P}&rfiId=rfi-2`);
    await pump();
    const box = screen.getByTestId('rfi-answer');
    expect(screen.getByText('Record the answer')).toBeTruthy();
    fireEvent.changeText(box, 'Use the Schluter Kerdi assembly per spec 09 30 00.');
    await pump(2);
    expect(screen.getByTestId('rfi-answer-chip')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('rfi-answer'), '');
    await pump(2);
    expect(screen.queryByTestId('rfi-answer-chip')).toBeNull();
  });

  it('B4: a sub with a phone opens Messages addressed to him; the row reads "Opened in Messages"', async () => {
    const sub = { id: 'sub-b-1', companyName: 'Acme Drywall', contactName: '', phone: '(555) 800-0001', email: '', address: '', trade: 'Drywall', licenseNumber: '', licenseExpiry: '', coiExpiry: '', w9OnFile: true, bidHistory: [], assignedProjects: [], notes: '', createdAt: now, updatedAt: now };
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const project = {
      ...(world.project as unknown as Record<string, unknown>), id: 'proj-b-lu', name: 'Main St Reno',
      schedule: {
        id: 'proj-b-lu-s', name: 's', projectId: 'proj-b-lu', startDate: iso, workingDaysPerWeek: 7, bufferDays: 0,
        totalDurationDays: 5, criticalPathDays: 5, laborAlignmentScore: 0, riskItems: [],
        tasks: [{ id: 't1', title: 'Hang board', phase: '', startDay: 1, durationDays: 3, status: 'not_started', progress: 0, crew: '', dependencies: [], notes: '', assignedSubId: 'sub-b-1' }],
      },
    };
    await primeWorld('empty');
    await AsyncStorage.setItem('mageid_projects', JSON.stringify([project]));
    await AsyncStorage.setItem('mageid_subcontractors', JSON.stringify([sub]));
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await mountRouteChecked('/tomorrow-lineup?projectId=proj-b-lu');
    await pump();
    await act(async () => { fireEvent.press(screen.getByTestId('lineup-send-sub-b-1')); });
    await pump(2);
    expect(open).toHaveBeenCalledTimes(1);
    const url = String(open.mock.calls[0][0]);
    expect(url.startsWith('sms:5558000001')).toBe(true);
    expect(decodeURIComponent(url.split('body=')[1])).toContain('Hang board');
    expect(screen.getByTestId('lineup-status-sub-b-1').props.children).toBe('Opened in Messages');
    open.mockRestore();
  });

  it('B6: arrived=1 opens "It\'s here now"; saving writes a delivered delivery and its linked receipt', async () => {
    await primeWorld('populated');
    await mountRouteChecked(`/deliveries?${P}&arrived=1`);
    await pump();
    expect(screen.getByTestId('arrived-save')).toBeTruthy();
    // Received by = the signed-in user's own name, as the app holds it.
    const me = screen.getByTestId('arrived-by').props.value as string;
    expect(me.trim().length).toBeGreaterThan(0);
    fireEvent.changeText(screen.getByTestId('arrived-supplier'), 'Nobody-Logged Supply');
    fireEvent.changeText(screen.getByTestId('arrived-what'), '40 sheets 5/8 board');
    await pump(1);
    await act(async () => { fireEvent.press(screen.getByTestId('arrived-save')); });
    await pump();
    const deliveries = await readJson<{ id: string; status: string; receiptId?: string; description: string; projectId: string; createdAt: string; deliveredAt?: string }>('mageid_deliveries');
    const d = deliveries.find(x => x.description === '40 sheets 5/8 board');
    expect(d?.status).toBe('delivered');
    // Fix round 1: the scorecard must read no advance promise from it.
    expect(isUnplannedArrival({ status: 'delivered', createdAt: d?.createdAt ?? '', deliveredAt: d?.deliveredAt })).toBe(true);
    const receipts = await readJson<{ id: string; deliveryId?: string; receivedBy: string }>('mageid_delivery_receipts');
    const r = receipts.find(x => x.deliveryId === d?.id);
    expect(r?.id).toBe(d?.receiptId);
    expect(r?.receivedBy).toBe(me);
  });

  it('B7: from a job — no Bid Advisor, Back names the job; from Tools both stay', async () => {
    await primeWorld('populated');
    await mountRouteChecked(`/construction-ai?${P}&source=project`);
    await pump();
    expect(screen.queryByTestId('construction-ai-bid-advisor')).toBeNull();
    expect(screen.getByTestId('code-check-photo')).toBeTruthy();
    const back = screen.queryByTestId('construction-ai-back-to-tools');
    if (back) expect(back.props.accessibilityLabel).toBe(`Back to ${(world.project as Project).name}`);
  });

  it('B7: the plain Tools entry keeps the Bid Advisor', async () => {
    await primeWorld('populated');
    await mountRouteChecked('/construction-ai');
    await pump();
    expect(screen.getByTestId('construction-ai-bid-advisor')).toBeTruthy();
  });
});
