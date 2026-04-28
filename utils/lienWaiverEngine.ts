// lienWaiverEngine — Supabase + PDF helpers for lien waivers.
//
// The 4-type generic waiver covers ~38 US states. State-specific forms
// (CA Civil Code §8132–8138, TX Property Code §53.281, etc.) come in a
// future push. We surface a "Consult an attorney for state-specific
// requirements" disclaimer on every PDF so the GC isn't relying on us
// for a binding statutory form they actually need a different layout
// for in CA/TX/FL/GA/AZ.

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  pdfShell, pdfHeader, pdfFooter, escHtml, fmtMoney, fmtDate, PDF_PALETTE,
} from './pdfDesign';
import type {
  LienWaiver, LienWaiverType, LienWaiverStatus,
  CompanyBranding, ContractSignature,
} from '@/types';

// Row mapping
interface LienWaiverRow {
  id: string;
  project_id: string;
  user_id: string;
  commitment_id: string | null;
  invoice_id: string | null;
  waiver_type: LienWaiverType;
  sub_company_id: string | null;
  sub_name: string;
  sub_email: string | null;
  through_date: string;
  paid_amount: number;
  status: LienWaiverStatus;
  sub_signature: ContractSignature | null;
  signed_at: string | null;
  signed_pdf_url: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

function rowToWaiver(r: LienWaiverRow): LienWaiver {
  return {
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    commitmentId: r.commitment_id ?? undefined,
    invoiceId:    r.invoice_id    ?? undefined,
    waiverType: r.waiver_type,
    subCompanyId: r.sub_company_id ?? undefined,
    subName:      r.sub_name,
    subEmail:     r.sub_email      ?? undefined,
    throughDate: r.through_date,
    paidAmount: Number(r.paid_amount) || 0,
    status: r.status,
    subSignature: r.sub_signature ?? undefined,
    signedAt:     r.signed_at     ?? undefined,
    signedPdfUrl: r.signed_pdf_url ?? undefined,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────

export async function fetchLienWaiversForProject(projectId: string): Promise<LienWaiver[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('lien_waivers')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[lienWaiverEngine] fetch error:', error.message);
    return [];
  }
  return (data ?? []).map(r => rowToWaiver(r as LienWaiverRow));
}

export async function saveLienWaiver(w: Partial<LienWaiver> & { id?: string; projectId: string; subName: string; waiverType: LienWaiverType; throughDate: string; paidAmount: number }): Promise<LienWaiver | null> {
  if (!isSupabaseConfigured) return null;
  const session = await supabase.auth.getSession();
  const userId = session.data.session?.user?.id;
  if (!userId) return null;

  const row = {
    id: w.id,
    project_id: w.projectId,
    user_id: userId,
    commitment_id: w.commitmentId ?? null,
    invoice_id:    w.invoiceId    ?? null,
    waiver_type: w.waiverType,
    sub_company_id: w.subCompanyId ?? null,
    sub_name:       w.subName,
    sub_email:      w.subEmail      ?? null,
    through_date: w.throughDate,
    paid_amount: w.paidAmount,
    status: w.status ?? 'requested',
    sub_signature: w.subSignature ?? null,
    signed_at:     w.signedAt     ?? null,
    signed_pdf_url: w.signedPdfUrl ?? null,
    notes: w.notes ?? '',
  };
  const { data, error } = await supabase
    .from('lien_waivers')
    .upsert(row, { onConflict: 'id' })
    .select('*')
    .maybeSingle();
  if (error || !data) {
    console.warn('[lienWaiverEngine] save error:', error?.message);
    return null;
  }
  return rowToWaiver(data as LienWaiverRow);
}

export async function deleteLienWaiver(id: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { error } = await supabase.from('lien_waivers').delete().eq('id', id);
  return !error;
}

// ─── Display helpers ────────────────────────────────────────────────

export const WAIVER_LABELS: Record<LienWaiverType, { short: string; long: string; description: string }> = {
  conditional_partial: {
    short: 'Conditional Partial',
    long:  'Conditional Waiver and Release on Progress Payment',
    description: 'Sub releases lien rights up to the paid amount, IF and ONLY IF the payment actually clears.',
  },
  unconditional_partial: {
    short: 'Unconditional Partial',
    long:  'Unconditional Waiver and Release on Progress Payment',
    description: 'Sub confirms payment received and releases lien rights up to the paid amount. Use only after funds have cleared.',
  },
  conditional_final: {
    short: 'Conditional Final',
    long:  'Conditional Waiver and Release on Final Payment',
    description: 'Sub releases all remaining lien rights, IF and ONLY IF the final payment clears.',
  },
  unconditional_final: {
    short: 'Unconditional Final',
    long:  'Unconditional Waiver and Release on Final Payment',
    description: 'Sub confirms full payment received and releases all lien rights. Use only after final funds have cleared.',
  },
};

// ─── PDF ───────────────────────────────────────────────────────────

function buildLienWaiverHtml(
  waiver: LienWaiver,
  branding: CompanyBranding,
  projectName: string,
  projectAddress?: string,
): string {
  const meta = WAIVER_LABELS[waiver.waiverType];
  const isFinal = waiver.waiverType.includes('final');
  const isConditional = waiver.waiverType.includes('conditional');

  const conditionalLanguage = isConditional ? `
    This release is CONDITIONAL upon the actual receipt by the undersigned of the payment amount stated above.
    If the payment is dishonored, withdrawn, or otherwise not actually received, this release is void.
  ` : '';

  const unconditionalLanguage = !isConditional ? `
    The undersigned has been paid in full for all labor, services, equipment, or material furnished
    through the Through Date stated above.
  ` : '';

  const finalLanguage = isFinal ? `
    This is a FINAL release. Upon receipt of the final payment stated above (or, in the case of a
    conditional release, upon clearance of that final payment), the undersigned waives and releases
    any and all mechanic's lien, stop notice, or bond claim rights on the property described above
    arising from labor, services, equipment, or materials furnished by the undersigned.
  ` : `
    This is a PROGRESS payment release. The undersigned waives and releases mechanic's lien, stop
    notice, and bond claim rights only with respect to the payment amount stated above and through
    the Through Date stated above, and reserves all other rights as to amounts not yet paid.
  `;

  const sigBlock = waiver.subSignature ? `
    <div style="margin-top:36px;padding:20px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};border-radius:12px">
      <div style="font-size:10px;font-weight:800;letter-spacing:1px;color:${PDF_PALETTE.textMuted};text-transform:uppercase;margin-bottom:6px">Signed by Subcontractor</div>
      <div style="font-family:'Fraunces',Georgia,serif;font-size:22px;font-weight:700;font-style:italic;color:${PDF_PALETTE.ink};margin-bottom:4px">${escHtml(waiver.subSignature.name)}</div>
      <div style="font-size:11px;color:${PDF_PALETTE.textMuted}">Signed ${fmtDate(waiver.subSignature.signedAt)} · ${escHtml(waiver.subName)}</div>
    </div>
  ` : `
    <div style="margin-top:36px;padding:20px;border:2px dashed ${PDF_PALETTE.bone};border-radius:12px;text-align:center">
      <div style="font-size:11px;color:${PDF_PALETTE.textMuted};font-style:italic">Awaiting subcontractor signature</div>
      <div style="margin-top:24px;height:1.5px;background:${PDF_PALETTE.ink2};max-width:280px;margin-inline:auto"></div>
      <div style="font-size:10px;color:${PDF_PALETTE.textMuted};margin-top:6px">Subcontractor signature</div>
    </div>
  `;

  const bodyHtml = `
    ${pdfHeader(branding)}
    <div style="text-align:center;margin:24px 0 28px">
      <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:${PDF_PALETTE.amber};text-transform:uppercase;margin-bottom:6px">Lien Waiver &amp; Release</div>
      <div style="font-family:'Fraunces',Georgia,serif;font-size:26px;font-weight:700;letter-spacing:-0.5px;color:${PDF_PALETTE.ink};line-height:1.2">${escHtml(meta.long)}</div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      <tr>
        <td style="padding:10px 14px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:10px;font-weight:800;letter-spacing:0.6px;color:${PDF_PALETTE.textMuted};text-transform:uppercase;width:36%">Project</td>
        <td style="padding:10px 14px;border:1px solid ${PDF_PALETTE.bone};font-size:13px;color:${PDF_PALETTE.text}">${escHtml(projectName)}</td>
      </tr>
      ${projectAddress ? `
      <tr>
        <td style="padding:10px 14px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:10px;font-weight:800;letter-spacing:0.6px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Property Address</td>
        <td style="padding:10px 14px;border:1px solid ${PDF_PALETTE.bone};font-size:13px;color:${PDF_PALETTE.text}">${escHtml(projectAddress)}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:10px 14px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:10px;font-weight:800;letter-spacing:0.6px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Subcontractor</td>
        <td style="padding:10px 14px;border:1px solid ${PDF_PALETTE.bone};font-size:13px;color:${PDF_PALETTE.text}">${escHtml(waiver.subName)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:10px;font-weight:800;letter-spacing:0.6px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Through Date</td>
        <td style="padding:10px 14px;border:1px solid ${PDF_PALETTE.bone};font-size:13px;color:${PDF_PALETTE.text}">${fmtDate(waiver.throughDate)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background:${PDF_PALETTE.cream2};border:1px solid ${PDF_PALETTE.bone};font-size:10px;font-weight:800;letter-spacing:0.6px;color:${PDF_PALETTE.textMuted};text-transform:uppercase">Payment Amount</td>
        <td style="padding:10px 14px;border:1px solid ${PDF_PALETTE.bone};font-size:18px;color:${PDF_PALETTE.ink};font-weight:800">${fmtMoney(waiver.paidAmount)}</td>
      </tr>
    </table>

    <div style="font-size:13px;line-height:1.7;color:${PDF_PALETTE.text};margin-bottom:16px">
      <p style="margin:0 0 12px"><strong>${escHtml(waiver.subName)}</strong> ("Subcontractor"), having furnished labor, services, equipment, or material to the project identified above, hereby acknowledges and agrees:</p>
      <p style="margin:0 0 12px">${conditionalLanguage}${unconditionalLanguage}</p>
      <p style="margin:0 0 12px">${finalLanguage}</p>
      <p style="margin:0">This waiver shall be governed by the laws of the state in which the property is located. Subcontractor warrants that all suppliers, employees, and lower-tier subcontractors have been paid for the amounts covered by this release, or will be paid from the proceeds of the payment that triggers this release.</p>
    </div>

    ${sigBlock}

    <div style="margin-top:28px;padding:14px 16px;background:${PDF_PALETTE.amberTint};border:1px solid ${PDF_PALETTE.amber}40;border-radius:10px;font-size:11px;color:${PDF_PALETTE.text};line-height:1.6">
      <strong>Important.</strong> This is a generic 4-type waiver suitable for use in approximately 38 US states. <strong>California, Texas, Florida, Georgia, and Arizona</strong> require specific statutory form language; using this generic form in those states may render the waiver void or unenforceable. Consult an attorney licensed in your state.
    </div>

    ${pdfFooter(branding, undefined, 'Generated by MAGE ID. Not legal advice; consult an attorney for state-specific lien waiver requirements.')}
  `;

  return pdfShell({
    bodyHtml, branding,
    title: `${meta.short} Lien Waiver — ${projectName}`,
    pageMargin: '36px 40px',
  });
}

export async function shareLienWaiverPDF(
  waiver: LienWaiver,
  branding: CompanyBranding,
  projectName: string,
  projectAddress?: string,
): Promise<void> {
  const html = buildLienWaiverHtml(waiver, branding, projectName, projectAddress);
  const title = `${WAIVER_LABELS[waiver.waiverType].short} Lien Waiver — ${projectName}`;
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
