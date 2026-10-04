// components/messages/MessageAiSheet.tsx — "Read with MAGE" on a client's
// portal message (lane ATTPORTAL). Phone app, project owner only; the screen
// decides who gets the button (utils/messageAiCore canReadWithAi) and mounts
// this sheet only while PORTAL_MESSAGE_AI_ENABLED is on.
//
// WHAT IT DOES. It lists the files it is about to have read, sends their ids
// (never a location, never the bytes: the server loads them itself and checks
// that the message is the caller's), and shows a summary, what the client is
// asking for and one drafted description. Three buttons open the existing
// change-order, RFI and punch forms with that text in place.
//
// WHAT IT NEVER DOES.
//   - Nothing here is posted to the thread, sent to the client or saved as a
//     record. A draft only opens a form; he saves it there or he does not.
//   - The AI never picks the record type, never sets a price and never sets a
//     change order's reason: he taps one of three buttons, and the routes carry
//     a fixed reason and no amount (utils/messageAiCore).
//   - The reading is kept in this component's memory and is gone when the
//     sheet closes.
//   - Nothing is logged: a client's file name and what the AI read out of the
//     file are personal data.
//
// HONESTY. The "Files:" line of a draft and the "What I read" block are built
// from the list the SERVER says it sent to the model, never from every file
// on the message. Files that were left out stay listed under "Not read", with
// the reason, before the read and after it. Every text the model wrote passes
// the own-words gate before it is drawn (utils/messageAiCore
// guardMessageReading: one gate question for the whole reading).
//
// The consent gate, the feature flag and the request itself are inside
// utils/askFiles (the one file that names the edge function). Strings come
// from useMessageAttachmentCopy().ai and useAskCopy().files.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Sheet, Spinner, cardSurface } from '@/components/ui';
import { WhatIRead } from '@/components/brain/ask/WhatIRead';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useAskCopy } from '@/hooks/useAskCopy';
import { useMessageAttachmentCopy } from '@/hooks/useMessageAttachmentCopy';
import { useOffline } from '@/hooks/useOnline';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useTierAccess } from '@/hooks/useTierAccess';
import type { MessageAttachment, Project } from '@/types';
import { AI_CONSENT_DECLINED_CODE } from '@/utils/aiConsent';
import { settleAiConsentSync } from '@/utils/aiConsentAccount';
import { askFiles, type AskFilesOutcome } from '@/utils/askFiles';
import {
  ASK_MAX_FILES, ASK_MESSAGE_FILE_MAX_BYTES, ASK_PDF_MAX_PAGES, ASK_TOTAL_MAX_BYTES,
  askFilesSentence, mbOf, toTurnFiles,
} from '@/utils/askFilesCore';
import { stashDraftHandoff } from '@/utils/draftHandoff';
import {
  aiReadableFiles, coDraftRoute, draftText, guardMessageReading, messageAiBlock, punchDraftRoute, refusalToNotRead,
  rfiDraftRoute, type MessageReadingView, type NotReadReason,
} from '@/utils/messageAiCore';

export interface MessageAiSheetProps {
  visible: boolean;
  onClose(): void;
  project: Project;
  message: { id: string; attachments: MessageAttachment[] };
}

type Phase = 'list' | 'reading' | 'result' | 'failure';

interface Failure { sentence: string; retry: boolean; plans: boolean }

export default function MessageAiSheet({ visible, onClose, project, message }: MessageAiSheetProps) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const copy = useMessageAttachmentCopy();
  const askCopy = useAskCopy();
  const { isProOrAbove, tier } = useTierAccess();
  const offline = useOffline();
  // The punch form is a Business feature (or the collaborator grant on this job).
  const canPunch = useProjectAccess(project.id).canAccess('punch_list_closeout');

  // All of it in memory, and gone when the sheet closes.
  const [excluded, setExcluded] = useState<ReadonlyMap<string, NotReadReason>>(() => new Map());
  const [phase, setPhase] = useState<Phase>('list');
  const [reading, setReading] = useState<MessageReadingView | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  /** The last try's sentence, shown above the list when a file was moved to "Not read". */
  const [listNote, setListNote] = useState<string | null>(null);

  const alive = useRef(true);
  /** A read is in flight. Each read is counted, so a second tap must not start another. */
  const running = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // A closed sheet keeps nothing; another message starts clean.
  useEffect(() => {
    if (visible) return;
    setExcluded(new Map());
    setPhase('list');
    setReading(null);
    setFailure(null);
    setListNote(null);
  }, [visible, message.id]);

  const { read, notRead } = useMemo(
    () => aiReadableFiles(message.attachments, excluded),
    [message.attachments, excluded],
  );
  const block = messageAiBlock({ isPro: isProOrAbove, offline });

  const reasonLabel = useCallback((reason: NotReadReason): string => {
    switch (reason) {
      case 'count': return copy.ai.notReadCount(ASK_MAX_FILES);
      case 'size': return copy.ai.notReadSize(mbOf(ASK_MESSAGE_FILE_MAX_BYTES));
      case 'total': return copy.ai.notReadTotal(mbOf(ASK_TOTAL_MAX_BYTES));
      case 'pages': return copy.ai.notReadPages(ASK_PDF_MAX_PAGES);
      case 'unreadable': return copy.ai.notReadUnreadable;
      case 'missing':
      default: return copy.ai.notReadMissing;
    }
  }, [copy]);

  const readFiles = useCallback(async () => {
    // a. The plan, then the connection: nothing is sent, and the reason shows.
    if (messageAiBlock({ isPro: isProOrAbove, offline })) return;
    const sent = aiReadableFiles(message.attachments, excluded).read;
    if (sent.length === 0) return;
    if (running.current) return;
    running.current = true;
    setFailure(null);
    setListNote(null);
    setPhase('reading');
    // b. Ids only. The flag, this phone's consent gate and the request live in askFiles.
    const files = sent.map((a) => ({ source: 'message' as const, messageId: message.id, attachmentId: a.id }));
    let out: AskFilesOutcome;
    try {
      out = await askFiles({ feature: 'portal', files });
      // c. The server wants the ACCOUNT's yes. A yes given on this phone a moment
      //    ago may still be on its way: wait for the sync, then one more try.
      if (!out.ok && out.code === 'account_ai_off') {
        await settleAiConsentSync();
        out = await askFiles({ feature: 'portal', files });
      }
    } catch {
      // askFiles does not throw. If it ever did, the sheet must not stay stuck on "Reading".
      out = { ok: false, code: 'internal', message: '' };
    } finally {
      running.current = false;
    }
    if (!alive.current) return;
    const names = sent.map((a) => a.name);
    if (out.ok) {
      if (out.data.mode !== 'message') {
        setFailure({ sentence: askCopy.files.errGeneric, retry: true, plans: false });
        setPhase('failure');
        return;
      }
      // d. Every model text is gated before it is drawn.
      setReading(guardMessageReading(out.data));
      setPhase('result');
      return;
    }
    // e. Refusals and failures.
    if (out.code === AI_CONSENT_DECLINED_CODE) {
      setFailure({ sentence: out.message || askCopy.files.errGeneric, retry: false, plans: false });
      setPhase('failure');
      return;
    }
    if (out.code === 'account_ai_off') {
      setFailure({ sentence: copy.ai.accountOff, retry: true, plans: false });
      setPhase('failure');
      return;
    }
    if (out.code === 'ai_check_unavailable') {
      setFailure({ sentence: copy.ai.accountUnknown, retry: true, plans: false });
      setPhase('failure');
      return;
    }
    if (out.code === 'before_notice') {
      setFailure({ sentence: copy.ai.beforeNotice, retry: false, plans: false });
      setPhase('failure');
      return;
    }
    const reason = refusalToNotRead(out.code);
    const refused = typeof out.fileIndex === 'number' ? sent[out.fileIndex] : undefined;
    if (reason && refused) {
      // That file moves to "Not read"; "Read files" then reads the rest.
      setExcluded((prev) => new Map(prev).set(refused.id, reason));
      setListNote(askFilesSentence(out, askCopy.files, names));
      setPhase('list');
      return;
    }
    setFailure({
      sentence: askFilesSentence(out, askCopy.files, names),
      retry: true,
      // The monthly allowance on Pro has a higher plan above it; a plan refusal always does.
      plans: (out.code === 'monthly_cap_reached' && tier === 'pro') || out.code === 'tier_required',
    });
    setPhase('failure');
  }, [isProOrAbove, offline, message.attachments, message.id, excluded, askCopy, copy, tier]);

  const retry = useCallback(() => {
    setFailure(null);
    setPhase('list');
    void readFiles();
  }, [readFiles]);

  const seePlans = useCallback(() => {
    router.push('/paywall');
    onClose();
  }, [router, onClose]);

  // The draft's text: the description, then the files it came from. The Files
  // line names what the SERVER read, and says how many files were left out.
  // That count is handed over on its own, so a long text never cuts it off.
  const draftBody = useMemo(() => {
    if (!reading?.draft) return '';
    const left = Math.max(notRead.length, message.attachments.length - reading.read.length);
    const filesLine = copy.coPrefillFiles(reading.read.map((r) => r.name).join(', '));
    return draftText(reading.draft.description, filesLine, left > 0 ? copy.ai.moreNotRead(left) : '');
  }, [reading, notRead.length, message.attachments.length, copy]);

  // He picks the record type. Nothing is saved until he saves in that form.
  const startCo = useCallback(() => {
    if (!reading?.draft) return;
    router.push(coDraftRoute(project.id, draftBody));
    onClose();
  }, [reading, router, project.id, draftBody, onClose]);
  const startRfi = useCallback(() => {
    if (!reading?.draft) return;
    const id = stashDraftHandoff({ title: reading.draft.title, description: draftBody });
    router.push(rfiDraftRoute(project.id, id));
    onClose();
  }, [reading, router, project.id, draftBody, onClose]);
  const startPunch = useCallback(() => {
    if (!reading?.draft || !canPunch) return;
    const id = stashDraftHandoff({ title: reading.draft.title, description: draftBody });
    router.push(punchDraftRoute(project.id, id));
    onClose();
  }, [reading, canPunch, router, project.id, draftBody, onClose]);

  const notReadList = notRead.length > 0 ? (
    <View style={styles.group} testID="message-ai-not-read">
      <Text style={styles.heading}>{copy.ai.notRead}</Text>
      {notRead.map(({ att, reason }) => (
        <View key={att.id} style={styles.fileRow} testID={`message-ai-not-read-${att.id}`}>
          <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">{att.name}</Text>
          <Text style={styles.fileWhy}>{reasonLabel(reason)}</Text>
        </View>
      ))}
    </View>
  ) : null;

  const startBlocked = block === 'plan'
    ? copy.ai.planLocked
    : block === 'offline'
      ? askCopy.files.errOffline
      : read.length === 0 ? copy.ai.noneReadable : undefined;

  const closeAction = { label: copy.close, onPress: onClose, testID: 'message-ai-close' };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={copy.ai.sheetTitle}
      // The read is counted: while it runs the sheet stays, so he sees what it bought.
      dismissible={phase !== 'reading'}
      primaryAction={phase === 'list'
        ? { label: copy.ai.start, onPress: () => { void readFiles(); }, disabled: !!startBlocked, disabledReason: startBlocked, testID: 'message-ai-start' }
        : phase === 'failure' && failure?.retry
          ? { label: copy.retry, onPress: retry, testID: 'message-ai-retry' }
          : undefined}
      secondaryAction={phase === 'result' || phase === 'failure' ? closeAction : undefined}
      testID="message-ai-sheet"
    >
      {phase === 'list' ? (
        <View style={styles.body}>
          {listNote ? <Text style={styles.failure} testID="message-ai-list-note">{listNote}</Text> : null}
          {read.length > 0 ? (
            <View style={styles.group} testID="message-ai-will-read">
              <Text style={styles.heading}>{copy.ai.willRead}</Text>
              {read.map((att) => (
                <View key={att.id} style={styles.fileRow} testID={`message-ai-will-read-${att.id}`}>
                  <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">{att.name}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {notReadList}
          <Text style={styles.note}>{copy.ai.goesTo}</Text>
          <Text style={styles.note}>{copy.ai.counts}</Text>
          {block === 'plan' ? (
            <Button label={copy.ai.seePlans} onPress={seePlans} variant="secondary" fullWidth testID="message-ai-see-plans" />
          ) : null}
        </View>
      ) : null}

      {phase === 'reading' ? (
        <View style={styles.readingRow} testID="message-ai-reading">
          <Spinner label={copy.ai.reading} />
          <Text style={styles.readingText}>{copy.ai.reading}</Text>
        </View>
      ) : null}

      {phase === 'result' && reading ? (
        <View style={styles.body}>
          <View style={styles.group}>
            <Text style={styles.heading}>{copy.ai.summary}</Text>
            {reading.summary ? <Text style={styles.text} selectable testID="message-ai-summary">{reading.summary}</Text> : null}
            {reading.withheld ? <Text style={styles.note}>{askCopy.files.codeWithheld}</Text> : null}
            {reading.truncated ? <Text style={styles.note}>{askCopy.files.truncated}</Text> : null}
          </View>

          <View style={styles.group}>
            <Text style={styles.heading}>{copy.ai.asks}</Text>
            {reading.asks.length > 0
              ? reading.asks.map((line, i) => (
                <Text key={`${i}-${line}`} style={styles.text} selectable testID={`message-ai-ask-${i}`}>{line}</Text>
              ))
              : <Text style={styles.note}>{copy.ai.asksNone}</Text>}
          </View>

          <WhatIRead files={toTurnFiles(reading.read)} partial={reading.truncated} copy={askCopy.files} />
          {notReadList}

          <View style={styles.group}>
            <Text style={styles.heading}>{copy.ai.draft}</Text>
            {reading.draft ? (
              <View style={styles.draftBox} testID="message-ai-draft">
                {reading.draft.title ? <Text style={styles.draftHead} selectable>{reading.draft.title}</Text> : null}
                <Text style={styles.text} selectable>{reading.draft.description}</Text>
              </View>
            ) : null}
            <Text style={styles.note}>{reading.draft ? copy.ai.draftNote : copy.ai.draftNone}</Text>
          </View>

          <View style={styles.actions}>
            <Button label={copy.ai.startCo} onPress={startCo} variant="secondary" disabled={!reading.draft} fullWidth testID="message-ai-co" />
            <Button label={copy.ai.startRfi} onPress={startRfi} variant="secondary" disabled={!reading.draft} fullWidth testID="message-ai-rfi" />
            <Button label={copy.ai.startPunch} onPress={startPunch} variant="secondary" disabled={!reading.draft || !canPunch} fullWidth testID="message-ai-punch" />
            {!canPunch ? <Text style={styles.note}>{copy.ai.punchLocked}</Text> : null}
          </View>

          <Text style={styles.note}>{copy.ai.notSaved}</Text>
          <Text style={styles.note}>{copy.ai.notPosted}</Text>
        </View>
      ) : null}

      {phase === 'failure' && failure ? (
        <View style={styles.body}>
          <Text style={styles.failure} accessibilityLiveRegion="polite" testID="message-ai-failure">{failure.sentence}</Text>
          {failure.plans ? (
            <Button label={copy.ai.seePlans} onPress={seePlans} variant="secondary" fullWidth testID="message-ai-see-plans" />
          ) : null}
        </View>
      ) : null}
    </Sheet>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  body: { gap: 14 },
  group: { gap: 4 },
  heading: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.textMuted },
  text: { fontSize: Type.subhead.fontSize, lineHeight: Type.subhead.lineHeight, color: t.text },
  note: { fontSize: Type.footnote.fontSize, lineHeight: Type.footnote.lineHeight, color: t.textSecondary },
  failure: { fontSize: Type.subhead.fontSize, lineHeight: Type.subhead.lineHeight, color: t.text, fontWeight: '600' },
  fileRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 2 },
  fileName: { flexShrink: 1, fontSize: Type.bodyCompact.fontSize, color: t.text },
  fileWhy: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  readingText: { fontSize: Type.subhead.fontSize, color: t.text },
  draftBox: { ...cardSurface(t, { radius: 'md', pad: 12 }), gap: 4 },
  draftHead: { fontSize: Type.subhead.fontSize, lineHeight: Type.subhead.lineHeight, fontWeight: '600', color: t.text },
  actions: { gap: 8 },
});
