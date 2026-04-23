# AI Features — Copilot, Voice & Service Layer


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

MAGE AI threading runs through `utils/mageAI.ts` + `utils/aiService.ts`
with rate limiting in `aiRateLimiter.ts`. The copilot is a floating overlay
(`components/AICopilot.tsx`). Voice capture + command parsing feed into
scheduling, daily reports, and quick-updates.


## Files in this bundle

- `components/AICopilot.tsx`
- `components/VoiceRecorder.tsx`
- `components/VoiceCommandModal.tsx`
- `utils/mageAI.ts`
- `utils/aiService.ts`
- `utils/aiRateLimiter.ts`
- `utils/voiceCommandParser.ts`
- `utils/voiceCommandExecutor.ts`


---

### `components/AICopilot.tsx`

```tsx
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

const MessageBubble = React.memo(({ message }: { message: CopilotMessage }) => {
  const isUser = message.role === 'user';

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
          {message.content}
        </Text>
        {message.actionItems && message.actionItems.length > 0 && (
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
      await recordAIUsage(requestTier);
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

```


---

### `components/VoiceRecorder.tsx`

```tsx
import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform,
  Animated,
} from 'react-native';
import { Mic, MicOff, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface VoiceRecorderProps {
  onTranscriptReady: (transcript: string) => void;
  isLoading: boolean;
  isLocked?: boolean;
  onLockedPress?: () => void;
}

export default function VoiceRecorder({ onTranscriptReady, isLoading, isLocked, onLockedPress }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingRef, setRecordingRef] = useState<any>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  const startPulse = useCallback(() => {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    pulseLoop.current.start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    pulseLoop.current?.stop();
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  const handlePress = useCallback(async () => {
    if (isLocked) {
      onLockedPress?.();
      return;
    }

    if (Platform.OS === 'web') {
      return;
    }

    if (isRecording && recordingRef) {
      try {
        console.log('[VoiceDFR] Stopping recording');
        stopPulse();
        setIsRecording(false);
        await recordingRef.stopAndUnloadAsync();
        const { Audio } = require('expo-av');
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        const uri = recordingRef.getURI();
        setRecordingRef(null);

        if (uri) {
          console.log('[VoiceDFR] Sending audio for transcription');
          const uriParts = uri.split('.');
          const fileType = uriParts[uriParts.length - 1];
          const formData = new FormData();
          const audioFile = { uri, name: `recording.${fileType}`, type: `audio/${fileType}` };
          formData.append('audio', audioFile as any);

          const response = await fetch('https://toolkit.rork.com/stt/transcribe/', {
            method: 'POST',
            body: formData,
          });
          const data = await response.json();
          if (data.text) {
            console.log('[VoiceDFR] Transcription received:', data.text.substring(0, 50));
            onTranscriptReady(data.text);
          }
        }
      } catch (err) {
        console.log('[VoiceDFR] Recording stop error:', err);
      }
    } else {
      try {
        const { Audio } = require('expo-av');
        console.log('[VoiceDFR] Requesting permissions');
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) return;

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });

        const recording = new Audio.Recording();
        await recording.prepareToRecordAsync({
          android: {
            extension: '.m4a',
            outputFormat: 3,
            audioEncoder: 3,
          },
          ios: {
            extension: '.wav',
            outputFormat: 6,
            audioQuality: 127,
          },
          web: {},
        });
        await recording.startAsync();
        setRecordingRef(recording);
        setIsRecording(true);
        startPulse();
        console.log('[VoiceDFR] Recording started');
      } catch (err) {
        console.log('[VoiceDFR] Recording start error:', err);
      }
    }
  }, [isRecording, recordingRef, isLocked, onLockedPress, onTranscriptReady, startPulse, stopPulse]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={[styles.micBtn, styles.micBtnDisabled]}>
          <MicOff size={20} color={Colors.textMuted} />
        </View>
        <Text style={styles.webLabel}>Voice input not available on web</Text>
      </View>
    );
  }

  if (isLocked) {
    return (
      <TouchableOpacity style={styles.container} onPress={onLockedPress} activeOpacity={0.7}>
        <View style={[styles.micBtn, styles.micBtnLocked]}>
          <Lock size={18} color={Colors.textMuted} />
        </View>
        <Text style={styles.lockedLabel}>Pro feature — tap to upgrade</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7} disabled={isLoading} testID="voice-record-btn">
        <Animated.View style={[
          styles.micBtn,
          isRecording && styles.micBtnRecording,
          { transform: [{ scale: isRecording ? pulseAnim : 1 }] },
        ]}>
          {isLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Mic size={20} color={isRecording ? '#fff' : Colors.primary} />
          )}
        </Animated.View>
      </TouchableOpacity>
      <Text style={styles.label}>
        {isLoading ? 'Processing...' : isRecording ? 'Tap to stop' : 'Tap to dictate'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginBottom: 12,
  },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnRecording: {
    backgroundColor: Colors.error,
  },
  micBtnDisabled: {
    backgroundColor: Colors.fillTertiary,
  },
  micBtnLocked: {
    backgroundColor: Colors.fillTertiary,
  },
  label: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  webLabel: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  lockedLabel: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
});

```


---

### `components/VoiceCommandModal.tsx`

```tsx
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
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
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
                  testID="voice-send-btn"
                >
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
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
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
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
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
    padding: 20,
    paddingBottom: 8,
  },
  inputSection: {
    marginBottom: 20,
  },
  textInput: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 17,
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
    marginTop: 8,
    paddingHorizontal: 4,
  },
  inputHintText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  historyList: {
    gap: 4,
    marginBottom: 16,
  },
  stateContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
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
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  stateSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  stateMessage: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  undoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Colors.fillTertiary,
  },
  undoBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  newCmdBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Colors.primary,
  },
  newCmdBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#fff',
  },
  batchList: {
    width: '100%',
    gap: 8,
    paddingHorizontal: 12,
  },
  batchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  batchItemText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
    flex: 1,
  },
  helpSection: {
    alignSelf: 'stretch',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 14,
    padding: 16,
    gap: 6,
    marginHorizontal: 12,
  },
  helpTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  helpExample: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 22,
  },
  clarifyList: {
    width: '100%',
    gap: 6,
    paddingHorizontal: 8,
  },
  clarifyTask: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
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
    gap: 2,
  },
  clarifyTaskName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  clarifyTaskMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
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
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
  },
  historyText: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
  },
  historyTime: {
    fontSize: 11,
    color: Colors.textMuted,
  },
});

```


---

### `utils/mageAI.ts`

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const AI_URL = "https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/ai";
const AI_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50ZW9xaGNzd2FwcHh4amxwdmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTU0MDMsImV4cCI6MjA4OTg5MTQwM30.xpz7yWhignppH-3dYD-EV4AvB4cugr7-881GKdOFado";
const CACHE_PREFIX = "mage_ai_cache_";

interface MageAIParams {
  prompt: string;
  schema?: any;           // Zod schema — used client-side for validation only, NOT sent to edge function
  schemaHint?: object;    // Plain JSON example — sent to edge function so Gemini knows the shape
  tier?: "fast" | "smart";
  maxTokens?: number;
  cacheKey?: string;
  cacheHours?: number;
  /** Abort the fetch after this many ms. Default 30s. */
  timeoutMs?: number;
}

interface MageAIResult {
  success: boolean;
  data: any;
  raw?: string;
  error?: string;
  cached?: boolean;
  /** Why the call failed, in a way the UI can branch on. */
  errorKind?: 'timeout' | 'network' | 'http' | 'model' | 'validation' | 'unknown';
  /** Convenience for UIs that want to show a "cached" pill. */
  fromCache?: boolean;
}

async function getCache(key: string): Promise<MageAIResult | null> {
  try {
    const c = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!c) return null;
    const { result, expiresAt } = JSON.parse(c);
    if (Date.now() > expiresAt) { await AsyncStorage.removeItem(CACHE_PREFIX + key); return null; }
    // Surface both flags — `cached` is the legacy name some UIs read, `fromCache`
    // is the newer name. Both mean the same thing: this did not hit the network.
    return { ...result, cached: true, fromCache: true };
  } catch { return null; }
}

async function setCache(key: string, result: MageAIResult, hours: number) {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ result, expiresAt: Date.now() + hours * 3600000 }));
  } catch {}
}

export async function mageAI(params: MageAIParams): Promise<MageAIResult> {
  const { prompt, schema, schemaHint, tier = "fast", maxTokens = 1000, cacheKey, cacheHours = 2, timeoutMs = 30000 } = params;
  if (cacheKey) { const c = await getCache(cacheKey); if (c) return c; }

  // AbortController-based timeout. Without this, a hung edge function (or a
  // laptop that went to sleep mid-request) leaves the UI spinner going forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Never send Zod schema objects to the edge function — JSON.stringify(zodSchema)
    // produces Zod internal structure, not a usable JSON example for the model.
    // Use schemaHint (a plain JS object) for the model, and schema (Zod) for client-side validation.
    const payload: Record<string, unknown> = { prompt, tier, maxTokens };
    if (schemaHint) {
      payload.schemaHint = schemaHint;
      payload.jsonMode = true;
    } else if (schema) {
      // No schemaHint provided — still enable JSON mode so Gemini returns parseable JSON
      payload.jsonMode = true;
    }

    const r = await fetch(AI_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + AI_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!r.ok) {
      clearTimeout(timer);
      return {
        success: false, data: null,
        error: `AI server returned ${r.status}. Try again in a moment.`,
        errorKind: 'http',
      };
    }
    const j = await r.json();
    if (!j.success) {
      clearTimeout(timer);
      // Special case: MAX_TOKENS means the model produced content but it was
      // truncated mid-JSON. If we have a schema, return a defaulted shape so
      // the UI can still render something instead of crashing. The caller can
      // check `truncated` to show a "try a smaller input" hint.
      const errMsg = j.error || "AI failed";
      if (schema && /MAX_TOKENS/i.test(errMsg)) {
        const fallback = schema.safeParse({});
        if (fallback.success) {
          console.warn("[mageAI] Response truncated (MAX_TOKENS), returning defaulted shape");
          return { success: true, data: fallback.data, error: errMsg, cached: false, fromCache: false };
        }
      }
      return { success: false, data: null, error: errMsg, errorKind: 'model' };
    }

    // Validate and coerce with Zod client-side — schema .default() values fill any missing fields.
    // If full parse fails, fall back to safeParse on an empty object to get a defaulted shape —
    // this guarantees UI consumers always receive the expected structure and never crash on
    // undefined array/object fields.
    if (schema && j.data !== undefined && j.data !== null) {
      // Sometimes Gemini wraps the response in an array instead of a root object.
      // If the schema expects an object and we got an array, try:
      //   1) the first element directly
      //   2) a shallow merge of all elements (later keys win)
      let candidate = j.data;
      if (Array.isArray(candidate) && candidate.length > 0 && candidate.every(x => x && typeof x === 'object')) {
        const first = schema.safeParse(candidate[0]);
        if (first.success) {
          candidate = candidate[0];
        } else if (candidate.length > 1) {
          const merged = Object.assign({}, ...candidate);
          const m = schema.safeParse(merged);
          if (m.success) candidate = merged;
        }
      }
      const primary = schema.safeParse(candidate);
      if (primary.success) {
        clearTimeout(timer);
        const result: MageAIResult = { success: true, data: primary.data, raw: j.raw, cached: false, fromCache: false };
        if (cacheKey) await setCache(cacheKey, result, cacheHours);
        return result;
      }
      console.warn("[mageAI] Zod validation failed, merging with defaults:", primary.error?.issues?.slice(0, 3));
      // Build a safe shape: start from schema defaults, overlay whatever keys parsed
      const fallback = schema.safeParse({});
      const safeShape = fallback.success ? fallback.data : {};
      const merged = typeof j.data === 'object' && j.data !== null
        ? { ...safeShape, ...j.data }
        : safeShape;
      // One more pass through safeParse so nested defaults apply to the merged shape too
      const finalParse = schema.safeParse(merged);
      const finalData = finalParse.success ? finalParse.data : safeShape;
      clearTimeout(timer);
      // Flag `errorKind: 'validation'` so the UI can show a "partial result" banner —
      // the data is still usable (defaults filled the gaps) but the caller should
      // know the model's response didn't cleanly match the schema.
      const result: MageAIResult = {
        success: true,
        data: finalData,
        raw: j.raw,
        cached: false,
        fromCache: false,
        errorKind: 'validation',
        error: 'AI response partially matched schema — showing defaulted fields.',
      };
      if (cacheKey) await setCache(cacheKey, result, cacheHours);
      return result;
    }

    // No schema or no data — return as-is
    clearTimeout(timer);
    const result: MageAIResult = { success: true, data: j.data, raw: j.raw, cached: false, fromCache: false };
    if (cacheKey) await setCache(cacheKey, result, cacheHours);
    return result;
  } catch (err) {
    clearTimeout(timer);
    // If AbortController fired, `err.name === 'AbortError'` and
    // `controller.signal.aborted === true`. Distinguish that from generic
    // network failure so the UI can show a retry-with-smaller-input hint
    // for timeouts vs. a check-connection hint for offline.
    if (controller.signal.aborted) {
      return {
        success: false,
        data: null,
        error: `AI request timed out after ${Math.round(timeoutMs / 1000)}s. Try a smaller selection or retry.`,
        errorKind: 'timeout',
      };
    }
    return {
      success: false,
      data: null,
      error: "Could not reach AI. Check connection.",
      errorKind: 'network',
    };
  }
}

export async function mageAIFast(prompt: string, schema?: any, cacheKey?: string) {
  return mageAI({ prompt, schema, tier: "fast", cacheKey });
}

export async function mageAISmart(prompt: string, schema?: any, cacheKey?: string) {
  return mageAI({ prompt, schema, tier: "smart", maxTokens: 2000, cacheKey });
}

```


---

### `utils/aiService.ts`

```ts
import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkAILimit, recordAIUsage, type SubscriptionTierKey, type RequestTier } from '@/utils/aiRateLimiter';
import type { Project, ProjectSchedule, ScheduleTask, ChangeOrder, Invoice, Subcontractor, Equipment } from '@/types';

const AI_CACHE_PREFIX = 'mageid_ai_cache_';
const COPILOT_HISTORY_PREFIX = 'mageid_copilot_';
const COMPANY_PROFILE_KEY = 'mageid_company_ai_profile';
const AI_USAGE_KEY = 'mageid_ai_usage';

export interface AIUsage {
  date: string;
  copilotCount: number;
  builderCount: number;
}

export async function getAIUsage(): Promise<AIUsage> {
  try {
    const stored = await AsyncStorage.getItem(AI_USAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as AIUsage;
      const today = new Date().toISOString().split('T')[0];
      if (parsed.date === today) return parsed;
    }
  } catch { /* ignore */ }
  return { date: new Date().toISOString().split('T')[0], copilotCount: 0, builderCount: 0 };
}

export async function incrementAIUsage(feature: 'copilot' | 'builder'): Promise<AIUsage> {
  const usage = await getAIUsage();
  if (feature === 'copilot') usage.copilotCount++;
  else usage.builderCount++;
  usage.date = new Date().toISOString().split('T')[0];
  await AsyncStorage.setItem(AI_USAGE_KEY, JSON.stringify(usage));
  return usage;
}

export async function getCachedResult<T>(key: string, maxAgeMs: number): Promise<T | null> {
  try {
    const stored = await AsyncStorage.getItem(AI_CACHE_PREFIX + key);
    if (!stored) return null;
    const { data, timestamp } = JSON.parse(stored);
    if (Date.now() - timestamp > maxAgeMs) return null;
    return data as T;
  } catch { return null; }
}

export async function setCachedResult(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(AI_CACHE_PREFIX + key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* ignore */ }
}

export interface CompanyAIProfile {
  specialties: string[];
  trades: string[];
  preferredSize: string;
  location: string;
  certifications: string[];
}

export async function getCompanyProfile(): Promise<CompanyAIProfile | null> {
  try {
    const stored = await AsyncStorage.getItem(COMPANY_PROFILE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

export async function saveCompanyProfile(profile: CompanyAIProfile): Promise<void> {
  await AsyncStorage.setItem(COMPANY_PROFILE_KEY, JSON.stringify(profile));
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actionItems?: Array<{ text: string; priority: 'urgent' | 'important' | 'suggestion' }>;
  dataPoints?: Array<{ label: string; value: string }>;
  timestamp: string;
}

export async function getCopilotHistory(projectId: string): Promise<CopilotMessage[]> {
  try {
    const stored = await AsyncStorage.getItem(COPILOT_HISTORY_PREFIX + projectId);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

export async function saveCopilotHistory(projectId: string, messages: CopilotMessage[]): Promise<void> {
  const trimmed = messages.slice(-20);
  await AsyncStorage.setItem(COPILOT_HISTORY_PREFIX + projectId, JSON.stringify(trimmed));
}

const copilotResponseSchema = z.object({
  answer: z.string().default(''),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  actionItems: z.array(z.object({
    text: z.string(),
    priority: z.enum(['urgent', 'important', 'suggestion']),
  })).default([]),
  dataPoints: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).default([]),
});

export type CopilotResponse = z.infer<typeof copilotResponseSchema>;

export function buildProjectContext(project: Project | null, schedule: ProjectSchedule | null): string {
  if (!project) return 'No project selected.';
  const estimate = project.linkedEstimate ?? project.estimate;
  const tasks = schedule?.tasks ?? [];
  const done = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const overdue = tasks.filter(t => t.status !== 'done' && t.progress < 100).length;

  return `Project: ${project.name}
Status: ${project.status}
Type: ${project.type}
Location: ${project.location}
Square Footage: ${project.squareFootage || 'N/A'}

Schedule:
- Total tasks: ${tasks.length}
- Completed: ${done}
- In progress: ${inProgress}
- Overdue: ${overdue}
- Health score: ${schedule?.healthScore ?? 'N/A'}
- Total duration: ${schedule?.totalDurationDays ?? 0} days
- Critical path: ${schedule?.criticalPathDays ?? 0} days

Estimate:
- Grand total: $${estimate && 'grandTotal' in estimate ? estimate.grandTotal : 0}
- Items: ${estimate && 'items' in estimate ? (estimate as any).items?.length ?? 0 : 0}

Risk items: ${schedule?.riskItems?.map(r => r.title).join('; ') || 'None'}

Tasks (top 25):
${tasks.slice(0, 25).map(t =>
    `- ${t.title} (${t.phase}): ${t.progress}% | ${t.status} | Day ${t.startDay}-${t.startDay + t.durationDays}${t.crew ? ` | Crew: ${t.crew}` : ''}`
  ).join('\n') || 'No tasks'}`;
}

export async function askCopilot(userMessage: string, projectContext: string): Promise<CopilotResponse> {
  console.log('[AI Copilot] Sending message:', userMessage.substring(0, 50));
  const aiResult = await mageAI({
    prompt: `You are MAGE AI, a senior construction project management advisor built into the MAGE ID app. You have access to the user's project data below. Answer their question with specific, actionable advice based on their actual data. Be concise (2-4 sentences max for the main answer). If there are action items, list them. Use construction industry terminology.

PROJECT DATA:
${projectContext}

USER QUESTION: ${userMessage}

Respond with a helpful, specific answer based on the project data above. Include relevant numbers and task names from the data. If you identify risks or issues, flag them clearly.`,
    schema: copilotResponseSchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'AI unavailable');
  }
  console.log('[AI Copilot] Response received');
  return aiResult.data;
}

export const scheduleRiskSchema = z.object({
  overallConfidence: z.number().default(0),
  predictedEndDate: z.string().default(''),
  predictedDelay: z.number().default(0),
  risks: z.array(z.object({
    taskName: z.string().default(''),
    severity: z.enum(['high', 'medium', 'low']).default('low'),
    delayProbability: z.number().default(0),
    delayDays: z.number().default(0),
    reasons: z.array(z.string()).default([]),
    recommendation: z.string().default(''),
  })).default([]),
  summary: z.string().default(''),
});

export type ScheduleRiskResult = z.infer<typeof scheduleRiskSchema>;

export async function analyzeScheduleRisk(schedule: ProjectSchedule, weatherData?: string): Promise<ScheduleRiskResult> {
  console.log('[AI Risk] Analyzing schedule risk...');
  const taskData = schedule.tasks.map(t => ({
    name: t.title,
    phase: t.phase,
    progress: t.progress,
    status: t.status,
    duration: t.durationDays,
    startDay: t.startDay,
    isCritical: t.isCriticalPath,
    isWeatherSensitive: t.isWeatherSensitive,
    crew: t.crew,
    crewSize: t.crewSize,
    depCount: t.dependencies?.length ?? 0,
  }));

  const aiResult = await mageAI({
    prompt: `You are an AI construction schedule analyst. Analyze this schedule and predict which tasks are at risk of delay. Consider: task dependencies, progress rates, critical path, weather sensitivity, and crew constraints.

SCHEDULE DATA:
Total tasks: ${schedule.tasks.length}
Total duration: ${schedule.totalDurationDays} days
Health score: ${schedule.healthScore}/100
Working days/week: ${schedule.workingDaysPerWeek}

TASKS:
${JSON.stringify(taskData, null, 2)}

WEATHER (next 7 days):
${weatherData || 'No weather data available'}

Analyze and predict risks. For each at-risk task, explain WHY based on the data and give ONE specific actionable recommendation. Rate overall project completion confidence 0-100.`,
    schema: scheduleRiskSchema,
    tier: 'smart',
    maxTokens: 3000,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Schedule risk analysis unavailable');
  }
  console.log('[AI Risk] Analysis complete');
  return aiResult.data;
}

export const bidScoreSchema = z.object({
  matchScore: z.number().default(0),
  matchReasons: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  bidStrategy: z.string().default(''),
  estimatedWinProbability: z.number().default(0),
});

export type BidScoreResult = z.infer<typeof bidScoreSchema>;

export async function scoreBid(bid: {
  title: string;
  department: string;
  estimated_value: number;
  naics_code?: string;
  set_aside?: string | null;
  state?: string;
  description?: string;
}, profile: CompanyAIProfile): Promise<BidScoreResult> {
  console.log('[AI Bid] Scoring bid:', bid.title?.substring(0, 40));
  const aiResult = await mageAI({
    prompt: `You are an AI bid analyst for construction contractors. Score how well this bid matches the contractor's profile. Consider: trade alignment, project size fit, location, set-aside eligibility, and certification requirements.

BID:
Title: ${bid.title}
Agency: ${bid.department}
Value: $${bid.estimated_value}
NAICS: ${bid.naics_code || 'N/A'}
Set-aside: ${bid.set_aside || 'None'}
State: ${bid.state || 'Unknown'}
Description: ${bid.description?.substring(0, 500) || 'No description'}

COMPANY PROFILE:
Specialties: ${profile.specialties.join(', ')}
Trades: ${profile.trades.join(', ')}
Preferred size: ${profile.preferredSize}
Location: ${profile.location}
Certifications: ${profile.certifications.join(', ') || 'None'}

Score 0-100 match. Give 2-3 reasons why it matches or doesn't. Give one sentence of bid strategy advice. Estimate win probability.`,
    schema: bidScoreSchema,
    tier: 'fast',
    maxTokens: 2000,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Bid scoring unavailable');
  }
  console.log('[AI Bid] Score:', aiResult.data.matchScore);
  return aiResult.data;
}

export const dailyReportSchema = z.object({
  summary: z.string().default(''),
  workCompleted: z.array(z.string()).default([]),
  workInProgress: z.array(z.string()).default([]),
  issuesAndDelays: z.array(z.string()).default([]),
  tomorrowPlan: z.array(z.string()).default([]),
  weatherImpact: z.string().default(''),
  crewsOnSite: z.array(z.object({
    trade: z.string().default(''),
    count: z.number().default(0),
    activity: z.string().default(''),
  })).default([]),
  safetyNotes: z.string().default(''),
});

export type DailyReportGenResult = z.infer<typeof dailyReportSchema>;

export async function generateDailyReport(
  projectName: string,
  tasks: ScheduleTask[],
  weatherStr: string,
): Promise<DailyReportGenResult> {
  console.log('[AI DFR] Generating daily report...');
  const activeTasks = tasks.filter(t => t.status === 'in_progress' || t.status === 'done');
  const aiResult = await mageAI({
    prompt: `You are a construction superintendent writing a professional daily field report. Based on the project schedule data below, generate a complete daily report for today. Write in professional but concise construction industry language.

PROJECT: ${projectName}
DATE: ${new Date().toLocaleDateString()}
WEATHER: ${weatherStr}

TODAY'S TASKS:
${activeTasks.map(t => `- ${t.title} (${t.phase}): ${t.progress}% complete, Status: ${t.status}, Crew: ${t.crew || 'TBD'} (${t.crewSize || 0} workers)`).join('\n') || 'No active tasks'}

COMPLETED TODAY:
${activeTasks.filter(t => t.status === 'done').map(t => t.title).join(', ') || 'None completed today'}

Generate a professional daily report. Be specific based on the task data.`,
    schema: dailyReportSchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Daily report generation unavailable');
  }
  console.log('[AI DFR] Report generated');
  return aiResult.data;
}

export const estimateValidationSchema = z.object({
  overallScore: z.number().default(5),
  issues: z.array(z.object({
    type: z.enum(['warning', 'error', 'suggestion', 'ok']).default('suggestion'),
    title: z.string().default(''),
    detail: z.string().default(''),
    potentialImpact: z.string().default(''),
  })).default([]),
  missingItems: z.array(z.string()).default([]),
  costPerSqFtAssessment: z.string().default(''),
  materialLaborRatioAssessment: z.string().default(''),
  contingencyRecommendation: z.string().default(''),
  summary: z.string().default(''),
});

export type EstimateValidationResult = z.infer<typeof estimateValidationSchema>;

export async function validateEstimate(
  projectType: string,
  squareFootage: number,
  totalCost: number,
  materialCost: number,
  laborCost: number,
  itemCount: number,
  hasContingency: boolean,
  location: string,
): Promise<EstimateValidationResult> {
  console.log('[AI Estimate] Validating estimate...');
  const costPerSF = squareFootage > 0 ? (totalCost / squareFootage).toFixed(2) : 'N/A';
  const matLabRatio = laborCost > 0 ? (materialCost / laborCost).toFixed(1) : 'N/A';

  const aiResult = await mageAI({
    prompt: `You are an AI construction estimator reviewer. Validate this estimate against industry standards and flag potential issues.

PROJECT TYPE: ${projectType}
SQUARE FOOTAGE: ${squareFootage} SF
LOCATION: ${location}
TOTAL COST: $${totalCost.toFixed(2)}
MATERIAL COST: $${materialCost.toFixed(2)}
LABOR COST: $${laborCost.toFixed(2)}
ITEM COUNT: ${itemCount}
COST PER SF: $${costPerSF}
MAT:LAB RATIO: ${matLabRatio}:1
HAS CONTINGENCY: ${hasContingency ? 'Yes' : 'No'}

Review this estimate. Flag issues like: unusual mat:lab ratio, missing contingency, cost/SF out of range for project type, missing common items. Score overall estimate health 1-10.`,
    schema: estimateValidationSchema,
    tier: 'smart',
    maxTokens: 5000,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Estimate validation unavailable');
  }
  console.log('[AI Estimate] Validation complete, score:', aiResult.data.overallScore);
  return aiResult.data;
}

export const aiScheduleSchema = z.object({
  projectName: z.string().default(''),
  estimatedDuration: z.number().default(30),
  tasks: z.array(z.object({
    title: z.string().default(''),
    phase: z.string().default('General'),
    durationDays: z.number().default(5),
    crew: z.string().default('General crew'),
    crewSize: z.number().default(2),
    isMilestone: z.boolean().default(false),
    isCriticalPath: z.boolean().default(false),
    isWeatherSensitive: z.boolean().default(false),
    predecessorIndex: z.number().optional(),
    dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
    lagDays: z.number().optional(),
    notes: z.string().optional(),
  })).default([]),
  assumptions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export type AIScheduleResult = z.infer<typeof aiScheduleSchema>;

export async function buildScheduleFromDescription(description: string): Promise<AIScheduleResult> {
  console.log('[AI Schedule] Building from description...');
  const aiResult = await mageAI({
    prompt: `You are a senior construction scheduler with 20 years of experience. Create a detailed, realistic construction schedule based on this project description.

PROJECT DESCRIPTION:
${description}

Create a complete schedule with:
1. All major construction phases in proper sequence
2. Realistic durations
3. Appropriate crew types and sizes
4. Dependencies (predecessorIndex = 0-indexed position in array)
5. Flag milestones (inspections, substantial completion)
6. Flag critical path tasks
7. Flag weather-sensitive tasks (concrete, roofing, exterior)
8. Notes for tasks with special considerations

Use phases: Site Work, Demo, Foundation, Framing, Roofing, MEP, Plumbing, Electrical, HVAC, Insulation, Drywall, Interior, Finishes, Landscaping, Inspections, General

Be specific with task names. Include inspections and mobilization/demobilization.`,
    schema: aiScheduleSchema,
    tier: 'smart',
    maxTokens: 8000,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'AI schedule builder unavailable');
  }

  let parsed: any = aiResult.data;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      let cleaned = parsed.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      try {
        parsed = JSON.parse(cleaned.trim());
      } catch {
        throw new Error('Could not parse AI schedule response. Please try again.');
      }
    }
  }

  parsed.projectName = parsed.projectName || description.substring(0, 60);
  parsed.estimatedDuration = typeof parsed.estimatedDuration === 'number' ? parsed.estimatedDuration : 30;
  parsed.tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  parsed.assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions : [];
  parsed.warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];

  parsed.tasks = parsed.tasks.map((t: any) => ({
    title: t.title || t.name || 'Task',
    phase: t.phase || 'General',
    durationDays: typeof t.durationDays === 'number' ? t.durationDays : (typeof t.duration === 'number' ? t.duration : 5),
    crew: t.crew || 'General crew',
    crewSize: typeof t.crewSize === 'number' ? t.crewSize : 2,
    isMilestone: !!t.isMilestone,
    isCriticalPath: !!t.isCriticalPath,
    isWeatherSensitive: !!t.isWeatherSensitive,
    predecessorIndex: typeof t.predecessorIndex === 'number' ? t.predecessorIndex : undefined,
    dependencyType: t.dependencyType || undefined,
    lagDays: typeof t.lagDays === 'number' ? t.lagDays : undefined,
    notes: t.notes || undefined,
  }));

  console.log('[AI Schedule] Generated', parsed.tasks.length, 'tasks');
  return parsed;
}

export const changeOrderImpactSchema = z.object({
  scheduleDays: z.number().default(0),
  costImpact: z.object({
    materials: z.number().default(0),
    labor: z.number().default(0),
    equipment: z.number().default(0),
    total: z.number().default(0),
  }).default({ materials: 0, labor: 0, equipment: 0, total: 0 }),
  affectedTasks: z.array(z.object({
    taskName: z.string().default(''),
    currentEnd: z.string().default(''),
    newEnd: z.string().default(''),
    daysAdded: z.number().default(0),
  })).default([]),
  newProjectEndDate: z.string().default(''),
  downstreamEffects: z.array(z.string()).default([]),
  // The model sometimes returns `recommendation` as a list of suggestions
  // instead of a single string — coerce so the UI always gets a displayable
  // paragraph instead of crashing Zod validation and showing a partial banner.
  recommendation: z.preprocess(
    v => Array.isArray(v) ? v.filter(x => typeof x === 'string').join('\n\n')
      : typeof v === 'string' ? v
      : v != null ? String(v) : '',
    z.string().default(''),
  ),
  compressionOptions: z.array(z.object({
    description: z.string().default(''),
    costPremium: z.number().default(0),
    daysSaved: z.number().default(0),
  })).default([]),
});

export type ChangeOrderImpactResult = z.infer<typeof changeOrderImpactSchema>;

export async function analyzeChangeOrderImpact(
  changeDescription: string,
  lineItems: Array<{ name: string; quantity: number; unitPrice: number; total: number }>,
  schedule: ProjectSchedule | null,
): Promise<ChangeOrderImpactResult> {
  console.log('[AI CO] Analyzing change order impact...');
  const taskSummary = schedule?.tasks?.slice(0, 20).map(t =>
    `${t.title} (${t.phase}): Day ${t.startDay}-${t.startDay + t.durationDays}, ${t.progress}%`
  ).join('\n') || 'No schedule';

  const aiResult = await mageAI({
    prompt: `You are a construction change order analyst. Analyze the schedule and cost impact of this change order.

CHANGE ORDER:
Description: ${changeDescription}
Line Items:
${lineItems.map(i => `- ${i.name}: ${i.quantity} × $${i.unitPrice} = $${i.total}`).join('\n') || 'No line items yet'}
Total Change Amount: $${lineItems.reduce((s, i) => s + i.total, 0)}

CURRENT SCHEDULE:
Total duration: ${schedule?.totalDurationDays ?? 0} days
Tasks:
${taskSummary}

Predict schedule delay, cost impact, affected downstream tasks, and give a recommendation. Include compression options to reduce delay.`,
    schema: changeOrderImpactSchema,
    tier: 'smart',
    maxTokens: 3500,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Change order analysis unavailable');
  }
  console.log('[AI CO] Impact analysis complete');
  return aiResult.data;
}

export const weeklySummarySchema = z.object({
  weekRange: z.string().default(''),
  portfolioSummary: z.object({
    totalProjects: z.number().default(0),
    onTrack: z.number().default(0),
    atRisk: z.number().default(0),
    behind: z.number().default(0),
    combinedValue: z.number().default(0),
    tasksCompletedThisWeek: z.number().default(0),
  }).default({ totalProjects: 0, onTrack: 0, atRisk: 0, behind: 0, combinedValue: 0, tasksCompletedThisWeek: 0 }),
  projects: z.array(z.object({
    name: z.string().default(''),
    // `.catch()` lets us accept any value the model invents (e.g. "delayed",
    // "starting") and fall back to on_track rather than rejecting the whole row.
    status: z.enum(['on_track', 'at_risk', 'behind', 'ahead']).catch('on_track').default('on_track'),
    progressStart: z.number().default(0),
    progressEnd: z.number().default(0),
    keyAccomplishment: z.string().default(''),
    primaryRisk: z.string().default(''),
    recommendation: z.string().default(''),
  })).default([]),
  overallRecommendation: z.string().default(''),
});

export type WeeklySummaryResult = z.infer<typeof weeklySummarySchema>;

export async function rateLimitedGenerate<T extends z.ZodType>(
  subscriptionTier: SubscriptionTierKey,
  requestTier: RequestTier,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  schema: T,
): Promise<{ success: true; data: z.infer<T> } | { success: false; data: null; error: string }> {
  try {
    const limit = await checkAILimit(subscriptionTier, requestTier);
    if (!limit.allowed) {
      return { success: false, data: null, error: limit.message ?? 'Rate limit reached.' };
    }
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
    const aiResult = await mageAI({ prompt, schema, tier: 'fast' });
    if (!aiResult.success) {
      return { success: false, data: null, error: aiResult.error || 'AI analysis unavailable right now. Please try again.' };
    }
    await recordAIUsage(requestTier);
    return { success: true, data: aiResult.data };
  } catch (err) {
    console.error('[AI] Generation failed:', err);
    return { success: false, data: null, error: 'AI analysis unavailable right now. Please try again.' };
  }
}

export async function generateWeeklySummary(projects: Project[]): Promise<WeeklySummaryResult> {
  console.log('[AI Weekly] Generating summary for', projects.length, 'projects');
  const projectData = projects.map(p => {
    const schedule = p.schedule;
    const tasks = schedule?.tasks ?? [];
    const totalProgress = tasks.length > 0
      ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length)
      : 0;
    const done = tasks.filter(t => t.status === 'done').length;
    const est = p.linkedEstimate ?? p.estimate;
    return {
      name: p.name,
      type: p.type,
      status: p.status,
      totalTasks: tasks.length,
      completedTasks: done,
      overallProgress: totalProgress,
      healthScore: schedule?.healthScore ?? 0,
      totalValue: est && 'grandTotal' in est ? est.grandTotal : 0,
      riskItems: schedule?.riskItems?.map(r => r.title) ?? [],
    };
  });

  const aiResult = await mageAI({
    prompt: `You are a construction portfolio manager writing a weekly executive summary. Analyze these projects and generate a professional report.

PROJECTS:
${JSON.stringify(projectData, null, 2)}

CURRENT DATE: ${new Date().toLocaleDateString()}

Generate a comprehensive weekly executive summary. For each project, assess status, highlight key accomplishments, identify primary risks, and give recommendations. Provide an overall portfolio recommendation.`,
    schema: weeklySummarySchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Weekly summary unavailable');
  }
  console.log('[AI Weekly] Summary generated');
  return aiResult.data;
}

export const homeBriefingSchema = z.object({
  briefing: z.string().default(''),
  projects: z.array(z.object({
    name: z.string().default(''),
    // Accept 'ahead' too — Gemini often uses it. Any other value falls to on_track.
    status: z.enum(['on_track', 'at_risk', 'behind', 'ahead']).catch('on_track').default('on_track'),
    keyInsight: z.string().default(''),
    actionItem: z.string().default(''),
  })).default([]),
  urgentItems: z.array(z.string()).default([]),
});

export type HomeBriefingResult = z.infer<typeof homeBriefingSchema>;

export async function generateHomeBriefing(
  projects: Project[],
  invoices: Invoice[],
): Promise<HomeBriefingResult> {
  console.log('[AI Briefing] Generating for', projects.length, 'projects');
  const projectSummaries = projects.map(p => {
    const schedule = p.schedule;
    const tasks = schedule?.tasks ?? [];
    const done = tasks.filter(t => t.status === 'done').length;
    const overdue = tasks.filter(t => t.status !== 'done' && t.progress < 100 && t.startDay + t.durationDays < (schedule?.totalDurationDays ?? 999)).length;
    const est = p.linkedEstimate ?? p.estimate;
    const projectInvoices = invoices.filter(inv => inv.projectId === p.id);
    const pendingInvoices = projectInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'draft');
    return `Project: ${p.name}
  Type: ${p.type} | Status: ${p.status}
  Schedule health: ${schedule?.healthScore ?? 'N/A'}/100
  Tasks: ${tasks.length} total, ${done} done, ${overdue} potentially overdue
  Estimate: ${est && 'grandTotal' in est ? est.grandTotal.toLocaleString() : '0'}
  Pending invoices: ${pendingInvoices.length} totaling ${pendingInvoices.reduce((s, i) => s + (i.totalDue - i.amountPaid), 0).toLocaleString()}`;
  }).join('\n---\n');

  const aiResult = await mageAI({
    prompt: `You are analyzing a contractor's project portfolio. Give a brief daily briefing — 2-3 sentences per project highlighting the single most important thing they should know or act on TODAY. Flag any overdue invoices, schedule delays, or upcoming deadlines. Be specific with names and numbers.

PROJECTS:
${projectSummaries}

DATE: ${new Date().toLocaleDateString()}`,
    schema: homeBriefingSchema,
    schemaHint: {
      briefing: "2-3 sentence portfolio overview highlighting what needs attention today",
      projects: [{ name: "Project Name", status: "on_track", keyInsight: "Key insight for today", actionItem: "Specific action to take" }],
      urgentItems: ["Overdue invoice for Project X"],
    },
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Home briefing unavailable');
  }
  console.log('[AI Briefing] Generated');
  return aiResult.data;
}

export const invoicePredictionSchema = z.object({
  predictedPaymentDate: z.string().default(''),
  confidenceLevel: z.enum(['high', 'medium', 'low']).default('medium'),
  daysFromDue: z.number().default(0),
  reasoning: z.string().default(''),
  tip: z.string().default(''),
});

export type InvoicePredictionResult = z.infer<typeof invoicePredictionSchema>;

export async function predictInvoicePayment(
  invoice: Invoice,
  projectName: string,
  clientHistory: { avgDaysLate: number; totalInvoices: number },
): Promise<InvoicePredictionResult> {
  console.log('[AI Invoice] Predicting payment for invoice #', invoice.number);
  const aiResult = await mageAI({
    prompt: `You are a construction payment analyst. Predict when this invoice will actually be paid based on the payment terms and client history.

INVOICE:
Number: #${invoice.number}
Amount: ${invoice.totalDue.toLocaleString()}
Issue date: ${invoice.issueDate}
Due date: ${invoice.dueDate}
Payment terms: ${invoice.paymentTerms}
Status: ${invoice.status}
Amount paid so far: ${invoice.amountPaid.toLocaleString()}
Project: ${projectName}

CLIENT HISTORY:
Avg days late: ${clientHistory.avgDaysLate}
Total past invoices: ${clientHistory.totalInvoices}

Predict the actual payment date, confidence level, and give a tip for getting paid faster.`,
    schema: invoicePredictionSchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Invoice prediction unavailable');
  }
  console.log('[AI Invoice] Prediction complete');
  return aiResult.data;
}

export const subEvaluationSchema = z.object({
  questionsToAsk: z.array(z.string()).default([]),
  typicalRates: z.object({
    journeyman: z.string().default(''),
    master: z.string().default(''),
    apprentice: z.string().default(''),
  }).default({ journeyman: '', master: '', apprentice: '' }),
  redFlags: z.array(z.string()).default([]),
  recommendation: z.string().default(''),
  trackRecord: z.string().optional(),
});

export type SubEvaluationResult = z.infer<typeof subEvaluationSchema>;

export async function evaluateSubcontractor(
  sub: Subcontractor,
  projectContext: string,
): Promise<SubEvaluationResult> {
  console.log('[AI Sub] Evaluating:', sub.companyName);
  const aiResult = await mageAI({
    prompt: `You are a construction subcontractor evaluator. Evaluate this subcontractor and provide hiring advice.

SUBCONTRACTOR:
Company: ${sub.companyName}
Contact: ${sub.contactName}
Trade: ${sub.trade}
License #: ${sub.licenseNumber || 'N/A'}
License expiry: ${sub.licenseExpiry || 'N/A'}
COI expiry: ${sub.coiExpiry || 'N/A'}
W9 on file: ${sub.w9OnFile ? 'Yes' : 'No'}
Bid history: ${sub.bidHistory.length} bids (${sub.bidHistory.filter(b => b.outcome === 'won').length} won)
Assigned projects: ${sub.assignedProjects.length}
Notes: ${sub.notes || 'None'}

CONTEXT:
${projectContext}

Provide: questions to ask before hiring, typical rates for their trade, red flags to watch for, and overall recommendation. If they have bid history, summarize their track record.`,
    schema: subEvaluationSchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Subcontractor evaluation unavailable');
  }
  console.log('[AI Sub] Evaluation complete');
  return aiResult.data;
}

export const equipmentAdviceSchema = z.object({
  // Model sometimes returns verbose strings ("it depends") — fall back to 'rent'
  // instead of letting the whole schema reject.
  recommendation: z.enum(['rent', 'buy', 'lease']).catch('rent').default('rent'),
  annualRentalCost: z.number().catch(0).default(0),
  purchasePrice: z.string().catch('').default(''),
  breakEvenProjects: z.number().catch(0).default(0),
  // Model occasionally returns an array of bullet points instead of a string —
  // coerce by joining.
  reasoning: z.preprocess(
    v => Array.isArray(v) ? v.join(' ') : v,
    z.string().catch('').default(''),
  ),
  reconsiderWhen: z.preprocess(
    v => Array.isArray(v) ? v.join(' ') : v,
    z.string().catch('').default(''),
  ),
});

export type EquipmentAdviceResult = z.infer<typeof equipmentAdviceSchema>;

export async function analyzeEquipmentRentVsBuy(
  equip: Equipment,
  projectsPerYear: number,
  avgDaysPerProject: number,
): Promise<EquipmentAdviceResult> {
  console.log('[AI Equipment] Analyzing rent vs buy:', equip.name);
  const aiResult = await mageAI({
    prompt: `You are a construction equipment financial advisor. Analyze whether this contractor should rent or buy this equipment.

EQUIPMENT:
Name: ${equip.name}
Type: ${equip.type}
Category: ${equip.category}
Make: ${equip.make}
Model: ${equip.model}
Daily rate: ${equip.dailyRate}
Current status: ${equip.status}
Utilization entries: ${equip.utilizationLog.length}

USAGE PATTERN:
Projects per year: ${projectsPerYear}
Avg days per project: ${avgDaysPerProject}
Estimated annual rental cost: ${(equip.dailyRate * avgDaysPerProject * projectsPerYear).toLocaleString()}

Analyze rent vs buy. Include annual rental cost estimate, typical purchase price range, break-even point, and when they should reconsider.`,
    schema: equipmentAdviceSchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Equipment analysis unavailable');
  }
  console.log('[AI Equipment] Analysis complete');
  return aiResult.data;
}

export const projectReportSchema = z.object({
  executiveSummary: z.string().default(''),
  scheduleStatus: z.string().default(''),
  budgetStatus: z.string().default(''),
  keyAccomplishments: z.array(z.string()).default([]),
  issuesAndRisks: z.array(z.string()).default([]),
  nextMilestones: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
});

export type ProjectReportResult = z.infer<typeof projectReportSchema>;

export const aiQuickEstimateSchema = z.object({
  projectSummary: z.string().default(''),
  materials: z.array(z.object({
    name: z.string().default('Item'),
    category: z.string().default('hardware'),
    unit: z.string().default('ea'),
    // The model sometimes omits quantity/unitPrice — default to 0 so the row
    // still renders (user can edit) instead of throwing away the whole estimate.
    quantity: z.number().default(0),
    unitPrice: z.number().default(0),
    supplier: z.string().default('Home Depot'),
    notes: z.string().optional(),
  })).default([]),
  labor: z.array(z.object({
    trade: z.string().default('Labor'),
    hourlyRate: z.number().default(0),
    hours: z.number().default(0),
    crew: z.string().default('General crew'),
    notes: z.string().optional(),
  })).default([]),
  assemblies: z.array(z.object({
    name: z.string().default('Assembly'),
    category: z.string().default('general'),
    quantity: z.number().default(1),
    unit: z.string().default('ea'),
    notes: z.string().optional(),
  })).default([]),
  additionalCosts: z.object({
    permits: z.number().default(0),
    dumpsterRental: z.number().default(0),
    equipmentRental: z.number().default(0),
    cleanup: z.number().default(0),
    contingencyPercent: z.number().default(10),
    overheadPercent: z.number().default(12),
  }).default({
    permits: 0,
    dumpsterRental: 0,
    equipmentRental: 0,
    cleanup: 0,
    contingencyPercent: 10,
    overheadPercent: 12,
  }),
  estimatedDuration: z.string().default('TBD'),
  costPerSqFt: z.number().default(0),
  confidenceScore: z.number().default(70),
  // Model sometimes returns warnings/tips as an object of { warning1: "...", warning2: "..." }
  // or a single string. Coerce any shape to string[].
  warnings: z.preprocess(
    v => Array.isArray(v) ? v
      : typeof v === 'string' ? [v]
      : v && typeof v === 'object' ? Object.values(v).map(x => String(x))
      : [],
    z.array(z.string()).default([]),
  ),
  savingsTips: z.preprocess(
    v => Array.isArray(v) ? v
      : typeof v === 'string' ? [v]
      : v && typeof v === 'object' ? Object.values(v).map(x => String(x))
      : [],
    z.array(z.string()).default([]),
  ),
});

export type AIQuickEstimateResult = z.infer<typeof aiQuickEstimateSchema>;

export async function generateQuickEstimate(
  description: string,
  projectType: string,
  squareFootage: number,
  qualityTier: string,
  location: string,
): Promise<AIQuickEstimateResult> {
  console.log('[AI Quick Estimate] Generating for:', description.substring(0, 60));

  const aiResult = await mageAI({
    prompt: `You are an expert construction estimator with current 2025-2026 pricing knowledge. Generate a detailed, realistic construction estimate for this project.

PROJECT: ${description}
Type: ${projectType || 'General Construction'} | SqFt: ${squareFootage || 'unspecified'} | Quality: ${qualityTier || 'standard'} | Location: ${location || 'US'}

Generate 8-15 material line items with real quantities and 2025 market pricing (reference Home Depot, Lowe's, ABC Supply). Include 3-6 labor trades with realistic hourly rates and hours. Add 2-4 relevant assemblies. Set contingency 8-12% and overhead 10-14%. Include 2-3 warnings and 2-3 money-saving tips.`,
    schema: aiQuickEstimateSchema,
    schemaHint: {
      projectSummary: "Brief project overview",
      materials: [{ name: "Lumber 2x4x8", category: "lumber", unit: "ea", quantity: 120, unitPrice: 8.50, supplier: "Home Depot", notes: "framing" }],
      labor: [{ trade: "Carpenter", hourlyRate: 75, hours: 40, crew: "Framing crew", notes: "framing and rough carpentry" }],
      assemblies: [{ name: "Frame Interior Wall", category: "framing", quantity: 4, unit: "lf" }],
      additionalCosts: { permits: 800, dumpsterRental: 450, equipmentRental: 600, cleanup: 300, contingencyPercent: 10, overheadPercent: 12 },
      estimatedDuration: "6-8 weeks",
      costPerSqFt: 85,
      confidenceScore: 78,
      warnings: ["Permit timeline may add 2-3 weeks"],
      savingsTips: ["Buy lumber in bulk for 15% savings"],
    },
    tier: 'smart',
    maxTokens: 8000,
  });
  if (!aiResult.success) {
    console.warn('[AI Quick Estimate] AI failed, returning stub:', aiResult.error);
    // Return a starter estimate the user can edit rather than crashing
    return {
      projectSummary: `Estimate for ${projectType || 'construction'} project — ${description.substring(0, 80)}`,
      materials: [
        { name: 'General Materials', category: 'hardware', unit: 'lot', quantity: 1, unitPrice: 5000, supplier: 'TBD' },
        { name: 'Lumber', category: 'lumber', unit: 'bf', quantity: 500, unitPrice: 1.20, supplier: 'Home Depot' },
        { name: 'Concrete', category: 'concrete', unit: 'cy', quantity: 10, unitPrice: 140, supplier: 'Local Supplier' },
      ],
      labor: [
        { trade: 'General Laborer', hourlyRate: 45, hours: 80, crew: 'General crew' },
        { trade: 'Carpenter', hourlyRate: 75, hours: 40, crew: 'Framing crew' },
      ],
      assemblies: [],
      additionalCosts: { permits: 500, dumpsterRental: 400, equipmentRental: 300, cleanup: 200, contingencyPercent: 10, overheadPercent: 12 },
      estimatedDuration: 'To be determined',
      costPerSqFt: squareFootage > 0 ? Math.round(8000 / squareFootage) : 0,
      confidenceScore: 30,
      warnings: ['AI estimate unavailable — this is a placeholder. Please edit with actual quantities and pricing.'],
      savingsTips: ['Get at least 3 contractor bids', 'Buy materials in bulk where possible'],
    };
  }
  const result = aiResult.data;
  console.log('[AI Quick Estimate] Generated:', result.materials.length, 'materials,', result.labor.length, 'labor,', result.assemblies.length, 'assemblies');
  return result;
}

export async function generateProjectReport(
  project: Project,
  invoices: Invoice[],
  changeOrders: ChangeOrder[],
): Promise<ProjectReportResult> {
  console.log('[AI Report] Generating for:', project.name);
  const schedule = project.schedule;
  const tasks = schedule?.tasks ?? [];
  const est = project.linkedEstimate ?? project.estimate;
  const projInvoices = invoices.filter(i => i.projectId === project.id);
  const projCOs = changeOrders.filter(co => co.projectId === project.id);
  const totalInvoiced = projInvoices.reduce((s, i) => s + i.totalDue, 0);
  const totalPaid = projInvoices.reduce((s, i) => s + i.amountPaid, 0);
  const coTotal = projCOs.reduce((s, co) => s + co.changeAmount, 0);

  const aiResult = await mageAI({
    prompt: `You are a senior construction project manager writing a professional project status report for stakeholders.

PROJECT: ${project.name}
Type: ${project.type} | Status: ${project.status}
Location: ${project.location}
Square footage: ${project.squareFootage || 'N/A'}

SCHEDULE:
Total tasks: ${tasks.length}
Completed: ${tasks.filter(t => t.status === 'done').length}
In progress: ${tasks.filter(t => t.status === 'in_progress').length}
Health score: ${schedule?.healthScore ?? 'N/A'}/100
Duration: ${schedule?.totalDurationDays ?? 0} days

BUDGET:
Estimate: ${est && 'grandTotal' in est ? est.grandTotal.toLocaleString() : '0'}
Total invoiced: ${totalInvoiced.toLocaleString()}
Total paid: ${totalPaid.toLocaleString()}
Change orders: ${projCOs.length} totaling ${coTotal.toLocaleString()}

TASKS (active):
${tasks.filter(t => t.status === 'in_progress').slice(0, 15).map(t => `- ${t.title}: ${t.progress}%`).join('\n') || 'None'}

Generate a professional project status report suitable for sharing with clients.`,
    schema: projectReportSchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Project report generation unavailable');
  }
  console.log('[AI Report] Generated');
  return aiResult.data;
}

```


---

### `utils/aiRateLimiter.ts`

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const RATE_KEY = 'mage_ai_usage';

interface DailyUsage {
  date: string;
  count: number;
  tier: {
    fast: number;
    smart: number;
  };
}

const LIMITS = {
  free: { daily: 10, smart: 3 },
  pro: { daily: 75, smart: 25 },
  business: { daily: 200, smart: 75 },
} as const;

export type SubscriptionTierKey = 'free' | 'pro' | 'business';
export type RequestTier = 'fast' | 'smart';

export async function checkAILimit(
  subscriptionTier: SubscriptionTierKey,
  requestTier: RequestTier,
): Promise<{ allowed: boolean; remaining: number; message?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const raw = await AsyncStorage.getItem(RATE_KEY);
  let usage: DailyUsage = raw
    ? JSON.parse(raw)
    : { date: today, count: 0, tier: { fast: 0, smart: 0 } };

  if (usage.date !== today) {
    usage = { date: today, count: 0, tier: { fast: 0, smart: 0 } };
  }

  const limits = LIMITS[subscriptionTier];
  const dailyRemaining = limits.daily - usage.count;

  if (usage.count >= limits.daily) {
    return {
      allowed: false,
      remaining: 0,
      message:
        subscriptionTier === 'free'
          ? "You've used all 10 AI requests today. Upgrade to Pro for 75/day."
          : subscriptionTier === 'pro'
            ? "You've used all 75 AI requests today. Upgrade to Business for 200/day."
            : "You've reached today's AI limit. Resets at midnight.",
    };
  }

  if (requestTier === 'smart' && usage.tier.smart >= limits.smart) {
    return {
      allowed: false,
      remaining: dailyRemaining,
      message:
        "You've used all advanced AI analysis for today. Try again tomorrow or use quick AI features instead.",
    };
  }

  return { allowed: true, remaining: dailyRemaining - 1 };
}

export async function recordAIUsage(requestTier: RequestTier): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const raw = await AsyncStorage.getItem(RATE_KEY);
  let usage: DailyUsage = raw
    ? JSON.parse(raw)
    : { date: today, count: 0, tier: { fast: 0, smart: 0 } };

  if (usage.date !== today) {
    usage = { date: today, count: 0, tier: { fast: 0, smart: 0 } };
  }

  usage.count += 1;
  usage.tier[requestTier] += 1;
  await AsyncStorage.setItem(RATE_KEY, JSON.stringify(usage));
}

export async function getAIUsageStats(
  subscriptionTier: SubscriptionTierKey,
): Promise<{
  used: number;
  limit: number;
  smartUsed: number;
  smartLimit: number;
}> {
  const today = new Date().toISOString().split('T')[0];
  const raw = await AsyncStorage.getItem(RATE_KEY);
  const usage: DailyUsage = raw
    ? JSON.parse(raw)
    : { date: today, count: 0, tier: { fast: 0, smart: 0 } };

  if (usage.date !== today) {
    return {
      used: 0,
      limit: LIMITS[subscriptionTier].daily,
      smartUsed: 0,
      smartLimit: LIMITS[subscriptionTier].smart,
    };
  }

  return {
    used: usage.count,
    limit: LIMITS[subscriptionTier].daily,
    smartUsed: usage.tier.smart,
    smartLimit: LIMITS[subscriptionTier].smart,
  };
}

```


---

### `utils/voiceCommandParser.ts`

```ts
import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import type { ScheduleTask } from '@/types';

const voiceCommandSchema = z.object({
  action: z.enum([
    'update_progress',
    'mark_complete',
    'add_note',
    'log_issue',
    'ask_question',
    'create_task',
    'reschedule_task',
    'assign_crew',
    'start_task',
    'weather_check',
    'status_update',
    'daily_report',
    'unknown',
  ]),
  taskName: z.string().optional(),
  value: z.number().optional(),
  text: z.string().optional(),
  crewName: z.string().optional(),
  date: z.string().optional(),
  confidence: z.number(),
  clarification: z.string().optional(),
});

const batchCommandSchema = z.object({
  commands: z.array(z.object({
    action: z.enum(['update_progress', 'mark_complete', 'add_note', 'log_issue', 'start_task']),
    taskName: z.string(),
    value: z.number().optional(),
    text: z.string().optional(),
  })),
  confidence: z.number(),
});

const dailyReportVoiceSchema = z.object({
  workCompleted: z.array(z.string()),
  workInProgress: z.array(z.string()),
  issues: z.array(z.string()),
  weather: z.string(),
  safetyIncidents: z.string(),
  crewCount: z.number().optional(),
  visitors: z.string().optional(),
  materialsReceived: z.array(z.string()).optional(),
  tomorrowPlan: z.array(z.string()).optional(),
});

export type VoiceAction = z.infer<typeof voiceCommandSchema>['action'];

export interface ParsedVoiceCommand {
  action: VoiceAction;
  taskName?: string;
  value?: number;
  text?: string;
  crewName?: string;
  date?: string;
  confidence: number;
  clarification?: string;
}

export interface ParsedBatchCommand {
  commands: Array<{
    action: 'update_progress' | 'mark_complete' | 'add_note' | 'log_issue' | 'start_task';
    taskName: string;
    value?: number;
    text?: string;
  }>;
  confidence: number;
}

export interface ParsedDailyReport {
  workCompleted: string[];
  workInProgress: string[];
  issues: string[];
  weather: string;
  safetyIncidents: string;
  crewCount?: number;
  visitors?: string;
  materialsReceived?: string[];
  tomorrowPlan?: string[];
}

function buildTaskContext(tasks: Array<{ title: string; phase: string; progress: number; status: string; crew: string }>): string {
  return tasks.map(t => `- "${t.title}" (${t.phase}) — ${t.progress}% complete, status: ${t.status}, crew: ${t.crew}`).join('\n');
}

function isBatchCommand(text: string): boolean {
  const lowerText = text.toLowerCase();
  const multiActionIndicators = [' and ', ' also ', ', then ', ', set ', ', mark ', ', update '];
  const actionWords = ['update', 'mark', 'set', 'complete', 'finish', 'start'];
  let actionCount = 0;
  for (const word of actionWords) {
    const matches = lowerText.split(word).length - 1;
    actionCount += matches;
  }
  if (actionCount >= 2) return true;
  return multiActionIndicators.some(ind => lowerText.includes(ind)) && actionCount >= 1;
}

function isDailyReport(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('end of day report') ||
    lower.includes('daily report') ||
    lower.includes('day report') ||
    lower.includes('eod report') ||
    lower.includes('field report');
}

export async function parseVoiceCommand(
  spokenText: string,
  currentTasks: Array<{ title: string; phase: string; progress: number; status: string; crew: string }>,
  projectName: string
): Promise<ParsedVoiceCommand> {
  console.log('[VoiceCmd] Parsing command:', spokenText.substring(0, 80));

  try {
    const aiResult = await mageAI({
      prompt: `You are a voice command parser for a construction project management app. Parse the user's spoken command and determine what action they want to take.

CURRENT PROJECT: ${projectName}

AVAILABLE TASKS:
${buildTaskContext(currentTasks)}

USER SAID: "${spokenText}"

Parse this into an action. Match task names FUZZY — the user might say "framing" to mean "Frame 2nd Floor" or "electrical" to mean "Rough Electrical Wiring". Pick the closest match from the available tasks.

For progress updates, extract the percentage. "80 percent" = 80, "halfway" = 50, "almost done" = 90, "done" or "finished" or "complete" = 100.

For notes and issues, extract the text content after identifying the action.

If the command is ambiguous or you can't match a task, set action to 'unknown' and provide a clarification question.

Set confidence 0-100. Below 60 means you should include a clarification.`,
      schema: voiceCommandSchema,
      tier: 'fast',
    });

    if (!aiResult.success) {
      console.log('[VoiceCmd] AI failed:', aiResult.error);
      return {
        action: 'unknown',
        confidence: 0,
        clarification: 'Voice processing unavailable. Try typing your update instead.',
      };
    }

    const result = aiResult.data;
    console.log('[VoiceCmd] Parsed result:', result.action, 'confidence:', result.confidence);
    return result;
  } catch (err) {
    console.log('[VoiceCmd] Parse failed:', err);
    return {
      action: 'unknown',
      confidence: 0,
      clarification: 'Voice processing unavailable. Try typing your update instead.',
    };
  }
}

export async function parseBatchVoiceCommand(
  spokenText: string,
  currentTasks: Array<{ title: string; phase: string; progress: number; status: string; crew: string }>,
  projectName: string
): Promise<ParsedBatchCommand> {
  console.log('[VoiceCmd] Parsing batch command:', spokenText.substring(0, 80));

  try {
    const aiResult = await mageAI({
      prompt: `You are a voice command parser for a construction project management app. The user is giving MULTIPLE commands at once. Parse each one separately.

CURRENT PROJECT: ${projectName}

AVAILABLE TASKS:
${buildTaskContext(currentTasks)}

USER SAID: "${spokenText}"

Parse each command separately. Match task names FUZZY. For progress, "80 percent" = 80, "halfway" = 50, "almost done" = 90, "done"/"finished"/"complete" = 100.

Return all commands found. Set confidence 0-100 for the overall batch.`,
      schema: batchCommandSchema,
      tier: 'fast',
    });

    if (!aiResult.success) {
      console.log('[VoiceCmd] Batch AI failed:', aiResult.error);
      return { commands: [], confidence: 0 };
    }

    const result = aiResult.data;
    console.log('[VoiceCmd] Batch parsed:', result.commands.length, 'commands');
    return result;
  } catch (err) {
    console.log('[VoiceCmd] Batch parse failed:', err);
    return { commands: [], confidence: 0 };
  }
}

export async function parseDailyReportVoice(
  spokenText: string,
  projectName: string
): Promise<ParsedDailyReport> {
  console.log('[VoiceCmd] Parsing daily report voice input');

  try {
    const aiResult = await mageAI({
      prompt: `You are a construction superintendent writing a daily field report. Parse this spoken end-of-day summary into structured report fields.

PROJECT: ${projectName}

SPOKEN INPUT: "${spokenText}"

Extract: work completed today, work still in progress, issues/delays, weather conditions, safety incidents (or "None" if not mentioned), crew count if mentioned, visitors if mentioned, materials received if mentioned, and tomorrow's plan if mentioned.

Be thorough but only extract what was actually said. If something wasn't mentioned, leave it empty or use reasonable defaults.`,
      schema: dailyReportVoiceSchema,
      tier: 'fast',
    });

    if (!aiResult.success) {
      console.log('[VoiceCmd] Daily report AI failed:', aiResult.error);
      return {
        workCompleted: [],
        workInProgress: [],
        issues: [],
        weather: 'Not mentioned',
        safetyIncidents: 'None reported',
      };
    }

    const result = aiResult.data;
    console.log('[VoiceCmd] Daily report parsed successfully');
    return result;
  } catch (err) {
    console.log('[VoiceCmd] Daily report parse failed:', err);
    return {
      workCompleted: [],
      workInProgress: [],
      issues: [],
      weather: 'Not mentioned',
      safetyIncidents: 'None reported',
    };
  }
}

export { isBatchCommand, isDailyReport };

```


---

### `utils/voiceCommandExecutor.ts`

```ts
import type { ScheduleTask } from '@/types';
import type { ParsedVoiceCommand, ParsedBatchCommand } from './voiceCommandParser';
import AsyncStorage from '@react-native-async-storage/async-storage';

const VOICE_HISTORY_KEY = 'mage_voice_history';
const VOICE_ISSUES_KEY = 'mage_voice_issues';

export interface VoiceHistoryItem {
  id: string;
  spokenText: string;
  parsedAction: string;
  taskName?: string;
  success: boolean;
  timestamp: string;
  projectId: string;
}

export interface VoiceCommandResult {
  success: boolean;
  message: string;
  undoAction?: () => void;
  matchedTasks?: ScheduleTask[];
  needsClarification?: boolean;
  dailyReportData?: any;
}

export interface VoiceUpdateFunctions {
  handleProgressUpdate: (task: ScheduleTask, progress: number) => void;
  handleSaveTask?: (draft: any, editing: ScheduleTask | null) => void;
  onAddNote?: (task: ScheduleTask, note: string) => void;
}

export function findTaskByName(name: string | undefined, tasks: ScheduleTask[]): ScheduleTask | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (!lower) return null;

  let match = tasks.find(t => t.title.toLowerCase() === lower);
  if (match) return match;

  match = tasks.find(t => t.title.toLowerCase().includes(lower));
  if (match) return match;

  match = tasks.find(t => lower.includes(t.title.toLowerCase()));
  if (match) return match;

  match = tasks.find(t => t.phase.toLowerCase().includes(lower));
  if (match) return match;

  const words = lower.split(/\s+/);
  match = tasks.find(t => {
    const titleLower = t.title.toLowerCase();
    return words.filter(w => w.length > 3).some(w => titleLower.includes(w));
  });
  return match || null;
}

export function findAllMatchingTasks(name: string | undefined, tasks: ScheduleTask[]): ScheduleTask[] {
  if (!name) return [];
  const lower = name.toLowerCase().trim();
  if (!lower) return [];

  const exact = tasks.filter(t => t.title.toLowerCase() === lower);
  if (exact.length === 1) return exact;

  const contains = tasks.filter(t =>
    t.title.toLowerCase().includes(lower) || lower.includes(t.title.toLowerCase())
  );
  if (contains.length > 0) return contains;

  const phaseMatch = tasks.filter(t => t.phase.toLowerCase().includes(lower));
  if (phaseMatch.length > 0) return phaseMatch;

  const words = lower.split(/\s+/).filter(w => w.length > 3);
  return tasks.filter(t => {
    const titleLower = t.title.toLowerCase();
    return words.some(w => titleLower.includes(w));
  });
}

export function executeVoiceCommand(
  parsed: ParsedVoiceCommand,
  tasks: ScheduleTask[],
  updateFunctions: VoiceUpdateFunctions,
): VoiceCommandResult {
  console.log('[VoiceExec] Executing:', parsed.action, 'task:', parsed.taskName);

  switch (parsed.action) {
    case 'update_progress': {
      const matches = findAllMatchingTasks(parsed.taskName, tasks);
      if (matches.length === 0) {
        return { success: false, message: `Couldn't find task "${parsed.taskName}"` };
      }
      if (matches.length > 1) {
        return {
          success: false,
          message: `Found ${matches.length} matching tasks`,
          matchedTasks: matches,
          needsClarification: true,
        };
      }
      const task = matches[0];
      const prevProgress = task.progress;
      const newProgress = Math.max(0, Math.min(100, parsed.value ?? 0));
      updateFunctions.handleProgressUpdate(task, newProgress);
      return {
        success: true,
        message: `Updated "${task.title}" to ${newProgress}%`,
        undoAction: () => updateFunctions.handleProgressUpdate(task, prevProgress),
      };
    }

    case 'mark_complete': {
      const matches = findAllMatchingTasks(parsed.taskName, tasks);
      if (matches.length === 0) {
        return { success: false, message: `Couldn't find task "${parsed.taskName}"` };
      }
      if (matches.length > 1) {
        return {
          success: false,
          message: `Found ${matches.length} matching tasks`,
          matchedTasks: matches,
          needsClarification: true,
        };
      }
      const task = matches[0];
      const prevProgress = task.progress;
      updateFunctions.handleProgressUpdate(task, 100);
      return {
        success: true,
        message: `Marked "${task.title}" as complete ✅`,
        undoAction: () => updateFunctions.handleProgressUpdate(task, prevProgress),
      };
    }

    case 'start_task': {
      const matches = findAllMatchingTasks(parsed.taskName, tasks);
      if (matches.length === 0) {
        return { success: false, message: `Couldn't find task "${parsed.taskName}"` };
      }
      if (matches.length > 1) {
        return {
          success: false,
          message: `Found ${matches.length} matching tasks`,
          matchedTasks: matches,
          needsClarification: true,
        };
      }
      const task = matches[0];
      if (task.progress === 0) {
        updateFunctions.handleProgressUpdate(task, 5);
      }
      return {
        success: true,
        message: `Started "${task.title}"`,
        undoAction: () => updateFunctions.handleProgressUpdate(task, 0),
      };
    }

    case 'add_note': {
      const matches = findAllMatchingTasks(parsed.taskName, tasks);
      if (matches.length === 0) {
        return { success: false, message: `Couldn't find task "${parsed.taskName}"` };
      }
      if (matches.length > 1) {
        return {
          success: false,
          message: `Found ${matches.length} matching tasks`,
          matchedTasks: matches,
          needsClarification: true,
        };
      }
      const task = matches[0];
      if (updateFunctions.onAddNote) {
        updateFunctions.onAddNote(task, parsed.text ?? '');
      }
      return {
        success: true,
        message: `Note added to "${task.title}"`,
      };
    }

    case 'log_issue': {
      return {
        success: true,
        message: `Issue logged: "${parsed.text ?? 'No details'}"`,
      };
    }

    case 'ask_question':
    case 'status_update':
    case 'weather_check': {
      return {
        success: true,
        message: parsed.text || 'Processing your question...',
      };
    }

    case 'daily_report': {
      return {
        success: true,
        message: 'Generating daily report from your update...',
      };
    }

    case 'unknown':
    default:
      return {
        success: false,
        message: parsed.clarification || "I didn't understand that. Try again?",
      };
  }
}

export function executeBatchCommands(
  parsed: ParsedBatchCommand,
  tasks: ScheduleTask[],
  updateFunctions: VoiceUpdateFunctions,
): { results: VoiceCommandResult[]; allSuccess: boolean } {
  console.log('[VoiceExec] Executing batch:', parsed.commands.length, 'commands');
  const results: VoiceCommandResult[] = [];
  const undoActions: (() => void)[] = [];

  for (const cmd of parsed.commands) {
    const singleParsed: ParsedVoiceCommand = {
      action: cmd.action,
      taskName: cmd.taskName,
      value: cmd.value,
      text: cmd.text,
      confidence: parsed.confidence,
    };
    const result = executeVoiceCommand(singleParsed, tasks, updateFunctions);
    results.push(result);
    if (result.undoAction) undoActions.push(result.undoAction);
  }

  const allSuccess = results.every(r => r.success);

  if (undoActions.length > 0) {
    results[0].undoAction = () => {
      undoActions.forEach(fn => fn());
    };
  }

  return { results, allSuccess };
}

export async function saveVoiceHistory(item: VoiceHistoryItem): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(VOICE_HISTORY_KEY);
    const history: VoiceHistoryItem[] = stored ? JSON.parse(stored) : [];
    history.unshift(item);
    const trimmed = history.slice(0, 10);
    await AsyncStorage.setItem(VOICE_HISTORY_KEY, JSON.stringify(trimmed));
    console.log('[VoiceExec] History saved, total:', trimmed.length);
  } catch (err) {
    console.log('[VoiceExec] Failed to save history:', err);
  }
}

export async function getVoiceHistory(): Promise<VoiceHistoryItem[]> {
  try {
    const stored = await AsyncStorage.getItem(VOICE_HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export async function saveVoiceIssue(projectId: string, issue: string): Promise<void> {
  try {
    const key = `${VOICE_ISSUES_KEY}_${projectId}`;
    const stored = await AsyncStorage.getItem(key);
    const issues: Array<{ text: string; timestamp: string }> = stored ? JSON.parse(stored) : [];
    issues.unshift({ text: issue, timestamp: new Date().toISOString() });
    await AsyncStorage.setItem(key, JSON.stringify(issues.slice(0, 50)));
  } catch (err) {
    console.log('[VoiceExec] Failed to save issue:', err);
  }
}

```
