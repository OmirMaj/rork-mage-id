import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import type { JobListing, WorkerProfile, Conversation, ChatMessage, TradeCategory, JobType, ExperienceLevel } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { sendLocalNotification } from '@/utils/notifications';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { generateUUID } from '@/utils/generateId';

const JOBS_KEY = 'mageid_jobs';
const WORKERS_KEY = 'mageid_workers';
const CONVERSATIONS_KEY = 'mageid_conversations';
const MESSAGES_KEY = 'mageid_messages';

export const [HireProvider, useHire] = createContextHook(() => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const isGuest = user?.isGuest ?? true;
  const canSync = !isGuest && !!userId && isSupabaseConfigured;

  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [workers, setWorkers] = useState<WorkerProfile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('job_listings')
            .select('*')
            .order('fetched_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, companyId: (r.company_id as string) ?? '',
              companyName: (r.company_name as string) ?? '', title: r.title as string,
              tradeCategory: r.trade_category as TradeCategory, city: (r.city as string) ?? '',
              state: (r.state as string) ?? '', payMin: Number(r.pay_min) || 0,
              payMax: Number(r.pay_max) || 0, payType: (r.pay_type as 'hourly' | 'salary') ?? 'hourly',
              jobType: (r.job_type as JobType) ?? 'full_time',
              requiredLicenses: (r.required_licenses as string[]) ?? [],
              experienceLevel: (r.experience_level as ExperienceLevel) ?? 'mid',
              description: (r.description as string) ?? '', startDate: (r.start_date as string) ?? '',
              postedDate: r.posted_date as string, status: (r.status as JobListing['status']) ?? 'open',
              applicantCount: Number(r.applicant_count) || 0,
            })) as JobListing[];
            await AsyncStorage.setItem(JOBS_KEY, JSON.stringify(mapped));
            return mapped;
          }
        } catch (err) {
          console.log('[HireContext] Supabase jobs fetch failed:', err);
        }
      }
      const stored = await AsyncStorage.getItem(JOBS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as JobListing[];
        if (parsed.length > 0) return parsed;
      }
      return [];
    },
  });

  const workersQuery = useQuery({
    queryKey: ['workers'],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('worker_profiles')
            .select('*')
            .order('fetched_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, name: r.name as string,
              tradeCategory: r.trade_category as TradeCategory,
              yearsExperience: Number(r.years_experience) || 0,
              licenses: (r.licenses as string[]) ?? [], city: (r.city as string) ?? '',
              state: (r.state as string) ?? '',
              availability: (r.availability as WorkerProfile['availability']) ?? 'available',
              hourlyRate: Number(r.hourly_rate) || 0, bio: (r.bio as string) ?? '',
              pastProjects: (r.past_projects as string[]) ?? [],
              contactEmail: (r.contact_email as string) ?? '', phone: (r.phone as string) ?? '',
              createdAt: r.created_at as string,
            })) as WorkerProfile[];
            await AsyncStorage.setItem(WORKERS_KEY, JSON.stringify(mapped));
            return mapped;
          }
        } catch (err) {
          console.log('[HireContext] Supabase workers fetch failed:', err);
        }
      }
      const stored = await AsyncStorage.getItem(WORKERS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as WorkerProfile[];
        if (parsed.length > 0) return parsed;
      }
      return [];
    },
  });

  const convoQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('conversations')
            .select('*')
            .order('last_message_time', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              participantIds: (r.participant_ids as string[]) ?? [],
              participantNames: (r.participant_names as string[]) ?? [],
              lastMessage: (r.last_message as string) ?? '',
              lastMessageTime: r.last_message_time as string,
              unreadCount: 0,
            })) as Conversation[];
            await AsyncStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(mapped));
            return mapped;
          }
        } catch { /* fallback */ }
      }
      const stored = await AsyncStorage.getItem(CONVERSATIONS_KEY);
      return stored ? JSON.parse(stored) as Conversation[] : [];
    },
  });

  const messagesQuery = useQuery({
    queryKey: ['messages'],
    queryFn: async () => {
      if (canSync) {
        try {
          const convoIds = conversations.map(c => c.id).filter(Boolean);
          if (convoIds.length > 0) {
            const { data, error } = await supabase
              .from('messages')
              .select('*')
              .in('conversation_id', convoIds)
              .order('timestamp', { ascending: true });
            if (!error && data) {
              const mapped = data.map((r: Record<string, unknown>) => ({
                id: r.id as string,
                conversationId: r.conversation_id as string,
                senderId: r.sender_id as string,
                senderName: (r.sender_name as string) ?? '',
                text: (r.text as string) ?? '',
                timestamp: r.timestamp as string,
              })) as ChatMessage[];
              await AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(mapped));
              return mapped;
            }
          }
        } catch (err) {
          console.log('[HireContext] Supabase messages fetch failed:', err);
        }
      }
      const stored = await AsyncStorage.getItem(MESSAGES_KEY);
      return stored ? JSON.parse(stored) as ChatMessage[] : [];
    },
  });

  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => { if (jobsQuery.data) setJobs(jobsQuery.data); }, [jobsQuery.data]);
  useEffect(() => { if (workersQuery.data) setWorkers(workersQuery.data); }, [workersQuery.data]);
  useEffect(() => { if (convoQuery.data) setConversations(convoQuery.data); }, [convoQuery.data]);
  useEffect(() => { if (messagesQuery.data) setMessages(messagesQuery.data); }, [messagesQuery.data]);

  const convoIdsKey = useMemo(() => conversations.map(c => c.id).join(','), [conversations]);

  useEffect(() => {
    if (!canSync) return;

    const convoIds = convoIdsKey.split(',').filter(Boolean);
    if (convoIds.length === 0) {
      console.log('[HireContext] No conversations, skipping Realtime subscription');
      return;
    }

    console.log('[HireContext] Setting up filtered Realtime for', convoIds.length, 'conversations');

    if (realtimeChannelRef.current) {
      void supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    const channel = supabase
      .channel(`realtime-messages-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=in.(${convoIds.join(',')})`,
        },
        (payload) => {
          console.log('[Realtime] New message received:', payload.new);
          const r = payload.new as Record<string, unknown>;
          const newMsg: ChatMessage = {
            id: r.id as string,
            conversationId: r.conversation_id as string,
            senderId: r.sender_id as string,
            senderName: (r.sender_name as string) ?? '',
            text: (r.text as string) ?? '',
            timestamp: r.timestamp as string,
          };

          if (newMsg.senderId !== userId) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });

            void sendLocalNotification(
              `New message from ${newMsg.senderName}`,
              newMsg.text,
              { conversationId: newMsg.conversationId },
            );
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload) => {
          console.log('[Realtime] Conversation updated:', payload.eventType);
          if (payload.eventType === 'UPDATE') {
            const r = payload.new as Record<string, unknown>;
            setConversations(prev =>
              prev.map(c =>
                c.id === (r.id as string)
                  ? {
                      ...c,
                      lastMessage: (r.last_message as string) ?? c.lastMessage,
                      lastMessageTime: (r.last_message_time as string) ?? c.lastMessageTime,
                    }
                  : c,
              ),
            );
          } else if (payload.eventType === 'INSERT') {
            const r = payload.new as Record<string, unknown>;
            const participantIds = (r.participant_ids as string[]) ?? [];
            if (participantIds.includes(userId!)) {
              const newConvo: Conversation = {
                id: r.id as string,
                participantIds,
                participantNames: (r.participant_names as string[]) ?? [],
                lastMessage: (r.last_message as string) ?? '',
                lastMessageTime: (r.last_message_time as string) ?? new Date().toISOString(),
                unreadCount: 1,
              };
              setConversations(prev => {
                if (prev.some(c => c.id === newConvo.id)) return prev;
                return [newConvo, ...prev];
              });
            }
          }
        },
      )
      .subscribe((status) => {
        console.log('[Realtime] Subscription status:', status);
      });

    realtimeChannelRef.current = channel;

    return () => {
      console.log('[HireContext] Cleaning up Realtime subscription');
      if (realtimeChannelRef.current) {
        void supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [canSync, userId, convoIdsKey]);

  const saveJobsMutation = useMutation({
    mutationFn: async (updated: JobListing[]) => { await AsyncStorage.setItem(JOBS_KEY, JSON.stringify(updated)); return updated; },
    onSuccess: (data) => queryClient.setQueryData(['jobs'], data),
  });
  const saveWorkersMutation = useMutation({
    mutationFn: async (updated: WorkerProfile[]) => { await AsyncStorage.setItem(WORKERS_KEY, JSON.stringify(updated)); return updated; },
    onSuccess: (data) => queryClient.setQueryData(['workers'], data),
  });
  const saveConvosMutation = useMutation({
    mutationFn: async (updated: Conversation[]) => { await AsyncStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(updated)); return updated; },
    onSuccess: (data) => queryClient.setQueryData(['conversations'], data),
  });
  const saveMessagesMutation = useMutation({
    mutationFn: async (updated: ChatMessage[]) => { await AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(updated)); return updated; },
    onSuccess: (data) => queryClient.setQueryData(['messages'], data),
  });

  const addJob = useCallback((job: JobListing) => {
    const updated = [job, ...jobs];
    setJobs(updated);
    saveJobsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('job_listings', 'insert', {
        id: job.id, user_id: userId, company_id: job.companyId, company_name: job.companyName,
        title: job.title, trade_category: job.tradeCategory, city: job.city, state: job.state,
        pay_min: job.payMin, pay_max: job.payMax, pay_type: job.payType, job_type: job.jobType,
        required_licenses: job.requiredLicenses, experience_level: job.experienceLevel,
        description: job.description, start_date: job.startDate, posted_date: job.postedDate,
        status: job.status, applicant_count: job.applicantCount,
      });
    }
  }, [jobs, saveJobsMutation, canSync, userId]);

  const updateJob = useCallback((id: string, changes: Partial<JobListing>) => {
    const updated = jobs.map(j => j.id === id ? { ...j, ...changes } : j);
    setJobs(updated);
    saveJobsMutation.mutate(updated);
    if (canSync) {
      const j = updated.find(x => x.id === id);
      if (j) {
        void supabaseWrite('job_listings', 'update', {
          id, title: j.title, trade_category: j.tradeCategory, city: j.city, state: j.state,
          pay_min: j.payMin, pay_max: j.payMax, pay_type: j.payType, job_type: j.jobType,
          required_licenses: j.requiredLicenses, experience_level: j.experienceLevel,
          description: j.description, start_date: j.startDate, status: j.status,
          applicant_count: j.applicantCount,
        });
      }
    }
  }, [jobs, saveJobsMutation, canSync]);

  const addWorker = useCallback((worker: WorkerProfile) => {
    const updated = [worker, ...workers];
    setWorkers(updated);
    saveWorkersMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('worker_profiles', 'insert', {
        id: worker.id, user_id: userId, name: worker.name, trade_category: worker.tradeCategory,
        years_experience: worker.yearsExperience, licenses: worker.licenses, city: worker.city,
        state: worker.state, availability: worker.availability, hourly_rate: worker.hourlyRate,
        bio: worker.bio, past_projects: worker.pastProjects, contact_email: worker.contactEmail, phone: worker.phone,
      });
    }
  }, [workers, saveWorkersMutation, canSync, userId]);

  const applyToJob = useCallback((jobId: string) => {
    const updated = jobs.map(j => j.id === jobId ? { ...j, applicantCount: j.applicantCount + 1 } : j);
    setJobs(updated);
    saveJobsMutation.mutate(updated);
  }, [jobs, saveJobsMutation]);

  const sendMessage = useCallback((conversationId: string, senderId: string, senderName: string, text: string) => {
    const msg: ChatMessage = {
      id: generateUUID(),
      conversationId, senderId, senderName, text,
      timestamp: new Date().toISOString(),
    };
    const updatedMessages = [...messages, msg];
    setMessages(updatedMessages);
    saveMessagesMutation.mutate(updatedMessages);

    const updatedConvos = conversations.map(c =>
      c.id === conversationId
        ? { ...c, lastMessage: text, lastMessageTime: msg.timestamp, unreadCount: c.unreadCount + 1 }
        : c
    );
    setConversations(updatedConvos);
    saveConvosMutation.mutate(updatedConvos);

    if (canSync) {
      void supabaseWrite('messages', 'insert', {
        conversation_id: conversationId, sender_id: senderId, sender_name: senderName, text,
      });
      void supabase.from('conversations').update({
        last_message: text, last_message_time: new Date().toISOString(),
      }).eq('id', conversationId);
    }
  }, [messages, conversations, saveMessagesMutation, saveConvosMutation, canSync]);

  const startConversation = useCallback((participantIds: string[], participantNames: string[], initialMessage: string) => {
    const existingConvo = conversations.find(c =>
      c.participantIds.length === participantIds.length &&
      participantIds.every(id => c.participantIds.includes(id))
    );
    if (existingConvo) return existingConvo.id;

    const convoId = generateUUID();
    const newConvo: Conversation = {
      id: convoId, participantIds, participantNames,
      lastMessage: initialMessage, lastMessageTime: new Date().toISOString(), unreadCount: 0,
    };
    const updatedConvos = [newConvo, ...conversations];
    setConversations(updatedConvos);
    saveConvosMutation.mutate(updatedConvos);

    if (canSync) {
      void (async () => {
        try {
          const { error: convoError } = await supabase.from('conversations').insert({
            id: convoId, participant_ids: participantIds, participant_names: participantNames, last_message: initialMessage,
          });
          if (convoError) {
            console.log('[HireContext] Failed to insert conversation:', convoError.message);
            return;
          }
          const { error: partError } = await supabase
            .from('conversation_participants')
            .insert(participantIds.map(pid => ({ conversation_id: convoId, user_id: pid })));
          if (partError) {
            console.log('[HireContext] Failed to insert participants:', partError.message);
          }
        } catch (err) {
          console.log('[HireContext] startConversation sync failed:', err);
        }
      })();
    }

    if (initialMessage) {
      sendMessage(convoId, participantIds[0], participantNames[0], initialMessage);
    }
    return convoId;
  }, [conversations, saveConvosMutation, sendMessage, canSync]);

  const getConversationMessages = useCallback((conversationId: string) => {
    return messages.filter(m => m.conversationId === conversationId);
  }, [messages]);

  return useMemo(() => ({
    jobs, workers, conversations,
    addJob, updateJob, addWorker, applyToJob,
    sendMessage, startConversation, getConversationMessages,
    isLoading: jobsQuery.isLoading || workersQuery.isLoading,
  }), [jobs, workers, conversations, addJob, updateJob, addWorker, applyToJob, sendMessage, startConversation, getConversationMessages, jobsQuery.isLoading, workersQuery.isLoading]);
});

export function useFilteredJobs(filters: {
  search?: string; trade?: TradeCategory; state?: string; jobType?: JobType; experienceLevel?: ExperienceLevel;
}) {
  const { jobs } = useHire();
  return useMemo(() => {
    let filtered = [...jobs];
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(j => j.title.toLowerCase().includes(q) || j.companyName.toLowerCase().includes(q) || j.city.toLowerCase().includes(q));
    }
    if (filters.trade) filtered = filtered.filter(j => j.tradeCategory === filters.trade);
    if (filters.state) filtered = filtered.filter(j => j.state === filters.state);
    if (filters.jobType) filtered = filtered.filter(j => j.jobType === filters.jobType);
    if (filters.experienceLevel) filtered = filtered.filter(j => j.experienceLevel === filters.experienceLevel);
    return filtered;
  }, [jobs, filters.search, filters.trade, filters.state, filters.jobType, filters.experienceLevel]);
}

export function useFilteredWorkers(filters: {
  search?: string; trade?: TradeCategory; state?: string; availability?: string;
}) {
  const { workers } = useHire();
  return useMemo(() => {
    let filtered = [...workers];
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(w => w.name.toLowerCase().includes(q) || w.city.toLowerCase().includes(q) || w.bio.toLowerCase().includes(q));
    }
    if (filters.trade) filtered = filtered.filter(w => w.tradeCategory === filters.trade);
    if (filters.state) filtered = filtered.filter(w => w.state === filters.state);
    if (filters.availability) filtered = filtered.filter(w => w.availability === filters.availability);
    return filtered;
  }, [workers, filters.search, filters.trade, filters.state, filters.availability]);
}
