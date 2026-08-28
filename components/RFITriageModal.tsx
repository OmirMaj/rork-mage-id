// components/RFITriageModal.tsx — paste an email, get a filed RFI.
//
// The one input-driven action worth doing from Ask: paste an architect/owner
// email, MAGE extracts the RFI (reusing parseRFIFromTranscript — email is just
// prose), the GC confirms/edits, and Submit calls addRFI. Unstructured inbound
// text becomes a dated, tracked obligation the moment it lands. A failed extract
// degrades to an editable empty sheet — never a dead end.

import React, { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { X, Sparkles, Check } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { parseRFIFromTranscript } from '@/utils/voiceFormParsers';
import { nailIt } from '@/components/animations/NailItToast';
import { showAlert } from '@/utils/alert';
import { localDateISO } from '@/utils/brief/composeBrief';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { RFIBallInCourt, RFIPriority } from '@/types';

const BALL: RFIBallInCourt[] = ['architect', 'engineer', 'owner', 'sub', 'gc'];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function RFITriageModal({ visible, onClose }: Props) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { projects, addRFI } = useProjects();

  const [step, setStep] = useState<'paste' | 'confirm'>('paste');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? '');
  const [subject, setSubject] = useState('');
  const [question, setQuestion] = useState('');
  const [ball, setBall] = useState<RFIBallInCourt>('architect');
  const [dateRequired, setDateRequired] = useState('');
  const [priority, setPriority] = useState<RFIPriority>('normal');

  const reset = () => {
    setStep('paste'); setEmail(''); setSubject(''); setQuestion('');
    setBall('architect'); setDateRequired(''); setPriority('normal');
  };
  const close = () => { reset(); onClose(); };

  const extract = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const proj = projects.find(p => p.id === projectId) ?? null;
      const r = await parseRFIFromTranscript(email.trim(), proj);
      setSubject(r.subject || '');
      setQuestion(r.question || '');
      setDateRequired(r.dateRequired || '');
      setPriority(r.priority || 'normal');
      const a = (r.assignedTo || '').toLowerCase();
      setBall(a.includes('eng') ? 'engineer' : a.includes('own') ? 'owner' : a.includes('sub') ? 'sub' : 'architect');
    } catch {
      // Graceful — fall through to the confirm sheet with whatever we have.
    } finally {
      setBusy(false);
      setStep('confirm');
    }
  };

  const create = () => {
    if (!projectId || !subject.trim() || !question.trim()) {
      showAlert('Missing details', 'Pick a project and fill in the subject and question.');
      return;
    }
    const rfi = addRFI({
      projectId,
      subject: subject.trim(),
      question: question.trim(),
      submittedBy: '',
      assignedTo: '',
      ballInCourt: ball,
      dateSubmitted: localDateISO(new Date()),
      dateRequired: dateRequired.trim(),
      status: 'open',
      priority,
      attachments: [],
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    nailIt(`RFI #${rfi.number} filed`);
    close();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{step === 'paste' ? 'Email → RFI' : 'Review RFI'}</Text>
          <TouchableOpacity onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <X size={22} color={t.text} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {step === 'paste' ? (
            <>
              <Text style={styles.help}>
                Paste an architect or owner email and MAGE pulls out the RFI. You confirm before it's filed.
              </Text>
              {projects.length > 1 && (
                <>
                  <Text style={styles.label}>PROJECT</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    {projects.map(p => (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.projChip, p.id === projectId && styles.chipOn]}
                        onPress={() => setProjectId(p.id)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.chipText, p.id === projectId && styles.chipTextOn]} numberOfLines={1}>{p.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}
              <Text style={styles.label}>EMAIL TEXT</Text>
              <TextInput
                style={styles.textArea}
                value={email}
                onChangeText={setEmail}
                placeholder="Paste the email here…"
                placeholderTextColor={t.textMuted}
                multiline
                textAlignVertical="top"
                testID="rfi-email-input"
              />
            </>
          ) : (
            <>
              <Text style={styles.label}>SUBJECT</Text>
              <TextInput style={styles.input} value={subject} onChangeText={setSubject} placeholder="What's it about?" placeholderTextColor={t.textMuted} />
              <Text style={styles.label}>QUESTION</Text>
              <TextInput style={styles.textArea} value={question} onChangeText={setQuestion} placeholder="The question to answer" placeholderTextColor={t.textMuted} multiline textAlignVertical="top" />
              <Text style={styles.label}>BALL IN COURT</Text>
              <View style={styles.chipRow}>
                {BALL.map(b => (
                  <TouchableOpacity key={b} style={[styles.ballChip, b === ball && styles.chipOn]} onPress={() => setBall(b)} activeOpacity={0.85}>
                    <Text style={[styles.chipText, b === ball && styles.chipTextOn]}>{b}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>NEEDED BY — optional</Text>
              <TextInput style={styles.input} value={dateRequired} onChangeText={setDateRequired} placeholder="2026-09-15" placeholderTextColor={t.textMuted} autoCapitalize="none" />
            </>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {step === 'paste' ? (
            <TouchableOpacity
              style={[styles.cta, (!email.trim() || busy) && styles.ctaDim]}
              onPress={extract}
              disabled={!email.trim() || busy}
              testID="rfi-extract"
            >
              {busy ? <ActivityIndicator size="small" color={Colors.textOnAccent} /> : <Sparkles size={18} color={Colors.textOnAccent} strokeWidth={2} />}
              <Text style={styles.ctaText}>{busy ? 'Reading…' : 'Extract RFI'}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.cta} onPress={create} testID="rfi-create">
              <Check size={18} color={Colors.textOnAccent} strokeWidth={2.4} />
              <Text style={styles.ctaText}>Create RFI</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  title: { ...Type.title3, color: t.text },
  body: { padding: 18, gap: 4 },
  help: { ...Type.footnote, color: t.textSecondary, lineHeight: 19, marginBottom: 8 },
  label: {
    fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted,
    letterSpacing: 1, marginTop: 14, marginBottom: 8,
  },
  input: {
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.lg,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: Type.subhead.fontSize, color: t.text,
  },
  textArea: {
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.lg,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: Type.subhead.fontSize, color: t.text,
    minHeight: 120,
  },
  chipRow: { gap: 8, paddingRight: 8, flexDirection: 'row', flexWrap: 'wrap' },
  projChip: {
    maxWidth: 180, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.full, paddingHorizontal: 13, paddingVertical: 8,
  },
  ballChip: {
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.full, paddingHorizontal: 13, paddingVertical: 8,
  },
  chipOn: { backgroundColor: t.accentFill, borderColor: t.accentFill },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.textSecondary },
  chipTextOn: { color: Colors.textOnAccent },
  footer: {
    borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.bg,
    paddingHorizontal: 18, paddingTop: 12,
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: t.accentFill, borderRadius: Tokens.radius.lg, paddingVertical: 15,
  },
  ctaDim: { opacity: 0.45 },
  ctaText: { ...Type.subheadEmphasized, color: Colors.textOnAccent },
});
