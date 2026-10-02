// utils/learn/certificateDoc.ts — the words of an app-skills certificate, in
// one place, for the card (components/learn/CertificateCard.tsx), the PDF
// ("Save PDF" → utils/platformFile printHtmlDocument) and the share text.
// Pure: no React Native import, so scripts/validate-skill-certificate-doc.ts
// drives it under bun.
//
// WHAT IT MAY LOOK LIKE. A plain one-page document: "MAGE ID" as words, the
// certificate title, who it was awarded to, the score and date, what it covers,
// and the two notes every certificate carries (CERT_NAME_NOTE under the name,
// CERT_SCOPE_NOTE as the footnote). Full-page proportions only. No emblem, no
// ribbon, no star, no end date, no ID-number styling, nothing shaped like a
// pocket card. The words a reader could take for a trade credential are banned
// from this file and from the card by the validator; the only place they may
// appear is inside CERT_SCOPE_NOTE, which says what this is NOT.
//
// The PDF and the share text stay English, like every other document MAGE ID
// prints. Every value that reaches the HTML is escaped (the printed name is
// whatever the account holder typed).

import { PDF_FONT_DISPLAY, PDF_PALETTE, escHtml } from '@/utils/pdfDesign';
import { SKILL_TOPICS } from './topics';
import { CERT_NAME_NOTE, CERT_SCOPE_NOTE, type SkillCertificate, type SkillTopic, type SkillTopicId } from './types';

/** How many topics there are, for "{n} of 15". */
export const SKILL_TOPIC_COUNT = SKILL_TOPICS.length;

/** 'ABCDEFGHJKLM' → 'ABCD-EFGH-JKLM'. Any other length is grouped in fours
 *  the same way (the server only issues twelve characters). */
export function formatCheckCode(code: string): string {
  const clean = String(code ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.match(/.{1,4}/g)?.join('-') ?? '';
}

function newestFirst(a: SkillCertificate, b: SkillCertificate): number {
  return a.issuedAt < b.issuedAt ? 1 : a.issuedAt > b.issuedAt ? -1 : 0;
}

/** The certificates that count: for each topic the NEWEST one (any quiz
 *  version), kept only while it is not revoked. Newest first. A removed row is
 *  gone from the table, so it never reaches here. */
export function earnedCertificates(certs: readonly SkillCertificate[]): SkillCertificate[] {
  const byTopic = new Map<SkillTopicId, SkillCertificate>();
  for (const c of certs.slice().sort(newestFirst)) {
    if (!byTopic.has(c.topic)) byTopic.set(c.topic, c);
  }
  return [...byTopic.values()].filter(c => c.revokedAt === null).sort(newestFirst);
}

/** The "{n}" of "{n} of 15". */
export function earnedCount(certs: readonly SkillCertificate[]): number {
  return earnedCertificates(certs).length;
}

/** The topics with no certificate that counts, in hub order. */
export function topicsNotEarned(certs: readonly SkillCertificate[]): SkillTopic[] {
  const have = new Set(earnedCertificates(certs).map(c => c.topic));
  return SKILL_TOPICS.filter(t => !have.has(t.id));
}

/** "Awarded to {name}" (English; the card renders the same words through t()). */
export function awardedLine(cert: SkillCertificate): string {
  return `Awarded to ${cert.holderName}`;
}

/** "Passed the in-app check, 4 of 5 · Oct 1, 2026". */
export function scoreLine(cert: SkillCertificate, issuedLabel: string): string {
  return `Passed the in-app check, ${cert.correct} of ${cert.total} · ${issuedLabel}`;
}

/** What the share sheet (or, on web, the clipboard) carries. CERT_NAME_NOTE
 *  rides along right after the name, as on the card and the PDF. */
export function certificateShareText(cert: SkillCertificate, topic: SkillTopic, url: string): string {
  return `${topic.certificateTitle} — ${cert.holderName}. ${CERT_NAME_NOTE} Check it at ${url}`;
}

/** What VoiceOver reads for one card:
 *  "MAGE ID skills: Change orders. Awarded to Dana Ruiz, October 1, 2026.
 *   Covers using the MAGE ID app only." */
export function certificateA11yLabel(cert: SkillCertificate, topic: SkillTopic, longDate: string): string {
  return `${topic.certificateTitle}. Awarded to ${cert.holderName}, ${longDate}. Covers using the MAGE ID app only.`;
}

/**
 * The PDF: one US-letter landscape page with the same words as the card, plus
 * "Check it at {verifyUrl}" and "Check code XXXX-XXXX-XXXX". No script, no
 * remote image; the display face falls back to a plain grotesque.
 */
export function buildCertificateHtml(
  cert: SkillCertificate,
  topic: SkillTopic,
  opts: { verifyUrl: string; issuedLabel: string },
): string {
  const P = PDF_PALETTE;
  const title = escHtml(topic.certificateTitle);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  @page { size: letter landscape; margin: 0.6in; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${P.surface}; color: ${P.text}; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif; }
  .page { width: 100%; min-height: 7in; border: 1px solid ${P.hairline}; border-radius: 10px; padding: 0.6in 0.7in; display: flex; flex-direction: column; }
  .mark { font-family: ${PDF_FONT_DISPLAY}; font-weight: 700; font-size: 14px; letter-spacing: 2px; color: ${P.brandDark}; }
  h1 { font-family: ${PDF_FONT_DISPLAY}; font-weight: 700; font-size: 34px; line-height: 1.15; margin: 0.45in 0 0; color: ${P.text}; }
  .awarded { font-size: 22px; margin: 0.35in 0 0; color: ${P.text}; }
  .note { font-size: 12px; margin: 6px 0 0; color: ${P.text2}; }
  .score { font-size: 15px; margin: 0.3in 0 0; color: ${P.text}; }
  .scope { font-size: 15px; margin: 8px 0 0; color: ${P.text}; }
  .foot { margin-top: auto; padding-top: 0.35in; border-top: 1px solid ${P.hairline}; }
  .check { font-size: 13px; margin: 0; color: ${P.text}; }
  .code { font-size: 13px; margin: 4px 0 0; color: ${P.text2}; letter-spacing: 1px; }
  .scopeNote { font-size: 11px; margin: 14px 0 0; color: ${P.text2}; line-height: 1.5; }
</style>
</head>
<body>
<div class="page">
  <div class="mark">MAGE ID</div>
  <h1>${title}</h1>
  <p class="awarded">${escHtml(awardedLine(cert))}</p>
  <p class="note">${escHtml(CERT_NAME_NOTE)}</p>
  <p class="score">${escHtml(scoreLine(cert, opts.issuedLabel))}</p>
  <p class="scope">${escHtml(topic.scope)}</p>
  <div class="foot">
    <p class="check">${escHtml(`Check it at ${opts.verifyUrl}`)}</p>
    <p class="code">${escHtml(`Check code ${formatCheckCode(cert.verifyCode)}`)}</p>
    <p class="scopeNote">${escHtml(CERT_SCOPE_NOTE)}</p>
  </div>
</div>
</body>
</html>`;
}
