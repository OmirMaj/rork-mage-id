// utils/codeAck.ts — the app's one "Before you rely on a code answer" gate.
//
// The logic is utils/codeAckCore.ts (pure); this file only wires it to
// AsyncStorage. Every building-code AI surface awaits ensureCodeAck() BEFORE
// its request. components/CodeAckHost.tsx, mounted once in app/_layout.tsx,
// registers how to show the notice and who is signed in.
//
// No react-native import on purpose (the same reason as utils/aiConsent.ts):
// bun validators import AI utils with react-native stubbed or absent.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createCodeAckGate, type CodeAckHost, type CodeAckRecord } from '@/utils/codeAckCore';

export {
  CODE_ACK_COPY,
  CODE_ACK_STORAGE_KEY,
  CODE_ACK_VERSION,
  CODE_RESULT_NOTE,
  askCodeAckOnce,
  serializeCodeAck,
  type CodeAckRecord,
} from '@/utils/codeAckCore';

const gate = createCodeAckGate({ storage: AsyncStorage });

/** True when a code request may go out (shows the notice once per account). Never throws. */
export const ensureCodeAck = (): Promise<boolean> => gate.ensure();
/** True, with no await, when this session already knows the account acknowledged.
 *  Handlers write `if (!codeAckKnown() && !(await ensureCodeAck())) return;`. */
export const codeAckKnown = (): boolean => gate.known();
/** This account's stored acknowledgement on this device, or null. */
export const readCodeAck = (): Promise<CodeAckRecord | null> => gate.read();
/** components/CodeAckHost.tsx registers here while mounted. */
export const setCodeAckHost = (h: CodeAckHost | null): void => gate.setHost(h);
