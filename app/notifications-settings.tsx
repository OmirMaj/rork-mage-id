import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, MessageSquare, HandCoins, CheckCircle2, Inbox, Bell,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

// Notification preferences mirror the four event-types the notify edge
// function dispatches today. Defaults flip everything ON until the user
// opts out. Stored on profiles.notification_preferences as a flat jsonb
// object keyed by category × channel.

interface CategoryDef {
  key: 'portal_message' | 'budget_proposal' | 'co_approval' | 'sub_invoice';
  label: string;
  description: string;
  icon: React.ReactNode;
}

const CATEGORIES: CategoryDef[] = [
  {
    key: 'portal_message',
    label: 'Client messages',
    description: 'Your client sends a message from the portal.',
    icon: <MessageSquare size={18} color="#007AFF" />,
  },
  {
    key: 'budget_proposal',
    label: 'Budget proposals',
    description: 'Your client proposes a target budget from the portal.',
    icon: <HandCoins size={18} color="#FF6A1A" />,
  },
  {
    key: 'co_approval',
    label: 'CO approvals',
    description: 'Your client approves or declines a change order.',
    icon: <CheckCircle2 size={18} color="#34C759" />,
  },
  {
    key: 'sub_invoice',
    label: 'Sub invoices',
    description: 'A subcontractor submits an invoice through their portal.',
    icon: <Inbox size={18} color="#AF52DE" />,
  },
];

type Prefs = Record<string, { push?: boolean; email?: boolean }>;

export default function NotificationsSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) { setLoading(false); return; }
    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('notification_preferences')
          .eq('id', user.id)
          .single();
        if (!cancelled && !error && data) {
          setPrefs((data.notification_preferences as Prefs) ?? {});
        }
      } catch (err) {
        console.log('[NotificationsSettings] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const toggle = useCallback(async (key: string, channel: 'push' | 'email', value: boolean) => {
    void Haptics.selectionAsync().catch(() => {});
    const next: Prefs = {
      ...prefs,
      [key]: { ...(prefs[key] ?? {}), [channel]: value },
    };
    setPrefs(next);
    if (!user?.id) return;
    setSaving(true);
    try {
      await supabase
        .from('profiles')
        .update({ notification_preferences: next })
        .eq('id', user.id);
    } catch (err) {
      console.log('[NotificationsSettings] save failed', err);
    } finally {
      setSaving(false);
    }
  }, [prefs, user?.id]);

  const isOn = useCallback((key: string, channel: 'push' | 'email'): boolean => {
    const v = prefs[key]?.[channel];
    return v !== false; // default ON
  }, [prefs]);

  const allOn = useMemo(() => {
    return CATEGORIES.every(c => isOn(c.key, 'push') && isOn(c.key, 'email'));
  }, [isOn]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Notifications',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }}>
              <ChevronLeft size={24} color={Colors.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Bell size={20} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Stay in the loop</Text>
          <Text style={styles.heroBody}>
            Push notifications land instantly on your phone; emails are the durable receipt and the catch-all when push isn&apos;t reliable. Toggle either off per category — defaults send both.
          </Text>
          {!allOn && (
            <Text style={styles.heroNote}>
              Some categories are silenced. You won&apos;t hear about those events at all unless you turn them back on.
            </Text>
          )}
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        ) : (
          <View style={styles.section}>
            <View style={styles.tableHead}>
              <Text style={styles.tableHeadLabel}>Category</Text>
              <Text style={styles.tableHeadCol}>Push</Text>
              <Text style={styles.tableHeadCol}>Email</Text>
            </View>
            <View style={styles.card}>
              {CATEGORIES.map((c, idx) => (
                <View
                  key={c.key}
                  style={[styles.row, idx < CATEGORIES.length - 1 && styles.rowDivider]}
                >
                  <View style={styles.rowLeft}>
                    {c.icon}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel}>{c.label}</Text>
                      <Text style={styles.rowDesc}>{c.description}</Text>
                    </View>
                  </View>
                  <View style={styles.toggle}>
                    <Switch
                      value={isOn(c.key, 'push')}
                      onValueChange={v => toggle(c.key, 'push', v)}
                      trackColor={{ false: Colors.border, true: Colors.primary }}
                      thumbColor="#FFF"
                    />
                  </View>
                  <View style={styles.toggle}>
                    <Switch
                      value={isOn(c.key, 'email')}
                      onValueChange={v => toggle(c.key, 'email', v)}
                      trackColor={{ false: Colors.border, true: Colors.primary }}
                      thumbColor="#FFF"
                    />
                  </View>
                </View>
              ))}
            </View>
            {saving && <Text style={styles.savingHint}>Saving…</Text>}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.tableHeadLabel}>How push works</Text>
          <Text style={styles.helperBody}>
            We register your iPhone or Android device when you log in. If you ever miss notifications, sign out and back in — that re-registers the device with our server. Push isn&apos;t supported on the web app, but every category still sends emails there.
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: {
    margin: 16, padding: 18, borderRadius: 16,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1, borderColor: Colors.primary + '20',
  },
  heroIcon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  heroBody: { fontSize: 13, color: Colors.text, lineHeight: 19 },
  heroNote: {
    marginTop: 10, padding: 10, borderRadius: 10,
    backgroundColor: '#FFF4E0',
    fontSize: 12, color: '#7A4500', lineHeight: 17, fontWeight: '600',
  },
  loadingWrap: { padding: 32, alignItems: 'center' },

  section: { marginHorizontal: 16, marginBottom: 22 },
  tableHead: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 8,
  },
  tableHeadLabel: {
    flex: 1, fontSize: 11, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  tableHeadCol: {
    width: 64, textAlign: 'center', fontSize: 11, fontWeight: '700',
    color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  card: {
    backgroundColor: Colors.card, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12, gap: 4,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },
  rowDesc: { fontSize: 12, color: Colors.textMuted, marginTop: 2, lineHeight: 16 },
  toggle: { width: 64, alignItems: 'center' },
  savingHint: {
    fontSize: 11, color: Colors.textMuted, marginTop: 8, fontStyle: 'italic', textAlign: 'right',
  },

  helperBody: {
    fontSize: 13, color: Colors.text, lineHeight: 20,
    paddingHorizontal: 14,
  },
});
