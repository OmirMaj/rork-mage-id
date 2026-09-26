// __tests__/smoke/scope-gaps.test.tsx — Step-3 L1: the Scope Code Gaps card
// renders inside the real provider stack (injected route under app/_layout),
// in cart mode, with its sanctioned root testID, the starter label and the
// Home/Commercial toggle. No snapshots: the goldens strip 'scopegaps-' roots
// (__tests__/helpers/sanctionedStrip), so THIS test is what proves the card
// shows up.
import React from 'react';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { ScopeGapsCard } from '@/components/scopeGaps/ScopeGapsCard';
import { SCOPE_GAPS_STARTER_LABEL } from '@/utils/codeScopeTriggers';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';

function CartProbe() {
  return <ScopeGapsCard mode="cart" lines={[{ name: 'Bedroom addition framing' }]} storageKey="cart:current" />;
}

function allText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach(n => allText(n, out)); return out; }
  const c = (node as { children?: unknown }).children;
  if (c) allText(c, out);
  return out;
}

describe('Scope Code Gaps card (cart mode)', () => {
  it('renders its root, the starter label, the job-kind toggle and the fired rules', async () => {
    await primeWorld('empty');
    const tree = await mountRouteChecked('/smoke-scope-gaps', CartProbe);
    expect(tree.getByTestId('scopegaps-card')).toBeTruthy();
    expect(tree.getByText(SCOPE_GAPS_STARTER_LABEL)).toBeTruthy();
    expect(tree.getByTestId('scopegaps-jobkind')).toBeTruthy();
    const text = allText(tree.toJSON()).join('\n');
    expect(text).toContain('Code items your scope usually triggers');
    expect(text).toContain('Edition unknown — confirm with your AHJ.');
    // 'Bedroom addition framing' fires the sleeping-room alarms and AFCI rules.
    expect(tree.getByTestId('scopegaps-row-smoke-co-sleeping')).toBeTruthy();
    expect(tree.getByTestId('scopegaps-row-habitable-afci')).toBeTruthy();
    expect(tree.getByTestId('scopegaps-qty-smoke-co-sleeping')).toBeTruthy();
    // No price in an empty book: it says so, and Add line says why it is off.
    expect(text).toContain('No price of yours yet — add it in the estimator with your price.');
    expect(text).toContain('until you sign out');
    // The golden strip removes the whole card.
    expect(allText(stripSanctioned(tree.toJSON())).join('\n')).not.toContain('Code items your scope usually triggers');
  });
});
