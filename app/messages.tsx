import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform,
  Animated,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Send, ChevronDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useHire } from '@/contexts/HireContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import type { ChatMessage } from '@/types';

export default function MessagesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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

  const onlineIndicator = (
    <View style={styles.headerRight}>
      <View style={styles.onlineDot} />
      <Text style={styles.onlineText}>Online</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: otherName,
        headerStyle: { backgroundColor: Colors.surface },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
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
              <ChevronDown size={18} color={Colors.primary} />
              <Text style={styles.scrollBtnText}>New messages</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={1000}
            testID="message-input"
          />
          <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim()}
            testID="send-button"
          >
            <Send size={18} color={text.trim() ? '#FFF' : Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  kav: { flex: 1 },
  messageList: { padding: 16, paddingBottom: 8 },
  messageBubble: { maxWidth: '80%' as unknown as number, marginBottom: 8, padding: 12, borderRadius: 16 },
  myMessage: { alignSelf: 'flex-end' as const, backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  theirMessage: { alignSelf: 'flex-start' as const, backgroundColor: Colors.surface, borderBottomLeftRadius: 4 },
  senderName: { fontSize: 11, fontWeight: '600' as const, color: Colors.primary, marginBottom: 2 },
  messageText: { fontSize: 15, color: Colors.text, lineHeight: 20 },
  myMessageText: { color: '#FFF' },
  timestamp: { fontSize: 10, color: Colors.textMuted, marginTop: 4, alignSelf: 'flex-end' as const },
  myTimestamp: { color: 'rgba(255,255,255,0.7)' },
  emptyContainer: { flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const, paddingTop: 100 },
  emptyText: { fontSize: 15, color: Colors.textMuted },
  inputBar: {
    flexDirection: 'row' as const, alignItems: 'flex-end' as const, padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12, backgroundColor: Colors.surface,
    borderTopWidth: 0.5, borderTopColor: Colors.borderLight, gap: 8,
  },
  textInput: {
    flex: 1, backgroundColor: Colors.background, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: Colors.text, maxHeight: 100,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const },
  sendBtnDisabled: { backgroundColor: Colors.background },
  headerRight: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginRight: 4 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759' },
  onlineText: { fontSize: 12, color: Colors.textMuted },
  scrollToBottomBtn: {
    position: 'absolute' as const, bottom: 80, alignSelf: 'center' as const,
    backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4,
    elevation: 4, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
  },
  scrollBtnInner: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  scrollBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' as const },
});
