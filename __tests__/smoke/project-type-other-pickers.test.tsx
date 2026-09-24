/**
 * Q6 fix round 1 — the pickers the first pass missed.
 *
 *  1. AI Quick Estimate and JUDGES showed an Other chip with no box, so the AI
 *     was sent the bare word "Other". Picking Other now opens a "describe the
 *     job" box; the button is blocked, with the reason under the box, until
 *     it has words; and the words are what the AI is sent and grounded on.
 *     With any other type the screen behaves exactly as before (no box, no
 *     reason, button live).
 *     (JUDGES and the Scope Sheet header are proven on the real routes in
 *     project-type-other-routes.test.tsx.)
 */

import React from 'react';
import { render, fireEvent, act, screen } from '@testing-library/react-native';
import AIQuickEstimate from '@/components/AIQuickEstimate';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});
jest.mock('@/contexts/SubscriptionContext', () => ({ useSubscription: () => ({ tier: 'pro' }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: () => {}, back: () => {}, replace: () => {} }) }));
jest.mock('@/utils/aiRateLimiter', () => ({
  checkAILimit: async () => ({ allowed: true }),
  recordAIUsage: async () => {},
}));

const mockGenerate = jest.fn();
jest.mock('@/utils/aiService', () => {
  const actual = jest.requireActual('@/utils/aiService');
  return { ...actual, generateQuickEstimate: (...args: unknown[]) => mockGenerate(...args) };
});

describe('Q6 — AI Quick Estimate: Other needs words, and the AI gets them', () => {
  // Rendered on its own: it is a modal inside the full estimator.
  const groundingFor = jest.fn((_h: { projectType?: string; scope?: string }) => ({ facts: [], counts: { measured: 0, seeded: 0 }, selectedCount: 0, calibration: false }));
  const props = {
    visible: true, onClose: () => {}, onApplyEstimate: () => {}, existingMaterials: [],
    globalMarkup: 0, location: 'Austin, TX', calculateAssemblyCost: () => ({ materialsCost: 0, laborCost: 0, totalCost: 0 }),
    groundingFor,
  };

  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerate.mockRejectedValue(new Error('stop here'));
    groundingFor.mockClear();
  });

  async function mount() {
    render(<AIQuickEstimate {...props} />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  }

  it('any other type: no box, no reason, the button is live (unchanged)', async () => {
    await mount();
    expect(screen.queryByTestId('ai-type-other')).toBeNull();
    fireEvent.changeText(screen.getByPlaceholderText(/2,500 sqft kitchen remodel/), 'Repipe the whole house in PEX');
    expect(screen.getByTestId('ai-generate-btn').props.accessibilityState?.disabled ?? false).toBe(false);
    expect(screen.queryByText(/You picked Other/)).toBeNull();
  });

  it('Other: box + blocked button with the reason, then his words reach the AI and the grounding', async () => {
    await mount();
    fireEvent.changeText(screen.getByPlaceholderText(/2,500 sqft kitchen remodel/), 'Swap the 3-ton condenser and air handler');
    fireEvent.press(screen.getByText('Other (describe it)'));
    expect(screen.getByTestId('ai-type-other')).toBeTruthy();
    expect(screen.getByTestId('ai-generate-btn').props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByText(/You picked Other\. Describe the job/)).toBeTruthy();
    // The AI-only screen never promises a job list / PDF / portal.
    expect(screen.queryByText(/job list|client portal/)).toBeNull();

    fireEvent.changeText(screen.getByTestId('ai-type-other'), 'HVAC changeout');
    expect(screen.queryByText(/You picked Other/)).toBeNull();
    expect(screen.getByTestId('ai-generate-btn').props.accessibilityState?.disabled ?? false).toBe(false);
    await act(async () => { fireEvent.press(screen.getByTestId('ai-generate-btn')); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0][1]).toBe('HVAC changeout');
    expect(groundingFor).toHaveBeenCalledWith(expect.objectContaining({ projectType: 'HVAC changeout' }));
  });
});

