import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MessageSquare, Send, Inbox } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';

export default function ClientMessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const {
    projects, settings,
    getPortalMessagesForProject, addPortalMessage, markPortalMessagesRead,
  } = useProjects();

  const project = useMemo(() => projects.find(p => p.id === id), [projects, id]);
  const portal = project?.clientPortal;

  const messages = useMemo(
    () => project ? getPortalMessagesForProject(project.id) : [],
    [project, getPortalMessagesForProject],
  );

  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  // When the GC opens this screen, mark all client messages as read.
  useEffect(() => {
    if (!project) return;
    markPortalMessagesRead(project.id, 'gc');
  }, [project?.id, markPortalMessagesRead]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length]);

  const handleSend = useCallback(() => {
    if (!project || !portal) return;
    const body = composeBody.trim();
    if (!body) return;
    const gcName = settings?.branding?.companyName || 'Your General Contractor';
    setSending(true);
    try {
      addPortalMessage({
        projectId: project.id,
        portalId: portal.portalId,
        authorType: 'gc',
        authorName: gcName,
        body,
        readByGc: true,
        readByClient: false,
      });
      setComposeBody('');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setSending(false);
    }
  }, [project, portal, composeBody, settings, addPortalMessage]);

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
        <Inbox size={30} color={Colors.textMuted} />
        <Text style={styles.muted}>Enable the client portal for this project to start a conversation.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnTxt}>Back to portal setup</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
      <Stack.Screen options={{ title: project.name }} />
      <View style={styles.subheader}>
        <MessageSquare size={14} color={Colors.primary} />
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
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <MessageSquare size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No messages yet.</Text>
            <Text style={styles.emptyHint}>
              Break the ice — send a quick hello and let your client know how to reach you.
            </Text>
          </View>
        ) : (
          messages.map((m) => {
            const mine = m.authorType === 'gc';
            return (
              <View
                key={m.id}
                style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}
              >
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.author, mine && styles.authorMine]}>
                    {mine ? 'You' : m.authorName}
                  </Text>
                  <Text style={[styles.body, mine && styles.bodyMine]}>{m.body}</Text>
                  <Text style={[styles.time, mine && styles.timeMine]}>
                    {new Date(m.createdAt).toLocaleString('en-US', {
                      month: 'short', day: 'numeric',
                      hour: 'numeric', minute: '2-digit',
                    })}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={[styles.compose, { paddingBottom: insets.bottom + 10 }]}>
        <TextInput
          style={styles.input}
          value={composeBody}
          onChangeText={setComposeBody}
          placeholder="Write a reply…"
          placeholderTextColor={Colors.textMuted}
          multiline
          textAlignVertical="top"
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!composeBody.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!composeBody.trim() || sending}
          activeOpacity={0.8}
        >
          <Send size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  muted: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 12 },
  backBtn: {
    marginTop: 18, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: Colors.primary, borderRadius: 10,
  },
  backBtnTxt: { color: Colors.textOnPrimary, fontWeight: '600', fontSize: 14 },

  subheader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: `${Colors.primary}0A`,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border,
  },
  subheaderTxt: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 8 },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginTop: 8 },
  emptyHint: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },

  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '84%', borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  bubbleMine: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: Colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: Colors.cardBorder },
  author: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, marginBottom: 2 },
  authorMine: { color: 'rgba(255,255,255,0.85)' },
  body: { fontSize: 14, color: Colors.text, lineHeight: 19 },
  bodyMine: { color: '#fff' },
  time: { fontSize: 10, color: Colors.textMuted, marginTop: 4 },
  timeMine: { color: 'rgba(255,255,255,0.7)' },

  compose: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 140,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: Colors.text, backgroundColor: Colors.background,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
});
