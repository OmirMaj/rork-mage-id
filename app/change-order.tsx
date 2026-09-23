import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, KeyboardAvoidingView, Modal, FlatList,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, useBrainFabLift } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, useNavigation, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, Trash2, X, FileText, Send, Search, Percent, BookUser, User, PenTool, AlertTriangle, Share2, RotateCcw,
} from 'lucide-react-native';
import { MageChangeOrder } from '@/components/icons';
import { ToolHeader, ToolProjectPicker } from '@/components/ToolScreenChrome';
import { CSIDivisionPicker } from '@/components/CSIDivisionPicker';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Button } from '@/components/ui/Button';
import { useProjects, type RecordWriteOutcome } from '@/contexts/ProjectContext';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { isMarkupSet, marginOf, type MarkupPct } from '@/utils/estimateMarkup';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState, type ProjectRole } from '@/hooks/useProjectRole';
import { useSafeBack } from '@/hooks/useSafeBack';
import { useAuth } from '@/contexts/AuthContext';
import Paywall from '@/components/Paywall';
import ContactPickerModal from '@/components/ContactPickerModal';
import InlineVoiceFill from '@/components/InlineVoiceFill';
import { StatusPipeline } from '@/components/StatusPipeline';
import { parseCOFromTranscript, mergeText, pickIfEmpty } from '@/utils/voiceFormParsers';
import { getLivePrices, resolvePricingMarket, catalogProvenanceLine, CATEGORY_META, type MaterialItem } from '@/constants/materials';
import { sendEmail, buildChangeOrderEmailHtml, type SendEmailOutcome } from '@/utils/emailService';
import AIChangeOrderImpact from '@/components/AIChangeOrderImpact';
import { nailIt } from '@/components/animations/NailItToast';
import TapeRollNumber from '@/components/animations/TapeRollNumber';
import { generateG714PDF, type G714Data, type CCDPaymentBasis } from '@/utils/aiaForms';
import type { ChangeOrderLineItem, ChangeOrder, ChangeOrderStatus, COApprover } from '@/types';
import { PortalStatusPill } from '@/components/PortalStatusPill';
import { SendToClientButton } from '@/components/SendToClientButton';
import { COScheduleReflowPreviewModal } from '@/components/schedule/COScheduleReflowPreviewModal';
import { resolveAiAffectedTaskIds } from '@/utils/coScheduleReflowCore';
import { formatMoney } from '@/utils/formatters';
import { changeOrderBillingState } from '@/utils/changeOrderBilling';
import { portalShareUrl } from '@/utils/portalSnapshot';
import { freezeForPortal } from '@/utils/portalFreeze';
import { formatCalendarDay, calendarDayOf } from '@/utils/calendarDate';
import { nextChangeOrderNumber } from '@/utils/coNumbering';
import { coApprovalLine } from '@/utils/coApproval';
import { generateChangeOrderPDF } from '@/utils/pdfGenerator';
import { useServerChangeOrderNumber, coNumberHoldReason } from '@/hooks/useServerChangeOrderNumber';

// The CO pipeline (and its side branches) is coPipelineFor, in the co-w4
// block below — it used to map rejected/void onto 'Submitted' (#73).

// The turnarounds a residential/light-commercial owner is actually given on a
// change-order decision. Offered as chips because typing a number into a modal
// while you are trying to send something is friction that gets skipped — and a
// skipped answer is the `basis: 'none'` state the follow-up engine has been
// stuck in. Tapping the lit chip clears it back to "no turnaround agreed",
// which must stay reachable: it is a real answer, not a missing one.
const CO_TURNAROUND_CHOICES = [3, 5, 7, 14] as const;

import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { showAlert } from '@/utils/alert';
import { cardSurface } from '@/components/ui';

/**
 * The CO fields frozen at save/send (#129, #131). Declared here and SPREAD
 * into the record, so this screen compiles before and after types/index.ts
 * gains them (the context lane adds them, and maps them to the
 * 20260919110000 migration's columns). Optional: a CO saved before this
 * carries none, and readers fall back instead of inventing a zero.
 */
type COFrozenFields = {
  taxRatePct?: number;
  taxAmount?: number;
  totalWithTax?: number;
  priorApprovedChangesTotal?: number;
};

function createId(_prefix: string): string {
  return generateUUID();
}

export default function ChangeOrderScreen() {
  const router = useRouter();
  const { coId, projectId: paramProjectId, prefillDescription } = useLocalSearchParams<{ coId?: string; projectId?: string; prefillDescription?: string }>();
  const { changeOrders, projects: allProjects } = useProjects();
  const { user: authUser } = useAuth();
  // The job this link is about, when it names one: the URL's project, else the
  // named CO's. A link with neither (sidebar, Tools) has no job yet — the
  // editor's own picker asks, and the role gate runs again inside it.
  const gateProjectId = paramProjectId || (coId ? changeOrders.find(c => c.id === coId)?.projectId : undefined) || undefined;
  const roleState = useProjectRoleState(gateProjectId);
  // useProjectAccess, not the bare tier: on a job he OWNS this is his own tier,
  // exactly as before; the collaborator branch never reaches it (below).
  const { canAccess } = useProjectAccess(gateProjectId);
  // #41 — the role decision runs BEFORE the tier paywall. A foreman on a free
  // account used to meet a "Change Orders — Pro" paywall here, which upgrading
  // would not have fixed: a CO written from his account is invisible to the GC.
  const roleGate = coRoleGate({
    hasProject: !!gateProjectId,
    role: roleState.role,
    isLoading: roleState.isLoading,
    isError: roleState.isError,
    stampedRole: gateProjectId ? allProjects.find(p => p.id === gateProjectId)?.myRole : undefined,
    ownedLocally: coOwnedLocally(gateProjectId ? allProjects.find(p => p.id === gateProjectId)?.ownerUserId : undefined, authUser?.id),
  });
  const blockedRole = roleState.role ?? (gateProjectId ? allProjects.find(p => p.id === gateProjectId)?.myRole ?? null : null);
  if (roleGate !== 'open') {
    return (
      <CoRoleBlocked
        gate={roleGate}
        role={blockedRole}
        projectId={gateProjectId}
        prefillDescription={prefillDescription}
        onRetry={roleState.refetch}
      />
    );
  }
  if (!canAccess('change_orders_invoicing')) {
    return (
      <Paywall
        visible={true}
        feature="Change Orders"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <ChangeOrderGate />;
}

/**
 * What a collaborator (or a role still resolving) sees instead of the editor.
 * Says WHY, and for a seat that files daily reports, where the extra work goes
 * instead: the daily report is a surface the project owner reads, so the scope
 * reaches him — a CO written from this account would not (#41).
 */
function CoRoleBlocked({ gate, role, projectId, prefillDescription, onRetry }: {
  gate: Exclude<CoRoleGate, 'open'>;
  role: ProjectRole;
  projectId: string | undefined;
  prefillDescription: string | undefined;
  onRetry: () => void;
}) {
  const router = useRouter();
  const goBack = useSafeBack();
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const copy = coRoleBlockedCopy(gate, role);
  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ToolHeader eyebrow="CHANGE ORDERS · MAGE ID" title="Change Order" />
      <View style={styles.gateBody}>
        {gate === 'loading' ? (
          <Text style={styles.gateText}>{copy.body}</Text>
        ) : (
          <>
            <AlertTriangle size={22} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.gateTitle}>{copy.title}</Text>
            <Text style={styles.gateText}>{copy.body}</Text>
            {!!prefillDescription && gate === 'collaborator' && (
              <View style={styles.gatePrefillBox}><Text style={styles.gatePrefill} selectable>{prefillDescription}</Text></View>
            )}
            {gate === 'error' && <Button label="Try again" variant="primary" onPress={onRetry} />}
            {gate === 'collaborator' && copy.canFileReport && !!projectId && (
              <Button
                label="Log it in a daily report"
                variant="primary"
                onPress={() => router.replace({
                  pathname: '/daily-report',
                  // fieldIssue carries the extra work into the report's
                  // field-issue note (dfr-screen reads it), so the owner gets
                  // the scope without him retyping it.
                  params: prefillDescription ? { projectId, fieldIssue: prefillDescription } : { projectId },
                })}
                testID="co-collab-daily-report"
              />
            )}
            <Button label="Back" variant="secondary" onPress={goBack} />
          </>
        )}
      </View>
    </View>
  );
}

// >>> co-deep-link-gate (pure; scripts/validate-notification-routes.ts evaluates this block)
/** How long a named CO may still be arriving AFTER the change-order list has
 *  loaded — a CO written a moment ago (the voice mic drafts one and opens it
 *  250 ms later) can still be committing. The wait itself is on the query
 *  settling (`changeOrdersLoaded`), not on this clock: a slow signal can take
 *  far longer than 4 s, and a fixed timer showed "missing" for a CO that exists. */
const CO_ARRIVAL_GRACE_MS = 4000;

/**
 * What a link naming a change order (`?coId=`) should show. A push, an email
 * button or the inbox names an EXISTING change order; before this gate the
 * screen rendered the blank "New Change Order" form whenever that CO was not
 * in memory yet (or not at all), numbered as the next CO on the job — a GC who
 * filled it in believing it was the signed one created a duplicate CO number
 * (audit round 2, #12). The editor also seeds its fields from the CO once, at
 * mount, so it must not mount until the CO is there.
 */
function coGateState(opts: {
  coId: string | null;
  found: boolean;
  /** The editor will resolve a project (the CO's, or the URL's projectId). */
  needsProject: boolean;
  projectsLoaded: boolean;
  changeOrdersLoaded: boolean;
  graceOver: boolean;
}): 'editor' | 'loading' | 'missing' {
  // The editor must not mount before the project list either: until it lands
  // `getProject` is null, so a URL projectId shows the "that project is gone"
  // picker and the CO's contract value reads $0.
  if (opts.needsProject && !opts.projectsLoaded) return 'loading';
  if (!opts.coId) return 'editor';
  // A named CO waits for THIS account's change orders even when it is already
  // "found": on a cold start the signed-out pass fills changeOrders from the
  // device cache first, so a hit can be a stale copy — and the editor seeds
  // once and never re-seeds when the newer server row lands under the same
  // id, so Save would write the old copy back. `changeOrdersLoaded` is keyed
  // by account and is already true in normal in-app use (the mic's own CO).
  if (!opts.changeOrdersLoaded) return 'loading';
  if (opts.found) return 'editor';
  if (!opts.projectsLoaded || !opts.graceOver) return 'loading';
  return 'missing';
}
// <<< co-deep-link-gate

// >>> co-send-outcome (pure; scripts/validate-records-open-before-load.ts evaluates this block)
/** Why this form cannot be saved, or null. Run BEFORE the email goes out:
 *  it used to run inside the save, after the send — so an email could reach
 *  the client and then the save be refused ("No Items"), leaving a CO number
 *  in the client's inbox that exists nowhere. */
export function coSaveBlocker(o: { description: string; lineItemCount: number }): { title: string; message: string } | null {
  if (!o.description.trim()) return { title: 'Missing Description', message: 'Please enter a description for this change order.' };
  if (o.lineItemCount === 0) return { title: 'No Items', message: 'Please add at least one line item.' };
  return null;
}

/** The status Send & Save writes, from what the email ACTUALLY did. Only a
 *  real send submits (and starts the client-approval clock). A composer that
 *  merely opened, or a failed send, keeps the CO where it was — a draft stays
 *  a draft, an already-submitted CO is not downgraded. */
export function coStatusForSend(email: SendEmailOutcome, existing: ChangeOrderStatus | undefined): ChangeOrderStatus {
  if (email === 'sent') return 'submitted';
  return existing && existing !== 'draft' ? existing : 'draft';
}

/** A write still unanswered after this long is reported as "on this device,
 *  still reaching MAGE" rather than holding the alert hostage to a dead signal. */
export const CO_WRITE_REPORT_TIMEOUT_MS = 8000;

/**
 * The one message Send & Save shows. It states the email's outcome and the
 * save's outcome SEPARATELY, and never says "saved" or "sent" for something
 * that did not happen. It used to read "Change order saved but email could not
 * be sent" on a failed send — when the function had returned before saving
 * anything, so backing out lost the CO.
 */
export function coSendReport(o: {
  number: number;
  email: SendEmailOutcome;
  emailError?: string;
  status: ChangeOrderStatus;
  write: RecordWriteOutcome | 'pending';
  recipient: string;
  /** #35 — what happened to the portal share Send & Save made (absent: none). */
  portal?: 'shared' | 'failed';
}): { title: string; message: string } {
  const where: Record<RecordWriteOutcome | 'pending', string> = {
    synced: '',
    // 'queued' is not always "offline": an update also queues behind an
    // earlier create still waiting on this device, while online (the email
    // just went out). Say what is known, not why.
    queued: ' It is saved on this device and will reach MAGE on the next sync.',
    pending: ' It is saved on this device and is still reaching MAGE.',
    local: ' It is saved on this device.',
    // 'failed' covers more than one cause — a refusal (RLS, validation), a
    // server error or outage, or a device that could not queue the write — and
    // this screen cannot tell which, so it names none (never a guess as fact).
    // What IS known: nothing reached MAGE and nothing is queued, so the copy
    // on this device will not sync by itself. No "before you leave this
    // screen" either: this alert is read after the screen has already closed.
    failed: ' MAGE could not save it, so it is on this device only and will not sync by itself — the next refresh from MAGE can drop it. Keep a copy of its details.',
  };
  if (o.email === 'sent') {
    return {
      title: o.write === 'failed' ? 'Sent — not saved to MAGE' : 'Sent',
      message: `CO #${o.number} was emailed${o.recipient ? ` to ${o.recipient}` : ''} for approval.${o.write === 'synced' ? ' It is saved.' : where[o.write]}`
        + (o.portal === 'shared' ? ' It is on the client portal for them to review and sign.' : '')
        + (o.portal === 'failed' ? ' It could NOT be put on the client portal, so the link in the email will not show it yet — open this change order and tap Send to client portal.' : ''),
    };
  }
  // Never "saved" for a write MAGE refused — the tail below says where it is.
  const saved = o.write === 'failed'
    ? `CO #${o.number} was not saved to MAGE`
    : o.status === 'draft' ? `CO #${o.number} is saved as a draft` : `CO #${o.number} is saved`;
  const reason = o.email === 'composer_opened'
    ? (o.emailError || 'a draft opened in your email app — press Send there')
    : (o.emailError || 'the email service could not be reached');
  // A composer that opened may still be sent from his mail app — MAGE cannot
  // see that, so the CO stays a draft; tell him the step that makes it count.
  const markIt = o.email === 'composer_opened' && o.status === 'draft'
    ? ' Once you have sent it from your mail app, open this change order and tap Mark submitted.'
    : '';
  return {
    title: 'Email not sent',
    message: `${saved}, but the email was NOT sent: ${reason.replace(/[.\s]+$/, '')}.${where[o.write]}${markIt}`,
  };
}

/** The close button a send that finished OFF-screen leaves behind. It states
 *  the same outcome as coSendReport's alert — never "Sent" for an email that
 *  did not go out (a failed send or a composer that only opened). */
export function coSendFinishedLabel(email: SendEmailOutcome, write: RecordWriteOutcome | 'pending'): string {
  if (email !== 'sent') return 'Not sent — close';
  return write === 'failed' ? 'Sent, not saved — close' : 'Sent — close';
}
// <<< co-send-outcome

// >>> co-wave3 (pure; scripts/validate-change-orders-wave3.ts evaluates this block)
/** Money is whole cents where it is COMPUTED, not only where it is printed
 *  (same rule as utils/invoiceBilling.roundCents — repeated here because this
 *  block is evaluated on its own by the validator). */
export function coRoundCents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export type CoRoleGate = 'open' | 'loading' | 'error' | 'no_access' | 'collaborator';

/**
 * #41 — who may open the change-order editor on a job. Only the PROJECT OWNER
 * writes change orders for now (a founder decision is open on editor seats):
 * a CO inserted from a collaborator's account is stored under HIS user_id, and
 * every change_orders SELECT policy is `auth.uid() = user_id`, so the GC never
 * sees it. The server now refuses that insert too
 * (20260919110000_change_orders_owner_insert_and_tax_freeze.sql).
 *
 * The gating contract: spin only while the role is loading, offer a retry on
 * an error, and a null role that is neither is NO ACCESS — said, never spun.
 * No job yet (the sidebar entry) is 'open': the editor's picker asks, and the
 * same gate runs again on the picked job.
 */
export function coRoleGate(o: { hasProject: boolean; role: string | null; isLoading: boolean; isError: boolean; stampedRole?: string | null; ownedLocally?: boolean }): CoRoleGate {
  if (!o.hasProject) return 'open';
  // The project list's own stamp (Project.myRole) is only ever set on a job
  // shared WITH him, so it is proof of a collaborator seat without waiting on
  // the collaborator read — or on a failed one. Its absence proves nothing
  // (old caches predate it), so it can only block, never open.
  if (o.stampedRole === 'editor' || o.stampedRole === 'viewer' || o.stampedRole === 'field') return 'collaborator';
  // The OWNER must never depend on the network: on a job site with no signal
  // the collaborator read fails (native) or pauses forever (web), and the GC
  // would be locked out of his own change orders. The device copy of the job
  // carries ownerUserId (ProjectContext persists it for exactly this offline
  // case — same rule as fieldTicketCore.pricingRoleFor), so a job whose stored
  // owner is the signed-in user opens without waiting on the read.
  if (o.ownedLocally) return 'open';
  if (o.isLoading) return 'loading';
  if (o.isError) return 'error';
  if (o.role === 'owner') return 'open';
  if (o.role === 'editor' || o.role === 'viewer' || o.role === 'field') return 'collaborator';
  return 'no_access';
}

/** The job's stored owner is the signed-in user. Both ids must be present:
 *  a cache predating ownerUserId, or no session, proves nothing. */
export function coOwnedLocally(ownerUserId: string | null | undefined, userId: string | null | undefined): boolean {
  return !!ownerUserId && !!userId && ownerUserId === userId;
}

export function coRoleBlockedCopy(gate: Exclude<CoRoleGate, 'open'>, role: string | null): { title: string; body: string; canFileReport: boolean } {
  if (gate === 'loading') return { title: '', body: 'Checking your role on this job…', canFileReport: false };
  if (gate === 'error') {
    return {
      title: 'Could not check your role on this job',
      body: 'MAGE could not load who is on this project, so it cannot tell whether you may write change orders here. Check your connection and try again.',
      canFileReport: false,
    };
  }
  if (gate === 'no_access') {
    return {
      title: 'You are not on this job',
      body: 'This project is not shared with your account (or your access was removed), so you cannot open its change orders.',
      canFileReport: false,
    };
  }
  const canFileReport = role === 'field' || role === 'editor';
  return {
    title: 'Your GC creates change orders on this job',
    body: canFileReport
      ? 'Send it as a field issue instead: log the extra work in a daily report, and the project owner sees it there and writes the change order. A change order written from your account would not reach your GC.'
      : 'Your seat on this project is view-only. Tell the project owner about the extra work so they can write the change order.',
    canFileReport,
  };
}

/**
 * #38 — the status a save writes. A plain "Save to Project" on a CO already
 * out for approval KEEPS its status: it used to write 'draft' over a
 * submitted, in-review or revised CO, which dropped it out of follow-up
 * tracking and took the sign button off the portal. Only a real submission
 * changes the status; a brand-new CO takes what was asked for.
 */
export function coPlainSaveStatus(requested: ChangeOrderStatus, existing: ChangeOrderStatus | undefined): ChangeOrderStatus {
  if (!existing) return requested;
  if (requested === 'draft') return existing;
  return requested;
}

/** Was the client already sent this CO (it is waiting on them)? */
export function coIsOutForApproval(status: ChangeOrderStatus | undefined): boolean {
  return status === 'submitted' || status === 'under_review' || status === 'revised';
}

/** #38 — did this save change what the client is being asked to approve? */
export function coPricedEditChanged(
  before: { changeAmount: number; lineItems: { quantity: number; unitPrice: number; total: number; name: string }[] },
  after: { changeAmount: number; lineItems: { quantity: number; unitPrice: number; total: number; name: string }[] },
): boolean {
  if (coRoundCents(before.changeAmount) !== coRoundCents(after.changeAmount)) return true;
  if (before.lineItems.length !== after.lineItems.length) return true;
  return before.lineItems.some((b, i) => {
    const a = after.lineItems[i];
    return b.name !== a.name || b.quantity !== a.quantity || coRoundCents(b.unitPrice) !== coRoundCents(a.unitPrice);
  });
}

/** #38 — the message a save shows; never "saved to project" over a CO that is
 *  still waiting on the client, and never silent about stale numbers. */
export function coSaveMessage(o: {
  number: number;
  isUpdate: boolean;
  requested: ChangeOrderStatus;
  next: ChangeOrderStatus;
  recipientInfo: string;
  pricedEditOnSentCO: boolean;
}): { title: string; message: string } {
  if (o.requested === 'submitted') {
    return { title: o.isUpdate ? 'Updated' : 'Saved', message: `Change Order #${o.number} has been submitted for approval${o.recipientInfo}.` };
  }
  if (o.isUpdate && coIsOutForApproval(o.next)) {
    return {
      title: 'Saved',
      message: `Change Order #${o.number} is saved — still awaiting approval.` + (o.pricedEditOnSentCO
        ? ' You changed its price or lines: your client still sees the numbers you sent until you re-send it (Send & Save, or Send to client portal).'
        : ''),
    };
  }
  return { title: o.isUpdate ? 'Updated' : 'Saved', message: `Change Order #${o.number} has been saved to the project.` };
}

/**
 * #125 — the client's decline, as the CO screen shows it: who, when, and the
 * reason they gave. The newest rejected Client approver first (the in-app
 * client-view signing path writes it there), else the newest portal decline in
 * the audit trail (the reconciler writes that — and when the GC had already
 * marked the CO rejected it writes NO approver row, so the trail is the only
 * copy). `when` is the raw stored value; the screen formats it as a calendar day.
 */
export function coDeclineLine(co: {
  status: ChangeOrderStatus;
  approvers?: { role: string; status: string; name?: string; email?: string; responseDate?: string; rejectionReason?: string }[];
  auditTrail?: { action: string; actor: string; timestamp: string; detail?: string }[];
}): { who: string; when: string | null; reason: string | null } | null {
  if (co.status !== 'rejected') return null;
  const audit = [...(co.auditTrail ?? [])]
    .filter(e => e.action === 'declined_via_portal')
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
  const auditNote = audit?.detail ? audit.detail.replace(/^Note:\s*/, '').trim() || null : null;
  const approver = [...(co.approvers ?? [])]
    .filter(a => a.role === 'Client' && a.status === 'rejected')
    .sort((a, b) => String(b.responseDate ?? '').localeCompare(String(a.responseDate ?? '')))[0];
  if (approver) {
    return {
      who: approver.name?.trim() || approver.email?.trim() || 'the client',
      when: approver.responseDate ?? audit?.timestamp ?? null,
      reason: approver.rejectionReason?.trim() || auditNote,
    };
  }
  if (audit) return { who: audit.actor?.trim() || 'the client', when: audit.timestamp ?? null, reason: auditNote };
  return null;
}

/** #126 — a Qty/Price box accepts a partial number while it is being typed:
 *  '45.', '-', '.5', '-12.' — never a letter or a second point. */
export function coLineDraftAccepts(s: string): boolean {
  return /^-?\d*\.?\d*$/.test(s);
}

/** The number a draft holds, or null while it holds none yet ('', '-', '.').
 *  null is not zero: an emptied box is not a $0 line. */
export function coParseLineDraft(s: string): number | null {
  if (!/\d/.test(s)) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** A Qty/Price box that is showing NO number (emptied, or just '-' / '.')
 *  while the line underneath still carries its last one. Saving then would
 *  write a figure he can't see — and on iOS the Save tap does not blur the box
 *  (keyboardShouldPersistTaps='handled'), so the blur commit never ran. The
 *  save is refused with the line named instead. Returns that refusal, or null. */
export function coEmptyLineDraftBlocker(
  drafts: Record<string, { qty?: string; price?: string } | undefined>,
  items: { id: string; name: string }[],
): { title: string; message: string } | null {
  for (let i = 0; i < items.length; i++) {
    const d = drafts[items[i].id];
    if (!d) continue;
    const field = d.price !== undefined && coParseLineDraft(d.price) == null ? 'price'
      : d.qty !== undefined && coParseLineDraft(d.qty) == null ? 'quantity' : null;
    if (!field) continue;
    const label = items[i].name.trim() || `Line ${i + 1}`;
    return { title: `${label} has no ${field}`, message: `Type a ${field} for "${label}" (or remove the line) before saving.` };
  }
  return null;
}

/** Every line at a whole-cent price with a whole-cent total — run on blur and
 *  again before any save, so no fraction of a cent reaches the record. */
export function coCommitLineItems<T extends { quantity: number; unitPrice: number; total: number }>(items: T[]): T[] {
  return items.map(i => {
    const unitPrice = coRoundCents(i.unitPrice);
    return { ...i, unitPrice, total: coRoundCents(i.quantity * unitPrice) };
  });
}

/**
 * #127 — the basis line under an "Add from Estimate" row, true to what the add
 * path will actually do. unitSell != null FIRST: such a line goes on at the
 * signed rate — at cost when that rate carries no markup (labor, assemblies,
 * Cost X-Ray and drawing lines are all-in by design) — so "+ your N% markup"
 * is only ever said for a legacy cost-only line, where it really is applied.
 */
export function coEstimatePickBasis(
  item: { unitCost: number; unitSell: number | null; markupPct: number | null },
  seedMarkupPct: number | null,
  money: (n: number) => string,
): string {
  if (item.unitSell != null) {
    if (item.markupPct != null && item.markupPct > 0) {
      return `Your cost ${money(item.unitCost)} + ${Math.round(item.markupPct)}% — the rate on the signed estimate`;
    }
    return `Your cost ${money(item.unitCost)} — at your cost — no markup on the signed estimate, so it goes on the change order at cost`;
  }
  if (seedMarkupPct != null && Number.isFinite(seedMarkupPct) && seedMarkupPct > 0) {
    return `Your cost ${money(item.unitCost)} + your ${Math.round(seedMarkupPct)}% markup — this line carries none on the estimate`;
  }
  return 'This is your cost. No markup is set, so it goes on the change order at what it costs you.';
}

/**
 * #129 — "Net change by previously authorized change orders" (AIA G701): the
 * approved COs numbered BELOW this one. Not "every other approved CO": reopening
 * CO #1 after CO #2 was approved pulled CO #2 into CO #1's base.
 */
export function coPriorApprovedChanges(
  cos: { id: string; number: number; status: string; changeAmount: number }[],
  thisNumber: number,
  thisId: string | null | undefined,
): number {
  return coRoundCents(cos
    .filter(c => c.status === 'approved' && c.id !== thisId && (c.number || 0) < thisNumber)
    .reduce((s, c) => s + (Number.isFinite(c.changeAmount) ? c.changeAmount : 0), 0));
}

/**
 * #131 — the tax frozen onto a CO when it goes out for approval, so the screen,
 * the email, the portal and the invoice read ONE number even if the rate in
 * settings changes later. Sign-aware for a credit CO.
 */
export function coTaxFreeze(changeAmount: number, ratePct: number): { taxRatePct: number; taxAmount: number; totalWithTax: number } {
  const rate = Number.isFinite(ratePct) && ratePct > 0 ? ratePct : 0;
  const amount = coRoundCents(changeAmount);
  const taxAmount = coRoundCents(amount * (rate / 100));
  return { taxRatePct: rate, taxAmount, totalWithTax: coRoundCents(amount + taxAmount) };
}

/** #130/#128 — ONE parse of the Schedule Impact box, shared by the save, the
 *  G714 and the confirm prompt so they cannot disagree. Empty or 0 is
 *  undefined — "to be determined", never "+0 days". */
export function coParseImpactDays(s: string): number | undefined {
  const d = parseInt(s, 10);
  return Number.isFinite(d) && d > 0 ? d : undefined;
}

export type CoImpactDaysSource = 'user' | 'ai' | 'voice' | null;

/**
 * #128 — the days a save or send must have him confirm first, or null. The
 * autofill stays (a GC on site should not have to tap a chip), but a number
 * the model guessed or parsed and nobody touched never reaches the saved CO or
 * the client unconfirmed: it is the time extension the client signs.
 */
export function coImpactDaysNeedsConfirm(o: { source: CoImpactDaysSource; value: string }): number | null {
  if (o.source !== 'ai' && o.source !== 'voice') return null;
  return coParseImpactDays(o.value) ?? null;
}

/** #128 — the line under the Schedule Impact box while it holds a fill. */
export function coImpactDaysHelper(source: CoImpactDaysSource, value: string): string | null {
  const d = coParseImpactDays(value);
  if (d == null) return null;
  if (source === 'ai') return `AI estimate: +${d} day${d === 1 ? '' : 's'} — check before sending. This is the number the client signs.`;
  if (source === 'voice') return `Heard: +${d} day${d === 1 ? '' : 's'} — check before sending. This is the number the client signs.`;
  return null;
}

/**
 * #35 — whether Send & Save may put this CO on the client portal and name the
 * portal in the email. Decided BEFORE the email goes out, from the project's
 * portal: it must be on, have a working share link (portalId + access token),
 * and show change orders. Anything else gets the reply-by-email wording only.
 */
export function coPortalShare(o: {
  shareUrl: string | null;
  showChangeOrders: boolean | undefined;
  requirePasscode: boolean | undefined;
  snapshotFits: boolean;
}): { portalUrl: string; portalNeedsPasscode: boolean } | null {
  if (!o.shareUrl) return null;
  // utils/portalSnapshot builds the CO section only when this is TRUE — an
  // unset flag is a hidden section, so it is not a portal to point at.
  if (o.showChangeOrders !== true) return null;
  if (!o.snapshotFits) return null;
  return { portalUrl: o.shareUrl, portalNeedsPasscode: o.requirePasscode === true };
}
// <<< co-wave3

// >>> co-w4 (pure; scripts/validate-w4-co-workflow-screen.ts evaluates this block)
type CoW4Status = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'revised' | 'void';
type CoW4Line = { id: string; name: string; description?: string; quantity: number; unit?: string; unitPrice: number; total: number; priceSource?: 'ai_estimated' | 'needs_price' };

/**
 * The pipeline this CO shows, and whether it offers a one-tap advance.
 * #73: rejected and void used to be drawn as "Submitted" (mapCOStatus) and the
 * pipeline then offered "Mark in review" — one tap revived a declined or voided
 * CO with no revision record. They are now drawn as what they are, a terminal
 * side branch, with no advance. 'revised' is out for approval again: it sits
 * at In Review and may only go on to Approved (through the confirm, #79).
 */
export function coPipelineFor(status: CoW4Status): {
  stages: { key: CoW4Status; label: string; terminal?: boolean }[];
  current: CoW4Status;
  canAdvance: boolean;
} {
  const head: { key: CoW4Status; label: string; terminal?: boolean }[] = [
    { key: 'draft', label: 'Draft' },
    { key: 'submitted', label: 'Submitted' },
    { key: 'under_review', label: 'In Review' },
  ];
  if (status === 'rejected') return { stages: [...head, { key: 'rejected', label: 'Declined', terminal: true }], current: 'rejected', canAdvance: false };
  if (status === 'void') return { stages: [...head, { key: 'void', label: 'Void', terminal: true }], current: 'void', canAdvance: false };
  return {
    stages: [...head, { key: 'approved', label: 'Approved', terminal: true }],
    current: status === 'revised' ? 'under_review' : status,
    canAdvance: status !== 'approved',
  };
}

/** #79 — the confirm before a CO is marked approved from this screen. */
export function coApproveConfirmCopy(number: number | null, amount: number, money: (n: number) => string): { title: string; message: string } {
  const label = number != null ? `CO #${number}` : 'this change order';
  return {
    title: `Approve ${label}?`,
    message: amount < 0
      ? `This credits ${money(Math.abs(amount))} back to the contract. Mark it approved only if your client agreed to it — there is no client signature on this path.`
      : `This commits ${money(amount)} to the contract. Mark it approved only if your client agreed to it — there is no client signature on this path.`,
  };
}

/**
 * #42 — the line under the tax rows, keyed on the CO's STATUS. The rate is
 * frozen when the CO goes OUT (a send, or Mark submitted), not when the client
 * approves it, so "your client approved this" was said of COs still waiting on
 * them and of COs they declined. Two sentences say "at your Settings rate on
 * that day" (the validator counts them): the approved and out-for-approval
 * wordings share one variable, the draft wording carries the other.
 */
export function coTaxNote(status: CoW4Status | undefined, frozenRatePct: number | undefined, ratePct: number): string {
  const billing = 'Tax is added when you bill it on a progress invoice, at your Settings rate on that day';
  if (frozenRatePct == null || !status || status === 'draft') {
    return 'Sales tax is added when you bill this change on a progress invoice, at your Settings rate on that day. The rate shown here is recorded on the change order when you send it, as the one your client is asked to approve.';
  }
  if (status === 'approved') {
    return `Your client approved this change at ${ratePct}% sales tax. ${billing} — if that rate has changed, the invoice total will differ from the approved one.`;
  }
  if (status === 'rejected' || status === 'void') {
    return `Sent at ${ratePct}% sales tax; your client did not approve it${status === 'void' ? ' (voided)' : ''}.`;
  }
  return `Sent at ${ratePct}% sales tax — the rate your client is being asked to approve. ${billing} — if that rate has changed, the invoice total will differ from the total you sent.`;
}

/**
 * #76 — route param prefillLines (CONTRACT 9): a JSON array of
 * { name, description, quantity, unit, unitPrice, priceSource? }, one CO line
 * each. Anything malformed is dropped, never guessed. Legacy prefillAmount (a
 * single lump line) is still honoured when no prefillLines came.
 */
export function coPrefillLines(
  raw: string | undefined,
  legacy: { amount?: string; reason?: string; description?: string },
  newId: () => string,
): CoW4Line[] | null {
  if (raw) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (Array.isArray(parsed)) {
      const lines: CoW4Line[] = [];
      for (const p of parsed) {
        if (!p || typeof p !== 'object') continue;
        const o = p as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name.trim() : '';
        if (!name) continue;
        const qtyRaw = typeof o.quantity === 'number' ? o.quantity : Number(o.quantity);
        const quantity = Number.isFinite(qtyRaw) && qtyRaw !== 0 ? qtyRaw : 1;
        const priceRaw = typeof o.unitPrice === 'number' ? o.unitPrice : Number(o.unitPrice);
        const unitPrice = Number.isFinite(priceRaw) ? Math.round(priceRaw * 100) / 100 : 0;
        const src = o.priceSource === 'ai_estimated' || o.priceSource === 'needs_price' ? o.priceSource : undefined;
        lines.push({
          id: newId(), name,
          description: typeof o.description === 'string' ? o.description : '',
          quantity, unit: typeof o.unit === 'string' && o.unit.trim() ? o.unit.trim() : 'ls',
          unitPrice, total: Math.round(quantity * unitPrice * 100) / 100,
          // A $0 line from a prefill is unpriced whatever it was tagged.
          ...(src ? { priceSource: src } : unitPrice === 0 ? { priceSource: 'needs_price' as const } : {}),
        });
      }
      if (lines.length > 0) return lines;
    }
  }
  const amt = Number(legacy.amount);
  if (legacy.amount && Number.isFinite(amt) && amt > 0) {
    return [{
      id: 'overage-prefill',
      name: legacy.reason === 'out_of_scope' ? 'Out-of-scope work' : 'Allowance overage',
      description: legacy.description ?? 'Allowance overage',
      quantity: 1, unit: 'ls', unitPrice: amt, total: amt,
    }];
  }
  return null;
}

/**
 * #76 — a CO may not go to the client while a line has no price or carries a
 * price nobody confirmed. 'refuse' = cannot be sent at all (a line tagged
 * needs_price, or a description still carrying an internal "NEEDS PRICE"
 * note — drafts saved before this fix carry that text); 'confirm' = AI
 * estimates he must accept first (same idea as the schedule-days confirm).
 * A plain draft save runs neither. Credit lines (negative) are real prices.
 */
export function coUnconfirmedPriceBlocker(
  lines: readonly CoW4Line[],
  description: string,
  money: (n: number) => string,
): { kind: 'refuse'; title: string; message: string } | { kind: 'confirm'; title: string; message: string; lineIds: string[] } | null {
  if (/needs\s*price/i.test(description)) {
    return { kind: 'refuse', title: 'The description still says NEEDS PRICE', message: 'That note is internal and would go to your client as written. Price the work as line items and rewrite the description as the scope your client is approving.' };
  }
  // Only a line MAGE tagged 'needs_price' (a daily-report or leak-sweep draft
  // line nobody priced) is refused. An untagged $0 line is one he typed on
  // purpose — a time-extension-only CO or a "no charge" line — and must still
  // be sendable: refusing every $0 total left a time-only CO with no way out
  // ("remove the line" then trips coSaveBlocker's "at least one line item").
  const unpriced = lines.find(l => l.priceSource === 'needs_price');
  if (unpriced) {
    const label = unpriced.name.trim() || `Line ${lines.indexOf(unpriced) + 1}`;
    return { kind: 'refuse', title: `${label} has no price`, message: `Type a price for "${label}" (or remove the line) before this goes to your client.` };
  }
  const ai = lines.filter(l => l.priceSource === 'ai_estimated');
  if (ai.length > 0) {
    const list = ai.slice(0, 4).map(l => `${l.name.trim() || 'Line'} ${money(l.total)}`).join(', ') + (ai.length > 4 ? `, and ${ai.length - 4} more` : '');
    return {
      kind: 'confirm',
      title: ai.length === 1 ? 'Keep the AI estimate?' : `Keep ${ai.length} AI estimates?`,
      message: `${list} ${ai.length === 1 ? 'was' : 'were'} priced by MAGE from your cost book, not by you. ${ai.length === 1 ? 'It goes' : 'They go'} to your client as the price they approve.`,
      lineIds: ai.map(l => l.id),
    };
  }
  return null;
}

/**
 * #78 — whether this write records the recipient and turnaround. A real send
 * submits and records them; a send that fell back to his mail app
 * ('composer_opened') records them too while the CO stays a draft, so "Mark
 * submitted" inherits them. A failed or cancelled send records nothing.
 */
export function coRecordsRecipient(o: { status: CoW4Status; composerOpened: boolean; recipient: string; recipientAddr: string }): boolean {
  return (o.status === 'submitted' || o.composerOpened) && (o.recipient.trim() !== '' || o.recipientAddr.trim() !== '');
}

/**
 * #73 + #77/#141 — whether the portal control may share this CO, and why not.
 * A declined or void CO is never re-shared as-is (the client got "New Change
 * Order from your builder" for a CO with no sign button); nor is one whose
 * number is still provisional, nor one with an unpriced line.
 */
export function coPortalSendGate(o: {
  status: CoW4Status | undefined;
  lineCount: number;
  numberHold: string | null;
  priceRefusal: string | null;
}): { canSend: boolean; reason?: string } {
  if (o.status === 'draft') {
    return { canSend: false, reason: 'Submit this change order for approval first (Send & Save, or Mark submitted) — the portal only asks your client to sign a submitted change order.' };
  }
  if (o.status === 'rejected') return { canSend: false, reason: 'Your client declined this change order. Use Revise & re-issue to send them a new version.' };
  if (o.status === 'void') return { canSend: false, reason: 'This change order is void, so it cannot go to your client.' };
  if (o.lineCount === 0) return { canSend: false, reason: 'Add at least one line item before sending.' };
  if (o.numberHold) return { canSend: false, reason: o.numberHold };
  if (o.priceRefusal) return { canSend: false, reason: o.priceRefusal };
  return { canSend: true };
}

/**
 * #77/#141 — the provider's copy still carries the number this device guessed
 * after the server gave the CO another. Anything built from that copy (the
 * portal share, the e-sign record) would print the duplicate, so it waits.
 */
export function coStaleNumberHold(localNumber: number | undefined, confirmedNumber: number | null): string | null {
  if (localNumber == null || confirmedNumber == null || localNumber === confirmedNumber) return null;
  return `MAGE numbered this change order #${confirmedNumber} (#${localNumber} was already used on this job). Tap Save to Project to update it on this device, then share it.`;
}

/** #72 — the manual approval line as the viewer reads it: his own mark says
 *  "by you"; anyone else's keeps the name from the audit trail. */
export function coApprovalLineForViewer<L extends { kind: string; who?: string; text: string }>(line: L, viewer: readonly (string | null | undefined)[]): L {
  if (line.kind !== 'manual' || !line.who) return line;
  const who = line.who.trim().toLowerCase();
  if (!viewer.some(v => !!v && v.trim().toLowerCase() === who)) return line;
  return { ...line, text: line.text.replace(`by ${line.who}`, 'by you') };
}

/** #74 — the Share PDF control: always shown, and says why when it can't run. */
export function coPdfAction(o: { saved: boolean; dirty: boolean; numberHold: string | null }): { enabled: boolean; label: string; reason?: string } {
  if (!o.saved) return { enabled: false, label: 'Share PDF', reason: 'Save the change order first — the PDF prints the saved change order.' };
  if (o.numberHold) return { enabled: false, label: 'Share PDF', reason: o.numberHold };
  if (o.dirty) return { enabled: true, label: 'PDF of last saved version', reason: 'You have unsaved changes — the PDF prints the change order as last saved.' };
  return { enabled: true, label: 'Share PDF' };
}

/** #74 — does the form differ from the saved CO (what the PDF would print)? */
export function coFormDirty(
  saved: { description: string; reason: string; scheduleImpactDays?: number; lineItems: readonly CoW4Line[] } | null | undefined,
  form: { description: string; reason: string; scheduleImpactDays?: number; lineItems: readonly CoW4Line[] },
): boolean {
  if (!saved) return false;
  if ((saved.description ?? '').trim() !== form.description.trim()) return true;
  if ((saved.reason ?? '').trim() !== form.reason.trim()) return true;
  if ((saved.scheduleImpactDays ?? undefined) !== (form.scheduleImpactDays ?? undefined)) return true;
  if (saved.lineItems.length !== form.lineItems.length) return true;
  return saved.lineItems.some((s, i) => {
    const f = form.lineItems[i];
    return s.name !== f.name || s.quantity !== f.quantity || Math.round(s.unitPrice * 100) !== Math.round(f.unitPrice * 100);
  });
}

/**
 * #73 — the NEW draft "Revise & re-issue" writes for a declined CO: the next
 * number, the same description, reason, lines and days, and a link back to the
 * declined one. Nothing the client saw is carried: no frozen tax (it re-freezes
 * when this one is sent), no portal state, no approvers — and the declined CO
 * keeps its own number, trail and decline.
 */
export function coRevisionDraft<L extends CoW4Line>(
  source: {
    id: string; number: number; projectId: string; description: string; reason: string;
    lineItems: readonly L[]; scheduleImpactDays?: number; scheduleImpactTaskIds?: string[];
    originalContractValue: number;
  },
  o: { id: string; number: number; nowIso: string; newId: () => string; actor: string },
) {
  const lineItems = source.lineItems.map(l => ({ ...l, id: o.newId() }));
  const changeAmount = Math.round(lineItems.reduce((s, l) => s + (Number.isFinite(l.total) ? l.total : 0), 0) * 100) / 100;
  return {
    id: o.id,
    number: o.number,
    projectId: source.projectId,
    date: o.nowIso,
    description: source.description,
    reason: source.reason,
    lineItems,
    originalContractValue: source.originalContractValue,
    changeAmount,
    newContractTotal: Math.round((source.originalContractValue + changeAmount) * 100) / 100,
    status: 'draft' as const,
    scheduleImpactDays: source.scheduleImpactDays,
    scheduleImpactTaskIds: source.scheduleImpactTaskIds,
    revisesChangeOrderId: source.id,
    auditTrail: [{
      id: o.newId(),
      action: 'revision_of_declined',
      actor: o.actor,
      timestamp: o.nowIso,
      detail: `Revises CO #${source.number}, which the client declined.`,
    }],
    createdAt: o.nowIso,
    updatedAt: o.nowIso,
  };
}
// <<< co-w4

function ChangeOrderGate() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { coId, projectId: paramProjectId } = useLocalSearchParams<{ coId?: string; projectId?: string }>();
  const { changeOrders, changeOrdersLoaded, projectsLoaded, retryRemoteReads } = useProjects();
  const target = useMemo(() => (coId ? changeOrders.find(c => c.id === coId) ?? null : null), [coId, changeOrders]);
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    if (!coId || target || !projectsLoaded || !changeOrdersLoaded || graceOver) return;
    const t = setTimeout(() => setGraceOver(true), CO_ARRIVAL_GRACE_MS);
    return () => clearTimeout(t);
  }, [coId, target, projectsLoaded, changeOrdersLoaded, graceOver]);

  const state = coGateState({
    coId: coId ?? null,
    found: !!target,
    needsProject: !!target || !!paramProjectId,
    projectsLoaded,
    changeOrdersLoaded,
    graceOver,
  });
  if (state === 'editor') {
    // Keyed on the CO so the editor re-seeds if the link changes underneath it;
    // the CO's own project wins over the URL's (a link may carry only coId).
    return <ChangeOrderInner key={target?.id ?? 'new'} projectIdOverride={target?.projectId} />;
  }
  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ToolHeader eyebrow="CHANGE ORDERS · MAGE ID" title="Change Order" />
      <View style={styles.gateBody}>
        {state === 'loading' ? (
          <Text style={styles.gateText}>Loading this change order…</Text>
        ) : (
          <>
            <AlertTriangle size={22} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.gateTitle}>This change order isn&apos;t on this device yet</Text>
            <Text style={styles.gateText}>
              The link names a change order that hasn&apos;t synced here, or was deleted. Nothing was
              opened in its place, so no new CO number was used.
            </Text>
            <Button label="Try again" variant="primary" onPress={() => { setGraceOver(false); retryRemoteReads(); }} />
            {!!paramProjectId && (
              <Button
                label="Open the project"
                variant="secondary"
                onPress={() => router.replace({ pathname: '/project-detail', params: { id: paramProjectId } })}
              />
            )}
          </>
        )}
      </View>
    </View>
  );
}

function ChangeOrderInner({ projectIdOverride }: { projectIdOverride?: string }) {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  // The action bar is position:absolute, so bottom padding cannot clear it —
  // measure it and lift the FAB by its height instead.
  const [bottomBarH, setBottomBarH] = useState(0);
  const onBottomBarLayout = useCallback((e: LayoutChangeEvent) => {
    setBottomBarH(e.nativeEvent.layout.height);
  }, []);
  // The CCD link row floats above the dock; the scroll padding clears both.
  const [ccdRowH, setCcdRowH] = useState(0);
  const onCcdRowLayout = useCallback((e: LayoutChangeEvent) => {
    setCcdRowH(e.nativeEvent.layout.height);
  }, []);
  const router = useRouter();
  const goBack = useSafeBack();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  // Reached from the sidebar (FINANCIALS ▸ Change Orders), Tools, universal
  // search or a deep link there is no projectId, so ToolProjectPicker sets one
  // locally (field-ticket pattern). A pick outranks the param so a STALE id in
  // the URL — deleted project, old shared link — can't make the picker inert.
  const { projectId: paramProjectId, coId, prefillReason, prefillDescription, prefillAmount, prefillLines, prefillScheduleDays, sendNext } = useLocalSearchParams<{
    projectId: string;
    coId?: string;
    prefillReason?: string;
    prefillDescription?: string;
    prefillAmount?: string;
    /** CONTRACT 9 — JSON lines, one CO line each (#76). */
    prefillLines?: string;
    prefillScheduleDays?: string;
    /** '1' = a new CO was just saved from Send & Save; reopen the send sheet
     *  once MAGE has confirmed its number (#77/#141). */
    sendNext?: string;
  }>();
  const {
    getProject, getChangeOrdersForProject, getInvoicesForProject, addChangeOrder, updateChangeOrder, contacts,
    projects, changeOrders: allChangeOrders, sendToClientPortal,
  } = useProjects();
  const { user: authUser } = useAuth();
  // #35 — Send & Save shares the CO to the portal AFTER its write. The
  // context's sendToClientPortal finds the item in the change-order list its
  // closure was built with, and writes the portal state over that list — so
  // it must be the closure from a render that already holds THIS save (an
  // older one throws "Item not found" for a new CO, or writes the pre-edit CO
  // back over the edit). Both refs are refreshed from the same render.
  const latestCOsRef = useRef(allChangeOrders);
  const sendToPortalRef = useRef(sendToClientPortal);
  useEffect(() => {
    latestCOsRef.current = allChangeOrders;
    sendToPortalRef.current = sendToClientPortal;
  }, [allChangeOrders, sendToClientPortal]);

  // The record's own project seeds the pick (the gate keys this editor on the
  // record, so it seeds once per record): a link may carry only the record id,
  // or a projectId that isn't the record's, and the record's job must win.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(projectIdOverride ?? null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const innerRoleState = useProjectRoleState(project ? projectId : undefined);
  const innerRoleGate = coRoleGate({
    hasProject: !!project,
    role: innerRoleState.role,
    isLoading: innerRoleState.isLoading,
    isError: innerRoleState.isError,
    stampedRole: project?.myRole,
    ownedLocally: coOwnedLocally(project?.ownerUserId, authUser?.id),
  });
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;
  const existingCOs = useMemo(() => getChangeOrdersForProject(projectId ?? ''), [projectId, getChangeOrdersForProject]);
  const existingCO = useMemo(() => coId ? existingCOs.find(c => c.id === coId) : null, [coId, existingCOs]);

  const nextCoNumber = useMemo(() => {
    if (existingCO) return existingCO.number;
    // A PROPOSAL (#77/#141): this device's max + 1. The server keeps it when
    // no other CO of the job holds it and moves a collider (20260920050000);
    // nothing client-facing prints it before useServerChangeOrderNumber has
    // read the server's number back.
    return nextChangeOrderNumber(existingCOs);
  }, [existingCOs, existingCO]);

  // #77/#141 — the saved CO's number as the SERVER has it. 'pending' while
  // its INSERT is still on this device; the email, the portal share and the
  // PDF wait for 'confirmed'.
  const serverNumber = useServerChangeOrderNumber(existingCO?.id, existingCO?.number);
  /** The number every client-facing output uses: the server's once known. */
  // 'edit_unsaved' (integration round 2): the CO is on MAGE with this number;
  // only a later edit is under Not saved — the number stands, sending waits.
  const confirmedNumber = existingCO ? ((serverNumber.state === 'confirmed' || serverNumber.state === 'edit_unsaved') ? serverNumber.number ?? existingCO.number : null) : null;
  const numberHold = useCallback(
    (action: 'email' | 'portal' | 'pdf') => (existingCO ? coNumberHoldReason(serverNumber.state, action) : null),
    [existingCO, serverNumber.state],
  );
  /** The number the G701 "prior approved changes" base is computed against. */
  const baseNumber = confirmedNumber ?? nextCoNumber;

  // #129 — AIA G701's three rows. This used to be ONE figure labelled
  // "Original Contract" that already carried every other approved CO, so CO #2
  // read $105,000 on a $100,000 contract — and reopening CO #1 after CO #2 was
  // approved pulled CO #2 into CO #1's base. Now: the original contract sum
  // (the signed estimate only), the net change by approved COs numbered BELOW
  // this one, and their sum.
  //
  // `originalContractValue` keeps its stored meaning — the contract sum just
  // before this CO (utils/wip's snapshot fallback, fieldTicketCore,
  // leakCoDraft and UniversalMicButton all write/read it that way); only the
  // filter is corrected, from "every other approved CO" to "the ones before it".
  const originalContractSum = useMemo(() => {
    if (!project) return 0;
    return project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0;
  }, [project]);
  const priorApprovedChanges = useMemo(
    // Against the CONFIRMED number once known (#141): a CO the server moved
    // from #4 to #5 counts the approved #4 as prior. The send waits for it.
    () => coPriorApprovedChanges(existingCOs, baseNumber, coId),
    [existingCOs, baseNumber, coId],
  );
  const originalContractValue = useMemo(
    () => coRoundCents(originalContractSum + priorApprovedChanges),
    [originalContractSum, priorApprovedChanges],
  );

  // Prefill from selections-overage CTA: when the homeowner picks an
  // option over allowance, the selections screen routes here with
  // a description + amount already filled. Only applies on a new CO,
  // never overrides an existing one.
  const [description, setDescription] = useState(
    existingCO?.description ?? (prefillDescription ?? '')
  );
  const [reason, setReason] = useState(
    existingCO?.reason ?? (
      prefillReason === 'allowance_overage' ? 'Allowance overage'
      : prefillReason === 'client_request' ? 'Client request'
      : prefillReason === 'out_of_scope' ? 'Out-of-scope work (from daily report)'
      : ''
    )
  );
  const [scheduleImpactDays, setScheduleImpactDays] = useState<string>(
    existingCO?.scheduleImpactDays ? String(existingCO.scheduleImpactDays)
      : (prefillScheduleDays && Number(prefillScheduleDays) > 0 ? prefillScheduleDays : '')
  );
  // #128 — where the Schedule Impact number came from. The AI analysis and the
  // voice fill write into an EMPTY box (kept: a GC on site should not have to
  // tap a chip), but a guessed number is the time extension the client signs,
  // so it is marked under the box and must be confirmed before it is saved or
  // sent. A number seeded from the saved CO or a prefill link is his (null).
  const [impactDaysSource, setImpactDaysSource] = useState<CoImpactDaysSource>(null);
  // The async voice parse resolves after renders; it reads the box through a
  // ref so "only fill an empty box" tests the box as it is NOW.
  const scheduleImpactDaysRef = useRef(scheduleImpactDays);
  scheduleImpactDaysRef.current = scheduleImpactDays;
  const fillImpactDaysIfEmpty = useCallback((days: number, source: 'ai' | 'voice') => {
    if (!(days > 0) || scheduleImpactDaysRef.current.trim() !== '') return;
    const v = String(Math.round(days));
    scheduleImpactDaysRef.current = v;
    setScheduleImpactDays(v);
    setImpactDaysSource(source);
  }, []);
  const onImpactDaysTyped = useCallback((v: string) => {
    setScheduleImpactDays(v);
    setImpactDaysSource('user');
  }, []);
  /** ONE parse, shared by the save, the G714 and the confirm prompt (#130). */
  const parsedImpactDays = useMemo(() => coParseImpactDays(scheduleImpactDays), [scheduleImpactDays]);
  // Schedule tasks the AI impact analysis named, resolved to real task ids.
  // Persisted on the CO so approval can extend the activity the model
  // identified — the analysis used to be rendered and thrown away.
  const [aiAffectedTaskIds, setAiAffectedTaskIds] = useState<string[]>(
    existingCO?.scheduleImpactTaskIds ?? []
  );
  // CO being previewed before its schedule impact is applied (pipeline approve).
  const [reflowPreviewCO, setReflowPreviewCO] = useState<ChangeOrder | null>(null);
  // #37: placing the days of an ALREADY approved CO (portal approval deferred them).
  const [placePreviewCO, setPlacePreviewCO] = useState<ChangeOrder | null>(null);
  // Pre-seed line items: single overage line so the dollar amount
  // shows on the change order without manual entry.
  // #76: prefillLines (one line per flagged item, each tagged with where its
  // price came from) wins; the legacy single prefillAmount line still works.
  const [lineItems, setLineItems] = useState<ChangeOrderLineItem[]>(() => {
    if (existingCO) return existingCO.lineItems;
    const seeded = coPrefillLines(prefillLines, { amount: prefillAmount, reason: prefillReason, description: prefillDescription }, () => createId('coli'));
    return seeded?.map(l => ({ ...l, description: l.description ?? '', unit: l.unit ?? 'ls', isNew: true })) ?? [];
  });
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemDesc, setNewItemDesc] = useState('');
  const [showEstimateItems, setShowEstimateItems] = useState(false);
  const [showMaterialSearch, setShowMaterialSearch] = useState(false);
  const [materialQuery, setMaterialQuery] = useState('');
  const [selectedPriceType, setSelectedPriceType] = useState<'retail' | 'bulk'>('bulk');
  // A change order is where a small GC's margin actually lives — the base
  // contract gets competed down, the extras do not. This screen used to open
  // every add path at 0% and never mention it, so the fastest way to build a CO
  // (pull the lines out of his own estimate, whose unitPrice is documented COST)
  // priced the added scope at exactly what it costs him to build. The seed below
  // is the markup HE already answered, read from the same pair the wizard, Quick
  // Quote, the full estimator and the AI takeoff all read, so one decision drives
  // every pricing surface in the app. Starts EMPTY, not '0' and not
  // DEFAULT_MARKUP: `markupDecided` is null while AsyncStorage answers, and
  // prefilling a percentage he never chose is the app setting his price for him.
  const [itemMarkup, setItemMarkup] = useState('');
  const [overridePrice, setOverridePrice] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showSendRecipient, setShowSendRecipient] = useState(false);
  // #78 — a recipient he already named (a send that fell back to his mail
  // app, or a new CO saved on its way to Send) is on the CO as its pending
  // Client approver; re-sending must not ask for it again.
  const pendingClient = existingCO?.approvers?.find(a => a.role === 'Client' && a.status === 'pending');
  const [sendRecipientName, setSendRecipientName] = useState(pendingClient?.name ?? '');
  const [sendRecipientEmail, setSendRecipientEmail] = useState(pendingClient?.email ?? '');
  // The turnaround this owner gets. Prefilled from the CO when one was already
  // agreed (re-sending a saved draft is the common case), and left BLANK
  // otherwise — never a default. See ChangeOrder.approvalDeadlineDays: an
  // invented number would have the follow-up engine telling him his owner is
  // late against a deadline the owner never agreed to.
  const [approvalDeadlineStr, setApprovalDeadlineStr] = useState(
    existingCO?.approvalDeadlineDays != null ? String(existingCO.approvalDeadlineDays) : ''
  );
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactPicked, setContactPicked] = useState(false);

  // His markup and whether he has ever been asked for it. Same pair
  // app/estimate-wizard.tsx:258, app/quick-quote.tsx:65 and
  // app/takeoff-estimate.tsx read, so a GC who told any one of them 22% is
  // not asked a second, contradictory question here.
  const { globalMarkup, markupDecided } = useMaterialCart();
  /** The markup to price a from-scratch CO line at, or null when he has never
   *  answered. null is NOT zero: null means "we must not assume", zero means
   *  "he said none" and is a legitimate answer (a favour, cost-plus work). */
  const seedMarkupPct: MarkupPct = markupDecided === true ? globalMarkup : null;
  /** The seed as the markup box wants it — '' when there is nothing to seed. */
  const seedMarkupStr = isMarkupSet(seedMarkupPct) && seedMarkupPct > 0
    ? String(Math.round(seedMarkupPct)) : '';
  // markupDecided is null until AsyncStorage answers, so the useState
  // initializer above always runs before the answer arrives. Seed once, on
  // hydration, and only while the box is still untouched — never clobber a
  // percentage he has typed for this change order. (Same shape as
  // app/quick-quote.tsx's markupSeededRef, deliberately.)
  const markupSeededRef = useRef(false);
  useEffect(() => {
    if (markupSeededRef.current) return;
    if (markupDecided !== true) return;
    markupSeededRef.current = true;
    if (globalMarkup > 0) setItemMarkup(String(Math.round(globalMarkup)));
  }, [markupDecided, globalMarkup]);

  const { settings } = useProjects();
  // The market, not just its multiplier: this screen used to multiply and print,
  // so a GC whose market never resolved priced every CO material at the US
  // average with nothing on screen saying so. The search sheet now states the
  // market and the book's age the same way the Materials tab and the Full
  // Estimator already do (catalogProvenanceLine is the one wording).
  const pricingMarket = useMemo(() => resolvePricingMarket(settings.location), [settings.location]);
  const locationMultiplier = pricingMarket.multiplier;
  const allMaterials = useMemo(() => getLivePrices(Date.now() / 10000, locationMultiplier), [locationMultiplier]);

  const filteredMaterials = useMemo(() => {
    if (!materialQuery.trim()) return allMaterials.slice(0, 30);
    const q = materialQuery.toLowerCase();
    return allMaterials.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.supplier.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [allMaterials, materialQuery]);

  // Estimate items keyed for the reflow's estimate-link anchor tier
  // (ScheduleTask.linkedEstimateItems stores materialIds). Memoized because the
  // preview modal re-runs CPM whenever this array's identity changes.
  const reflowEstimateItems = useMemo(
    () => (project?.linkedEstimate?.items ?? []).map(i => ({ id: i.materialId, name: i.name })),
    [project?.linkedEstimate],
  );

  const changeAmount = useMemo(() => {
    return lineItems.reduce((sum, item) => sum + item.total, 0);
  }, [lineItems]);

  const newContractTotal = useMemo(() => {
    return originalContractValue + changeAmount;
  }, [originalContractValue, changeAmount]);

  // Tax preview — the CO's changeAmount is stored pre-tax (correct: it's
  // folded into the contract total, and invoices apply settings.taxRate on
  // top when billing). Previously the CO showed ONLY the pre-tax figure, so
  // a homeowner approved e.g. $5,000 and then got billed $5,000 + tax on the
  // progress invoice. Surface the same tax the invoice will add so the
  // approved number matches what gets billed. Sign-aware for credit COs.
  // MONEY-F3: the persisted setting, 0 % when the GC never set one.
  // #131: a CO already sent carries the rate it was SENT at (frozen on the
  // record) and that rate wins — it is the rate the client was sent (and, once
  // approved, approved), and a later change in settings must not move the
  // number on this screen away from the email, the portal and the invoice.
  const liveTaxRatePct = settings.taxRate ?? 0;
  const existingFrozenTaxRate = (existingCO as (ChangeOrder & COFrozenFields) | null | undefined)?.taxRatePct;
  const taxRatePct = existingFrozenTaxRate ?? liveTaxRatePct;
  const taxPreview = useMemo(() => coTaxFreeze(changeAmount, taxRatePct), [changeAmount, taxRatePct]);
  const changeTaxAmount = taxPreview.taxAmount;
  const changeAmountWithTax = taxPreview.totalWithTax;

  /** The Add New Item modal's live preview: what he typed, plus his markup. */
  const newItemMarkupPct = Math.max(0, parseFloat(itemMarkup) || 0);
  const newItemSellPrice = (parseFloat(newItemPrice) || 0) * (1 + newItemMarkupPct / 100);

  /**
   * What this change order actually makes him — or the honest admission that
   * MAGE cannot tell.
   *
   * The screen showed exactly one number per change order, so a $12,000 CO at
   * cost and a $12,000 CO at 30 points looked identical, and the at-cost one is
   * the one the fast path produced. Every line added from here on records its
   * cost basis (`ChangeOrderLineItem.unitCost`), so the split below is read off
   * the lines rather than assumed.
   *
   * `basisKnown` is the grounding rule: lines dictated by voice, prefilled from
   * an allowance overage, or saved before `unitCost` existed carry no cost
   * basis. Treating a missing basis as "cost equals price" would report a
   * confident 0% margin on a change order that may well be marked up — an
   * invented fact, which this repo does not ship. When the basis is partial the
   * card says which lines it cannot see instead of quoting a margin.
   */
  const coMargin = useMemo(() => {
    if (lineItems.length === 0 || changeAmount <= 0) return null;
    const unpriced = lineItems.filter(i => i.unitCost == null);
    const cost = lineItems.reduce((sum, i) => sum + (i.unitCost ?? 0) * i.quantity, 0);
    const overheadProfit = changeAmount - cost;
    return {
      basisKnown: unpriced.length === 0,
      unpricedCount: unpriced.length,
      cost,
      overheadProfit,
      /** Percent OF COST added on top — the arithmetic this app means by
       *  "markup" (utils/estimateMarkup documents why). Realized, not the
       *  percentage typed in any one box, because lines can carry their own. */
      effectiveMarkupPct: cost > 0 ? (overheadProfit / cost) * 100 : 0,
      /** Fraction OF PRICE kept as profit. A contractor who hears "25 points"
       *  usually means this one, and it is five points below the markup that
       *  produced it — so both are printed rather than one being left to be
       *  misread as the other. */
      marginFraction: changeAmount > 0 ? overheadProfit / changeAmount : 0,
      /** Half-cent floor, same as utils/estimateMarkup.isAtCost, so rounding
       *  noise on a genuinely marked-up CO never reads as at-cost. */
      atCost: unpriced.length === 0 && Math.abs(overheadProfit) < 0.005,
    };
  }, [lineItems, changeAmount]);

  /**
   * One row of the "Add from Estimate" picker, carrying BOTH bases.
   *
   * This memo used to emit `{ name, unit, unitPrice, category }` and drop
   * `lineTotal`, `markup` and `quantity` on the floor — which is precisely the
   * data that says what the owner already agreed to pay for this line.
   * `LinkedEstimateItem.unitPrice` is documented COST per unit (see
   * utils/estimateMarkup: "unitPrice is COST per unit and is NEVER touched
   * here; lineTotal is SELL"), so copying it onto a change order sold the added
   * scope at cost.
   */
  type COEstimatePick = {
    name: string;
    unit: string;
    category: string;
    /** COST per unit, bulk-aware. Recorded on the CO line, never shown to the client. */
    unitCost: number;
    /** SELL per unit at the rate the owner already signed on THIS line, or null
     *  when the estimate behind it carries no markup at all. */
    unitSell: number | null;
    /** The per-line percent that produced `unitSell`, for the picker's meta row. */
    markupPct: number | null;
  };

  const estimateItems = useMemo((): COEstimatePick[] => {
    if (!project) return [];
    const linked = project.linkedEstimate;
    if (linked && linked.items.length > 0) {
      return linked.items.map(item => {
        const unitCost = item.usesBulk ? item.bulkPrice : item.unitPrice;
        // lineTotal is written as cost × (1 + markup/100) for the WHOLE
        // quantity (app/(tabs)/estimate/full.tsx), so the per-unit sell price
        // is lineTotal / quantity. Deriving it from the line rather than
        // re-running the cart's global markup is deliberate and matters twice:
        // it preserves a line the contractor hand-tuned to 40% in the estimator
        // instead of flattening it to a global default, and it prices the added
        // scope at the same rate the owner already signed on the base contract —
        // which is the rate he will be asked to defend if the CO is disputed.
        // The fallback covers a zero/absent quantity, where the division is
        // meaningless.
        const qty = item.quantity ?? 0;
        const unitSell = qty > 0 && Number.isFinite(item.lineTotal)
          ? item.lineTotal / qty
          : unitCost * (1 + (item.markup ?? 0) / 100);
        return {
          name: item.name,
          unit: item.unit,
          category: item.category,
          unitCost,
          unitSell,
          markupPct: item.markup ?? 0,
        };
      });
    }
    const legacy = project.estimate;
    if (legacy) {
      // The legacy EstimateBreakdown has no markup anywhere in its shape — its
      // MaterialLineItem is cost only. There is no signed rate to inherit, so
      // `unitSell` is null and the add path falls back to HIS answered markup
      // (or, if he has never answered, to cost with the totals card saying so).
      return legacy.materials.map(item => ({
        name: item.name,
        unit: item.unit,
        category: item.category,
        unitCost: item.unitPrice,
        unitSell: null,
        markupPct: null,
      }));
    }
    return [];
  }, [project]);

  const handleAddNewItem = useCallback(() => {
    const name = newItemName.trim();
    if (!name) {
      showAlert('Missing Name', 'Please enter an item name.');
      return;
    }
    const qty = parseFloat(newItemQty) || 0;
    const price = parseFloat(newItemPrice) || 0;
    const markup = parseFloat(itemMarkup) || 0;
    // Whole cents: cost × (1 + markup) is rarely a cent amount (#126).
    const finalPrice = coRoundCents(price * (1 + markup / 100));
    const item: ChangeOrderLineItem = {
      id: createId('coli'),
      name,
      description: newItemDesc.trim() + (overridePrice && overrideReason.trim() ? ` (${overrideReason.trim()})` : ''),
      quantity: qty,
      unit: newItemUnit.trim() || 'ea',
      unitPrice: finalPrice,
      // What he typed IS the cost; finalPrice is that cost plus his markup.
      // Keeping both is what lets the totals card below show him the margin
      // instead of one number that looks right either way.
      unitCost: price,
      total: coRoundCents(qty * finalPrice),
      isNew: true,
    };
    setLineItems(prev => [...prev, item]);
    setNewItemName('');
    setNewItemQty('');
    setNewItemUnit('');
    setNewItemPrice('');
    setNewItemDesc('');
    // Back to HIS markup, not to zero. The old reset to '0' meant the second
    // line on a change order was priced at cost even when he had just set a
    // percentage for the first one.
    setItemMarkup(seedMarkupStr);
    setOverridePrice(false);
    setOverrideReason('');
    setShowAddItem(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [newItemName, newItemQty, newItemUnit, newItemPrice, newItemDesc, itemMarkup, overridePrice, overrideReason, seedMarkupStr]);

  const handleAddFromMaterials = useCallback((material: MaterialItem) => {
    const price = selectedPriceType === 'bulk' ? material.baseBulkPrice : material.baseRetailPrice;
    const markup = parseFloat(itemMarkup) || 0;
    // Whole cents (#126): the catalogue price times a markup printed as
    // 45.123456789 in the Price box and reached the record that way.
    const finalPrice = coRoundCents(price * (1 + markup / 100));
    // The comparison a GC wants here is against what this item is already
    // SOLD at on the estimate, not against what it cost — a marked-up CO price
    // next to a cost figure reads as a rip-off the contractor has to explain.
    // The legacy estimate shape has no sell price, so that case says which
    // basis it is instead of quietly mixing the two.
    const origEst = estimateItems.find(e => e.name === material.name);
    const desc = origEst
      ? `Original estimate${origEst.unitSell == null ? ' (your cost)' : ''}: ${(origEst.unitSell ?? origEst.unitCost).toFixed(2)}/${material.unit}`
      : '';
    const item: ChangeOrderLineItem = {
      id: createId('coli'),
      name: material.name,
      description: desc,
      quantity: 1,
      unit: material.unit,
      unitPrice: finalPrice,
      // The catalogue price is the cost; the markup box is what he adds on top.
      unitCost: price,
      total: finalPrice,
      isNew: true,
    };
    setLineItems(prev => [...prev, item]);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [selectedPriceType, itemMarkup, estimateItems]);

  /**
   * Pull a line out of the project's own estimate onto this change order.
   *
   * THE RATE COMES FROM THE LINE, not from the cart. `pick.unitSell` is what
   * the owner already agreed to pay per unit for exactly this item — including
   * the case where the contractor hand-tuned that one line to 40% in the
   * estimator. Re-running a global markup over it would flatten that back to a
   * default, which is the same class of mistake utils/estimateMarkup's
   * keep-your-own-markup clause exists to prevent.
   *
   * Only when the estimate behind the line carries no markup at all (the legacy
   * EstimateBreakdown shape, which is cost-only) do we fall back to the markup
   * he answered elsewhere — and if he has never answered one, the line goes on
   * at cost and the totals card says so out loud rather than pretending.
   */
  const handleAddFromEstimate = useCallback((pick: COEstimatePick) => {
    const price = pick.unitSell
      ?? (isMarkupSet(seedMarkupPct) ? pick.unitCost * (1 + seedMarkupPct / 100) : pick.unitCost);
    const newItem: ChangeOrderLineItem = {
      id: createId('coli'),
      name: pick.name,
      description: '',
      quantity: 1,
      unit: pick.unit,
      // lineTotal / qty is rarely a whole cent; the line is (#126).
      unitPrice: coRoundCents(price),
      unitCost: pick.unitCost,
      total: coRoundCents(price),
      isNew: false,
    };
    setLineItems(prev => [...prev, newItem]);
    setShowEstimateItems(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [seedMarkupPct]);

  const handleRemoveItem = useCallback((id: string) => {
    setLineItems(prev => prev.filter(item => item.id !== id));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  // #126 — per-line STRING drafts for the Qty and Price boxes. The boxes used
  // to render from the parsed number on every keystroke, so '45.' snapped back
  // to 45 (no cents could be typed), '-' became 0 (no credit line), and a
  // Materials line showed 45.123456789. The draft holds what he is typing; the
  // number follows it whenever the draft holds one, and on blur the price is
  // committed to whole cents. An emptied box is NOT a $0 line — the line keeps
  // its last number until he types a new one.
  // unitCost is deliberately left alone: editing the SELL price inline does not
  // change what the line costs him.
  const [lineDrafts, setLineDrafts] = useState<Record<string, { qty?: string; price?: string }>>({});
  const setLineDraft = useCallback((id: string, field: 'qty' | 'price', v: string | undefined) => {
    setLineDrafts(prev => {
      const next = { ...prev, [id]: { ...prev[id], [field]: v } };
      if (next[id].qty === undefined && next[id].price === undefined) delete next[id];
      return next;
    });
  }, []);

  const handleUpdateItemQty = useCallback((id: string, qtyStr: string) => {
    if (!coLineDraftAccepts(qtyStr)) return;
    setLineDraft(id, 'qty', qtyStr);
    const qty = coParseLineDraft(qtyStr);
    if (qty == null) return;
    setLineItems(prev => prev.map(item =>
      item.id === id ? { ...item, quantity: qty, total: coRoundCents(qty * item.unitPrice) } : item
    ));
  }, [setLineDraft]);

  const handleUpdateItemPrice = useCallback((id: string, priceStr: string) => {
    if (!coLineDraftAccepts(priceStr)) return;
    setLineDraft(id, 'price', priceStr);
    const price = coParseLineDraft(priceStr);
    if (price == null) return;
    setLineItems(prev => prev.map(item =>
      // #76 — a price he typed is his: the AI-estimate / needs-price tag goes.
      item.id === id ? { ...item, unitPrice: price, total: coRoundCents(item.quantity * price), priceSource: undefined } : item
    ));
  }, [setLineDraft]);

  /** Blur: drop the draft and commit the line to whole cents. */
  const commitLineDraft = useCallback((id: string, field: 'qty' | 'price') => {
    setLineDraft(id, field, undefined);
    setLineItems(prev => prev.map(item => item.id === id ? coCommitLineItems([item])[0] : item));
  }, [setLineDraft]);

  /**
   * Writes the CO — and ONLY writes it: no toast, no navigation. Split out of
   * handleSave so Send & Save can put the CO on disk and read where the write
   * landed BEFORE it reports anything (handleSave ends in goBack(), which
   * cannot run mid-send). Returns null when the form is refused (the refusal
   * has been shown), else the CO's number and the write outcome.
   */
  const persistCO = useCallback((status: ChangeOrderStatus, recipientName?: string, recipientEmail?: string, opts?: { recordRecipient?: boolean }): { id: string; number: number; isUpdate: boolean; status: ChangeOrderStatus; pricedEditOnSentCO: boolean; write: Promise<RecordWriteOutcome> } | null => {
    if (!projectId) return null;
    const blocked = coSaveBlocker({ description, lineItemCount: lineItems.length })
      ?? coEmptyLineDraftBlocker(lineDrafts, lineItems);
    if (blocked) {
      showAlert(blocked.title, blocked.message);
      return null;
    }

    const now = new Date().toISOString();

    const impactDays = parsedImpactDays;
    // #126 — whatever is still half-typed in a Qty/Price box is committed to
    // whole cents here, so the record never carries a fraction of a cent.
    const committedLines = coCommitLineItems(lineItems);
    const committedAmount = coRoundCents(committedLines.reduce((sum, i) => sum + i.total, 0));
    const committedNewTotal = coRoundCents(originalContractValue + committedAmount);
    // #38 — a plain save keeps a sent CO's status; only a real submission moves it.
    const nextStatus = coPlainSaveStatus(status, existingCO?.status);
    // #131 — once the CO is out for approval its tax is FROZEN on the record
    // (the rate it was sent at wins over today's settings), so the screen,
    // email, portal and invoice all read the same incl.-tax figure. A draft
    // freezes nothing: nobody has been shown a number yet.
    // #129 — the G701 "prior approved changes" row is frozen on every save.
    // Typed on its own and SPREAD (not written inline) so this compiles
    // whether or not types/index.ts carries the fields yet (context lane).
    const frozen: COFrozenFields = {
      priorApprovedChangesTotal: priorApprovedChanges,
      ...(nextStatus !== 'draft'
        ? coTaxFreeze(committedAmount, existingFrozenTaxRate ?? liveTaxRatePct)
        : {}),
    };

    // ── The two facts the send sheet collected and then threw away ──────────
    //
    // The approver's name and email were used for exactly one thing: the string
    // "submitted for approval to Dave (dave@…)" in the toast below. The saved
    // ChangeOrder carried no `approvers` and no `approvalDeadlineDays`, and four
    // things that are already built went blind as a result:
    //
    //   utils/followUp/rules.ts   R1 minted the item with basis 'none' ("nothing
    //                             can call it late") and, with no holder, guard
    //                             G4 suppressed the drafted chase message — the
    //                             one feature that would have written the
    //                             follow-up for him produced nothing to send.
    //   utils/systemOfAction.ts   fell back to waitingOn: 'the owner', so the
    //                             chase list could not name the human holding it.
    //   utils/portfolio/clientBook.ts  computes rejection rate, counter rate and
    //                             median days-to-approve entirely off
    //                             approvers[].responseDate — all null.
    //   utils/aiaBilling.ts       wants the approver's response date to put the
    //                             CO in the right pay-application period.
    //
    // The shape below is pinned to what app/client-view.tsx merges against: it
    // finds the first approver with `role === 'Client' && status === 'pending'`
    // and stamps the response onto THAT row. Match the predicate and a portal
    // approval closes the loop; miss it and the portal appends a second
    // approver, which breaks aiaBilling's last-signature rule.
    const recipient = (recipientName ?? '').trim();
    const recipientAddr = (recipientEmail ?? '').trim();
    // #78 — `sending` was keyed on status 'submitted' alone, so a send that
    // fell back to his mail app (the CO stays a draft) threw away the name,
    // email and turnaround he had just typed. coRecordsRecipient records them
    // for 'composer_opened' too; the status logic is unchanged.
    const sending = coRecordsRecipient({ status, composerOpened: opts?.recordRecipient === true, recipient, recipientAddr });

    const parsedDeadline = parseInt(approvalDeadlineStr, 10);
    /** undefined = no turnaround was agreed. NOT a default — see
     *  ChangeOrder.approvalDeadlineDays and followUp/rules.ts R1. */
    const deadlineDays = Number.isFinite(parsedDeadline) && parsedDeadline > 0 ? parsedDeadline : undefined;

    const pendingClientApprover = (): COApprover => ({
      id: createId('coapp'),
      name: recipient,
      email: recipientAddr,
      role: 'Client',
      required: true,
      order: 0,
      status: 'pending',
    });

    if (existingCO) {
      // Re-sending a saved draft is the COMMON case and recorded nothing at all
      // before this. Merge rather than replace: an approver who has already
      // answered is a signed record, and a second pending 'Client' row would be
      // picked up as a duplicate by the portal merge.
      let approversPatch: COApprover[] | undefined;
      if (sending) {
        const existing = existingCO.approvers ?? [];
        const idx = existing.findIndex(a => a.role === 'Client' && a.status === 'pending');
        approversPatch = idx >= 0
          ? existing.map((a, i) => i === idx ? { ...a, name: recipient, email: recipientAddr } : a)
          : [...existing, { ...pendingClientApprover(), order: existing.length }];
      }
      const pricedEditOnSentCO = coIsOutForApproval(existingCO.status)
        && coPricedEditChanged(existingCO, { changeAmount: committedAmount, lineItems: committedLines });
      const write = updateChangeOrder(existingCO.id, {
        description: description.trim(),
        reason: reason.trim(),
        lineItems: committedLines,
        originalContractValue,
        changeAmount: committedAmount,
        newContractTotal: committedNewTotal,
        // Written only when it CHANGES (#38): a plain save used to put
        // 'draft' over a submitted / in-review / revised CO.
        ...(nextStatus !== existingCO.status ? { status: nextStatus } : {}),
        ...frozen,
        scheduleImpactDays: impactDays,
        scheduleImpactTaskIds: aiAffectedTaskIds.length > 0 ? aiAffectedTaskIds : undefined,
        // updateChangeOrder spreads the patch over the record, so an explicit
        // `undefined` CLOBBERS. Both keys are therefore only present when this
        // save is the one that knows about them — a plain "Save to Project"
        // must not wipe an approver or a turnaround already on the CO.
        ...(approversPatch ? { approvers: approversPatch } : {}),
        ...(sending ? { approvalDeadlineDays: deadlineDays } : {}),
        // #77/#141 — the server renumbered this CO but the provider still holds
        // the device's number (its re-pull has not landed, or kept this device
        // copy because we are writing it). Stamp the server's number on the
        // local record so the portal share and the e-sign record, which build
        // from the provider's CO, never carry the duplicate. The server pins
        // `number` on client updates (20260920050000 §2), so this is local-only.
        ...(confirmedNumber != null && confirmedNumber !== existingCO.number ? { number: confirmedNumber } : {}),
      });
      return { id: existingCO.id, number: confirmedNumber ?? existingCO.number, isUpdate: true, status: nextStatus, pricedEditOnSentCO, write };
    }
    const co: ChangeOrder = {
      id: createId('co'),
      number: nextCoNumber,
      projectId,
      date: now,
      description: description.trim(),
      reason: reason.trim(),
      lineItems: committedLines,
      originalContractValue,
      changeAmount: committedAmount,
      newContractTotal: committedNewTotal,
      status: nextStatus,
      ...frozen,
      createdAt: now,
      updatedAt: now,
      scheduleImpactDays: impactDays,
      scheduleImpactTaskIds: aiAffectedTaskIds.length > 0 ? aiAffectedTaskIds : undefined,
      approvers: sending ? [pendingClientApprover()] : undefined,
      approvalDeadlineDays: sending ? deadlineDays : undefined,
    };
    const write = addChangeOrder(co);
    return { id: co.id, number: nextCoNumber, isUpdate: false, status: nextStatus, pricedEditOnSentCO: false, write };
  }, [projectId, description, reason, parsedImpactDays, approvalDeadlineStr, aiAffectedTaskIds, lineItems, lineDrafts, originalContractValue, priorApprovedChanges, existingFrozenTaxRate, liveTaxRatePct, existingCO, nextCoNumber, confirmedNumber, addChangeOrder, updateChangeOrder]);

  /**
   * #76 — run `proceed` only once no line is unpriced and every AI-estimated
   * price is confirmed. Refusals name the line; the AI estimates get one
   * confirm listing them, which clears their tags (the same rule the schedule
   * days follow, #128). Only a SEND runs this — a draft save does not.
   */
  const withConfirmedPrices = useCallback((proceed: () => void) => {
    const b = coUnconfirmedPriceBlocker(lineItems, description, formatCurrency);
    if (!b) { proceed(); return; }
    if (b.kind === 'refuse') { showAlert(b.title, b.message); return; }
    showAlert(b.title, b.message, [
      { text: 'Change them', style: 'cancel' },
      {
        text: 'Keep these prices',
        onPress: () => {
          const ids = new Set(b.lineIds);
          setLineItems(prev => prev.map(l => (ids.has(l.id) ? { ...l, priceSource: undefined } : l)));
          proceed();
        },
      },
    ]);
  }, [lineItems, description]);

  // Send & Save in flight: from the tap on Send until the screen pops. The
  // email await and then the write report (up to CO_WRITE_REPORT_TIMEOUT_MS on
  // a bad signal) leave the form on screen with its buttons live, and for a
  // NEW CO `existingCO` stays null (it is keyed on the URL coId) — a second tap
  // on Save to Project / Send & Save wrote a SECOND CO with the next number and
  // popped a second screen. The ref closes the same-frame double tap; the
  // state disables the controls and relabels them so he can see why.
  const sendingRef = useRef(false);
  const [sendInFlight, setSendInFlight] = useState(false);
  const releaseSending = useCallback(() => { sendingRef.current = false; setSendInFlight(false); }, []);
  // The send finished while he was on another screen (a sidebar or push
  // navigation during the write wait), so the pop was skipped and this form is
  // still mounted under him. The lock must stay — for a NEW CO a second tap
  // would write a duplicate — but "Sending…" would be false. The bar becomes
  // one "Sent — close" action instead.
  // The close label once a send finished off-screen (null = not finished):
  // it follows the outcome, see coSendFinishedLabel.
  const [sendFinished, setSendFinished] = useState<string | null>(null);
  // Whether this screen is still the one on top. The send waits up to
  // CO_WRITE_REPORT_TIMEOUT_MS; if he left through the header meanwhile, the
  // delayed back would close the screen he went to instead.
  const navigation = useNavigation();
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  /**
   * #128 — run `proceed` only once any AI- or voice-filled Schedule Impact he
   * has not touched is confirmed. The number is the time extension the client
   * signs; an unconfirmed guess must not reach the saved CO, the email, the
   * portal or a G714.
   */
  const withConfirmedImpactDays = useCallback((proceed: () => void) => {
    const days = coImpactDaysNeedsConfirm({ source: impactDaysSource, value: scheduleImpactDays });
    if (days == null) { proceed(); return; }
    const plural = days === 1 ? '' : 's';
    showAlert(
      `The client signs +${days} day${plural} — keep it?`,
      `${impactDaysSource === 'ai' ? 'The schedule impact was estimated by AI' : 'The schedule impact was taken from your voice note'} and has not been checked. It goes on the change order as the time extension your client approves.`,
      [
        { text: 'Change it', style: 'cancel' },
        { text: `Keep +${days} day${plural}`, onPress: () => { setImpactDaysSource('user'); proceed(); } },
      ],
    );
  }, [impactDaysSource, scheduleImpactDays]);

  const handleSave = useCallback((status: 'draft' | 'submitted', recipientName?: string, recipientEmail?: string) => {
    if (sendingRef.current) return;
    const saved = persistCO(status, recipientName, recipientEmail);
    if (!saved) return;
    const recipientInfo = recipientName ? ` to ${recipientName}${recipientEmail ? ` (${recipientEmail})` : ''}` : '';
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (saved.isUpdate) {
      const msg = coSaveMessage({
        number: saved.number, isUpdate: true, requested: status, next: saved.status,
        recipientInfo, pricedEditOnSentCO: saved.pricedEditOnSentCO,
      });
      showAlert(msg.title, msg.message);
    } else {
      // No number: a new CO's is provisional until the server has it (#141) —
      // the change-order list shows "(pending #)" until then.
      nailIt(status === 'submitted' ? `Change order submitted${recipientInfo}` : 'Change order saved');
    }
    // Safe back, as after Send: a cold-opened form must still leave.
    goBack();
  }, [persistCO, goBack]);

  const handleSendPress = useCallback(() => {
    if (sendingRef.current) return;
    // #77/#141 — a saved CO whose number MAGE has not confirmed is not sent:
    // the email would carry a number another device may already have used.
    const hold = numberHold('email');
    if (hold) { showAlert('Not yet', hold); return; }
    withConfirmedPrices(() => withConfirmedImpactDays(() => setShowSendRecipient(true)));
  }, [withConfirmedImpactDays, withConfirmedPrices, numberHold]);

  // #77/#141 — a NEW CO saved from Send & Save reopens here (sendNext=1) and
  // the send sheet comes back, recipient prefilled, once its number is
  // confirmed. Once only: closing the sheet must not re-open it.
  const sendNextOpenedRef = useRef(false);
  useEffect(() => {
    if (sendNext !== '1' || sendNextOpenedRef.current || !existingCO) return;
    if (serverNumber.state !== 'confirmed') return;
    sendNextOpenedRef.current = true;
    setShowSendRecipient(true);
    // Clear the param: the ref lives per mount, so a remount (the gate going
    // loading → editor on a refetch, a web reload of this URL) would otherwise
    // reopen the send sheet unasked.
    router.setParams({ sendNext: undefined });
  }, [sendNext, existingCO, serverNumber.state, router]);

  // Issue as G714 — Construction Change Directive. The same change
  // content is rendered as a G714 PDF instead of (or in addition to)
  // the standard Change Order. Used when work must proceed before the
  // owner/GC have agreed on price/time. Action sheet picks the payment
  // basis (lump sum, T&M, cost+, unit prices, or pending negotiation).

  const generateCcd = useCallback(async (basis: CCDPaymentBasis) => {
    if (!project) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const branding = settings.branding ?? { companyName: 'MAGE ID', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      // The owner is the portal invite, or nothing. Two terms were removed:
      //   * `project.owner` — Project HAS NO `owner` FIELD. The only `owner:
      //     string` in types/index.ts belongs to IncidentCorrectiveAction. It
      //     compiled here purely by cast / `useProjects() as any`, and
      //     evaluated to undefined on every render since it was written.
      //   * `?? 'Owner'` — which printed the literal word "Owner" into the
      //     Owner field of a G704/G714 the homeowner signs. field() in
      //     utils/aiaForms.ts:125 renders `value || ' '`, a blank fill-in
      //     line, which is the correct rendering of a field nobody has filled.
      //     A form that looks completed and is not is worse than a blank.
      // NOT added: project.primaryContact — only the two dev seeders ever
      // write it, so no real project-creation path produces one.
      const owner = project.clientPortal?.invites?.[0]?.name ?? '';
      const data: G714Data = {
        ownerName: owner,
        contractorName: branding.companyName,
        projectName: project.name,
        projectAddress: (project as { location?: string }).location ?? '',
        contractDate: undefined,
        ccdNumber: nextCoNumber,
        ccdDate: new Date().toISOString(),
        changeDescription: description.trim(),
        paymentBasis: basis,
        estimatedCostAdjustment: lineItems.reduce((s, l) => s + (l.total ?? 0), 0) || undefined,
        // #130 — the days he entered, parsed exactly as the save parses them.
        // Empty or 0 stays undefined, so the form keeps its honest
        // "— (to be determined)" instead of printing "+0 days".
        estimatedTimeAdjustmentDays: parsedImpactDays,
      };
      await generateG714PDF(data, branding);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[CCD] Generate failed:', err);
      showAlert('Could not generate', err instanceof Error ? err.message : 'Try again.');
    }
  }, [project, settings, description, lineItems, nextCoNumber, parsedImpactDays]);

  const handleIssueAsCcd = useCallback(() => {
    if (!project) return;
    if (!description.trim()) {
      showAlert('Add a description', 'A CCD needs a clear description of the work being directed.');
      return;
    }
    // A signed directive must not print a price his screen isn't showing (#126).
    const emptyDraft = coEmptyLineDraftBlocker(lineDrafts, lineItems);
    if (emptyDraft) {
      showAlert(emptyDraft.title, emptyDraft.message);
      return;
    }
    withConfirmedImpactDays(() => showAlert(
      'Issue as Construction Change Directive?',
      'A CCD directs the contractor to start work before final pricing is agreed. Pick how payment will be calculated:',
      [
        { text: 'Lump sum (estimate stated)',  onPress: () => generateCcd('lump_sum') },
        { text: 'Time & materials',            onPress: () => generateCcd('time_and_materials') },
        { text: 'Cost-plus fee',               onPress: () => generateCcd('cost_plus') },
        { text: 'Unit prices in contract',     onPress: () => generateCcd('unit_prices') },
        { text: 'Pending negotiation',         onPress: () => generateCcd('pending_negotiation') },
        { text: 'Cancel', style: 'cancel' },
      ],
    ));
    // Declared AFTER generateCcd and depending on it: this callback used to
    // hold the first render's generateCcd, whose lines and days never updated
    // after he edited them (#130).
  }, [project, description, lineDrafts, lineItems, withConfirmedImpactDays, generateCcd]);

  /**
   * #35 — share a CO this screen just wrote to the client portal. Waits (up to
   * ~2 s) for a render whose change-order list holds THAT write — the new row,
   * or the edited row's new updatedAt — then calls the context's share from
   * that render (see latestCOsRef). 'failed' when it never appeared or the
   * share threw, and the report then says so instead of claiming it.
   */
  const shareSavedCOToPortal = useCallback(async (id: string, priorUpdatedAt: string | null): Promise<'shared' | 'failed'> => {
    const landed = () => {
      const c = latestCOsRef.current.find(x => x.id === id);
      return !!c && (priorUpdatedAt == null || c.updatedAt !== priorUpdatedAt);
    };
    for (let i = 0; i < 40 && !landed(); i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!landed()) return 'failed';
    try {
      await sendToPortalRef.current({ kind: 'change_order', itemId: id, projectId });
      return 'shared';
    } catch (e) {
      console.warn('[ChangeOrder] portal share failed:', e);
      return 'failed';
    }
  }, [projectId]);

  /**
   * #77/#141 — Send & Save on a NEW change order. It has no confirmed number
   * yet, and the email, the portal and the e-sign record must never carry a
   * guess. It is saved as a draft WITH the recipient and turnaround (so nothing
   * he typed is lost, #78) and the screen reopens on it: the send sheet comes
   * back by itself once MAGE has confirmed the number — a moment online;
   * offline it waits for the sync and the screen says so.
   */
  const saveNewForSend = useCallback(() => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSendInFlight(true);
    setShowSendRecipient(false);
    const saved = persistCO('draft', sendRecipientName, sendRecipientEmail, { recordRecipient: true });
    if (!saved) { releaseSending(); return; }
    nailIt('Saved as a draft — send opens once MAGE confirms its number');
    router.setParams({ coId: saved.id, sendNext: '1' });
  }, [persistCO, sendRecipientName, sendRecipientEmail, releaseSending, router]);

  const handleConfirmSend = useCallback(async () => {
    if (!sendRecipientEmail.trim()) {
      showAlert('Email Required', 'Please enter a recipient email address.');
      return;
    }
    // Refuse BEFORE anything goes out — see coSaveBlocker.
    const blocked = coSaveBlocker({ description, lineItemCount: lineItems.length })
      ?? coEmptyLineDraftBlocker(lineDrafts, lineItems);
    if (blocked) {
      showAlert(blocked.title, blocked.message);
      return;
    }
    // #76 — the send path's own check (handleSendPress confirmed the AI
    // prices before this sheet opened; anything still unpriced is refused).
    const unpriced = coUnconfirmedPriceBlocker(lineItems, description, formatCurrency);
    if (unpriced) {
      showAlert(unpriced.title, unpriced.kind === 'refuse' ? unpriced.message : `${unpriced.message} Close this and tap Send & Save again to confirm them.`);
      return;
    }
    // #77/#141 — a NEW change order has no confirmed number yet: it is saved
    // first and the send comes back once MAGE has numbered it (saveNewForSend).
    if (!existingCO) { saveNewForSend(); return; }
    const hold = numberHold('email');
    if (hold) { showAlert('Not yet', hold); return; }
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSendInFlight(true);
    setShowSendRecipient(false);

    if (sendRecipientEmail.trim()) {
      const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      // #35 — may this send put the CO on the client portal and point the email
      // at it? Decided BEFORE the email goes out: the portal must be on, have a
      // working share link, show change orders, and take this CO's frozen copy.
      // Otherwise the email says "reply with your decision" and nothing more —
      // it never names a portal the client cannot sign on.
      const cp = project?.clientPortal;
      const sendLines = coCommitLineItems(lineItems);
      const sendAmount = coRoundCents(sendLines.reduce((sum, i) => sum + i.total, 0));
      const portal = coPortalShare({
        shareUrl: portalShareUrl(cp),
        showChangeOrders: cp?.showChangeOrders,
        requirePasscode: cp?.requirePasscode === true && !!cp?.passcode,
        snapshotFits: freezeForPortal('change_order', {
          ...(existingCO ?? {}),
          description: description.trim(), reason: reason.trim(), lineItems: sendLines, changeAmount: sendAmount,
        }) != null,
      });
      // #131 — the incl.-tax figure the client approves, at the rate this send
      // freezes onto the CO (persistCO writes the same numbers).
      const sendTax = coTaxFreeze(sendAmount, existingFrozenTaxRate ?? liveTaxRatePct);
      // The fields past contactEmail drive the builder's portal CTA (#35), its
      // tax rows and tax-inclusive headline (#131) and the G701 build-up (#129).
      // Typed against the builder so a renamed option fails tsc here instead
      // of being carried and silently ignored.
      const emailOpts: Parameters<typeof buildChangeOrderEmailHtml>[0] = {
        companyName: branding.companyName,
        recipientName: sendRecipientName,
        projectName: project?.name ?? 'Project',
        // The SERVER's number — the send is held until it is known (#141).
        coNumber: confirmedNumber ?? nextCoNumber,
        description: description.trim(),
        changeAmount: sendAmount,
        newContractTotal: coRoundCents(originalContractValue + sendAmount),
        contactName: branding.contactName,
        contactEmail: branding.email,
        portalUrl: portal?.portalUrl,
        portalNeedsPasscode: portal?.portalNeedsPasscode ?? false,
        taxRatePct: sendTax.taxRatePct,
        taxAmount: sendTax.taxAmount,
        totalWithTax: sendTax.totalWithTax,
        originalContractSum,
        priorApprovedChangesTotal: priorApprovedChanges,
      };
      const html = buildChangeOrderEmailHtml(emailOpts);

      // Subject: tight, scannable. Inbox preview shows the dollar swing
      // up front so the homeowner knows before opening. Drops the
      // "{Company} - " prefix because the FROM personalization (handled
      // server-side via fromCompanyName) already shows the company.
      const coNum = confirmedNumber ?? nextCoNumber;
      // #131 — the headline is what the client approves: incl. tax when a tax
      // rate applies (the body lists the pre-tax change and the tax).
      const headline = sendTax.taxAmount !== 0 ? sendTax.totalWithTax : sendAmount;
      const sign = headline >= 0 ? '+' : '−';
      const moneyShort = (() => {
        const v = Math.abs(headline);
        if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
        if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
        return `$${v.toLocaleString('en-US')}`;
      })();
      const subject = `Change order #${coNum}: ${sign}${moneyShort} · ${project?.name ?? 'Project'}`;

      let result: Awaited<ReturnType<typeof sendEmail>>;
      try {
        result = await sendEmail({
          to: sendRecipientEmail.trim(),
          subject,
          html,
          replyTo: branding.email || undefined,
          fromCompanyName: branding.companyName || undefined,
          unsubscribe: { recipientEmail: sendRecipientEmail.trim(), eventKey: 'co_approval', enabled: true },
        });
      } catch (e) {
        // Never leave the controls locked behind a send that threw.
        releaseSending();
        showAlert('Not sent', `The email was not sent and nothing was saved: ${e instanceof Error ? e.message : 'unknown error'}. Your change order is still open here.`);
        return;
      }

      // He dismissed the composer (reached only because the send service
      // failed). Nothing went out and nothing is written; the form stays open
      // exactly as he left it, and we say so rather than returning silently.
      if (result.outcome === 'cancelled') {
        releaseSending();
        showAlert('Not sent', 'The email was not sent and nothing was saved. Your change order is still open here.');
        return;
      }
      if (!result.success) console.warn('[ChangeOrder] Email not sent:', result.outcome, result.error);

      // ONE write, after the send, with the status the send earned. Saving
      // first and then flipping to 'submitted' would need a second
      // updateChangeOrder from this closure, whose change-order list predates
      // the row the first write added — it would write that row back out.
      // The validation above already ran, so this cannot be refused now.
      const status = coStatusForSend(result.outcome, existingCO?.status);
      const sent = result.outcome === 'sent';
      const priorUpdatedAt = existingCO?.updatedAt ?? null;
      // #78 — a send that fell back to his mail app records the recipient and
      // turnaround on the draft too, so Mark submitted inherits them.
      const composerOpened = result.outcome === 'composer_opened';
      const saved = persistCO(
        status,
        sent || composerOpened ? sendRecipientName : undefined,
        sent || composerOpened ? sendRecipientEmail : undefined,
        { recordRecipient: composerOpened },
      );
      if (!saved) { releaseSending(); return; }
      const write = await Promise.race<RecordWriteOutcome | 'pending'>([
        saved.write.catch((): RecordWriteOutcome => 'failed'),
        new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), CO_WRITE_REPORT_TIMEOUT_MS)),
      ]);
      // #35 — the email just named the portal, so put the CO on it. Only for
      // a real send (the CO is now submitted) of a CO MAGE did not refuse.
      const portalOutcome = sent && portal && saved.status === 'submitted' && write !== 'failed'
        ? await shareSavedCOToPortal(saved.id, saved.isUpdate ? priorUpdatedAt : null)
        : undefined;
      const report = coSendReport({
        number: confirmedNumber ?? saved.number,
        email: result.outcome,
        emailError: result.error,
        status,
        write,
        recipient: sendRecipientName.trim() || sendRecipientEmail.trim(),
        portal: portalOutcome,
      });
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(sent && write !== 'failed'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning);
      }
      // The alert host is global, so the message survives the pop below.
      showAlert(report.title, report.message);
      // sendInFlight stays set: this screen is leaving, and nothing may write
      // again. Safe back: opened cold (a deep link, a web refresh of
      // /change-order?coId=) there is nothing to pop, and a bare back() left
      // the form up with Save and Send disabled as "Sending…" for good.
      // Skipped when he already left: popping then closes another screen.
      if (mountedRef.current && navigation.isFocused()) goBack();
      else if (mountedRef.current) setSendFinished(coSendFinishedLabel(result.outcome, write));
    } else {
      releaseSending();
    }
  }, [persistCO, releaseSending, goBack, navigation, lineItems, lineDrafts, sendRecipientName, sendRecipientEmail, settings, project, existingCO, nextCoNumber, confirmedNumber, numberHold, router, description, reason, originalContractValue, originalContractSum, priorApprovedChanges, existingFrozenTaxRate, liveTaxRatePct, shareSavedCOToPortal]);

  // A locked CO hides the EDIT action bar — an approved one gets the billing
  // bar below instead, which lifts the FAB the same way.
  // Derived above the early return below so the hook order never changes.
  const isLocked = existingCO?.status === 'approved' || existingCO?.status === 'rejected' || existingCO?.status === 'void';

  // MONEY-DEF-2 (audit 2026-09-07): an approved CO moved the contract total on
  // six read-only surfaces and had no path to a billable line anywhere, so the
  // GC retyped it by hand — losing the CO number, the approval trail and the
  // double-bill guard the milestone flow has — or ate it. Billing runs through
  // /bill-from-estimate (which writes the key onto the invoice line) rather
  // than /invoice, whose prefillLines parser drops `sourceEstimateItemId` and
  // would leave the guard below nothing to read. The decision itself is
  // utils/changeOrderBilling.changeOrderBillingState — one implementation,
  // shared with the billing screen and executed by the guard.
  type COBilling =
    | { canBill: false; reason: string }
    | { canBill: true; remaining: number; label: string; note?: string };
  const coBilling = useMemo((): COBilling | null => {
    if (!existingCO || existingCO.status !== 'approved') return null;
    const state = changeOrderBillingState(
      existingCO.id, existingCO.changeAmount, getInvoicesForProject(existingCO.projectId),
    );
    switch (state.kind) {
      case 'credit':
        // Do NOT tell him to add a negative line in the invoice editor: that
        // editor has no add-a-line control at all (app/invoice.tsx:1549 renders
        // lineItems and can only delete or voice-append). Say what is true —
        // the credit is already inside the New Contract Total shown above.
        return {
          canBill: false,
          reason: `This change order is a ${formatMoney(Math.abs(state.amount), 2)} credit, not a charge. It is already off the New Contract Total above, so there is no invoice line to raise for it.`,
        };
      case 'no_value':
        return { canBill: false, reason: 'This change order carries no dollar value, so there is nothing to bill.' };
      case 'fully_billed':
        return {
          canBill: false,
          reason: state.invoiceNumber != null
            ? `Already billed in full on invoice #${state.invoiceNumber} (${formatMoney(state.already, 2)}).`
            : `Already billed in full (${formatMoney(state.already, 2)}).`,
        };
      case 'billable':
        return {
          canBill: true,
          remaining: state.remaining,
          label: state.already > 0.009
            ? `Bill remaining ${formatMoney(state.remaining, 2)}`
            : `Bill this change order — ${formatMoney(state.remaining, 2)}`,
          // A draft is deliberately not counted as billed (it may never be
          // sent), which is the one way this button bills the same CO twice.
          // Name the draft rather than let him make a second one blind.
          note: state.pendingDraftNumber != null
            ? `Draft invoice #${state.pendingDraftNumber} already has this change order on it. Billing again makes a second invoice.`
            : state.already > 0.009
              ? `${formatMoney(state.already, 2)} of this change order is already on an invoice.`
              : undefined,
        };
    }
  }, [existingCO, getInvoicesForProject]);

  // #33 (app side) — the portal only signs a CO that is out for approval; a
  // draft shared there showed the client a change order with nothing to sign.
  // #73 — never re-share a declined or void CO as-is; #77/#141 — never share
  // one whose number is still provisional; #76 — never one with a line that
  // has no price. coPortalSendGate says which.
  const portalSendGate = useMemo((): { canSend: boolean; reason?: string } => {
    const refusal = existingCO ? coUnconfirmedPriceBlocker(existingCO.lineItems, existingCO.description ?? '', formatCurrency) : null;
    return coPortalSendGate({
      status: existingCO?.status,
      lineCount: lineItems.length,
      // The portal share builds from the provider's CO, so it also waits until
      // that copy carries the server's number (a save stamps it, see persistCO).
      numberHold: numberHold('portal') ?? coStaleNumberHold(existingCO?.number, confirmedNumber),
      priceRefusal: refusal ? (refusal.kind === 'refuse' ? refusal.message : 'Confirm the AI-estimated prices first: open Send & Save, which asks, or type the prices yourself and save.') : null,
    });
  }, [existingCO, lineItems.length, numberHold, confirmedNumber]);

  // #72 — who approved it and how, for the approved card.
  // On screen, the viewer's own mark reads "by you" (the PDF keeps the name).
  const approvalLine = useMemo(() => {
    const l = existingCO ? coApprovalLine(existingCO) : null;
    return l ? coApprovalLineForViewer(l, [authUser?.email, authUser?.name]) : null;
  }, [existingCO, authUser?.email, authUser?.name]);

  // #74 — the CO PDF (G701 + frozen tax rows) from the SAVED record.
  const formDirty = useMemo(() => coFormDirty(existingCO ?? null, {
    description, reason, scheduleImpactDays: parsedImpactDays, lineItems,
  }), [existingCO, description, reason, parsedImpactDays, lineItems]);
  const pdfAction = coPdfAction({ saved: !!existingCO, dirty: formDirty, numberHold: numberHold('pdf') });
  const pdfBusyRef = useRef(false);
  const handleSharePdf = useCallback(async () => {
    if (!existingCO || !project || pdfBusyRef.current) return;
    const hold = numberHold('pdf');
    if (hold) { showAlert('Not yet', hold); return; }
    pdfBusyRef.current = true;
    try {
      const branding = settings.branding ?? { companyName: 'MAGE ID', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      // The server's number, if the provider has not adopted it yet.
      const co = confirmedNumber != null && confirmedNumber !== existingCO.number ? { ...existingCO, number: confirmedNumber } : existingCO;
      await generateChangeOrderPDF(co, project, branding);
    } catch (err) {
      showAlert('Could not make the PDF', err instanceof Error ? err.message : 'Try again.');
    } finally {
      pdfBusyRef.current = false;
    }
  }, [existingCO, project, settings, confirmedNumber, numberHold]);

  // #73 — "Revise & re-issue" on a declined CO: a NEW draft with the next
  // number, prefilled, linked back. The declined CO keeps its number, trail
  // and decline; the portal and the e-sign flow see only the new one.
  const reviseBusyRef = useRef(false);
  const handleReviseReissue = useCallback(() => {
    if (!existingCO || existingCO.status !== 'rejected' || reviseBusyRef.current) return;
    reviseBusyRef.current = true;
    const nowIso = new Date().toISOString();
    const draft = coRevisionDraft(existingCO, {
      id: createId('co'),
      number: nextChangeOrderNumber(existingCOs),
      nowIso,
      newId: () => createId('coli'),
      actor: authUser?.email ?? 'you',
    });
    const co: ChangeOrder = { ...draft, lineItems: draft.lineItems.map(l => ({ ...l })) };
    void addChangeOrder(co);
    nailIt('Revision started as a new draft change order');
    router.replace({ pathname: '/change-order', params: { projectId: existingCO.projectId, coId: co.id } });
  }, [existingCO, existingCOs, authUser?.email, addChangeOrder, router]);

  // #79 — Mark approved commits money: confirm first, as the project screen does.
  const confirmApprove = useCallback((co: ChangeOrder) => {
    const copy = coApproveConfirmCopy(confirmedNumber ?? co.number, co.changeAmount, formatCurrency);
    showAlert(copy.title, copy.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: () => {
          updateChangeOrder(co.id, { status: 'approved' });
          nailIt(`CO #${confirmedNumber ?? co.number} approved`);
        },
      },
    ]);
  }, [confirmedNumber, updateChangeOrder]);

  const declineLine = useMemo(() => (existingCO ? coDeclineLine(existingCO) : null), [existingCO]);

  useBrainFabLift(!isLocked || coBilling ? bottomBarH : 0);

  // #41 — the same role gate, on the job this editor actually resolved: a job
  // picked in the editor (sidebar entry) or a link that named only a CO the
  // outer gate could not see yet.
  if (project && innerRoleGate !== 'open') {
    return (
      <CoRoleBlocked
        gate={innerRoleGate}
        role={innerRoleState.role ?? project.myRole ?? null}
        projectId={projectId}
        prefillDescription={prefillDescription}
        onRetry={innerRoleState.refetch}
      />
    );
  }

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolHeader eyebrow="CHANGE ORDERS · MAGE ID" title="Change Orders" />
        <ToolProjectPicker
          toolName="Change Orders"
          message="A change order adjusts an existing contract amount, so it is written against one project."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={staleProjectId}
          icon={<MageChangeOrder size={36} color={themeColors.accent} />}
          steps={[
            'Open the project that needs the change from the Projects tab.',
            'Tap Change Orders inside the project tile grid.',
            'Hit + New to log added scope, the price delta, and approval.',
          ]}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ToolHeader
        eyebrow="CHANGE ORDERS · MAGE ID"
        title={existingCO ? (confirmedNumber != null ? `CO #${confirmedNumber}` : 'CO (pending #)') : 'New Change Order'}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          {...fabScroll}
          // The approved-CO billing bar is taller than the edit bar it replaces
          // (it carries an explanatory line), so clear the measured height.
          contentContainerStyle={[{ paddingBottom: Math.max(insets.bottom + 100, bottomBarH + (isLocked ? 0 : ccdRowH) + 24) }, isDesktop && styles.contentDesktop]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.heroCard}>
            {/* #77/#141 — never a guessed number shown as settled. */}
            <Text style={styles.heroLabel} testID="co-number-label">
              {!existingCO
                ? `New change order · #${nextCoNumber} proposed`
                : confirmedNumber != null
                  ? `Change Order #${confirmedNumber}`
                  : `Change Order (pending #${existingCO.number})`}
            </Text>
            <Text style={styles.heroProject}>{project.name}</Text>
            {existingCO && (
              <View style={[styles.statusBadge, { backgroundColor: getStatusBg(themeColors, existingCO.status) }]}>
                <Text style={[styles.statusText, { color: getStatusText(themeColors, existingCO.status) }]}>
                  {existingCO.status.charAt(0).toUpperCase() + existingCO.status.slice(1)}
                </Text>
              </View>
            )}
            {existingCO && (
              <PortalStatusPill portalState={existingCO.portalState} itemUpdatedAt={existingCO.updatedAt} />
            )}
          </View>

          {/* #77/#141 — say why the number is not settled, and say it when the
              server moved it (another device had already used it). */}
          {existingCO && serverNumber.state !== 'confirmed' && serverNumber.state !== 'checking' && (
            <View style={styles.numberNote} testID="co-number-pending">
              <Text style={styles.numberNoteText}>{coNumberHoldReason(serverNumber.state, 'email')}</Text>
            </View>
          )}
          {existingCO && serverNumber.renumberedFrom != null && confirmedNumber != null && serverNumber.renumberedFrom !== confirmedNumber && (
            <View style={styles.numberNote} testID="co-renumbered">
              <Text style={styles.numberNoteText}>
                {`This change order was #${serverNumber.renumberedFrom} on this device, but #${serverNumber.renumberedFrom} was already used on this job, so MAGE numbered it #${confirmedNumber}. Everything you send uses #${confirmedNumber}.`}
              </Text>
            </View>
          )}

          {/* #74 — the change order PDF (G701 build-up + frozen tax rows),
              from the SAVED record. Always shown; says why when it can't run. */}
          <View style={styles.pdfRow}>
            <Button
              label={pdfAction.label}
              variant="secondary"
              size="sm"
              disabled={!pdfAction.enabled}
              onPress={() => { void handleSharePdf(); }}
              iconLeft={<Share2 size={14} color={themeColors.text} strokeWidth={1.75} />}
              testID="co-share-pdf"
            />
            {!!pdfAction.reason && <Text style={styles.pdfReason}>{pdfAction.reason}</Text>}
          </View>

          {existingCO && (() => {
            const pipe = coPipelineFor(existingCO.status);
            return (
              <View style={styles.pipelineWrap}>
                <StatusPipeline
                  stages={pipe.stages}
                  current={pipe.current}
                  startedAt={existingCO.createdAt}
                  // #73 — no one-tap advance out of Declined or Void.
                  onAdvance={pipe.canAdvance ? (next) => {
                    // Advancing to approved can now rewrite the Gantt. Same rule
                    // as the project screen: preview first, never on the tap.
                    if (
                      next === 'approved' &&
                      (existingCO.scheduleImpactDays ?? 0) > 0 &&
                      !existingCO.scheduleImpactApplied &&
                      (project?.schedule?.tasks?.length ?? 0) > 0
                    ) {
                      setReflowPreviewCO(existingCO);
                      return;
                    }
                    // #79 — every other approve (money-only, no schedule,
                    // revised) asks first: it commits the money.
                    if (next === 'approved') {
                      confirmApprove(existingCO);
                      return;
                    }
                    // #76 — "Mark submitted" means he sent it himself: an
                    // unpriced line still may not go out as the price.
                    if (next === 'submitted') {
                      const refusal = coUnconfirmedPriceBlocker(existingCO.lineItems, existingCO.description ?? '', formatCurrency);
                      if (refusal?.kind === 'refuse') { showAlert(refusal.title, refusal.message); return; }
                    }
                    // #131 — "Mark submitted" puts the CO out for approval too,
                    // so it freezes the tax the same way Send & Save does (the
                    // rate already frozen on the CO wins over today's setting).
                    const freeze: COFrozenFields = next === 'submitted' && existingFrozenTaxRate == null
                      ? coTaxFreeze(existingCO.changeAmount, liveTaxRatePct)
                      : {};
                    updateChangeOrder(existingCO.id, { status: next, ...freeze });
                  } : undefined}
                  advanceLabel={
                    existingCO.status === 'draft' ? 'Mark submitted'
                    : existingCO.status === 'submitted' ? 'Move to review'
                    : existingCO.status === 'under_review' || existingCO.status === 'revised' ? 'Mark approved'
                    : undefined
                  }
                />
              </View>
            );
          })()}

          <View style={styles.totalsCard}>
            {/* AIA G701's rows (#129). "Original Contract" used to show the
                contract WITH every other approved CO in it. The prior-CO rows
                only appear when there is a prior approved change to show. */}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Original contract sum</Text>
              <Text style={styles.totalValue}>{formatCurrency(originalContractSum)}</Text>
            </View>
            {priorApprovedChanges !== 0 && (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Net change by prior approved COs</Text>
                  <Text style={styles.totalValue}>{priorApprovedChanges >= 0 ? '+' : ''}{formatCurrency(priorApprovedChanges)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Contract sum prior to this CO</Text>
                  <Text style={styles.totalValue}>{formatCurrency(originalContractValue)}</Text>
                </View>
              </>
            )}
            <View style={styles.divider} />
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: changeAmount >= 0 ? themeColors.accent : themeColors.success }]}>
                This CO (Subtotal)
              </Text>
              <Text style={[styles.totalValueBold, { color: changeAmount >= 0 ? themeColors.accent : themeColors.success }]}>
                {changeAmount >= 0 ? '+' : ''}{formatCurrency(changeAmount)}
              </Text>
            </View>
            {/* The margin split. Nothing on this card used to say whether the
                number above carried any overhead or profit at all, which is how
                a change order built the fast way went out at cost without the
                contractor ever seeing it. Only renders on a charge: margin on a
                credit CO is not a meaningful figure. */}
            {coMargin && coMargin.basisKnown && (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Your cost</Text>
                  <Text style={styles.totalValue}>{formatCurrency(coMargin.cost)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>
                    Overhead &amp; profit ({Math.round(coMargin.effectiveMarkupPct)}% markup)
                  </Text>
                  <Text style={[styles.totalValue, { color: coMargin.atCost ? themeColors.dangerLabel : themeColors.success }]}>
                    {formatCurrency(coMargin.overheadProfit)}
                  </Text>
                </View>
              </>
            )}
            {coMargin && coMargin.basisKnown && !coMargin.atCost && (
              <Text style={styles.coMarginNote}>
                That is {(coMargin.marginFraction * 100).toFixed(1)}% margin on this change order — margin is a share of the price, markup is a share of the cost, and they are never the same number.
              </Text>
            )}
            {/* Honest when it cannot tell. A missing cost basis is not a zero
                margin, and the card must not report one. */}
            {coMargin && !coMargin.basisKnown && (
              <Text style={styles.coMarginNote}>
                {coMargin.unpricedCount === lineItems.length
                  ? 'MAGE does not know what these lines cost you — they were dictated or typed as a finished price — so it cannot show the margin on this change order.'
                  : `${coMargin.unpricedCount} of these ${lineItems.length} lines has no cost recorded against it, so the margin on this change order cannot be shown.`}
              </Text>
            )}
            {/* THE AT-COST BAND. Same fact, same words as the estimate wizard's
                band (app/estimate-wizard.tsx): a total that is his cost, with
                nothing saying so, is the defect — not the zero itself, which a
                contractor is entitled to choose. It does not block the send:
                quoting a change at cost is a legitimate decision (a goodwill
                fix, cost-plus work), and this screen's job is to make sure it
                is a decision rather than an accident. */}
            {coMargin && coMargin.atCost && (
              <View style={styles.coAtCostBand}>
                <AlertTriangle size={16} color={themeColors.dangerLabel} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.coAtCostTitle}>This change order is your cost</Text>
                  <Text style={styles.coAtCostBody}>
                    No overhead and no profit on work that still carries your supervision, insurance and warranty. Set a markup on the lines above before you send it.
                  </Text>
                </View>
              </View>
            )}
            {taxRatePct > 0 && changeAmount !== 0 && (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Sales Tax ({taxRatePct}%)</Text>
                  <Text style={styles.totalValue}>
                    {changeAmount >= 0 ? '+' : ''}{formatCurrency(changeTaxAmount)}
                  </Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>CO Total (incl. tax)</Text>
                  <Text style={styles.totalValueBold}>
                    {changeAmount >= 0 ? '+' : ''}{formatCurrency(changeAmountWithTax)}
                  </Text>
                </View>
                <Text style={styles.coTaxNote}>
                  {/* Integration critic money-portal: no invoice path reads the
                      frozen rate (an invoice carries ONE rate — its own, from
                      Settings when it is created), so the note must not promise
                      the approved incl.-tax total is what gets billed. */}
                  {/* #42 — keyed on STATUS: the rate freezes when the CO goes
                      out, not when the client approves it. */}
                  {coTaxNote(existingCO?.status, existingFrozenTaxRate, taxRatePct)}
                </Text>
              </>
            )}
            <View style={styles.dividerThick} />
            <View style={styles.totalRow}>
              <Text style={styles.grandLabel}>{taxRatePct > 0 && changeAmount !== 0 ? 'New Contract Total (pre-tax)' : 'New Contract Total'}</Text>
              <TapeRollNumber
                value={newContractTotal}
                formatter={formatCurrency}
                duration={550}
                style={styles.grandValue}
              />
            </View>
          </View>

          {!isLocked && (
            <>
              <View style={styles.fieldSection}>
                <InlineVoiceFill
                  title="Dictate this change order"
                  contextLine={project?.name ? `for ${project.name}` : undefined}
                  buttonLabel={existingCO ? 'Add detail by voice' : 'Fill change order by voice'}
                  suggestions={[
                    'Owner wants the heat pump upgrade — change order for forty-five hundred dollars',
                    'Field condition — found knob and tube wiring, two days extra and twelve hundred dollars',
                    'Add a window in the basement bedroom, owner direction, three thousand',
                    'Code requirement — upgrade panel to 200 amp, sub bid is twenty-eight hundred',
                  ]}
                  onTranscript={async (transcript) => {
                    const partial = await parseCOFromTranscript(transcript, project);
                    if (partial.description) setDescription(prev => mergeText(prev, partial.description, prev ? 'append' : 'replace-if-empty'));
                    if (partial.reason) setReason(prev => pickIfEmpty(prev, partial.reason));
                    if (partial.scheduleImpactDays && partial.scheduleImpactDays > 0) {
                      fillImpactDaysIfEmpty(partial.scheduleImpactDays, 'voice');
                    }
                    // Line items: append voice-derived items to whatever's already there.
                    if (partial.lineItems && partial.lineItems.length > 0) {
                      setLineItems(prev => [
                        ...prev,
                        ...partial.lineItems.map(li => ({
                          id: createId('coli'),
                          name: li.name || 'Voice line item',
                          description: li.description || '',
                          quantity: li.quantity || 1,
                          unit: li.unit || 'lump',
                          unitPrice: li.unitPrice || 0,
                          total: (li.quantity || 1) * (li.unitPrice || 0),
                          isNew: true,
                        })),
                      ]);
                    } else if (partial.changeAmount > 0 && lineItems.length === 0) {
                      // Single bulk amount with no itemization — seed one line.
                      setLineItems([{
                        id: createId('coli'),
                        name: partial.description || 'Voice change order',
                        description: '',
                        quantity: 1,
                        unit: 'lump',
                        unitPrice: partial.changeAmount,
                        total: partial.changeAmount,
                        isNew: true,
                      }]);
                    }
                  }}
                />
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={styles.textArea}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Describe the change..."
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                  textAlignVertical="top"
                  testID="co-description-input"
                />
              </View>

              <View style={styles.fieldSection}>
                <Text style={styles.fieldLabel}>Reason for change</Text>
                <TextInput
                  style={styles.input}
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Why is this change needed?"
                  placeholderTextColor={themeColors.textMuted}
                  testID="co-reason-input"
                />
              </View>

              <View style={styles.fieldSection}>
                <Text style={styles.fieldLabel}>Schedule Impact (days)</Text>
                <TextInput
                  style={styles.input}
                  value={scheduleImpactDays}
                  onChangeText={onImpactDaysTyped}
                  placeholder="Additional days added to project (0 if none)"
                  placeholderTextColor={themeColors.textMuted}
                  keyboardType="numeric"
                  testID="co-schedule-impact-input"
                />
                {/* This line used to read "When approved, these days extend
                    the project schedule automatically." Nothing extended: the
                    approval bumped three scalars and left every task date
                    untouched. Approval now really does reflow the schedule —
                    behind a preview — so the copy says exactly that, and says
                    something different when there is no schedule to reflow. */}
                {!!coImpactDaysHelper(impactDaysSource, scheduleImpactDays) && (
                  <Text style={styles.impactGuessText} testID="co-impact-days-source">
                    {coImpactDaysHelper(impactDaysSource, scheduleImpactDays)}
                  </Text>
                )}
                <Text style={styles.helperText}>
                  {project?.schedule?.tasks?.length
                    ? 'On approval you\'ll see which task absorbs these days and what shifts downstream — nothing moves until you apply it.'
                    : 'This project has no schedule yet, so these days are recorded on the change order only.'}
                </Text>
              </View>

              <View style={{ paddingHorizontal: 16 }}>
                <AIChangeOrderImpact
                  changeDescription={description}
                  lineItems={lineItems.map(i => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total }))}
                  schedule={project?.schedule ?? null}
                  onResult={(res) => {
                    // Keep the tasks the model named so approval can anchor the
                    // reflow on real work instead of a guess.
                    const names = (res.affectedTasks ?? []).map(t => t.taskName).filter(Boolean);
                    const ids = resolveAiAffectedTaskIds(project?.schedule?.tasks ?? [], names);
                    if (ids.length > 0) setAiAffectedTaskIds(ids);
                    // Only fill the days field when the user left it blank —
                    // their number is the contractual one — and mark the fill
                    // as an AI estimate he must confirm before it goes out.
                    if (res.scheduleDays > 0) fillImpactDaysIfEmpty(res.scheduleDays, 'ai');
                  }}
                />
              </View>
            </>
          )}

          {isLocked && (
            <View style={styles.fieldSection}>
              <View style={styles.lockedCard}>
                <Text style={styles.lockedTitle}>{existingCO?.description}</Text>
                {/* #125 — the client's decline, with their reason. The portal
                    requires one, the reconciler stored it, and this card showed
                    only "Rejected". */}
                {declineLine && (
                  <View style={styles.declineBox} testID="co-decline-line">
                    <Text style={styles.declineTitle}>
                      Declined by {declineLine.who}{declineLine.when ? ` on ${formatCalendarDay(calendarDayOf(declineLine.when) ?? declineLine.when)}` : ''}
                    </Text>
                    <Text style={styles.lockedSub}>
                      {declineLine.reason ? `Their reason: ${declineLine.reason}` : 'No reason given.'}
                    </Text>
                  </View>
                )}
                {/* #73 — the way forward the decline email names. */}
                {existingCO?.status === 'rejected' && (
                  <Button
                    label="Revise & re-issue"
                    variant="primary"
                    size="sm"
                    onPress={handleReviseReissue}
                    iconLeft={<RotateCcw size={14} color="#FFFFFF" strokeWidth={1.75} />}
                    testID="co-revise-reissue"
                  />
                )}
                {existingCO?.status === 'rejected' && (
                  <Text style={styles.lockedSub}>
                    Starts a new draft change order with the next number, these lines and days, linked to this one. This declined change order stays as it is.
                  </Text>
                )}
                {/* #72 — who approved it and how: the client's portal
                    signature (signer, day, record hash), or plainly that
                    there is none. A signed CO no longer looks like one he
                    marked approved himself. */}
                {approvalLine && (
                  <View style={[styles.approvalBox, approvalLine.kind === 'manual' && styles.approvalBoxManual]} testID="co-approval-line">
                    <Text style={styles.approvalTitle}>
                      {approvalLine.kind === 'client_signed' ? 'Client signature' : approvalLine.kind === 'manual' ? 'Approval' : 'Client approval'}
                    </Text>
                    <Text style={styles.lockedSub}>{approvalLine.text}</Text>
                  </View>
                )}
                {/* "for change", so his own reason is never read as the client's. */}
                {existingCO?.reason ? <Text style={styles.lockedSub}>Reason for change: {existingCO.reason}</Text> : null}
                {existingCO?.scheduleImpactDays ? (
                  <Text style={styles.lockedSub}>
                    Schedule Impact: +{existingCO.scheduleImpactDays} day{existingCO.scheduleImpactDays === 1 ? '' : 's'}
                    {/* Say which of the three states it is. The old flat
                        "applied" suffix printed on COs whose Gantt had never
                        moved, which is exactly the lie this work removes. */}
                    {existingCO.scheduleImpactApplied
                      ? ' — applied to the schedule'
                      : existingCO.status === 'approved'
                        ? ((project?.schedule?.tasks?.length ?? 0) > 0
                          ? ' — approved but not yet placed on the schedule.'
                          : ' — approved, but this job has no schedule to place them on yet.')
                        : ' — not applied yet'}
                  </Text>
                ) : null}
                {/* #37: a CO approved in the client portal waits for him to
                    place its days (the reconciler defers the reflow). The
                    push he got says "review and place them" and opens THIS
                    screen, so the control lives here too — the same preview
                    the project screen uses, in its 'place' intent. */}
                {existingCO?.status === 'approved'
                  && (existingCO.scheduleImpactDays ?? 0) > 0
                  && !existingCO.scheduleImpactApplied
                  && (project?.schedule?.tasks?.length ?? 0) > 0 ? (
                  <Button
                    label={`Place +${existingCO.scheduleImpactDays}d on the schedule`}
                    variant="secondary"
                    onPress={() => setPlacePreviewCO(existingCO)}
                    testID="co-place-days"
                  />
                ) : null}
              </View>
            </View>
          )}

          <View style={styles.fieldSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.fieldLabel}>Line Items</Text>
              {!isLocked && (
                <View style={styles.addBtnRow}>
                  <TouchableOpacity
                    style={styles.addSearchBtn}
                    onPress={() => { setMaterialQuery(''); setShowMaterialSearch(true); }}
                    activeOpacity={0.7}
                    testID="search-materials-btn"
                  >
                    <Search size={14} color={themeColors.success} strokeWidth={1.75} />
                    <Text style={styles.addSearchBtnText}>Materials</Text>
                  </TouchableOpacity>
                  {estimateItems.length > 0 && (
                    <TouchableOpacity
                      style={styles.addFromBtn}
                      onPress={() => setShowEstimateItems(true)}
                      activeOpacity={0.7}
                    >
                      <FileText size={14} color={themeColors.info} strokeWidth={1.75} />
                      <Text style={styles.addFromBtnText}>Estimate</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.addNewBtn}
                    onPress={() => setShowAddItem(true)}
                    activeOpacity={0.7}
                    testID="add-co-item-btn"
                  >
                    <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.addNewBtnText}>Custom</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {lineItems.length === 0 && (
              <View style={styles.emptyItems}>
                <Text style={styles.emptyItemsText}>No line items yet. Add items to define this change order.</Text>
              </View>
            )}

            {lineItems.map((item) => (
              <View key={item.id} style={styles.lineItemCard}>
                <View style={styles.lineItemHeader}>
                  <View style={styles.lineItemNameRow}>
                    {item.isNew && <View style={styles.newBadge}><Text style={styles.newBadgeText}>NEW</Text></View>}
                    <Text style={styles.lineItemName} numberOfLines={1}>{item.name}</Text>
                  </View>
                  {!isLocked && (
                    <TouchableOpacity onPress={() => handleRemoveItem(item.id)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Delete">
                      <Trash2 size={16} color={themeColors.danger} strokeWidth={1.75} />
                    </TouchableOpacity>
                  )}
                </View>
                {!isLocked ? (
                  <>
                    <View style={styles.lineItemFields}>
                      <View style={styles.lineItemFieldSmall}>
                        <Text style={styles.lineItemFieldLabel}>Qty</Text>
                        <TextInput
                          style={styles.lineItemInput}
                          value={lineDrafts[item.id]?.qty ?? String(item.quantity)}
                          onChangeText={(v) => handleUpdateItemQty(item.id, v)}
                          onBlur={() => commitLineDraft(item.id, 'qty')}
                          // Not iOS's decimal-pad: it has no minus key, and a
                          // credit line needs one.
                          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                          testID={`co-line-qty-${item.id}`}
                        />
                      </View>
                      <View style={styles.lineItemFieldSmall}>
                        <Text style={styles.lineItemFieldLabel}>Unit</Text>
                        <Text style={styles.lineItemUnitText}>{item.unit}</Text>
                      </View>
                      <View style={styles.lineItemFieldSmall}>
                        <Text style={styles.lineItemFieldLabel}>Price</Text>
                        <TextInput
                          style={styles.lineItemInput}
                          value={lineDrafts[item.id]?.price ?? item.unitPrice.toFixed(2)}
                          onChangeText={(v) => handleUpdateItemPrice(item.id, v)}
                          onBlur={() => commitLineDraft(item.id, 'price')}
                          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'decimal-pad'}
                          testID={`co-line-price-${item.id}`}
                        />
                      </View>
                      <View style={styles.lineItemFieldSmall}>
                        <Text style={styles.lineItemFieldLabel}>Total</Text>
                        <Text style={styles.lineItemTotal}>{formatCurrency(item.total)}</Text>
                      </View>
                    </View>
                    {/* #76 — a price nobody confirmed is marked, not sent. */}
                    {item.priceSource === 'ai_estimated' && (
                      <Text style={styles.linePriceTag} testID={`co-line-ai-${item.id}`}>AI estimate from your cost book — type a price, or confirm it when you send.</Text>
                    )}
                    {item.priceSource === 'needs_price' && (
                      <Text style={styles.linePriceTag} testID={`co-line-needs-${item.id}`}>Needs a price — it cannot be sent at $0.</Text>
                    )}
                    <View style={{ marginTop: 8 }}>
                      <CSIDivisionPicker
                        value={item.csiDivision}
                        suggestFromText={item.description}
                        onChange={(next) =>
                          setLineItems((prev) =>
                            prev.map((li) =>
                              li.id === item.id ? { ...li, csiDivision: next } : li,
                            ),
                          )
                        }
                        testID={`co-line-csi-${item.id}`}
                      />
                    </View>
                  </>
                ) : (
                  <View style={styles.lineItemFields}>
                    <Text style={styles.lockedFieldText}>{item.quantity} {item.unit} × {formatCurrency(item.unitPrice)}</Text>
                    <Text style={styles.lineItemTotal}>{formatCurrency(item.total)}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </ScrollView>

        {/* CCD (G714) — issued when work needs to start BEFORE pricing
            is agreed. Lives as a small tertiary text action so it's
            available to GCs who know what it is, but stays out of the
            way for GCs who don't. Tap → option sheet to pick payment
            basis → renders G714 PDF with same change content. The CO
            record is unchanged; G714 is just an alternate output. */}
        {!isLocked && (
          <View style={[styles.ccdRow, { bottom: bottomBarH }]} onLayout={onCcdRowLayout}>
            <TouchableOpacity
              style={styles.ccdLink}
              onPress={handleIssueAsCcd}
              activeOpacity={0.7}
              testID="issue-as-ccd-btn"
            >
              <FileText size={13} color={themeColors.textSecondary} strokeWidth={1.75} />
              <Text style={styles.ccdLinkText}>
                Need work to start before pricing is agreed? Issue as Construction Change Directive (G714)
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Rejected / void: no bar at the foot, so the portal control (recall,
            "shared with client") stays in the normal flow. */}
        {existingCO && (existingCO.status === 'rejected' || existingCO.status === 'void') && (
          <SendToClientButton
            kind="change_order"
            itemId={existingCO.id}
            projectId={existingCO.projectId}
            portalState={existingCO.portalState}
            itemUpdatedAt={existingCO.updatedAt}
            canSend={portalSendGate.canSend}
            canSendReason={portalSendGate.reason}
          />
        )}

        {/* #36 — ONE measured, absolute dock. The portal send used to render
            in flow and sit underneath the absolute Save / Send & Save bar (and
            the bill bar on an approved CO), so it could not be tapped. It now
            stacks above them, inside the measured height the scroll padding,
            the CCD row and the FAB lift all read. Email and portal stay two
            actions: different channels, and merging them is a product call. */}
        {(!isLocked || !!coBilling) && (
          <View style={styles.bottomDock} onLayout={onBottomBarLayout}>
            {existingCO && existingCO.status !== 'rejected' && existingCO.status !== 'void' && (
              <SendToClientButton
                kind="change_order"
                itemId={existingCO.id}
                projectId={existingCO.projectId}
                portalState={existingCO.portalState}
                itemUpdatedAt={existingCO.updatedAt}
                canSend={portalSendGate.canSend}
                canSendReason={portalSendGate.reason}
              />
            )}
            {!isLocked && sendFinished && (
              <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
                <Button
                  label={sendFinished}
                  onPress={goBack}
                  variant="secondary"
                  style={{ flex: 1 }}
                  testID="co-sent-close"
                />
              </View>
            )}

            {!isLocked && !sendFinished && (
              <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
                <Button
                  label="Save to Project"
                  disabled={sendInFlight}
                  onPress={() => withConfirmedImpactDays(() => handleSave('draft'))}
                  variant="secondary"
                  style={{ flex: 1 }}
                  testID="save-co-draft"
                />
                <Button
                  label={sendInFlight ? 'Sending…' : 'Send & Save'}
                  onPress={handleSendPress}
                  disabled={sendInFlight}
                  iconLeft={<Send size={16} color="#FFFFFF" strokeWidth={1.75} />}
                  style={{ flex: 1 }}
                  testID="send-co-btn"
                />
              </View>
            )}

            {/* Approved CO → the one action that was missing: turn it into money.
                When it cannot be billed the control still renders and SAYS WHY,
                rather than vanishing and leaving the GC to guess. */}
            {coBilling && existingCO && (
              <View style={[styles.coBillBar, { paddingBottom: insets.bottom + 12 }]}>
                {coBilling.canBill ? (
                  <>
                    <Button
                      label={coBilling.label}
                      onPress={() => {
                        if (Platform.OS !== 'web') void Haptics.selectionAsync();
                        router.push({
                          pathname: '/bill-from-estimate' as any,
                          params: { projectId: existingCO.projectId, focusChangeOrderId: existingCO.id, type: 'progress' },
                        });
                      }}
                      iconLeft={<Percent size={16} color="#FFFFFF" strokeWidth={1.75} />}
                      fullWidth
                      testID="bill-change-order-btn"
                    />
                    {!!coBilling.note && <Text style={styles.coBillNote}>{coBilling.note}</Text>}
                  </>
                ) : (
                  <>
                    <Button label="Bill this change order" onPress={() => {}} disabled fullWidth testID="bill-change-order-btn" />
                    <Text style={styles.coBillNote}>{coBilling.reason}</Text>
                  </>
                )}
              </View>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={showSendRecipient} transparent animationType="slide" onRequestClose={() => setShowSendRecipient(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Send for Approval To</Text>
                <TouchableOpacity onPress={() => setShowSendRecipient(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              {contactPicked ? (
                <View style={styles.selectedRecipientCard}>
                  <User size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedRecipientName}>{sendRecipientName}</Text>
                    {sendRecipientEmail ? <Text style={styles.selectedRecipientEmail}>{sendRecipientEmail}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => { setSendRecipientName(''); setSendRecipientEmail(''); setContactPicked(false); }} style={styles.clearRecipientBtn} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={12} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.modalFieldLabel}>Approver Name</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={sendRecipientName}
                    onChangeText={setSendRecipientName}
                    placeholder="Enter name or pick from contacts"
                    placeholderTextColor={themeColors.textMuted}
                  />
                  <Text style={styles.modalFieldLabel}>Email</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={sendRecipientEmail}
                    onChangeText={setSendRecipientEmail}
                    placeholder="email@example.com"
                    placeholderTextColor={themeColors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  {contacts.length > 0 && (
                    <TouchableOpacity
                      style={styles.pickContactBtn}
                      onPress={() => { setShowSendRecipient(false); setTimeout(() => setShowContactPicker(true), 350); }}
                      activeOpacity={0.7}
                    >
                      <BookUser size={14} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.pickContactText}>Pick from Contacts</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              {/* The turnaround. One question, asked where the decision is
                  already being made, and NEVER pre-answered — the same rule
                  Project.structuredAddress' zoning fields follow: an unknown
                  fact stays unknown rather than becoming a plausible default.
                  With an answer, the follow-up engine can say a change order is
                  late and who is holding it. Without one, it still tracks the CO
                  and says plainly that nothing can call it late. */}
              <Text style={styles.modalFieldLabel}>How long does this owner get to respond? (days)</Text>
              <View style={styles.deadlineRow}>
                {CO_TURNAROUND_CHOICES.map(d => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.deadlineChip, approvalDeadlineStr === String(d) && styles.deadlineChipActive]}
                    onPress={() => setApprovalDeadlineStr(prev => prev === String(d) ? '' : String(d))}
                    activeOpacity={0.7}
                    testID={`co-turnaround-${d}`}
                  >
                    <Text style={[styles.deadlineChipText, approvalDeadlineStr === String(d) && styles.deadlineChipTextActive]}>
                      {d}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TextInput
                  style={styles.deadlineInput}
                  value={approvalDeadlineStr}
                  onChangeText={setApprovalDeadlineStr}
                  placeholder="—"
                  placeholderTextColor={themeColors.textMuted}
                  keyboardType="numeric"
                  testID="co-turnaround-custom"
                />
              </View>
              <Text style={styles.modalHelperText}>
                {approvalDeadlineStr.trim() && (parseInt(approvalDeadlineStr, 10) > 0)
                  ? `MAGE will chase this change order once it is ${parseInt(approvalDeadlineStr, 10)} days old, and it will name ${sendRecipientName.trim() || 'the approver'} as the person holding it.`
                  : 'Leave this blank if you never agreed a turnaround. MAGE will still track the change order as out for approval — it just will not call it late against a deadline nobody agreed to.'}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={styles.saveDraftBtn} onPress={() => setShowSendRecipient(false)} activeOpacity={0.7}>
                  <Text style={styles.saveDraftBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.sendBtn, sendInFlight && { opacity: 0.5 }]} onPress={handleConfirmSend} disabled={sendInFlight} activeOpacity={0.7} testID="co-send-confirm">
                  <Send size={16} color={"#FFFFFF"} strokeWidth={1.75} />
                  <Text style={styles.sendBtnText}>{sendInFlight ? 'Sending…' : 'Send'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ContactPickerModal
        visible={showContactPicker}
        onClose={() => { setShowContactPicker(false); setTimeout(() => setShowSendRecipient(true), 350); }}
        contacts={contacts}
        title="Select Approver"
        onSelect={(contact) => {
          const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.companyName;
          setSendRecipientName(name);
          setSendRecipientEmail(contact.email);
          setContactPicked(true);
          setShowContactPicker(false);
          setTimeout(() => setShowSendRecipient(true), 350);
        }}
      />

      <Modal visible={showAddItem} transparent animationType="slide" onRequestClose={() => setShowAddItem(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add New Item</Text>
                <TouchableOpacity onPress={() => setShowAddItem(false)} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
              </View>
              <Text style={styles.modalFieldLabel}>Item Name</Text>
              <TextInput style={styles.modalInput} value={newItemName} onChangeText={setNewItemName} placeholder="Item name" placeholderTextColor={themeColors.textMuted} />
              <Text style={styles.modalFieldLabel}>Description</Text>
              <TextInput style={styles.modalInput} value={newItemDesc} onChangeText={setNewItemDesc} placeholder="Optional description" placeholderTextColor={themeColors.textMuted} />
              <View style={styles.modalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Quantity</Text>
                  <TextInput style={styles.modalInput} value={newItemQty} onChangeText={setNewItemQty} placeholder="0" placeholderTextColor={themeColors.textMuted} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Unit</Text>
                  <TextInput style={styles.modalInput} value={newItemUnit} onChangeText={setNewItemUnit} placeholder="ea, sq ft..." placeholderTextColor={themeColors.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Your cost</Text>
                  <TextInput style={styles.modalInput} value={newItemPrice} onChangeText={setNewItemPrice} placeholder="0.00" placeholderTextColor={themeColors.textMuted} keyboardType="numeric" testID="co-new-item-cost" />
                </View>
                {/* The control this modal never had. Name / Description /
                    Quantity / Unit / Unit Price, and whatever he typed was the
                    price — so the custom line, which is the one he reaches for
                    when the change is real work rather than a catalogue item,
                    went to the owner at cost every time. */}
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Markup %</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={itemMarkup}
                    onChangeText={setItemMarkup}
                    placeholder="0"
                    placeholderTextColor={themeColors.textMuted}
                    keyboardType="numeric"
                    testID="co-new-item-markup"
                  />
                </View>
              </View>
              {/* Says where the percentage came from, and says it plainly when
                  it came from nowhere. Never asserts a markup he did not set. */}
              <Text style={styles.modalHelperText}>
                {newItemMarkupPct > 0
                  ? `Client pays ${formatCurrency(newItemSellPrice)} per ${newItemUnit.trim() || 'unit'}${seedMarkupStr && itemMarkup === seedMarkupStr ? ' — your usual markup, carried over from your estimating settings' : ''}.`
                  : seedMarkupStr
                    ? 'At 0% this line goes to the client at what it costs you. Your usual markup is ' + seedMarkupStr + '%.'
                    : 'At 0% this line goes to the client at what it costs you — no overhead, no profit.'}
              </Text>
              <TouchableOpacity style={styles.modalAddBtn} onPress={handleAddNewItem} activeOpacity={0.85}>
                <Text style={styles.modalAddBtnText}>Add Item</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showEstimateItems} transparent animationType="slide" onRequestClose={() => setShowEstimateItems(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16, maxHeight: '70%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add from Estimate</Text>
              <TouchableOpacity onPress={() => setShowEstimateItems(false)} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {estimateItems.map((item, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.estimateItemRow}
                  onPress={() => handleAddFromEstimate(item)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.estimateItemName}>{item.name}</Text>
                    {/* Shows the rate that will land on the change order, and
                        where it came from. The row used to print the estimate's
                        COST here and then add that same cost to the CO, so the
                        screen was honest about a number that was wrong. */}
                    <Text style={styles.estimateItemMeta}>
                      {item.category} · {formatCurrency(item.unitSell ?? (isMarkupSet(seedMarkupPct) ? item.unitCost * (1 + seedMarkupPct / 100) : item.unitCost))}/{item.unit}
                    </Text>
                    <Text style={styles.estimateItemBasis}>
                      {coEstimatePickBasis(item, isMarkupSet(seedMarkupPct) ? seedMarkupPct : null, formatCurrency)}
                    </Text>
                  </View>
                  <Plus size={18} color={themeColors.accent} strokeWidth={1.75} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showMaterialSearch} transparent animationType="slide" onRequestClose={() => setShowMaterialSearch(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16, maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Search Materials</Text>
              <TouchableOpacity onPress={() => setShowMaterialSearch(false)} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
            </View>

            <View style={styles.matSearchBar}>
              <Search size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              <TextInput
                style={styles.matSearchInput}
                value={materialQuery}
                onChangeText={setMaterialQuery}
                placeholder="Search lumber, concrete, HVAC..."
                placeholderTextColor={themeColors.textMuted}
                autoFocus
                testID="co-material-search"
              />
              {materialQuery.length > 0 && (
                <TouchableOpacity onPress={() => setMaterialQuery('')} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.priceTypeRow}>
              <TouchableOpacity
                style={[styles.priceTypeChip, selectedPriceType === 'retail' && styles.priceTypeChipActive]}
                onPress={() => setSelectedPriceType('retail')}
              >
                <Text style={[styles.priceTypeText, selectedPriceType === 'retail' && styles.priceTypeTextActive]}>Retail</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.priceTypeChip, selectedPriceType === 'bulk' && styles.priceTypeChipActive]}
                onPress={() => setSelectedPriceType('bulk')}
              >
                <Text style={[styles.priceTypeText, selectedPriceType === 'bulk' && styles.priceTypeTextActive]}>Bulk</Text>
              </TouchableOpacity>
              <View style={styles.matMarkupRow}>
                <Percent size={12} color={themeColors.accent} strokeWidth={1.75} />
                <TextInput
                  style={styles.matMarkupInput}
                  value={itemMarkup}
                  onChangeText={setItemMarkup}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={themeColors.textMuted}
                  testID="co-material-markup"
                />
                <Text style={styles.matMarkupLabel}>markup</Text>
              </View>
            </View>

            {/* This box used to open at 0 and reset to 0 after every add, so the
                one place on the screen that COULD carry a markup lost it between
                items. It now holds his answered percentage and says so. */}
            <Text style={styles.matMarkupNote}>
              {newItemMarkupPct > 0
                ? `Every material added is priced at cost + ${Math.round(newItemMarkupPct)}%.`
                : seedMarkupStr
                  ? `At 0% materials go on at what they cost you. Your usual markup is ${seedMarkupStr}%.`
                  : 'At 0% materials go on at what they cost you — no overhead, no profit.'}
            </Text>

            <Text style={styles.matMarketLine} testID="co-material-market">
              {catalogProvenanceLine(pricingMarket.resolved ? pricingMarket.label : null)}
              {pricingMarket.resolved ? '' : ' — set your market in Settings → Location or on the Materials tab.'}
            </Text>
            <Text style={styles.matResultCount}>{filteredMaterials.length} results</Text>

            <FlatList
              data={filteredMaterials}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: material }) => {
                const price = selectedPriceType === 'bulk' ? material.baseBulkPrice : material.baseRetailPrice;
                const markup = parseFloat(itemMarkup) || 0;
                const finalPrice = price * (1 + markup / 100);
                const catLabel = CATEGORY_META[material.category]?.label ?? material.category;
                const origEst = estimateItems.find(e => e.name === material.name);
                return (
                  <TouchableOpacity
                    style={styles.matResultRow}
                    onPress={() => handleAddFromMaterials(material)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.matResultName} numberOfLines={1}>{material.name}</Text>
                      <View style={styles.matResultMeta}>
                        <Text style={styles.matResultCat}>{catLabel}</Text>
                        <Text style={styles.matResultSupplier}>{material.supplier}</Text>
                      </View>
                      {origEst && (
                        <Text style={styles.matOriginalPrice}>
                          Original estimate{origEst.unitSell == null ? ' (your cost)' : ''}: {formatCurrency(origEst.unitSell ?? origEst.unitCost)}/{origEst.unit}
                        </Text>
                      )}
                    </View>
                    <View style={styles.matResultPrices}>
                      <Text style={styles.matResultRetail}>${material.baseRetailPrice.toFixed(2)}</Text>
                      <Text style={styles.matResultBulk}>${material.baseBulkPrice.toFixed(2)}</Text>
                      {markup > 0 && <Text style={styles.matResultFinal}>${finalPrice.toFixed(2)}</Text>}
                    </View>
                    <Plus size={18} color={themeColors.accent} strokeWidth={1.75} />
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* Preview-then-apply for the CO's schedule impact. Same component the
          project screen uses, so both approve surfaces show the identical
          plan — and the same core computes the write. */}
      {reflowPreviewCO !== null && (
        <COScheduleReflowPreviewModal
          visible
          changeOrder={reflowPreviewCO}
          schedule={project?.schedule ?? null}
          estimateItems={reflowEstimateItems}
          moneyLine={reflowPreviewCO.changeAmount < 0
            ? `Credits ${formatCurrency(-reflowPreviewCO.changeAmount)} back to the contract.`
            : `Commits ${formatCurrency(reflowPreviewCO.changeAmount)} to the contract.`}
          onClose={() => setReflowPreviewCO(null)}
          onConfirm={(anchorTaskId) => {
            const co = reflowPreviewCO;
            setReflowPreviewCO(null);
            updateChangeOrder(co.id, { status: 'approved' }, { anchorTaskId });
            nailIt(`CO #${co.number} approved`);
          }}
        />
      )}
      {placePreviewCO !== null && (
        <COScheduleReflowPreviewModal
          visible
          changeOrder={placePreviewCO}
          schedule={project?.schedule ?? null}
          estimateItems={reflowEstimateItems}
          intent="place"
          onClose={() => setPlacePreviewCO(null)}
          onConfirm={(anchorTaskId) => {
            const co = placePreviewCO;
            setPlacePreviewCO(null);
            // Already approved: an explicit anchor lets the reflow run with no
            // status change (ProjectContext updateChangeOrder, #37).
            updateChangeOrder(co.id, {}, { anchorTaskId });
            nailIt(`CO #${co.number}: +${co.scheduleImpactDays}d placed on the schedule`);
          }}
        />
      )}
    </View>
  );
}

// MONEY-F18 / HEALTH-F5: sign-correct — a −$5,000 credit CO renders as
// "-$5,000.00", not "$5,000.00". Delegates to the one formatter.
const formatCurrency = (n: number): string => formatMoney(n, 2);

function getStatusBg(t: ThemeColors, status: string): string {
  switch (status) {
    case 'draft': case 'void': return t.line;
    case 'submitted': case 'sent': return t.info;
    case 'under_review': case 'revised': return t.accentSoft;
    case 'approved': return t.successSoft;
    case 'rejected': return t.danger;
    default: return t.line;
  }
}

function getStatusText(t: ThemeColors, status: string): string {
  switch (status) {
    case 'draft': return t.textSecondary;
    case 'submitted': case 'sent': return t.info;
    case 'under_review': case 'revised': return t.accent;
    case 'approved': return t.success;
    case 'rejected': return t.danger;
    case 'void': return t.textMuted;
    default: return t.text;
  }
}

// Wraps the StatusPipeline component with the screen's standard side padding.
const pipelineWrapStyle = { paddingHorizontal: 16, marginTop: 12, marginBottom: 8 } as const;

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  gateBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.sm, padding: Tokens.spacing.lg },
  gateTitle: { ...Type.headline, color: themeColors.text, textAlign: 'center' },
  gateText: { ...Type.subhead, color: themeColors.textSecondary, textAlign: 'center', maxWidth: 420 },
  gatePrefillBox: { ...cardSurface(themeColors, { radius: 'md' }), maxWidth: 420 },
  gatePrefill: { ...Type.footnote, color: themeColors.text },
  impactGuessText: { fontSize: Type.caption1.fontSize, color: themeColors.dangerLabel, marginTop: 6, fontWeight: '600' as const },
  declineBox: { borderLeftWidth: 3, borderLeftColor: themeColors.dangerLabel, paddingLeft: 10, marginVertical: 4, gap: 2 },
  declineTitle: { fontSize: Type.footnote.fontSize, color: themeColors.text, fontWeight: '600' as const },
  approvalBox: { borderLeftWidth: 3, borderLeftColor: themeColors.success, paddingLeft: 10, marginVertical: 4, gap: 2 },
  approvalBoxManual: { borderLeftColor: themeColors.line },
  approvalTitle: { fontSize: Type.footnote.fontSize, color: themeColors.text, fontWeight: '600' as const },
  numberNote: { marginHorizontal: 20, marginTop: 10, padding: 10, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, borderWidth: 1, borderColor: themeColors.line },
  numberNoteText: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 16 },
  pdfRow: { marginHorizontal: 20, marginTop: 10, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, flexWrap: 'wrap' as const },
  pdfReason: { flex: 1, minWidth: 160, fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 16 },
  linePriceTag: { fontSize: Type.caption1.fontSize, color: themeColors.dangerLabel, marginTop: 6, fontWeight: '600' as const },
  pipelineWrap: pipelineWrapStyle,
  container: { flex: 1, backgroundColor: themeColors.bg },
  // Document-style form — cap kept, widened for desktop.
  contentDesktop: { width: '100%', maxWidth: 1040, alignSelf: 'center' as const },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: Type.subheadline.fontSize, color: themeColors.textSecondary, marginBottom: 16 },
  backBtn: { backgroundColor: themeColors.accentFill, paddingHorizontal: 24, paddingVertical: 12, borderRadius: Tokens.radius.md },
  backBtnText: { color: "#FFFFFF", fontSize: Type.subhead.fontSize, fontWeight: '600' as const },
  heroCard: { backgroundColor: themeColors.accentFill, marginHorizontal: 20, marginTop: 16, borderRadius: Tokens.radius.panel, padding: 20, gap: 4 },
  heroLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroProject: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: Tokens.radius.sm, marginTop: 6 },
  statusText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  totalsCard: { marginHorizontal: 20, marginTop: 16, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 18, borderWidth: 1, borderColor: themeColors.line },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  totalLabel: { fontSize: Type.subhead.fontSize, color: themeColors.textSecondary, fontWeight: '500' as const },
  totalValue: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text },
  totalValueBold: { fontSize: Type.body.fontSize, fontWeight: '700' as const },
  divider: { height: 1, backgroundColor: themeColors.line, marginVertical: 4 },
  dividerThick: { height: 2, backgroundColor: themeColors.accent + '30', borderRadius: 1, marginVertical: 6 },
  grandLabel: { fontSize: Type.body.fontSize, fontWeight: '800' as const, color: themeColors.text },
  grandValue: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  coTaxNote: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const, marginTop: 6, lineHeight: 15 },
  coMarginNote: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 4, lineHeight: 15 },
  // The at-cost band. `dangerSoft` fill under a `dangerLabel` foreground — the
  // accent is never allowed to become the background (standing visual rule).
  coAtCostBand: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10,
    backgroundColor: themeColors.dangerSoft, borderRadius: Tokens.radius.card,
    padding: 12, marginTop: 10,
  },
  coAtCostTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.dangerLabel },
  coAtCostBody: { fontSize: Type.caption2.fontSize, color: themeColors.dangerLabel, lineHeight: 15, marginTop: 2 },
  fieldSection: { marginHorizontal: 20, marginTop: 18 },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  helperText: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 6, fontStyle: 'italic' as const },
  input: { minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.surface, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text, borderWidth: 1, borderColor: themeColors.line },
  textArea: { minHeight: 90, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.surface, paddingHorizontal: 14, paddingTop: 12, fontSize: Type.subhead.fontSize, color: themeColors.text, borderWidth: 1, borderColor: themeColors.line },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  addBtnRow: { flexDirection: 'row', gap: 8 },
  // fg === bg: label AND the FileText icon were `info` on an `info` fill. The
  // sibling addNewBtn (`accent + '15'` fill, `accent` label) is the pattern.
  addFromBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.info + '1F' },
  addFromBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.info },
  addNewBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '15' },
  addNewBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  emptyItems: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: themeColors.line },
  emptyItemsText: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textMuted, textAlign: 'center' as const },
  lineItemCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: themeColors.line },
  lineItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  lineItemNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  newBadge: { backgroundColor: themeColors.accent + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  newBadgeText: { fontSize: 9, fontWeight: '700' as const, color: themeColors.accent },
  lineItemName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text, flex: 1 },
  lineItemFields: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineItemFieldSmall: { flex: 1, gap: 2 },
  lineItemFieldLabel: { fontSize: 10, fontWeight: '600' as const, color: themeColors.textMuted, textTransform: 'uppercase' as const },
  lineItemInput: { minHeight: 36, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 8, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  lineItemUnitText: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary, paddingVertical: 8 },
  lineItemTotal: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  lockedCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 16, borderWidth: 1, borderColor: themeColors.line, gap: 4 },
  lockedTitle: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text },
  lockedSub: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary },
  lockedFieldText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary },
  // Subtle text-link row for "Issue as G714 (CCD)" — sits above the
  // bottom action bar. Tertiary-action treatment so it's discoverable
  // by GCs who know what a CCD is, but doesn't compete with the
  // primary save/send actions.
  ccdRow: {
    // `bottom` is set inline from the measured dock height (#36): a fixed 76
    // left ~30pt of this row under the bar on an iPhone with a home indicator.
    position: 'absolute' as const,
    left: 0, right: 0,
    paddingHorizontal: 20, paddingVertical: 8,
    backgroundColor: themeColors.surface,
  },
  ccdLink: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 6,
  },
  ccdLinkText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    color: themeColors.textSecondary,
    fontWeight: '500' as const,
    lineHeight: 16,
  },
  coBillBar: { backgroundColor: themeColors.surface, borderTopWidth: 0.5, borderTopColor: themeColors.line, paddingHorizontal: 20, paddingTop: 12, gap: 8 },
  coBillNote: { fontSize: Type.caption1.fontSize, lineHeight: 16, color: themeColors.textSecondary, textAlign: 'center' as const },
  // The one absolute container at the foot of the screen (#36): the portal
  // send sits INSIDE it, above Save / Send & Save (or the bill bar), so it is
  // measured with them and nothing is drawn under anything.
  bottomDock: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  bottomBar: { backgroundColor: themeColors.surface, borderTopWidth: 0.5, borderTopColor: themeColors.line, paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', gap: 10 },
  saveDraftBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  saveDraftBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveProjectBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '15', borderWidth: 1.5, borderColor: themeColors.accent, alignItems: 'center', justifyContent: 'center' },
  saveProjectBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  sendBtn: { flex: 1.2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  sendBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  selectedRecipientCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: themeColors.accent + '10', borderRadius: Tokens.radius.card, paddingHorizontal: 12, paddingVertical: 10, gap: 10, borderWidth: 1, borderColor: themeColors.accent + '25' },
  selectedRecipientName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  selectedRecipientEmail: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  clearRecipientBtn: { width: 24, height: 24, borderRadius: Tokens.radius.card, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  pickContactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '10' },
  pickContactText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  modalCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  modalFieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  modalInput: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.subhead.fontSize, color: themeColors.text },
  modalRow: { flexDirection: 'row', gap: 10 },
  modalHelperText: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 15, marginTop: 6 },
  deadlineRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 6 },
  deadlineChip: { minWidth: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line, alignItems: 'center' as const },
  deadlineChipActive: { backgroundColor: themeColors.accentFill },
  deadlineChipText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  deadlineChipTextActive: { color: "#FFFFFF" },
  deadlineInput: { flex: 1, minHeight: 40, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 10, fontSize: Type.bodyCompact.fontSize, color: themeColors.text, textAlign: 'center' as const },
  modalAddBtn: { backgroundColor: themeColors.accentFill, borderRadius: Tokens.radius.lg, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  modalAddBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  estimateItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: themeColors.line, gap: 12 },
  estimateItemName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text },
  estimateItemMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2 },
  estimateItemBasis: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 2, lineHeight: 14 },
  addSearchBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.successSoft },
  addSearchBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.success },
  matSearchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.card, paddingHorizontal: 12, gap: 8, height: 44, borderWidth: 1, borderColor: themeColors.line },
  matSearchInput: { flex: 1, fontSize: Type.subhead.fontSize, color: themeColors.text },
  priceTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  priceTypeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line },
  priceTypeChipActive: { backgroundColor: themeColors.accentFill },
  priceTypeText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  priceTypeTextActive: { color: "#FFFFFF" },
  matMarkupRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' as const, backgroundColor: themeColors.line, borderRadius: Tokens.radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  matMarkupInput: { width: 36, fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text, textAlign: 'center' as const },
  matMarkupLabel: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted },
  matMarkupNote: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 15, marginTop: 6 },
  matResultCount: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 6, marginBottom: 4 },
  matMarketLine: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 15, marginTop: 6 },
  matResultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: themeColors.line, gap: 10 },
  matResultName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  matResultMeta: { flexDirection: 'row', gap: 8, marginTop: 2 },
  matResultCat: { fontSize: Type.caption2.fontSize, color: themeColors.info, fontWeight: '500' as const },
  matResultSupplier: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted },
  matOriginalPrice: { fontSize: 10, color: themeColors.accent, fontWeight: '500' as const, marginTop: 2 },
  matResultPrices: { alignItems: 'flex-end', gap: 1 },
  matResultRetail: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, textDecorationLine: 'line-through' as const },
  matResultBulk: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.success },
  matResultFinal: { fontSize: 10, color: themeColors.accent, fontWeight: '600' as const },
});
