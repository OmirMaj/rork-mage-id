// rfp-detail — shared read-only view of a homeowner-posted RFP. Used by:
//   - Contractors browsing nearby RFPs (shows a "Submit estimate" CTA)
//   - The homeowner reviewing what they posted (shows an "Edit" CTA + a
//     link straight to the responses dashboard)
//
// We deliberately don't expose the homeowner's exact street address until
// they accept a contractor — only city/state. Drawings + photos are
// attached publicly so contractors can size up the work.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, Linking, Alert, TextInput, Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, MapPin, Calendar, FileText, ShieldCheck, AlertTriangle,
  Send, Pencil, ChevronRight, Clock, Trophy, Image as ImageIcon,
  HelpCircle, MessageSquare, CheckCircle2,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { formatMoney } from '@/utils/formatters';
import { fetchBidQuestions, askBidQuestion, answerBidQuestion, type BidQuestion } from '@/utils/bidQuestionsEngine';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface RfpRow {
  id: string;
  user_id: string | null;
  title: string;
  city: string;
  state: string;
  status: string;
  category: string;
  posted_date: string;
  deadline: string;
  scope_description: string | null;
  budget_min: number | null;
  budget_max: number | null;
  desired_start: string | null;
  photo_urls: string[] | null;
  drawing_urls: string[] | null;
  address_verified: boolean;
  verified_only: boolean | null;
  awarded_response_id: string | null;
  awarded_at: string | null;
}

export default function RfpDetailScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { bidId } = useLocalSearchParams<{ bidId: string }>();

  const { data: rfp, isLoading } = useQuery({
    queryKey: ['rfp-detail', bidId],
    enabled: !!bidId && isSupabaseConfigured,
    queryFn: async (): Promise<RfpRow | null> => {
      const { data, error } = await supabase
        .from('public_bids')
        .select('id,user_id,title,city,state,status,category,posted_date,deadline,scope_description,photo_urls,drawing_urls,budget_min,budget_max,desired_start,address_verified,verified_only,awarded_response_id,awarded_at')
        .eq('id', bidId)
        .eq('is_homeowner_rfp', true)
        .single();
      if (error) {
        console.warn('[rfp-detail] fetch error', error);
        return null;
      }
      return {
        ...data,
        photo_urls: data.photo_urls as string[] | null,
        drawing_urls: data.drawing_urls as string[] | null,
      };
    },
  });

  // Has the contractor already responded? Used to swap the CTA.
  const { data: existingResponse } = useQuery({
    queryKey: ['rfp-my-response', bidId, user?.id],
    enabled: !!bidId && !!user?.id && isSupabaseConfigured,
    queryFn: async () => {
      if (!user?.id) return null;
      // Column is bid_amount on the table (estimate_amount doesn't exist —
      // selecting it errored and silently suppressed the "you already bid"
      // card). Verified against the live schema, May 2026.
      const { data } = await supabase
        .from('bid_responses')
        .select('id,status,bid_amount')
        .eq('bid_id', bidId)
        .eq('user_id', user.id)
        .maybeSingle();
      return data;
    },
  });

  const isOwner = useMemo(() => !!rfp && !!user?.id && rfp.user_id === user.id, [rfp, user]);
  const isAwarded = !!rfp?.awarded_response_id;
  const isOpen = rfp?.status === 'open' && !isAwarded;

  // Pre-bid Q&A — public by default so every prospective bidder gets the
  // same info. The homeowner answers; contractors ask.
  const queryClient = useQueryClient();
  const { data: questions } = useQuery({
    queryKey: ['rfp-questions', bidId],
    enabled: !!bidId && isSupabaseConfigured,
    queryFn: () => fetchBidQuestions(bidId!),
    refetchInterval: 30_000,
  });
  const [newQuestion, setNewQuestion] = useState('');
  const [submittingQ, setSubmittingQ] = useState(false);
  const handleAsk = useCallback(async () => {
    if (!bidId || !newQuestion.trim() || newQuestion.trim().length < 8) {
      Alert.alert('Question too short', 'Add a few more words so the homeowner has something to answer.');
      return;
    }
    setSubmittingQ(true);
    try {
      const q = await askBidQuestion(bidId, newQuestion, user?.name);
      if (q) {
        setNewQuestion('');
        void queryClient.invalidateQueries({ queryKey: ['rfp-questions', bidId] });
      } else {
        Alert.alert('Could not post', 'Try again in a moment.');
      }
    } finally {
      setSubmittingQ(false);
    }
  }, [bidId, newQuestion, user, queryClient]);
  const handleAnswer = useCallback(async (q: BidQuestion) => {
    const persist = async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      try {
        const ok = await answerBidQuestion(q.id, text);
        if (ok) void queryClient.invalidateQueries({ queryKey: ['rfp-questions', bidId] });
        else Alert.alert('Could not post', 'Try again in a moment.');
      } catch (e) {
        Alert.alert('Could not post', e instanceof Error ? e.message : 'Try again.');
      }
    };
    if (Platform.OS === 'web' || !(Alert as any).prompt) {
      // Alert.prompt is iOS-only; provide a window.prompt fallback so
      // homeowners on Android / web can still answer questions.
      const text = window.prompt(`Reply to: "${q.question}"`, q.answer ?? '');
      if (text == null) return;
      void persist(text);
      return;
    }
    (Alert as any).prompt(
      'Answer',
      `Reply to: "${q.question}"`,
      (text: string) => { if (text != null) void persist(text); },
      'plain-text',
      q.answer ?? '',
    );
  }, [bidId, queryClient]);

  const handleSubmit = useCallback(() => {
    if (!bidId) return;
    router.push({ pathname: '/submit-bid-response' as never, params: { bidId } as never });
  }, [bidId, router]);

  const handleReview = useCallback(() => {
    if (!bidId) return;
    router.push({ pathname: '/rfp-responses-review' as never, params: { bidId } as never });
  }, [bidId, router]);

  const openAttachment = useCallback((url: string) => {
    Linking.openURL(url).catch(() => Alert.alert('Could not open', 'The attachment link is broken.'));
  }, []);

  if (isLoading || !rfp) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="small" color={themeColors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Homeowner RFP</Text>
          <Text style={styles.title} numberOfLines={2}>{rfp.title}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero photo gallery */}
        {rfp.photo_urls && rfp.photo_urls.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gallery}>
            {rfp.photo_urls.map(url => (
              <TouchableOpacity key={url} onPress={() => openAttachment(url)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Add image">
                <Image source={{ uri: url }} style={styles.galleryImage} resizeMode="cover" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Status + meta */}
        <View style={styles.metaRow}>
          <View style={styles.metaPills}>
            {isAwarded && (
              <View style={[styles.pill, { backgroundColor: themeColors.success + '20' }]}>
                <Trophy size={10} color={themeColors.success} strokeWidth={1.75} />
                <Text style={[styles.pillText, { color: themeColors.success }]}>AWARDED</Text>
              </View>
            )}
            {isOpen && (
              <View style={[styles.pill, { backgroundColor: themeColors.accent + '20' }]}>
                <Clock size={10} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={[styles.pillText, { color: themeColors.accent }]}>OPEN FOR BIDS</Text>
              </View>
            )}
            {rfp.verified_only && (
              <View style={[styles.pill, { backgroundColor: themeColors.accent + '18' }]}>
                <ShieldCheck size={10} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={[styles.pillText, { color: themeColors.accent }]}>VERIFIED PROS ONLY</Text>
              </View>
            )}
            {rfp.address_verified && (
              <View style={[styles.pill, { backgroundColor: themeColors.success + '15' }]}>
                <ShieldCheck size={10} color={themeColors.success} strokeWidth={1.75} />
                <Text style={[styles.pillText, { color: themeColors.success }]}>ADDRESS VERIFIED</Text>
              </View>
            )}
            {!rfp.address_verified && (
              <View style={[styles.pill, { backgroundColor: Colors.warning + '15' }]}>
                <AlertTriangle size={10} color={Colors.warning} strokeWidth={1.75} />
                <Text style={[styles.pillText, { color: Colors.warning }]}>UNVERIFIED ADDRESS</Text>
              </View>
            )}
          </View>
        </View>

        {/* Location + budget */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <MapPin size={14} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.cardRowText}>
              {[rfp.city, rfp.state].filter(Boolean).join(', ') || 'Location pending'}
              {' '}<Text style={styles.cardRowMuted}>(exact address shared after homeowner accepts a site visit)</Text>
            </Text>
          </View>
          {(rfp.budget_min || rfp.budget_max) && (
            <View style={styles.cardRow}>
              <FileText size={14} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.cardRowText}>
                Budget {rfp.budget_min ? formatMoney(rfp.budget_min) : '—'} to {rfp.budget_max ? formatMoney(rfp.budget_max) : '—'}
              </Text>
            </View>
          )}
          {rfp.desired_start && (
            <View style={styles.cardRow}>
              <Calendar size={14} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.cardRowText}>Desired start: {rfp.desired_start}</Text>
            </View>
          )}
          <View style={styles.cardRow}>
            <Calendar size={14} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.cardRowText}>
              Bids due {new Date(rfp.deadline).toLocaleDateString()}
            </Text>
          </View>
        </View>

        {/* Scope */}
        {rfp.scope_description && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Scope of work</Text>
            <Text style={styles.scope}>{rfp.scope_description}</Text>
          </View>
        )}

        {/* Drawings */}
        {rfp.drawing_urls && rfp.drawing_urls.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Drawings & documents</Text>
            <View style={styles.drawingList}>
              {rfp.drawing_urls.map(url => {
                const name = url.split('/').pop()?.replace(/^\d+_/, '') ?? 'attachment';
                return (
                  <TouchableOpacity key={url} style={styles.drawingItem} onPress={() => openAttachment(url)}>
                    <FileText size={16} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.drawingName} numberOfLines={1}>{decodeURIComponent(name)}</Text>
                    <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Pre-bid Q&A */}
        <View style={styles.qaCard}>
          <View style={styles.qaHead}>
            <HelpCircle size={14} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.qaTitle}>Questions & answers</Text>
            {(questions?.length ?? 0) > 0 && (
              <View style={styles.qaCount}>
                <Text style={styles.qaCountText}>{questions!.length}</Text>
              </View>
            )}
          </View>
          <Text style={styles.qaHelper}>
            {isOwner
              ? 'Contractors ask here before submitting bids. Answer once and every prospective bidder sees it — saves you a dozen DMs.'
              : 'Ask the homeowner anything you need to know before bidding. Answers are public so every bidder works from the same info.'}
          </Text>

          {/* Question composer (contractors only, on open RFPs) */}
          {!isOwner && isOpen && (
            <View style={styles.qaCompose}>
              <TextInput
                style={[styles.qaInput, submittingQ && { opacity: 0.5 }]}
                value={newQuestion}
                onChangeText={setNewQuestion}
                placeholder="What's the existing electrical panel size? Any HOA constraints?"
                placeholderTextColor={themeColors.textMuted}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                editable={!submittingQ}
              />
              <TouchableOpacity
                style={[styles.qaAskBtn, (!newQuestion.trim() || submittingQ) && { opacity: 0.5 }]}
                onPress={handleAsk}
                disabled={!newQuestion.trim() || submittingQ}
              >
                {submittingQ ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <MessageSquare size={13} color="#FFF" strokeWidth={1.75} />
                    <Text style={styles.qaAskBtnText}>Ask</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Question list */}
          {(questions ?? []).length === 0 ? (
            <Text style={styles.qaEmpty}>
              No questions yet. {!isOwner && isOpen ? 'Be the first to ask.' : ''}
            </Text>
          ) : (
            <View style={styles.qaList}>
              {questions!.map(q => (
                <View key={q.id} style={styles.qaRow}>
                  <View style={styles.qaQuestion}>
                    <Text style={styles.qaAuthor}>{q.askerName ?? 'A bidder'}</Text>
                    <Text style={styles.qaText}>{q.question}</Text>
                  </View>
                  {q.answer ? (
                    <View style={styles.qaAnswer}>
                      <CheckCircle2 size={11} color={themeColors.success} strokeWidth={1.75} />
                      <Text style={styles.qaAnswerText}>{q.answer}</Text>
                    </View>
                  ) : isOwner ? (
                    <TouchableOpacity style={styles.qaAnswerCta} onPress={() => handleAnswer(q)}>
                      <Text style={styles.qaAnswerCtaText}>Answer →</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.qaPending}>Awaiting homeowner answer</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* CTA */}
        {!isOwner && isOpen && !existingResponse && (
          <TouchableOpacity style={styles.primaryCta} onPress={handleSubmit} activeOpacity={0.85}>
            <Send size={16} color="#FFF" strokeWidth={1.75} />
            <Text style={styles.primaryCtaText}>Submit your estimate</Text>
          </TouchableOpacity>
        )}

        {!isOwner && !isOpen && (
          <View style={styles.dimmedCta}>
            <Text style={styles.dimmedCtaText}>
              {isAwarded ? 'This project has been awarded.' : 'This project is no longer accepting bids.'}
            </Text>
          </View>
        )}

        {!isOwner && existingResponse && (
          <View style={styles.responseCard}>
            <View style={styles.responseHead}>
              <ImageIcon size={14} color={themeColors.success} strokeWidth={1.75} />
              <Text style={styles.responseTitle}>You submitted an estimate</Text>
            </View>
            <Text style={styles.responseDetail}>
              {existingResponse.bid_amount ? formatMoney(existingResponse.bid_amount) : 'Pending review'}
              {' · '}
              <Text style={styles.responseStatus}>{existingResponse.status?.toUpperCase()}</Text>
            </Text>
          </View>
        )}

        {isOwner && (
          <View style={styles.ownerActions}>
            <TouchableOpacity style={[styles.primaryCta, { flex: 1 }]} onPress={handleReview}>
              <FileText size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.primaryCtaText}>Review bids</Text>
            </TouchableOpacity>
            {/* Edit button removed pre-launch — the in-place edit flow isn't
                built yet, and a button that says "Editing coming soon" is
                worse UX than no button. Owners can post a new RFP if scope
                changed materially. Restore when edit is wired. */}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, marginTop: 4 },

  gallery: { marginBottom: 14, marginHorizontal: -2 },
  galleryImage: { width: 220, height: 160, borderRadius: Tokens.radius.card, marginRight: 8, backgroundColor: t.bg },

  metaRow: { marginBottom: 14 },
  metaPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full },
  pillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },

  card: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.line, marginBottom: 12, gap: 8,
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardRowText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },
  cardRowMuted: { color: t.textMuted, fontSize: Type.caption1.fontSize },
  cardLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  scope: { fontSize: Type.bodyCompact.fontSize, color: t.text, lineHeight: 21 },

  drawingList: { gap: 6 },
  drawingItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.bg, borderRadius: Tokens.radius.md,
    padding: 10, borderWidth: 1, borderColor: t.line,
  },
  drawingName: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' },

  primaryCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.card,
    backgroundColor: t.accent, marginTop: 10,
    shadowColor: t.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  primaryCtaText: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },

  secondaryCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 13, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line, marginTop: 10,
  },
  secondaryCtaText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  ownerActions: { flexDirection: 'row', gap: 10 },

  dimmedCta: {
    paddingVertical: 16, borderRadius: Tokens.radius.card, marginTop: 10,
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.line,
    alignItems: 'center',
  },
  dimmedCtaText: { fontSize: Type.footnote.fontSize, color: t.textMuted, fontStyle: 'italic' },

  responseCard: {
    backgroundColor: t.success + '0D', borderRadius: Tokens.radius.card, padding: 14,
    borderWidth: 1, borderColor: t.success + '30', marginTop: 10, gap: 6,
  },
  responseHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  responseTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: t.text },
  responseDetail: { fontSize: Type.footnote.fontSize, color: t.text },
  responseStatus: { fontWeight: '700', color: t.success },

  // ─── Q&A ───
  qaCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.line,
    marginTop: 4, marginBottom: 10, gap: 10,
  },
  qaHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qaTitle: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  qaCount: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: Tokens.radius.full, backgroundColor: t.accent + '15' },
  qaCountText: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.accent, letterSpacing: 0.4 },
  qaHelper: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },

  qaCompose: { gap: 6 },
  qaInput: {
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: Type.footnote.fontSize, color: t.text, minHeight: 70,
  },
  qaAskBtn: {
    alignSelf: 'flex-end',
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent,
  },
  qaAskBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: '#FFF' },

  qaEmpty: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontStyle: 'italic', paddingVertical: 8 },
  qaList: { gap: 10 },
  qaRow: {
    backgroundColor: t.bg, borderRadius: Tokens.radius.md, padding: 11,
    borderWidth: 1, borderColor: t.line, gap: 8,
  },
  qaQuestion: { gap: 3 },
  qaAuthor: { fontSize: 10, fontWeight: '800', color: t.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' },
  qaText: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 18 },
  qaAnswer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: t.line,
  },
  qaAnswerText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600', lineHeight: 18 },
  qaAnswerCta: { paddingTop: 6, alignSelf: 'flex-start' },
  qaAnswerCtaText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.accent },
  qaPending: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontStyle: 'italic', paddingTop: 4 },
});
