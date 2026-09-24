import { projectTypeLabel } from '@/utils/projectTypes';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { deliverTextFile } from '@/utils/platformFile';
import * as Sharing from 'expo-sharing';
import type {
  Project, Invoice, ChangeOrder, DailyFieldReport, PunchItem, ProjectPhoto,
  Contact, RFI, Submittal, Equipment, Warranty, Subcontractor, CommunicationEvent,
  CompanyBranding, SavedAIAPayApp, Commitment, FieldTicket, TimeEntry, SafetyIncident,
  ManagedProperty, WorkOrder,
} from '@/types';
import { punchListTypeOf } from '@/types';
import { generateCloseoutPacketUri } from '@/utils/closeoutPacketGenerator';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { effectiveRetentionHeld } from '@/utils/invoiceBilling';
import { computeFieldTicketTotals } from '@/utils/fieldTicketCore';

// ──────────────────────────────────────────────────────────────────────────────
// One-click data export — the "kill lock-in" feature
// Competitors like Buildertrend make exporting your own data near-impossible.
// We bundle the user's records into a portable, human-readable format they can
// hand off to any accountant, lawyer, or migration target.
//
// WHAT IT IS NOT (audit #80 / #131). It is not "every record and every photo":
//   • Photos leave as RECORDS — id, job, tag, time, the storage path, and a
//     link minted at export time that expires (24 h, the bucket is private and
//     a long-lived link is a sharing risk). The image files are not in the
//     bundle; a photo still waiting to upload from this phone has no link at
//     all and is labelled and counted as such.
//   • NOT_EXPORTED lists the record types still left out. The README and the
//     screen print it, so nobody reads "every" into what we hand over.
// scripts/validate-w5-settings-export.ts executes the CSV + README builders.
// ──────────────────────────────────────────────────────────────────────────────

/** Record types the export does not carry yet — printed in the README and on
 *  the Export screen instead of claiming the bundle is complete. */
export const NOT_EXPORTED: readonly string[] = [
  'contracts',
  'lien waivers',
  'permits',
  'plan sheets and markups',
  'selections',
  'the photo image files themselves',
];

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
  // #131: the money and field records the export used to leave out.
  aiaPayApps: SavedAIAPayApp[];
  commitments: Commitment[];
  fieldTickets: FieldTicket[];
  timeEntries: TimeEntry[];
  safetyIncidents: SafetyIncident[];
  // Phase 0: the Property Manager's portfolio (PropertyContext). It was left
  // out while Settings promised "no lock-in, ever". Not tied to a project, so
  // an all-projects export carries it and a single-project export does not.
  managedProperties: ManagedProperty[];
  workOrders: WorkOrder[];
}

/**
 * What the export knows about each photo's bytes, gathered by the screen just
 * before the export runs (the queue read and the signing need I/O this module
 * keeps out of its pure builders):
 *   links       — storagePath → a signed link minted NOW (resolvePhotoUrls);
 *   notUploaded — photo ids still in this phone's upload queue. storagePath is
 *                 deterministic and set at capture, so its presence does NOT
 *                 prove the bytes reached the bucket — the queue does.
 */
export interface PhotoExportContext {
  links: Map<string, string>;
  notUploaded: Set<string>;
}

/** The note a photo row carries when it has no working link. */
export const PHOTO_ON_DEVICE_ONLY = 'on this device only, not uploaded';
export const PHOTO_NO_LINK_OFFLINE = 'no link: exported without a connection to MAGE';
export const PHOTO_LINKS_OMITTED = 'links left out of this export';
export const PHOTO_OLD_LINK = 'older photo: link as stored, expiry unknown';

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
  submittalCount: number;
  payAppCount: number;
  commitmentCount: number;
  fieldTicketCount: number;
  timeEntryCount: number;
  safetyIncidentCount: number;
  managedPropertyCount: number;
  workOrderCount: number;
  /** Photos whose bytes are still only on this phone (no link in the export). */
  photoOnDeviceOnlyCount: number;
  /** When the export's photo links stop working (ISO), or null for none. */
  photoLinksExpireAt: string | null;
  /** Share targets written to this device's cache. Empty on web. */
  fileUris: string[];
  /** Every file handed over — written to cache (native) or downloaded (web). */
  deliveredFileCount: number;
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

/** Money as the CSV prints it: exact to the cent, two decimals, '' when absent. */
export function csvMoney(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

/**
 * The `exp` of a Supabase Storage signed URL (its `token` query param is a
 * JWT), as ISO — so the column header states the link's real expiry, not an
 * assumed one. Null when the URL carries no readable token.
 */
export function signedUrlExpiresAt(url: string): string | null {
  try {
    const token = /[?&]token=([^&#]+)/.exec(url)?.[1];
    if (!token) return null;
    const part = decodeURIComponent(token).split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = typeof atob === 'function' ? atob(padded) : '';
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? new Date(exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

export interface PhotoExportRow {
  id: string;
  projectId: string;
  tag: string;
  timestamp: string;
  storagePath: string;
  /** A working link, or '' (see note). */
  viewUrl: string;
  viewUrlExpiresAt: string | null;
  note: string;
}

/**
 * One row per photo. Never exports a file:// / blob: path (no other machine
 * can open it) and never the load-time signed URL on a photo that has a
 * storage path — that link may be most of a day old; the context's link was
 * minted for this export.
 */
export function photoExportRows(
  photos: ProjectPhoto[],
  ctx: PhotoExportContext | undefined,
  includeLinks: boolean,
): PhotoExportRow[] {
  return photos.map((ph) => {
    const base = {
      id: ph.id, projectId: ph.projectId, tag: ph.tag ?? '', timestamp: ph.timestamp,
      storagePath: ph.storagePath ?? '',
    };
    const isHttp = typeof ph.uri === 'string' && /^https?:\/\//i.test(ph.uri);
    const pending = ctx?.notUploaded.has(ph.id) ?? false;
    if (pending || (!ph.storagePath && !isHttp)) {
      return { ...base, viewUrl: '', viewUrlExpiresAt: null, note: PHOTO_ON_DEVICE_ONLY };
    }
    if (!includeLinks) return { ...base, viewUrl: '', viewUrlExpiresAt: null, note: PHOTO_LINKS_OMITTED };
    const fresh = ph.storagePath ? ctx?.links.get(ph.storagePath) : undefined;
    if (fresh) return { ...base, viewUrl: fresh, viewUrlExpiresAt: signedUrlExpiresAt(fresh), note: '' };
    if (!ph.storagePath && isHttp) {
      return { ...base, viewUrl: ph.uri, viewUrlExpiresAt: signedUrlExpiresAt(ph.uri), note: PHOTO_OLD_LINK };
    }
    return { ...base, viewUrl: '', viewUrlExpiresAt: null, note: PHOTO_NO_LINK_OFFLINE };
  });
}

/** The earliest expiry among the rows' links — what the column header states. */
export function earliestLinkExpiry(rows: PhotoExportRow[]): string | null {
  let best: string | null = null;
  for (const r of rows) {
    if (r.viewUrlExpiresAt && (best === null || r.viewUrlExpiresAt < best)) best = r.viewUrlExpiresAt;
  }
  return best;
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

  // Photos go out as they are held; the link / on-device decision is made per
  // row by photoExportRows at write time (#80), not by blanking `uri` here.
  const photos = filterByProject(all.photos ?? [], opts.projectId);

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
    aiaPayApps: filterByProject(all.aiaPayApps ?? [], opts.projectId),
    commitments: filterByProject(all.commitments ?? [], opts.projectId),
    fieldTickets: filterByProject(all.fieldTickets ?? [], opts.projectId),
    timeEntries: filterByProject(all.timeEntries ?? [], opts.projectId),
    safetyIncidents: filterByProject(all.safetyIncidents ?? [], opts.projectId),
    // A portfolio belongs to no project: whole in an all-projects export,
    // absent from a single-project one.
    managedProperties: opts.projectId ? [] : (all.managedProperties ?? []),
    workOrders: opts.projectId ? [] : (all.workOrders ?? []),
  };
}

/**
 * Convert the payload into a set of CSV strings (one per entity).
 */
export function payloadToCsvs(
  p: DataExportPayload,
  photoCtx?: PhotoExportContext,
  includePhotoLinks = true,
): Record<string, string> {
  const csvs: Record<string, string> = {};

  csvs.projects = toCsv(
    // Q6: `type` stays the machine id (a backup must round-trip); typeLabel is
    // what a person reads — his words for an Other job ("Whole-house repipe").
    ['id', 'name', 'type', 'typeLabel', 'location', 'squareFootage', 'quality', 'status', 'grandTotal', 'createdAt', 'updatedAt'],
    p.projects.map(pr => [
      pr.id, pr.name, pr.type, projectTypeLabel(pr), pr.location, pr.squareFootage, pr.quality,
      pr.status, (effectiveEstimateTotal(pr) || ''), pr.createdAt, pr.updatedAt,
    ]),
  );

  csvs.invoices = toCsv(
    ['id', 'number', 'projectId', 'type', 'issueDate', 'dueDate', 'paymentTerms', 'subtotal', 'taxAmount', 'totalDue', 'amountPaid', 'status', 'retentionPercent', 'retentionAmount'],
    p.invoices.map(i => [
      i.id, i.number, i.projectId, i.type, i.issueDate, i.dueDate, i.paymentTerms,
      i.subtotal, i.taxAmount, i.totalDue, i.amountPaid, i.status,
      i.retentionPercent ?? '',
      // MONEY-05: the withholding the app actually applies (percentage of the
      // work value), not the stored column. This CSV goes to an accountant or a
      // migration target, so a row that disagreed with the invoice, the portal
      // and the Stripe charge for the same job would be the one figure that
      // outlived the app. Rows with no percentage to recompute from fall back to
      // the stored amount inside the helper.
      (i.retentionPercent ?? i.retentionAmount) == null ? '' : effectiveRetentionHeld(i),
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

  // `listType` is in the CSV because the two lists are one table: without the
  // column a crew-list item (internal, never client-facing) is
  // indistinguishable from formal punch the moment this sheet is handed to an
  // owner's rep or an accountant. Resolved through punchListTypeOf so a
  // pre-listType row prints 'punch', the same default every screen applies.
  // (The JSON file carries the field as stored — it spreads the whole item.)
  csvs.punchItems = toCsv(
    ['id', 'projectId', 'listType', 'description', 'location', 'assignedSub', 'status', 'priority', 'createdAt'],
    p.punchItems.map(pi => [
      pi.id, pi.projectId, punchListTypeOf(pi), pi.description, pi.location ?? '', pi.assignedSub ?? '',
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

  // #131: the README promised a submittals file that was never written.
  csvs.submittals = toCsv(
    ['id', 'number', 'projectId', 'title', 'specSection', 'status', 'submittedDate', 'requiredDate'],
    p.submittals.map(sb => [
      sb.id, sb.number, sb.projectId, sb.title, sb.specSection ?? '', sb.currentStatus,
      sb.submittedDate ?? '', sb.requiredDate ?? '',
    ]),
  );

  // #80: photos are RECORDS with a temporary link, never the image files. The
  // header states when the links die; a photo still only on this phone says so.
  const photoRows = photoExportRows(p.photos, photoCtx, includePhotoLinks);
  const expires = earliestLinkExpiry(photoRows);
  csvs.photos = toCsv(
    ['id', 'projectId', 'tag', 'timestamp', 'storagePath',
      expires ? `viewUrl (expires ${expires})` : 'viewUrl (temporary link)', 'note'],
    photoRows.map(r => [r.id, r.projectId, r.tag, r.timestamp, r.storagePath, r.viewUrl, r.note]),
  );

  // #131: the money and field records. Money columns are exact to the cent.
  csvs.aiaPayApps = toCsv(
    ['id', 'projectId', 'applicationNumber', 'applicationDate', 'periodTo', 'invoiceId',
      'originalContractSum', 'netChangeByCO', 'contractSumToDate', 'retainagePercent',
      'totalCompletedAndStored', 'totalRetainage', 'lessPreviousCertificates', 'currentPaymentDue',
      'balanceToFinish', 'paidAt'],
    p.aiaPayApps.map(a => [
      a.id, a.projectId, a.applicationNumber, a.applicationDate, a.periodTo, a.invoiceId ?? '',
      csvMoney(a.originalContractSum), csvMoney(a.netChangeByCO), csvMoney(a.contractSumToDate),
      a.retainagePercent ?? '',
      csvMoney(a.totals?.totalCompletedAndStored), csvMoney(a.totals?.totalRetainage),
      csvMoney(a.lessPreviousCertificates), csvMoney(a.totals?.currentPaymentDue),
      csvMoney(a.totals?.balanceToFinish), a.paidAt ?? '',
    ]),
  );

  csvs.commitments = toCsv(
    ['id', 'projectId', 'number', 'type', 'subcontractorId', 'vendorName', 'description',
      'amount', 'changeAmount', 'paidToDate', 'signedDate', 'status'],
    p.commitments.map(c => [
      c.id, c.projectId, c.number, c.type, c.subcontractorId ?? '', c.vendorName ?? '', c.description,
      csvMoney(c.amount), csvMoney(c.changeAmount ?? 0), csvMoney(c.paidToDate ?? 0), c.signedDate, c.status,
    ]),
  );

  csvs.fieldTickets = toCsv(
    ['id', 'number', 'projectId', 'date', 'status', 'workDescription', 'laborHours',
      'laborCost', 'materialCost', 'equipmentCost', 'markupPercent', 'billableTotal', 'convertedChangeOrderId'],
    p.fieldTickets.map(t => {
      const totals = computeFieldTicketTotals(t);
      return [
        t.id, t.number, t.projectId, t.date, t.status, t.workDescription, totals.laborHours,
        csvMoney(totals.laborCost), csvMoney(totals.materialCost), csvMoney(totals.equipmentCost),
        totals.markupPercent, csvMoney(totals.billableTotal), t.convertedChangeOrderId ?? '',
      ];
    }),
  );

  csvs.timeEntries = toCsv(
    ['id', 'projectId', 'projectName', 'date', 'workerName', 'trade', 'clockIn', 'clockOut',
      'breakMinutes', 'totalHours', 'overtimeHours', 'status', 'notes'],
    p.timeEntries.map(e => [
      e.id, e.projectId, e.projectName, e.date, e.workerName, e.trade, e.clockIn, e.clockOut ?? '',
      e.breakMinutes, e.totalHours, e.overtimeHours, e.status, e.notes ?? '',
    ]),
  );

  csvs.safetyIncidents = toCsv(
    ['id', 'projectId', 'occurredAt', 'type', 'severity', 'location', 'description', 'treatment',
      'daysAway', 'daysRestricted', 'oshaRecordable', 'status', 'reportedBy'],
    p.safetyIncidents.map(i => [
      i.id, i.projectId, i.occurredAt, i.type, i.severity, i.location, i.description, i.treatment,
      i.daysAway, i.daysRestricted, i.oshaRecordable, i.status, i.reportedBy,
    ]),
  );

  // The PM portfolio — only when there is one, so a contractor's export does
  // not grow two empty files. `?? []` because a payload built before these
  // fields existed (or by a caller that omits them) must still export.
  const managedProperties = p.managedProperties ?? [];
  const workOrders = p.workOrders ?? [];
  if (managedProperties.length > 0 || workOrders.length > 0) {
    csvs.managedProperties = toCsv(
      ['id', 'name', 'address', 'propertyType', 'units', 'ownerName', 'ownerPhone', 'ownerEmail', 'notes', 'createdAt', 'updatedAt'],
      managedProperties.map(mp => [
        mp.id, mp.name, mp.address ?? '', mp.propertyType ?? '', mp.units ?? '', mp.ownerName ?? '',
        mp.ownerPhone ?? '', mp.ownerEmail ?? '', mp.notes ?? '', mp.createdAt, mp.updatedAt,
      ]),
    );
    const propertyName = new Map(managedProperties.map(mp => [mp.id, mp.name]));
    csvs.workOrders = toCsv(
      ['id', 'propertyId', 'propertyName', 'title', 'description', 'category', 'priority', 'status', 'budget',
        'assignedContactName', 'assignedAt', 'rfpId', 'completedAt', 'createdAt', 'updatedAt'],
      workOrders.map(w => [
        w.id, w.propertyId, propertyName.get(w.propertyId) ?? '', w.title, w.description ?? '', w.category ?? '',
        w.priority, w.status, csvMoney(w.budget), w.assignedContactName ?? '', w.assignedAt ?? '',
        w.rfpId ?? '', w.completedAt ?? '', w.createdAt, w.updatedAt,
      ]),
    );
  }

  return csvs;
}

/** Human names for the CSV files, in the order payloadToCsvs writes them. */
const CSV_ENTITY_LABELS: Record<string, string> = {
  projects: 'projects', invoices: 'invoices', changeOrders: 'change orders',
  dailyReports: 'daily reports', punchItems: 'punch items', contacts: 'contacts', rfis: 'RFIs',
  submittals: 'submittals', photos: 'photo records', aiaPayApps: 'AIA pay apps',
  commitments: 'commitments / POs', fieldTickets: 'T&M field tickets', timeEntries: 'time entries',
  safetyIncidents: 'safety incidents', managedProperties: 'managed properties', workOrders: 'work orders',
};

/** The CSV set, named for a person — built from the files actually written,
 *  so the README can never again list a file that does not exist (#131). */
export function csvEntityLine(csvs: Record<string, string>): string {
  return Object.keys(csvs).map((k) => CSV_ENTITY_LABELS[k] ?? k).join(', ');
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
  photoCtx?: PhotoExportContext,
): Promise<DataExportSummary> {
  const payload = buildExportPayload(all, opts);
  const includeLinks = opts.includePhotoUrls !== false;
  const photoRows = photoExportRows(payload.photos, photoCtx, includeLinks);
  const photoLinksExpireAt = earliestLinkExpiry(photoRows);
  const photoOnDeviceOnlyCount = photoRows.filter((r) => r.note === PHOTO_ON_DEVICE_ONLY).length;
  let deliveredFileCount = 0;
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
    // Photos in the JSON carry the same decision as the CSV row: `uri` is the
    // export-time link or '' (never a file:// path), with the expiry and note.
    const rowById = new Map(photoRows.map((r) => [r.id, r]));
    const jsonPhotos = payload.photos.map((ph) => {
      const r = rowById.get(ph.id);
      return { ...ph, uri: r?.viewUrl ?? '', viewUrlExpiresAt: r?.viewUrlExpiresAt ?? null, exportNote: r?.note ?? '' };
    });
    const jsonBody = JSON.stringify({
      exportedAt: new Date().toISOString(),
      exportedBy: 'MAGE ID',
      schemaVersion: 1,
      options: opts,
      notExported: NOT_EXPORTED,
      ...payload,
      photos: jsonPhotos,
    }, null, 2);
    const written = await deliverTextFile(`${baseName}.json`, jsonBody, 'application/json');
    deliveredFileCount += 1;
    totalBytes += jsonBody.length;
    // Web returns null — the file already reached the user via download, and
    // there is no URI to hand to Sharing afterwards.
    if (written) fileUris.push(written);
  }

  if (opts.format === 'csv' || opts.format === 'both') {
    const csvs = payloadToCsvs(payload, photoCtx, includeLinks);
    for (const [entity, body] of Object.entries(csvs)) {
      const written = await deliverTextFile(`${baseName}-${entity}.csv`, body, 'text/csv;charset=utf-8');
      deliveredFileCount += 1;
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
        deliveredFileCount += 1;
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
    const readme = buildReadmeText(payload, opts, { photoLinksExpireAt, photoOnDeviceOnlyCount, includeLinks });
    const written = await deliverTextFile(`${baseName}-README.txt`, readme, 'text/plain;charset=utf-8');
    deliveredFileCount += 1;
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
    submittalCount: payload.submittals.length,
    payAppCount: payload.aiaPayApps.length,
    commitmentCount: payload.commitments.length,
    fieldTicketCount: payload.fieldTickets.length,
    timeEntryCount: payload.timeEntries.length,
    safetyIncidentCount: payload.safetyIncidents.length,
    managedPropertyCount: payload.managedProperties.length,
    workOrderCount: payload.workOrders.length,
    photoOnDeviceOnlyCount,
    photoLinksExpireAt,
    fileUris,
    deliveredFileCount,
    totalBytes,
  };
}

/**
 * Build a plain-text README explaining each file in the export bundle.
 * Goes alongside the JSON / CSV / PDF so a non-technical recipient
 * (homeowner, accountant, lawyer) can find what they're looking for.
 */
export function buildReadmeText(
  payload: DataExportPayload,
  opts: DataExportOptions,
  photos: { photoLinksExpireAt: string | null; photoOnDeviceOnlyCount: number; includeLinks: boolean } =
    { photoLinksExpireAt: null, photoOnDeviceOnlyCount: 0, includeLinks: true },
): string {
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
    lines.push(`  JSON snapshot of the records listed under COUNTS. Open with any`);
    lines.push(`  text editor or import into another tool. Schema version is included.`);
    lines.push(``);
  }
  if (opts.format === 'csv' || opts.format === 'both') {
    lines.push(`• mage-id-export-*.csv (one per record type)`);
    lines.push(`  Spreadsheet-friendly. Open with Excel, Google Sheets, Numbers.`);
    lines.push(`  One file per record type: ${csvEntityLine(payloadToCsvs(payload))}.`);
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
  lines.push(`  Photo records:   ${payload.photos.length}`);
  lines.push(`  Contacts:        ${payload.contacts.length}`);
  lines.push(`  AIA pay apps:    ${payload.aiaPayApps.length}`);
  lines.push(`  Commitments/POs: ${payload.commitments.length}`);
  lines.push(`  T&M tickets:     ${payload.fieldTickets.length}`);
  lines.push(`  Time entries:    ${payload.timeEntries.length}`);
  lines.push(`  Safety incidents: ${payload.safetyIncidents.length}`);
  if ((payload.managedProperties?.length ?? 0) > 0 || (payload.workOrders?.length ?? 0) > 0) {
    lines.push(`  Managed properties: ${payload.managedProperties.length}`);
    lines.push(`  Work orders:     ${payload.workOrders.length}`);
  }
  lines.push(``);
  lines.push(`PHOTOS`);
  lines.push(``);
  lines.push(`  The photo image files are NOT in this bundle. Each photo is a record`);
  lines.push(`  (job, tag, time, storage path) with a download link that`);
  lines.push(photos.includeLinks
    ? (photos.photoLinksExpireAt
      ? `  stops working at ${photos.photoLinksExpireAt} (UTC). Download what you need before then.`
      : `  was made for this export and expires within 24 hours.`)
    : `  was left out of this export (the photo-link option was off).`);
  if (photos.photoOnDeviceOnlyCount > 0) {
    lines.push(`  ${photos.photoOnDeviceOnlyCount} photo${photos.photoOnDeviceOnlyCount === 1 ? ' is' : 's are'} still only on the phone that took ${photos.photoOnDeviceOnlyCount === 1 ? 'it' : 'them'} (not uploaded) and ${photos.photoOnDeviceOnlyCount === 1 ? 'has' : 'have'} no link.`);
  }
  lines.push(``);
  lines.push(`NOT IN THIS BUNDLE YET`);
  lines.push(``);
  lines.push(`  ${NOT_EXPORTED.join(', ')}.`);
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
    `${s.photoCount} photo records`,
    `${s.contactCount} contacts`,
    `${s.rfiCount} RFIs`,
    `${s.submittalCount} submittals`,
    `${s.payAppCount} pay apps`,
    `${s.commitmentCount} commitments`,
    `${s.fieldTicketCount} T&M tickets`,
    `${s.timeEntryCount} time entries`,
    `${s.safetyIncidentCount} safety incidents`,
    // Only a Property Manager has a portfolio; nobody else reads "0 work orders".
    ...((s.managedPropertyCount ?? 0) > 0 || (s.workOrderCount ?? 0) > 0
      ? [`${s.managedPropertyCount} managed properties`, `${s.workOrderCount} work orders`]
      : []),
  ];
  return `${parts.join(' · ')} (${sizeKb} KB)`;
}
