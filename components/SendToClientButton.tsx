// Sticky bottom action for portal-aware item detail screens. Renders
// the correct primary action based on portalState + unsent-edits
// state. Calls into ProjectContext for the actual send/recall mutations.
//
// Wave 3 (rfi-core):
//   #36 The label names the destination for EVERY caller — "Send to client
//       portal" — so it can't be mistaken for an email send (a change order's
//       own email action is "Email PDF").
//   #58 The portal snapshots the STORED row, so a caller with unsaved edits
//       passes canSend=false with its reason — and that now holds on the
//       "Re-send" bar too, which used to ignore canSend. There is deliberately
//       no "save first" hook: a save and a send in one tap run inside one
//       render's closures, so sendToClientPortal would snapshot the record
//       from BEFORE the save (review round 2). Save, then send.
//
// Integration critic money-portal (round 1): an accepted editor may send and
// recall, but only the OWNER's device publishes the portal. A recall is live
// on the client's next page load anyway (the server's portal_overlay_live
// drops anything whose row is no longer shared). A SEND is not — the overlay
// can only take away — so an editor is told it reaches the client when the
// GC's app next publishes this job, instead of assuming it is already there.

import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Send, RotateCcw, Eye } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { useProjects } from '@/contexts/ProjectContext';
import type { PortalState, SendableItemKind } from '@/types';
import { showAlert } from '@/utils/alert';
import { useAuth } from '@/contexts/AuthContext';
import { isPortalOwner } from '@/utils/portalLiteSync';

/** What an editor (not the owner) is told after a send — exported so the
 *  validator pins the words. #17 (wave 4): the owner's app now republishes
 *  when a server read brings in another member's shared record, so "the next
 *  time your GC's app is open" is when it lands — not only when he edits
 *  this job. Shown only to an editor, whose send really does share it. */
export const EDITOR_SEND_NOTE =
  'Your GC\u2019s app adds it to the client\u2019s page the next time your GC\u2019s app is open, so the client may not see it yet. A recall takes effect right away.';

interface Props {
  kind: SendableItemKind;
  itemId: string;
  projectId: string;
  portalState?: PortalState;
  itemUpdatedAt?: string;
  /** Optional client-side validation — disables Send when false. */
  canSend?: boolean;
  /** Optional tooltip shown when canSend=false. */
  canSendReason?: string;
}

type PortalActions = {
  sendToClientPortal: (a: { kind: SendableItemKind; itemId: string; projectId: string }) => Promise<void>;
  recallFromClientPortal: (a: { kind: SendableItemKind; itemId: string; projectId: string }) => Promise<void>;
};

export function SendToClientButton({ kind, itemId, projectId, portalState, itemUpdatedAt, canSend = true, canSendReason }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Temporary cast until T5 wires the actions onto the context type.
  const { sendToClientPortal, recallFromClientPortal, projects } = useProjects() as unknown as PortalActions & ReturnType<typeof useProjects>;
  const { user } = useAuth();
  const project = projects.find(p => p.id === projectId);
  // Unknown project → treat as the owner (no extra note): the send itself
  // refuses a project it cannot find.
  const isOwner = !project || isPortalOwner(project, user?.id);
  const [busy, setBusy] = useState(false);

  const status = portalState?.status ?? 'sent';
  const unsentEdits = status === 'sent' && portalState?.sentAt && itemUpdatedAt &&
    new Date(itemUpdatedAt).getTime() > new Date(portalState.sentAt).getTime();

  const doSend = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await sendToClientPortal({ kind, itemId, projectId });
      if (!isOwner) showAlert('Sent to the client portal', EDITOR_SEND_NOTE);
    }
    catch (e) { showAlert('Send failed', e instanceof Error ? e.message : 'Try again.'); }
    finally { setBusy(false); }
  }, [busy, kind, itemId, projectId, sendToClientPortal, isOwner]);

  const doRecall = useCallback(() => {
    showAlert(
      'Recall from client?',
      // Only the owner's recall posts the "removed" notice (RLS admits no one
      // else to portal_messages) — an editor is not promised one.
      isOwner
        ? 'The client will see a message saying this item was removed. You can re-send later.'
        : 'It comes off the client\u2019s portal right away. Only your GC can post a note to the client about it. You can re-send later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Recall', style: 'destructive', onPress: async () => {
          setBusy(true);
          try { await recallFromClientPortal({ kind, itemId, projectId }); }
          catch (e) { showAlert('Recall failed', e instanceof Error ? e.message : 'Try again.'); }
          finally { setBusy(false); }
        }},
      ],
    );
  }, [kind, itemId, projectId, recallFromClientPortal, isOwner]);

  if (status === 'draft' || status === 'recalled') {
    return (
      <View style={styles.bar}>
        <TouchableOpacity
          style={[styles.primary, (busy || !canSend) && { opacity: 0.5 }]}
          onPress={doSend}
          disabled={busy || !canSend}
          testID={`send-to-client-${kind}-${itemId}`}
        >
          <Send size={16} color="#FFFFFF" strokeWidth={1.75} />
          <Text style={styles.primaryText}>{busy ? 'Sending…' : status === 'recalled' ? 'Re-send to client portal' : 'Send to client portal'}</Text>
        </TouchableOpacity>
        {!canSend && canSendReason ? <Text style={styles.hint}>{canSendReason}</Text> : null}
      </View>
    );
  }

  // Sent
  if (unsentEdits) {
    return (
      <View style={styles.bar}>
        <TouchableOpacity
          style={[styles.primary, (busy || !canSend) && { opacity: 0.5 }]}
          onPress={doSend}
          disabled={busy || !canSend}
          testID={`resend-to-client-${kind}-${itemId}`}
        >
          <Send size={16} color="#FFFFFF" strokeWidth={1.75} />
          <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Re-send to client portal'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={doRecall} disabled={busy}>
          <RotateCcw size={14} color={colors.textMuted} strokeWidth={1.75} />
          <Text style={styles.secondaryText}>Recall</Text>
        </TouchableOpacity>
        {!canSend && canSendReason ? <Text style={styles.hint}>{canSendReason}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.bar}>
      <View style={styles.statusInline}>
        {portalState?.viewedAt ? <Eye size={14} color={colors.textMuted} strokeWidth={1.75} /> : null}
        <Text style={styles.statusInlineText}>{portalState?.viewedAt ? 'Client viewed this' : 'Shared with client'}</Text>
      </View>
      <TouchableOpacity style={styles.secondary} onPress={doRecall} disabled={busy}>
        <RotateCcw size={14} color={colors.textMuted} strokeWidth={1.75} />
        <Text style={styles.secondaryText}>Recall</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  bar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: t.surface,
    borderTopWidth: 1,
    borderTopColor: t.line,
  },
  primary: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 13,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accentFill,
  },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' as const },
  secondary: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: t.line,
  },
  secondaryText: { color: t.textMuted, fontSize: 13, fontWeight: '700' as const },
  statusInline: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  statusInlineText: { color: t.textMuted, fontSize: 13, fontWeight: '600' as const },
  hint: { fontSize: 11, color: t.textMuted, marginTop: 4 },
});
