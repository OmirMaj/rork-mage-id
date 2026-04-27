// submit-bid-response — contractor side of the homeowner RFP flow.
// Inserts a row into bid_responses tied to the RFP, optionally with a
// "request to view site first" flag (which suppresses estimate fields
// since they can't price it sight-unseen).

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Send, DollarSign, MessageSquare, Eye, Sparkles,
  AlertTriangle, FileText,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useCompanies } from '@/contexts/CompaniesContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

interface RfpRow {
  id: string;
  title: string;
  user_id: string;
  status: string;
  is_homeowner_rfp: boolean;
}

export default function SubmitBidResponseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { companies } = useCompanies();
  const { bidId } = useLocalSearchParams<{ bidId: string }>();

  // Only one company per user for now — first one wins (most apps have a single org).
  const company = useMemo(() => companies[0], [companies]);

  const [estimateAmount, setEstimateAmount]   = useState('');
  const [estimateSummary, setEstimateSummary] = useState('');
  const [message, setMessage]                 = useState('');
  const [viewSiteFirst, setViewSiteFirst]     = useState(false);
  const [submitting, setSubmitting]           = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  const { data: rfp, isLoading } = useQuery({
    queryKey: ['rfp-summary', bidId],
    enabled: !!bidId && isSupabaseConfigured,
    queryFn: async (): Promise<RfpRow | null> => {
      const { data, error: e } = await supabase
        .from('public_bids')
        .select('id,title,user_id,status,is_homeowner_rfp')
        .eq('id', bidId).single();
      if (e) return null;
      return data;
    },
  });

  const validate = useCallback((): string | null => {
    if (!viewSiteFirst) {
      if (!estimateAmount || Number(estimateAmount) <= 0) return 'Enter a non-zero estimate amount.';
      if (!estimateSummary.trim()) return 'Add a one-line summary of what your estimate covers.';
    }
    if (!message.trim() || message.trim().length < 20) return 'Add a brief message — what makes you a good fit, when you can start, etc.';
    return null;
  }, [viewSiteFirst, estimateAmount, estimateSummary, message]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const v = validate();
    if (v) { setError(v); return; }
    if (!user || !bidId || !rfp) return;

    if (rfp.user_id === user.id) {
      setError('You can\'t submit a bid on your own RFP.');
      return;
    }
    if (rfp.status !== 'open' || !rfp.is_homeowner_rfp) {
      setError('This project isn\'t accepting bids.');
      return;
    }

    setSubmitting(true);
    try {
      const proposerName = company?.companyName ?? user.name ?? user.email ?? 'Anonymous contractor';
      const proposerEmail = company?.contactEmail ?? user.email ?? null;
      const proposerPhone = company?.phone ?? null;

      const { error: insertErr } = await supabase.from('bid_responses').insert({
        bid_id: bidId,
        user_id: user.id,
        proposer_company_id: company?.id ?? null,
        company_name: proposerName,            // legacy column name on existing table
        proposer_email: proposerEmail,
        proposer_phone: proposerPhone,
        bid_amount: viewSiteFirst ? null : Number(estimateAmount),
        estimate_summary: viewSiteFirst ? 'Site visit requested before final estimate.' : estimateSummary.trim(),
        scope_description: message.trim(),
        view_site_requested: viewSiteFirst,
        status: 'submitted',
      });
      if (insertErr) throw insertErr;

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Bid submitted',
        viewSiteFirst
          ? 'The homeowner will see your site-visit request and reach out if they want to schedule.'
          : 'The homeowner will review your estimate. You\'ll be notified if they shortlist or award you.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e) {
      console.warn('[submit-bid-response] failed', e);
      setError(String((e as Error).message ?? e));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  }, [validate, user, bidId, rfp, company, viewSiteFirst, estimateAmount, estimateSummary, message, router]);

  if (isLoading || !rfp) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Submit your bid</Text>
          <Text style={styles.title} numberOfLines={2}>{rfp.title}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Site visit toggle */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Need to walk the site first?</Text>
          <Text style={styles.helper}>
            Toggle on if you can&apos;t price the work without seeing it. The homeowner will see this
            request and decide whether to invite you over before deciding.
          </Text>
          <TouchableOpacity
            style={[styles.toggleRow, viewSiteFirst && styles.toggleRowActive]}
            onPress={() => setViewSiteFirst(v => !v)}
            activeOpacity={0.85}
          >
            <Eye size={16} color={viewSiteFirst ? Colors.primary : Colors.textMuted} />
            <Text style={[styles.toggleText, viewSiteFirst && styles.toggleTextActive]}>
              {viewSiteFirst ? 'Requesting a site visit before quoting' : 'Request site visit before quoting'}
            </Text>
            <View style={[styles.toggleDot, viewSiteFirst && styles.toggleDotActive]} />
          </TouchableOpacity>
        </View>

        {!viewSiteFirst && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Estimate amount *</Text>
            <View style={styles.amountField}>
              <DollarSign size={16} color={Colors.textMuted} />
              <TextInput
                style={styles.amountInput}
                value={estimateAmount}
                onChangeText={setEstimateAmount}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
              />
            </View>

            <Text style={[styles.cardLabel, { marginTop: 14 }]}>One-line summary *</Text>
            <Text style={styles.helper}>What does this estimate cover? E.g. &quot;Cabinets + counters + install, materials sourced.&quot;</Text>
            <TextInput
              style={styles.input}
              value={estimateSummary}
              onChangeText={setEstimateSummary}
              placeholder="Materials + labor + permits, 6-week timeline"
              placeholderTextColor={Colors.textMuted}
              maxLength={140}
            />
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Message to the homeowner *</Text>
          <Text style={styles.helper}>
            Why are you a fit, what&apos;s included, when can you start, references? This is your pitch.
          </Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={message}
            onChangeText={setMessage}
            placeholder="Hey — I'm a residential GC in your area with 12 years on remodels. I'd handle..."
            placeholderTextColor={Colors.textMuted}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{message.length} chars</Text>
        </View>

        {/* Identity preview */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Submitting as</Text>
          <View style={styles.identityRow}>
            <FileText size={14} color={Colors.primary} />
            <Text style={styles.identityText}>
              {company?.companyName ?? user?.name ?? user?.email ?? 'Anonymous'}
              {company?.city && company?.state ? ` · ${company.city}, ${company.state}` : ''}
            </Text>
          </View>
          {!company && (
            <Text style={styles.identityHelper}>
              Tip: add a company profile in Settings → Companies so the homeowner sees a verified pitch.
            </Text>
          )}
        </View>

        {error && (
          <View style={styles.errorCard}>
            <AlertTriangle size={16} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              {viewSiteFirst ? <MessageSquare size={16} color="#FFF" /> : <Send size={16} color="#FFF" />}
              <Text style={styles.submitBtnText}>
                {viewSiteFirst ? 'Send site-visit request' : 'Send bid'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Submitting binds you to honor the estimate if the homeowner accepts. You can withdraw any
          time before they award the project.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  eyebrow: { fontSize: 11, fontWeight: '700', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: 20, fontWeight: '800', color: Colors.text, letterSpacing: -0.4, marginTop: 4 },

  card: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 12,
  },
  cardLabel: { fontSize: 12, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  helper: { fontSize: 12, color: Colors.textMuted, marginBottom: 10, lineHeight: 17 },
  charCount: { fontSize: 11, color: Colors.textMuted, alignSelf: 'flex-end', marginTop: 4 },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.background, borderRadius: 10,
    padding: 14, borderWidth: 1.5, borderColor: Colors.border,
  },
  toggleRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  toggleText: { flex: 1, fontSize: 13, color: Colors.text, fontWeight: '600' },
  toggleTextActive: { color: Colors.primary },
  toggleDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: Colors.background, borderWidth: 1.5, borderColor: Colors.border },
  toggleDotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },

  amountField: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.background, borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  amountInput: { flex: 1, fontSize: 22, fontWeight: '800', color: Colors.text },

  input: {
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: Colors.text,
  },
  inputMultiline: { minHeight: 120, paddingTop: 11 },

  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  identityText: { flex: 1, fontSize: 13, color: Colors.text, fontWeight: '600' },
  identityHelper: { fontSize: 11, color: Colors.textMuted, marginTop: 8, fontStyle: 'italic', lineHeight: 16 },

  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: 12,
    backgroundColor: Colors.error + '0D',
    borderWidth: 1, borderColor: Colors.error + '30',
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 13, color: Colors.error, lineHeight: 18 },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12,
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { fontSize: 15, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },

  disclaimer: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 14, fontStyle: 'italic', paddingHorizontal: 16, lineHeight: 16 },
});
