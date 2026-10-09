// components/roomScan/ScanRoomOwnerRow.tsx — the one door into Scan The Room,
// and only the owner has it.
//
// SCAN_ROOM_ENABLED is false for everyone. This row renders NOTHING unless
// utils/roomScan/allowed.scanRoomAllowed says yes for the signed-in email,
// which today means the founder's master account (utils/owner.ts). It also
// renders nothing off iPhone: the scanner is Apple's RoomPlan.
//
// It imports no native module and nothing from utils/roomScan/native: tapping
// it only navigates to /scan-room, and that route does its own check.
import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, ScanLine } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useRoomScanCopy } from '@/hooks/useRoomScanCopy';
import { scanRoomAllowed } from '@/utils/roomScan/allowed';
import { makeRoomScanStyles } from './styles';

export function ScanRoomOwnerRow({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  if (Platform.OS !== 'ios' || !scanRoomAllowed(user?.email)) return null;
  return <OwnerRow projectId={projectId} />;
}

function OwnerRow({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeRoomScanStyles);
  const copy = useRoomScanCopy();
  return (
    <Pressable
      style={[styles.card, styles.ownerRow]}
      accessibilityRole="button"
      accessibilityLabel={copy.ownerRowLabel}
      // `as any`: the typed-route file (.expo/types/router.d.ts) is generated on each machine and may predate this route.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onPress={() => router.push({ pathname: '/scan-room' as any, params: { projectId } })}
      testID="scan-room-owner-row"
    >
      <ScanLine size={20} color={colors.text} strokeWidth={1.75} />
      <View style={styles.rowMain}>
        <Text style={styles.rowLabel}>{copy.ownerRowLabel}</Text>
        <Text style={styles.rowSub}>{copy.ownerOnlySub}</Text>
      </View>
      <ChevronRight size={18} color={colors.textMuted} />
    </Pressable>
  );
}
