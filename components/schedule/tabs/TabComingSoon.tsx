// components/schedule/tabs/TabComingSoon.tsx — Phase 27.
//
// Stub tab content for Calendar / Workload / Timeline. Shows a small
// preview mock + tagline + "Notify me" button that writes a row to
// feature_interest. Button states: idle → loading → "We'll let you know" (with check icon).

import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { supabase } from '@/lib/supabase';

export interface TabComingSoonProps {
  tabName: 'Calendar' | 'Workload' | 'Timeline';
  tagline: string;
  /** Stable key written to feature_interest.event_key. */
  eventKey: string;
  /** Tiny visual hint of what the tab will look like. */
  previewMock: ReactNode;
}

export function TabComingSoon({ tabName, tagline, eventKey, previewMock }: TabComingSoonProps) {
  // Was a bare `useTheme()` over a module-scope StyleSheet: subscribing to the
  // theme does nothing when the styles froze their Colors.* getters at import
  // (audit 2026-09-07). useThemedStyles is the subscription that actually
  // rebuilds the sheet.
  const styles = useThemedStyles(makeStyles);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  const notify = async () => {
    setState('loading');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setState('error'); return; }
      const { error } = await supabase
        .from('feature_interest')
        .upsert({ user_id: user.id, event_key: eventKey }, { onConflict: 'user_id,event_key' });
      setState(error ? 'error' : 'done');
    } catch {
      setState('error');
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.preview}>{previewMock}</View>
      <Text style={styles.title}>{tabName} · coming soon</Text>
      <Text style={styles.tagline}>{tagline}</Text>
      <Pressable
        onPress={notify}
        disabled={state === 'loading' || state === 'done'}
        style={[styles.btn, state === 'done' && styles.btnDone]}
      >
        {state === 'done' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Check size={12} color={Colors.tradeColors.general} strokeWidth={2.5} />
            <Text style={styles.btnText}>We'll let you know</Text>
          </View>
        ) : (
          <Text style={styles.btnText}>
            {state === 'loading' ? 'Saving…'
             : state === 'error' ? 'Try again →'
             : 'Notify me when this ships →'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 14 },
  preview: { width: 240, height: 120, backgroundColor: t.surfaceAlt, borderRadius: 10, padding: 12, opacity: 0.7 },
  title: { fontSize: 18, color: t.text, fontWeight: '700' },
  tagline: { fontSize: 13, color: t.textSecondary, textAlign: 'center', maxWidth: 320, lineHeight: 19 },
  btn: { backgroundColor: 'rgba(255,106,26,0.15)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  btnDone: { backgroundColor: 'rgba(78,211,122,0.15)' },
  btnText: { color: Colors.tradeColors.general, fontSize: 12, fontWeight: '700' },
});
