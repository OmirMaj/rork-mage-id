// hooks/useAskAction.ts — Ask MAGE "do it for me" (lane AIDO): detect a
// request, open the matching Copilot capability pre-seeded with his words, and
// afterwards say what was ACTUALLY saved, read from ProjectContext.
//
// Ask writes nothing. Start only navigates: /copilot runs its own job gate and
// clarifying interview, and nothing is saved until its review step ("Build
// it"). The before-snapshot lives in memory only (a ref Map keyed by turn and
// workflow) and is never stored, so a recalled thread shows Start again and
// never an old outcome. No polling and no timers: outcome() is recomputed from
// the live records on every render.
import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useProjects } from '@/contexts/ProjectContext';
import {
  hubScheduleNav,
  MODAL_DISMISS_DELAY_MS,
  scheduleEditHref,
  scheduleViewHref,
  type ScheduleRoute,
} from '@/utils/copilot/intentTable';
import {
  actionOutcome,
  detectAskActions,
  howToOffer,
  refreshPrecondition,
  snapshotForAction,
  type AskActionData,
  type AskActionOutcome,
  type AskActionProposal,
  type AskActionSnapshot,
  type AskProjectLike,
} from '@/utils/oneMind/askAction';

interface Started {
  proposal: AskActionProposal;
  before: AskActionSnapshot;
  /** The first 'saved' outcome, kept: a later record added elsewhere (the
   *  desktop dock stays open beside every screen) never relabels it. */
  saved?: AskActionOutcome;
}

export interface UseAskAction {
  detect(text: string, anchorProjectId: string | null): AskActionProposal[];
  howTo(text: string, anchorProjectId: string | null): AskActionProposal | null;
  start(turnKey: string, p: AskActionProposal): void;
  startEstimateFirst(turnKey: string, p: AskActionProposal): void;
  pick(turnKey: string, p: AskActionProposal, projectId: string): void;
  /** null = not started in this session. */
  outcome(turnKey: string, p: AskActionProposal): AskActionOutcome | null;
  /** The proposal with its precondition re-read from the live jobs (a card
   *  blocked on "no estimate yet" un-blocks once the estimate exists). */
  live(p: AskActionProposal): AskActionProposal;
  /** Go to a saved record (the card's Open). */
  openHref(href: { pathname: string; params: Record<string, string> }): void;
  /** True when Start leaves Ask for the Schedule tab and Ask closes (native page only). */
  leavesAsk(p: AskActionProposal): boolean;
}

const startedKey = (turnKey: string, p: Pick<AskActionProposal, 'capabilityId'>) => `${turnKey}::${p.capabilityId}`;

const isBlocked = (p: AskActionProposal) => !p.precondition.ok && p.precondition.kind === 'no_estimate';

export function useAskAction(opts: { variant: 'page' | 'panel' }): UseAskAction {
  const router = useRouter();
  const {
    projects, changeOrders, rfis, dailyReports, punchItems, invoices, submittals, permits, leads,
  } = useProjects();
  const started = useRef(new Map<string, Started>());
  // Bumped on Start so the card re-renders into its status line.
  const [version, setVersion] = useState(0);

  const data = useMemo<AskActionData>(() => ({
    projects: (projects ?? []) as unknown as AskProjectLike[],
    changeOrders: (changeOrders ?? []) as never,
    rfis: (rfis ?? []) as never,
    dailyReports: (dailyReports ?? []) as never,
    punchItems: (punchItems ?? []) as never,
    invoices: (invoices ?? []) as never,
    submittals: (submittals ?? []) as never,
    permits: (permits ?? []) as never,
    leads: (leads ?? []) as never,
  }), [projects, changeOrders, rfis, dailyReports, punchItems, invoices, submittals, permits, leads]);

  const variant = opts.variant;

  const leavesAsk = useCallback((p: AskActionProposal) => {
    const k = p.schedule?.kind;
    return variant === 'page' && Platform.OS !== 'web' && p.capabilityId === 'schedule' && (k === 'edit' || k === 'view' || k === 'pick');
  }, [variant]);

  /** Arrive on the Schedule tab. The Ask page is a native modal: an arrival
   *  there must dismiss it first or the tab opens hidden under the sheet (the
   *  hub's rule, hubScheduleNav). The desktop dock is not a modal and always
   *  pushes. */
  const toScheduleTab = useCallback((href: never, kind: 'edit' | 'view') => {
    const mode = variant === 'page'
      ? hubScheduleNav({ kind, how: 'push', platform: Platform.OS, canGoBack: router.canGoBack() })
      : 'push';
    if (mode === 'dismiss-then-push') {
      router.back();
      setTimeout(() => router.push(href), MODAL_DISMISS_DELAY_MS(Platform.OS));
    } else if (mode === 'replace') router.replace(href);
    else router.push(href);
  }, [router, variant]);

  /** Navigate for a proposal. Only routes; never writes. */
  const go = useCallback((p: AskActionProposal) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const r: ScheduleRoute | undefined = p.capabilityId === 'schedule' ? p.schedule : undefined;
    if (r && (r.kind === 'edit' || r.kind === 'view')) {
      toScheduleTab((r.kind === 'edit' ? scheduleEditHref(r.projectId, r.seed) : scheduleViewHref(r.projectId)) as never, r.kind);
      return;
    }
    if (r && r.kind === 'pick') return; // the card lists the jobs first
    // /copilot is itself a modal and stacks over the Ask modal.
    router.push({
      pathname: '/copilot',
      params: {
        capabilityId: p.capabilityId,
        projectId: p.projectId,
        ...(p.seed ? { seed: p.seed, autostart: '1' } : {}),
      },
    } as never);
  }, [router, toScheduleTab]);

  const record = useCallback((turnKey: string, keyOf: AskActionProposal, effective: AskActionProposal) => {
    started.current.set(startedKey(turnKey, keyOf), { proposal: effective, before: snapshotForAction(effective, data) });
    setVersion((v) => v + 1);
  }, [data]);

  const live = useCallback((p: AskActionProposal) => refreshPrecondition(p, data.projects), [data]);

  const start = useCallback((turnKey: string, p: AskActionProposal) => {
    const cur = live(p);
    if (isBlocked(cur) || cur.schedule?.kind === 'pick') return;
    record(turnKey, p, cur);
    go(cur);
  }, [live, record, go]);

  const startEstimateFirst = useCallback((turnKey: string, p: AskActionProposal) => {
    void turnKey;
    if (!p.projectId) return;
    // The estimate is its own Copilot run on the same job. The schedule row
    // un-blocks on its own once the estimate exists (live()).
    go({ ...p, capabilityId: 'estimate', label: 'Estimate', seed: '', schedule: undefined, precondition: { ok: true } });
  }, [go]);

  const pick = useCallback((turnKey: string, p: AskActionProposal, projectId: string) => {
    const r = p.schedule;
    if (!r || r.kind !== 'pick') return;
    const name = r.candidates.find((c) => c.id === projectId)?.name;
    const route: ScheduleRoute = r.then === 'view' ? { kind: 'view', projectId } : { kind: 'edit', projectId, seed: r.seed };
    const eff: AskActionProposal = { ...p, projectId, ...(name ? { projectName: name } : {}), schedule: route, precondition: { ok: true } };
    record(turnKey, p, eff);
    go(eff);
  }, [record, go]);

  const outcome = useCallback((turnKey: string, p: AskActionProposal): AskActionOutcome | null => {
    const s = started.current.get(startedKey(turnKey, p));
    if (!s) return null;
    if (s.saved) return s.saved;
    const o = actionOutcome(s.proposal, s.before, data);
    if (o.kind === 'saved') s.saved = o;
    return o;
    // `version` re-creates this after a Start so the card re-reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, version]);

  const detect = useCallback(
    (text: string, anchorProjectId: string | null) => detectAskActions(text, { projects: data.projects, anchorProjectId }),
    [data],
  );
  const howTo = useCallback(
    (text: string, anchorProjectId: string | null) => howToOffer(text, { projects: data.projects, anchorProjectId }),
    [data],
  );

  const openHref = useCallback((href: { pathname: string; params: Record<string, string> }) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // A schedule arrival needs a fresh focus nonce, or the tab ignores it.
    if ('focus' in href.params) {
      toScheduleTab({ pathname: href.pathname, params: { ...href.params, focus: String(Date.now()) } } as never, 'view');
      return;
    }
    router.push({ pathname: href.pathname, params: href.params } as never);
  }, [router, toScheduleTab]);

  return useMemo(
    () => ({ detect, howTo, start, startEstimateFirst, pick, outcome, live, openHref, leavesAsk }),
    [detect, howTo, start, startEstimateFirst, pick, outcome, live, openHref, leavesAsk],
  );
}
