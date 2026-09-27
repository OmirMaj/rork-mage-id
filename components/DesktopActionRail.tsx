// ============================================================================
// components/DesktopActionRail.tsx
//
// Right-rail "Action Required" column shown next to the main content at very
// wide desktop widths (>= 1280px). Mirrors the SaaS-dashboard reference layout
// the user shared — sidebar / main / rail — so the eye flows: where am I →
// what am I looking at → what needs me right now.
//
// Data source is useBrainWatch() — THE canonical "needs your attention" set.
// This is the SAME hook + count the Your-Projects tab badge, the Summary NEEDS
// YOU card, and the home Brain Watch card use, so the rail can never disagree
// with the badge mounted beside it (sim-audit #15 "1 vs 11" — the rail used to
// run its own useSmartInbox() row count under an authoritative-sounding
// "Action Required" title while the badge showed the canonical total). The
// dismissible Smart Inbox feed lives in the home "Inbox" card, not here.
//
// Width gate: 1280px MAIN VIEWPORT (not content width). Below that, the rail
// is dropped entirely and the inline Inbox card takes over. This keeps narrow
// laptops (1024-1280) from getting cramped 3-column layouts.
//
// WHY THE EMPTY STATE IS SCOPED (polish audit 2026-09-10, the all-clear wave).
// "All caught up / Nothing urgent across your projects." is a claim about every
// project, made from nine attention kinds that contain no RFI and no submittal
// category. On the audited account that sentence rendered while an RFI sat 23
// days past due to the architect — and it is WORSE here than on the phone,
// because above 1280px app/(tabs)/(home)/index.tsx suppresses the inline Smart
// Inbox in favour of this rail, so the desktop reader has nowhere else on the
// screen to see the row that contradicts it.
//
// The fix keeps this file's original rule intact: the COUNT PILL and the ROWS
// are still only the canonical set (that is sim-audit #15 — the rail once ran
// its own useSmartInbox count under an authoritative "Action Required" title
// while the badge beside it showed a different number).
//
// UX wave, lane A (A7): the RFIs and submittals that used to gate only the
// sentence (a side-count, `outsideTheScan`) are IN the canonical set now
// (hooks/useBrainWatch), so they are rows here with the count — an overdue RFI
// to the architect is listed beside the overdue invoice instead of surfacing
// only after everything else is cleared. And each row can do its job in one
// click (a trailing button; the row itself still opens the record):
//   • invoice → "Remind"  (utils/remindInvoice: the invoice screen's own
//     guards — sample refusal, QuickBooks-closed confirm, the server's
//     outcome — and its marker mirror);
//   • RFI / submittal → "Nudge" (utils/chaseNudge: the share sheet, or on the
//     web a pre-addressed email when the record names an address, logged on
//     /waiting-on only after "Did you send it?");
//   • permit inspection → "Prep" (Inspection Ready on the job).
// Nothing sends without the click. Each button carries its destination's gate:
// Remind is the invoice screen's (a locked plan shows the button with a lock
// and says what unlocks it; a job shared with him — a collaborator — gets no
// Remind, billing the client is the owner's); Nudge is /waiting-on's (none).
//
// WAVE 6c (lane F) — THE ONE ATTENTION LIST. At 1512 px Home drew this list
// twice (the rail AND the Brain Watch card) and '+N more' was plain text that
// went nowhere. Now, while the rail is up (utils/sidebarRail actionRailVisible,
// which Home reads too), Home leaves Brain Watch, Ready to Bill, the daily-log
// card and the warranty banner OUT, and the rail carries them:
//   • the canonical rows (still the first 8) and 'See all N' — a real link to
//     /attention (Cmd-click opens a tab);
//   • three sections below — READY TO BILL, DAILY-LOG GAPS, WARRANTY WALKS —
//     each at most 3 rows (utils/portfolio/attentionRows railSection), each
//     with its own 'See all N' to /attention?view=…, each hidden at 0 rows.
//     Their rows are the SAME builders and targets the Home cards use
//     (buildReadyToBill, buildDailyLogGaps, getUpcomingWarrantyWalks).
// One ScrollView holds the whole body so the sections scroll together.
//
// WAVE 6d restore (d6r, lane K1) — variant 'dock'. The same list renders inside
// the desktop shell's right dock (components/desktop/ShellDock, id
// ATTENTION_DOCK_ID), opened from the sidebar's Action Required row on ANY
// page, so the GC can work down it beside the page it sends him to. In the
// dock it fills the panel (no fixed 300 width, no left rule — SidePanel draws
// its own), SidePanel's header already says 'Action Required', so the list
// leads with 'Needs you now', and every 'See all' closes the dock as it lands
// on /attention — that page IS the list, it must not show twice. The rail
// variant is unchanged.
// ============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CloudOff, ChevronRight, CheckCircle2, Lock } from 'lucide-react-native';
import { useBrainWatch } from '@/hooks/useBrainWatch';
import { useCoreData, useDocsData, useProjects } from '@/contexts/ProjectContext';
import type { AttentionAction, AttentionItem, AttnSeverity } from '@/utils/brainWatch';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { showAlert } from '@/utils/alert';
import { nailIt } from '@/components/animations/NailItToast';
import { remindInvoice, confirmViaAlert } from '@/utils/remindInvoice';
import { sendInvoiceReminderNow } from '@/utils/invoiceReminders';
import { canShare, shareText } from '@/utils/shareText';
import { buildChaseList } from '@/utils/systemOfAction';
import {
  chaseLogId, chaseMailSubject, chaseRecipientEmail, recordChaseToLog, sendNudge,
} from '@/utils/chaseNudge';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { RowLink, routeHref } from '@/components/desktop/RowLink';
import { useShellDock } from '@/components/desktop/ShellDock';
import { buildReadyToBill } from '@/utils/draftedRevenue';
import { formatMoney } from '@/utils/formatters';
import { getUpcomingWarrantyWalks, warrantyWalkTitle } from '@/utils/warrantyWalks';
import { resolveWarrantyMonths } from '@/utils/paymentTerms';
import {
  buildDailyLogGaps, railSection, dailyLogGapLine, dailyLogGapTarget,
} from '@/utils/portfolio/attentionRows';

/** Severity → theme ink (wave 6c: the hex literals were not theme-aware). */
function severityColor(severity: AttnSeverity, t: ThemeColors): string {
  if (severity === 'critical') return t.danger;
  if (severity === 'high') return t.warningLabel;
  return t.textSecondary;
}

/** Web-only print contract (wave 6b): the rail is chrome, not the page. */
const PRINT_HIDE: object = Platform.OS === 'web' ? { dataSet: { print: 'hide' } } : {};

export const RAIL_WIDTH = 300;

/** RT-R1: shown instead of "All caught up" when the probe could not reach
 *  MAGE — identical wording to components/home/BrainWatchCard. */
const UNREACHABLE_LINE =
  `Couldn't reach MAGE — showing what's on this ${Platform.OS === 'web' ? 'device' : 'phone'}`;

interface Props {
  width?: number;
  /** 'rail' (default): Home's 300 px column. 'dock': inside the shell's right
   *  dock — fills the panel, and 'See all' closes the dock. */
  variant?: 'rail' | 'dock';
}

const DesktopActionRail = React.memo(function DesktopActionRail({ width = RAIL_WIDTH, variant = 'rail' }: Props) {
  const { items, sourceFailed } = useBrainWatch();
  const router = useRouter();
  const dock = useShellDock();
  const docked = variant === 'dock';
  // 'See all' lands on /attention, which IS this list: close the dock as it
  // goes (spread, so the rail's RowLinks carry exactly the props they did).
  const seeAllPress = docked ? dock.close : undefined;
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const { projects } = useCoreData();
  // UX A7: the records behind the Nudge button (the drafted words and the
  // address come from the RFI / submittal itself).
  const { rfis, submittals } = useDocsData();

  const top = useMemo(() => items.slice(0, 8), [items]);

  // The three sections — the same builders the Home cards use, so the rail
  // and the cards it stands in for can never list different rows.
  const { changeOrders, dailyReports, settings, invoices, updateInvoice, contacts, subcontractors } = useProjects();
  const [busyId, setBusyId] = useState<string | null>(null);
  const ready = useMemo(
    () => buildReadyToBill({ changeOrders, projects, nowMs: Date.now() }),
    [changeOrders, projects],
  );
  const logGaps = useMemo(
    () => buildDailyLogGaps(projects, dailyReports, new Date().toISOString()),
    [projects, dailyReports],
  );
  const warrantyMonths = resolveWarrantyMonths(settings);
  const walks = useMemo(
    () => getUpcomingWarrantyWalks(projects, warrantyMonths),
    [projects, warrantyMonths],
  );
  const billSection = railSection(ready.rows);
  const logSection = railSection(logGaps);
  const walkSection = railSection(walks);

  const onRowPress = useCallback((item: AttentionItem) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (!item.route?.pathname) return; // never push a dead-end route
    if (item.route.params) router.push({ pathname: item.route.pathname, params: item.route.params } as any);
    else router.push(item.route.pathname as any);
  }, [router]);

  // ── UX A7: the one-click jobs ─────────────────────────────────────────────

  /** A locked plan: say what unlocks it, never a dead button. */
  const explainLocked = useCallback((what: string) => {
    showAlert(
      `${what} is on the Pro plan`,
      `Upgrade to ${what.toLowerCase()} from here. The row still opens the record.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'See plans', onPress: () => router.push('/paywall') },
      ],
    );
  }, [router]);

  /** Which button a row gets, or null. The gates are the destinations'.
   *  `access` is the row's project-aware access (useProjectAccess, read per
   *  row by RailAttentionRow): the viewer's tier OR a collaborator seat's
   *  grant, and his role on that job. */
  const actionFor = useCallback((item: AttentionItem, access: RowAccess): RailAction | null => {
    const a: AttentionAction | undefined = item.action;
    if (!a) return null;
    const project = projects.find(p => p.id === item.projectId);
    if (a.kind === 'remind') {
      // A job shared WITH him: billing the client is the owner's
      // (invoiceRoleGate's collaborator rule) — no Remind, the row still opens.
      const role = access.role ?? project?.myRole;
      if (role === 'editor' || role === 'viewer' || role === 'field') return null;
      const locked = !access.canAccess('change_orders_invoicing');
      return {
        label: 'Remind',
        locked,
        run: locked ? () => explainLocked('Sending invoice reminders') : async () => {
          const inv = invoices.find(i => i.id === a.invoiceId);
          if (!inv) { showAlert('Invoice not on this device', 'Open it from the invoice list to check it, then try again.'); return; }
          setBusyId(item.id);
          try {
            const lastMs = inv.dunningLastSentAt ? Date.parse(inv.dunningLastSentAt) : null;
            const out = await remindInvoice(
              {
                invoiceId: inv.id,
                projectName: project?.name ?? item.projectName,
                qboError: inv.qboError,
                lastReminderMs: Number.isFinite(lastMs as number) ? lastMs : null,
              },
              { send: sendInvoiceReminderNow, confirm: confirmViaAlert(showAlert) },
            );
            // The edge function wrote the same markers; echoing them is idempotent.
            if (out.patch) updateInvoice(inv.id, out.patch);
            if (out.kind === 'sent') nailIt(out.message);
            else if (out.kind !== 'cancelled') showAlert(out.title, out.message);
          } finally {
            setBusyId(null);
          }
        },
      };
    }
    if (a.kind === 'nudge') {
      // No tier lock: a nudge is the /waiting-on chase (the drafted words out
      // through the share sheet or a mail client), and /waiting-on chases with
      // no plan gate. The RFI / submittal record itself stays behind its own
      // (project-aware) gate when the row opens it.
      if (a.record === 'rfi') {
        const rfi = rfis.find(r => r.id === a.recordId);
        // An RFI that never went out has nobody to nudge — the row opens it to send.
        if (!rfi || !rfi.dateSubmitted?.trim()) return null;
        return {
          label: 'Nudge',
          locked: false,
          run: async () => {
            const chase = buildChaseList({ rfis: [rfi], submittals: [], changeOrders: [], projects: project ? [project] : [], nowMs: Date.now() })
              .find(c => c.id === rfi.id);
            const message = chase?.nudge
              ?? `Following up on RFI #${rfi.number} (${rfi.subject}) for ${project?.name ?? 'the job'} — we still need your answer to keep work moving.`;
            const via = await sendNudge(
              {
                message,
                to: chaseRecipientEmail({ text: rfi.assignedTo, subId: rfi.assignedSubId }, { contacts, subs: subcontractors }),
                toName: rfi.assignedTo,
                subject: chaseMailSubject('rfi', rfi.number, project?.name),
              },
              { platform: Platform.OS, shareText, canShare, showAlert, openURL: (u) => Linking.openURL(u) },
            );
            if (!via) return;
            await recordChaseToLog({ id: chaseLogId('rfi', rfi.id), projectId: rfi.projectId, via, message, at: new Date().toISOString() }, AsyncStorage);
            nailIt(`Chase logged on Waiting On · RFI #${rfi.number}`);
          },
        };
      }
      const sub = submittals.find(x => x.id === a.recordId);
      const cycles = sub?.reviewCycles ?? [];
      const lastCycle = cycles.length > 0 ? cycles[cycles.length - 1] : null;
      if (!sub || !(lastCycle?.sentDate || sub.submittedDate)) return null;
      return {
        label: 'Nudge',
        locked: false,
        run: async () => {
          const chase = buildChaseList({ rfis: [], submittals: [sub], changeOrders: [], projects: project ? [project] : [], nowMs: Date.now() })
            .find(c => c.id === sub.id);
          const message = chase?.nudge
            ?? `Following up on submittal #${sub.number} (${sub.title}) for ${project?.name ?? 'the job'} — can you send back your review?`;
          const via = await sendNudge(
            {
              message,
              to: chaseRecipientEmail({ text: lastCycle?.reviewer }, { contacts, subs: subcontractors }),
              toName: lastCycle?.reviewer,
              subject: chaseMailSubject('submittal', sub.number, project?.name),
            },
            { platform: Platform.OS, shareText, canShare, showAlert, openURL: (u) => Linking.openURL(u) },
          );
          if (!via) return;
          await recordChaseToLog({ id: chaseLogId('submittal', sub.id), projectId: sub.projectId, via, message, at: new Date().toISOString() }, AsyncStorage);
          nailIt(`Chase logged on Waiting On · submittal #${sub.number}`);
        },
      };
    }
    // prep — Inspection Ready's checklist on the job.
    return {
      label: 'Prep',
      locked: false,
      run: () => router.push({ pathname: '/project-detail', params: { id: item.projectId, prep: `permit:${a.permitId}` } }),
    };
  }, [projects, invoices, updateInvoice, rfis, submittals, contacts, subcontractors, router, explainLocked]);

  return (
    <View
      style={[styles.rail, variant === 'dock' ? styles.railDock : { width }]}
      testID={docked ? 'desktop-action-dock' : 'desktop-action-rail'}
      {...PRINT_HIDE}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, variant === 'dock' && styles.scrollContentDock]}
      >
        <View style={styles.headerRow}>
          {variant === 'dock'
            ? <Text style={styles.dockLead}>Needs you now</Text>
            : <Text style={styles.headerTitle}>Action Required</Text>}
          {items.length > 0 ? (
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{items.length}</Text>
            </View>
          ) : null}
        </View>

        {items.length === 0 ? (
          sourceFailed ? (
            // RT-R1: an empty set from a failed read (dead session, no network)
            // is this device's last cache, not "all caught up" — same copy as
            // BrainWatchCard.
            <View style={styles.emptyState} testID="rail-unreachable">
              <View style={styles.emptyIconWrap}>
                <CloudOff size={22} color={colors.warningLabel} strokeWidth={1.8} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.warningLabel }]}>{UNREACHABLE_LINE}</Text>
              <Text style={styles.emptySubtitle}>Nothing cached needs attention; the live read failed.</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <CheckCircle2 size={22} color={colors.success} strokeWidth={1.8} />
              </View>
              <Text style={styles.emptyTitle}>All caught up</Text>
              <Text style={styles.emptySubtitle}>Nothing overdue on schedules, invoices, permits or certs.</Text>
            </View>
          )
        ) : (
          <View style={styles.listWrap}>
            {top.map(item => (
              <RailAttentionRow
                key={item.id}
                item={item}
                styles={styles}
                colors={colors}
                busy={busyId === item.id}
                onRowPress={onRowPress}
                actionFor={actionFor}
              />
            ))}
            {items.length > top.length && (
              <RowLink
                href={routeHref('/attention')}
                accessibilityLabel={`See all ${items.length} items that need attention`}
                testID="rail-see-all"
                {...(seeAllPress ? { onPress: seeAllPress } : null)}
              >
                <Text style={styles.moreText}>See all {items.length}</Text>
              </RowLink>
            )}
          </View>
        )}

        {billSection.shown.length > 0 ? (
          <RailSection
            title={`READY TO BILL · ${formatMoney(ready.total)}`}
            total={ready.rows.length}
            view="bill"
            testID="rail-section-bill"
            styles={styles}
            onSeeAll={seeAllPress}
          >
            {billSection.shown.map(row => (
              <TouchableOpacity
                key={row.id}
                style={styles.row}
                onPress={() => router.push({ pathname: '/change-order', params: { projectId: row.projectId, coId: row.id } })}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Review change order ${row.coNumber} for ${row.projectName}, ${formatMoney(row.amount)}`}
                testID={`rail-bill-${row.id}`}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {row.projectName} · CO #{row.coNumber} · {formatMoney(row.amount)}
                  </Text>
                </View>
                <ChevronRight size={14} color={colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))}
          </RailSection>
        ) : null}

        {logSection.shown.length > 0 ? (
          <RailSection title="DAILY-LOG GAPS" total={logGaps.length} view="logs" testID="rail-section-logs" styles={styles} onSeeAll={seeAllPress}>
            {logSection.shown.map(row => (
              <TouchableOpacity
                key={row.projectId}
                style={styles.row}
                // A today row opens a NEW report (new: '1'): on desktop web a
                // bare projectId now opens the log (lane H).
                onPress={() => router.push({ pathname: '/daily-report', params: dailyLogGapTarget(row) })}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID={`rail-log-${row.projectId}`}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{dailyLogGapLine(row)}</Text>
                </View>
                <ChevronRight size={14} color={colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))}
          </RailSection>
        ) : null}

        {walkSection.shown.length > 0 ? (
          <RailSection title="WARRANTY WALKS" total={walks.length} view="warranty" testID="rail-section-warranty" styles={styles} onSeeAll={seeAllPress}>
            {walkSection.shown.map(a => (
              <TouchableOpacity
                key={a.project.id}
                style={styles.row}
                onPress={() => router.push({ pathname: '/warranty-walk', params: { projectId: a.project.id } })}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID={`rail-walk-${a.project.id}`}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {a.project.name} · {a.warrantyMonthsAssumed ? 'Warranty walk' : warrantyWalkTitle(a.warrantyMonths)}
                  </Text>
                </View>
                <ChevronRight size={14} color={colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))}
          </RailSection>
        ) : null}
      </ScrollView>
    </View>
  );
});

export default DesktopActionRail;

type Styles = ReturnType<typeof makeStyles>;

/** UX A7 — a row's project-aware access (hooks/useProjectAccess). */
interface RowAccess {
  role: string | null | undefined;
  canAccess: (feature: Parameters<ReturnType<typeof useProjectAccess>['canAccess']>[0]) => boolean;
}
interface RailAction { label: string; locked: boolean; run: () => void | Promise<void> }

/**
 * One canonical row. Its own component so each row can read ITS job's access
 * (useProjectAccess is per project): the Remind gate is the invoice screen's,
 * and a plan gate on a shared job is the seat's grant, never only the
 * viewer's own tier. A row with no action renders exactly the row it always
 * did; a row with one splits into the row and a trailing button (never a
 * button inside a button on the web).
 */
function RailAttentionRow({ item, styles, colors, busy, onRowPress, actionFor }: {
  item: AttentionItem;
  styles: Styles;
  colors: ThemeColors;
  busy: boolean;
  onRowPress: (item: AttentionItem) => void;
  actionFor: (item: AttentionItem, access: RowAccess) => RailAction | null;
}) {
  const access = useProjectAccess(item.projectId);
  const act = actionFor(item, access);
  const rowBody = (
    <>
      <View style={[styles.severityDot, { backgroundColor: severityColor(item.severity, colors) }]} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>{item.message}</Text>
      </View>
      <ChevronRight size={14} color={colors.textMuted} strokeWidth={1.75} />
    </>
  );
  if (!act) {
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => onRowPress(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        testID={`rail-row-${item.id}`}
      >
        {rowBody}
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.rowLine}>
      <TouchableOpacity
        style={styles.rowMain}
        onPress={() => onRowPress(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        testID={`rail-row-${item.id}`}
      >
        {rowBody}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.rowAction, (busy || act.locked) && styles.rowActionMuted]}
        onPress={() => { if (!busy) void act.run(); }}
        disabled={busy}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={act.locked ? `${act.label} — not on your plan; tap to see why` : `${act.label}: ${item.message}`}
        testID={`rail-action-${item.id}`}
      >
        {act.locked ? <Lock size={11} color={colors.textMuted} strokeWidth={2} /> : null}
        <Text style={[styles.rowActionText, act.locked && styles.rowActionTextMuted]}>
          {busy ? 'Sending…' : act.label}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/** One rail section: a 13 px caption header, its rows, and 'See all N' to its
 *  /attention view when it holds more than it shows. */
function RailSection({ title, total, view, testID, styles, onSeeAll, children }: {
  title: string;
  total: number;
  view: 'bill' | 'logs' | 'warranty';
  testID: string;
  styles: Styles;
  /** The dock variant closes the dock as 'See all' lands on /attention. */
  onSeeAll?: () => void;
  children: React.ReactNode;
}) {
  const shown = React.Children.count(children);
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionCaption} numberOfLines={1}>{title}</Text>
      <View style={styles.listWrap}>
        {children}
        {total > shown ? (
          <RowLink
            href={routeHref('/attention', { view })}
            accessibilityLabel={`See all ${total}`}
            testID={`${testID}-see-all`}
            {...(onSeeAll ? { onPress: onSeeAll } : null)}
          >
            <Text style={styles.moreText}>See all {total}</Text>
          </RowLink>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  rail: {
    backgroundColor: t.bg,
    borderLeftWidth: 1,
    borderLeftColor: t.line,
  },
  // Inside the dock: fill the panel; SidePanel already draws the left rule.
  railDock: { flex: 1, borderLeftWidth: 0 },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 16,
  },
  scrollContentDock: { paddingTop: Layout.cardPad },
  section: {
    marginTop: 20,
  },
  sectionCaption: {
    ...Type.footnoteEmphasized,
    color: t.textSecondary,
    letterSpacing: 0.4,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 4,
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.1,
    flex: 1,
  },
  // The dock's lead line under SidePanel's 'Action Required' header.
  dockLead: {
    ...Type.footnoteEmphasized,
    color: t.textSecondary,
    flex: 1,
  },
  countPill: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.danger,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  countPillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.1,
  },
  emptyState: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: t.line,
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center' as const,
    gap: 8,
  },
  emptyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.successSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  emptySubtitle: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    textAlign: 'center' as const,
  },
  listWrap: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: t.line,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  // UX A7: a row with a trailing action — the same line, split in two so the
  // action is its own button (never a button inside a button on the web).
  rowLine: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingRight: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 6,
  },
  rowAction: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: t.accent,
  },
  rowActionMuted: { borderColor: t.line },
  rowActionText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.accent,
  },
  rowActionTextMuted: { color: t.textMuted },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.text,
    letterSpacing: -0.1,
  },
  moreText: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    fontWeight: '500' as const,
    paddingVertical: 10,
    paddingHorizontal: 14,
    textAlign: 'center' as const,
  },
});
