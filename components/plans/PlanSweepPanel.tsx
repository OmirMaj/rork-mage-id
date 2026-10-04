// components/plans/PlanSweepPanel.tsx — Plan Set Code Sweep: "sweep my plans
// for questions in my scope".
//
// Two taps, each saying what it costs before it spends anything:
//   A. "Find the sheets for my scope" — one plan search per scope topic. He sees
//      which sheets were picked, and which were NOT and why, before any plan
//      review is spent.
//   B. "Review these N sheets" — one AI plan pre-check per picked sheet, against
//      his monthly plan-review allowance.
// Every finding is a QUESTION FOR THE ARCHITECT with the model's words
// neutralised, every citation is labelled as the AI's recall, and "Draft RFI to
// architect" creates an UNSENT draft (app/rfi.tsx's Send tap is the only send).
//
// Nothing runs on mount: the tier comes from useTierAccess (local), the topics
// from the pure scopeTargetsFor. Nothing is saved: the sweep lives here until
// the sheet closes, and the panel says so.
//
// Code cards (lane CCWIRE, 2026-10-03): once sheets are reviewed, every row is
// ALSO a code card in one list above the per-sheet findings: the headline, the
// tally, By status (Fix / Needs an answer / Look right) and By inspection, and
// the opened card with its actions. A finding is 'ask' unless the server
// marked it 'fix'; only the server's separate "look right" rows are 'ok', and
// those never get a question, an RFI draft or a punch item. The per-sheet
// findings below (rung, mismatch, Draft RFI, Add punch item) are unchanged.
// The sweep itself is still not kept; a card he pins to an inspection
// checklist or saves is kept by the code-card stores on this device, because
// he asked for that. Recall is neutral grey here too (founder decision), so
// amber is left for the edition mismatch, a real warning.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Info, Lock, MapPin, Search, MessageSquare, FileText, ListChecks } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTierAccess, FEATURE_LIMITS } from '@/hooks/useTierAccess';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button, Card } from '@/components/ui';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { PLAN_REVIEW_DISCLAIMER, type PlanCodeFindingRaw } from '@/utils/planCodeReviewer';
import { groundingFactsFor, jurisdictionQueryForProject, resolveCodeJurisdiction } from '@/utils/codeJurisdiction';
import { projectTypeLabel } from '@/utils/projectTypes';
import { sheetAttachmentFor } from '@/utils/plans/revisionActions';
import { generateUUID } from '@/utils/generateId';
import {
  scopeTargetsFor, sweepFindingView, sweepCitation, rfiFromSweepFinding, punchFromSweepFinding, sweepCopy, type NotReviewedSheet, type SweepFindingView,
} from '@/utils/plans/planSweep';
import { findSweepSheets, reviewSweepSheets, type FindSweepResult, type ReviewSweepResult } from '@/utils/plans/planSweepRun';
import type { PlanSheet, Project } from '@/types';
import { describeError } from '@/utils/errorCopy';
import { showAlert } from '@/utils/alert';
import { formatCalendarDay, todayCalendarDay } from '@/utils/calendarDate';
import { bookedStageDays } from '@/utils/inspectionPrep';
import { CodeCardList } from '@/components/codeCard/CodeCardList';
import { blockedAction, doneAction, readyAction } from '@/components/codeCard/parts';
import type { CodeCardItem, CodeStage } from '@/utils/codeCard/types';
import { parseCodeCardItem } from '@/utils/codeCard/parse';
import { passesEchoCheck } from '@/utils/codeCard/echoCheck';
import { codeJurisdictionInfoFor } from '@/utils/codeCard/jurisdiction';
import { pinnedStage } from '@/utils/codeCard/pins';
import { isSaved } from '@/utils/codeCard/saved';
import { architectMessageFor, mailtoUrlFor } from '@/utils/codeCard/shareText';
import { addAllLabel, architectButtonLabel, ARCHITECT_BLOCKED } from '@/utils/codeCard/summary';
import {
  sweepCardItem, useCodeCardWiring, usePermitOfficeAnswer, withContentIds,
} from '@/components/construction/AskConstructionMode';

interface Props {
  project: Project;
  sheets: PlanSheet[];
  /** Where the free-tier upgrade link goes. */
  onUpgrade?: () => void;
  /** Closes the sheet this panel sits in — used before opening a drafted RFI,
   *  so the RFI screen is not left underneath an open modal. */
  onClose?: () => void;
}

type Phase = 'idle' | 'finding' | 'found' | 'reviewing' | 'done';

const sheetNo = (s: PlanSheet) => (s.sheetNumber ?? '').trim() || s.name || 'Sheet';

/** The server's separate "look right" rows for one reviewed sheet (code-card
 *  responses only; an older server, or a request without the flag, sends none). */
function lookRightRows(reviewed: unknown): PlanCodeFindingRaw[] {
  const raw = (reviewed as { lookRight?: unknown } | null)?.lookRight;
  return Array.isArray(raw) ? raw.filter((x): x is PlanCodeFindingRaw => !!x && typeof x === 'object') : [];
}

/** "Punch item added — …. Open punch list" → the sentence and the link words. */
const OPEN_PUNCH = 'Open punch list';
const withoutLink = (s: string) => (s.endsWith(OPEN_PUNCH) ? s.slice(0, -OPEN_PUNCH.length).trimEnd() : s);

export default function PlanSweepPanel({ project, sheets, onUpgrade, onClose }: Props) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { tier, isProOrAbove } = useTierAccess();
  const { addRFI, addDrawingPin, addPunchItem, permits } = useProjects();
  const { user } = useAuth();

  const current = useMemo(() => sheets.filter(s => !s.superseded), [sheets]);
  const scope = useMemo(() => scopeTargetsFor({
    lines: project.linkedEstimate?.items ?? [],
    scopeNotes: [project.scope?.scope, project.scope?.specialRequirements, project.description],
    projectType: project.type,
    jobKind: project.type === 'commercial' ? 'commercial' : 'residential',
  }), [project]);
  const jurisdiction = useMemo(() => resolveCodeJurisdiction(jurisdictionQueryForProject(project)), [project]);
  const grounding = useMemo(() => groundingFactsFor(jurisdiction), [jurisdiction]);
  const monthlyCap = FEATURE_LIMITS.ai_plan_review_monthly[tier];

  const [phase, setPhase] = useState<Phase>('idle');
  const [found, setFound] = useState<FindSweepResult | null>(null);
  const [review, setReview] = useState<ReviewSweepResult | null>(null);
  const [progress, setProgress] = useState<{ label: string; i: number; n: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafted, setDrafted] = useState<Record<string, { rfiId: string; number: number }>>({});
  const [punched, setPunched] = useState<Record<string, { pinned: boolean }>>({});
  const punchedRef = useRef<Record<string, true>>({});
  const abort = useRef<{ aborted: boolean }>({ aborted: false });
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; abort.current.aborted = true; }, []);

  const onFind = useCallback(async () => {
    abort.current = { aborted: false };
    setPhase('finding'); setFound(null); setReview(null); setError(null); setDrafted({}); setPunched({}); punchedRef.current = {};
    try {
      const out = await findSweepSheets({
        projectId: project.id, sheets, targets: scope.targets, userId: user?.id, monthlyCap, signal: abort.current,
      });
      if (!mounted.current) return;
      setFound(out);
      setPhase(out.state === 'ready' ? 'found' : 'idle');
    } catch (e) {
      if (!mounted.current) return;
      console.warn('[plan-sweep] search failed:', e instanceof Error ? e.message : e);
      setError(describeError(e, { action: 'search the plans' }).body);
      setPhase('idle');
    }
  }, [project.id, sheets, scope.targets, user?.id, monthlyCap]);

  const onReview = useCallback(async () => {
    if (found?.state !== 'ready') return;
    abort.current = { aborted: false };
    setPhase('reviewing'); setError(null);
    try {
      const out = await reviewSweepSheets({
        selected: found.selected,
        limit: found.allowance.limit,
        location: project.location,
        projectType: projectTypeLabel(project) || undefined,
        jurisdictionBlock: grounding.promptBlock,
        onProgress: (label, i, n) => { if (mounted.current) setProgress({ label, i, n }); },
        signal: abort.current,
      });
      if (!mounted.current) return;
      setReview(out);
      setPhase('done');
    } catch (e) {
      if (!mounted.current) return;
      console.warn('[plan-sweep] review failed:', e instanceof Error ? e.message : e);
      setError(describeError(e, { action: 'review the plan sheets' }).body);
      setPhase('found');
    } finally {
      if (mounted.current) setProgress(null);
    }
  }, [found, project, grounding.promptBlock]);

  const onDraft = useCallback((sheet: PlanSheet, view: SweepFindingView, key: string) => {
    if (drafted[key]) return;
    const rfi = addRFI(rfiFromSweepFinding(sheet, view, new Date(), sheetAttachmentFor(sheet)));
    if (view.location) {
      addDrawingPin({
        planSheetId: sheet.id, projectId: project.id, x: view.location.x, y: view.location.y,
        kind: 'rfi', label: view.title, linkedRfiId: rfi.id,
      });
    }
    setDrafted(d => ({ ...d, [key]: { rfiId: rfi.id, number: rfi.number } }));
  }, [drafted, addRFI, addDrawingPin, project.id]);

  // One punch item per finding: the ref guards a double tap inside one render.
  // The pin is written only when the AI placed the finding — never invented.
  const onPunch = useCallback((sheet: PlanSheet, view: SweepFindingView, key: string) => {
    if (punchedRef.current[key]) return;
    punchedRef.current[key] = true;
    const punch = punchFromSweepFinding(sheet, view, generateUUID(), new Date().toISOString());
    addPunchItem(punch);
    if (view.location) {
      addDrawingPin({
        planSheetId: sheet.id, projectId: project.id, x: view.location.x, y: view.location.y,
        kind: 'punch', label: view.title, linkedPunchItemId: punch.id,
      });
    }
    setPunched(p => ({ ...p, [key]: { pinned: !!view.location } }));
  }, [addPunchItem, addDrawingPin, project.id]);

  const openPunchList = useCallback(() => {
    onClose?.();
    router.push({ pathname: '/punch-list', params: { projectId: project.id } });
  }, [onClose, router, project.id]);

  const openRfi = useCallback((rfiId: string) => {
    onClose?.();
    router.push({ pathname: '/rfi', params: { projectId: project.id, rfiId } });
  }, [onClose, router, project.id]);

  // ── Code cards: every reviewed row as a card (lane CCWIRE) ──
  const sweepCards = useMemo<CodeCardItem[]>(() => {
    if (!review) return [];
    const out: CodeCardItem[] = [];
    for (const r of review.reviewed) {
      const sheet = { id: r.sheet.id, label: sheetNo(r.sheet) };
      const add = (rows: readonly PlanCodeFindingRaw[], lookRight: boolean) => rows.forEach((f, i) => {
        // The sweep's own view: every model word is neutralised there first.
        const view = sweepFindingView(f, r.sheet, jurisdiction);
        out.push(sweepCardItem(
          f as unknown as Record<string, unknown>,
          { question: (f.question ?? '').trim() ? view.title : '', requirement: view.requirement, observed: view.observed },
          sweepCitation({ codeRef: view.citation, citedEdition: f.citedEdition, section: f.section }),
          view.rung,
          sheet,
          i,
          lookRight,
          parseCodeCardItem,
          passesEchoCheck,
        ));
      });
      add(r.findings, false);
      add(lookRightRows(r), true);
    }
    return withContentIds('sweep', out);
  }, [review, jurisdiction]);
  const permitAnswer = usePermitOfficeAnswer(project, sweepCards.length > 0);
  const cardInfo = useMemo(() => codeJurisdictionInfoFor(jurisdiction, permitAnswer, null), [jurisdiction, permitAnswer]);
  const wiring = useCodeCardWiring({ project, info: cardInfo, testID: 'plansweep-cards' });
  const booked = useMemo<Partial<Record<CodeStage, string | null>>>(() => {
    const out: Partial<Record<CodeStage, string | null>> = {};
    if (sweepCards.length === 0) return out;
    const days = bookedStageDays(permits, project.id, todayCalendarDay());
    for (const [stage, day] of Object.entries(days) as [CodeStage, string][]) {
      out[stage] = formatCalendarDay(day, { weekday: 'short', month: 'short', day: 'numeric' });
    }
    return out;
  }, [permits, project.id, sweepCards.length]);
  const reviewedLabel = useMemo(() => (review?.reviewed ?? []).map((r) => sheetNo(r.sheet)).join(', '), [review]);
  // His own Mail opens with the fixes and questions; nothing is sent from here.
  const sendToArchitect = useCallback(() => {
    const msg = architectMessageFor(sweepCards, { jobLabel: project.name, sheetLabel: reviewedLabel, info: cardInfo });
    void Linking.openURL(mailtoUrlFor('', msg.subject, msg.body)).catch(() =>
      showAlert('No mail app', 'Copy the questions into your email instead.'));
  }, [sweepCards, project.name, reviewedLabel, cardInfo]);

  // ── header + grounding (always) ──
  const header = (
    <View>
      <Text style={styles.heading}>{sweepCopy.heading}</Text>
      <Text style={styles.subheading}>{sweepCopy.subheading}</Text>
      <View style={styles.recallChip} testID="plansweep-recall-chip">
        <Info size={12} color={t.textSecondary} strokeWidth={2} />
        <Text style={styles.recallChipText}>{sweepCopy.recallLine}</Text>
      </View>
      <Text style={styles.meta} testID="plansweep-edition">{`${sweepCopy.editionPrefix}${grounding.chipLabel}`}</Text>
      <Text style={styles.meta}>{sweepCopy.notPlanReview}</Text>
    </View>
  );
  const footer = <Text style={styles.footerNote} testID="plansweep-disclaimer">{PLAN_REVIEW_DISCLAIMER}</Text>;

  if (!isProOrAbove) {
    return (
      <View style={styles.root} testID="plansweep-panel">
        {header}
        <View style={styles.blockedRow} testID="plansweep-blocked">
          <Lock size={14} color={t.textSecondary} strokeWidth={1.75} />
          <Text style={styles.blockedText}>{sweepCopy.freeBlocked}</Text>
        </View>
        <Button label={sweepCopy.findButton(scope.targets.length)} onPress={() => {}} disabled variant="secondary" testID="plansweep-find-disabled" />
        {onUpgrade ? (
          <TouchableOpacity onPress={onUpgrade} accessibilityRole="link" testID="plansweep-upgrade">
            <Text style={styles.link}>{sweepCopy.seePlans}</Text>
          </TouchableOpacity>
        ) : null}
        {footer}
      </View>
    );
  }

  const ready = found?.state === 'ready' ? found : null;
  const notReviewed: NotReviewedSheet[] = [...(ready?.notReviewed ?? []), ...(review?.notReviewed ?? [])];
  const reviewCount = ready ? Math.min(ready.selected.length, ready.allowance.limit) : 0;
  const busy = phase === 'finding' || phase === 'reviewing';

  return (
    <View style={styles.root} testID="plansweep-panel">
      {header}

      {/* What it looks for */}
      <View style={styles.section} testID="plansweep-targets">
        <Text style={styles.sectionLabel}>{scope.basis === 'general' ? sweepCopy.generalBasis : sweepCopy.scopeBasis}</Text>
        {scope.targets.map(tg => (
          <Text key={tg.id} style={styles.bullet}>{`• ${tg.phrase}`}</Text>
        ))}
      </View>

      {current.length === 0 ? (
        <Text style={styles.blockedText} testID="plansweep-no-sheets">{sweepCopy.noSheets}</Text>
      ) : (
        <Button
          label={phase === 'finding' ? sweepCopy.findBusy : sweepCopy.findButton(scope.targets.length)}
          onPress={() => { void onFind(); }}
          disabled={busy}
          loading={phase === 'finding'}
          variant={ready ? 'secondary' : 'primary'}
          iconLeft={<Search size={14} color={ready ? t.text : t.surface} strokeWidth={2} />}
          testID="plansweep-find"
        />
      )}

      {found?.state === 'needs_index' ? (
        <Text style={styles.blockedText} testID="plansweep-needs-index">{sweepCopy.needsIndex}</Text>
      ) : null}
      {found?.state === 'refused' ? (
        <Text style={styles.errorText} testID="plansweep-refused">{found.message}</Text>
      ) : null}
      {error ? <Text style={styles.errorText} testID="plansweep-error">{error}</Text> : null}
      {ready?.stoppedWhy ? <Text style={styles.errorText} testID="plansweep-search-stopped">{ready.stoppedWhy}</Text> : null}

      {/* Stage B: the review, costed up front */}
      {ready && phase !== 'done' ? (
        <View style={styles.section}>
          {ready.allowance.readFailed ? (
            <Text style={styles.meta} testID="plansweep-allowance-unknown">{sweepCopy.allowanceUnknown}</Text>
          ) : null}
          {reviewCount > 0 ? (
            <Button
              label={ready.allowance.readFailed
                ? sweepCopy.reviewButtonUnknown(reviewCount)
                : sweepCopy.reviewButton(reviewCount, ready.allowance.remaining ?? 0)}
              onPress={() => { void onReview(); }}
              disabled={busy}
              loading={phase === 'reviewing'}
              testID="plansweep-review"
            />
          ) : ready.selected.length > 0 || ready.allowance.remaining === 0 ? (
            <Text style={styles.blockedText} testID="plansweep-no-allowance">{sweepCopy.noAllowance}</Text>
          ) : (
            <Text style={styles.blockedText} testID="plansweep-nothing">{sweepCopy.nothingToReview}</Text>
          )}
        </View>
      ) : null}

      {progress ? (
        <View style={styles.progressRow} testID="plansweep-progress">
          <ActivityIndicator size="small" color={t.accent} />
          <Text style={styles.progressText}>{sweepCopy.progress(progress.label, progress.i, progress.n)}</Text>
          <TouchableOpacity onPress={() => { abort.current.aborted = true; }} accessibilityRole="button" testID="plansweep-cancel">
            <Text style={styles.link}>{sweepCopy.cancel}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Which sheets, and why */}
      {ready && (review ? review.reviewed.length > 0 : ready.selected.length > 0) ? (
        <View style={styles.section} testID="plansweep-chosen">
          <Text style={styles.sectionLabel}>{review ? sweepCopy.reviewedTitle : sweepCopy.toReviewTitle}</Text>
          {(review ? review.reviewed : ready.selected).map(x => (
            <View key={x.sheet.id} style={styles.sheetRow} testID={`plansweep-chosen-${x.sheet.id}`}>
              <Text style={styles.sheetNo}>{sheetNo(x.sheet)}</Text>
              {x.reasons.map(r => (
                <Text key={r.topic} style={styles.meta}>{`${sweepCopy.chosenFor} ${r.topic}: “${r.snippet}”`}</Text>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {ready ? (
        notReviewed.length > 0 ? (
          <View style={styles.section} testID="plansweep-not-reviewed">
            <Text style={styles.sectionLabel}>{sweepCopy.notReviewedTitle}</Text>
            {notReviewed.map(x => (
              <View key={x.sheet.id} style={styles.sheetRow} testID={`plansweep-not-reviewed-${x.sheet.id}`}>
                <Text style={styles.sheetNo}>{sheetNo(x.sheet)}</Text>
                <Text style={styles.meta}>{x.why}</Text>
              </View>
            ))}
          </View>
        ) : review ? (
          <Text style={styles.meta} testID="plansweep-all-reviewed">{sweepCopy.allReviewed(current.length)}</Text>
        ) : null
      ) : null}

      {/* Every reviewed row as a code card: the answer first, by status. */}
      {sweepCards.length > 0 ? (
        <View style={styles.cardList}>
          <CodeCardList
            items={sweepCards}
            info={cardInfo}
            mode="plan"
            eyebrow={sweepCards.some((c) => c.status === 'ok') ? undefined : `Result · ${sweepCards.length} to look at`}
            planSourceLabel={reviewedLabel || null}
            bookedDates={booked}
            stageOf={wiring.stageOf}
            onOpen={wiring.onOpen}
            checklistFor={wiring.checklistFor}
            askTownFor={wiring.askTownFor}
            primary={{
              key: 'architect',
              label: architectButtonLabel(sweepCards) ?? 'Send to architect',
              icon: 'send',
              action: architectButtonLabel(sweepCards) ? readyAction(sendToArchitect) : blockedAction(ARCHITECT_BLOCKED),
            }}
            secondary={[
              {
                key: 'checklists',
                label: addAllLabel(sweepCards.map((c) => ({ ...c, stage: wiring.stageOf(c) }))),
                icon: 'clip',
                action: sweepCards.every((c) => !!pinnedStage(wiring.pins, project.id, c.id))
                  ? doneAction('On the inspection checklists')
                  : readyAction(() => wiring.addAll(sweepCards)),
              },
              {
                key: 'save',
                label: 'Save',
                icon: 'save',
                action: sweepCards.every((c) => isSaved(wiring.saved, project.id, c.id))
                  ? doneAction(`Saved to ${project.name}`)
                  : readyAction(() => wiring.saveAll(sweepCards)),
              },
            ]}
            testID="plansweep-card-list"
          />
        </View>
      ) : null}
      {sweepCards.length > 0 ? wiring.overlay : null}

      {/* Findings, grouped by sheet */}
      {review && review.reviewed.some(r => r.findings.length > 0) ? (
        <Text style={styles.meta} testID="plansweep-approx-note">{sweepCopy.approxNote}</Text>
      ) : null}
      {review ? review.reviewed.map(r => (
        <Card key={r.sheet.id} pad={Tokens.spacing.sm} style={styles.sheetCard} testID={`plansweep-sheet-${r.sheet.id}`}>
          <View style={styles.inlineRow}>
            <FileText size={14} color={t.textSecondary} strokeWidth={1.75} />
            <Text style={styles.sheetNo}>{sheetNo(r.sheet)}</Text>
          </View>
          {r.findings.length === 0 ? (
            <Text style={styles.body} testID={`plansweep-none-${r.sheet.id}`}>{sweepCopy.noFindings(sheetNo(r.sheet))}</Text>
          ) : r.findings.map((f, i) => {
            const key = `${r.sheet.id}#${i}`;
            const view = sweepFindingView(f, r.sheet, jurisdiction);
            const done = drafted[key];
            const punchDone = punched[key];
            return (
              <View key={key} style={styles.findingRow} testID={`plansweep-finding-${key}`}>
                <Text style={styles.question}>{view.title}</Text>
                {view.observed ? <Text style={styles.body}>{`${sweepCopy.observed}: ${view.observed}`}</Text> : null}
                {view.requirement ? (
                  <Text style={styles.meta}>{`${view.requirementLabel}: ${view.requirement}`}</Text>
                ) : null}
                <View style={styles.inlineRow}>
                  {view.citation ? <Text style={styles.citation}>{view.citation}</Text> : null}
                  <View style={[styles.badge, view.rung.rungIndex <= 2 ? styles.badgeBacked : styles.badgeRecall]} testID={`plansweep-rung-${key}`}>
                    <Text style={[styles.badgeText, view.rung.rungIndex <= 2 ? styles.badgeBackedText : styles.badgeRecallText]}>{view.rung.badge}</Text>
                  </View>
                  {view.mismatch ? (
                    <View style={[styles.badge, styles.badgeWarn]} testID={`plansweep-mismatch-${key}`}>
                      <Text style={[styles.badgeText, styles.badgeWarnText]}>{view.mismatch.label}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.inlineRow}>
                  <MapPin size={12} color={t.textSecondary} strokeWidth={1.75} />
                  <Text style={styles.meta}>{view.where}</Text>
                </View>
                <Text style={styles.meta}>{`${sweepCopy.severity[view.severity]} · ${sweepCopy.confidence[view.confidence]}`}</Text>
                {!view.location ? <Text style={styles.meta}>{sweepCopy.noLocation}</Text> : null}
                {done ? (
                  <View style={styles.inlineRow}>
                    <Text style={styles.draftedText} testID={`plansweep-drafted-${key}`}>{sweepCopy.drafted(done.number)}</Text>
                    <TouchableOpacity onPress={() => openRfi(done.rfiId)} accessibilityRole="button" testID={`plansweep-open-rfi-${key}`}>
                      <Text style={styles.link}>{`Open RFI #${done.number}`}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Button
                    label={sweepCopy.draftRfi}
                    onPress={() => onDraft(r.sheet, view, key)}
                    variant="secondary"
                    size="sm"
                    iconLeft={<MessageSquare size={13} color={t.text} strokeWidth={1.75} />}
                    containerStyle={styles.draftBtn}
                    testID={`plansweep-draft-${key}`}
                  />
                )}
                {punchDone ? (
                  <View style={styles.inlineRow} testID={`plansweep-punched-${key}`}>
                    <Text style={styles.draftedText}>
                      {withoutLink(punchDone.pinned ? sweepCopy.punchAddedPinned : sweepCopy.punchAddedNoPin)}
                    </Text>
                    <TouchableOpacity onPress={openPunchList} accessibilityRole="link" testID={`plansweep-open-punch-${key}`}>
                      <Text style={styles.link}>{OPEN_PUNCH}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Button
                    label={sweepCopy.addPunch}
                    onPress={() => onPunch(r.sheet, view, key)}
                    variant="secondary"
                    size="sm"
                    iconLeft={<ListChecks size={13} color={t.text} strokeWidth={1.75} />}
                    containerStyle={styles.draftBtn}
                    testID={`plansweep-punch-${key}`}
                  />
                )}
              </View>
            );
          })}
        </Card>
      )) : null}

      {ready ? <Text style={styles.meta} testID="plansweep-not-saved">{sweepCopy.notSaved}</Text> : null}
      {footer}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { gap: Tokens.spacing.sm },
  heading: { ...Type.headline, color: t.text },
  subheading: { ...Type.subhead, color: t.textSecondary, marginTop: Tokens.spacing.xxs },
  recallChip: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs, alignSelf: 'flex-start',
    backgroundColor: t.neutralSoft, borderRadius: Tokens.radius.xs,
    paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.xxs, marginTop: Tokens.spacing.xs,
  },
  recallChipText: { ...Type.caption1, color: t.textSecondary, flexShrink: 1 },
  meta: { ...Type.footnote, color: t.textSecondary, marginTop: Tokens.spacing.xxs, flexShrink: 1 },
  body: { ...Type.subhead, color: t.text, marginTop: Tokens.spacing.xxs },
  section: { gap: Tokens.spacing.xxs },
  sectionLabel: { ...Type.subheadEmphasized, color: t.text },
  bullet: { ...Type.footnote, color: t.textSecondary },
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
  blockedText: { ...Type.footnote, color: t.textSecondary, flexShrink: 1 },
  errorText: { ...Type.footnote, color: t.dangerLabel },
  link: { ...Type.footnoteEmphasized, color: t.accent },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
  progressText: { ...Type.footnote, color: t.text, flex: 1 },
  sheetRow: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line,
    paddingTop: Tokens.spacing.xs, marginTop: Tokens.spacing.xxs,
  },
  sheetNo: { ...Type.subheadEmphasized, color: t.text },
  sheetCard: { marginTop: Tokens.spacing.xs },
  cardList: { marginTop: Tokens.spacing.sm },
  inlineRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xxs },
  findingRow: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line,
    marginTop: Tokens.spacing.sm, paddingTop: Tokens.spacing.sm,
  },
  question: { ...Type.subheadEmphasized, color: t.text },
  citation: { ...Type.footnoteEmphasized, color: t.text },
  badge: {
    flexDirection: 'row', alignItems: 'center', borderRadius: Tokens.radius.xs,
    paddingHorizontal: Tokens.spacing.xs, paddingVertical: 2, maxWidth: '100%',
  },
  // Recall: neutral grey (founder decision 2026-10-03, code cards). Amber is
  // kept for the edition mismatch, a real warning (badgeWarn).
  badgeRecall: { backgroundColor: t.neutralSoft },
  badgeWarn: { backgroundColor: t.warningSoft },
  badgeBacked: { backgroundColor: t.successSoft },
  badgeText: { ...Type.caption2, flexShrink: 1 },
  badgeRecallText: { color: t.textSecondary },
  badgeWarnText: { color: t.warningLabel },
  badgeBackedText: { color: t.successLabel },
  draftBtn: { alignSelf: 'flex-start', marginTop: Tokens.spacing.xs },
  draftedText: { ...Type.footnoteEmphasized, color: t.text },
  footerNote: { ...Type.caption1, color: t.textSecondary, marginTop: Tokens.spacing.sm },
});
