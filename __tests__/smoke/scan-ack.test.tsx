/**
 * Smoke — the first-use scan notice (hooks/useScanAck.ts, lane PROTECT-SERVER).
 *
 *   SA1 The first time, the notice is shown with the agreed sentence and one
 *       button, "I Understand". Nothing goes on until it is tapped.
 *   SA2 The tap lets the action go on, saves the device record and records the
 *       acknowledgement for the signed-in account, in the language shown.
 *   SA3 The second time nothing is asked and nothing is recorded again.
 *   SA4 A dismissed notice is not an acknowledgement: the action does not go
 *       on, nothing is stored, and the next tap asks again.
 *   SA5 A recorder that throws does not stop the action.
 */

import React from 'react';
import { Pressable, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanupAsync, fireEvent, render } from '@testing-library/react-native';

type Btn = { text: string; onPress?: () => void };
type Opts = { cancelable?: boolean; onDismiss?: () => void };
const mockAlerts: Array<{ title: string; message?: string; buttons?: Btn[]; options?: Opts }> = [];
jest.mock('@/utils/alert', () => ({
  showAlert: (title: string, message?: string, buttons?: Btn[], options?: Opts) => { mockAlerts.push({ title, message, buttons, options }); },
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: '00000000-0000-4000-8000-0000000000a1' } }) }));
const mockRecord = jest.fn();
jest.mock('@/utils/legalAcceptance', () => ({ recordScanAck: (...a: unknown[]) => mockRecord(...a) }));

import { useScanAck } from '@/hooks/useScanAck';
import { SCAN_ACK_STORAGE_KEY } from '@/utils/scanAckCore';
import { SCAN_ACK_COPY } from '@/utils/legalAcceptanceCore';

const went = jest.fn();
function Harness() {
  const scanAck = useScanAck();
  return (
    <Pressable testID="go" onPress={() => { void scanAck.ensure().then((ok) => { if (ok) went(); }); }}>
      <Text>{scanAck.known() ? 'known' : 'not known'}</Text>
    </Pressable>
  );
}
const tick = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };

describe('the first-use scan notice', () => {
  beforeEach(() => { mockAlerts.length = 0; mockRecord.mockReset(); went.mockReset(); });
  afterEach(async () => { await cleanupAsync(); });

  // One module instance holds the gate, so the cases run in order on one phone.
  it('SA4 a dismissed notice is not an acknowledgement', async () => {
    await AsyncStorage.removeItem(SCAN_ACK_STORAGE_KEY);
    const { getByTestId } = render(<Harness />);
    fireEvent.press(getByTestId('go'));
    await tick();
    expect(mockAlerts).toHaveLength(1);
    await act(async () => { mockAlerts[0].options?.onDismiss?.(); });
    await tick();
    expect(went).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(SCAN_ACK_STORAGE_KEY)).toBeNull();
  });

  it('SA1 SA2 the notice is the agreed sentence; the tap goes on and records it', async () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.press(getByTestId('go'));
    await tick();
    expect(mockAlerts).toHaveLength(1);
    expect(mockAlerts[0].title).toBe(SCAN_ACK_COPY.title);
    expect(mockAlerts[0].message).toBe('A scan is a first measure. It can be off by an inch or more. Check before you order, cut, price or build from it.');
    expect(mockAlerts[0].buttons).toHaveLength(1);
    expect(mockAlerts[0].buttons?.[0].text).toBe('I Understand');
    expect(mockAlerts[0].options?.cancelable).toBe(false);
    expect(went).not.toHaveBeenCalled();
    await act(async () => { mockAlerts[0].buttons?.[0].onPress?.(); });
    await tick();
    expect(went).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls[0][0]).toBe('00000000-0000-4000-8000-0000000000a1');
    expect(mockRecord.mock.calls[0][1]).toBe('en');
    expect(typeof mockRecord.mock.calls[0][2]).toBe('number');
    const stored = JSON.parse((await AsyncStorage.getItem(SCAN_ACK_STORAGE_KEY)) ?? '{}');
    expect(stored.account).toBe('00000000-0000-4000-8000-0000000000a1');
  });

  it('SA3 the second time nothing is asked', async () => {
    const { getByTestId, getByText } = render(<Harness />);
    expect(getByText('known')).toBeTruthy();
    fireEvent.press(getByTestId('go'));
    await tick();
    expect(mockAlerts).toHaveLength(0);
    expect(went).toHaveBeenCalledTimes(1);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe('the scan notice when the recorder throws', () => {
  it('SA5 the action still goes on', async () => {
    const { createScanAckGate } = jest.requireActual('@/utils/scanAckCore');
    const mem = new Map<string, string>();
    const gate = createScanAckGate({ storage: { getItem: async (k: string) => mem.get(k) ?? null, setItem: async (k: string, v: string) => { mem.set(k, v); } } });
    const ok = await gate.ensure('u1', async () => true, () => { throw new Error('recorder down'); });
    expect(ok).toBe(true);
    expect(gate.known('u1')).toBe(true);
  });
});
