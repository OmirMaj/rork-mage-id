/**
 * Ask MAGE "do it for me" (lane AIDO), mounted in Ask inside the REAL app (the
 * 16-provider stack, the populated fixture world, 390 x 844 iOS).
 *
 * THE PROMISES THIS PROVES
 *   1. Typing "create a project for the Henderson kitchen" into Ask shows the
 *      offer card (lead line, the "New Project" workflow, his words quoted, the
 *      honesty line, Start) and NOT a "You'll pick the job next" line: a new
 *      project has no job to pick.
 *   2. Detection is deterministic: no model call (mageAI), no One Mind answer,
 *      no AI meter.
 *   3. Nothing is written from Ask, nor from Start: Start only opens the
 *      Copilot (/copilot, new_project, his words, autostart), and the Copilot
 *      stops at its review with "Build it" and still no project write.
 *   4. Positive control, so the "no write" spies are proven live: tapping
 *      "Build it" creates the project (the projects upsert and the
 *      project_created event fire exactly then).
 *
 * The interview's one model turn is scripted (mageAI is mocked); everything
 * else (ProjectContext, the offline queue, the router) is the real code. The
 * scripted name starts 'Sample — ' only because ProjectContext.addProject
 * skips the QuickBooks push for samples, and that push's dynamic import()
 * cannot run under jest (as in w6c-home.test.tsx). The create write itself is
 * the same for a sample.
 */
const BUILT_NAME = 'Sample — Henderson Kitchen';

import React from 'react';
import { Dimensions } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import * as offlineQueue from '@/utils/offlineQueue';
import * as analytics from '@/utils/analytics';
import * as oneMindAnswer from '@/utils/oneMind/answer';
import * as aiUsage from '@/utils/aiRateLimiter';
import { mageAI } from '@/utils/mageAI';

const SAID = 'create a project for the Henderson kitchen';

jest.mock('@/utils/mageAI', () => {
  const actual = jest.requireActual('@/utils/mageAI');
  return {
    ...actual,
    mageAI: jest.fn(async () => ({
      success: true,
      data: {
        name: 'Sample — Henderson Kitchen',
        type: 'remodel',
        quality: 'standard',
        location: 'Brooklyn',
        squareFootage: 220,
        description: 'Kitchen remodel at the Henderson house',
      },
      cached: false,
      fromCache: false,
    })),
  };
});

beforeEach(() => {
  jest.useRealTimers();
  (mageAI as jest.Mock).mockClear();
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 }, screen: { width: 390, height: 844, scale: 3, fontScale: 1 } });
});
afterEach(() => {
  jest.restoreAllMocks();
});

async function pump(n = 8) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

function allText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => allText(n, out)); return out; }
  const kids = (node as { children?: unknown }).children;
  if (kids) allText(kids, out);
  return out;
}

const projectWrites = (spy: jest.SpyInstance) =>
  spy.mock.calls.filter(([table]) => table === 'projects');
const projectCreatedEvents = (spy: jest.SpyInstance) =>
  spy.mock.calls.filter(([event]) => event === analytics.AnalyticsEvents.PROJECT_CREATED);

describe('Ask MAGE: "do it for me" on a phone (real app)', () => {
  it('"create a project for the Henderson kitchen" shows the offer card, and nothing is written before Build it', async () => {
    await primeWorld('populated');
    const tree = await mountRouteChecked('/ask');
    expect(tree.getPathname()).toBe('/ask');

    // Spies go in after the mount, so hydration's own writes are not counted.
    const write = jest.spyOn(offlineQueue, 'supabaseWrite');
    const writeDetailed = jest.spyOn(offlineQueue, 'supabaseWriteDetailed');
    const writeOnline = jest.spyOn(offlineQueue, 'supabaseWriteOnlineDetailed');
    const track = jest.spyOn(analytics, 'track');
    const askOneMind = jest.spyOn(oneMindAnswer, 'askOneMind');
    const meter = jest.spyOn(aiUsage, 'recordAIUsage');

    fireEvent.changeText(screen.getByTestId('ask-input'), SAID);
    await pump(2);
    fireEvent.press(screen.getByTestId('ask-send'));
    await pump(4);

    // 1. The offer card.
    expect(screen.getByText('I can do that.')).toBeTruthy();
    const cardText = allText(screen.getByTestId('ask-action-card')).join('\n');
    expect(cardText).toContain('New Project');
    expect(screen.getByText('New Project')).toBeTruthy();
    expect(screen.getByText(`“${SAID}”`)).toBeTruthy();
    expect(screen.getByText('From what you typed. Nothing is saved until you check it and tap Build it.')).toBeTruthy();
    expect(screen.getByTestId('ask-action-start')).toBeTruthy();
    expect(screen.queryByText("You'll pick the job next")).toBeNull();
    expect(screen.getByTestId('ask-action-answer-instead')).toBeTruthy();

    // 2. Deterministic: no model call, no One Mind answer, no meter.
    expect(mageAI).not.toHaveBeenCalled();
    expect(askOneMind).not.toHaveBeenCalled();
    expect(meter).not.toHaveBeenCalled();

    // 3a. Nothing written from Ask.
    expect(projectWrites(write)).toHaveLength(0);
    expect(projectWrites(writeDetailed)).toHaveLength(0);
    expect(projectWrites(writeOnline)).toHaveLength(0);
    expect(projectCreatedEvents(track)).toHaveLength(0);

    // 3b. Start only opens the Copilot, pre-seeded with his words.
    fireEvent.press(screen.getByTestId('ask-action-start'));
    await pump(10);
    expect(tree.getPathname()).toBe('/copilot');
    expect(tree.getSearchParams()).toMatchObject({ capabilityId: 'new_project', seed: SAID, autostart: '1' });

    // The autostart sent his words as the first turn (the one scripted model
    // call), and the Copilot stopped at its review.
    for (let i = 0; i < 10 && !screen.queryByText('Build It'); i++) await pump(2);
    expect(mageAI).toHaveBeenCalledTimes(1);
    expect(String((mageAI as jest.Mock).mock.calls[0][0].prompt)).toContain(`WHAT THEY SAID: ${SAID}`);
    expect(screen.getByText('Build It')).toBeTruthy();
    expect(projectWrites(write)).toHaveLength(0);
    expect(projectWrites(writeDetailed)).toHaveLength(0);
    expect(projectWrites(writeOnline)).toHaveLength(0);
    expect(projectCreatedEvents(track)).toHaveLength(0);

    // 4. Positive control: Build it is the write.
    fireEvent.press(screen.getByText('Build It'));
    await pump(10);
    const created = projectCreatedEvents(track);
    expect(created).toHaveLength(1);
    const allProjectWrites = [...projectWrites(write), ...projectWrites(writeDetailed), ...projectWrites(writeOnline)];
    expect(allProjectWrites.length).toBeGreaterThanOrEqual(1);
    expect(allProjectWrites.some(([, , row]) => (row as { name?: string })?.name === BUILT_NAME)).toBe(true);
  });
});
