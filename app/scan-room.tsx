// app/scan-room.tsx — Scan The Room (Phase 1). DARK, with an OWNER PREVIEW.
//
// SCAN_ROOM_ENABLED is false. For everyone the gate refuses
// (utils/roomScan/allowed.scanRoomAllowed: the flag is off and he is not the
// owner) this route redirects to Home and mounts nothing: the flow component is
// not rendered, no saved scan is read, and the native module is never looked up
// (utils/roomScan/native.ts refuses the lookup for the same people). No tab,
// sidebar row, tile or search hit leads here; the one row that does
// (components/roomScan/ScanRoomOwnerRow.tsx) is drawn for the owner only.
//
// For the owner, and for everyone once the flag is on, two gates, then the flow
// for the project in `projectId`:
//   1. Pro and up, through hooks/useProjectAccess (the project-scoped form of
//      useTierAccess; the same key as Visual Takeoff, whose takeoff-to-estimate
//      path this feature prices through).
//   2. His seat on THIS project (utils/roomScan/gate.scanSeat): the scan ends in
//      a write to the project's estimate, so only the owner or an editor gets
//      past this screen. A viewer or a field seat is told why.
import React from 'react';
import { Text, View } from 'react-native';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import Paywall from '@/components/Paywall';
import { Button } from '@/components/ui';
import { RoomScanFlow } from '@/components/roomScan/RoomScanFlow';
import { makeRoomScanStyles } from '@/components/roomScan/styles';
import { useRoomScanCopy } from '@/hooks/useRoomScanCopy';
import { scanRoomAllowed, scanRoomOwnerTools } from '@/utils/roomScan/allowed';
import { SCAN_ROOM_FEATURE, SCAN_ROOM_REQUIRED_TIER, scanSeat } from '@/utils/roomScan/gate';

export default function ScanRoomRoute() {
  const { user } = useAuth();
  const userEmail = user?.email ?? null;
  if (!scanRoomAllowed(userEmail)) return <Redirect href="/(tabs)/(home)" />;
  return <ScanRoomScreen userEmail={userEmail} />;
}

function ScanRoomScreen({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const copy = useRoomScanCopy();
  const styles = useThemedStyles(makeRoomScanStyles);
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { canAccess } = useProjectAccess(projectId);
  const roleState = useProjectRoleState(projectId);
  if (!canAccess(SCAN_ROOM_FEATURE)) {
    return <Paywall visible feature={copy.paywallFeatureLabel} requiredTier={SCAN_ROOM_REQUIRED_TIER} onClose={() => router.back()} />;
  }
  if (!projectId) return <Redirect href="/(tabs)/(home)" />;
  const seat = scanSeat({ role: roleState.role, isLoading: roleState.isLoading, isError: roleState.isError });
  if (seat !== 'open') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.screen, { paddingTop: insets.top }]} testID={`scan-seat-${seat}`}>
          <View style={styles.body}>
            <View style={styles.blocked}>
              <Text style={styles.blockedText}>{copy.seatBody(seat)}</Text>
            </View>
            {seat === 'unknown' && <Button label={copy.retryLabel} variant="primary" onPress={() => roleState.refetch()} testID="scan-seat-retry" />}
            <Button label={copy.backLabel} variant="secondary" onPress={() => router.back()} testID="scan-seat-back" />
          </View>
        </View>
      </>
    );
  }
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <RoomScanFlow projectId={projectId} mayEditEstimate userEmail={userEmail} ownerTools={scanRoomOwnerTools(userEmail)} />
    </>
  );
}
