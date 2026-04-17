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
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { ClientPortalSettings, ClientPortalInvite } from '@/types';
import { generateUUID } from '@/utils/generateId';

const PORTAL_BASE_URL = 'mageid.app/portal';

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
  const { getProject, updateProject } = useProjects();

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

  const portalLink = `${PORTAL_BASE_URL}/${portal.portalId}`;

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
    const message = portal.welcomeMessage
      ? `${portal.welcomeMessage}\n\nView your project here: ${portalLink}`
      : `You're invited to view project updates for "${project?.name}".\n\nLink: ${portalLink}`;
    if (Platform.OS === 'web') {
      Alert.alert('Share', message);
      return;
    }
    await Share.share({ message, title: 'Client Portal Invite' });
  }, [portal.welcomeMessage, portalLink, project?.name]);

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
            <Text style={styles.linkText} numberOfLines={1}>{portalLink}</Text>
          </View>
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
            <TextInput
              style={[styles.welcomeInput, { minHeight: 48, textAlign: 'center' as const, letterSpacing: 2, fontSize: 16, marginTop: 10 }]}
              value={portal.passcode ?? ''}
              onChangeText={val => setPortal(p => ({ ...p, passcode: val }))}
              placeholder="Enter a passcode (4-12 chars)"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              maxLength={20}
            />
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
                    <TouchableOpacity onPress={() => handleRemoveInvite(invite.id)} style={styles.removeBtn}>
                      <Trash2 size={14} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

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

  disableBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.error + '40',
    borderRadius: 12, paddingVertical: 14,
  },
  disableBtnText: { fontSize: 15, fontWeight: '600', color: Colors.error },
});
