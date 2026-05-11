// Lead detail — working screen for a single lead.
//
// Where Buildertrend gives you a form-with-tabs that scrolls forever,
// this is a single column with the moves a GC actually makes:
//   - Tap-to-call / tap-to-text / tap-to-email at the top.
//   - Stage chips with one-tap progression and a "Convert to project"
//     button that fires when the lead reaches 'won'.
//   - Activity log: every call/text/email/note logged in one timeline,
//     dictatable by voice (logTouch).
//   - AI score badge with the reason inline.
//   - Inline voice fill for the whole record (re-dictate to update).

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Linking, Platform, Alert, KeyboardAvoidingView, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Phone, Mail, MapPin, ChevronRight, MessageSquare, Calendar, Clock,
  Trash2, Save, Sparkles, ArrowRight, Briefcase, Mic, X,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  LEAD_STAGES, LEAD_STAGE_LABELS, LEAD_SOURCES, LEAD_SOURCE_LABELS,
  type Lead, type LeadStage, type LeadSource, type LeadTouchKind,
} from '@/types';
import InlineVoiceFill from '@/components/InlineVoiceFill';
import VoiceCaptureModal from '@/components/VoiceCaptureModal';
import { StatusPipeline, type PipelineStage } from '@/components/StatusPipeline';
import { parseLeadFromTranscript, pickIfEmpty, titleCase } from '@/utils/voiceFormParsers';

// Lead lifecycle pipeline stages — happy path through the funnel.
// 'lost' is a side branch (lead disqualified) and isn't shown in the
// visual; the user can still tap the 'Lost' chip below to set it.
const LEAD_PIPELINE_STAGES: PipelineStage<LeadStage>[] = [
  { key: 'new', label: 'New' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'won', label: 'Won', terminal: true },
];

function mapLeadStage(s: LeadStage): LeadStage {
  return s === 'lost' ? 'new' : s;
}
import { buildMailtoUrl, mailSignOff } from '@/utils/mailtoComposer';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function LeadDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { leadId, mode } = useLocalSearchParams<{ leadId?: string; mode?: string }>();
  const { getLead, addLead, updateLead, deleteLead, addLeadTouch, convertLeadToProject } = useProjects();

  const isNew = mode === 'new' || !leadId;
  const existing = !isNew && leadId ? getLead(leadId) : null;

  const [name, setName] = useState(existing?.name ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [projectType, setProjectType] = useState(existing?.projectType ?? '');
  const [scope, setScope] = useState(existing?.scope ?? '');
  const [budgetMin, setBudgetMin] = useState<string>(existing?.budgetMin ? String(existing.budgetMin) : '');
  const [budgetMax, setBudgetMax] = useState<string>(existing?.budgetMax ? String(existing.budgetMax) : '');
  const [timeline, setTimeline] = useState(existing?.timeline ?? '');
  const [source, setSource] = useState<LeadSource>(existing?.source ?? 'other');
  const [stage, setStage] = useState<LeadStage>(existing?.stage ?? 'new');
  const [score, setScore] = useState<number | undefined>(existing?.score);
  const [scoreReason, setScoreReason] = useState<string>(existing?.scoreReason ?? '');
  // Lose-reason capture. The lostReason field exists on Lead but pre-fix
  // was never prompted for — we'd just flip stage to 'lost' and lose the
  // why. Now: when stage transitions TO 'lost' from anywhere else, open
  // a chip-picker modal so the next "why are we losing deals?" report
  // has actual data behind it.
  const [lostReason, setLostReason] = useState<string>(existing?.lostReason ?? '');
  const [showLostReasonModal, setShowLostReasonModal] = useState(false);
  const [pendingLostStage, setPendingLostStage] = useState(false);

  // Activity log inputs.
  const [touchKind, setTouchKind] = useState<LeadTouchKind>('call');
  const [touchBody, setTouchBody] = useState('');
  const [voiceLogOpen, setVoiceLogOpen] = useState(false);

  const canSave = name.trim().length > 0;

  const saveAndExit = useCallback(() => {
    if (!canSave) {
      Alert.alert('Missing name', 'Add a name for this lead.');
      return;
    }
    const payload = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      projectType: projectType.trim() || undefined,
      scope: scope.trim() || undefined,
      budgetMin: budgetMin ? Number(budgetMin) : undefined,
      budgetMax: budgetMax ? Number(budgetMax) : undefined,
      timeline: timeline.trim() || undefined,
      source,
      stage,
      score,
      scoreReason: scoreReason || undefined,
      lostReason: lostReason || undefined,
    };
    if (isNew) {
      addLead({ ...payload, touches: [] });
    } else if (existing) {
      updateLead(existing.id, payload);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }, [canSave, name, phone, email, address, projectType, scope, budgetMin, budgetMax, timeline, source, stage, score, scoreReason, lostReason, isNew, existing, addLead, updateLead, router]);

  // Wrap stage changes so flipping to 'lost' opens the reason modal.
  // The actual stage flip stays gated until the modal closes — if the
  // GC bails on giving a reason, we still let them mark it lost (the
  // reason is "best-effort capture", not a hard requirement).
  const setStageWithLossPrompt = useCallback((next: LeadStage) => {
    if (next === 'lost' && stage !== 'lost' && !lostReason) {
      setPendingLostStage(true);
      setShowLostReasonModal(true);
      return;
    }
    setStage(next);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [stage, lostReason]);

  const handleConvert = useCallback(() => {
    if (!existing) return;
    Alert.alert(
      'Convert to project?',
      `This will mark "${existing.name}" as Won and create a new project carrying over the contact info, scope, and budget.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Convert',
          onPress: () => {
            const projectId = convertLeadToProject(existing.id);
            if (projectId) {
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.replace({ pathname: '/project-detail' as never, params: { id: projectId } as never });
            }
          },
        },
      ],
    );
  }, [existing, convertLeadToProject, router]);

  const handleDelete = useCallback(() => {
    if (!existing) return;
    Alert.alert(
      'Delete this lead?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            deleteLead(existing.id);
            router.back();
          },
        },
      ],
    );
  }, [existing, deleteLead, router]);

  const handleLogTouch = useCallback(() => {
    if (!existing || !touchBody.trim()) return;
    addLeadTouch(existing.id, touchKind, touchBody.trim());
    setTouchBody('');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [existing, touchKind, touchBody, addLeadTouch]);

  const handleVoiceLogTouch = useCallback(async (transcript: string) => {
    if (!existing) return;
    addLeadTouch(existing.id, touchKind, transcript);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [existing, touchKind, addLeadTouch]);

  return (
    <>
      <Stack.Screen options={{ title: isNew ? 'New lead' : existing?.name ?? 'Lead', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} keyboardShouldPersistTaps="handled">
          {/* Quick actions row */}
          {existing && (
            <View style={styles.quickRow}>
              {!!existing.phone && (
                <>
                  <TouchableOpacity style={styles.quickBtn} activeOpacity={0.85}
                    onPress={() => Linking.openURL(`tel:${existing.phone}`)}>
                    <Phone size={16} color={Colors.text} />
                    <Text style={styles.quickBtnText}>Call</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.quickBtn} activeOpacity={0.85}
                    onPress={() => Linking.openURL(`sms:${existing.phone}`)}>
                    <MessageSquare size={16} color={Colors.text} />
                    <Text style={styles.quickBtnText}>Text</Text>
                  </TouchableOpacity>
                </>
              )}
              {!!existing.email && (
                <TouchableOpacity style={styles.quickBtn} activeOpacity={0.85}
                  onPress={() => Linking.openURL(buildMailtoUrl({
                    to: existing.email!,
                    subject: existing.projectType
                      ? `Following up on your ${existing.projectType.toLowerCase()} project`
                      : `Following up on your project inquiry`,
                    body: [
                      `Hi ${(existing.name || '').split(' ')[0] || 'there'},`,
                      '',
                      `Thanks for reaching out${existing.source && existing.source !== 'other' ? ` via ${existing.source}` : ''}. I wanted to follow up on the ${existing.projectType ? existing.projectType.toLowerCase() : 'project'} you mentioned${existing.address ? ` at ${existing.address}` : ''}.`,
                      '',
                      `When works for a quick call to walk through the scope?`,
                      '',
                      ...mailSignOff(),
                    ],
                  }))}>
                  <Mail size={16} color={Colors.text} />
                  <Text style={styles.quickBtnText}>Email</Text>
                </TouchableOpacity>
              )}
              {!!existing.address && (
                <TouchableOpacity style={styles.quickBtn} activeOpacity={0.85}
                  onPress={() => Linking.openURL(`maps:?q=${encodeURIComponent(existing.address!)}`)}>
                  <MapPin size={16} color={Colors.text} />
                  <Text style={styles.quickBtnText}>Map</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Score badge */}
          {score != null && (
            <View style={styles.scoreCard}>
              <View style={[styles.scoreCircle, score >= 8 && styles.scoreCircleHot]}>
                <Sparkles size={14} color={score >= 8 ? '#FFF' : Colors.primary} />
                <Text style={[styles.scoreCircleText, score >= 8 && styles.scoreCircleTextHot]}>{score}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.scoreCardTitle}>Fit score</Text>
                <Text style={styles.scoreCardReason} numberOfLines={3}>{scoreReason || '—'}</Text>
              </View>
            </View>
          )}

          {/* Stage chips — pipeline visualization above for existing leads
              showing days-in-pipeline + one-tap advance. The chip row below
              keeps the "tap any stage to jump" affordance — useful when a
              lead jumps from 'new' straight to 'won' (e.g. accepted on the
              first call) or needs to be marked 'lost'. Two patterns serve
              different intents: linear progression vs. arbitrary jump. */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Stage</Text>
            {existing && stage !== 'lost' && (
              <View style={{ marginBottom: Tokens.spacing.sm }}>
                <StatusPipeline
                  stages={LEAD_PIPELINE_STAGES}
                  current={mapLeadStage(stage)}
                  startedAt={existing.receivedAt ?? existing.createdAt}
                  onAdvance={(next) => setStageWithLossPrompt(next)}
                  advanceLabel={
                    stage === 'new' ? 'Mark qualified'
                    : stage === 'qualified' ? 'Move to proposal'
                    : stage === 'proposal' ? 'Mark won'
                    : undefined
                  }
                />
              </View>
            )}
            <View style={styles.chipRow}>
              {LEAD_STAGES.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, stage === s && styles.chipActive]}
                  onPress={() => setStageWithLossPrompt(s)}
                >
                  <Text style={[styles.chipText, stage === s && styles.chipTextActive]}>{LEAD_STAGE_LABELS[s]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {existing && stage === 'won' && !existing.convertedProjectId && (
              <TouchableOpacity style={styles.convertBtn} onPress={handleConvert} activeOpacity={0.85}>
                <Briefcase size={16} color="#FFF" />
                <Text style={styles.convertBtnText}>Convert to project</Text>
                <ArrowRight size={16} color="#FFF" />
              </TouchableOpacity>
            )}
            {existing?.convertedProjectId && (
              <TouchableOpacity
                style={styles.convertedBtn}
                onPress={() => router.replace({ pathname: '/project-detail' as never, params: { id: existing.convertedProjectId } as never })}
                activeOpacity={0.85}
              >
                <Briefcase size={16} color={Colors.primary} />
                <Text style={styles.convertedBtnText}>Open the project</Text>
                <ChevronRight size={16} color={Colors.primary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Voice fill */}
          <View style={styles.section}>
            <InlineVoiceFill
              title={isNew ? 'Capture this lead' : 'Update this lead'}
              contextLine={isNew ? 'Speak the way the homeowner described it' : `for ${existing?.name}`}
              buttonLabel={isNew ? 'Fill lead by voice' : 'Add detail by voice'}
              suggestions={[
                'John Smith, 555 1234, kitchen remodel, found us on Houzz, eighty thousand budget, spring',
                'Jane Garcia, jane@email.com, full bathroom renovation, referral from Bob, twenty-five thousand',
                'Patel family, 312 555 0199, two-story addition, our website, two hundred thousand',
                'Mike Doe, walk-in this morning, ADU in the back yard, one fifty',
              ]}
              onTranscript={async (transcript) => {
                const partial = await parseLeadFromTranscript(transcript);
                if (partial.name) setName(prev => pickIfEmpty(prev, titleCase(partial.name)));
                if (partial.phone) setPhone(prev => pickIfEmpty(prev, partial.phone));
                if (partial.email) setEmail(prev => pickIfEmpty(prev, partial.email));
                if (partial.address) setAddress(prev => pickIfEmpty(prev, partial.address));
                if (partial.projectType) setProjectType(prev => pickIfEmpty(prev, partial.projectType));
                if (partial.scope) setScope(prev => pickIfEmpty(prev, partial.scope));
                if (partial.budgetMin > 0) setBudgetMin(prev => prev || String(partial.budgetMin));
                if (partial.budgetMax > 0) setBudgetMax(prev => prev || String(partial.budgetMax));
                if (partial.timeline) setTimeline(prev => pickIfEmpty(prev, partial.timeline));
                if (partial.source && partial.source !== 'other') setSource(partial.source);
                // Score: always update — that's the AI's job.
                if (partial.score && partial.score > 0) setScore(partial.score);
                if (partial.scoreReason) setScoreReason(partial.scoreReason);
              }}
            />
          </View>

          {/* Fields */}
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>Name *</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Homeowner name" placeholderTextColor={Colors.textMuted} />

            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="(555) 555-1234" placeholderTextColor={Colors.textMuted} keyboardType="phone-pad" />

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="name@email.com" placeholderTextColor={Colors.textMuted} keyboardType="email-address" autoCapitalize="none" />

            <Text style={styles.fieldLabel}>Address</Text>
            <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="123 Main St, City" placeholderTextColor={Colors.textMuted} />

            <Text style={styles.fieldLabel}>Project type</Text>
            <TextInput style={styles.input} value={projectType} onChangeText={setProjectType} placeholder="Kitchen remodel, bathroom, ADU…" placeholderTextColor={Colors.textMuted} />

            <Text style={styles.fieldLabel}>Scope notes</Text>
            <TextInput style={[styles.input, styles.multilineInput]} value={scope} onChangeText={setScope} placeholder="Anything specific the homeowner mentioned" placeholderTextColor={Colors.textMuted} multiline textAlignVertical="top" />

            <View style={styles.budgetRow}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Text style={styles.fieldLabel}>Budget min</Text>
                <TextInput style={styles.input} value={budgetMin} onChangeText={setBudgetMin} placeholder="0" placeholderTextColor={Colors.textMuted} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Text style={styles.fieldLabel}>Budget max</Text>
                <TextInput style={styles.input} value={budgetMax} onChangeText={setBudgetMax} placeholder="0" placeholderTextColor={Colors.textMuted} keyboardType="numeric" />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Timeline</Text>
            <TextInput style={styles.input} value={timeline} onChangeText={setTimeline} placeholder="When do they want to start?" placeholderTextColor={Colors.textMuted} />

            <Text style={styles.fieldLabel}>Source</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {LEAD_SOURCES.map(s => (
                <TouchableOpacity key={s} style={[styles.chip, source === s && styles.chipActive]} onPress={() => setSource(s)}>
                  <Text style={[styles.chipText, source === s && styles.chipTextActive]}>{LEAD_SOURCE_LABELS[s]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Activity log */}
          {existing && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Activity</Text>
              <View style={styles.touchKindRow}>
                {(['call','text','email','meeting','site_visit','voicemail','note'] as LeadTouchKind[]).map(k => (
                  <TouchableOpacity key={k} style={[styles.chipSmall, touchKind === k && styles.chipSmallActive]} onPress={() => setTouchKind(k)}>
                    <Text style={[styles.chipSmallText, touchKind === k && styles.chipSmallTextActive]}>{k.replace('_',' ')}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.touchInputRow}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={touchBody}
                  onChangeText={setTouchBody}
                  placeholder={`Log a ${touchKind.replace('_',' ')}…`}
                  placeholderTextColor={Colors.textMuted}
                />
                <TouchableOpacity style={styles.touchVoiceBtn} onPress={() => setVoiceLogOpen(true)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Record">
                  <Mic size={16} color={Colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.touchAddBtn, !touchBody.trim() && styles.touchAddBtnDisabled]}
                  onPress={handleLogTouch}
                  disabled={!touchBody.trim()}
                  activeOpacity={0.8}
                >
                  <Text style={styles.touchAddBtnText}>Log</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.touchList}>
                {(existing.touches ?? []).length === 0 ? (
                  <Text style={styles.emptyText}>No activity yet. Log your first call / text above.</Text>
                ) : (
                  (existing.touches ?? []).map(t => (
                    <View key={t.id} style={styles.touchRow}>
                      <View style={styles.touchKindBadge}>
                        <Text style={styles.touchKindBadgeText}>{t.kind.replace('_',' ')}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.touchBody}>{t.body}</Text>
                        <Text style={styles.touchMeta}>{new Date(t.occurredAt).toLocaleString()}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </View>
          )}
        </ScrollView>

        {/* Sticky bottom save bar */}
        <View style={[styles.saveBar, { paddingBottom: insets.bottom + 12 }]}>
          {existing && (
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Delete"><Trash2 size={16} color={Colors.error} /></TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            onPress={saveAndExit}
            disabled={!canSave}
            activeOpacity={0.85}
          >
            <Save size={16} color="#FFF" />
            <Text style={styles.saveBtnText}>{isNew ? 'Save lead' : 'Save changes'}</Text>
          </TouchableOpacity>
        </View>

        <VoiceCaptureModal
          visible={voiceLogOpen}
          onClose={() => setVoiceLogOpen(false)}
          onTranscriptReady={handleVoiceLogTouch}
          title={`Log ${touchKind.replace('_',' ')}`}
          contextLine={existing ? `for ${existing.name}` : undefined}
          suggestions={[
            'Called, left a voicemail asking when they want to walk the site',
            'Texted with the budget summary, they said they need a couple days to think',
            'Emailed the proposal, attached the schedule and selections allowance',
            'Met at the house, walked the kitchen, took photos of the existing layout',
          ]}
        />

        {/* Lose-reason modal — fires when GC flips the stage to 'lost'.
            Chip picker covers the five answers that actually drive
            "why are we losing" reporting. "Skip" still moves the stage
            but leaves the reason blank — capture is best-effort, not a
            hard requirement. */}
        <Modal
          visible={showLostReasonModal}
          transparent
          animationType="fade"
          onRequestClose={() => { setShowLostReasonModal(false); setPendingLostStage(false); }}
        >
          <View style={styles.lostModalBackdrop}>
            <View style={styles.lostModalCard}>
              <Text style={styles.lostModalTitle}>Why did this one go cold?</Text>
              <Text style={styles.lostModalSubtitle}>
                One tap. We'll roll it into "why are we losing deals" reports later — won't ask you again.
              </Text>
              <View style={styles.lostReasonChips}>
                {LOST_REASONS.map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.chip, lostReason === r && styles.chipActive]}
                    onPress={() => {
                      setLostReason(r);
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    }}
                  >
                    <Text style={[styles.chipText, lostReason === r && styles.chipTextActive]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.lostModalActions}>
                <TouchableOpacity
                  style={styles.lostModalSkipBtn}
                  onPress={() => {
                    if (pendingLostStage) setStage('lost');
                    setShowLostReasonModal(false);
                    setPendingLostStage(false);
                  }}
                >
                  <Text style={styles.lostModalSkipText}>Skip</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.lostModalSaveBtn, !lostReason && { opacity: 0.5 }]}
                  disabled={!lostReason}
                  onPress={() => {
                    if (pendingLostStage) setStage('lost');
                    setShowLostReasonModal(false);
                    setPendingLostStage(false);
                  }}
                >
                  <Text style={styles.lostModalSaveText}>Save reason</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </>
  );
}

const LOST_REASONS = [
  'Price',
  'Timeline',
  'Trust',
  'Awarded elsewhere',
  'No response',
  'Scope changed',
  'Other',
] as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  quickRow: { flexDirection: 'row', gap: Tokens.spacing.xs, padding: Tokens.spacing.md, paddingBottom: 0, flexWrap: 'wrap' },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surface,
    paddingHorizontal: Tokens.spacing.sm, paddingVertical: 10, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  quickBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.text },
  scoreCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    margin: Tokens.spacing.md, marginBottom: 0,
    backgroundColor: Colors.surface,
    padding: 14, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  scoreCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  scoreCircleHot: { backgroundColor: Colors.primary },
  scoreCircleText: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: Colors.primary },
  scoreCircleTextHot: { color: '#FFF' },
  scoreCardTitle: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  scoreCardReason: { fontSize: Type.footnote.fontSize, color: Colors.text, marginTop: Tokens.spacing.hairline, lineHeight: 18 },
  section: { padding: Tokens.spacing.md, paddingBottom: Tokens.spacing.xs },
  sectionLabel: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: Tokens.spacing.xs },
  fieldLabel: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.sm, marginBottom: 6, fontWeight: '600' as const },
  input: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 14, paddingVertical: Tokens.spacing.sm,
    borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: Colors.cardBorder,
    fontSize: Type.subhead.fontSize, color: Colors.text,
  },
  multilineInput: { minHeight: 80 },
  budgetRow: { flexDirection: 'row', marginTop: Tokens.spacing.xxs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: Tokens.spacing.sm, paddingVertical: Tokens.spacing.xs,
    backgroundColor: Colors.surface, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: Type.footnote.fontSize, color: Colors.text, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  convertBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.xs,
    marginTop: Tokens.spacing.sm,
    backgroundColor: Colors.success,
    paddingVertical: 14, borderRadius: Tokens.radius.card,
  },
  convertBtnText: { color: '#FFF', fontSize: Type.subhead.fontSize, fontWeight: '700' as const },
  convertedBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.xs,
    marginTop: Tokens.spacing.sm,
    backgroundColor: Colors.primary + '15',
    paddingVertical: 14, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  convertedBtnText: { color: Colors.primary, fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const },
  touchKindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: Tokens.spacing.xs },
  chipSmall: {
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: Colors.surface, borderRadius: Tokens.radius.sm,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  chipSmallActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  chipSmallText: { fontSize: Type.caption1.fontSize, color: Colors.text, textTransform: 'capitalize' as const },
  chipSmallTextActive: { color: '#FFF' },
  touchInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  touchVoiceBtn: {
    width: 42, height: 42, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  touchAddBtn: {
    backgroundColor: Colors.text,
    paddingHorizontal: 14, paddingVertical: Tokens.spacing.sm, borderRadius: Tokens.radius.card,
  },
  touchAddBtnDisabled: { backgroundColor: Colors.fillTertiary },
  touchAddBtnText: { color: '#FFF', fontSize: Type.footnote.fontSize, fontWeight: '600' as const },
  touchList: { marginTop: Tokens.spacing.sm, gap: 10 },
  touchRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: Colors.surface,
    padding: Tokens.spacing.sm, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  touchKindBadge: {
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: Tokens.spacing.xs, paddingVertical: 3, borderRadius: Tokens.radius.xs,
  },
  touchKindBadgeText: { fontSize: 10, fontWeight: '700' as const, color: Colors.primary, textTransform: 'uppercase' },
  touchBody: { fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 18 },
  touchMeta: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline },
  emptyText: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, textAlign: 'center', paddingVertical: Tokens.spacing.sm },
  saveBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', gap: Tokens.spacing.xs,
    backgroundColor: Colors.background,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder,
    paddingHorizontal: Tokens.spacing.md, paddingTop: Tokens.spacing.sm,
  },
  deleteBtn: {
    width: 48, height: 48, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.error + '15',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.error + '30',
  },
  saveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.xs,
    backgroundColor: Colors.primary,
    paddingVertical: 14, borderRadius: Tokens.radius.card,
  },
  saveBtnDisabled: { backgroundColor: Colors.fillTertiary },
  saveBtnText: { color: '#FFF', fontSize: Type.subhead.fontSize, fontWeight: '700' as const },

  // ── Lose-reason modal ──────────────────────────────────────────
  lostModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: Tokens.spacing.xl,
  },
  lostModalCard: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.card,
    padding: Tokens.spacing.lg,
    width: '100%' as const,
    maxWidth: 420,
  },
  lostModalTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  lostModalSubtitle: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    marginBottom: Tokens.spacing.md,
    lineHeight: 19,
  },
  lostReasonChips: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: Tokens.spacing.xs,
    marginBottom: 18,
  },
  lostModalActions: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  lostModalSkipBtn: {
    flex: 1,
    paddingVertical: Tokens.spacing.sm,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center' as const,
  },
  lostModalSkipText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: Colors.textMuted },
  lostModalSaveBtn: {
    flex: 1,
    paddingVertical: Tokens.spacing.sm,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
  },
  lostModalSaveText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: '#FFF' },
});
