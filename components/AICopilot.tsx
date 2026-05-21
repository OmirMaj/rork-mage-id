import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  FlatList, KeyboardAvoidingView, Platform, Animated, ActivityIndicator,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Sparkles, Send, X, AlertTriangle, Lightbulb, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useBids } from '@/contexts/BidsContext';
import {
  askCopilot, buildProjectContext,
  type CopilotMessage,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage, getAIUsageStats } from '@/utils/aiRateLimiter';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const SUGGESTED_PROMPTS = [
  "What should I focus on today?",
  "Am I on budget?",
  "Which projects are at risk?",
  "Which invoices are overdue?",
  "What's my most profitable project?",
  "Draft a client update email",
];

function createMsgId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function getPriorityPalette(colors: ThemeColors, priority: 'urgent' | 'important' | 'suggestion') {
  switch (priority) {
    case 'urgent':     return { bg: colors.danger + '1F', text: colors.danger, border: colors.danger };
    case 'important':  return { bg: colors.accentSoft, text: colors.accentLabel, border: colors.accent };
    case 'suggestion':
    default:           return { bg: colors.info + '1F', text: colors.info, border: colors.info };
  }
}

interface MessageBubbleProps {
  message: CopilotMessage;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}

const MessageBubble = React.memo(function MessageBubble({ message, styles, colors }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
        {!isUser && (
          <View style={styles.aiLabel}>
            <Sparkles size={10} color={colors.accent} />
            <Text style={styles.aiLabelText}>MAGE AI</Text>
          </View>
        )}
        <Text style={[styles.bubbleText, isUser ? styles.userText : styles.aiText]}>
          {message.content}
        </Text>
        {message.actionItems && message.actionItems.length > 0 && (
          <View style={styles.actionItems}>
            {message.actionItems.map((item, idx) => {
              const palette = getPriorityPalette(colors, item.priority);
              return (
                <View key={idx} style={[styles.actionChip, { backgroundColor: palette.bg, borderColor: palette.border }]}>
                  {item.priority === 'urgent' && <AlertTriangle size={11} color={palette.text} />}
                  {item.priority === 'suggestion' && <Lightbulb size={11} color={palette.text} />}
                  <Text style={[styles.actionChipText, { color: palette.text }]}>{item.text}</Text>
                </View>
              );
            })}
          </View>
        )}
        {message.dataPoints && message.dataPoints.length > 0 && (
          <View style={styles.dataGrid}>
            {message.dataPoints.map((dp, idx) => (
              <View key={idx} style={styles.dataCard}>
                <Text style={styles.dataLabel}>{dp.label}</Text>
                <Text style={styles.dataValue}>{dp.value}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
});
MessageBubble.displayName = 'MessageBubble';

function buildFullContext(projects: any[], bids: any[], subs: any[], equipment: any[], invoices: any[], changeOrders: any[]): string {
  const projectsSummary = projects.map(p => {
    const schedule = p.schedule;
    const tasks = schedule?.tasks ?? [];
    const est = p.linkedEstimate ?? p.estimate;
    return `"${p.name}" — ${p.type} — ${p.status}
  Schedule: ${tasks.length} tasks, ${schedule?.healthScore ?? 'N/A'}/100 health
  Estimate: ${est && 'grandTotal' in est ? est.grandTotal.toLocaleString() : '0'}
  Progress: ${tasks.length > 0 ? Math.round(tasks.reduce((s: number, t: any) => s + t.progress, 0) / tasks.length) : 0}%`;
  }).join('\n');

  const pendingInvoices = invoices.filter((i: any) => i.status !== 'paid' && i.status !== 'draft');
  const overdueInvoices = invoices.filter((i: any) => i.status === 'overdue');

  return `CONTRACTOR'S DATA SNAPSHOT:

PROJECTS (${projects.length} total):
${projectsSummary || 'No projects'}

INVOICES:
Pending: ${pendingInvoices.length} totaling ${pendingInvoices.reduce((s: number, i: any) => s + (i.totalDue - i.amountPaid), 0).toLocaleString()}
Overdue: ${overdueInvoices.length}

CHANGE ORDERS: ${changeOrders.length} total

SUBCONTRACTORS (${subs.length}):
${subs.slice(0, 10).map((s: any) => `${s.companyName} — ${s.trade}`).join('\n') || 'None'}

EQUIPMENT (${equipment.length}):
${equipment.slice(0, 10).map((e: any) => `${e.name} — ${e.status}`).join('\n') || 'None'}

ACTIVE BIDS (${bids.length}):
${bids.slice(0, 5).map((b: any) => `"${b.title}" — ${b.estimatedValue?.toLocaleString() ?? '0'}`).join('\n') || 'None'}`;
}

export default function AICopilot() {
  const insets = useSafeAreaInsets();
  const { projects, invoices, changeOrders, subcontractors, equipment } = useProjects();
  const { bids } = useBids();
  const { tier } = useSubscription();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [usageText, setUsageText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const refreshUsage = useCallback(async () => {
    const stats = await getAIUsageStats(tier as any);
    setUsageText(`${stats.used}/${stats.limit} AI requests used today`);
  }, [tier]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  useEffect(() => {
    if (isOpen) {
      void refreshUsage();
    }
  }, [isOpen, refreshUsage]);

  const handleOpen = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const detectRequestTier = useCallback((text: string): 'fast' | 'smart' => {
    const smartKeywords = ['analyze', 'compare', 'should i', 'recommend', 'predict', 'calculate', 'draft', 'report'];
    const lower = text.toLowerCase();
    return smartKeywords.some(k => lower.includes(k)) ? 'smart' : 'fast';
  }, []);

  const handleSend = useCallback(async (text?: string) => {
    const msgText = text ?? input.trim();
    if (!msgText || isLoading) return;

    const requestTier = detectRequestTier(msgText);
    const limit = await checkAILimit(tier as any, requestTier, 'copilot');
    if (!limit.allowed) {
      const limitMsg: CopilotMessage = {
        id: createMsgId(),
        role: 'assistant',
        content: limit.message ?? "You've reached your daily AI limit.",
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, limitMsg]);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');

    const userMsg: CopilotMessage = {
      id: createMsgId(),
      role: 'user',
      content: msgText,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const fullContext = buildFullContext(
        projects, bids, subcontractors, equipment, invoices, changeOrders
      );
      const response = await askCopilot(msgText, fullContext);
      await recordAIUsage(requestTier, 'copilot');
      void refreshUsage();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const aiMsg: CopilotMessage = {
        id: createMsgId(),
        role: 'assistant',
        content: response.answer,
        actionItems: response.actionItems,
        dataPoints: response.dataPoints,
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      console.error('[AI Copilot] Error:', err);
      const errorMsg: CopilotMessage = {
        id: createMsgId(),
        role: 'assistant',
        content: 'AI analysis unavailable right now. Try again in a moment.',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, tier, projects, bids, subcontractors, equipment, invoices, changeOrders, detectRequestTier, refreshUsage]);

  const renderMessage = useCallback(({ item }: { item: CopilotMessage }) => (
    <MessageBubble message={item} styles={styles} colors={colors} />
  ), [styles, colors]);

  const keyExtractor = useCallback((item: CopilotMessage) => item.id, []);

  return (
    <>
      {/* Audit-2026-05-21 W12 (LOW): web has no tab-bar safe-area
          inset, so insets.bottom is usually 0. Add a 48px floor offset
          on web to keep the AI FAB clear of typical scrollable content
          edges. Matches the same +48 offset on UniversalMicButton so
          the two FABs stay vertically aligned. */}
      <Animated.View style={[styles.fab, { bottom: insets.bottom + 70 + (Platform.OS === 'web' ? 48 : 0), transform: [{ scale: pulseAnim }] }]}>
        <TouchableOpacity
          onPress={handleOpen}
          style={styles.fabButton}
          activeOpacity={0.8}
          testID="ai-copilot-fab" accessibilityRole="button" accessibilityLabel="AI"><Sparkles size={22} color={'#FFFFFF'} /></TouchableOpacity>
      </Animated.View>

      <Modal visible={isOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.modalContainer, { paddingBottom: insets.bottom }]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.headerLeft}>
                <Sparkles size={18} color={colors.accent} />
                <Text style={styles.headerTitle}>MAGE AI Copilot</Text>
              </View>
              <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={colors.textSecondary} /></TouchableOpacity>
            </View>

            <View style={styles.projectBadge}>
              <Text style={styles.projectBadgeText} numberOfLines={1}>
                Analyzing {projects.length} project{projects.length !== 1 ? 's' : ''}, {subcontractors.length} subs, {equipment.length} equipment
              </Text>
            </View>

            {messages.length === 0 && !isLoading ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <Sparkles size={32} color={colors.accent} />
                </View>
                <Text style={styles.emptyTitle}>Ask me anything about your project</Text>
                <Text style={styles.emptySubtitle}>I have access to your schedule, estimate, and project data.</Text>
                <View style={styles.suggestedPrompts}>
                  {SUGGESTED_PROMPTS.map((prompt, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={styles.suggestChip}
                      onPress={() => handleSend(prompt)}
                    >
                      <Text style={styles.suggestText}>{prompt}</Text>
                      <ChevronRight size={14} color={colors.accent} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <FlatList
                ref={flatListRef}
                data={messages}
                renderItem={renderMessage}
                keyExtractor={keyExtractor}
                contentContainerStyle={styles.messageList}
                onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                ListFooterComponent={isLoading ? (
                  <View style={[styles.bubbleRow, styles.bubbleRowLeft]}>
                    <View style={[styles.bubble, styles.aiBubble]}>
                      <View style={styles.typingRow}>
                        <ActivityIndicator size="small" color={colors.accent} />
                        <Text style={styles.typingText}>Analyzing your project data...</Text>
                      </View>
                    </View>
                  </View>
                ) : null}
              />
            )}

            <View style={styles.inputSection}>
              {usageText ? (
                <Text style={styles.usageCounter}>{usageText}</Text>
              ) : null}
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.chatInput}
                  placeholder="Ask about your projects..."
                  placeholderTextColor={colors.textMuted}
                  value={input}
                  onChangeText={setInput}
                  onSubmitEditing={() => handleSend()}
                  returnKeyType="send"
                  multiline={false}
                />
                <TouchableOpacity
                  onPress={() => handleSend()}
                  style={[styles.sendBtn, (!input.trim() || isLoading) && styles.sendBtnDisabled]}
                  disabled={!input.trim() || isLoading} accessibilityRole="button" accessibilityLabel="Send">
                  <Send size={18} color={input.trim() && !isLoading ? '#FFFFFF' : colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  fab: {
    position: 'absolute' as const,
    right: 20,
    zIndex: 999,
  },
  fabButton: {
    width: 52,
    height: 52,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end' as const,
  },
  modalContainer: {
    backgroundColor: t.bg,
    borderTopLeftRadius: Tokens.radius.xl,
    borderTopRightRadius: Tokens.radius.xl,
    maxHeight: '80%' as const,
    minHeight: '60%' as const,
  },
  modalHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
    backgroundColor: t.surface,
    borderTopLeftRadius: Tokens.radius.xl,
    borderTopRightRadius: Tokens.radius.xl,
  },
  headerLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  headerTitle: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  projectBadge: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    backgroundColor: t.surfaceAlt,
  },
  projectBadgeText: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    fontWeight: '500' as const,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center' as const,
    paddingTop: 32,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    marginBottom: 6,
    textAlign: 'center' as const,
  },
  emptySubtitle: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.textSecondary,
    textAlign: 'center' as const,
    marginBottom: 20,
  },
  suggestedPrompts: {
    width: '100%' as const,
    gap: 8,
  },
  suggestChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
  },
  suggestText: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bubbleRow: {
    marginBottom: 10,
  },
  bubbleRowRight: {
    alignItems: 'flex-end' as const,
  },
  bubbleRowLeft: {
    alignItems: 'flex-start' as const,
  },
  bubble: {
    maxWidth: '85%' as const,
    padding: 12,
    borderRadius: Tokens.radius.panel,
  },
  userBubble: {
    backgroundColor: t.accent,
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: t.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 0.5,
    borderColor: t.line,
  },
  aiLabel: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginBottom: 4,
  },
  aiLabelText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: t.accent,
    letterSpacing: 0.5,
  },
  bubbleText: {
    fontSize: Type.subhead.fontSize,
    lineHeight: 21,
  },
  userText: {
    color: '#FFFFFF',
  },
  aiText: {
    color: t.text,
  },
  actionItems: {
    marginTop: 10,
    gap: 6,
  },
  actionChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.sm,
    borderWidth: 0.5,
  },
  actionChipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '500' as const,
    flex: 1,
  },
  dataGrid: {
    marginTop: 10,
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  dataCard: {
    backgroundColor: t.surfaceAlt,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.sm,
    minWidth: 80,
  },
  dataLabel: {
    fontSize: 10,
    color: t.textMuted,
    fontWeight: '500' as const,
  },
  dataValue: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  typingRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  typingText: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    fontStyle: 'italic' as const,
  },
  inputSection: {
    borderTopWidth: 0.5,
    borderTopColor: t.line,
    backgroundColor: t.surface,
  },
  usageCounter: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    textAlign: 'center' as const,
    paddingTop: 6,
    fontWeight: '500' as const,
  },
  inputRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  chatInput: {
    flex: 1,
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.full,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: Type.subhead.fontSize,
    color: t.text,
    maxHeight: 80,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  sendBtnDisabled: {
    backgroundColor: t.line,
  },
});
