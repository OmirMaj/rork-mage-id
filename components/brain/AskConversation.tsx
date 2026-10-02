// components/brain/AskConversation.tsx — "Ask MAGE anything", powered by One Mind.
//
// One question in, one fused answer out. The engine (utils/oneMind/*) routes
// the question (project-scoped vs business-wide — deterministic, no AI),
// assembles fact blocks from EVERY engine the app runs — business records,
// live margin, margin risk, schedule health, pace book, RFI latency, brain
// watch, cash flow, the four portfolio engines, the brain's own accuracy
// report and open leak flags — and answers with citations. Each cited block
// renders as a tappable chip that drills into the real screen behind it.
//
// This component is just the chat shell: bundle assembly, metering (askMage —
// the established AIFeature pattern), and the citation-chip UI.
//
// Two variants (wave 6d restore, d6r lane K1). 'page' is the /ask screen
// (app/ask.tsx renders it) and draws exactly the tree that screen always drew.
// 'panel' renders inside the desktop shell's 440 px right dock
// (components/desktop/ShellDock, opened by hooks/useAskDock) so the GC can
// look at the schedule WHILE he asks about it: no Stack.Screen (it would
// retitle whatever route sits under the dock), no brand header (SidePanel
// draws 'Ask MAGE' and the X), no safe-area padding, a vertical Recent list,
// and the anchor follows the job he is working on (ActiveProjectContext).
// On desktop web Enter sends and Shift+Enter keeps the newline, in both.
//
// Opened from a job's own screen, the Brain FAB forwards that job
// (?projectId=) and the conversation is ANCHORED to it: the header says
// "Answering for <job>" (tap to clear), the starters name the job, and a
// question that names no project is answered for it — see applyAnchorScope
// (audit #36). A blocked answer (monthly / hourly cap, signed out) carries
// the one action that fixes it (audit #119).
//
// The look (lane AILOOK, 2026-10-01): a modern assistant chat. Your words
// leave the composer and glide up into the conversation as a neutral bubble
// (components/brain/ask/AskMessage); a quiet thinking row appears under it
// (ask/AskThinking: the mark, three dots, "Reading your records"); the answer
// fades in as plain full-width text with its Sources underneath. Flat theme
// surfaces, no gradients, no glow. Only turns ask() created this session move
// (liveKeys); Recent recalls and dock remounts render still. Every number is in
// ask/askMotion.ts. Reduce Motion keeps the states and drops the movement.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Pressable,
  Platform, KeyboardAvoidingView, Animated, Keyboard,
  type NativeSyntheticEvent, type TextInputKeyPressEventData, type NativeScrollEvent, type TextStyle,
} from 'react-native';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronRight, ArrowUp, AlertTriangle, Search, X, Clock, DollarSign, CalendarClock,
  Mic, Gauge, Users, Wallet, TrendingUp, Sparkles, Mail, Briefcase, LogIn, type LucideIcon,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import VoiceCaptureModal from '@/components/VoiceCaptureModal';
import RFITriageModal from '@/components/RFITriageModal';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useSearch } from '@/contexts/SearchContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useBidResponsesPortfolio } from '@/hooks/useBidResponsesPortfolio';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples, useLaborRates, useTimeEntriesMirror } from '@/hooks/useLaborRates';
import type { JobCostActualSources } from '@/utils/jobCostEngine';
import { checkAILimit, recordAIUsage, nextAiResetLabel } from '@/utils/aiRateLimiter';
import { localDateISO } from '@/utils/brief/composeBrief';
import { askOneMind, type OneMindCitation } from '@/utils/oneMind/answer';
import { type OneMindBundle, isColdStart } from '@/utils/oneMind/factBlocks';
import { resolveStarters, ONBOARDING_STARTERS, type Starter, type StarterIcon } from '@/utils/resolveStarters';
import { followupsForRefs } from '@/utils/oneMind/followupMapping';
import { DEMO_ANSWERS } from '@/utils/oneMind/demoColdStart';
import { loadAskThreads, saveAskThread, type AskThread } from '@/utils/askHistory';
import { loadAllConstraints } from '@/hooks/useLastPlanner';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import type { Constraint } from '@/utils/lastPlanner';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { useActiveProject } from '@/contexts/ActiveProjectContext';
import { isAppHowTo } from '@/utils/oneMind/composePrompt';
import type { AskActionProposal } from '@/utils/oneMind/askAction';
import { useAskAction } from '@/hooks/useAskAction';
import { useAskCopy } from '@/hooks/useAskCopy';
import { AskActionCard } from '@/components/brain/AskActionCard';
import { cardSurface, nativeDriver, useReducedMotion } from '@/components/ui';
import { AskMessage, AskFade } from '@/components/brain/ask/AskMessage';
import { AskThinking } from '@/components/brain/ask/AskThinking';
import { AskJumpLatest } from '@/components/brain/ask/AskJumpLatest';
import { ASK_MOTION, chipDelay } from '@/components/brain/ask/askMotion';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
  citations?: OneMindCitation[];
  /** Why the answer failed (OneMindAnswer.errorKind / errorCode) — drives the
   *  See plans / Sign in action under a blocked turn. */
  errorKind?: string;
  errorCode?: string;
  /** Stable per-turn id (Date.now() + suffix); the React key and the do-it
   *  card's turnKey. Older saved threads have none (index fallback). */
  key?: string;
  /** Lane AIDO: the do-it card's workflows under this assistant turn. Saved
   *  threads keep them; a recalled card shows Start again, never an outcome. */
  actions?: AskActionProposal[];
  /** The words he sent, on the assistant turn that carries `actions`, so
   *  "Answer instead" can re-ask them through One Mind. */
  askedText?: string;
}

/**
 * The one action that fixes a blocked answer, or null.
 *
 *   monthly cap on Free / Pro → 'plans'  (a bigger plan lifts it)
 *   hourly limit             → null     (waiting an hour does; the relay's own
 *                                        sentence says so — never a paywall)
 *   signed out / expired     → 'signin'
 */
function blockedAction(t: Turn, tier: string): 'plans' | 'signin' | null {
  if (t.errorKind === 'unauthenticated') return 'signin';
  if (t.errorKind === 'monthly_cap' && t.errorCode !== 'hourly_limit' && (tier === 'free' || tier === 'pro')) {
    return 'plans';
  }
  return null;
}

// Starter icon KEY -> Lucide component. Keys come from utils/resolveStarters so
// that pure data module carries no component dependency.
const STARTER_ICON: Record<StarterIcon, LucideIcon> = {
  clock: Clock, dollar: DollarSign, alert: AlertTriangle, calendar: CalendarClock,
  gauge: Gauge, users: Users, wallet: Wallet, trending: TrendingUp, sparkle: Sparkles,
};

export interface AskConversationProps {
  /** 'page' = the /ask screen (today's tree); 'panel' = inside the desktop dock. */
  variant: 'page' | 'panel';
  /** A question to auto-ask once the data has hydrated (copilot-hub handoff). */
  seed?: string;
  /** The screen Ask was opened from — tunes the starters. */
  screen?: string;
  /** The page's ?projectId= anchor. The panel anchors to the active job instead. */
  anchorProjectId?: string | null;
  /** Panel only: start a new docked conversation. Passed in by hooks/useAskDock
   *  (never imported here), so the two files do not require each other. With
   *  none, the panel shows no 'New chat'. */
  onNewChat?: () => void;
}

/** The Recent list in the dock: a vertical list, at most this many rows (the
 *  page keeps its horizontal strip). */
const PANEL_RECENT_MAX = 4;

/** The desktop composer's input draws no focus ring of its own: the composer's
 *  rounded container is the field. (A CSS-only key, so it is cast once here.) */
const WEB_INPUT_NO_OUTLINE = { outlineStyle: 'none' } as unknown as TextStyle;

/** [a, b, c] -> [[a, b], [c]]: the desktop starters' rows. */
function pairsOf<T>(list: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
  return rows;
}

export function AskConversation(props: AskConversationProps) {
  const { seed } = props;
  const panel = props.variant === 'panel';
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { openSearch } = useSearch();
  const isDesktopWeb = useIsDesktopWeb();
  // The dock follows the job he is working on; the page reads ?projectId=.
  // (`?.`: a mount outside ActiveProjectProvider — a test — anchors nothing.)
  const activeProjectId = useActiveProject()?.activeProjectId ?? null;
  const anchorParam = props.variant === 'panel' ? activeProjectId : props.anchorProjectId;
  // The dock outlives route changes; with no explicit screen it tunes its
  // starters to the route under it when it opened.
  const segments = useSegments();
  const cleanedSegments = segments.map(s => s.replace(/[()]/g, '')).filter(Boolean);
  const screen = panel ? (props.screen ?? cleanedSegments[cleanedSegments.length - 1]) : props.screen;

  const reduced = useReducedMotion();
  // The desktop /ask page centres the conversation in a reading column.
  const isDesktopPage = isDesktopWeb && !panel;

  // Search is a pageSheet modal and so is this screen. Dismiss ask first, then
  // present search — the same close-then-open timing the Brain FAB used for its
  // voice/help sheets, so search animates in cleanly instead of stacking.
  const openSearchFromAsk = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // Desktop web: search is a palette over the shell — nothing to dismiss
    // first, and backing out of /ask would drop him somewhere else.
    if (isDesktopWeb) { openSearch(); return; }
    router.back();
    setTimeout(() => openSearch(), 350);
  }, [router, openSearch, isDesktopWeb]);

  // Close the page. Desktop web: a direct /ask link has no history to go back
  // to, so it lands on Home instead of doing nothing.
  const closeAsk = useCallback(() => {
    if (isDesktopWeb) {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/(home)');
      return;
    }
    router.back();
  }, [router, isDesktopWeb]);

  const {
    projects, invoices, leads, changeOrders, rfis,
    commitments, dailyReports, permits, submittals, punchItems, aiaPayApps,
    equipment, subcontractors,
    projectsLoaded,
  } = useProjects();
  const safety = useSafety();
  const { tier } = useSubscription();
  const { bidResponses } = useBidResponsesPortfolio();
  const { receipts } = useMaterialReceipts();
  const laborSamples = useLaborCostSamples();
  // The seven cost streams Job Costing prices. Without them the MARGIN and RISK
  // blocks are built on subcontracts alone — and they SAY so — so a self-perform
  // job's crew overrun never reaches the answer (audit round 2, #16).
  const timeEntries = useTimeEntriesMirror();
  const { rates: laborRates, overtimeMultiplier, overtimeRule } = useLaborRates();
  const costSources = useMemo<JobCostActualSources>(() => ({
    receipts, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits, subcontractors,
  }), [receipts, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits, subcontractors]);
  const [allConstraints, setAllConstraints] = useState<Record<string, Constraint[]>>({});
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const bundle = useMemo<OneMindBundle>(() => {
    // Local calendar day, not toISOString() (UTC flips the date for evening
    // hours west of Greenwich) — same discipline as the Morning Brief.
    const todayISO = localDateISO(new Date());
    return {
      projects, commitments, changeOrders, invoices,
      rfis, leads, dailyReports, permits, submittals, punchItems,
      expiringCertifications: safety.expiringCertifications(todayISO) as OneMindBundle['expiringCertifications'],
      bidResponses,
      // buildPipelineHorizon reads them for billed-to-date; without them a GC
      // billing through G702/G703 shows a backlog overstated by everything he
      // has already billed.
      aiaPayApps,
      receipts,
      costSources,
      laborSamples,
      constraints: allConstraints,
      // The pipeline horizon's backlog is this company's own jobs only.
      userId,
    };
  }, [
    projects, commitments, changeOrders, invoices, rfis, leads, dailyReports,
    permits, submittals, punchItems, safety, bidResponses, aiaPayApps, receipts, costSources, laborSamples,
    allConstraints, userId,
  ]);

  // The anchored job (from the Brain FAB on a job screen). Resolved against the
  // user's own projects, so a stale or foreign id anchors nothing. Clearing it
  // turns the rest of the conversation business-wide.
  const [anchorCleared, setAnchorCleared] = useState(false);
  // In the dock the anchor follows the active job: switching jobs re-anchors
  // even after "All jobs" was tapped for the previous one.
  useEffect(() => {
    if (panel) setAnchorCleared(false);
  }, [anchorParam, panel]);
  const anchorProject = useMemo(
    () => (!anchorCleared && typeof anchorParam === 'string' && anchorParam
      ? projects.find(p => p.id === anchorParam) ?? null
      : null),
    [anchorCleared, anchorParam, projects],
  );
  const anchorProjectId = anchorProject?.id ?? null;

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [rfiOpen, setRfiOpen] = useState(false);
  const [recentThreads, setRecentThreads] = useState<AskThread[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  // Stable id for THIS conversation, so history save upserts one thread/session.
  const sessionId = useRef(String(Date.now())).current;

  // Prior turns for multi-turn continuity, without re-creating `ask` per turn.
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  const doIt = useAskAction({ variant: panel ? 'panel' : 'page' });
  const askCopy = useAskCopy();

  // Turns ask() created in THIS session that have not finished their entrance.
  // Only these move; a Recent recall, the seeded history and a dock remount
  // render still. AskMessage drops its key when the entrance ends.
  const [liveKeys, setLiveKeys] = useState<ReadonlySet<string>>(() => new Set());
  const keySeq = useRef(0);
  const newKey = useCallback(() => `${sessionId}-${++keySeq.current}`, [sessionId]);
  const markLive = useCallback((...keys: string[]) => {
    setLiveKeys(prev => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }, []);
  const dropLive = useCallback((key: string) => {
    setLiveKeys(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  // "Jump to latest": is he reading near the end (within 160 pt)? An answer
  // that lands while he has scrolled up shows the pill instead of yanking him.
  const nearEndRef = useRef(true);
  const [jumpVisible, setJumpVisible] = useState(false);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const fromEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    nearEndRef.current = fromEnd <= ASK_MOTION.jump.showAfterPx;
    if (nearEndRef.current) setJumpVisible(false);
  }, []);
  const jumpToLatest = useCallback(() => {
    setJumpVisible(false);
    nearEndRef.current = true;
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);
  /** After a new turn lands: follow it if he is near the end, else offer the pill. */
  const followNewTurn = useCallback(() => {
    if (nearEndRef.current) requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    else setJumpVisible(true);
  }, []);

  const ask = useCallback(async (question: string, opts?: { skipAction?: boolean }) => {
    const q = question.trim();
    if (!q || busy) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // Cold-start onboarding: answer the canned demo prompts instantly and
    // entirely client-side — no model call, no metering, no network.
    const demo = isColdStart(bundle) ? DEMO_ANSWERS[q] : undefined;
    if (demo) {
      const ku = newKey();
      const ka = newKey();
      setDraft('');
      markLive(ku, ka);
      setTurns(prev => [
        ...prev,
        { role: 'user', text: q, key: ku },
        { role: 'assistant', text: demo.answer, citations: demo.citations, key: ka },
      ]);
      nearEndRef.current = true;
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      return;
    }
    // Lane AIDO: a do-request ("build the schedule", "write an RFI about the
    // beam") gets the Start card instead of a how-to answer. No AI call and no
    // meter: detection is deterministic, and nothing is written until the
    // Copilot's own review.
    const acts = opts?.skipAction ? [] : doIt.detect(q, anchorProjectId);
    if (acts.length) {
      const ku = newKey();
      const ka = newKey();
      setDraft('');
      markLive(ku, ka);
      setTurns(prev => [
        ...prev,
        { role: 'user', text: q, key: ku },
        { role: 'assistant', text: askCopy.actionLead(acts.length), actions: acts, askedText: q, key: ka },
      ]);
      nearEndRef.current = true;
      setJumpVisible(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      return;
    }
    const prior = turnsRef.current.map(t => ({ role: t.role, text: t.text }));
    const ku = newKey();
    setDraft('');
    markLive(ku);
    setTurns(prev => [...prev, { role: 'user', text: q, key: ku }]);
    setBusy(true);
    // He just sent: follow his words up. Let the user message paint before we
    // scroll, so the glide and the scroll read as one upward motion.
    nearEndRef.current = true;
    setJumpVisible(false);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    try {
      // Smart-tier call — meter it like every other call site (client-side
      // daily caps per CLAUDE.md; the relay only sees the feature id).
      const limit = await checkAILimit(tier, 'smart', 'askMage');
      if (!limit.allowed) {
        const canUpgrade = tier === 'free' || tier === 'pro';
        const kc = newKey();
        markLive(kc);
        setTurns(prev => [...prev, {
          key: kc,
          role: 'assistant',
          text: limit.message ?? (canUpgrade
            ? 'Today’s advanced AI calls are used up. More are on a higher plan. Opening plans.'
            // The allowance rolls at 00:00 UTC — often later TODAY (audit #123).
            : `You've used today's advanced AI calls. ${nextAiResetLabel().daily}.`),
          error: true,
        }]);
        // Convert at the moment of intent instead of dead-ending: send
        // upgradeable tiers to the paywall so they can lift the cap right now.
        if (canUpgrade) router.push('/paywall');
        return;
      }
      const res = await askOneMind(q, prior, bundle, { anchorProjectId });
      // Count only answers that actually hit the model — cold-start and
      // verbatim-fallback answers report usedAI: false and cost nothing.
      if (res.usedAI) {
        void recordAIUsage('smart', 'askMage');
      }
      // An app how-to ("how do I create a project") is answered from the
      // guide as today, with the offer to do it under the answer.
      const offer = !res.errorKind && isAppHowTo(q) ? doIt.howTo(q, anchorProjectId) : null;
      const ka = newKey();
      markLive(ka);
      setTurns(prev => [...prev, {
        key: ka,
        role: 'assistant',
        text: res.answer,
        error: !!res.errorKind,
        citations: res.citations,
        errorKind: res.errorKind,
        errorCode: res.errorCode,
        ...(offer ? { actions: [offer] } : {}),
      }]);
    } finally {
      setBusy(false);
      followNewTurn();
    }
  }, [busy, bundle, tier, router, anchorProjectId, doIt, askCopy, newKey, markLive, followNewTurn]);

  // Desktop web: Enter sends, Shift+Enter keeps the newline. Preventing the
  // default also stops react-native-web's own submit-and-blur, so the cursor
  // stays in the composer for the next question.
  const onComposerKey = useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const ne = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean };
    if (ne.key === 'Enter' && !ne.shiftKey && !ne.isComposing) {
      e.preventDefault();
      void ask(draft);
    }
  }, [ask, draft]);

  // Load saved threads for the Recent strip on mount.
  useEffect(() => { void loadAskThreads().then(setRecentThreads); }, []);

  // Load Last Planner constraints (all projects) so project-scoped answers can
  // include the readiness lookahead. Through the hook's shared loader, which
  // merges the cloud copy — so a fresh device or a re-sign-in sees constraints
  // without first opening the Last Planner. Absent -> readiness just skips.
  useEffect(() => {
    let cancelled = false;
    void loadAllConstraints(queryClient, userId).then(c => { if (!cancelled) setAllConstraints(c); });
    return () => { cancelled = true; };
  }, [queryClient, userId]);

  // Persist a completed Q&A thread (upsert by session id) so it can be recalled
  // for free from the Recent strip. Only save once an assistant turn has landed.
  useEffect(() => {
    const last = turns[turns.length - 1];
    if (last && last.role === 'assistant') {
      void saveAskThread(sessionId, turns, Date.now()).then(setRecentThreads);
    }
  }, [turns, sessionId]);

  // Copilot-hub handoff: arrive with ?seed=<question> and auto-ask it once —
  // but only after the project data has hydrated. Firing against a
  // pre-hydration (empty) bundle hit One Mind's cold-start short-circuit and
  // told users with plenty of data "you have no data", with no retry. The
  // projectsLoaded gate re-runs this effect when hydration lands, so the
  // seed still fires exactly once.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !projectsLoaded) return;
    if (typeof seed === 'string' && seed.trim() && turnsRef.current.length === 0) {
      seededRef.current = true;
      void ask(seed);
    }
  }, [seed, ask, projectsLoaded]);

  const openCitation = useCallback((c: OneMindCitation) => {
    if (!c.drillIn) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // drillIn.pathname is typed against the router (FactBlockDrillIn.pathname:
    // Route), so a dead route fails tsc at the block that declares it. The
    // Href cast here only bridges the pathname UNION into push's overloads —
    // it cannot smuggle an unknown route past the compiler the way the old
    // `as never` did.
    router.push({ pathname: c.drillIn.pathname, params: c.drillIn.params } as Href);
  }, [router]);

  const empty = turns.length === 0;
  const cold = isColdStart(bundle);
  // Starters adapt to context: onboarding demos when there's no data yet,
  // otherwise the set tuned to the screen the user opened Ask from.
  const starters = useMemo<Starter[]>(
    () => (cold ? ONBOARDING_STARTERS : resolveStarters(screen, anchorProject?.name)),
    [cold, screen, anchorProject?.name],
  );

  // ── The conversation body — the same for the page and the dock ──────────

  // The page's Recent strip is a horizontal rail; the dock's is a short
  // vertical list (440 px holds ~2 cards across, and a mouse cannot swipe a
  // hidden-scrollbar rail).
  const recentStrip = panel ? (
    recentThreads.length > 0 && (
      <View style={styles.recentWrap}>
        <Text style={styles.recentLabel}>Recent</Text>
        {recentThreads.slice(0, PANEL_RECENT_MAX).map(thread => {
          const firstQ = thread.turns.find(x => x.role === 'user')?.text ?? 'Conversation';
          return (
            <TouchableOpacity
              key={thread.id}
              style={styles.recentItemPanel}
              onPress={() => setTurns(thread.turns as Turn[])}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`Open the earlier conversation: ${firstQ}`}
              testID="ask-recent"
            >
              <Clock size={13} color={themeColors.textMuted} strokeWidth={2} />
              <Text style={styles.recentText} numberOfLines={1}>{firstQ}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    )
  ) : (
    recentThreads.length > 0 && (
      <View style={styles.recentWrap}>
        <Text style={styles.recentLabel}>Recent</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
          {recentThreads.map(thread => {
            const firstQ = thread.turns.find(x => x.role === 'user')?.text ?? 'Conversation';
            return (
              <TouchableOpacity
                key={thread.id}
                style={styles.recentCard}
                onPress={() => setTurns(thread.turns as Turn[])}
                activeOpacity={0.85}
                accessibilityRole="button"
                testID="ask-recent"
              >
                <Clock size={13} color={themeColors.textMuted} strokeWidth={2} />
                <Text style={styles.recentText} numberOfLines={2}>{firstQ}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    )
  );

  const starterTile = ({ q, icon }: Starter) => {
    const Icon = STARTER_ICON[icon];
    return (
      <TouchableOpacity
        key={q}
        style={[styles.suggestion, isDesktopPage && styles.suggestionDesktop]}
        onPress={() => ask(q)}
        activeOpacity={0.85}
        accessibilityRole="button"
        testID="ask-suggestion"
      >
        <Icon size={17} color={themeColors.accent} strokeWidth={2} />
        <Text style={styles.suggestionText}>{q}</Text>
        <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={2} />
      </TouchableOpacity>
    );
  };

  const messages = empty ? (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyMark}>
        <MageAIMark size={22} color={Colors.textOnAccent} accentColor={Colors.textOnAccent} />
      </View>
      <Text style={styles.emptyTitle}>{askCopy.lookEmptyTitle}</Text>
      <Text style={styles.emptyBody}>
        {anchorProject
          ? `Ask about ${anchorProject.name}: its money, schedule and RFIs. Tap "All projects" to ask across the business. Every answer cites where it came from.`
          : 'Ask about your money, schedules and leads across your projects. Every answer cites where it came from.'}
      </Text>
      <Text style={styles.emptyHint}>{askCopy.lookEmptyHint}</Text>
      <View style={styles.suggestions}>
        {isDesktopPage
          // Desktop /ask: the starters two to a row (an odd last one keeps its
          // half width beside a spacer, never stretching across the column).
          ? pairsOf(starters).map((row) => (
            <View key={row[0].q} style={styles.suggestionPair}>
              {row.map(starterTile)}
              {row.length === 1 && <View style={styles.suggestionSpacer} />}
            </View>
          ))
          : starters.map(starterTile)}
      </View>
      {!cold && projects.length > 0 && (
        <TouchableOpacity
          style={styles.toolRow}
          onPress={() => setRfiOpen(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
          testID="ask-rfi-triage"
        >
          <Mail size={16} color={themeColors.accent} strokeWidth={2} />
          <Text style={styles.toolText}>Turn an email into an RFI</Text>
          <ChevronRight size={15} color={themeColors.textMuted} strokeWidth={2} />
        </TouchableOpacity>
      )}
      {recentStrip}
    </View>
  ) : (
    turns.map((t, i) => {
      const turnKey = t.key;
      const live = !!turnKey && liveKeys.has(turnKey);
      const onEntered = turnKey ? () => dropLive(turnKey) : undefined;
      if (t.role === 'user') {
        return (
          <AskMessage key={turnKey ?? i} role="user" live={live} variant={props.variant} text={t.text} onEntered={onEntered} />
        );
      }
      const action = blockedAction(t, tier);
      const citations = t.citations ?? [];
      const followups = i === turns.length - 1 && !busy ? followupsForRefs(citations.map(c => c.ref)) : [];
      return (
        <AskMessage
          key={turnKey ?? i}
          role="assistant"
          live={live}
          variant={props.variant}
          error={t.error}
          text={t.text}
          onEntered={onEntered}
        >
          {!!t.actions?.length && (
            <AskActionCard
              turnKey={t.key ?? `${sessionId}-${i}`}
              proposals={t.actions}
              action={doIt}
              onAnswerInstead={t.askedText ? () => { void ask(t.askedText ?? '', { skipAction: true }); } : undefined}
            />
          )}
          {action && (
            <TouchableOpacity
              style={styles.blockedAction}
              onPress={() => router.push(action === 'plans' ? '/paywall' : '/login')}
              activeOpacity={0.85}
              accessibilityRole="button"
              testID={action === 'plans' ? 'ask-see-plans' : 'ask-sign-in'}
            >
              {action === 'plans'
                ? <Sparkles size={14} color={themeColors.accent} strokeWidth={2} />
                : <LogIn size={14} color={themeColors.accent} strokeWidth={2} />}
              <Text style={styles.blockedActionText}>{action === 'plans' ? 'See plans' : 'Sign in'}</Text>
              <ChevronRight size={13} color={themeColors.accent} strokeWidth={2} />
            </TouchableOpacity>
          )}
          {/* The grounding row: where this answer came from. No citations, no
              label (never an empty "Sources"). */}
          {citations.length > 0 && (
            <View style={styles.sources}>
              <Text style={styles.sourcesLabel}>{askCopy.lookSources}</Text>
              <View style={styles.citationRow}>
                {citations.map((c, ci) => (
                  <AskFade key={c.ref} live={live} delayMs={chipDelay(ci, reduced)}>
                    <TouchableOpacity
                      style={styles.citationChip}
                      onPress={() => openCitation(c)}
                      disabled={!c.drillIn}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      testID={`ask-citation-${c.ref}`}
                    >
                      <Text style={styles.citationText}>{c.domain}</Text>
                      {c.drillIn && <ChevronRight size={12} color={themeColors.accent} strokeWidth={2.2} />}
                    </TouchableOpacity>
                  </AskFade>
                ))}
              </View>
            </View>
          )}
          {followups.length > 0 && (
            <View style={styles.followupRow}>
              {followups.map((f, fi) => (
                <AskFade key={f} live={live} delayMs={chipDelay(citations.length + fi, reduced)}>
                  <TouchableOpacity
                    style={styles.followupChip}
                    onPress={() => ask(f)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    testID="ask-followup"
                  >
                    <Text style={styles.followupText}>{f}</Text>
                    <ChevronRight size={13} color={themeColors.textSecondary} strokeWidth={2} />
                  </TouchableOpacity>
                </AskFade>
              ))}
            </View>
          )}
        </AskMessage>
      );
    })
  );

  // The thinking row: a direct child of the View that holds the turns, so the
  // answer that replaces it takes its slot with no jump.
  const thinking = (
    <AskThinking
      visible={busy}
      label={askCopy.lookThinking}
      stillLabel={askCopy.lookStillThinking}
      a11yLabel={askCopy.lookThinkingA11y}
    />
  );

  // The send button's press: scale 0.92 on the snap spring, back to 1 on
  // release (no scale under Reduce Motion). No motion style until the first
  // press, so a first render carries none.
  const pressScale = useRef(new Animated.Value(1)).current;
  const [pressArmed, setPressArmed] = useState(false);
  const pressTo = useCallback((to: number) => {
    if (reduced) return;
    setPressArmed(true);
    Animated.spring(pressScale, { toValue: to, ...ASK_MOTION.sendPress.spring, useNativeDriver: nativeDriver }).start();
  }, [reduced, pressScale]);
  const sendBlocked = busy || !draft.trim();
  // A disabled send always says why (never a silent grey button).
  const sendHint = busy ? askCopy.lookSendHintBusy : !draft.trim() ? askCopy.lookSendHintEmpty : undefined;

  // The composer: one rounded container (mic · field · send) on the page's
  // ground. Only the outer padding differs: the page clears the home
  // indicator, the dock sits on the panel's own padding.
  const inputBar = (
    <View style={[styles.inputBar, panel ? styles.inputBarPanel : { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={[styles.composer, isDesktopPage && styles.columnDesktop]}>
        <TouchableOpacity
          style={styles.micBtn}
          onPress={() => { Keyboard.dismiss(); setVoiceOpen(true); }}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="Ask by voice"
          testID="ask-mic"
        >
          <Mic size={20} color={themeColors.textMuted} strokeWidth={2} />
        </TouchableOpacity>
        <TextInput
          style={[styles.input, isDesktopWeb && WEB_INPUT_NO_OUTLINE]}
          value={draft}
          onChangeText={setDraft}
          placeholder={askCopy.lookPlaceholder}
          placeholderTextColor={themeColors.textMuted}
          multiline
          onSubmitEditing={() => ask(draft)}
          blurOnSubmit
          testID="ask-input"
          {...(isDesktopWeb ? { onKeyPress: onComposerKey } : null)}
        />
        <Animated.View style={pressArmed ? { transform: [{ scale: pressScale }] } : null}>
          <TouchableOpacity
            style={[styles.send, sendBlocked && styles.sendIdle]}
            onPress={() => ask(draft)}
            onPressIn={() => pressTo(ASK_MOTION.sendPress.scale)}
            onPressOut={() => pressTo(1)}
            disabled={sendBlocked}
            activeOpacity={0.9}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: sendBlocked }}
            accessibilityHint={sendHint}
            testID="ask-send"
          >
            <ArrowUp size={18} color={sendBlocked ? themeColors.textMuted : Colors.textOnAccent} strokeWidth={2.6} />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );

  // "Jump to latest" — nothing at rest; see AskJumpLatest.
  const jumpPill = (
    <AskJumpLatest visible={jumpVisible} label={askCopy.lookJumpLatest} onPress={jumpToLatest} />
  );

  const sheets = (
    <>
      <VoiceCaptureModal
        visible={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onTranscriptReady={(t) => { setVoiceOpen(false); void ask(t); }}
        title="Ask by voice"
        contextLine="Speak your question — I'll answer from your jobs."
        suggestions={starters.map(s => s.q)}
      />

      <RFITriageModal visible={rfiOpen} onClose={() => setRfiOpen(false)} />
    </>
  );

  // ── Panel: inside the desktop dock ──────────────────────────────────────
  // SidePanel draws the 'Ask MAGE' title and the X; the dock outlives route
  // changes, so there is no Stack.Screen here (it would retitle the route
  // under the dock). Citations, See plans and Sign in still router.push: the
  // page column navigates and the dock stays open beside it.
  if (panel) {
    return (
      <View style={styles.panelRoot} testID="ask-panel">
        {(anchorProject || !empty) && (
          <View style={styles.anchorRow} testID="ask-anchor">
            {anchorProject ? (
              <>
                <Briefcase size={14} color={themeColors.accent} strokeWidth={2} />
                <Text style={styles.anchorText} numberOfLines={1}>
                  Answering for {anchorProject.name}
                </Text>
                <TouchableOpacity
                  onPress={() => setAnchorCleared(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Stop answering for ${anchorProject.name} and ask about all projects`}
                  testID="ask-anchor-clear"
                >
                  <Text style={styles.anchorClear}>All projects</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.anchorText} numberOfLines={1}>Answering across all your projects</Text>
            )}
            {!empty && props.onNewChat && (
              <TouchableOpacity
                onPress={props.onNewChat}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Start a new conversation"
                testID="ask-new-chat"
              >
                <Text style={styles.anchorClear}>New chat</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.panelScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={32}
        >
          {messages}
          {thinking}
        </ScrollView>
        {jumpPill}
        {inputBar}
        {sheets}
      </View>
    );
  }

  // ── Page: the /ask screen ────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {props.variant === 'page' && <Stack.Screen options={{ headerShown: false }} />}

      {/* Header — the flat mark + 'Ask MAGE' left, search + close right */}
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <MageAIMark size={14} color={Colors.textOnAccent} accentColor={Colors.textOnAccent} />
          </View>
          <Text style={styles.brandName}>{askCopy.lookTitle}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
            onPress={openSearchFromAsk}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Search"
            testID="ask-search"
          >
            <Search size={18} color={themeColors.textMuted} strokeWidth={2} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
            onPress={closeAsk}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID="ask-close"
          >
            <X size={18} color={themeColors.textMuted} strokeWidth={2.2} />
          </Pressable>
        </View>
      </View>

      {/* Grounding chip: which job this conversation answers for. */}
      {anchorProject && (
        <View style={styles.anchorRow} testID="ask-anchor">
          <Briefcase size={14} color={themeColors.accent} strokeWidth={2} />
          <Text style={styles.anchorText} numberOfLines={1}>
            Answering for {anchorProject.name}
          </Text>
          <TouchableOpacity
            onPress={() => setAnchorCleared(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Stop answering for ${anchorProject.name} and ask about all projects`}
            testID="ask-anchor-clear"
          >
            <Text style={styles.anchorClear}>All projects</Text>
          </TouchableOpacity>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={[styles.pageScrollContent, isDesktopPage && styles.columnDesktop]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={32}
        >
          {messages}
          {thinking}
        </ScrollView>

        {jumpPill}
        {/* Input bar */}
        {inputBar}
      </KeyboardAvoidingView>

      {sheets}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, minHeight: 52,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  // Flat: the accent fill is the mark itself, never a glow behind it.
  brandMark: {
    width: 24, height: 24, borderRadius: Tokens.radius.md,
    backgroundColor: t.accentFill,
    alignItems: 'center', justifyContent: 'center',
  },
  brandName: { ...Type.headline, color: t.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: {
    width: 36, height: 36, borderRadius: Tokens.radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnPressed: { backgroundColor: t.surfaceAlt },

  anchorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: t.line, backgroundColor: t.surface,
  },
  anchorText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  anchorClear: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accent },

  // The fix for a blocked answer: a neutral pill, the label in the accent.
  blockedAction: {
    ...cardSurface(t, { radius: 'full', pad: 'none' }),
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
  blockedActionText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent },

  emptyWrap: { alignItems: 'flex-start', paddingTop: 28, paddingHorizontal: 8 },
  emptyMark: {
    width: 40, height: 40, borderRadius: Tokens.radius.lg,
    backgroundColor: t.accentFill,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { ...Type.serifHeadline, color: t.text },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19, marginTop: 8, maxWidth: 320 },
  emptyHint: { ...Type.footnote, color: t.textSecondary, marginTop: 6, maxWidth: 360 },
  suggestions: { gap: 9, marginTop: 22, alignSelf: 'stretch' },
  suggestion: {
    ...cardSurface(t, { radius: 'card', pad: 'none' }),
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  // Desktop /ask: two starters to a row.
  suggestionPair: { flexDirection: 'row', gap: 9 },
  suggestionDesktop: { flex: 1 },
  suggestionSpacer: { flex: 1 },
  suggestionText: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '600', color: t.text },
  // Secondary "tool" affordance under the starters — reads as an action, not a
  // suggestion (dashed border, muted).
  toolRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, alignSelf: 'stretch',
    borderWidth: 1, borderColor: t.line, borderStyle: 'dashed', borderRadius: Tokens.radius.lg,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  toolText: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '600', color: t.textSecondary },

  // Sources: the grounding row under every answer that cites something.
  sources: { marginTop: 10 },
  sourcesLabel: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textMuted, marginBottom: 6 },
  citationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  citationChip: {
    ...cardSurface(t, { radius: 'full', pad: 'none' }),
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  citationText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary },

  // The composer's ground: the page colour, no hairline above it.
  inputBar: {
    paddingHorizontal: 12, paddingTop: 8,
    backgroundColor: t.bg,
  },
  composer: {
    ...cardSurface(t, { radius: '2xl', pad: 6 }),
    flexDirection: 'row', alignItems: 'flex-end', gap: 4,
  },
  input: {
    flex: 1, minHeight: 36, maxHeight: 160,
    paddingHorizontal: 6, paddingTop: 8, paddingBottom: 8,
    fontSize: Type.callout.fontSize, color: t.text,
  },
  send: {
    width: 36, height: 36, borderRadius: Tokens.radius.full,
    backgroundColor: t.accentFill,
    alignItems: 'center', justifyContent: 'center',
  },
  sendIdle: { backgroundColor: t.surfaceAlt },
  micBtn: {
    width: 36, height: 36, borderRadius: Tokens.radius.full,
    alignItems: 'center', justifyContent: 'center',
  },

  // The /ask page's scroll content; on desktop it is also the reading column.
  pageScrollContent: { padding: 16, paddingBottom: 24 },
  columnDesktop: { width: '100%', maxWidth: Layout.page.reading, alignSelf: 'center' },

  // Recent-threads strip in the empty state — recall a past answer for free.
  recentWrap: { marginTop: 22, alignSelf: 'stretch' },
  recentLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted, letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' },
  recentRow: { gap: 9, paddingRight: 8 },
  recentCard: {
    ...cardSurface(t, { radius: 'lg', pad: 'none' }),
    width: 152, flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  recentText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.textSecondary, lineHeight: 16 },

  // Follow-up chips under the latest answer: neutral pills.
  followupRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  followupChip: {
    ...cardSurface(t, { radius: 'full', pad: 'none' }),
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 11, paddingVertical: 7,
  },
  followupText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary },

  // ── Panel (the desktop dock) ──
  panelRoot: { flex: 1 },
  panelScrollContent: { padding: Layout.cardPad },
  inputBarPanel: { paddingBottom: Layout.cardPad },
  // One Recent row in the dock: a hairline list, not a card (440 px).
  recentItemPanel: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    minHeight: Layout.control.row, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
});
