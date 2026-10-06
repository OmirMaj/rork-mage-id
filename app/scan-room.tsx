// app/scan-room.tsx — Scan The Room (Phase 1). DARK.
//
// While SCAN_ROOM_ENABLED is false this route redirects to Home and mounts
// nothing: the flow component is not rendered, no saved scan is read, and the
// native module is never looked up (utils/roomScan/native.ts refuses the lookup
// while the flag is off). No tab, sidebar row, tile or search hit leads here.
//
// With the flag on: Pro and up (the same gate as Visual Takeoff, whose
// takeoff-to-estimate path this feature prices through), then the flow for the
// project in `projectId`.
import React from 'react';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SCAN_ROOM_ENABLED } from '@/constants/featureFlags';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { RoomScanFlow } from '@/components/roomScan/RoomScanFlow';
import { useRoomScanCopy } from '@/hooks/useRoomScanCopy';
import { SCAN_ROOM_FEATURE_KEY, SCAN_ROOM_REQUIRED_TIER } from '@/utils/roomScan/gate';

export default function ScanRoomRoute() {
  if (!SCAN_ROOM_ENABLED) return <Redirect href="/(tabs)/(home)" />;
  return <ScanRoomScreen />;
}

function ScanRoomScreen() {
  const router = useRouter();
  const copy = useRoomScanCopy();
  const { canAccess } = useTierAccess();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  if (!canAccess(SCAN_ROOM_FEATURE_KEY)) {
    return <Paywall visible feature={copy.paywallFeatureLabel} requiredTier={SCAN_ROOM_REQUIRED_TIER} onClose={() => router.back()} />;
  }
  if (!projectId) return <Redirect href="/(tabs)/(home)" />;
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <RoomScanFlow projectId={projectId} />
    </>
  );
}
