// connect-claude.tsx — manage the personal access tokens that let the user
// connect Claude (or any MCP client) to their MAGE ID data, READ-ONLY.
//
// Flow: create a token (raw value shown exactly once), copy the ready-made
// connector URL into Claude, and revoke any token instantly. All requests go
// through the `mcp-token` edge function with the user's session JWT; the `mcp`
// edge function is the actual MCP server Claude talks to.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform,
  ActivityIndicator, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  Plus, Copy, Trash2, ShieldCheck, KeyRound, Info, Check, AlertTriangle,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const MCP_URL = `${SUPABASE_FUNCTIONS_URL}/mcp`;

interface TokenRow {
  id: string;
  name: string | null;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export default function ConnectClaudeScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [creating, setCreating] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('mcp-token', { body: { action: 'list' } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setTokens(Array.isArray(data?.tokens) ? data.tokens : []);
    } catch (err) {
      console.error('[ConnectClaude] list failed', err);
      Alert.alert('Could not load tokens', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const copy = useCallback(async (value: string, key: string) => {
    await Clipboard.setStringAsync(value);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  }, []);

  const createToken = useCallback(async () => {
    try {
      setCreating(true);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const { data, error } = await supabase.functions.invoke('mcp-token', {
        body: { action: 'create', name: name.trim() || 'Claude' },
      });
      if (error) throw new Error(error.message);
      if (data?.error || !data?.token) throw new Error(data?.error || 'No token returned.');
      setFreshToken(data.token as string);
      setName('');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch (err) {
      console.error('[ConnectClaude] create failed', err);
      Alert.alert('Could not create token', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setCreating(false);
    }
  }, [name, load]);

  const revokeToken = useCallback((row: TokenRow) => {
    Alert.alert(
      'Revoke this token?',
      `Any Claude connection using "${row.name || row.token_prefix}" will stop working immediately. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data, error } = await supabase.functions.invoke('mcp-token', {
                body: { action: 'revoke', id: row.id },
              });
              if (error) throw new Error(error.message);
              if (data?.error) throw new Error(data.error);
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await load();
            } catch (err) {
              Alert.alert('Could not revoke', err instanceof Error ? err.message : 'Please try again.');
            }
          },
        },
      ],
    );
  }, [load]);

  const connectUrl = freshToken ? `${MCP_URL}?token=${freshToken}` : null;

  if (!user) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <KeyRound size={28} color={themeColors.textSecondary} strokeWidth={1.75} />
        <Text style={styles.emptyText}>Sign in to connect Claude to your data.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}><MageAIMark size={24} color={themeColors.accent} /></View>
          <Text style={styles.heroTitle}>Connect Claude</Text>
          <Text style={styles.heroSub}>
            Ask Claude (on claude.ai or Claude Desktop) about your business — &quot;what&apos;s overdue?&quot;,
            &quot;how much am I owed?&quot;, &quot;which RFIs are open?&quot; — answered from your live MAGE ID data.
          </Text>
          <View style={styles.roBadge}>
            <ShieldCheck size={13} color={themeColors.success} strokeWidth={1.75} />
            <Text style={styles.roBadgeText}>Read-only. Claude can view your data but never change it. Revoke any time.</Text>
          </View>
        </View>

        {/* Freshly minted token — shown exactly once. */}
        {freshToken && connectUrl && (
          <View style={styles.freshCard}>
            <View style={styles.freshHeader}>
              <AlertTriangle size={15} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.freshTitle}>Save this now — it won&apos;t be shown again</Text>
            </View>

            <Text style={styles.fieldLabel}>Connector URL (paste into Claude)</Text>
            <TouchableOpacity style={styles.codeRow} onPress={() => copy(connectUrl, 'url')} activeOpacity={0.7}>
              <Text style={styles.codeText} numberOfLines={2}>{connectUrl}</Text>
              {copied === 'url' ? <Check size={16} color={themeColors.success} strokeWidth={1.75} /> : <Copy size={16} color={themeColors.accent} strokeWidth={1.75} />}
            </TouchableOpacity>

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Token only (for header-based clients)</Text>
            <TouchableOpacity style={styles.codeRow} onPress={() => copy(freshToken, 'tok')} activeOpacity={0.7}>
              <Text style={styles.codeText} numberOfLines={1}>{freshToken}</Text>
              {copied === 'tok' ? <Check size={16} color={themeColors.success} strokeWidth={1.75} /> : <Copy size={16} color={themeColors.accent} strokeWidth={1.75} />}
            </TouchableOpacity>

            <TouchableOpacity style={styles.dismissBtn} onPress={() => setFreshToken(null)} activeOpacity={0.8}>
              <Text style={styles.dismissText}>I&apos;ve saved it — done</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Create a token */}
        <Text style={styles.sectionLabel}>CREATE A CONNECTION</Text>
        <View style={styles.createCard}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Label (e.g. Claude Desktop)"
            placeholderTextColor={themeColors.textMuted}
            maxLength={60}
          />
          <TouchableOpacity
            style={[styles.createBtn, creating && styles.createBtnDisabled]}
            onPress={createToken}
            disabled={creating}
            activeOpacity={0.85}
            testID="create-mcp-token"
          >
            {creating ? <ActivityIndicator color="#FFFFFF" /> : <><Plus size={16} color="#FFFFFF" strokeWidth={1.75} /><Text style={styles.createBtnText}>Create token</Text></>}
          </TouchableOpacity>
        </View>

        {/* Setup steps */}
        <Text style={styles.sectionLabel}>HOW TO CONNECT</Text>
        <View style={styles.stepsCard}>
          <Step n={1} text="Create a token above and copy the Connector URL it gives you." />
          <Step n={2} text="In Claude, open Settings → Connectors → Add custom connector (or your MCP client's config)." />
          <Step n={3} text="Paste the Connector URL as the MCP server URL and save." />
          <Step n={4} text='Ask away: "What is overdue right now?" or "How much money is unpaid across all jobs?"' last />
        </View>
        <View style={styles.hintCard}>
          <Info size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
          <Text style={styles.hintText}>
            Server URL: {MCP_URL}{'\n'}
            The token authenticates the connection — keep it private; it grants read access to your data.
          </Text>
        </View>

        {/* Existing tokens */}
        <Text style={styles.sectionLabel}>YOUR CONNECTIONS</Text>
        {loading ? (
          <ActivityIndicator color={themeColors.accent} style={{ marginVertical: 20 }} />
        ) : tokens.length === 0 ? (
          <Text style={styles.emptyText}>No connections yet. Create one above to connect Claude.</Text>
        ) : (
          <View style={styles.tokenList}>
            {tokens.map((t) => {
              const revoked = !!t.revoked_at;
              return (
                <View key={t.id} style={styles.tokenRow}>
                  <View style={[styles.tokenIcon, revoked && { opacity: 0.4 }]}>
                    <KeyRound size={16} color={themeColors.accent} strokeWidth={1.75} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.tokenName, revoked && styles.tokenRevoked]}>
                      {t.name || 'Claude'} {revoked ? '· revoked' : ''}
                    </Text>
                    <Text style={styles.tokenMeta}>
                      {t.token_prefix}…  ·  {t.last_used_at ? `last used ${t.last_used_at.slice(0, 10)}` : 'never used'}
                    </Text>
                  </View>
                  {!revoked && (
                    <TouchableOpacity onPress={() => revokeToken(t)} hitSlop={10} testID={`revoke-${t.id}`}>
                      <Trash2 size={18} color={themeColors.danger} strokeWidth={1.75} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Step({ n, text, last }: { n: number; text: string; last?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.step, last && { borderBottomWidth: 0 }]}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  scroll: { padding: 16 },

  hero: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel, padding: 20,
    borderWidth: 1, borderColor: t.line, marginBottom: 20, gap: 10,
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: Tokens.radius.card,
    backgroundColor: `${t.accent}15`, alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '700', color: t.text },
  heroSub: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, lineHeight: 20 },
  roBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: `${t.success}12`, padding: 10, borderRadius: Tokens.radius.md, marginTop: 4,
  },
  roBadgeText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 16 },

  freshCard: {
    backgroundColor: `${t.accent}0E`, borderWidth: 1, borderColor: `${t.accent}55`,
    borderRadius: Tokens.radius.card, padding: 16, marginBottom: 20, gap: 6,
  },
  freshHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  freshTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text },
  fieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.textSecondary },
  codeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4,
    backgroundColor: t.bg, borderRadius: Tokens.radius.sm, padding: 12,
    borderWidth: 1, borderColor: t.line,
  },
  codeText: {
    flex: 1, fontSize: Type.caption1.fontSize, color: t.text,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  dismissBtn: { marginTop: 12, alignItems: 'center', paddingVertical: 11, borderRadius: Tokens.radius.md, backgroundColor: t.accent },
  dismissText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.textOnAccent },

  sectionLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary,
    letterSpacing: 0.8, marginBottom: 8, marginTop: 4,
  },
  createCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line,
    padding: 12, gap: 10, marginBottom: 20,
  },
  input: {
    backgroundColor: t.bg, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accent, paddingVertical: 13, borderRadius: Tokens.radius.card,
  },
  createBtnDisabled: { opacity: 0.6 },
  createBtnText: { color: Colors.textOnAccent, fontWeight: '700', fontSize: Type.subhead.fontSize },

  stepsCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line,
    overflow: 'hidden', marginBottom: 10,
  },
  step: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  stepNum: {
    width: 22, height: 22, borderRadius: Tokens.radius.full, backgroundColor: `${t.accent}18`,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  stepNumText: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: t.accent },
  stepText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },

  hintCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: `${t.accent}08`, padding: 12, borderRadius: Tokens.radius.md, marginBottom: 20,
  },
  hintText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  tokenList: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, overflow: 'hidden',
  },
  tokenRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  tokenIcon: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm, backgroundColor: `${t.accent}12`,
    alignItems: 'center', justifyContent: 'center',
  },
  tokenName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },
  tokenRevoked: { color: t.textMuted, textDecorationLine: 'line-through' },
  tokenMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2 },

  emptyText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center', paddingVertical: 16, paddingHorizontal: 20, lineHeight: 19 },
});
