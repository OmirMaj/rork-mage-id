// Accounting CSV export — give the GC's bookkeeper one file QuickBooks
// Online or Xero can import, instead of manual double-entry. Read-only
// over the project's invoices. The pure builder is separate from the
// FS/share wrapper (mirrors utils/icsGenerator.ts exportProjectIcs);
// project-detail calls the wrapper exactly like it calls exportProjectIcs.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { deliverTextFile } from '@/utils/platformFile';
import type { Project, Invoice, InvoiceStatus } from '@/types';
import { billedAmountForLine, pendingRetentionHeld, roundCents } from '@/utils/invoiceBilling';

export type AccountingFormat = 'quickbooks' | 'xero';

const BILLABLE: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>([
  'sent', 'partially_paid', 'paid', 'overdue',
]);

// RFC-4180 escaping + spreadsheet formula-injection guard (these files
// open in Excel/Sheets). Same shape as utils/dataExport.ts csvCell,
// extended with the leading =+-@ formula-injection guard.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // A plain signed decimal ("-3779.75", the retainage line) is a number, not a
  // formula: prefixing it with ' would make QuickBooks/Xero read it as text
  // and reject the row. Anything else starting with =+-@ is still escaped.
  const isPlainNumber = /^-?\d+(\.\d+)?$/.test(s);
  if (!isPlainNumber && s.length > 0 && '=+-@'.indexOf(s[0]!) !== -1) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtDate(iso: string | undefined, format: AccountingFormat): string {
  const key = ((iso ?? '') + '').slice(0, 10); // YYYY-MM-DD portion
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const t = Date.parse(`${key}T12:00:00Z`);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  return format === 'xero' ? `${dd}/${mm}/${yyyy}` : `${mm}/${dd}/${yyyy}`;
}

function money(n: number): string {
  return Number.isFinite(n) ? Number(n).toFixed(2) : '0.00';
}

const QBO_HEADER = [
  'InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Item(Product/Service)',
  'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'Taxable',
  'TaxRate', 'ServiceDate', 'Memo',
];
const XERO_HEADER = [
  'ContactName', 'InvoiceNumber', 'InvoiceDate', 'DueDate', 'Description',
  'Quantity', 'UnitAmount', 'AccountCode', 'TaxType', 'TrackingName1',
  'TrackingOption1',
];

/**
 * Pure: build the CSV string + a sanitized filename. Never touches the FS.
 * Empty / all-draft invoices → rowCount 0 and csv = header only.
 */
export function buildAccountingCsv(
  format: AccountingFormat,
  project: Project,
  invoices: Invoice[],
): { filename: string; csv: string; rowCount: number } {
  const customer = project.primaryContact?.name ?? project.name;
  const billable = (invoices ?? []).filter((i) => BILLABLE.has(i.status));
  const header = format === 'xero' ? XERO_HEADER : QBO_HEADER;
  const rows: string[][] = [];

  for (const inv of billable) {
    const issue = fmtDate(inv.issueDate, format);
    const due = fmtDate(inv.dueDate, format);
    const lineItems = inv.lineItems ?? [];
    // MONEY-CSV-PROGRESS (health 2026-09-26). A native-editor progress invoice
    // stores FULL line totals and scales ONCE at the invoice level
    // (utils/invoiceBilling progressSubtotal / billedAmountForLine), so the
    // raw `li.total` exported a 30% bill of a $30,000 line as $30,000. The
    // QuickBooks push (supabase/functions/_shared/qbo-mapping/invoice.ts) was
    // already fixed for exactly this; the CSV now follows the same rule, with
    // the same invoice-level gate (ONE pre-scaled line = nothing is scaled).
    const anyPreScaled = lineItems.some((l) => l.billedPercent != null);
    for (const li of lineItems) {
      const billed = roundCents(billedAmountForLine(li, inv, anyPreScaled));
      // Only a line the invoice actually SCALED changes shape. Everything else
      // — every full invoice, every Bill-from-Estimate line — exports exactly
      // what it always did.
      const scaled = billed !== roundCents(li.total || 0);
      const pctNote = scaled ? ` (${inv.progressPercent ?? 100}% progress billing)` : '';
      // Qty 1 × Rate billed foots to the billed amount by construction; the
      // full-scope quantity × a rounded rate would not.
      const qty = scaled ? '1' : String(li.quantity);
      const rate = scaled ? money(billed) : money(li.unitPrice);
      const amount = scaled ? money(billed) : money(li.total);
      if (format === 'xero') {
        rows.push([
          customer, String(inv.number), issue, due,
          `${li.description || li.name}${pctNote}`, qty,
          rate, '', '', 'Project', project.name,
        ]);
      } else {
        // Taxable 'No' and no TaxRate on a taxed invoice: sales tax is
        // exported as its own 'Sales Tax' line below, so an importer that also
        // applied TaxRate to 'Yes' item rows counted the tax twice. An untaxed
        // invoice keeps the row it always exported (Taxable was already 'No').
        rows.push([
          String(inv.number), customer, issue, due, li.name,
          `${li.description ?? ''}${pctNote}`, qty, rate,
          amount, 'No',
          inv.taxAmount > 0 ? '' : String(inv.taxRate), issue, `Invoice #${inv.number}`,
        ]);
      }
    }
    if (inv.taxAmount > 0) {
      if (format === 'xero') {
        rows.push([
          customer, String(inv.number), issue, due, 'Sales Tax', '1',
          money(inv.taxAmount), '', '', 'Project', project.name,
        ]);
      } else {
        rows.push([
          String(inv.number), customer, issue, due, 'Sales Tax',
          'Sales Tax', '1', money(inv.taxAmount), money(inv.taxAmount),
          'No', '', issue, `Invoice #${inv.number} tax`,
        ]);
      }
    }
    // Retainage — mirrors the QuickBooks push: an explicit NEGATIVE line for
    // the retention still held (pendingRetentionHeld, the same figure
    // netBalanceDue nets out and the Stripe pay link charges without), so the
    // imported invoice totals what the client can be asked for today instead
    // of sitting open by the retainage until closeout. Releasing it later
    // shrinks the line to nothing.
    const retentionHeld = roundCents(pendingRetentionHeld(inv));
    if (retentionHeld > 0) {
      const desc = `Retainage withheld${inv.retentionPercent ? ` (${inv.retentionPercent}% of work value)` : ''} (not collectible until released)`;
      if (format === 'xero') {
        rows.push([
          customer, String(inv.number), issue, due, desc, '1',
          money(-retentionHeld), '', '', 'Project', project.name,
        ]);
      } else {
        rows.push([
          String(inv.number), customer, issue, due, 'Retainage Receivable',
          desc, '1', money(-retentionHeld), money(-retentionHeld),
          'No', '', issue, `Invoice #${inv.number} retainage`,
        ]);
      }
    }
  }

  const csv = [header, ...rows]
    .map((r) => r.map(csvCell).join(','))
    .join('\n');

  const safe =
    (project.name || 'project').replace(/[^A-Za-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') ||
    'project';
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const filename = `${safe}-invoices-${format}-${ymd}.csv`;

  return { filename, csv, rowCount: rows.length };
}

/**
 * FS/share wrapper — mirrors utils/icsGenerator.ts exportProjectIcs.
 * rowCount 0 → returns early without writing/sharing a file.
 */
export async function exportProjectAccountingCsv(input: {
  format: AccountingFormat;
  project: Project;
  invoices: Invoice[];
}): Promise<{ rowCount: number; fileUri: string }> {
  const { filename, csv, rowCount } = buildAccountingCsv(
    input.format, input.project, input.invoices,
  );
  if (rowCount === 0) return { rowCount: 0, fileUri: '' };

  // deliverTextFile downloads the CSV in the browser and returns null; on
  // native it writes to cache and returns the URI to share. Previously
  // cacheDirectory was undefined on web, so this wrote to the literal path
  // "invoices.csv", threw, and the QuickBooks/Xero export was dead — while its
  // three sibling exporters (which use the Blob-anchor pattern) worked fine.
  const fileUri = await deliverTextFile(filename, csv, 'text/csv;charset=utf-8');
  if (!fileUri) return { rowCount, fileUri: '' };
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/csv',
      dialogTitle: 'Export Invoices to Accounting',
      UTI: 'public.comma-separated-values-text',
    });
  }
  return { rowCount, fileUri };
}
