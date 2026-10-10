// utils/payApp/saveRecord.ts — the saved record for a pay application that was
// started from Bill This Month.
//
// The same record app/aia-pay-app.tsx buildSavedRecord writes: the lines
// through sovLineToSaved, the totals from computeAIATotals, and the change
// order summary frozen as it stood. It is a DRAFT: no pay link, no stamp. The
// screen saves it through addAIAPayApp (local first, then the offline queue).
//
// Pure: the id, the invoice id and the clock are passed in.
import type { ChangeOrder, SavedAIAPayApp } from '@/types';
import {
  computeAIATotals, sovLineToSaved, summarizeChangeOrders,
  type AIAPayApplication,
} from '@/utils/aiaBilling';

export function savedDraftFromApplication(input: {
  app: AIAPayApplication;
  id: string;
  projectId: string;
  invoiceId: string;
  changeOrders: readonly ChangeOrder[];
  /** ISO instant, passed in. */
  savedAt: string;
}): SavedAIAPayApp {
  const { app } = input;
  const totals = computeAIATotals(app);
  return {
    id: input.id,
    projectId: input.projectId,
    invoiceId: input.invoiceId,
    applicationNumber: app.applicationNumber,
    applicationDate: app.applicationDate,
    periodTo: app.periodTo,
    periodFrom: app.periodFrom,
    contractDate: app.contractDate,
    ownerName: app.ownerName,
    contractorName: app.contractorName,
    architectName: app.architectName,
    projectName: app.projectName,
    projectLocation: app.projectLocation,
    contractForDescription: app.contractForDescription,
    originalContractSum: app.originalContractSum,
    netChangeByCO: app.netChangeByCO,
    contractSumToDate: app.contractSumToDate,
    retainagePercent: app.retainagePercent,
    storedRetainagePercent: app.storedRetainagePercent,
    lessPreviousCertificates: app.lessPreviousCertificates,
    changeOrderSummary: app.changeOrderSummary
      ?? summarizeChangeOrders([...input.changeOrders], app.periodFrom, app.periodTo || undefined),
    notarize: app.notarize,
    notaryState: app.notaryState,
    notaryCounty: app.notaryCounty,
    sovBasis: app.sovBasis,
    lines: app.lines.map(sovLineToSaved),
    notes: app.notes,
    totals: {
      totalScheduledValue: totals.totalScheduledValue,
      totalCompletedAndStored: totals.totalCompletedAndStored,
      totalRetainage: totals.totalRetainage,
      totalEarnedLessRetainage: totals.totalEarnedLessRetainage,
      currentPaymentDue: totals.currentPaymentDue,
      balanceToFinish: totals.balanceToFinish,
      percentComplete: totals.percentComplete,
    },
    savedAt: input.savedAt,
  };
}
