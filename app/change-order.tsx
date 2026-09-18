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
  Plus, Trash2, X, FileText, Send, Search, Percent, BookUser, User, PenTool, AlertTriangle,
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
import { useTierAccess } from '@/hooks/useTierAccess';
import { useSafeBack } from '@/hooks/useSafeBack';
import Paywall from '@/components/Paywall';
import ContactPickerModal from '@/components/ContactPickerModal';
import InlineVoiceFill from '@/components/InlineVoiceFill';
import { StatusPipeline, type PipelineStage } from '@/components/StatusPipeline';
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

// Pipeline stages — happy path through the CO lifecycle. Side branches
// (rejected, revised, void) live outside this visual; the user can still
// flip into them via the status badge / approve-reject buttons elsewhere
// on the screen. We map under_review → "Under Review" as the middle step
// because in practice every submitted CO sits in review for a beat before
// it gets approved or rejected.
const CO_PIPELINE_STAGES: PipelineStage<ChangeOrderStatus>[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'under_review', label: 'In Review' },
  { key: 'approved', label: 'Approved', terminal: true },
];

// The turnarounds a residential/light-commercial owner is actually given on a
// change-order decision. Offered as chips because typing a number into a modal
// while you are trying to send something is friction that gets skipped — and a
// skipped answer is the `basis: 'none'` state the follow-up engine has been
// stuck in. Tapping the lit chip clears it back to "no turnaround agreed",
// which must stay reachable: it is a real answer, not a missing one.
const CO_TURNAROUND_CHOICES = [3, 5, 7, 14] as const;

function mapCOStatus(s: ChangeOrderStatus): ChangeOrderStatus {
  if (s === 'rejected' || s === 'void') return 'submitted';
  if (s === 'revised') return 'under_review';
  return s;
}
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { showAlert } from '@/utils/alert';

function createId(_prefix: string): string {
  return generateUUID();
}

export default function ChangeOrderScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const { colors: themeColors } = useTheme();
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
      message: `CO #${o.number} was emailed${o.recipient ? ` to ${o.recipient}` : ''} for approval.${o.write === 'synced' ? ' It is saved.' : where[o.write]}`,
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
  const router = useRouter();
  const goBack = useSafeBack();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  // Reached from the sidebar (FINANCIALS ▸ Change Orders), Tools, universal
  // search or a deep link there is no projectId, so ToolProjectPicker sets one
  // locally (field-ticket pattern). A pick outranks the param so a STALE id in
  // the URL — deleted project, old shared link — can't make the picker inert.
  const { projectId: paramProjectId, coId, prefillReason, prefillDescription, prefillAmount, prefillScheduleDays } = useLocalSearchParams<{
    projectId: string;
    coId?: string;
    prefillReason?: string;
    prefillDescription?: string;
    prefillAmount?: string;
    prefillScheduleDays?: string;
  }>();
  const {
    getProject, getChangeOrdersForProject, getInvoicesForProject, addChangeOrder, updateChangeOrder, contacts,
    projects,
  } = useProjects();

  // The record's own project seeds the pick (the gate keys this editor on the
  // record, so it seeds once per record): a link may carry only the record id,
  // or a projectId that isn't the record's, and the record's job must win.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(projectIdOverride ?? null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;
  const existingCOs = useMemo(() => getChangeOrdersForProject(projectId ?? ''), [projectId, getChangeOrdersForProject]);
  const existingCO = useMemo(() => coId ? existingCOs.find(c => c.id === coId) : null, [coId, existingCOs]);

  const originalContractValue = useMemo(() => {
    if (!project) return 0;
    const linked = project.linkedEstimate;
    const legacy = project.estimate;
    let base = linked?.grandTotal ?? legacy?.grandTotal ?? 0;
    const approvedCOs = existingCOs.filter(c => c.status === 'approved' && c.id !== coId);
    approvedCOs.forEach(c => { base += c.changeAmount; });
    return base;
  }, [project, existingCOs, coId]);

  const nextCoNumber = useMemo(() => {
    if (existingCO) return existingCO.number;
    // max(existing) + 1, NOT length + 1: deleting a CO out of the middle would
    // otherwise reissue an already-used number, producing duplicate CO numbers
    // on signed, client-facing documents.
    return existingCOs.reduce((max, c) => Math.max(max, c.number || 0), 0) + 1;
  }, [existingCOs, existingCO]);

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
  // Schedule tasks the AI impact analysis named, resolved to real task ids.
  // Persisted on the CO so approval can extend the activity the model
  // identified — the analysis used to be rendered and thrown away.
  const [aiAffectedTaskIds, setAiAffectedTaskIds] = useState<string[]>(
    existingCO?.scheduleImpactTaskIds ?? []
  );
  // CO being previewed before its schedule impact is applied (pipeline approve).
  const [reflowPreviewCO, setReflowPreviewCO] = useState<ChangeOrder | null>(null);
  // Pre-seed line items: single overage line so the dollar amount
  // shows on the change order without manual entry.
  const seedFromOverage: ChangeOrderLineItem[] | null = !existingCO && prefillAmount && Number(prefillAmount) > 0
    ? [{
        id: 'overage-prefill',
        name: prefillReason === 'out_of_scope' ? 'Out-of-scope work' : 'Allowance overage',
        description: prefillDescription ?? 'Allowance overage',
        quantity: 1,
        unit: 'ls',
        unitPrice: Number(prefillAmount),
        total: Number(prefillAmount),
        isNew: true,
      }]
    : null;
  const [lineItems, setLineItems] = useState<ChangeOrderLineItem[]>(
    existingCO?.lineItems ?? seedFromOverage ?? []
  );
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
  const [sendRecipientName, setSendRecipientName] = useState('');
  const [sendRecipientEmail, setSendRecipientEmail] = useState('');
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
  const taxRatePct = settings.taxRate ?? 0;
  const changeTaxAmount = useMemo(() => changeAmount * (taxRatePct / 100), [changeAmount, taxRatePct]);
  const changeAmountWithTax = useMemo(() => changeAmount + changeTaxAmount, [changeAmount, changeTaxAmount]);

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
    const finalPrice = price * (1 + markup / 100);
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
      total: qty * finalPrice,
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
    const finalPrice = price * (1 + markup / 100);
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
      unitPrice: price,
      unitCost: pick.unitCost,
      total: price,
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

  const handleUpdateItemQty = useCallback((id: string, qtyStr: string) => {
    const qty = parseFloat(qtyStr) || 0;
    setLineItems(prev => prev.map(item =>
      item.id === id ? { ...item, quantity: qty, total: qty * item.unitPrice } : item
    ));
  }, []);

  const handleUpdateItemPrice = useCallback((id: string, priceStr: string) => {
    const price = parseFloat(priceStr) || 0;
    setLineItems(prev => prev.map(item =>
      item.id === id ? { ...item, unitPrice: price, total: item.quantity * price } : item
    ));
  }, []);

  /**
   * Writes the CO — and ONLY writes it: no toast, no navigation. Split out of
   * handleSave so Send & Save can put the CO on disk and read where the write
   * landed BEFORE it reports anything (handleSave ends in goBack(), which
   * cannot run mid-send). Returns null when the form is refused (the refusal
   * has been shown), else the CO's number and the write outcome.
   */
  const persistCO = useCallback((status: ChangeOrderStatus, recipientName?: string, recipientEmail?: string): { number: number; isUpdate: boolean; write: Promise<RecordWriteOutcome> } | null => {
    if (!projectId) return null;
    const blocked = coSaveBlocker({ description, lineItemCount: lineItems.length });
    if (blocked) {
      showAlert(blocked.title, blocked.message);
      return null;
    }

    const now = new Date().toISOString();

    const parsedImpactDays = parseInt(scheduleImpactDays, 10);
    const impactDays = Number.isFinite(parsedImpactDays) && parsedImpactDays > 0 ? parsedImpactDays : undefined;

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
    const sending = status === 'submitted' && (recipient !== '' || recipientAddr !== '');

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
      const write = updateChangeOrder(existingCO.id, {
        description: description.trim(),
        reason: reason.trim(),
        lineItems,
        originalContractValue,
        changeAmount,
        newContractTotal,
        status,
        scheduleImpactDays: impactDays,
        scheduleImpactTaskIds: aiAffectedTaskIds.length > 0 ? aiAffectedTaskIds : undefined,
        // updateChangeOrder spreads the patch over the record, so an explicit
        // `undefined` CLOBBERS. Both keys are therefore only present when this
        // save is the one that knows about them — a plain "Save to Project"
        // must not wipe an approver or a turnaround already on the CO.
        ...(approversPatch ? { approvers: approversPatch } : {}),
        ...(sending ? { approvalDeadlineDays: deadlineDays } : {}),
      });
      return { number: existingCO.number, isUpdate: true, write };
    }
    const co: ChangeOrder = {
      id: createId('co'),
      number: nextCoNumber,
      projectId,
      date: now,
      description: description.trim(),
      reason: reason.trim(),
      lineItems,
      originalContractValue,
      changeAmount,
      newContractTotal,
      status,
      createdAt: now,
      updatedAt: now,
      scheduleImpactDays: impactDays,
      scheduleImpactTaskIds: aiAffectedTaskIds.length > 0 ? aiAffectedTaskIds : undefined,
      approvers: sending ? [pendingClientApprover()] : undefined,
      approvalDeadlineDays: sending ? deadlineDays : undefined,
    };
    const write = addChangeOrder(co);
    return { number: nextCoNumber, isUpdate: false, write };
  }, [projectId, description, reason, scheduleImpactDays, approvalDeadlineStr, aiAffectedTaskIds, lineItems, originalContractValue, changeAmount, newContractTotal, existingCO, nextCoNumber, addChangeOrder, updateChangeOrder]);

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

  const handleSave = useCallback((status: 'draft' | 'submitted', recipientName?: string, recipientEmail?: string) => {
    if (sendingRef.current) return;
    const saved = persistCO(status, recipientName, recipientEmail);
    if (!saved) return;
    const recipientInfo = recipientName ? ` to ${recipientName}${recipientEmail ? ` (${recipientEmail})` : ''}` : '';
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (saved.isUpdate) {
      showAlert('Updated', `Change Order #${saved.number} has been ${status === 'submitted' ? `submitted for approval${recipientInfo}` : 'saved to project'}.`);
    } else {
      nailIt(status === 'submitted' ? `CO #${saved.number} submitted${recipientInfo}` : `CO #${saved.number} saved`);
    }
    // Safe back, as after Send: a cold-opened form must still leave.
    goBack();
  }, [persistCO, goBack]);

  const handleSendPress = useCallback(() => {
    if (sendingRef.current) return;
    setShowSendRecipient(true);
  }, []);

  // Issue as G714 — Construction Change Directive. The same change
  // content is rendered as a G714 PDF instead of (or in addition to)
  // the standard Change Order. Used when work must proceed before the
  // owner/GC have agreed on price/time. Action sheet picks the payment
  // basis (lump sum, T&M, cost+, unit prices, or pending negotiation).
  const handleIssueAsCcd = useCallback(() => {
    if (!project) return;
    if (!description.trim()) {
      showAlert('Add a description', 'A CCD needs a clear description of the work being directed.');
      return;
    }
    showAlert(
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
    );
  }, [project, description]);

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
        estimatedTimeAdjustmentDays: undefined,
      };
      await generateG714PDF(data, branding);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[CCD] Generate failed:', err);
      showAlert('Could not generate', err instanceof Error ? err.message : 'Try again.');
    }
  }, [project, settings, description, lineItems, nextCoNumber]);

  const handleConfirmSend = useCallback(async () => {
    if (!sendRecipientEmail.trim()) {
      showAlert('Email Required', 'Please enter a recipient email address.');
      return;
    }
    // Refuse BEFORE anything goes out — see coSaveBlocker.
    const blocked = coSaveBlocker({ description, lineItemCount: lineItems.length });
    if (blocked) {
      showAlert(blocked.title, blocked.message);
      return;
    }
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSendInFlight(true);
    setShowSendRecipient(false);

    if (sendRecipientEmail.trim()) {
      const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      const html = buildChangeOrderEmailHtml({
        companyName: branding.companyName,
        recipientName: sendRecipientName,
        projectName: project?.name ?? 'Project',
        coNumber: existingCO?.number ?? nextCoNumber,
        description: description.trim(),
        changeAmount,
        newContractTotal,
        contactName: branding.contactName,
        contactEmail: branding.email,
      });

      // Subject: tight, scannable. Inbox preview shows the dollar swing
      // up front so the homeowner knows before opening. Drops the
      // "{Company} - " prefix because the FROM personalization (handled
      // server-side via fromCompanyName) already shows the company.
      const coNum = existingCO?.number ?? nextCoNumber;
      const sign = changeAmount >= 0 ? '+' : '−';
      const moneyShort = (() => {
        const v = Math.abs(changeAmount);
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
      const saved = persistCO(status, sent ? sendRecipientName : undefined, sent ? sendRecipientEmail : undefined);
      if (!saved) { releaseSending(); return; }
      const write = await Promise.race<RecordWriteOutcome | 'pending'>([
        saved.write.catch((): RecordWriteOutcome => 'failed'),
        new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), CO_WRITE_REPORT_TIMEOUT_MS)),
      ]);
      const report = coSendReport({
        number: saved.number,
        email: result.outcome,
        emailError: result.error,
        status,
        write,
        recipient: sendRecipientName.trim() || sendRecipientEmail.trim(),
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
  }, [persistCO, releaseSending, goBack, navigation, lineItems.length, sendRecipientName, sendRecipientEmail, settings, project, existingCO, nextCoNumber, description, changeAmount, newContractTotal]);

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

  useBrainFabLift(!isLocked || coBilling ? bottomBarH : 0);

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
        title={existingCO ? `CO #${existingCO.number}` : 'New Change Order'}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          {...fabScroll}
          // The approved-CO billing bar is taller than the edit bar it replaces
          // (it carries an explanatory line), so clear the measured height.
          contentContainerStyle={[{ paddingBottom: Math.max(insets.bottom + 100, bottomBarH + 24) }, isDesktop && styles.contentDesktop]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Change Order #{nextCoNumber}</Text>
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

          {existingCO && (
            <View style={styles.pipelineWrap}>
              <StatusPipeline
                stages={CO_PIPELINE_STAGES}
                current={mapCOStatus(existingCO.status)}
                startedAt={existingCO.createdAt}
                onAdvance={(next) => {
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
                  updateChangeOrder(existingCO.id, { status: next });
                  if (next === 'approved') {
                    nailIt(`CO #${existingCO.number} approved`);
                  }
                }}
                advanceLabel={
                  existingCO.status === 'draft' ? 'Mark submitted'
                  : existingCO.status === 'submitted' ? 'Move to review'
                  : existingCO.status === 'under_review' ? 'Mark approved'
                  : undefined
                }
              />
            </View>
          )}

          <View style={styles.totalsCard}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Original Contract</Text>
              <Text style={styles.totalValue}>${originalContractValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            </View>
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
                  Sales tax is applied when this change is billed on a progress invoice — shown here so the total you approve matches what gets invoiced.
                </Text>
              </>
            )}
            <View style={styles.dividerThick} />
            <View style={styles.totalRow}>
              <Text style={styles.grandLabel}>New Contract Total</Text>
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
                    if (partial.scheduleImpactDays && partial.scheduleImpactDays !== 0) {
                      setScheduleImpactDays(prev => prev || String(partial.scheduleImpactDays));
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
                <Text style={styles.fieldLabel}>Reason</Text>
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
                  onChangeText={setScheduleImpactDays}
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
                    // their number is the contractual one.
                    if (res.scheduleDays > 0) setScheduleImpactDays(prev => prev || String(res.scheduleDays));
                  }}
                />
              </View>
            </>
          )}

          {isLocked && (
            <View style={styles.fieldSection}>
              <View style={styles.lockedCard}>
                <Text style={styles.lockedTitle}>{existingCO?.description}</Text>
                {existingCO?.reason ? <Text style={styles.lockedSub}>Reason: {existingCO.reason}</Text> : null}
                {existingCO?.scheduleImpactDays ? (
                  <Text style={styles.lockedSub}>
                    Schedule Impact: +{existingCO.scheduleImpactDays} day{existingCO.scheduleImpactDays === 1 ? '' : 's'}
                    {/* Say which of the three states it is. The old flat
                        "applied" suffix printed on COs whose Gantt had never
                        moved, which is exactly the lie this work removes. */}
                    {existingCO.scheduleImpactApplied
                      ? ' — applied to the schedule'
                      : existingCO.status === 'approved'
                        ? ' — approved but not yet placed on the schedule. Open Change Orders on the project to pick the activity that absorbs them.'
                        : ' — not applied yet'}
                  </Text>
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
                          value={item.quantity.toString()}
                          onChangeText={(v) => handleUpdateItemQty(item.id, v)}
                          keyboardType="numeric"
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
                          value={item.unitPrice.toString()}
                          onChangeText={(v) => handleUpdateItemPrice(item.id, v)}
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={styles.lineItemFieldSmall}>
                        <Text style={styles.lineItemFieldLabel}>Total</Text>
                        <Text style={styles.lineItemTotal}>{formatCurrency(item.total)}</Text>
                      </View>
                    </View>
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
          <View style={styles.ccdRow}>
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

        {existingCO && (
          <SendToClientButton
            kind="change_order"
            itemId={existingCO.id}
            projectId={existingCO.projectId}
            portalState={existingCO.portalState}
            itemUpdatedAt={existingCO.updatedAt}
            canSend={lineItems.length > 0}
            canSendReason={lineItems.length === 0 ? 'Add at least one line item before sending.' : undefined}
          />
        )}

        {!isLocked && sendFinished && (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]} onLayout={onBottomBarLayout}>
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
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]} onLayout={onBottomBarLayout}>
            <Button
              label="Save to Project"
              onPress={() => handleSave('draft')}
              variant="secondary"
              style={{ flex: 1 }}
              disabled={sendInFlight}
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
          <View style={[styles.coBillBar, { paddingBottom: insets.bottom + 12 }]} onLayout={onBottomBarLayout}>
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
                      {item.unitSell != null && item.markupPct != null && item.markupPct > 0
                        ? `Your cost ${formatCurrency(item.unitCost)} + ${Math.round(item.markupPct)}% — the rate on the signed estimate`
                        : isMarkupSet(seedMarkupPct) && seedMarkupPct > 0
                          ? `Your cost ${formatCurrency(item.unitCost)} + your ${Math.round(seedMarkupPct)}% markup — this line carries none on the estimate`
                          : `This is your cost. No markup is set, so it goes on the change order at what it costs you.`}
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
    position: 'absolute' as const,
    bottom: 76, left: 0, right: 0,
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
  coBillBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: themeColors.surface, borderTopWidth: 0.5, borderTopColor: themeColors.line, paddingHorizontal: 20, paddingTop: 12, gap: 8 },
  coBillNote: { fontSize: Type.caption1.fontSize, lineHeight: 16, color: themeColors.textSecondary, textAlign: 'center' as const },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: themeColors.surface, borderTopWidth: 0.5, borderTopColor: themeColors.line, paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', gap: 10 },
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
