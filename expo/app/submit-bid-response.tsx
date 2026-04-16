import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Send, DollarSign, Clock, FileText, Calendar } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { POSTING_LIMITS, getCategoryLabel, getCategoryIcon } from '@/constants/projectCategories';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { supabase } from '@/lib/supabase';
import { generateUUID } from '@/utils/generateId';

export default function SubmitBidResponseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ bidId: string }>();
  const { user } = useAuth();
  const { tier } = useSubscription();
  const userId = user?.id ?? null;

  const [bidAmount, setBidAmount] = useState('');
  const [duration, setDuration] = useState('');
  const [scope, setScope] = useState('');
  const [availability, setAvailability] = useState('');

  const { data: requestData } = useQuery({
    queryKey: ['bid_detail', params.bidId],
    queryFn: async () => {
      const { data } = await supabase
        .from('public_bids')
        .select('*')
        .eq('id', params.bidId)
        .single();
      return data as Record<string, unknown> | null;
    },
    enabled: !!params.bidId,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Please sign in to submit a bid');
      if (!bidAmount) throw new Error('Please enter your bid amount');
      if (!duration) throw new Error('Please enter estimated duration');
      if (scope.length < 100) throw new Error('Scope description must be at least 100 characters');

      const limits = POSTING_LIMITS[tier as keyof typeof POSTING_LIMITS] ?? POSTING_LIMITS.free;
      const { count } = await supabase
        .from('bid_responses')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

      if ((count ?? 0) >= limits.responses) {
        throw new Error(`You've used ${count} of ${limits.responses} bid responses this month. Upgrade for more.`);
      }

      const responseId = generateUUID();
      const { error } = await supabase.from('bid_responses').insert({
        id: responseId,
        user_id: userId,
        bid_id: params.bidId,
        company_name: user?.name ?? 'Contractor',
        bid_amount: parseFloat(bidAmount.replace(/[^0-9.]/g, '')) || 0,
        duration_estimate: duration,
        scope_description: scope,
        availability_date: availability || null,
        status: 'submitted',
      });

      if (error) {
        console.log('[BidResponse] Insert error:', error);
        throw new Error(error.message);
      }
      return responseId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplace_bids'] });
      queryClient.invalidateQueries({ queryKey: ['bid_responses'] });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Bid Submitted!',
        'The homeowner will be notified of your bid. They can view your profile and message you directly.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    },
  });

  const meta = (requestData?.metadata ?? {}) as Record<string, unknown>;
  const budgetMin = meta.budget_min as number | undefined;
  const budgetMax = meta.budget_max as number | undefined;
  const categoryId = requestData?.category as string | undefined;
  const projectTitle = requestData?.title as string | undefined;

  const scopeCount = scope.length;
  const isValid = bidAmount && duration && scope.length >= 100;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Submit Your Bid</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {requestData && (
            <View style={styles.projectSummary}>
              <Text style={styles.projectIcon}>{getCategoryIcon(categoryId ?? '')}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.projectTitle}>{projectTitle ?? getCategoryLabel(categoryId ?? 'other')}</Text>
                <Text style={styles.projectLocation}>
                  {requestData.city as string}{requestData.state ? `, ${requestData.state as string}` : ''}
                </Text>
                {budgetMin != null && budgetMax != null && budgetMax > 0 && (
                  <Text style={styles.projectBudget}>
                    Budget: ${budgetMin?.toLocaleString()} - ${budgetMax?.toLocaleString()}
                  </Text>
                )}
              </View>
            </View>
          )}

          <Text style={styles.sectionLabel}>Your Bid Amount *</Text>
          <View style={styles.inputRow}>
            <DollarSign size={18} color={Colors.primary} />
            <TextInput
              style={styles.amountInput}
              value={bidAmount}
              onChangeText={setBidAmount}
              placeholder="22,500"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
            />
          </View>

          <Text style={styles.sectionLabel}>Estimated Duration *</Text>
          <View style={styles.inputRow}>
            <Clock size={18} color={Colors.textSecondary} />
            <TextInput
              style={styles.amountInput}
              value={duration}
              onChangeText={setDuration}
              placeholder="e.g. 3-4 weeks"
              placeholderTextColor={Colors.textMuted}
            />
          </View>

          <Text style={styles.sectionLabel}>What's Included * (min 100 chars)</Text>
          <TextInput
            style={styles.textArea}
            value={scope}
            onChangeText={setScope}
            placeholder="Describe exactly what's included in your bid: materials, labor, permits, cleanup, etc. Be specific — homeowners compare scope across bids."
            placeholderTextColor={Colors.textMuted}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            maxLength={2000}
          />
          <Text style={[styles.charCount, scopeCount < 100 && styles.charCountWarn]}>
            {scopeCount}/100 min {scopeCount >= 100 ? '✓' : `(${100 - scopeCount} more)`}
          </Text>

          <Text style={styles.sectionLabel}>Your Availability</Text>
          <View style={styles.inputRow}>
            <Calendar size={18} color={Colors.textSecondary} />
            <TextInput
              style={styles.amountInput}
              value={availability}
              onChangeText={setAvailability}
              placeholder="e.g. Can start May 1, 2026"
              placeholderTextColor={Colors.textMuted}
            />
          </View>

          <View style={styles.infoBox}>
            <FileText size={16} color={Colors.info} />
            <Text style={styles.infoText}>
              Your company profile will be shared with the homeowner. Make sure it's up to date with your licenses, reviews, and portfolio.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, (!isValid || submitMutation.isPending) && styles.submitButtonDisabled]}
            onPress={() => submitMutation.mutate()}
            disabled={!isValid || submitMutation.isPending}
            activeOpacity={0.8}
          >
            {submitMutation.isPending ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Send size={18} color="#FFF" />
                <Text style={styles.submitButtonText}>Submit Bid — Free</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: insets.bottom + 20 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  headerTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  scroll: { flex: 1 },
  scrollContent: { padding: 20 },
  projectSummary: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.homeownerLight, borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: Colors.homeowner + '30' },
  projectIcon: { fontSize: 28 },
  projectTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  projectLocation: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  projectBudget: { fontSize: 13, color: Colors.homeowner, fontWeight: '600' as const, marginTop: 4 },
  sectionLabel: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, marginBottom: 8, marginTop: 16 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: Colors.borderLight },
  amountInput: { flex: 1, fontSize: 16, color: Colors.text, paddingVertical: 14, fontWeight: '600' as const },
  textArea: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, fontSize: 14, color: Colors.text, borderWidth: 1, borderColor: Colors.borderLight, minHeight: 140, textAlignVertical: 'top' as const },
  charCount: { fontSize: 12, color: Colors.textMuted, marginTop: 4, textAlign: 'right' as const },
  charCountWarn: { color: Colors.warning },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.infoLight, borderRadius: 10, padding: 12, marginTop: 20 },
  infoText: { flex: 1, fontSize: 13, color: Colors.info, lineHeight: 18 },
  submitButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16, marginTop: 24 },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { fontSize: 16, fontWeight: '700' as const, color: '#FFF' },
});

