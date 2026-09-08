import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { redeemCrewClaim } from '@/utils/crewScan';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';

// Worker claim redemption. Opened from the magic-link invite
// (mageid://claim-crew?token=crew_...). MagicLinkHandler (app/_layout.tsx)
// establishes the session from the URL hash; once authenticated we redeem the
// claim token via the SERVICE-ROLE claim-crew edge function — NOT a client
// context mutation. The claiming worker is a different auth user than the GC,
// and crew_members RLS makes the unclaimed row invisible + un-writable to them,
// so a client-side redeem always fails. Public destination — RootLayoutNav must
// NOT bounce it to /login before the session lands (added to the allow-list).
export default function ClaimCrewScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'waiting' | 'done' | 'failed'>('waiting');
  // Built per theme: this screen's page background and body ink were baked at
  // import, so a worker who opens the invite link in dark mode landed on a
  // light-grey page (audit 2026-09-07).
  const styles = useThemedStyles(makeStyles);

  useEffect(() => {
    if (!token) { setState('failed'); return; }
    if (!isAuthenticated || !user?.id) return; // wait for magic-link session
    let cancelled = false;
    (async () => {
      try {
        await redeemCrewClaim(token);
        if (cancelled) return;
        // The row is now visible to the worker via RLS (auth.uid() =
        // claimed_by_user_id) — refetch the roster so it hydrates in-app.
        void queryClient.invalidateQueries({ queryKey: ['crew_members'] });
        setState('done');
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => { cancelled = true; };
  }, [token, isAuthenticated, user?.id, queryClient]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Claim profile' }} />
      {state === 'waiting' && <><ActivityIndicator color={Colors.primary} /><Text style={styles.msg}>Confirming your profile…</Text></>}
      {state === 'done' && (
        <>
          <Text style={styles.msg}>You’ve claimed your crew profile. You can now edit it and control your visibility.</Text>
          {/* /sub-profile had ZERO click paths anywhere in the product — search
              only — despite being the supply-side referral loop its own header
              describes: work history across every GC who hired you, and a
              credential you can hand your OTHER GCs. There is no subcontractor
              persona in onboarding (utils/onboardingProfile.ts:19), so the door
              belongs where a tradesperson actually arrives, which is here and
              on the prequal form — not in GC navigation
              (audit 2026-09-07, built-but-unreachable #13). */}
          <Text style={styles.link} onPress={() => router.push('/sub-profile')}>
            See your work history and reliability across every contractor
          </Text>
        </>
      )}
      {state === 'failed' && <Text style={styles.msg}>This invite link is invalid or already used. Ask the contractor to resend it.</Text>}
      {state !== 'waiting' && (
        <Text style={styles.linkMuted} onPress={() => router.replace('/')}>Go to app</Text>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, padding: 24, gap: 16 },
  msg: { fontSize: Type.body.fontSize, color: t.text, textAlign: 'center' },
  link: { fontSize: Type.body.fontSize, color: Colors.primary, fontWeight: '700', textAlign: 'center' },
  linkMuted: { fontSize: Type.body.fontSize, color: t.textSecondary, fontWeight: '600' },
});
