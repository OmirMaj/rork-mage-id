/**
 * Q6 — the real screens, mounted in the real router, on the founder's case.
 *
 *  1. "Add scope" on a job typed Plumbing (his live "piping" job) opens the
 *     "What kind of project?" step on the Plumbing / Repipe chip. It used to
 *     open blank with no Plumbing chip, so he picked "Bathroom Remodel".
 *  2. The same screen on an Other job opens the Other box with his words.
 *  3. The Home job list prints an Other job's words, never the word "other".
 *  4. (fix round 1) JUDGES describe mode: Other opens a box, and the reason
 *     it is blocked shows until it has words.
 *  5. (fix round 1) The Scope Sheet header prints the label / his words, not
 *     the raw id ("other · estimate $X", "new_build · estimate $X").
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet } from 'react-native';
import { screen, fireEvent } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { world } from '@/__tests__/fixtures/world';
import type { Project } from '@/types';

const base = world.project as Project;
const PIPING: Project = { ...base, id: 'q6-piping', name: 'piping', type: 'plumbing', scope: undefined };
const REPIPE: Project = { ...base, id: 'q6-other', name: 'Okafor house', type: 'other', projectTypeOther: 'Whole-house repipe', scope: undefined };

async function seed(projects: Project[]) {
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(projects));
}
const bg = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style)?.backgroundColor;

describe('Q6 — project type on the real screens', () => {
  beforeEach(async () => { await primeWorld('empty'); });

  it('a Plumbing job opens "What kind of project?" on the Plumbing / Repipe chip', async () => {
    await seed([PIPING]);
    await mountRouteChecked(`/project-scope?id=${PIPING.id}`);
    expect(screen.getByText('What kind of project?')).toBeTruthy();
    // Selected chip paints differently from an unselected one.
    expect(bg('scope-type-Plumbing / Repipe')).not.toEqual(bg('scope-type-Bathroom Remodel'));
    expect(bg('scope-type-Bathroom Remodel')).toEqual(bg('scope-type-New Build'));
    expect(screen.queryByTestId('scope-type-other-input')).toBeNull();
  });

  it('an Other job opens the Other box with his words', async () => {
    await seed([REPIPE]);
    await mountRouteChecked(`/project-scope?id=${REPIPE.id}`);
    expect(screen.getByTestId('scope-type-other-input').props.value).toBe('Whole-house repipe');
  });

  it('the Home job list prints an Other job\'s words, not "other"', async () => {
    await seed([REPIPE, PIPING]);
    await mountRouteChecked('/');
    expect(screen.queryAllByText('Whole-house repipe').length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/^other$/i).length).toBe(0);
  });
});

describe('Q6 — JUDGES describe mode and the Scope Sheet header', () => {
  beforeEach(async () => { await primeWorld('empty'); });

  it('JUDGES: Other opens the box; the button is blocked with the reason until it has words', async () => {
    await mountRouteChecked('/judges');
    expect(screen.queryByTestId('judges-type-other')).toBeNull();
    fireEvent.press(screen.getByText('Other (describe it)'));
    expect(screen.getByTestId('judges-type-other')).toBeTruthy();
    expect(screen.getByText(/You picked Other\. Describe the job/)).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('judges-type-other'), 'Windows & doors');
    expect(screen.queryByText(/You picked Other/)).toBeNull();
  });

  it('Scope Sheet: an Other job\'s header prints his words, a new build "New Build" — never the raw id', async () => {
    const base = world.project as Project;
    const REPIPE: Project = { ...base, id: 'q6-ss-other', name: 'Okafor house', type: 'other', projectTypeOther: 'Whole-house repipe' };
    const NEW: Project = { ...base, id: 'q6-ss-new', name: 'Lot 7', type: 'new_build' };
    await AsyncStorage.setItem('mageid_projects', JSON.stringify([REPIPE, NEW]));
    await mountRouteChecked(`/scope-sheet?projectId=${REPIPE.id}`);
    expect(screen.getByText(/^Whole-house repipe · estimate/)).toBeTruthy();
    expect(screen.queryByText(/^other · estimate/)).toBeNull();
  });

  it('Scope Sheet: a new build reads "New Build", not new_build', async () => {
    const base = world.project as Project;
    const NEW: Project = { ...base, id: 'q6-ss-new2', name: 'Lot 7', type: 'new_build' };
    await AsyncStorage.setItem('mageid_projects', JSON.stringify([NEW]));
    await mountRouteChecked(`/scope-sheet?projectId=${NEW.id}`);
    expect(screen.getByText(/^New Build · estimate/)).toBeTruthy();
    expect(screen.queryByText(/new_build/)).toBeNull();
  });
});
