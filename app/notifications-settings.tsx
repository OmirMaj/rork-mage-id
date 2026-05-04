import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, ActivityIndicator, Alert, Linking, Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import {
  ChevronLeft, MessageSquare, HandCoins, CheckCircle2, Inbox, Bell,
  PenTool, ShoppingCart, HelpCircle, Hammer, Sunrise,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { registerForPushNotifications } from '@/utils/notifications';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// Notification preferences mirror the four event-types the notify edge
// function dispatches today. Defaults flip everything ON until the user
// opts out. Stored on profiles.notification_preferences as a flat jsonb
// object keyed by category × channel.

interface CategoryDef {
  key:
    | 'portal_message' | 'budget_proposal' | 'co_approval' | 'sub_invoice'
    | 'contract_signed' | 'selection_chosen'
    | 'bid_question_asked' | 'rfp_awarded' | 'nearby_rfp_posted'
    | 'daily_digest';
  label: string;
  description: string;
  icon: React.ReactNode;
  /** Group label for the section header. */
  group: 'digest' | 'client' | 'sub' | 'marketplace';
  /** When true, the toggle defaults OFF instead of ON. Used for opt-in
   *  channels like the daily digest where users must actively subscribe. */
  defaultOff?: boolean;
  /** When true, only the email channel matters (no push variant). */
  emailOnly?: boolean;
}

const CATEGORIES: CategoryDef[] = [
  // ─── Daily digest (opt-in only) ───
  {
    key: 'daily_digest',
    label: 'Daily digest',
    description: 'A once-a-day recap of project activity (8 AM ET). Off by default.',
    icon: <Sunrise size={18} color={Colors.orange} />,
    group: 'digest',
    defaultOff: true,
    emailOnly: true,
  },
  // ─── Client → GC ───
  {
    key: 'portal_message',
    label: 'Client messages',
    description: 'Your client sends a message from the portal.',
    icon: <MessageSquare size={18} color={Colors.info} />,
    group: 'client',
  },
  {
    key: 'contract_signed',
    label: 'Contract signed',
    description: 'Your client counter-signs the construction agreement.',
    icon: <PenTool size={18} color={Colors.successDark} />,
    group: 'client',
  },
  {
    key: 'selection_chosen',
    label: 'Selection picked',
    description: 'Your client picks a tile, fixture, or other allowance option.',
    icon: <ShoppingCart size={18} color={Colors.orange} />,
    group: 'client',
  },
  {
    key: 'budget_proposal',
    label: 'Budget proposals',
    description: 'Your client proposes a target budget from the portal.',
    icon: <HandCoins size={18} color={Colors.orange} />,
    group: 'client',
  },
  {
    key: 'co_approval',
    label: 'CO approvals',
    description: 'Your client approves or declines a change order.',
    icon: <CheckCircle2 size={18} color={Colors.success} />,
    group: 'client',
  },
  // ─── Sub → GC ───
  {
    key: 'sub_invoice',
    label: 'Sub invoices',
    description: 'A subcontractor submits an invoice through their portal.',
    icon: <Inbox size={18} color="#AF52DE" />,
    group: 'sub',
  },
  // ─── Marketplace ───
  {
    key: 'nearby_rfp_posted',
    label: 'New nearby RFPs',
    description: 'A homeowner posts a project in your service area.',
    icon: <Hammer size={18} color={Colors.purple} />,
    group: 'marketplace',
  },
  {
    key: 'bid_question_asked',
    label: 'Pre-bid questions',
    description: 'A contractor asks a question on an RFP you posted.',
    icon: <HelpCircle size={18} color={Colors.purple} />,
    group: 'marketplace',
  },
  {
    key: 'rfp_awarded',
    label: 'RFP awarded to you',
    description: 'A homeowner picks your bid for their project.',
    icon: <CheckCircle2 size={18} color={Colors.successDark} />,
    group: 'marketplace',
  },
];

const GROUP_LABELS: Record<CategoryDef['group'], { title: string; subtitle: string }> = {
  digest:      { title: 'Daily digest',         subtitle: 'A once-a-day wrap-up email. Sent in the morning, opt-in only.' },
  client:      { title: 'Client → You',         subtitle: 'When the homeowner does something on the portal.' },
  sub:         { title: 'Subcontractor → You',  subtitle: 'When a sub does something through their portal link.' },
  marketplace: { title: 'Marketplace',          subtitle: 'New RFPs nearby, awards, and pre-bid Q&A.' },
};

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
    // Optimistic update — flip the toggle immediately so the UI feels
    // snappy. If the persist fails, we roll back to the previous state
    // and surface an Alert so the user knows their preference didn't
    // stick (otherwise next session would silently revert).
    const previous = prefs;
    const next: Prefs = {
      ...prefs,
      [key]: { ...(prefs[key] ?? {}), [channel]: value },
    };
    setPrefs(next);
    if (!user?.id) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ notification_preferences: next })
        .eq('id', user.id);
      if (error) throw error;
    } catch (err) {
      console.log('[NotificationsSettings] save failed', err);
      // Roll back the toggle.
      setPrefs(previous);
      Alert.alert(
        'Could not save',
        'Your notification preference didn\'t save. Check your connection and try again.',
      );
    } finally {
      setSaving(false);
    }
  }, [prefs, user?.id]);

  const isOn = useCallback((key: string, channel: 'push' | 'email'): boolean => {
    const cat = CATEGORIES.find(c => c.key === key);
    const v = prefs[key]?.[channel];
    if (cat?.defaultOff) {
      // Opt-in: explicit `true` only. Anything else (undefined / false) = OFF.
      return v === true;
    }
    return v !== false; // default ON
  }, [prefs]);

  // Push permission status. We surface a banner at the top of this
  // screen prompting the user to enable iOS / Android push notifications
  // when they haven't yet — better than silently leaving them broken
  // OR cold-prompting on first launch (where the user has no context
  // for why we're asking).
  const [pushPermStatus, setPushPermStatus] = useState<'granted' | 'denied' | 'undetermined' | 'web' | null>(null);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      setPushPermStatus('web');
      return;
    }
    Notifications.getPermissionsAsync().then((r) => {
      setPushPermStatus((r.status as 'granted' | 'denied' | 'undetermined') ?? 'undetermined');
    }).catch(() => setPushPermStatus('undetermined'));
  }, []);

  const handleEnablePush = useCallback(async () => {
    setEnabling(true);
    try {
      // If the user previously denied, the system won't re-prompt;
      // bounce them to Settings instead.
      if (pushPermStatus === 'denied') {
        Alert.alert(
          'Notifications are disabled',
          'Open iOS Settings and turn on notifications for MAGE ID.',
          [
            { text: 'Cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ],
        );
        return;
      }
      const token = await registerForPushNotifications({ prompt: true });
      const { status } = await Notifications.getPermissionsAsync();
      setPushPermStatus(status as 'granted' | 'denied' | 'undetermined');
      if (token && user?.id) {
        try {
          await supabase.from('profiles').update({ push_token: token }).eq('id', user.id);
        } catch { /* non-fatal */ }
      }
      if (status === 'granted' && Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } finally {
      setEnabling(false);
    }
  }, [pushPermStatus, user?.id]);

  const allOn = useMemo(() => {
    // Skip default-off categories from the "everything is on" check —
    // they don't count toward "silenced" since silence is the default.
    return CATEGORIES
      .filter(c => !c.defaultOff)
      .every(c => isOn(c.key, 'push') && isOn(c.key, 'email'));
  }, [isOn]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Notifications',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back">
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

        {/* Push-permission rationale banner. Surfaces when iOS / Android
            permission is undetermined or denied. We don't cold-prompt on
            first launch anymore — this is where users opt in with full
            context for why we're asking. */}
        {(pushPermStatus === 'undetermined' || pushPermStatus === 'denied') && (
          <View style={styles.permBanner}>
            <View style={styles.permIcon}>
              <Bell size={18} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.permTitle}>
                {pushPermStatus === 'denied' ? 'Push is turned off' : 'Get instant alerts'}
              </Text>
              <Text style={styles.permBody}>
                {pushPermStatus === 'denied'
                  ? "Open iOS Settings and switch notifications back on so you don't miss a CO approval or sub invoice."
                  : 'Approve once and we\'ll ping you when a client signs a contract, picks a selection, or a sub uploads an invoice.'}
              </Text>
              <TouchableOpacity
                style={styles.permCta}
                onPress={handleEnablePush}
                disabled={enabling}
                activeOpacity={0.85}
              >
                <Text style={styles.permCtaText}>
                  {enabling
                    ? 'Working…'
                    : pushPermStatus === 'denied'
                      ? 'Open Settings'
                      : 'Turn on push notifications'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        ) : (
          (['digest', 'client', 'sub', 'marketplace'] as CategoryDef['group'][]).map(group => {
            const groupCats = CATEGORIES.filter(c => c.group === group);
            if (groupCats.length === 0) return null;
            const meta = GROUP_LABELS[group];
            return (
              <View key={group} style={styles.section}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupTitle}>{meta.title}</Text>
                  <Text style={styles.groupSubtitle}>{meta.subtitle}</Text>
                </View>
                <View style={styles.tableHead}>
                  <Text style={styles.tableHeadLabel}>Category</Text>
                  <Text style={styles.tableHeadCol}>Push</Text>
                  <Text style={styles.tableHeadCol}>Email</Text>
                </View>
                <View style={styles.card}>
                  {groupCats.map((c, idx) => (
                    <View
                      key={c.key}
                      style={[styles.row, idx < groupCats.length - 1 && styles.rowDivider]}
                    >
                      <View style={styles.rowLeft}>
                        {c.icon}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowLabel}>{c.label}</Text>
                          <Text style={styles.rowDesc}>{c.description}</Text>
                        </View>
                      </View>
                      <View style={styles.toggle}>
                        {c.emailOnly ? (
                          <Text style={styles.naLabel}>—</Text>
                        ) : (
                          <Switch
                            value={isOn(c.key, 'push')}
                            onValueChange={v => toggle(c.key, 'push', v)}
                            trackColor={{ false: Colors.border, true: Colors.primary }}
                            thumbColor="#FFF"
                          />
                        )}
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
                {saving && group === 'client' && <Text style={styles.savingHint}>Saving…</Text>}
              </View>
            );
          })
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
    margin: 16, padding: 18, borderRadius: Tokens.radius.panel,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1, borderColor: Colors.primary + '20',
  },
  heroIcon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  heroBody: { fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 19 },
  heroNote: {
    marginTop: 10, padding: 10, borderRadius: Tokens.radius.md,
    backgroundColor: '#FFF4E0',
    fontSize: Type.caption1.fontSize, color: '#7A4500', lineHeight: 17, fontWeight: '600',
  },
  permBanner: {
    marginHorizontal: 16, marginBottom: 16, padding: 16,
    borderRadius: Tokens.radius.lg, backgroundColor: Colors.text,
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
  },
  permIcon: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  permTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: '#FFF', marginBottom: 4 },
  permBody: { fontSize: 12.5, color: '#D8DDE3', lineHeight: 18, marginBottom: 10 },
  permCta: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.md,
  },
  permCtaText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: '#FFF' },
  loadingWrap: { padding: 32, alignItems: 'center' },

  section: { marginHorizontal: 16, marginBottom: 22 },
  groupHeader: { marginBottom: 10, paddingHorizontal: 4 },
  groupTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  groupSubtitle: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: 2, lineHeight: 17 },
  tableHead: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 8,
  },
  tableHeadLabel: {
    flex: 1, fontSize: Type.caption2.fontSize, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  tableHeadCol: {
    width: 64, textAlign: 'center', fontSize: Type.caption2.fontSize, fontWeight: '700',
    color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  card: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12, gap: 4,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: Colors.text },
  rowDesc: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: 2, lineHeight: 16 },
  toggle: { width: 64, alignItems: 'center' },
  naLabel: { fontSize: Type.subheadline.fontSize, color: Colors.textMuted, fontWeight: '600' },
  savingHint: {
    fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 8, fontStyle: 'italic', textAlign: 'right',
  },

  helperBody: {
    fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 20,
    paddingHorizontal: 14,
  },
});
