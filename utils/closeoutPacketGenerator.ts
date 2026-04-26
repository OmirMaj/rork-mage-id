import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type {
  Project, CompanyBranding, ChangeOrder, Invoice, DailyFieldReport, PunchItem, Warranty, ProjectPhoto,
} from '@/types';

function escapeHtml(raw: string | number | undefined | null): string {
  if (raw === undefined || raw === null) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

interface CloseoutPacketData {
  project: Project;
  branding: CompanyBranding;
  changeOrders: ChangeOrder[];
  invoices: Invoice[];
  dailyReports: DailyFieldReport[];
  punchItems: PunchItem[];
  warranties: Warranty[];
  /** Caller passes the full photo set; generator picks before/after pairs to embed. */
  photos?: ProjectPhoto[];
  /** Legacy field — if `photos` is omitted we still show a count. */
  photoCount?: number;
}

// Pick representative before/after photo pairs.
//
// Strategy:
// 1. If any photos are explicitly tagged 'before' / 'after', honor that — most
//    deliberate, least surprising.
// 2. Otherwise fall back to chronology: earliest 3 = before, latest 3 = after.
//    This is what 90% of supers actually want; they take photos before
//    starting and at handoff and never bother tagging.
//
// We cap at 3 of each so the PDF stays a sane size — embedded JPEGs in HTML
// blow up file size fast, and Print.printToFileAsync's webview can OOM on
// very large image docs (especially Android low-end).
function selectBeforeAfterPhotos(photos: ProjectPhoto[]): { before: ProjectPhoto[]; after: ProjectPhoto[] } {
  if (!photos || photos.length === 0) return { before: [], after: [] };
  const tagged = {
    before: photos.filter(p => p.tag?.toLowerCase() === 'before'),
    after: photos.filter(p => p.tag?.toLowerCase() === 'after'),
  };
  if (tagged.before.length > 0 || tagged.after.length > 0) {
    return {
      before: tagged.before.slice(0, 3),
      after: tagged.after.slice(0, 3),
    };
  }
  // Chronological fallback. Sort once, take from each end.
  const sorted = [...photos].sort((a, b) => {
    const ta = new Date(a.timestamp || a.createdAt).getTime();
    const tb = new Date(b.timestamp || b.createdAt).getTime();
    return ta - tb;
  });
  if (sorted.length === 1) return { before: sorted, after: [] };
  if (sorted.length <= 3) return { before: [sorted[0]], after: [sorted[sorted.length - 1]] };
  return {
    before: sorted.slice(0, Math.min(3, Math.floor(sorted.length / 2))),
    after: sorted.slice(-Math.min(3, Math.floor(sorted.length / 2))),
  };
}

function buildCloseoutHtml(data: CloseoutPacketData): string {
  const { project, branding, changeOrders, invoices, dailyReports, punchItems, warranties } = data;

  const approvedCOs = changeOrders.filter(co => co.status === 'approved');
  const totalCOValue = approvedCOs.reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);

  const totalInvoiced = invoices.reduce((s, i) => s + (i.totalDue ?? 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + (i.amountPaid ?? 0), 0);
  const totalRetentionHeld = invoices.reduce((s, i) => s + (i.retentionAmount ?? 0), 0);
  const totalRetentionReleased = invoices.reduce((s, i) => s + (i.retentionReleased ?? 0), 0);
  const retentionPending = Math.max(0, totalRetentionHeld - totalRetentionReleased);

  const openPunch = punchItems.filter(p => p.status !== 'closed');
  const closedPunch = punchItems.filter(p => p.status === 'closed');
  const punchCompletion = punchItems.length > 0 ? Math.round((closedPunch.length / punchItems.length) * 100) : 100;

  const activeWarranties = warranties.filter(w => w.status === 'active' || w.status === 'expiring_soon');

  const baseEstimate = project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0;
  const finalContractValue = baseEstimate + totalCOValue;

  const company = branding.companyName || 'Contractor';
  const logoHtml = branding.logoUri ? `<img src="${escapeHtml(branding.logoUri)}" style="max-height: 60px; margin-bottom: 8px;" />` : '';

  const coveragePageHtml = `
    <section class="cover">
      ${logoHtml}
      <h1>Project Closeout Packet</h1>
      <h2>${escapeHtml(project.name)}</h2>
      <p class="sub">${escapeHtml(project.location)}</p>
      <div class="cover-meta">
        <div><span class="label">Prepared By</span><span class="value">${escapeHtml(company)}</span></div>
        <div><span class="label">License #</span><span class="value">${escapeHtml(branding.licenseNumber) || '—'}</span></div>
        <div><span class="label">Generated</span><span class="value">${formatDate(new Date().toISOString())}</span></div>
        ${project.closedAt ? `<div><span class="label">Closed</span><span class="value">${formatDate(project.closedAt)}</span></div>` : ''}
        <div><span class="label">Status</span><span class="value status-${project.status}">${escapeHtml(project.status.replace(/_/g, ' '))}</span></div>
      </div>
    </section>
  `;

  const financialsHtml = `
    <section>
      <h3>Financial Summary</h3>
      <table class="summary">
        <tr><td>Original Contract</td><td class="num">${formatMoney(baseEstimate)}</td></tr>
        <tr><td>Approved Change Orders (${approvedCOs.length})</td><td class="num">${totalCOValue >= 0 ? '+' : ''}${formatMoney(totalCOValue)}</td></tr>
        <tr class="total"><td>Final Contract Value</td><td class="num">${formatMoney(finalContractValue)}</td></tr>
        <tr><td>Total Invoiced (${invoices.length})</td><td class="num">${formatMoney(totalInvoiced)}</td></tr>
        <tr><td>Total Paid</td><td class="num">${formatMoney(totalPaid)}</td></tr>
        ${totalRetentionHeld > 0 ? `
          <tr><td>Retention Held</td><td class="num warn">${formatMoney(totalRetentionHeld)}</td></tr>
          <tr><td>Retention Released</td><td class="num ok">${formatMoney(totalRetentionReleased)}</td></tr>
          <tr><td>Retention Pending Release</td><td class="num ${retentionPending > 0 ? 'warn' : 'ok'}">${formatMoney(retentionPending)}</td></tr>
        ` : ''}
      </table>
    </section>
  `;

  const coSectionHtml = approvedCOs.length > 0 ? `
    <section>
      <h3>Approved Change Orders</h3>
      <table class="list">
        <thead><tr><th>CO #</th><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${approvedCOs.map(co => `
            <tr>
              <td>${escapeHtml(co.number)}</td>
              <td>${formatDate(co.date || co.createdAt)}</td>
              <td>${escapeHtml(co.reason || co.description || '—')}</td>
              <td class="num">${formatMoney(co.changeAmount ?? 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  ` : '';

  const invoicesSectionHtml = invoices.length > 0 ? `
    <section>
      <h3>Invoice Register</h3>
      <table class="list">
        <thead><tr><th>#</th><th>Issued</th><th>Type</th><th>Status</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Retention</th></tr></thead>
        <tbody>
          ${invoices.map(inv => `
            <tr>
              <td>${inv.number}</td>
              <td>${formatDate(inv.issueDate)}</td>
              <td>${escapeHtml(inv.type)}${inv.progressPercent ? ` (${inv.progressPercent}%)` : ''}</td>
              <td><span class="pill pill-${inv.status}">${escapeHtml(inv.status.replace(/_/g, ' '))}</span></td>
              <td class="num">${formatMoney(inv.totalDue)}</td>
              <td class="num">${formatMoney(inv.amountPaid ?? 0)}</td>
              <td class="num">${inv.retentionAmount ? formatMoney(inv.retentionAmount) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  ` : '';

  const punchSectionHtml = punchItems.length > 0 ? `
    <section>
      <h3>Punch List — ${punchCompletion}% Complete</h3>
      <p class="note">${closedPunch.length} of ${punchItems.length} items verified closed.</p>
      ${openPunch.length > 0 ? `
        <h4>Outstanding Items (${openPunch.length})</h4>
        <table class="list">
          <thead><tr><th>Item</th><th>Location</th><th>Assigned To</th><th>Status</th></tr></thead>
          <tbody>
            ${openPunch.map(p => `
              <tr>
                <td>${escapeHtml(p.description)}</td>
                <td>${escapeHtml(p.location || '—')}</td>
                <td>${escapeHtml(p.assignedSub || '—')}</td>
                <td>${escapeHtml(String(p.status).replace(/_/g, ' '))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="ok-note">All punch items verified closed.</p>'}
    </section>
  ` : '';

  const warrantySectionHtml = activeWarranties.length > 0 ? `
    <section>
      <h3>Active Warranties</h3>
      <table class="list">
        <thead><tr><th>Item</th><th>Provider</th><th>Start</th><th>End</th><th>Coverage</th></tr></thead>
        <tbody>
          ${activeWarranties.map(w => `
            <tr>
              <td>${escapeHtml(w.title)}</td>
              <td>${escapeHtml(w.provider)}</td>
              <td>${formatDate(w.startDate)}</td>
              <td>${formatDate(w.endDate)}</td>
              <td>${escapeHtml(w.coverageDetails || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  ` : '';

  const beforeAfter = selectBeforeAfterPhotos(data.photos ?? []);
  const totalPhotoCount = data.photos?.length ?? data.photoCount ?? 0;

  const photoCellHtml = (p: ProjectPhoto, kind: 'before' | 'after') => {
    const meta: string[] = [];
    if (p.location) meta.push(escapeHtml(p.location));
    if (p.locationLabel && !p.location) meta.push(escapeHtml(p.locationLabel));
    if (p.timestamp) meta.push(formatDate(p.timestamp));
    return `
      <div class="photo-cell">
        <div class="photo-frame">
          <img src="${escapeHtml(p.uri)}" alt="${kind} photo" />
          <span class="photo-tag photo-tag-${kind}">${kind === 'before' ? 'Before' : 'After'}</span>
        </div>
        ${meta.length > 0 ? `<div class="photo-caption">${meta.join(' &middot; ')}</div>` : ''}
      </div>
    `;
  };

  const photosSectionHtml = (beforeAfter.before.length > 0 || beforeAfter.after.length > 0) ? `
    <section class="photos-section">
      <h3>Project Documentation Photos</h3>
      <p class="note">Before / after pairs from ${totalPhotoCount} total project photo${totalPhotoCount === 1 ? '' : 's'} on file. Photos selected ${data.photos?.some(p => p.tag?.toLowerCase() === 'before' || p.tag?.toLowerCase() === 'after') ? 'by tag' : 'chronologically'}.</p>
      ${beforeAfter.before.length > 0 ? `
        <div class="photo-row">
          ${beforeAfter.before.map(p => photoCellHtml(p, 'before')).join('')}
        </div>
      ` : ''}
      ${beforeAfter.after.length > 0 ? `
        <div class="photo-row">
          ${beforeAfter.after.map(p => photoCellHtml(p, 'after')).join('')}
        </div>
      ` : ''}
    </section>
  ` : '';

  const dfrCount = dailyReports.length;
  const projectInfoHtml = `
    <section>
      <h3>Project Information</h3>
      <table class="info">
        <tr><td>Project Name</td><td>${escapeHtml(project.name)}</td></tr>
        <tr><td>Type</td><td>${escapeHtml(project.type)}</td></tr>
        <tr><td>Location</td><td>${escapeHtml(project.location)}</td></tr>
        <tr><td>Square Footage</td><td>${project.squareFootage ? project.squareFootage.toLocaleString() + ' sq ft' : '—'}</td></tr>
        <tr><td>Quality</td><td>${escapeHtml(project.quality)}</td></tr>
        <tr><td>Started</td><td>${formatDate(project.createdAt)}</td></tr>
        ${project.closedAt ? `<tr><td>Closed</td><td>${formatDate(project.closedAt)}</td></tr>` : ''}
        <tr><td>Daily Reports on File</td><td>${dfrCount}</td></tr>
        ${totalPhotoCount > 0 ? `<tr><td>Photos Captured</td><td>${totalPhotoCount}</td></tr>` : ''}
      </table>
    </section>
  `;

  const signoffHtml = `
    <section class="signoff">
      <h3>Acceptance & Sign-Off</h3>
      <div class="sign-grid">
        <div class="sign-box">
          <div class="sign-line"></div>
          <div class="sign-label">Owner / Client — Date</div>
        </div>
        <div class="sign-box">
          <div class="sign-line"></div>
          <div class="sign-label">${escapeHtml(company)} — Date</div>
        </div>
      </div>
      <p class="note">By signing above, parties acknowledge the project has reached substantial completion and all closeout deliverables (warranties, O&M manuals, as-built documentation, punch list clearance) have been furnished.</p>
    </section>
  `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Closeout Packet — ${escapeHtml(project.name)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@500;700;800&display=swap" rel="stylesheet" />
  <style>
    @page { size: letter; margin: 0.75in; }
    body { font-family: -apple-system, 'SF Pro Text', Arial, sans-serif; color: #0B0D10; font-size: 12px; line-height: 1.55; background: #FFFFFF; }
    .cover { text-align: center; padding: 56px 0 40px 0; border-bottom: 1px solid #E8DFCD; margin-bottom: 32px; }
    .cover h1 { font-family: 'Fraunces', Georgia, serif; font-size: 14px; letter-spacing: 1.6px; margin: 0 0 12px 0; color: #FF6A1A; font-weight: 700; text-transform: uppercase; }
    .cover h1::before { content: ''; display: inline-block; width: 28px; height: 2px; background: #FF6A1A; vertical-align: middle; margin-right: 10px; }
    .cover h2 { font-family: 'Fraunces', Georgia, serif; font-size: 38px; margin: 0 0 8px 0; letter-spacing: -0.022em; line-height: 1.1; color: #0B0D10; font-weight: 700; }
    .cover .sub { color: #4A5159; margin: 0 0 28px 0; font-size: 14px; }
    .cover-meta { display: flex; justify-content: center; flex-wrap: wrap; gap: 22px 32px; }
    .cover-meta > div { text-align: left; min-width: 140px; }
    .cover-meta .label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #8B9099; font-weight: 700; }
    .cover-meta .value { font-size: 13px; font-weight: 700; color: #0B0D10; margin-top: 2px; }
    section { margin-bottom: 28px; page-break-inside: avoid; }
    section h3 { font-family: 'Fraunces', Georgia, serif; font-size: 18px; margin: 0 0 12px 0; color: #0B0D10; border-bottom: 1px solid #F1EAD9; padding-bottom: 8px; font-weight: 700; letter-spacing: -0.01em; }
    section h4 { font-size: 13px; margin: 14px 0 8px 0; color: #4A5159; font-weight: 700; }
    .note { color: #8B9099; font-size: 11px; margin: 4px 0 10px 0; }
    .ok-note { color: #1E8E4A; font-size: 13px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    table th, table td { padding: 9px 10px; text-align: left; font-size: 11.5px; border-bottom: 1px solid #F1EAD9; }
    table th { background: #FAF7F0; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #8B9099; border-bottom: 2px solid #E8DFCD; }
    table .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
    table.summary tr.total td { font-family: 'Fraunces', Georgia, serif; font-weight: 700; font-size: 16px; border-top: 1.5px solid #0B0D10; padding-top: 14px; color: #FF6A1A; letter-spacing: -0.012em; }
    table.info td:first-child { width: 40%; color: #4A5159; font-weight: 500; }
    .num.warn { color: #C26A00; }
    .num.ok { color: #1E8E4A; }
    .pill { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; background: #F1EAD9; color: #4A5159; }
    .pill-paid { background: #E8F5ED; color: #1E8E4A; }
    .pill-sent { background: #FFF1E6; color: #E5570F; }
    .pill-overdue { background: #FBEAE7; color: #C0392B; }
    .signoff { margin-top: 36px; border-top: 1.5px solid #0B0D10; padding-top: 24px; }
    .sign-grid { display: flex; gap: 32px; margin: 28px 0 12px 0; }
    .sign-box { flex: 1; }
    .sign-line { border-bottom: 1px solid #0B0D10; height: 44px; margin-bottom: 6px; }
    .sign-label { font-size: 10px; color: #8B9099; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
    .disclaimer { margin-top: 24px; padding: 14px 16px; border-radius: 12px; border: 1px solid #F1EAD9; background: #FAF7F0; font-size: 9.5px; color: #4A5159; line-height: 1.55; font-style: italic; }
    .disclaimer-title { font-style: normal; font-weight: 700; color: #0B0D10; margin-bottom: 4px; font-size: 9.5px; letter-spacing: 0.4px; text-transform: uppercase; }
    .footer { text-align: center; color: #8B9099; font-size: 10px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #E8DFCD; }
    .photos-section { page-break-before: auto; }
    .photo-row { display: flex; gap: 10px; margin: 12px 0; flex-wrap: wrap; }
    .photo-cell { flex: 1 1 0; min-width: 30%; max-width: 33%; }
    .photo-frame { position: relative; width: 100%; padding-top: 75%; background: #FAF7F0; border-radius: 8px; overflow: hidden; border: 1px solid #E8DFCD; }
    .photo-frame img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .photo-tag { position: absolute; top: 6px; left: 6px; padding: 3px 8px; border-radius: 999px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #fff; }
    .photo-tag-before { background: #C26A00; }
    .photo-tag-after { background: #1E8E4A; }
    .photo-caption { font-size: 10px; color: #8B9099; margin-top: 6px; line-height: 1.4; }
  </style>
</head>
<body>
  ${coveragePageHtml}
  ${projectInfoHtml}
  ${financialsHtml}
  ${coSectionHtml}
  ${invoicesSectionHtml}
  ${punchSectionHtml}
  ${warrantySectionHtml}
  ${photosSectionHtml}
  ${signoffHtml}
  <div class="disclaimer">
    <div class="disclaimer-title">Important — please read</div>
    This handoff packet is provided for the owner&apos;s reference. Warranty terms, product specifications, and maintenance schedules originate with the manufacturer or installer named for each item. The contractor disclaims any warranty beyond what is stated in the original construction contract or in the items themselves. Verify all amounts and dates against your own records before relying on them.
  </div>
  <div class="footer">${escapeHtml(company)} &middot; Built with <span style="color:#0B0D10;font-weight:700">MAGE ID</span> &middot; mageid.app &middot; ${formatDate(new Date().toISOString())}</div>
</body>
</html>`;
}

export async function generateCloseoutPacketUri(data: CloseoutPacketData): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildCloseoutHtml(data);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[Closeout] Packet PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[Closeout] Error generating packet:', error);
    return null;
  }
}

export async function generateAndShareCloseoutPacket(data: CloseoutPacketData): Promise<boolean> {
  const html = buildCloseoutHtml(data);

  if (Platform.OS === 'web') {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
      newWindow.print();
    }
    return true;
  }

  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Closeout Packet — ${data.project.name}`,
        UTI: 'com.adobe.pdf',
      });
    }
    return true;
  } catch (error) {
    console.error('[Closeout] Error sharing packet:', error);
    return false;
  }
}
