// components/followUp/PreventiveFollowUps.tsx — "About to go wrong".
//
// WHAT THIS IS, AND WHY IT IS NOT A SECOND SCREEN.
//
// utils/followUp/ shipped a complete derived-follow-up engine — a rule
// registry, seven honesty guards, a held/derived split — and nothing in app/
// or components/ imported a line of it. The obvious move was a /follow-ups
// route. It was the wrong one: /waiting-on is already the chase surface, is
// already reachable four ways (DesktopSidebar, discover/tools,
// DesktopActionRail, BrainWatchCard), and a second list would have rendered
// the same change order twice with two different overdue counts.
//
// So this is a SECTION on that screen, and it carries only the half of the
// engine the chase list cannot say. Every row buildChaseList produces means
// "someone is already late". Every row here means "this is about to go
// wrong" — which is a different claim, a more valuable one, and the only one
// that is still cheap to act on:
//
//   - a sub's certificate of insurance expires BEFORE the morning they are
//     booked on site, so the building turns the crew away at the dock and the
//     day is gone, along with every trade stacked behind them;
//   - a sub is on the tools with no signed contract or PO behind them, which
//     is the exposure that becomes an unwinnable payment dispute.
//
// Warnings, not chases — so they are grouped, labelled and coloured as
// warnings, and they sit ABOVE the late list because the cheap fix expires.
//
// HONESTY, which is most of this file:
//   - G2. A row whose targetBasis is 'none' has NO deadline and never renders
//     a countdown. It says so in words instead. work_started_without_commitment
//     is exactly that case: the app cannot know when the PO was due and will
//     not invent a date to shout about.
//   - G4. No name, no nudge. A row with no drafted message shows no Send
//     button, and says why, rather than a dead control.
//   - G6. A rule's first run against a nine-month-old job is quiet. Those rows
//     are marked "was already true when this check started" so an install does
//     not read as an emergency.
//   - G3. A check that did not run says so, by name and by job. "Checked 2 of
//     2" is only printed when both checks ran on every job.
//   - The COI check can only see a task with a subcontractor assigned to it,
//     and most tasks historically have none (utils/subTradeMatch.ts). The
//     count of tasks it cannot see is on screen, not in a docstring.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import {
  ShieldAlert, FileSignature, ChevronRight, Send, TriangleAlert, Link2, Info, History,
} from 'lucide-react-native';
import { cardSurface } from '@/components/ui';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { formatCalendarDay } from '@/utils/calendarDate';
import type { FollowUp, FollowUpBasis, EntityRef } from '@/types';
import type { FollowUpPortfolioRefusal, FollowUpReads } from '@/utils/followUp/engine';

/** His words for each check, for the coverage line and the row icon. */
const RULE_LABEL: Record<string, string> = {
  coi_expires_before_sub_is_on_site: 'Insurance against the schedule',
  work_started_without_commitment: 'Work started with no contract',
};

const RULE_ICON: Record<string, typeof ShieldAlert> = {
  coi_expires_before_sub_is_on_site: ShieldAlert,
  work_started_without_commitment: FileSignature,
};

/**
 * What a missing collection means to the person reading it.
 *
 * The engine's own `detail` is written for a validator run ("not loaded
 * (undefined, not empty)"). That string is correct and useless on a job site,
 * so the refusal carries the collection names as data and the sentence is
 * built here. `scheduleStartDate` is the one that will actually fire in the
 * field: a schedule with no anchor date cannot answer "before they start", and
 * the rule refuses rather than anchoring on today — the bug that once marched
 * every task on two real schedules forward a day, every day.
 */
const MISSING_COPY: Partial<Record<FollowUpReads, string>> = {
  subcontractors: 'the subcontractor roster has not loaded',
  tasks: 'the schedule has not loaded',
  scheduleStartDate: 'the schedule has no start date, so "before they start" has nothing to compare against',
  commitments: 'contracts and POs have not loaded',
  changeOrders: 'change orders have not loaded',
  rfis: 'RFIs have not loaded',
  submittals: 'submittals have not loaded',
  deliveries: 'deliveries have not loaded',
  invoices: 'invoices have not loaded',
  permits: 'permits have not loaded',
  planSheets: 'plan sheets have not loaded',
  contacts: 'contacts have not loaded',
};

/** The grounding chip, in words. Never claims a date the record did not give. */
function basisLine(basis: FollowUpBasis, targetDate: string | undefined): string {
  const on = targetDate ? formatCalendarDay(targetDate, { month: 'short', day: 'numeric' }) : null;
  switch (basis.kind) {
    case 'stated':
      return on ? `${on} — from ${basis.field}` : `From ${basis.field}, which has no date on it`;
    case 'derived':
      return on ? `${on} — derived from ${basis.from}` : `Derived from ${basis.from}`;
    case 'learned':
      return on
        ? `${on} — learned from ${basis.n} past ${basis.of}`
        : `Learned from ${basis.n} past ${basis.of}`;
    case 'none':
      // G2 in prose. There is no deadline here, so there is nothing to be late
      // for, and the row must not borrow urgency it has not earned.
      return 'No deadline — nobody is late. This is exposure, not a due date.';
  }
}

/**
 * The countdown, or nothing.
 *
 * `daysOverdue` is null whenever the basis is 'none' (guard G2), and negative
 * when the target date has not arrived — which is the NORMAL case here, since
 * these are warnings. "12d left" and "3d ago" are the two real readings; a
 * single "late" label would have been a lie on most rows.
 */
function countdown(daysOverdue: number | null): { value: string; label: string } | null {
  if (daysOverdue === null) return null;
  if (daysOverdue === 0) return { value: 'today', label: '' };
  const n = Math.abs(daysOverdue);
  return daysOverdue > 0
    ? { value: `${n}d`, label: 'ago' }
    : { value: `${n}d`, label: 'left' };
}

export interface PreventiveFollowUpsProps {
  /** Already merged with the held face and ranked. */
  items: FollowUp[];
  /** FollowUp id → the other jobs that minted the same item. */
  alsoOnProjects: Record<string, string[]>;
  projectNameById: Record<string, string>;
  refusals: FollowUpPortfolioRefusal[];
  /** Checks that ran on EVERY job. */
  checkedCount: number;
  totalChecks: number;
  jobCount: number;
  /** True while the project store is still hydrating. */
  loading: boolean;
  /** contexts/ProjectContext sourceFailed — a read failed, so this ran on the
   *  local copy and may be incomplete. */
  sourceFailed: boolean;
  /** Scheduled, unfinished tasks with no subcontractor on them. The COI check
   *  cannot see these, and he should hear that from the screen. */
  unassignedTaskCount: number;
  /** "Chased 2× · last Tue" for this item, or null. Owned by the screen, which
   *  holds the chase log. */
  chaseLabelFor: (followUpId: string) => string | null;
  onSend: (item: FollowUp) => void;
  isDesktop: boolean;
}

export function PreventiveFollowUps({
  items, alsoOnProjects, projectNameById, refusals, checkedCount, totalChecks,
  jobCount, loading, sourceFailed, unassignedTaskCount, chaseLabelFor, onSend,
  isDesktop,
}: PreventiveFollowUpsProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { navigateTo } = useEntityNavigation();

  /**
   * One sentence per check that did not run somewhere, naming the job.
   *
   * Deduped by rule + job + missing set: the same schedule refuses the same
   * check on every render, and three copies of one sentence reads like three
   * problems.
   */
  const skipped = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of refusals) {
      const missing = r.missing ?? [];
      const key = `${r.ruleId}|${r.projectId}|${missing.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const why = missing.map(m => MISSING_COPY[m] ?? `${m} is unavailable`).join('; ');
      const label = RULE_LABEL[r.ruleId] ?? r.ruleId;
      out.push(`${label} did not run on ${r.projectName} — ${why || r.detail}.`);
    }
    return out;
  }, [refusals]);

  const openRef = (ref: EntityRef) => navigateTo(ref);

  /**
   * Shown even when it finds nothing, as long as there is an open job to check.
   *
   * Hiding a clean result looks identical to the feature not being here — which
   * is precisely the defect this section fixes, an engine nothing rendered. The
   * empty state is two lines and it carries the coverage count, so "nothing
   * heading for trouble" arrives with the evidence that anything was looked at.
   * It disappears entirely only when there is no open job at all.
   */
  if (jobCount === 0 && !loading && items.length === 0 && skipped.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <TriangleAlert size={14} color={t.warningLabel} strokeWidth={2.25} />
        <Text style={styles.sectionEyebrow}>About to go wrong</Text>
      </View>
      <Text style={styles.sectionSub}>
        {items.length > 0
          ? `${items.length} ${items.length === 1 ? 'thing is' : 'things are'} heading for trouble on a job you have not been told about yet. Nobody is late — that is the point.`
          : 'Nothing here is heading for trouble. These checks look ahead of the late list, so an empty section means the cheap fixes are still cheap.'}
      </Text>

      {/* ── What was actually checked ──────────────────────────────────────
          "All clear" is only honest when every check ran. When one refused,
          the count says so and the reason is named below it. */}
      <View style={styles.groundingRow}>
        <Info size={12} color={t.textMuted} strokeWidth={2} />
        <Text style={styles.groundingText}>
          {loading
            ? 'Still loading your subs, schedules and contracts — nothing has been checked yet.'
            : jobCount === 0
              ? 'No open jobs to check. These run on jobs that are not finished or closed.'
              : `Checked ${checkedCount} of ${totalChecks} ${totalChecks === 1 ? 'check' : 'checks'} across ${jobCount} open ${jobCount === 1 ? 'job' : 'jobs'}.`}
          {sourceFailed
            ? ' MAGE could not be reached on the last read, so this ran on your local copy and may be incomplete.'
            : ''}
        </Text>
      </View>

      {skipped.map((line) => (
        <View key={line} style={styles.groundingRow}>
          <Info size={12} color={t.warningLabel} strokeWidth={2} />
          <Text style={styles.skippedText}>{line}</Text>
        </View>
      ))}

      {unassignedTaskCount > 0 && (
        // The honest caveat that would otherwise be discovered in the field.
        // Both checks join through ScheduleTask.assignedSubId, and most tasks
        // have never had one (utils/subTradeMatch.ts documents zero of 44 on
        // the production account). Silence from these checks is therefore NOT
        // the same as "everyone is insured and under contract".
        <View style={styles.groundingRow}>
          <Info size={12} color={t.textMuted} strokeWidth={2} />
          <Text style={styles.groundingText}>
            {unassignedTaskCount} scheduled {unassignedTaskCount === 1 ? 'task has' : 'tasks have'} no
            subcontractor assigned. Both checks join through that field, so those
            {unassignedTaskCount === 1 ? ' tasks are' : ' tasks are'} invisible to them until a sub is picked.
          </Text>
        </View>
      )}

      <View style={isDesktop ? styles.cardGrid : undefined}>
        {items.map((item) => {
          const Icon = RULE_ICON[item.ruleId] ?? TriangleAlert;
          // preExisting (G6) rows keep the muted ink whatever their severity —
          // "this was already true before the check existed" is not an alarm.
          const ink = item.preExisting
            ? t.textSecondary
            : item.severity === 'critical'
              ? t.danger
              : item.severity === 'high'
                ? t.warningLabel
                : t.textSecondary;
          const clock = countdown(item.daysOverdue);
          const alsoOn = alsoOnProjects[item.id] ?? [];
          const chased = chaseLabelFor(item.id);
          const primary = item.evidence[0]?.ref;

          return (
            <View key={item.id} style={[styles.card, isDesktop && styles.cardDesktop]}>
              <TouchableOpacity
                style={styles.cardTop}
                activeOpacity={0.8}
                disabled={!primary}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.title}`}
                onPress={() => { if (primary) openRef(primary); }}
              >
                <View style={[styles.iconWrap, { backgroundColor: t.warningSoft }]}>
                  <Icon size={14} color={ink} strokeWidth={2} />
                </View>
                <View style={styles.cardTopText}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {projectNameById[item.projectId] ?? 'Project'}
                    {alsoOn.length > 0 ? ` · also on ${alsoOn.join(', ')}` : ''}
                  </Text>
                </View>
                {clock ? (
                  <View style={styles.clockBox}>
                    <Text style={[styles.clockNum, { color: ink }]}>{clock.value}</Text>
                    {!!clock.label && <Text style={styles.clockLabel}>{clock.label}</Text>}
                  </View>
                ) : null}
                {primary ? <ChevronRight size={14} color={t.textMuted} strokeWidth={2} /> : null}
              </TouchableOpacity>

              {/* The grounding chip: WHY this exists, naming both records. */}
              <Text style={styles.because}>{item.because}</Text>
              <Text style={styles.basis}>{basisLine(item.targetBasis, item.targetDate)}</Text>

              {item.preExisting && (
                <Text style={styles.preExisting}>
                  Already true when this check first ran — shown quietly on purpose, not ranked as new.
                </Text>
              )}

              {/* Both sides of the join, each openable. This is what stops a
                  warning being a claim you cannot check. */}
              <View style={styles.evidenceBlock}>
                {item.evidence.map((e) => (
                  <TouchableOpacity
                    key={`${e.ref.kind}-${e.ref.id}-${e.says}`}
                    style={styles.evidenceRow}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${e.ref.label ?? e.ref.kind}: ${e.says}`}
                    onPress={() => openRef(e.ref)}
                  >
                    <Link2 size={11} color={t.textMuted} strokeWidth={2} />
                    <Text style={styles.evidenceText} numberOfLines={2}>
                      <Text style={styles.evidenceLabel}>{e.ref.label ?? e.ref.kind}</Text>
                      {` — ${e.says}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {chased && (
                <View style={styles.chasedRow}>
                  <History size={12} color={t.textSecondary} strokeWidth={2} />
                  <Text style={styles.chasedText} numberOfLines={1}>{chased}</Text>
                </View>
              )}

              {item.nudge ? (
                <>
                  <Text style={styles.nudge} numberOfLines={3}>{item.nudge}</Text>
                  <TouchableOpacity
                    style={styles.sendBtn}
                    onPress={() => onSend(item)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={
                      chased ? `Send the warning about ${item.title} again. ${chased}`
                        : `Send the warning about ${item.title}`
                    }
                    testID={`preventive-nudge-${item.id}`}
                  >
                    <Send size={13} color={t.accent} strokeWidth={2.25} />
                    <Text style={styles.sendText}>{chased ? 'Send again' : 'Send warning'}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                // G4, on screen. No button rather than a dead one, and the row
                // says which of the two reasons applies — there is nobody to
                // send it to, or there is nobody to send it to but you.
                <Text style={styles.noNudge}>
                  {item.ball === 'gc'
                    ? 'No message to send — this one is your move, not somebody else’s.'
                    : 'No message drafted: MAGE has no name for who to send it to. Add a contact on the record above and it will draft one.'}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    section: { marginBottom: Tokens.spacing.lg },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 2,
    },
    sectionEyebrow: {
      ...Type.caption1,
      color: t.warningLabel,
      textTransform: 'uppercase',
      letterSpacing: 1,
      fontWeight: '700',
    },
    sectionSub: { ...Type.subhead, color: t.textSecondary, marginBottom: Tokens.spacing.sm },
    groundingRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginBottom: 6,
    },
    groundingText: { ...Type.caption2, color: t.textMuted, flex: 1, lineHeight: 15 },
    skippedText: { ...Type.caption2, color: t.warningLabel, flex: 1, lineHeight: 15 },
    cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Tokens.spacing.sm },
    // Through cardSurface() rather than hand-rolling the surface/radius/padding
    // trio: scripts/validate-ui-adoption.ts RATCHETS how many of those recipes
    // exist (ceiling 684, and this block was the 685th). The borderColor
    // override is what makes it a warning card rather than a plain one — these
    // are things about to go wrong, not things already late.
    card: {
      ...cardSurface(t, { radius: 'panel', pad: Tokens.spacing.md }),
      borderColor: t.warningSoft,
      marginBottom: Tokens.spacing.sm,
      marginTop: 6,
    },
    cardDesktop: { flexGrow: 1, flexBasis: 380, maxWidth: 520, marginBottom: 0 },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm },
    cardTopText: { flex: 1 },
    iconWrap: {
      width: 28,
      height: 28,
      borderRadius: Tokens.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    cardTitle: { ...Type.footnoteEmphasized, color: t.text },
    cardMeta: { ...Type.caption1, color: t.textSecondary, marginTop: 1 },
    clockBox: { alignItems: 'flex-end' },
    clockNum: { ...Type.subheadEmphasized, fontVariant: ['tabular-nums'] },
    clockLabel: { ...Type.caption2, color: t.textMuted },
    because: {
      ...Type.caption1,
      color: t.textSecondary,
      lineHeight: 17,
      marginTop: Tokens.spacing.sm,
      paddingTop: Tokens.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.line,
    },
    basis: { ...Type.caption2, color: t.textMuted, marginTop: 4, lineHeight: 15 },
    preExisting: { ...Type.caption2, color: t.textMuted, marginTop: 4, lineHeight: 15, fontStyle: 'italic' },
    evidenceBlock: { marginTop: Tokens.spacing.sm, gap: 5 },
    evidenceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
    evidenceText: { ...Type.caption2, color: t.textSecondary, flex: 1, lineHeight: 15 },
    evidenceLabel: { ...Type.caption2, color: t.text, fontWeight: '700' },
    chasedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: Tokens.spacing.sm },
    chasedText: { ...Type.caption2, color: t.textSecondary, flex: 1 },
    nudge: {
      ...Type.caption1,
      color: t.textSecondary,
      lineHeight: 17,
      marginTop: Tokens.spacing.sm,
      paddingTop: Tokens.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.line,
    },
    noNudge: {
      ...Type.caption2,
      color: t.textMuted,
      lineHeight: 15,
      marginTop: Tokens.spacing.sm,
      paddingTop: Tokens.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.line,
    },
    sendBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: Tokens.spacing.sm,
      paddingVertical: 9,
      borderRadius: Tokens.radius.md,
      borderWidth: 1,
      borderColor: t.accentSoft,
      backgroundColor: t.surfaceAlt,
    },
    sendText: { ...Type.caption1, color: t.accent, fontWeight: '700' },
  });

export default PreventiveFollowUps;
