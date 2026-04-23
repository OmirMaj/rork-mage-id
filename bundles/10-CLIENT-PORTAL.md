# Client Portal, Messaging & Sharing


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

Client-facing surfaces. A project owner can publish a read-only portal
snapshot, share a schedule link, send weekly updates, and exchange messages.

- `portalSnapshot.ts` builds the JSON payload that drives the public client
  view.
- `weeklyClientUpdate.ts` generates the rolling weekly summary.


## Files in this bundle

- `app/client-portal-setup.tsx`
- `app/client-messages.tsx`
- `app/client-update.tsx`
- `app/client-view.tsx`
- `app/messages.tsx`
- `utils/portalSnapshot.ts`
- `utils/weeklyClientUpdate.ts`
- `utils/emailService.ts`


---

### `app/client-portal-setup.tsx`

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch,
  TextInput, Alert, Platform, Share, Clipboard,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Globe, Copy, Send, Trash2, Eye, EyeOff, CheckCircle2,
  CalendarDays, DollarSign, Image, FileText, ClipboardList,
  MessageSquare, BarChart3, Users, ChevronLeft, Plus, Link, Clock, Lock,
  Mail, RefreshCw, Sparkles,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { ClientPortalSettings, ClientPortalInvite } from '@/types';
import { generateUUID } from '@/utils/generateId';
import { sendEmailNative } from '@/utils/emailService';
import {
  buildPortalSnapshot, buildPortalUrl, estimateSnapshotSizeKb,
} from '@/utils/portalSnapshot';

const PORTAL_BASE_URL = 'https://mageid.app/portal';
const DEEP_LINK_SCHEME = 'rork-app://client-view';

interface PermissionToggle {
  key: keyof ClientPortalSettings;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const PERMISSION_TOGGLES: PermissionToggle[] = [
  {
    key: 'showSchedule',
    label: 'Project Schedule',
    description: 'Gantt chart & task progress',
    icon: <CalendarDays size={18} color="#007AFF" />,
  },
  {
    key: 'showBudgetSummary',
    label: 'Budget Summary',
    description: 'Overall spend vs. contract value',
    icon: <BarChart3 size={18} color="#34C759" />,
  },
  {
    key: 'showInvoices',
    label: 'Invoices',
    description: 'Invoice history & payment status',
    icon: <DollarSign size={18} color="#FF9500" />,
  },
  {
    key: 'showChangeOrders',
    label: 'Change Orders',
    description: 'Approved & pending change orders',
    icon: <FileText size={18} color="#FF3B30" />,
  },
  {
    key: 'showPhotos',
    label: 'Site Photos',
    description: 'Progress photos from the field',
    icon: <Image size={18} color="#5856D6" />,
  },
  {
    key: 'showDailyReports',
    label: 'Daily Reports',
    description: 'Weather, crew, and work summaries',
    icon: <ClipboardList size={18} color="#32ADE6" />,
  },
  {
    key: 'showPunchList',
    label: 'Punch List',
    description: 'Open items & completion status',
    icon: <CheckCircle2 size={18} color="#34C759" />,
  },
  {
    key: 'showRFIs',
    label: 'RFIs',
    description: 'Requests for information',
    icon: <MessageSquare size={18} color="#FF9500" />,
  },
  {
    key: 'showDocuments',
    label: 'Documents',
    description: 'Contracts, lien waivers, permits',
    icon: <FileText size={18} color="#8E8E93" />,
  },
];

const DEFAULT_PORTAL: ClientPortalSettings = {
  enabled: true,
  portalId: '',
  showSchedule: true,
  showBudgetSummary: false,
  showInvoices: true,
  showChangeOrders: true,
  showPhotos: true,
  showDailyReports: false,
  showPunchList: false,
  showRFIs: false,
  showDocuments: false,
  welcomeMessage: '',
  invites: [],
};

export default function ClientPortalSetupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    getProject, updateProject, getUnreadPortalMessageCount,
    settings,
    getInvoicesForProject, getChangeOrdersForProject,
    getDailyReportsForProject, getPunchItemsForProject,
    getPhotosForProject, getRFIsForProject,
  } = useProjects();
  const unreadFromClient = id ? getUnreadPortalMessageCount(id, 'gc') : 0;

  const project = useMemo(() => getProject(id ?? ''), [id, getProject]);

  const [portal, setPortal] = useState<ClientPortalSettings>(() => {
    if (project?.clientPortal?.enabled) {
      return {
        ...DEFAULT_PORTAL,
        ...project.clientPortal,
        invites: project.clientPortal.invites ?? [],
      };
    }
    return {
      ...DEFAULT_PORTAL,
      portalId: `portal-${(id ?? '').slice(0, 8)}-${Date.now().toString(36)}`,
    };
  });

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const deepLink = `${DEEP_LINK_SCHEME}?portalId=${portal.portalId}`;

  // Build a fresh snapshot every render so toggle changes / new data flow through
  // immediately. Snapshot is built only from sections the GC has toggled on,
  // then base64url-encoded into the URL's hash fragment (never sent to server).
  const snapshot = useMemo(() => {
    if (!project) return null;
    return buildPortalSnapshot({
      project,
      portal,
      settings,
      invoices: getInvoicesForProject(project.id),
      changeOrders: getChangeOrdersForProject(project.id),
      dailyReports: getDailyReportsForProject(project.id),
      punchItems: getPunchItemsForProject(project.id),
      photos: getPhotosForProject(project.id),
      rfis: getRFIsForProject(project.id),
    });
  }, [
    project, portal, settings,
    getInvoicesForProject, getChangeOrdersForProject,
    getDailyReportsForProject, getPunchItemsForProject,
    getPhotosForProject, getRFIsForProject,
  ]);

  const portalLink = useMemo(() => {
    if (!snapshot) return `${PORTAL_BASE_URL}/${portal.portalId}`;
    return buildPortalUrl(PORTAL_BASE_URL, portal.portalId, snapshot);
  }, [snapshot, portal.portalId]);

  const snapshotSizeKb = useMemo(() => {
    return snapshot ? estimateSnapshotSizeKb(snapshot) : 0;
  }, [snapshot]);

  const buildInviteLink = useCallback((invite?: ClientPortalInvite) => {
    if (!snapshot) return `${PORTAL_BASE_URL}/${portal.portalId}`;
    // Include invite.id so the portal page can greet the client by name + mark viewed
    const inviteSnapshot = invite
      ? { ...snapshot, clientName: invite.name }
      : snapshot;
    return buildPortalUrl(
      PORTAL_BASE_URL,
      portal.portalId,
      inviteSnapshot,
      invite?.id,
    );
  }, [snapshot, portal.portalId]);

  const buildInviteEmailBody = useCallback((invite: ClientPortalInvite) => {
    const link = buildInviteLink(invite);
    const greeting = invite.name ? `Hi ${invite.name.split(' ')[0]},` : 'Hi,';
    const welcome = portal.welcomeMessage
      ? `\n\n${portal.welcomeMessage}\n`
      : `\n\nWe've set up a private portal where you can follow along with your project in real time — schedule, photos, budget, and any change orders that need your sign-off.\n`;
    const passcodeLine = portal.requirePasscode && portal.passcode
      ? `\n\nPasscode (required to view): ${portal.passcode}\n(keep this private — it protects your portal)\n`
      : '';
    return `${greeting}${welcome}\nYour portal link:\n${link}${passcodeLine}\n\nIf the link doesn't open on your phone, paste it into Safari or Chrome.\n\n— ${project?.name ?? 'Your project team'}`;
  }, [buildInviteLink, portal.welcomeMessage, portal.requirePasscode, portal.passcode, project?.name]);

  const handleToggle = useCallback((key: keyof ClientPortalSettings, value: boolean) => {
    setPortal(p => ({ ...p, [key]: value }));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const handleSave = useCallback(async () => {
    if (!id) return;
    if (portal.requirePasscode && (!portal.passcode || portal.passcode.trim().length < 4)) {
      Alert.alert('Passcode Required', 'Please enter a passcode of at least 4 characters, or disable passcode protection.');
      return;
    }
    setIsSaving(true);
    try {
      updateProject(id, { clientPortal: portal });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Portal settings updated.');
    } finally {
      setIsSaving(false);
    }
  }, [id, portal, updateProject]);

  const handleCopyLink = useCallback(() => {
    if (Platform.OS === 'web') {
      navigator.clipboard?.writeText(portalLink);
    } else {
      Clipboard.setString(portalLink);
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Copied', 'Portal link copied to clipboard.');
  }, [portalLink]);

  const handleShare = useCallback(async () => {
    const passcodeLine = portal.requirePasscode && portal.passcode
      ? `\n\nPasscode: ${portal.passcode}`
      : '';
    const message = portal.welcomeMessage
      ? `${portal.welcomeMessage}\n\nView your project here:\n${portalLink}${passcodeLine}`
      : `You're invited to view live updates for "${project?.name}".\n\nLink: ${portalLink}${passcodeLine}`;
    if (Platform.OS === 'web') {
      Alert.alert('Share', message);
      return;
    }
    await Share.share({ message, title: 'Client Portal Invite' });
  }, [portal.welcomeMessage, portal.requirePasscode, portal.passcode, portalLink, project?.name]);

  const handleEmailInvite = useCallback(async (invite: ClientPortalInvite) => {
    const link = buildInviteLink(invite);
    const subject = `Your project portal — ${project?.name ?? 'MAGE ID'}`;
    const body = buildInviteEmailBody(invite);

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        window.open(`mailto:${encodeURIComponent(invite.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
      }
      return;
    }

    const result = await sendEmailNative({
      to: invite.email,
      subject,
      body,
      isHtml: false,
    });

    if (!result.success && result.error && result.error !== 'cancelled') {
      Alert.alert('Email Not Sent', result.error);
    } else if (result.success) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [buildInviteLink, buildInviteEmailBody, project?.name]);

  const handleResetPasscode = useCallback(() => {
    const generate = () => {
      const digits = Math.floor(1000 + Math.random() * 9000).toString();
      setPortal(p => ({ ...p, passcode: digits, requirePasscode: true }));
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Alert.alert('New Passcode', `New passcode: ${digits}\n\nRemember to tap Save and re-share it with clients.`);
    };
    Alert.alert(
      'Reset Passcode',
      'Generate a new 4-digit passcode? Existing clients will need the new code before they can view the portal.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Generate', onPress: generate },
      ],
    );
  }, []);

  const handleAddInvite = useCallback(() => {
    const email = inviteEmail.trim().toLowerCase();
    const name = inviteName.trim();
    if (!email || !email.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (portal.invites?.some(i => i.email === email)) {
      Alert.alert('Already Invited', 'This email has already been invited.');
      return;
    }
    const invite: ClientPortalInvite = {
      id: generateUUID(),
      email,
      name: name || email,
      invitedAt: new Date().toISOString(),
      status: 'pending',
    };
    setPortal(p => ({ ...p, invites: [...(p.invites ?? []), invite] }));
    setInviteEmail('');
    setInviteName('');
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [inviteEmail, inviteName, portal.invites]);

  const handleRemoveInvite = useCallback((inviteId: string) => {
    Alert.alert('Remove Access', 'Remove this client\'s access?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: () => {
          setPortal(p => ({ ...p, invites: (p.invites ?? []).filter(i => i.id !== inviteId) }));
        },
      },
    ]);
  }, []);

  const handleDisablePortal = useCallback(() => {
    Alert.alert('Disable Portal', 'This will revoke all client access. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disable', style: 'destructive', onPress: () => {
          if (!id) return;
          updateProject(id, { clientPortal: { ...portal, enabled: false } });
          router.back();
        },
      },
    ]);
  }, [id, portal, updateProject, router]);

  if (!project) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Client Portal',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }}>
              <ChevronLeft size={24} color={Colors.primary} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity onPress={handleSave} disabled={isSaving} style={styles.headerSaveBtn}>
              <Text style={styles.headerSaveBtnText}>{isSaving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Portal Link */}
        <View style={styles.linkCard}>
          <View style={styles.linkCardHeader}>
            <Globe size={20} color="#5856D6" />
            <Text style={styles.linkCardTitle}>Portal Link</Text>
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>Active</Text>
            </View>
          </View>
          <View style={styles.linkRow}>
            <Link size={12} color={Colors.info} />
            <Text style={styles.linkText} numberOfLines={1}>
              {`${PORTAL_BASE_URL}/${portal.portalId}`}
            </Text>
          </View>
          {snapshotSizeKb > 6 && (
            <Text style={styles.sizeWarning}>
              Snapshot is {snapshotSizeKb} KB — large links may break SMS. Consider hiding photos.
            </Text>
          )}
          <View style={styles.linkActions}>
            <TouchableOpacity style={styles.linkActionBtn} onPress={handleCopyLink}>
              <Copy size={15} color={Colors.primary} />
              <Text style={styles.linkActionText}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkActionBtn} onPress={handleShare}>
              <Send size={15} color={Colors.primary} />
              <Text style={styles.linkActionText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Passcode Protection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Passcode Protection</Text>
          <Text style={styles.sectionSubtitle}>Require clients to enter a passcode before viewing the portal. Share it separately from the link.</Text>
          <View style={styles.togglesCard}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleLeft}>
                <Lock size={18} color={Colors.primary} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>Require Passcode</Text>
                  <Text style={styles.toggleDesc}>{portal.requirePasscode ? 'Portal is locked' : 'Portal is open with link only'}</Text>
                </View>
              </View>
              <Switch
                value={!!portal.requirePasscode}
                onValueChange={val => setPortal(p => ({ ...p, requirePasscode: val }))}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#FFF"
              />
            </View>
          </View>
          {portal.requirePasscode && (
            <>
              <TextInput
                style={[styles.welcomeInput, { minHeight: 48, textAlign: 'center' as const, letterSpacing: 2, fontSize: 16, marginTop: 10 }]}
                value={portal.passcode ?? ''}
                onChangeText={val => setPortal(p => ({ ...p, passcode: val }))}
                placeholder="Enter a passcode (4-12 chars)"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                maxLength={20}
              />
              <TouchableOpacity style={styles.resetPasscodeBtn} onPress={handleResetPasscode} activeOpacity={0.8}>
                <RefreshCw size={13} color={Colors.primary} />
                <Text style={styles.resetPasscodeText}>Generate New Passcode</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Welcome Message */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Welcome Message</Text>
          <Text style={styles.sectionSubtitle}>Optional message shown to clients when they open the portal</Text>
          <TextInput
            style={styles.welcomeInput}
            value={portal.welcomeMessage}
            onChangeText={val => setPortal(p => ({ ...p, welcomeMessage: val }))}
            placeholder="e.g. Hi! Here's a live view of your project. Feel free to reach out with any questions."
            placeholderTextColor={Colors.textMuted}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Permissions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What Clients Can See</Text>
          <Text style={styles.sectionSubtitle}>Toggle sections on or off. Changes take effect immediately after saving.</Text>
          <View style={styles.togglesCard}>
            {PERMISSION_TOGGLES.map((item, index) => (
              <View key={item.key} style={[styles.toggleRow, index < PERMISSION_TOGGLES.length - 1 && styles.toggleRowBorder]}>
                <View style={styles.toggleLeft}>
                  {item.icon}
                  <View style={styles.toggleLabels}>
                    <Text style={styles.toggleLabel}>{item.label}</Text>
                    <Text style={styles.toggleDesc}>{item.description}</Text>
                  </View>
                </View>
                <Switch
                  value={portal[item.key] as boolean}
                  onValueChange={val => handleToggle(item.key, val)}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor="#FFF"
                />
              </View>
            ))}
          </View>
        </View>

        {/* Invite Clients */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Invite Clients</Text>
          <Text style={styles.sectionSubtitle}>Add clients by email to track who has access</Text>
          <View style={styles.inviteForm}>
            <TextInput
              style={styles.input}
              value={inviteName}
              onChangeText={setInviteName}
              placeholder="Client name"
              placeholderTextColor={Colors.textMuted}
            />
            <TextInput
              style={styles.input}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="Email address"
              placeholderTextColor={Colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.inviteBtn} onPress={handleAddInvite}>
              <Plus size={16} color="#FFF" />
              <Text style={styles.inviteBtnText}>Add Client</Text>
            </TouchableOpacity>
          </View>

          {/* Invite List */}
          {(portal.invites ?? []).length > 0 && (
            <View style={styles.inviteList}>
              {(portal.invites ?? []).map(invite => (
                <View key={invite.id} style={styles.inviteRow}>
                  <View style={styles.inviteAvatar}>
                    <Text style={styles.inviteAvatarText}>{invite.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.inviteInfo}>
                    <Text style={styles.inviteName}>{invite.name}</Text>
                    <Text style={styles.inviteEmail}>{invite.email}</Text>
                  </View>
                  <View style={styles.inviteRight}>
                    <View style={[styles.inviteStatus, invite.status === 'viewed' && styles.inviteStatusViewed]}>
                      {invite.status === 'viewed'
                        ? <Eye size={10} color="#34C759" />
                        : <Clock size={10} color="#FF9500" />
                      }
                      <Text style={[styles.inviteStatusText, invite.status === 'viewed' && { color: '#34C759' }]}>
                        {invite.status === 'viewed' ? 'Viewed' : 'Pending'}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => handleEmailInvite(invite)} style={styles.emailInviteBtn} activeOpacity={0.7}>
                      <Mail size={14} color={Colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleRemoveInvite(invite.id)} style={styles.removeBtn}>
                      <Trash2 size={14} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Messages inbox CTA */}
        <TouchableOpacity
          style={styles.weeklyUpdateBtn}
          onPress={() => router.push(`/client-messages?id=${id}` as any)}
          activeOpacity={0.85}
          testID="portal-messages-btn"
        >
          <View style={styles.weeklyUpdateIcon}>
            <MessageSquare size={16} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.weeklyUpdateTitle}>Messages</Text>
            <Text style={styles.weeklyUpdateSub}>
              {unreadFromClient > 0
                ? `${unreadFromClient} new ${unreadFromClient === 1 ? 'message' : 'messages'} from your client`
                : 'Two-way Q&A with everyone invited to the portal.'}
            </Text>
          </View>
          {unreadFromClient > 0 && (
            <View style={styles.unreadPill}>
              <Text style={styles.unreadPillTxt}>{unreadFromClient}</Text>
            </View>
          )}
          <Text style={styles.weeklyUpdateArrow}>›</Text>
        </TouchableOpacity>

        {/* Weekly Update CTA */}
        <TouchableOpacity
          style={styles.weeklyUpdateBtn}
          onPress={() => router.push(`/client-update?projectId=${id}` as any)}
          activeOpacity={0.85}
          testID="draft-weekly-update-btn"
        >
          <View style={styles.weeklyUpdateIcon}>
            <Sparkles size={16} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.weeklyUpdateTitle}>Draft Weekly Update</Text>
            <Text style={styles.weeklyUpdateSub}>AI writes a friendly progress email from the last 7 days. You edit, then send.</Text>
          </View>
          <Text style={styles.weeklyUpdateArrow}>›</Text>
        </TouchableOpacity>

        {/* Danger Zone */}
        <TouchableOpacity style={styles.disableBtn} onPress={handleDisablePortal}>
          <EyeOff size={16} color={Colors.error} />
          <Text style={styles.disableBtnText}>Disable Client Portal</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerSaveBtn: { paddingHorizontal: 4 },
  headerSaveBtnText: { fontSize: 16, fontWeight: '600', color: Colors.primary },

  linkCard: {
    margin: 16,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#5856D620',
  },
  linkCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  linkCardTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, flex: 1 },
  activeBadge: { backgroundColor: '#34C75920', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  activeBadgeText: { fontSize: 11, fontWeight: '600', color: '#34C759' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.background, borderRadius: 8, padding: 10, marginBottom: 12 },
  linkText: { fontSize: 12, color: Colors.info, flex: 1 },
  linkActions: { flexDirection: 'row', gap: 10 },
  linkActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary + '15', borderRadius: 10, paddingVertical: 10 },
  linkActionText: { fontSize: 14, fontWeight: '600', color: Colors.primary },

  section: { paddingHorizontal: 16, marginBottom: 24 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, color: Colors.textMuted, marginBottom: 12, lineHeight: 18 },

  welcomeInput: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },

  togglesCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  toggleRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  toggleLabels: { flex: 1 },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },
  toggleDesc: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },

  inviteForm: { gap: 8 },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
  },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 13,
  },
  inviteBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },

  inviteList: {
    marginTop: 12,
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  inviteRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  inviteAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primary + '25',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  inviteAvatarText: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  inviteInfo: { flex: 1 },
  inviteName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  inviteEmail: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  inviteRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inviteStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FF950020', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3,
  },
  inviteStatusViewed: { backgroundColor: '#34C75920' },
  inviteStatusText: { fontSize: 10, fontWeight: '600', color: '#FF9500' },
  removeBtn: { padding: 4 },
  emailInviteBtn: { padding: 4 },
  resetPasscodeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: 10, paddingVertical: 10, borderRadius: 10,
    backgroundColor: Colors.primary + '12', borderWidth: 1, borderColor: Colors.primary + '30',
  },
  resetPasscodeText: { fontSize: 13, fontWeight: '600', color: Colors.primary },

  disableBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.error + '40',
    borderRadius: 12, paddingVertical: 14,
  },
  disableBtnText: { fontSize: 15, fontWeight: '600', color: Colors.error },
  sizeWarning: {
    fontSize: 11,
    color: Colors.warning,
    marginTop: -6,
    marginBottom: 10,
    fontStyle: 'italic',
  },

  weeklyUpdateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.primary + '25',
    padding: 14,
  },
  weeklyUpdateIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  weeklyUpdateTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  weeklyUpdateSub: { fontSize: 12, color: Colors.textMuted, lineHeight: 16 },
  weeklyUpdateArrow: { fontSize: 22, color: Colors.textMuted, paddingHorizontal: 4 },

  unreadPill: {
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.error,
    paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center',
    marginRight: 4,
  },
  unreadPillTxt: { color: '#fff', fontWeight: '800', fontSize: 11 },
});

```


---

### `app/client-messages.tsx`

```tsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MessageSquare, Send, Inbox } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';

export default function ClientMessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const {
    projects, settings,
    getPortalMessagesForProject, addPortalMessage, markPortalMessagesRead,
  } = useProjects();

  const project = useMemo(() => projects.find(p => p.id === id), [projects, id]);
  const portal = project?.clientPortal;

  const messages = useMemo(
    () => project ? getPortalMessagesForProject(project.id) : [],
    [project, getPortalMessagesForProject],
  );

  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  // When the GC opens this screen, mark all client messages as read.
  useEffect(() => {
    if (!project) return;
    markPortalMessagesRead(project.id, 'gc');
  }, [project?.id, markPortalMessagesRead]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length]);

  const handleSend = useCallback(() => {
    if (!project || !portal) return;
    const body = composeBody.trim();
    if (!body) return;
    const gcName = settings?.branding?.companyName || 'Your General Contractor';
    setSending(true);
    try {
      addPortalMessage({
        projectId: project.id,
        portalId: portal.portalId,
        authorType: 'gc',
        authorName: gcName,
        body,
        readByGc: true,
        readByClient: false,
      });
      setComposeBody('');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setSending(false);
    }
  }, [project, portal, composeBody, settings, addPortalMessage]);

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 40, alignItems: 'center' }]}>
        <Stack.Screen options={{ title: 'Messages' }} />
        <Text style={styles.muted}>Project not found.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnTxt}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!portal?.enabled) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 40, alignItems: 'center', paddingHorizontal: 24 }]}>
        <Stack.Screen options={{ title: 'Messages' }} />
        <Inbox size={30} color={Colors.textMuted} />
        <Text style={styles.muted}>Enable the client portal for this project to start a conversation.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnTxt}>Back to portal setup</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
      <Stack.Screen options={{ title: project.name }} />
      <View style={styles.subheader}>
        <MessageSquare size={14} color={Colors.primary} />
        <Text style={styles.subheaderTxt}>
          Thread with {portal.invites?.length ?? 0} {(portal.invites?.length ?? 0) === 1 ? 'client' : 'clients'}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <MessageSquare size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No messages yet.</Text>
            <Text style={styles.emptyHint}>
              Break the ice — send a quick hello and let your client know how to reach you.
            </Text>
          </View>
        ) : (
          messages.map((m) => {
            const mine = m.authorType === 'gc';
            return (
              <View
                key={m.id}
                style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}
              >
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.author, mine && styles.authorMine]}>
                    {mine ? 'You' : m.authorName}
                  </Text>
                  <Text style={[styles.body, mine && styles.bodyMine]}>{m.body}</Text>
                  <Text style={[styles.time, mine && styles.timeMine]}>
                    {new Date(m.createdAt).toLocaleString('en-US', {
                      month: 'short', day: 'numeric',
                      hour: 'numeric', minute: '2-digit',
                    })}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={[styles.compose, { paddingBottom: insets.bottom + 10 }]}>
        <TextInput
          style={styles.input}
          value={composeBody}
          onChangeText={setComposeBody}
          placeholder="Write a reply…"
          placeholderTextColor={Colors.textMuted}
          multiline
          textAlignVertical="top"
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!composeBody.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!composeBody.trim() || sending}
          activeOpacity={0.8}
        >
          <Send size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  muted: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 12 },
  backBtn: {
    marginTop: 18, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: Colors.primary, borderRadius: 10,
  },
  backBtnTxt: { color: Colors.textOnPrimary, fontWeight: '600', fontSize: 14 },

  subheader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: `${Colors.primary}0A`,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border,
  },
  subheaderTxt: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 8 },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginTop: 8 },
  emptyHint: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },

  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '84%', borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  bubbleMine: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: Colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: Colors.cardBorder },
  author: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, marginBottom: 2 },
  authorMine: { color: 'rgba(255,255,255,0.85)' },
  body: { fontSize: 14, color: Colors.text, lineHeight: 19 },
  bodyMine: { color: '#fff' },
  time: { fontSize: 10, color: Colors.textMuted, marginTop: 4 },
  timeMine: { color: 'rgba(255,255,255,0.7)' },

  compose: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 140,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: Colors.text, backgroundColor: Colors.background,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
});

```


---

### `app/client-update.tsx`

```tsx
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Sparkles, Mail, RefreshCw, CheckCircle2, Plus, X, FileText, Info,
  Users,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  draftWeeklyUpdate, gatherWeeklyContext, renderDraftToPlainText, renderDraftToHtml,
  type WeeklyUpdateDraft,
} from '@/utils/weeklyClientUpdate';
import { sendEmailNative } from '@/utils/emailService';

export default function ClientUpdateScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const {
    projects, settings, getProject, getDailyReportsForProject, getPhotosForProject,
    getChangeOrdersForProject, getInvoicesForProject, getPunchItemsForProject, getRFIsForProject,
  } = useProjects();

  const initialProject = params.projectId ?? projects[0]?.id;
  const [projectId, setProjectId] = useState<string | undefined>(initialProject);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<WeeklyUpdateDraft | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const project = projectId ? getProject(projectId) : undefined;
  const inviteEmails = useMemo(
    () => (project?.clientPortal?.invites ?? []).map(i => i.email).filter(Boolean),
    [project],
  );
  const [recipients, setRecipients] = useState<string[]>(inviteEmails);
  const [newEmail, setNewEmail] = useState('');

  useEffect(() => {
    setRecipients(inviteEmails);
  }, [inviteEmails]);

  const gcName = settings?.branding?.companyName || 'Your General Contractor';
  const primaryInvite = project?.clientPortal?.invites?.[0];
  const ownerName = primaryInvite?.name ?? '';

  const handleDraft = useCallback(async () => {
    if (!project) {
      Alert.alert('Pick a project', 'Select a project first.');
      return;
    }
    try {
      setDrafting(true);
      setErrorMsg(null);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const ctx = gatherWeeklyContext(
        project,
        getDailyReportsForProject(project.id),
        getPhotosForProject(project.id),
        getChangeOrdersForProject(project.id),
        getInvoicesForProject(project.id),
        getPunchItemsForProject(project.id),
        getRFIsForProject(project.id),
        7,
      );

      const res = await draftWeeklyUpdate(ctx, gcName, ownerName || 'there');
      if (!res.success || !res.draft) {
        setErrorMsg(res.error ?? 'AI draft failed');
      } else {
        setDraft(res.draft);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      console.error('[ClientUpdate] draft failed', err);
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDrafting(false);
    }
  }, [project, gcName, ownerName, getDailyReportsForProject, getPhotosForProject,
      getChangeOrdersForProject, getInvoicesForProject, getPunchItemsForProject, getRFIsForProject]);

  const handleSend = useCallback(async () => {
    if (!draft) return;
    if (recipients.length === 0) {
      Alert.alert('Add a recipient', 'Add at least one email address to send this update.');
      return;
    }
    try {
      setSending(true);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const html = renderDraftToHtml(draft);
      const res = await sendEmailNative({
        to: recipients.join(','),
        subject: draft.subject,
        body: html,
        isHtml: true,
      });
      if (res.success) {
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Sent', 'Weekly update sent via your mail app.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('Could not open mail', res.error ?? 'Unknown error');
      }
    } catch (err) {
      console.error('[ClientUpdate] send failed', err);
      Alert.alert('Send failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSending(false);
    }
  }, [draft, recipients, router]);

  const addRecipient = useCallback(() => {
    const e = newEmail.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      Alert.alert('Invalid email', 'Enter a valid email address.');
      return;
    }
    if (recipients.includes(e)) {
      setNewEmail('');
      return;
    }
    setRecipients([...recipients, e]);
    setNewEmail('');
  }, [newEmail, recipients]);

  const removeRecipient = useCallback((e: string) => {
    setRecipients(recipients.filter(r => r !== e));
  }, [recipients]);

  const updateBullet = useCallback((key: 'accomplishments' | 'upcoming' | 'issues', idx: number, value: string) => {
    if (!draft) return;
    const next = [...draft[key]];
    next[idx] = value;
    setDraft({ ...draft, [key]: next });
  }, [draft]);

  const addBullet = useCallback((key: 'accomplishments' | 'upcoming' | 'issues') => {
    if (!draft) return;
    setDraft({ ...draft, [key]: [...draft[key], ''] });
  }, [draft]);

  const removeBullet = useCallback((key: 'accomplishments' | 'upcoming' | 'issues', idx: number) => {
    if (!draft) return;
    const next = draft[key].filter((_, i) => i !== idx);
    setDraft({ ...draft, [key]: next });
  }, [draft]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Sparkles size={22} color={Colors.primary} /></View>
          <Text style={styles.heroTitle}>Weekly client update</Text>
          <Text style={styles.heroSub}>
            AI drafts a friendly email from the last 7 days of field data. Review, edit, then send from your mail app.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>PROJECT</Text>
        <View style={styles.projectList}>
          {projects.length === 0 ? (
            <Text style={styles.emptyTxt}>Create a project first.</Text>
          ) : (
            projects.map(p => {
              const active = p.id === projectId;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.projectRow, active && styles.projectRowActive]}
                  onPress={() => { setProjectId(p.id); setDraft(null); }}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.projectRowName, active && styles.projectRowNameActive]}>{p.name}</Text>
                    <Text style={styles.projectRowMeta}>{p.type} · {p.location}</Text>
                  </View>
                  {active && <CheckCircle2 size={18} color={Colors.primary} />}
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <Text style={styles.sectionLabel}>RECIPIENTS</Text>
        <View style={styles.recipientCard}>
          {recipients.length === 0 && (
            <Text style={styles.emptyInline}>No recipients yet — add one below, or set up the client portal first.</Text>
          )}
          {recipients.map(email => (
            <View key={email} style={styles.chip}>
              <Mail size={12} color={Colors.primary} />
              <Text style={styles.chipTxt} numberOfLines={1}>{email}</Text>
              <TouchableOpacity onPress={() => removeRecipient(email)} hitSlop={8}>
                <X size={14} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={styles.addRow}>
            <TextInput
              style={styles.emailInput}
              placeholder="add@email.com"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={newEmail}
              onChangeText={setNewEmail}
              onSubmitEditing={addRecipient}
            />
            <TouchableOpacity style={styles.addBtn} onPress={addRecipient} activeOpacity={0.7}>
              <Plus size={14} color={Colors.textOnPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {!draft && (
          <TouchableOpacity
            style={[styles.draftBtn, drafting && styles.draftBtnDisabled]}
            onPress={handleDraft}
            disabled={drafting || !project}
            activeOpacity={0.85}
          >
            {drafting ? (
              <ActivityIndicator color={Colors.textOnPrimary} />
            ) : (
              <>
                <Sparkles size={16} color={Colors.textOnPrimary} />
                <Text style={styles.draftBtnTxt}>Draft update with AI</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {errorMsg && (
          <View style={styles.errorCard}>
            <Info size={14} color="#D93025" />
            <Text style={styles.errorTxt}>{errorMsg}</Text>
          </View>
        )}

        {draft && (
          <>
            <View style={styles.draftHeader}>
              <Text style={styles.sectionLabel}>DRAFT · Edit anything</Text>
              <TouchableOpacity onPress={handleDraft} style={styles.regenBtn} activeOpacity={0.7}>
                <RefreshCw size={12} color={Colors.primary} />
                <Text style={styles.regenTxt}>Regenerate</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Subject</Text>
              <TextInput
                style={styles.fieldInput}
                value={draft.subject}
                onChangeText={(v) => setDraft({ ...draft, subject: v })}
                placeholderTextColor={Colors.textMuted}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Greeting</Text>
              <TextInput
                style={styles.fieldInput}
                value={draft.greeting}
                onChangeText={(v) => setDraft({ ...draft, greeting: v })}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Summary</Text>
              <TextInput
                style={[styles.fieldInput, styles.multiline]}
                value={draft.summary}
                onChangeText={(v) => setDraft({ ...draft, summary: v })}
                multiline
                textAlignVertical="top"
              />
            </View>

            <BulletEditor
              title="This week we..."
              items={draft.accomplishments}
              onChange={(i, v) => updateBullet('accomplishments', i, v)}
              onAdd={() => addBullet('accomplishments')}
              onRemove={(i) => removeBullet('accomplishments', i)}
            />
            <BulletEditor
              title="Coming up..."
              items={draft.upcoming}
              onChange={(i, v) => updateBullet('upcoming', i, v)}
              onAdd={() => addBullet('upcoming')}
              onRemove={(i) => removeBullet('upcoming', i)}
            />
            <BulletEditor
              title="Heads up..."
              items={draft.issues}
              onChange={(i, v) => updateBullet('issues', i, v)}
              onAdd={() => addBullet('issues')}
              onRemove={(i) => removeBullet('issues', i)}
            />

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Financial note</Text>
              <TextInput
                style={[styles.fieldInput, styles.multiline]}
                value={draft.financial}
                onChangeText={(v) => setDraft({ ...draft, financial: v })}
                multiline
                textAlignVertical="top"
                placeholder="Change orders, invoices, contract impact..."
                placeholderTextColor={Colors.textMuted}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Closing</Text>
              <TextInput
                style={styles.fieldInput}
                value={draft.closing}
                onChangeText={(v) => setDraft({ ...draft, closing: v })}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Signature</Text>
              <TextInput
                style={styles.fieldInput}
                value={draft.signatureName}
                onChangeText={(v) => setDraft({ ...draft, signatureName: v })}
              />
            </View>

            <View style={styles.previewCard}>
              <View style={styles.previewHeader}>
                <FileText size={14} color={Colors.textSecondary} />
                <Text style={styles.previewHeaderTxt}>Plain-text preview</Text>
              </View>
              <Text style={styles.previewBody}>{renderDraftToPlainText(draft)}</Text>
            </View>
          </>
        )}
      </ScrollView>

      {draft && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={sending}
            activeOpacity={0.85}
          >
            {sending ? (
              <ActivityIndicator color={Colors.textOnPrimary} />
            ) : (
              <>
                <Users size={16} color={Colors.textOnPrimary} />
                <Text style={styles.sendBtnTxt}>
                  Send to {recipients.length} {recipients.length === 1 ? 'recipient' : 'recipients'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function BulletEditor({
  title, items, onChange, onAdd, onRemove,
}: {
  title: string;
  items: string[];
  onChange: (idx: number, value: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{title}</Text>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <TextInput
            style={styles.bulletInput}
            value={item}
            onChangeText={(v) => onChange(i, v)}
            multiline
            textAlignVertical="top"
            placeholder="Type a bullet…"
            placeholderTextColor={Colors.textMuted}
          />
          <TouchableOpacity onPress={() => onRemove(i)} hitSlop={8} style={styles.bulletRemove}>
            <X size={14} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity onPress={onAdd} style={styles.addBullet} activeOpacity={0.7}>
        <Plus size={12} color={Colors.primary} />
        <Text style={styles.addBulletTxt}>Add</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16 },
  hero: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 10, marginBottom: 8,
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: `${Colors.primary}15`,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },
  heroSub: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },

  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: Colors.textSecondary,
    letterSpacing: 0.8, marginBottom: 8, marginTop: 20,
  },

  projectList: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden',
  },
  projectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight,
  },
  projectRowActive: { backgroundColor: `${Colors.primary}08` },
  projectRowName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  projectRowNameActive: { color: Colors.primary },
  projectRowMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  emptyTxt: { fontSize: 13, color: Colors.textSecondary, padding: 14, textAlign: 'center' },
  emptyInline: { fontSize: 12, color: Colors.textSecondary, paddingBottom: 8 },

  recipientCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder,
    padding: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: `${Colors.primary}10`,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    maxWidth: '100%',
  },
  chipTxt: { fontSize: 12, color: Colors.text, maxWidth: 180 },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '100%', marginTop: 4 },
  emailInput: {
    flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: Colors.text,
    backgroundColor: Colors.background,
  },
  addBtn: {
    backgroundColor: Colors.primary, width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },

  draftBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: 12, marginTop: 20,
  },
  draftBtnDisabled: { opacity: 0.6 },
  draftBtnTxt: { color: Colors.textOnPrimary, fontWeight: '700', fontSize: 15 },

  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#FEE', padding: 12, borderRadius: 10, marginTop: 12,
  },
  errorTxt: { flex: 1, fontSize: 12, color: '#D93025', lineHeight: 17 },

  draftHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  regenBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: `${Colors.primary}10`, borderRadius: 10, marginTop: 20,
  },
  regenTxt: { fontSize: 11, fontWeight: '600', color: Colors.primary },

  field: { marginTop: 16 },
  fieldLabel: {
    fontSize: 11, fontWeight: '600', color: Colors.textSecondary,
    marginBottom: 6, letterSpacing: 0.5,
  },
  fieldInput: {
    borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: Colors.text, backgroundColor: Colors.surface,
  },
  multiline: { minHeight: 72 },

  bulletRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginBottom: 6,
  },
  bulletDot: { fontSize: 16, color: Colors.primary, paddingTop: 10, width: 10 },
  bulletInput: {
    flex: 1, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13, color: Colors.text, backgroundColor: Colors.surface,
    minHeight: 40,
  },
  bulletRemove: { paddingTop: 10, paddingHorizontal: 4 },
  addBullet: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: `${Colors.primary}10`, borderRadius: 8, marginTop: 4,
  },
  addBulletTxt: { fontSize: 11, fontWeight: '600', color: Colors.primary },

  previewCard: {
    marginTop: 24, borderRadius: 12, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.cardBorder, padding: 14,
  },
  previewHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  previewHeaderTxt: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, letterSpacing: 0.5 },
  previewBody: {
    fontSize: 13, color: Colors.text, lineHeight: 19,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },

  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border,
  },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 12,
  },
  sendBtnDisabled: { opacity: 0.6 },
  sendBtnTxt: { color: Colors.textOnPrimary, fontWeight: '700', fontSize: 15 },
});

```


---

### `app/client-view.tsx`

```tsx
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, Dimensions, TextInput, Platform, Modal, Alert,
  RefreshControl,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Globe, CalendarDays, DollarSign, FileText, Image as ImageIcon,
  ClipboardList, CheckCircle2, MessageSquare, ChevronDown, ChevronUp,
  TrendingUp, Clock, AlertTriangle, BarChart3, Flag, GitBranch, Lock,
  FileSignature, X, Check, ThumbsUp, ThumbsDown, ShieldCheck, Send,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { formatMoney } from '@/utils/formatters';
import type { ScheduleTask, ChangeOrder, COApprover, COAuditEntry } from '@/types';
import { getStatusColor, getStatusLabel, getPhaseColor } from '@/utils/scheduleEngine';
import { MOCK_DOCUMENTS, DOCUMENT_TYPE_INFO } from '@/mocks/documents';
import SignaturePad from '@/components/SignaturePad';
import { generateUUID } from '@/utils/generateId';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type SectionKey = 'messages' | 'schedule' | 'budget' | 'invoices' | 'changeOrders' | 'photos' | 'dailyReports' | 'punchList' | 'rfis' | 'documents';

function SectionHeader({ title, icon, count, expanded, onToggle }: {
  title: string; icon: React.ReactNode; count?: number; expanded: boolean; onToggle: () => void;
}) {
  return (
    <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
      {icon}
      <Text style={styles.sectionTitle}>{title}</Text>
      {count !== undefined && (
        <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
      )}
      {expanded ? <ChevronUp size={16} color={Colors.textMuted} /> : <ChevronDown size={16} color={Colors.textMuted} />}
    </TouchableOpacity>
  );
}

function TaskRow({ task }: { task: ScheduleTask }) {
  const statusColor = getStatusColor(task.status);
  const phaseColor = getPhaseColor(task.phase);
  return (
    <View style={styles.taskRow}>
      <View style={[styles.taskPhaseBar, { backgroundColor: phaseColor }]} />
      <View style={styles.taskContent}>
        <View style={styles.taskTitleRow}>
          {task.isMilestone && <Flag size={11} color="#FF9500" />}
          {task.isCriticalPath && <GitBranch size={11} color={Colors.error} />}
          <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
        </View>
        <Text style={styles.taskMeta}>{task.phase} · {task.durationDays}d</Text>
        <View style={styles.taskProgressRow}>
          <View style={styles.taskProgressBar}>
            <View style={[styles.taskProgressFill, { width: `${task.progress}%` as any, backgroundColor: statusColor }]} />
          </View>
          <Text style={[styles.taskProgressPct, { color: statusColor }]}>{task.progress}%</Text>
        </View>
      </View>
      <View style={[styles.taskStatusBadge, { backgroundColor: statusColor + '20' }]}>
        <Text style={[styles.taskStatusText, { color: statusColor }]}>{getStatusLabel(task.status)}</Text>
      </View>
    </View>
  );
}

export default function ClientViewScreen() {
  const insets = useSafeAreaInsets();
  const { portalId, inviteId, clientName: clientNameParam } = useLocalSearchParams<{ portalId: string; inviteId?: string; clientName?: string }>();
  const {
    projects, getChangeOrdersForProject, getInvoicesForProject, getDailyReportsForProject,
    getPunchItemsForProject, getPhotosForProject, getRFIsForProject, updateProject, updateChangeOrder,
    getPortalMessagesForProject, addPortalMessage, markPortalMessagesRead, getUnreadPortalMessageCount,
  } = useProjects();

  // Find project by portalId
  const project = useMemo(() =>
    projects.find(p => p.clientPortal?.portalId === portalId && p.clientPortal?.enabled),
    [projects, portalId]
  );

  const portal = project?.clientPortal;

  const changeOrders = useMemo(() => project ? getChangeOrdersForProject(project.id) : [], [project, getChangeOrdersForProject]);
  const invoices = useMemo(() => project ? getInvoicesForProject(project.id) : [], [project, getInvoicesForProject]);
  const dailyReports = useMemo(() => project ? getDailyReportsForProject(project.id) : [], [project, getDailyReportsForProject]);
  const punchItems = useMemo(() => project ? getPunchItemsForProject(project.id) : [], [project, getPunchItemsForProject]);
  const photos = useMemo(() => project ? getPhotosForProject(project.id) : [], [project, getPhotosForProject]);
  const rfis = useMemo(() => project ? getRFIsForProject(project.id) : [], [project, getRFIsForProject]);
  const documents = useMemo(
    () => project ? MOCK_DOCUMENTS.filter(d => d.projectId === project.id) : [],
    [project]
  );

  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    messages: true, schedule: true, budget: true, invoices: true, changeOrders: false,
    photos: true, dailyReports: false, punchList: false, rfis: false, documents: false,
  });

  // Realtime: when the GC updates anything on this project, invalidate local
  // react-query caches so the client portal re-renders with fresh data.
  // We scope the subscription to the single project row to avoid noisy
  // re-fetches when unrelated records change.
  const queryClient = useQueryClient();
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['changeOrders'] }),
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['dailyReports'] }),
        queryClient.invalidateQueries({ queryKey: ['punchItems'] }),
        queryClient.invalidateQueries({ queryKey: ['photos'] }),
        queryClient.invalidateQueries({ queryKey: ['rfis'] }),
      ]);
      setLastUpdatedAt(new Date());
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (!isSupabaseConfigured || !project?.id) return;
    const projectId = project.id;
    const channel = supabase
      .channel(`client-portal-${projectId}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['projects'] });
          setLastUpdatedAt(new Date());
        },
      )
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'change_orders', filter: `project_id=eq.${projectId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['changeOrders'] });
          setLastUpdatedAt(new Date());
        },
      )
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'invoices', filter: `project_id=eq.${projectId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['invoices'] });
          setLastUpdatedAt(new Date());
        },
      )
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'daily_reports', filter: `project_id=eq.${projectId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['dailyReports'] });
          setLastUpdatedAt(new Date());
        },
      )
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'photos', filter: `project_id=eq.${projectId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['photos'] });
          setLastUpdatedAt(new Date());
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [project?.id, queryClient]);

  const [passcodeEntry, setPasscodeEntry] = useState('');
  const [passcodeUnlocked, setPasscodeUnlocked] = useState(false);
  const [passcodeError, setPasscodeError] = useState(false);

  // CO approval modal state
  const [approvalCO, setApprovalCO] = useState<ChangeOrder | null>(null);
  const [approvalMode, setApprovalMode] = useState<'approve' | 'reject'>('approve');
  const [approverName, setApproverName] = useState<string>(typeof clientNameParam === 'string' ? clientNameParam : '');
  const [rejectionReason, setRejectionReason] = useState('');
  const [signaturePaths, setSignaturePaths] = useState<string[]>([]);
  const [submittingApproval, setSubmittingApproval] = useState(false);

  // Mark invite viewed when client opens portal (after passcode if required)
  const canRecordAccess = !!project && !!portal && (!portal.requirePasscode || passcodeUnlocked);
  useEffect(() => {
    if (!canRecordAccess || !project || !portal) return;
    const invites = portal.invites ?? [];
    if (invites.length === 0) return;

    const now = new Date().toISOString();
    let changed = false;
    const nextInvites = invites.map(inv => {
      // If a specific inviteId was passed on the link, only update that one
      if (inviteId) {
        if (inv.id === inviteId && inv.status !== 'viewed') {
          changed = true;
          return { ...inv, status: 'viewed' as const, accessedAt: now };
        }
        return inv;
      }
      // Otherwise, mark all pending invites as viewed (no client identity signal)
      if (inv.status === 'pending' && !inv.accessedAt) {
        changed = true;
        return { ...inv, status: 'viewed' as const, accessedAt: now };
      }
      return inv;
    });

    if (changed) {
      updateProject(project.id, { clientPortal: { ...portal, invites: nextInvites } });
    }
    // Only run when unlock state or portalId changes — not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRecordAccess, project?.id, inviteId]);

  const toggleSection = (key: SectionKey) => setExpanded(p => ({ ...p, [key]: !p[key] }));

  // Portal messages (Q&A thread) — client side
  const messages = useMemo(
    () => project ? getPortalMessagesForProject(project.id) : [],
    [project, getPortalMessagesForProject],
  );
  const unreadFromGc = useMemo(
    () => project ? getUnreadPortalMessageCount(project.id, 'client') : 0,
    [project, getUnreadPortalMessageCount],
  );
  const [composeBody, setComposeBody] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  // Mark all messages from GC as read once the client has opened the portal.
  useEffect(() => {
    if (!canRecordAccess || !project) return;
    if (unreadFromGc === 0) return;
    markPortalMessagesRead(project.id, 'client');
  }, [canRecordAccess, project?.id, unreadFromGc, markPortalMessagesRead]);

  const handleSendMessage = useCallback(() => {
    if (!project || !portal) return;
    const body = composeBody.trim();
    if (!body) return;
    const authorName =
      (typeof clientNameParam === 'string' && clientNameParam.trim()) ||
      portal.invites?.find(i => i.id === inviteId)?.name ||
      'Client';
    setSendingMsg(true);
    try {
      addPortalMessage({
        projectId: project.id,
        portalId: portal.portalId,
        authorType: 'client',
        authorName,
        inviteId: typeof inviteId === 'string' ? inviteId : undefined,
        body,
        readByGc: false,
        readByClient: true,
      });
      setComposeBody('');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setSendingMsg(false);
    }
  }, [project, portal, composeBody, inviteId, clientNameParam, addPortalMessage]);

  const openApprovalFlow = useCallback((co: ChangeOrder, mode: 'approve' | 'reject') => {
    setApprovalCO(co);
    setApprovalMode(mode);
    setSignaturePaths([]);
    setRejectionReason('');
    if (!approverName && clientNameParam) setApproverName(String(clientNameParam));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [approverName, clientNameParam]);

  const closeApprovalFlow = useCallback(() => {
    setApprovalCO(null);
    setSignaturePaths([]);
    setRejectionReason('');
    setSubmittingApproval(false);
  }, []);

  const submitApproval = useCallback(() => {
    if (!approvalCO || !project) return;
    if (!approverName.trim()) {
      Alert.alert('Name Required', 'Please enter your name as it appears on the contract.');
      return;
    }
    if (approvalMode === 'approve' && signaturePaths.length === 0) {
      Alert.alert('Signature Required', 'Please sign above to approve this change order.');
      return;
    }
    if (approvalMode === 'reject' && !rejectionReason.trim()) {
      Alert.alert('Reason Required', 'Please briefly explain why you are rejecting this change order.');
      return;
    }

    setSubmittingApproval(true);

    const now = new Date().toISOString();
    const existingApprovers: COApprover[] = approvalCO.approvers ?? [];
    const existingAudit: COAuditEntry[] = approvalCO.auditTrail ?? [];

    // Find or create a "Client" approver slot
    let approverUpdated = false;
    const nextApprovers: COApprover[] = existingApprovers.map(a => {
      if (!approverUpdated && a.role === 'Client' && a.status === 'pending') {
        approverUpdated = true;
        return {
          ...a,
          name: approverName.trim(),
          status: approvalMode === 'approve' ? 'approved' : 'rejected',
          responseDate: now,
          rejectionReason: approvalMode === 'reject' ? rejectionReason.trim() : undefined,
        };
      }
      return a;
    });
    if (!approverUpdated) {
      nextApprovers.push({
        id: generateUUID(),
        name: approverName.trim(),
        email: '',
        role: 'Client',
        required: true,
        order: nextApprovers.length,
        status: approvalMode === 'approve' ? 'approved' : 'rejected',
        responseDate: now,
        rejectionReason: approvalMode === 'reject' ? rejectionReason.trim() : undefined,
      });
    }

    const auditEntry: COAuditEntry = {
      id: generateUUID(),
      action: approvalMode === 'approve' ? 'client_approved_via_portal' : 'client_rejected_via_portal',
      actor: approverName.trim(),
      timestamp: now,
      detail: approvalMode === 'approve'
        ? `Digitally signed via client portal. Signature stroke count: ${signaturePaths.length}.`
        : `Rejected via client portal. Reason: ${rejectionReason.trim()}`,
    };

    const nextStatus = approvalMode === 'approve' ? 'approved' : 'rejected';

    updateChangeOrder(approvalCO.id, {
      status: nextStatus,
      approvers: nextApprovers,
      auditTrail: [...existingAudit, auditEntry],
    });

    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    const verb = approvalMode === 'approve' ? 'approved' : 'rejected';
    Alert.alert(
      approvalMode === 'approve' ? 'Approved' : 'Rejected',
      `Change Order #${approvalCO.number} has been ${verb}. The contractor has been notified.`,
      [{ text: 'OK', onPress: closeApprovalFlow }]
    );
  }, [approvalCO, project, approverName, signaturePaths, approvalMode, rejectionReason, updateChangeOrder, closeApprovalFlow]);

  // Budget metrics
  const contractValue = project?.estimate?.grandTotal ?? 0;
  const invoicedTotal = invoices.reduce((s, i) => s + i.totalDue, 0);
  const paidTotal = invoices.reduce((s, i) => s + i.amountPaid, 0);
  const coTotal = changeOrders.filter(c => c.status === 'approved').reduce((s, c) => s + c.changeAmount, 0);
  const revisedContract = contractValue + coTotal;

  // Schedule metrics
  const tasks = project?.schedule?.tasks ?? [];
  const doneTasks = tasks.filter(t => t.status === 'done').length;
  const scheduleProgress = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;
  const healthScore = project?.schedule?.healthScore ?? 0;

  if (!project || !portal) {
    return (
      <View style={styles.notFoundContainer}>
        <Stack.Screen options={{ title: 'Client Portal', headerShown: false }} />
        <Globe size={48} color={Colors.textMuted} />
        <Text style={styles.notFoundTitle}>Portal Not Found</Text>
        <Text style={styles.notFoundSubtitle}>This portal link may be expired or invalid.</Text>
      </View>
    );
  }

  const passcodeRequired = !!portal.requirePasscode && !!portal.passcode;

  if (passcodeRequired && !passcodeUnlocked) {
    const verify = () => {
      if (passcodeEntry.trim() === (portal.passcode ?? '').trim()) {
        setPasscodeUnlocked(true);
        setPasscodeError(false);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setPasscodeError(true);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    };
    return (
      <View style={styles.passcodeContainer}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.passcodeCard}>
          <View style={styles.passcodeIconWrap}>
            <Lock size={32} color={Colors.primary} />
          </View>
          <Text style={styles.passcodeTitle}>Protected Portal</Text>
          <Text style={styles.passcodeSub}>{project.name}</Text>
          <Text style={styles.passcodeDesc}>
            Enter the passcode shared with you to access this project portal.
          </Text>
          <TextInput
            style={[styles.passcodeInput, passcodeError && { borderColor: Colors.error }]}
            value={passcodeEntry}
            onChangeText={(v) => { setPasscodeEntry(v); if (passcodeError) setPasscodeError(false); }}
            placeholder="Enter passcode"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={verify}
            returnKeyType="done"
          />
          {passcodeError ? (
            <Text style={styles.passcodeErrorText}>Incorrect passcode. Please try again.</Text>
          ) : null}
          <TouchableOpacity style={styles.passcodeBtn} onPress={verify} activeOpacity={0.85}>
            <Text style={styles.passcodeBtnText}>Unlock Portal</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.headerBrand}>
            <Globe size={22} color="#FFF" />
            <Text style={styles.headerBrandText}>Client Portal</Text>
          </View>
          <Text style={styles.headerProjectName}>{project.name}</Text>
          <Text style={styles.headerLocation}>{project.location}</Text>
          <Text style={styles.headerLastUpdated} testID="client-last-updated">
            Last updated {lastUpdatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: project.status === 'in_progress' ? '#34C75940' : '#FF950040' }]}>
            <Text style={[styles.statusBadgeText, { color: project.status === 'in_progress' ? '#34C759' : '#FF9500' }]}>
              {project.status === 'in_progress' ? 'In Progress' : project.status === 'completed' ? 'Completed' : 'Active'}
            </Text>
          </View>
        </View>

        {/* Welcome message */}
        {!!portal.welcomeMessage && (
          <View style={styles.welcomeCard}>
            <MessageSquare size={16} color={Colors.primary} />
            <Text style={styles.welcomeText}>{portal.welcomeMessage}</Text>
          </View>
        )}

        {/* Quick stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Schedule</Text>
            <Text style={[styles.statValue, { color: healthScore >= 80 ? '#34C759' : healthScore >= 60 ? '#FF9500' : Colors.error }]}>
              {scheduleProgress}%
            </Text>
            <Text style={styles.statSub}>complete</Text>
          </View>
          {portal.showBudgetSummary && (
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Invoiced</Text>
              <Text style={styles.statValue}>{formatMoney(invoicedTotal)}</Text>
              <Text style={styles.statSub}>of {formatMoney(revisedContract)}</Text>
            </View>
          )}
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Punch List</Text>
            <Text style={[styles.statValue, { color: punchItems.filter(p => p.status !== 'closed').length > 0 ? '#FF9500' : '#34C759' }]}>
              {punchItems.filter(p => p.status !== 'closed').length}
            </Text>
            <Text style={styles.statSub}>open items</Text>
          </View>
        </View>

        {/* Messages Section — always on, it's the main 2-way channel */}
        <View style={styles.section}>
          <SectionHeader
            title="Messages"
            icon={<MessageSquare size={18} color={Colors.primary} />}
            count={messages.length || undefined}
            expanded={expanded.messages}
            onToggle={() => toggleSection('messages')}
          />
          {expanded.messages && (
            <View style={styles.sectionBody}>
              {messages.length === 0 ? (
                <View style={styles.msgEmpty}>
                  <MessageSquare size={20} color={Colors.textMuted} />
                  <Text style={styles.msgEmptyTitle}>Ask us anything.</Text>
                  <Text style={styles.msgEmptyHint}>
                    Questions about the schedule, finishes, or anything on-site — this goes straight to your GC.
                  </Text>
                </View>
              ) : (
                <View style={styles.msgList}>
                  {messages.map(m => {
                    const mine = m.authorType === 'client';
                    return (
                      <View
                        key={m.id}
                        style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}
                      >
                        <View style={[styles.msgBubble, mine ? styles.msgBubbleMine : styles.msgBubbleTheirs]}>
                          <Text style={[styles.msgAuthor, mine && styles.msgAuthorMine]}>
                            {mine ? 'You' : m.authorName}
                          </Text>
                          <Text style={[styles.msgBody, mine && styles.msgBodyMine]}>{m.body}</Text>
                          <Text style={[styles.msgTime, mine && styles.msgTimeMine]}>
                            {new Date(m.createdAt).toLocaleString('en-US', {
                              month: 'short', day: 'numeric',
                              hour: 'numeric', minute: '2-digit',
                            })}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              <View style={styles.msgCompose}>
                <TextInput
                  style={styles.msgInput}
                  value={composeBody}
                  onChangeText={setComposeBody}
                  placeholder="Write a message…"
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  editable={!sendingMsg}
                />
                <TouchableOpacity
                  style={[styles.msgSendBtn, (!composeBody.trim() || sendingMsg) && styles.msgSendBtnDisabled]}
                  onPress={handleSendMessage}
                  disabled={!composeBody.trim() || sendingMsg}
                  activeOpacity={0.8}
                >
                  <Send size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Schedule Section */}
        {portal.showSchedule && tasks.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Project Schedule"
              icon={<CalendarDays size={18} color="#007AFF" />}
              count={tasks.length}
              expanded={expanded.schedule}
              onToggle={() => toggleSection('schedule')}
            />
            {expanded.schedule && (
              <View style={styles.sectionBody}>
                {/* Health bar */}
                <View style={styles.healthRow}>
                  <Text style={styles.healthLabel}>Schedule Health</Text>
                  <View style={styles.healthBar}>
                    <View style={[styles.healthFill, {
                      width: `${healthScore}%` as any,
                      backgroundColor: healthScore >= 80 ? '#34C759' : healthScore >= 60 ? '#FF9500' : Colors.error,
                    }]} />
                  </View>
                  <Text style={[styles.healthPct, {
                    color: healthScore >= 80 ? '#34C759' : healthScore >= 60 ? '#FF9500' : Colors.error,
                  }]}>{healthScore}%</Text>
                </View>
                {/* Tasks by phase */}
                {tasks.map(task => <TaskRow key={task.id} task={task} />)}
              </View>
            )}
          </View>
        )}

        {/* Budget Summary */}
        {portal.showBudgetSummary && (
          <View style={styles.section}>
            <SectionHeader
              title="Budget Summary"
              icon={<BarChart3 size={18} color="#34C759" />}
              expanded={expanded.budget}
              onToggle={() => toggleSection('budget')}
            />
            {expanded.budget && (
              <View style={styles.sectionBody}>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Original Contract</Text>
                  <Text style={styles.budgetValue}>{formatMoney(contractValue)}</Text>
                </View>
                {coTotal !== 0 && (
                  <View style={styles.budgetRow}>
                    <Text style={styles.budgetLabel}>Approved Change Orders</Text>
                    <Text style={[styles.budgetValue, { color: coTotal > 0 ? Colors.error : '#34C759' }]}>
                      {coTotal > 0 ? '+' : ''}{formatMoney(coTotal)}
                    </Text>
                  </View>
                )}
                <View style={[styles.budgetRow, styles.budgetRowTotal]}>
                  <Text style={styles.budgetLabelTotal}>Revised Contract</Text>
                  <Text style={styles.budgetValueTotal}>{formatMoney(revisedContract)}</Text>
                </View>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Total Invoiced</Text>
                  <Text style={styles.budgetValue}>{formatMoney(invoicedTotal)}</Text>
                </View>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Total Paid</Text>
                  <Text style={[styles.budgetValue, { color: '#34C759' }]}>{formatMoney(paidTotal)}</Text>
                </View>
                {/* Invoice progress bar */}
                <View style={styles.invoiceProgressRow}>
                  <View style={styles.invoiceProgressBar}>
                    <View style={[styles.invoiceProgressFill, { width: revisedContract > 0 ? `${Math.min(100, (paidTotal / revisedContract) * 100)}%` as any : '0%' }]} />
                  </View>
                  <Text style={styles.invoiceProgressPct}>
                    {revisedContract > 0 ? Math.round((paidTotal / revisedContract) * 100) : 0}% paid
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Invoices */}
        {portal.showInvoices && invoices.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Invoices"
              icon={<DollarSign size={18} color="#FF9500" />}
              count={invoices.length}
              expanded={expanded.invoices}
              onToggle={() => toggleSection('invoices')}
            />
            {expanded.invoices && (
              <View style={styles.sectionBody}>
                {invoices.map(inv => {
                  const statusColor = inv.status === 'paid' ? '#34C759' : inv.status === 'overdue' ? Colors.error : '#FF9500';
                  return (
                    <View key={inv.id} style={styles.listRow}>
                      <View style={styles.listRowLeft}>
                        <Text style={styles.listRowTitle}>Invoice #{inv.number}</Text>
                        <Text style={styles.listRowMeta}>Due {new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                      </View>
                      <View style={styles.listRowRight}>
                        <Text style={styles.listRowAmount}>{formatMoney(inv.totalDue)}</Text>
                        <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                          <Text style={[styles.listStatusText, { color: statusColor }]}>
                            {inv.status === 'paid' ? 'Paid' : inv.status === 'overdue' ? 'Overdue' : inv.status === 'partially_paid' ? 'Partial' : 'Sent'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Change Orders */}
        {portal.showChangeOrders && changeOrders.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Change Orders"
              icon={<FileText size={18} color="#FF3B30" />}
              count={changeOrders.length}
              expanded={expanded.changeOrders}
              onToggle={() => toggleSection('changeOrders')}
            />
            {expanded.changeOrders && (
              <View style={styles.sectionBody}>
                {changeOrders.map(co => {
                  const statusColor = co.status === 'approved' ? '#34C759' : co.status === 'rejected' ? Colors.error : '#FF9500';
                  const awaitingClient = co.status === 'submitted' || co.status === 'under_review' || co.status === 'revised';
                  return (
                    <View key={co.id} style={styles.coCard}>
                      <View style={styles.listRow}>
                        <View style={styles.listRowLeft}>
                          <Text style={styles.listRowTitle}>CO #{co.number} — {co.description}</Text>
                          <Text style={styles.listRowMeta}>{new Date(co.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                        </View>
                        <View style={styles.listRowRight}>
                          <Text style={[styles.listRowAmount, { color: co.changeAmount > 0 ? Colors.error : '#34C759' }]}>
                            {co.changeAmount > 0 ? '+' : ''}{formatMoney(co.changeAmount)}
                          </Text>
                          <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                            <Text style={[styles.listStatusText, { color: statusColor }]}>
                              {co.status.charAt(0).toUpperCase() + co.status.slice(1).replace('_', ' ')}
                            </Text>
                          </View>
                        </View>
                      </View>
                      {awaitingClient && (
                        <View style={styles.coActions}>
                          <TouchableOpacity
                            style={[styles.coActionBtn, styles.coActionReject]}
                            onPress={() => openApprovalFlow(co, 'reject')}
                            activeOpacity={0.85}
                          >
                            <ThumbsDown size={14} color={Colors.error} />
                            <Text style={[styles.coActionText, { color: Colors.error }]}>Reject</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.coActionBtn, styles.coActionApprove]}
                            onPress={() => openApprovalFlow(co, 'approve')}
                            activeOpacity={0.85}
                          >
                            <FileSignature size={14} color="#FFF" />
                            <Text style={[styles.coActionText, { color: '#FFF' }]}>Sign & Approve</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {co.status === 'approved' && co.approvers?.some(a => a.role === 'Client' && a.status === 'approved') && (
                        <View style={styles.coSignedBanner}>
                          <ShieldCheck size={12} color="#34C759" />
                          <Text style={styles.coSignedBannerText}>
                            Approved by {co.approvers.find(a => a.role === 'Client' && a.status === 'approved')?.name} on{' '}
                            {new Date(co.approvers.find(a => a.role === 'Client' && a.status === 'approved')?.responseDate ?? co.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Site Photos */}
        {portal.showPhotos && photos.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Site Photos"
              icon={<ImageIcon size={18} color="#5856D6" />}
              count={photos.length}
              expanded={expanded.photos}
              onToggle={() => toggleSection('photos')}
            />
            {expanded.photos && (
              <View style={styles.photoGrid}>
                {photos.slice(0, 9).map(photo => (
                  <View key={photo.id} style={styles.photoThumb}>
                    <Image source={{ uri: photo.uri }} style={styles.photoImg} resizeMode="cover" />
                    {photo.tag && (
                      <View style={styles.photoTag}><Text style={styles.photoTagText}>{photo.tag}</Text></View>
                    )}
                  </View>
                ))}
                {photos.length > 9 && (
                  <View style={[styles.photoThumb, styles.photoMoreOverlay]}>
                    <Text style={styles.photoMoreText}>+{photos.length - 9}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Daily Reports */}
        {portal.showDailyReports && dailyReports.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Daily Reports"
              icon={<ClipboardList size={18} color="#32ADE6" />}
              count={dailyReports.length}
              expanded={expanded.dailyReports}
              onToggle={() => toggleSection('dailyReports')}
            />
            {expanded.dailyReports && (
              <View style={styles.sectionBody}>
                {dailyReports.slice(0, 5).map(report => (
                  <View key={report.id} style={styles.listRow}>
                    <View style={styles.listRowLeft}>
                      <Text style={styles.listRowTitle}>{new Date(report.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
                      <Text style={styles.listRowMeta} numberOfLines={2}>{report.workPerformed || 'No summary provided'}</Text>
                    </View>
                    <View style={styles.listRowRight}>
                      <Text style={styles.listRowAmount}>{report.weather.conditions}</Text>
                      <Text style={styles.listStatusText}>{report.weather.temperature}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Punch List */}
        {portal.showPunchList && punchItems.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Punch List"
              icon={<CheckCircle2 size={18} color="#34C759" />}
              count={punchItems.filter(p => p.status !== 'closed').length}
              expanded={expanded.punchList}
              onToggle={() => toggleSection('punchList')}
            />
            {expanded.punchList && (
              <View style={styles.sectionBody}>
                {punchItems.map(item => {
                  const statusColor = item.status === 'closed' ? '#34C759' : item.status === 'in_progress' ? '#007AFF' : '#FF9500';
                  return (
                    <View key={item.id} style={styles.listRow}>
                      <View style={styles.listRowLeft}>
                        <Text style={styles.listRowTitle} numberOfLines={1}>{item.description}</Text>
                        <Text style={styles.listRowMeta}>{item.location} · {item.assignedSub}</Text>
                      </View>
                      <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                        <Text style={[styles.listStatusText, { color: statusColor }]}>
                          {item.status === 'closed' ? 'Closed' : item.status === 'in_progress' ? 'In Progress' : 'Open'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* RFIs */}
        {portal.showRFIs && rfis.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="RFIs"
              icon={<MessageSquare size={18} color="#FF9500" />}
              count={rfis.filter(r => r.status === 'open').length}
              expanded={expanded.rfis}
              onToggle={() => toggleSection('rfis')}
            />
            {expanded.rfis && (
              <View style={styles.sectionBody}>
                {rfis.map(rfi => {
                  const statusColor = rfi.status === 'answered' ? '#34C759' : rfi.status === 'closed' ? Colors.textMuted : '#FF9500';
                  return (
                    <View key={rfi.id} style={styles.listRow}>
                      <View style={styles.listRowLeft}>
                        <Text style={styles.listRowTitle} numberOfLines={1}>RFI #{rfi.number} — {rfi.subject}</Text>
                        <Text style={styles.listRowMeta}>Due {new Date(rfi.dateRequired).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                      </View>
                      <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                        <Text style={[styles.listStatusText, { color: statusColor }]}>
                          {rfi.status.charAt(0).toUpperCase() + rfi.status.slice(1)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Documents */}
        {portal.showDocuments && (
          <View style={styles.section}>
            <SectionHeader
              title="Documents"
              icon={<FileText size={18} color="#8E8E93" />}
              count={documents.length}
              expanded={expanded.documents}
              onToggle={() => toggleSection('documents')}
            />
            {expanded.documents && (
              <View style={styles.sectionBody}>
                {documents.length === 0 ? (
                  <View style={styles.emptyDocs}>
                    <FileText size={20} color={Colors.textMuted} />
                    <Text style={styles.emptyDocsText}>No documents shared yet.</Text>
                    <Text style={styles.emptyDocsHint}>Contracts, lien waivers, permits, and COIs will appear here.</Text>
                  </View>
                ) : (
                  documents.map(doc => {
                    const typeInfo = DOCUMENT_TYPE_INFO[doc.type] ?? { label: doc.type, color: Colors.textMuted, bgColor: Colors.surfaceAlt };
                    const statusColor = doc.status === 'signed' ? '#34C759' : doc.status === 'expired' ? Colors.error : doc.status === 'pending_signature' ? '#FF9500' : Colors.textMuted;
                    return (
                      <View key={doc.id} style={styles.listRow}>
                        <View style={styles.listRowLeft}>
                          <Text style={styles.listRowTitle} numberOfLines={1}>{doc.title}</Text>
                          <Text style={styles.listRowMeta}>
                            {typeInfo.label}
                            {doc.signedAt ? ` · Signed ${new Date(doc.signedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                            {doc.expiresAt ? ` · Exp ${new Date(doc.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                          </Text>
                        </View>
                        <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                          <Text style={[styles.listStatusText, { color: statusColor }]}>
                            {doc.status === 'pending_signature' ? 'Pending' : doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
                          </Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Globe size={14} color={Colors.textMuted} />
          <Text style={styles.footerText}>Powered by MAGE ID · Secure client portal</Text>
        </View>
      </ScrollView>

      {/* CO Digital Approval Modal */}
      <Modal
        visible={!!approvalCO}
        transparent
        animationType="slide"
        onRequestClose={closeApprovalFlow}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {approvalMode === 'approve' ? 'Sign & Approve' : 'Reject Change Order'}
              </Text>
              <TouchableOpacity onPress={closeApprovalFlow} style={styles.modalClose}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {approvalCO && (
                <View style={styles.modalSummary}>
                  <Text style={styles.modalSummaryLabel}>Change Order #{approvalCO.number}</Text>
                  <Text style={styles.modalSummaryTitle}>{approvalCO.description}</Text>
                  <View style={styles.modalSummaryRow}>
                    <Text style={styles.modalSummaryKey}>Change Amount</Text>
                    <Text style={[styles.modalSummaryVal, { color: approvalCO.changeAmount > 0 ? Colors.error : '#34C759' }]}>
                      {approvalCO.changeAmount > 0 ? '+' : ''}{formatMoney(approvalCO.changeAmount)}
                    </Text>
                  </View>
                  <View style={styles.modalSummaryRow}>
                    <Text style={styles.modalSummaryKey}>New Contract Total</Text>
                    <Text style={styles.modalSummaryVal}>{formatMoney(approvalCO.newContractTotal)}</Text>
                  </View>
                  {!!approvalCO.reason && (
                    <Text style={styles.modalSummaryReason}>{approvalCO.reason}</Text>
                  )}
                </View>
              )}

              <Text style={styles.modalFieldLabel}>Your Name</Text>
              <TextInput
                style={styles.modalInput}
                value={approverName}
                onChangeText={setApproverName}
                placeholder="Full legal name as on contract"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="words"
              />

              {approvalMode === 'approve' ? (
                <>
                  <Text style={styles.modalFieldLabel}>Signature</Text>
                  <Text style={styles.modalFieldHint}>
                    By signing below, you authorize this change order and agree to the adjusted contract total.
                  </Text>
                  <View style={styles.signatureWrap}>
                    <SignaturePad
                      width={300}
                      height={150}
                      onSave={(paths) => setSignaturePaths(paths)}
                      onClear={() => setSignaturePaths([])}
                    />
                  </View>
                  {signaturePaths.length > 0 && (
                    <View style={styles.signatureConfirm}>
                      <Check size={14} color="#34C759" />
                      <Text style={styles.signatureConfirmText}>Signature captured</Text>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.modalFieldLabel}>Reason for Rejection</Text>
                  <TextInput
                    style={[styles.modalInput, { minHeight: 100, textAlignVertical: 'top' }]}
                    value={rejectionReason}
                    onChangeText={setRejectionReason}
                    placeholder="Briefly explain what needs to change before you can approve…"
                    placeholderTextColor={Colors.textMuted}
                    multiline
                  />
                </>
              )}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={closeApprovalFlow} activeOpacity={0.85}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSubmitBtn,
                  approvalMode === 'reject' && { backgroundColor: Colors.error },
                  submittingApproval && { opacity: 0.6 },
                ]}
                onPress={submitApproval}
                activeOpacity={0.85}
                disabled={submittingApproval}
              >
                {approvalMode === 'approve'
                  ? <FileSignature size={15} color="#FFF" />
                  : <ThumbsDown size={15} color="#FFF" />
                }
                <Text style={styles.modalSubmitText}>
                  {approvalMode === 'approve' ? 'Approve & Sign' : 'Submit Rejection'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const PHOTO_SIZE = (SCREEN_WIDTH - 32 - 8) / 3;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  notFoundContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  notFoundTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  notFoundSubtitle: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },

  passcodeContainer: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  passcodeCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 28, width: '100%', maxWidth: 380, alignItems: 'center', borderWidth: 1, borderColor: Colors.cardBorder, gap: 10 },
  passcodeIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  passcodeTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  passcodeSub: { fontSize: 14, color: Colors.primary, fontWeight: '600' },
  passcodeDesc: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  passcodeInput: { width: '100%', minHeight: 50, borderRadius: 12, backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.cardBorder, paddingHorizontal: 14, fontSize: 16, color: Colors.text, marginTop: 12, textAlign: 'center', letterSpacing: 2 },
  passcodeErrorText: { fontSize: 12, color: Colors.error, marginTop: 4 },
  passcodeBtn: { width: '100%', minHeight: 50, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  passcodeBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },

  header: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingBottom: 24,
    alignItems: 'flex-start',
  },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, opacity: 0.8 },
  headerBrandText: { fontSize: 12, fontWeight: '600', color: '#FFF', letterSpacing: 1 },
  headerProjectName: { fontSize: 24, fontWeight: '800', color: '#FFF', marginBottom: 4 },
  headerLocation: { fontSize: 13, color: '#FFFFFF99', marginBottom: 4 },
  headerLastUpdated: { fontSize: 11, color: '#FFFFFF80', marginBottom: 12, fontStyle: 'italic' as const },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },

  welcomeCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    margin: 16, backgroundColor: Colors.primary + '10',
    borderRadius: 12, padding: 14,
    borderLeftWidth: 3, borderLeftColor: Colors.primary,
  },
  welcomeText: { flex: 1, fontSize: 14, color: Colors.text, lineHeight: 20 },

  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  statCard: {
    flex: 1, backgroundColor: Colors.card,
    borderRadius: 12, padding: 12, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  statLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '800', color: Colors.text },
  statSub: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },

  section: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1 },
  badge: { backgroundColor: Colors.primary + '20', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', color: Colors.primary },

  sectionBody: { padding: 12, gap: 8 },

  // Health bar
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  healthLabel: { fontSize: 12, color: Colors.textMuted, width: 100 },
  healthBar: { flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  healthFill: { height: '100%', borderRadius: 3 },
  healthPct: { fontSize: 12, fontWeight: '700', width: 34, textAlign: 'right' },

  // Task rows
  taskRow: { flexDirection: 'row', backgroundColor: Colors.background, borderRadius: 8, overflow: 'hidden', marginBottom: 4 },
  taskPhaseBar: { width: 3 },
  taskContent: { flex: 1, padding: 10 },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  taskTitle: { fontSize: 13, fontWeight: '600', color: Colors.text, flex: 1 },
  taskMeta: { fontSize: 11, color: Colors.textMuted, marginBottom: 6 },
  taskProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskProgressBar: { flex: 1, height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  taskProgressFill: { height: '100%', borderRadius: 2 },
  taskProgressPct: { fontSize: 11, fontWeight: '600', width: 28, textAlign: 'right' },
  taskStatusBadge: { margin: 10, alignSelf: 'center', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  taskStatusText: { fontSize: 10, fontWeight: '700' },

  // Budget
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  budgetRowTotal: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 4, paddingTop: 10 },
  budgetLabel: { fontSize: 13, color: Colors.textMuted },
  budgetValue: { fontSize: 14, fontWeight: '600', color: Colors.text },
  budgetLabelTotal: { fontSize: 14, fontWeight: '700', color: Colors.text },
  budgetValueTotal: { fontSize: 16, fontWeight: '800', color: Colors.text },
  invoiceProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  invoiceProgressBar: { flex: 1, height: 8, backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden' },
  invoiceProgressFill: { height: '100%', backgroundColor: '#34C759', borderRadius: 4 },
  invoiceProgressPct: { fontSize: 12, fontWeight: '600', color: Colors.textMuted },

  // List rows (invoices, COs, RFIs, punch)
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.background, borderRadius: 8, padding: 10, marginBottom: 4 },
  listRowLeft: { flex: 1, marginRight: 10 },
  listRowTitle: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 2 },
  listRowMeta: { fontSize: 11, color: Colors.textMuted },
  listRowRight: { alignItems: 'flex-end', gap: 4 },
  listRowAmount: { fontSize: 14, fontWeight: '700', color: Colors.text },
  listStatusBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  listStatusText: { fontSize: 10, fontWeight: '700', color: Colors.textMuted },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 4 },
  photoThumb: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 8, overflow: 'hidden', backgroundColor: Colors.border },
  photoImg: { width: '100%', height: '100%' },
  photoTag: { position: 'absolute', bottom: 4, left: 4, backgroundColor: '#00000080', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  photoTagText: { fontSize: 9, color: '#FFF', fontWeight: '600' },
  photoMoreOverlay: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000060' },
  photoMoreText: { fontSize: 20, fontWeight: '800', color: '#FFF' },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
  footerText: { fontSize: 12, color: Colors.textMuted },

  // Change order card (wrapper for row + actions)
  coCard: { backgroundColor: Colors.background, borderRadius: 8, marginBottom: 6, overflow: 'hidden' },
  coActions: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingBottom: 10,
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10,
  },
  coActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: 8,
  },
  coActionApprove: { backgroundColor: '#34C759' },
  coActionReject: { backgroundColor: Colors.error + '15', borderWidth: 1, borderColor: Colors.error + '40' },
  coActionText: { fontSize: 13, fontWeight: '700' },
  coSignedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#34C75915', paddingHorizontal: 10, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: '#34C75920',
  },
  coSignedBannerText: { fontSize: 11, fontWeight: '600', color: '#2E7D32', flex: 1 },

  // Empty documents state
  emptyDocs: { alignItems: 'center', padding: 20, gap: 6 },
  emptyDocsText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  emptyDocsHint: { fontSize: 11, color: Colors.textMuted, textAlign: 'center' },

  // Messages (Q&A thread)
  msgEmpty: { alignItems: 'center', padding: 18, gap: 6 },
  msgEmptyTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  msgEmptyHint: { fontSize: 12, color: Colors.textMuted, textAlign: 'center', lineHeight: 17, paddingHorizontal: 10 },
  msgList: { gap: 8, paddingBottom: 12 },
  msgRow: { flexDirection: 'row' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },
  msgBubble: {
    maxWidth: '84%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  msgBubbleMine: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  msgBubbleTheirs: { backgroundColor: Colors.surfaceAlt, borderBottomLeftRadius: 4 },
  msgAuthor: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, marginBottom: 2 },
  msgAuthorMine: { color: 'rgba(255,255,255,0.85)' },
  msgBody: { fontSize: 14, color: Colors.text, lineHeight: 19 },
  msgBodyMine: { color: '#fff' },
  msgTime: { fontSize: 10, color: Colors.textMuted, marginTop: 4 },
  msgTimeMine: { color: 'rgba(255,255,255,0.7)' },
  msgCompose: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border,
  },
  msgInput: {
    flex: 1, minHeight: 40, maxHeight: 120,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: Colors.text, backgroundColor: Colors.surface,
  },
  msgSendBtn: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  msgSendBtnDisabled: { opacity: 0.5 },

  // Approval modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '90%', paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  modalClose: { padding: 4 },
  modalBody: { paddingHorizontal: 20, paddingTop: 14 },
  modalSummary: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 16,
  },
  modalSummaryLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', marginBottom: 4, letterSpacing: 0.5 },
  modalSummaryTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  modalSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  modalSummaryKey: { fontSize: 13, color: Colors.textMuted },
  modalSummaryVal: { fontSize: 14, fontWeight: '700', color: Colors.text },
  modalSummaryReason: { fontSize: 12, color: Colors.textMuted, marginTop: 8, fontStyle: 'italic', lineHeight: 17 },
  modalFieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 6, marginTop: 4 },
  modalFieldHint: { fontSize: 11, color: Colors.textMuted, marginBottom: 10, lineHeight: 16 },
  modalInput: {
    backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text, marginBottom: 14,
  },
  signatureWrap: { alignItems: 'center', marginBottom: 10 },
  signatureConfirm: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginBottom: 14 },
  signatureConfirmText: { fontSize: 12, fontWeight: '600', color: '#34C759' },
  modalActions: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  modalCancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: Colors.text },
  modalSubmitBtn: {
    flex: 2, flexDirection: 'row', gap: 8, paddingVertical: 13, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#34C759',
  },
  modalSubmitText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
});

```


---

### `app/messages.tsx`

```tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform,
  Animated,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Send, ChevronDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useHire } from '@/contexts/HireContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import type { ChatMessage } from '@/types';

export default function MessagesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { conversations, getConversationMessages, sendMessage } = useHire();
  const { user } = useAuth();
  const { clearBadge } = useNotifications();
  const [text, setText] = useState('');
  const [isAtBottom, setIsAtBottom] = useState(true);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const prevMessageCount = useRef(0);
  const scrollIndicatorAnim = useRef(new Animated.Value(0)).current;

  const conversation = conversations.find(c => c.id === id);
  const messages = getConversationMessages(id ?? '');
  const senderId = user?.id ?? 'you';
  const senderName = user?.name ?? 'You';

  useEffect(() => {
    void clearBadge();
  }, [clearBadge]);

  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      if (isAtBottom) {
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      } else {
        Animated.sequence([
          Animated.timing(scrollIndicatorAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.delay(3000),
          Animated.timing(scrollIndicatorAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start();
      }
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, isAtBottom, scrollIndicatorAnim]);

  const handleSend = useCallback(() => {
    if (!text.trim() || !id) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMessage(id, senderId, senderName, text.trim());
    setText('');
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 150);
  }, [text, id, sendMessage, senderId, senderName]);

  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    setIsAtBottom(distFromBottom < 50);
  }, []);

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  const otherName = conversation?.participantNames.find((_, i) => i > 0) ?? 'Chat';

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isMe = item.senderId === senderId;
    return (
      <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage]}>
        {!isMe && <Text style={styles.senderName}>{item.senderName}</Text>}
        <Text style={[styles.messageText, isMe && styles.myMessageText]}>{item.text}</Text>
        <Text style={[styles.timestamp, isMe && styles.myTimestamp]}>
          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  }, [senderId]);

  const onlineIndicator = (
    <View style={styles.headerRight}>
      <View style={styles.onlineDot} />
      <Text style={styles.onlineText}>Online</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: otherName,
        headerStyle: { backgroundColor: Colors.surface },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        headerRight: () => onlineIndicator,
      }} />
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Start the conversation</Text>
            </View>
          }
        />

        {!isAtBottom && (
          <Animated.View style={[styles.scrollToBottomBtn, { opacity: scrollIndicatorAnim }]}>
            <TouchableOpacity onPress={scrollToBottom} style={styles.scrollBtnInner}>
              <ChevronDown size={18} color={Colors.primary} />
              <Text style={styles.scrollBtnText}>New messages</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={1000}
            testID="message-input"
          />
          <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim()}
            testID="send-button"
          >
            <Send size={18} color={text.trim() ? '#FFF' : Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  kav: { flex: 1 },
  messageList: { padding: 16, paddingBottom: 8 },
  messageBubble: { maxWidth: '80%' as unknown as number, marginBottom: 8, padding: 12, borderRadius: 16 },
  myMessage: { alignSelf: 'flex-end' as const, backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  theirMessage: { alignSelf: 'flex-start' as const, backgroundColor: Colors.surface, borderBottomLeftRadius: 4 },
  senderName: { fontSize: 11, fontWeight: '600' as const, color: Colors.primary, marginBottom: 2 },
  messageText: { fontSize: 15, color: Colors.text, lineHeight: 20 },
  myMessageText: { color: '#FFF' },
  timestamp: { fontSize: 10, color: Colors.textMuted, marginTop: 4, alignSelf: 'flex-end' as const },
  myTimestamp: { color: 'rgba(255,255,255,0.7)' },
  emptyContainer: { flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const, paddingTop: 100 },
  emptyText: { fontSize: 15, color: Colors.textMuted },
  inputBar: {
    flexDirection: 'row' as const, alignItems: 'flex-end' as const, padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12, backgroundColor: Colors.surface,
    borderTopWidth: 0.5, borderTopColor: Colors.borderLight, gap: 8,
  },
  textInput: {
    flex: 1, backgroundColor: Colors.background, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: Colors.text, maxHeight: 100,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const },
  sendBtnDisabled: { backgroundColor: Colors.background },
  headerRight: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginRight: 4 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759' },
  onlineText: { fontSize: 12, color: Colors.textMuted },
  scrollToBottomBtn: {
    position: 'absolute' as const, bottom: 80, alignSelf: 'center' as const,
    backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4,
    elevation: 4, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
  },
  scrollBtnInner: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  scrollBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' as const },
});

```


---

### `utils/portalSnapshot.ts`

```ts
// Portal snapshot builder
//
// Takes a project + its portal settings and produces a compact JSON payload
// honoring the GC's visibility toggles. The payload is base64url-encoded and
// stuffed into the URL hash fragment of the shareable portal link, so the
// HTML page at mageid.app/portal/<id>#d=<base64> can decode and render it
// without any backend round-trip. The hash never leaves the client's browser,
// so the snapshot stays private between GC and whoever has the link.

import type {
  Project, AppSettings, ClientPortalSettings, Invoice, ChangeOrder,
  DailyFieldReport, PunchItem, ProjectPhoto, RFI, ClientPortalInvite,
} from '@/types';

export const PORTAL_SNAPSHOT_VERSION = 1;

export interface PortalSnapshot {
  v: number;
  snapshotAt: string;
  requirePasscode?: boolean;
  passcode?: string;
  welcomeMessage?: string;
  clientName?: string;
  company: {
    name: string;
    primaryColor?: string;
  };
  project: {
    id: string;
    name: string;
    type?: string;
    address?: string;
    status?: string;
  };
  sections: {
    schedule?: { tasks: Array<{
      id: string; title: string; phase?: string; progress: number;
      status: string; durationDays: number; isMilestone?: boolean; isCriticalPath?: boolean;
    }> };
    budget?: {
      contractValue: number; paidToDate: number; outstanding: number;
      pctComplete: number; nextMilestone?: string;
    };
    invoices?: Array<{
      id: string; number: number | string; total: number; status: string;
      dueDate?: string; dateSubmitted?: string;
      // Remaining balance for the invoice (totalDue - amountPaid). Portal uses
      // this to decide whether to show a "Pay Now" button and for how much.
      balance?: number;
      // If the GC has generated a Stripe payment link for this invoice, the
      // portal surfaces a one-tap "Pay Now" button that opens it.
      payLinkUrl?: string;
    }>;
    changeOrders?: Array<{
      id: string; number: number | string; description: string;
      changeAmount: number; status: string; dateSubmitted?: string;
    }>;
    photos?: Array<{ url: string; caption?: string; timestamp?: string }>;
    dailyReports?: Array<{
      id: string; date: string; weather?: string;
      totalManpower?: number; totalManHours?: number;
      workPerformed?: string;
    }>;
    punchList?: Array<{
      id: string; title: string; status: string;
      priority?: string; location?: string;
    }>;
    rfis?: Array<{
      id: string; number: number | string; subject: string;
      status: string; dateSubmitted?: string;
    }>;
    documents?: Array<{ name: string; type?: string; dateSent?: string }>;
  };
}

interface BuildOpts {
  project: Project;
  portal: ClientPortalSettings;
  settings?: AppSettings;
  invoices?: Invoice[];
  changeOrders?: ChangeOrder[];
  dailyReports?: DailyFieldReport[];
  punchItems?: PunchItem[];
  photos?: ProjectPhoto[];
  rfis?: RFI[];
  invite?: ClientPortalInvite;
  maxPhotos?: number;       // cap to keep URL manageable (default 24)
  maxDailyReports?: number; // default 10
}

export function buildPortalSnapshot(opts: BuildOpts): PortalSnapshot {
  const {
    project, portal, settings, invoices = [], changeOrders = [],
    dailyReports = [], punchItems = [], photos = [], rfis = [], invite,
    maxPhotos = 24, maxDailyReports = 10,
  } = opts;

  const sections: PortalSnapshot['sections'] = {};

  // Schedule
  if (portal.showSchedule && project.schedule?.tasks?.length) {
    sections.schedule = {
      tasks: project.schedule.tasks.map(t => ({
        id: t.id,
        title: t.title,
        phase: t.phase,
        progress: t.progress ?? 0,
        status: t.status,
        durationDays: t.durationDays ?? 0,
        isMilestone: t.isMilestone,
        isCriticalPath: t.isCriticalPath,
      })),
    };
  }

  // Budget summary — derived from project estimate + approved COs + invoices
  if (portal.showBudgetSummary) {
    const baseContract = project.estimate?.grandTotal ?? 0;
    const coTotal = changeOrders
      .filter(c => c.status === 'approved')
      .reduce((sum, c) => sum + (c.changeAmount ?? 0), 0);
    const contractValue = baseContract + coTotal;
    const paidToDate = invoices.reduce(
      (sum, i) => sum + (i.amountPaid ?? 0),
      0,
    );
    const outstanding = Math.max(0, contractValue - paidToDate);
    const pctComplete = contractValue > 0
      ? Math.round((paidToDate / contractValue) * 100)
      : 0;
    sections.budget = {
      contractValue,
      paidToDate,
      outstanding,
      pctComplete,
    };
  }

  // Invoices
  if (portal.showInvoices && invoices.length) {
    sections.invoices = invoices.map(i => {
      const total = i.totalDue ?? 0;
      const balance = Math.max(0, total - (i.amountPaid ?? 0));
      return {
        id: i.id,
        number: i.number,
        total,
        status: i.status,
        dueDate: i.dueDate,
        dateSubmitted: i.issueDate,
        balance,
        payLinkUrl: i.payLinkUrl,
      };
    });
  }

  // Change Orders
  if (portal.showChangeOrders && changeOrders.length) {
    sections.changeOrders = changeOrders.map(c => ({
      id: c.id,
      number: c.number,
      description: c.description ?? c.reason ?? '',
      changeAmount: c.changeAmount ?? 0,
      status: c.status,
      dateSubmitted: c.date,
    }));
  }

  // Photos (limit to prevent URL bloat — newest first)
  if (portal.showPhotos && photos.length) {
    const sorted = [...photos].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });
    sections.photos = sorted.slice(0, maxPhotos).map(p => ({
      url: p.uri ?? '',
      caption: p.tag ?? p.location,
      timestamp: p.timestamp,
    })).filter(p => p.url);
  }

  // Daily Reports (limit — most recent first)
  if (portal.showDailyReports && dailyReports.length) {
    const sorted = [...dailyReports].sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });
    sections.dailyReports = sorted.slice(0, maxDailyReports).map(d => {
      const totalManHours = (d.manpower ?? []).reduce(
        (s, m) => s + ((m.hoursWorked ?? 0) * (m.headcount ?? 1)),
        0,
      );
      const totalManpower = (d.manpower ?? []).reduce(
        (s, m) => s + (m.headcount ?? 0),
        0,
      );
      const weather = d.weather
        ? `${d.weather.conditions ?? ''} ${d.weather.temperature ?? ''}`.trim() || undefined
        : undefined;
      return {
        id: d.id,
        date: d.date,
        weather,
        totalManpower,
        totalManHours,
        workPerformed: d.workPerformed,
      };
    });
  }

  // Punch List (only open / in-progress items are useful to clients)
  if (portal.showPunchList && punchItems.length) {
    sections.punchList = punchItems.map(p => ({
      id: p.id,
      title: p.description,
      status: p.status,
      priority: p.priority,
      location: p.location,
    }));
  }

  // RFIs
  if (portal.showRFIs && rfis.length) {
    sections.rfis = rfis.map(r => ({
      id: r.id,
      number: r.number,
      subject: r.subject ?? r.question ?? '',
      status: r.status,
      dateSubmitted: r.dateSubmitted,
    }));
  }

  // Documents — stub for now; wire up when documents model is finalized
  if (portal.showDocuments) {
    sections.documents = [];
  }

  return {
    v: PORTAL_SNAPSHOT_VERSION,
    snapshotAt: new Date().toISOString(),
    requirePasscode: portal.requirePasscode,
    passcode: portal.requirePasscode ? portal.passcode : undefined,
    welcomeMessage: portal.welcomeMessage,
    clientName: invite?.name,
    company: {
      name: settings?.branding?.companyName ?? 'MAGE ID',
      primaryColor: settings?.themeColors?.primary,
    },
    project: {
      id: project.id,
      name: project.name,
      type: project.type,
      address: project.location,
      status: project.status,
    },
    sections,
  };
}

// Base64-url encode a UTF-8 JSON string safely across web + RN Hermes.
function encodeBase64Url(input: string): string {
  // btoa needs Latin-1; encode via URI escape trick so non-ASCII survives.
  const b64 = typeof btoa !== 'undefined'
    ? btoa(unescape(encodeURIComponent(input)))
    : // RN fallback — Hermes supports btoa since 0.72 but be defensive
      globalThis.Buffer
        ? (globalThis as any).Buffer.from(input, 'utf-8').toString('base64')
        : '';
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildPortalUrl(
  baseUrl: string,
  portalId: string,
  snapshot: PortalSnapshot,
  inviteId?: string,
): string {
  const json = JSON.stringify(snapshot);
  const encoded = encodeBase64Url(json);
  const base = `${baseUrl}/${portalId}`;
  const query = inviteId ? `?inviteId=${encodeURIComponent(inviteId)}` : '';
  return `${base}${query}#d=${encoded}`;
}

// Rough sanity check — URL fragments over ~8KB start to make SMS clients unhappy.
// Return size in KB of the encoded payload to let the UI show a warning.
export function estimateSnapshotSizeKb(snapshot: PortalSnapshot): number {
  const json = JSON.stringify(snapshot);
  return Math.ceil(new Blob([json]).size / 1024);
}

```


---

### `utils/weeklyClientUpdate.ts`

```ts
import type {
  Project, Invoice, ChangeOrder, DailyFieldReport, PunchItem, ProjectPhoto, RFI,
} from '@/types';
import { mageAI } from './mageAI';

// ──────────────────────────────────────────────────────────────────────────────
// AI-drafted weekly owner update.
// The GC pushes one button → Gemini drafts a friendly, plain-English email
// summarizing the last 7 days. The GC edits, then sends via native mail.
// This is the recurring touchpoint competitors charge hundreds/month for.
// ──────────────────────────────────────────────────────────────────────────────

export interface WeeklyUpdateContext {
  project: Project;
  dailyReports: DailyFieldReport[];      // last 7 days
  photos: ProjectPhoto[];                // last 7 days
  changeOrders: ChangeOrder[];           // last 7 days' activity
  invoices: Invoice[];                   // any invoice changed in last 7 days
  punchItems: PunchItem[];               // currently open
  rfis: RFI[];                           // open RFIs
  weekEndingISO: string;                 // ISO date the week ends
}

export interface WeeklyUpdateDraft {
  subject: string;
  greeting: string;        // "Hi Sarah,"
  summary: string;         // 2-3 sentence top-line
  accomplishments: string[];  // bullets of what got done
  upcoming: string[];      // bullets of what's next
  issues: string[];        // concerns / delays / weather, can be empty
  financial: string;       // one-paragraph money summary
  closing: string;         // "Let me know if you have questions."
  signatureName: string;
}

// Narrow the raw data down to what fits in a prompt.
function compressContext(ctx: WeeklyUpdateContext, gcName: string, ownerName: string) {
  const dfrSummary = ctx.dailyReports.slice(0, 7).map(d => {
    const manpower = d.manpower ?? [];
    const crewSize = manpower.reduce((s, m) => s + (m.headcount ?? 0), 0);
    const hoursWorked = manpower.reduce((s, m) => s + (m.hoursWorked ?? 0) * (m.headcount ?? 1), 0);
    return {
      date: d.date,
      weather: (d.weather as any)?.conditions ?? '',
      tempHigh: (d.weather as any)?.tempHigh ?? null,
      crewSize,
      hoursWorked,
      work: (d.workPerformed ?? '').slice(0, 280),
      issues: (d.issuesAndDelays ?? '').slice(0, 200),
    };
  });

  const coSummary = ctx.changeOrders.map(c => ({
    number: c.number,
    status: c.status,
    amount: c.changeAmount,
    description: c.description.slice(0, 140),
    scheduleDays: c.scheduleImpactDays ?? 0,
  }));

  const invSummary = ctx.invoices.map(i => ({
    number: i.number,
    status: i.status,
    totalDue: i.totalDue,
    amountPaid: i.amountPaid,
    balance: i.totalDue - i.amountPaid,
  }));

  const openPunch = ctx.punchItems.filter(p => p.status !== 'closed').length;
  const openRfis = ctx.rfis.filter(r => r.status !== 'answered' && r.status !== 'closed').length;

  return {
    projectName: ctx.project.name,
    location: ctx.project.location,
    weekEnding: ctx.weekEndingISO.slice(0, 10),
    gcName,
    ownerName,
    dailyReports: dfrSummary,
    changeOrders: coSummary,
    invoices: invSummary,
    photoCount: ctx.photos.length,
    openPunchItemCount: openPunch,
    openRFICount: openRfis,
  };
}

const DRAFT_SCHEMA_HINT = {
  subject: 'string',
  greeting: 'string',
  summary: 'string',
  accomplishments: ['string'],
  upcoming: ['string'],
  issues: ['string'],
  financial: 'string',
  closing: 'string',
  signatureName: 'string',
};

/**
 * Ask the model to draft a weekly owner update. Returns a structured draft
 * the GC can review and edit before sending.
 */
export async function draftWeeklyUpdate(
  ctx: WeeklyUpdateContext,
  gcName: string,
  ownerName: string,
): Promise<{ success: boolean; draft: WeeklyUpdateDraft | null; error?: string }> {
  const compact = compressContext(ctx, gcName, ownerName);

  const prompt = `You are drafting a warm, plain-English weekly progress update from a general contractor to their client/owner. Tone: professional but friendly, confident, no jargon. Short sentences. Do not invent facts — only reference what's in the data below.

DATA:
${JSON.stringify(compact, null, 2)}

Write a weekly update email with these sections:
- subject: concise, includes project name and week-ending date, e.g. "Weekly update — ${compact.projectName} — week of ${compact.weekEnding}"
- greeting: "Hi [first name]," using the owner name provided
- summary: 2-3 sentences, top-line "here's where we stand"
- accomplishments: 3-6 bullets, each one concrete thing completed this week, pulled from daily reports
- upcoming: 2-4 bullets, what's planned next week (infer from work cadence if not explicit)
- issues: 0-3 bullets of concerns, delays, weather impact — empty array if genuinely nothing to flag
- financial: one short paragraph on change orders approved this week, invoices issued/paid, total CO impact on contract; omit numbers if nothing changed
- closing: one friendly sentence inviting questions
- signatureName: the GC's name

Keep each bullet under 20 words. Do not hallucinate line items that aren't in the data. If a section has no real content, still include it (empty issues array is fine, but accomplishments should be non-empty).`;

  const res = await mageAI({
    prompt,
    schemaHint: DRAFT_SCHEMA_HINT,
    tier: 'smart',
    maxTokens: 2000,
  });

  if (!res.success || !res.data) {
    return { success: false, draft: null, error: res.error ?? 'AI draft failed' };
  }
  const d = res.data as WeeklyUpdateDraft;
  // Defensive shape check
  const draft: WeeklyUpdateDraft = {
    subject: String(d.subject ?? `Weekly update — ${compact.projectName}`),
    greeting: String(d.greeting ?? `Hi ${ownerName.split(' ')[0] || 'there'},`),
    summary: String(d.summary ?? ''),
    accomplishments: Array.isArray(d.accomplishments) ? d.accomplishments.map(String) : [],
    upcoming: Array.isArray(d.upcoming) ? d.upcoming.map(String) : [],
    issues: Array.isArray(d.issues) ? d.issues.map(String) : [],
    financial: String(d.financial ?? ''),
    closing: String(d.closing ?? 'Let me know if you have any questions.'),
    signatureName: String(d.signatureName ?? gcName),
  };
  return { success: true, draft };
}

/**
 * Render the structured draft back into a plain-text email body ready to send.
 */
export function renderDraftToPlainText(draft: WeeklyUpdateDraft): string {
  const lines: string[] = [];
  lines.push(draft.greeting);
  lines.push('');
  lines.push(draft.summary);
  lines.push('');
  if (draft.accomplishments.length) {
    lines.push('This week we:');
    draft.accomplishments.forEach(a => lines.push(`• ${a}`));
    lines.push('');
  }
  if (draft.upcoming.length) {
    lines.push('Coming up:');
    draft.upcoming.forEach(u => lines.push(`• ${u}`));
    lines.push('');
  }
  if (draft.issues.length) {
    lines.push('Heads up:');
    draft.issues.forEach(i => lines.push(`• ${i}`));
    lines.push('');
  }
  if (draft.financial && draft.financial.trim()) {
    lines.push(draft.financial.trim());
    lines.push('');
  }
  lines.push(draft.closing);
  lines.push('');
  lines.push('— ' + draft.signatureName);
  return lines.join('\n');
}

/**
 * Render to HTML for nicer email clients.
 */
export function renderDraftToHtml(draft: WeeklyUpdateDraft): string {
  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const section = (title: string, items: string[]) => {
    if (!items.length) return '';
    return `<p style="margin:16px 0 6px 0;font-weight:600;">${esc(title)}</p>
      <ul style="margin:0;padding-left:18px;line-height:1.5;">
        ${items.map(i => `<li>${esc(i)}</li>`).join('')}
      </ul>`;
  };

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;line-height:1.5;color:#111;">
    <p>${esc(draft.greeting)}</p>
    <p>${esc(draft.summary)}</p>
    ${section('This week we:', draft.accomplishments)}
    ${section('Coming up:', draft.upcoming)}
    ${section('Heads up:', draft.issues)}
    ${draft.financial ? `<p style="margin-top:16px;">${esc(draft.financial)}</p>` : ''}
    <p style="margin-top:20px;">${esc(draft.closing)}</p>
    <p style="margin-top:20px;">— ${esc(draft.signatureName)}</p>
  </div>`;
}

/**
 * Filter raw data down to the last N days for a single project.
 */
export function gatherWeeklyContext(
  project: Project,
  allDailyReports: DailyFieldReport[],
  allPhotos: ProjectPhoto[],
  allChangeOrders: ChangeOrder[],
  allInvoices: Invoice[],
  allPunchItems: PunchItem[],
  allRfis: RFI[],
  days: number = 7,
): WeeklyUpdateContext {
  const cutoff = Date.now() - days * 86400 * 1000;
  const since = (iso: string | undefined) => iso ? new Date(iso).getTime() >= cutoff : false;

  return {
    project,
    dailyReports: allDailyReports
      .filter(d => d.projectId === project.id && since(d.date))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    photos: allPhotos
      .filter(p => p.projectId === project.id && since(p.timestamp)),
    changeOrders: allChangeOrders
      .filter(c => c.projectId === project.id && (since(c.updatedAt) || since(c.createdAt))),
    invoices: allInvoices
      .filter(i => i.projectId === project.id && (since(i.updatedAt) || since(i.issueDate))),
    punchItems: allPunchItems
      .filter(p => p.projectId === project.id),
    rfis: allRfis
      .filter(r => r.projectId === project.id),
    weekEndingISO: new Date().toISOString(),
  };
}

```


---

### `utils/emailService.ts`

```ts
import * as MailComposer from 'expo-mail-composer';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export interface SendEmailWithAttachmentsParams extends SendEmailParams {
  attachments?: string[]; // local file URIs
  from?: string;          // override default FROM if needed
}

interface SendEmailResponse {
  success: boolean;
  id?: string;
  error?: string;
}

// Read a local file URI and return { filename, content (base64), contentType }.
// The send-email edge function expects attachments in this shape.
async function fileUriToAttachment(uri: string): Promise<{ filename: string; content: string; contentType?: string } | null> {
  try {
    const filename = decodeURIComponent(uri.split('/').pop() || 'attachment');
    const lower = filename.toLowerCase();
    const contentType =
      lower.endsWith('.pdf') ? 'application/pdf' :
      lower.endsWith('.png') ? 'image/png' :
      lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' :
      lower.endsWith('.csv') ? 'text/csv' :
      lower.endsWith('.txt') ? 'text/plain' :
      undefined;

    // On web, expo-file-system isn't available. We'd need to fetch the URI and
    // convert to base64 via FileReader — for now just skip web attachments.
    if (Platform.OS === 'web') {
      const res = await fetch(uri);
      const blob = await res.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          // Strip the "data:...;base64," prefix
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { filename, content: base64, contentType };
    }

    const content = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { filename, content, contentType };
  } catch (err) {
    console.error('[EmailService] Attachment read failed:', uri, err);
    return null;
  }
}

/**
 * The real server-side sender. Calls the `send-email` Supabase edge function,
 * which forwards to Resend using the verified mageid.app domain. Replaces the
 * old mailto: flow that bounced because it sent from the user's personal inbox.
 */
async function sendViaResend(params: SendEmailWithAttachmentsParams): Promise<SendEmailResponse> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Email service not configured (Supabase missing)' };
  }

  // Encode attachments in parallel — typical invoice is 1-2 files so this is fast.
  let attachments: Array<{ filename: string; content: string; contentType?: string }> | undefined;
  if (params.attachments && params.attachments.length > 0) {
    const encoded = await Promise.all(params.attachments.map(fileUriToAttachment));
    attachments = encoded.filter((a): a is NonNullable<typeof a> => a !== null);
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: {
        to: params.to,
        subject: params.subject,
        html: params.html,
        replyTo: params.replyTo,
        from: params.from,
        attachments,
      },
    });

    if (error) {
      console.error('[EmailService] Edge function error:', error);
      return { success: false, error: error.message || 'Failed to send email' };
    }

    const result = data as { success?: boolean; id?: string; error?: string } | null;
    if (!result?.success) {
      return { success: false, error: result?.error || 'Email send failed' };
    }
    console.log('[EmailService] Sent via Resend, id:', result.id);
    return { success: true, id: result.id };
  } catch (err) {
    console.error('[EmailService] Invoke threw:', err);
    return { success: false, error: String(err) };
  }
}

export async function sendEmailNative(params: {
  to: string;
  subject: string;
  body: string;
  isHtml?: boolean;
  attachments?: string[];
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (Platform.OS === 'web') {
      console.log('[EmailService] Native mail not available on web');
      return { success: false, error: 'not_available' };
    }

    const isAvailable = await MailComposer.isAvailableAsync();
    if (!isAvailable) {
      console.log('[EmailService] Native mail not available on this device');
      return { success: false, error: 'No email app configured on this device. Please set up an email account in your device settings.' };
    }

    const result = await MailComposer.composeAsync({
      recipients: params.to ? [params.to] : [],
      subject: params.subject,
      body: params.body,
      isHtml: params.isHtml ?? true,
      attachments: params.attachments ?? [],
    });

    if (result.status === MailComposer.MailComposerStatus.SENT) {
      console.log('[EmailService] Email sent via native mail');
      return { success: true };
    } else if (result.status === MailComposer.MailComposerStatus.CANCELLED) {
      console.log('[EmailService] User cancelled email');
      return { success: false, error: 'cancelled' };
    } else {
      console.log('[EmailService] Email status:', result.status);
      return { success: true };
    }
  } catch (err) {
    console.error('[EmailService] Native mail error:', err);
    return { success: false, error: 'Failed to open email composer' };
  }
}

/**
 * Primary email send path. Routes through the Supabase `send-email` edge
 * function, which calls Resend using the verified mageid.app domain.
 *
 * Behavior:
 *   1. Try the server-side Resend pipeline first. This is the path that
 *      actually works — emails come from noreply@mageid.app with proper
 *      DKIM signatures and land in inboxes instead of spam/bounce.
 *   2. If Resend fails (network, outage, not configured), fall back to the
 *      native mail composer so the GC isn't stranded. The composer still
 *      bounces for the "spam filter" reason but at least it puts the draft
 *      in their hand where they can verify it and send manually.
 */
export async function sendEmail(params: SendEmailWithAttachmentsParams): Promise<SendEmailResponse> {
  // Path 1: Resend via Supabase edge function (the path that actually works).
  const resendResult = await sendViaResend(params);
  if (resendResult.success) return resendResult;

  console.log('[EmailService] Resend failed, falling back to native composer:', resendResult.error);

  // Path 2: Native mail composer fallback. Only reached if Resend errors out.
  try {
    if (Platform.OS === 'web') {
      const mailtoUrl = `mailto:${encodeURIComponent(params.to)}?subject=${encodeURIComponent(params.subject)}&body=${encodeURIComponent('Please view the attached document.')}`;
      window.open(mailtoUrl, '_blank');
      return { success: true };
    }

    const isAvailable = await MailComposer.isAvailableAsync();
    if (!isAvailable) {
      return {
        success: false,
        error: resendResult.error || 'No email app configured on this device. Please set up an email account in Settings, or use the Share option instead.',
      };
    }

    const result = await MailComposer.composeAsync({
      recipients: params.to ? [params.to] : [],
      subject: params.subject,
      body: params.html,
      isHtml: true,
      attachments: params.attachments ?? [],
    });

    if (result.status === MailComposer.MailComposerStatus.CANCELLED) {
      return { success: false, error: 'cancelled' };
    }
    return { success: true };
  } catch (err) {
    console.error('[EmailService] Composer fallback failed too:', err);
    return { success: false, error: resendResult.error || 'Failed to send email' };
  }
}



export function buildInvoiceEmailHtml(opts: {
  companyName: string;
  recipientName: string;
  projectName: string;
  invoiceNumber: number;
  totalDue: number;
  dueDate: string;
  paymentTerms: string;
  message?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}): string {
  const {
    companyName, recipientName, projectName, invoiceNumber,
    totalDue, dueDate, paymentTerms, message,
    contactName, contactEmail, contactPhone,
  } = opts;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName || 'MAGE ID'}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Invoice #${invoiceNumber}</p>
          <h2 style="margin:0 0 24px;color:#111827;font-size:20px;">${projectName}</h2>
          ${recipientName ? `<p style="margin:0 0 16px;color:#374151;">Hi ${recipientName},</p>` : ''}
          ${message ? `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">${message}</p>` : ''}
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:20px 0;">
            <tr><td style="padding:20px;">
              <table width="100%">
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Amount Due</td>
                  <td align="right" style="color:#111827;font-size:18px;font-weight:700;padding:4px 0;">$${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Due Date</td>
                  <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${new Date(dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Payment Terms</td>
                  <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${paymentTerms}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
            This invoice was generated using MAGE ID.
            ${contactName ? `<br/>Contact: ${contactName}` : ''}
            ${contactEmail ? ` | ${contactEmail}` : ''}
            ${contactPhone ? ` | ${contactPhone}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildChangeOrderEmailHtml(opts: {
  companyName: string;
  recipientName: string;
  projectName: string;
  coNumber: number;
  description: string;
  changeAmount: number;
  newContractTotal: number;
  message?: string;
  contactName?: string;
  contactEmail?: string;
}): string {
  const {
    companyName, recipientName, projectName, coNumber,
    description, changeAmount, newContractTotal, message,
    contactName, contactEmail,
  } = opts;

  const amountColor = changeAmount >= 0 ? '#dc2626' : '#16a34a';
  const amountPrefix = changeAmount >= 0 ? '+' : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName || 'MAGE ID'}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Change Order #${coNumber}</p>
          <h2 style="margin:0 0 24px;color:#111827;font-size:20px;">${projectName}</h2>
          ${recipientName ? `<p style="margin:0 0 16px;color:#374151;">Hi ${recipientName},</p>` : ''}
          <p style="margin:0 0 16px;color:#374151;line-height:1.5;">A change order has been submitted for your review and approval.</p>
          ${message ? `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">${message}</p>` : ''}
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:20px 0;">
            <tr><td style="padding:20px;">
              <p style="margin:0 0 12px;color:#374151;font-size:14px;font-weight:600;">Description</p>
              <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.5;">${description}</p>
              <table width="100%">
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Change Amount</td>
                  <td align="right" style="color:${amountColor};font-size:16px;font-weight:700;padding:4px 0;">${amountPrefix}$${Math.abs(changeAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">New Contract Total</td>
                  <td align="right" style="color:#111827;font-size:16px;font-weight:700;padding:4px 0;">$${newContractTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
            This change order was generated using MAGE ID.
            ${contactName ? `<br/>Contact: ${contactName}` : ''}
            ${contactEmail ? ` | ${contactEmail}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildDailyReportEmailHtml(opts: {
  companyName: string;
  recipientName: string;
  projectName: string;
  date: string;
  weather: { condition: string; tempHigh: number; tempLow: number };
  totalManpower: number;
  totalManHours: number;
  workPerformed: string;
  issuesAndDelays: string;
  message?: string;
  contactName?: string;
  contactEmail?: string;
}): string {
  const {
    companyName, recipientName, projectName, date,
    weather, totalManpower, totalManHours, workPerformed,
    issuesAndDelays, message, contactName, contactEmail,
  } = opts;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName || 'MAGE ID'}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Daily Field Report</p>
          <h2 style="margin:0 0 4px;color:#111827;font-size:20px;">${projectName}</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">${new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          ${recipientName ? `<p style="margin:0 0 16px;color:#374151;">Hi ${recipientName},</p>` : ''}
          ${message ? `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">${message}</p>` : ''}
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:20px 0;">
            <tr><td style="padding:20px;">
              <table width="100%">
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Weather</td>
                  <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${weather.condition} (${weather.tempHigh}°/${weather.tempLow}°F)</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Manpower</td>
                  <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${totalManpower} workers</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Man-Hours</td>
                  <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${totalManHours} hrs</td>
                </tr>
              </table>
            </td></tr>
          </table>
          ${workPerformed ? `
          <p style="margin:16px 0 8px;color:#374151;font-size:14px;font-weight:600;">Work Performed</p>
          <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.5;white-space:pre-wrap;">${workPerformed}</p>
          ` : ''}
          ${issuesAndDelays ? `
          <p style="margin:16px 0 8px;color:#dc2626;font-size:14px;font-weight:600;">Issues & Delays</p>
          <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.5;white-space:pre-wrap;">${issuesAndDelays}</p>
          ` : ''}
          <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
            This report was generated using MAGE ID.
            ${contactName ? `<br/>Contact: ${contactName}` : ''}
            ${contactEmail ? ` | ${contactEmail}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildEstimateEmailHtml(opts: {
  companyName: string;
  recipientName: string;
  projectName: string;
  grandTotal: number;
  itemCount: number;
  message?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}): string {
  const {
    companyName, recipientName, projectName, grandTotal,
    itemCount, message, contactName, contactEmail, contactPhone,
  } = opts;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName || 'MAGE ID'}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Estimate</p>
          <h2 style="margin:0 0 24px;color:#111827;font-size:20px;">${projectName}</h2>
          ${recipientName ? `<p style="margin:0 0 16px;color:#374151;">Hi ${recipientName},</p>` : ''}
          <p style="margin:0 0 16px;color:#374151;line-height:1.5;">Please find the estimate details below.</p>
          ${message ? `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">${message}</p>` : ''}
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:20px 0;">
            <tr><td style="padding:20px;">
              <table width="100%">
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Line Items</td>
                  <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${itemCount} items</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Estimated Total</td>
                  <td align="right" style="color:#111827;font-size:18px;font-weight:700;padding:4px 0;">$${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
            This estimate was generated using MAGE ID.
            ${contactName ? `<br/>Contact: ${contactName}` : ''}
            ${contactEmail ? ` | ${contactEmail}` : ''}
            ${contactPhone ? ` | ${contactPhone}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildGenericDocumentEmailHtml(opts: {
  companyName: string;
  recipientName: string;
  projectName: string;
  documentType: string;
  fileName: string;
  message?: string;
  contactName?: string;
  contactEmail?: string;
}): string {
  const {
    companyName, recipientName, projectName, documentType,
    fileName, message, contactName, contactEmail,
  } = opts;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName || 'MAGE ID'}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">${documentType}</p>
          <h2 style="margin:0 0 24px;color:#111827;font-size:20px;">${projectName}</h2>
          ${recipientName ? `<p style="margin:0 0 16px;color:#374151;">Hi ${recipientName},</p>` : ''}
          <p style="margin:0 0 16px;color:#374151;line-height:1.5;">Please find the attached document: <strong>${fileName}</strong></p>
          ${message ? `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">${message}</p>` : ''}
          <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
            This document was sent using MAGE ID.
            ${contactName ? `<br/>Contact: ${contactName}` : ''}
            ${contactEmail ? ` | ${contactEmail}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

```
