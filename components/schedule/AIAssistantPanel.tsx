// AIAssistantPanel — the game-changer drawer for Schedule Pro.
//
// Lives on the right edge of the screen. One-click actions surface the
// highest-leverage AI capabilities, with a chat input at the bottom for
// anything else.
//
// Core principle: AI suggests, user applies. Every proposed change has an
// explicit "Apply" button — we never silently mutate the plan.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  X,
  Sparkles,
  ShieldAlert,
  Zap,
  Target,
  MessageSquare,
  Mic,
  Wand2,
  ArrowRight,
  Check,
  AlertTriangle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';
import {
  aiDetectRisks,
  aiOptimizeSchedule,
  aiExplainCriticalPath,
  aiAskSchedule,
  aiLogAsBuilt,
  aiGenerateSchedule,
  aiBulkEdit,
  materializeGeneratedTasks,
  type AIRiskFinding,
  type AIOptimizationIdea,
  type AIAsBuiltPatch,
  type AIBulkPatch,
} from '@/utils/scheduleAI';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AIAssistantPanelProps {
  visible: boolean;
  onClose: () => void;
  tasks: ScheduleTask[];
  cpm: CpmResult;
  projectStartDate: Date;
  todayDayNumber: number;
  /** Apply a single task patch (mirror schedule-pro handleEdit). */
  onApplyPatch: (taskId: string, patch: Partial<ScheduleTask>) => void;
  /** Replace the whole schedule (for generator). */
  onReplaceAll: (tasks: ScheduleTask[]) => void;
  /** Highlight a set of task ids so the Gantt/grid can scroll to them. */
  onFocusTasks?: (ids: string[]) => void;
  /** Currently selected task ids from the grid — scopes bulk AI ops. */
  selectedIds?: Set<string>;
  /** Apply a batch of AI-proposed patches as one commit (undoable as a unit). */
  onApplyBulkPatches?: (patches: Array<{ taskId: string; patch: Partial<ScheduleTask> }>) => void;
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

type Mode = 'home' | 'risks' | 'optimize' | 'explain' | 'ask' | 'asbuilt' | 'generate' | 'bulk';

export default function AIAssistantPanel(props: AIAssistantPanelProps) {
  const {
    visible, onClose, tasks, cpm, projectStartDate, todayDayNumber,
    onApplyPatch, onApplyBulkPatches, onReplaceAll, onFocusTasks, selectedIds,
  } = props;
  const [mode, setMode] = useState<Mode>('home');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [riskResult, setRiskResult] = useState<{ summary: string; findings: AIRiskFinding[] } | null>(null);
  const [optResult, setOptResult] = useState<{ summary: string; ideas: AIOptimizationIdea[] } | null>(null);
  const [explainText, setExplainText] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<Array<{ q: string; a: string }>>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [asBuiltDraft, setAsBuiltDraft] = useState('');
  const [asBuiltPatches, setAsBuiltPatches] = useState<AIAsBuiltPatch[]>([]);
  const [genDraft, setGenDraft] = useState('');
  const [genPreview, setGenPreview] = useState<ScheduleTask[] | null>(null);
  const [bulkDraft, setBulkDraft] = useState('');
  const [bulkResult, setBulkResult] = useState<{
    summary: string;
    patches: AIBulkPatch[];
    fromCache?: boolean;
    errorKind?: 'timeout' | 'network' | 'http' | 'model' | 'validation' | 'unknown';
  } | null>(null);

  // Per-session call counter — helps the user see when they're hitting the
  // cache vs. burning a fresh model call. Resets on panel close (see resetAll).
  const [callStats, setCallStats] = useState<{ total: number; cached: number }>({ total: 0, cached: 0 });

  // Jump straight into bulk mode when the panel opens with a selection active.
  // That's almost always what the user wants after clicking "✨ Ask AI" on the
  // bulk bar — zero extra clicks to start typing their instruction.
  React.useEffect(() => {
    if (visible && selectedIds && selectedIds.size > 0 && mode === 'home') {
      setMode('bulk');
    }
  }, [visible, selectedIds, mode]);

  const selectedCount = selectedIds?.size ?? 0;
  const selectedTaskTitles = useMemo(() => {
    if (!selectedIds || selectedIds.size === 0) return [];
    return tasks.filter(t => selectedIds.has(t.id)).map(t => t.title);
  }, [tasks, selectedIds]);

  const handleBulkEdit = useCallback(() => {
    if (!bulkDraft.trim() || !selectedIds || selectedIds.size === 0) return;
    const instruction = bulkDraft.trim();
    run(async () => {
      const res = await aiBulkEdit(tasks, cpm, Array.from(selectedIds), instruction);
      setCallStats(s => ({ total: s.total + 1, cached: s.cached + (res.fromCache ? 1 : 0) }));
      // Surface timeout / network / http failures as the panel error banner so
      // the user sees a distinct message rather than an empty result card.
      if (res.errorKind === 'timeout' || res.errorKind === 'network' || res.errorKind === 'http' || res.errorKind === 'model') {
        setError(res.errorDetail || 'AI could not complete that edit.');
        setBulkResult(null);
        return;
      }
      setBulkResult({
        summary: res.summary,
        patches: res.patches,
        fromCache: res.fromCache,
        errorKind: res.errorKind,
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkDraft, selectedIds, tasks, cpm]);

  const handleBulkApplyAll = useCallback(() => {
    if (!bulkResult) return;
    if (onApplyBulkPatches) {
      onApplyBulkPatches(bulkResult.patches.map(p => ({ taskId: p.taskId, patch: p.patch })));
    } else {
      for (const p of bulkResult.patches) onApplyPatch(p.taskId, p.patch);
    }
    setBulkResult(null);
    setBulkDraft('');
  }, [bulkResult, onApplyBulkPatches, onApplyPatch]);

  const handleBulkApplyOne = useCallback((p: AIBulkPatch) => {
    onApplyPatch(p.taskId, p.patch);
    setBulkResult(prev => prev ? {
      ...prev,
      patches: prev.patches.filter(x => x.taskId !== p.taskId),
    } : prev);
  }, [onApplyPatch]);

  const resetAll = useCallback(() => {
    setMode('home');
    setBusy(false);
    setError(null);
    setRiskResult(null);
    setOptResult(null);
    setExplainText('');
    setAsBuiltPatches([]);
    setGenPreview(null);
    setCallStats({ total: 0, cached: 0 });
  }, []);

  // Wrap every async action with loading + error guard.
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); }
    catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally { setBusy(false); }
  }, []);

  const handleDetectRisks = useCallback(() => {
    setMode('risks');
    run(async () => {
      const res = await aiDetectRisks(tasks, cpm);
      setRiskResult({ summary: res.summary, findings: res.findings });
    });
  }, [tasks, cpm, run]);

  const handleOptimize = useCallback(() => {
    setMode('optimize');
    run(async () => {
      const res = await aiOptimizeSchedule(tasks, cpm);
      setOptResult({ summary: res.summary, ideas: res.ideas });
    });
  }, [tasks, cpm, run]);

  const handleExplain = useCallback(() => {
    setMode('explain');
    run(async () => {
      const res = await aiExplainCriticalPath(tasks, cpm);
      setExplainText(res.explanation);
    });
  }, [tasks, cpm, run]);

  const handleAsk = useCallback(() => {
    if (!chatDraft.trim()) return;
    const question = chatDraft.trim();
    setChatDraft('');
    run(async () => {
      const res = await aiAskSchedule(tasks, cpm, question, projectStartDate);
      setChatHistory(h => [...h, { q: question, a: res.answer }]);
    });
  }, [chatDraft, tasks, cpm, projectStartDate, run]);

  const handleAsBuiltParse = useCallback(() => {
    if (!asBuiltDraft.trim()) return;
    run(async () => {
      const res = await aiLogAsBuilt(tasks, asBuiltDraft.trim(), todayDayNumber);
      setAsBuiltPatches(res.patches);
    });
  }, [asBuiltDraft, tasks, todayDayNumber, run]);

  const handleAsBuiltApply = useCallback((p: AIAsBuiltPatch) => {
    onApplyPatch(p.taskId, p.patch);
    setAsBuiltPatches(prev => prev.filter(x => x.taskId !== p.taskId));
  }, [onApplyPatch]);

  const handleAsBuiltApplyAll = useCallback(() => {
    for (const p of asBuiltPatches) onApplyPatch(p.taskId, p.patch);
    setAsBuiltPatches([]);
    setAsBuiltDraft('');
  }, [asBuiltPatches, onApplyPatch]);

  const handleGenerate = useCallback(() => {
    if (!genDraft.trim()) return;
    run(async () => {
      const res = await aiGenerateSchedule(genDraft.trim());
      const materialized = materializeGeneratedTasks(res.tasks);
      setGenPreview(materialized);
    });
  }, [genDraft, run]);

  const handleGenerateApply = useCallback(() => {
    if (!genPreview) return;
    onReplaceAll(genPreview);
    setGenPreview(null);
    setGenDraft('');
    onClose();
  }, [genPreview, onReplaceAll, onClose]);

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
      <View style={styles.panel}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconWrap}>
              <Sparkles size={16} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.headerTitle}>AI Schedule Assistant</Text>
              <Text style={styles.headerSub}>
                {callStats.total > 0
                  ? `${callStats.total} call${callStats.total === 1 ? '' : 's'} · ${callStats.cached} cached`
                  : mode === 'home' ? 'Pick an action below' : `Mode: ${mode}`}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Mode switcher (always visible) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.modeRow}
        >
          {selectedCount > 0 && (
            <ModeChip icon={Sparkles} label={`Bulk (${selectedCount})`} active={mode === 'bulk'} onPress={() => setMode('bulk')} />
          )}
          <ModeChip icon={ShieldAlert} label="Risks"      active={mode === 'risks'}    onPress={handleDetectRisks} />
          <ModeChip icon={Zap}          label="Optimize"   active={mode === 'optimize'} onPress={handleOptimize} />
          <ModeChip icon={Target}       label="Explain CP" active={mode === 'explain'}  onPress={handleExplain} />
          <ModeChip icon={MessageSquare} label="Ask"       active={mode === 'ask'}      onPress={() => setMode('ask')} />
          <ModeChip icon={Mic}          label="As-built"  active={mode === 'asbuilt'}  onPress={() => setMode('asbuilt')} />
          <ModeChip icon={Wand2}        label="Generate"   active={mode === 'generate'} onPress={() => setMode('generate')} />
        </ScrollView>

        {/* Selection summary strip — informs the user that bulk ops are scoped. */}
        {selectedCount > 0 && mode === 'bulk' && (
          <View style={styles.selectionStrip}>
            <Sparkles size={12} color={Colors.primary} />
            <Text style={styles.selectionStripText} numberOfLines={2}>
              Bulk editing {selectedCount} task{selectedCount === 1 ? '' : 's'}:{' '}
              <Text style={styles.selectionStripNames}>
                {selectedTaskTitles.slice(0, 3).join(', ')}
                {selectedTaskTitles.length > 3 ? `, +${selectedTaskTitles.length - 3} more` : ''}
              </Text>
            </Text>
          </View>
        )}

        {/* Body — scroll area */}
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
          {busy && (
            <View style={styles.busyRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.busyText}>Thinking…</Text>
            </View>
          )}
          {error && (
            <View style={styles.errorCard}>
              <AlertTriangle size={14} color={Colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {mode === 'home' && !busy && (
            <HomeCard
              taskCount={tasks.length}
              criticalCount={cpm.criticalPath.length}
              onGenerate={() => setMode('generate')}
              onRisks={handleDetectRisks}
              onAsBuilt={() => setMode('asbuilt')}
            />
          )}

          {mode === 'risks' && riskResult && !busy && (
            <RisksView
              result={riskResult}
              tasks={tasks}
              onFocusTasks={onFocusTasks}
            />
          )}

          {mode === 'optimize' && optResult && !busy && (
            <OptimizeView result={optResult} tasks={tasks} onFocusTasks={onFocusTasks} />
          )}

          {mode === 'explain' && explainText !== '' && !busy && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Why this is the critical path</Text>
              <Text style={styles.cardBody}>{explainText}</Text>
            </View>
          )}

          {mode === 'ask' && (
            <View>
              {chatHistory.map((h, i) => (
                <View key={i} style={styles.chatTurn}>
                  <View style={styles.chatQ}>
                    <Text style={styles.chatQText}>{h.q}</Text>
                  </View>
                  <View style={styles.chatA}>
                    <Text style={styles.chatAText}>{h.a}</Text>
                  </View>
                </View>
              ))}
              {chatHistory.length === 0 && !busy && (
                <View style={styles.emptyHint}>
                  <Text style={styles.emptyHintText}>
                    Ask anything about the schedule. Try: {'\n'}
                    "When does drywall start?" {'\n'}
                    "What's on the critical path for week 6?" {'\n'}
                    "Which crew is busiest?"
                  </Text>
                </View>
              )}
            </View>
          )}

          {mode === 'asbuilt' && (
            <View>
              <View style={styles.emptyHint}>
                <Text style={styles.emptyHintText}>
                  Talk like you would to a site foreman. Try: {'\n'}
                  "We finished the foundation and started framing today." {'\n'}
                  AI will propose the matching task updates — you approve each.
                </Text>
              </View>
              {asBuiltPatches.length > 0 && (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{asBuiltPatches.length} update(s) proposed</Text>
                    <TouchableOpacity style={styles.applyAllBtn} onPress={handleAsBuiltApplyAll}>
                      <Check size={12} color="#fff" />
                      <Text style={styles.applyAllBtnText}>Apply all</Text>
                    </TouchableOpacity>
                  </View>
                  {asBuiltPatches.map(p => (
                    <View key={p.taskId} style={styles.patchRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.patchTitle}>{p.taskTitle}</Text>
                        <Text style={styles.patchDetail}>{describePatch(p.patch)}</Text>
                        {p.rationale ? <Text style={styles.patchRationale}>"{p.rationale}"</Text> : null}
                      </View>
                      <TouchableOpacity style={styles.applyBtn} onPress={() => handleAsBuiltApply(p)}>
                        <Check size={12} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {mode === 'bulk' && (
            <View>
              {selectedCount === 0 ? (
                <View style={styles.emptyHint}>
                  <Text style={styles.emptyHintText}>
                    No tasks are selected. Click a row's number in the grid to
                    select it, then come back here to edit in bulk with AI.
                  </Text>
                </View>
              ) : (
                <View style={styles.emptyHint}>
                  <Text style={styles.emptyHintText}>
                    Tell AI what to do with the {selectedCount} selected task{selectedCount === 1 ? '' : 's'}. Try:{'\n'}
                    "Compress each of these by 20%"{'\n'}
                    "Move them all out by one week"{'\n'}
                    "Reassign to the Finish Carp crew"
                  </Text>
                </View>
              )}
              {bulkResult && (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={[styles.cardTitle, { flex: 1 }]}>{bulkResult.patches.length} change(s) proposed</Text>
                    {bulkResult.fromCache && (
                      <View style={styles.cachedPill}>
                        <Text style={styles.cachedPillText}>cached</Text>
                      </View>
                    )}
                    {bulkResult.patches.length > 0 && (
                      <TouchableOpacity style={styles.applyAllBtn} onPress={handleBulkApplyAll}>
                        <Check size={12} color="#fff" />
                        <Text style={styles.applyAllBtnText}>Apply all</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {bulkResult.errorKind === 'validation' && (
                    <View style={styles.partialBanner}>
                      <AlertTriangle size={12} color={Colors.warning} />
                      <Text style={styles.partialBannerText}>
                        Partial result — AI response didn't fully match the expected shape. Review carefully before applying.
                      </Text>
                    </View>
                  )}
                  {bulkResult.summary ? (
                    <Text style={styles.cardBody}>{bulkResult.summary}</Text>
                  ) : null}
                  {bulkResult.patches.map(p => (
                    <View key={p.taskId} style={styles.patchRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.patchTitle}>{p.taskTitle}</Text>
                        <Text style={styles.patchDetail}>{describePatch(p.patch)}</Text>
                        {p.rationale ? <Text style={styles.patchRationale}>"{p.rationale}"</Text> : null}
                      </View>
                      <TouchableOpacity style={styles.applyBtn} onPress={() => handleBulkApplyOne(p)}>
                        <Check size={12} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {mode === 'generate' && (
            <View>
              <View style={styles.emptyHint}>
                <Text style={styles.emptyHintText}>
                  Describe your project and AI will draft the full schedule. Try: {'\n'}
                  "2500sqft two-story residential build, Dallas, break ground May 1, 4-month deadline" {'\n'}
                  You'll see a preview before anything replaces your current plan.
                </Text>
              </View>
              {genPreview && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{genPreview.length} tasks proposed</Text>
                  <Text style={styles.cardBody}>
                    Runs approximately{' '}
                    {Math.max(...genPreview.map(t => t.startDay + Math.max(0, t.durationDays - 1)))} days.
                  </Text>
                  <View style={{ maxHeight: 220, marginTop: 8 }}>
                    <ScrollView>
                      {genPreview.slice(0, 50).map((t, i) => (
                        <Text key={t.id} style={styles.genPreviewRow} numberOfLines={1}>
                          {i + 1}. {t.title}  ·  {t.durationDays}d  ·  {t.crew || '—'}
                        </Text>
                      ))}
                    </ScrollView>
                  </View>
                  <View style={styles.cardActions}>
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => setGenPreview(null)}>
                      <Text style={styles.secondaryBtnText}>Discard</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.primaryBtn} onPress={handleGenerateApply}>
                      <Check size={12} color="#fff" />
                      <Text style={styles.primaryBtnText}>Apply to project</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Input bar — changes by mode */}
        {mode === 'ask' && (
          <InputBar
            value={chatDraft}
            onChangeText={setChatDraft}
            onSubmit={handleAsk}
            placeholder="Ask anything about the schedule…"
            busy={busy}
          />
        )}
        {mode === 'asbuilt' && (
          <InputBar
            value={asBuiltDraft}
            onChangeText={setAsBuiltDraft}
            onSubmit={handleAsBuiltParse}
            placeholder="'We poured the slab and started framing today…'"
            busy={busy}
          />
        )}
        {mode === 'generate' && !genPreview && (
          <InputBar
            value={genDraft}
            onChangeText={setGenDraft}
            onSubmit={handleGenerate}
            placeholder="Describe your project in 1-2 sentences…"
            busy={busy}
          />
        )}
        {mode === 'bulk' && selectedCount > 0 && (
          <InputBar
            value={bulkDraft}
            onChangeText={setBulkDraft}
            onSubmit={handleBulkEdit}
            placeholder="What should I do with the selected tasks?"
            busy={busy}
          />
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ModeChip({
  icon: Icon, label, active, onPress,
}: { icon: any; label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.modeChip, active && styles.modeChipActive]} onPress={onPress} activeOpacity={0.8}>
      <Icon size={12} color={active ? '#fff' : Colors.primary} />
      <Text style={[styles.modeChipText, active && { color: '#fff' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function HomeCard({
  taskCount, criticalCount, onGenerate, onRisks, onAsBuilt,
}: { taskCount: number; criticalCount: number; onGenerate: () => void; onRisks: () => void; onAsBuilt: () => void; }) {
  const empty = taskCount === 0;
  return (
    <View>
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statNum}>{taskCount}</Text>
          <Text style={styles.statLabel}>Tasks</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: Colors.error }]}>{criticalCount}</Text>
          <Text style={styles.statLabel}>Critical</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Quick actions</Text>
      <View style={styles.quickGrid}>
        {empty ? (
          <QuickBtn icon={Wand2} title="Generate schedule" sub="Describe project → full plan" onPress={onGenerate} featured />
        ) : (
          <>
            <QuickBtn icon={ShieldAlert} title="Detect risks" sub="Scan for logic issues" onPress={onRisks} featured />
            <QuickBtn icon={Mic} title="Log progress" sub="Voice-to-actuals" onPress={onAsBuilt} />
          </>
        )}
      </View>
    </View>
  );
}

function QuickBtn({
  icon: Icon, title, sub, onPress, featured,
}: { icon: any; title: string; sub: string; onPress: () => void; featured?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.quickBtn, featured && styles.quickBtnFeatured]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Icon size={16} color={featured ? '#fff' : Colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.quickBtnTitle, featured && { color: '#fff' }]}>{title}</Text>
        <Text style={[styles.quickBtnSub, featured && { color: 'rgba(255,255,255,0.8)' }]}>{sub}</Text>
      </View>
      <ArrowRight size={14} color={featured ? '#fff' : Colors.textSecondary} />
    </TouchableOpacity>
  );
}

function RisksView({
  result, tasks, onFocusTasks,
}: { result: { summary: string; findings: AIRiskFinding[] }; tasks: ScheduleTask[]; onFocusTasks?: (ids: string[]) => void }) {
  const color = (s: AIRiskFinding['severity']) => s === 'high' ? Colors.error : s === 'medium' ? Colors.warning : Colors.textSecondary;
  const names = (ids: string[]) => ids.map(id => tasks.find(t => t.id === id)?.title).filter(Boolean).join(', ');
  return (
    <View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Summary</Text>
        <Text style={styles.cardBody}>{result.summary}</Text>
      </View>
      {result.findings.length === 0 && (
        <View style={styles.emptyHint}><Text style={styles.emptyHintText}>No issues found — the plan looks solid.</Text></View>
      )}
      {result.findings.map(f => (
        <View key={f.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.severityDot, { backgroundColor: color(f.severity) }]} />
            <Text style={[styles.cardTitle, { flex: 1 }]}>{f.title}</Text>
            <Text style={[styles.severityLabel, { color: color(f.severity) }]}>{f.severity.toUpperCase()}</Text>
          </View>
          <Text style={styles.cardBody}>{f.detail}</Text>
          {f.suggestion && <Text style={styles.cardSuggestion}>→ {f.suggestion}</Text>}
          {f.affectedTaskIds.length > 0 && (
            <TouchableOpacity
              style={styles.focusLink}
              onPress={() => onFocusTasks?.(f.affectedTaskIds)}
            >
              <Text style={styles.focusLinkText} numberOfLines={1}>
                Affects: {names(f.affectedTaskIds)}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

function OptimizeView({
  result, tasks, onFocusTasks,
}: { result: { summary: string; ideas: AIOptimizationIdea[] }; tasks: ScheduleTask[]; onFocusTasks?: (ids: string[]) => void }) {
  const names = (ids: string[]) => ids.map(id => tasks.find(t => t.id === id)?.title).filter(Boolean).join(', ');
  return (
    <View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Summary</Text>
        <Text style={styles.cardBody}>{result.summary}</Text>
      </View>
      {result.ideas.map(idea => (
        <View key={idea.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { flex: 1 }]}>{idea.title}</Text>
            {idea.expectedDaysSaved > 0 && (
              <Text style={styles.saveBadge}>−{idea.expectedDaysSaved}d</Text>
            )}
          </View>
          <Text style={styles.cardBody}>{idea.detail}</Text>
          {idea.affectedTaskIds.length > 0 && (
            <TouchableOpacity style={styles.focusLink} onPress={() => onFocusTasks?.(idea.affectedTaskIds)}>
              <Text style={styles.focusLinkText} numberOfLines={1}>
                Affects: {names(idea.affectedTaskIds)}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

function InputBar({
  value, onChangeText, onSubmit, placeholder, busy,
}: { value: string; onChangeText: (v: string) => void; onSubmit: () => void; placeholder: string; busy: boolean }) {
  return (
    <View style={styles.inputBar}>
      <TextInput
        style={styles.inputField}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        multiline
        blurOnSubmit
        onSubmitEditing={() => { if (!busy) onSubmit(); }}
      />
      <TouchableOpacity
        style={[styles.inputSend, (busy || !value.trim()) && { opacity: 0.5 }]}
        onPress={onSubmit}
        disabled={busy || !value.trim()}
      >
        {busy
          ? <ActivityIndicator size="small" color="#fff" />
          : <ArrowRight size={16} color="#fff" />}
      </TouchableOpacity>
    </View>
  );
}

function describePatch(patch: Partial<ScheduleTask>): string {
  const bits: string[] = [];
  if (patch.progress != null) bits.push(`${patch.progress}% progress`);
  if (patch.status) bits.push(patch.status.replace('_', ' '));
  if (patch.actualStartDay != null) bits.push(`start day ${patch.actualStartDay}`);
  if (patch.actualEndDay != null) bits.push(`finish day ${patch.actualEndDay}`);
  return bits.join(' · ') || 'update';
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 420;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    zIndex: 2000,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  panel: {
    width: PANEL_WIDTH,
    maxWidth: '100%',
    height: '100%',
    backgroundColor: Colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: Colors.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: -4, height: 0 },
    flexDirection: 'column',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.primary + '1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  closeBtn: { padding: 4 },

  modeRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.primary + '14',
  },
  modeChipActive: { backgroundColor: Colors.primary },
  modeChipText: { fontSize: 11, fontWeight: '700', color: Colors.primary },

  body: { flex: 1, padding: 12 },

  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  busyText: { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic' },

  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, marginBottom: 8,
    borderRadius: 8,
    backgroundColor: Colors.errorLight,
    borderWidth: 1,
    borderColor: Colors.error + '33',
  },
  errorText: { fontSize: 12, color: Colors.error, flex: 1 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: {
    flex: 1,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  statNum: { fontSize: 22, fontWeight: '800', color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, fontWeight: '600' },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  quickGrid: { gap: 8 },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  quickBtnFeatured: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  quickBtnTitle: { fontSize: 13, fontWeight: '700', color: Colors.text },
  quickBtnSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 12,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: Colors.text },
  cardBody: { fontSize: 12, color: Colors.text, lineHeight: 18 },
  cardSuggestion: { fontSize: 12, color: Colors.primary, marginTop: 6, fontWeight: '600' },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 12 },

  severityDot: { width: 8, height: 8, borderRadius: 4 },
  severityLabel: { fontSize: 9, fontWeight: '800' },

  saveBadge: {
    fontSize: 11, fontWeight: '800', color: Colors.success,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    backgroundColor: Colors.success + '20',
  },

  focusLink: { marginTop: 6 },
  focusLinkText: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic' },

  emptyHint: {
    padding: 14, borderRadius: 10,
    backgroundColor: Colors.fillSecondary,
    marginBottom: 10,
  },
  emptyHintText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },

  chatTurn: { marginBottom: 14 },
  chatQ: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 12, alignSelf: 'flex-end',
    maxWidth: '90%', marginBottom: 4,
  },
  chatQText: { color: '#fff', fontSize: 12 },
  chatA: {
    backgroundColor: Colors.fillSecondary,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 12, alignSelf: 'flex-start',
    maxWidth: '95%',
  },
  chatAText: { color: Colors.text, fontSize: 12, lineHeight: 18 },

  patchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  patchTitle: { fontSize: 12, fontWeight: '700', color: Colors.text },
  patchDetail: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  patchRationale: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic', marginTop: 2 },

  applyBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  applyAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  applyAllBtnText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 8, backgroundColor: Colors.primary,
  },
  primaryBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  secondaryBtn: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1, borderColor: Colors.cardBorder,
    backgroundColor: Colors.surface,
  },
  secondaryBtnText: { color: Colors.text, fontSize: 12, fontWeight: '700' },

  genPreviewRow: { fontSize: 11, color: Colors.text, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    backgroundColor: Colors.surfaceAlt,
  },
  inputField: {
    flex: 1,
    maxHeight: 80,
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    fontSize: 12,
    color: Colors.text,
  },
  inputSend: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  selectionStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.primary + '12',
    borderBottomWidth: 1,
    borderBottomColor: Colors.primary + '30',
  },
  selectionStripText: {
    flex: 1,
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 14,
  },
  selectionStripNames: {
    color: Colors.text,
    fontWeight: '600',
  },
  cachedPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: Colors.textSecondary + '22',
  },
  cachedPillText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  partialBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    marginTop: 4,
    marginBottom: 6,
    borderRadius: 6,
    backgroundColor: Colors.warning + '18',
    borderWidth: 1,
    borderColor: Colors.warning + '40',
  },
  partialBannerText: {
    flex: 1,
    fontSize: 11,
    color: Colors.warning,
    lineHeight: 15,
  },
});
