// closeoutBinderEngine — auto-compiles the homeowner closeout binder
// PDF from everything we already know about the project: photos, paint
// colors + fixtures (from Selections), warranties, sub contacts, permits,
// maintenance schedule. The big differentiator nobody else ships well —
// every owner asks "what valve is what?" 3 years after the build.

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  pdfShell, pdfHeader, pdfTitle, pdfFooter, escHtml, fmtMoney, fmtDate, PDF_PALETTE,
} from './pdfDesign';
import type {
  CompanyBranding, Project, Commitment, ProjectPhoto, RFI,
  Submittal, Warranty as ProjectWarranty, SelectionCategory, LienWaiver,
  Subcontractor, SubmittalStatus, RFIStatus,
} from '@/types';
import { WAIVER_LABELS } from './lienWaiverEngine';
import { calendarDayStart } from './calendarDate';
import { resolveTradeContacts } from './tradeContacts';

export interface MaintenanceItem {
  id: string;
  task: string;            // "HVAC service"
  frequency: string;       // "Annual"
  nextDate?: string;       // ISO date for first reminder
  notes?: string;
}

export interface CloseoutBinder {
  id: string;
  projectId: string;
  userId: string;
  pdfUrl?: string;
  html?: string;
  maintenanceSchedule: MaintenanceItem[];
  notes: string;
  status: 'draft' | 'finalized' | 'sent';
  finalizedAt?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface CloseoutBinderRow {
  id: string;
  project_id: string;
  user_id: string;
  pdf_url: string | null;
  html: string | null;
  maintenance_schedule: MaintenanceItem[];
  notes: string;
  status: 'draft' | 'finalized' | 'sent';
  finalized_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToBinder(r: CloseoutBinderRow): CloseoutBinder {
  return {
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    pdfUrl: r.pdf_url ?? undefined,
    html:   r.html    ?? undefined,
    maintenanceSchedule: Array.isArray(r.maintenance_schedule) ? r.maintenance_schedule : [],
    notes: r.notes ?? '',
    status: r.status,
    finalizedAt: r.finalized_at ?? undefined,
    sentAt:      r.sent_at      ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Default maintenance items for a typical residential project. The GC
// can edit, add, remove.
export const DEFAULT_MAINTENANCE: MaintenanceItem[] = [
  { id: 'm1', task: 'HVAC filter replacement',  frequency: 'Quarterly', notes: 'Replace MERV 11 or higher.' },
  { id: 'm2', task: 'HVAC professional service', frequency: 'Annual',    notes: 'Spring tune-up recommended before cooling season.' },
  { id: 'm3', task: 'Smoke + CO detectors test', frequency: 'Monthly',   notes: 'Replace batteries annually.' },
  { id: 'm4', task: 'Caulk + sealant inspection', frequency: 'Annual',   notes: 'Check kitchen + bath grout, exterior caulking.' },
  { id: 'm5', task: 'Gutter cleaning',           frequency: 'Bi-annual', notes: 'Spring and fall.' },
  { id: 'm6', task: 'Water heater flush',        frequency: 'Annual',    notes: 'Drain sediment to extend life.' },
];

// ─── CRUD ───────────────────────────────────────────────────────────

export async function fetchCloseoutBinder(projectId: string): Promise<CloseoutBinder | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from('closeout_binders')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToBinder(data as CloseoutBinderRow);
}

export async function saveCloseoutBinder(b: Partial<CloseoutBinder> & { id?: string; projectId: string }): Promise<CloseoutBinder | null> {
  if (!isSupabaseConfigured) return null;
  const session = await supabase.auth.getSession();
  const userId = session.data.session?.user?.id;
  if (!userId) return null;

  const row = {
    id: b.id,
    project_id: b.projectId,
    user_id: userId,
    pdf_url: b.pdfUrl ?? null,
    html:    b.html    ?? null,
    maintenance_schedule: b.maintenanceSchedule ?? DEFAULT_MAINTENANCE,
    notes: b.notes ?? '',
    status: b.status ?? 'draft',
    finalized_at: b.finalizedAt ?? null,
    sent_at:      b.sentAt      ?? null,
  };
  const { data, error } = await supabase
    .from('closeout_binders')
    .upsert(row, { onConflict: 'id' })
    .select('*')
    .maybeSingle();
  if (error || !data) {
    console.warn('[closeoutBinderEngine] save error:', error?.message);
    return null;
  }
  return rowToBinder(data as CloseoutBinderRow);
}

// ─── PDF builder ───────────────────────────────────────────────────

export interface BuildBinderInput {
  project: Project;
  branding: CompanyBranding;
  binder: CloseoutBinder;
  commitments: Commitment[];      // for sub/vendor contact list
  photos: ProjectPhoto[];         // hero + before/after
  selections: SelectionCategory[]; // chosen finishes/fixtures
  warranties: ProjectWarranty[];
  rfis: RFI[];
  submittals: Submittal[];
  /**
   * The sub roster, used to turn each subcontract commitment into a contact
   * the client can actually dial. Optional only so an older call site cannot
   * silently fail to compile — when it is absent the trade-contacts table
   * still renders, with the phone and email cells blank and a line saying so,
   * rather than back-filling those columns with some other field. See
   * utils/tradeContacts.ts for what that mistake cost.
   */
  subcontractors?: Subcontractor[];
  /** Signed lien waivers — legal artifact for the binder. Residential
   *  needs unconditional finals from majors; commercial needs the full
   *  per-period conditional + unconditional set. AUD-008. */
  lienWaivers: LienWaiver[];
}

/**
 * A table cell's date, printed as the DAY it names. RFI.dateSubmitted,
 * warranty end dates, lien-waiver through-dates and maintenance due dates
 * arrive as either a bare 'YYYY-MM-DD' or a full instant, depending on the
 * writer. pdfDesign's fmtDate runs them through `new Date(value)`, which reads
 * the bare shape as UTC midnight — so every one of those cells printed the day
 * BEFORE for a client anywhere west of Greenwich, in a document they keep for
 * the life of the building. calendarDayStart reads a bare day as that day and
 * an instant as the local day it fell on; this is the same parse
 * utils/pdfGenerator.ts formatRfiDate settled on for the standalone RFI log.
 *
 * An unparseable value is printed as-is (escaped) rather than swapped for a
 * dash: a dash would claim "no date" when there IS a date we could not read.
 */
function fmtCellDay(value: string | null | undefined, empty: string): string {
  if (!value) return empty;
  const d = calendarDayStart(value);
  if (!d) return escHtml(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Exported for scripts/validate-closeout-binder.ts, which renders it with the
// native modules stubbed. The screen reaches it only through
// shareCloseoutBinderPDF.
export function buildBinderHtml(input: BuildBinderInput): string {
  const {
    project, branding, binder, commitments, photos, selections, warranties, lienWaivers,
    // rfis/submittals were declared on BuildBinderInput and filtered by the
    // screen, and then this destructure never named them — so the full
    // design-question and shop-drawing record was computed and thrown away on
    // every export. They are the two logs a landlord or tenant holds retention
    // over, and the GC was re-assembling them by hand from two other screens.
    rfis, submittals, subcontractors,
  } = input;
  const completionDate = project.closedAt ?? project.updatedAt;

  // Hero photo — most recent project photo if available.
  const heroPhoto = (photos ?? [])
    .slice()
    .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))[0];

  // Selections become the "what's installed" reference — paint colors,
  // tile, fixtures, appliances. Critical for the "what brand is this
  // shower head?" 3-years-later question.
  const chosenSelections = (selections ?? [])
    .map(c => ({ category: c.category, chosen: (c.options ?? []).find(o => o.isChosen) }))
    .filter(x => !!x.chosen);

  // Trade contacts — "who did my electrical", answered two years from now.
  //
  // This table used to print `fmtMoney(c.amount + (c.changeAmount ?? 0))` under
  // a column headed "Email", and c.phase under a column headed "Phone". That is
  // every subcontractor's contract value, including approved change orders, in
  // the document handed to the client: subtract the column from the contract
  // sum and the GC's margin is readable line by line. Sub contract values are a
  // GC-side number and live on the buyout and job-cost screens; they have no
  // business in a client-facing binder at all, so the amount cell is gone
  // rather than relabelled. The resolver is shared with the client portal so
  // the same table can never drift apart between the two surfaces.
  const tradeContacts = resolveTradeContacts(commitments, subcontractors, project.id);
  const subContactRows = tradeContacts.map(t => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:12px;font-weight:700">${escHtml(t.company)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(t.scope ?? '')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(t.phone ?? '')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(t.email ?? '')}</td>
      </tr>
    `).join('');
  // Honesty line: a blank phone/email cell means we never captured it, not that
  // the trade has no number. Say so under the table instead of letting the
  // client read the gap as a data error — and tell them who to call meanwhile.
  const missingContactCount = tradeContacts.filter(t => !t.phone && !t.email).length;
  const tradeContactsNote = missingContactCount > 0 ? `
    <p style="margin:8px 2px 0;font-size:11px;color:${PDF_PALETTE.textMuted};font-style:italic">
      ${missingContactCount} of ${tradeContacts.length} trades ${missingContactCount === 1 ? 'has' : 'have'} no phone or email on file — we never captured one. Contact us and we'll put you in touch.
    </p>
  ` : '';

  // ── RFI log ────────────────────────────────────────────────────────────────
  // Every design question asked and where it landed. Void RFIs are withdrawn
  // questions and are left out — a closeout log of things that were un-asked
  // reads as noise, not as a record.
  const RFI_STATUS_LABELS: Record<RFIStatus, string> = {
    open: 'Open', answered: 'Answered', closed: 'Closed', void: 'Void',
  };
  const projectRfis = (rfis ?? [])
    .filter(r => r.projectId === project.id && r.status !== 'void')
    .sort((a, b) => a.number - b.number);
  // Columns stop at status on purpose: dateResponded and `response` are null on
  // most real rows, so a "Responded" column would print a page of dashes and
  // make a complete log look incomplete.
  const rfiRows = projectRfis.map(r => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:12px;font-weight:700">#${escHtml(r.number)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text}">${escHtml(r.subject)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${fmtCellDay(r.dateSubmitted, '')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(RFI_STATUS_LABELS[r.status] ?? r.status)}</td>
    </tr>
  `).join('');

  // ── Submittal log ──────────────────────────────────────────────────────────
  // The shop-drawing record. Same reasoning on columns: the review-cycle
  // reviewer and return date are empty on most rows, so the log prints the
  // current disposition and stops there.
  // Plain text, escaped at the cell like every other value in this document —
  // a label map that carries its own entities is one edit away from a raw '&'
  // or an unescaped fallback reaching a client-facing PDF.
  const SUBMITTAL_STATUS_LABELS: Record<SubmittalStatus, string> = {
    pending: 'Pending',
    in_review: 'In review',
    approved: 'Approved',
    approved_as_noted: 'Approved as noted',
    revise_resubmit: 'Revise & resubmit',
    rejected: 'Rejected',
  };
  const projectSubmittals = (submittals ?? [])
    .filter(s => s.projectId === project.id)
    .sort((a, b) => a.number - b.number);
  const submittalRows = projectSubmittals.map(s => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:12px;font-weight:700">SUB-${escHtml(String(s.number).padStart(3, '0'))}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(s.specSection ?? '')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text}">${escHtml(s.title)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(SUBMITTAL_STATUS_LABELS[s.currentStatus] ?? s.currentStatus)}</td>
    </tr>
  `).join('');

  const selectionRows = chosenSelections.map(s => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;font-weight:800;color:${PDF_PALETTE.textMuted};text-transform:uppercase;letter-spacing:0.4px;width:25%">${escHtml(s.category)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:12px;color:${PDF_PALETTE.text}"><strong>${escHtml(s.chosen!.productName)}</strong>${s.chosen!.brand ? ` · ${escHtml(s.chosen!.brand)}` : ''}${s.chosen!.sku ? ` · SKU ${escHtml(s.chosen!.sku)}` : ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.textMuted}">${s.chosen!.supplier ? escHtml(s.chosen!.supplier) : ''}</td>
    </tr>
  `).join('');

  // Lien waivers section: filter to this project, prefer "signed"/"received"
  // (the legally useful states; "requested" still has no signature on file).
  // Sort newest first by throughDate so the final waivers float to the top.
  const projectLienWaivers = (lienWaivers ?? [])
    .filter(w => w.projectId === project.id && (w.status === 'signed' || w.status === 'received'))
    .sort((a, b) => (b.throughDate ?? '').localeCompare(a.throughDate ?? ''));
  const lienWaiverRows = projectLienWaivers.map(w => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:12px;font-weight:700">${escHtml(w.subName)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(WAIVER_LABELS[w.waiverType]?.short ?? w.waiverType)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${fmtCellDay(w.throughDate, '—')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${fmtMoney(w.paidAmount)}</td>
    </tr>
  `).join('');

  const warrantyRows = (warranties ?? [])
    .filter(w => w.projectId === project.id)
    .map(w => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:12px;font-weight:700">${escHtml(w.title ?? w.category ?? 'Item')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(w.provider ?? '')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${w.durationMonths ? w.durationMonths + ' mo' : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${fmtCellDay(w.endDate, '')}</td>
      </tr>
    `).join('');

  const maintenanceRows = (binder.maintenanceSchedule ?? []).map(m => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:12px;font-weight:700">${escHtml(m.task)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(m.frequency)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${fmtCellDay(m.nextDate, '—')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(m.notes ?? '')}</td>
    </tr>
  `).join('');

  const sectionTable = (title: string, columns: string[], rowsHtml: string, emptyMsg: string) => `
    <div class="no-break" style="margin-bottom:24px">
      <h2 style="font-family:'Fraunces',Georgia,serif;font-size:18px;font-weight:700;color:${PDF_PALETTE.ink};margin:0 0 10px;letter-spacing:-0.3px">${escHtml(title)}</h2>
      ${rowsHtml ? `
        <table style="width:100%;border-collapse:collapse;background:${PDF_PALETTE.surface};border:1px solid ${PDF_PALETTE.bone};border-radius:8px;overflow:hidden">
          <thead><tr>${columns.map(c => `<th style="text-align:left;padding:10px 12px;background:${PDF_PALETTE.cream2};font-size:9px;font-weight:800;letter-spacing:0.6px;color:${PDF_PALETTE.textMuted};text-transform:uppercase;border-bottom:2px solid ${PDF_PALETTE.bone}">${escHtml(c)}</th>`).join('')}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      ` : `<p style="font-size:12px;color:${PDF_PALETTE.textMuted};font-style:italic">${escHtml(emptyMsg)}</p>`}
    </div>
  `;

  const heroSection = heroPhoto?.uri ? `
    <div style="margin:24px 0;border-radius:12px;overflow:hidden;border:1px solid ${PDF_PALETTE.bone}">
      <img src="${escHtml(heroPhoto.uri)}" style="width:100%;height:auto;display:block;max-height:300px;object-fit:cover" alt="" />
    </div>
  ` : '';

  const bodyHtml = `
    ${pdfHeader(branding)}
    ${pdfTitle({
      eyebrow: 'Project Closeout',
      title:   `${project.name} — Closeout Binder`,
      subtitle: `Everything you need to maintain, troubleshoot, and improve this build.`,
      meta: [
        { label: 'Address',     value: project.location ?? '—' },
        { label: 'Completion',  value: fmtDate(completionDate) },
        { label: 'Built by',    value: branding.companyName ?? 'MAGE ID' },
      ],
    })}
    ${heroSection}

    ${binder.notes ? `
    <div style="background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};border-radius:10px;padding:14px 16px;margin-bottom:24px;font-size:13px;line-height:1.6;color:${PDF_PALETTE.text}">
      <div style="font-size:10px;font-weight:800;letter-spacing:1px;color:${PDF_PALETTE.amber};text-transform:uppercase;margin-bottom:6px">A note from your contractor</div>
      ${escHtml(binder.notes).replace(/\n/g, '<br/>')}
    </div>
    ` : ''}

    ${sectionTable('Finishes & fixtures installed',
      ['Category', 'Product · Brand · SKU', 'Supplier'],
      selectionRows,
      'No selections recorded.')}

    ${sectionTable('Warranties on file',
      ['Item', 'Provider', 'Duration', 'Expires'],
      warrantyRows,
      'No warranties on file.')}

    ${sectionTable('Lien waivers received',
      ['Subcontractor', 'Waiver type', 'Through date', 'Paid amount'],
      lienWaiverRows,
      'No lien waivers on file.')}

    ${sectionTable('Maintenance schedule',
      ['Task', 'Frequency', 'Next due', 'Notes'],
      maintenanceRows,
      'No maintenance items configured.')}

    ${sectionTable('Trade contacts',
      ['Company', 'Scope', 'Phone', 'Email'],
      subContactRows,
      'No subcontractors on file.')}
    ${tradeContactsNote}

    <!-- The two logs are rendered only when they have rows. Unlike the sections
         above them, "no RFIs on this job" is a normal and common outcome on a
         small job, and an empty table with a header reads as a broken feature
         rather than as an honest zero. -->
    ${rfiRows ? sectionTable('RFI log',
      ['RFI', 'Subject', 'Submitted', 'Status'],
      rfiRows,
      '') : ''}

    ${submittalRows ? sectionTable('Submittal log',
      ['Submittal', 'Spec section', 'Title', 'Status'],
      submittalRows,
      '') : ''}

    <div style="margin-top:28px;padding:16px 18px;background:${PDF_PALETTE.amberTint};border:1px solid ${PDF_PALETTE.amber}40;border-radius:10px;font-size:12px;color:${PDF_PALETTE.text};line-height:1.6">
      <strong style="color:${PDF_PALETTE.ink};font-size:13px">If something breaks during the warranty period:</strong>
      <ol style="margin:8px 0 0 20px;padding:0">
        <li>Document with a photo + short description of the issue.</li>
        <li>Email the contractor at <strong>${escHtml(branding.email ?? '—')}</strong> within the warranty window.</li>
        <li>For urgent items (water leak, no heat, no power), call <strong>${escHtml(branding.phone ?? '—')}</strong>.</li>
      </ol>
    </div>

    ${pdfFooter(branding, undefined, 'Keep this binder for the life of the home. Reference it when scheduling maintenance, planning upgrades, or selling the property.')}
  `;

  return pdfShell({
    bodyHtml, branding,
    title: `${project.name} — Closeout Binder`,
    pageMargin: '32px 36px',
  });
}

export async function shareCloseoutBinderPDF(input: BuildBinderInput): Promise<void> {
  const html = buildBinderHtml(input);
  const title = `Closeout Binder — ${input.project.name}`;
  if (Platform.OS === 'web') {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
      newWindow.print();
    }
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}
