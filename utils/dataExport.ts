import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type {
  Project, Invoice, ChangeOrder, DailyFieldReport, PunchItem, ProjectPhoto,
  Contact, RFI, Submittal, Equipment, Warranty, Subcontractor, CommunicationEvent,
} from '@/types';

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
      pr.status, pr.estimate?.grandTotal ?? '', pr.createdAt, pr.updatedAt,
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
 */
export async function exportUserData(
  all: Partial<DataExportPayload>,
  opts: DataExportOptions,
): Promise<DataExportSummary> {
  const payload = buildExportPayload(all, opts);
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const projectSuffix = opts.projectId ? `-project-${opts.projectId.slice(0, 8)}` : '-all';
  const baseName = `mage-id-export${projectSuffix}-${timestamp}`;

  const fileUris: string[] = [];
  let totalBytes = 0;

  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error('No cache directory available on this platform.');

  if (opts.format === 'json' || opts.format === 'both') {
    const jsonUri = `${dir}${baseName}.json`;
    const jsonBody = JSON.stringify({
      exportedAt: new Date().toISOString(),
      exportedBy: 'MAGE ID',
      schemaVersion: 1,
      options: opts,
      ...payload,
    }, null, 2);
    if (Platform.OS !== 'web') {
      await FileSystem.writeAsStringAsync(jsonUri, jsonBody, { encoding: 'utf8' });
    }
    totalBytes += jsonBody.length;
    fileUris.push(jsonUri);
  }

  if (opts.format === 'csv' || opts.format === 'both') {
    const csvs = payloadToCsvs(payload);
    for (const [entity, body] of Object.entries(csvs)) {
      const csvUri = `${dir}${baseName}-${entity}.csv`;
      if (Platform.OS !== 'web') {
        await FileSystem.writeAsStringAsync(csvUri, body, { encoding: 'utf8' });
      }
      totalBytes += body.length;
      fileUris.push(csvUri);
    }
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
 * Share one of the generated export files.
 */
export async function shareExportedFile(uri: string, title: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) return;
  const mimeType = uri.endsWith('.csv') ? 'text/csv' : 'application/json';
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
