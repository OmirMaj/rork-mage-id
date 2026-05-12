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
  PenTool, ShoppingCart, HelpCircle, Hammer, Sunrise, MapPin, Clock,
  Mail, Smartphone, Send,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
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
    | 'bid_question_asked' | 'rfp_awarded' | 'nearby_rfp_posted';
  label: string;
  description: string;
  icon: React.ReactNode;
  /** Group label for the section header. */
  group: 'client' | 'sub' | 'marketplace';
  /** When true, the toggle defaults OFF instead of ON. Used for opt-in
   *  channels like the daily digest where users must actively subscribe. */
  defaultOff?: boolean;
  /** When true, only the email channel matters (no push variant). */
  emailOnly?: boolean;
}

const CATEGORIES: CategoryDef[] = [
  // ─── Client → GC ───
  {
    key: 'portal_message',
    label: 'Client messages',
    description: 'Your client sends a message from the portal.',
    icon: <MessageSquare size={18} color={"#1565C0"} />,
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
    icon: <CheckCircle2 size={18} color={"#2E7D44"} />,
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
  client:      { title: 'Client → You',         subtitle: 'When the homeowner does something on the portal.' },
  sub:         { title: 'Subcontractor → You',  subtitle: 'When a sub does something through their portal link.' },
  marketplace: { title: 'Marketplace',          subtitle: 'New RFPs nearby, awards, and pre-bid Q&A.' },
};

type Prefs = Record<string, { push?: boolean; email?: boolean }>;

// Format a 24-hour integer (0..23) as "5 AM" / "12 PM" / "8 PM" — what
// the user reads in the digest card. Construction users tend to think
// in 12-hour clock, even when they're up at 4 AM.
function formatHour(h: number): string {
  const hour = ((h % 24) + 24) % 24;
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

export default function NotificationsSettingsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { settings, updateSettings, projects } = useProjects();
  const [prefs, setPrefs] = useState<Prefs>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // Digest preferences pulled from settings (which read from profiles row).
  // Defaults: opt-in (off), 6 AM, both channels.
  const digestEnabled = !!settings.digest?.enabled;
  const digestHour = settings.digest?.hour ?? 6;
  const digestEmailOn = settings.digest?.channels?.email ?? true;
  const digestInAppOn = settings.digest?.channels?.in_app ?? true;
  const digestTimezone = settings.digest?.timezone ?? (
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'America/New_York'
  );

  // Project-location coverage. We compute how many active projects have
  // geocoded coords vs. how many have only a free-text location vs. how
  // many have nothing. This drives the "set your project locations for
  // accurate weather" nudge.
  const activeProjects = useMemo(
    () => projects.filter(p => p.status !== 'completed' && p.status !== 'closed'),
    [projects],
  );
  const locationCoverage = useMemo(() => {
    const total = activeProjects.length;
    let geocoded = 0;
    let textOnly = 0;
    let blank = 0;
    for (const p of activeProjects) {
      const hasCoords = p.locationLatitude != null && p.locationLongitude != null;
      const hasText = !!(p.location && p.location.trim().length >= 3);
      if (hasCoords) geocoded += 1;
      else if (hasText) textOnly += 1;
      else blank += 1;
    }
    return { total, geocoded, textOnly, blank };
  }, [activeProjects]);

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

  const updateDigest = useCallback((patch: Partial<NonNullable<typeof settings.digest>>) => {
    void Haptics.selectionAsync().catch(() => {});
    const current = settings.digest ?? {
      enabled: false, hour: 6, timezone: digestTimezone, channels: { email: true, in_app: true },
    };
    const next = {
      enabled: patch.enabled ?? current.enabled,
      hour: patch.hour ?? current.hour,
      timezone: patch.timezone ?? current.timezone,
      channels: { ...current.channels, ...(patch.channels ?? {}) },
    };
    updateSettings({ digest: next });
  }, [settings.digest, updateSettings, digestTimezone]);

  const previewDigest = useCallback(async () => {
    if (!user?.id) return;
    setPreviewing(true);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const { data, error } = await supabase.functions.invoke('morning-digest', {
        body: { userId: user.id, preview: true },
      });
      if (error) throw error;
      const sent = data?.sent === true;
      Alert.alert(
        sent ? 'Preview sent' : 'No projects to digest',
        sent
          ? 'Check your inbox in a few seconds. The digest reads what you have right now — set up a project with a location to see weather and tasks.'
          : 'Add an active project with a location to preview the digest. We use the lat/lng of each project to pull a hyperlocal weather forecast.',
      );
    } catch (err) {
      console.log('[NotificationsSettings] preview failed', err);
      Alert.alert(
        'Preview failed',
        'We could not send your preview digest. Check your connection and try again.',
      );
    } finally {
      setPreviewing(false);
    }
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
              <ChevronLeft size={24} color={themeColors.accent} />
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
            <Bell size={20} color={themeColors.accent} />
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

        {/* ── Morning digest card ───────────────────────────────────
            Dedicated card above the per-category table because the
            digest has more knobs (time, channels, location) than a
            simple on/off toggle and we want users to discover the
            location-accuracy story. */}
        <View style={styles.section}>
          <View style={styles.groupHeader}>
            <Text style={styles.groupTitle}>AI morning digest</Text>
            <Text style={styles.groupSubtitle}>
              A 6 AM brief of today&apos;s tasks, yesterday&apos;s field notes, weather risks, and what needs you. Pulled fresh each morning from your projects.
            </Text>
          </View>
          <View style={styles.digestCard}>
            <View style={styles.digestHeader}>
              <View style={styles.digestIcon}>
                <Sunrise size={18} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.digestTitle}>Send me a daily brief</Text>
                <Text style={styles.digestSubtitle}>
                  {digestEnabled
                    ? `On — fires at ${formatHour(digestHour)} ${digestTimezone.split('/').pop()?.replace(/_/g, ' ')}`
                    : 'Off — opt in to start receiving briefs'}
                </Text>
              </View>
              <Switch
                value={digestEnabled}
                onValueChange={v => updateDigest({ enabled: v })}
                trackColor={{ false: themeColors.line, true: themeColors.accent }}
                thumbColor="#FFF"
              />
            </View>

            {digestEnabled && (
              <>
                <View style={styles.digestDivider} />

                {/* Time picker — horizontal scroll of common hours.
                    Construction-friendly (4 AM — 9 AM dominant), but
                    we expose the full 24-hour range for night-shift
                    crews and overseas users. */}
                <View style={styles.digestRow}>
                  <View style={styles.digestRowLabel}>
                    <Clock size={14} color={themeColors.textMuted} />
                    <Text style={styles.digestRowLabelText}>When</Text>
                  </View>
                  <Text style={styles.digestRowValue}>{formatHour(digestHour)}</Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.hourScroll}
                >
                  {[4, 5, 6, 7, 8, 9, 10, 12, 17, 20].map(h => (
                    <TouchableOpacity
                      key={h}
                      onPress={() => updateDigest({ hour: h })}
                      style={[styles.hourPill, digestHour === h && styles.hourPillActive]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.hourPillText, digestHour === h && styles.hourPillTextActive]}>
                        {formatHour(h)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={styles.digestDivider} />

                {/* Channel toggles. Email is the durable receipt; in-app
                    is the inbox card on the dashboard. We don't push
                    digests to mobile push because it's noisy at 6 AM. */}
                <View style={styles.channelRow}>
                  <View style={styles.channelInfo}>
                    <Mail size={16} color={themeColors.text} />
                    <Text style={styles.channelLabel}>Email</Text>
                  </View>
                  <Switch
                    value={digestEmailOn}
                    onValueChange={v => updateDigest({ channels: { email: v, in_app: digestInAppOn } })}
                    trackColor={{ false: themeColors.line, true: themeColors.accent }}
                    thumbColor="#FFF"
                  />
                </View>
                <View style={styles.channelRow}>
                  <View style={styles.channelInfo}>
                    <Smartphone size={16} color={themeColors.text} />
                    <Text style={styles.channelLabel}>In-app inbox</Text>
                  </View>
                  <Switch
                    value={digestInAppOn}
                    onValueChange={v => updateDigest({ channels: { email: digestEmailOn, in_app: v } })}
                    trackColor={{ false: themeColors.line, true: themeColors.accent }}
                    thumbColor="#FFF"
                  />
                </View>

                <View style={styles.digestDivider} />

                {/* Location coverage hint. The digest pulls weather from
                    each project's lat/lng — we geocode on save. Nudge
                    the user to set locations when active projects are
                    missing them, since "no location" = "no weather
                    in that brief." */}
                <View style={styles.locationCard}>
                  <View style={styles.locationHeader}>
                    <MapPin size={14} color={locationCoverage.geocoded === locationCoverage.total ? themeColors.success : '#7A4500'} />
                    <Text style={styles.locationTitle}>
                      {locationCoverage.total === 0
                        ? 'No active projects yet'
                        : locationCoverage.geocoded === locationCoverage.total
                          ? 'All locations set'
                          : `${locationCoverage.geocoded} of ${locationCoverage.total} projects have a location`}
                    </Text>
                  </View>
                  <Text style={styles.locationBody}>
                    {locationCoverage.total === 0
                      ? 'Add a project with a real address (e.g. 1234 Main St, Austin, TX) and we\'ll geocode it for hyperlocal weather.'
                      : locationCoverage.geocoded === locationCoverage.total
                        ? "Each project has lat/lng. Today's digest will include 24-hour wind, rain, and temperature for every site."
                        : `${locationCoverage.textOnly + locationCoverage.blank} project${locationCoverage.textOnly + locationCoverage.blank === 1 ? '' : 's'} ${locationCoverage.textOnly + locationCoverage.blank === 1 ? "doesn't" : "don't"} have a precise location yet. Edit the project, type the address, and save — we'll geocode it.`}
                  </Text>
                  {locationCoverage.total > 0 && locationCoverage.geocoded < locationCoverage.total && (
                    <TouchableOpacity
                      onPress={() => router.push('/projects' as any)}
                      activeOpacity={0.85}
                      style={styles.locationCta}
                    >
                      <Text style={styles.locationCtaText}>Open projects</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Preview button. Calls morning-digest with preview:true
                    so the user sees the actual rendered email, not a
                    mockup. Gives confidence the cadence and content
                    will work for them before they wait until tomorrow
                    morning. */}
                <TouchableOpacity
                  onPress={previewDigest}
                  disabled={previewing}
                  activeOpacity={0.85}
                  style={[styles.previewBtn, previewing && { opacity: 0.6 }]}
                >
                  <Send size={14} color="#FFF" />
                  <Text style={styles.previewBtnText}>
                    {previewing ? 'Sending preview…' : "Send today's preview now"}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={themeColors.accent} />
          </View>
        ) : (
          (['client', 'sub', 'marketplace'] as CategoryDef['group'][]).map(group => {
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
                            trackColor={{ false: themeColors.line, true: themeColors.accent }}
                            thumbColor="#FFF"
                          />
                        )}
                      </View>
                      <View style={styles.toggle}>
                        <Switch
                          value={isOn(c.key, 'email')}
                          onValueChange={v => toggle(c.key, 'email', v)}
                          trackColor={{ false: themeColors.line, true: themeColors.accent }}
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  hero: {
    margin: 16, padding: 18, borderRadius: Tokens.radius.panel,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '20',
  },
  heroIcon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, marginBottom: 8 },
  heroBody: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },
  heroNote: {
    marginTop: 10, padding: 10, borderRadius: Tokens.radius.md,
    backgroundColor: '#FFF4E0',
    fontSize: Type.caption1.fontSize, color: '#7A4500', lineHeight: 17, fontWeight: '600',
  },
  permBanner: {
    marginHorizontal: 16, marginBottom: 16, padding: 16,
    borderRadius: Tokens.radius.lg, backgroundColor: t.text,
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
  },
  permIcon: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  permTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: '#FFF', marginBottom: 4 },
  permBody: { fontSize: 12.5, color: '#D8DDE3', lineHeight: 18, marginBottom: 10 },
  permCta: {
    alignSelf: 'flex-start',
    backgroundColor: t.accent,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.md,
  },
  permCtaText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: '#FFF' },
  loadingWrap: { padding: 32, alignItems: 'center' },

  section: { marginHorizontal: 16, marginBottom: 22 },
  groupHeader: { marginBottom: 10, paddingHorizontal: 4 },
  groupTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  groupSubtitle: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 17 },
  tableHead: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 8,
  },
  tableHeadLabel: {
    flex: 1, fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  tableHeadCol: {
    width: 64, textAlign: 'center', fontSize: Type.caption2.fontSize, fontWeight: '700',
    color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  card: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12, gap: 4,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: t.line },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },
  rowDesc: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 16 },
  toggle: { width: 64, alignItems: 'center' },
  naLabel: { fontSize: Type.subheadline.fontSize, color: t.textMuted, fontWeight: '600' },
  savingHint: {
    fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 8, fontStyle: 'italic', textAlign: 'right',
  },

  helperBody: {
    fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 20,
    paddingHorizontal: 14,
  },

  // ── Digest card ───────────────────────────────────────────────
  digestCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, overflow: 'hidden',
    padding: 16,
  },
  digestHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  digestIcon: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: '#FF6A1A',
    alignItems: 'center', justifyContent: 'center',
  },
  digestTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  digestSubtitle: {
    fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 16,
  },
  digestDivider: { height: 1, backgroundColor: t.line, marginVertical: 14 },
  digestRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  digestRowLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  digestRowLabelText: {
    fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  digestRowValue: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '700' },

  hourScroll: { gap: 8, paddingVertical: 4 },
  hourPill: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.line,
  },
  hourPillActive: {
    backgroundColor: t.text,
    borderColor: t.text,
  },
  hourPillText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  hourPillTextActive: { color: '#FFF' },

  channelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  channelInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  channelLabel: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' },

  locationCard: {
    padding: 12, borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.line,
  },
  locationHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  locationTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  locationBody: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },
  locationCta: {
    alignSelf: 'flex-start', marginTop: 10,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.md,
    backgroundColor: t.text,
  },
  locationCtaText: { fontSize: Type.caption1.fontSize, color: '#FFF', fontWeight: '700' },

  previewBtn: {
    marginTop: 14, paddingVertical: 12, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  previewBtnText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' },
});
