// import-pipeline — bring your existing book of business into MAGE ID in
// seconds. The "contractor brings their own pipeline" cold-start play: the
// app is a useful CRM on day one, independent of any marketplace liquidity.
//
// Two sources, both OTA-safe (no native deps):
//   1. Paste — copy a column from a spreadsheet / Notes / a text and we
//      parse one client per line (see utils/pipelineImport).
//   2. Existing contacts — one tap to turn any Contact already in the app
//      into a lead in the pipeline.
//
// Parsed rows are shown for review (the contractor can delete bad ones)
// before they're committed as leads — so a messy paste never silently
// creates junk.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Platform, Alert,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ClipboardPaste, Users, Check, X, Trash2, Sparkles, DollarSign, Phone,
} from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { parseImportBlob, draftToLeadInput, type ImportedLeadDraft } from '@/utils/pipelineImport';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

type Mode = 'paste' | 'contacts';

export default function ImportPipelineScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { addLead, contacts, leads } = useProjects();

  const [mode, setMode] = useState<Mode>('paste');
  const [blob, setBlob] = useState('');
  const [drafts, setDrafts] = useState<ImportedLeadDraft[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [importing, setImporting] = useState(false);

  // Contacts not already turned into a lead (match on name, case-insensitive)
  // so re-importing doesn't duplicate the pipeline.
  const importableContacts = useMemo(() => {
    const leadNames = new Set(leads.map(l => l.name.trim().toLowerCase()));
    return contacts.filter(c => {
      const full = `${c.firstName} ${c.lastName}`.trim();
      return full.length > 0 && !leadNames.has(full.toLowerCase());
    });
  }, [contacts, leads]);

  const handleParse = useCallback(() => {
    const parsed = parseImportBlob(blob);
    if (parsed.length === 0) {
      Alert.alert('Nothing to import', 'Paste one client per line — name first, then phone, email, project, or budget in any order.');
      return;
    }
    setDrafts(parsed);
    setReviewing(true);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [blob]);

  const removeDraft = useCallback((idx: number) => {
    setDrafts(d => d.filter((_, i) => i !== idx));
  }, []);

  const commitDrafts = useCallback(() => {
    if (drafts.length === 0) return;
    setImporting(true);
    try {
      for (const d of drafts) addLead(draftToLeadInput(d));
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Pipeline imported',
        `${drafts.length} client${drafts.length === 1 ? '' : 's'} added to your pipeline as Qualified leads. Open any one to draft an Instant Bid.`,
        [{ text: 'View pipeline', onPress: () => router.replace('/leads' as never) }],
      );
    } finally {
      setImporting(false);
    }
  }, [drafts, addLead, router]);

  const importContact = useCallback((contactId: string) => {
    const c = contacts.find(x => x.id === contactId);
    if (!c) return;
    addLead({
      name: `${c.firstName} ${c.lastName}`.trim() || c.companyName || 'Client',
      phone: c.phone || undefined,
      email: c.email || undefined,
      address: c.address || undefined,
      source: 'repeat',
      stage: 'qualified',
      touches: [{
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: 'note',
        body: 'Added to pipeline from contacts.',
        occurredAt: new Date().toISOString(),
      }],
    });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [contacts, addLead]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Bring your book of business</Text>
          <Text style={styles.title}>Import your clients</Text>
        </View>
      </View>

      {/* Mode toggle */}
      <View style={styles.segmentRow}>
        <TouchableOpacity
          style={[styles.segment, mode === 'paste' && styles.segmentActive]}
          onPress={() => { setMode('paste'); setReviewing(false); }}
        >
          <ClipboardPaste size={14} color={mode === 'paste' ? themeColors.accent : themeColors.textMuted} />
          <Text style={[styles.segmentText, mode === 'paste' && styles.segmentTextActive]}>Paste list</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segment, mode === 'contacts' && styles.segmentActive]}
          onPress={() => { setMode('contacts'); setReviewing(false); }}
        >
          <Users size={14} color={mode === 'contacts' ? themeColors.accent : themeColors.textMuted} />
          <Text style={[styles.segmentText, mode === 'contacts' && styles.segmentTextActive]}>
            From contacts{importableContacts.length > 0 ? ` · ${importableContacts.length}` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {mode === 'paste' && !reviewing && (
          <>
            <View style={styles.pitch}>
              <Sparkles size={16} color={themeColors.accent} />
              <Text style={styles.pitchText}>
                Paste your client list — one per line. We&apos;ll read the name, phone, email,
                project, and budget in any order. Copy a column straight from a spreadsheet,
                Notes, or a text.
              </Text>
            </View>
            <TextInput
              style={styles.blobInput}
              value={blob}
              onChangeText={setBlob}
              placeholder={'John Smith, 555-123-4567, kitchen remodel, $80,000\nJane Garcia, jane@email.com, bathroom reno\nPatel Family, 312-555-0199, ADU, 150k'}
              placeholderTextColor={themeColors.textMuted}
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.primaryBtn, !blob.trim() && styles.primaryBtnDisabled]}
              onPress={handleParse}
              disabled={!blob.trim()}
              activeOpacity={0.85}
              testID="import-parse"
            >
              <Text style={styles.primaryBtnText}>Review {blob.trim() ? `${blob.split(/\r?\n/).filter(l => l.trim()).length} ` : ''}clients</Text>
            </TouchableOpacity>
          </>
        )}

        {mode === 'paste' && reviewing && (
          <>
            <Text style={styles.reviewHead}>
              {drafts.length} client{drafts.length === 1 ? '' : 's'} ready. Remove any that look wrong, then import.
            </Text>
            {drafts.map((d, i) => (
              <View key={`${d.raw}-${i}`} style={styles.draftCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.draftName}>{d.name}</Text>
                  <View style={styles.draftMeta}>
                    {!!d.phone && (
                      <View style={styles.draftChip}><Phone size={10} color={themeColors.textMuted} /><Text style={styles.draftChipText}>{d.phone}</Text></View>
                    )}
                    {!!d.email && <View style={styles.draftChip}><Text style={styles.draftChipText}>{d.email}</Text></View>}
                    {(d.budgetMax != null) && (
                      <View style={styles.draftChip}><DollarSign size={10} color={themeColors.accent} /><Text style={styles.draftChipText}>{formatMoney(d.budgetMax)}</Text></View>
                    )}
                  </View>
                  {!!d.projectType && <Text style={styles.draftProject} numberOfLines={1}>{d.projectType}</Text>}
                </View>
                <TouchableOpacity onPress={() => removeDraft(i)} hitSlop={8} style={styles.draftRemove}>
                  <Trash2 size={15} color={themeColors.danger} />
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.reviewActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setReviewing(false)} activeOpacity={0.8}>
                <X size={15} color={themeColors.text} />
                <Text style={styles.secondaryBtnText}>Back to edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, { flex: 1 }, (importing || drafts.length === 0) && styles.primaryBtnDisabled]}
                onPress={commitDrafts}
                disabled={importing || drafts.length === 0}
                activeOpacity={0.85}
                testID="import-commit"
              >
                <Check size={16} color="#FFF" />
                <Text style={styles.primaryBtnText}>Import {drafts.length}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {mode === 'contacts' && (
          importableContacts.length === 0 ? (
            <View style={styles.emptyCard}>
              <Users size={26} color={themeColors.textMuted} />
              <Text style={styles.emptyTitle}>No contacts to import</Text>
              <Text style={styles.emptyBody}>
                Every contact is already in your pipeline, or you haven&apos;t added contacts yet.
                Use the Paste tab to bring in your client list.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.reviewHead}>Tap a contact to add them to your pipeline as a Qualified lead.</Text>
              {importableContacts.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.draftCard}
                  onPress={() => importContact(c.id)}
                  activeOpacity={0.8}
                  testID={`import-contact-${c.id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.draftName}>{`${c.firstName} ${c.lastName}`.trim() || c.companyName}</Text>
                    <View style={styles.draftMeta}>
                      {!!c.role && <View style={styles.draftChip}><Text style={styles.draftChipText}>{c.role}</Text></View>}
                      {!!c.phone && <View style={styles.draftChip}><Phone size={10} color={themeColors.textMuted} /><Text style={styles.draftChipText}>{c.phone}</Text></View>}
                    </View>
                  </View>
                  <View style={styles.addPill}><Text style={styles.addPillText}>Add</Text></View>
                </TouchableOpacity>
              ))}
            </>
          )
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, marginTop: 4 },

  segmentRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  segment: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: Tokens.radius.md,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
  },
  segmentActive: { backgroundColor: t.accent + '12', borderColor: t.accent },
  segmentText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.textMuted },
  segmentTextActive: { color: t.accent },

  pitch: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: t.accent + '0C', borderRadius: Tokens.radius.lg,
    padding: 14, borderWidth: 1, borderColor: t.accent + '2A', marginBottom: 12,
  },
  pitchText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },

  blobInput: {
    minHeight: 180, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.lg, padding: 14, fontSize: Type.bodyCompact.fontSize,
    color: t.text, lineHeight: 22, marginBottom: 12,
  },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.card, backgroundColor: t.accent,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: '#FFF' },

  reviewHead: { fontSize: Type.footnote.fontSize, color: t.textMuted, marginBottom: 12, lineHeight: 18 },
  draftCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 12,
    borderWidth: 1, borderColor: t.line, marginBottom: 8,
  },
  draftName: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  draftMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  draftChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: t.bg, borderRadius: Tokens.radius.full,
    paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: t.line,
  },
  draftChipText: { fontSize: Type.caption2.fontSize, color: t.text, fontWeight: '600' },
  draftProject: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 4 },
  draftRemove: { padding: 6 },
  addPill: { backgroundColor: t.accent, paddingHorizontal: 14, paddingVertical: 7, borderRadius: Tokens.radius.full },
  addPillText: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: '#FFF' },

  reviewActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 14, borderRadius: Tokens.radius.card,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
  },
  secondaryBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },

  emptyCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 28,
    alignItems: 'center', gap: 8, marginTop: 30, borderWidth: 1, borderColor: t.line,
  },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, marginTop: 4 },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
});
