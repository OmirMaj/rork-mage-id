// Sticky bottom action for portal-aware item detail screens. Renders
// the correct primary action based on portalState + unsent-edits
// state. Calls into ProjectContext for the actual send/recall mutations.

import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Send, RotateCcw, Eye } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { useProjects } from '@/contexts/ProjectContext';
import type { PortalState, SendableItemKind } from '@/types';

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
  const { sendToClientPortal, recallFromClientPortal } = useProjects() as unknown as PortalActions & ReturnType<typeof useProjects>;
  const [busy, setBusy] = useState(false);

  const status = portalState?.status ?? 'sent';
  const unsentEdits = status === 'sent' && portalState?.sentAt && itemUpdatedAt &&
    new Date(itemUpdatedAt).getTime() > new Date(portalState.sentAt).getTime();

  const doSend = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try { await sendToClientPortal({ kind, itemId, projectId }); }
    catch (e) { Alert.alert('Send failed', e instanceof Error ? e.message : 'Try again.'); }
    finally { setBusy(false); }
  }, [busy, kind, itemId, projectId, sendToClientPortal]);

  const doRecall = useCallback(() => {
    Alert.alert(
      'Recall from client?',
      'The client will see a message saying this item was removed. You can re-send later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Recall', style: 'destructive', onPress: async () => {
          setBusy(true);
          try { await recallFromClientPortal({ kind, itemId, projectId }); }
          catch (e) { Alert.alert('Recall failed', e instanceof Error ? e.message : 'Try again.'); }
          finally { setBusy(false); }
        }},
      ],
    );
  }, [kind, itemId, projectId, recallFromClientPortal]);

  if (status === 'draft' || status === 'recalled') {
    return (
      <View style={styles.bar}>
        <TouchableOpacity
          style={[styles.primary, (busy || !canSend) && { opacity: 0.5 }]}
          onPress={doSend}
          disabled={busy || !canSend}
          testID={`send-to-client-${kind}-${itemId}`}
        >
          <Send size={16} color="#FFFFFF" />
          <Text style={styles.primaryText}>{busy ? 'Sending…' : status === 'recalled' ? 'Re-send to Client' : 'Send to Client'}</Text>
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
          style={[styles.primary, busy && { opacity: 0.5 }]}
          onPress={doSend}
          disabled={busy}
          testID={`resend-to-client-${kind}-${itemId}`}
        >
          <Send size={16} color="#FFFFFF" />
          <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Re-send updated'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={doRecall} disabled={busy}>
          <RotateCcw size={14} color={colors.textMuted} />
          <Text style={styles.secondaryText}>Recall</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.bar}>
      <View style={styles.statusInline}>
        {portalState?.viewedAt ? <Eye size={14} color={colors.textMuted} /> : null}
        <Text style={styles.statusInlineText}>{portalState?.viewedAt ? 'Client viewed this' : 'Shared with client'}</Text>
      </View>
      <TouchableOpacity style={styles.secondary} onPress={doRecall} disabled={busy}>
        <RotateCcw size={14} color={colors.textMuted} />
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
    backgroundColor: t.accent,
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
