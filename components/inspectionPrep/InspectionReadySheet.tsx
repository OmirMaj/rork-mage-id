// InspectionReadySheet — the pre-inspection checklist for ONE upcoming
// inspection, and the Pass / Fail that files the inspector's words on the
// permit history afterwards.
//
// Top to bottom, in trust order:
//   1. what HIS inspector with this authority wrote before (verbatim, dated);
//   2. what this job's estimate puts in scope for the trade;
//   3. what an inspector commonly checks — MODEL RECALL, labelled amber,
//      Pro and up, never a figure;
//   4. the low-confidence recall, split out as "verify on site".
// The disclaimer is a fixed constant (PREP_DISCLAIMER), never model text.
//
// Free tier: groups 1-2 and Pass/Fail work fully with no AI at all; the recall
// group says it needs Pro and offers the existing Paywall.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { X, History, Ruler, BookOpen, HelpCircle, Camera, ListChecks, RefreshCw } from 'lucide-react-native';
import type { Permit, Project } from '@/types';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useInspectionPrepState } from '@/hooks/useInspectionPrepState';
import { SheetOverlay, SheetScrim, useSheetFrame } from '@/components/ui/Sheet';
import { cardSurface } from '@/components/ui';
import Paywall from '@/components/Paywall';
import { generateUUID } from '@/utils/generateId';
import { showAlert } from '@/utils/alert';
import { formatCalendarDay } from '@/utils/calendarDate';
import {
  groundingFactsFor, jobsiteAddressForProject, resolveCodeJurisdiction,
} from '@/utils/codeJurisdiction';
import { editionMismatchFor } from '@/utils/codeAmendments';
import {
  PREP_DISCLAIMER,
  buildChecklist,
  buildRecallPrompt,
  prepStateKey,
  punchForPrepItem,
  recordInspectionResult,
  type PrepItem,
  type UpcomingInspection,
} from '@/utils/inspectionPrep';
import { runInspectionRecall } from '@/utils/inspectionPrepAI';

export const RECALL_CHIP = 'From model recall — verify with your AHJ';
export const RECALL_NEEDS_PRO = 'Commonly-checked items use AI and need Pro';

function permitLabel(p: Permit): string {
  const n = (p.permitNumber ?? '').trim();
  return n ? `${n} permit` : `${p.type.replace(/_/g, ' ')} permit`;
}

export default function InspectionReadySheet({
  inspection, project, visible, onClose,
}: {
  inspection: UpcomingInspection;
  project: Project;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const f = useSheetFrame('panel', { visible, animationType: 'slide' });
  const { permits, addPunchItem, updatePunchItem, updatePermit, getPunchItemsForProject } = useProjects();
  const { canAccess } = useTierAccess();
  const canAI = canAccess('ai_code_check');
  const { entry, loaded, update } = useInspectionPrepState(visible ? prepStateKey(inspection) : null);

  const resolved = useMemo(() => resolveCodeJurisdiction(jobsiteAddressForProject(project)), [project]);
  const grounding = useMemo(() => groundingFactsFor(resolved), [resolved]);

  const base = useMemo(() => buildChecklist({ inspection, project, permits, recall: null }), [inspection, project, permits]);
  const full = useMemo(
    () => buildChecklist({ inspection, project, permits, recall: entry.recall ?? null }),
    [inspection, project, permits, entry.recall],
  );
  const byGroup = useMemo(() => ({
    history: full.items.filter((i) => i.group === 'history'),
    scope: full.items.filter((i) => i.group === 'scope'),
    recall: full.items.filter((i) => i.group === 'recall'),
    verify: full.items.filter((i) => i.group === 'verify'),
  }), [full.items]);

  // ── Recall (Pro and up) ────────────────────────────────────────────────
  const [recallBusy, setRecallBusy] = useState(false);
  const [recallError, setRecallError] = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  // Newest request wins: a slower, older answer (tap a chip, then another)
  // never overwrites the one that matches the answers he picked last.
  const recallSeq = useRef(0);
  const runRecall = useCallback(async (answers: Record<string, string>, refresh = false) => {
    if (!canAI) return;
    const { prompt, cacheKey } = buildRecallPrompt({ inspection, project, jurisdiction: grounding, covered: base.items, answers });
    const seq = ++recallSeq.current;
    setRecallBusy(true);
    setRecallError(null);
    const res = await runInspectionRecall(prompt, refresh ? `${cacheKey}::refresh:${Date.now()}` : cacheKey);
    if (seq !== recallSeq.current) return;
    setRecallBusy(false);
    if (!res.ok) { setRecallError(res.error); return; }
    update((e) => ({ ...e, recall: res.answer, recallAt: new Date().toISOString() }));
  }, [canAI, inspection, project, grounding, base.items, update]);

  // Once per open, after the stored entry has loaded (the 24 h cache makes a
  // re-open cheap; the stored answer shows meanwhile).
  const ranForOpen = useRef(false);
  useEffect(() => {
    if (!visible) { ranForOpen.current = false; return; }
    if (!loaded || !canAI || ranForOpen.current) return;
    ranForOpen.current = true;
    void runRecall(entry.answers);
  }, [visible, loaded, canAI, runRecall, entry.answers]);

  const answer = useCallback((question: string, option: string) => {
    const answers = { ...entry.answers, [question]: option };
    update((e) => ({ ...e, answers }));
    void runRecall(answers);
  }, [entry.answers, update, runRecall]);

  // ── Item actions ───────────────────────────────────────────────────────
  const projectPunchIds = useMemo(
    () => new Set(getPunchItemsForProject(project.id).map((p) => p.id)),
    [getPunchItemsForProject, project.id],
  );
  const linkedPunch = useCallback((item: PrepItem): string | null => {
    const id = entry.punchByItem[item.id];
    return id && projectPunchIds.has(id) ? id : null;
  }, [entry.punchByItem, projectPunchIds]);

  const addToPunch = useCallback((item: PrepItem, photoUri?: string): string => {
    const punch = punchForPrepItem(item, inspection, new Date().toISOString(), generateUUID);
    addPunchItem(photoUri ? { ...punch, photoUri } : punch);
    update((e) => ({ ...e, punchByItem: { ...e.punchByItem, [item.id]: punch.id } }));
    return punch.id;
  }, [inspection, addPunchItem, update]);

  const snapProof = useCallback(async (item: PrepItem) => {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (Platform.OS === 'web') {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          showAlert('Camera access needed', 'Open Settings, then MAGE ID, then Camera to allow it.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false, exif: false });
      }
      const uri = !result.canceled ? result.assets?.[0]?.uri : undefined;
      if (!uri) return;
      const linked = linkedPunch(item);
      if (linked) updatePunchItem(linked, { photoUri: uri });
      else addToPunch(item, uri);
      update((e) => ({ ...e, proofByItem: { ...e.proofByItem, [item.id]: true } }));
    } catch {
      showAlert('Could not attach the photo', 'Try again, or add it from Punch List.');
    }
  }, [linkedPunch, updatePunchItem, addToPunch, update]);

  const toggleNA = useCallback((item: PrepItem) => {
    update((e) => ({ ...e, na: e.na.includes(item.id) ? e.na.filter((x) => x !== item.id) : [...e.na, item.id] }));
  }, [update]);

  // ── How did it go? ─────────────────────────────────────────────────────
  const jobPermits = useMemo(() => permits.filter((p) => p.projectId === project.id), [permits, project.id]);
  const [result, setResult] = useState<'passed' | 'failed' | null>(null);
  const [notes, setNotes] = useState('');
  const [inspectorName, setInspectorName] = useState('');
  const [permitId, setPermitId] = useState<string | null>(inspection.permitId);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const showPicker = inspection.source.kind === 'task' || jobPermits.length > 1;
  const chosenPermit = jobPermits.find((p) => p.id === permitId) ?? (jobPermits.length === 1 ? jobPermits[0] : null);

  const save = useCallback(() => {
    if (!result || !chosenPermit) return;
    const patch = recordInspectionResult(
      chosenPermit,
      { name: inspection.name, day: inspection.day, result, notes, inspectorName },
      new Date().toISOString(),
      generateUUID,
    );
    updatePermit(chosenPermit.id, patch);
    const authority = inspection.authority ?? ((chosenPermit.jurisdiction ?? '').trim() || 'this authority');
    setSavedMsg(notes.trim()
      ? `Saved to the ${permitLabel(chosenPermit)} history. Next time ${authority} inspects your work, this note leads the list.`
      : `Saved to the ${permitLabel(chosenPermit)} history.`);
  }, [result, chosenPermit, inspection, notes, inspectorName, updatePermit]);

  const openPermits = useCallback(() => {
    onClose();
    router.push({ pathname: '/permits', params: { projectId: project.id } });
  }, [onClose, project.id]);

  // ── Render helpers ─────────────────────────────────────────────────────
  const dayLabel = formatCalendarDay(inspection.day, { weekday: 'long', month: 'short', day: 'numeric' });
  const jurisdictionKnown = resolved.kind !== 'unknown';

  const renderItem = (item: PrepItem) => {
    const na = entry.na.includes(item.id);
    const punchId = linkedPunch(item);
    const proof = !!entry.proofByItem[item.id] && !!punchId;
    const mismatch = item.codeRef && jurisdictionKnown ? editionMismatchFor(resolved, item.codeRef) : null;
    return (
      <View key={item.id} style={s.item} testID={`inspection-prep-item-${item.id}`}>
        {item.group === 'history' && item.quoteDate ? (
          <Text style={s.recordChip}>{`From your inspection record · ${formatCalendarDay(item.quoteDate)}`}</Text>
        ) : null}
        <Text style={[s.itemText, na && s.itemTextNA]} selectable>{item.text}</Text>
        {item.why && item.group !== 'history' ? <Text style={s.itemWhy}>{item.why}</Text> : null}
        {item.codeRef && jurisdictionKnown ? <Text style={s.codeRef}>{item.codeRef}</Text> : null}
        {mismatch ? (
          <View style={s.mismatch} testID={`inspection-prep-mismatch-${item.id}`}>
            <Text style={s.mismatchText}>{mismatch.label}</Text>
          </View>
        ) : null}
        <View style={s.itemActions}>
          <TouchableOpacity
            style={s.action}
            onPress={() => { if (!punchId) addToPunch(item); }}
            disabled={!!punchId}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!punchId }}
            testID={`inspection-prep-punch-${item.id}`}
          >
            <ListChecks size={13} color={t.textSecondary} strokeWidth={1.75} />
            <Text style={s.actionText}>{punchId ? 'In punch (internal)' : 'Add to punch (internal)'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.action}
            onPress={() => { void snapProof(item); }}
            accessibilityRole="button"
            testID={`inspection-prep-proof-${item.id}`}
          >
            <Camera size={13} color={t.textSecondary} strokeWidth={1.75} />
            <Text style={s.actionText}>{proof ? 'Proof attached' : 'Snap proof'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.action, na && s.actionOn]}
            onPress={() => toggleNA(item)}
            accessibilityRole="button"
            accessibilityState={{ selected: na }}
            testID={`inspection-prep-na-${item.id}`}
          >
            <Text style={s.actionText}>N/A</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType={f.animationType} presentationStyle="pageSheet" transparent={f.transparent} onRequestClose={onClose}>
      <SheetOverlay frame={f}>
        <SheetScrim frame={f} onPress={onClose} />
        <View style={[s.container, { paddingTop: Platform.OS === 'ios' ? 8 : insets.top + 8 }, f.card]} testID="inspection-ready-sheet">
          <View style={s.header}>
            <View style={s.headerBody}>
              <Text style={s.sheetHeading}>{`Get ready for ${inspection.name} — ${dayLabel}`}</Text>
              <Text style={s.authority}>{inspection.authority ?? 'Issuing authority not set — add it on the permit'}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Close" testID="inspection-ready-close">
              <X size={18} color={t.text} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <Text style={s.disclaimer} testID="inspection-prep-disclaimer">{PREP_DISCLAIMER}</Text>

            {/* 1. His inspector, verbatim. */}
            <View style={s.section}>
              <View style={s.sectionHead}>
                <History size={15} color={t.accentLabel} strokeWidth={1.75} />
                <Text style={s.sectionHeading}>Your inspector flagged this before</Text>
              </View>
              {byGroup.history.length > 0
                ? byGroup.history.map(renderItem)
                : <Text style={s.empty}>{full.history.chipLabel}</Text>}
            </View>

            {/* 2. This job's scope. */}
            <View style={s.section}>
              <View style={s.sectionHead}>
                <Ruler size={15} color={t.accentLabel} strokeWidth={1.75} />
                <Text style={s.sectionHeading}>Your scope triggers this</Text>
              </View>
              {byGroup.scope.length > 0
                ? byGroup.scope.map(renderItem)
                : <Text style={s.empty}>No line in this job&apos;s estimate matches this inspection&apos;s trade.</Text>}
            </View>

            {/* 3. Model recall — labelled, Pro and up. */}
            <View style={s.section}>
              <View style={s.sectionHead}>
                <BookOpen size={15} color={t.warningLabel} strokeWidth={1.75} />
                <Text style={s.sectionHeading}>Commonly checked (model recall)</Text>
              </View>
              <Text style={s.recallChip}>{RECALL_CHIP}</Text>
              <Text style={s.groundingChip}>{grounding.chipLabel}</Text>
              {!canAI ? (
                <View style={s.proBox}>
                  <Text style={s.empty} testID="inspection-prep-needs-pro">{RECALL_NEEDS_PRO}</Text>
                  <TouchableOpacity style={s.action} onPress={() => setPaywallOpen(true)} accessibilityRole="button" testID="inspection-prep-see-pro">
                    <Text style={s.actionText}>See Pro</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {recallBusy ? (
                    <View style={s.busy}>
                      <ActivityIndicator size="small" color={t.textSecondary} />
                      <Text style={s.empty}>Loading what inspectors commonly check…</Text>
                    </View>
                  ) : null}
                  {recallError ? <Text style={s.empty}>{recallError}</Text> : null}
                  {byGroup.recall.map(renderItem)}
                  {!recallBusy && !recallError && entry.recall && byGroup.recall.length === 0
                    ? <Text style={s.empty}>Nothing to add beyond the lists above.</Text>
                    : null}
                  {full.followUps.map((q) => (
                    <View key={q.question} style={s.followUp}>
                      <Text style={s.followUpQ}>{q.question}</Text>
                      <View style={s.options}>
                        {q.options.map((o) => {
                          const on = entry.answers[q.question] === o;
                          return (
                            <TouchableOpacity
                              key={o}
                              style={[s.option, on && s.optionOn]}
                              onPress={() => answer(q.question, o)}
                              accessibilityRole="button"
                              accessibilityState={{ selected: on }}
                            >
                              <Text style={[s.optionText, on && s.optionTextOn]}>{o}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={s.action}
                    onPress={() => { void runRecall(entry.answers, true); }}
                    disabled={recallBusy}
                    accessibilityRole="button"
                    testID="inspection-prep-refresh"
                  >
                    <RefreshCw size={13} color={t.textSecondary} strokeWidth={1.75} />
                    <Text style={s.actionText}>Refresh list</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* 4. Not sure — verify on site. */}
            {canAI && byGroup.verify.length > 0 ? (
              <View style={s.section}>
                <View style={s.sectionHead}>
                  <HelpCircle size={15} color={t.warningLabel} strokeWidth={1.75} />
                  <Text style={s.sectionHeading}>Not sure — verify on site</Text>
                </View>
                {byGroup.verify.map(renderItem)}
              </View>
            ) : null}

            {/* How did it go? */}
            <View style={s.section} testID="inspection-prep-result">
              <Text style={s.sectionHeading}>How did it go?</Text>
              {jobPermits.length === 0 ? (
                <TouchableOpacity style={s.action} onPress={openPermits} accessibilityRole="button" testID="inspection-prep-log-permit">
                  <Text style={s.actionText}>Log this on a permit first</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <View style={s.options}>
                    {(['passed', 'failed'] as const).map((r) => (
                      <TouchableOpacity
                        key={r}
                        style={[s.option, result === r && s.optionOn]}
                        onPress={() => { setResult(r); setSavedMsg(null); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: result === r }}
                        testID={`inspection-prep-${r === 'passed' ? 'pass' : 'fail'}`}
                      >
                        <Text style={[s.optionText, result === r && s.optionTextOn]}>{r === 'passed' ? 'Pass' : 'Fail'}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {result === 'failed' ? (
                    <>
                      <Text style={s.label}>What did the inspector write?</Text>
                      <TextInput
                        style={[s.input, s.inputMulti]}
                        value={notes}
                        onChangeText={setNotes}
                        multiline
                        placeholder="The correction notice, word for word"
                        placeholderTextColor={t.textMuted}
                        accessibilityLabel="What did the inspector write?"
                        testID="inspection-prep-notes"
                      />
                      <Text style={s.label}>Inspector name (optional)</Text>
                      <TextInput
                        style={s.input}
                        value={inspectorName}
                        onChangeText={setInspectorName}
                        placeholderTextColor={t.textMuted}
                        accessibilityLabel="Inspector name (optional)"
                        testID="inspection-prep-inspector"
                      />
                    </>
                  ) : null}
                  {result && showPicker ? (
                    <>
                      <Text style={s.label}>Which permit?</Text>
                      <View style={s.options}>
                        {jobPermits.map((p) => {
                          const on = chosenPermit?.id === p.id;
                          return (
                            <TouchableOpacity
                              key={p.id}
                              style={[s.option, on && s.optionOn]}
                              onPress={() => setPermitId(p.id)}
                              accessibilityRole="button"
                              accessibilityState={{ selected: on }}
                            >
                              <Text style={[s.optionText, on && s.optionTextOn]}>{permitLabel(p)}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  ) : null}
                  {result ? (
                    <TouchableOpacity
                      style={[s.saveBtn, !chosenPermit && s.saveBtnOff]}
                      onPress={save}
                      disabled={!chosenPermit}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !chosenPermit }}
                      testID="inspection-prep-save"
                    >
                      <Text style={s.saveText}>{chosenPermit ? 'Save' : 'Pick a permit to save'}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {savedMsg ? <Text style={s.saved} testID="inspection-prep-saved">{savedMsg}</Text> : null}
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </SheetOverlay>
      {paywallOpen ? (
        <Paywall visible={paywallOpen} onClose={() => setPaywallOpen(false)} feature="Inspection Ready commonly-checked list" requiredTier="pro" />
      ) : null}
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  headerBody: { flex: 1, minWidth: 0, gap: 4 },
  sheetHeading: { ...Type.serifHeadline, color: t.text },
  authority: { ...Type.footnote, color: t.textSecondary },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  scroll: { padding: 16, gap: 14 },
  disclaimer: { ...Type.footnote, color: t.textSecondary },
  section: { ...cardSurface(t, { radius: 'lg', pad: 14 }), gap: 10 },
  sectionHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  sectionHeading: { ...Type.subheadEmphasized, color: t.text },
  empty: { ...Type.footnote, color: t.textSecondary },
  item: {
    gap: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.line,
  },
  recordChip: { ...Type.caption1, color: t.accentLabel, fontWeight: '600' as const },
  itemText: { ...Type.bodyCompact, color: t.text },
  itemTextNA: { color: t.textMuted, textDecorationLine: 'line-through' as const },
  itemWhy: { ...Type.caption1, color: t.textSecondary },
  codeRef: { ...Type.caption1, color: t.textSecondary, fontWeight: '600' as const },
  mismatch: {
    alignSelf: 'flex-start' as const,
    backgroundColor: t.dangerSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  mismatchText: { ...Type.caption1, color: t.dangerLabel, fontWeight: '600' as const },
  itemActions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, paddingTop: 2 },
  action: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    alignSelf: 'flex-start' as const,
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.line,
  },
  actionOn: { backgroundColor: t.neutralSoft },
  actionText: { ...Type.caption1, color: t.textSecondary, fontWeight: '600' as const },
  recallChip: {
    ...Type.caption1,
    alignSelf: 'flex-start' as const,
    color: t.warningLabel,
    backgroundColor: t.warningSoft,
    borderRadius: 999,
    overflow: 'hidden' as const,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontWeight: '600' as const,
  },
  groundingChip: { ...Type.caption1, color: t.textSecondary },
  proBox: { gap: 8 },
  busy: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  followUp: { gap: 6, paddingTop: 6 },
  followUpQ: { ...Type.footnoteEmphasized, color: t.text },
  options: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  option: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center' as const,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.line,
  },
  optionOn: { borderColor: t.text, backgroundColor: t.neutralSoft },
  optionText: { ...Type.footnote, color: t.textSecondary },
  optionTextOn: { color: t.text, fontWeight: '600' as const },
  label: { ...Type.footnoteEmphasized, color: t.textSecondary },
  input: {
    ...Type.bodyCompact,
    color: t.text,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputMulti: { minHeight: 96, textAlignVertical: 'top' as const },
  saveBtn: {
    alignSelf: 'flex-start' as const,
    backgroundColor: t.text,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  saveBtnOff: { opacity: 0.5 },
  saveText: { ...Type.footnoteEmphasized, color: t.bg },
  saved: { ...Type.footnote, color: t.successLabel },
});
