// app/living-model.tsx — The Living Model (Phase 1). DARK, with an OWNER PREVIEW.
//
// LIVING_MODEL_ENABLED is false. For everyone the gate refuses
// (utils/livingModel/allowed.livingModelAllowed: the flag is off and he is not
// the owner) this route redirects to Home and mounts nothing: the screen is not
// rendered, no saved model is read and the 3D library is never asked for. No
// tab, sidebar row, tile or search hit leads here; the one row that does
// (components/livingModel/LivingModelEntryRow.tsx) is drawn for the owner only.
//
// For the owner, and for everyone once the flag is on, one more gate: his seat
// on THIS project (utils/livingModel/allowed.livingModelSeat). The model is made
// from the project's schedule and ticked against it, so only a seat that may
// edit that schedule (the owner or an editor) opens it, to view or to edit. A
// viewer or a field seat is told why.
import React from 'react';
import { Text, View } from 'react-native';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { Button } from '@/components/ui';
import { LivingModelScreen } from '@/components/livingModel/LivingModelScreen';
import { makeLivingModelStyles } from '@/components/livingModel/styles';
import { livingModelAllowed, livingModelSeat } from '@/utils/livingModel/allowed';

export default function LivingModelRoute() {
  const { user } = useAuth();
  if (!livingModelAllowed(user?.email)) return <Redirect href="/(tabs)/(home)" />;
  return <Gated userId={user?.id ?? null} />;
}

function Gated({ userId }: { userId: string | null }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const copy = useLivingModelCopy();
  const styles = useThemedStyles(makeLivingModelStyles);
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const roleState = useProjectRoleState(projectId);
  if (!projectId) return <Redirect href="/(tabs)/(home)" />;
  const seat = livingModelSeat({ role: roleState.role, isLoading: roleState.isLoading, isError: roleState.isError });
  if (seat !== 'open') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.screen, { paddingTop: insets.top }]} testID={`living-model-seat-${seat}`}>
          <View style={styles.blocked}>
            <Text style={styles.para}>{copy.seatBody(seat)}</Text>
            {seat === 'unknown' ? <Button label={copy.retryLabel} variant="primary" onPress={() => roleState.refetch()} testID="living-model-seat-retry" /> : null}
            <Button label={copy.backLabel} variant="secondary" onPress={() => router.back()} testID="living-model-seat-back" />
          </View>
        </View>
      </>
    );
  }
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <LivingModelScreen projectId={projectId} userId={userId} />
    </>
  );
}
