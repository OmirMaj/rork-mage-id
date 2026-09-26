// CodeLookSheet — Photo Code Look: ONE site photo of work about to be covered
// up, and at most five things an inspector would look at in it.
//
// Honesty rules this sheet holds (utils/codeLook.ts carries the copy):
//   - it runs only on an explicit "Look at this photo" tap — never on mount;
//   - the header line is the fixed CODE_LOOK_DISCLAIMER, never model text;
//   - an empty answer reads "Nothing flagged in what's visible." and the
//     "Can't tell from this photo" group is ALWAYS shown, at the same weight
//     as the observations;
//   - the trust label describes how clearly the thing is SEEN; a code section
//     is model recall and carries the amber recall chip (+ an edition mismatch
//     when the section names another edition than the one adopted here);
//   - nothing is sent anywhere: a punch item is an internal crew-list item.
//
// `embedded`: rendered inside another sheet's Modal tree (Inspection Ready),
// with no Modal of its own — a second presented modal over a modal is the iOS
// hazard the photo viewers avoid with a setTimeout hand-off.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, ActivityIndicator, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, ScanSearch, ListChecks, ClipboardCheck, HelpCircle, EyeOff, RefreshCw } from 'lucide-react-native';
import type { Project } from '@/types';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useHotkeys } from '@/hooks/useHotkeys';
import { appendPrepExtra } from '@/hooks/useInspectionPrepState';
import { SheetOverlay, SheetScrim, useSheetFrame } from '@/components/ui/Sheet';
import { cardSurface } from '@/components/ui';
import Paywall from '@/components/Paywall';
import { generateUUID } from '@/utils/generateId';
import { edgeErrorCode } from '@/utils/edgeError';
import { analyzePhotoCodeLook } from '@/utils/photoAnalyzer';
import {
  groundingFactsFor, jobsiteAddressForProject, resolveCodeJurisdiction,
} from '@/utils/codeJurisdiction';
import { editionMismatchFor } from '@/utils/codeAmendments';
import {
  PREP_WINDOW_DAYS,
  prepStateKey,
  upcomingInspectionsFor,
  type PrepItem,
  type UpcomingInspection,
} from '@/utils/inspectionPrep';
import {
  CODE_LOOK_DISCLAIMER,
  CODE_LOOK_RECALL_CHIP,
  codeLookContext,
  codeLookHeadline,
  codeLookToPrepItem,
  codeLookToPunch,
  trustLabel,
  type CodeLookObservation,
  type CodeLookResult,
} from '@/utils/codeLook';

export const CODE_LOOK_NEEDS_PRO = 'Code look uses AI and needs Pro';
export const CODE_LOOK_NOT_LIVE = "Code look isn't live on the server yet.";

type RunState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; result: CodeLookResult }
  | { kind: 'error'; message: string; code: string };

export interface CodeLookSheetProps {
  visible: boolean;
  onClose: () => void;
  project: Project;
  photoUri: string;
  /** The gallery photo (photos.id) when the photo is one — pins a punch to it. */
  sourcePhotoId?: string;
  trade?: string | null;
  /** The checklist lines the model checks against (from an Inspection Ready line). */
  checklist?: string[];
  inspection?: UpcomingInspection | null;
  /** Inside Inspection Ready: add the line to THAT sheet's prep state. */
  onAddToPrep?: (item: PrepItem) => void;
  /** Render without a Modal of its own (inside another sheet's Modal tree). */
  embedded?: boolean;
}

export default function CodeLookSheet({
  visible, onClose, project, photoUri, sourcePhotoId, trade, checklist, inspection, onAddToPrep, embedded = false,
}: CodeLookSheetProps) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Embedded: the host sheet already owns the frame and the dialog scope.
  const f = useSheetFrame('panel', { visible: visible && !embedded, animationType: 'slide' });
  const { permits, addPunchItem } = useProjects();
  const { canAccess } = useTierAccess();
  const canAI = canAccess('ai_code_check');

  // Esc closes the Code look. Standalone: the handler closes it (its own
  // Modal's Escape does the same — closing twice is a no-op). Embedded: listed
  // at priority 1 WITHOUT a handler — the host Modal's Escape (keyup) is routed
  // to this sheet first by the host's onRequestClose, so one Esc never closes
  // both sheets.
  useHotkeys(
    [{ combo: 'escape', handler: embedded ? undefined : onClose, priority: embedded ? 1 : 0, label: 'Close Code look' }],
    { scope: 'dialog', enabled: visible },
  );

  const resolved = useMemo(() => resolveCodeJurisdiction(jobsiteAddressForProject(project)), [project]);
  const grounding = useMemo(() => groundingFactsFor(resolved), [resolved]);
  const jurisdictionKnown = resolved.kind !== 'unknown';

  const [run, setRun] = useState<RunState>({ kind: 'idle' });
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [punched, setPunched] = useState<Record<string, true>>({});
  const [added, setAdded] = useState<Record<string, string>>({});

  // A new photo is a new look.
  useEffect(() => {
    setRun({ kind: 'idle' });
    setPunched({});
    setAdded({});
  }, [photoUri]);

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const seq = useRef(0);

  // ONLY from the explicit tap — never on mount (no auto-spend).
  const look = useCallback(async () => {
    if (!canAI) { setPaywallOpen(true); return; }
    const mine = ++seq.current;
    setRun({ kind: 'busy' });
    try {
      const result = await analyzePhotoCodeLook({
        photoUrl: photoUri,
        projectName: (project.name ?? '').trim() || undefined,
        codeLook: codeLookContext({ project, trade, checklist }),
      });
      if (!alive.current || mine !== seq.current) return;
      setRun({ kind: 'done', result });
    } catch (e) {
      if (!alive.current || mine !== seq.current) return;
      const message = e instanceof Error && e.message.trim() ? e.message.trim() : 'Code look failed.';
      setRun({ kind: 'error', message, code: edgeErrorCode(e) });
    }
  }, [canAI, photoUri, project, trade, checklist]);

  // Where "Add to inspection prep" goes when no host sheet takes it.
  const nextInspection = useMemo<UpcomingInspection | null>(() => {
    if (onAddToPrep) return inspection ?? null;
    return upcomingInspectionsFor(project, permits, new Date())[0] ?? null;
  }, [onAddToPrep, inspection, project, permits]);

  const makePunch = useCallback((o: CodeLookObservation) => {
    if (punched[o.id]) return;
    addPunchItem(codeLookToPunch(o, {
      projectId: project.id, photoUri, sourcePhotoId, now: new Date().toISOString(), newId: generateUUID,
    }));
    setPunched((p) => ({ ...p, [o.id]: true }));
  }, [punched, addPunchItem, project.id, photoUri, sourcePhotoId]);

  const [prepFull, setPrepFull] = useState<Record<string, boolean>>({});
  const addToPrep = useCallback((o: CodeLookObservation) => {
    if (added[o.id] || !nextInspection) return;
    const item = codeLookToPrepItem(o);
    if (onAddToPrep) onAddToPrep(item);
    else void appendPrepExtra(prepStateKey(nextInspection), item).then((landed) => {
      if (!landed) setPrepFull((f) => ({ ...f, [o.id]: true }));
    });
    setAdded((a) => ({ ...a, [o.id]: nextInspection.name }));
  }, [added, nextInspection, onAddToPrep]);

  const renderObservation = (o: CodeLookObservation) => {
    const mismatch = o.codeRef && jurisdictionKnown ? editionMismatchFor(resolved, o.codeRef) : null;
    const inPunch = !!punched[o.id];
    const addedTo = added[o.id];
    const prepBlocked = !nextInspection;
    return (
      <View key={o.id} style={s.item} testID={`codelook-obs-${o.id}`}>
        <Text style={s.itemText} selectable>{o.what}</Text>
        {o.whereInPhoto ? <Text style={s.itemMeta}>{`where: ${o.whereInPhoto}`}</Text> : null}
        <Text style={s.itemMeta}>{[o.family, o.topic].filter(Boolean).join(' · ')}</Text>
        <Text style={s.trust}>{trustLabel(o.confidence)}</Text>
        {o.codeRef ? (
          <View style={s.refRow}>
            <Text style={s.codeRef}>{o.codeRef}</Text>
            <Text style={s.recallChip}>{CODE_LOOK_RECALL_CHIP}</Text>
          </View>
        ) : null}
        {mismatch ? (
          <View style={s.mismatch}>
            <Text style={s.mismatchText}>{mismatch.label}</Text>
          </View>
        ) : null}
        <View style={s.itemActions}>
          <TouchableOpacity
            style={s.action}
            onPress={() => makePunch(o)}
            disabled={inPunch}
            accessibilityRole="button"
            accessibilityState={{ disabled: inPunch }}
            testID={`codelook-punch-${o.id}`}
          >
            <ListChecks size={13} color={t.textSecondary} strokeWidth={1.75} />
            <Text style={s.actionText}>{inPunch ? 'In punch (internal)' : 'Make punch item'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.action}
            onPress={() => addToPrep(o)}
            disabled={!!addedTo || prepBlocked}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!addedTo || prepBlocked }}
            testID={`codelook-prep-add-${o.id}`}
          >
            <ClipboardCheck size={13} color={t.textSecondary} strokeWidth={1.75} />
            <Text style={s.actionText}>
              {addedTo
                ? (prepFull[o.id] ? `Not added: ${addedTo}'s Code look list is full` : `Added to ${addedTo} prep on this device`)
                : prepBlocked
                  ? `No inspection in the next ${PREP_WINDOW_DAYS} days to add it to`
                  : 'Add to inspection prep'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const body = (
    <View
      style={[s.container, embedded ? StyleSheet.absoluteFill : null, { paddingTop: embedded || Platform.OS === 'ios' ? 8 : insets.top + 8 }, embedded ? null : f.card]}
      testID="codelook-sheet"
    >
      <View style={s.header}>
        <View style={s.headerBody}>
          <Text style={s.sheetHeading}>Code look</Text>
          <Text style={s.disclaimer} testID="codelook-disclaimer">{CODE_LOOK_DISCLAIMER}</Text>
          <Text style={s.groundingChip}>{grounding.chipLabel}</Text>
        </View>
        <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Close" testID="codelook-close">
          <X size={18} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}>
        <Image source={{ uri: photoUri }} style={s.thumb} resizeMode="cover" accessibilityLabel="The photo to look at" />

        {!canAI ? (
          <View style={s.section}>
            <Text style={s.empty} testID="codelook-needs-pro">{CODE_LOOK_NEEDS_PRO}</Text>
            <TouchableOpacity style={s.action} onPress={() => setPaywallOpen(true)} accessibilityRole="button" testID="codelook-see-pro">
              <Text style={s.actionText}>See Pro</Text>
            </TouchableOpacity>
          </View>
        ) : run.kind === 'idle' ? (
          <TouchableOpacity style={s.primary} onPress={() => { void look(); }} accessibilityRole="button" testID="codelook-run">
            <ScanSearch size={16} color={t.bg} strokeWidth={1.75} />
            <Text style={s.primaryText}>Look at this photo</Text>
          </TouchableOpacity>
        ) : run.kind === 'busy' ? (
          <View style={s.busy} testID="codelook-busy">
            <ActivityIndicator size="small" color={t.textSecondary} />
            <Text style={s.empty}>Looking at the photo…</Text>
          </View>
        ) : run.kind === 'error' ? (
          <View style={s.section} testID="codelook-error">
            <Text style={s.empty}>
              {run.code === 'unknown_task' || /^task must be/i.test(run.message) ? CODE_LOOK_NOT_LIVE : run.message}
            </Text>
            {run.code === 'monthly_cap_reached' ? (
              <TouchableOpacity style={s.action} onPress={() => setPaywallOpen(true)} accessibilityRole="button" testID="codelook-see-plans">
                <Text style={s.actionText}>See plans</Text>
              </TouchableOpacity>
            ) : run.code === 'unknown_task' ? null : (
              <TouchableOpacity style={s.action} onPress={() => { void look(); }} accessibilityRole="button" testID="codelook-retry">
                <RefreshCw size={13} color={t.textSecondary} strokeWidth={1.75} />
                <Text style={s.actionText}>Try again</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            <Text style={s.headline} testID="codelook-headline">{codeLookHeadline(run.result)}</Text>
            {run.result.observations.length > 0 ? (
              <View style={s.section} testID="codelook-observations">
                <View style={s.sectionHead}>
                  <ScanSearch size={15} color={t.accentLabel} strokeWidth={1.75} />
                  <Text style={s.sectionHeading}>What an inspector would look at</Text>
                </View>
                {run.result.observations.map(renderObservation)}
              </View>
            ) : null}
            {run.result.checkOnSite.length > 0 ? (
              <View style={s.section} testID="codelook-check-on-site">
                <View style={s.sectionHead}>
                  <HelpCircle size={15} color={t.warningLabel} strokeWidth={1.75} />
                  <Text style={s.sectionHeading}>Check on site</Text>
                </View>
                {run.result.checkOnSite.map(renderObservation)}
              </View>
            ) : null}
            <View style={s.section} testID="codelook-cant-tell">
              <View style={s.sectionHead}>
                <EyeOff size={15} color={t.textSecondary} strokeWidth={1.75} />
                <Text style={s.sectionHeading}>Can&apos;t tell from this photo</Text>
              </View>
              {run.result.cantTell.map((c, i) => (
                <View key={`${i}_${c.what}`} style={s.item}>
                  <Text style={s.itemText} selectable>{c.what}</Text>
                  {c.betterShot ? <Text style={s.itemMeta}>{`Better shot: ${c.betterShot}`}</Text> : null}
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );

  const paywall = paywallOpen ? (
    <Paywall visible={paywallOpen} onClose={() => setPaywallOpen(false)} feature="Photo Code Look" requiredTier="pro" />
  ) : null;

  if (embedded) {
    return (
      <>
        {body}
        {paywall}
      </>
    );
  }

  return (
    <Modal visible={visible} animationType={f.animationType} presentationStyle="pageSheet" transparent={f.transparent} onRequestClose={onClose}>
      <SheetOverlay frame={f}>
        <SheetScrim frame={f} onPress={onClose} />
        {body}
      </SheetOverlay>
      {paywall}
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
  disclaimer: { ...Type.footnote, color: t.textSecondary },
  groundingChip: { ...Type.caption1, color: t.textSecondary },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  scroll: { padding: 16, gap: 14 },
  thumb: { width: '100%', height: 200, borderRadius: 10, backgroundColor: t.neutralSoft },
  section: { ...cardSurface(t, { radius: 'lg', pad: 14 }), gap: 10 },
  sectionHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  sectionHeading: { ...Type.subheadEmphasized, color: t.text },
  headline: { ...Type.bodyCompact, color: t.text, fontWeight: '600' as const },
  empty: { ...Type.footnote, color: t.textSecondary },
  busy: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  item: {
    gap: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.line,
  },
  itemText: { ...Type.bodyCompact, color: t.text },
  itemMeta: { ...Type.caption1, color: t.textSecondary },
  trust: { ...Type.caption1, color: t.text, fontWeight: '600' as const },
  refRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: 6 },
  codeRef: { ...Type.caption1, color: t.textSecondary, fontWeight: '600' as const },
  recallChip: {
    ...Type.caption1,
    color: t.warningLabel,
    backgroundColor: t.warningSoft,
    borderRadius: 999,
    overflow: 'hidden' as const,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontWeight: '600' as const,
  },
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
  actionText: { ...Type.caption1, color: t.textSecondary, fontWeight: '600' as const },
  primary: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: t.text,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    minHeight: 44,
  },
  primaryText: { ...Type.footnoteEmphasized, color: t.bg },
});
