// components/CodeAckHost.tsx — shows the one-time "Before you rely on a code
// answer" notice for utils/codeAck.
//
// Mounted ONCE in app/_layout.tsx, under AuthProvider (it names the signed-in
// account in the record). A system alert and not a <Sheet>, for the reason
// components/AiConsentSheet.tsx gives: most code surfaces are themselves
// inside a Modal, and a second Modal from the root would never present. On
// the web showAlert is the app's own alert modal (components/AlertHost), so
// the web shows the notice too.
//
// Renders nothing.

import { useEffect, useRef } from 'react';
import { showAlert } from '@/utils/alert';
import { useAuth } from '@/contexts/AuthContext';
import { askCodeAckOnce, readCodeAck, setCodeAckHost } from '@/utils/codeAck';
import { recordCodeAck } from '@/utils/legalAcceptance';

export default function CodeAckHost() {
  const { user } = useAuth();
  const userId = useRef<string | null>(user?.id ?? null);
  userId.current = user?.id ?? null;
  useEffect(() => {
    setCodeAckHost({
      accountId: () => userId.current,
      prompt: () => askCodeAckOnce(showAlert),
      // The saved record (public.legal_acceptances). Best effort, never awaited.
      acknowledged: (account, at, version) => recordCodeAck(account, version, at.getTime()),
    });
    return () => setCodeAckHost(null);
  }, []);
  // Read the stored acknowledgement as soon as the account is known, so an
  // acknowledged contractor's tap never waits on storage (codeAckKnown()).
  const id = user?.id ?? null;
  // An acknowledgement given on this phone before the server record existed is
  // sent once too (the recorder keeps one entry per account and version).
  useEffect(() => {
    void readCodeAck().then((rec) => {
      if (rec && id && rec.account === id) recordCodeAck(id, rec.v, Date.parse(rec.at));
    }).catch(() => { /* asked again at the next code request */ });
  }, [id]);
  return null;
}
