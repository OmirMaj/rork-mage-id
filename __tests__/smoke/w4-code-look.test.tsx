/**
 * Photo Code Look (wave 4, lane P) — BEHAVIOUR ONLY, no snapshot.
 *
 * The model call (utils/photoAnalyzer analyzePhotoCodeLook) is mocked; the
 * answer still goes through the REAL utils/codeLook normaliser, so routing
 * (low → check on site) and the always-present can't-tell line are the real
 * ones. The sheet is mounted inside the real app tree (an injected route under
 * app/_layout), so useProjects / useTierAccess are the real providers.
 */

import React from 'react';
import { Text, View, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { useProjects } from '@/contexts/ProjectContext';
import CodeLookSheet, { CODE_LOOK_NEEDS_PRO } from '@/components/codeLook/CodeLookSheet';
import { CODE_LOOK_DISCLAIMER, CODE_LOOK_NOTHING_FLAGGED } from '@/utils/codeLook';
import { analyzePhotoCodeLook } from '@/utils/photoAnalyzer';
import type { Permit } from '@/types';

jest.mock('@/utils/photoAnalyzer', () => {
  const actual = jest.requireActual('@/utils/photoAnalyzer');
  return { ...actual, analyzePhotoCodeLook: jest.fn() };
});

const mockLook = analyzePhotoCodeLook as jest.MockedFunction<typeof analyzePhotoCodeLook>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { normalizeCodeLook } = jest.requireActual('@/utils/codeLook') as typeof import('@/utils/codeLook');

const PHOTO = 'https://example.test/storage/v1/object/sign/project-photos/rough-in.jpg';
const SOURCE_PHOTO_ID = 'photo-src-codelook-1';

const TWO_PLUS_LOW = {
  observations: [
    { what: 'Cable not stapled within reach of the box', whereInPhoto: 'upper left stud bay', family: 'electrical', topic: 'cable support', codeRef: '', confidence: 'high' },
    { what: 'Nail plate appears missing where the pipe crosses the stud', whereInPhoto: 'center', family: 'plumbing', topic: 'protection', codeRef: 'IRC R602.6', confidence: 'med' },
    { what: 'Possible gap in fire-stopping at the top plate', whereInPhoto: 'top right', family: 'fire', topic: 'fire-stopping', codeRef: '', confidence: 'low' },
  ],
  cantTell: [{ what: 'Box fill inside the two-gang box', betterShot: 'A straight-on shot into the open box' }],
};

function textOf(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => textOf(n, out)); return out; }
  const children = (node as { children?: unknown }).children;
  if (children) textOf(children, out);
  return out;
}

function Harness() {
  const { getProject, getPunchItemsForProject } = useProjects();
  const project = getProject(PROJECT_ID);
  if (!project) return <Text>loading</Text>;
  const punches = getPunchItemsForProject(PROJECT_ID)
    .filter((p) => p.photoUri === PHOTO)
    .map((p) => ({ photoUri: p.photoUri, sourcePhotoId: p.sourcePhotoId, description: p.description }));
  return (
    <View style={{ flex: 1 }}>
      <Text testID="probe-punches">{JSON.stringify(punches)}</Text>
      <CodeLookSheet visible onClose={() => {}} project={project} photoUri={PHOTO} sourcePhotoId={SOURCE_PHOTO_ID} />
    </View>
  );
}

async function mountHarness() {
  const tree = await mountRouteChecked('/codelook-harness', Harness);
  await settle();
  return tree;
}

async function tapLook() {
  await act(async () => { fireEvent.press(screen.getByTestId('codelook-run')); });
  await settle();
}

beforeEach(async () => {
  allowConsoleErrors();
  mockLook.mockReset();
  await primeWorld('populated');
});

test('(1) nothing model-derived renders before the explicit tap — and no call is made', async () => {
  mockLook.mockResolvedValue(normalizeCodeLook(TWO_PLUS_LOW));
  await mountHarness();
  expect(screen.getByTestId('codelook-sheet')).toBeTruthy();
  expect(screen.getByTestId('codelook-run')).toBeTruthy();
  expect(mockLook).not.toHaveBeenCalled();
  expect(screen.queryByTestId('codelook-headline')).toBeNull();
  expect(screen.queryByTestId('codelook-cant-tell')).toBeNull();
  expect(screen.queryByText(/Cable not stapled/)).toBeNull();
});

test('(2) after the tap: observations, check on site, can\'t tell and the fixed disclaimer', async () => {
  mockLook.mockResolvedValue(normalizeCodeLook(TWO_PLUS_LOW));
  await mountHarness();
  await tapLook();
  expect(mockLook).toHaveBeenCalledTimes(1);
  const arg = mockLook.mock.calls[0][0];
  expect(arg.photoUrl).toBe(PHOTO);
  expect(typeof arg.codeLook.jurisdictionBlock).toBe('string');

  expect(screen.getByTestId('codelook-disclaimer').props.children).toBe(CODE_LOOK_DISCLAIMER);
  expect(screen.getByTestId('codelook-headline').props.children).toBe('3 things an inspector would look at · 1 to check on site');
  const obs = screen.getByTestId('codelook-observations');
  expect(within(obs).getByText('Cable not stapled within reach of the box')).toBeTruthy();
  expect(within(obs).getByText('Nail plate appears missing where the pipe crosses the stud')).toBeTruthy();
  expect(within(obs).getByText('IRC R602.6')).toBeTruthy();
  const site = screen.getByTestId('codelook-check-on-site');
  expect(within(site).getByText('Possible gap in fire-stopping at the top plate')).toBeTruthy();
  expect(within(site).getByText('Hard to see — check on site')).toBeTruthy();
  const cant = screen.getByTestId('codelook-cant-tell');
  expect(within(cant).getByText('Box fill inside the two-gang box')).toBeTruthy();
  expect(within(cant).getByText('Better shot: A straight-on shot into the open box')).toBeTruthy();
});

test('(3) zero observations → exactly the nothing-flagged line, the can\'t-tell group still shows, and no verdict words', async () => {
  mockLook.mockResolvedValue(normalizeCodeLook({ observations: [], cantTell: [] }));
  const tree = await mountHarness();
  await tapLook();
  expect(screen.getByTestId('codelook-headline').props.children).toBe(CODE_LOOK_NOTHING_FLAGGED);
  expect(CODE_LOOK_NOTHING_FLAGGED).toBe("Nothing flagged in what's visible.");
  expect(screen.getByTestId('codelook-cant-tell')).toBeTruthy();
  expect(screen.getByText('Anything behind the finish or outside the frame')).toBeTruthy();
  expect(screen.queryByTestId('codelook-observations')).toBeNull();
  const all = textOf(tree.toJSON()).join('\n');
  expect(all).not.toMatch(/no issues|passes|compliant/i);
});

test('(4) "Make punch item" files an internal punch pinned to THIS photo', async () => {
  mockLook.mockResolvedValue(normalizeCodeLook(TWO_PLUS_LOW));
  await mountHarness();
  await tapLook();
  const first = normalizeCodeLook(TWO_PLUS_LOW).observations[0];
  await act(async () => { fireEvent.press(screen.getByTestId(`codelook-punch-${first.id}`)); });
  await settle();
  const punches = JSON.parse(String(screen.getByTestId('probe-punches').props.children)) as { photoUri: string; sourcePhotoId?: string; description: string }[];
  expect(punches).toEqual([{ photoUri: PHOTO, sourcePhotoId: SOURCE_PHOTO_ID, description: first.what }]);
  // The row now says it is in punch, and cannot be pressed again.
  const btn = screen.getByTestId(`codelook-punch-${first.id}`);
  expect(within(btn).getByText('In punch (internal)')).toBeTruthy();
  expect(btn.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
});

test('(5) free tier: the Pro reason, never a model call', async () => {
  await AsyncStorage.setItem('mageid_subscription_tier', 'free');
  mockLook.mockResolvedValue(normalizeCodeLook(TWO_PLUS_LOW));
  await mountHarness();
  expect(screen.getByTestId('codelook-needs-pro').props.children).toBe(CODE_LOOK_NEEDS_PRO);
  expect(screen.queryByTestId('codelook-run')).toBeNull();
  expect(screen.getByTestId('codelook-see-pro')).toBeTruthy();
  expect(mockLook).not.toHaveBeenCalled();
  expect(screen.queryByTestId('codelook-headline')).toBeNull();
});

// ── (6) Inside Inspection Ready — the inspection-ready.test.tsx mount ─────
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-25T15:00:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;

function goldenDayPlus(n: number): string {
  const g = new OuterDate(GOLDEN_CLOCK);
  const d = new OuterDate(g.getFullYear(), g.getMonth(), g.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function seedReadyPermit() {
  const raw = JSON.parse((await AsyncStorage.getItem('mageid_permits')) ?? '[]');
  const list: Permit[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  const ready: Permit = {
    id: 'permit-codelook-p',
    projectId: PROJECT_ID,
    projectName: 'Fixture job',
    type: 'electrical',
    permitNumber: 'ELE-26-07777',
    jurisdiction: 'City of Portland Bureau of Development Services',
    status: 'inspection_scheduled',
    phase: 'Rough electrical',
    appliedDate: goldenDayPlus(-30),
    inspectionDate: goldenDayPlus(2),
    fee: 250,
  };
  const next = [...list.filter((p) => p.id !== ready.id), ready];
  await AsyncStorage.setItem('mageid_permits', JSON.stringify(Array.isArray(raw) ? next : { ...raw, data: next }));
}

describe('inside Inspection Ready', () => {
  let nowSpy: jest.SpyInstance | null = null;
  let outerNowSpy: jest.SpyInstance | null = null;
  beforeEach(async () => {
    jest.useRealTimers();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
    await AsyncStorage.setItem('mageid_subscription_tier', 'free');
    await seedReadyPermit();
  });
  afterEach(() => {
    nowSpy?.mockRestore();
    nowSpy = null;
    outerNowSpy?.mockRestore();
    outerNowSpy = null;
  });

  test('(6) each line offers Code look, and the look renders INSIDE the prep sheet — no second Modal', async () => {
    await mountRouteChecked(`/project-detail?id=${PROJECT_ID}`);
    await settle();
    const rows = screen.getAllByText('Get ready for Rough electrical');
    await act(async () => { fireEvent.press(rows[0]); });
    await settle();

    const sheet = screen.getByTestId('inspection-ready-sheet');
    const actions = within(sheet).getAllByTestId(/^codelook-prep-/);
    expect(actions.length).toBeGreaterThan(0);
    const modalsBefore = screen.UNSAFE_queryAllByType(Modal).length;

    const picked = { canceled: false, assets: [{ uri: 'file:///tmp/rough-in.jpg', width: 10, height: 10 }] } as unknown as ImagePicker.ImagePickerResult;
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValueOnce(picked);
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce(picked);
    await act(async () => { fireEvent.press(actions[0]); });
    await settle();

    const embedded = within(screen.getByTestId('inspection-ready-sheet')).getByTestId('codelook-embedded');
    expect(within(embedded).getByTestId('codelook-sheet')).toBeTruthy();
    // Free tier: the Pro reason, from inside the prep sheet.
    expect(within(embedded).getByTestId('codelook-needs-pro')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(Modal).length).toBe(modalsBefore);
    expect(mockLook).not.toHaveBeenCalled();

    // Close the look: the prep sheet is still there.
    await act(async () => { fireEvent.press(within(embedded).getByTestId('codelook-close')); });
    await settle();
    expect(screen.queryByTestId('codelook-embedded')).toBeNull();
    expect(screen.getByTestId('inspection-ready-sheet')).toBeTruthy();
  });
});

test('(7) project-detail with the lightbox closed mounts no Code look sheet', async () => {
  await mountRouteChecked(`/project-detail?id=${PROJECT_ID}`);
  await settle();
  expect(screen.queryByTestId('codelook-sheet')).toBeNull();
  expect(screen.queryByTestId('codelook-open-lightbox')).toBeNull();
});
