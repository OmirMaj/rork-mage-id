/**
 * Lane APPSET (first App Store submission) — PHONE PROOF for the Settings copy
 * and the one-time AI data-sharing consent.
 *
 * GOLDEN — recorded FIRST, on the untouched base (195b7361), before a line of
 * this lane was written, and afterwards only run with --ci. Each case records
 * the READABLE text of a real route mounted inside the real app (the provider
 * stack, the empty fixture world, the Enterprise tier the smoke world seeds),
 * one string per line, so a reviewer reads the delta as copy, not as a hash.
 *
 * The deltas this lane is allowed to make on iOS (spec APPSET MUST 1-4):
 *   • the FAQ no longer names Android / Google Play, no longer says paid plans
 *     are "turned on" by MAGE ID, and says data goes to AI providers only with
 *     permission;
 *   • the plan row for a paid tier with no App Store purchase is the plan name
 *     (no "turned on by MAGE ID", no email-to-change instruction);
 *   • the Enterprise card loses "Priority queue on heavy AI requests";
 *   • a new "AI features" row (On / Off) in Your data;
 *   • Notifications says "Your iPhone registers…" (no Android).
 * Anything else that moves is a regression.
 *
 * The AI answer is cleared after primeWorld so the "AI features" row reads the
 * first-run state ("Off", asked on first use) whether or not the shared world
 * seeds a yes for the suites that drive AI flows.
 *
 * BOTH CLOCKS ARE PINNED (finisher round). /settings prints when the AI
 * allowances reset ("Daily AI resets at 8:00 PM · Takeoff pages reset …"), and
 * the first recording read the wall clock: run after midnight UTC it said
 * "resets tomorrow at 8:00 PM" and went red with no code change. Same pins as
 * w6d-forms-phone (the app's Date.now and the outer realm's, which
 * renderRouter's fake timers start from).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach(n => collectText(n, out)); return out; }
  const children = (node as { children?: unknown }).children;
  if (children) collectText(children, out);
  return out;
}

// Text nodes that are only whitespace carry nothing a reader sees; time-of-day
// strings are not in these screens' copy.
const lines = (tree: { toJSON: () => unknown }) =>
  collectText(tree.toJSON()).map(s => s.trim()).filter(Boolean).join('\n');

const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-25T16:00:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;
let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
});
afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
});

describe('APPSET phone golden (iOS 390, text)', () => {
  it('/settings reads exactly as recorded', async () => {
    await primeWorld('empty');
    await AsyncStorage.removeItem('mageid_ai_consent_v1');
    const tree = await mountRouteChecked('/settings');
    expect(lines(tree)).toMatchSnapshot();
  });

  it('/notifications-settings reads exactly as recorded', async () => {
    await primeWorld('empty');
    const tree = await mountRouteChecked('/notifications-settings');
    expect(lines(tree)).toMatchSnapshot();
  });
});
