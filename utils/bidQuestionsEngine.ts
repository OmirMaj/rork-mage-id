// bidQuestionsEngine — Supabase helpers for the pre-bid Q&A surface on
// homeowner RFPs. Visible by default to every authenticated user so
// every prospective bidder gets the same info; private follow-ups
// (is_public=false) are still allowed but rare.

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { notifyEvent } from './notifyClient';

export interface BidQuestion {
  id: string;
  bidId: string;
  askerUserId: string;
  askerName: string | null;
  question: string;
  answer: string | null;
  answeredAt: string | null;
  isPublic: boolean;
  createdAt: string;
}

interface BidQuestionRow {
  id: string;
  bid_id: string;
  asker_user_id: string;
  asker_name: string | null;
  question: string;
  answer: string | null;
  answered_at: string | null;
  is_public: boolean;
  created_at: string;
}

function rowToQuestion(r: BidQuestionRow): BidQuestion {
  return {
    id: r.id,
    bidId: r.bid_id,
    askerUserId: r.asker_user_id,
    askerName: r.asker_name,
    question: r.question,
    answer: r.answer,
    answeredAt: r.answered_at,
    isPublic: r.is_public,
    createdAt: r.created_at,
  };
}

export async function fetchBidQuestions(bidId: string): Promise<BidQuestion[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('bid_questions')
    .select('*')
    .eq('bid_id', bidId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[bidQuestionsEngine] fetch error:', error.message);
    return [];
  }
  return (data ?? []).map(r => rowToQuestion(r as BidQuestionRow));
}

export async function askBidQuestion(bidId: string, question: string, askerName?: string): Promise<BidQuestion | null> {
  if (!isSupabaseConfigured) return null;
  const session = await supabase.auth.getSession();
  const userId = session.data.session?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('bid_questions')
    .insert({
      bid_id: bidId,
      asker_user_id: userId,
      asker_name: askerName ?? null,
      question: question.trim(),
      is_public: true,
    })
    .select('*')
    .maybeSingle();
  if (error || !data) {
    console.warn('[bidQuestionsEngine] ask error:', error?.message);
    return null;
  }
  // Resolve the RFP poster + title so the notify edge function can
  // route the email to the right person. We read minimum metadata —
  // the function looks up profile contact info itself.
  const { data: bidRow } = await supabase
    .from('bids')
    .select('user_id, title')
    .eq('id', bidId)
    .maybeSingle();
  void notifyEvent('bid_question_asked', {
    rfp_id: bidId,
    bid_id: bidId,
    rfp_title: (bidRow as any)?.title ?? null,
    asker_name: askerName ?? null,
    question: question.trim(),
    // The poster is the GC for routing purposes — notify uses
    // gc_user_id to look up profile email + push token.
    gc_user_id: (bidRow as any)?.user_id ?? null,
  });
  return rowToQuestion(data as BidQuestionRow);
}

export async function answerBidQuestion(id: string, answer: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  // Read the question + bid title so we can notify every bidder.
  const { data: qRow } = await supabase
    .from('bid_questions')
    .select('id, bid_id, question')
    .eq('id', id)
    .maybeSingle();
  const { error } = await supabase
    .from('bid_questions')
    .update({ answer: answer.trim(), answered_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.warn('[bidQuestionsEngine] answer error:', error.message);
    return false;
  }
  // Resolve every bidder on this RFP and ping them. We pre-resolve here
  // because the edge function would otherwise need a service role to
  // read profile rows by user id — easier to push the recipient list
  // along with the event so notify can fan out emails directly.
  if (qRow?.bid_id) {
    try {
      const { data: bidRow } = await supabase
        .from('bids')
        .select('id, title, user_id')
        .eq('id', qRow.bid_id)
        .maybeSingle();
      const { data: responses } = await supabase
        .from('bid_responses')
        .select('contractor_user_id')
        .eq('bid_id', qRow.bid_id);
      const ids = Array.from(new Set((responses ?? []).map((r: any) => r.contractor_user_id).filter(Boolean)));
      let recipients: Array<{ user_id: string; email: string | null; push_token: string | null }> = [];
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, email, push_token')
          .in('id', ids);
        recipients = (profiles ?? []).map((p: any) => ({
          user_id: p.id,
          email: p.email ?? null,
          push_token: p.push_token ?? null,
        }));
      }
      void notifyEvent('bid_question_answered', {
        rfp_id: qRow.bid_id,
        bid_id: qRow.bid_id,
        rfp_title: (bidRow as any)?.title ?? null,
        gc_user_id: (bidRow as any)?.user_id ?? null,
        question: qRow.question,
        answer: answer.trim(),
        bidder_recipients: recipients,
      });
    } catch (e) {
      console.warn('[bidQuestionsEngine] notify fan-out failed', e);
    }
  }
  return true;
}
