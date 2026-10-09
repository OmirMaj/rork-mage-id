// app/proof-pack.tsx — the Proof of Work Package (Big Bets, Bet 3, Phase 1).
// DARK, with an OWNER PREVIEW.
//
// PROOF_PACK_ENABLED is false. For everyone the gate refuses
// (utils/proofPack/allowed.proofPackAllowed: the flag is off and they are not
// the app's owner account) this route redirects to Home and mounts nothing: the
// review component is not rendered and no record is read. No tab, sidebar row,
// tile or search hit leads here; the one row that does
// (components/proofPack/ProofPackEntryRow.tsx) is drawn for the same people.
//
// Past the gate there is one more rule: the SEAT. Only the project's owner seat
// makes a package (it carries the client's name, the address and the amounts).
// An editor, a viewer or a field seat is told why and offered the way back.
import React from 'react';
import { Text, View } from 'react-native';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProofPackCopy } from '@/hooks/useProofPackCopy';
import { Button } from '@/components/ui';
import { ProofPackReview } from '@/components/proofPack/ProofPackReview';
import { makeProofPackStyles } from '@/components/proofPack/styles';
import { proofPackAllowed, proofPackSeatAllowed } from '@/utils/proofPack/allowed';

export default function ProofPackRoute() {
  const { user } = useAuth();
  if (!proofPackAllowed(user?.email ?? null)) return <Redirect href="/(tabs)/(home)" />;
  return <ProofPackScreen />;
}

function ProofPackScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const copy = useProofPackCopy();
  const styles = useThemedStyles(makeProofPackStyles);
  const { projectId, kind, payId } = useLocalSearchParams<{ projectId?: string; kind?: string; payId?: string }>();
  const roleState = useProjectRoleState(projectId);
  if (!projectId || !payId || (kind !== 'pay_app' && kind !== 'invoice')) return <Redirect href="/(tabs)/(home)" />;
  if (roleState.isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.screen, { paddingTop: insets.top + 16 }]} testID="proof-pack-loading">
          <View style={styles.body}><Text style={styles.para}>{copy.loadingBody}</Text></View>
        </View>
      </>
    );
  }
  if (roleState.isError) {
    // The seat could not be read: say so and offer another try. Never "no access" on a failed read.
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.screen, { paddingTop: insets.top + 16 }]} testID="proof-pack-role-error">
          <View style={styles.body}>
            <View style={styles.blocked}><Text style={styles.blockedText}>{copy.roleErrorBody}</Text></View>
            <Button label={copy.retryLabel} variant="primary" onPress={() => roleState.refetch()} testID="proof-pack-role-retry" />
            <Button label={copy.backLabel} variant="secondary" onPress={() => router.back()} testID="proof-pack-role-back" />
          </View>
        </View>
      </>
    );
  }
  if (!proofPackSeatAllowed(roleState.role)) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.screen, { paddingTop: insets.top + 16 }]} testID="proof-pack-seat">
          <View style={styles.body}>
            <View style={styles.blocked}><Text style={styles.blockedText}>{copy.seatBody}</Text></View>
            <Button label={copy.backLabel} variant="secondary" onPress={() => router.back()} testID="proof-pack-seat-back" />
          </View>
        </View>
      </>
    );
  }
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ProofPackReview projectId={projectId} payRef={{ kind, id: payId }} onBack={() => router.back()} />
    </>
  );
}
