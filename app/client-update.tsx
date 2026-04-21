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
