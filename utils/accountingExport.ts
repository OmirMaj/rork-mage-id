// Accounting CSV export — give the GC's bookkeeper one file QuickBooks
// Online or Xero can import, instead of manual double-entry. Read-only
// over the project's invoices. The pure builder is separate from the
// FS/share wrapper (mirrors utils/icsGenerator.ts exportProjectIcs);
// project-detail calls the wrapper exactly like it calls exportProjectIcs.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { Project, Invoice, InvoiceStatus } from '@/types';

export type AccountingFormat = 'quickbooks' | 'xero';

const BILLABLE: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>([
  'sent', 'partially_paid', 'paid', 'overdue',
]);

// RFC-4180 escaping + spreadsheet formula-injection guard (these files
// open in Excel/Sheets). Same shape as utils/tax1099Export.ts csvCell.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (s.length > 0 && '=+-@'.indexOf(s[0]!) !== -1) s = `'${s}`;
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
    for (const li of inv.lineItems ?? []) {
      if (format === 'xero') {
        rows.push([
          customer, String(inv.number), issue, due,
          li.description || li.name, String(li.quantity),
          money(li.unitPrice), '', '', 'Project', project.name,
        ]);
      } else {
        rows.push([
          String(inv.number), customer, issue, due, li.name,
          li.description, String(li.quantity), money(li.unitPrice),
          money(li.total), inv.taxAmount > 0 ? 'Yes' : 'No',
          String(inv.taxRate), issue, `Invoice #${inv.number}`,
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

  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const fileUri = `${dir}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: 'utf8' });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/csv',
      dialogTitle: 'Export invoices to accounting',
      UTI: 'public.comma-separated-values-text',
    });
  }
  return { rowCount, fileUri };
}
