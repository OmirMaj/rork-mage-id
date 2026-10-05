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
import { askCodeAckOnce, setCodeAckHost } from '@/utils/codeAck';

export default function CodeAckHost() {
  const { user } = useAuth();
  const userId = useRef<string | null>(user?.id ?? null);
  userId.current = user?.id ?? null;
  useEffect(() => {
    setCodeAckHost({
      accountId: () => userId.current,
      prompt: () => askCodeAckOnce(showAlert),
    });
    return () => setCodeAckHost(null);
  }, []);
  return null;
}
