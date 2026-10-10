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
//     `typePercent`, and each is his tap or his keystroke. The footer adds up
//     `thisPeriod` and nothing else, and says how many suggestions are not in
//     it.
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
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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
import { showAlert } from '@/utils/alert';
import {
  computeAIATotals, isCalendarDay, selectPriorApplication,
  type AIAPayApplication, type PayAppContractLike,
} from '@/utils/aiaBilling';
import { INVOICE_OWNER_ONLY_REASON, invoiceRoleGate, nextInvoiceNumberFrom, noteIssuedInvoiceNumber, sessionIssuedInvoiceMax } from '@/utils/billingFlowCore';
import { todayCalendarDay } from '@/utils/calendarDate';
import { formatMoney } from '@/utils/formatters';
import { generateUUID } from '@/utils/generateId';
import { retainageOnWorkValue, roundCents } from '@/utils/invoiceBilling';
import { payAppEasyIsOwnerPreview } from '@/utils/payApp/allowed';
import { shortDay } from '@/utils/payApp/days';
import { buildPeriodInvoice } from '@/utils/payApp/periodInvoice';
import { checkFingerprint, runRejectionCheck } from '@/utils/payApp/rejectionCheck';
import { REJECTION_COPY } from '@/utils/payApp/rejectionCopy';
import { restatePeriodTo, rollForwardNextApplication, type RollForwardResult } from '@/utils/payApp/rollForward';
import { savedDraftFromApplication } from '@/utils/payApp/saveRecord';
import { SUGGEST_COPY, fmtPct } from '@/utils/payApp/suggestCopy';
import {
  acceptSuggestion, enterPercent, suggestForLines, tallyOpenSuggestions,
  type LineAcceptState,
} from '@/utils/payApp/suggestPercent';
import { BillThisMonthLine } from './BillThisMonthLine';
import { RejectionCheckSheet } from './RejectionCheckSheet';
import { makePayAppStyles } from './styles';

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
    rollRef.current = rollForwardNextApplication({
      project,
      saved,
      changeOrders: getChangeOrdersForProject(project.id),
      contract,
      today: todayCalendarDay(),
    });
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
    setApp(prev => (prev ? restatePeriodTo(prev, cos, v) : prev));
  }, [getChangeOrdersForProject, project.id]);
  const setPeriodFrom = useCallback((v: string) => {
    setApp(prev => (prev ? { ...prev, periodFrom: v || undefined, changeOrderSummary: undefined } : prev));
  }, []);

  // The Rejection Check, on the figures on screen.
  const prior = useMemo(() => (app ? selectPriorApplication(saved, {
    thisApplicationNumber: app.applicationNumber, thisPeriodTo: app.periodTo,
  }) : null), [saved, app]);
  const check = useMemo(() => (app && checkOpen ? runRejectionCheck({
    app, prior, saved, changeOrders: getChangeOrdersForProject(project.id),
  }) : null), [app, checkOpen, prior, saved, getChangeOrdersForProject, project.id]);

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

  const saveDraft = useCallback(() => {
    if (!app || savingRef.current) return;
    if (roleGate !== 'open') {
      showAlert(SUGGEST_COPY.ownerOnly, INVOICE_OWNER_ONLY_REASON);
      return;
    }
    const projectInvoices = invoices.filter(i => i.projectId === project.id);
    const priorInvoice = prior?.invoiceId ? projectInvoices.find(i => i.id === prior.invoiceId) : undefined;
    const terms: PaymentTerms = priorInvoice?.paymentTerms ?? 'net_30';
    const now = new Date().toISOString();
    const invoice = buildPeriodInvoice({
      projectId: project.id,
      lines: app.lines,
      estimateItems: project.linkedEstimate?.items,
      applicationNumber: app.applicationNumber,
      number: nextInvoiceNumberFrom(projectInvoices, sessionIssuedInvoiceMax.get(project.id) ?? 0),
      now,
      taxRate: priorInvoice?.taxRate ?? settings?.taxRate ?? 0,
      paymentTerms: terms,
      retainagePercent: app.retainagePercent,
      newInvoiceId: generateUUID,
      newLineId: generateUUID,
    });
    if (!invoice) {
      setCheckOpen(false);
      showAlert(SUGGEST_COPY.screenTitle, SUGGEST_COPY.nothingEntered);
      return;
    }
    savingRef.current = true;
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
    onSaved({ invoiceId: invoice.id, checkedFor: checkFingerprint(app) });
  }, [app, roleGate, invoices, project, prior, settings?.taxRate, addInvoice, addAIAPayApp, getChangeOrdersForProject, onSaved]);

  const header = (
    <Stack.Screen
      options={{
        title: SUGGEST_COPY.screenTitle,
        headerLeft: () => (
          <Pressable onPress={onClose} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back" testID="btm-back">
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
          <Text style={styles.headerName}>{SUGGEST_COPY.noPriorTitle}</Text>
          <Text style={styles.lead}>{SUGGEST_COPY.noPriorBody}</Text>
          <Button label={REJECTION_COPY.back} onPress={onClose} variant="secondary" />
        </View>
      </View>
    );
  }

  const workThis = roundCents(app.lines.reduce((s, l) => s + l.thisPeriod, 0));
  const retainageThis = roundCents(app.lines.reduce((s, l) => s + retainageOnWorkValue(l.thisPeriod, l.retainagePercent), 0));
  const oneRate = app.lines.every(l => l.retainagePercent === app.retainagePercent);
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
          {!app.periodFrom && !roll.period.from ? <Text style={styles.note}>{SUGGEST_COPY.periodNoStart}</Text> : null}
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
        </View>

        <Text style={styles.lead}>{SUGGEST_COPY.lead}</Text>
        <Text style={styles.heading}>{SUGGEST_COPY.carriedHeading(roll.carriedFrom.applicationNumber)}</Text>
        <View>
          {app.lines.map(line => (
            <View key={line.id} onLayout={(e) => { lineY.current[line.id] = e.nativeEvent.layout.y; }}>
              <BillThisMonthLine
                line={line}
                result={suggestions[line.id]}
                state={states[line.id] ?? 'untouched'}
                onAccept={() => accept(line.id)}
                onPercent={(p) => typePercent(line.id, p)}
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
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{oneRate ? SUGGEST_COPY.retainageAt(fmtPct(app.retainagePercent)) : SUGGEST_COPY.retainageMixed}</Text>
            <Text style={styles.totalValue}>{`-${formatMoney(retainageThis, 2)}`}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.dueLabel}>{SUGGEST_COPY.paymentDue}</Text>
            <Text style={styles.dueValue} testID="btm-payment-due">{formatMoney(totals.currentPaymentDue, 2)}</Text>
          </View>
          <Button label={SUGGEST_COPY.next} onPress={() => setCheckOpen(true)} fullWidth testID="btm-next" />
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
