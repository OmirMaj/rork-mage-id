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
  Submittal, Warranty as ProjectWarranty, SelectionCategory,
} from '@/types';

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
}

function buildBinderHtml(input: BuildBinderInput): string {
  const { project, branding, binder, commitments, photos, selections, warranties } = input;
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

  const subContactRows = (commitments ?? [])
    .filter(c => c.status !== 'draft')
    .map(c => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:12px;font-weight:700">${escHtml(c.vendorName ?? 'Subcontractor')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(c.description ?? c.type ?? '')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(c.phase ?? '')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${fmtMoney(c.amount + (c.changeAmount ?? 0))}</td>
      </tr>
    `).join('');

  const selectionRows = chosenSelections.map(s => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;font-weight:800;color:${PDF_PALETTE.textMuted};text-transform:uppercase;letter-spacing:0.4px;width:25%">${escHtml(s.category)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:12px;color:${PDF_PALETTE.text}"><strong>${escHtml(s.chosen!.productName)}</strong>${s.chosen!.brand ? ` · ${escHtml(s.chosen!.brand)}` : ''}${s.chosen!.sku ? ` · SKU ${escHtml(s.chosen!.sku)}` : ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.textMuted}">${s.chosen!.supplier ? escHtml(s.chosen!.supplier) : ''}</td>
    </tr>
  `).join('');

  const warrantyRows = (warranties ?? [])
    .filter(w => w.projectId === project.id)
    .map(w => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:12px;font-weight:700">${escHtml(w.title ?? w.category ?? 'Item')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(w.provider ?? '')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${w.durationMonths ? w.durationMonths + ' mo' : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${w.endDate ? fmtDate(w.endDate) : ''}</td>
      </tr>
    `).join('');

  const maintenanceRows = (binder.maintenanceSchedule ?? []).map(m => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:12px;font-weight:700">${escHtml(m.task)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${escHtml(m.frequency)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${PDF_PALETTE.bone};font-size:11px;color:${PDF_PALETTE.text2}">${m.nextDate ? fmtDate(m.nextDate) : '—'}</td>
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

    ${sectionTable('Finishes &amp; fixtures installed',
      ['Category', 'Product · Brand · SKU', 'Supplier'],
      selectionRows,
      'No selections recorded.')}

    ${sectionTable('Warranties on file',
      ['Item', 'Provider', 'Duration', 'Expires'],
      warrantyRows,
      'No warranties on file.')}

    ${sectionTable('Maintenance schedule',
      ['Task', 'Frequency', 'Next due', 'Notes'],
      maintenanceRows,
      'No maintenance items configured.')}

    ${sectionTable('Trade contacts',
      ['Company', 'Scope', 'Phone', 'Email'],
      subContactRows,
      'No subcontractors on file.')}

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
