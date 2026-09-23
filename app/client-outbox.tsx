import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChevronLeft, Send, FileText, DollarSign, Camera,
  Image as ImageIcon, ListChecks, ClipboardList,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useProjects } from '@/contexts/ProjectContext';
import type { PortalState, SendableItemKind } from '@/types';
import { showAlert } from '@/utils/alert';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getOfflineQueue, onQueueChanged, onQueueFlushed } from '@/utils/offlineQueue';
import { insertStillQueued } from '@/utils/invoiceWrites';
import { recordNumberLabel, numberHoldReason, type NumberState } from '@/hooks/useCollectionSettled';

// #28: RFIs and submittals are numbered by the SERVER on insert. The provider
// row holds the phone's guess until a refetch replaces it, so the Outbox must
// neither print that guess as fact nor freeze it into the homeowner portal.
type NumberedTable = 'rfis' | 'submittals';
type NumberInfo = { state: NumberState; number?: number };

/**
 * The server's number for each RFI / submittal row the Outbox lists — the same
 * rule as the record screens' useServerRecordNumber, in one read per table:
 * INSERT still queued → 'pending'; on the server → 'confirmed' with its
 * number; not there yet (the direct insert is still on the wire) → 'pending';
 * the read failed / offline → 'local' (can't be confirmed). A confirmed number
 * that differs from the device's refetches the list so the provider adopts it.
 */
const NUMBER_READ_CHUNK = 100;

// The rows the Outbox lists: a draft / recalled item, or a sent one edited
// since it was sent. Shared by the list and the number read, so the server is
// asked only about rows on screen — not every RFI on the job.
function isOutboxCandidate(ps: PortalState | undefined, updatedAt: string | undefined): 'draft' | 'unsent' | null {
  if (ps?.status === 'draft' || ps?.status === 'recalled') return 'draft';
  if (ps?.status === 'sent' && ps.sentAt && updatedAt && new Date(updatedAt).getTime() > new Date(ps.sentAt).getTime()) return 'unsent';
  return null;
}

function useServerNumbers(rows: { table: NumberedTable; id: string; local: number | undefined }[]): Record<string, NumberInfo> {
  const qc = useQueryClient();
  const [info, setInfo] = useState<Record<string, NumberInfo>>({});
  const key = rows.map(r => `${r.table}:${r.id}:${r.local ?? ''}`).join('|');
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const seq = useRef(0);
  // Which of OUR rows still have a queued INSERT, as of the last read. The
  // queue fires a change for every write in the app (a photo, a time entry);
  // only a change to this set can change what we show, so anything else is
  // not worth a server read.
  const lastPendingSig = useRef<string | null>(null);
  const check = useCallback((onlyIfQueueMoved = false) => {
    const list = rowsRef.current;
    if (!list.length) { ++seq.current; lastPendingSig.current = ''; setInfo({}); return; }
    // The generation this call saw when it started. A call claims a new one
    // (++seq) only once it knows it WILL read the server: a queue-change ping
    // that turns out to be about someone else's row must never cancel a read
    // already in flight, or that read's answer is dropped and the rows sit on
    // 'checking' / a stale 'pending' until the next rfis flush.
    const startedAt = seq.current;
    void (async () => {
      const out: Record<string, NumberInfo> = {};
      let queue: Awaited<ReturnType<typeof getOfflineQueue>> = [];
      try { queue = await getOfflineQueue(); } catch { queue = []; }
      // A newer read began (or the rows changed / the screen closed) while we
      // looked at the queue: that one answers, this one bows out.
      if (seq.current !== startedAt) return;
      const toRead: Record<NumberedTable, string[]> = { rfis: [], submittals: [] };
      for (const r of list) {
        if (insertStillQueued(queue, r.table, r.id)) out[r.id] = { state: 'pending' };
        else toRead[r.table].push(r.id);
      }
      const sig = Object.keys(out).sort().join(',');
      if (onlyIfQueueMoved && sig === lastPendingSig.current) return;
      const mine = ++seq.current;
      lastPendingSig.current = sig;
      const stale = new Set<NumberedTable>();
      for (const table of ['rfis', 'submittals'] as const) {
        const ids = toRead[table];
        if (!ids.length) continue;
        if (!isSupabaseConfigured) { ids.forEach(id => { out[id] = { state: 'local' }; }); continue; }
        // Chunked: an .in() list rides in the URL, and a long job's ids would
        // otherwise run the query string past gateway limits. A failed chunk
        // marks only its own rows 'local' (held, and said so).
        for (let at = 0; at < ids.length; at += NUMBER_READ_CHUNK) {
          const chunk = ids.slice(at, at + NUMBER_READ_CHUNK);
          try {
            const { data, error } = await supabase.from(table).select('id, number').in('id', chunk);
            if (error) { chunk.forEach(id => { out[id] = { state: 'local' }; }); continue; }
            const byId = new Map(((data ?? []) as { id: string; number: unknown }[]).map(d => [d.id, d.number]));
            for (const id of chunk) {
              const n = byId.get(id);
              if (typeof n === 'number') {
                out[id] = { state: 'confirmed', number: n };
                if (n !== list.find(r => r.id === id)?.local) stale.add(table);
              } else {
                out[id] = { state: 'pending' };
              }
            }
          } catch {
            chunk.forEach(id => { out[id] = { state: 'local' }; });
          }
        }
      }
      if (mine !== seq.current) return;
      setInfo(out);
      stale.forEach(table => { void qc.invalidateQueries({ queryKey: [table] }); });
    })();
  }, [qc]);
  useEffect(() => {
    check();
    const offChange = onQueueChanged(() => check(true));
    const offFlush = onQueueFlushed(tables => { if (tables.has('rfis') || tables.has('submittals')) check(); });
    return () => { offChange(); offFlush(); seq.current++; };
  // `key` stands for the rows (ids + local numbers); check reads them by ref.
  }, [key, check]);
  return info;
}

type OutboxRow = {
  kind: SendableItemKind;
  itemId: string;
  title: string;
  subtitle: string;
  isUnsentEdit: boolean;
};

export default function ClientOutboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId } = useLocalSearchParams<{ projectId: string }>();

  const {
    getProject,
    batchSendToClientPortal,
    changeOrders,
    invoices,
    aiaPayApps,
    rfis,
    submittals,
    dailyReports,
    projectPhotos,
    warranties,
  } = useProjects();

  const [busy, setBusy] = useState(false);

  // Only the RFIs / submittals the Outbox actually lists (same updatedAt
  // reads as addItems below).
  const numberedRows = useMemo(() => [
    ...rfis.filter(r => r.projectId === projectId && isOutboxCandidate(r.portalState, (r as { updatedAt?: string }).updatedAt))
      .map(r => ({ table: 'rfis' as const, id: r.id, local: r.number })),
    ...submittals.filter(x => x.projectId === projectId && isOutboxCandidate(x.portalState, (x as { updatedAt?: string }).updatedAt))
      .map(x => ({ table: 'submittals' as const, id: x.id, local: x.number })),
  ], [rfis, submittals, projectId]);
  const numbers = useServerNumbers(numberedRows);
  const numberOf = useCallback((id: string): NumberInfo => numbers[id] ?? { state: 'checking' }, [numbers]);

  const project = projectId ? getProject(projectId) : null;

  const { drafts, unsent } = useMemo(() => {
    const out = { drafts: [] as OutboxRow[], unsent: [] as OutboxRow[] };

    function addItems<T extends { id: string; projectId: string; portalState?: PortalState }>(
      list: T[],
      kind: SendableItemKind,
      build: (i: T) => { title: string; subtitle: string },
      getUpdatedAt: (i: T) => string | undefined = () => undefined,
    ) {
      for (const i of list) {
        if (i.projectId !== projectId) continue;
        const which = isOutboxCandidate(i.portalState, getUpdatedAt(i));
        if (!which) continue;
        const { title, subtitle } = build(i);
        if (which === 'draft') out.drafts.push({ kind, itemId: i.id, title, subtitle, isUnsentEdit: false });
        else out.unsent.push({ kind, itemId: i.id, title, subtitle, isUnsentEdit: true });
      }
    }

    addItems(
      changeOrders,
      'change_order',
      co => ({
        title: `Change Order #${co.number ?? '—'}`,
        subtitle: co.description || (typeof co.changeAmount === 'number' ? `${co.changeAmount >= 0 ? '+' : ''}$${co.changeAmount}` : ''),
      }),
      co => (co as { updatedAt?: string }).updatedAt,
    );

    addItems(
      invoices,
      'invoice',
      inv => ({
        title: `Invoice #${(inv as { number?: number }).number ?? '—'}`,
        subtitle: typeof (inv as { totalDue?: number }).totalDue === 'number'
          ? `$${(inv as { totalDue: number }).totalDue}`
          : '',
      }),
      inv => (inv as { updatedAt?: string }).updatedAt,
    );

    addItems(
      aiaPayApps,
      'aia_pay_app',
      ap => ({ title: `AIA Pay App #${ap.applicationNumber ?? '—'}`, subtitle: '' }),
      ap => ap.savedAt,
    );

    addItems(
      rfis,
      'rfi',
      rfi => ({
        // #28: the server's number or "(pending #)" — never the phone's guess.
        title: recordNumberLabel('RFI', numberOf(rfi.id).state, numberOf(rfi.id).number, rfi.number),
        subtitle: ((rfi as { question?: string }).question ?? '').slice(0, 80),
      }),
      rfi => (rfi as { updatedAt?: string }).updatedAt,
    );

    addItems(
      submittals,
      'submittal',
      sb => ({
        title: recordNumberLabel('Submittal', numberOf(sb.id).state, numberOf(sb.id).number, sb.number),
        subtitle: ((sb as { title?: string }).title ?? '').slice(0, 80),
      }),
      sb => (sb as { updatedAt?: string }).updatedAt,
    );

    addItems(
      dailyReports,
      'daily_report',
      d => ({
        title: `Daily Report${d.date ? ' · ' + d.date : ''}`,
        subtitle: '',
      }),
      d => d.updatedAt,
    );

    addItems(
      projectPhotos,
      'photo',
      p => ({
        title: 'Photo',
        subtitle: p.location || p.tag || (p.timestamp ? new Date(p.timestamp).toLocaleDateString() : ''),
      }),
      p => (p as { timestamp?: string }).timestamp,
    );

    addItems(
      warranties,
      'warranty',
      w => ({
        title: (w as { title?: string }).title ?? 'Warranty',
        subtitle: '',
      }),
      w => (w as { updatedAt?: string }).updatedAt,
    );

    return out;
  }, [projectId, changeOrders, invoices, aiaPayApps, rfis, submittals, dailyReports, projectPhotos, warranties, numberOf]);

  // #28: an RFI / submittal whose number the server hasn't confirmed is HELD
  // out of Send all (the portal would freeze the guess) and said so, the same
  // rule the record screen's Send to client applies.
  const isHeld = useCallback((d: OutboxRow) => (d.kind === 'rfi' || d.kind === 'submittal') && numberOf(d.itemId).state !== 'confirmed', [numberOf]);
  const sendable = useMemo(() => drafts.filter(d => !isHeld(d)), [drafts, isHeld]);
  const held = useMemo(() => drafts.filter(isHeld), [drafts, isHeld]);
  const heldLine = useMemo(() => {
    if (!held.length) return null;
    const rfiN = held.filter(d => d.kind === 'rfi').length;
    const subN = held.filter(d => d.kind === 'submittal').length;
    const parts = [rfiN ? `${rfiN} RFI${rfiN === 1 ? '' : 's'}` : '', subN ? `${subN} submittal${subN === 1 ? '' : 's'}` : ''].filter(Boolean);
    return `${parts.join(' and ')} held until ${held.length === 1 ? 'its number is' : 'their numbers are'} confirmed by the server.`;
  }, [held]);

  const onSendAll = useCallback(async () => {
    if (busy || !sendable.length || !projectId) return;
    setBusy(true);
    try {
      const { sent } = await batchSendToClientPortal({
        items: sendable.map(d => ({ kind: d.kind, itemId: d.itemId })),
        projectId,
      });
      showAlert('Sent', `${sent} item${sent === 1 ? '' : 's'} sent to your client.${heldLine ? ` ${heldLine}` : ''}`);
    } catch (e) {
      showAlert('Send failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, sendable, projectId, batchSendToClientPortal, heldLine]);

  // Every query key here must be one the TARGET screen reads in its
  // useLocalSearchParams — `?id=` is not a generic "the record" param. Four of
  // these sent `id` to screens that read `coId` / `invoiceId` / `rfiId` /
  // `submittalId` / `reportId`, so tapping a waiting CO, invoice, RFI,
  // submittal or daily report opened a BLANK NEW one (numbered next, dated
  // today) in place of the item he came to share — and saving it made a
  // duplicate. typedRoutes does not type-check query keys on static routes,
  // so scripts/validate-records-open-before-load.ts checks each case against
  // the screen's own param keys.
  const routeForKind = (k: SendableItemKind, id: string, pid: string): string => {
    switch (k) {
      case 'change_order': return `/change-order?coId=${id}&projectId=${pid}`;
      case 'invoice':      return `/invoice?invoiceId=${id}&projectId=${pid}`;
      // aia-pay-app is INVOICE-keyed: it reads `invoiceId`, never `id`, and our
      // itemId here is the pay app's own id. Passing `?id=<payAppId>` therefore
      // opened the screen with nothing selected — the row looked live and
      // landed the GC on the period chooser. Resolve the invoice the pay app
      // was billed from (same as app/documents.tsx). It is optional on
      // SavedAIAPayApp, so an unlinked pay app falls back to the project and
      // the chooser at least opens on the right job.
      case 'aia_pay_app': {
        const invoiceId = aiaPayApps.find(a => a.id === id)?.invoiceId;
        return invoiceId
          ? `/aia-pay-app?invoiceId=${invoiceId}&projectId=${pid}`
          : `/aia-pay-app?projectId=${pid}`;
      }
      case 'rfi':          return `/rfi?rfiId=${id}&projectId=${pid}`;
      case 'submittal':    return `/submittal?submittalId=${id}&projectId=${pid}`;
      case 'daily_report': return `/daily-report?reportId=${id}&projectId=${pid}`;
      case 'photo':        return `/project-detail?id=${pid}&tile=photos`;
      case 'selection':    return `/selections?projectId=${pid}`;
      // The warranties screen is a per-project list with no item param; the
      // old `?id=` was read by nothing.
      case 'warranty':     return `/warranties?projectId=${pid}`;
    }
  };

  const iconForKind = (k: SendableItemKind) => {
    switch (k) {
      case 'change_order': return FileText;
      case 'invoice':      return DollarSign;
      case 'aia_pay_app':  return DollarSign;
      case 'rfi':          return ClipboardList;
      case 'submittal':    return ClipboardList;
      case 'daily_report': return ClipboardList;
      case 'photo':        return Camera;
      case 'selection':    return ImageIcon;
      case 'warranty':     return ListChecks;
    }
  };

  const projectName = project?.name;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title} numberOfLines={1}>Client Outbox</Text>
          {projectName ? <Text style={styles.projectName} numberOfLines={1}>{projectName}</Text> : null}
        </View>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        <Text style={styles.sectionLabel}>{`DRAFTS · ${drafts.length}`}</Text>
        {drafts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing in your Outbox</Text>
            <Text style={styles.emptySub}>
              {"New Change Orders, Invoices, RFIs, and Submittals start as Drafts. Drafts you haven't sent appear here."}
            </Text>
          </View>
        ) : (
          <>
            {drafts.map(d => {
              const Icon = iconForKind(d.kind);
              return (
                <TouchableOpacity
                  key={`${d.kind}-${d.itemId}`}
                  onPress={() => projectId && router.push(routeForKind(d.kind, d.itemId, projectId) as never)}
                  style={styles.itemRow}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconWrap, { backgroundColor: colors.accent + '22' }]}>
                    <Icon size={16} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{d.title}</Text>
                    {d.subtitle ? (
                      <Text style={styles.itemSub} numberOfLines={1}>{d.subtitle}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.statusInline, { color: isHeld(d) ? colors.textMuted : colors.accent }]}>{isHeld(d) ? 'Held' : 'Draft'}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.primary, (busy || !sendable.length) && { opacity: 0.5 }]}
              onPress={onSendAll}
              disabled={busy || !sendable.length}
              accessibilityState={{ disabled: busy || !sendable.length }}
              testID="outbox-send-all"
            >
              <Send size={16} color="#FFFFFF" strokeWidth={1.75} />
              <Text style={styles.primaryText}>
                {busy ? 'Sending…' : `Send ${sendable.length === drafts.length ? 'all ' : ''}${sendable.length} to client`}
              </Text>
            </TouchableOpacity>
            {heldLine ? (
              <Text style={styles.heldNote} testID="outbox-held">
                {`${heldLine} ${held.length === 1 && held[0] ? (numberHoldReason(held[0].kind === 'rfi' ? 'RFI' : 'submittal', numberOf(held[0].itemId).state) ?? '') : 'They send once they sync.'}`}
              </Text>
            ) : null}
          </>
        )}

        {unsent.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
              {`UNSENT EDITS · ${unsent.length}`}
            </Text>
            {unsent.map(d => {
              const Icon = iconForKind(d.kind);
              return (
                <TouchableOpacity
                  key={`u-${d.kind}-${d.itemId}`}
                  onPress={() => projectId && router.push(routeForKind(d.kind, d.itemId, projectId) as never)}
                  style={styles.itemRow}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconWrap, { backgroundColor: '#F59E0B22' }]}>
                    <Icon size={16} color="#D97706" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{d.title}</Text>
                    {d.subtitle ? (
                      <Text style={styles.itemSub} numberOfLines={1}>{d.subtitle}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.statusInline, { color: '#D97706' }]}>Edited</Text>
                </TouchableOpacity>
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: t.bg,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  backBtn: {
    width: 34,
    height: 34,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 17,
    backgroundColor: t.surfaceAlt,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center' as const,
    paddingHorizontal: 8,
  },
  title: {
    ...Type.serifHeadline,
    color: t.text,
  },
  projectName: {
    fontSize: 12,
    color: t.textMuted,
    marginTop: 1,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: t.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 10,
  },
  emptyCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    padding: 20,
    alignItems: 'center' as const,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: t.text,
  },
  emptySub: {
    fontSize: 13,
    color: t.textMuted,
    textAlign: 'center' as const,
    lineHeight: 19,
  },
  itemRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    marginBottom: 8,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: t.text,
  },
  itemSub: {
    fontSize: 13,
    color: t.textMuted,
    marginTop: 1,
  },
  statusInline: {
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  primary: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    marginTop: 12,
    paddingVertical: 13,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accentFill,
  },
  heldNote: {
    fontSize: 12,
    color: t.textMuted,
    lineHeight: 17,
    marginTop: 8,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800' as const,
  },
});
