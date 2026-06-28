// app/client-messages.tsx — GC's view of the client↔GC message thread.
//
// iMessage-style layout: consecutive bubbles from the same author within
// 15 min collapse into a run (author label only on first, timestamp only
// on last). Time-separator pills slip in between runs that cross a 15-min
// gap or a calendar-day boundary. New bubbles slide up + spring in.
//
// DATA SOURCE — Supabase via usePortalThread. The old implementation read
// from a LOCAL AsyncStorage `portalMessages` array and wrote to it via
// addPortalMessage. That broke real messaging in production: client→GC
// messages arrive in Supabase (the web portal POSTs there) but the GC
// screen never saw them; GC→client messages were never sent at all
// because addPortalMessage was local-only. Both ends now share Supabase,
// filtered by portal_id (the column BOTH ends always populate).
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform,
  KeyboardAvoidingView, Alert, Animated, Easing, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MessageSquare, Send, Inbox } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { usePortalThread } from '@/hooks/usePortalThread';
import type { PortalMessage } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// Anything older than this gap from the previous message gets a fresh
// timestamp pill above it AND breaks the bubble-run grouping.
const GROUP_GAP_MS = 15 * 60 * 1000;

type DisplayItem =
  | { kind: 'separator'; id: string; label: string }
  | {
      kind: 'message';
      message: PortalMessage;
      // True when this message is the first in a same-sender run (so we
      // show the author label above it on the theirs side).
      isFirstInRun: boolean;
      // True when this is the last in a same-sender run (so we show a
      // timestamp underneath + draw the bubble tail).
      isLastInRun: boolean;
    };

function formatDayLabel(d: Date): string {
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = startOfDay(now);
  const that  = startOfDay(d);
  const diffDays = Math.round((today - that) / (24 * 60 * 60 * 1000));
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays < 7) return `${d.toLocaleDateString('en-US', { weekday: 'long' })} ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

function buildDisplayList(messages: PortalMessage[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;
    const next = i < messages.length - 1 ? messages[i + 1] : null;

    const mTime = new Date(m.createdAt).getTime();
    const prevTime = prev ? new Date(prev.createdAt).getTime() : 0;
    const nextTime = next ? new Date(next.createdAt).getTime() : 0;

    const gapFromPrev = prev ? mTime - prevTime : Infinity;
    const senderChangedFromPrev = !prev || prev.authorType !== m.authorType;

    if (!prev || gapFromPrev > GROUP_GAP_MS) {
      out.push({
        kind: 'separator',
        id: `sep-${m.id}`,
        label: formatDayLabel(new Date(m.createdAt)),
      });
    }

    const isFirstInRun = senderChangedFromPrev || gapFromPrev > GROUP_GAP_MS;
    const senderChangesNext = !next || next.authorType !== m.authorType;
    const gapToNext = next ? nextTime - mTime : Infinity;
    const isLastInRun = senderChangesNext || gapToNext > GROUP_GAP_MS;

    out.push({ kind: 'message', message: m, isFirstInRun, isLastInRun });
  }
  return out;
}

/** Single message bubble. Animates in on mount (slide up + slight scale). */
function MessageBubble({
  item,
  onLongPress,
  styles,
  themeColors,
}: {
  item: Extract<DisplayItem, { kind: 'message' }>;
  onLongPress?: () => void;
  styles: ReturnType<typeof makeStyles>;
  themeColors: ThemeColors;
}) {
  const { message: m, isFirstInRun, isLastInRun } = item;
  const mine = m.authorType === 'gc';
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(enter, {
      toValue: 1,
      tension: 80,
      friction: 11,
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  const scale      = enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  const opacity    = enter;

  // Corner radii — iMessage tightens the corner closest to the run's anchor
  // (bottom-right for mine, bottom-left for theirs) and only on the last
  // bubble in a run. Other corners stay round.
  const radius = 18;
  const tail   = 4;
  const cornerStyle = mine
    ? {
        borderTopLeftRadius: radius,
        borderTopRightRadius: radius,
        borderBottomLeftRadius: radius,
        borderBottomRightRadius: isLastInRun ? tail : radius,
      }
    : {
        borderTopLeftRadius: radius,
        borderTopRightRadius: radius,
        borderBottomRightRadius: radius,
        borderBottomLeftRadius: isLastInRun ? tail : radius,
      };

  const bubble = (
    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, cornerStyle]}>
      <Text style={[styles.body, mine && styles.bodyMine]} selectable>{m.body}</Text>
    </View>
  );

  return (
    <Animated.View
      style={[
        styles.row,
        mine ? styles.rowMine : styles.rowTheirs,
        { opacity, transform: [{ translateY }, { scale }] },
        isFirstInRun ? styles.runFirst : styles.runFollow,
      ]}
    >
      <View style={mine ? styles.bubbleCol : styles.bubbleColTheirs}>
        {/* Author label sits above the FIRST bubble in a theirs-run only.
            Mine never shows a label — it's obvious it's from the GC. */}
        {!mine && isFirstInRun ? (
          <Text style={styles.author} numberOfLines={1}>{m.authorName || 'Client'}</Text>
        ) : null}

        {onLongPress && !mine ? (
          <Pressable
            onLongPress={onLongPress}
            delayLongPress={350}
            accessibilityRole="button"
            accessibilityLabel={`Message from ${m.authorName || 'client'}. Long-press for actions.`}
          >
            {bubble}
          </Pressable>
        ) : bubble}

        {isLastInRun ? (
          <Text style={[styles.time, mine && styles.timeMine]}>
            {new Date(m.createdAt).toLocaleTimeString('en-US', {
              hour: 'numeric', minute: '2-digit',
            })}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

function TimeSeparator({ label, styles }: { label: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.separator}>
      <Text style={styles.separatorText}>{label}</Text>
    </View>
  );
}

export default function ClientMessagesScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { projects, settings } = useProjects();

  const project = useMemo(() => projects.find(p => p.id === id), [projects, id]);
  const portal = project?.clientPortal;
  const threadQ = usePortalThread({ projectId: project?.id, portalId: portal?.portalId });

  const messages = threadQ.messages;
  const display: DisplayItem[] = useMemo(() => buildDisplayList(messages), [messages]);

  const [composeBody, setComposeBody] = useState('');
  // Mutation.isPending stays true from the moment the Supabase insert
  // fires until it resolves — drives the disabled state on the input +
  // send button.
  const sending = threadQ.isSending;
  const scrollRef = useRef<ScrollView | null>(null);

  // Mark any unread client messages as read once when the GC opens this
  // screen. Server-side update via the Supabase row's read_by_gc column.
  useEffect(() => {
    if (!threadQ.unreadFromClient.length) return;
    for (const m of threadQ.unreadFromClient) {
      threadQ.markRead(m.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadQ.unreadFromClient.length]);

  // Auto-scroll to bottom as messages land.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length]);

  const canSend = composeBody.trim().length > 0 && !sending;

  // Smooth send-button activation: gray → accent + scale up when there's
  // text to send. Springs back when the input empties.
  const sendActivate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(sendActivate, {
      toValue: canSend ? 1 : 0,
      tension: 110,
      friction: 8,
      useNativeDriver: false, // backgroundColor isn't transformable
    }).start();
  }, [canSend, sendActivate]);

  const sendScale = useRef(new Animated.Value(1)).current;
  const handlePressIn = useCallback(() => {
    Animated.timing(sendScale, {
      toValue: 0.86, duration: 80, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  }, [sendScale]);
  const handlePressOut = useCallback(() => {
    Animated.spring(sendScale, {
      toValue: 1, tension: 130, friction: 6, useNativeDriver: true,
    }).start();
  }, [sendScale]);

  const handleSend = useCallback(() => {
    if (!project || !portal?.portalId) return;
    const body = composeBody.trim();
    if (!body) return;
    const gcName = settings?.branding?.companyName || 'Your General Contractor';
    // Inserts a row into Supabase `portal_messages`. The realtime
    // subscription invalidates the messages query and the new bubble
    // animates in. Also sets project_id so the row is properly tagged.
    threadQ.sendMessage({
      portalId: portal.portalId,
      projectId: project.id,
      body,
      authorName: gcName,
    });
    setComposeBody('');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [project, portal, composeBody, settings, threadQ]);

  // Long-press a client message → draft a change order from its body.
  const handleConvertToCO = useCallback((messageBody: string) => {
    if (!project) return;
    router.push({
      pathname: '/change-order' as any,
      params: {
        projectId: project.id,
        prefillReason: 'client_request',
        prefillDescription: `Client request from portal message:\n\n"${messageBody}"`,
      },
    });
  }, [project, router]);

  const showMessageActions = useCallback((messageBody: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    Alert.alert(
      'Message actions',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Convert to change order', onPress: () => handleConvertToCO(messageBody) },
      ],
    );
  }, [handleConvertToCO]);

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 40, alignItems: 'center' }]}>
        <Stack.Screen options={{ title: 'Messages' }} />
        <Text style={styles.muted}>Project not found.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnTxt}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!portal?.enabled) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 40, alignItems: 'center', paddingHorizontal: 24 }]}>
        <Stack.Screen options={{ title: 'Messages' }} />
        <Inbox size={30} color={themeColors.textMuted} strokeWidth={1.75} />
        <Text style={styles.muted}>Enable the client portal for this project to start a conversation.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnTxt}>Back to portal setup</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sendBg = sendActivate.interpolate({
    inputRange: [0, 1],
    outputRange: [themeColors.line, themeColors.accent],
  });

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
      <Stack.Screen options={{ title: project.name }} />
      <View style={styles.subheader}>
        <MessageSquare size={14} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={styles.subheaderTxt}>
          Thread with {portal.invites?.length ?? 0} {(portal.invites?.length ?? 0) === 1 ? 'client' : 'clients'}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {display.length === 0 ? (
          <View style={styles.empty}>
            <MessageSquare size={28} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No messages yet.</Text>
            <Text style={styles.emptyHint}>
              Break the ice — send a quick hello and let your client know how to reach you.
            </Text>
          </View>
        ) : (
          display.map(item => {
            if (item.kind === 'separator') {
              return <TimeSeparator key={item.id} label={item.label} styles={styles} />;
            }
            return (
              <MessageBubble
                key={item.message.id}
                item={item}
                onLongPress={() => showMessageActions(item.message.body)}
                styles={styles}
                themeColors={themeColors}
              />
            );
          })
        )}
      </ScrollView>

      <View style={[styles.compose, { paddingBottom: insets.bottom + 10 }]}>
        <TextInput
          style={styles.input}
          value={composeBody}
          onChangeText={setComposeBody}
          placeholder="iMessage"
          placeholderTextColor={themeColors.textMuted}
          multiline
          textAlignVertical="top"
          editable={!sending}
        />
        <Animated.View style={[styles.sendBtnWrap, { transform: [{ scale: sendScale }] }]}>
          <Pressable
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onPress={handleSend}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={({ pressed }) => [{ opacity: pressed && canSend ? 0.92 : 1 }]}
          >
            <Animated.View style={[styles.sendBtn, { backgroundColor: sendBg }]}>
              <Send size={16} color="#FFFFFF" strokeWidth={1.75} />
            </Animated.View>
          </Pressable>
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  muted: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 12 },
  backBtn: {
    marginTop: 18, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: t.accent, borderRadius: Tokens.radius.md,
  },
  backBtnTxt: { color: '#FFFFFF', fontWeight: '600', fontSize: Type.bodyCompact.fontSize },

  subheader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: `${t.accent}0A`,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  subheaderTxt: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 10 },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text, marginTop: 8 },
  emptyHint: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 18 },

  // Time-separator pill between groups. Centered, ~10pt, all-caps-feel.
  separator: { alignItems: 'center', marginTop: 14, marginBottom: 6 },
  separatorText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.textMuted,
    letterSpacing: 0.4,
  },

  row: { flexDirection: 'row', width: '100%' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  // Spacing — first bubble in a run gets a normal gap from above; follow-up
  // bubbles in the SAME run squeeze in tight so they read as one thought.
  runFirst:  { marginTop: 8 },
  runFollow: { marginTop: 2 },
  bubbleCol:       { maxWidth: '78%', alignItems: 'flex-end' },
  bubbleColTheirs: { maxWidth: '78%', alignItems: 'flex-start' },
  bubble: {
    paddingHorizontal: 13, paddingVertical: 8,
  },
  bubbleMine: { backgroundColor: t.accent },
  bubbleTheirs: { backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line },
  author: {
    fontSize: 11, fontWeight: '700',
    color: t.textMuted,
    marginLeft: 12, marginBottom: 4,
    letterSpacing: 0.1,
  },
  body: { fontSize: 15, color: t.text, lineHeight: 20 },
  bodyMine: { color: '#FFFFFF' },
  time: {
    fontSize: 10,
    color: t.textMuted,
    marginTop: 4,
    marginHorizontal: 8,
  },
  timeMine: { color: t.textMuted },

  compose: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: t.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 140,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: t.text, backgroundColor: t.bg,
  },
  sendBtnWrap: { },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
});
