/**
 * Q5 (2026-09-24, founder: "what is prequal link?") — the sub's prequal form.
 *
 *  - It names who is asking (the lookup RPC returns the GC's company).
 *  - "Submitted" appears only after submit_prequal_packet says yes; a refused
 *    or failed save says so instead, and never both.
 *  - An approved packet is read-only: no input takes an edit, no autosave runs,
 *    so no "Couldn't save" pops on every pause.
 *  - A save the server refuses (expired / replaced link) alerts ONCE and locks.
 *  - An unreadable typed date is named under the field and stops the submit.
 *
 * Wiring is pinned statically by scripts/validate-prequal-q5.ts; the date and
 * token rules are executed by scripts/validate-prequal-engine.ts.
 */
import React from 'react';
import { renderRouter, screen, fireEvent, waitFor, act } from 'expo-router/testing-library';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';

const mockRpc = jest.fn();
const mockShowAlert = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isAuthenticated: false, isLoading: false }) }));
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => ({ subcontractors: [] }) }));
jest.mock('@/utils/alert', () => ({ showAlert: (...a: unknown[]) => mockShowAlert(...a) }));

// eslint-disable-next-line import/first
import PrequalForm from '@/app/prequal-form';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}><SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider></QueryClientProvider>;
}

function row(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'pk1', subcontractor_id: 's1', status,
    criteria: { minCglPerOccurrence: 1000000, minCglAggregate: 2000000, requireWorkersComp: true, requireCG2010: true, requireCG2037: false, requireW9: true, maxEmr: 1, minYearsInBusiness: 2 },
    financials: { yearsInBusiness: 5 }, safety: { writtenSafetyProgram: true },
    insurance: { cglPerOccurrence: 1000000, cglAggregate: 2000000, workersCompActive: true, hasCG2010: true, coiExpiry: '2099-01-01' },
    licenses: [], w9_on_file: true,
    invite_token: 'tok', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    gc_company_name: 'Hanover Builders', sub_company_name: 'Ace Plumbing',
    ...extra,
  };
}

type SubmitAnswer = { data: unknown; error: unknown };
function serve(status: string, submit: () => Promise<SubmitAnswer> | SubmitAnswer, extra: Record<string, unknown> = {}) {
  mockRpc.mockImplementation(async (name: string) => {
    if (name === 'lookup_prequal_packet_by_token') return { data: row(status, extra), error: null };
    if (name === 'submit_prequal_packet') return submit();
    return { data: null, error: null };
  });
}
const submitCalls = () => mockRpc.mock.calls.filter(c => c[0] === 'submit_prequal_packet');
const alertTitles = () => mockShowAlert.mock.calls.map(c => c[0]);

async function open() {
  renderRouter({ 'prequal-form': PrequalForm as () => React.ReactElement }, { initialUrl: '/prequal-form?token=tok', wrapper: Wrapper });
  await waitFor(() => expect(screen.queryByText('Loading prequalification packet…')).toBeNull());
}

beforeEach(() => { mockRpc.mockReset(); mockShowAlert.mockReset(); });

describe('prequal form (Q5)', () => {
  it('names the GC who is asking, and the sub, for a signed-out visitor', async () => {
    serve('invited', () => ({ data: true, error: null }));
    await open();
    expect(screen.getByTestId('prequal-requester').props.children).toBe('Prequalification for Hanover Builders');
    expect(screen.getByText('Ace Plumbing')).toBeTruthy();
    expect(screen.queryByText(/Prequalification · MAGE ID/)).toBeNull();
  });

  it('shows "Submitted" only after the server accepted it, then the footer moves', async () => {
    let resolve!: (a: SubmitAnswer) => void;
    serve('invited', () => new Promise<SubmitAnswer>(r => { resolve = r; }));
    await open();
    await act(async () => { fireEvent.press(screen.getByTestId('prequal-submit')); });
    expect(submitCalls()).toHaveLength(1);
    expect(submitCalls()[0][1].p_status).toBe('submitted');
    expect(alertTitles()).not.toContain('Submitted');
    await act(async () => { resolve({ data: true, error: null }); });
    await waitFor(() => expect(alertTitles()).toContain('Submitted'));
    expect(mockShowAlert.mock.calls.find(c => c[0] === 'Submitted')?.[1]).toMatch(/sent to Hanover Builders/);
    expect(screen.getByText('Submitted — awaiting review')).toBeTruthy();
  });

  it('a refused submit says "Not submitted", never "Submitted", and closes the form', async () => {
    serve('invited', () => ({ data: false, error: null }));
    await open();
    await act(async () => { fireEvent.press(screen.getByTestId('prequal-submit')); });
    await waitFor(() => expect(alertTitles()).toContain('Not submitted'));
    expect(alertTitles()).not.toContain('Submitted');
    expect(screen.getByText('Link closed — ask the GC for a fresh link')).toBeTruthy();
    expect(screen.getByTestId('prequal-locked')).toBeTruthy();
  });

  it('a failed submit (network) explains itself and leaves Submit in place', async () => {
    serve('invited', () => ({ data: null, error: { message: 'Failed to fetch' } }));
    await open();
    await act(async () => { fireEvent.press(screen.getByTestId('prequal-submit')); });
    await waitFor(() => expect(mockShowAlert).toHaveBeenCalled());
    expect(alertTitles()).not.toContain('Submitted');
    expect(screen.getByTestId('prequal-submit')).toBeTruthy();
    expect(screen.queryByText('Submitted — awaiting review')).toBeNull();
  });

  // Fake timers for the two autosave cases: the 800ms debounce is advanced,
  // not slept through.
  it('an approved packet is read-only and never autosaves', async () => {
    jest.useFakeTimers();
    try {
      serve('approved', () => ({ data: false, error: null }));
      await open();
      expect(screen.getByText('Approved — answers locked')).toBeTruthy();
      const years = screen.getByPlaceholderText('e.g. 8');
      expect(years.props.editable).toBe(false);
      expect(screen.getByPlaceholderText('2026-12-31').props.editable).toBe(false);
      // Even an edit that got through (a paste, an old keyboard) is ignored.
      await act(async () => { years.props.onChangeText('9'); });
      await act(async () => { jest.advanceTimersByTime(1500); });
      expect(submitCalls()).toHaveLength(0);
      expect(mockShowAlert).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText('e.g. 8').props.value).toBe('5');
      expect(screen.queryByText('Add license')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('an autosave the server refuses alerts once, then locks instead of re-alerting', async () => {
    jest.useFakeTimers();
    try {
      serve('invited', () => ({ data: false, error: null }));
      await open();
      await act(async () => { fireEvent.changeText(screen.getByPlaceholderText('e.g. 8'), '9'); });
      await act(async () => { jest.advanceTimersByTime(900); });
      await waitFor(() => expect(submitCalls()).toHaveLength(1));
      await waitFor(() => expect(alertTitles()).toEqual(["Couldn't save"]));
      await waitFor(() => expect(screen.getByTestId('prequal-locked')).toBeTruthy());
      await act(async () => { screen.getByPlaceholderText('e.g. 8').props.onChangeText('10'); });
      await act(async () => { jest.advanceTimersByTime(1500); });
      expect(submitCalls()).toHaveLength(1);
      expect(mockShowAlert).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('an unreadable COI date is named under the field and stops the submit', async () => {
    serve('invited', () => ({ data: true, error: null }), { insurance: { cglPerOccurrence: 1000000, cglAggregate: 2000000, workersCompActive: true, hasCG2010: true, coiExpiry: 'next March' } });
    await open();
    expect(screen.getByText('Not a date we can read — use YYYY-MM-DD, e.g. 2026-12-31')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('prequal-submit')); });
    expect(alertTitles()).toEqual(['Check the dates']);
    expect(submitCalls()).toHaveLength(0);
  });

  it('a US-style date is tidied to YYYY-MM-DD on blur', async () => {
    serve('invited', () => ({ data: true, error: null }));
    await open();
    const coi = screen.getByPlaceholderText('2026-12-31');
    await act(async () => { fireEvent.changeText(coi, '12/31/2099'); });
    await act(async () => { fireEvent(screen.getByPlaceholderText('2026-12-31'), 'blur'); });
    await waitFor(() => expect(screen.getByPlaceholderText('2026-12-31').props.value).toBe('2099-12-31'));
  });

  // Review r1: keyboardShouldPersistTaps="handled" means a Submit tap does not
  // blur the focused date field, so Submit has to tidy the date itself.
  it('Submit tapped with a US-style date still focused tidies it and sends it, no "Check the dates"', async () => {
    serve('invited', () => ({ data: true, error: null }));
    await open();
    await act(async () => { fireEvent.changeText(screen.getByPlaceholderText('2026-12-31'), '12/31/2099'); });
    // no blur
    await act(async () => { fireEvent.press(screen.getByTestId('prequal-submit')); });
    await waitFor(() => expect(submitCalls()).toHaveLength(1));
    expect(alertTitles()).not.toContain('Check the dates');
    expect(submitCalls()[0][1].p_insurance.coiExpiry).toBe('2099-12-31');
    await waitFor(() => expect(alertTitles()).toContain('Submitted'));
    expect(screen.getByPlaceholderText('2026-12-31').props.value).toBe('2099-12-31');
  });

  it('a half-typed date shows no error until the field is left', async () => {
    serve('invited', () => ({ data: true, error: null }));
    await open();
    const ERR = 'Not a date we can read — use YYYY-MM-DD, e.g. 2026-12-31';
    await act(async () => { fireEvent.changeText(screen.getByPlaceholderText('2026-12-31'), '2026-1'); });
    expect(screen.queryByText(ERR)).toBeNull();
    await act(async () => { fireEvent(screen.getByPlaceholderText('2026-12-31'), 'blur'); });
    expect(screen.getByText(ERR)).toBeTruthy();
    // Submit still refuses it, named.
    await act(async () => { fireEvent.press(screen.getByTestId('prequal-submit')); });
    expect(alertTitles()).toEqual(['Check the dates']);
    expect(submitCalls()).toHaveLength(0);
  });
});
