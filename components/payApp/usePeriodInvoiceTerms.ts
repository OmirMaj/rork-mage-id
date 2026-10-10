// components/payApp/usePeriodInvoiceTerms.ts — the payment terms on the draft
// invoice Bill This Month makes. Easier Pay Applications, Phase 1.
//
// NEVER A SILENT NET 30. The terms come from, in order:
//   1. the last invoice on this job, when it carries terms AND a due date (he
//      has already billed this job on those terms);
//   2. his finished cash-flow setup, through the SAME resolver the invoice
//      editor and Bill From Estimate use (the block below is their block, kept
//      byte-identical; scripts/validate-pay-app-easy.ts pins it);
//   3. otherwise nothing is confirmed: the invoice keeps the app's Net 30 as a
//      placeholder with NO due date, the screen says so before he saves, and
//      the invoice editor says so until he picks.
//
// The effect here only reads his settings. It writes no figure, on any line.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Invoice, PaymentTerms } from '@/types';
import { loadCashFlowSettings } from '@/utils/cashFlowStorage';

// <invoice-terms-default> — keep byte-identical in app/invoice.tsx and
// app/bill-from-estimate.tsx; scripts/validate-invoice-terms.ts executes both
// copies and fails if they drift.
//
// The GC already told the app how he gets paid: cash-flow setup asks for his
// payment terms (CashFlowData.defaultPaymentTerms), and the forecast times
// every receivable by it. New invoices used to open on a hard-coded Net 30
// anyway, so a GC on Net 15 issued Net 30 paper while his forecast expected
// the money two weeks earlier. This turns his setting into the default.
//
// It is only HIS setting when he finished cash-flow setup and the value came
// from a real record (server row or device cache). The three origins keep the
// picker's caption honest:
//   cash_flow_setup — his finished setup names one of the four terms.
//   fallback        — a real record answered, and it holds no usable terms
//                     (setup unfinished, or a value like net_60 / "2/10 net 30"
//                     that is never forced onto the nearest term).
//   unconfirmed     — nothing answered. `source: 'default'` is the loader's
//                     own net_30 placeholder, and the loader returns it both
//                     for "no row" and for "the server read failed with no
//                     device cache" (utils/cashFlowStorage swallows the error),
//                     so it cannot be told apart from an outage and must not
//                     be captioned as "you have no setting".
// The two vocabularies are the same four keys today; the normaliser tolerates
// spacing/case drift ("Net 15", "net-15", "NET15") because the column is free
// text.
type InvoiceTermsDefault = {
  terms: 'net_15' | 'net_30' | 'net_45' | 'due_on_receipt';
  // 'contract' never comes out of this block: app/invoice.tsx sets it when a
  // signed contract row already fixed the terms (utils/billingFlowCore
  // milestoneContractTerms), and nothing in cash-flow setup may overwrite it.
  origin: 'cash_flow_setup' | 'fallback' | 'unconfirmed' | 'contract';
};
type CashFlowTermsSettings = { data?: { defaultPaymentTerms?: unknown } | null; setupComplete?: boolean; source?: string } | null | undefined;
function invoiceTermsDefaultFromCashFlow(settings: CashFlowTermsSettings): InvoiceTermsDefault {
  const unconfirmed: InvoiceTermsDefault = { terms: 'net_30', origin: 'unconfirmed' };
  const fallback: InvoiceTermsDefault = { terms: 'net_30', origin: 'fallback' };
  if (!settings || settings.source === 'default') return unconfirmed;
  if (settings.setupComplete !== true) return fallback;
  const raw = settings.data?.defaultPaymentTerms;
  if (typeof raw !== 'string') return fallback;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const net = /^net_?(\d+)$/.exec(key);
  const normalised = net ? `net_${Number(net[1])}` : key.replace(/^(due_)?(up)?on_receipt$/, 'due_on_receipt');
  if (normalised === 'net_15' || normalised === 'net_30' || normalised === 'net_45' || normalised === 'due_on_receipt') {
    return { terms: normalised, origin: 'cash_flow_setup' };
  }
  return fallback;
}
// The server read-through, bounded. Offline, the Supabase fetch can hang far
// longer than a GC will wait on an invoice, so past the budget the read counts
// as failed — the caption then says his setup could not be reached rather than
// sitting on "Checking…" forever. The loader is passed in so this block stays
// free of imports and the validator can execute it with a fake.
const INVOICE_TERMS_SERVER_WAIT_MS = 5000;
async function readServerInvoiceTerms(
  load: () => Promise<CashFlowTermsSettings>,
  waitMs: number = INVOICE_TERMS_SERVER_WAIT_MS,
): Promise<InvoiceTermsDefault | 'failed'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<'failed'>(resolve => { timer = setTimeout(() => resolve('failed'), waitMs); });
    const read = load().then(invoiceTermsDefaultFromCashFlow, () => 'failed' as const);
    return await Promise.race([read, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
// Combines the two reads. The device cache answers in milliseconds, but after a
// sign-in, a tenant switch (wipeLocalUserCache sweeps mage_cashflow_*) or on a
// fresh browser it is EMPTY — so for a signed-in GC an empty/unusable cache is
// not an answer: we keep waiting on the server (null = still loading) instead
// of flashing Net 30 and a "no setting" caption he would then see corrected.
// A cache that DOES carry his terms is shown at once; a server answer, when it
// arrives, is fresher and wins.
type ServerInvoiceTerms = 'not_signed_in' | 'pending' | 'failed' | InvoiceTermsDefault;
function settleInvoiceTermsDefault(
  cache: InvoiceTermsDefault | null,
  server: ServerInvoiceTerms,
): InvoiceTermsDefault | null {
  if (typeof server === 'object') return server;
  if (cache?.origin === 'cash_flow_setup') return cache;
  if (server === 'pending') return null;
  if (server === 'not_signed_in' && cache) return cache;
  return { terms: 'net_30', origin: 'unconfirmed' };
}
// </invoice-terms-default>

export type PeriodTermsOrigin = 'prior_invoice' | 'cash_flow_setup' | 'unconfirmed';
export interface PeriodTermsAnswer {
  paymentTerms: PaymentTerms;
  /** False = the app's default, not his: no due date is worked out. */
  confirmed: boolean;
  origin: PeriodTermsOrigin;
}

/** The resolver's answer as Bill This Month uses it. Only his own setup confirms terms. */
export function periodTermsFromDefault(d: InvoiceTermsDefault | null): PeriodTermsAnswer {
  if (d && d.origin === 'cash_flow_setup') return { paymentTerms: d.terms, confirmed: true, origin: 'cash_flow_setup' };
  return { paymentTerms: 'net_30', confirmed: false, origin: 'unconfirmed' };
}

/** The last invoice on this job answers when it has both terms and a due date. */
export function periodTermsFromPriorInvoice(prior: Pick<Invoice, 'paymentTerms' | 'dueDate'> | null | undefined): PeriodTermsAnswer | null {
  if (!prior || !prior.paymentTerms || !prior.dueDate) return null;
  return { paymentTerms: prior.paymentTerms, confirmed: true, origin: 'prior_invoice' };
}

/**
 * `terms` is null while his setup is still being read. `resolve` finishes the
 * reads (bounded: readServerInvoiceTerms gives up after a few seconds) and
 * returns the answer, for the tap that saves.
 */
export function usePeriodInvoiceTerms(
  priorInvoice: Pick<Invoice, 'paymentTerms' | 'dueDate'> | null | undefined,
  userId: string | null | undefined,
): { terms: PeriodTermsAnswer | null; resolve: () => Promise<PeriodTermsAnswer> } {
  const fromPrior = periodTermsFromPriorInvoice(priorInvoice);
  const [settled, setSettled] = useState<PeriodTermsAnswer | null>(null);
  const cacheRef = useRef<InvoiceTermsDefault | null>(null);
  const serverRef = useRef<ServerInvoiceTerms>('pending');
  const serverPromiseRef = useRef<Promise<InvoiceTermsDefault | 'failed'> | null>(null);
  const hasPrior = !!fromPrior;

  useEffect(() => {
    if (hasPrior) return undefined;
    let cancelled = false;
    const settle = () => {
      if (cancelled) return;
      const resolved = settleInvoiceTermsDefault(cacheRef.current, serverRef.current);
      if (resolved) setSettled(periodTermsFromDefault(resolved));
    };
    void (async () => {
      try { cacheRef.current = invoiceTermsDefaultFromCashFlow(await loadCashFlowSettings()); } catch { cacheRef.current = null; }
      settle();
    })();
    if (!userId) {
      serverRef.current = 'not_signed_in';
      serverPromiseRef.current = null;
      settle();
    } else {
      serverRef.current = 'pending';
      const p = readServerInvoiceTerms(() => loadCashFlowSettings(userId));
      serverPromiseRef.current = p;
      void p.then((r) => { if (!cancelled) { serverRef.current = r; settle(); } });
    }
    return () => { cancelled = true; };
  }, [hasPrior, userId]);

  const resolve = useCallback(async (): Promise<PeriodTermsAnswer> => {
    if (fromPrior) return fromPrior;
    if (!cacheRef.current) {
      try { cacheRef.current = invoiceTermsDefaultFromCashFlow(await loadCashFlowSettings()); } catch { cacheRef.current = null; }
    }
    if (serverRef.current === 'pending' && cacheRef.current?.origin !== 'cash_flow_setup' && serverPromiseRef.current) {
      serverRef.current = await serverPromiseRef.current;
    }
    return periodTermsFromDefault(settleInvoiceTermsDefault(cacheRef.current, serverRef.current));
  }, [fromPrior]);

  return { terms: fromPrior ?? settled, resolve };
}
