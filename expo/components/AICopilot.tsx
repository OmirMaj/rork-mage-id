import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  FlatList, KeyboardAvoidingView, Platform, Animated, ActivityIndicator,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Sparkles, Send, X, AlertTriangle, Lightbulb, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useBids } from '@/contexts/BidsContext';
import {
  askCopilot, buildProjectContext,
  type CopilotMessage,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage, getAIUsageStats } from '@/utils/aiRateLimiter';
import { useSubscription } from '@/contexts/SubscriptionContext';

const SUGGESTED_PROMPTS = [
  "What should I focus on today?",
  "Am I on budget?",
  "Which projects are at risk?",
  "Which invoices are overdue?",
  "What's my most profitable project?",
  "Draft a client update email",
];

const PRIORITY_COLORS = {
  urgent: { bg: '#FFF0EF', text: '#FF3B30', border: '#FF3B30' },
  important: { bg: '#FFF3E0', text: '#FF9500', border: '#FF9500' },
  suggestion: { bg: '#EBF3FF', text: '#007AFF', border: '#007AFF' },
} as const;

function createMsgId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function getDisplayContent(message: CopilotMessage): string {
  if (typeof message.content === 'string' && message.content.length > 0) {
    return message.content;
  }
  if (message.content && typeof message.content === 'object') {
    const obj = message.content as any;
    return obj.answer ?? obj.text ?? obj.response ?? obj.message ?? JSON.stringify(obj);
  }
  return 'No response content.';
}

const MessageBubble = React.memo(({ message }: { message: CopilotMessage }) => {
  const isUser = message.role === 'user';
  const displayText = getDisplayContent(message);

  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
        {!isUser && (
          <View style={styles.aiLabel}>
            <Sparkles size={10} color={Colors.primary} />
            <Text style={styles.aiLabelText}>MAGE AI</Text>
          </View>
        )}
        <Text style={[styles.bubbleText, isUser ? styles.userText : styles.aiText]}>
          {displayText}
        </Text>
        {Array.isArray(message.actionItems) && message.actionItems.length > 0 && (
          <View style={styles.actionItems}>
            {message.actionItems.map((item, idx) => {
              const colors = PRIORITY_COLORS[item.priority];
              return (
                <View key={idx} style={[styles.actionChip, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                  {item.priority === 'urgent' && <AlertTriangle size={11} color={colors.text} />}
                  {item.priority === 'suggestion' && <Lightbulb size={11} color={colors.text} />}
                  <Text style={[styles.actionChipText, { color: colors.text }]}>{item.text}</Text>
                </View>
              );
            })}
          </View>
        )}
        {Array.isArray(message.dataPoints) && message.dataPoints.length > 0 && (
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

function buildFullContext(projects: any[], bids: any[], subs: any[], equipment: any[], invoices: any[], changeOrders: any[]): string {
  const safeProjects = Array.isArray(projects) ? projects : [];
  const projectsSummary = safeProjects.map(p => {
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
    const limit = await checkAILimit(tier as any, requestTier);
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
      console.log('[Copilot] AI response:', JSON.stringify(response)?.substring(0, 300));
      console.log('[Copilot] response.answer type:', typeof response?.answer);
      await recordAIUsage(requestTier);
      void refreshUsage();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      let answerText = '';
      if (typeof response === 'string') {
        answerText = response;
      } else if (response && typeof response === 'object') {
        answerText = (response as any).answer ?? (response as any).text ?? (response as any).response ?? '';
        if (typeof answerText !== 'string') {
          answerText = JSON.stringify(answerText);
        }
      }
      if (!answerText) {
        answerText = 'AI returned a response but it could not be displayed. Please try again.';
      }

      const aiMsg: CopilotMessage = {
        id: createMsgId(),
        role: 'assistant',
        content: answerText,
        actionItems: Array.isArray(response?.actionItems) ? response.actionItems : [],
        dataPoints: Array.isArray(response?.dataPoints) ? response.dataPoints : [],
        timestamp: new Date().toISOString(),
      };

      console.log('[Copilot] Adding AI message, content length:', aiMsg.content.length);
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
    <MessageBubble message={item} />
  ), []);

  const keyExtractor = useCallback((item: CopilotMessage) => item.id, []);

  return (
    <>
      <Animated.View style={[styles.fab, { bottom: insets.bottom + 70, transform: [{ scale: pulseAnim }] }]}>
        <TouchableOpacity
          onPress={handleOpen}
          style={styles.fabButton}
          activeOpacity={0.8}
          testID="ai-copilot-fab"
        >
          <Sparkles size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>

      <Modal visible={isOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.modalContainer, { paddingBottom: insets.bottom }]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.headerLeft}>
                <Sparkles size={18} color={Colors.primary} />
                <Text style={styles.headerTitle}>MAGE AI Copilot</Text>
              </View>
              <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.projectBadge}>
              <Text style={styles.projectBadgeText} numberOfLines={1}>
                Analyzing {projects.length} project{projects.length !== 1 ? 's' : ''}, {subcontractors.length} subs, {equipment.length} equipment
              </Text>
            </View>

            {messages.length === 0 && !isLoading ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <Sparkles size={32} color={Colors.primary} />
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
                      <ChevronRight size={14} color={Colors.primary} />
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
                        <ActivityIndicator size="small" color={Colors.primary} />
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
                  placeholderTextColor={Colors.textMuted}
                  value={input}
                  onChangeText={setInput}
                  onSubmitEditing={() => handleSend()}
                  returnKeyType="send"
                  multiline={false}
                />
                <TouchableOpacity
                  onPress={() => handleSend()}
                  style={[styles.sendBtn, (!input.trim() || isLoading) && styles.sendBtnDisabled]}
                  disabled={!input.trim() || isLoading}
                >
                  <Send size={18} color={input.trim() && !isLoading ? '#FFFFFF' : Colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    zIndex: 999,
  },
  fabButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    minHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  projectBadge: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    backgroundColor: Colors.fillSecondary,
  },
  projectBadgeText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 32,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${Colors.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  suggestedPrompts: {
    width: '100%',
    gap: 8,
  },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  suggestText: {
    fontSize: 14,
    color: Colors.text,
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
    alignItems: 'flex-end',
  },
  bubbleRowLeft: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 16,
  },
  userBubble: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
  },
  aiLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  aiLabelText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
  },
  userText: {
    color: '#FFFFFF',
  },
  aiText: {
    color: Colors.text,
  },
  actionItems: {
    marginTop: 10,
    gap: 6,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 0.5,
  },
  actionChipText: {
    fontSize: 13,
    fontWeight: '500' as const,
    flex: 1,
  },
  dataGrid: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dataCard: {
    backgroundColor: Colors.fillSecondary,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    minWidth: 80,
  },
  dataLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  dataValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typingText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontStyle: 'italic' as const,
  },
  inputSection: {
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  usageCounter: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingTop: 6,
    fontWeight: '500' as const,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  chatInput: {
    flex: 1,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    maxHeight: 80,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.fillTertiary,
  },
});
