import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useCrew } from '@/contexts/CrewContext';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';

// Worker claim redemption. Opened from the magic-link invite
// (rork-app://claim-crew?token=crew_...). MagicLinkHandler (app/_layout.tsx)
// establishes the session from the URL hash; once authenticated we redeem the
// claim token. Public destination — RootLayoutNav must NOT bounce it to /login
// before the session lands (added to the allow-list below).
export default function ClaimCrewScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const { claimCrewMember } = useCrew();
  const [state, setState] = useState<'waiting' | 'done' | 'failed'>('waiting');

  useEffect(() => {
    if (!token) { setState('failed'); return; }
    if (!isAuthenticated || !user?.id) return; // wait for magic-link session
    const ok = claimCrewMember(token, user.id);
    setState(ok ? 'done' : 'failed');
  }, [token, isAuthenticated, user?.id, claimCrewMember]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Claim profile' }} />
      {state === 'waiting' && <><ActivityIndicator color={Colors.primary} /><Text style={styles.msg}>Confirming your profile…</Text></>}
      {state === 'done' && <Text style={styles.msg}>You’ve claimed your crew profile. You can now edit it and control your visibility.</Text>}
      {state === 'failed' && <Text style={styles.msg}>This invite link is invalid or already used. Ask the contractor to resend it.</Text>}
      {state !== 'waiting' && (
        <Text style={styles.link} onPress={() => router.replace('/')}>Go to app</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, padding: 24, gap: 16 },
  msg: { fontSize: Type.body.fontSize, color: Colors.text, textAlign: 'center' },
  link: { fontSize: Type.body.fontSize, color: Colors.primary, fontWeight: '700' },
});
