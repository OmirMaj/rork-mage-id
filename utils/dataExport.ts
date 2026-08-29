import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { deliverTextFile } from '@/utils/platformFile';
import * as Sharing from 'expo-sharing';
import type {
  Project, Invoice, ChangeOrder, DailyFieldReport, PunchItem, ProjectPhoto,
  Contact, RFI, Submittal, Equipment, Warranty, Subcontractor, CommunicationEvent,
  CompanyBranding,
} from '@/types';
import { generateCloseoutPacketUri } from '@/utils/closeoutPacketGenerator';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';

// ──────────────────────────────────────────────────────────────────────────────
// One-click data export — the "kill lock-in" feature
// Competitors like Buildertrend make exporting your own data near-impossible.
// We bundle every entity the user owns into a portable, human-readable format
// they can hand off to any accountant, lawyer, or migration target.
// ──────────────────────────────────────────────────────────────────────────────

export interface DataExportPayload {
  projects: Project[];
  invoices: Invoice[];
  changeOrders: ChangeOrder[];
  dailyReports: DailyFieldReport[];
  punchItems: PunchItem[];
  photos: ProjectPhoto[];
  contacts: Contact[];
  rfis: RFI[];
  submittals: Submittal[];
  equipment: Equipment[];
  warranties: Warranty[];
  subcontractors: Subcontractor[];
  communications: CommunicationEvent[];
}

export interface DataExportOptions {
  projectId?: string;           // export a single project only
  format: 'json' | 'csv' | 'both';
  includePhotoUrls?: boolean;   // include photo URIs (large if local file:// paths)
  /** When true, generate the printable closeout packet PDF and include
   *  it alongside the JSON / CSV files. Only applies when projectId is
   *  set (closeout doesn't make sense for "all projects"). The closeout
   *  PDF mirrors what the homeowner would receive at substantial-completion
   *  handover — contract, change orders, payments, warranties, finishes,
   *  punch list, photo summary. */
  includeCloseoutPacket?: boolean;
  /** When true, write a README.txt to the export bundle that explains
   *  what's in each file. Useful when the user is handing the bundle
   *  off to a non-technical recipient (homeowner, accountant). */
  includeReadme?: boolean;
}

export interface DataExportSummary {
  format: 'json' | 'csv' | 'both';
  projectCount: number;
  invoiceCount: number;
  coCount: number;
  dfrCount: number;
  punchCount: number;
  photoCount: number;
  contactCount: number;
  rfiCount: number;
  fileUris: string[];
  totalBytes: number;
}

// CSV escaping: wrap in quotes if contains comma, quote, or newline; double internal quotes.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map(csvCell).join(',');
  const bodyLines = rows.map(r => r.map(csvCell).join(',')).join('\n');
  return headerLine + '\n' + bodyLines + '\n';
}

function filterByProject<T extends { projectId?: string }>(items: T[], projectId?: string): T[] {
  if (!projectId) return items;
  return items.filter(i => i.projectId === projectId);
}

/**
 * Build the in-memory export payload.
 */
export function buildExportPayload(
  all: Partial<DataExportPayload>,
  opts: DataExportOptions,
): DataExportPayload {
  const projects = opts.projectId
    ? (all.projects ?? []).filter(p => p.id === opts.projectId)
    : (all.projects ?? []);

  const photosRaw = filterByProject(all.photos ?? [], opts.projectId);
  const photos = opts.includePhotoUrls === false
    ? photosRaw.map(p => ({ ...p, uri: '[omitted]' }))
    : photosRaw;

  return {
    projects,
    invoices: filterByProject(all.invoices ?? [], opts.projectId),
    changeOrders: filterByProject(all.changeOrders ?? [], opts.projectId),
    dailyReports: filterByProject(all.dailyReports ?? [], opts.projectId),
    punchItems: filterByProject(all.punchItems ?? [], opts.projectId),
    photos,
    contacts: all.contacts ?? [],
    rfis: filterByProject(all.rfis ?? [], opts.projectId),
    submittals: filterByProject(all.submittals ?? [], opts.projectId),
    equipment: all.equipment ?? [],
    warranties: filterByProject(all.warranties ?? [], opts.projectId),
    subcontractors: all.subcontractors ?? [],
    communications: filterByProject(all.communications ?? [], opts.projectId),
  };
}

/**
 * Convert the payload into a set of CSV strings (one per entity).
 */
export function payloadToCsvs(p: DataExportPayload): Record<string, string> {
  const csvs: Record<string, string> = {};

  csvs.projects = toCsv(
    ['id', 'name', 'type', 'location', 'squareFootage', 'quality', 'status', 'grandTotal', 'createdAt', 'updatedAt'],
    p.projects.map(pr => [
      pr.id, pr.name, pr.type, pr.location, pr.squareFootage, pr.quality,
      pr.status, (effectiveEstimateTotal(pr) || ''), pr.createdAt, pr.updatedAt,
    ]),
  );

  csvs.invoices = toCsv(
    ['id', 'number', 'projectId', 'type', 'issueDate', 'dueDate', 'paymentTerms', 'subtotal', 'taxAmount', 'totalDue', 'amountPaid', 'status', 'retentionPercent', 'retentionAmount'],
    p.invoices.map(i => [
      i.id, i.number, i.projectId, i.type, i.issueDate, i.dueDate, i.paymentTerms,
      i.subtotal, i.taxAmount, i.totalDue, i.amountPaid, i.status,
      i.retentionPercent ?? '', i.retentionAmount ?? '',
    ]),
  );

  csvs.changeOrders = toCsv(
    ['id', 'number', 'projectId', 'date', 'description', 'changeAmount', 'newContractTotal', 'status', 'scheduleImpactDays', 'createdAt'],
    p.changeOrders.map(c => [
      c.id, c.number, c.projectId, c.date, c.description, c.changeAmount,
      c.newContractTotal, c.status, c.scheduleImpactDays ?? '', c.createdAt,
    ]),
  );

  csvs.dailyReports = toCsv(
    ['id', 'projectId', 'date', 'status', 'weatherConditions', 'workPerformed', 'issuesAndDelays'],
    p.dailyReports.map(d => [
      d.id, d.projectId, d.date, d.status, d.weather?.conditions ?? '',
      d.workPerformed ?? '', d.issuesAndDelays ?? '',
    ]),
  );

  csvs.punchItems = toCsv(
    ['id', 'projectId', 'description', 'location', 'assignedSub', 'status', 'priority', 'createdAt'],
    p.punchItems.map(pi => [
      pi.id, pi.projectId, pi.description, pi.location ?? '', pi.assignedSub ?? '',
      pi.status, pi.priority ?? '', pi.createdAt ?? '',
    ]),
  );

  csvs.contacts = toCsv(
    ['id', 'firstName', 'lastName', 'email', 'phone', 'companyName', 'role'],
    p.contacts.map(c => [
      c.id, c.firstName, c.lastName, c.email ?? '', c.phone ?? '',
      c.companyName ?? '', c.role,
    ]),
  );

  csvs.rfis = toCsv(
    ['id', 'number', 'projectId', 'subject', 'status', 'priority', 'dateRequired', 'dateSubmitted'],
    p.rfis.map(r => [
      r.id, r.number, r.projectId, r.subject, r.status, r.priority ?? '',
      r.dateRequired ?? '', r.dateSubmitted ?? '',
    ]),
  );

  csvs.photos = toCsv(
    ['id', 'projectId', 'tag', 'timestamp', 'uri'],
    p.photos.map(ph => [
      ph.id, ph.projectId, ph.tag ?? '', ph.timestamp, ph.uri,
    ]),
  );

  return csvs;
}

/**
 * Perform the actual export: write files to cache, then share.
 *
 * Optional inputs:
 *   branding   — when present + opts.includeCloseoutPacket, used as the
 *                CompanyBranding source for the closeout PDF header /
 *                signature block.
 */
export async function exportUserData(
  all: Partial<DataExportPayload>,
  opts: DataExportOptions,
  branding?: CompanyBranding,
): Promise<DataExportSummary> {
  const payload = buildExportPayload(all, opts);
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const projectSuffix = opts.projectId ? `-project-${opts.projectId.slice(0, 8)}` : '-all';
  const baseName = `mage-id-export${projectSuffix}-${timestamp}`;

  const fileUris: string[] = [];
  let totalBytes = 0;

  // NO THROW ON WEB. cacheDirectory is undefined in a browser, so this bailed
  // before any of the `Platform.OS !== 'web'` guards below could run — meaning
  // the GDPR/CCPA "Export my data" button was dead on web, which is the one
  // platform where a regulator-facing export is most likely to be exercised.
  // deliverTextFile downloads in the browser and writes to cache on native.
  const dir = FileSystem.cacheDirectory ?? '';

  if (opts.format === 'json' || opts.format === 'both') {
    const jsonBody = JSON.stringify({
      exportedAt: new Date().toISOString(),
      exportedBy: 'MAGE ID',
      schemaVersion: 1,
      options: opts,
      ...payload,
    }, null, 2);
    const written = await deliverTextFile(`${baseName}.json`, jsonBody, 'application/json');
    totalBytes += jsonBody.length;
    // Web returns null — the file already reached the user via download, and
    // there is no URI to hand to Sharing afterwards.
    if (written) fileUris.push(written);
  }

  if (opts.format === 'csv' || opts.format === 'both') {
    const csvs = payloadToCsvs(payload);
    for (const [entity, body] of Object.entries(csvs)) {
      const written = await deliverTextFile(`${baseName}-${entity}.csv`, body, 'text/csv;charset=utf-8');
      totalBytes += body.length;
      if (written) fileUris.push(written);
    }
  }

  // ── Closeout PDF — only meaningful for single-project exports ─────
  // We generate the same handoff packet the GC produces for substantial-
  // completion. Mobile-only; the web export skips the PDF since the
  // closeout generator uses expo-print which doesn't ship a PDF on web.
  if (opts.includeCloseoutPacket && opts.projectId && Platform.OS !== 'web') {
    const project = (all.projects ?? []).find(p => p.id === opts.projectId);
    if (project && branding) {
      const closeoutUri = await generateCloseoutPacketUri({
        project,
        branding,
        changeOrders: payload.changeOrders,
        invoices: payload.invoices,
        dailyReports: payload.dailyReports,
        punchItems: payload.punchItems,
        warranties: payload.warranties,
        photos: payload.photos,
      });
      if (closeoutUri) {
        // Print writes to a tmp uri; copy into cache so the bundle file
        // is co-located with the JSON / CSV pieces. Best-effort: if copy
        // fails (rare), share the original tmp uri directly.
        const targetUri = `${dir}${baseName}-closeout.pdf`;
        try {
          await FileSystem.copyAsync({ from: closeoutUri, to: targetUri });
          fileUris.push(targetUri);
        } catch {
          fileUris.push(closeoutUri);
        }
        // Closeout PDF size — count the file.
        try {
          const info = await FileSystem.getInfoAsync(targetUri);
          if ('size' in info && typeof info.size === 'number') totalBytes += info.size;
        } catch { /* size is informational only */ }
      }
    }
  }

  // ── README — orientation file for the recipient ──────────────────
  if (opts.includeReadme) {
    const readme = buildReadmeText(payload, opts);
    const written = await deliverTextFile(`${baseName}-README.txt`, readme, 'text/plain;charset=utf-8');
    totalBytes += readme.length;
    if (written) fileUris.push(written);
  }

  return {
    format: opts.format,
    projectCount: payload.projects.length,
    invoiceCount: payload.invoices.length,
    coCount: payload.changeOrders.length,
    dfrCount: payload.dailyReports.length,
    punchCount: payload.punchItems.length,
    photoCount: payload.photos.length,
    contactCount: payload.contacts.length,
    rfiCount: payload.rfis.length,
    fileUris,
    totalBytes,
  };
}

/**
 * Build a plain-text README explaining each file in the export bundle.
 * Goes alongside the JSON / CSV / PDF so a non-technical recipient
 * (homeowner, accountant, lawyer) can find what they're looking for.
 */
function buildReadmeText(payload: DataExportPayload, opts: DataExportOptions): string {
  const exportedAt = new Date().toLocaleString('en-US');
  const scope = opts.projectId ? `Project ${opts.projectId.slice(0, 8)}` : 'All projects';
  const lines: string[] = [
    `MAGE ID — Project Archive`,
    `Generated: ${exportedAt}`,
    `Scope: ${scope}`,
    ``,
    `WHAT'S IN THIS BUNDLE`,
    ``,
  ];
  if (opts.format === 'json' || opts.format === 'both') {
    lines.push(`• mage-id-export-*.json`);
    lines.push(`  Full JSON snapshot of every record. Open with any text editor`);
    lines.push(`  or import into another tool. Schema version is included.`);
    lines.push(``);
  }
  if (opts.format === 'csv' || opts.format === 'both') {
    lines.push(`• mage-id-export-*.csv (one per record type)`);
    lines.push(`  Spreadsheet-friendly. Open with Excel, Google Sheets, Numbers.`);
    lines.push(`  One file per entity: projects, invoices, change orders, daily`);
    lines.push(`  reports, punch items, photos, contacts, RFIs, submittals.`);
    lines.push(``);
  }
  if (opts.includeCloseoutPacket) {
    lines.push(`• mage-id-export-*-closeout.pdf`);
    lines.push(`  The substantial-completion handover packet. Includes contract`);
    lines.push(`  summary, change orders, payments, warranties, finishes, punch`);
    lines.push(`  list, and photo summary. Safe to print and file with the homeowner.`);
    lines.push(``);
  }
  lines.push(`COUNTS`);
  lines.push(``);
  lines.push(`  Projects:        ${payload.projects.length}`);
  lines.push(`  Invoices:        ${payload.invoices.length}`);
  lines.push(`  Change orders:   ${payload.changeOrders.length}`);
  lines.push(`  Daily reports:   ${payload.dailyReports.length}`);
  lines.push(`  Punch items:     ${payload.punchItems.length}`);
  lines.push(`  RFIs:            ${payload.rfis.length}`);
  lines.push(`  Submittals:      ${payload.submittals.length}`);
  lines.push(`  Photos:          ${payload.photos.length}`);
  lines.push(`  Contacts:        ${payload.contacts.length}`);
  lines.push(``);
  lines.push(`This bundle is YOUR property. There is no lock-in — you can`);
  lines.push(`migrate to any other tool, hand it off to your accountant, or`);
  lines.push(`keep it as a permanent record. Built with MAGE ID. mageid.app`);
  return lines.join('\n');
}

/**
 * Share one of the generated export files.
 */
export async function shareExportedFile(uri: string, title: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) return;
  const mimeType =
    uri.endsWith('.csv') ? 'text/csv' :
    uri.endsWith('.pdf') ? 'application/pdf' :
    uri.endsWith('.txt') ? 'text/plain' :
    'application/json';
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: title });
}

/**
 * Compact human-readable summary of the export payload size.
 */
export function summarizeExport(s: DataExportSummary): string {
  const sizeKb = (s.totalBytes / 1024).toFixed(1);
  const parts = [
    `${s.projectCount} projects`,
    `${s.invoiceCount} invoices`,
    `${s.coCount} change orders`,
    `${s.dfrCount} daily reports`,
    `${s.punchCount} punch items`,
    `${s.photoCount} photos`,
    `${s.contactCount} contacts`,
    `${s.rfiCount} RFIs`,
  ];
  return `${parts.join(' · ')} (${sizeKb} KB)`;
}
