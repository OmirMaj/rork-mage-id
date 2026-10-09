// components/proofPack/ProofPackEntryRow.tsx — the one door into the Pay Period Record: a row on a saved pay application and on a saved invoice.
//
// PROOF_PACK_ENABLED is false for everyone. This row renders NOTHING unless
// utils/proofPack/allowed.proofPackEntryAllowed says yes: the gate (flag on, or
// the app owner's account) AND the project's owner seat. While the answer is
// no, the inner row is never rendered, so its hooks never run: no copy is
// built and nothing is read.
//
// Tapping it only navigates to /proof-pack, and that route asks the gate again.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, FileCheck2 } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProofPackCopy } from '@/hooks/useProofPackCopy';
import { proofPackAllowed, proofPackEntryAllowed, proofPackIsOwnerPreview } from '@/utils/proofPack/allowed';
import { makeProofPackStyles } from './styles';

export interface ProofPackEntryRowProps {
  projectId: string | null | undefined;
  kind: 'pay_app' | 'invoice';
  /** The SAVED pay application's or invoice's id. No id, no row. */
  payId: string | null | undefined;
}

export function ProofPackEntryRow({ projectId, kind, payId }: ProofPackEntryRowProps) {
  const { user } = useAuth();
  if (!projectId || !payId || !proofPackAllowed(user?.email)) return null;
  return <SeatGate projectId={projectId} kind={kind} payId={payId} email={user?.email ?? null} />;
}

function SeatGate({ projectId, kind, payId, email }: { projectId: string; kind: 'pay_app' | 'invoice'; payId: string; email: string | null }) {
  const role = useProjectRole(projectId);
  if (!proofPackEntryAllowed(email, role)) return null;
  return <Row projectId={projectId} kind={kind} payId={payId} />;
}

function Row({ projectId, kind, payId }: { projectId: string; kind: 'pay_app' | 'invoice'; payId: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeProofPackStyles);
  const copy = useProofPackCopy();
  return (
    <Pressable
      style={styles.entry}
      accessibilityRole="button"
      accessibilityLabel={copy.entryLabel}
      // `as any`: the typed-route file (.expo/types/router.d.ts) is generated on each machine and may predate this route.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onPress={() => router.push({ pathname: '/proof-pack' as any, params: { projectId, kind, payId } })}
      testID="proof-pack-entry"
    >
      <FileCheck2 size={20} color={colors.text} strokeWidth={1.75} />
      <View style={styles.entryMain}>
        <Text style={styles.rowTitle}>{copy.entryLabel}</Text>
        <Text style={styles.rowSub}>{proofPackIsOwnerPreview() ? copy.entryOwnerPreviewLabel : copy.entryBody}</Text>
      </View>
      <ChevronRight size={18} color={colors.textMuted} />
    </Pressable>
  );
}
