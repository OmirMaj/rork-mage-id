// components/SendPortalLinkModal.tsx — Phase 27 audit followup.
//
// User asked: "in those settings, it should have a send an email or text
// the link to client area then a pop up shows up where you can add each."
//
// Previously the Share button on the client/sub portal setup pages did one
// of two things:
//   - Native: opened the system share sheet (works fine)
//   - Web:    showed an Alert with the message text (useless — couldn't
//             actually send anything)
//
// This modal replaces the web Share path and supplements native Share. The
// user picks Email or Text, types one or more recipients (one per line,
// commas also accepted), and we dispatch:
//
//   Email: through utils/emailService.ts → Resend via the send-email edge
//          function. Each recipient gets the same branded portal-invite
//          email body.
//   Text:  on native, opens the device SMS composer pre-filled with the
//          message + first recipient. On web (no SMS API), we copy the
//          message + recipient list to clipboard so the user can paste
//          into whatever messaging app they want.
//
// Self-contained: caller hands us subject + message + the link, we handle
// the recipient flow + dispatch + error toast.

import { useState, useEffect, useMemo } from 'react';
import { View, Text, Modal, Pressable, TextInput, Platform, Linking, StyleSheet, ActivityIndicator, KeyboardAvoidingView, ScrollView, Keyboard } from 'react-native';
import { Mail, MessageSquare } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { copyToClipboard } from '@/utils/clipboard';
import { sendEmail } from '@/utils/emailService';

export interface SendPortalLinkModalProps {
  visible: boolean;
  onClose: () => void;
  /** Branded subject line for email. */
  subject: string;
  /** Plain-text body. We'll also fall back to this for SMS. */
  message: string;
  /** Optional rich HTML body for email. If omitted, we wrap `message`. */
  emailHtml?: string;
  /** Where the recipient ends up — kept here so we can append it for SMS. */
  link: string;
}

type Mode = 'email' | 'text';

export function SendPortalLinkModal({
  visible,
  onClose,
  subject,
  message,
  emailHtml,
  link,
}: SendPortalLinkModalProps) {
  const [mode, setMode] = useState<Mode>('email');
  const [recipientsText, setRecipientsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setMode('email');
      setRecipientsText('');
      setBusy(false);
      setError(null);
      setSuccess(null);
    }
  }, [visible]);

  const recipients = useMemo(() => {
    return recipientsText
      .split(/[\n,;\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }, [recipientsText]);

  const validateRecipient = (r: string): boolean => {
    if (mode === 'email') {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r);
    }
    // Phone: 7+ digits after stripping non-numerics.
    return r.replace(/\D/g, '').length >= 7;
  };

  const submit = async () => {
    setError(null);
    setSuccess(null);
    if (recipients.length === 0) {
      setError(mode === 'email' ? 'Add at least one email address' : 'Add at least one phone number');
      return;
    }
    const bad = recipients.find(r => !validateRecipient(r));
    if (bad) {
      setError(`"${bad}" doesn't look like a valid ${mode === 'email' ? 'email' : 'phone number'}`);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'email') {
        const htmlBody = emailHtml ?? wrapPlainAsHtml(message, link);
        let failed = 0;
        for (const to of recipients) {
          const result = await sendEmail({ to, subject, html: htmlBody });
          if (!result.success) failed++;
        }
        if (failed > 0) {
          setError(`${failed} of ${recipients.length} email${recipients.length === 1 ? '' : 's'} failed to send`);
        } else {
          setSuccess(`Sent to ${recipients.length} ${recipients.length === 1 ? 'recipient' : 'recipients'}`);
          setTimeout(onClose, 1200);
        }
      } else {
        // Text path — open the device SMS composer pre-filled with the
        // message. iOS supports comma-separated recipients in the URL;
        // Android picks up the first.
        const smsBody = encodeURIComponent(message);
        if (Platform.OS === 'web') {
          // Web has no SMS API. Copy the message to clipboard and tell the
          // user to paste it into whichever app they prefer.
          const text = `${message}\n\nSend to: ${recipients.join(', ')}`;
          const ok = await copyToClipboard(text);
          setSuccess(ok
            ? 'Copied message + recipients to clipboard — paste into your messaging app.'
            : 'Couldn’t access clipboard. Long-press the message above to copy manually.');
          setTimeout(onClose, 2000);
        } else {
          const phones = recipients.join(Platform.OS === 'ios' ? ',' : ';');
          const url = `sms:${phones}${Platform.OS === 'ios' ? '&' : '?'}body=${smsBody}`;
          const can = await Linking.canOpenURL(url);
          if (!can) {
            setError('Couldn’t open the SMS composer on this device.');
          } else {
            await Linking.openURL(url);
            setSuccess('SMS composer opened.');
            setTimeout(onClose, 800);
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* KeyboardAvoidingView lifts the modal above the soft keyboard so the
          Send button stays tappable. ScrollView lets the user manually push
          the sheet up if the keyboard still overlaps (or to access the Done
          button quickly). */}
      <KeyboardAvoidingView
        style={styles.kavRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              bounces={false}
            >
              <Text style={styles.title}>Send the portal link</Text>
              <Text style={styles.sub}>Add one or more recipients, separated by commas or new lines.</Text>

              <View style={styles.modeRow}>
                <Pressable
                  onPress={() => { setMode('email'); setError(null); }}
                  style={[styles.modeBtn, mode === 'email' && styles.modeBtnActive]}
                >
                  <Mail size={14} color={mode === 'email' ? '#0B0D10' : Colors.text} />
                  <Text style={[styles.modeBtnText, mode === 'email' && styles.modeBtnTextActive]}>Email</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setMode('text'); setError(null); }}
                  style={[styles.modeBtn, mode === 'text' && styles.modeBtnActive]}
                >
                  <MessageSquare size={14} color={mode === 'text' ? '#0B0D10' : Colors.text} />
                  <Text style={[styles.modeBtnText, mode === 'text' && styles.modeBtnTextActive]}>Text</Text>
                </Pressable>
              </View>

              <View style={styles.labelRow}>
                <Text style={styles.label}>{mode === 'email' ? 'Email addresses' : 'Phone numbers'}</Text>
                <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} style={styles.doneInline}>
                  <Text style={styles.doneInlineText}>Done</Text>
                </Pressable>
              </View>
              <TextInput
                value={recipientsText}
                onChangeText={(t) => { setRecipientsText(t); if (error) setError(null); }}
                placeholder={mode === 'email'
                  ? 'client@example.com\nspouse@example.com'
                  : '(555) 123-4567\n(555) 987-6543'}
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
                multiline
                autoCapitalize="none"
                keyboardType={mode === 'email' ? 'email-address' : 'phone-pad'}
                testID="send-portal-recipients"
              />

              <Text style={styles.previewLabel}>Message preview</Text>
              <View style={styles.preview}>
                <Text style={styles.previewText} numberOfLines={6}>{message}</Text>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}
              {success ? <Text style={styles.success}>{success}</Text> : null}

              <View style={styles.actions}>
                <Pressable onPress={onClose} style={styles.cancelBtn} disabled={busy}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={submit} style={styles.sendBtn} disabled={busy}>
                  {busy
                    ? <ActivityIndicator size="small" color="#0B0D10" />
                    : <Text style={styles.sendText}>
                        Send{recipients.length > 0 ? ` (${recipients.length})` : ''}
                      </Text>}
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Minimal HTML wrapper for the plain-text body. The portal-invite email
// template (see contexts/AuthContext.tsx welcome flow) uses richer markup,
// but the Share modal supports arbitrary callers so we keep this generic.
function wrapPlainAsHtml(message: string, link: string): string {
  const safeMessage = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;line-height:1.5;color:#0B0D10;max-width:560px;margin:0 auto;padding:24px;">
  <pre style="white-space:pre-wrap;font-family:inherit;font-size:15px;margin:0 0 20px;">${safeMessage}</pre>
  <p style="margin:24px 0;">
    <a href="${link}" style="display:inline-block;background:#FF6A1A;color:#0B0D10;font-weight:700;padding:12px 20px;border-radius:8px;text-decoration:none;">Open the portal</a>
  </p>
  <p style="font-size:12px;color:#6b6b6b;margin-top:32px;">
    Sent via MAGE ID
  </p>
</body></html>`;
}

const styles = StyleSheet.create({
  kavRoot: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '90%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
  },
  scrollContent: {
    padding: 22,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  doneInline: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: Colors.surfaceAlt,
    marginBottom: 4,
  },
  doneInlineText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.tradeColors.general,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  sub: { fontSize: 12, color: Colors.textSecondary, marginTop: 4, marginBottom: 16 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  modeBtnActive: { backgroundColor: Colors.tradeColors.general, borderColor: Colors.tradeColors.general },
  modeBtnText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  modeBtnTextActive: { color: '#0B0D10' },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 14,
    minHeight: 78,
    textAlignVertical: 'top',
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 4,
  },
  preview: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  previewText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  error: { color: Colors.pillLate, fontSize: 12, marginTop: 10 },
  success: { color: Colors.pillOnTrack, fontSize: 12, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14, justifyContent: 'flex-end' },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.surfaceAlt,
  },
  cancelText: { color: Colors.text, fontWeight: '600', fontSize: 13 },
  sendBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.tradeColors.general,
    minWidth: 110,
    alignItems: 'center',
  },
  sendText: { color: '#0B0D10', fontWeight: '700', fontSize: 13 },
});
