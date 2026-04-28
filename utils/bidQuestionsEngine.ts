// bidQuestionsEngine — Supabase helpers for the pre-bid Q&A surface on
// homeowner RFPs. Visible by default to every authenticated user so
// every prospective bidder gets the same info; private follow-ups
// (is_public=false) are still allowed but rare.

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

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
  return rowToQuestion(data as BidQuestionRow);
}

export async function answerBidQuestion(id: string, answer: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { error } = await supabase
    .from('bid_questions')
    .update({ answer: answer.trim(), answered_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.warn('[bidQuestionsEngine] answer error:', error.message);
    return false;
  }
  return true;
}
