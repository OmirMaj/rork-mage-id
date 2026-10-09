// utils/proofPack/html.ts — the Pay Period Record, printed.
//
// PURE: takes the record (utils/proofPack/core), the copy table for one
// language (utils/proofPack/docCopy), the fingerprint as it stands, and the
// photo image sources the I/O layer resolved. Returns the HTML the app's
// ordinary PDF path prints (utils/pdfDesign pdfShell, expo-print). No storage,
// no network, no clock, no model.
//
// Rules this file holds (each pinned by scripts/validate-proof-pack.ts):
//   - The first page carries the two "what this is and is not" sentences.
//   - The Notice to Recipients prints as a block on the first page AND in the
//     footer of every page. The footer is the <tfoot> of one table that frames
//     the whole document: a table footer group repeats at the foot of every
//     printed page in normal flow (utils/aiaBilling.ts PRINT NOTES measured why
//     a position:fixed footer cannot be used: it overprints the content).
//   - EVERY item prints its class label. There is no code path that prints
//     an item without one (`strengthPill` is in every row builder).
//   - Money is printed from the record's integer cents, never recomputed, and
//     a figure that is not on file prints "Not on file", never $0.00.
//   - A gap prints as a gap: an empty section says it is empty, a source that
//     was not read says "not checked", and what was left out is counted UNDER
//     EACH CLASS in the same strip as what was included, and by kind.
//   - A change order prints the amount in its signature record first, and says
//     so in words when the change order now reads a different amount.
//   - The full fingerprint prints legibly, in groups, with what it does not show.
//   - User-entered text is escaped. Nothing is summarised or reworded.
import type { CompanyBranding } from '@/types';
import { formatCalendarDay } from '@/utils/calendarDate';
import {
  PDF_FONT_DISPLAY, PDF_PALETTE, escHtml, pdfFooter, pdfHeader, pdfSectionHeader, pdfShell, pdfTitle,
} from '@/utils/pdfDesign';
import {
  PROOF_STRENGTHS,
  type ProofChangeOrderItem, type ProofDailyReportItem, type ProofFieldTicketItem, type ProofInspectionItem,
  type ProofItem, type ProofLienWaiverItem, type ProofPack, type ProofPhotoItem, type ProofPunchItem,
  type ProofItemKind, type ProofPunchSealItem, type ProofReason, type ProofStrength,
  PROOF_ITEM_KINDS,
} from '@/utils/proofPack/core';
import { proofDocCopy, type ProofDocCopy, type ProofDocLang } from '@/utils/proofPack/docCopy';

/** The most photos one document prints as images; the rest are listed. */
export const PROOF_PACK_MAX_PHOTOS = 12;

export interface ProofPackPrintFingerprint {
  hash: string;
  code: string;
  /** The server's time for the fingerprint record, or null when none is on file. */
  serverCreatedAt: string | null;
}

export interface ProofPackHtmlOptions {
  branding: CompanyBranding;
  lang: ProofDocLang;
  fingerprint: ProofPackPrintFingerprint;
  /** Image source per photo item key. Missing or null prints the stated gap. */
  photoSrc?: Record<string, string | null>;
}

const P = PDF_PALETTE;

/** Whole cents as money, always two decimals, "-" in front of a negative. */
export function proofMoney(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}$${whole}.${frac}`;
}

/** Money, or the "Not on file" words when the saved document holds no such figure. */
export function proofMoneyOrGap(cents: number | null | undefined, c: ProofDocCopy): string {
  return typeof cents === 'number' ? proofMoney(cents) : c.notOnFile;
}

/** The 64 characters in eight groups of eight, so two people can compare them by eye. */
export function fingerprintGroups(hash: string): string {
  return (hash ?? '').replace(/(.{8})(?=.)/g, '$1 ');
}

function dayText(day: string | null | undefined, c: ProofDocCopy, lang: ProofDocLang): string {
  return day ? formatCalendarDay(day, { month: 'short', day: 'numeric', year: 'numeric' }, lang) : c.dayUnknown;
}

/** An instant as "Oct 3, 2026, 14:05 UTC": one unambiguous form for a reader in any time zone. */
export function proofInstant(iso: string | null | undefined, c: ProofDocCopy, lang: ProofDocLang): string {
  if (!iso) return c.notOnFile;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${formatCalendarDay(day, { month: 'short', day: 'numeric', year: 'numeric' }, lang)}, ${hm} UTC`;
}

const PILL: Record<ProofStrength, { bg: string; fg: string; border: string }> = {
  sealed: { bg: P.brand, fg: '#FFFFFF', border: P.brand },
  signed: { bg: P.brandTint, fg: P.brandDark, border: P.brandTint },
  locked: { bg: P.surface, fg: P.brandDark, border: P.brand },
  recorded: { bg: P.ground2, fg: P.text2, border: P.hairline },
  stated: { bg: P.surface, fg: P.text2, border: P.hairline },
};

export function strengthPill(s: ProofStrength, c: ProofDocCopy): string {
  const k = PILL[s];
  return `<span data-strength="${s}" style="display:inline-block;padding:2px 9px;border-radius:999px;border:1px solid ${k.border};background:${k.bg};color:${k.fg};font-size:9.5px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;white-space:nowrap">${escHtml(c.strengthLabel[s])}</span>`;
}

const muted = (s: string): string => `<p style="margin:0 0 10px;font-size:10.5px;color:${P.text2}">${escHtml(s)}</p>`;
const small = (s: string): string => `<div style="font-size:10px;color:${P.text2};margin-top:2px">${escHtml(s)}</div>`;
const gap = (s: string): string => `<p style="margin:0 0 12px;padding:10px 12px;border:1px dashed ${P.hairline};border-radius:6px;font-size:11px;color:${P.text2}">${escHtml(s)}</p>`;

/** One evidence row: label on the left, the facts on the right, the reason underneath. */
function row(strength: ProofStrength, reason: ProofReason, c: ProofDocCopy, headHtml: string, bodyHtml: string): string {
  return `<div class="no-break" data-item style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid ${P.hairline2}">
  <div style="width:86px;flex:none;padding-top:1px">${strengthPill(strength, c)}</div>
  <div style="flex:1;min-width:0">
    <div style="font-size:12px;font-weight:700;color:${P.text}">${headHtml}</div>
    ${bodyHtml}
    <div style="font-size:9.5px;color:${P.textMuted};margin-top:4px">${escHtml(c.reason[reason])}</div>
  </div>
</div>`;
}

function reportRow(i: ProofDailyReportItem, c: ProofDocCopy, lang: ProofDocLang): string {
  const crew = i.crew.length
    ? small(c.crewLine(i.totalHeadcount, Math.round(i.totalHours * 10) / 10)
      + ' ' + i.crew.map((m) => `${m.trade || '?'}: ${m.headcount}`).join(', ') + '.')
    : small(c.crewNone);
  const w = i.weather;
  const weatherFacts = [w.temperature, w.conditions, w.wind].filter(Boolean).join(', ');
  const weather = small(
    (weatherFacts ? `${weatherFacts}. ` : '') + c.weatherSource[w.source]
    + (w.source === 'openweather' && w.readAt ? ` ${c.weatherReadAt(proofInstant(w.readAt, c, lang))}` : ''),
  );
  const block = (label: string, body: string) => body
    ? `<div style="margin-top:6px"><span style="font-size:9px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${P.textMuted}">${escHtml(label)}</span><div style="font-size:11px;color:${P.text};white-space:pre-wrap">${escHtml(body)}</div></div>`
    : '';
  const trace = small(
    (i.firstSavedAt ? c.firstSaved(proofInstant(i.firstSavedAt, c, lang)) + ' ' : '')
    + (i.lastChangedAt ? c.lastChanged(proofInstant(i.lastChangedAt, c, lang)) : '')
    + (i.changedAfterItsDay ? ` ${c.changedLater}` : ''),
  );
  return row(i.strength, i.reason, c,
    `${escHtml(dayText(i.day, c, lang))} <span style="font-weight:500;color:${P.text2}">(${escHtml(c.reportStatus[i.status])})</span>`,
    crew + weather
      + block(c.workPerformedLabel, i.workPerformed)
      + block(c.issuesLabel, i.issuesAndDelays)
      + block(c.materialsLabel, i.materialsDelivered.join(', '))
      + (i.photoCount > 0 ? small(c.reportPhotos(i.photoCount)) : '')
      + trace);
}

function photoStamp(i: ProofPhotoItem, c: ProofDocCopy, lang: ProofDocLang): string {
  // Coordinates print only when the record carries them (the contractor's switch).
  let place = c.photoPlace[i.placeSource];
  if (i.placeSource === 'phone_gps' && i.latitude !== null && i.longitude !== null) {
    place += `: ${i.latitude.toFixed(5)}, ${i.longitude.toFixed(5)}`;
    if (i.accuracyMeters !== null) place += ` (${c.photoAccuracy(Math.round(i.accuracyMeters))})`;
  } else if (i.placeSource === 'typed' && i.placeLabel) {
    place += `: ${i.placeLabel}`;
  }
  return small(c.photoTime(proofInstant(i.takenAt, c, lang))) + small(place + '.')
    + (i.taskName ? small(i.taskName) : '');
}

function photoTile(i: ProofPhotoItem, src: string | null | undefined, c: ProofDocCopy, lang: ProofDocLang): string {
  const img = src
    ? `<img src="${escHtml(src)}" alt="" style="width:100%;height:118px;object-fit:cover;border-radius:6px;display:block" />`
    : `<div style="width:100%;height:118px;border:1px dashed ${P.hairline};border-radius:6px;display:flex;align-items:center;justify-content:center;padding:8px;text-align:center;font-size:10px;color:${P.text2}">${escHtml(i.uploaded ? c.photoNotShown : c.photoNotUploaded)}</div>`;
  return `<div class="no-break" data-item style="width:31.5%;margin-bottom:12px">
  ${img}
  <div style="margin-top:5px">${strengthPill(i.strength, c)}</div>
  ${photoStamp(i, c, lang)}
</div>`;
}

function changeOrderRow(i: ProofChangeOrderItem, c: ProofDocCopy, lang: ProofDocLang): string {
  // The amount that prints first is the one in the signature record, when the
  // row carries one. The contractor's current copy is named as such.
  const signed = i.signedAmountCents;
  const headCents = signed !== null ? signed : i.changeAmountCents;
  const when = i.signedAtServer ? proofInstant(i.signedAtServer, c, lang) : dayText(i.approvedDay ?? i.day, c, lang);
  const amountLines = signed !== null
    ? small((i.strength === 'signed' ? c.coSignedFor(proofMoney(signed), when) : c.coRecordStates(proofMoney(signed), when))
      + (i.amountDiffers ? ` ${c.coNowReads(proofMoney(i.changeAmountCents))}` : ''))
      + (i.descriptionDiffers ? small(c.coDescriptionDiffers) : '')
    : small(c.coCurrentAmount(proofMoney(i.changeAmountCents)));
  return row(i.strength, i.reason, c,
    `${escHtml(c.changeOrderName(i.number))} <span class="num" data-co-amount="${headCents}" style="font-weight:700">${proofMoney(headCents)}</span>`,
    (i.description ? `<div style="font-size:11px;color:${P.text}">${escHtml(i.description)}</div>` : '')
      + `<div data-co-terms${i.amountDiffers ? ' data-co-differs' : ''}>${amountLines}</div>`
      + (i.signedAtServer ? '' : small(dayText(i.approvedDay ?? i.day, c, lang)))
      + (i.approvedBy ? small(c.signedBy(i.approvedBy)) : '')
      + (i.signedAtServer ? small(i.serverSetTime ? c.signatureRecordTime(proofInstant(i.signedAtServer, c, lang)) : c.signatureRecordDate(proofInstant(i.signedAtServer, c, lang))) : '')
      + (i.recordHashPrefix ? small(c.recordFingerprintStarts(i.recordHashPrefix)) : ''));
}

function punchSealRow(i: ProofPunchSealItem, c: ProofDocCopy, lang: ProofDocLang): string {
  return row(i.strength, i.reason, c,
    escHtml(c.kindLabel.punch_seal),
    small(c.punchSealLine(i.itemCount, proofInstant(i.sealedAt, c, lang)))
      + small(c.punchSealSigner(i.signerName, i.signerRole))
      + `<div class="num" style="font-size:9.5px;color:${P.text2};margin-top:2px;word-break:break-all">${escHtml(c.punchSealFingerprint(i.manifestHash))}</div>`);
}

function punchItemRow(i: ProofPunchItem, c: ProofDocCopy, lang: ProofDocLang): string {
  return row(i.strength, i.reason, c,
    escHtml(i.description || c.notOnFile),
    (i.location ? small(i.location) : '')
      + small((i.createdDay ? c.punchOpened(dayText(i.createdDay, c, lang)) + ' ' : '')
        + (i.closedDay ? c.punchClosed(dayText(i.closedDay, c, lang)) + ' ' : '')
        + (i.hasAfterPhoto ? c.punchAfterPhoto : '')));
}

function inspectionRow(i: ProofInspectionItem, c: ProofDocCopy, lang: ProofDocLang): string {
  const result = i.result === 'passed' ? c.inspectionResult.passed : c.inspectionResult.failed;
  return row(i.strength, i.reason, c,
    escHtml(c.inspectionLine(i.name || c.notOnFile, result)),
    small(dayText(i.day, c, lang)));
}

function ticketRow(i: ProofFieldTicketItem, c: ProofDocCopy, lang: ProofDocLang): string {
  return row(i.strength, i.reason, c,
    escHtml(c.ticketName(i.number)),
    (i.workDescription ? `<div style="font-size:11px;color:${P.text}">${escHtml(i.workDescription)}</div>` : '')
      + small(dayText(i.day, c, lang) + '. ' + c.ticketCrew(i.workerCount, Math.round(i.totalHours * 10) / 10))
      + small(c.ticketSigned(i.signerName || c.notOnFile, proofInstant(i.signedAt, c, lang))));
}

function waiverRow(i: ProofLienWaiverItem, c: ProofDocCopy, lang: ProofDocLang): string {
  return row(i.strength, i.reason, c,
    escHtml(i.subName || c.notOnFile),
    small(c.waiverThrough(dayText(i.throughDay, c, lang)) + ' ' + c.waiverAmount(proofMoney(i.paidAmountCents)))
      + (i.signerName ? small(c.signedBy(i.signerName)) : '')
      + (i.signedAt ? small(i.strength === 'signed' ? c.waiverSignedAtServer(proofInstant(i.signedAt, c, lang)) : c.waiverSignedAt(proofInstant(i.signedAt, c, lang))) : ''));
}

function itemLabel(i: ProofItem, c: ProofDocCopy, lang: ProofDocLang): string {
  switch (i.kind) {
    case 'daily_report': return `${c.kindLabel.daily_report}: ${dayText(i.day, c, lang)}`;
    case 'photo': return `${c.kindLabel.photo}: ${dayText(i.day, c, lang)}`;
    case 'change_order': return c.changeOrderName(i.number);
    case 'punch_item': return `${c.kindLabel.punch_item}: ${i.description}`;
    case 'punch_seal': return c.kindLabel.punch_seal;
    case 'inspection': return `${c.kindLabel.inspection}: ${i.name}`;
    case 'lien_waiver': return `${c.kindLabel.lien_waiver}: ${i.subName}`;
    case 'field_ticket': return c.ticketName(i.number);
    default: return '';
  }
}

function moneyTable(rows: { label: string; cents: number | null; strong?: boolean; summed?: boolean }[], c: ProofDocCopy): string {
  return `<table style="margin-bottom:10px">${rows.map((r) => `<tr>
  <td style="padding:6px 8px;border-bottom:1px solid ${P.hairline2};font-size:11.5px;${r.strong ? 'font-weight:700;' : ''}">${escHtml(r.label)}</td>
  <td class="num" ${r.cents === null ? 'data-money-gap' : `data-money="${r.cents}"`}${r.summed ? ' data-summed' : ''} style="padding:6px 8px;border-bottom:1px solid ${P.hairline2};font-size:11.5px;text-align:right;${r.strong ? 'font-weight:700;' : ''}">${escHtml(proofMoneyOrGap(r.cents, c))}</td>
</tr>`).join('')}</table>`;
}

/** The whole document. */
export function buildProofPackHtml(pack: ProofPack, opts: ProofPackHtmlOptions): string {
  const lang = opts.lang;
  const c = proofDocCopy(lang);
  const pay = pack.pay;
  const byKey = new Map(pack.items.map((i) => [i.key, i]));
  const of = <K extends ProofItem['kind']>(kind: K) => pack.items.filter((i): i is Extract<ProofItem, { kind: K }> => i.kind === kind);

  const payName = pay.kind === 'pay_app' ? c.payAppName(pay.applicationNumber) : c.invoiceName(pay.number);
  const periodText = pack.period.from
    ? c.periodRange(dayText(pack.period.from, c, lang), dayText(pack.period.to, c, lang))
    : c.periodOpen(dayText(pack.period.to, c, lang));

  // ── Page 1: what this is, what was billed, the counts ──
  // The company name that prints is the one inside the fingerprint.
  const branding: CompanyBranding = pack.company.name ? { ...opts.branding, companyName: pack.company.name } : opts.branding;
  let out = pdfHeader(branding);
  out += pdfTitle({
    eyebrow: c.eyebrowLabel,
    title: c.titleLabel,
    meta: [
      { label: c.projectLabel, value: pack.project.name || c.notOnFile },
      { label: c.locationLabel, value: pack.project.location || c.notOnFile },
      { label: c.periodLabel, value: periodText },
      { label: c.payDocumentLabel, value: payName },
      { label: c.checkCodeLabel, value: opts.fingerprint.code || c.notOnFile },
    ],
  });
  out += `<div data-what-this-is style="margin:14px 0 6px;padding:12px 14px;border-left:4px solid ${P.brand};background:${P.brandTint};font-size:12.5px;color:${P.text};font-family:${PDF_FONT_DISPLAY};font-weight:600">${escHtml(c.whatThisIs)} ${escHtml(c.whatThisIsNot)}</div>`;
  out += `<div class="no-break" data-notice="first-page" style="margin:10px 0 10px;padding:10px 14px;border:1.5px solid ${P.text};border-radius:6px">
  <div style="font-size:9.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${P.text}">${escHtml(c.noticeHeadingLabel)}</div>
  <div style="font-size:11.5px;color:${P.text};margin-top:3px">${escHtml(c.notice)}</div>
</div>`;
  out += muted(c.labelMeaning);
  out += muted(c.periodStart[pack.period.startSource]);

  out += pdfSectionHeader(c.billedHeadingLabel);
  out += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">${strengthPill(pay.strength, c)}<span style="font-size:12px;font-weight:700">${escHtml(payName)}</span></div>`;
  out += `<div data-pay-reason="${pay.reason}">${muted(c.reason[pay.reason])}</div>`;
  if (pay.kind === 'pay_app' && pay.strength === 'locked' && pay.lockedAt) {
    out += `<div data-lock-time>${muted(`${c.lockTime(proofInstant(pay.lockedAt, c, lang))} ${pay.periodFromLocked ? c.periodInLock : c.periodNotInLock}`)}</div>`;
  }
  out += `<div data-billed-source>${muted(pay.kind === 'pay_app' ? c.billedSourcePayApp : c.billedSourceInvoice)}</div>`;
  if (pay.kind === 'pay_app') {
    const r = c.payAppRows;
    out += moneyTable([
      { label: r.originalContractSum, cents: pay.originalContractSumCents },
      { label: r.netChangeByCO, cents: pay.netChangeByCOCents },
      { label: r.contractSumToDate, cents: pay.contractSumToDateCents },
      { label: r.workThisPeriod, cents: pay.workThisPeriodCents, strong: true, summed: true },
      { label: r.storedMaterial, cents: pay.storedMaterialCents, summed: true },
      { label: r.totalCompletedAndStored, cents: pay.totalCompletedAndStoredCents, strong: true },
      { label: r.retainage, cents: pay.totalRetainageCents },
      { label: r.totalEarnedLessRetainage, cents: pay.totalEarnedLessRetainageCents },
      { label: r.lessPreviousCertificates, cents: pay.lessPreviousCertificatesCents },
      { label: r.currentPaymentDue, cents: pay.currentPaymentDueCents, strong: true },
      { label: r.balanceToFinish, cents: pay.balanceToFinishCents },
    ], c);
    out += muted(c.payAppStyleNote);
  } else {
    const r = c.invoiceRows;
    out += moneyTable([
      { label: r.subtotal, cents: pay.subtotalCents },
      { label: r.tax, cents: pay.taxCents },
      { label: r.totalDue, cents: pay.totalDueCents, strong: true },
      { label: r.amountPaid, cents: pay.amountPaidCents },
      ...(pay.retentionCents !== 0 && pay.retentionCents !== null ? [{ label: r.retention, cents: pay.retentionCents }] : []),
    ], c);
    if (pay.progressPercent !== null) out += muted(`${r.progress}: ${pay.progressPercent}%`);
  }

  out += pdfSectionHeader(c.countsHeadingLabel);
  // Included and left out, side by side under each class: switching off every
  // weak record cannot make the strip look stronger without the count saying so.
  out += `<div data-counts style="display:flex;gap:8px;margin-bottom:10px">${PROOF_STRENGTHS.map((s) => `<div style="flex:1;border:1px solid ${P.hairline};border-radius:8px;padding:10px 8px;text-align:center;background:${P.surface}">
  <div class="num" data-count="${s}" style="font-family:${PDF_FONT_DISPLAY};font-size:24px;font-weight:700;color:${P.text}">${pack.counts[s]}</div>
  <div style="margin-top:4px">${strengthPill(s, c)}</div>
  <div class="num" data-left-out-class="${s}" data-n="${pack.leftOut.byStrength[s]}" style="margin-top:6px;font-size:10px;font-weight:700;color:${pack.leftOut.byStrength[s] > 0 ? P.warningInk : P.textMuted}">${escHtml(c.leftOutCellLabel(pack.leftOut.byStrength[s]))}</div>
</div>`).join('')}</div>`;
  out += `<p data-left-out="${pack.leftOut.total}" style="margin:0 0 4px;font-size:11.5px;font-weight:700;color:${P.text}">${escHtml(pack.leftOut.total > 0 ? c.leftOutLine(pack.leftOut.total) : c.nothingLeftOut)}</p>`;
  if (pack.leftOut.total > 0) {
    const kinds = PROOF_ITEM_KINDS.filter((k: ProofItemKind) => pack.leftOut.byKind[k] > 0).map((k) => `${c.kindLabel[k]} ${pack.leftOut.byKind[k]}`).join(', ');
    out += `<p data-left-out-kinds style="margin:0 0 10px;font-size:10.5px;color:${P.text2}">${escHtml(c.leftOutByKind(kinds))}</p>`;
  }
  out += `<table style="margin-bottom:8px">${PROOF_STRENGTHS.map((s) => `<tr><td style="width:96px;padding:5px 0;vertical-align:top">${strengthPill(s, c)}</td><td style="padding:5px 0;font-size:10.5px;color:${P.text2}">${escHtml(c.strengthRule[s])}</td></tr>`).join('')}</table>`;

  // ── Lines billed this period ──
  out += `<div style="page-break-before:always"></div>`;
  out += pdfSectionHeader(c.linesHeadingLabel);
  out += muted(pay.kind === 'pay_app' ? c.linesIntro : c.linesInvoiceIntro);
  const cols = c.lineColsLabel;
  const th = (label: string, right = false) => `<th style="text-align:${right ? 'right' : 'left'};font-size:9px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${P.textMuted};padding:8px 6px;border-bottom:2px solid ${P.hairline}">${escHtml(label)}</th>`;
  const td = `padding:8px 6px;border-bottom:1px solid ${P.hairline2};font-size:11px`;
  if (pay.kind === 'pay_app') {
    out += `<table style="margin-bottom:12px"><thead><tr>${th(cols.item)}${th(cols.description)}${th(cols.scheduled, true)}${th(cols.thisPeriod, true)}${th(cols.stored, true)}${th(cols.records)}</tr></thead><tbody>`;
    for (const l of pay.lines) {
      const attached = l.itemKeys.map((k) => byKey.get(k)).filter((i): i is ProofItem => !!i);
      const list = attached.length
        ? `<div style="font-size:10.5px;font-weight:700">${escHtml(c.attachedCount(attached.length))}</div>`
          + attached.slice(0, 6).map((i) => `<div style="margin-top:3px">${strengthPill(i.strength, c)} <span style="font-size:10px;color:${P.text2}">${escHtml(itemLabel(i, c, lang))}</span></div>`).join('')
        : '';
      out += `<tr class="no-break" data-line="${escHtml(l.id)}">
  <td style="${td}">${escHtml(l.itemNo)}</td>
  <td style="${td}">${escHtml(l.description)}</td>
  <td class="num" style="${td};text-align:right">${proofMoney(l.scheduledValueCents)}</td>
  <td class="num" style="${td};text-align:right;font-weight:700">${escHtml(proofMoneyOrGap(l.thisPeriodCents, c))}</td>
  <td class="num" style="${td};text-align:right">${escHtml(proofMoneyOrGap(l.storedCents, c))}</td>
  <td style="padding:8px 6px;border-bottom:1px solid ${P.hairline2};width:30%">${list}<div style="font-size:9.5px;color:${P.textMuted};margin-top:3px">${escHtml(c.lineLink[l.link])}</div></td>
</tr>`;
    }
    out += `</tbody></table>`;
  } else {
    // An invoice line prints its own total and nothing called "this period".
    out += `<table data-invoice-lines style="margin-bottom:12px"><thead><tr>${th(cols.description)}${th(cols.lineTotal, true)}</tr></thead><tbody>`;
    for (const l of pay.lines) {
      out += `<tr class="no-break" data-line="${escHtml(l.id)}">
  <td style="${td}">${escHtml(l.description)}<div style="font-size:9.5px;color:${P.textMuted};margin-top:3px">${escHtml(c.lineLink[l.link])}</div></td>
  <td class="num" style="${td};text-align:right">${proofMoney(l.scheduledValueCents)}</td>
</tr>`;
    }
    out += `</tbody></table>`;
  }

  // ── Daily reports ──
  out += pdfSectionHeader(c.reportsHeadingLabel);
  const reports = of('daily_report');
  out += reports.length ? reports.map((i) => reportRow(i, c, lang)).join('') : gap(c.reportsEmpty);

  // ── Photos ──
  out += pdfSectionHeader(c.photosHeadingLabel);
  const photos = of('photo');
  if (photos.length === 0) {
    out += gap(c.photosEmpty);
  } else {
    out += muted(`${c.photosIntro} ${c.reason.photo_phone}`);
    if (pack.photoCoordinates === 'left_out' && photos.some((i) => i.placeSource === 'phone_gps')) out += `<div data-coords-left-out>${muted(c.photoCoordsLeftOut)}</div>`;
    const shown = photos.slice(0, PROOF_PACK_MAX_PHOTOS);
    const listed = photos.slice(PROOF_PACK_MAX_PHOTOS);
    out += `<div style="display:flex;flex-wrap:wrap;gap:0 2.75%">${shown.map((i) => photoTile(i, opts.photoSrc?.[i.key], c, lang)).join('')}</div>`;
    if (listed.length) {
      out += muted(c.photosListed(listed.length));
      out += listed.map((i) => row(i.strength, i.reason, c, escHtml(dayText(i.day, c, lang)), photoStamp(i, c, lang))).join('');
    }
  }

  // ── Change orders ──
  out += pdfSectionHeader(c.changeOrdersHeadingLabel);
  const cos = of('change_order');
  out += cos.length ? cos.map((i) => changeOrderRow(i, c, lang)).join('') : gap(c.changeOrdersEmpty);

  // ── Punch, inspections, field tickets ──
  out += pdfSectionHeader(c.punchHeadingLabel);
  const punchRows = [
    ...of('punch_seal').map((i) => punchSealRow(i, c, lang)),
    ...of('punch_item').map((i) => punchItemRow(i, c, lang)),
    ...of('inspection').map((i) => inspectionRow(i, c, lang)),
    ...of('field_ticket').map((i) => ticketRow(i, c, lang)),
  ];
  out += punchRows.length ? punchRows.join('') : gap(c.punchEmpty);

  // ── Lien waivers ──
  out += pdfSectionHeader(c.waiversHeadingLabel);
  const waiversNotRead = pack.openItems.some((o) => o.code === 'source_not_loaded' && o.source === 'lien_waivers');
  const waivers = of('lien_waiver');
  if (waivers.length) out += muted(c.waiversNameSubs);
  if (waiversNotRead) out += gap(c.waiversNotChecked);
  else out += waivers.length ? waivers.map((i) => waiverRow(i, c, lang)).join('') : gap(c.waiversEmpty);
  if (pack.waiverGaps.length) {
    out += `<div style="font-size:10px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${P.warningInk};margin:10px 0 4px">${escHtml(c.waiverGapsHeadingLabel)}</div>`;
    out += pack.waiverGaps.map((g) => `<div data-waiver-gap style="font-size:11px;padding:4px 0;border-bottom:1px solid ${P.hairline2}">${escHtml(c.waiverGapLine(g.subName || c.notOnFile, dayText(g.throughDay, c, lang)))}</div>`).join('');
  }

  // ── Open items ──
  out += `<div style="page-break-before:always"></div>`;
  out += pdfSectionHeader(c.openHeadingLabel);
  out += muted(c.openIntro);
  out += `<ul data-open-items style="margin:0 0 14px 18px;padding:0">${pack.openItems.map((o) => `<li data-open="${o.code}" style="font-size:11.5px;color:${P.text};padding:3px 0">${escHtml(c.openItem(o))}</li>`).join('')}</ul>`;

  // ── How to check this document ──
  out += pdfSectionHeader(c.checkHeadingLabel);
  const fp = opts.fingerprint;
  out += `<div class="no-break" data-fingerprint style="border:1px solid ${P.hairline};border-radius:8px;padding:12px 14px;margin-bottom:10px">
  <div style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${P.textMuted}">${escHtml(c.fingerprintLabel)}</div>
  <div class="num" data-hash="${escHtml(fp.hash)}" style="font-family:${PDF_FONT_DISPLAY};font-size:15px;font-weight:700;letter-spacing:1px;line-height:1.5;color:${P.text}">${escHtml(fingerprintGroups(fp.hash))}</div>
  <div style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${P.textMuted};margin-top:8px">${escHtml(c.checkCodeLabel)}</div>
  <div class="num" data-check-code style="font-size:12px;font-weight:700;letter-spacing:1px;color:${P.text2}">${escHtml(fp.code)}</div>
  <div data-check-code-note style="font-size:10.5px;color:${P.text2};margin-top:2px">${escHtml(c.checkCodeNote)}</div>
</div>`;
  out += muted(fp.serverCreatedAt ? c.fingerprintOnFile(proofInstant(fp.serverCreatedAt, c, lang)) : c.fingerprintNotOnFile);
  out += `<div data-fingerprint-limits style="margin:0 0 10px;padding:10px 12px;border-left:4px solid ${P.brand};background:${P.brandTint};font-size:11.5px;font-weight:600;color:${P.text}">${escHtml(c.fingerprintLimits)}</div>`;
  out += muted(c.fingerprintCovers);
  out += `<div data-fingerprint-outside>${muted(c.fingerprintOutside)}</div>`;
  if (fp.serverCreatedAt) {
    out += muted(c.howToCheck);
    out += muted(c.checkWhere);
    out += muted(c.fileFingerprintNote);
  }
  out += muted(`${c.madeOnLabel}: ${proofInstant(pack.generatedAt, c, lang)}. ${c.madeOnPhoneClock}`);

  out += pdfFooter(branding, undefined, c.footer);

  // One table frames the document so its footer group repeats on every page.
  const framed = `<table data-page-frame style="width:100%;border-collapse:collapse">
<tfoot style="display:table-footer-group"><tr><td data-notice="page-footer" style="padding:10px 0 0;font-size:8.5px;line-height:1.4;color:${P.text2}"><div style="border-top:1px solid ${P.hairline};padding-top:6px"><span style="font-weight:700;letter-spacing:0.6px;text-transform:uppercase">${escHtml(c.noticeHeadingLabel)}.</span> ${escHtml(c.notice)}</div></td></tr></tfoot>
<tbody><tr><td style="padding:0">${out}</td></tr></tbody>
</table>`;
  const html = pdfShell({ bodyHtml: framed, branding, title: `${c.titleLabel} ${payName}` });
  return lang === 'es' ? html.replace('<html lang="en">', '<html lang="es">') : html;
}

/** The file title the share sheet shows: the document's name, the pay document's number, the project. */
export function proofPackFileTitle(pack: Pick<ProofPack, 'pay' | 'project'>, lang: ProofDocLang): string {
  const c = proofDocCopy(lang);
  const n = pack.pay.kind === 'pay_app' ? pack.pay.applicationNumber : pack.pay.number;
  return `${c.titleLabel} ${n} ${pack.project.name}`.replace(/[^\p{L}\p{N} _-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
