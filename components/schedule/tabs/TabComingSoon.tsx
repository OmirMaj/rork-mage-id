// components/schedule/tabs/TabComingSoon.tsx — Phase 27.
//
// Stub tab content for Calendar / Workload / Timeline. Shows a small
// preview mock + tagline + "Notify me" button that writes a row to
// feature_interest. Button states: idle → loading → "✓ We'll let you know".

import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
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
  useTheme();
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
        <Text style={styles.btnText}>
          {state === 'loading' ? 'Saving…'
           : state === 'done' ? "✓ We'll let you know"
           : state === 'error' ? 'Try again →'
           : 'Notify me when this ships →'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 14 },
  preview: { width: 240, height: 120, backgroundColor: Colors.surfaceAlt, borderRadius: 10, padding: 12, opacity: 0.7 },
  title: { fontSize: 18, color: Colors.text, fontWeight: '700' },
  tagline: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', maxWidth: 320, lineHeight: 19 },
  btn: { backgroundColor: 'rgba(255,106,26,0.15)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  btnDone: { backgroundColor: 'rgba(78,211,122,0.15)' },
  btnText: { color: Colors.tradeColors.general, fontSize: 12, fontWeight: '700' },
});
