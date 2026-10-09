// archive-legal-text.ts — the one script that computes the hash of the Terms of
// Service and the Privacy Policy, and files the exact words that hash covers
// (lane PROTECT-SERVER, review finding 8a).
//
// A row in public.legal_acceptances says "version 2026-05-12, text hash c0b1…".
// A hash proves the words did not change; it cannot be read. So for every
// version this script writes the words themselves to
//   docs/legal/versions/<kind>-<version>-<first 8 of the hash>.txt
// exactly as hashed: the text inside <main> of the published page, tags
// removed, white space collapsed (utils/legalAcceptanceCore normalizeLegalHtml),
// UTF-8, no trailing newline. `shasum -a 256 <file>` prints the hash in the row.
//
// The hash is of the file IN THIS REPO (marketing/terms.html,
// marketing/privacy.html). The live site is published from that folder; nothing
// here fetches the live page. See docs/legal/versions/README.md.
//
//   bun run scripts/archive-legal-text.ts            print version, hash and file for both pages; write a missing archive file
//   bun run scripts/archive-legal-text.ts --check    write nothing; exit 1 if a constant or an archive file is wrong
//
// It also files the in-app questions that are recorded with a hash (NOTICES
// below: the Living Model's scan question, English and Spanish), the same way.
//
// When a page's words change: edit the page, put its new "Last updated" date
// and the hash this prints into utils/legalAcceptanceCore.ts, run this again
// (it writes the new archive file; the old one stays, it is the record of the
// old version), commit all three together. scripts/validate-legal-acceptance.ts
// fails the build until they agree.
//
// An archive file is never rewritten: if one exists with different words, this
// stops. Two texts cannot share a version.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ES_OFFICE_LIVING_MODEL } from '../i18n/catalog/es/office/livingModel';
import {
  PRIVACY_TEXT_SHA256, PRIVACY_VERSION, SCAN_UPLOAD_COPY, SCAN_UPLOAD_TEXT_SHA256, SCAN_UPLOAD_TEXT_SHA256_ES, SCAN_UPLOAD_VERSION,
  TERMS_TEXT_SHA256, TERMS_VERSION, legalNoticeText, normalizeLegalHtml,
} from '../utils/legalAcceptanceCore';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LEGAL_ARCHIVE_DIR = 'docs/legal/versions';

/** The archive file for one version of one document. */
export function legalArchivePath(kind: 'terms' | 'privacy' | 'scan_room_upload-en' | 'scan_room_upload-es', version: string, sha256: string): string {
  return `${LEGAL_ARCHIVE_DIR}/${kind}-${version}-${sha256.slice(0, 8)}.txt`;
}

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** The page's own date ("Last updated: May 12, 2026") as 2026-05-12, or ''. */
function pageDate(text: string): string {
  const m = /Last updated:\s*([A-Za-z]+ \d{1,2}, \d{4})/.exec(text);
  if (!m) return '';
  const d = new Date(`${m[1]} 12:00:00 UTC`);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
}

const PAGES = [
  { kind: 'terms' as const, page: 'marketing/terms.html', version: TERMS_VERSION, hash: TERMS_TEXT_SHA256, names: 'TERMS_VERSION / TERMS_TEXT_SHA256' },
  { kind: 'privacy' as const, page: 'marketing/privacy.html', version: PRIVACY_VERSION, hash: PRIVACY_TEXT_SHA256, names: 'PRIVACY_VERSION / PRIVACY_TEXT_SHA256' },
];

/**
 * IN-APP QUESTIONS that are recorded with a hash (lane LIVINGSYNC): the Living
 * Model's question before a scanned room is sent to the account. One file per
 * language, the exact string the hash is taken over (title, one newline,
 * body). The English is the constant in utils/legalAcceptanceCore; the
 * Spanish is the catalog entry a Spanish-language phone shows.
 */
const esText = (key: string): string => String((ES_OFFICE_LIVING_MODEL as Record<string, { s: unknown }>)[key]?.s ?? '');
export const NOTICES = [
  { kind: 'scan_room_upload-en' as const, version: SCAN_UPLOAD_VERSION, hash: SCAN_UPLOAD_TEXT_SHA256, names: 'SCAN_UPLOAD_VERSION / SCAN_UPLOAD_TEXT_SHA256',
    text: legalNoticeText(SCAN_UPLOAD_COPY.title, SCAN_UPLOAD_COPY.body) },
  { kind: 'scan_room_upload-es' as const, version: SCAN_UPLOAD_VERSION, hash: SCAN_UPLOAD_TEXT_SHA256_ES, names: 'SCAN_UPLOAD_VERSION / SCAN_UPLOAD_TEXT_SHA256_ES',
    text: legalNoticeText(esText('office.livingModel.sync.scanAskTitleBody'), esText('office.livingModel.sync.scanAskBody')) },
];

if (import.meta.main) {
  const check = process.argv.includes('--check');
  let bad = 0;
  for (const p of PAGES) {
    const text = normalizeLegalHtml(readFileSync(path.join(ROOT, p.page), 'utf8'));
    const hash = sha(text);
    const date = pageDate(text);
    const file = legalArchivePath(p.kind, date || p.version, hash);
    console.log(`${p.kind}: page date ${date || '(none found)'}, sha256 ${hash}`);
    if (hash !== p.hash || date !== p.version) {
      bad++;
      console.log(`  ✗ utils/legalAcceptanceCore.ts ${p.names} say ${p.version} / ${p.hash.slice(0, 12)}…; the page says ${date} / ${hash.slice(0, 12)}…. Put the page's date and this hash there.`);
    }
    const abs = path.join(ROOT, file);
    if (existsSync(abs)) {
      const same = readFileSync(abs, 'utf8') === text;
      console.log(`  ${same ? '✓' : '✗'} ${file}${same ? '' : ' exists with DIFFERENT words: a version\'s archive is never rewritten. Give the page a new date.'}`);
      if (!same) bad++;
    } else if (check) {
      bad++;
      console.log(`  ✗ ${file} is missing. Run: bun run scripts/archive-legal-text.ts`);
    } else {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, text, 'utf8');
      console.log(`  ✓ wrote ${file} (${Buffer.byteLength(text, 'utf8')} bytes)`);
    }
  }
  for (const n of NOTICES) {
    const hash = sha(n.text);
    const file = legalArchivePath(n.kind, n.version, hash);
    console.log(`${n.kind}: version ${n.version}, sha256 ${hash}`);
    if (hash !== n.hash) {
      bad++;
      console.log(`  ✗ utils/legalAcceptanceCore.ts ${n.names} say ${n.hash.slice(0, 12)}…; the words hash to ${hash.slice(0, 12)}…. The words changed: bump SCAN_UPLOAD_VERSION and put this hash there.`);
    }
    const abs = path.join(ROOT, file);
    if (existsSync(abs)) {
      const same = readFileSync(abs, 'utf8') === n.text;
      console.log(`  ${same ? '✓' : '✗'} ${file}${same ? '' : ' exists with DIFFERENT words: a version\'s archive is never rewritten. Bump the version.'}`);
      if (!same) bad++;
    } else if (check) {
      bad++;
      console.log(`  ✗ ${file} is missing. Run: bun run scripts/archive-legal-text.ts`);
    } else {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, n.text, 'utf8');
      console.log(`  ✓ wrote ${file} (${Buffer.byteLength(n.text, 'utf8')} bytes)`);
    }
  }
  process.exit(bad > 0 ? 1 : 0);
}
