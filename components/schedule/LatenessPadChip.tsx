// components/schedule/LatenessPadChip.tsx — "+2d for Acme Framing", with the
// evidence, offered on a task assigned to a sub who runs over plan.
//
// Modeled on PaceChip. The engine is utils/pace/partyLateness.ts; this file is
// every surface of it, so all its copy lives in one place:
//   • LatenessPadChip       — the offer (tap = apply) or, once applied, the
//                             quiet provenance line with an Undo link.
//   • LatenessPadNote       — the quiet line alone, for a padded task's row.
//   • TaskEditorLatenessPad — the Schedule tab's task editor, under the sub
//                             picker. Owns the lateness + pace memos so the
//                             5,000-line screen only passes what it has.
//   • SubLatenessRow        — "Runs long?" on a sub's scorecard card, with the
//                             per-sub "Suggest extra days" switch.
//   • SupplierAdvisoryLine  — one warning line on a new delivery when the
//                             supplier has run late before (no schedule change).
//
// HONESTY: nothing here applies on its own. The applied state reflects the
// local draft only; the schedule save keeps its own confirmation. No AI is
// involved, so the provenance reads "From your records". Warning tokens
// (warningSoft / warningLabel), never accent as a background, no hex.
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { Clock } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useT } from '@/contexts/LanguageContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAutonomy } from '@/hooks/useAutonomy';
import type { Contact, Project, ScheduleTask, Subcontractor } from '@/types';
import { buildPaceBook, lookupPace } from '@/utils/pace/paceBook';
import { tradeKeyForTask } from '@/utils/scheduleColors';
import {
  buildPartyLateness, latenessPadFor, padRecordFor, readLatenessPad, LATE_MIN_JOBS,
  type PartyLateness, type PendingLatenessPad, type SupplierAdvisory,
} from '@/utils/pace/partyLateness';

/** 2 → "2", 2.5 → "2.5". Medians of an even count can land on a half. */
function fmtDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** The entry a task's assignee resolves to (its own id, or a legacy Contact
 *  id that maps to exactly one sub). */
export function latenessEntryFor(
  map: Map<string, PartyLateness>,
  assignedSubId: string | undefined | null,
): PartyLateness | undefined {
  if (!assignedSubId) return undefined;
  return map.get(assignedSubId) ?? [...map.values()].find(e => e.attributedIds.includes(assignedSubId));
}

// ── the chip ──────────────────────────────────────────────────────────────

interface LatenessPadChipProps {
  padDays: number;
  subName: string;
  medianOverrunDays: number;
  jobs: number;
  residualOfPace: boolean;
  /** The trade whose usual pace was subtracted (residualOfPace). */
  paceTrade?: string | null;
  onApply: () => void;
  /** Applied: render the quiet provenance line with an Undo link. */
  applied?: boolean;
  onRevert?: () => void;
}

export default function LatenessPadChip({
  padDays, subName, medianOverrunDays, jobs, residualOfPace, paceTrade, onApply, applied, onRevert,
}: LatenessPadChipProps) {
  const { t, tn } = useT();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (applied) {
    return (
      <LatenessPadNote days={padDays} subName={subName} onRevert={onRevert} />
    );
  }

  const evidence = residualOfPace && paceTrade
    ? tn('schedule.lateness.evidenceResidual', medianOverrunDays, {
      one: 'Ran a median {median} working day over plan on your last {jobs} jobs, {days} beyond your usual {trade} pace.',
      other: 'Ran a median {median} working days over plan on your last {jobs} jobs, {days} beyond your usual {trade} pace.',
    }, { median: fmtDays(medianOverrunDays), jobs, days: padDays, trade: paceTrade })
    : tn('schedule.lateness.evidence', medianOverrunDays, {
      one: 'Ran a median {median} working day over plan on your last {jobs} jobs.',
      other: 'Ran a median {median} working days over plan on your last {jobs} jobs.',
    }, { median: fmtDays(medianOverrunDays), jobs });
  const title = t('schedule.lateness.offer', 'Add {days}d for {sub}', { days: padDays, sub: subName });

  return (
    <TouchableOpacity
      style={styles.chip}
      onPress={onApply}
      activeOpacity={0.8}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${evidence}`}
      testID="lateness-pad-chip"
    >
      <Clock size={12} color={colors.warningLabel} strokeWidth={2} />
      <View style={styles.chipBody}>
        <Text style={styles.chipTitle}>{title}</Text>
        <Text style={styles.chipEvidence}>{evidence}</Text>
        <Text style={styles.chipSource}>{t('schedule.lateness.fromRecords', 'From your records')}</Text>
      </View>
    </TouchableOpacity>
  );
}

/** "+2d for Acme Framing's track record", and an Undo link when one is wired. */
export function LatenessPadNote({ days, subName, onRevert }: { days: number; subName: string; onRevert?: () => void }) {
  const { t } = useT();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.noteRow} testID="lateness-pad-note">
      <Text style={styles.noteText}>
        {t('schedule.lateness.applied', "+{days}d for {sub}'s track record", { days, sub: subName })}
      </Text>
      {onRevert ? (
        <TouchableOpacity
          onPress={onRevert}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('schedule.lateness.undoA11y', 'Remove the {days} extra days', { days })}
          testID="lateness-pad-undo"
        >
          <Text style={styles.noteLink}>{t('schedule.lateness.undo', 'Undo')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── the task editor (Schedule tab) ────────────────────────────────────────

interface TaskEditorLatenessPadProps {
  projects: Project[];
  subcontractors: Subcontractor[];
  contacts: Contact[];
  /** The task being edited, or null for a new task. */
  editingTask: ScheduleTask | null;
  draft: {
    title: string;
    phase: string;
    durationDays: string;
    isMilestone: boolean;
    assignedSubId: string;
    latenessPad?: PendingLatenessPad;
  };
  sqft: number | undefined;
  /** Apply: the padded duration (as the field's text) and the pending pad. */
  onApply: (durationDays: string, pending: PendingLatenessPad) => void;
  /** Undo a pad applied in this editor session. */
  onUndoPending: () => void;
  /** Remove a saved pad: the duration goes down by it, which clears it on save. */
  onRemoveStored: (durationDays: string) => void;
}

export function TaskEditorLatenessPad({
  projects, subcontractors, contacts, editingTask, draft, sqft, onApply, onUndoPending, onRemoveStored,
}: TaskEditorLatenessPadProps) {
  const { delayEvents } = useProjects();
  const { prefs } = useAutonomy();
  const lateness = useMemo(
    () => buildPartyLateness({ projects, subcontractors, contacts, delayEvents }),
    [projects, subcontractors, contacts, delayEvents],
  );
  const paceBook = useMemo(() => buildPaceBook(projects), [projects]);
  const offSubIds = useMemo(() => new Set(prefs.lateness_pad_off ?? []), [prefs.lateness_pad_off]);

  if (!draft.assignedSubId) return null;
  const entry = latenessEntryFor(lateness, draft.assignedSubId);
  if (!entry) return null;
  const dur = parseInt(draft.durationDays, 10);
  if (!Number.isFinite(dur)) return null;

  // Applied in this session, and the duration still holds it.
  const pending = draft.latenessPad;
  if (pending && pending.pad.subId === entry.subId && dur === pending.appliedDuration) {
    return <LatenessPadNote days={pending.pad.days} subName={entry.subName} onRevert={onUndoPending} />;
  }
  // Saved on the task, same sub, duration not edited down.
  const stored = readLatenessPad(editingTask);
  if (stored && editingTask && stored.subId === entry.subId && dur >= editingTask.durationDays) {
    return (
      <LatenessPadNote
        days={stored.days}
        subName={entry.subName}
        onRevert={() => onRemoveStored(String(Math.max(1, dur - stored.days)))}
      />
    );
  }

  const draftAsTask = {
    ...(editingTask ?? {}),
    id: editingTask?.id ?? 'draft',
    title: draft.title,
    phase: draft.phase,
    durationDays: dur,
    isMilestone: draft.isMilestone,
    assignedSubId: draft.assignedSubId,
  } as ScheduleTask;
  const paceEntry = lookupPace(paceBook, tradeKeyForTask(draftAsTask), sqft);
  const s = latenessPadFor(entry, draftAsTask, { paceEntry, offSubIds });
  if (!s) return null;
  return (
    <LatenessPadChip
      padDays={s.padDays}
      subName={entry.subName}
      medianOverrunDays={s.medianOverrunDays}
      jobs={s.jobs}
      residualOfPace={s.residualOfPace}
      paceTrade={s.paceTrade}
      onApply={() => onApply(String(dur + s.padDays), { pad: padRecordFor(entry.subId, s), appliedDuration: dur + s.padDays })}
    />
  );
}

// ── the scorecard row ─────────────────────────────────────────────────────

export function SubLatenessRow({
  entry, suggestOn, onToggle,
}: { entry: PartyLateness | undefined; suggestOn: boolean; onToggle: (on: boolean) => void }) {
  const { t, tn } = useT();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const jobs = entry?.jobsMeasured ?? 0;
  let line: string;
  if (entry?.status === 'learned' && entry.medianOverrunDays !== null) {
    line = tn('schedule.lateness.rowLearned', entry.medianOverrunDays, {
      one: 'Ran a median {days} working day over plan on your last {jobs} jobs ({tasks} tasks).',
      other: 'Ran a median {days} working days over plan on your last {jobs} jobs ({tasks} tasks).',
    }, { days: fmtDays(entry.medianOverrunDays), jobs, tasks: entry.tasksMeasured });
  } else if (entry?.status === 'on_plan') {
    line = t('schedule.lateness.rowOnPlan', 'Finished on plan across your last {jobs} jobs.', { jobs });
  } else {
    line = t('schedule.lateness.rowNotEnough', 'Not enough history yet — {have} of {need} finished jobs with start and finish dates.', {
      have: jobs, need: LATE_MIN_JOBS,
    });
  }
  const excused = entry && entry.status !== 'not_enough_history' && entry.excusedTasks > 0
    ? tn('schedule.lateness.rowExcused', entry.excusedTasks, {
      one: "{count} task left out because a logged delay was not this sub's doing.",
      other: "{count} tasks left out because logged delays were not this sub's doing.",
    })
    : null;
  const switchLabel = t('schedule.lateness.switch', 'Suggest extra days for this sub');
  return (
    <View style={styles.subRow} testID="sub-lateness-row">
      <View style={styles.subRowTop}>
        <Text style={styles.subRowLabel}>{t('schedule.lateness.rowLabel', 'Runs long?')}</Text>
        <Text style={styles.subRowSource}>{t('schedule.lateness.fromRecords', 'From your records')}</Text>
      </View>
      <Text style={styles.subRowDetail}>{line}</Text>
      {excused ? <Text style={styles.subRowDetail}>{excused}</Text> : null}
      <View style={styles.subRowSwitch}>
        <Text style={styles.subRowSwitchLabel}>{switchLabel}</Text>
        <Switch
          value={suggestOn}
          onValueChange={onToggle}
          trackColor={{ false: colors.line, true: colors.accent }}
          accessibilityLabel={switchLabel}
          testID="sub-lateness-switch"
        />
      </View>
    </View>
  );
}

// ── suppliers: advisory only ──────────────────────────────────────────────

export function SupplierAdvisoryLine({ advisory }: { advisory: SupplierAdvisory | null }) {
  const { tn } = useT();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!advisory) return null;
  return (
    <View style={styles.supplierLine} testID="delivery-supplier-advisory">
      <Clock size={12} color={colors.warningLabel} strokeWidth={2} />
      <Text style={styles.supplierText}>
        {tn('schedule.lateness.supplierLate', advisory.avgSlipDays, {
          one: '{supplier} was late on {late} of their last {n} loads, by {avg} day on average.',
          other: '{supplier} was late on {late} of their last {n} loads, by {avg} days on average.',
        }, { supplier: advisory.supplier, late: advisory.late, n: advisory.loads, avg: fmtDays(advisory.avgSlipDays) })}
      </Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  chip: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6,
    alignSelf: 'flex-start' as const, maxWidth: '100%' as const,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.md,
    backgroundColor: c.warningSoft, marginTop: 4,
  },
  chipBody: { flexShrink: 1, gap: 1 },
  chipTitle: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: c.warningLabel },
  chipEvidence: { fontSize: Type.caption2.fontSize, lineHeight: Type.caption1.lineHeight, color: c.warningLabel },
  chipSource: { fontSize: Type.caption2.fontSize, color: c.textMuted, marginTop: 1 },
  noteRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 3, flexWrap: 'wrap' as const },
  noteText: { fontSize: Type.caption2.fontSize, color: c.textMuted, fontWeight: '600' as const },
  noteLink: { fontSize: Type.caption2.fontSize, color: c.textSecondary, fontWeight: '700' as const, textDecorationLine: 'underline' as const },
  subRow: { gap: 5 },
  subRowTop: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  subRowLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: c.text },
  subRowSource: { fontSize: Type.caption2.fontSize, color: c.textMuted, fontWeight: '600' as const },
  subRowDetail: { fontSize: Type.caption1.fontSize, color: c.textMuted, lineHeight: Type.caption1.lineHeight },
  subRowSwitch: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 8 },
  subRowSwitchLabel: { flex: 1, fontSize: Type.caption1.fontSize, color: c.textSecondary, fontWeight: '600' as const },
  supplierLine: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.md,
    backgroundColor: c.warningSoft, marginTop: 6,
  },
  supplierText: { flex: 1, fontSize: Type.caption1.fontSize, lineHeight: Type.caption1.lineHeight, color: c.warningLabel },
});
