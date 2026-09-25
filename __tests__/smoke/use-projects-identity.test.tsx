/**
 * Wave 6d, lane Z2 (contract D17) — useProjects() is identity-stable.
 *
 * useProjects() merged the provider's seven memoised slices into a NEW object
 * on every call, so every useMemo / useEffect / useCallback keyed on the whole
 * object (Home's Smart Inbox, universal search, oac-meeting's meeting list,
 * the copilot schedule panel …) rebuilt on every render of its screen. The
 * merge is now memoised on the seven slices.
 *
 * The probe is mounted as a route inside the REAL app (the 16-provider stack,
 * the populated fixture world). Its parent re-renders three times through its
 * own local state — nothing the provider knows about — and the probe must see
 * the SAME reference each time. Then a real context action changes a project,
 * and the reference must change, carrying the new data.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { act } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { useProjects } from '@/contexts/ProjectContext';

type ProjectsApi = ReturnType<typeof useProjects>;

let renders = 0;
let latest: ProjectsApi | null = null;
let bumpParent: (() => void) | null = null;

function Probe() {
  latest = useProjects();
  renders += 1;
  return null;
}

function ProbeHost() {
  const [n, setN] = useState(0);
  bumpParent = () => setN((x) => x + 1);
  return (
    <View testID="z2-identity-host">
      <Text>{`parent render ${n}`}</Text>
      <Probe />
    </View>
  );
}

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

describe('useProjects() identity (D17)', () => {
  jest.setTimeout(120000);

  it('is the same object across unrelated re-renders, and a new one when the data changes', async () => {
    await primeWorld('populated');
    await mountRouteChecked('/z2-identity-probe', ProbeHost);
    await pump(10);

    const before = latest;
    expect(before).not.toBeNull();
    expect(before!.projects.some((p) => p.id === PROJECT_ID)).toBe(true);

    // Three re-renders the provider knows nothing about.
    for (let i = 0; i < 3; i++) {
      const rendersBefore = renders;
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { bumpParent!(); });
      // The probe really re-rendered (so it really called useProjects again) …
      expect(renders).toBeGreaterThan(rendersBefore);
      // … and got the same object back.
      expect(latest).toBe(before);
    }

    // A real context action that changes the projects collection.
    await act(async () => {
      before!.updateProject(PROJECT_ID, { name: 'Harlow Residence — renamed by the identity test' });
    });
    await pump(4);

    expect(latest).not.toBe(before);
    expect(latest!.projects.find((p) => p.id === PROJECT_ID)?.name).toBe('Harlow Residence — renamed by the identity test');

    // And it is stable again at the new identity.
    const after = latest;
    const rendersBefore = renders;
    await act(async () => { bumpParent!(); });
    expect(renders).toBeGreaterThan(rendersBefore);
    expect(latest).toBe(after);
  });
});
