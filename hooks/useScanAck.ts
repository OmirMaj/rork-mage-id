// hooks/useScanAck.ts — asks "Before you rely on a scan" once per account, the
// first time a room scan is started or the Order List or Clearance Check is
// opened (components/roomScan/RoomScanFlow.tsx), and saves the record.
//
// A system alert and not a <Sheet>, for the reason components/CodeAckHost.tsx
// gives (a second Modal from inside a Modal may never present); on the web
// showAlert is the app's own alert modal. The rules are utils/scanAckCore.ts.
import { useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showAlert } from '@/utils/alert';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/LanguageContext';
import { useLegalCopy } from '@/hooks/useLegalCopy';
import { recordScanAck } from '@/utils/legalAcceptance';
import { createScanAckGate } from '@/utils/scanAckCore';

const gate = createScanAckGate({ storage: AsyncStorage });

export interface ScanAck {
  /** True when the scan action may go on (shows the notice once per account). Never throws. */
  ensure: () => Promise<boolean>;
  /** True, with no await, when this session already knows the account acknowledged.
   *  Handlers write `if (!scanAck.known() && !(await scanAck.ensure())) return;` so an
   *  acknowledged tap runs exactly as before (no extra tick before the button turns busy). */
  known: () => boolean;
}

export function useScanAck(): ScanAck {
  const { user } = useAuth();
  const { lang } = useT();
  const copy = useLegalCopy();
  const ref = useRef({ userId: user?.id ?? null, lang, copy });
  ref.current = { userId: user?.id ?? null, lang, copy };

  const ensure = useCallback(async () => {
    const { userId, lang: shownLang, copy: shown } = ref.current;
    if (gate.known(userId)) return true;
    const prompt = () => new Promise<boolean>((resolve) => {
      let done = false;
      const settle = (v: boolean) => { if (!done) { done = true; resolve(v); } };
      showAlert(
        shown.scanTitle,
        shown.scanBody,
        [{ text: shown.scanAckLabel, onPress: () => settle(true) }],
        { cancelable: false, onDismiss: () => settle(false) },
      );
    });
    return gate.ensure(userId, prompt, (at) => recordScanAck(userId, shownLang, at.getTime()));
  }, []);
  const known = useCallback(() => gate.known(ref.current.userId), []);
  return useMemo(() => ({ ensure, known }), [ensure, known]);
}
