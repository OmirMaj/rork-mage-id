import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform,
  Animated,
  type LayoutChangeEvent,
} from 'react-native';
import { useBrainFabLift } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Send, ChevronDown, MessageCircle } from 'lucide-react-native';
import EmptyState from '@/components/EmptyState';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useHire, HIRE_ENABLED } from '@/contexts/HireContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import type { ChatMessage } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function MessagesScreen() {
  // A chat screen: the composer sits at the bottom of the flex column, which is
  // exactly where the global Brain FAB rests — it was drawn over the Send
  // button (iOS visual audit 2026-08-16, defect #5). Bottom padding on the
  // message list cannot reach a sibling below it, so measure the composer and
  // lift the FAB by its height.
  //
  // No {...fabScroll} here: this list already owns onScroll for the "New
  // messages" affordance, and the spread's handler would replace it.
  const [composerH, setComposerH] = useState(0);
  const onComposerLayout = useCallback((e: LayoutChangeEvent) => {
    setComposerH(e.nativeEvent.layout.height);
  }, []);
  useBrainFabLift(composerH);
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { conversations, getConversationMessages, sendMessage } = useHire();
  const { user } = useAuth();
  const { clearBadge } = useNotifications();
  const [text, setText] = useState('');
  const [isAtBottom, setIsAtBottom] = useState(true);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const prevMessageCount = useRef(0);
  const scrollIndicatorAnim = useRef(new Animated.Value(0)).current;

  const conversation = conversations.find(c => c.id === id);
  const messages = getConversationMessages(id ?? '');
  const senderId = user?.id ?? 'you';
  const senderName = user?.name ?? 'You';

  useEffect(() => {
    void clearBadge();
  }, [clearBadge]);

  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      if (isAtBottom) {
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      } else {
        Animated.sequence([
          Animated.timing(scrollIndicatorAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.delay(3000),
          Animated.timing(scrollIndicatorAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start();
      }
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, isAtBottom, scrollIndicatorAnim]);

  const handleSend = useCallback(() => {
    if (!text.trim() || !id) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMessage(id, senderId, senderName, text.trim());
    setText('');
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 150);
  }, [text, id, sendMessage, senderId, senderName]);

  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    setIsAtBottom(distFromBottom < 50);
  }, []);

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  const otherName = conversation?.participantNames.find((_, i) => i > 0) ?? 'Chat';

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isMe = item.senderId === senderId;
    return (
      <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage]}>
        {!isMe && <Text style={styles.senderName}>{item.senderName}</Text>}
        <Text style={[styles.messageText, isMe && styles.myMessageText]}>{item.text}</Text>
        <Text style={[styles.timestamp, isMe && styles.myTimestamp]}>
          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  }, [senderId]);

  // No real presence signal is wired yet, so we don't fake an "Online" status.
  const onlineIndicator = null;

  // Messaging ships as part of the Direct-Hire subsystem, which is
  // feature-flagged off for launch (see HIRE_ENABLED). Until that's live,
  // show a neutral "coming soon" state rather than instructions pointing at
  // a flow that doesn't yet work end-to-end.
  if (!HIRE_ENABLED) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Messages' }} />
        <EmptyState
          icon={<MessageCircle size={36} color={themeColors.accent} strokeWidth={1.6} />}
          title="Messaging is coming soon"
          message="In-app messaging isn't available yet. We'll turn it on once the hiring marketplace goes live."
        />
      </View>
    );
  }

  // Direct sidebar hits land here without a conversation id. Show how to
  // open one instead of an empty screen with no context.
  if (!id) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Messages' }} />
        <EmptyState
          icon={<MessageCircle size={36} color={themeColors.accent} strokeWidth={1.6} />}
          title="No conversation open yet"
          message="Messages live inside hires and subs you've connected with. To start a thread:"
          steps={[
            'Open Hire from the sidebar to see active hires, or Subs for your sub roster.',
            'Tap a person to open their profile.',
            'Hit Message to start chatting — replies show up here automatically.',
          ]}
          actionLabel="Open Hire"
          onAction={() => router.push('/(tabs)/discover/hire' as any)}
          secondaryLabel="View Subs"
          onSecondaryAction={() => router.push('/(tabs)/subs' as any)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: otherName,
        headerStyle: { backgroundColor: themeColors.surface },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
        headerRight: () => onlineIndicator,
      }} />
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Start the conversation</Text>
            </View>
          }
        />

        {!isAtBottom && (
          <Animated.View style={[styles.scrollToBottomBtn, { opacity: scrollIndicatorAnim }]}>
            <TouchableOpacity onPress={scrollToBottom} style={styles.scrollBtnInner}>
              <ChevronDown size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.scrollBtnText}>New messages</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        <View style={styles.inputBar} onLayout={onComposerLayout}>
          <TextInput
            style={styles.textInput}
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            placeholderTextColor={themeColors.textMuted}
            multiline
            maxLength={1000}
            testID="message-input"
          />
          <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim()}
            testID="send-button" accessibilityRole="button" accessibilityLabel="Send"><Send size={18} color={text.trim() ? '#FFF' : themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  kav: { flex: 1 },
  messageList: { padding: 16, paddingBottom: 8 },
  messageBubble: { maxWidth: '80%' as unknown as number, marginBottom: 8, padding: 12, borderRadius: Tokens.radius.panel },
  myMessage: { alignSelf: 'flex-end' as const, backgroundColor: t.accent, borderBottomRightRadius: 4 },
  theirMessage: { alignSelf: 'flex-start' as const, backgroundColor: t.surface, borderBottomLeftRadius: 4 },
  senderName: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.accent, marginBottom: 2 },
  messageText: { fontSize: Type.subhead.fontSize, color: t.text, lineHeight: 20 },
  myMessageText: { color: '#FFF' },
  timestamp: { fontSize: 10, color: t.textMuted, marginTop: 4, alignSelf: 'flex-end' as const },
  myTimestamp: { color: 'rgba(255,255,255,0.7)' },
  emptyContainer: { flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const, paddingTop: 100 },
  emptyText: { fontSize: Type.subhead.fontSize, color: t.textMuted },
  inputBar: {
    flexDirection: 'row' as const, alignItems: 'flex-end' as const, padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12, backgroundColor: t.surface,
    borderTopWidth: 0.5, borderTopColor: t.line, gap: 8,
  },
  textInput: {
    flex: 1, backgroundColor: t.bg, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: Type.subhead.fontSize, color: t.text, maxHeight: 100,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.accent, alignItems: 'center' as const, justifyContent: 'center' as const },
  sendBtnDisabled: { backgroundColor: t.bg },
  headerRight: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginRight: 4 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.success },
  onlineText: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  scrollToBottomBtn: {
    position: 'absolute' as const, bottom: 80, alignSelf: 'center' as const,
    backgroundColor: t.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4,
    elevation: 4, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
  },
  scrollBtnInner: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  scrollBtnText: { fontSize: Type.footnote.fontSize, color: t.accent, fontWeight: '600' as const },
});
