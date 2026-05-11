import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  KeyboardAvoidingView, Platform, Animated,
  Pressable, ScrollView, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Mic, Send, X, CheckCircle2, AlertTriangle, HelpCircle,
  RotateCcw, ChevronRight, Clock, Sparkles, MessageSquare,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import type { ScheduleTask } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  parseVoiceCommand,
  parseBatchVoiceCommand,
  parseDailyReportVoice,
  isBatchCommand,
  isDailyReport,
  type ParsedVoiceCommand,
} from '@/utils/voiceCommandParser';
import {
  executeVoiceCommand,
  executeBatchCommands,
  saveVoiceHistory,
  getVoiceHistory,
  saveVoiceIssue,
  findTaskByName,
  type VoiceCommandResult,
  type VoiceUpdateFunctions,
  type VoiceHistoryItem,
} from '@/utils/voiceCommandExecutor';

interface VoiceCommandModalProps {
  visible: boolean;
  onClose: () => void;
  tasks: ScheduleTask[];
  projectName: string;
  projectId: string;
  updateFunctions: VoiceUpdateFunctions;
  activeTodayTask?: ScheduleTask | null;
}

type ModalState = 'input' | 'processing' | 'success' | 'error' | 'clarification' | 'batch_success';

interface BatchResultItem {
  taskName: string;
  success: boolean;
  message: string;
}

const QUICK_COMMANDS = [
  { label: 'Update progress', template: 'Update [task] to [%] percent' },
  { label: 'Mark complete', template: 'Mark [task] complete' },
  { label: 'Log issue', template: 'Log issue: ' },
  { label: 'Add note', template: 'Add note to [task]: ' },
  { label: "What's the status?", template: "What's the status of my project?" },
  { label: "What's next?", template: 'What tasks are coming up next?' },
];

const HistoryItem = React.memo(function HistoryItem({
  item, onTap,
}: { item: VoiceHistoryItem; onTap: (text: string) => void }) {
  const timeAgo = useMemo(() => {
    const diff = Date.now() - new Date(item.timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hr ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }, [item.timestamp]);

  return (
    <TouchableOpacity
      style={histStyles.historyItem}
      onPress={() => onTap(item.spokenText)}
      activeOpacity={0.7}
    >
      {item.success ? (
        <CheckCircle2 size={13} color={Colors.success} />
      ) : (
        <X size={13} color={Colors.error} />
      )}
      <Text style={histStyles.historyText} numberOfLines={1}>{item.spokenText}</Text>
      <Text style={histStyles.historyTime}>{timeAgo}</Text>
    </TouchableOpacity>
  );
});

export default function VoiceCommandModal({
  visible, onClose, tasks, projectName, projectId, updateFunctions, activeTodayTask,
}: VoiceCommandModalProps) {
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState('');
  const [modalState, setModalState] = useState<ModalState>('input');
  const [resultMessage, setResultMessage] = useState('');
  const [undoAction, setUndoAction] = useState<(() => void) | null>(null);
  const [clarificationTasks, setClarificationTasks] = useState<ScheduleTask[]>([]);
  const [pendingParsed, setPendingParsed] = useState<ParsedVoiceCommand | null>(null);
  const [batchResults, setBatchResults] = useState<BatchResultItem[]>([]);
  const [history, setHistory] = useState<VoiceHistoryItem[]>([]);
  const inputRef = useRef<TextInput>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setModalState('input');
      setInputText('');
      setResultMessage('');
      setUndoAction(null);
      setClarificationTasks([]);
      setBatchResults([]);
      getVoiceHistory().then(setHistory);
      setTimeout(() => inputRef.current?.focus(), 300);
    }
    return () => {
      if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    };
  }, [visible]);

  const startAutoDismiss = useCallback(() => {
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    autoDismissTimer.current = setTimeout(() => {
      onClose();
    }, 4000);
  }, [onClose]);

  const taskContext = useMemo(() => {
    return tasks.map(t => ({
      title: t.title,
      phase: t.phase,
      progress: t.progress,
      status: t.status,
      crew: t.crew,
    }));
  }, [tasks]);

  const processCommand = useCallback(async (text: string) => {
    if (!text.trim()) return;

    setModalState('processing');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();

    try {
      if (isDailyReport(text)) {
        const reportData = await parseDailyReportVoice(text, projectName);
        setResultMessage('Daily report data extracted! Open Daily Report to review.');
        setModalState('success');
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        await saveVoiceHistory({
          id: `vh-${Date.now()}`,
          spokenText: text,
          parsedAction: 'daily_report',
          success: true,
          timestamp: new Date().toISOString(),
          projectId,
        });
        startAutoDismiss();
        return;
      }

      if (isBatchCommand(text)) {
        const batchParsed = await parseBatchVoiceCommand(text, taskContext, projectName);
        if (batchParsed.commands.length > 1) {
          const { results, allSuccess } = executeBatchCommands(batchParsed, tasks, updateFunctions);
          const batchItems: BatchResultItem[] = batchParsed.commands.map((cmd, i) => ({
            taskName: cmd.taskName,
            success: results[i]?.success ?? false,
            message: results[i]?.message ?? 'Unknown error',
          }));
          setBatchResults(batchItems);
          setUndoAction(results[0]?.undoAction ? () => results[0].undoAction?.() : null);
          setModalState('batch_success');

          if (Platform.OS !== 'web') {
            void Haptics.notificationAsync(
              allSuccess ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
            );
          }

          await saveVoiceHistory({
            id: `vh-${Date.now()}`,
            spokenText: text,
            parsedAction: 'batch',
            success: allSuccess,
            timestamp: new Date().toISOString(),
            projectId,
          });
          startAutoDismiss();
          return;
        }
      }

      const parsed = await parseVoiceCommand(text, taskContext, projectName);

      if (parsed.action === 'log_issue' && parsed.text) {
        await saveVoiceIssue(projectId, parsed.text);
      }

      const result = executeVoiceCommand(parsed, tasks, updateFunctions);

      if (result.needsClarification && result.matchedTasks) {
        setClarificationTasks(result.matchedTasks);
        setPendingParsed(parsed);
        setModalState('clarification');
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
      } else if (result.success) {
        setResultMessage(result.message);
        setUndoAction(result.undoAction ? () => result.undoAction?.() : null);
        setModalState('success');
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        startAutoDismiss();
      } else {
        setResultMessage(result.message);
        setModalState('error');
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }

      await saveVoiceHistory({
        id: `vh-${Date.now()}`,
        spokenText: text,
        parsedAction: parsed.action,
        taskName: parsed.taskName,
        success: result.success,
        timestamp: new Date().toISOString(),
        projectId,
      });
    } catch (err) {
      console.log('[VoiceModal] Processing error:', err);
      setResultMessage('Voice processing unavailable. Try typing your update instead.');
      setModalState('error');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [projectName, projectId, taskContext, tasks, updateFunctions, startAutoDismiss]);

  const handleClarificationSelect = useCallback((task: ScheduleTask) => {
    if (!pendingParsed) return;
    const result = executeVoiceCommand(
      { ...pendingParsed, taskName: task.title },
      tasks,
      updateFunctions,
    );
    if (result.success) {
      setResultMessage(result.message);
      setUndoAction(result.undoAction ? () => result.undoAction?.() : null);
      setModalState('success');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      startAutoDismiss();
    } else {
      setResultMessage(result.message);
      setModalState('error');
    }
  }, [pendingParsed, tasks, updateFunctions, startAutoDismiss]);

  const handleQuickCommand = useCallback((template: string) => {
    let filled = template;
    if (activeTodayTask) {
      filled = filled.replace('[task]', activeTodayTask.title);
    }
    setInputText(filled);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [activeTodayTask]);

  const handleNewCommand = useCallback(() => {
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    setModalState('input');
    setInputText('');
    setResultMessage('');
    setUndoAction(null);
    setClarificationTasks([]);
    setBatchResults([]);
    getVoiceHistory().then(setHistory);
    setTimeout(() => inputRef.current?.focus(), 200);
  }, []);

  const handleUndo = useCallback(() => {
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    if (undoAction) {
      undoAction();
      setResultMessage('Action undone');
      setUndoAction(null);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [undoAction]);

  const renderInput = () => (
    <>
      <View style={s.inputSection}>
        <TextInput
          ref={inputRef}
          style={s.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder={'Say something like "Mark framing 80% complete"'}
          placeholderTextColor={Colors.textMuted}
          multiline
          returnKeyType="send"
          onSubmitEditing={() => processCommand(inputText)}
          testID="voice-command-input"
        />
        <View style={s.inputHint}>
          <Mic size={14} color={Colors.textMuted} />
          <Text style={s.inputHintText}>Tap mic on keyboard to speak</Text>
        </View>
      </View>

      <Text style={s.sectionLabel}>Quick Commands</Text>
      <View style={s.chipsRow}>
        {QUICK_COMMANDS.map((cmd, i) => (
          <TouchableOpacity
            key={i}
            style={s.chip}
            onPress={() => handleQuickCommand(cmd.template)}
            activeOpacity={0.7}
          >
            <Text style={s.chipText}>{cmd.label}</Text>
            <ChevronRight size={11} color={Colors.textSecondary} />
          </TouchableOpacity>
        ))}
      </View>

      {history.length > 0 && (
        <>
          <Text style={s.sectionLabel}>Recent</Text>
          <View style={s.historyList}>
            {history.slice(0, 5).map(item => (
              <HistoryItem
                key={item.id}
                item={item}
                onTap={(text) => { setInputText(text); }}
              />
            ))}
          </View>
        </>
      )}
    </>
  );

  const renderProcessing = () => (
    <View style={s.stateContainer}>
      <ConstructionLoader size="lg" />
      <Text style={s.stateTitle}>Understanding...</Text>
      <Text style={s.stateSubtitle}>Analyzing your command</Text>
    </View>
  );

  const renderSuccess = () => (
    <View style={s.stateContainer}>
      <View style={s.successIcon}>
        <CheckCircle2 size={36} color={Colors.success} />
      </View>
      <Text style={s.stateTitle}>Done!</Text>
      <Text style={s.stateMessage}>{resultMessage}</Text>
      <View style={s.actionRow}>
        {undoAction && (
          <TouchableOpacity style={s.undoBtn} onPress={handleUndo} activeOpacity={0.7}>
            <RotateCcw size={14} color={Colors.primary} />
            <Text style={s.undoBtnText}>Undo</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.newCmdBtn} onPress={handleNewCommand} activeOpacity={0.7}>
          <Mic size={14} color="#fff" />
          <Text style={s.newCmdBtnText}>New Command</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderBatchSuccess = () => (
    <View style={s.stateContainer}>
      <View style={s.successIcon}>
        <CheckCircle2 size={36} color={Colors.success} />
      </View>
      <Text style={s.stateTitle}>{batchResults.filter(r => r.success).length} updates applied</Text>
      <View style={s.batchList}>
        {batchResults.map((r, i) => (
          <View key={i} style={s.batchItem}>
            {r.success ? (
              <CheckCircle2 size={14} color={Colors.success} />
            ) : (
              <AlertTriangle size={14} color={Colors.error} />
            )}
            <Text style={[s.batchItemText, !r.success && { color: Colors.error }]}>{r.message}</Text>
          </View>
        ))}
      </View>
      <View style={s.actionRow}>
        {undoAction && (
          <TouchableOpacity style={s.undoBtn} onPress={handleUndo} activeOpacity={0.7}>
            <RotateCcw size={14} color={Colors.primary} />
            <Text style={s.undoBtnText}>Undo All</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.newCmdBtn} onPress={handleNewCommand} activeOpacity={0.7}>
          <Text style={s.newCmdBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderError = () => (
    <View style={s.stateContainer}>
      <View style={s.errorIcon}>
        <HelpCircle size={36} color={Colors.warning} />
      </View>
      <Text style={s.stateTitle}>Didn't catch that</Text>
      <Text style={s.stateMessage}>{resultMessage}</Text>
      <View style={s.helpSection}>
        <Text style={s.helpTitle}>Try something like:</Text>
        <Text style={s.helpExample}>• "Update framing to 75%"</Text>
        <Text style={s.helpExample}>• "Mark drywall complete"</Text>
        <Text style={s.helpExample}>• "Add note to plumbing task"</Text>
      </View>
      <View style={s.actionRow}>
        <TouchableOpacity style={s.newCmdBtn} onPress={handleNewCommand} activeOpacity={0.7}>
          <Text style={s.newCmdBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderClarification = () => (
    <View style={s.stateContainer}>
      <View style={s.clarifyIcon}>
        <HelpCircle size={36} color={Colors.info} />
      </View>
      <Text style={s.stateTitle}>Which task?</Text>
      <Text style={s.stateMessage}>
        I found {clarificationTasks.length} matching tasks:
      </Text>
      <View style={s.clarifyList}>
        {clarificationTasks.map(task => (
          <TouchableOpacity
            key={task.id}
            style={s.clarifyTask}
            onPress={() => handleClarificationSelect(task)}
            activeOpacity={0.7}
          >
            <View style={[s.clarifyDot, { backgroundColor: Colors.primary }]} />
            <View style={s.clarifyTaskInfo}>
              <Text style={s.clarifyTaskName}>{task.title}</Text>
              <Text style={s.clarifyTaskMeta}>{task.phase} · {task.progress}%</Text>
            </View>
            <ChevronRight size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={s.undoBtn} onPress={handleNewCommand} activeOpacity={0.7}>
        <Text style={s.undoBtnText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={s.overlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.keyboardView}
        >
          <Pressable
            style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onPress={() => undefined}
          >
            <View style={s.handle} />
            <View style={s.header}>
              <View style={s.headerLeft}>
                <Mic size={18} color={Colors.primary} />
                <Text style={s.headerTitle}>MAGE Voice</Text>
                <View style={s.aiBadge}>
                  <Sparkles size={9} color={Colors.primary} />
                  <Text style={s.aiBadgeText}>AI</Text>
                </View>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.textMuted} /></TouchableOpacity>
            </View>

            <ScrollView
              style={s.content}
              contentContainerStyle={s.contentInner}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {modalState === 'input' && renderInput()}
              {modalState === 'processing' && renderProcessing()}
              {modalState === 'success' && renderSuccess()}
              {modalState === 'batch_success' && renderBatchSuccess()}
              {modalState === 'error' && renderError()}
              {modalState === 'clarification' && renderClarification()}
            </ScrollView>

            {modalState === 'input' && (
              <View style={s.bottomBar}>
                <TouchableOpacity
                  style={[s.sendBtn, !inputText.trim() && s.sendBtnDisabled]}
                  onPress={() => processCommand(inputText)}
                  disabled={!inputText.trim()}
                  activeOpacity={0.7}
                  testID="voice-send-btn" accessibilityRole="button" accessibilityLabel="Send">
                  <Send size={18} color={inputText.trim() ? '#fff' : Colors.textMuted} />
                </TouchableOpacity>
              </View>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  keyboardView: {
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    minHeight: 360,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.fillTertiary,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Tokens.spacing.lg,
    paddingVertical: Tokens.spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Tokens.spacing.xs,
  },
  headerTitle: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: 6,
    paddingVertical: Tokens.spacing.hairline,
    borderRadius: Tokens.radius.xs,
  },
  aiBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: Tokens.spacing.lg,
    paddingBottom: Tokens.spacing.xs,
  },
  inputSection: {
    marginBottom: Tokens.spacing.lg,
  },
  textInput: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.panel,
    paddingHorizontal: Tokens.spacing.md,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: Type.body.fontSize,
    color: Colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  inputHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Tokens.spacing.xs,
    paddingHorizontal: Tokens.spacing.xxs,
  },
  inputHintText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
  },
  sectionLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    marginBottom: Tokens.spacing.xs,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Tokens.spacing.xs,
    marginBottom: Tokens.spacing.lg,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Tokens.spacing.xxs,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.xs,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  chipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  historyList: {
    gap: Tokens.spacing.xxs,
    marginBottom: Tokens.spacing.md,
  },
  stateContainer: {
    alignItems: 'center',
    paddingVertical: Tokens.spacing.xl,
    gap: Tokens.spacing.sm,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.warningLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clarifyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.infoLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  stateSubtitle: {
    fontSize: Type.bodyCompact.fontSize,
    color: Colors.textSecondary,
  },
  stateMessage: {
    fontSize: Type.bodyCompact.fontSize,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: Tokens.spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Tokens.spacing.sm,
    marginTop: Tokens.spacing.xs,
  },
  undoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Tokens.spacing.lg,
    paddingVertical: Tokens.spacing.sm,
    borderRadius: Tokens.radius.lg,
    backgroundColor: Colors.fillTertiary,
  },
  undoBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  newCmdBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Tokens.spacing.lg,
    paddingVertical: Tokens.spacing.sm,
    borderRadius: Tokens.radius.lg,
    backgroundColor: Colors.primary,
  },
  newCmdBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: '#fff',
  },
  batchList: {
    width: '100%',
    gap: Tokens.spacing.xs,
    paddingHorizontal: Tokens.spacing.sm,
  },
  batchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Tokens.spacing.xs,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Tokens.radius.card,
  },
  batchItemText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '500' as const,
    color: Colors.text,
    flex: 1,
  },
  helpSection: {
    alignSelf: 'stretch',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.lg,
    padding: Tokens.spacing.md,
    gap: 6,
    marginHorizontal: Tokens.spacing.sm,
  },
  helpTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    marginBottom: Tokens.spacing.hairline,
  },
  helpExample: {
    fontSize: Type.bodyCompact.fontSize,
    color: Colors.text,
    lineHeight: 22,
  },
  clarifyList: {
    width: '100%',
    gap: 6,
    paddingHorizontal: Tokens.spacing.xs,
  },
  clarifyTask: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 14,
    paddingVertical: Tokens.spacing.sm,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  clarifyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  clarifyTaskInfo: {
    flex: 1,
    gap: Tokens.spacing.hairline,
  },
  clarifyTaskName: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  clarifyTaskMeta: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Tokens.spacing.lg,
    paddingVertical: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.fillTertiary,
  },
});

const histStyles = StyleSheet.create({
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Tokens.spacing.xs,
    paddingVertical: Tokens.spacing.xs,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.surfaceAlt,
  },
  historyText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: Colors.text,
  },
  historyTime: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
  },
});
