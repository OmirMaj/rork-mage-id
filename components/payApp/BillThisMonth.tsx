// components/payApp/BillThisMonth.tsx — Bill This Month: the next pay
// application, started from the last one, on one screen.
//
// Easier Pay Applications, Phase 1. Rendered by app/aia-pay-app.tsx only when
// utils/payApp/allowed.payAppEasyAllowed says yes (PAY_APP_EASY_ENABLED is
// false: the owner account only).
//
// WHAT HAPPENS HERE
//   • The last application rolls forward (utils/payApp/rollForward): its own
//     lines, previous work carried, this period at ZERO on every line.
//   • Each line shows a suggested percent WITH ITS SOURCE, or says why there
//     is none (utils/payApp/suggestPercent). A line with no linked schedule
//     task gets no suggestion. There is no project average.
//   • NOTHING COUNTS UNTIL HE ACCEPTS IT OR TYPES HIS OWN. The only writers of
//     a line's `thisPeriod` in this file are `accept`, `acceptAll` and
//     `typePercent`, each his tap or his keystroke, and `restoreLine`, which
//     puts a line back to what it held when a percent he typed was refused.
//     The footer adds up `thisPeriod` and nothing else, and says how many
//     suggestions are not in it.
//   • The footer is the cover's lines 4 to 8 in plain labels, so it adds up
//     when money carries in from earlier applications.
//   • The draft invoice behind the period is named, with its total including
//     tax and its payment terms, BEFORE he saves.
//   • "Next: Rejection Check" shows the check, which never blocks. Continue
//     saves the period as a DRAFT: the progress invoice behind it is made from
//     the lines he entered (utils/payApp/periodInvoice, saved through the same
//     addInvoice path Bill From Estimate uses) and the pay application is
//     saved against it (addAIAPayApp: local first, then the offline queue).
//     Certifying is still the slide on the pay application screen.
//
// No date here is a deadline. Period To opens on the last day of the month as
// a default he confirms or retypes.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { PaymentTerms, Project, SavedAIAPayApp } from '@/types';
import { SAMPLE_DOC_NOT_SENT, isSampleProject } from '@/utils/sampleGuard';
import { showAlert } from '@/utils/alert';
import {
  computeAIATotals, isCalendarDay, selectPriorApplication,
  type AIAPayApplication, type PayAppContractLike,
} from '@/utils/aiaBilling';
import { INVOICE_OWNER_ONLY_REASON, invoiceRoleGate, nextInvoiceNumberFrom, noteIssuedInvoiceNumber, sessionIssuedInvoiceMax } from '@/utils/billingFlowCore';
import { todayCalendarDay } from '@/utils/calendarDate';
import { formatMoney } from '@/utils/formatters';
import { generateUUID } from '@/utils/generateId';
import { effectiveRetentionHeld, roundCents } from '@/utils/invoiceBilling';
import { payAppEasyIsOwnerPreview } from '@/utils/payApp/allowed';
import { shortDay } from '@/utils/payApp/days';
import { buildPeriodInvoice, periodRetainage } from '@/utils/payApp/periodInvoice';
import { buildCheckInput, checkFingerprint, runRejectionCheck } from '@/utils/payApp/rejectionCheck';
import { REJECTION_COPY } from '@/utils/payApp/rejectionCopy';
import { defaultApplicationDate, restatePeriodTo, rollForwardNextApplication, type RollForwardResult } from '@/utils/payApp/rollForward';
import { changeOrderLineCount, startFirstApplication } from '@/utils/payApp/firstApplication';
import { savedDraftFromApplication } from '@/utils/payApp/saveRecord';
import { SUGGEST_COPY, fmtPct } from '@/utils/payApp/suggestCopy';
import {
  acceptSuggestion, enterPercent, suggestForLines, tallyOpenSuggestions,
  type LineAcceptState,
} from '@/utils/payApp/suggestPercent';
import { BillThisMonthLine, type LineBeforeTyping } from './BillThisMonthLine';
import { usePeriodInvoiceTerms } from './usePeriodInvoiceTerms';
import { RejectionCheckSheet } from './RejectionCheckSheet';
import { makePayAppStyles } from './styles';

const TERMS_LABEL: Record<string, string> = {
  due_on_receipt: 'Due on Receipt', net_15: 'Net 15', net_30: 'Net 30', net_45: 'Net 45',
};

export interface BillThisMonthProps {
  project: Project;
  /** Every saved pay application on this project. */
  saved: SavedAIAPayApp[];
  /** The signed contract as the pay application screen read it (undefined = not read). */
  contract: PayAppContractLike | null | undefined;
  onClose: () => void;
  /** The period was saved as a draft against this new invoice. `checkedFor` is
   *  the fingerprint of the figures the Rejection Check was shown for. */
  onSaved: (done: { invoiceId: string; checkedFor: string }) => void;
}

export function BillThisMonth({ project, saved, contract, onClose, onSaved }: BillThisMonthProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makePayAppStyles);
  const { user } = useAuth();
  const {
    invoices, addInvoice, addAIAPayApp, settings,
    getChangeOrdersForProject, getDailyReportsForProject,
  } = useProjects();

  // Rolled forward ONCE per opening. A background sync that replaces the saved
  // list must not rebuild the lines under his hands.
  const rollRef = useRef<RollForwardResult | null | undefined>(undefined);
  if (rollRef.current === undefined) {
    const changeOrders = getChangeOrdersForProject(project.id);
    const today = todayCalendarDay();
    // The next application rolls forward from the last one. A job with none starts its first from the linked estimate.
    rollRef.current = rollForwardNextApplication({ project, saved, changeOrders, contract, today })
      ?? (settings?.branding ? startFirstApplication({
        project, saved, changeOrders, contract, today,
        branding: settings.branding,
        invoices,
      }) : null);
  }
  const roll = rollRef.current;

  const [app, setApp] = useState<AIAPayApplication | null>(roll ? roll.app : null);
  const [states, setStates] = useState<Record<string, LineAcceptState>>({});
  const [checkOpen, setCheckOpen] = useState(false);
  const savingRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const lineY = useRef<Record<string, number>>({});

  const tasks = project.schedule?.tasks;
  const dailyReports = useMemo(() => getDailyReportsForProject(project.id), [project.id, getDailyReportsForProject]);

  // What the schedule and the daily reports suggest. A value: reading it
  // changes nothing on `app`.
  const suggestions = useMemo(
    () => (app ? suggestForLines({ lines: app.lines, tasks: tasks ?? [], dailyReports, periodTo: app.periodTo }) : {}),
    [app, tasks, dailyReports],
  );
  const tally = useMemo(() => tallyOpenSuggestions(suggestions, states), [suggestions, states]);
  // The total is the application's own arithmetic over `thisPeriod`. An open
  // suggestion is not in `thisPeriod`, so it is not in here.
  const totals = useMemo(() => (app ? computeAIATotals(app) : null), [app]);

  const accept = useCallback((lineId: string) => {
    const r = suggestions[lineId];
    if (!r || r.kind !== 'suggest') return;
    setApp(prev => (prev ? { ...prev, lines: prev.lines.map(l => (l.id === lineId ? acceptSuggestion(l, r.suggestion) : l)) } : prev));
    setStates(prev => ({ ...prev, [lineId]: 'accepted' }));
  }, [suggestions]);

  const typePercent = useCallback((lineId: string, percent: number) => {
    const r = suggestions[lineId];
    const s = r && r.kind === 'suggest' ? r.suggestion : null;
    setApp(prev => (prev ? { ...prev, lines: prev.lines.map(l => (l.id === lineId ? enterPercent(l, percent, s) : l)) } : prev));
    setStates(prev => ({ ...prev, [lineId]: 'changed' }));
  }, [suggestions]);

  // A percent he typed was refused (or he emptied the field): the line goes
  // back to exactly what it held when he put the cursor in the field.
  const restoreLine = useCallback((lineId: string, before: LineBeforeTyping) => {
    setApp(prev => (prev ? {
      ...prev,
      lines: prev.lines.map((l) => {
        if (l.id !== lineId) return l;
        const { suggestedPercent: _p, suggestionSource: _s, ...rest } = l;
        void _p; void _s;
        return {
          ...rest,
          thisPeriod: before.thisPeriod,
          ...(before.suggestedPercent != null ? { suggestedPercent: before.suggestedPercent } : {}),
          ...(before.suggestionSource ? { suggestionSource: before.suggestionSource } : {}),
        };
      }),
    } : prev));
    setStates((prev) => {
      const next = { ...prev };
      if (before.state === 'untouched') delete next[lineId]; else next[lineId] = before.state;
      return next;
    });
  }, []);

  const acceptAll = useCallback(() => {
    if (tally.open === 0) return;
    showAlert(SUGGEST_COPY.acceptAllTitle, SUGGEST_COPY.acceptAllBody(tally.open, tally.openAmount), [
      { text: SUGGEST_COPY.cancel, style: 'cancel' },
      {
        text: SUGGEST_COPY.acceptAllConfirm,
        onPress: () => {
          const open = Object.entries(suggestions)
            .filter(([id, r]) => r.kind === 'suggest' && (states[id] ?? 'untouched') === 'untouched');
          const byId = new Map(open.map(([id, r]) => [id, r]));
          setApp(prev => (prev ? {
            ...prev,
            lines: prev.lines.map((l) => {
              const r = byId.get(l.id);
              return r && r.kind === 'suggest' ? acceptSuggestion(l, r.suggestion) : l;
            }),
          } : prev));
          setStates(prev => {
            const next = { ...prev };
            for (const [id] of open) next[id] = 'accepted';
            return next;
          });
        },
      },
    ]);
  }, [tally, suggestions, states]);

  const setPeriodTo = useCallback((v: string) => {
    const cos = getChangeOrdersForProject(project.id);
    const today = todayCalendarDay();
    setApp((prev) => {
      if (!prev) return prev;
      const next = restatePeriodTo(prev, cos, v);
      // The application date follows the period end while it is still the
      // default; a date he typed himself stays.
      return prev.applicationDate === defaultApplicationDate(today, prev.periodTo) && isCalendarDay(v)
        ? { ...next, applicationDate: defaultApplicationDate(today, v) }
        : next;
    });
  }, [getChangeOrdersForProject, project.id]);
  const setApplicationDate = useCallback((v: string) => {
    setApp(prev => (prev ? { ...prev, applicationDate: v } : prev));
  }, []);
  const setPeriodFrom = useCallback((v: string) => {
    setApp(prev => (prev ? { ...prev, periodFrom: v || undefined, changeOrderSummary: undefined } : prev));
  }, []);

  // The Rejection Check, on the figures on screen. Its inputs are built by
  // the ONE helper the pay application screen uses (buildCheckInput), so this
  // is the check that screen would show for the same figures: the rate on
  // record, the change order log and the prior application included.
  const prior = useMemo(() => (app ? selectPriorApplication(saved, {
    thisApplicationNumber: app.applicationNumber, thisPeriodTo: app.periodTo,
  }) : null), [saved, app]);
  const checkInput = useMemo(() => (app ? buildCheckInput({
    app, project, savedForProject: saved, changeOrders: getChangeOrdersForProject(project.id),
  }) : null), [app, project, saved, getChangeOrdersForProject]);
  const check = useMemo(() => (checkInput && checkOpen ? runRejectionCheck(checkInput) : null), [checkInput, checkOpen]);

  // The draft invoice this period will make: terms first, then the figures.
  const projectInvoices = useMemo(() => invoices.filter(i => i.projectId === project.id), [invoices, project.id]);
  const priorInvoice = prior?.invoiceId ? projectInvoices.find(i => i.id === prior.invoiceId) : undefined;
  const { terms: periodTerms, resolve: resolvePeriodTerms } = usePeriodInvoiceTerms(priorInvoice, user?.id);
  const invoiceTaxRate = priorInvoice?.taxRate ?? settings?.taxRate ?? 0;
  const invoicePreview = useMemo(() => (app ? buildPeriodInvoice({
    projectId: project.id,
    lines: app.lines,
    estimateItems: project.linkedEstimate?.items,
    applicationNumber: app.applicationNumber,
    number: 0,
    now: '',
    taxRate: invoiceTaxRate,
    terms: { paymentTerms: 'net_30', confirmed: false },
    newInvoiceId: () => 'preview',
    newLineId: () => 'preview',
  }) : null), [app, project.id, project.linkedEstimate?.items, invoiceTaxRate]);

  // He is about to see the check or save: the keyboard goes, and with it any
  // field that still has the cursor. (A percent is on the line the moment it
  // is typed, so there is nothing left to carry over.)
  const openCheck = useCallback(() => {
    Keyboard.dismiss();
    setCheckOpen(true);
  }, []);

  // Leaving with figures entered asks first: nothing is saved until Continue.
  const entered = Object.keys(states).length;
  const leave = useCallback(() => {
    if (entered === 0) { onClose(); return; }
    showAlert(SUGGEST_COPY.leaveTitle, SUGGEST_COPY.leaveBody(entered), [
      { text: SUGGEST_COPY.leaveStay, style: 'cancel' },
      { text: SUGGEST_COPY.leaveConfirm, style: 'destructive', onPress: onClose },
    ]);
  }, [entered, onClose]);

  const goToLine = useCallback((lineId: string) => {
    setCheckOpen(false);
    const y = lineY.current[lineId];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, []);

  // Only the project's owner bills (the same rule as Bill From Estimate).
  const roleState = useProjectRoleState(project.id);
  const roleGate = invoiceRoleGate({
    hasProject: true,
    role: roleState.role,
    isLoading: roleState.isLoading,
    isError: roleState.isError,
    isPaused: roleState.isPaused,
    stampedRole: project.myRole,
    ownedLocally: !!project.ownerUserId && !!user?.id && project.ownerUserId === user.id,
  });

  const saveDraft = useCallback(async () => {
    if (!app || !checkInput || savingRef.current) return;
    Keyboard.dismiss();
    if (roleGate !== 'open') {
      showAlert(SUGGEST_COPY.ownerOnly, INVOICE_OWNER_ONLY_REASON);
      return;
    }
    savingRef.current = true;
    // The same resolver Bill From Estimate uses, finished here if the tap beat
    // it (the read is bounded). Terms he has not confirmed put NO due date on
    // the invoice.
    let terms: { paymentTerms: PaymentTerms; confirmed: boolean };
    try { terms = await resolvePeriodTerms(); } catch { terms = { paymentTerms: 'net_30', confirmed: false }; }
    const now = new Date().toISOString();
    const invoice = buildPeriodInvoice({
      projectId: project.id,
      lines: app.lines,
      estimateItems: project.linkedEstimate?.items,
      applicationNumber: app.applicationNumber,
      number: nextInvoiceNumberFrom(projectInvoices, sessionIssuedInvoiceMax.get(project.id) ?? 0),
      now,
      taxRate: invoiceTaxRate,
      terms: { paymentTerms: terms.paymentTerms, confirmed: terms.confirmed },
      newInvoiceId: generateUUID,
      newLineId: generateUUID,
    });
    if (!invoice) {
      savingRef.current = false;
      setCheckOpen(false);
      showAlert(SUGGEST_COPY.screenTitle, SUGGEST_COPY.nothingEntered);
      return;
    }
    addInvoice(invoice);
    noteIssuedInvoiceNumber(invoice.projectId, invoice.number);
    addAIAPayApp(savedDraftFromApplication({
      app,
      id: generateUUID(),
      projectId: project.id,
      invoiceId: invoice.id,
      changeOrders: getChangeOrdersForProject(project.id),
      savedAt: now,
    }));
    setCheckOpen(false);
    onSaved({ invoiceId: invoice.id, checkedFor: checkFingerprint(checkInput) });
  }, [app, checkInput, roleGate, projectInvoices, project, invoiceTaxRate, resolvePeriodTerms, addInvoice, addAIAPayApp, getChangeOrdersForProject, onSaved]);

  const header = (
    <Stack.Screen
      options={{
        title: SUGGEST_COPY.screenTitle,
        headerLeft: () => (
          <Pressable onPress={leave} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back" testID="btm-back">
            <ChevronLeft size={24} color={colors.accent} strokeWidth={1.75} />
          </Pressable>
        ),
      }}
    />
  );

  if (!roll || !app || !totals) {
    return (
      <View style={styles.screen} testID="btm-none">
        {header}
        <View style={styles.body}>
          {/* With no earlier application the screen was opened to start a first one, and that was refused. */}
          <Text style={styles.headerName}>{saved.some(a => a.lines.length > 0) ? SUGGEST_COPY.noPriorTitle : SUGGEST_COPY.firstCannotStartTitle}</Text>
          <Text style={styles.lead}>{saved.some(a => a.lines.length > 0) ? SUGGEST_COPY.noPriorBody : SUGGEST_COPY.firstCannotStartBody}</Text>
          <Button label={REJECTION_COPY.back} onPress={onClose} variant="secondary" />
        </View>
      </View>
    );
  }

  const workThis = roundCents(app.lines.reduce((s, l) => s + l.thisPeriod, 0));
  const sample = isSampleProject(project);
  const termsLabel = periodTerms ? (TERMS_LABEL[periodTerms.paymentTerms] ?? '') : '';
  const periodLine = `Pay Application ${app.applicationNumber}`
    + (shortDay(app.periodTo) ? `, ${shortDay(app.periodFrom) ? `${shortDay(app.periodFrom)} to ` : 'through '}${shortDay(app.periodTo)}` : '');

  return (
    <View style={styles.screen} testID="bill-this-month">
      {header}
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.body, { paddingBottom: 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.note}>{project.name}</Text>
          <Text style={styles.headerName}>{SUGGEST_COPY.screenTitle}</Text>
          <Text style={styles.headerSub} testID="btm-period-line">{periodLine}</Text>
          {payAppEasyIsOwnerPreview() ? (
            <View style={styles.preview}><Text style={styles.previewText}>{SUGGEST_COPY.ownerPreview}</Text></View>
          ) : null}
        </View>

        <View style={styles.periodCard}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Period From</Text>
            <TextInput
              style={styles.fieldInput}
              value={app.periodFrom ?? ''}
              onChangeText={setPeriodFrom}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Period From"
              testID="btm-period-from"
            />
          </View>
          {!!app.periodFrom && !isCalendarDay(app.periodFrom) ? (
            <Text style={styles.fieldError}>Type the date as year, month, day, like 2026-10-01.</Text>
          ) : null}
          {!app.periodFrom && !roll.period.from ? <Text style={styles.note}>{roll.carriedFrom ? SUGGEST_COPY.periodNoStart : SUGGEST_COPY.firstPeriodNoStart}</Text> : null}
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Period To</Text>
            <TextInput
              style={styles.fieldInput}
              value={app.periodTo}
              onChangeText={setPeriodTo}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Period To"
              testID="btm-period-to"
            />
          </View>
          {!isCalendarDay(app.periodTo) ? (
            <Text style={styles.fieldError}>Type the date as year, month, day, like 2026-10-31.</Text>
          ) : app.periodTo === roll.period.to ? (
            <Text style={styles.note}>{SUGGEST_COPY.periodToDefault}</Text>
          ) : null}
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Application Date</Text>
            <TextInput
              style={styles.fieldInput}
              value={app.applicationDate}
              onChangeText={setApplicationDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Application Date"
              testID="btm-application-date"
            />
          </View>
          {!isCalendarDay(app.applicationDate) ? (
            <Text style={styles.fieldError}>Type the date as year, month, day, like 2026-10-31.</Text>
          ) : app.applicationDate === app.periodTo ? (
            <Text style={styles.note}>{SUGGEST_COPY.applicationDateFollows}</Text>
          ) : null}
        </View>

        {/* Where this period starts from, when that needs saying. */}
        {roll.notes.map((n) => (n.kind === 'prior_not_sent' ? (
          <Text key={`ns-${n.applicationNumber}`} style={styles.fieldError} testID="btm-prior-not-sent">{SUGGEST_COPY.priorNotSent(n.applicationNumber)}</Text>
        ) : n.kind === 'undated_skipped' ? (
          <Text key={`us-${n.applicationNumber}`} style={styles.fieldError} testID="btm-undated-skipped">{SUGGEST_COPY.undatedSkipped(n.applicationNumber, n.carriedFrom)}</Text>
        ) : n.kind === 'retainage_from_record' ? (
          <Text key="rr" style={styles.note} testID="btm-retainage-record">{SUGGEST_COPY.retainageFromRecord(fmtPct(n.percent), n.label)}</Text>
        ) : n.kind === 'retainage_not_on_record' ? (
          <Text key="rn" style={styles.fieldError} testID="btm-retainage-none">{SUGGEST_COPY.retainageNotOnRecord}</Text>
        ) : null))}
        {sample ? <Text style={styles.note} testID="btm-sample">{SAMPLE_DOC_NOT_SENT}</Text> : null}

        {roll.carriedFrom ? null : <Text style={styles.lead} testID="btm-first">{SUGGEST_COPY.firstLead}</Text>}
        <Text style={styles.lead}>{SUGGEST_COPY.lead}</Text>
        <Text style={styles.heading}>{roll.carriedFrom ? SUGGEST_COPY.carriedHeading(roll.carriedFrom.applicationNumber) : SUGGEST_COPY.firstHeading(app.lines.length - changeOrderLineCount(app.lines), changeOrderLineCount(app.lines))}</Text>
        <View>
          {app.lines.map(line => (
            <View key={line.id} onLayout={(e) => { lineY.current[line.id] = e.nativeEvent.layout.y; }}>
              <BillThisMonthLine
                line={line}
                result={suggestions[line.id]}
                state={states[line.id] ?? 'untouched'}
                onAccept={() => accept(line.id)}
                onPercent={(p) => typePercent(line.id, p)}
                onRestore={(before) => restoreLine(line.id, before)}
              />
            </View>
          ))}
        </View>
        {tally.open > 1 ? (
          <Pressable onPress={acceptAll} style={styles.linkBtn} accessibilityRole="button" accessibilityLabel={SUGGEST_COPY.acceptAll} testID="btm-accept-all">
            <Text style={styles.linkText}>{SUGGEST_COPY.acceptAll}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.footerInner}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{SUGGEST_COPY.workThisApplication}</Text>
            <Text style={styles.totalValue} testID="btm-work-total">{formatMoney(workThis, 2)}</Text>
          </View>
          {/* The cover's lines 4 to 8, so the footer ADDS UP when money
              carries in from earlier applications: 4 less 5 is 6, and 6 less
              7 is the payment due. */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{SUGGEST_COPY.completedToDate}</Text>
            <Text style={styles.totalValue} testID="btm-completed-to-date">{formatMoney(totals.totalCompletedAndStored, 2)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{SUGGEST_COPY.retainageToDate}</Text>
            <Text style={styles.totalValue} testID="btm-retainage-to-date">{totals.totalRetainage === 0 ? formatMoney(0, 2) : `-${formatMoney(totals.totalRetainage, 2)}`}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{SUGGEST_COPY.completedLessRetainage}</Text>
            <Text style={styles.totalValue} testID="btm-less-retainage">{formatMoney(totals.totalEarnedLessRetainage, 2)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{SUGGEST_COPY.lessPreviousCertificates}</Text>
            <Text style={styles.totalValue} testID="btm-less-previous">{app.lessPreviousCertificates === 0 ? formatMoney(0, 2) : `-${formatMoney(app.lessPreviousCertificates, 2)}`}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.dueLabel}>{SUGGEST_COPY.paymentDue}</Text>
            <Text style={styles.dueValue} testID="btm-payment-due">{formatMoney(totals.currentPaymentDue, 2)}</Text>
          </View>
          <Button label={SUGGEST_COPY.next} onPress={openCheck} fullWidth testID="btm-next" />
          {/* The draft invoice saving will make, said before he saves. */}
          {invoicePreview ? (
            <Text style={styles.footerNote} testID="btm-invoice-line">
              {SUGGEST_COPY.invoiceLine(formatMoney(invoicePreview.totalDue, 2), invoicePreview.taxRate > 0 ? fmtPct(invoicePreview.taxRate) : null)}
              {periodRetainage(app.lines) > 0 ? ` ${SUGGEST_COPY.invoiceRetainageLine(formatMoney(effectiveRetentionHeld(invoicePreview), 2))}` : ''}
              {' '}
              {!periodTerms ? SUGGEST_COPY.termsChecking
                : periodTerms.origin === 'prior_invoice' ? SUGGEST_COPY.termsFromPrior(termsLabel)
                  : periodTerms.origin === 'cash_flow_setup' ? SUGGEST_COPY.termsFromSetup(termsLabel)
                    : SUGGEST_COPY.termsUnconfirmed}
            </Text>
          ) : null}
          {tally.open > 0 ? (
            <Text style={styles.footerNote} testID="btm-not-accepted">{SUGGEST_COPY.notAccepted(tally.open)}</Text>
          ) : null}
        </View>
      </View>

      <RejectionCheckSheet
        visible={checkOpen}
        result={check}
        onClose={() => setCheckOpen(false)}
        onGoToLine={goToLine}
        onContinue={saveDraft}
        testID="btm-check"
      />
    </View>
  );
}
