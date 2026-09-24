/**
 * Render guard for Settings > AI USAGE (founder question, 2026-09-24: "AI I see
 * you have 10 attempts").
 *
 * The block opened on `useState(10)` / `useState(3)` — the retired v1 free cap
 * and a number no plan has — and printed "Today: 0 of 10 requests" until the
 * usage read landed, and permanently when the read threw (`.catch(() => {})`).
 * These mount the REAL settings tab and assert on what a contractor reads:
 *
 *   1. a good read shows the plan's real cap (the seeded tier is Enterprise:
 *      150 a day, 40 advanced), never 10 or 3;
 *   2. a failed read says so, states the plan allowance, and offers a Retry
 *      that re-reads — no placeholder number anywhere;
 *   3. Retry after the cause is gone lands on the real numbers.
 *
 * The phone golden for the loaded card is desktop-page-frame's /settings
 * snapshot, which this change leaves byte-identical.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach(n => collectText(n, out)); return out; }
  const children = (node as { children?: unknown }).children;
  if (children) collectText(children, out);
  return out;
}
const flat = (tree: { toJSON: () => unknown }) => collectText(tree.toJSON()).join('');

describe('Settings > AI USAGE shows real numbers or says it could not', () => {
  it('a good read shows the plan cap from LIMITS, never the old 10 / 3 placeholders', async () => {
    await primeWorld('empty');
    const tree = await mountRouteChecked('/settings');
    const text = flat(tree);
    expect(text).toContain('AI USAGE');
    expect(text).toContain('Today: 0 of 150 requests');
    expect(text).toContain('Advanced: 0 of 40');
    expect(text).not.toMatch(/of 10 requests/);
    expect(text).not.toMatch(/Advanced: \d+ of 3\b/);
    expect(text).not.toContain('Couldn’t load today’s AI usage.');
    expect(text).not.toContain('Loading today’s AI usage');
  });

  it('a failed read is visible, keeps the plan allowance, and Retry re-reads', async () => {
    await primeWorld('empty');
    // A corrupt local usage cache makes getAIUsageStats throw — the case that
    // used to leave "0 of 10" up forever behind a swallowed error.
    await AsyncStorage.setItem('mage_ai_usage', '{corrupt');
    const tree = await mountRouteChecked('/settings');
    let text = flat(tree);
    expect(text).toContain('Couldn’t load today’s AI usage.');
    expect(text).toContain('Your plan: 150 AI requests a day, 40 of them advanced.');
    expect(text).not.toMatch(/Today: \d+ of \d+ requests/);
    expect(text).not.toMatch(/of 10 requests/);

    await AsyncStorage.removeItem('mage_ai_usage');
    fireEvent.press(tree.getByLabelText('Retry loading AI usage'));
    await settle();
    text = flat(tree);
    expect(text).not.toContain('Couldn’t load today’s AI usage.');
    expect(text).toContain('Today: 0 of 150 requests');
  });
});
