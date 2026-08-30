// last-planner.tsx — the Last Planner production-control layer (Lean / pull
// planning) on top of the CPM schedule. The loop that keeps residential jobs
// from slipping, and the one thing Buildertrend/Knowify don't have.
//
//   LOOKAHEAD (CAN)  — next 3 weeks; each task's readiness gated by a
//                      constraint log (materials / permit / prior work / …).
//   THIS WEEK (WILL/DID) — the weekly work plan: commit ready tasks, then at
//                      week's end mark each kept or missed (with a reason).
//   RELIABILITY (LEARN)  — PPC (% of commitments kept; target 80-85%), the
//                      trend, and which reasons cost you the most.
//
// Responsive: a centered max-width column that reads well on phone AND web/
// desktop (React Native Web). Pure logic lives in utils/lastPlanner; per-project
// constraints + commitments persist via hooks/useLastPlanner.

import React, { useCallback, useMemo, useState } from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, ChevronLeft as ChevLeft, Plus, X, Check,
  AlertTriangle, CircleCheck, Clock, Target, ListChecks, TrendingUp, TrendingDown,
  Mail, Share2, Users,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { shareText } from '@/utils/shareText';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { useLastPlanner } from '@/hooks/useLastPlanner';
import {
  buildLookahead, buildWeeklyWorkPlan, computePpc, ppcBand, ppcHistory, ppcTrend,
  type TaskWindowCalendar,
  varianceBreakdown, currentWeekStart, addWeeks, formatWeekRange, taskWindow,
  CONSTRAINT_LABELS, VARIANCE_LABELS,
  type Readiness, type ConstraintCategory, type VarianceReason,
} from '@/utils/lastPlanner';
import {
  groupCommitmentsByCrew, buildCrewMessage, buildCrewEmailHtml, dispatchSubject,
  type CommittedTaskInput, type CrewDispatchGroup,
} from '@/utils/crewDispatch';
import { sendEmail } from '@/utils/emailService';
import type { ScheduleTask } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

const haptic = () => { if (Platform.OS !== 'web') void Haptics.selectionAsync(); };

type Tab = 'lookahead' | 'week' | 'reliability';

export default function LastPlannerScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('schedule_gantt_pdf')) {
    return (
      <Paywall visible feature="Last Planner" requiredTier="pro" onClose={() => router.back()} />
    );
  }
  return <LastPlannerInner />;
}

function LastPlannerInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const layout = useResponsiveLayout();
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, getProject, getSubcontractor, settings } = useProjects();
  const gcName = settings?.branding?.companyName?.trim() || undefined;

  const [projectId, setProjectId] = useState<string | null>(paramProjectId ?? null);
  const project = useMemo(() => (projectId ? getProject(projectId) : null), [projectId, getProject]);
  const tasks: ScheduleTask[] = project?.schedule?.tasks ?? [];
  const startDate = project?.schedule?.startDate ?? null;
  // The lookahead's task windows must use the SAME working calendar as the
  // CPM engine, or a task's finish here disagrees with the Gantt's. Durations
  // are working-day counts; without this they were spanned as calendar days.
  const calendar = useMemo(() => ({
    workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
    nonWorkingDates: project?.schedule?.nonWorkingDates,
  }), [project?.schedule?.workingDaysPerWeek, project?.schedule?.nonWorkingDates]);

  const lp = useLastPlanner(projectId);
  const [tab, setTab] = useState<Tab>('lookahead');
  const [weekStart, setWeekStart] = useState<string>(currentWeekStart());

  // Modals
  const [constraintFor, setConstraintFor] = useState<ScheduleTask | null>(null);
  const [reviewFor, setReviewFor] = useState<ScheduleTask | null>(null);

  // Lookahead / weekly-commitment grids are data-dense — on desktop use the
  // full content width (1400) rather than a 960 column.
  const contentWidth = layout.contentMaxWidth;

  // ── Project picker / empty states ──
  const Header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
        <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
      </TouchableOpacity>
      <View style={styles.headerText}>
        <Text style={styles.headerEyebrow}>Last Planner · MAGE ID</Text>
        <Text style={styles.headerTitle} numberOfLines={1}>{project?.name ?? 'Production control'}</Text>
      </View>
      <View style={styles.headerBtn} />
    </View>
  );

  if (!project) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {Header}
        <View style={[styles.centered, { maxWidth: contentWidth }]}>
          {projects.length === 0 ? (
            <EmptyState
              icon={<Target size={36} color={t.accent} strokeWidth={1.6} />}
              title="No projects yet"
              message="Last Planner runs the weekly commitment loop on a project's schedule. Create a project and build a schedule first."
              actionLabel="Open Projects"
              onAction={() => router.push('/(tabs)/(home)' as never)}
            />
          ) : (
            <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
              <Text style={styles.sectionTitle}>Pick a project</Text>
              {projects.map(p => (
                <TouchableOpacity key={p.id} style={styles.pickRow} onPress={() => setProjectId(p.id)} activeOpacity={0.8}>
                  <Text style={styles.pickRowTitle} numberOfLines={1}>{p.name}</Text>
                  <ChevronRight size={16} color={t.accent} strokeWidth={1.75} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    );
  }

  if (!startDate || tasks.length === 0) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {Header}
        <View style={[styles.centered, { maxWidth: contentWidth }]}>
          <EmptyState
            icon={<ListChecks size={36} color={t.accent} strokeWidth={1.6} />}
            title="Build a schedule first"
            message="Last Planner sits on top of the CPM schedule — it needs tasks and a start date to plan the next 3 weeks."
            actionLabel="Open Schedule"
            onAction={() => router.push({ pathname: '/schedule-wizard', params: { projectId: project.id } } as never)}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {Header}

      <View style={[styles.segmentWrap, { maxWidth: contentWidth }]}>
        <Segment label="Lookahead" active={tab === 'lookahead'} onPress={() => { setTab('lookahead'); haptic(); }} t={t} styles={styles} />
        <Segment label="This Week" active={tab === 'week'} onPress={() => { setTab('week'); haptic(); }} t={t} styles={styles} />
        <Segment label="Reliability" active={tab === 'reliability'} onPress={() => { setTab('reliability'); haptic(); }} t={t} styles={styles} />
      </View>

      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE, alignItems: 'center' }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: '100%', maxWidth: contentWidth }}>
          {tab === 'lookahead' && (
            <LookaheadView
              tasks={tasks} startDate={startDate} constraints={lp.constraints} calendar={calendar}
              onAddConstraint={setConstraintFor} onClearConstraint={lp.toggleConstraint}
              t={t} styles={styles}
            />
          )}
          {tab === 'week' && (
            <WeekView
              tasks={tasks} startDate={startDate} weekStart={weekStart} calendar={calendar}
              setWeekStart={setWeekStart} constraints={lp.constraints} commitments={lp.commitments}
              onToggleCommit={(taskId, committed) => lp.setCommit(taskId, weekStart, committed)}
              onReview={setReviewFor}
              projectName={project.name} gcName={gcName}
              getSub={getSubcontractor} dispatches={lp.dispatches} onDispatched={lp.markDispatched}
              t={t} styles={styles}
            />
          )}
          {tab === 'reliability' && (
            <ReliabilityView commitments={lp.commitments} weekStart={weekStart} t={t} styles={styles} />
          )}
        </View>
      </ScrollView>

      <ConstraintModal
        task={constraintFor}
        onClose={() => setConstraintFor(null)}
        onSave={(input) => { lp.addConstraint(input); setConstraintFor(null); if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
        t={t} styles={styles}
      />
      <ReviewModal
        task={reviewFor}
        onClose={() => setReviewFor(null)}
        onReview={(outcome, reason) => { if (reviewFor) lp.reviewCommit(reviewFor.id, weekStart, outcome, reason); setReviewFor(null); if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
        t={t} styles={styles}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
function Segment({ label, active, onPress, t, styles }: { label: string; active: boolean; onPress: () => void; t: ThemeColors; styles: S }) {
  return (
    <TouchableOpacity style={[styles.segment, active && { backgroundColor: t.accentFill }]} onPress={onPress} activeOpacity={0.85}>
      <Text style={[styles.segmentText, active && { color: Colors.textOnAccent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function readinessMeta(r: Readiness, t: ThemeColors): { color: string; label: string } {
  switch (r) {
    case 'done': return { color: t.textMuted, label: 'Done' };
    case 'in_progress': return { color: t.info ?? t.accent, label: 'In progress' };
    case 'ready': return { color: t.success, label: 'Ready' };
    case 'constrained': return { color: t.accentHot, label: 'Constrained' };
  }
}

function taskSub(task: ScheduleTask): string {
  return [task.phase, task.assignedSubName || task.crew].filter(Boolean).join(' · ');
}

// ── Lookahead ──
function LookaheadView({ tasks, startDate, constraints, calendar, onAddConstraint, onClearConstraint, t, styles }: {
  tasks: ScheduleTask[]; startDate: string; constraints: ReturnType<typeof useLastPlanner>['constraints'];
  calendar: TaskWindowCalendar;
  onAddConstraint: (task: ScheduleTask) => void; onClearConstraint: (id: string) => void; t: ThemeColors; styles: S;
}) {
  const la = useMemo(() => buildLookahead(tasks, startDate, constraints, { weeks: 3, calendar }), [tasks, startDate, constraints, calendar]);

  if (la.weeks.length === 0) {
    return <View style={styles.infoCard}><Clock size={24} color={t.accent} strokeWidth={1.75} /><Text style={styles.infoTitle}>Nothing in the next 3 weeks</Text><Text style={styles.infoBody}>No scheduled tasks fall inside the lookahead window. Check the project schedule.</Text></View>;
  }

  return (
    <>
      <Text style={styles.note}>
        Clear constraints to make work <Text style={{ color: t.success, fontWeight: '700' }}>ready</Text> before you commit it. {la.constrainedCount > 0 ? `${la.constrainedCount} task${la.constrainedCount === 1 ? '' : 's'} still constrained.` : 'Everything ahead is ready.'}
      </Text>
      {la.weeks.map(week => (
        <View key={week.weekStart} style={{ marginBottom: 8 }}>
          <Text style={styles.weekHeading}>
            {week.weeksOut === 0 ? 'This week' : week.weeksOut === 1 ? 'Next week' : `In ${week.weeksOut} weeks`} · {formatWeekRange(week.weekStart)}
          </Text>
          {week.entries.map(e => {
            const m = readinessMeta(e.readiness, t);
            return (
              <View key={e.task.id} style={styles.taskCard}>
                <View style={styles.taskHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taskTitle} numberOfLines={1}>{e.task.title}</Text>
                    {!!taskSub(e.task) && <Text style={styles.taskMeta} numberOfLines={1}>{taskSub(e.task)}</Text>}
                  </View>
                  <View style={[styles.chip, { backgroundColor: m.color + '22' }]}>
                    {e.atRisk ? <AlertTriangle size={11} color={m.color} strokeWidth={1.75} /> : null}
                    <Text style={[styles.chipText, { color: m.color }]}>{m.label}</Text>
                  </View>
                </View>
                {e.openConstraints.map(c => (
                  <TouchableOpacity key={c.id} style={styles.constraintRow} onPress={() => onClearConstraint(c.id)} activeOpacity={0.7}>
                    <View style={styles.constraintCheck}><Check size={11} color={t.textMuted} strokeWidth={1.75} /></View>
                    <Text style={styles.constraintText} numberOfLines={1}>
                      <Text style={{ fontWeight: '700', color: t.accentHot }}>{CONSTRAINT_LABELS[c.category]}: </Text>
                      {c.description}{c.needBy ? ` · need by ${c.needBy}` : ''}{c.owner ? ` · ${c.owner}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.addConstraintBtn} onPress={() => onAddConstraint(e.task)} activeOpacity={0.7}>
                  <Plus size={13} color={t.accent} strokeWidth={1.75} />
                  <Text style={styles.addConstraintText}>Add constraint</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      ))}
    </>
  );
}

// ── This Week (weekly work plan) ──
function startLabelFor(task: ScheduleTask, startDate: string, calendar?: TaskWindowCalendar): string | undefined {
  const win = taskWindow(task, startDate, calendar);
  if (!win) return undefined;
  return new Date(win.startMs).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function WeekView({ tasks, startDate, weekStart, calendar, setWeekStart, constraints, commitments, onToggleCommit, onReview, projectName, gcName, getSub, dispatches, onDispatched, t, styles }: {
  tasks: ScheduleTask[]; startDate: string; weekStart: string; calendar: TaskWindowCalendar;
  setWeekStart: (w: string) => void;
  constraints: ReturnType<typeof useLastPlanner>['constraints']; commitments: ReturnType<typeof useLastPlanner>['commitments'];
  onToggleCommit: (taskId: string, committed: boolean) => void; onReview: (task: ScheduleTask) => void;
  projectName: string; gcName?: string;
  getSub: (id: string) => { companyName?: string; contactName?: string; email?: string; phone?: string } | null;
  dispatches: ReturnType<typeof useLastPlanner>['dispatches'];
  onDispatched: (crewKey: string, weekStart: string, channel: 'email' | 'share') => void;
  t: ThemeColors; styles: S;
}) {
  const wwp = useMemo(() => buildWeeklyWorkPlan(tasks, startDate, weekStart, constraints, commitments, calendar), [tasks, startDate, weekStart, constraints, commitments, calendar]);
  const ppc = useMemo(() => computePpc(commitments, weekStart), [commitments, weekStart]);
  const committedCount = wwp.filter(e => e.committed).length;
  const [sending, setSending] = useState<string | null>(null);

  // Group committed tasks by crew for the "send the week" push.
  const crews = useMemo<CrewDispatchGroup[]>(() => {
    const committed: CommittedTaskInput[] = wwp
      .filter(e => e.committed)
      .map(e => ({
        taskId: e.task.id, title: e.task.title,
        assignedSubId: e.task.assignedSubId, assignedSubName: e.task.assignedSubName,
        crew: e.task.crew, startLabel: startLabelFor(e.task, startDate, calendar),
      }));
    return groupCommitmentsByCrew(committed, getSub);
  }, [wwp, startDate, calendar, getSub]);

  const sentAtFor = useCallback((crewKey: string) =>
    dispatches.find(d => d.crewKey === crewKey && d.weekStart === weekStart)?.sentAt,
    [dispatches, weekStart]);

  const handleSend = useCallback(async (g: CrewDispatchGroup) => {
    const ctx = { projectName, weekRange: formatWeekRange(weekStart), gcName };
    setSending(g.key);
    try {
      if (g.email) {
        const res = await sendEmail({ to: g.email, subject: dispatchSubject(ctx), html: buildCrewEmailHtml(g, ctx), fromCompanyName: gcName });
        if (res.success) {
          onDispatched(g.key, weekStart, 'email');
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          showAlert('Could not email', res.error || 'Try again, or share instead.');
        }
      } else {
        await shareText({ message: buildCrewMessage(g, ctx) });
        onDispatched(g.key, weekStart, 'share');
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      // Web/native share can reject (dismissed or unsupported) — surface the text to copy.
      showAlert('Send manually', buildCrewMessage(g, ctx));
    } finally {
      setSending(null);
    }
  }, [projectName, weekStart, gcName, onDispatched]);

  return (
    <>
      {/* Week selector */}
      <View style={styles.weekNav}>
        <TouchableOpacity onPress={() => setWeekStart(addWeeks(weekStart, -1))} hitSlop={10} style={styles.weekNavBtn}><ChevLeft size={18} color={t.text} strokeWidth={1.75} /></TouchableOpacity>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={styles.weekNavLabel}>{weekStart === currentWeekStart() ? 'This week' : formatWeekRange(weekStart)}</Text>
          <Text style={styles.weekNavSub}>{formatWeekRange(weekStart)} · {committedCount} committed</Text>
        </View>
        <TouchableOpacity onPress={() => setWeekStart(addWeeks(weekStart, 1))} hitSlop={10} style={styles.weekNavBtn}><ChevronRight size={18} color={t.text} strokeWidth={1.75} /></TouchableOpacity>
      </View>

      {ppc.committed > 0 && (ppc.completed > 0 || wwp.some(e => e.outcome)) ? (
        <View style={[styles.ppcInline, { borderColor: bandColor(ppcBand(ppc.ppc), t) }]}>
          <Text style={[styles.ppcInlineNum, { color: bandColor(ppcBand(ppc.ppc), t) }]}>{Math.round(ppc.ppc * 100)}%</Text>
          <Text style={styles.ppcInlineLabel}>PPC this week · {ppc.completed}/{ppc.committed} commitments kept</Text>
        </View>
      ) : null}

      {wwp.length === 0 ? (
        <View style={styles.infoCard}><ListChecks size={24} color={t.accent} strokeWidth={1.75} /><Text style={styles.infoTitle}>No tasks scheduled this week</Text><Text style={styles.infoBody}>Use the arrows to move weeks, or commit work from the Lookahead.</Text></View>
      ) : (
        <>
          <Text style={styles.note}>Commit the work the crew <Text style={{ fontWeight: '700', color: t.text }}>will</Text> finish this week. At week's end, mark each kept or missed.</Text>
          {wwp.map(e => {
            const m = readinessMeta(e.readiness, t);
            const reviewed = !!e.outcome;
            return (
              <View key={e.task.id} style={[styles.taskCard, e.committed && { borderColor: t.accent + '66' }]}>
                <View style={styles.taskHead}>
                  <TouchableOpacity
                    style={[styles.commitBox, e.committed && { backgroundColor: t.accent, borderColor: t.accent }]}
                    onPress={() => { onToggleCommit(e.task.id, !e.committed); haptic(); }}
                    accessibilityRole="checkbox" accessibilityState={{ checked: e.committed }}
                  >
                    {e.committed ? <Check size={13} color={Colors.textOnAccent} strokeWidth={1.75} /> : null}
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taskTitle} numberOfLines={1}>{e.task.title}</Text>
                    {!!taskSub(e.task) && <Text style={styles.taskMeta} numberOfLines={1}>{taskSub(e.task)}</Text>}
                  </View>
                  <View style={[styles.chip, { backgroundColor: m.color + '22' }]}>
                    <Text style={[styles.chipText, { color: m.color }]}>{m.label}</Text>
                  </View>
                </View>

                {e.committed && e.readiness === 'constrained' && !reviewed ? (
                  <View style={styles.warnRow}><AlertTriangle size={12} color={t.accentHot} strokeWidth={1.75} /><Text style={styles.warnText}>{e.openConstraints} open constraint{e.openConstraints === 1 ? '' : 's'} — clear before relying on this.</Text></View>
                ) : null}

                {e.committed ? (
                  reviewed ? (
                    <View style={styles.reviewedRow}>
                      {e.outcome === 'done'
                        ? <><CircleCheck size={13} color={t.success} strokeWidth={1.75} /><Text style={[styles.reviewedText, { color: t.success }]}>Kept</Text></>
                        : <><X size={13} color={t.danger} strokeWidth={1.75} /><Text style={[styles.reviewedText, { color: t.danger }]}>Missed{e.varianceReason ? ` · ${VARIANCE_LABELS[e.varianceReason]}` : ''}</Text></>}
                      <TouchableOpacity onPress={() => onReview(e.task)} hitSlop={8}><Text style={styles.reReviewText}>change</Text></TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.reviewBtns}>
                      <TouchableOpacity style={[styles.reviewBtn, { borderColor: t.success }]} onPress={() => { onReview(e.task); }} activeOpacity={0.85}>
                        <Text style={[styles.reviewBtnText, { color: t.text }]}>Review at week-end</Text>
                      </TouchableOpacity>
                    </View>
                  )
                ) : null}
              </View>
            );
          })}

          {/* Notify crews — push each crew their committed week (the field half of the loop). */}
          {crews.length > 0 && (
            <View style={styles.crewSection}>
              <View style={styles.crewSectionHead}>
                <Users size={15} color={t.accent} strokeWidth={1.75} />
                <Text style={styles.crewSectionTitle}>Send the week to your crews</Text>
              </View>
              {crews.map(g => {
                const sentAt = sentAtFor(g.key);
                const isUnassigned = g.key === 'unassigned';
                return (
                  <View key={g.key} style={styles.crewRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.crewName} numberOfLines={1}>{g.name}</Text>
                      <Text style={styles.crewMeta} numberOfLines={1}>
                        {g.tasks.length} task{g.tasks.length === 1 ? '' : 's'}
                        {g.email ? ` · ${g.email}` : g.phone ? ` · ${g.phone}` : isUnassigned ? '' : ' · no contact'}
                        {sentAt ? ` · sent ${new Date(sentAt).toLocaleDateString()}` : ''}
                      </Text>
                    </View>
                    {isUnassigned ? (
                      <View style={[styles.crewBtn, { borderColor: t.line }]}><Text style={[styles.crewBtnText, { color: t.textMuted }]}>Assign a sub</Text></View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.crewBtn, sentAt ? { borderColor: t.success } : { borderColor: t.accent, backgroundColor: t.accent }]}
                        onPress={() => handleSend(g)}
                        disabled={sending === g.key}
                        activeOpacity={0.85}
                      >
                        {g.email ? <Mail size={13} color={sentAt ? t.success : Colors.textOnAccent} strokeWidth={1.75} /> : <Share2 size={13} color={sentAt ? t.success : Colors.textOnAccent} strokeWidth={1.75} />}
                        <Text style={[styles.crewBtnText, { color: sentAt ? t.success : Colors.textOnAccent }]}>
                          {sending === g.key ? 'Sending…' : sentAt ? 'Resend' : g.email ? 'Email' : 'Share'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
              <Text style={styles.crewHint}>Only the committed work goes out — each crew sees just their slice, not the whole schedule.</Text>
            </View>
          )}
        </>
      )}
    </>
  );
}

// ── Reliability (PPC) ──
function ReliabilityView({ commitments, weekStart, t, styles }: {
  commitments: ReturnType<typeof useLastPlanner>['commitments']; weekStart: string; t: ThemeColors; styles: S;
}) {
  const history = useMemo(() => ppcHistory(commitments), [commitments]);
  const trend = useMemo(() => ppcTrend(history), [history]);
  const variance = useMemo(() => varianceBreakdown(commitments), [commitments]);
  const maxVar = Math.max(1, ...variance.map(v => v.count));

  if (history.length === 0) {
    return (
      <View style={styles.infoCard}>
        <Target size={26} color={t.accent} strokeWidth={1.7} />
        <Text style={styles.infoTitle}>No reliability data yet</Text>
        <Text style={styles.infoBody}>Commit tasks in This Week, then mark them kept or missed at week's end. Your PPC — the % of commitments you actually keep — builds here. The Lean target is 80–85%.</Text>
      </View>
    );
  }

  const latestPct = Math.round((trend.latest ?? 0) * 100);
  const avgPct = Math.round((trend.average ?? 0) * 100);
  const band = ppcBand(trend.latest ?? 0);
  const bc = bandColor(band, t);

  return (
    <>
      <View style={[styles.ppcHero, { borderColor: bc }]}>
        <Text style={styles.ppcHeroLabel}>Percent Plan Complete · latest week</Text>
        <View style={styles.ppcHeroRow}>
          <Text style={[styles.ppcHeroNum, { color: bc }]}>{latestPct}%</Text>
          {trend.direction === 'up' ? <TrendingUp size={20} color={t.success} strokeWidth={1.75} /> : trend.direction === 'down' ? <TrendingDown size={20} color={t.danger} strokeWidth={1.75} /> : null}
          <View style={{ flex: 1 }} />
          <View style={[styles.bandChip, { backgroundColor: bc + '22' }]}><Text style={[styles.bandChipText, { color: bc }]}>{band === 'strong' ? 'Reliable' : band === 'ok' ? 'Improving' : 'At risk'}</Text></View>
        </View>
        <Text style={styles.ppcHeroSub}>{avgPct}% average over {history.length} week{history.length === 1 ? '' : 's'} · target 80–85%</Text>
      </View>

      <Text style={styles.sectionTitle}>Trend</Text>
      <View style={styles.trendCard}>
        {history.slice(-8).map(r => {
          const pct = Math.round(r.ppc * 100);
          const c = bandColor(ppcBand(r.ppc), t);
          return (
            <View key={r.weekStart} style={styles.trendRow}>
              <Text style={styles.trendWeek}>{formatWeekRange(r.weekStart)}</Text>
              <View style={styles.trendTrack}><View style={[styles.trendFill, { width: `${pct}%` as any, backgroundColor: c }]} /></View>
              <Text style={[styles.trendPct, { color: c }]}>{pct}%</Text>
            </View>
          );
        })}
      </View>

      {variance.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>What's costing you</Text>
          <View style={styles.trendCard}>
            {variance.map(v => (
              <View key={v.reason} style={styles.trendRow}>
                <Text style={styles.trendWeek} numberOfLines={1}>{VARIANCE_LABELS[v.reason]}</Text>
                <View style={styles.trendTrack}><View style={[styles.trendFill, { width: `${Math.round((v.count / maxVar) * 100)}%` as any, backgroundColor: t.accentHot }]} /></View>
                <Text style={[styles.trendPct, { color: t.accentHot }]}>{v.count}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>Attack the top reason and your PPC climbs. That's the &quot;learn&quot; step of the Last Planner loop.</Text>
        </>
      )}
    </>
  );
}

function bandColor(band: 'strong' | 'ok' | 'weak', t: ThemeColors): string {
  return band === 'strong' ? t.success : band === 'ok' ? t.accent : t.danger;
}

// ── Constraint add modal ──
function ConstraintModal({ task, onClose, onSave, t, styles }: {
  task: ScheduleTask | null; onClose: () => void;
  onSave: (input: { taskId: string; category: ConstraintCategory; description: string; needBy?: string; owner?: string }) => void;
  t: ThemeColors; styles: S;
}) {
  const [category, setCategory] = useState<ConstraintCategory>('materials');
  const [description, setDescription] = useState('');
  const [needBy, setNeedBy] = useState('');
  const [owner, setOwner] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);

  if (task && task.id !== loadedId) {
    setLoadedId(task.id); setCategory('materials'); setDescription(''); setNeedBy(''); setOwner('');
  }

  const cats = Object.keys(CONSTRAINT_LABELS) as ConstraintCategory[];

  return (
    <Modal visible={!!task} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle} numberOfLines={1}>What's blocking {task?.title}?</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><X size={20} color={t.textSecondary} strokeWidth={1.75} /></TouchableOpacity>
          </View>
          <Text style={styles.fieldLabel}>Type</Text>
          <View style={styles.catWrap}>
            {cats.map(c => (
              <TouchableOpacity key={c} style={[styles.catChip, category === c && { backgroundColor: t.accentFill, borderColor: t.accent }]} onPress={() => setCategory(c)}>
                <Text style={[styles.catChipText, category === c && { color: Colors.textOnAccent }]}>{CONSTRAINT_LABELS[c]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.fieldLabel}>What exactly</Text>
          <TextInput style={styles.fieldInput} value={description} onChangeText={setDescription} placeholder="e.g. tile order not shipped yet" placeholderTextColor={t.textMuted} />
          <View style={styles.fieldRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Need by (optional)</Text>
              <TextInput style={styles.fieldInput} value={needBy} onChangeText={setNeedBy} placeholder="YYYY-MM-DD" placeholderTextColor={t.textMuted} autoCapitalize="none" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Owner (optional)</Text>
              <TextInput style={styles.fieldInput} value={owner} onChangeText={setOwner} placeholder="who clears it" placeholderTextColor={t.textMuted} />
            </View>
          </View>
          <TouchableOpacity
            style={[styles.modalSave, !description.trim() && { opacity: 0.5 }]}
            disabled={!description.trim()}
            onPress={() => task && onSave({ taskId: task.id, category, description, needBy: needBy.trim() || undefined, owner: owner.trim() || undefined })}
            activeOpacity={0.85}
          >
            <Plus size={16} color={Colors.textOnAccent} strokeWidth={1.75} /><Text style={styles.modalSaveText}>Add constraint</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Commitment review modal ──
function ReviewModal({ task, onClose, onReview, t, styles }: {
  task: ScheduleTask | null; onClose: () => void;
  onReview: (outcome: 'done' | 'missed', reason?: VarianceReason) => void; t: ThemeColors; styles: S;
}) {
  const [missed, setMissed] = useState(false);
  const [reason, setReason] = useState<VarianceReason>('prereq');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (task && task.id !== loadedId) { setLoadedId(task.id); setMissed(false); setReason('prereq'); }
  const reasons = Object.keys(VARIANCE_LABELS) as VarianceReason[];

  return (
    <Modal visible={!!task} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle} numberOfLines={1}>Did "{task?.title}" get done?</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><X size={20} color={t.textSecondary} strokeWidth={1.75} /></TouchableOpacity>
          </View>
          {!missed ? (
            <View style={{ gap: 10, marginTop: 8 }}>
              <TouchableOpacity style={[styles.outcomeBtn, { borderColor: t.success }]} onPress={() => onReview('done')} activeOpacity={0.85}>
                <CircleCheck size={18} color={t.success} strokeWidth={1.75} /><Text style={styles.outcomeText}>Yes — kept the commitment</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.outcomeBtn, { borderColor: t.danger }]} onPress={() => setMissed(true)} activeOpacity={0.85}>
                <X size={18} color={t.danger} strokeWidth={1.75} /><Text style={styles.outcomeText}>No — it slipped</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.fieldLabel}>Why did it slip? (the &quot;learn&quot; step)</Text>
              <View style={styles.catWrap}>
                {reasons.map(r => (
                  <TouchableOpacity key={r} style={[styles.catChip, reason === r && { backgroundColor: t.accentHot, borderColor: t.accentHot }]} onPress={() => setReason(r)}>
                    <Text style={[styles.catChipText, reason === r && { color: Colors.textOnAccent }]}>{VARIANCE_LABELS[r]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={[styles.modalSave, { backgroundColor: t.danger }]} onPress={() => onReview('missed', reason)} activeOpacity={0.85}>
                <Check size={16} color={Colors.textOnAccent} strokeWidth={1.75} /><Text style={styles.modalSaveText}>Log the miss</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

type S = ReturnType<typeof makeStyles>;
const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  centered: { flex: 1, width: '100%', alignSelf: 'center' as const },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { ...Type.serifHeadline, color: t.text },

  segmentWrap: {
    flexDirection: 'row' as const, gap: 6, padding: 12, alignSelf: 'center' as const, width: '100%',
  },
  segment: { flex: 1, paddingVertical: 9, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line, alignItems: 'center' as const, backgroundColor: t.surface },
  segmentText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.textSecondary },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10, marginTop: 8 },
  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginBottom: 12 },
  weekHeading: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const, color: t.accent, letterSpacing: 0.3, marginBottom: 8, marginTop: 4, textTransform: 'uppercase' as const },

  pickRow: { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, padding: 14, marginBottom: 8 },
  pickRowTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },

  taskCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, padding: 12, marginBottom: 8, gap: 8 },
  taskHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  taskTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  taskMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 1 },
  chip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
  chipText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const },

  constraintRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 2 },
  constraintCheck: { width: 18, height: 18, borderRadius: Tokens.radius.xs, borderWidth: 1.5, borderColor: t.line, alignItems: 'center' as const, justifyContent: 'center' as const },
  constraintText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 16 },
  addConstraintBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  addConstraintText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700' as const },

  commitBox: { width: 24, height: 24, borderRadius: Tokens.radius.sm, borderWidth: 1.5, borderColor: t.line, alignItems: 'center' as const, justifyContent: 'center' as const },
  warnRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  warnText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.accentHot, lineHeight: 15 },
  reviewBtns: { flexDirection: 'row' as const, gap: 8 },
  reviewBtn: { flex: 1, borderWidth: 1.5, borderRadius: Tokens.radius.full, paddingVertical: 9, alignItems: 'center' as const },
  reviewBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
  reviewedRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  reviewedText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
  reReviewText: { fontSize: Type.caption1.fontSize, color: t.textMuted, textDecorationLine: 'underline' as const, marginLeft: 4 },

  weekNav: { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line, padding: 8, marginBottom: 12 },
  weekNavBtn: { width: 34, height: 34, alignItems: 'center' as const, justifyContent: 'center' as const },
  weekNavLabel: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: t.text },
  weekNavSub: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 1 },

  ppcInline: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, borderWidth: 1.5, borderRadius: Tokens.radius.card, padding: 12, marginBottom: 12, backgroundColor: t.surface },
  ppcInlineNum: { fontSize: Type.title2.fontSize, fontWeight: '800' as const },
  ppcInlineLabel: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary },

  ppcHero: { backgroundColor: t.surface, borderRadius: Tokens.radius.panel, padding: 18, borderWidth: 1.5, gap: 8, marginBottom: 16 },
  ppcHeroLabel: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  ppcHeroRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  ppcHeroNum: { fontSize: Type.largeTitle.fontSize, fontWeight: '800' as const, letterSpacing: -1, lineHeight: Type.largeTitle.fontSize },
  bandChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.full },
  bandChipText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const },
  ppcHeroSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary },

  trendCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line, padding: 14, marginBottom: 12, gap: 10 },
  trendRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  trendWeek: { width: 96, fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  trendTrack: { flex: 1, height: 8, borderRadius: Tokens.radius.full, backgroundColor: t.line, overflow: 'hidden' as const },
  trendFill: { height: 8, borderRadius: Tokens.radius.full },
  trendPct: { width: 40, textAlign: 'right' as const, fontSize: Type.footnote.fontSize, fontWeight: '800' as const },

  infoCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line, padding: 24, alignItems: 'center' as const, gap: 10, marginTop: 12 },
  infoTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text, textAlign: 'center' as const },
  infoBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 20, textAlign: 'center' as const },

  modalBackdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: Colors.overlay },
  modalSheet: { backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, padding: 20, paddingBottom: 34, gap: 4, maxWidth: 720, width: '100%', alignSelf: 'center' as const },
  modalHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 6, gap: 12 },
  modalTitle: { flex: 1, fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text },
  fieldLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '700' as const, marginTop: 10, marginBottom: 6 },
  fieldInput: { backgroundColor: t.surface, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: t.line, paddingHorizontal: 12, paddingVertical: 10, fontSize: Type.subhead.fontSize, color: t.text },
  fieldRow: { flexDirection: 'row' as const, gap: 12 },
  catWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 7 },
  catChip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface },
  catChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },
  modalSave: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 7, backgroundColor: t.accentFill, borderRadius: Tokens.radius.full, paddingVertical: 13, marginTop: 16 },
  modalSaveText: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: Colors.textOnAccent },
  outcomeBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, borderWidth: 1.5, borderRadius: Tokens.radius.card, padding: 16 },
  outcomeText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },

  crewSection: { marginTop: 14, backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line, padding: 14 },
  crewSectionHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7, marginBottom: 10 },
  crewSectionTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: t.text },
  crewRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: t.line },
  crewName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  crewMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 1 },
  crewBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, borderWidth: 1.5, borderRadius: Tokens.radius.full, paddingHorizontal: 13, paddingVertical: 7 },
  crewBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const },
  crewHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15, marginTop: 10 },
});
