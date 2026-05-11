// webhooks-settings.tsx — manage outbound webhook endpoints.
//
// Where the user pastes a Zapier/Make/n8n hook URL and turns on the
// events they want piped out. Each endpoint shows a signing secret
// (revealed once — copy to receiver's signature-verification config),
// firing stats (last_fired_at, fire_count, fail_count), and enable
// toggle.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Switch, Alert, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { Webhook, Plus, Copy, Trash2, Check, X, Zap, Send } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  listEndpoints, createEndpoint, toggleEndpoint, deleteEndpoint, dispatchWebhook,
  type WebhookEndpoint,
} from '@/utils/webhooks';

export default function WebhooksSettingsScreen() {
  const insets = useSafeAreaInsets();
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const list = await listEndpoints();
    setEndpoints(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(async () => {
    const url = newUrl.trim();
    const label = newLabel.trim() || 'Webhook';
    if (!url.startsWith('https://')) {
      Alert.alert('URL must start with https://', 'Webhook receivers must use HTTPS.');
      return;
    }
    setCreating(true);
    const ep = await createEndpoint({ url, label });
    setCreating(false);
    if (ep) {
      setNewUrl(''); setNewLabel(''); setNewOpen(false);
      await refresh();
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Webhook created', `Signing secret:\n${ep.signing_secret}\n\nCopy this into your receiver's signature-verification config. You won't see it again.`, [
        {
          text: 'Copy secret',
          onPress: () => Clipboard.setStringAsync(ep.signing_secret),
        },
        { text: 'OK' },
      ]);
    } else {
      Alert.alert('Failed to create', 'Check your network and try again.');
    }
  }, [newUrl, newLabel, refresh]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    const ok = await toggleEndpoint(id, enabled);
    if (ok) await refresh();
  }, [refresh]);

  const handleDelete = useCallback((ep: WebhookEndpoint) => {
    Alert.alert('Delete webhook?', `${ep.label} (${ep.url}) will stop receiving events.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const ok = await deleteEndpoint(ep.id);
          if (ok) await refresh();
        },
      },
    ]);
  }, [refresh]);

  const handleTest = useCallback(async (ep: WebhookEndpoint) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const result = await dispatchWebhook('test', { endpoint_id: ep.id, label: ep.label });
    if (result && result.dispatched > 0) {
      Alert.alert('Test fired', `Sent to ${result.dispatched} endpoint${result.dispatched === 1 ? '' : 's'}. Check your receiver for the payload.`);
    } else {
      Alert.alert('Test failed', 'Dispatch returned no successful deliveries. Check the URL and try again.');
    }
    await refresh();
  }, [refresh]);

  const handleCopySecret = useCallback(async (secret: string) => {
    await Clipboard.setStringAsync(secret);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Webhooks' }} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 60 }}>
        <Text style={styles.eyebrow}>INTEGRATIONS · OUTBOUND</Text>
        <Text style={styles.heading}>
          Webhooks <Text style={styles.headingItalic}>everywhere.</Text>
        </Text>
        <Text style={styles.sub}>
          Pipe events out to Zapier, Make, n8n, or any URL. One URL unlocks 6,000+ integrations.
        </Text>

        <View style={styles.infoBox}>
          <Zap size={14} color={Colors.accent} />
          <Text style={styles.infoText}>
            Events: invoice_paid, rfi_answered, project_created, subscription_purchased,
            change_order_approved, dfr_submitted, bid_received, bid_submitted, permit_qa_used.
            All POSTed with HMAC-SHA256 signature in `X-MAGE-Signature` header.
          </Text>
        </View>

        {!newOpen && (
          <TouchableOpacity onPress={() => setNewOpen(true)} style={styles.addBtn} testID="webhooks-add">
            <Plus size={14} color={Colors.cream} />
            <Text style={styles.addBtnText}>Add webhook</Text>
          </TouchableOpacity>
        )}

        {newOpen && (
          <View style={styles.form}>
            <Text style={styles.formLabel}>Label</Text>
            <TextInput
              style={styles.input}
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="Zapier — invoice tracker"
              placeholderTextColor={Colors.textMuted}
            />
            <Text style={styles.formLabel}>URL</Text>
            <TextInput
              style={styles.input}
              value={newUrl}
              onChangeText={setNewUrl}
              placeholder="https://hooks.zapier.com/hooks/catch/..."
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.formActions}>
              <TouchableOpacity onPress={() => setNewOpen(false)} style={styles.cancelBtn}>
                <X size={14} color={Colors.textSecondary} />
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreate} style={styles.saveBtn} disabled={creating}>
                {creating
                  ? <ActivityIndicator size="small" color={Colors.cream} />
                  : <Check size={14} color={Colors.cream} />}
                <Text style={styles.saveText}>{creating ? 'Creating…' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {loading && <ActivityIndicator size="small" color={Colors.accent} style={{ marginTop: 32 }} />}

        {!loading && endpoints.length === 0 && !newOpen && (
          <View style={styles.empty}>
            <Webhook size={36} color={Colors.accent} />
            <Text style={styles.emptyTitle}>No webhooks yet</Text>
            <Text style={styles.emptyBody}>
              Paste a Zapier or Make hook URL above. Every key event in MAGE ID will fire to it instantly.
            </Text>
          </View>
        )}

        {endpoints.map(ep => (
          <View key={ep.id} style={styles.endpoint}>
            <View style={styles.endpointHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.endpointLabel}>{ep.label}</Text>
                <Text style={styles.endpointUrl} numberOfLines={1}>{ep.url}</Text>
              </View>
              <Switch
                value={ep.enabled}
                onValueChange={(v) => handleToggle(ep.id, v)}
                trackColor={{ false: Colors.borderLight, true: Colors.accent + '60' }}
                thumbColor={ep.enabled ? Colors.accent : Colors.surface}
              />
            </View>

            <View style={styles.endpointStats}>
              <Text style={styles.endpointStat}>
                {ep.fire_count} fired · {ep.fail_count} failed
              </Text>
              {ep.last_fired_at && (
                <Text style={styles.endpointStat}>
                  Last: {new Date(ep.last_fired_at).toLocaleString()} {ep.last_status ? `(${ep.last_status})` : ''}
                </Text>
              )}
            </View>

            <View style={styles.endpointActions}>
              <TouchableOpacity onPress={() => handleCopySecret(ep.signing_secret)} style={styles.miniBtn}>
                <Copy size={12} color={Colors.text} />
                <Text style={styles.miniBtnText}>Copy secret</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleTest(ep)} style={styles.miniBtn}>
                <Send size={12} color={Colors.accent} />
                <Text style={[styles.miniBtnText, { color: Colors.accent }]}>Test</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(ep)} style={styles.miniBtn}>
                <Trash2 size={12} color={Colors.error} />
                <Text style={[styles.miniBtnText, { color: Colors.error }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  eyebrow: { ...Type.monoSm, color: Colors.accent, fontWeight: '600' as const, marginBottom: 8 },
  heading: { ...Type.display, color: Colors.ink, marginBottom: 4 },
  headingItalic: { ...Type.displayItalic, color: Colors.accent },
  sub: { fontSize: Type.subhead.fontSize, color: Colors.textSecondary, lineHeight: 21, marginBottom: 16 },
  infoBox: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8,
    padding: 12, marginBottom: 16,
    backgroundColor: Colors.accent + '10', borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: Colors.accent + '30',
  },
  infoText: { flex: 1, fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 18 },
  addBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, alignSelf: 'flex-start' as const, gap: 4,
    backgroundColor: Colors.accent, paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.full,
    marginBottom: 16,
  },
  addBtnText: { ...Type.bodyCompact, color: Colors.cream, fontWeight: '700' as const },
  form: {
    padding: 14, marginBottom: 16,
    backgroundColor: Colors.cream, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: Colors.bone,
  },
  formLabel: { ...Type.caption1, color: Colors.concrete, fontWeight: '700' as const, marginBottom: 6, marginTop: 4 },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
    borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: Type.body.fontSize, color: Colors.text, marginBottom: 8,
  },
  formActions: { flexDirection: 'row' as const, gap: 8, marginTop: 8 },
  cancelBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.fillTertiary,
  },
  cancelText: { ...Type.bodyCompact, color: Colors.textSecondary, fontWeight: '600' as const },
  saveBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 4,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.accent,
  },
  saveText: { ...Type.bodyCompact, color: Colors.cream, fontWeight: '700' as const },
  empty: { padding: 32, alignItems: 'center' as const, gap: 8, marginTop: 12 },
  emptyTitle: { ...Type.headline, color: Colors.text, marginTop: 8 },
  emptyBody: { ...Type.footnote, color: Colors.textSecondary, textAlign: 'center' as const, maxWidth: 280, lineHeight: 18 },
  endpoint: {
    backgroundColor: Colors.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: Colors.cardBorder, padding: 14, marginBottom: 10,
  },
  endpointHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  endpointLabel: { ...Type.bodyEmphasized, color: Colors.text },
  endpointUrl: { ...Type.caption1, color: Colors.textMuted, marginTop: 2 },
  endpointStats: { marginTop: 6, gap: 2 },
  endpointStat: { ...Type.caption1, color: Colors.textSecondary },
  endpointActions: { flexDirection: 'row' as const, gap: 6, marginTop: 10 },
  miniBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.fillTertiary,
  },
  miniBtnText: { ...Type.caption1, color: Colors.text, fontWeight: '600' as const },
});
