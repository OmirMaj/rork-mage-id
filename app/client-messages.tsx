// app/client-messages.tsx — GC's view of the client↔GC message thread.
//
// iMessage-style layout: consecutive bubbles from the same author within
// 15 min collapse into a run (author label only on first, timestamp only
// on last). Time-separator pills slip in between runs that cross a 15-min
// gap or a calendar-day boundary. MOTION (kit ChatTurn + useSeenKeys): the
// history never moves — opening a thread is still. Only the NEWEST message
// that arrives while the thread is open moves, once: the one he just sent
// glides up out of the composer, a client reply fades in. Reduce Motion: a
// 100 ms fade, no travel.
//
// DATA SOURCE — Supabase via usePortalThread. The old implementation read
// from a LOCAL AsyncStorage `portalMessages` array and wrote to it via
// addPortalMessage. That broke real messaging in production: client→GC
// messages arrive in Supabase (the web portal POSTs there) but the GC
// screen never saw them; GC→client messages were never sent at all
// because addPortalMessage was local-only. Both ends now share Supabase,
// filtered by portal_id (the column BOTH ends always populate).
//
// ATTACHMENTS (track MSG, lane MSGAPP) — photos and PDFs ride a message
// through the device outbox (utils/messageOutbox.ts): a file message is drawn
// from there with its real state ("Uploading 1 of 2…", the waiting line,
// "Sending…", "Not sent" with Retry / Remove) until its row is written, and
// it never shows a sent time before that. A text message queued offline says
// "Waiting to send". Text-only sends take the unchanged sendMessage path.
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, KeyboardAvoidingView, Animated, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import MageRefreshControl from '@/components/MageRefreshControl';
import { MessageSquare, Send, Inbox, Lock, ChevronLeft, Paperclip } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { usePortalThread } from '@/hooks/usePortalThread';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useSafeBack } from '@/hooks/useSafeBack';
import type { PortalMessage } from '@/types';
import { Type } from '@/constants/typography';
import { Motion, Tokens } from '@/constants/designTokens';
import { nativeDriver } from '@/components/ui/motion';
import { showAlert } from '@/utils/alert';
import { oops, nailIt } from '@/components/animations/NailItToast';
import AttachmentTray from '@/components/messages/AttachmentTray';
import { AttachmentGrid, MessageStatusLine } from '@/components/messages/AttachmentGrid';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import AttachmentViewer from '@/components/messages/AttachmentViewer';
import { useAttachmentPicker, type PickedAttachment, type PickKind, type PickResult } from '@/hooks/useAttachmentPicker';
import { useMessageAttachmentUrls, type ThreadAttachment, type MessageAttachmentUrls } from '@/hooks/useMessageAttachmentUrls';
import { useMessageAttachmentCopy, type MessageAttachmentCopy } from '@/hooks/useMessageAttachmentCopy';
import { outboxDisplay, type OutboxDisplay, type OutboxEntry } from '@/utils/messageAttachments';
import { ChatTurn, useSeenKeys } from '@/components/motion/kit';

// Anything older than this gap from the previous message gets a fresh
// timestamp pill above it AND breaks the bubble-run grouping.
const GROUP_GAP_MS = 15 * 60 * 1000;

/** A message the server does not hold yet: an outbox entry, or a text send
 *  queued offline. It never gets a time label (and so never a separator). */
interface Pending {
  display?: OutboxDisplay;
  queued?: boolean;
  outboxId?: string;
}

/** A thread message as drawn: its attachments may be outbox copies. */
type ThreadMessage = Omit<PortalMessage, 'attachments'> & { attachments?: ThreadAttachment[] };
interface ThreadItem { message: ThreadMessage; pending?: Pending }

type DisplayItem =
  | { kind: 'separator'; id: string; label: string }
  | {
      kind: 'message';
      message: ThreadMessage;
      pending?: Pending;
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

function buildDisplayList(items: ThreadItem[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  const messages = items.map((x) => x.message);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const pending = items[i].pending;
    const prev = i > 0 ? messages[i - 1] : null;
    const next = i < messages.length - 1 ? messages[i + 1] : null;

    const mTime = new Date(m.createdAt).getTime();
    const prevTime = prev ? new Date(prev.createdAt).getTime() : 0;
    const nextTime = next ? new Date(next.createdAt).getTime() : 0;

    const gapFromPrev = prev ? mTime - prevTime : Infinity;
    const senderChangedFromPrev = !prev || prev.authorType !== m.authorType;

    // A separator is a time label: a pending message never gets one.
    if (!pending && (!prev || gapFromPrev > GROUP_GAP_MS)) {
      out.push({
        kind: 'separator',
        id: `sep-${m.id}`,
        label: formatDayLabel(new Date(m.createdAt)),
      });
    }

    const isFirstInRun = senderChangedFromPrev || gapFromPrev > GROUP_GAP_MS;
    const senderChangesNext = !next || next.authorType !== m.authorType;
    const gapToNext = next ? nextTime - mTime : Infinity;
    // A pending message never closes a run with a time: the sent message
    // before it keeps its own time.
    const nextPending = !!(next && items[i + 1].pending);
    const isLastInRun = senderChangesNext || gapToNext > GROUP_GAP_MS || (!pending && nextPending);

    out.push({ kind: 'message', message: m, pending, isFirstInRun, isLastInRun });
  }
  return out;
}

/** Single message bubble. Still unless `live` (the newest message, arrived
 *  while the thread is open): then ChatTurn moves it in once. */
function MessageBubble({
  item,
  live,
  onLongPress,
  styles,
  themeColors,
  urls,
  wide,
  onRetry,
  onRemove,
}: {
  item: Extract<DisplayItem, { kind: 'message' }>;
  live: boolean;
  onLongPress?: () => void;
  styles: ReturnType<typeof makeStyles>;
  themeColors: ThemeColors;
  urls: MessageAttachmentUrls;
  wide: boolean;
  onRetry?: (outboxId: string) => void;
  onRemove?: (outboxId: string) => void;
}) {
  const { message: m, pending, isFirstInRun, isLastInRun } = item;
  const atts = m.attachments ?? [];
  const hasText = m.body.trim().length > 0;
  const mine = m.authorType === 'gc';

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

  const grid = atts.length > 0 ? (
    <AttachmentGrid
      attachments={atts}
      mine={mine}
      bare={!hasText}
      urlFor={urls.urlFor}
      onRefresh={urls.refresh}
      onOpen={urls.open}
      onShare={urls.share}
    />
  ) : null;
  // A message with files and no text draws only the grid. `bare` gives a
  // contractor PDF chip its own green fill there: with no bubble behind it,
  // white ink on the page background would be unreadable.
  const bubble = hasText ? (
    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, cornerStyle]}>
      {grid ? <View style={styles.bubbleGrid}>{grid}</View> : null}
      <Text style={[styles.body, mine && styles.bodyMine]} selectable>{m.body}</Text>
    </View>
  ) : <View>{grid}</View>;
  const outboxId = pending?.outboxId;

  return (
    <ChatTurn
      role={mine ? 'user' : 'assistant'}
      live={live}
      variant="page"
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, isFirstInRun ? styles.runFirst : styles.runFollow]}
    >
      <View style={[mine ? styles.bubbleCol : styles.bubbleColTheirs, wide && styles.bubbleColWide]}>
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

        {isLastInRun && !pending ? (
          <Text style={[styles.time, mine && styles.timeMine]}>
            {new Date(m.createdAt).toLocaleTimeString('en-US', {
              hour: 'numeric', minute: '2-digit',
            })}
          </Text>
        ) : null}
        {pending ? (
          <MessageStatusLine
            display={pending.display}
            queued={pending.queued}
            web={Platform.OS === 'web'}
            onRetry={outboxId && onRetry ? () => onRetry(outboxId) : undefined}
            onRemove={outboxId && onRemove ? () => onRemove(outboxId) : undefined}
            testID={`message-status-${m.id}`}
          />
        ) : null}
      </View>
    </ChatTurn>
  );
}

/** An outbox entry as a gc message at its createdAt, its files as device copies. */
function outboxMessage(e: OutboxEntry): ThreadMessage {
  return {
    id: e.id, projectId: e.projectId, portalId: e.portalId, authorType: 'gc', authorName: e.authorName,
    body: e.body, createdAt: e.createdAt, readByGc: true, readByClient: false,
    // No storage path: until the row is written the thread shows the copy on this device.
    attachments: e.attachments.map(({ id, name, mime, size, kind, width, height, localUri }) => ({
      id, name, mime, size, kind, width, height, localUri,
    })),
  };
}

/** Server rows (a queued one marked as such) plus the outbox, oldest first. */
function threadItems(messages: PortalMessage[], outbox: OutboxEntry[], queuedIds: ReadonlySet<string>): ThreadItem[] {
  const seen = new Set(messages.map((m) => m.id));
  const out: ThreadItem[] = messages.map((m) => (queuedIds.has(m.id) ? { message: m, pending: { queued: true } } : { message: m }));
  let extra = false;
  for (const e of outbox) {
    if (seen.has(e.id)) continue; // its row is already in the thread (sent or queued)
    out.push({ message: outboxMessage(e), pending: { display: outboxDisplay(e), outboxId: e.id } });
    extra = true;
  }
  if (!extra) return out;
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (new Date(a.x.message.createdAt).getTime() - new Date(b.x.message.createdAt).getTime()) || a.i - b.i)
    .map(({ x }) => x);
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
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  // THE HOMEOWNER-MESSAGE EMAIL LANDS HERE AS THE FIRST ROUTE (audit
  // 2026-09-23 #149). 'Reply in MAGE ID' on an iPhone opens Safari at
  // app.mageid.app/client-messages?id=… — no associated domains, so not the
  // app — at phone width, so no sidebar and no tab bar. With nothing to pop,
  // the header drew no back and both buttons below called router.back(),
  // which does nothing: the only exit was editing the URL. useSafeBack falls
  // through to Home, and the header gets its own chevron whenever there is no
  // history (with history, the stack's native back is left alone).
  const goBack = useSafeBack();
  const headerBack = router.canGoBack()
    ? {}
    : {
        headerLeft: () => (
          <TouchableOpacity
            onPress={goBack}
            style={{ marginLeft: 4, paddingRight: 8 }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="client-messages-back"
          >
            <ChevronLeft size={24} color={themeColors.accent} strokeWidth={1.75} />
          </TouchableOpacity>
        ),
      };

  const { projects, settings } = useProjects();

  const project = useMemo(() => projects.find(p => p.id === id), [projects, id]);
  const portal = project?.clientPortal;
  const threadQ = usePortalThread({ projectId: project?.id, portalId: portal?.portalId });
  // The "gc inserts own portal messages" policy accepts the project OWNER
  // only, so a collaborator's send is refused every time. Say so up front
  // instead of letting him type a message the server will never take. A
  // role still resolving (null) keeps the composer: the owner's own
  // unsynced job resolves as 'owner' from the cache hint.
  const role = useProjectRole(project?.id);
  const ownerOnlyBlocked = role === 'editor' || role === 'viewer' || role === 'field';

  const messages = threadQ.messages;
  const outbox = threadQ.outbox;
  const queuedIds = threadQ.queuedIds;
  const items = useMemo(() => threadItems(messages, outbox, queuedIds), [messages, outbox, queuedIds]);
  const display: DisplayItem[] = useMemo(() => buildDisplayList(items), [items]);

  // Motion: which bubble may move. Nothing is live until the thread has
  // loaded once (the first commit after `loaded` seeds every id shown then,
  // a cached thread included); after that only the NEWEST message, the first
  // time it is shown, is live. Every id on screen is marked seen after each
  // commit, so history, a refresh that brings several and the outbox → sent
  // hand-off (same id) never animate again.
  const seenMsgs = useSeenKeys();
  const seededRef = useRef(false);
  let newestId: string | null = null;
  for (let k = display.length - 1; k >= 0; k--) {
    const d = display[k];
    if (d.kind === 'message') { newestId = d.message.id; break; }
  }
  const liveId = seededRef.current && newestId && !seenMsgs.has(newestId) ? newestId : null;
  useEffect(() => {
    seenMsgs.mark(display.flatMap((d) => (d.kind === 'message' ? [d.message.id] : [])));
    if (threadQ.loaded) seededRef.current = true;
  });

  // Attachments: picked files for the next message, the signed URLs of the
  // thread's files, and the full-screen photo.
  const copy: MessageAttachmentCopy = useMessageAttachmentCopy();
  const { pick, vetDroppedFiles } = useAttachmentPicker();
  const [files, setFiles] = useState<PickedAttachment[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;
  const [viewing, setViewing] = useState<ThreadAttachment | null>(null);
  const urls = useMessageAttachmentUrls(messages, { onOpenPhoto: setViewing });
  // The single desktop gate (web >= 900): the same width the sidebar uses.
  const wide = useIsDesktopWeb();

  const [composeBody, setComposeBody] = useState('');
  // Mutation.isPending stays true from the moment the Supabase insert
  // fires until it resolves — drives the disabled state on the input +
  // send button.
  const sending = threadQ.isSending;
  const scrollRef = useRef<ScrollView | null>(null);

  // Pull-to-refresh — force a fetch of the client's latest replies. Matches
  // the homeowner's client-view, which already has MageRefreshControl. Gives
  // the GC a manual pull when a poll is stale or the realtime channel drops.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await threadQ.refetchMessages();
    } finally {
      setRefreshing(false);
    }
  }, [threadQ]);

  // Mark any unread client messages as read once when the GC opens this
  // screen. Server-side update via the Supabase row's read_by_gc column.
  useEffect(() => {
    if (!threadQ.unreadFromClient.length) return;
    for (const m of threadQ.unreadFromClient) {
      threadQ.markRead(m.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadQ.unreadFromClient.length]);

  // Auto-scroll to bottom as messages land (or wait in the outbox).
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [display.length]);

  // A pick's refusals: one toast naming the first refused file; the rest of
  // the pick is kept.
  const addPicked = useCallback((res: PickResult) => {
    if (res.picked.length > 0) setFiles((prev) => [...prev, ...res.picked]);
    const first = res.refused[0];
    if (first) oops(copy.refusal(first.reason, first.name, first.size));
  }, [copy]);
  const runPick = useCallback(async (kind: PickKind) => {
    addPicked(await pick(kind, filesRef.current.length));
  }, [pick, addPicked]);
  const handleAttach = useCallback(() => {
    // Desktop web: the browser's file chooser, images and PDFs, several at once.
    if (Platform.OS === 'web') { void runPick('any'); return; }
    showAlert(copy.sheetTitle, undefined, [
      { text: copy.takePhoto, onPress: () => { void runPick('camera'); } },
      { text: copy.choosePhotos, onPress: () => { void runPick('photos'); } },
      { text: copy.choosePdf, onPress: () => { void runPick('pdf'); } },
      { text: copy.cancel, style: 'cancel' },
    ]);
  }, [copy, runPick]);

  // Desktop web: files dropped on the thread join the tray, held to the same
  // checks as the picker. A browser DOM event, so inert on a phone.
  const dropRef = useRef<View | null>(null);
  const dropLive = useRef({ blocked: ownerOnlyBlocked, add: (_l: File[]) => {} });
  dropLive.current = {
    blocked: ownerOnlyBlocked,
    add: (list: File[]) => addPicked(vetDroppedFiles(list, filesRef.current.length)),
  };
  const dropReady = !!project && !!portal?.enabled;
  useEffect(() => {
    if (Platform.OS !== 'web' || !dropReady) return;
    const node = dropRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files');
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // without it the browser opens the file in the tab
      if (e.dataTransfer) e.dataTransfer.dropEffect = dropLive.current.blocked ? 'none' : 'copy';
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (dropLive.current.blocked) return;
      dropLive.current.add(Array.from(e.dataTransfer?.files ?? []));
    };
    node.addEventListener('dragover', onOver);
    node.addEventListener('drop', onDrop);
    return () => {
      node.removeEventListener('dragover', onOver);
      node.removeEventListener('drop', onDrop);
    };
  }, [dropReady]);

  const canSend = (composeBody.trim().length > 0 || files.length > 0) && !sending;

  // Smooth send-button activation: gray → accent + scale up when there's
  // text to send. Springs back when the input empties.
  const sendActivate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(sendActivate, {
      toValue: canSend ? 1 : 0,
      ...Motion.spring.rise,
      useNativeDriver: false, // backgroundColor isn't transformable
    }).start();
  }, [canSend, sendActivate]);

  const sendScale = useRef(new Animated.Value(1)).current;
  const handlePressIn = useCallback(() => {
    // A firm press, no squash: 0.94 on the snap preset (was a 0.86 squash).
    Animated.spring(sendScale, {
      toValue: 0.94, ...Motion.spring.snap, useNativeDriver: nativeDriver,
    }).start();
  }, [sendScale]);
  const handlePressOut = useCallback(() => {
    // Release settles back without the old pop-and-wobble (ζ≈0.83).
    Animated.spring(sendScale, {
      toValue: 1, ...Motion.spring.snap, useNativeDriver: nativeDriver,
    }).start();
  }, [sendScale]);

  // A message with files goes into the device outbox and is drawn in the
  // thread with its state, so the composer and tray clear at once (nothing is
  // lost if an upload fails). No success haptic or toast here: it is not sent
  // until the outbox has written its row.
  const sendFiles = useCallback(async () => {
    if (!project || !portal?.portalId) return;
    const picked = filesRef.current;
    if (picked.length === 0) return;
    const body = composeBody.trim();
    const gcName = settings?.branding?.companyName || 'Your contractor';
    setComposeBody('');
    setFiles([]);
    try {
      await threadQ.sendWithAttachments({
        portalId: portal.portalId,
        projectId: project.id,
        body,
        authorName: gcName,
        files: picked,
      });
    } catch {
      setComposeBody(body);
      setFiles(picked);
      oops("Message didn't send. Check your connection and try again.");
    }
  }, [project, portal, composeBody, settings, threadQ]);

  const handleSend = useCallback(async () => {
    if (!project || !portal?.portalId) return;
    if (filesRef.current.length > 0) { await sendFiles(); return; }
    const body = composeBody.trim();
    if (!body) return;
    const gcName = settings?.branding?.companyName || 'Your contractor';
    // SYNC-F8: the insert goes through the offline queue with a client id
    // (usePortalThread). The composer keeps the text until the message has
    // landed or been queued for the next flush, and the success haptic fires
    // only then — a lost message is said out loud, not buzzed as "sent".
    const outcome = await threadQ.sendMessage({
      portalId: portal.portalId,
      projectId: project.id,
      body,
      authorName: gcName,
    });
    if (outcome === 'failed') {
      oops("Message didn't send. Check your connection and try again.");
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setComposeBody('');
    if (outcome === 'queued') nailIt("Saved offline. It sends when you're back online.");
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [project, portal, composeBody, settings, threadQ, sendFiles]);

  // Long-press a client message → draft a change order from its body (and
  // the names of its files, on a line of their own).
  const handleConvertToCO = useCallback((messageBody: string, fileNames: string[] = []) => {
    if (!project) return;
    const filesLine = fileNames.length > 0 ? `\n${copy.coPrefillFiles(fileNames.join(', '))}` : '';
    router.push({
      pathname: '/change-order' as any,
      params: {
        projectId: project.id,
        prefillReason: 'client_request',
        prefillDescription: `Client request from portal message:\n\n"${messageBody}"${filesLine}`,
      },
    });
  }, [project, router, copy]);

  const showMessageActions = useCallback((messageBody: string, fileNames: string[] = []) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    showAlert(
      'Message actions',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Convert to change order', onPress: () => handleConvertToCO(messageBody, fileNames) },
      ],
    );
  }, [handleConvertToCO]);

  // A message that never went: Retry runs the outbox again; Remove asks first.
  const retryOutbox = useCallback((outboxId: string) => { void threadQ.retryOutbox(outboxId); }, [threadQ]);
  const confirmRemoveOutbox = useCallback((outboxId: string) => {
    showAlert(copy.removeTitle, copy.removeBody, [
      { text: copy.cancel, style: 'cancel' },
      { text: copy.remove, style: 'destructive', onPress: () => { void threadQ.removeOutbox(outboxId); } },
    ]);
  }, [copy, threadQ]);

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 40, alignItems: 'center' }]}>
        <Stack.Screen options={{ title: 'Messages', ...headerBack }} />
        <Text style={styles.muted}>Project not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Text style={styles.backBtnTxt}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!portal?.enabled) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 40, alignItems: 'center', paddingHorizontal: 24 }]}>
        <Stack.Screen options={{ title: 'Messages', ...headerBack }} />
        <Inbox size={30} color={themeColors.textMuted} strokeWidth={1.75} />
        <Text style={styles.muted}>Enable the client portal for this project to start a conversation.</Text>
        {/* Goes where its label says. router.back() popped to whatever came
            before — and from an email link, to nothing at all. */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.replace({ pathname: '/client-portal-setup', params: { id: project.id } })}
        >
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
      <Stack.Screen options={{ title: project.name, ...headerBack }} />
      <View style={styles.subheader}>
        <MessageSquare size={14} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={styles.subheaderTxt}>
          Thread with {portal.invites?.length ?? 0} {(portal.invites?.length ?? 0) === 1 ? 'client' : 'clients'}
        </Text>
      </View>

      <View ref={dropRef} style={styles.dropZone}>
      <ScrollView
        {...fabScroll}
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <MageRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {display.length === 0 ? (
          <View style={styles.empty}>
            <MessageSquare size={28} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyHint}>
              Send a first message so your client knows how to reach you.
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
                live={item.message.id === liveId}
                onLongPress={() => showMessageActions(item.message.body, (item.message.attachments ?? []).map((a) => a.name))}
                styles={styles}
                themeColors={themeColors}
                urls={urls}
                wide={wide}
                onRetry={retryOutbox}
                onRemove={confirmRemoveOutbox}
              />
            );
          })
        )}
      </ScrollView>

      {ownerOnlyBlocked ? (
      <View
        style={[styles.compose, styles.composeBlocked, { paddingBottom: insets.bottom + 10 }]}
        accessibilityRole="text"
        testID="client-messages-owner-only"
      >
        <Lock size={16} color={themeColors.textMuted} strokeWidth={1.75} />
        <Text style={styles.composeBlockedText}>Only the project owner can message the client. You can read the thread.</Text>
      </View>
      ) : (
      <View style={[styles.compose, { paddingBottom: insets.bottom + 10 }]}>
        <AttachmentTray files={files} onRemove={(fid) => setFiles((prev) => prev.filter((f) => f.id !== fid))} />
        <View style={styles.composeRow}>
        <Pressable
          onPress={handleAttach}
          disabled={sending}
          style={styles.attachBtn}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={copy.attachA11y}
          testID="client-messages-attach"
        >
          <Paperclip size={20} color={themeColors.textSecondary} strokeWidth={1.75} />
        </Pressable>
        <TextInput
          style={styles.input}
          value={composeBody}
          onChangeText={setComposeBody}
          // This is the portal thread, not iMessage — the old placeholder said
          // otherwise and read as if the reply went to the client's phone.
          placeholder={portal?.invites?.[0]?.name?.trim() ? `Reply to ${portal.invites[0].name.trim()}` : 'Reply to your client'}
          placeholderTextColor={themeColors.textMuted}
          multiline
          textAlignVertical="top"
          editable={!sending}
        />
        <Animated.View style={[styles.sendBtnWrap, { transform: [{ scale: sendScale }] }]}>
          <Pressable
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onPress={() => { void handleSend(); }}
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
      </View>
      )}
      </View>
      <AttachmentViewer
        attachment={viewing}
        uri={viewing ? ((viewing.path ? urls.urlFor(viewing.id) : null) ?? viewing.localUri ?? null) : null}
        onClose={() => setViewing(null)}
        onShare={urls.share}
        onRetry={(a) => urls.refresh(a.id)}
      />
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  muted: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 12 },
  backBtn: {
    marginTop: 18, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: t.accentFill, borderRadius: Tokens.radius.md,
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
  // Desktop web: a photo grid does not stretch across a wide thread.
  bubbleColWide:   { maxWidth: 560 },
  bubbleGrid: { marginBottom: 6 },
  dropZone: { flex: 1 },
  bubble: {
    paddingHorizontal: 13, paddingVertical: 8,
  },
  bubbleMine: { backgroundColor: t.accentFill },
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

  // A column: the tray of picked files (when there are any), then the row.
  compose: {
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
  composeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  attachBtn: { width: 36, height: 36, borderRadius: Tokens.radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  composeBlocked: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingBottom: 12 },
  composeBlockedText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, lineHeight: 20 },
  sendBtnWrap: { },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
});
