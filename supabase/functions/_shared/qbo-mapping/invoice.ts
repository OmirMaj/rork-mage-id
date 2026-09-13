import { qboFetch, qboHash, svc, type QboConnectionRow } from "../qbo.ts";
import { retentionPending } from "../paymentMath.ts";
// linked_estimate moved to project_financials — see financials.ts.
import { readLinkedEstimateItems } from "./financials.ts";

// ─────────────────────────────────────────────────────────────────────────────
// MONEY-QBO-1 (audit 2026-09-11). This mapper is the $79 Business feature that
// writes into the GC's REAL books, and it used to post a number that was not
// the invoice.
//
// Three omissions, all in the same direction — QuickBooks carried a bigger
// receivable than MAGE ever billed:
//
//  1. PROGRESS BILLING WAS IGNORED. utils/invoiceBilling.ts documents that a
//     NATIVE-EDITOR progress invoice stores the FULL line total and scales ONCE
//     at the invoice level (`progressSubtotal`). This file pushed `li.total`
//     raw, so a 30% progress billing of $30,000 posted to QuickBooks as a
//     $100,000 invoice. `payment.ts` then applied the $30,000 the client
//     actually paid against it, leaving a $70,000 phantom receivable that
//     ages forever in A/R and inflates reported revenue in the GC's own P&L.
//
//  2. SALES TAX WAS DROPPED. `tax_amount` and `total_due` were SELECTed and
//     never read, so a taxed invoice posted short by the tax.
//
//  3. RETAINAGE WAS NEVER WITHHELD. A 10%-held invoice posted gross, so it sat
//     open in QuickBooks by the retainage until closeout with no explanation.
//
// THE RULE THIS FILE NOW FOLLOWS: the QuickBooks invoice must equal what the
// client is actually being asked to pay today — `total_due` less the retainage
// still held, which is exactly `netBalanceDue`'s numerator and exactly what the
// Stripe pay link charges. Retainage is carried as an explicit negative line so
// it is visible and so releasing it later simply shrinks that line.
//
// AND THE POST-CONDITION: after the push we compare QuickBooks' OWN returned
// `TotalAmt` against the figure we intended. QuickBooks recomputes totals
// server-side (Automated Sales Tax in particular can override a supplied tax
// figure), so "we sent the right body" is not evidence the ledger is right.
// If the two disagree by more than a cent we refuse to mark the row synced and
// throw a message naming both numbers — a loud refusal the GC can act on beats
// a silent wrong ledger in books an accountant will file from.
// ─────────────────────────────────────────────────────────────────────────────

// EVERY NUMERIC COLUMN IS TYPED `number | string`, and that is not defensive
// noise. PostgREST hands NUMERIC back as a STRING — the fact
// supabase/functions/_shared/paymentMath.ts states in its own header and
// coerces for, because the Stripe webhook reads the same four retention
// columns off the same table. `line_items` is JSONB, so the figures INSIDE it
// really are JSON numbers; the COLUMNS around it are not.
//
// This matters more here than anywhere else in the file: the first cut of this
// fix tested `Number.isFinite(inv.subtotal)` directly, and `Number.isFinite("75595")`
// is FALSE. Every retainage row would have fallen back to the stale stored
// column and every invoice would have failed the footing check below — a
// mapper that refuses to push anything at all.
interface MageInvoiceRow {
  id: string; user_id: string; project_id: string;
  number: number; issue_date: string; due_date: string; notes: string | null;
  line_items: Array<{ id: string; name: string; description?: string; quantity: number; unitPrice: number; total: number; sourceEstimateItemId?: string | null; billedPercent?: number | null }>;
  total_due: number | string | null; tax_amount: number | string | null; subtotal: number | string | null;
  type: string | null; progress_percent: number | string | null;
  retention_percent: number | string | null; retention_amount: number | string | null; retention_released: number | string | null;
  qbo_id: string | null; qbo_hash: string | null;
}

/** PostgREST NUMERIC → number, with a non-numeric degrading to 0 rather than
 *  propagating NaN into a ledger. Same helper `paymentMath.num` is. */
function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Money is whole cents at the point it is COMPUTED — the doctrine in
 *  utils/invoiceBilling.ts. Production rows carry sub-cent totals
 *  (total_due 81264.625), and a ledger may not. */
function roundCents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Billed dollars on one invoice line — the server-side twin of
 * `billedAmountForLine` in utils/invoiceBilling.ts. The two MUST agree: that
 * function decides what the client is charged and what "already billed" means
 * on Bill-from-Estimate, and this one decides what the GC's accountant sees.
 *
 *  - A line carrying `billedPercent` came from Bill-from-Estimate and its
 *    `total` is ALREADY the scaled amount.
 *  - A native-editor progress line carries the FULL total and is scaled by the
 *    invoice-level `progress_percent` — UNLESS the invoice also holds a
 *    pre-scaled line, in which case `progressSubtotal`'s anyPreScaled gate
 *    charged every line unscaled and this one must not be scaled either.
 *  - Anything else bills 100%.
 *
 * Unknown progress % on a progress invoice falls back to FULL weighting, for
 * the same reason the client-side function does: both creation paths stamp it,
 * so a missing value is a data-integrity edge, and over-stating a line is
 * caught by the footing check below rather than silently under-billing.
 */
function billedAmountForLine(
  li: MageInvoiceRow['line_items'][number],
  inv: Pick<MageInvoiceRow, 'type' | 'progress_percent'>,
  anyPreScaled: boolean,
): number {
  const total = num(li.total);
  if (li.billedPercent != null) return total;
  if (inv.type === 'progress' && !anyPreScaled) {
    const ratio = (inv.progress_percent == null ? 100 : num(inv.progress_percent)) / 100;
    return total * ratio;
  }
  return total;
}

// Retainage still held comes from `retentionPending` in
// supabase/functions/_shared/paymentMath.ts — NOT from a private copy here.
//
// That function is the server half of utils/invoiceBilling.pendingRetentionHeld
// and it already carries MONEY-05: a stored `retention_amount` never decides
// the withholding when a percentage and a subtotal are both present, because
// rows written before the MISS-04 basis fix hold the TAX-INCLUSIVE figure. It
// is also what the Stripe webhook charges against, so the retainage QuickBooks
// sees and the retainage the client's Pay button withholds are one number by
// construction rather than by two functions agreeing today. A duplicate lived
// here for one revision of this fix and had already drifted (it accepted a
// string subtotal as non-finite, and it clamped the percentage at both ends
// where paymentMath clamps only the top).

/**
 * Lazily provision the QuickBooks Item that carries withheld retainage.
 *
 * Construction practice: retainage is not a discount, it is a RECLASS — the
 * money is earned but not yet collectible, so it moves out of A/R into a
 * "Retainage Receivable" asset until release. QuickBooks has no native
 * retainage field, so the standard treatment is a negative line on the invoice
 * pointed at an Other Current Asset account. We create both the account and the
 * item on first use and never touch them again; releasing retainage in MAGE
 * shrinks the negative line on the next push, which moves the money back into
 * A/R exactly the way the release is supposed to.
 *
 * If QuickBooks refuses either object we throw rather than falling back to a
 * gross invoice — a gross invoice is the bug this function exists to fix.
 */
async function retainageItemId(conn: QboConnectionRow): Promise<string> {
  const ITEM_NAME = 'Retainage Receivable';
  const found = await qboFetch(
    conn,
    "/query?query=" + encodeURIComponent(`select Id from Item where Name = '${ITEM_NAME}' MAXRESULTS 1`),
    { method: 'GET' },
  ) as { QueryResponse?: { Item?: { Id?: string }[] } };
  const existing = found?.QueryResponse?.Item?.[0]?.Id;
  if (existing) return existing;

  // The account must be a RETAINAGE account, not merely an asset account.
  //
  // The first cut of this took `accounts[0]` when no name matched /retain/i —
  // i.e. whatever Other Current Asset the company happened to list first,
  // which in a default QuickBooks file is "Inventory Asset" or "Undeposited
  // Funds". Booking withheld retainage into Undeposited Funds is not a
  // smaller error than posting the invoice gross; it is a larger one, because
  // it lands in an account the GC reconciles against his bank.
  //
  // So: match by name, or CREATE the account. Never borrow one.
  const acctQuery = await qboFetch(
    conn,
    "/query?query=" + encodeURIComponent(
      "select Id, Name from Account where AccountType = 'Other Current Asset' MAXRESULTS 100",
    ),
    { method: 'GET' },
  ) as { QueryResponse?: { Account?: { Id?: string; Name?: string }[] } };
  const accounts = acctQuery?.QueryResponse?.Account ?? [];
  let accountId = accounts.find(a => /retain/i.test(a.Name ?? ''))?.Id;
  if (!accountId) {
    const made = await qboFetch(conn, '/account', {
      method: 'POST',
      body: JSON.stringify({ Name: ITEM_NAME, AccountType: 'Other Current Asset', AccountSubType: 'OtherCurrentAssets' }),
    }) as { Account?: { Id?: string } };
    accountId = made?.Account?.Id;
  }
  if (!accountId) {
    throw new Error(
      'Retainage is withheld on this invoice, but QuickBooks would not provide an Other Current Asset account to book it to. ' +
      'Create an account named "Retainage Receivable" (Other Current Asset) in QuickBooks and retry — MAGE will not post the invoice gross of retainage.',
    );
  }

  //
  // IF THIS FAILS, MAGE REFUSES THE PUSH — it does not degrade to a gross
  // invoice, and it does not degrade to a `DescriptionOnly` negative line
  // either. Both alternatives were considered (audit 2026-09-11, review round
  // 3) and both are worse:
  //   • gross is the defect this function exists to remove — a receivable the
  //     client cannot be asked to pay, ageing in A/R until closeout;
  //   • a DescriptionOnly line has no posting account, so QuickBooks has
  //     nowhere to book the withheld money. It would reduce the invoice total
  //     by a figure that lands in no account, which is a reconciliation the
  //     GC's accountant cannot close.
  // A refusal is loud, bounded (the reconciler retries five times and stops)
  // and carries a one-line remedy the GC can perform in QuickBooks in a
  // minute. The harness exercises this path — see the `/item` fault case in
  // scripts/validate-money-definitions.ts — so the failure produces this
  // sentence and posts NOTHING, rather than a stack trace after a half-write.
  const made = await qboFetch(conn, '/item', {
    method: 'POST',
    body: JSON.stringify({ Name: ITEM_NAME, Type: 'Service', IncomeAccountRef: { value: accountId } }),
  }).catch((e: unknown) => {
    throw new Error(
      `QuickBooks refused to create the "${ITEM_NAME}" product/service MAGE books withheld retainage to `
      + `(${String((e as Error)?.message ?? e).slice(0, 160)}). Create it in QuickBooks — Products & services → New → `
      + `Service, name it "${ITEM_NAME}", and set its Income account to the "${ITEM_NAME}" Other Current Asset `
      + `account — then re-sync. MAGE will not post the invoice gross of retainage.`,
    );
  }) as { Item?: { Id?: string } };
  const itemId = made?.Item?.Id;
  if (!itemId) {
    throw new Error(
      `QuickBooks did not return an id for the "${ITEM_NAME}" product/service. Create it in QuickBooks — `
      + `Products & services → New → Service, name it "${ITEM_NAME}", income account "${ITEM_NAME}" `
      + `(Other Current Asset) — then re-sync. MAGE will not post the invoice gross of retainage.`,
    );
  }
  return itemId;
}

export async function upsertInvoice(conn: QboConnectionRow, invoiceId: string, userId: string): Promise<void> {
  const s = svc();
  const { data: row, error } = await s
    .from('invoices').select('*').eq('id', invoiceId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`invoice read: ${error.message}`);
  if (!row) throw new Error('invoice not found');
  const inv = row as MageInvoiceRow;

  // Resolve project's qbo_customer_id (push the project first if missing).
  const { data: projRow } = await s.from('projects').select('qbo_customer_id').eq('id', inv.project_id).eq('user_id', userId).maybeSingle();
  let customerId = (projRow as { qbo_customer_id?: string } | null)?.qbo_customer_id;
  if (!customerId) {
    const { upsertCustomer } = await import("./customer.ts");
    await upsertCustomer(conn, inv.project_id, userId);
    const { data: projRow2 } = await s.from('projects').select('qbo_customer_id').eq('id', inv.project_id).eq('user_id', userId).maybeSingle();
    customerId = (projRow2 as { qbo_customer_id?: string } | null)?.qbo_customer_id;
    if (!customerId) throw new Error('Could not establish QBO Customer for project');
  }

  // Read linked_estimate once before the loop. Re-read inside the loop only after a lazy upsertItem.
  // Sourced from project_financials (legacy column as fallback) — see financials.ts.
  let linkedItems = await readLinkedEstimateItems(s, inv.project_id, userId);
  const { upsertItem } = await import("./item.ts");
  const lines: Array<Record<string, unknown>> = [];
  const lineItems = inv.line_items ?? [];
  // The invoice-level gate from progressSubtotal: ONE pre-scaled line makes the
  // whole invoice charge unscaled, so it is a property of the invoice, not of
  // the line being mapped.
  const anyPreScaled = lineItems.some(li => li.billedPercent != null);
  let billedSum = 0;

  for (const li of lineItems) {
    const billed = roundCents(billedAmountForLine(li, inv, anyPreScaled));
    billedSum = roundCents(billedSum + billed);
    const qty = Number.isFinite(li.quantity) && li.quantity !== 0 ? li.quantity : 1;
    // Qty × UnitPrice === Amount by construction. QuickBooks recomputes the
    // line amount from those two on some paths, so a body where they disagree
    // is a body whose posted total is not the one we checked.
    const unitPrice = billed / qty;
    // A progress line has to SAY it is a progress line: an accountant opening
    // the QuickBooks invoice sees "$30,000" against a $100,000 scope and needs
    // to know why. Bill-from-Estimate lines already carry their percentage.
    const pctNote = li.billedPercent != null
      ? ` (${li.billedPercent}% billed)`
      : (inv.type === 'progress' && !anyPreScaled && li.billedPercent == null && (inv.progress_percent ?? 100) !== 100
        ? ` (${inv.progress_percent}% progress billing)`
        : '');
    const description = `${li.description ?? li.name}${pctNote}`;

    // A namespaced billing key (`co:<id>` — utils/changeOrderBilling.ts, and
    // `milestone:<id>` — utils/billingFlowCore.ts) is NOT an estimate item.
    // Looking one up threw `item <key> not found` and failed the whole push,
    // so every change-order and milestone invoice was permanently unsyncable.
    // Resolve against the estimate we actually hold, and describe anything the
    // estimate does not know about.
    const estimateKey = li.sourceEstimateItemId ?? null;
    const knownEstimateItem = estimateKey
      ? linkedItems.some(i => i.materialId === estimateKey)
      : false;

    if (estimateKey && knownEstimateItem) {
      let qboItemId = linkedItems.find(i => i.materialId === estimateKey)?.qboItemId;
      if (!qboItemId) {
        await upsertItem(conn, `${inv.project_id}::${estimateKey}`, userId);
        // Re-read ONLY when we just pushed a new item.
        linkedItems = await readLinkedEstimateItems(s, inv.project_id, userId);
        qboItemId = linkedItems.find(i => i.materialId === estimateKey)?.qboItemId;
      }
      if (!qboItemId) throw new Error(`Could not establish QBO Item for line ${estimateKey} on invoice ${invoiceId}`);
      lines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: billed,
        Description: description,
        SalesItemLineDetail: { ItemRef: { value: qboItemId }, Qty: qty, UnitPrice: unitPrice },
      });
    } else {
      lines.push({
        DetailType: 'DescriptionOnly',
        Amount: billed,
        Description: description,
      });
    }
  }

  // FOOTING CHECK. `subtotal` is what the client was charged pre-tax and what
  // `total_due` was computed from; Σ billedAmountForLine is the same population
  // by the invariant stated on billedAmountForLine. If they disagree the row is
  // internally inconsistent (a hand-edited subtotal, a half-migrated shape) and
  // we do not know which figure is the invoice. Refuse — an accountant cannot
  // unpick a wrong ledger later, but a GC can fix an invoice today.
  const storedSubtotal = roundCents(num(inv.subtotal));
  const footingTolerance = Math.max(0.05, lineItems.length * 0.01);
  if (Math.abs(billedSum - storedSubtotal) > footingTolerance) {
    throw new Error(
      `Refusing to push invoice #${inv.number} to QuickBooks: its line items bill ` +
      `$${billedSum.toFixed(2)} but the invoice subtotal is $${storedSubtotal.toFixed(2)}. ` +
      `Open the invoice in MAGE and re-save it so the two agree, then retry the sync.`,
    );
  }

  const taxAmount = roundCents(num(inv.tax_amount));
  const retentionHeld = retentionPending(inv);
  if (retentionHeld > 0) {
    const itemId = await retainageItemId(conn);
    lines.push({
      DetailType: 'SalesItemLineDetail',
      Amount: -retentionHeld,
      Description:
        `Retainage withheld${inv.retention_percent ? ` (${inv.retention_percent}% of work value)` : ''}` +
        ' — not collectible until released',
      SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: -retentionHeld },
    });
  }

  // What QuickBooks' invoice total MUST come to: everything the client can be
  // asked for today. Same numerator as utils/invoiceBilling.netBalanceDue and
  // as the Stripe pay link, so the receivable in the books, the receivable on
  // the portal and the amount on the Pay button are one number.
  const expectedTotal = roundCents(billedSum + taxAmount - retentionHeld);

  const body: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    DocNumber: String(inv.number),
    TxnDate: inv.issue_date.slice(0, 10),
    DueDate: inv.due_date.slice(0, 10),
    PrivateNote: inv.notes ?? undefined,
    Line: lines,
  };
  if (taxAmount > 0) {
    // Sales tax as MAGE computed it. QuickBooks may override this from its own
    // tax codes (Automated Sales Tax does), which is precisely why the returned
    // TotalAmt is checked below instead of assuming the body won.
    body.TxnTaxDetail = { TotalTax: taxAmount };
  }
  // Compute hash BEFORE adding SyncToken (the token is a concurrency tag, not content).
  const hash = await qboHash(body);
  if (inv.qbo_id && inv.qbo_hash === hash) return; // no drift

  if (inv.qbo_id) {
    // QBO requires the CURRENT SyncToken for sparse updates. Fetch it via GET first.
    const current = await qboFetch(conn, `/invoice/${encodeURIComponent(inv.qbo_id)}`, { method: 'GET' }) as { Invoice?: { SyncToken?: string } };
    const syncToken = current?.Invoice?.SyncToken ?? '0';
    // SPARSE, deliberately — and this was changed to a full update for one
    // revision of this fix before the reasoning was checked.
    //
    // A sparse update does not merge line arrays: when `Line` is present it
    // REPLACES the invoice's lines wholesale, which is exactly what a
    // re-scaled progress bill or a shrinking retainage line needs. What sparse
    // buys on top of that is everything MAGE does not model — BillEmail,
    // CustomerMemo, ShipAddr, class and location refs an accountant set inside
    // QuickBooks. A full update NULLs every writable field the body omits, so
    // switching to one would silently strip the customer's own work off the
    // invoice every time MAGE touched it.
    Object.assign(body, { Id: inv.qbo_id, sparse: true, SyncToken: syncToken });
  }

  const path = inv.qbo_id ? '/invoice?operation=update' : '/invoice';
  const r = await qboFetch(conn, path, { method: 'POST', body: JSON.stringify(body) }) as {
    Invoice?: { Id?: string; TotalAmt?: number; TxnTaxDetail?: { TotalTax?: number } };
  };
  const newId = r?.Invoice?.Id ?? inv.qbo_id;
  if (!newId) throw new Error('QBO did not return an Invoice.Id');

  // ───────────────────────────────────────────────────────────────────────────
  // POST-CONDITION — CHECKED ON THE WORK, NOT ON THE TAX (audit 2026-09-11,
  // review round 3).
  //
  // The first cut compared QuickBooks' returned `TotalAmt` against
  // `billedSum + taxAmount − retentionHeld`, where `taxAmount` is MAGE's tax.
  // Six lines above, this file's own comment says QuickBooks recomputes that
  // figure — "Automated Sales Tax does" — so on every AST company every taxed
  // invoice POSTED and was then marked `error` and thrown. The reconciler
  // re-pushes an errored row five times; each retry re-POSTs the update and
  // fails identically. That converts "synced, short by the tax" into a
  // permanent error state, which is a worse place to be than the defect this
  // whole file was rewritten to fix.
  //
  // What MAGE is actually the authority on is the WORK: the schedule of
  // values, the progress scaling, and the retainage withheld. Sales tax on a
  // QuickBooks invoice is QuickBooks' own computation from the customer's tax
  // codes and jurisdiction, and it is ALLOWED to differ. So:
  //
  //   • totals match outright                  → synced, silent;
  //   • PRE-TAX matches and only the tax moved → synced, with the difference
  //                                              recorded on the row so an
  //                                              accountant can see it;
  //   • pre-tax does not match                 → refuse, loudly. The work
  //                                              amount is the number MAGE
  //                                              owns and a wrong one is the
  //                                              defect, not a difference.
  //
  // `postedPreTax` needs QuickBooks' own tax back. When the response carries
  // no `TxnTaxDetail` we cannot separate the two, so the strict comparison is
  // all we have and a mismatch is refused — the safe direction.
  // ───────────────────────────────────────────────────────────────────────────
  const postedTotal = r?.Invoice?.TotalAmt;
  const postedTax = typeof r?.Invoice?.TxnTaxDetail?.TotalTax === 'number'
    ? roundCents(r.Invoice.TxnTaxDetail.TotalTax as number)
    : null;
  const expectedPreTax = roundCents(billedSum - retentionHeld);
  const exactMatch = typeof postedTotal === 'number'
    && Math.abs(roundCents(postedTotal) - expectedTotal) <= 0.01;
  const preTaxMatch = !exactMatch
    && typeof postedTotal === 'number' && postedTax !== null
    && Math.abs(roundCents(postedTotal - postedTax) - expectedPreTax) <= 0.01;
  const totalsAgree = exactMatch || preTaxMatch;

  const workDetail = `$${billedSum.toFixed(2)} work − $${retentionHeld.toFixed(2)} retainage held`;
  // A warning, not a failure. The row is synced; this sentence is why the two
  // ledgers will not tie to the cent.
  const taxNote = preTaxMatch
    ? (`QuickBooks charged $${(postedTax ?? 0).toFixed(2)} of sales tax on invoice #${inv.number} where MAGE computed `
      + `$${taxAmount.toFixed(2)} — its own tax codes recomputed it. The work total matches (${workDetail}), `
      + `so the invoice is correct and synced; the tax difference is $${roundCents((postedTax ?? 0) - taxAmount).toFixed(2)}.`
    ).slice(0, 500)
    : null;

  const { error: updateErr } = await s.from('invoices').update({
    qbo_id: newId,
    // A hash is a "nothing changed since we last pushed" tag. Storing it on a
    // push whose result we just rejected would make the NEXT push a no-op and
    // strand the wrong total in QuickBooks forever.
    qbo_hash: totalsAgree ? hash : null,
    qbo_synced_at: new Date().toISOString(),
    qbo_sync_status: totalsAgree ? 'synced' : 'error',
    qbo_error: totalsAgree ? taxNote : (
      `QuickBooks posted $${Number(postedTotal ?? 0).toFixed(2)} for invoice #${inv.number} but MAGE billed ` +
      `$${expectedTotal.toFixed(2)} (${workDetail} + $${taxAmount.toFixed(2)} tax). ` +
      `The pre-tax work total does not match either, so this is not QuickBooks recomputing sales tax. ` +
      `Review the invoice in QuickBooks before your books are filed from it, then re-sync.`
    ).slice(0, 500),
    qbo_retry_count: 0,
  }).eq('id', invoiceId).eq('user_id', userId);
  if (updateErr) throw new Error(`invoice update: ${updateErr.message}`);

  if (!totalsAgree) {
    throw new Error(
      `QuickBooks recorded $${Number(postedTotal ?? 0).toFixed(2)} for invoice #${inv.number}; MAGE billed $${expectedTotal.toFixed(2)} (${workDetail} + $${taxAmount.toFixed(2)} tax). ` +
      `The invoice is in QuickBooks but the WORK totals disagree — review it there before your books are filed from it.`,
    );
  }
}
