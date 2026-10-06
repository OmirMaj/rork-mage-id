// utils/coProofPacketHtml.ts — the change order proof packet, printed.
//
// Renders a CoProofPacket (utils/coProofPacket.ts) to one print-ready HTML
// document on the shared PDF design system (utils/pdfDesign.ts). PURE: the
// caller passes the packet, the CO document body it already built, and the
// photos it already resolved (same order and ids as packet.photos.items);
// nothing here reads storage, the network or the clock.
//
// Order: header, cover (with "How this packet was built"), the CO document
// verbatim, then Approval record, Money check, Schedule impact, Photos, Daily
// logs, RFIs, Messages, Linked records, footer. Every section prints its
// source line directly under its header and, with no rows, its empty or
// not-checked sentence (never swapped, never "none").
//
// Every piece of user text goes through escHtml; money through fmtMoney in
// whole cents / 100; days through formatCalendarDay in English (the packet is
// English per docs/I18N.md §PDFs). No photo tile is ever blank.
import type { CompanyBranding } from '@/types';
import {
  PDF_PALETTE,
  escHtml,
  fmtMoney,
  pdfFooter,
  pdfHeader,
  pdfPill,
  pdfSectionHeader,
  pdfShell,
  pdfStatGrid,
  pdfTable,
  pdfTitle,
} from '@/utils/pdfDesign';
import { dfrMarkupSvg, type DfrDocumentPhoto } from '@/utils/pdfGenerator';
import { calendarDayOf, formatCalendarDay } from '@/utils/calendarDate';
import {
  COPROOF_COPY,
  COPROOF_MAX_EMBEDDED_PHOTOS,
  COPROOF_REASON_LABEL,
  coProofPacketFileTitle,
  type CoProofPacket,
  type CoProofPhotoItem,
  type CoProofSection,
} from '@/utils/coProofPacket';

export interface CoProofPacketHtmlOptions {
  project: { name: string; location?: string };
  branding: CompanyBranding;
  /** The CO document body, from pdfGenerator's buildChangeOrderBodyHtml. Printed verbatim. */
  coBodyHtml: string;
  /** Resolved by the caller, same order and ids as packet.photos.items. */
  photos: DfrDocumentPhoto[];
}

export const COPROOF_HTML_COPY = {
  eyebrow: 'Proof Packet',
  howBuiltHeading: 'How this packet was built',
  howBuiltBody: 'Every section below is copied from this job’s record in MAGE ID. Nothing in it was written by AI. Each item says why it is included, and each section says where its rows came from.',
  noApproval: 'No approval is recorded on this change order.',
  notOpened: 'Not opened in the portal yet.',
  notShared: 'Not shared to the client portal.',
  photoNotUploaded: 'Not uploaded yet. It is only on the phone that took it.',
  photoNotLoaded: 'This photo could not be loaded for the packet.',
  photoOverBudget: 'Not printed. This packet reached its size limit.',
} as const;

const CO_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review', approved: 'Approved',
  rejected: 'Rejected', revised: 'Revised', void: 'Void',
};
const DFR_STATUS_LABEL: Record<string, string> = { draft: 'Draft', sent: 'Sent' };
const APPROVER_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Declined', changes_requested: 'Changes Requested',
};

/** Whole cents, printed. The only money path in this file. */
const money = (cents: number) => fmtMoney(cents / 100, { decimals: 2 });

/** A calendar day (or the day of an instant), in English. */
function day(value: string | null | undefined): string {
  if (!value) return '';
  return formatCalendarDay(calendarDayOf(value) ?? value, undefined, 'en');
}

/** Day plus local time for an instant; a bare day prints as the day alone. */
function dayTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = day(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return d;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return d;
  return `${d} · ${new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const muted = (text: string) =>
  `<div style="font-size:11px;color:${PDF_PALETTE.textMuted};margin:-4px 0 12px">${escHtml(text)}</div>`;
const para = (html: string) =>
  `<div style="font-size:12px;color:${PDF_PALETTE.text};margin:0 0 8px;line-height:1.55">${html}</div>`;
const note = (text: string) =>
  `<div style="font-size:11.5px;color:${PDF_PALETTE.text2};background:${PDF_PALETTE.ground2};border:1px solid ${PDF_PALETTE.hairline2};border-radius:10px;padding:10px 14px;margin:0 0 10px;line-height:1.5">${escHtml(text)}</div>`;
const block = (metaHtml: string, bodyHtml: string) =>
  `<div class="no-break" style="border:1px solid ${PDF_PALETTE.hairline2};border-radius:10px;padding:12px 14px;margin:0 0 10px">
    <div style="font-size:10.5px;color:${PDF_PALETTE.text2};margin-bottom:6px">${metaHtml}</div>
    <div style="font-size:12px;color:${PDF_PALETTE.text};white-space:pre-wrap;line-height:1.55">${bodyHtml}</div>
  </div>`;

/** Header, source line, and — with no rows — the one honest sentence. */
function sectionOpen<T>(s: CoProofSection<T>): string {
  const head = pdfSectionHeader(s.title) + muted(s.source);
  if (s.items.length > 0) return head;
  const sentence = s.notChecked ?? s.empty;
  return head + (sentence ? note(sentence) : '');
}

function statusPillKind(status: string): 'success' | 'warning' | 'error' | 'muted' {
  return status === 'approved' ? 'success'
    : status === 'rejected' ? 'error'
    : status === 'draft' || status === 'void' ? 'muted'
    : 'warning';
}

function scheduleStat(p: CoProofPacket): string {
  const n = p.schedule.impactDays == null ? 0 : Math.round(p.schedule.impactDays);
  if (n === 0) return 'None recorded';
  return `${n > 0 ? '+' : '-'}${plural(Math.abs(n), 'day', 'days')}`;
}

function countLine(p: CoProofPacket): string {
  const c = (label: string, s: CoProofSection<unknown>) => (s.notChecked ? `${label} not checked` : `${label} ${s.items.length}`);
  return [
    c('Photos', p.photos), c('Daily logs', p.dailyLogs), c('RFIs', p.rfis), c('Messages', p.messages),
    c('Linked records', p.linked),
  ].join(' · ');
}

function coverHtml(p: CoProofPacket, opts: CoProofPacketHtmlOptions): string {
  const status = CO_STATUS_LABEL[p.status] ?? 'Status not set';
  const subtitle = [opts.project.name, opts.project.location].filter(s => !!s && s.trim()).join(' · ');
  const title = pdfTitle({
    eyebrow: COPROOF_HTML_COPY.eyebrow,
    title: `Change order #${p.coNumber}`,
    subtitle: subtitle || undefined,
    meta: [
      { label: 'Generated', value: day(p.generatedAt) || 'Not recorded' },
      { label: 'Status', value: status },
    ],
  });
  const windowLine = para(`${pdfPill(status, statusPillKind(p.status))}&nbsp;&nbsp;${escHtml(`Evidence window: ${day(p.window.startDay)} to ${day(p.window.endDay)}`)}`);
  const glance = pdfStatGrid([
    { label: 'Amount', value: money(p.money.changeCents) },
    { label: 'Status', value: status },
    { label: 'Schedule', value: scheduleStat(p) },
  ]);
  const howBuilt = `<div class="no-break" style="background:${PDF_PALETTE.brandTint};border:1px solid ${PDF_PALETTE.hairline2};border-radius:12px;padding:14px 18px;margin:0 0 24px">
    <div style="font-size:12px;font-weight:700;color:${PDF_PALETTE.brandDark};margin-bottom:4px">${escHtml(COPROOF_HTML_COPY.howBuiltHeading)}</div>
    <div style="font-size:12px;color:${PDF_PALETTE.text};line-height:1.55">${escHtml(COPROOF_HTML_COPY.howBuiltBody)}</div>
  </div>`;
  return title + windowLine + glance + para(escHtml(countLine(p))) + howBuilt;
}

function approvalHtml(p: CoProofPacket): string {
  const a = p.approval;
  let out = pdfSectionHeader(COPROOF_COPY.titles.approval) + muted(COPROOF_COPY.sources.approval);
  out += para(escHtml(a.line?.text ?? COPROOF_HTML_COPY.noApproval));
  if (a.decline) {
    const when = a.decline.when ? ` on ${day(a.decline.when)}` : '';
    out += para(escHtml(`Declined by ${a.decline.who}${when}.`));
    if (a.decline.reason) out += para(escHtml(`Reason given: ${a.decline.reason}`));
  }
  if (a.portal.sentAt) {
    out += para(escHtml(`Shared to the client portal on ${day(a.portal.sentAt)}.`));
    out += para(escHtml(a.portal.viewedAt
      ? `First opened by the client on ${day(a.portal.viewedAt)}.`
      : COPROOF_HTML_COPY.notOpened));
  } else {
    out += para(escHtml(COPROOF_HTML_COPY.notShared));
  }
  if (a.approvers.length > 0) {
    out += pdfTable(
      [{ header: 'Approver' }, { header: 'Role' }, { header: 'Status' }, { header: 'Responded' }, { header: 'Note' }],
      a.approvers.map(r => [
        escHtml(r.name),
        escHtml(r.role),
        escHtml(APPROVER_STATUS_LABEL[r.status] ?? 'Status not set'),
        escHtml(day(r.responseDate) || 'Not yet'),
        escHtml([
          r.rejectionReason ?? '',
          r.counterCents != null ? `Counter offer ${money(r.counterCents)}` : '',
        ].filter(Boolean).join(' · ')),
      ]),
    );
  }
  if (a.timeline.length > 0) {
    out += pdfTable(
      [{ header: 'When', width: '22%' }, { header: 'What happened' }, { header: 'By', width: '20%' }],
      a.timeline.map(t => [
        escHtml(dayTime(t.at) || 'Not recorded'),
        escHtml(t.label) + (t.detail ? `<div style="font-size:10.5px;color:${PDF_PALETTE.text2};margin-top:2px">${escHtml(t.detail)}</div>` : ''),
        escHtml(t.actor),
      ]),
    );
  }
  return out;
}

function moneyHtml(p: CoProofPacket): string {
  const m = p.money;
  let out = pdfSectionHeader(COPROOF_COPY.titles.money) + muted(COPROOF_COPY.sources.money);
  out += para(escHtml(`Line items add to ${money(m.lineSumCents)}.`));
  out += para(escHtml(`Recorded change: ${money(m.changeCents)}.`));
  if (m.lineMismatch) {
    const diff = Math.abs(m.lineMismatch.lineSumCents - m.lineMismatch.recordedCents);
    out += note(`The line items and the recorded amount differ by ${money(diff)}. The recorded amount is what was sent.`);
  }
  const rows: string[][] = [
    ['Contract before this change', money(m.contractBeforeCents)],
    ['This change', money(m.changeCents)],
    ['New contract total', money(m.newContractCents)],
  ];
  if (m.taxCents != null) rows.push(['Sales tax on this change', money(m.taxCents)]);
  if (m.totalWithTaxCents != null) rows.push(['This change with tax', money(m.totalWithTaxCents)]);
  out += pdfTable(
    [{ header: 'Amount' }, { header: 'Recorded', align: 'right' }],
    rows.map(([label, value]) => [escHtml(label), `<span class="num">${escHtml(value)}</span>`]),
  );
  return out;
}

function scheduleHtml(p: CoProofPacket): string {
  const s = p.schedule;
  let out = pdfSectionHeader(COPROOF_COPY.titles.schedule) + muted(COPROOF_COPY.sources.schedule);
  out += para(escHtml(s.statement));
  if (s.anchorTaskTitle) out += para(escHtml(`Task that takes the days: ${s.anchorTaskTitle}`));
  if (s.affectedTaskTitles.length > 0) out += para(escHtml(`Tasks named as affected: ${s.affectedTaskTitles.join(' · ')}`));
  if (s.reflows.length > 0) {
    out += pdfTable(
      [{ header: 'When', width: '22%' }, { header: 'Schedule record' }],
      s.reflows.map(r => [escHtml(dayTime(r.at) || 'Not recorded'), escHtml(r.summary)]),
    );
  }
  if (s.auditNote) out += note(s.auditNote);
  out += note(s.previewNote);
  return out;
}

function photoCaption(item: CoProofPhotoItem): string {
  return [day(item.timestamp), COPROOF_REASON_LABEL[item.reason], item.caption ?? ''].filter(Boolean).join(' · ');
}

function photosHtml(p: CoProofPacket, resolved: DfrDocumentPhoto[]): string {
  const s = p.photos;
  let out = sectionOpen(s);
  const byId = new Map(resolved.filter(r => !!r && !!r.id).map(r => [r.id, r]));
  const tiles: string[] = [];
  // The cap is by POSITION, the way buildDFRHtml caps: the first
  // COPROOF_MAX_EMBEDDED_PHOTOS items get a tile (image or a stated gap) and
  // every later item goes to the list, whatever its src. resolveDfrPhotosForDocument
  // only tries to load the first DFR_PDF_MAX_PHOTOS and hands every later one
  // back with src null — those were never attempted, so they must not print
  // "could not be loaded".
  const tiled = s.items.slice(0, COPROOF_MAX_EMBEDDED_PHOTOS);
  const overflow: CoProofPhotoItem[] = s.items.slice(COPROOF_MAX_EMBEDDED_PHOTOS);
  for (const item of tiled) {
    const r = byId.get(item.id);
    const textTile = (text: string) =>
      `<div style="width:100%;padding:28px 12px;border-radius:10px;border:1px dashed ${PDF_PALETTE.hairline};font-size:11px;color:${PDF_PALETTE.textMuted};text-align:center;line-height:1.45">${escHtml(text)}</div>`;
    let frame: string;
    if (r?.overBudget) frame = textTile(COPROOF_HTML_COPY.photoOverBudget);
    else if (!r?.src) frame = textTile(r?.notUploaded ? COPROOF_HTML_COPY.photoNotUploaded : COPROOF_HTML_COPY.photoNotLoaded);
    else frame = `<div style="position:relative;width:100%;padding-top:100%;border-radius:10px;overflow:hidden;background:${PDF_PALETTE.hairline2}"><img src="${escHtml(r.src)}" alt="" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover"/>${dfrMarkupSvg(r.markup)}</div>`;
    tiles.push(`<td class="no-break" style="width:50%;padding:6px;vertical-align:top">${frame}<div style="font-size:10px;color:${PDF_PALETTE.textMuted};margin-top:4px">${escHtml(photoCaption(item))}</div></td>`);
  }
  if (tiles.length > 0) {
    const rows: string[] = [];
    for (let i = 0; i < tiles.length; i += 2) {
      const cells = tiles.slice(i, i + 2);
      while (cells.length < 2) cells.push('<td style="width:50%"></td>');
      rows.push(`<tr>${cells.join('')}</tr>`);
    }
    out += `<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:10px">${rows.join('')}</table>`;
  }
  if (overflow.length > 0) {
    out += note(`${tiles.length} of ${s.items.length} photos are shown. The rest are listed below.`);
    out += pdfTable(
      [{ header: 'Taken', width: '22%' }, { header: 'Why it is included' }, { header: 'Where' }],
      overflow.map(item => [
        escHtml(day(item.timestamp) || 'Not recorded'),
        escHtml(COPROOF_REASON_LABEL[item.reason]),
        escHtml(item.caption ?? ''),
      ]),
    );
  }
  if (s.excludedIncidentCount > 0) {
    out += note(s.excludedIncidentCount === 1
      ? '1 incident photo from this window is kept off this packet.'
      : `${s.excludedIncidentCount} incident photos from this window are kept off this packet.`);
  }
  return out;
}

function dailyLogsHtml(p: CoProofPacket): string {
  const s = p.dailyLogs;
  return sectionOpen(s) + s.items.map(item => block(
    escHtml([day(item.day), DFR_STATUS_LABEL[item.status] ?? 'Status not set', COPROOF_REASON_LABEL[item.reason]].join(' · ')),
    escHtml(item.excerpt),
  )).join('');
}

function rfisHtml(p: CoProofPacket): string {
  const s = p.rfis;
  return sectionOpen(s) + s.items.map(item => {
    const meta = [
      `RFI #${item.number}`,
      item.status,
      item.dateSubmitted ? `Asked ${day(item.dateSubmitted)}` : '',
      item.dateResponded ? `Answered ${day(item.dateResponded)}` : '',
      COPROOF_REASON_LABEL[item.reason],
    ].filter(Boolean).join(' · ');
    const body = [
      item.subject,
      item.question ? `Question: ${item.question}` : '',
      item.response ? `Response: ${item.response}` : 'No response recorded.',
    ].filter(Boolean).join('\n');
    return block(escHtml(meta), escHtml(body));
  }).join('');
}

function messagesHtml(p: CoProofPacket): string {
  const s = p.messages;
  let out = sectionOpen(s);
  if (s.items.length > 0) {
    out += pdfTable(
      [{ header: 'When', width: '20%' }, { header: 'From', width: '18%' }, { header: 'Message' }, { header: 'Why it is included', width: '22%' }],
      s.items.map(m => [
        escHtml(dayTime(m.at) || 'Not recorded'),
        escHtml(m.from) + `<div style="font-size:10px;color:${PDF_PALETTE.textMuted}">${escHtml(m.kind === 'portal' ? 'Client portal' : 'Activity log')}</div>`,
        `<span style="white-space:pre-wrap">${escHtml(m.body)}</span>`,
        escHtml(COPROOF_REASON_LABEL[m.reason]),
      ]),
    );
  }
  return out;
}

function linkedHtml(p: CoProofPacket): string {
  const s = p.linked;
  let out = sectionOpen(s);
  if (s.items.length > 0) {
    out += pdfTable(
      [{ header: 'Record', width: '24%' }, { header: 'Date', width: '18%' }, { header: 'Detail' }],
      s.items.map(l => [
        escHtml(l.label) + `<div style="font-size:10px;color:${PDF_PALETTE.textMuted}">${escHtml(COPROOF_REASON_LABEL.linked)}</div>`,
        escHtml(day(l.day) || 'Not recorded'),
        escHtml(l.detail),
      ]),
    );
  }
  return out;
}

export function buildCoProofPacketHtml(packet: CoProofPacket, opts: CoProofPacketHtmlOptions): string {
  const body =
    pdfHeader(opts.branding)
    + coverHtml(packet, opts)
    + opts.coBodyHtml
    + approvalHtml(packet)
    + moneyHtml(packet)
    + scheduleHtml(packet)
    + photosHtml(packet, opts.photos ?? [])
    + dailyLogsHtml(packet)
    + rfisHtml(packet)
    + messagesHtml(packet)
    + linkedHtml(packet)
    + pdfFooter(opts.branding, escHtml(`Change order #${packet.coNumber} proof packet`));
  return pdfShell({
    title: coProofPacketFileTitle(packet.coNumber, opts.project.name),
    branding: opts.branding,
    bodyHtml: body,
  });
}
