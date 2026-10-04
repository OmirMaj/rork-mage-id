// validate-storage-paths.ts — a storage path that did not start on the server
// is checked WHOLE, by one rule, before a service-role storage call sees it.
//
// WHY THIS EXISTS (security review 2026-10-04). Four edge functions took a path
// from a request body (or from a free-text column the app writes), checked its
// FIRST part — `startsWith('<uid>/')`, or "the first segment is my project and
// no segment is exactly '..'" — and handed the raw string to
// `storage.from(bucket).download(path)` with the service role. The storage
// client splices the path into a URL unencoded, and the URL parser reads
// `%2e%2e`, `.%2E`, a backslash and a dot segment with a tab inside it as a
// real `..`. `<my project>/%2e%2e/<your project>/<file>.png` read another
// tenant's plan sheet; two of them reached another bucket.
//
// The fix is one pure rule, supabase/functions/_shared/storagePath.ts
// (requestStoragePath), used at every site. This guard holds it there:
//
//   1. THE RULE, EXECUTED. The real module is imported and run against the
//      legitimate shapes (built by the app's real writers where they are pure)
//      and an attack corpus. Each layer of the rule is also tested ALONE,
//      because two layers refuse most attacks and a whole-rule test cannot see
//      one of them being removed. Every exported shape is pinned WHOLE (bucket,
//      segment kinds, extension allow-list): widening one is a red build.
//   2. THE PREMISE, EXECUTED. The storage client from node_modules is driven
//      against a stub fetch: which methods put the path in the URL (where the
//      parser can rewrite it) and which put it in the JSON body is MEASURED, and
//      a seeded fuzz proves "accepted ⇒ the URL the client builds is the path,
//      byte for byte".
//   3. THE SINK, EXECUTED. _shared/planSheetBytes.ts runs with a stubbed
//      service-role client: no attack path downloads anything, and a legitimate
//      path downloads exactly the string that was checked.
//   4. THE SWEEP. Every storage call in supabase/functions/** is DERIVED from
//      the syntax tree (nothing here lists call sites). A path argument must be
//      a constant, or a const the rule produced, or an array that only ever
//      receives such consts and is otherwise only READ, or a slice of one that
//      nothing writes to, or a parameter every caller fills that way and the
//      function itself never writes to. "Read" is an allow-list (length, slice,
//      includes, indexOf, join, at, for-of, spread, a `.storage.from(…)` call);
//      everything else — an alias, a callback member, a same-named method on
//      another object — is "not proven". Whatever is left must be in the
//      reviewed ledger below with its reason — a new storage call that is none
//      of those fails here. The same sweep is then run over planted sources
//      (7b): each way of getting an unchecked string into a storage call must
//      be flagged, and for the reason under test.
//
//   5. ASK-FILES, EXECUTED. The AI file reader's two request-named files: a
//      plan page (its own fence and the rule must agree on every string, and
//      the key it loads is the rule's answer pinned to a project the caller
//      owns) and a client's message file (the loader runs against a stub
//      database and bucket; the key is rebuilt and passes the rule).
//   6. THE FOUR FUNCTIONS THAT USED TO CHECK A KEY THEMSELVES (lane SEC3):
//      signed-media-urls, shared-photos-sign, job-facts-view and delete-account
//      took a key out of a row, checked "segment N is mine and no segment is
//      exactly '..'", and passed it in a JSON body. Their decisions are RUN here
//      against the attack corpus (bare, and inside a Supabase object URL), and
//      the storage call of each is proven by the sweep, with no ledger entry.
//      delete-account's folder walk (list answers) keeps its two entries, now
//      with a proof this file executes; and account deletion never removes an
//      object from the legacy shared tmp/ folder.
//
// Nothing in this file touches the network. Run from the repo root:
//   bun run scripts/validate-storage-paths.ts

import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import ts from 'typescript';
import { StorageClient } from '@supabase/storage-js';
import { buildPlanSheetImagePath } from '../utils/planSheetImageCore';
import { buildPhotoStoragePath } from '../utils/photoUploadCore';
import { messageAttachmentPath } from '../utils/messageAttachments';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const read = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const show = (v: unknown): string => {
  const s = typeof v === 'string' ? JSON.stringify(v) : String(v);
  return s.length > 120 ? `${s.slice(0, 117)}…(${s.length})` : s;
};

// ── the modules under guard ─────────────────────────────────────────────────
// Specifiers are ASSEMBLED so `tsc --noEmit` does not pull supabase/functions
// (Deno code, excluded by tsconfig) into the app's program; bun resolves them
// at runtime, and the shapes used are declared here.
type SegmentRule =
  | { kind: 'id' }
  | { kind: 'file'; extensions: readonly string[] }
  | { kind: 'idFile'; extensions: readonly string[] }
  | { kind: 'stampedName' }
  | { kind: 'literal'; value: string };
interface Shape { bucket: string; segments: readonly SegmentRule[] }
interface StoragePathModule {
  STORAGE_PATH_MAX_LENGTH: number;
  STORAGE_FILE_NAME_MAX_LENGTH: number;
  STORAGE_STAMPED_NAME_MAX_LENGTH: number;
  PLAN_SHEET_PATH: Shape;
  PDF_UPLOAD_PATH: Shape;
  CONTRACT_PDF_PATH: Shape;
  PUNCH_AFTER_PHOTO_PATH: Shape;
  PUNCH_SEAL_PHOTO_PATH: Shape;
  PUNCH_SEAL_RECORD_PATH: Shape;
  MESSAGE_ATTACHMENT_PATH: Shape;
  PROJECT_PHOTO_PATH: Shape;
  RFP_ATTACHMENT_PATH: Shape;
  isStorageId(v: unknown): boolean;
  storagePinIndexIsSegment(index: string, count: number): boolean;
  storagePathHasForbiddenChar(path: string): boolean;
  storagePathSegments(path: string): string[] | null;
  storageSegmentMatches(segment: string, rule: SegmentRule): boolean;
  storagePathSurvivesUrlParser(path: string): boolean;
  requestStoragePath(raw: unknown, shape: Shape, pinned?: Record<string, string>): string | null;
  storagePathSegment(path: string, index: number): string;
  planSheetPagePath(projectId: unknown, baseId: unknown, pageNumber: unknown): string | null;
  contractPdfPath(userId: unknown, contractId: unknown): string | null;
  punchSealPhotoPath(userId: unknown, sealId: unknown, itemId: unknown): string | null;
  punchSealRecordPath(userId: unknown, sealId: unknown): string | null;
}
const FN_ROOT = 'supabase/functions';
const RULE_FILE = `${FN_ROOT}/_shared/storagePath.ts`;
const fromHere = (repoPath: string) => ['..', ...repoPath.split('/')].join('/');
const rule = await import(fromHere(RULE_FILE)) as StoragePathModule;
const {
  PLAN_SHEET_PATH, PDF_UPLOAD_PATH, CONTRACT_PDF_PATH, PUNCH_AFTER_PHOTO_PATH,
  PUNCH_SEAL_PHOTO_PATH, PUNCH_SEAL_RECORD_PATH, MESSAGE_ATTACHMENT_PATH, PROJECT_PHOTO_PATH, RFP_ATTACHMENT_PATH,
  requestStoragePath,
} = rule;

// Ids as the server prints them. OWN is the caller, VICTIM is somebody else.
const UID = '0b9f2c1e-7a44-4d0e-9c1b-3f6a5e2d8c47';
const OWN = '4c1d7e9a-2b35-4f68-8a0c-9d1e2f3a4b5c';
const VICTIM = 'e7a1c3b5-9d2f-4a6c-8e0b-1f3d5a7c9e2b';
const VICTIM_UID = 'a3f5c7e9-1b2d-4c6e-8f0a-2b4d6f8a0c1e';
const BASE = '6f2e4d8c-0a1b-4c3d-9e5f-7a8b9c0d1e2f';
const ITEM = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

// ── 1. every key a current or older app version sends is accepted ───────────
console.log('\n1. legitimate keys, as their writers build them:');

interface Legit { name: string; shape: Shape; path: string | null; pinned?: Record<string, string> }
const legit: Legit[] = [];

// plan-sheets — the server writer (convert-pdf-to-images, since its first version).
for (const n of [1, 2, 24, 200]) {
  legit.push({ name: `plan-sheets: rendered page ${n}`, shape: PLAN_SHEET_PATH, path: rule.planSheetPagePath(OWN, BASE, n) });
}
ok('planSheetPagePath is <project>/<base>-page-<N>.png', rule.planSheetPagePath(OWN, BASE, 7) === `${OWN}/${BASE}-page-7.png`,
  show(rule.planSheetPagePath(OWN, BASE, 7)));
// plan-sheets — the app writer, EXECUTED (utils/planSheetImageCore.ts).
for (const ext of ['jpg', 'png'] as const) {
  legit.push({ name: `plan-sheets: an imported image (.${ext})`, shape: PLAN_SHEET_PATH, path: buildPlanSheetImagePath(OWN, BASE, ext) });
}
legit.push({ name: 'plan-sheets: an image id the app had to sanitise', shape: PLAN_SHEET_PATH, path: buildPlanSheetImagePath(OWN, 'sheet A/1 (rev.2)', 'jpg') });
// The two key shapes production holds under a project folder (read-only aggregate, 2026-10-04).
legit.push({ name: 'plan-sheets: production shape <project>/<3 letters>-<uuid>.<ext>', shape: PLAN_SHEET_PATH, path: `${OWN}/img-${BASE}.jpg` });

// pdf-uploads — utils/pdfRenderClient.ts cannot load under bun (it imports the
// Supabase client), so its two lines are pinned as text and re-run here.
const pdfClient = read('utils/pdfRenderClient.ts');
ok('pdfRenderClient still reduces the file name to [a-zA-Z0-9._-], 60 characters',
  pdfClient.includes("const safeName = (fileName ?? 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);"));
ok('pdfRenderClient still builds <userId>/<uuid>-<name>.pdf',
  pdfClient.includes("const storagePath = `${userId}/${uuid}-${safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`}`;"));
const pdfKeyFor = (fileName: string | undefined): string => {
  const safeName = (fileName ?? 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  return `${UID}/${BASE}-${safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`}`;
};
const PDF_NAMES: (string | undefined)[] = [
  undefined, 'document.pdf', 'A-101 Floor Plan (rev 3).pdf', 'SPEC BOOK.PDF', '', '..', '.pdf', '../../etc/passwd',
  '%2e%2e/%2e%2e/x.pdf', 'plans\\..\\x.pdf', '図面 第2版.pdf', 'a'.repeat(200) + '.pdf', 'x?y#z.pdf', ' leading and trailing .pdf ',
];
for (const n of PDF_NAMES) {
  legit.push({ name: `pdf-uploads: a PDF the user named ${show(n)}`, shape: PDF_UPLOAD_PATH, path: pdfKeyFor(n), pinned: { 0: UID } });
}

// secure-contracts — utils/contractSealing.ts.
ok('contractSealing still uploads to <userId>/<contract id>.pdf',
  read('utils/contractSealing.ts').includes('const storagePath = `${userId}/${contract.id}.pdf`;'));
legit.push({ name: 'secure-contracts: the sealed contract', shape: CONTRACT_PDF_PATH, path: `${UID}/${BASE}.pdf`, pinned: { 0: UID } });
ok('contractPdfPath rebuilds exactly what the app uploads', rule.contractPdfPath(UID, BASE) === `${UID}/${BASE}.pdf`);

// project-photos, a punch after photo — the app writer, EXECUTED.
ok('the after photo is still staged as punch-<id>-after under the item’s project',
  /stagePhotoUpload\(\{\s*userId, projectId: item\.projectId, recordId: `punch-\$\{item\.id\}-after`/.test(read('contexts/ProjectContext.tsx')));
for (const ext of ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']) {
  legit.push({
    name: `project-photos: a punch after photo (.${ext})`, shape: PUNCH_AFTER_PHOTO_PATH,
    path: buildPhotoStoragePath(UID, OWN, `punch-${ITEM}-after`, ext), pinned: { 0: UID, 1: OWN },
  });
}

// project-photos, any jobsite photo — the one key builder, EXECUTED with every
// record-id form its callers use and every extension photoExtFromUri answers.
const photoCore = read('utils/photoUploadCore.ts');
ok('buildPhotoStoragePath is still <user>/<project>/<record id>.<ext>, each part reduced to [a-zA-Z0-9._-]',
  photoCore.includes("const safe = (s: string) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_');")
  && photoCore.includes('return `${safe(userId)}/${safe(projectId)}/${safe(photoId)}.${safe(ext)}`;'));
const photoExtBlock = /const CONTENT_TYPE_BY_EXT: Record<string, string> = \{([\s\S]*?)\};/.exec(photoCore)?.[1] ?? '';
const PHOTO_WRITER_EXTS = [...photoExtBlock.matchAll(/^\s*([a-z0-9]+):/gm)].map((m) => m[1]).sort();
ok('the photo writer\'s extensions are exactly the six the project-photos shapes allow',
  PHOTO_WRITER_EXTS.join(',') === 'heic,heif,jpeg,jpg,png,webp' && /return CONTENT_TYPE_BY_EXT\[ext\] \? ext : 'jpg';/.test(photoCore),
  PHOTO_WRITER_EXTS.join(','));
const PHOTO_RECORD_IDS = [ITEM, `punch-${ITEM}`, `punch-${ITEM}-after`, `punch-${ITEM}-rlz4k2a9`, `hazard-${ITEM}`, `incident-${ITEM}`, `permit-${ITEM}`];
for (const recordId of PHOTO_RECORD_IDS) {
  for (const ext of PHOTO_WRITER_EXTS) {
    legit.push({
      name: `project-photos: ${recordId.replace(ITEM, '<id>')}.${ext}`, shape: PROJECT_PHOTO_PATH,
      path: buildPhotoStoragePath(UID, OWN, recordId, ext), pinned: { 0: UID, 1: OWN },
    });
  }
}
// The key shape production holds (read-only aggregate, 2026-10-04): 64 objects, all <uuid>/<uuid>/<word>-<uuid>.jpg.
legit.push({ name: 'project-photos: production shape <user>/<project>/<word>-<uuid>.jpg', shape: PROJECT_PHOTO_PATH, path: `${UID}/${OWN}/photo-${ITEM}.jpg`, pinned: { 1: OWN } });

// rfp-attachments — utils/storage.ts cannot load under bun (it imports the
// Supabase client), so uploadRfpAttachment's two lines are pinned as text and re-run here.
const storageUtil = read('utils/storage.ts');
ok('uploadRfpAttachment still reduces the file name to [a-zA-Z0-9._-]',
  storageUtil.includes("const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');"));
ok('uploadRfpAttachment still builds <userId>/<rfpId>/<stamp>_<name>',
  storageUtil.includes('const path = `${userId}/${rfpId}/${Date.now()}_${safeName}`;'));
const rfpKeyFor = (fileName: string): string => `${UID}/${BASE}/1759593600000_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
// What the two pickers in app/post-rfp.tsx hand over: a library photo's own file name, or ANY file from Files
// (the picker's type list is `application/pdf` + `image/*`, which on iOS is every image type the system knows,
// and on the web only a hint). The writer keeps the name, so every extension, every case, and no extension
// at all are real keys — the shape is a pattern, not an extension list.
const RFP_NAMES = ['IMG_0012.JPG', 'IMG_0012.HEIC', 'photo-1759593600000.jpg', 'Kitchen (north wall).png', 'A-101 Floor Plan rev 3.pdf', 'SPEC BOOK.PDF',
  'scan.jpeg', 'sketch.webp', 'site.gif', 'elevation.TIFF', 'survey.bmp', 'render.avif', '図面 第2版.pdf', '../../etc/passwd.pdf', '%2e%2e/x.png', 'x?y#z.pdf', 'a'.repeat(100) + '.pdf',
  'scan.jfif', 'logo.svg', 'raw.dng', 'icon.ico', 'photo.jp2', 'img.jxl', 'a.jpe', 'Drawing.Pdf', 'IMG_0012.Jpg', 'notes.docx', 'plan.dwg', 'takeoff.xlsx', 'README', 'Makefile',
  'archive.tar.gz', 'notes.', '.hidden', '..', '.', '-rf.pdf', '_', 'a'.repeat(115) + '.pdf', 'a'.repeat(140) + '.pdf', 'a'.repeat(164) + '.pdf'];
for (const n of RFP_NAMES) {
  legit.push({ name: `rfp-attachments: a file the user named ${show(n)}`, shape: RFP_ATTACHMENT_PATH, path: rfpKeyFor(n), pinned: { 0: UID } });
}
// The key shapes production holds (read-only aggregate, 2026-10-04): <uuid>/<uuid>/<digits>_<name>.<jpg|png|pdf|one longer extension>.
// The longer one is not named in the aggregate; the pattern takes any extension, so it is covered whatever it is.
for (const ext of ['jpg', 'png', 'pdf', 'jpeg', 'heic', 'heif', 'webp', 'tiff', 'avif', 'docx', 'jfif']) {
  legit.push({ name: `rfp-attachments: production shape <user>/<rfp>/<digits>_<name>.${ext}`, shape: RFP_ATTACHMENT_PATH, path: `${UID}/${BASE}/1759593600000_site_photo-2.${ext}`, pinned: { 0: UID } });
}
// A device whose clock is wrong still prints digits: any stamp Date.now() can print is taken.
for (const stamp of ['0', '86400000', '999999999999', '1759593600000', '9007199254740991']) {
  legit.push({ name: `rfp-attachments: a ${stamp.length}-digit stamp`, shape: RFP_ATTACHMENT_PATH, path: `${UID}/${BASE}/${stamp}_plan.pdf`, pinned: { 0: UID } });
}

// punch-seals.
ok('punchSealShare still uploads the record to <userId>/<sealId>/record.pdf',
  read('utils/punchSealShare.ts').includes('return `${userId}/${sealId}/record.pdf`;'));
legit.push({ name: 'punch-seals: the sealed record PDF', shape: PUNCH_SEAL_RECORD_PATH, path: `${UID}/${BASE}/record.pdf`, pinned: { 0: UID, 1: BASE } });
ok('punchSealRecordPath rebuilds exactly what the app uploads', rule.punchSealRecordPath(UID, BASE) === `${UID}/${BASE}/record.pdf`);
legit.push({ name: 'punch-seals: a copied after photo', shape: PUNCH_SEAL_PHOTO_PATH, path: rule.punchSealPhotoPath(UID, BASE, ITEM), pinned: { 0: UID, 1: BASE } });

// message-attachments: both writers, EXECUTED (the server's pathFor is imported
// in section 6; the app's messageAttachmentPath here). The database trigger
// refuses a row whose path is anything else.
const MSG_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const MSG_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
for (const mime of MSG_MIMES) {
  legit.push({
    name: `message-attachments: a file the app sends (.${MSG_EXT[mime]})`, shape: MESSAGE_ATTACHMENT_PATH,
    path: messageAttachmentPath(OWN, BASE, ITEM, mime), pinned: { 0: OWN, 1: BASE },
  });
}
legit.push({
  name: 'message-attachments: ids the app was handed in upper case are lower-cased by the writer', shape: MESSAGE_ATTACHMENT_PATH,
  path: messageAttachmentPath(OWN.toUpperCase(), BASE.toUpperCase(), ITEM.toUpperCase(), 'image/png'), pinned: { 0: OWN, 1: BASE },
});
ok('messageAttachmentPath is <project>/<message>/<attachment>.<ext>, all lower-case ids',
  messageAttachmentPath(OWN, BASE, ITEM, 'application/pdf') === `${OWN}/${BASE}/${ITEM}.pdf`);
ok('the trigger still builds the same key for a row (project || / || id || / || attachment id || . || ext)',
  read('supabase/migrations/20261001150000_portal_message_attachments.sql').includes("v_path := new.project_id || '/' || new.id::text || '/' || v_id || '.' || v_ext;"));

for (const l of legit) {
  const got = l.path === null ? null : requestStoragePath(l.path, l.shape, l.pinned);
  ok(`${l.name} is accepted, unchanged`, l.path !== null && got === l.path, `path ${show(l.path)} -> ${show(got)}`);
}

// Refused on purpose, and it stays refused: no membership check exists for a
// folder that is not a project (file comment in _shared/planSheetBytes.ts).
ok("plan-sheets: the legacy shared 'tmp/' prefix is still refused (production holds 7 such objects)",
  requestStoragePath(`tmp/${BASE}-page-1.png`, PLAN_SHEET_PATH) === null);
ok('plan-sheets: a deeper key than any writer makes is refused',
  requestStoragePath(`${OWN}/rev2/a.png`, PLAN_SHEET_PATH) === null);
// rfp-attachments keeps the picked file's own name, so the shape takes any name the writer lets through.
// The ONE thing it does not take is said here so nobody finds it by surprise: a name so long that the whole
// key passes the path cap. delete-account (its one reader) removes such an object through its walk of the
// user's folder, not by row.
ok('rfp-attachments: the longest name the path cap leaves room for is taken (168 characters behind a 13-digit stamp, a 256-character key), one more is refused',
  rfpKeyFor('a'.repeat(168)).length === rule.STORAGE_PATH_MAX_LENGTH && requestStoragePath(rfpKeyFor('a'.repeat(168)), RFP_ATTACHMENT_PATH, { 0: UID }) === rfpKeyFor('a'.repeat(168))
  && requestStoragePath(rfpKeyFor('a'.repeat(169)), RFP_ATTACHMENT_PATH, { 0: UID }) === null && requestStoragePath(rfpKeyFor('a'.repeat(255)), RFP_ATTACHMENT_PATH, { 0: UID }) === null);
ok('rfp-attachments: a key that is not <digits>_<name> is refused — no stamp, no underscore, a stamp that is not digits, a name the writer would have rewritten',
  [`${UID}/${BASE}/plan.pdf`, `${UID}/${BASE}/1759593600000plan.pdf`, `${UID}/${BASE}/1759593600000-plan.pdf`, `${UID}/${BASE}/_plan.pdf`, `${UID}/${BASE}/17x9_plan.pdf`,
    `${UID}/${BASE}/-1759593600000_plan.pdf`, `${UID}/${BASE}/1.5e12_plan.pdf`, `${UID}/${BASE}/1759593600000_pl an.pdf`, `${UID}/${BASE}/1759593600000_plan(1).pdf`,
    `${UID}/${BASE}/1759593600000_pl%61n.pdf`, `${UID}/${BASE}/1759593600000_plán.pdf`, `${UID}/${BASE}/1759593600000_a+b.pdf`, `${UID}/${BASE}/1759593600000_a,b.pdf`,
    `${UID}/${BASE}/1759593600000_a~b.pdf`, `${UID}/${BASE}/1759593600000_a:b.pdf`, `${UID}/${BASE}/1759593600000_a@b.pdf`, `${UID}/${BASE}/1759593600000_a;b.pdf`,
    `${UID}/1759593600000_plan.pdf`, `${UID}/${BASE}/sub/1759593600000_plan.pdf`,
  ].every((k) => requestStoragePath(k, RFP_ATTACHMENT_PATH, { 0: UID }) === null));

// ── 2. the attack corpus ────────────────────────────────────────────────────
console.log('\n2. the attack corpus is refused for every shape:');

/** Attack strings against a shape whose legitimate key is `<own…>/<file>`; the target is `<victim…>/<file>`. */
function attacks(own: string, victim: string, f: string): { name: string; path: unknown }[] {
  const a: { name: string; path: unknown }[] = [];
  const add = (name: string, path: unknown) => a.push({ name, path });
  add('a literal ..', `${own}/../${victim}/${f}`);
  for (const dots of ['%2e%2e', '%2E%2E', '.%2e', '%2e.', '.%2E', '%2E.', '%2e%2E']) add(`an encoded dot segment ${dots}`, `${own}/${dots}/${victim}/${f}`);
  add('..%2f', `${own}/..%2f${victim}%2f${f}`);
  add('..%2F twice', `${own}/..%2F..%2F${f}`);
  add('a double-encoded %252e%252e', `${own}/%252e%252e/${victim}/${f}`);
  add('backslashes for every slash', `${own}\\..\\${victim}\\${f}`);
  add('one backslash segment', `${own}/..\\${victim}/${f}`);
  add('an encoded backslash %5c', `${own}/..%5c${victim}%5c${f}`);
  add('..;/', `${own}/..;/${victim}/${f}`);
  add('a NUL at the end', `${own}/${f}\u0000`);
  add('a NUL inside a dot segment', `${own}/.\u0000./${victim}/${f}`);
  add('an encoded NUL %00', `${own}/..%00/${victim}/${f}`);
  add('a tab inside a dot segment', `${own}/.\t./${victim}/${f}`);
  add('a newline inside a dot segment', `${own}/.\n./${victim}/${f}`);
  add('a carriage return inside a dot segment', `${own}/.\r./${victim}/${f}`);
  add('a trailing newline', `${own}/${f}\n`);
  add('a DEL character', `${own}/${f}\u007f`);
  add('an overlong %c0%ae%c0%ae', `${own}/%c0%ae%c0%ae/${victim}/${f}`);
  add('an overlong %e0%80%ae', `${own}/%e0%80%ae%e0%80%ae/${victim}/${f}`);
  add('fullwidth dots', `${own}/\uff0e\uff0e/${victim}/${f}`);
  add('an encoded fullwidth dot', `${own}/%ef%bc%8e%ef%bc%8e/${victim}/${f}`);
  add('a two-dot leader', `${own}/\u2025/${victim}/${f}`);
  add('a fullwidth slash', `${own}\uff0f..\uff0f${victim}\uff0f${f}`);
  add('a division slash', `${own}\u2215${f}`);
  add('a no-break space', `${own}/${f}\u00a0`);
  add('a trailing dot', `${own}/${f}.`);
  add('two trailing dots', `${own}/${f}..`);
  add('a trailing space', `${own}/${f} `);
  add('a leading space', ` ${own}/${f}`);
  add('a query', `${own}/${f}?download=1`);
  add('a query on a dot segment', `${own}/..?/${victim}/${f}`);
  add('a fragment', `${own}/${f}#x`);
  add('an empty segment //', `${own}//${f}`);
  add('an empty segment before the target', `${own}//${victim}/${f}`);
  add('a leading slash', `/${own}/${f}`);
  add('two leading slashes', `//${own}/${f}`);
  add('a trailing slash', `${own}/${f}/`);
  add('a single dot segment', `${own}/./${f}`);
  add('an encoded single dot', `${own}/%2e/${f}`);
  add('an extra segment', `${own}/sub/${f}`);
  add('the target appended as extra segments', `${own}/${victim}/${f}`);
  add('a missing file segment', own);
  add('a missing folder', f);
  add('an empty string', '');
  add('a 4 KB file name', `${own}/${'a'.repeat(4096)}.${f.split('.').pop()}`);
  add('a 4 KB path of short segments', `${own}/${'a/'.repeat(2048)}${f}`);
  add("another bucket's name, two encoded dot segments up", `${own}/%2e%2e/%2e%2e/secure-contracts/${victim}/${f}`);
  add("another bucket's name, two literal dot segments up", `${own}/../../secure-contracts/${victim}/${f}`);
  add("another bucket's name as the folder", `secure-contracts/${f}`);
  add('a URL', `https://evil.example/${own}/${f}`);
  add('a file: URL', 'file:///etc/passwd');
  add('a hidden file', `${own}/.${f}`);
  add('a file name starting with a dash', `${own}/-${f}`);
  add('no extension', `${own}/${f.split('.')[0]}`);
  add('an extension no writer uses', `${own}/${f.split('.')[0]}.exe`);
  add('an allowed extension that is not the last one', `${own}/${f}.exe`);
  add('an uppercase extension', `${own}/${f.split('.')[0]}.${String(f.split('.').pop()).toUpperCase()}`);
  add('an uppercase id', `${own.toUpperCase()}/${f}`);
  add('a braced id', `{${own.split('/')[0]}}${own.slice(36)}/${f}`);
  add('a hyphenless id', `${own.split('/')[0].replace(/-/g, '')}${own.slice(36)}/${f}`);
  add('null', null);
  add('undefined', undefined);
  add('a number', 42);
  add('an array holding a good path', [`${own}/${f}`]);
  add('an object', { path: `${own}/${f}` });
  add('a String object', new String(`${own}/${f}`));
  return a;
}

/** `benign` names corpus forms that ARE that bucket's writer output (never a traversal): the shape must take exactly those and no other. */
interface Target { name: string; shape: Shape; own: string; victim: string; file: string; pinned?: Record<string, string>; benign?: string[] }
const TARGETS: Target[] = [
  { name: 'plan-sheets', shape: PLAN_SHEET_PATH, own: OWN, victim: VICTIM, file: `${BASE}-page-1.png` },
  { name: 'pdf-uploads', shape: PDF_UPLOAD_PATH, own: UID, victim: VICTIM_UID, file: `${BASE}-plans.pdf`, pinned: { 0: UID } },
  { name: 'secure-contracts', shape: CONTRACT_PDF_PATH, own: UID, victim: VICTIM_UID, file: `${BASE}.pdf`, pinned: { 0: UID } },
  { name: 'project-photos (after photo)', shape: PUNCH_AFTER_PHOTO_PATH, own: `${UID}/${OWN}`, victim: `${VICTIM_UID}/${VICTIM}`, file: `punch-${ITEM}-after.jpg`, pinned: { 0: UID, 1: OWN } },
  { name: 'punch-seals (photo)', shape: PUNCH_SEAL_PHOTO_PATH, own: `${UID}/${BASE}`, victim: `${VICTIM_UID}/${BASE}`, file: `${ITEM}.jpg`, pinned: { 0: UID, 1: BASE } },
  { name: 'punch-seals (record)', shape: PUNCH_SEAL_RECORD_PATH, own: `${UID}/${BASE}`, victim: `${VICTIM_UID}/${BASE}`, file: 'record.pdf', pinned: { 0: UID, 1: BASE } },
  { name: 'message-attachments', shape: MESSAGE_ATTACHMENT_PATH, own: `${OWN}/${BASE}`, victim: `${VICTIM}/${BASE}`, file: `${ITEM}.jpg`, pinned: { 0: OWN, 1: BASE } },
  { name: 'project-photos (any photo)', shape: PROJECT_PHOTO_PATH, own: `${UID}/${OWN}`, victim: `${VICTIM_UID}/${VICTIM}`, file: `photo-${ITEM}.jpg`, pinned: { 0: UID, 1: OWN } },
  // uploadRfpAttachment keeps the picked file's own name: a trailing dot, no extension, any extension in any
  // case are all names a device hands over (`plan.pdf.`, `README`, `tool.exe`, `IMG_0012.JPG`). None is a traversal.
  { name: 'rfp-attachments', shape: RFP_ATTACHMENT_PATH, own: `${UID}/${BASE}`, victim: `${VICTIM_UID}/${BASE}`, file: '1759593600000_plan.pdf', pinned: { 0: UID },
    benign: ['a trailing dot', 'two trailing dots', 'no extension', 'an extension no writer uses', 'an allowed extension that is not the last one', 'an uppercase extension'] },
];
let corpusSize = 0;
for (const t of TARGETS) {
  const corpus = attacks(t.own, t.victim, t.file);
  corpusSize = corpus.length;
  const benign = t.benign ?? [];
  const taken = corpus.filter((c) => requestStoragePath(c.path, t.shape, t.pinned) !== null);
  const accepted = taken.filter((c) => !benign.includes(c.name));
  ok(`${t.name}: all ${corpus.length - benign.length} attack forms are refused`, accepted.length === 0,
    accepted.map((c) => `${c.name}: ${show(c.path)}`).join('\n      '));
  if (benign.length > 0) {
    ok(`${t.name}: the only corpus form it takes is its writer's own output (${benign.join(', ')}), still inside the caller's folder`,
      JSON.stringify(taken.map((c) => c.name)) === JSON.stringify(benign)
      && taken.every((c) => typeof c.path === 'string' && c.path.startsWith(`${t.own}/`) && c.path.split('/').length === t.shape.segments.length && !c.path.includes('/.')),
      taken.map((c) => c.name).join(', '));
  }
  // The same key in someone else's folder is a perfectly shaped key — only the pin refuses it.
  if (t.pinned) {
    ok(`${t.name}: a well-formed key in ANOTHER tenant's folder is refused by the pin`,
      requestStoragePath(`${t.victim}/${t.file}`, t.shape, t.pinned) === null
      && requestStoragePath(`${t.victim}/${t.file}`, t.shape) === `${t.victim}/${t.file}`);
    ok(`${t.name}: a pin that is missing at runtime refuses (never "no pin, so anything")`,
      requestStoragePath(`${t.own}/${t.file}`, t.shape, { 0: undefined as unknown as string }) === null
      && requestStoragePath(`${t.own}/${t.file}`, t.shape, { 0: '' }) === null
      && requestStoragePath(`${t.own}/${t.file}`, t.shape, { 9: UID }) === null);
    // A pinned key that is not a segment index used to be skipped, so `{ project: id }` pinned nothing
    // and the path was accepted for ANY folder. Each key below is given the value segment 0 really has,
    // so the key is the only thing wrong with the pin.
    const good = `${t.own}/${t.file}`;
    const seg0 = good.split('/')[0];
    const BAD_PIN_KEYS = ['project', 'user', 'zero', '0,1', 'NaN', '01', '00', ' 0', '0 ', '-0', '-1', '0.0', '1.5', '1e0', '0x0', '', String(t.shape.segments.length), '99'];
    const pinAnswer = (pin: unknown): string | null | 'threw' => {
      try { return requestStoragePath(good, t.shape, pin as Record<string, string>); } catch { return 'threw'; }
    };
    const pinLeaks = BAD_PIN_KEYS.filter((k) => pinAnswer({ [k]: seg0 }) !== null || pinAnswer({ ...t.pinned, [k]: seg0 }) !== null);
    ok(`${t.name}: a pinned key that names no segment refuses (${BAD_PIN_KEYS.length} keys, alone and beside the real pins)`, pinLeaks.length === 0, pinLeaks.map(show).join(', '));
    ok(`${t.name}: a pin that is not an object refuses instead of throwing`,
      [null, 'x', 7, true].every((pin) => pinAnswer(pin) === null), [null, 'x', 7, true].map((pin) => String(pinAnswer(pin))).join(', '));
    // A pin with no key Object.keys would show is still a pin that binds nothing. Each one below carries the
    // value of ANOTHER tenant's folder for segment 0, so reading it as "no pin" accepts the caller's own key
    // and reading it as a pin refuses it: either way the right answer is a refusal of the pin itself.
    const other = `${t.victim}/${t.file}`;
    const otherSeg0 = other.split('/')[0];
    const ODD_PINS: [string, () => unknown][] = [
      ['a Map', () => new Map([[0, seg0]])],
      ['a Set', () => new Set([seg0])],
      ['an array', () => [seg0]],
      ['an object that inherits its key', () => Object.create({ 0: seg0 })],
      ['a symbol key', () => ({ [Symbol('0')]: seg0 })],
      ['a symbol key beside a real pin', () => ({ 0: seg0, [Symbol.iterator]: seg0 })],
      ['a non-enumerable key that names no segment', () => Object.defineProperty({ 0: seg0 }, 'project', { value: seg0, enumerable: false })],
      ['a class instance', () => new (class Pin { 0 = seg0; })()],
      ['a function', () => Object.assign(() => seg0, { 0: seg0 })],
      ['a Date', () => new Date(0)],
    ];
    const oddLeaks = ODD_PINS.filter(([, make]) => pinAnswer(make()) !== null || (() => { try { return requestStoragePath(other, t.shape, make() as Record<string, string>) !== null; } catch { return true; } })());
    ok(`${t.name}: a pin that is not a plain object of segment indexes refuses (${ODD_PINS.length} kinds: a Map, an array, an inherited key, a symbol key, a hidden key that names no segment…)`, oddLeaks.length === 0, oddLeaks.map(([n]) => n).join(', '));
    ok(`${t.name}: a non-enumerable pin IS read: a hidden pin for another tenant's folder refuses the caller's key, a hidden pin for the caller's accepts it`,
      pinAnswer(Object.defineProperty({}, '0', { value: otherSeg0, enumerable: false })) === null
      && pinAnswer(Object.assign(Object.create(null), { 0: seg0 })) === good && pinAnswer(Object.assign(Object.create(null), { 0: otherSeg0 })) === null);
    ok(`${t.name}: the real pins still accept the key, unchanged`, pinAnswer(t.pinned) === good && pinAnswer({ 0: seg0 }) === good);
  }
}

// ── 3. each layer, alone ────────────────────────────────────────────────────
console.log('\n3. each layer of the rule, tested alone:');

const FORBIDDEN_SAMPLES: [string, string][] = [
  ['%', 'a percent sign'], ['\\', 'a backslash'], ['?', 'a question mark'], ['#', 'a hash'], [' ', 'a space'],
  ['\t', 'a tab'], ['\n', 'a newline'], ['\r', 'a carriage return'], ['\u0000', 'a NUL'], ['\u001f', 'a C0 control'],
  ['\u007f', 'DEL'], ['\u0085', 'a C1 control'], ['\u00a0', 'a no-break space'], ['\uff0e', 'a fullwidth dot'],
  ['\u2028', 'a line separator'], ['\ufeff', 'a byte-order mark'], ['\ud83d\ude00', 'an astral character'],
];
for (const [ch, label] of FORBIDDEN_SAMPLES) {
  ok(`forbidden-character layer refuses ${label}`, rule.storagePathHasForbiddenChar(`${OWN}/a${ch}b.png`) === true);
}
ok('forbidden-character layer passes every legitimate key', legit.every((l) => l.path !== null && !rule.storagePathHasForbiddenChar(l.path)));

for (const bad of ['', '/', 'a//b', '/a/b', 'a/b/', 'a/./b', 'a/../b', '..', '.', 'a/..', './a']) {
  ok(`segment layer refuses ${show(bad)}`, rule.storagePathSegments(bad) === null);
}
ok('segment layer splits a plain key', JSON.stringify(rule.storagePathSegments('a/b/c.png')) === '["a","b","c.png"]');

const ID_RULE: SegmentRule = { kind: 'id' };
const PNG_RULE: SegmentRule = { kind: 'file', extensions: ['png', 'jpg'] };
ok('id layer accepts a lowercase canonical uuid', rule.storageSegmentMatches(OWN, ID_RULE));
for (const bad of [OWN.toUpperCase(), `{${OWN}}`, OWN.replace(/-/g, ''), `${OWN} `, `${OWN}x`, OWN.slice(1), 'tmp', '']) {
  ok(`id layer refuses ${show(bad)}`, rule.storageSegmentMatches(bad, ID_RULE) === false);
}
for (const good of ['a.png', 'img-1.jpg', `${BASE}-page-12.png`, 'A_b.c-d.png', 'a..png']) {
  ok(`file layer accepts ${show(good)}`, rule.storageSegmentMatches(good, PNG_RULE));
}
for (const bad of ['.png', '.a.png', '-a.png', '_a.png', 'a', 'png', 'a.png.', 'a.PNG', 'a.gif', 'a.png.exe', 'a b.png', 'a%2e.png', 'a/b.png', 'a;.png', 'a..', `${'a'.repeat(rule.STORAGE_FILE_NAME_MAX_LENGTH)}.png`]) {
  ok(`file layer refuses ${show(bad)}`, rule.storageSegmentMatches(bad, PNG_RULE) === false);
}
const ID_FILE_RULE: SegmentRule = { kind: 'idFile', extensions: ['jpg', 'png', 'webp', 'pdf'] };
for (const good of [`${ITEM}.jpg`, `${ITEM}.png`, `${ITEM}.webp`, `${ITEM}.pdf`]) {
  ok(`id-file layer accepts ${show(good)}`, rule.storageSegmentMatches(good, ID_FILE_RULE));
}
for (const bad of [ITEM, `${ITEM}.`, `${ITEM}.gif`, `${ITEM}.JPG`, `${ITEM}.jpg.exe`, `${ITEM}.pdf.jpg`, `${ITEM}..jpg`, `${ITEM.toUpperCase()}.jpg`, `${ITEM.replace(/-/g, '')}.jpg`,
  `x${ITEM}.jpg`, `${ITEM}x.jpg`, `${ITEM.slice(1)}.jpg`, `${ITEM}-page-1.jpg`, 'photo.jpg', '.jpg', 'jpg', '', `${ITEM}.jpg `, `${ITEM}/a.jpg`, `${ITEM}%2ejpg`]) {
  ok(`id-file layer refuses ${show(bad)}`, rule.storageSegmentMatches(bad, ID_FILE_RULE) === false);
}
ok('message-attachments: a safe file name that is not an id is refused (the plain file layer would take it)',
  requestStoragePath(`${OWN}/${BASE}/photo.jpg`, MESSAGE_ATTACHMENT_PATH) === null
  && requestStoragePath(`${OWN}/${BASE}/${ITEM}-copy.jpg`, MESSAGE_ATTACHMENT_PATH) === null
  && rule.storageSegmentMatches('photo.jpg', { kind: 'file', extensions: ['jpg'] }));
ok('literal layer is exact', rule.storageSegmentMatches('record.pdf', { kind: 'literal', value: 'record.pdf' })
  && !rule.storageSegmentMatches('record.pdf ', { kind: 'literal', value: 'record.pdf' })
  && !rule.storageSegmentMatches('Record.pdf', { kind: 'literal', value: 'record.pdf' }));

// The stamped-name layer (rfp-attachments): `<digits>_<what the writer lets through>`, and nothing else.
const STAMPED_RULE: SegmentRule = { kind: 'stampedName' };
const STAMP = '1759593600000';
const stampedMax = rule.STORAGE_STAMPED_NAME_MAX_LENGTH;
for (const good of [`${STAMP}_plan.pdf`, `${STAMP}_IMG_0012.JPG`, `${STAMP}_Drawing.Pdf`, `${STAMP}_scan.jfif`, `${STAMP}_logo.svg`, `${STAMP}_notes.docx`, `${STAMP}_README`,
  `${STAMP}_`, `${STAMP}_.`, `${STAMP}_..`, `${STAMP}_.hidden`, `${STAMP}_-rf`, `${STAMP}__`, `${STAMP}_a.tar.gz`, `${STAMP}_plan.pdf.`, '0_a', '9007199254740991_a.png',
  `${STAMP}_${'a'.repeat(stampedMax - STAMP.length - 1)}`]) {
  ok(`stamped-name layer accepts ${show(good)}`, rule.storageSegmentMatches(good, STAMPED_RULE));
}
for (const bad of ['', '_', '_plan.pdf', 'plan.pdf', STAMP, `${STAMP}plan.pdf`, `${STAMP}-plan.pdf`, `${STAMP}.plan.pdf`, `x${STAMP}_plan.pdf`, `-${STAMP}_plan.pdf`, `.${STAMP}_plan.pdf`,
  `+${STAMP}_plan.pdf`, ` ${STAMP}_plan.pdf`, `${STAMP}_plan.pdf `, `${STAMP}_plan.pdf\n`, `${STAMP} _plan.pdf`, '1.5_plan.pdf', '1e3_plan.pdf', '0x1_plan.pdf', '\uff11_plan.pdf',
  '12345678901234567_plan.pdf', `${STAMP}_pl an.pdf`, `${STAMP}_pl/an.pdf`, `${STAMP}_pl\\an.pdf`, `${STAMP}_pl%2ean.pdf`, `${STAMP}_plan.pdf?x`, `${STAMP}_plan.pdf#x`,
  `${STAMP}_plan(1).pdf`, `${STAMP}_a+b`, `${STAMP}_a,b`, `${STAMP}_a;b`, `${STAMP}_a:b`, `${STAMP}_a@b`, `${STAMP}_a~b`, `${STAMP}_a&b`, `${STAMP}_a=b`, `${STAMP}_a'b`, `${STAMP}_a"b`,
  `${STAMP}_a*b`, `${STAMP}_a|b`, `${STAMP}_a<b`, `${STAMP}_a$b`, `${STAMP}_a!b`, `${STAMP}_a\u0000b`, `${STAMP}_pl\u00e1n.pdf`, `${STAMP}_\uff0e\uff0e`,
  `${STAMP}_${'a'.repeat(stampedMax - STAMP.length)}`, `${STAMP}_${'a'.repeat(4096)}`]) {
  ok(`stamped-name layer refuses ${show(bad)}`, rule.storageSegmentMatches(bad, STAMPED_RULE) === false);
}
ok('stamped-name layer: its length cap is exactly what the path cap leaves after two id folders, so the two cannot drift apart',
  stampedMax === rule.STORAGE_PATH_MAX_LENGTH - 2 * (OWN.length + 1) && stampedMax === 182);
{
  // Every character, one at a time: the name part takes the 65 the writer lets through and no other (the first 256 code points and a few beyond).
  const taken: string[] = [];
  for (const code of [...Array(256).keys(), 0x2028, 0xff0e, 0xfeff, 0x1f600]) {
    const ch = String.fromCodePoint(code);
    if (rule.storageSegmentMatches(`${STAMP}_a${ch}b`, STAMPED_RULE)) taken.push(ch);
  }
  ok('stamped-name layer: the name takes exactly A-Z a-z 0-9 . _ - and no other character',
    taken.join('') === '-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz', show(taken.join('')));
  const stampTaken: string[] = [];
  for (let code = 0; code < 256; code++) { const ch = String.fromCodePoint(code); if (rule.storageSegmentMatches(`1${ch}2_a`, STAMPED_RULE)) stampTaken.push(ch); }
  ok('stamped-name layer: the stamp takes digits only (one underscore ends it)', stampTaken.join('') === '0123456789_', show(stampTaken.join('')));
}

for (const goodIndex of ['0', '1', '2']) ok(`pin-index layer takes ${show(goodIndex)} for a 3-segment path`, rule.storagePinIndexIsSegment(goodIndex, 3) === true);
for (const badIndex of ['3', '9', '01', '00', '-0', '-1', '1.5', '1e0', '0x1', ' 1', '1 ', '1\n', '', 'project', 'NaN', 'Infinity', '\uff11', '1,2']) {
  ok(`pin-index layer refuses ${show(badIndex)} for a 3-segment path`, rule.storagePinIndexIsSegment(badIndex, 3) === false);
}
ok('pin-index layer: nothing names a segment of a path with none', rule.storagePinIndexIsSegment('0', 0) === false);

for (const bad of [`${OWN}/%2e%2e/${VICTIM}/a.png`, `${OWN}/.%2E/a.png`, `${OWN}/%2E./a.png`, `${OWN}/../a.png`, `${OWN}/./a.png`,
  `${OWN}\\a.png`, `${OWN}/.\t./a.png`, `${OWN}/.\n./a.png`, `${OWN}/a b.png`, `${OWN}/a.png?x`, `${OWN}/a.png#x`, `${OWN}/\uff0e\uff0e/a.png`, `${OWN}/a.png `]) {
  ok(`URL round-trip layer refuses ${show(bad)}`, rule.storagePathSurvivesUrlParser(bad) === false);
}
ok('URL round-trip layer passes every legitimate key', legit.every((l) => l.path !== null && rule.storagePathSurvivesUrlParser(l.path)));

ok('the length cap is a sane size', rule.STORAGE_PATH_MAX_LENGTH >= 160 && rule.STORAGE_PATH_MAX_LENGTH <= 512
  && rule.STORAGE_FILE_NAME_MAX_LENGTH >= 101 && rule.STORAGE_FILE_NAME_MAX_LENGTH <= 160);
ok('a path one character over the cap is refused, whatever else is true of it',
  requestStoragePath(`${OWN}/${'a'.repeat(rule.STORAGE_PATH_MAX_LENGTH)}.png`, PLAN_SHEET_PATH) === null);

// The whole rule is the layers, all of them, on the SAME string — read from the source.
const ruleSrc = read(RULE_FILE);
const ruleSf = ts.createSourceFile(RULE_FILE, ruleSrc, ts.ScriptTarget.Latest, true);
let ruleBody = '';
const ruleProducers = new Set<string>();
ruleSf.forEachChild((n) => {
  if (!ts.isFunctionDeclaration(n) || !n.name) return;
  const exported = (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export) !== 0;
  if (n.name.text === 'requestStoragePath' && n.body) ruleBody = n.body.getText(ruleSf);
  // A producer is an export that answers `string | null`: the rule itself and the builders on top of it.
  if (exported && n.type && n.type.getText(ruleSf).replace(/\s+/g, ' ') === 'string | null') ruleProducers.add(n.name.text);
});
const STEPS: [string, RegExp][] = [
  ['a non-string is refused', /if \(typeof raw !== 'string'\) return null;/],
  ['a pin that is not an object is refused', /if \(pinned === null \|\| typeof pinned !== 'object'\) return null;/],
  ['a pin that is not a PLAIN object is refused', /const pinKind = Object\.getPrototypeOf\(pinned\);\s*if \(pinKind !== Object\.prototype && pinKind !== null\) return null;/],
  ['the length is capped', /if \(raw\.length === 0 \|\| raw\.length > STORAGE_PATH_MAX_LENGTH\) return null;/],
  ['forbidden characters are refused', /if \(storagePathHasForbiddenChar\(raw\)\) return null;/],
  ['the segments come from the same string', /const segments = storagePathSegments\(raw\);/],
  ['the segment count is fixed', /if \(!segments \|\| segments\.length !== shape\.segments\.length\) return null;/],
  ['EVERY segment is matched, not the first', /for \(let i = 0; i < segments\.length; i\+\+\) \{\s*if \(!storageSegmentMatches\(segments\[i\], shape\.segments\[i\]\)\) return null;\s*\}/],
  ['EVERY own key of the pin is read, and each must be a segment index', /for \(const index of Reflect\.ownKeys\(pinned\)\) \{\s*if \(typeof index !== 'string' \|\| !storagePinIndexIsSegment\(index, segments\.length\)\) return null;/],
  ['pinned segments must be equal', /if \(segments\[Number\(index\)\] !== pinned\[Number\(index\)\]\) return null;\s*\}/],
  ['the URL parser must not change it', /if \(!storagePathSurvivesUrlParser\(raw\)\) return null;/],
  ['the answer is the input string', /return raw;\s*\}$/],
];
let cursor = 0, inOrder = true;
for (const [label, re] of STEPS) {
  const m = re.exec(ruleBody);
  ok(`requestStoragePath: ${label}`, !!m);
  if (m) { if (m.index < cursor) inOrder = false; cursor = m.index; }
}
ok('requestStoragePath runs those steps in that order', inOrder);
const ruleCode = ruleSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
ok('the rule never repairs a path (no trim / replace / decode / normalize / toLowerCase anywhere in the module)',
  !/\.trim\w*\(|\.replace(All)?\(|decodeURI|\.normalize\(|\.toLowerCase\(|\.toUpperCase\(/.test(ruleCode));
ok('the module is pure (no Deno.*, no imports)', !/\bDeno\./.test(ruleCode) && !/^\s*import\s/m.test(ruleCode));
ok('its code is plain ASCII (a character class holding an invisible literal cannot be reviewed)', !/[^\x00-\x7f]/.test(ruleCode.replace(/\/\/.*$/gm, '').replace(/\/\*\*[\s\S]*?\*\//g, '')));
ok('the URL round-trip compares the parsed pathname to the path itself',
  /new URL\('https:\/\/h\/' \+ path\)/.test(ruleCode) && /url\.pathname === '\/' \+ path/.test(ruleCode));
ok('the producers are the rule and its four builders',
  [...ruleProducers].sort().join(',') === 'contractPdfPath,planSheetPagePath,punchSealPhotoPath,punchSealRecordPath,requestStoragePath',
  [...ruleProducers].sort().join(','));

// THE SHAPES, PINNED WHOLE. A shape is the allow-list: one more extension, one
// segment kind loosened, one bucket renamed changes what a service-role call
// may touch. Every exported shape must be listed here exactly as it is, so
// widening one is a red build and a reviewed edit of this table — never a
// one-word change in the rule module that nothing notices.
const describeSegment = (r: SegmentRule): string =>
  r.kind === 'id' ? 'id' : r.kind === 'stampedName' ? 'stampedName' : r.kind === 'literal' ? `literal:${r.value}` : `${r.kind}:${r.extensions.join(',')}`;
const IMAGE_EXTS = 'jpg,jpeg,png,heic,heif,webp';
const SHAPE_PINS: Record<string, { bucket: string; segments: string[] }> = {
  PLAN_SHEET_PATH: { bucket: 'plan-sheets', segments: ['id', 'file:png,jpg'] },
  PDF_UPLOAD_PATH: { bucket: 'pdf-uploads', segments: ['id', 'file:pdf'] },
  CONTRACT_PDF_PATH: { bucket: 'secure-contracts', segments: ['id', 'file:pdf'] },
  PUNCH_AFTER_PHOTO_PATH: { bucket: 'project-photos', segments: ['id', 'id', `file:${IMAGE_EXTS}`] },
  PROJECT_PHOTO_PATH: { bucket: 'project-photos', segments: ['id', 'id', `file:${IMAGE_EXTS}`] },
  PUNCH_SEAL_PHOTO_PATH: { bucket: 'punch-seals', segments: ['id', 'id', 'file:jpg'] },
  PUNCH_SEAL_RECORD_PATH: { bucket: 'punch-seals', segments: ['id', 'id', 'literal:record.pdf'] },
  MESSAGE_ATTACHMENT_PATH: { bucket: 'message-attachments', segments: ['id', 'id', 'idFile:jpg,png,webp,pdf'] },
  RFP_ATTACHMENT_PATH: { bucket: 'rfp-attachments', segments: ['id', 'id', 'stampedName'] },
};
const isShape = (v: unknown): v is Shape => !!v && typeof v === 'object' && typeof (v as Shape).bucket === 'string' && Array.isArray((v as Shape).segments);
const exportedShapes = Object.entries(rule as unknown as Record<string, unknown>).filter((e): e is [string, Shape] => isShape(e[1]));
ok(`every shape the rule module exports is pinned here, and nothing else is (${exportedShapes.length} shapes)`,
  exportedShapes.map(([n]) => n).sort().join(',') === Object.keys(SHAPE_PINS).sort().join(','),
  `exported: ${exportedShapes.map(([n]) => n).sort().join(', ')}`);
for (const [name, shape] of exportedShapes) {
  const pin = SHAPE_PINS[name];
  ok(`${name} is exactly ${pin ? `${pin.bucket}: ${pin.segments.join(' / ')}` : '(not pinned)'}`,
    !!pin && shape.bucket === pin.bucket && JSON.stringify(shape.segments.map(describeSegment)) === JSON.stringify(pin.segments),
    `${shape.bucket}: ${shape.segments.map(describeSegment).join(' / ')}`);
}
const allExts = exportedShapes.flatMap(([name, shape]) => shape.segments.flatMap((r) => (r.kind === 'file' || r.kind === 'idFile' ? r.extensions.map((e) => ({ name, e })) : [])));
ok('an extension is lower-case letters and digits only (never a dot, a slash, a wildcard, an upper-case spelling or an empty string)', allExts.every(({ e }) => /^[a-z0-9]{2,5}$/.test(e)));
// The one kind with no extension list. Its pattern is a constant of the rule module, pinned here as text
// AND character by character above: loosening it (one more character, a missing anchor, no length cap) is red.
ok('the stamped-name pattern is exactly ^[0-9]{1,16}_[A-Za-z0-9._-]*$, capped by its own constant, and only rfp-attachments uses the kind',
  ruleSrc.includes('const STORAGE_STAMPED_NAME_RE = /^[0-9]{1,16}_[A-Za-z0-9._-]*$/;')
  && ruleSrc.includes("if (rule.kind === 'stampedName') {\n    return segment.length <= STORAGE_STAMPED_NAME_MAX_LENGTH && STORAGE_STAMPED_NAME_RE.test(segment);\n  }")
  && (ruleSrc.match(/STORAGE_STAMPED_NAME_RE/g) ?? []).length === 2
  && exportedShapes.filter(([, shape]) => shape.segments.some((r) => r.kind === 'stampedName')).map(([n]) => n).join() === 'RFP_ATTACHMENT_PATH'
  && RFP_ATTACHMENT_PATH.segments.findIndex((r) => r.kind === 'stampedName') === 2);
// No key a shape accepts can be longer than the path cap allows, so the cap never refuses a writer's key
// except where the comment on that shape says so (rfp-attachments, whose writer puts no cap on the name).
const longestSegment = (r: SegmentRule): number => r.kind === 'id' ? 36 : r.kind === 'literal' ? r.value.length
  : r.kind === 'idFile' ? 37 + Math.max(...r.extensions.map((e) => e.length)) : r.kind === 'stampedName' ? rule.STORAGE_STAMPED_NAME_MAX_LENGTH : rule.STORAGE_FILE_NAME_MAX_LENGTH;
ok('the longest key each shape can accept fits under the path cap (the cap is reached only by rfp-attachments, exactly)',
  exportedShapes.every(([name, shape]) => {
    const longest = shape.segments.reduce((sum, r) => sum + longestSegment(r), 0) + shape.segments.length - 1;
    return name === 'RFP_ATTACHMENT_PATH' ? longest === rule.STORAGE_PATH_MAX_LENGTH : longest < rule.STORAGE_PATH_MAX_LENGTH;
  }));
ok('every shape starts with an id folder — the tenant boundary of its bucket — and no shape is one segment',
  exportedShapes.every(([, shape]) => shape.segments.length >= 2 && shape.segments[0].kind === 'id'));
// The rule module builds its shapes with three helpers; a segment written out by hand would dodge a text pin, not this table.
ok('the shapes are read from the running module, not from its text (a widened list changes this run)',
  requestStoragePath(`${OWN}/a.gif`, PLAN_SHEET_PATH) === null && requestStoragePath(`${UID}/${OWN}/a.gif`, PROJECT_PHOTO_PATH) === null
  && requestStoragePath(`${UID}/${BASE}.png`, CONTRACT_PDF_PATH) === null && requestStoragePath(`${OWN}/${BASE}/${ITEM}.gif`, MESSAGE_ATTACHMENT_PATH) === null);

// Builders refuse anything that is not an id / a page number, and what they emit passes the rule.
const BAD_IDS: unknown[] = ['..', '%2e%2e', `${OWN}/..`, OWN.toUpperCase(), `{${OWN}}`, '', null, undefined, 7, `${OWN}\n`, 'tmp'];
ok('planSheetPagePath refuses a non-id project or base, and a bad page number',
  BAD_IDS.every((b) => rule.planSheetPagePath(b, BASE, 1) === null && rule.planSheetPagePath(OWN, b, 1) === null)
  && [0, -1, 1.5, NaN, Infinity, '1', null, 100001].every((n) => rule.planSheetPagePath(OWN, BASE, n) === null));
ok('contractPdfPath refuses a non-id user or contract',
  BAD_IDS.every((b) => rule.contractPdfPath(b, BASE) === null && rule.contractPdfPath(UID, b) === null));
ok('punchSealPhotoPath refuses a non-id user, seal or item',
  BAD_IDS.every((b) => rule.punchSealPhotoPath(b, BASE, ITEM) === null && rule.punchSealPhotoPath(UID, b, ITEM) === null && rule.punchSealPhotoPath(UID, BASE, b) === null));
ok('punchSealRecordPath refuses a non-id user or seal',
  BAD_IDS.every((b) => rule.punchSealRecordPath(b, BASE) === null && rule.punchSealRecordPath(UID, b) === null));

// ── 4. the premise: what the storage client does with a path ────────────────
console.log('\n4. the storage client from node_modules, against a stub fetch:');

interface Sent { url: string; body: string }
const sent: Sent[] = [];
const stubFetch = (async (input: unknown, init?: { body?: unknown }) => {
  const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input);
  sent.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;
const storageClient = new StorageClient('https://h.example/storage/v1', { apikey: 'stub' }, stubFetch);
type BucketApi = ReturnType<typeof storageClient.from>;
const bytes1 = new Uint8Array([1]);
const PROBES: Record<string, (b: BucketApi, p: string) => unknown> = {
  download: (b, p) => b.download(p),
  createSignedUrl: (b, p) => b.createSignedUrl(p, 60),
  createSignedUrls: (b, p) => b.createSignedUrls([p], 60),
  createSignedUploadUrl: (b, p) => b.createSignedUploadUrl(p),
  uploadToSignedUrl: (b, p) => b.uploadToSignedUrl(p, 'tok', bytes1),
  upload: (b, p) => b.upload(p, bytes1),
  update: (b, p) => b.update(p, bytes1),
  remove: (b, p) => b.remove([p]),
  list: (b, p) => b.list(p),
  move: (b, p) => b.move(p, 'dest.png'),
  copy: (b, p) => b.copy(p, 'dest.png'),
  info: (b, p) => b.info(p),
  exists: (b, p) => b.exists(p),
};
/** Where the client put `path`: 'url' (a parser will read it), 'body' (the server matches the name literally). */
async function transportOf(method: string, path: string): Promise<{ where: 'url' | 'body' | 'none'; urls: string[] }> {
  sent.length = 0;
  try { await PROBES[method](storageClient.from('plan-sheets'), path); } catch { /* the stub answers '{}' — only the request matters */ }
  const inUrl = sent.some((s) => s.url.includes(path));
  const inBody = sent.some((s) => s.body.includes(JSON.stringify(path).slice(1, -1)));
  return { where: inUrl ? 'url' : inBody ? 'body' : 'none', urls: sent.map((s) => s.url) };
}
const ATTACK = `${OWN}/%2e%2e/${VICTIM}/${BASE}-page-1.png`;
const transport: Record<string, 'url' | 'body' | 'none'> = {};
for (const m of Object.keys(PROBES)) transport[m] = (await transportOf(m, ATTACK)).where;
const dlAttack = await transportOf('download', ATTACK);
ok('download() puts the raw path in the URL', transport.download === 'url', JSON.stringify(dlAttack.urls));
ok('…and the URL parser turns the encoded dot segment into the OTHER project’s key (this is the hole)',
  new URL(dlAttack.urls[0] ?? 'https://h/').pathname === `/storage/v1/object/plan-sheets/${VICTIM}/${BASE}-page-1.png`,
  new URL(dlAttack.urls[0] ?? 'https://h/').pathname);
const twoUp = await transportOf('download', `${OWN}/%2e%2e/%2e%2e/secure-contracts/${VICTIM_UID}/${BASE}.pdf`);
ok('…and two of them reach another bucket',
  new URL(twoUp.urls[0] ?? 'https://h/').pathname === `/storage/v1/object/secure-contracts/${VICTIM_UID}/${BASE}.pdf`);
ok('createSignedUrl() and createSignedUploadUrl() and upload() carry the path in the URL too',
  transport.createSignedUrl === 'url' && transport.createSignedUploadUrl === 'url' && transport.upload === 'url', JSON.stringify(transport));
ok('createSignedUrls(), remove() and list() carry it in the JSON body, where no parser rewrites it',
  transport.createSignedUrls === 'body' && transport.remove === 'body' && transport.list === 'body', JSON.stringify(transport));

// Every escaping form in the corpus really does leave the caller's folder when the client builds its URL.
let escaping = 0;
for (const c of attacks(OWN, VICTIM, `${BASE}-page-1.png`)) {
  if (typeof c.path !== 'string' || c.path.length === 0 || c.path.length > 600) continue;
  const t = await transportOf('download', c.path);
  let landed = '';
  try { landed = new URL(t.urls[0] ?? '').pathname; } catch { landed = '(unparseable)'; }
  if (!landed.startsWith(`/storage/v1/object/plan-sheets/${OWN}/`)) escaping++;
}
ok(`the corpus has teeth: ${escaping} of its forms leave the caller's folder in the URL the client builds`, escaping >= 12, String(escaping));

// Seeded fuzz: accepted ⇒ the client's URL is the path, byte for byte, inside the caller's folder.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TOKENS = [OWN, VICTIM, '/', '/', '/', '..', '.', '%2e', '%2E', '%2f', '%5c', '\\', '\t', '\n', ' ', '?', '#', ';', '%', '%25',
  'a', 'img-1', '.png', '.jpg', 'x.png', `${BASE}-page-3.png`, 'secure-contracts', '\uff0e', '-', '_', 'tmp'];
const rand = mulberry32(20261004);
let fuzzAccepted = 0, fuzzBroken = 0;
const FUZZ_RUNS = 40000;
for (let i = 0; i < FUZZ_RUNS; i++) {
  let s = rand() < 0.6 ? `${OWN}/` : '';
  const n = 1 + Math.floor(rand() * 5);
  for (let k = 0; k < n; k++) s += TOKENS[Math.floor(rand() * TOKENS.length)];
  const got = requestStoragePath(s, PLAN_SHEET_PATH, { 0: OWN });
  if (got === null) continue;
  fuzzAccepted++;
  const t = await transportOf('download', got);
  const landed = t.urls.length === 1 ? new URL(t.urls[0]).pathname : '';
  if (got !== s || landed !== `/storage/v1/object/plan-sheets/${s}` || !landed.startsWith(`/storage/v1/object/plan-sheets/${OWN}/`)
    || landed.split('/').length !== 7) fuzzBroken++;
}
ok(`fuzz (${FUZZ_RUNS} strings from traversal tokens, seeded): the ${fuzzAccepted} accepted ones reach exactly their own key`,
  fuzzAccepted >= 200 && fuzzBroken === 0, `accepted ${fuzzAccepted}, broken ${fuzzBroken}`);

// ── 5. the plan-sheet sink, executed with a stubbed service-role client ─────
console.log('\n5. _shared/planSheetBytes.ts with a stubbed service-role client:');

const downloaded: string[] = [];
function tableStub(table: string) {
  let ids: string[] = [];
  const api = {
    select: () => api,
    in: (_c: string, v: string[]) => { ids = v; return api; },
    eq: () => api,
    then: (resolve: (r: { data: unknown[]; error: null }) => void) => {
      // The caller owns OWN and nothing else; there are no collaborator rows.
      resolve({ data: table === 'projects' ? ids.filter((id) => id === OWN).map((id) => ({ id })) : [], error: null });
    },
  };
  return api;
}
const clientStub = {
  from: (table: string) => tableStub(table),
  storage: {
    from: () => ({
      download: async (path: string) => {
        downloaded.push(path);
        return { data: { arrayBuffer: async () => new Uint8Array(8).buffer }, error: null };
      },
    }),
  },
};
interface BunGlobal {
  plugin(def: { name: string; setup: (build: { module(spec: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void }) => void }): void;
}
const bun = (globalThis as unknown as { Bun?: BunGlobal }).Bun;
if (!bun) { console.error('\n✗ validate-storage-paths must run under bun (needs Bun.plugin)\n'); process.exit(1); }
bun.plugin({
  name: 'stub-service-role-client',
  setup(build) {
    build.module('https://esm.sh/@supabase/supabase-js@2.39.7', () => ({ exports: { createClient: () => clientStub }, loader: 'object' }));
  },
});
(globalThis as unknown as { Deno?: unknown }).Deno = {
  env: { get: (k: string) => (k === 'SUPABASE_URL' ? 'https://stub.supabase.co' : k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service-role-key' : '') },
};
interface PlanSheetBytesModule {
  planSheetProjectId(p: unknown): string;
  planSheetSideSource(path: unknown, url: unknown): 'path' | 'url' | 'none';
  loadPlanSheetImageParts(paths: string[], userId: string, maxBytes: number): Promise<unknown[]>;
  mintLegacyViewUrl(storage: { createSignedUrl(path: string, ttl: number): Promise<{ data?: { signedUrl?: string | null } | null }> }, path: string, ttl: number): Promise<string>;
  PlanSheetAccessError: new () => Error;
}
const sheets = await import(fromHere(`${FN_ROOT}/_shared/planSheetBytes.ts`)) as PlanSheetBytesModule;
const sheetAttacks = attacks(OWN, VICTIM, `${BASE}-page-1.png`);

const GOOD = `${OWN}/${BASE}-page-1.png`;
await sheets.loadPlanSheetImageParts([GOOD], UID, 1 << 20);
ok('a legitimate path downloads exactly the string that was checked', JSON.stringify(downloaded) === JSON.stringify([GOOD]), JSON.stringify(downloaded));
ok('planSheetProjectId reads the project out of that string', sheets.planSheetProjectId(GOOD) === OWN);

downloaded.length = 0;
let leaked: string[] = [], wrongError: string[] = [];
for (const c of sheetAttacks) {
  let err: unknown = null;
  try { await sheets.loadPlanSheetImageParts([c.path as string], UID, 1 << 20); } catch (e) { err = e; }
  if (!(err instanceof sheets.PlanSheetAccessError)) wrongError.push(c.name);
  if (downloaded.length > 0) { leaked.push(`${c.name}: ${show(downloaded[0])}`); downloaded.length = 0; }
}
ok(`none of the ${sheetAttacks.length} attack paths downloads anything`, leaked.length === 0, leaked.join('\n      '));
ok('each is answered with the generic access error', wrongError.length === 0, wrongError.join(', '));

downloaded.length = 0;
let mixedErr: unknown = null;
try { await sheets.loadPlanSheetImageParts([GOOD, `${OWN}/%2e%2e/${VICTIM}/${BASE}-page-1.png`], UID, 1 << 20); } catch (e) { mixedErr = e; }
ok('one attack path in a batch refuses the whole batch before any download',
  mixedErr instanceof sheets.PlanSheetAccessError && downloaded.length === 0, JSON.stringify(downloaded));
downloaded.length = 0;
let victimErr: unknown = null;
try { await sheets.loadPlanSheetImageParts([`${VICTIM}/${BASE}-page-1.png`], UID, 1 << 20); } catch (e) { victimErr = e; }
ok('a well-formed key in a project the caller cannot reach is still refused', victimErr instanceof sheets.PlanSheetAccessError && downloaded.length === 0);

ok('planSheetProjectId answers nothing for every attack path', sheetAttacks.every((c) => sheets.planSheetProjectId(c.path) === ''));
ok('compare-drawings never treats an attack path as a path side', sheetAttacks.every((c) => sheets.planSheetSideSource(c.path, 'https://x/y.png') !== 'path'));
let signedWith: string[] = [];
const signer = { createSignedUrl: async (p: string) => { signedWith.push(p); return { data: { signedUrl: `https://stub.supabase.co/storage/v1/object/sign/plan-sheets/${p}?token=t` } }; } };
for (const c of sheetAttacks) await sheets.mintLegacyViewUrl(signer, c.path as string, 60);
ok('mintLegacyViewUrl signs nothing for an attack path', signedWith.length === 0, signedWith.map(show).join(', '));
signedWith = [];
ok('…and still signs a legitimate key, with that exact string',
  (await sheets.mintLegacyViewUrl(signer, GOOD, 60)).includes('/object/sign/') && JSON.stringify(signedWith) === JSON.stringify([GOOD]));

// ── 6. keys built by another proven producer (portal-message-files) ─────────
console.log('\n6. the other key builder in the tree emits only keys the layers accept:');

interface MessageFilesModule {
  pathFor(projectId: string, messageId: string, attachmentId: string, mime: string): string | null;
}
interface MessageFilesCore extends MessageFilesModule {
  folderFor(projectId: string, messageId: string): string | null;
  signable(rows: { id: string; project_id: string | null; attachments: unknown }[], projectId: string): { key: string }[];
}
const msgShared = await import(fromHere(`${FN_ROOT}/_shared/messageFiles.ts`)) as MessageFilesModule;
const msgCore = await import(fromHere(`${FN_ROOT}/portal-message-files/core.ts`)) as MessageFilesCore;
const safeKey = (k: string | null, segments: number): boolean => k !== null && !rule.storagePathHasForbiddenChar(k)
  && rule.storagePathSegments(k)?.length === segments && rule.storagePathSurvivesUrlParser(k);
const NASTY = ['..', '%2e%2e', `${OWN}/..`, `${OWN}/%2e%2e`, `${OWN}\\..`, `${OWN}\n`, '', 'tmp', `${OWN}?x`, `${OWN}#x`];
ok('core.ts re-exports the shared pathFor (one builder, not two)', msgCore.pathFor === msgShared.pathFor);
ok('pathFor emits <project>/<message>/<attachment>.<ext> that every layer accepts',
  ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].every((m) => safeKey(msgShared.pathFor(OWN, BASE, ITEM, m), 3)));
ok('…and each is exactly the message-attachments shape, pinned to its project and message; the app and the server build the same key',
  MSG_MIMES.every((m) => {
    const k = msgShared.pathFor(OWN, BASE, ITEM, m);
    return k !== null && requestStoragePath(k, MESSAGE_ATTACHMENT_PATH, { 0: OWN, 1: BASE }) === k && k === messageAttachmentPath(OWN, BASE, ITEM, m)
      && requestStoragePath(k, MESSAGE_ATTACHMENT_PATH, { 0: VICTIM, 1: BASE }) === null && requestStoragePath(k, MESSAGE_ATTACHMENT_PATH, { 0: OWN, 1: ITEM }) === null;
  }));
ok('pathFor answers null for any non-id part or unknown type',
  NASTY.every((b) => msgShared.pathFor(b, BASE, ITEM, 'image/png') === null && msgShared.pathFor(OWN, b, ITEM, 'image/png') === null
    && msgShared.pathFor(OWN, BASE, b, 'image/png') === null) && msgShared.pathFor(OWN, BASE, ITEM, 'image/png/../x') === null);
ok('folderFor emits <project>/<message> or null',
  safeKey(msgCore.folderFor(OWN, BASE), 2) && NASTY.every((b) => msgCore.folderFor(b, BASE) === null && msgCore.folderFor(OWN, b) === null));
const goodKey = msgShared.pathFor(OWN, BASE, ITEM, 'image/png') as string;
const rowWith = (path: string) => [{ id: BASE, project_id: OWN, attachments: [{ id: ITEM, mime: 'image/png', path, name: 'a.png' }] }];
ok('signable returns a key only when the stored path IS the rebuilt key',
  msgCore.signable(rowWith(goodKey), OWN).map((i) => i.key).join() === goodKey
  && [`${OWN}/%2e%2e/${VICTIM}/${BASE}/${ITEM}.png`, `${OWN}/${BASE}/../${ITEM}.png`, `${goodKey} `, `/${goodKey}`, `${VICTIM}/${BASE}/${ITEM}.png`]
    .every((p) => msgCore.signable(rowWith(p), OWN).length === 0));

// ── 6b. the four functions that used to check a key themselves, EXECUTED ────
// signed-media-urls, shared-photos-sign, job-facts-view and delete-account each
// read a key out of a row (or a request) and tested it by hand — "segment N is
// my project, and no segment is exactly '..'" — before a body-carried storage
// call. `<mine>/%2e%2e/<yours>/x` passed that test. Their decisions now go
// through the rule; this section runs each one against the attack corpus, as a
// bare value AND inside a Supabase object URL (the other shape a row holds).
console.log('\n6b. the four functions that used to check a key themselves, executed:');

/** A string attack wrapped the way a legacy row holds a key: a Supabase object URL of the bucket. */
const asObjectUrl = (bucket: string, key: string, kind: 'public' | 'sign' | 'bare' = 'sign'): string =>
  `https://ref.supabase.co/storage/v1/object/${kind === 'bare' ? '' : `${kind}/`}${bucket}/${key}${kind === 'sign' ? '?token=old' : ''}`;
const PROOFS_RUN = new Set(['signable']); // section 6 executed it

// --- signed-media-urls/core.ts -------------------------------------------------
interface SignedMediaCore {
  photoSource(uri: unknown, projectId: string): { sign: string } | { pass: string } | null;
  rfiSheetKey(uriOrPath: unknown, projectId: string): string;
  rfiReferencedSheetKeys(attachments: unknown, pinSheetPaths: unknown[], projectId: string): Set<string>;
  rfiSheetKeysToSign(paths: string[], projectId: string, referenced: Set<string>): Map<string, string[]>;
}
const SIGNED_MEDIA_CORE_FILE = `${FN_ROOT}/signed-media-urls/core.ts`;
const SIGNED_MEDIA_INDEX_FILE = `${FN_ROOT}/signed-media-urls/index.ts`;
const mediaCore = await import(fromHere(SIGNED_MEDIA_CORE_FILE)) as SignedMediaCore;
const PHOTO_FILE = `photo-${ITEM}.jpg`;
const PHOTO_GOOD = `${UID}/${OWN}/${PHOTO_FILE}`;
const SHEET_FILE = `${BASE}-page-1.png`;
const SHEET_GOOD = `${OWN}/${SHEET_FILE}`;
const photoAttacks = attacks(`${UID}/${OWN}`, `${VICTIM_UID}/${VICTIM}`, PHOTO_FILE);
const sheetCorpus = attacks(OWN, VICTIM, SHEET_FILE);
const signedKey = (r: { sign: string } | { pass: string } | null): string | null => (r && 'sign' in r ? r.sign : null);

const photoLegit = legit.filter((l) => l.shape === PROJECT_PHOTO_PATH && l.path !== null).map((l) => l.path as string);
ok(`signed-media-urls signs every legitimate photo key (${photoLegit.length}), unchanged — bare, and from a signed / public / plain object URL of it`,
  photoLegit.length >= 40 && photoLegit.every((k) => signedKey(mediaCore.photoSource(k, OWN)) === k
    && (['sign', 'public', 'bare'] as const).every((kind) => signedKey(mediaCore.photoSource(asObjectUrl('project-photos', k, kind), OWN)) === k)));
ok('…and takes the uploader from the key, not from the caller: a collaborator’s photo on this job is signed, the same key for ANOTHER job is not',
  signedKey(mediaCore.photoSource(`${VICTIM_UID}/${OWN}/${PHOTO_FILE}`, OWN)) === `${VICTIM_UID}/${OWN}/${PHOTO_FILE}`
  && mediaCore.photoSource(PHOTO_GOOD, VICTIM) === null && mediaCore.photoSource(`${VICTIM_UID}/${VICTIM}/${PHOTO_FILE}`, OWN) === null);
const photoBareLeaks = photoAttacks.filter((c) => signedKey(mediaCore.photoSource(c.path, OWN)) !== null);
ok(`signed-media-urls: none of the ${photoAttacks.length} attack forms is signed as a photo key`, photoBareLeaks.length === 0,
  photoBareLeaks.map((c) => `${c.name}: ${show(c.path)}`).join('\n      '));
const photoUrlLeaks = photoAttacks.filter((c) => typeof c.path === 'string' && (['sign', 'public', 'bare'] as const).some((kind) => {
  const k = signedKey(mediaCore.photoSource(asObjectUrl('project-photos', c.path as string, kind), OWN));
  // A URL whose path IS the good key (the corpus's query form reduces to it) may be signed; nothing else may.
  return k !== null && k !== PHOTO_GOOD;
}));
ok('…nor when the form arrives inside an object URL of the bucket (the only key such a URL can yield is the caller’s own)', photoUrlLeaks.length === 0,
  photoUrlLeaks.map((c) => `${c.name}: ${show(c.path)}`).join('\n      '));
ok('a non-storage http link still passes through as itself, and is never a key',
  JSON.stringify(mediaCore.photoSource('https://picsum.photos/seed/x/800', OWN)) === JSON.stringify({ pass: 'https://picsum.photos/seed/x/800' })
  && mediaCore.photoSource(asObjectUrl('plan-sheets', SHEET_GOOD, 'public'), OWN) === null);

const sheetLegit = legit.filter((l) => l.shape === PLAN_SHEET_PATH && l.path !== null).map((l) => l.path as string);
ok(`signed-media-urls takes every legitimate plan-sheet key (${sheetLegit.length}) for the RFI’s own project — bare, and from an object URL of it`,
  sheetLegit.length >= 7 && sheetLegit.every((k) => mediaCore.rfiSheetKey(k, OWN) === k
    && (['sign', 'public', 'bare'] as const).every((kind) => mediaCore.rfiSheetKey(asObjectUrl('plan-sheets', k, kind), OWN) === k)));
const sheetBareLeaks = sheetCorpus.filter((c) => mediaCore.rfiSheetKey(c.path, OWN) !== '');
ok(`signed-media-urls: none of the ${sheetCorpus.length} attack forms is a plan-sheet key`, sheetBareLeaks.length === 0,
  sheetBareLeaks.map((c) => `${c.name}: ${show(c.path)}`).join('\n      '));
const sheetUrlLeaks = sheetCorpus.filter((c) => typeof c.path === 'string' && (['sign', 'public', 'bare'] as const).some((kind) => {
  const k = mediaCore.rfiSheetKey(asObjectUrl('plan-sheets', c.path as string, kind), OWN);
  return k !== '' && k !== SHEET_GOOD;
}));
ok('…nor inside an object URL of the bucket', sheetUrlLeaks.length === 0, sheetUrlLeaks.map((c) => `${c.name}: ${show(c.path)}`).join('\n      '));
ok('a plan-sheet key of ANOTHER project, the legacy shared tmp/ folder, and a key for the wrong pin are refused',
  mediaCore.rfiSheetKey(`${VICTIM}/${SHEET_FILE}`, OWN) === '' && mediaCore.rfiSheetKey(`tmp/${SHEET_FILE}`, OWN) === '' && mediaCore.rfiSheetKey(SHEET_GOOD, VICTIM) === '');
{
  // The whole rfi_sheets plan: the RFI row itself is hostile (its attachments ARE the corpus), and so is the request.
  const strings = sheetCorpus.map((c) => c.path).filter((v): v is string => typeof v === 'string');
  const referenced = mediaCore.rfiReferencedSheetKeys([SHEET_GOOD, ...sheetCorpus.map((c) => c.path), ...strings.map((v) => asObjectUrl('plan-sheets', v, 'public'))], strings, OWN);
  const plan = mediaCore.rfiSheetKeysToSign([SHEET_GOOD, ...strings, ...strings.map((v) => asObjectUrl('plan-sheets', v, 'sign'))], OWN, referenced);
  ok('rfi_sheets: with the corpus in the RFI row AND in the request, the only key to sign is the RFI’s own sheet',
    JSON.stringify([...referenced]) === JSON.stringify([SHEET_GOOD]) && JSON.stringify([...plan.keys()]) === JSON.stringify([SHEET_GOOD]),
    `referenced ${show(JSON.stringify([...referenced]))}, plan ${show(JSON.stringify([...plan.keys()]))}`);
}
const mediaCoreSrc = read(SIGNED_MEDIA_CORE_FILE);
const mediaIndexSrc = read(SIGNED_MEDIA_INDEX_FILE);
ok('signed-media-urls/core.ts decides both keys with the rule, pinned to the project that was checked',
  /const key = requestStoragePath\(candidate, PROJECT_PHOTO_PATH, \{ 1: projectId\.toLowerCase\(\) \}\);\s*return key \? \{ sign: key \} : null;/.test(mediaCoreSrc)
  && /return requestStoragePath\(candidate, PLAN_SHEET_PATH, \{ 0: projectId\.toLowerCase\(\) \}\) \?\? '';/.test(mediaCoreSrc)
  && (mediaCoreSrc.match(/requestStoragePath\(/g) ?? []).length === 2);
ok('signed-media-urls/index.ts signs only what the rule returns for the bucket’s own shape (one storage call, a shape is never used on another bucket)',
  /if \(shape\.bucket !== bucket\) return out;\s*const unique: string\[\] = \[\];\s*for \(const candidate of new Set\(keys\)\) \{\s*const key = requestStoragePath\(candidate, shape, pinned\);\s*if \(key\) unique\.push\(key\);\s*\}/.test(mediaIndexSrc)
  && /signKeys\(svc, PHOTO_BUCKET, PROJECT_PHOTO_PATH, \{ 1: projectId\.toLowerCase\(\) \}, /.test(mediaIndexSrc)
  && /signKeys\(svc, PLAN_SHEET_BUCKET, PLAN_SHEET_PATH, \{ 0: projectId\.toLowerCase\(\) \}, /.test(mediaIndexSrc)
  && (mediaIndexSrc.match(/\bsignKeys\(/g) ?? []).length === 3);

// --- shared-photos-sign and job-facts-view: each function's own pure block ------
// Sliced from the function's source and run under bun, with the rule's two
// names imported from the real module (exactly what index.ts imports).
interface PhotoRow { id: string; user_id: string | null; project_id: string | null; uri: unknown; timestamp: string | null; tag: string | null; portal_state: unknown }
interface SignedPhoto { id: string; path: string; owner: string }
const RULE_IMPORT_LINE = `import { PROJECT_PHOTO_PATH, requestStoragePath } from ${JSON.stringify(join(process.cwd(), RULE_FILE))};\n`;
const pureDir = mkdtempSync(join(tmpdir(), 'storage-paths-pure-'));
/** Writes the block to a file of its own; returns that file and the function's whole source. */
function writePureBlock(fnFile: string, as: string): { file: string; src: string } {
  const src = read(fnFile);
  const a = src.indexOf('// ── pure:begin');
  const b = src.indexOf('// ── pure:end');
  ok(`${fnFile} has its pure block, and imports the rule it uses`, a > 0 && b > a
    && src.includes('import { PROJECT_PHOTO_PATH, requestStoragePath } from "../_shared/storagePath.ts";'));
  const file = join(pureDir, as);
  writeFileSync(file, RULE_IMPORT_LINE + src.slice(a, b));
  return { file, src };
}
const SHARE_FILE = `${FN_ROOT}/shared-photos-sign/index.ts`;
const FACTS_FILE = `${FN_ROOT}/job-facts-view/index.ts`;
// Both files are written before either is imported (bun reads a directory once).
const shareBlock = writePureBlock(SHARE_FILE, 'share.ts');
const factsBlock = writePureBlock(FACTS_FILE, 'facts.ts');
const share = { src: shareBlock.src, mod: await import(shareBlock.file) as {
  signableSharePhotos(rows: PhotoRow[], req: { projectId: string; photoIds: string[] }): SignedPhoto[];
} };
const facts = { src: factsBlock.src, mod: await import(factsBlock.file) as {
  signableFactsPhotos(rows: PhotoRow[], projectId: string, photoIds: string[]): SignedPhoto[];
} };
const photoRow = (uri: unknown, over: Partial<PhotoRow> = {}): PhotoRow => ({ id: ITEM, user_id: UID, project_id: OWN, uri, timestamp: null, tag: null, portal_state: null, ...over });
const shareSigns = (row: PhotoRow): string[] => share.mod.signableSharePhotos([row], { projectId: OWN, photoIds: [ITEM] }).map((p) => p.path);
const factsSigns = (row: PhotoRow): string[] => facts.mod.signableFactsPhotos([row], OWN, [ITEM]).map((p) => p.path);
for (const [label, signs] of [['shared-photos-sign', shareSigns], ['job-facts-view', factsSigns]] as const) {
  ok(`${label} signs every legitimate photo key of the row’s own user and job (${photoLegit.length}), unchanged, bare and from an object URL`,
    photoLegit.every((k) => JSON.stringify(signs(photoRow(k))) === JSON.stringify([k])
      && (['sign', 'public', 'bare'] as const).every((kind) => JSON.stringify(signs(photoRow(asObjectUrl('project-photos', k, kind)))) === JSON.stringify([k]))));
  const bare = photoAttacks.filter((c) => signs(photoRow(c.path)).length > 0);
  ok(`${label}: a row holding any of the ${photoAttacks.length} attack forms signs nothing`, bare.length === 0, bare.map((c) => `${c.name}: ${show(c.path)}`).join('\n      '));
  const inUrl = photoAttacks.filter((c) => typeof c.path === 'string' && (['sign', 'public', 'bare'] as const).some((kind) => {
    const got = signs(photoRow(asObjectUrl('project-photos', c.path as string, kind)));
    return got.length > 0 && got[0] !== PHOTO_GOOD;
  }));
  ok(`${label}: …nor when the form sits inside an object URL of the bucket`, inUrl.length === 0, inUrl.map((c) => `${c.name}: ${show(c.path)}`).join('\n      '));
  ok(`${label}: the pins are the ROW’s user and the job that was asked for — another user’s folder, another job’s folder, a row with no user sign nothing`,
    signs(photoRow(`${VICTIM_UID}/${OWN}/${PHOTO_FILE}`)).length === 0 && signs(photoRow(`${UID}/${VICTIM}/${PHOTO_FILE}`)).length === 0
    && signs(photoRow(PHOTO_GOOD, { user_id: null })).length === 0 && signs(photoRow(PHOTO_GOOD, { user_id: VICTIM_UID })).length === 0
    && JSON.stringify(signs(photoRow(PHOTO_GOOD))) === JSON.stringify([PHOTO_GOOD]));
}
ok('both blocks answer the same thing for every corpus form (one rule, not two)',
  photoAttacks.every((c) => JSON.stringify(shareSigns(photoRow(c.path))) === JSON.stringify(factsSigns(photoRow(c.path))))
  && photoLegit.every((k) => JSON.stringify(shareSigns(photoRow(k))) === JSON.stringify(factsSigns(photoRow(k)))));
ok('shared-photos-sign: the filter and the storage call both use the rule with the row’s user and the requested project',
  /const path = requestStoragePath\(shareStoragePathOf\(r\.uri\), PROJECT_PHOTO_PATH, \{ 0: owner, 1: req\.projectId \}\);\s*if \(!path\) continue;/.test(share.src)
  && /const key = requestStoragePath\(p\.path, PROJECT_PHOTO_PATH, \{ 0: p\.owner, 1: parsed\.projectId \}\);\s*if \(key\) keys\.push\(key\);/.test(share.src)
  && (share.src.match(/requestStoragePath\(/g) ?? []).length === 2 && !/segs\[|\.split\("\/"\)/.test(share.src));
ok('job-facts-view: the filter and the storage call both use the rule with the row’s user and the link’s project',
  /const path = requestStoragePath\(factsStoragePathOf\(r\.uri\), PROJECT_PHOTO_PATH, \{ 0: owner, 1: pid \}\);\s*if \(!path\) continue;/.test(facts.src)
  && /const key = requestStoragePath\(p\.path, PROJECT_PHOTO_PATH, \{ 0: p\.owner, 1: link\.projectId \}\);\s*if \(key\) keys\.push\(key\);/.test(facts.src)
  && (facts.src.match(/requestStoragePath\(/g) ?? []).length === 2 && !/segs\[|\.split\("\/"\)/.test(facts.src));
ok('neither function repairs a stored value on its way to the rule (no leading-slash strip; a bare value is returned as it is stored)',
  [share.src, facts.src].every((src) => !/replace\(\/\^\\\/\+\//.test(src) && /\n {2}return uri;\n\}/.test(src)));

// --- delete-account -------------------------------------------------------------
// The function is one serve() handler, so its pure pieces are taken from its
// own source by name and run here: the row → key decision, and the folder walk.
const DELETE_FILE = `${FN_ROOT}/delete-account/index.ts`;
const deleteSrc = read(DELETE_FILE);
const deleteSf = ts.createSourceFile(DELETE_FILE, deleteSrc, ts.ScriptTarget.Latest, true);
const deleteCode = deleteSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const toJs = (tsText: string): string => ts.transpileModule(tsText, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
/** Text of a module-level statement declaring `name` (a function, a const, or a type), or ''. */
function topLevelText(name: string): string {
  for (const st of deleteSf.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isTypeAliasDeclaration(st)) && st.name?.text === name) return st.getText(deleteSf);
    if (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)) return st.getText(deleteSf);
  }
  return '';
}
/** Initializer text of a `const name = …` declared anywhere in the file (the handler's closures), or ''. */
function closureText(name: string): string {
  let out = '';
  const find = (n: ts.Node) => {
    if (!out && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) out = n.initializer.getText(deleteSf);
    if (!out) n.forEachChild(find);
  };
  find(deleteSf);
  return out;
}
type RowTarget = { kind: 'legacy-shared' } | { kind: 'owned'; candidate: string; folder: string } | null;
interface DeletePure {
  LEGACY_SHARED_PLAN_FOLDER: string;
  storagePathFromUrl(raw: unknown, bucket: string): string | null;
  planSheetRowTarget(imageUri: unknown, owned: ReadonlySet<string>): RowTarget;
}
const purePieces = ['LEGACY_SHARED_PLAN_FOLDER', 'storagePathFromUrl', 'PlanSheetRowTarget', 'planSheetRowTarget'].map(topLevelText);
ok('delete-account still has its row → key pieces at module level (storagePathFromUrl, planSheetRowTarget, the legacy folder name)', purePieces.every((t) => t.length > 0));
const deletePure = new Function(`${toJs(purePieces.join('\n'))}\nreturn { LEGACY_SHARED_PLAN_FOLDER, storagePathFromUrl, planSheetRowTarget };`)() as DeletePure;
const OWNED = new Set([OWN]);
/** What step 1 queues for a plan_sheets row: the two lines of the handler, with the function's own decision. */
const sheetKeyQueued = (imageUri: unknown, owned: ReadonlySet<string> = OWNED): string | null => {
  const target = deletePure.planSheetRowTarget(imageUri, owned);
  return target && target.kind === 'owned' ? requestStoragePath(target.candidate, PLAN_SHEET_PATH, { 0: target.folder }) : null;
};
ok('delete-account queues a plan-sheets key through exactly those two lines, and an rfp-attachments key through the rule pinned to the caller',
  /const target = planSheetRowTarget\(row\.image_uri, ownedPlanFolders\);\s*if \(!target\) continue;\s*if \(target\.kind === 'legacy-shared'\) \{\s*legacyTmpPlanSheetsKept\+\+;\s*continue;\s*\}\s*const key = requestStoragePath\(target\.candidate, PLAN_SHEET_PATH, \{ 0: target\.folder \}\);/.test(deleteCode)
  && /const ownedPlanFolders = new Set<string>\(projectIds\);/.test(deleteCode)
  && /const key = requestStoragePath\(storagePathFromUrl\(url, 'rfp-attachments'\), RFP_ATTACHMENT_PATH, \{ 0: userId \}\);/.test(deleteCode)
  && (deleteCode.match(/requestStoragePath\(/g) ?? []).length === 2);
ok(`delete-account queues every legitimate plan-sheet key of an owned project (${sheetLegit.length}), unchanged — a bare path, or the public / signed URL an older row holds`,
  sheetLegit.every((k) => sheetKeyQueued(k) === k && (['sign', 'public', 'bare'] as const).every((kind) => sheetKeyQueued(asObjectUrl('plan-sheets', k, kind)) === k)
    && sheetKeyQueued(`https://ref.supabase.co/storage/v1/object/authenticated/plan-sheets/${k}`) === k));
const delSheetLeaks = sheetCorpus.filter((c) => sheetKeyQueued(c.path, new Set([OWN, VICTIM])) !== null
  || (typeof c.path === 'string' && (['sign', 'public', 'bare'] as const).some((kind) => {
    const k = sheetKeyQueued(asObjectUrl('plan-sheets', c.path as string, kind));
    return k !== null && k !== SHEET_GOOD;
  })));
ok(`delete-account: a row holding any of the ${sheetCorpus.length} attack forms (bare, with BOTH projects owned; or inside an object URL) queues nothing but the caller’s own key`,
  delSheetLeaks.length === 0, delSheetLeaks.map((c) => `${c.name}: ${show(c.path)}`).join('\n      '));
ok('delete-account: a well-formed key in a project the caller does not own queues nothing',
  sheetKeyQueued(`${VICTIM}/${SHEET_FILE}`) === null && sheetKeyQueued(asObjectUrl('plan-sheets', `${VICTIM}/${SHEET_FILE}`, 'public')) === null);

// The legacy shared folder: counted, never removed. A stranger's tmp key written into the caller's own row used to be deleted.
const TMP_KEY = `tmp/${BASE}-page-1.png`;
const TMP_FORMS: unknown[] = [TMP_KEY, 'tmp/x.png', 'tmp', 'tmp/', `tmp/../${OWN}/a.png`, `tmp/%2e%2e/${OWN}/a.png`, `tmp/${OWN}/a.png`,
  asObjectUrl('plan-sheets', TMP_KEY, 'public'), asObjectUrl('plan-sheets', TMP_KEY, 'sign'), asObjectUrl('plan-sheets', `%74mp/${BASE}-page-1.png`, 'public')];
ok(`delete-account: a row pointing into the legacy shared tmp/ folder is counted and queues NOTHING (${TMP_FORMS.length} spellings)`,
  deletePure.LEGACY_SHARED_PLAN_FOLDER === 'tmp'
  && TMP_FORMS.every((v) => deletePure.planSheetRowTarget(v, OWNED)?.kind === 'legacy-shared' && sheetKeyQueued(v) === null),
  TMP_FORMS.filter((v) => deletePure.planSheetRowTarget(v, OWNED)?.kind !== 'legacy-shared' || sheetKeyQueued(v) !== null).map(show).join(', '));
ok('…even for an account that somehow "owns" a project called tmp: the shared folder is decided first, and the rule refuses it anyway',
  deletePure.planSheetRowTarget(TMP_KEY, new Set(['tmp', OWN]))?.kind === 'legacy-shared'
  && requestStoragePath(TMP_KEY, PLAN_SHEET_PATH, { 0: 'tmp' }) === null && requestStoragePath(TMP_KEY, PLAN_SHEET_PATH) === null);
ok('…and a spelling that would need repairing to reach tmp/ (a leading slash, padding, another case) is neither counted nor queued',
  ['/' + TMP_KEY, ' ' + TMP_KEY, 'TMP/x.png', 'Tmp/x.png', './' + TMP_KEY].every((v) => deletePure.planSheetRowTarget(v, OWNED) === null && sheetKeyQueued(v) === null));
ok("delete-account names the legacy folder once, and no storage call's path is built from it",
  (deleteCode.match(/'tmp'/g) ?? []).length === 1 && /const LEGACY_SHARED_PLAN_FOLDER = 'tmp';/.test(deleteCode)
  && !/ownedPlanPrefixes/.test(deleteCode) && !/explicitObjects\w*\.push\(\s*(path|candidate|\{)/.test(deleteCode));
const successAt = deleteCode.lastIndexOf('success: true');
const successBody = successAt === -1 ? '' : deleteCode.slice(successAt, deleteCode.indexOf('})', successAt));
const tmpWarn = /console\.warn\(`\[delete-account\] ([^`]*)`\);/.exec(deleteCode.slice(deleteCode.indexOf('if (legacyTmpPlanSheetsKept > 0)')))?.[1] ?? '';
ok('the objects it left are COUNTED: in the response, and in one log line that carries the count and no key',
  /\blegacyTmpPlanSheetsKept,/.test(successBody)
  && /legacyTmpPlanSheetsKept\+\+;/.test(deleteCode) && /legacyTmpPlanSheetsKept: number;/.test(deleteCode)
  && /if \(legacyTmpPlanSheetsKept > 0\) \{\s*console\.warn\(/.test(deleteCode)
  && tmpWarn.includes('${legacyTmpPlanSheetsKept}') && (tmpWarn.match(/\$\{/g) ?? []).length === 1,
  show(tmpWarn));

// rfp-attachments: the value in the row is a public URL (uploadRfpAttachment returns getPublicUrl) or a path.
const rfpKeyQueued = (url: unknown): string | null => requestStoragePath(deletePure.storagePathFromUrl(url, 'rfp-attachments'), RFP_ATTACHMENT_PATH, { 0: UID });
const rfpLegit = legit.filter((l) => l.shape === RFP_ATTACHMENT_PATH && l.path !== null).map((l) => l.path as string);
ok(`delete-account queues every legitimate rfp-attachments key (${rfpLegit.length}) from the public URL the app stores, and from a bare path`,
  rfpLegit.length >= 50 && rfpLegit.every((k) => rfpKeyQueued(asObjectUrl('rfp-attachments', k, 'public')) === k && rfpKeyQueued(k) === k));
const RFP_FILE = '1759593600000_plan.pdf';
const RFP_GOOD = `${UID}/${BASE}/${RFP_FILE}`;
const rfpCorpus = attacks(`${UID}/${BASE}`, `${VICTIM_UID}/${BASE}`, RFP_FILE);
// The writer keeps the picked file's own name, so a few corpus forms ARE keys of the caller's own folder
// (`plan.pdf.`, `plan`, `plan.exe`, `plan.PDF`). What must hold for everything queued: it is a three-segment key
// directly inside the caller's own RFP folder, and it is the string the URL parser would carry unchanged.
const rfpOwnKey = (k: string): boolean => {
  const segs = k.split('/');
  return segs.length === 3 && segs[0] === UID && segs[1] === BASE && /^[0-9]+_[A-Za-z0-9._-]*$/.test(segs[2]) && new URL(`https://h/${k}`).pathname === `/${k}`;
};
const rfpQueuedFromCorpus: string[] = [];
const rfpLeaks = rfpCorpus.filter((c) => {
  const bare = rfpKeyQueued(c.path);
  if (bare !== null) { rfpQueuedFromCorpus.push(c.name); if (bare !== c.path || !rfpOwnKey(bare)) return true; }
  return typeof c.path === 'string' && (['sign', 'public', 'bare'] as const).some((kind) => {
    const k = rfpKeyQueued(asObjectUrl('rfp-attachments', c.path as string, kind));
    return k !== null && !rfpOwnKey(k);
  });
});
ok(`delete-account: a public_bids row holding any of the ${rfpCorpus.length} attack forms (bare or inside an object URL) queues nothing outside the caller’s own folder`,
  rfpLeaks.length === 0, rfpLeaks.map((c) => `${c.name}: ${show(c.path)}`).join('\n      '));
ok('…and the only bare corpus forms it queues are the six that are the writer’s own output',
  JSON.stringify(rfpQueuedFromCorpus) === JSON.stringify(['a trailing dot', 'two trailing dots', 'no extension', 'an extension no writer uses', 'an allowed extension that is not the last one', 'an uppercase extension']),
  rfpQueuedFromCorpus.join(', '));
ok('delete-account queues the names the old extension list refused: any extension, any case, none, and a long name',
  ['scan.jfif', 'logo.svg', 'raw.dng', 'icon.ico', 'photo.jp2', 'img.jxl', 'a.jpe', 'Drawing.Pdf', 'notes.docx', 'plan.dwg', 'README', 'a'.repeat(140) + '.pdf']
    .every((n) => rfpKeyQueued(asObjectUrl('rfp-attachments', rfpKeyFor(n), 'public')) === rfpKeyFor(n)));
ok("delete-account: another account's attachment, and a URL of another bucket or another host, queue nothing",
  rfpKeyQueued(asObjectUrl('rfp-attachments', `${VICTIM_UID}/${BASE}/${RFP_FILE}`, 'public')) === null && rfpKeyQueued(`${VICTIM_UID}/${BASE}/${RFP_FILE}`) === null
  && rfpKeyQueued(asObjectUrl('plan-sheets', RFP_GOOD, 'public')) === null && rfpKeyQueued(`https://evil.example/${RFP_GOOD}`) === null && rfpKeyQueued('file:///x.pdf') === null);
ok('storagePathFromUrl returns a bare value exactly as the row holds it (never cut at ? or #, never stripped of a slash)',
  ['a/b.png?x', 'a/b.png#x', '/a/b.png', ' a/b.png', 'a/b.png '].every((v) => deletePure.storagePathFromUrl(v, 'plan-sheets') === v)
  && deletePure.storagePathFromUrl('', 'plan-sheets') === null && deletePure.storagePathFromUrl(7, 'plan-sheets') === null);

// The folder walk (the two ledger entries below). list() / remove() are driven
// against a stub bucket; PAGE is 2 so paging and chunking both happen.
{
  const pieces = ['listPathsRecursive', 'removePaths', 'removePrefix'].map(closureText);
  ok('delete-account still has its three walk helpers', pieces.every((t) => t.startsWith('async (')));
  const maxDepth = Number(/const MAX_STORAGE_DEPTH = (\d+);/.exec(deleteCode)?.[1] ?? NaN);
  interface Walk { removePrefix(bucket: string, prefix: string): Promise<void>; counts(): { removed: number; listErrors: number; removeErrors: number } }
  const makeWalk = new Function('sb', 'PAGE', 'MAX_STORAGE_DEPTH', 'keptPhotoPrefixes', toJs(`
    let storageObjectsRemoved = 0; let storageListErrors = 0; let storageRemoveErrors = 0;
    const listPathsRecursive = ${pieces[0]};
    const removePaths = ${pieces[1]};
    const removePrefix = ${pieces[2]};
    return { removePrefix, counts: () => ({ removed: storageObjectsRemoved, listErrors: storageListErrors, removeErrors: storageRemoveErrors }) };
  `)) as (sb: unknown, page: number, depth: number, kept: string[]) => Walk;

  const KEPT_JOB = ITEM; // a job handed over to its owner: its photos stay
  const mine = [`${UID}/${OWN}/a.jpg`, `${UID}/${OWN}/b c.jpg`, `${UID}/${OWN}/%2e%2e`, `${UID}/${OWN}/deep/er/y.jpg`, `${UID}/${OWN}/z.heic`, `${UID}/top.png`, `${UID}/${OWN}/..x/q.jpg`];
  const kept = [`${UID}/${KEPT_JOB}/kept-1.jpg`, `${UID}/${KEPT_JOB}/kept-2.jpg`];
  const theirs = [`${VICTIM_UID}/${VICTIM}/v.jpg`, `${UID}x/sibling.jpg`, `${UID.slice(0, 35)}/short.jpg`, `tmp/${BASE}-page-1.png`];
  const buckets: Record<string, Set<string>> = {
    'project-photos': new Set([...mine, ...kept, ...theirs]),
    'plan-sheets': new Set([`${OWN}/img-1.png`, `${OWN}/${BASE}-page-2.png`, `${VICTIM}/img-2.png`, TMP_KEY, `tmp/${OWN}/trap.png`]),
  };
  const listed: { bucket: string; prefix: string }[] = [];
  const answered = new Set<string>();
  const removedNames: { bucket: string; name: string }[] = [];
  let failPrefix = '';
  const sbStub = {
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string, opts: { limit: number; offset: number }) => {
          listed.push({ bucket, prefix });
          if (prefix === failPrefix) return { data: null, error: { message: 'stub failure' } };
          const children = new Map<string, boolean>(); // name -> is a folder
          for (const name of buckets[bucket] ?? []) {
            if (!name.startsWith(prefix)) continue;
            const rest = name.slice(prefix.length);
            const first = rest.split('/')[0];
            children.set(first, rest.includes('/') || (children.get(first) ?? false));
          }
          const page = [...children.entries()].sort().slice(opts.offset, opts.offset + opts.limit);
          for (const [name, isFolder] of page) if (!isFolder) answered.add(`${bucket}|${prefix}${name}`);
          return { data: page.map(([name, isFolder]) => ({ name, id: isFolder ? null : 'object-id' })), error: null };
        },
        remove: async (names: string[]) => {
          const gone: { name: string }[] = [];
          for (const name of names) {
            removedNames.push({ bucket, name });
            if (buckets[bucket]?.delete(name)) gone.push({ name });
          }
          return { data: gone, error: null };
        },
      }),
    },
  };
  const quiet = console.error;
  const walk = makeWalk(sbStub, 2, maxDepth, [`${UID}/${KEPT_JOB}/`]);
  console.error = () => {};
  try {
    await walk.removePrefix('project-photos', `${UID}/`);
    await walk.removePrefix('plan-sheets', `${OWN}/`);
  } finally { console.error = quiet; }
  const counts = walk.counts();
  ok('the walk removes every object under the folder it was handed, whatever it is named (a space, a literal %2e%2e, three folders deep)',
    mine.every((n) => !buckets['project-photos'].has(n)) && !buckets['plan-sheets'].has(`${OWN}/img-1.png`) && !buckets['plan-sheets'].has(`${OWN}/${BASE}-page-2.png`),
    [...buckets['project-photos']].join(', '));
  ok('…and nothing else: another tenant, a folder whose name only STARTS like the caller’s, the legacy shared tmp/ folder, a handed-over job’s photos',
    theirs.every((n) => buckets['project-photos'].has(n)) && kept.every((n) => buckets['project-photos'].has(n))
    && buckets['plan-sheets'].has(`${VICTIM}/img-2.png`) && buckets['plan-sheets'].has(TMP_KEY) && buckets['plan-sheets'].has(`tmp/${OWN}/trap.png`));
  const roots: Record<string, string> = { 'project-photos': `${UID}/`, 'plan-sheets': `${OWN}/` };
  ok(`every list() prefix is the folder handed in, or that folder extended by names list() answered (${listed.length} calls)`,
    listed.length >= 8 && listed.every((l) => l.prefix.startsWith(roots[l.bucket]) && l.prefix.endsWith('/')), listed.map((l) => l.prefix).join(' '));
  ok(`every name handed to remove() is one list() answered under that folder — never a name from anywhere else (${removedNames.length} names)`,
    removedNames.length === mine.length + 2 && removedNames.every((r) => answered.has(`${r.bucket}|${r.name}`) && r.name.startsWith(roots[r.bucket])),
    removedNames.map((r) => r.name).join(' '));
  ok('the walk counts what it removed, and nothing failed', counts.removed === mine.length + 2 && counts.listErrors === 0 && counts.removeErrors === 0, JSON.stringify(counts));

  // A list() that fails is counted and removes nothing under it.
  buckets['project-photos'].add(`${UID}/${OWN}/later.jpg`);
  failPrefix = `${UID}/${OWN}/`;
  const before = removedNames.length;
  const walk2 = makeWalk(sbStub, 2, maxDepth, []);
  console.error = () => {};
  try { await walk2.removePrefix('project-photos', `${UID}/`); } finally { console.error = quiet; }
  ok('a list() that fails is counted, and the objects under it are left (not guessed at)',
    walk2.counts().listErrors === 1 && buckets['project-photos'].has(`${UID}/${OWN}/later.jpg`)
    && removedNames.slice(before).every((r) => r.name.startsWith(`${UID}/${KEPT_JOB}/`)));

  ok('the walk is handed only `<id>/` folders: the caller, a project of the caller’s, a subcontractor of the caller’s',
    JSON.stringify([...deleteCode.matchAll(/removePrefix\(bucket, `\$\{(\w+)\}\/`\)/g)].map((m) => m[1])) === JSON.stringify(['userId', 'projectId', 'subId'])
    && (deleteCode.match(/\bremovePrefix\(/g) ?? []).length === 3
    && /for \(const projectId of projectIds\) await removePrefix\(bucket, `\$\{projectId\}\/`\);/.test(deleteCode)
    && /for \(const subId of subcontractorIds\) await removePrefix\(bucket, `\$\{subId\}\/`\);/.test(deleteCode));
  ok('remove() in the walk receives list answers only: removePaths has one caller, the walk itself',
    (deleteCode.match(/\bremovePaths\(/g) ?? []).length === 1
    && /let paths = await listPathsRecursive\(bucket, prefix\);[\s\S]{0,400}await removePaths\(bucket, paths\);/.test(pieces[2])
    && /const full = `\$\{prefix\}\$\{name\}`;/.test(pieces[0]) && /found\.push\(\.\.\.await listPathsRecursive\(bucket, `\$\{full\}\/`, depth \+ 1\)\);/.test(pieces[0])
    && (pieces[0].match(/found\.push\(/g) ?? []).length === 2 && /found\.push\(full\);/.test(pieces[0]));
  PROOFS_RUN.add('accountDeletionWalk');
}

// --- convert-pdf-to-images: no request string in a log line ---------------------
{
  const CONVERT_FILE = `${FN_ROOT}/convert-pdf-to-images/index.ts`;
  const convertSrc = read(CONVERT_FILE);
  const convertSf = ts.createSourceFile(CONVERT_FILE, convertSrc, ts.ScriptTarget.Latest, true);
  /** Names that hold request text in this function (the body and what is destructured from it). */
  const REQUEST_NAMES = new Set(['body', 'pdfStoragePath', 'projectId']);
  const raw: string[] = [];
  let logCalls = 0;
  /** A request name may appear in a log argument only inside `isStorageId(x)`, `x.length`, `String(x).length` or `typeof x`. */
  const measured = (id: ts.Identifier): boolean => {
    const p = id.parent;
    if (ts.isTypeOfExpression(p)) return true;
    if (ts.isPropertyAccessExpression(p) && p.expression === id && p.name.text === 'length') return true;
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.arguments.length === 1 && p.arguments[0] === id) {
      if (p.expression.text === 'isStorageId') return true;
      if (p.expression.text === 'String' && ts.isPropertyAccessExpression(p.parent) && p.parent.expression === p && p.parent.name.text === 'length') return true;
    }
    return false;
  };
  const visitLogs = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(convertSf);
      if (callee === 'log' || /^console\.(log|warn|error|info|debug)$/.test(callee)) {
        logCalls++;
        const scan = (a: ts.Node) => {
          if (ts.isIdentifier(a) && REQUEST_NAMES.has(a.text) && isValueReference(a) && !measured(a)) {
            raw.push(`line ${convertSf.getLineAndCharacterOfPosition(n.getStart(convertSf)).line + 1}: ${a.text}`);
          }
          if (ts.isShorthandPropertyAssignment(a) && REQUEST_NAMES.has(a.name.text)) raw.push(`line ${convertSf.getLineAndCharacterOfPosition(n.getStart(convertSf)).line + 1}: { ${a.name.text} }`);
          a.forEachChild(scan);
        };
        n.arguments.forEach(scan);
      }
    }
    n.forEachChild(visitLogs);
  };
  visitLogs(convertSf);
  ok(`convert-pdf-to-images writes no request string to a log line: a request value appears there only as a length or a yes/no (${logCalls} log calls)`,
    logCalls >= 15 && raw.length === 0, raw.join('; '));
  ok('…the two refusals say what they need to and nothing the caller typed',
    /log\('idor_blocked_path', \{ userId: auth\.userId \}\);/.test(convertSrc)
    && /log\('idor_blocked_project', \{\s*projectIdIsId: isStorageId\(projectId\),\s*projectIdLength: typeof projectId === 'string' \? projectId\.length : -1,\s*userId: auth\.userId,\s*\}\);/.test(convertSrc)
    && /const \{ pdfStoragePath, projectId \} = body;/.test(convertSrc));
}

// ── 7. the sweep: every storage call in supabase/functions ──────────────────
console.log('\n7. every storage call in supabase/functions/** (derived from the syntax tree):');

/** Functions outside the rule module whose answer is proven above to be a safe key (or null). */
const PROVEN_PRODUCERS: Record<string, string[]> = {
  [RULE_FILE]: [...ruleProducers],
  [`${FN_ROOT}/_shared/messageFiles.ts`]: ['pathFor'],
  [`${FN_ROOT}/portal-message-files/core.ts`]: ['pathFor', 'folderFor'],
};
/** A helper that is handed `storage.from(bucket)` and a path: argument index of the path. It re-checks inside (section 5). */
const STORAGE_HELPERS: Record<string, number> = { mintLegacyViewUrl: 1 };
/** Storage method names that are not also PostgREST / array / Map method names: a site whatever the receiver. */
const DISTINCTIVE = new Set(['download', 'createSignedUrl', 'createSignedUrls', 'createSignedUploadUrl', 'uploadToSignedUrl', 'getPublicUrl']);

/**
 * THE LEDGER — storage calls whose path is not, by syntax alone, a constant or a
 * const the rule produced. Each was read; the reason is what makes it safe. An
 * entry that no longer matches a call fails (stale), and a call that is neither
 * proven nor listed fails (new). A URL-carried entry needs a `proof` that this
 * file executes; a body-carried one travels in JSON, where the storage server
 * matches the object name literally and no URL parser sees it (measured in 4).
 * An entry of either kind that names a proof must name one this file ran.
 *
 * Lane SEC3 took the ledger from nine entries to five. shared-photos-sign,
 * job-facts-view and signed-media-urls: their keys are rule answers now and each
 * call is proven by syntax (a collector that only ever receives rule answers
 * and is otherwise only read). seal-punch's `copied`: the same collector rule
 * proves it, so it needs no reviewed reason. delete-account's two folder-walk
 * calls stay, with an executed proof (see below).
 */
interface LedgerEntry { file: string; fn: string; method: string; arg: string; why: string; proof?: string; bucketWhy?: string }
const LEDGER: LedgerEntry[] = [
  {
    file: `${FN_ROOT}/portal-message-files/index.ts`, fn: 'download', method: 'createSignedUrl', arg: 'item.key',
    why: 'item comes from core.signable(): the stored path must EQUAL the key pathFor rebuilds from uuid-checked ids.',
    proof: 'signable',
  },
  {
    file: `${FN_ROOT}/portal-message-files/index.ts`, fn: 'removeKeys', method: 'remove', arg: 'keys',
    why: 'body-carried; every caller passes keyOf() results, which are pathFor() keys or dropped.',
  },
  {
    file: `${FN_ROOT}/portal-message-files/index.ts`, fn: 'urls', method: 'createSignedUrls', arg: 'keys',
    why: 'body-carried; keys are core.signable() items (stored path equals the rebuilt key).',
  },
  // delete-account's FOLDER WALK. These two calls cannot take the shape rule: a
  // departing user's files are removed whatever they are named, and refusing a
  // name the rule does not know would leave that file behind for good. What
  // makes them safe is that remove() only ever receives names list() answered
  // under a folder the walk was handed — and that is RUN in section 6b (the three
  // helpers are taken from the function's own source and driven against a stub
  // bucket holding another tenant's objects and the legacy shared tmp/ folder).
  // The keys delete-account reads out of ROWS no longer come through here: they
  // are rule answers with their own storage calls, proven by syntax below.
  {
    file: `${FN_ROOT}/delete-account/index.ts`, fn: 'listPathsRecursive', method: 'list', arg: 'prefix',
    why: 'body-carried; a prefix is `<id>/` built from the caller’s own user id or an id read from a uuid column of the caller’s rows, extended only by names list() answered under it.',
    proof: 'accountDeletionWalk',
    bucketWhy: 'the bucket names are a server-side list in the same function.',
  },
  {
    file: `${FN_ROOT}/delete-account/index.ts`, fn: 'removePaths', method: 'remove', arg: 'chunk',
    why: 'body-carried; object names are list() answers under the prefix the walk was handed, and nothing else (no row-derived key reaches this call any more).',
    proof: 'accountDeletionWalk',
    bucketWhy: 'the bucket names are a server-side list in the same function.',
  },
];

function edgeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) out.push(...edgeFiles(p));
    else if (/\.tsx?$/.test(name) && !/[._]test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

type Binding =
  | { kind: 'const'; init: ts.Expression | undefined }
  | { kind: 'import'; module: string; imported: string }
  | { kind: 'parameter'; fn: ts.SignatureDeclaration; index: number }
  | { kind: 'other'; what: string }
  | { kind: 'none' };

function namesIn(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const out: string[] = [];
  for (const el of name.elements) if (!ts.isOmittedExpression(el)) out.push(...namesIn(el.name));
  return out;
}
/** True when a `var <name>` is declared anywhere in this function's own body (not inside a function nested in it). */
function declaresVar(fn: ts.SignatureDeclaration, name: string): boolean {
  let found = false;
  const scan = (n: ts.Node) => {
    if (found || (n !== fn && ts.isFunctionLike(n))) return;
    if (ts.isVariableDeclarationList(n) && (n.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0 && n.declarations.some((d) => namesIn(d.name).includes(name))) { found = true; return; }
    n.forEachChild(scan);
  };
  scan(fn);
  return found;
}
/** The nearest lexical binding of an identifier, walking outwards from where it is used. */
function bindingOf(id: ts.Identifier, file: string): Binding {
  const name = id.text;
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) {
      // A `var` belongs to the whole function wherever it is written — inside a nested block it still
      // re-declares (and can re-assign) a parameter or hides an outer const of the same name.
      if (declaresVar(n, name)) return { kind: 'other', what: 'a var somewhere in this function (it can be reassigned)' };
      for (let i = 0; i < n.parameters.length; i++) {
        const p = n.parameters[i];
        if (ts.isIdentifier(p.name) && p.name.text === name) return { kind: 'parameter', fn: n, index: i };
        if (namesIn(p.name).includes(name)) return { kind: 'other', what: 'a destructured parameter' };
      }
    }
    if (ts.isCatchClause(n) && n.variableDeclaration && namesIn(n.variableDeclaration.name).includes(name)) return { kind: 'other', what: 'a catch variable' };
    if (ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isForStatement(n)) {
      const init = n.initializer;
      if (init && ts.isVariableDeclarationList(init) && init.declarations.some((d) => namesIn(d.name).includes(name))) return { kind: 'other', what: 'a loop variable' };
    }
    // A switch is ONE scope: a `let` in `case 1:` is the binding `case 2:` sees when control falls through.
    const statements = ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) ? n.statements
      : ts.isCaseBlock(n) ? n.clauses.flatMap((c) => [...c.statements]) : undefined;
    if (!statements) continue;
    for (const st of statements) {
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (!namesIn(d.name).includes(name)) continue;
          if (!ts.isIdentifier(d.name)) return { kind: 'other', what: 'a destructured variable' };
          return (st.declarationList.flags & ts.NodeFlags.Const) !== 0 ? { kind: 'const', init: d.initializer } : { kind: 'other', what: 'a let / var (it can be reassigned)' };
        }
      } else if (ts.isFunctionDeclaration(st) && st.name?.text === name) {
        return { kind: 'other', what: 'a function' };
      } else if (ts.isImportDeclaration(st) && st.importClause && ts.isStringLiteral(st.moduleSpecifier)) {
        const spec = st.moduleSpecifier.text;
        const module = spec.startsWith('.') ? normalize(join(dirname(file), spec)) : spec;
        const nb = st.importClause.namedBindings;
        if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) if (el.name.text === name) return { kind: 'import', module, imported: (el.propertyName ?? el.name).text };
        }
        if (st.importClause.name?.text === name || (nb && ts.isNamespaceImport(nb) && nb.name.text === name)) return { kind: 'other', what: 'a default / namespace import' };
      }
    }
  }
  return { kind: 'none' };
}

const unwrap = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e);

/** Is this expression a direct call of a proven producer (the rule, a builder on it, or pathFor / folderFor)? */
function isProducerCall(e: ts.Expression, file: string): boolean {
  const x = unwrap(e);
  if (!ts.isCallExpression(x) || !ts.isIdentifier(x.expression)) return false;
  const b = bindingOf(x.expression, file);
  return b.kind === 'import' && (PROVEN_PRODUCERS[b.module] ?? []).includes(b.imported);
}

/**
 * Array members that only READ the array and hand no reference to it to anyone.
 * No member that takes a callback is here: forEach / map / filter / some /
 * every / find / findIndex give the callback the array itself as its third
 * argument (and as `arguments[2]`), so `all.push(raw)` inside one is a way in.
 * A read that needs a callback is written as a for-of over the array.
 */
const READ_ONLY_MEMBERS = new Set(['length', 'slice', 'includes', 'indexOf', 'join', 'at']);
/** True when the identifier is USED as a value here (not a property name, a declaration name or a label). */
function isValueReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p)) && p.name === id) return false;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p)) && p.name === id) return false;
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return false;
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return false;
  return true;
}
/** True when the identifier is the NAME a declaration introduces (a variable, a destructured name, a parameter of a real function, a function or a class). */
function isDeclarationName(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isParameter(p)) {
    // A parameter name inside a TYPE (`(keys: string[]) => void`) declares nothing.
    const owner = p.parent;
    return p.name === id && !(ts.isFunctionTypeNode(owner) || ts.isConstructorTypeNode(owner) || ts.isMethodSignature(owner)
      || ts.isCallSignatureDeclaration(owner) || ts.isConstructSignatureDeclaration(owner) || ts.isIndexSignatureDeclaration(owner));
  }
  return (ts.isVariableDeclaration(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)
    || ts.isClassDeclaration(p) || ts.isClassExpression(p)) && p.name === id;
}
/**
 * True when the node sits where a value is WRITTEN: the left of an assignment
 * (also deep inside a destructuring pattern, `[...x] = rows`), the variable of
 * a for-of / for-in, the operand of ++ / --.
 */
function isWriteTarget(node: ts.Node): boolean {
  let child = node;
  for (let p = node.parent; p; child = p, p = p.parent) {
    if (ts.isBinaryExpression(p)) {
      const k = p.operatorToken.kind;
      return k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment && p.left === child;
    }
    if (ts.isForOfStatement(p) || ts.isForInStatement(p)) return p.initializer === child;
    if (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) return p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken;
    if (ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p)
      || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isParenthesizedExpression(p)) continue;
    return false;
  }
  return false;
}
/** `<x>.storage.from(<bucket>)` → the `.storage` node and the bucket argument. */
function storageFrom(e: ts.Expression): { storageNode: ts.Node; bucket: ts.Expression | undefined } | null {
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression) || e.expression.name.text !== 'from') return null;
  const recv = e.expression.expression;
  if (ts.isPropertyAccessExpression(recv) && recv.name.text === 'storage') return { storageNode: recv, bucket: e.arguments[0] };
  return null;
}
/**
 * The identifier is an argument of `<x>.storage.from(<bucket>).<storage method>(…)`:
 * a call the sweep judges as a site of its own, and one that changes nothing it
 * is handed. A method of the same NAME on any other receiver — `evil.remove(keys)`
 * — is not one: it could put anything into the array.
 */
function isStorageHandOff(n: ts.Identifier): boolean {
  const p = n.parent;
  if (!ts.isCallExpression(p) || !p.arguments.includes(n) || !ts.isPropertyAccessExpression(p.expression)) return false;
  const method = p.expression.name.text;
  return (method in transport || DISTINCTIVE.has(method)) && storageFrom(p.expression.expression) !== null;
}
/**
 * '' when this ONE reference to an array of keys only reads it, or hands it to a
 * storage call; else what it does. There is no "probably harmless" here: an
 * alias (`const y = x`), a `return x`, passing it to any other function, any
 * `x[i]`, any member that is not in READ_ONLY_MEMBERS — each is "not proven".
 */
function readOnlyUse(n: ts.Identifier, sf: ts.SourceFile): string {
  const p = n.parent;
  const name = n.text;
  if (ts.isPropertyAccessExpression(p) && p.expression === n) {
    const member = p.name.text;
    if (!READ_ONLY_MEMBERS.has(member)) return `${name}.${member} may put a value in it that the rule did not produce`;
    // Assigning `.length` can only shorten the array or leave empty slots: it cannot put a string in it.
    if (member === 'length') return '';
    return ts.isCallExpression(p.parent) && p.parent.expression === p ? '' : `${name}.${member} is taken as a value, not called`;
  }
  // `x[i] = …`, `[x[0]] = […]`, `x[i]++`: an index is a way in. Reading by index is not needed, so none is allowed.
  if (ts.isElementAccessExpression(p) && p.expression === n) return `an element of ${name} is addressed by index`;
  if (ts.isSpreadElement(p) && !isWriteTarget(p)) return '';
  if (ts.isForOfStatement(p) && p.expression === n) return '';
  if (isStorageHandOff(n)) return '';
  return `${name} is used in a way the sweep cannot follow (${p.getText(sf).replace(/\s+/g, ' ').slice(0, 60)})`;
}
/** True when `const x = <init>` is an exported declaration (another module could write to the array). */
function isExportedConst(init: ts.Expression): boolean {
  const decl = init.parent;
  const statement = ts.isVariableDeclaration(decl) && ts.isVariableDeclarationList(decl.parent) ? decl.parent.parent : undefined;
  return !!statement && ts.isVariableStatement(statement) && (ts.getCombinedModifierFlags(decl as ts.VariableDeclaration) & ts.ModifierFlags.Export) !== 0;
}
/** Runs `judge` on EVERY value reference in the file that resolves to the one `const name = <init>` binding; the first complaint wins. */
function constBindingProblem(name: string, init: ts.Expression, file: string, sf: ts.SourceFile, judge: (n: ts.Identifier) => string): string {
  if (isExportedConst(init)) return `${name} is exported (another module can write to it)`;
  let why = '';
  const visitRefs = (n: ts.Node) => {
    if (why) return;
    if (ts.isIdentifier(n) && n.text === name) {
      if (ts.isExportSpecifier(n.parent)) why = `${name} is exported (another module can write to it)`;
      else if (isValueReference(n)) {
        const b = bindingOf(n, file);
        if (b.kind === 'const' && b.init === init) why = judge(n);
      }
    }
    n.forEachChild(visitRefs);
  };
  visitRefs(sf);
  return why;
}
/**
 * A COLLECTOR: `const x: string[] = []` that only ever receives rule answers.
 * '' when every use of that one binding in the file is `x.push(<proven>)` or a
 * read-only use (readOnlyUse); else the first use that could put another value
 * in it.
 */
function collectorUnproven(name: string, init: ts.Expression, file: string, sf: ts.SourceFile, depth: number): string {
  let pushes = 0;
  const why = constBindingProblem(name, init, file, sf, (n) => {
    const p = n.parent;
    if (!(ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === 'push')) return readOnlyUse(n, sf);
    const call = p.parent;
    if (!ts.isCallExpression(call) || call.expression !== p || call.arguments.length === 0) return `${name}.push is used as a value, not called`;
    for (const arg of call.arguments) {
      const argWhy = ts.isSpreadElement(arg) ? 'it spreads another value' : unproven(arg, file, sf, depth + 1);
      if (argWhy) return `${name} receives a value that is not proven (${argWhy})`;
    }
    pushes++;
    return '';
  });
  if (why) return why;
  return pushes > 0 ? '' : `nothing is ever pushed into ${name}`;
}
/** `<collector>.slice(…)` → the collector identifier, else null. A slice of an array of rule answers is rule answers. */
function sliceBase(e: ts.Expression): ts.Identifier | null {
  const x = unwrap(e);
  if (!ts.isCallExpression(x) || !ts.isPropertyAccessExpression(x.expression) || x.expression.name.text !== 'slice') return null;
  const base = unwrap(x.expression.expression);
  return ts.isIdentifier(base) ? base : null;
}
/** '' when the identifier is bound to a collector (see collectorUnproven), else why not. */
function collectorIdentifierUnproven(id: ts.Identifier, file: string, sf: ts.SourceFile, depth: number): string {
  const b = bindingOf(id, file);
  if (b.kind !== 'const' || !b.init) return `${id.text} is not a const array`;
  const init = unwrap(b.init);
  if (!ts.isArrayLiteralExpression(init) || init.elements.length !== 0) return `${id.text} does not start as an empty array`;
  return collectorUnproven(id.text, b.init, file, sf, depth);
}
/**
 * `const chunk = <collector>.slice(…)`. The copy holds rule answers when it is
 * made — and stays that way only while NOTHING writes to it. So every use of
 * the copy must be read-only too (no push at all): `chunk.push(raw)`,
 * `chunk[0] = raw`, an alias, handing it to another function are each a refusal.
 */
function sliceConstUnproven(name: string, init: ts.Expression, base: ts.Identifier, file: string, sf: ts.SourceFile, depth: number): string {
  const baseWhy = collectorIdentifierUnproven(base, file, sf, depth + 1);
  if (baseWhy) return `const ${name} slices ${base.text}, which is not a proven collector (${baseWhy})`;
  const copyWhy = constBindingProblem(name, init, file, sf, (n) => readOnlyUse(n, sf));
  return copyWhy ? `const ${name} is a slice of ${base.text}, but it is written to or leaves the sweep's sight afterwards (${copyWhy})` : '';
}

/**
 * The direct calls of a LOCAL function declaration, or why the sweep cannot see
 * every value a parameter of it may receive: the function is not a plain named
 * declaration, it is exported, its name is used as a value, nobody calls it, or
 * a caller spreads its arguments (then argument N is not parameter N).
 */
function directCallers(fn: ts.SignatureDeclaration, paramName: string, sf: ts.SourceFile): { calls: ts.CallExpression[]; why: string } {
  const fnName = ts.isFunctionDeclaration(fn) && fn.name ? fn.name.text : '';
  if (!fnName) return { calls: [], why: `${paramName} is a parameter` };
  if ((ts.getCombinedModifierFlags(fn as ts.FunctionDeclaration) & ts.ModifierFlags.Export) !== 0) return { calls: [], why: `${paramName} is a parameter of an exported function` };
  const calls: ts.CallExpression[] = [];
  let otherUses = 0;
  const find = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === fnName) calls.push(n);
    if (ts.isIdentifier(n) && n.text === fnName && !(ts.isCallExpression(n.parent) && n.parent.expression === n) && n.parent !== fn) otherUses++;
    n.forEachChild(find);
  };
  find(sf);
  if (calls.length === 0 || otherUses > 0) return { calls: [], why: `${paramName} is a parameter of ${fnName}, which is not only called directly` };
  if (calls.some((c) => c.arguments.some((a) => ts.isSpreadElement(a)))) return { calls: [], why: `${paramName} is a parameter of ${fnName}, and a caller spreads its arguments` };
  return { calls, why: '' };
}
/**
 * '' when NOTHING inside the function can change what parameter `index` holds
 * between the call and the storage call: it is a plain parameter (not a rest,
 * no default), the function never touches `arguments` or `eval`, the name is
 * never declared again inside it, and every use of it passes `judge` — an
 * allow-list of reads. An assignment (`bucket = other`, `[...keys] = rows`,
 * `keys.push(raw)`) is on no allow-list.
 */
function parameterHeldUnproven(fn: ts.SignatureDeclaration, index: number, file: string, sf: ts.SourceFile, judge: (n: ts.Identifier) => string): string {
  const param = fn.parameters[index];
  if (!ts.isIdentifier(param.name)) return 'the parameter is destructured';
  const name = param.name.text;
  if (param.dotDotDotToken) return `${name} is a rest parameter (it collects every further argument)`;
  if (param.initializer) return `${name} has a default value`;
  let why = '';
  const scan = (n: ts.Node) => {
    if (why) return;
    if (ts.isIdentifier(n)) {
      if ((n.text === 'arguments' || n.text === 'eval') && isValueReference(n)) why = `the function uses ${n.text}, which can reach ${name} another way`;
      else if (n.text === name && n !== param.name && isDeclarationName(n)) why = `${name} is declared again inside the function`;
      else if (n.text === name && n !== param.name && isValueReference(n)) {
        const b = bindingOf(n, file);
        why = b.kind === 'parameter' && b.fn === fn && b.index === index ? judge(n) : `${name} names something else inside the function`;
      }
    }
    n.forEachChild(scan);
  };
  scan(fn);
  return why;
}
const COMPARISON_OPERATORS: readonly ts.SyntaxKind[] = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken];
/** '' when this reference only READS a bucket parameter (a string): an argument of a call, a comparison, a template span. */
function bucketParameterUse(n: ts.Identifier, sf: ts.SourceFile): string {
  const p = n.parent;
  if (ts.isCallExpression(p) && p.arguments.includes(n)) return '';
  if (ts.isBinaryExpression(p) && COMPARISON_OPERATORS.includes(p.operatorToken.kind)) return '';
  if (ts.isTemplateSpan(p) && p.expression === n) return '';
  return `${n.text} is assigned, or used in a way the sweep cannot follow (${p.getText(sf).replace(/\s+/g, ' ').slice(0, 60)})`;
}

/** '' when the path expression is proven by syntax, else the reason it is not. */
function unproven(e: ts.Expression | undefined, file: string, sf: ts.SourceFile, depth = 0): string {
  if (!e) return 'there is no path argument';
  const x = unwrap(e);
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return '';
  if (isProducerCall(x, file)) return '';
  // A slice of a collector, made in place: nothing else holds the copy. (Never a slice of a single key: a slice of a STRING is a different string.)
  const sliced = sliceBase(x);
  if (sliced) {
    if (depth > 3) return `${sliced.text}.slice(…) is nested too deep to follow`;
    const baseWhy = collectorIdentifierUnproven(sliced, file, sf, depth + 1);
    return baseWhy ? `it slices ${sliced.text}, which is not a proven collector (${baseWhy})` : '';
  }
  if (ts.isArrayLiteralExpression(x)) {
    for (const el of x.elements) {
      const why = ts.isSpreadElement(el) ? 'it spreads another value' : unproven(el, file, sf, depth);
      if (why) return `an element is not proven: ${why}`;
    }
    return x.elements.length > 0 ? '' : 'it is an empty array';
  }
  if (ts.isIdentifier(x)) {
    const b = bindingOf(x, file);
    if (b.kind === 'const') {
      if (b.init && isProducerCall(b.init, file)) return '';
      if (b.init && depth <= 3) {
        // `const chunk = keys.slice(i, i + N)` — a slice of a collector, and the copy is never written to.
        const sliceOf = sliceBase(b.init);
        if (sliceOf) return sliceConstUnproven(x.text, b.init, sliceOf, file, sf, depth);
        // `const keys: string[] = []` that only ever receives rule answers.
        const init = unwrap(b.init);
        if (ts.isArrayLiteralExpression(init) && init.elements.length === 0) return collectorUnproven(x.text, b.init, file, sf, depth);
      }
      return `const ${x.text} is not assigned from the rule`;
    }
    if (b.kind === 'parameter') {
      // A parameter is proven when the function is local, not exported, EVERY call of it passes a proven
      // value, and nothing inside the function writes to it on the way to the storage call.
      if (depth > 1) return `${x.text} is a parameter`;
      const callers = directCallers(b.fn, x.text, sf);
      if (callers.why) return callers.why;
      for (const c of callers.calls) {
        const why = unproven(c.arguments[b.index], file, sf, depth + 1);
        if (why) return `${x.text} is a parameter, and a caller passes a value that is not proven (${why})`;
      }
      const held = parameterHeldUnproven(b.fn, b.index, file, sf, (n) => readOnlyUse(n, sf));
      return held ? `${x.text} is a parameter that the function may change before the storage call (${held})` : '';
    }
    if (b.kind === 'import') return `${x.text} is imported, not produced by the rule here`;
    if (b.kind === 'other') return `${x.text} is ${b.what}`;
    return `${x.text} has no binding in this file`;
  }
  return 'it is an expression, not a constant or a const the rule produced';
}

/**
 * '' when the bucket is a string literal, a module-level const string, an
 * imported constant, or a parameter of a local, non-exported function that
 * EVERY call fills with one of those and that the function never assigns.
 */
function bucketUnproven(e: ts.Expression | undefined, file: string, sf: ts.SourceFile, depth = 0): string {
  if (!e) return 'there is no bucket argument';
  const x = unwrap(e);
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return '';
  if (ts.isIdentifier(x)) {
    const b = bindingOf(x, file);
    if (b.kind === 'import') return '';
    if (b.kind === 'const' && b.init && (ts.isStringLiteral(unwrap(b.init)) || ts.isNoSubstitutionTemplateLiteral(unwrap(b.init)))) return '';
    if (b.kind === 'parameter') {
      if (depth > 0) return `${x.text} is not a constant`;
      const callers = directCallers(b.fn, x.text, sf);
      if (callers.why) return callers.why;
      for (const c of callers.calls) {
        const why = bucketUnproven(c.arguments[b.index], file, sf, depth + 1);
        if (why) return `${x.text} is a parameter, and a caller passes a bucket that is not a constant (${why})`;
      }
      const held = parameterHeldUnproven(b.fn, b.index, file, sf, (n) => bucketParameterUse(n, sf));
      return held ? `${x.text} is a parameter that the function may change before the storage call (${held})` : '';
    }
    if (b.kind === 'other') return `${x.text} is ${b.what}`;
    return `${x.text} is not a constant`;
  }
  return 'it is an expression';
}

function enclosingName(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      const p = n.parent;
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
      if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'serve') return 'serve';
    }
  }
  return '<module>';
}

interface Site {
  file: string; line: number; fn: string; method: string; arg: string;
  pathWhy: string; bucketWhy: string; transport: 'url' | 'body' | 'none' | 'unknown';
}
interface Sweep {
  sites: Site[];
  strayStorage: string[];
  rawStorageFetch: string[];
  ruleCalls: { file: string; line: number; text: string; pinned: boolean }[];
}
const newSweep = (): Sweep => ({ sites: [], strayStorage: [], rawStorageFetch: [], ruleCalls: [] });

/** Sweep ONE source text: every storage call in it, with what the prover says about its path and its bucket. */
function sweepSource(file: string, text: string, into: Sweep): ts.SourceFile {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const accounted = new Set<ts.Node>();
  const addSite = (node: ts.Node, method: string, pathArg: ts.Expression | undefined, bucketArg: ts.Expression | undefined, hasBucket: boolean) => {
    const base = method.split(' ')[0];
    into.sites.push({
      file, line: lineOf(node), fn: enclosingName(node), method, arg: pathArg ? pathArg.getText(sf).replace(/\s+/g, ' ') : '',
      pathWhy: unproven(pathArg, file, sf), bucketWhy: hasBucket ? bucketUnproven(bucketArg, file, sf) : '',
      transport: base in transport ? transport[base] : base === 'getPublicUrl' ? 'none' : 'unknown',
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const from = storageFrom(node.expression.expression);
        if (from) {
          accounted.add(from.storageNode);
          addSite(node, method, node.arguments[0], from.bucket, true);
          if (method === 'move' || method === 'copy') addSite(node, `${method} (destination)`, node.arguments[1], from.bucket, true);
        } else if (DISTINCTIVE.has(method)) {
          addSite(node, method, node.arguments[0], undefined, false);
        }
      }
      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (name in STORAGE_HELPERS) {
          node.arguments.forEach((a) => {
            const from = storageFrom(a);
            if (from) {
              accounted.add(from.storageNode);
              addSite(node, `createSignedUrl (through ${name})`, node.arguments[STORAGE_HELPERS[name]], from.bucket, true);
            }
          });
        }
        if (name === 'fetch' && node.arguments[0] && /storage\/v1/.test(node.arguments[0].getText(sf))) into.rawStorageFetch.push(`${file}:${lineOf(node)}`);
        if (name === 'requestStoragePath' && file !== RULE_FILE) {
          into.ruleCalls.push({ file, line: lineOf(node), text: node.getText(sf).replace(/\s+/g, ' '), pinned: node.arguments.length >= 3 });
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  const stray = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'storage' && !accounted.has(node)) into.strayStorage.push(`${file}:${lineOf(node)} ${node.parent.getText(sf).slice(0, 80)}`);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'storage') into.strayStorage.push(`${file}:${lineOf(node)} ${node.getText(sf).slice(0, 80)}`);
    // `const { storage } = svc` — the client's storage taken out by destructuring, which no `.storage.from(…)` pattern would see.
    if (ts.isBindingElement(node) && ts.isIdentifier(node.propertyName ?? node.name) && (node.propertyName ?? node.name).getText(sf) === 'storage') into.strayStorage.push(`${file}:${lineOf(node)} ${node.parent.getText(sf).slice(0, 80)}`);
    node.forEachChild(stray);
  };
  stray(sf);
  return sf;
}

const swept = newSweep();
const { sites, strayStorage, rawStorageFetch, ruleCalls } = swept;
const sources = new Map<string, ts.SourceFile>();
for (const file of edgeFiles(FN_ROOT)) sources.set(file, sweepSource(file, read(file), swept));

ok(`the sweep found the storage calls (${sites.length} in ${new Set(sites.map((s) => s.file)).size} files)`, sites.length >= 20, String(sites.length));
ok('every `.storage` in the tree is `.storage.from(bucket).<method>(…)` or handed to a known helper (no alias the sweep cannot follow)',
  strayStorage.length === 0, strayStorage.join('\n      '));
ok('no function builds a storage REST URL for fetch() by hand', rawStorageFetch.length === 0, rawStorageFetch.join(', '));
ok('every storage method in use has a measured transport', sites.every((s) => s.transport !== 'unknown'),
  sites.filter((s) => s.transport === 'unknown').map((s) => `${s.file}:${s.line} ${s.method}`).join(', '));

const keyOf = (s: { file: string; fn: string; method: string; arg: string }) => `${s.file} | ${s.fn} | ${s.method} | ${s.arg}`;
const ledgerByKey = new Map(LEDGER.map((l) => [keyOf(l), l]));
const used = new Set<string>();
let proven = 0;
for (const s of sites) {
  const where = `${s.file}:${s.line} ${s.fn}() .${s.method}(${s.arg})`;
  const entry = ledgerByKey.get(keyOf(s));
  if (entry) used.add(keyOf(s));
  if (!s.pathWhy) {
    proven++;
    ok(`${where} — a constant or a key the rule produced`, !entry, 'this call is proven by syntax; remove its ledger entry');
  } else if (s.transport === 'url') {
    ok(`${where} — URL-carried, ledger entry with an executed proof`,
      !!entry && !!entry.proof && PROOFS_RUN.has(entry.proof),
      `the path goes into a URL and is not proven: ${s.pathWhy}. Pass it through requestStoragePath (${RULE_FILE}) in the same function.`);
  } else {
    ok(`${where} — ${s.transport === 'body' ? 'body-carried' : 'no request'}, reviewed in the ledger`, !!entry,
      `not proven (${s.pathWhy}) and not in the ledger. Pass it through requestStoragePath, or add a ledger entry with the reason it is safe.`);
  }
  if (s.bucketWhy) {
    ok(`${where} — the bucket is not a constant, reviewed`, s.transport !== 'url' && !!entry?.bucketWhy,
      `${s.bucketWhy}; a bucket name goes into the URL for every method, so a URL-carried call needs a constant bucket.`);
  } else if (entry?.bucketWhy) {
    ok(`${where} — ledger bucket note is still needed`, false, 'the bucket is a constant now; drop bucketWhy');
  }
}
const stale = LEDGER.filter((l) => !used.has(keyOf(l)));
ok('no ledger entry is stale', stale.length === 0, stale.map(keyOf).join('\n      '));
ok('URL-carried calls outnumber nothing they should not: every one is proven or carries an executed proof',
  sites.filter((s) => s.transport === 'url').every((s) => !s.pathWhy || !!ledgerByKey.get(keyOf(s))?.proof));
console.log(`     (${proven} proven by syntax, ${used.size} in the ledger, ${sites.filter((s) => s.transport === 'url').length} URL-carried)`);

ok('every ledger entry that names a proof names one this file executed', LEDGER.every((l) => !l.proof || PROOFS_RUN.has(l.proof)),
  LEDGER.filter((l) => l.proof && !PROOFS_RUN.has(l.proof)).map(keyOf).join('\n      '));
// The ledger, pinned whole: a new exception is an edit of this list, in review, with its reason beside it.
ok('the ledger is exactly the reviewed five: portal-message-files (3) and delete-account’s folder walk (2)',
  LEDGER.map((l) => `${l.file.slice(FN_ROOT.length + 1)} ${l.fn}.${l.method}`).sort().join(' | ')
    === 'delete-account/index.ts listPathsRecursive.list | delete-account/index.ts removePaths.remove | portal-message-files/index.ts download.createSignedUrl | portal-message-files/index.ts removeKeys.remove | portal-message-files/index.ts urls.createSignedUrls',
  LEDGER.map((l) => `${l.file.slice(FN_ROOT.length + 1)} ${l.fn}.${l.method}`).sort().join(' | '));
// The four functions lane SEC3 moved onto the rule: every storage call that takes a key read from a row or a
// request is proven by syntax with a constant bucket — no reviewed reason stands in for the rule any more.
const RULED_FILES = ['signed-media-urls/index.ts', 'shared-photos-sign/index.ts', 'job-facts-view/index.ts'].map((f) => `${FN_ROOT}/${f}`);
const ruledSites = sites.filter((x) => RULED_FILES.includes(x.file) || (x.file === `${FN_ROOT}/delete-account/index.ts` && x.fn === 'serve'));
ok(`signed-media-urls, shared-photos-sign, job-facts-view and delete-account’s row keys: all ${ruledSites.length} storage calls are proven by syntax, constant bucket, no ledger entry`,
  ruledSites.length === 5 && ruledSites.every((x) => x.pathWhy === '' && x.bucketWhy === '' && !ledgerByKey.has(keyOf(x)))
  && RULED_FILES.every((f) => sites.filter((x) => x.file === f).length === 1 && !LEDGER.some((l) => l.file === f))
  && ruledSites.filter((x) => x.file.endsWith('delete-account/index.ts')).map((x) => `${x.method}(${x.arg})`).join() === 'remove(chunk),remove(chunk)',
  ruledSites.map((x) => `${x.file}:${x.line} ${x.method}(${x.arg}) ${x.pathWhy || x.bucketWhy || 'proven'}`).join('\n      '));
ok('delete-account’s row keys are removed from two buckets named in the call itself, each chunk a slice of the array the rule filled',
  /const chunk = explicitObjectsPlanSheets\.slice\(i, i \+ PAGE\);\s*try \{\s*const \{ data, error \} = await sb\.storage\.from\('plan-sheets'\)\.remove\(chunk\);/.test(deleteCode)
  && /const chunk = explicitObjectsRfp\.slice\(i, i \+ PAGE\);\s*try \{\s*const \{ data, error \} = await sb\.storage\.from\('rfp-attachments'\)\.remove\(chunk\);/.test(deleteCode)
  && (deleteCode.match(/explicitObjectsPlanSheets\.push\(/g) ?? []).length === 1 && (deleteCode.match(/explicitObjectsRfp\.push\(/g) ?? []).length === 1);

// ── 7b. the prover has teeth: planted sources ───────────────────────────────
// The sweep above only shows that today's tree passes. These run the SAME
// sweepSource over small planted functions: the shapes the prover accepts must
// stay accepted, and each way of getting an unchecked string into a storage
// call must be flagged.
console.log('\n7b. the sweep, run over planted sources (what it accepts, and what it must flag):');
const PLANTED_FILE = `${FN_ROOT}/planted-probe/index.ts`;
const PLANT_HEAD = "import { requestStoragePath, PLAN_SHEET_PATH } from '../_shared/storagePath.ts';\n";
const plantedSweep = (body: string): Sweep => { const sw = newSweep(); sweepSource(PLANTED_FILE, PLANT_HEAD + body, sw); return sw; };
const plantedSites = (body: string): Site[] => plantedSweep(body).sites;
/** One function: a collector filled by `fill`, then `call`. */
const plant = (fill: string, call: string, decl = 'const keys: string[] = [];'): string => `
async function probe(svc: any, rows: string[], pid: string) {
  ${decl}
  for (const r of rows) {
    const key = requestStoragePath(r, PLAN_SHEET_PATH, { 0: pid });
    ${fill}
  }
  ${call}
}`;
const GOOD_FILL = 'if (key) keys.push(key);';
const SIGN_ALL = "await svc.storage.from('plan-sheets').createSignedUrls(keys, 60);";
const REMOVE_CHUNKS = "for (let i = 0; i < keys.length; i += 2) { const chunk = keys.slice(i, i + 2); await svc.storage.from('plan-sheets').remove(chunk); }";
const REMOVE_CHUNK = "await svc.storage.from('plan-sheets').remove(chunk);";
const provenPlant = (body: string): boolean => { const st = plantedSites(body); return st.length >= 1 && st.every((x) => x.pathWhy === '' && x.bucketWhy === ''); };
const flaggedPlant = (body: string): boolean => plantedSites(body).some((x) => x.pathWhy !== '' || x.bucketWhy !== '');
/** Flagged, and FOR THE REASON under test: a probe that is refused for some other reason proves nothing about the rule it names. */
const flaggedFor = (body: string, reason: RegExp): boolean => plantedSites(body).some((x) => reason.test(x.pathWhy) || reason.test(x.bucketWhy));
const plantedWhy = (body: string): string => plantedSites(body).map((x) => `${x.method}: ${x.pathWhy || x.bucketWhy || 'PROVEN'}`).join('; ');
ok('accepted: an array that only ever receives rule answers, handed to a storage call', provenPlant(plant(GOOD_FILL, SIGN_ALL)));
ok('accepted: a slice of that array (chunked removal), as a const or inline',
  provenPlant(plant(GOOD_FILL, REMOVE_CHUNKS)) && provenPlant(plant(GOOD_FILL, "await svc.storage.from('plan-sheets').remove(keys.slice(0, 1000));")));
ok('accepted: reading the array on the way (length, includes, indexOf, join, at, for-of, spread into a Set)',
  provenPlant(plant('if (key && !keys.includes(key)) keys.push(key);', `if (keys.length === 0 || keys.indexOf('x') > 0) return; for (const k of keys) void k; void new Set([...keys]); void keys.join(','); void keys.at(0); ${SIGN_ALL}`)));
ok('accepted: reading the SLICE on the way (its length in a log line, a for-of, the storage call)',
  provenPlant(plant(GOOD_FILL, 'const chunk = keys.slice(0, 2); if (chunk.length > 0) { for (const k of chunk) void k; console.log(`${chunk.length} keys`); ' + REMOVE_CHUNK + ' }')));
ok('accepted: a module-level collector that is not exported', provenPlant(`const keys: string[] = [];${plant(GOOD_FILL, SIGN_ALL, '')}`));
const PLANTED_BAD: [string, string][] = [
  ['the raw string is pushed', plant('keys.push(r);', SIGN_ALL)],
  ['the rule answer OR the raw string is pushed', plant('keys.push(key ?? r);', SIGN_ALL)],
  ['a second, raw argument rides along in the push', plant('if (key) keys.push(key, r);', SIGN_ALL)],
  ['the request array is spread into it', plant(`${GOOD_FILL} keys.push(...rows);`, SIGN_ALL)],
  ['a raw string is unshifted into it', plant(`${GOOD_FILL} keys.unshift(r);`, SIGN_ALL)],
  ['a raw string is spliced into it', plant(`${GOOD_FILL} keys.splice(0, 0, r);`, SIGN_ALL)],
  ['an element is assigned directly', plant(`${GOOD_FILL} keys[0] = r;`, SIGN_ALL)],
  ['an element is assigned through a destructuring', plant(`${GOOD_FILL} [keys[0]] = [r];`, SIGN_ALL)],
  ['it is aliased, and the alias receives the raw string', plant(`${GOOD_FILL} const alias = keys; alias.push(r);`, SIGN_ALL)],
  ['it is handed to another function (which could add to it)', plant(`${GOOD_FILL} taint(keys, r);`, SIGN_ALL)],
  ['it is returned (an alias leaves the function)', plant(GOOD_FILL, `${SIGN_ALL} return keys;`)],
  ['it is a let (it can be replaced wholesale)', plant(GOOD_FILL, SIGN_ALL, 'let keys: string[] = [];')],
  ['it does not start empty', plant(GOOD_FILL, SIGN_ALL, 'const keys: string[] = [rows[0]];')],
  ['it starts as the request array', plant(GOOD_FILL, SIGN_ALL, 'const keys: string[] = rows;')],
  ['nothing is ever pushed into it', plant('void key;', SIGN_ALL)],
  ['the call is handed a map over the request instead', plant(GOOD_FILL, "await svc.storage.from('plan-sheets').createSignedUrls(rows.map((r) => r), 60);")],
  ['the call is handed the collector concatenated with the request', plant(GOOD_FILL, "await svc.storage.from('plan-sheets').createSignedUrls(keys.concat(rows), 60);")],
  ['the chunk is a slice of the request array', plant(GOOD_FILL, "const chunk = rows.slice(0, 2); await svc.storage.from('plan-sheets').remove(chunk);")],
  ['a slice of ONE key (a different string) is downloaded', plant('if (key) await svc.storage.from(\'plan-sheets\').download(key.slice(37));', '')],
  ['an inner block shadows the collector with the request array', plant(GOOD_FILL, `{ const keys = rows; ${SIGN_ALL} }`)],
  ['the bucket comes from the request', plant(GOOD_FILL, 'await svc.storage.from(pid).createSignedUrls(keys, 60);')],
  // A SLICE of the collector is a second array. It is proven only while nothing writes to it (review round 1:
  // `const chunk = keys.slice(…)` was trusted whatever happened to `chunk` afterwards).
  ['a raw string is pushed into the slice', plant(GOOD_FILL, `const chunk = keys.slice(0, 2); chunk.push(rows[0]); ${REMOVE_CHUNK}`)],
  ['an element of the slice is assigned', plant(GOOD_FILL, `const chunk = keys.slice(0, 2); chunk[0] = rows[0]; ${REMOVE_CHUNK}`)],
  ['a raw string is unshifted into the slice', plant(GOOD_FILL, `const chunk = keys.slice(0, 2); chunk.unshift(rows[0]); ${REMOVE_CHUNK}`)],
  ['a raw string is spliced into the slice', plant(GOOD_FILL, `const chunk = keys.slice(0, 2); chunk.splice(0, 0, rows[0]); ${REMOVE_CHUNK}`)],
  ['the slice is filled with a raw string', plant(GOOD_FILL, `const chunk = keys.slice(0, 2); chunk.fill(rows[0]); ${REMOVE_CHUNK}`)],
  ['the slice is aliased, and the alias receives the raw string', plant(GOOD_FILL, `const chunk = keys.slice(0, 2); const alias = chunk; alias.push(rows[0]); ${REMOVE_CHUNK}`)],
  ['the slice is handed to another function (which could add to it)', plant(GOOD_FILL, `const chunk = keys.slice(0, 2); taint(chunk, rows[0]); ${REMOVE_CHUNK}`)],
  ['a callback over the slice writes through its third argument', plant(GOOD_FILL, `const chunk = keys.slice(0, 2); chunk.forEach((k, i, all) => { all.push(rows[0]); }); ${REMOVE_CHUNK}`)],
  ['the slice is a let (it can be replaced wholesale)', plant(GOOD_FILL, `let chunk = keys.slice(0, 2); chunk = rows; ${REMOVE_CHUNK}`)],
  ['the chunk is a slice of a slice of the request', plant(GOOD_FILL, `const part = rows.slice(0, 9); const chunk = part.slice(0, 2); ${REMOVE_CHUNK}`)],
  // A callback is handed the array itself (third argument, and `arguments[2]`): no callback member is a "read".
  ...['forEach', 'map', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'flatMap'].map((member): [string, string] => [
    `a ${member} callback over the collector writes through its third argument`,
    plant(GOOD_FILL, `keys.${member}((k, i, all) => { all.push(rows[0]); return true; }); ${SIGN_ALL}`)]),
  ['a reduce callback over the collector writes through its fourth argument', plant(GOOD_FILL, `keys.reduce((n, k, i, all) => all.push(rows[0]), 0); ${SIGN_ALL}`)],
  ['a forEach callback writes through `arguments`, declaring no parameter at all', plant(GOOD_FILL, `keys.forEach(function () { arguments[2].push(rows[0]); }); ${SIGN_ALL}`)],
  ['a forEach callback writes through `this`', plant(GOOD_FILL, `keys.forEach(function (this: string[]) { this.push(rows[0]); }, keys); ${SIGN_ALL}`)],
  ['the collector is filled with a raw string', plant(GOOD_FILL, `keys.fill(rows[0]); ${SIGN_ALL}`)],
  ['Array.prototype.push is called on it', plant(GOOD_FILL, `Array.prototype.push.call(keys, rows[0]); ${SIGN_ALL}`)],
  ['Object.assign writes into it', plant(GOOD_FILL, `Object.assign(keys, rows); ${SIGN_ALL}`)],
  ['its push is taken as a value and called later', plant(GOOD_FILL, `const add = keys.push; add.call(keys, rows[0]); ${SIGN_ALL}`)],
  ['it is the target of a destructuring with a rest', plant(GOOD_FILL, `[...keys] = rows; ${SIGN_ALL}`)],
  // A method that only SHARES A NAME with a storage method is not a storage call: it could put anything in the array.
  ['it is handed to remove() of something that is not storage', plant(GOOD_FILL, `await evil.remove(keys); ${SIGN_ALL}`)],
  ['it is handed to something that only looks like a bucket (x.from(…).remove)', plant(GOOD_FILL, `await evil.from('plan-sheets').remove(keys); ${SIGN_ALL}`)],
  ['it is handed to createSignedUrls() of something that is not storage', plant(GOOD_FILL, 'await evil.createSignedUrls(keys, 60);')],
  // A `var` belongs to the whole function, wherever it is written.
  ['a var in a nested block hides the rule answer of the enclosing function', `
async function probe(svc: any, rows: string[], pid: string) {
  const key = requestStoragePath(rows[0], PLAN_SHEET_PATH, { 0: pid });
  async function inner() { if (rows.length > 1) { var key = rows[1]; } await svc.storage.from('plan-sheets').download(key); }
  if (key) await inner();
}`],
  // A `let` in one case of a switch is what the next case sees when control falls through.
  ['a let in an earlier case of the same switch hides the rule answer', `
async function probe(svc: any, rows: string[], pid: string, n: number) {
  const key = requestStoragePath(rows[0], PLAN_SHEET_PATH, { 0: pid });
  if (!key) return;
  switch (n) {
    case 1: let key = rows[1];
    case 2: await svc.storage.from('plan-sheets').download(key);
  }
}`],
  // An exported collector can be written to from another module.
  ['the collector is an exported const', `export const keys: string[] = [];${plant(GOOD_FILL, SIGN_ALL, '')}`],
  ['the collector is exported by name', `const keys: string[] = [];\nexport { keys };${plant(GOOD_FILL, SIGN_ALL, '')}`],
];
for (const [label, body] of PLANTED_BAD) {
  const why = plantedSites(body).map((x) => `${x.method}: ${x.pathWhy || x.bucketWhy || 'PROVEN'}`).join('; ');
  ok(`flagged: ${label}`, flaggedPlant(body), why);
  if (process.env.SWEEP_REASONS) console.log(`      ${why}`); // SWEEP_REASONS=1 prints why each planted source is flagged
}
{
  // A storage call the sweep cannot see as `.storage.from(bucket).<method>(…)` is refused as a stray, not skipped.
  const strays: [string, string][] = [
    ['the storage client is aliased', "async function probe(svc: any, rows: string[]) { const st = svc.storage; await st.from('plan-sheets').remove(rows); }"],
    ['the storage client is taken out by destructuring', "async function probe(svc: any, rows: string[]) { const { storage } = svc; await storage.from('plan-sheets').remove(rows); }"],
    ['…or by a renaming destructuring', "async function probe(svc: any, rows: string[]) { const { storage: st } = svc; await st.from('plan-sheets').remove(rows); }"],
    ['the bucket handle is kept in a variable', "async function probe(svc: any, rows: string[]) { const b = svc.storage.from('plan-sheets'); await b.remove(rows); }"],
    ['the method is reached by index', "async function probe(svc: any, rows: string[]) { await svc.storage.from('plan-sheets')['remove'](rows); }"],
    ['the client is reached by index', "async function probe(svc: any, rows: string[]) { await svc['storage'].from('plan-sheets').remove(rows); }"],
  ];
  for (const [label, body] of strays) {
    const sw = plantedSweep(body);
    ok(`flagged as a stray: ${label}`, sw.strayStorage.length > 0, `${sw.sites.length} site(s), ${sw.strayStorage.length} stray(s)`);
  }
  ok('a plain `.storage.from(bucket).<method>(…)` is never a stray', plantedSweep(plant(GOOD_FILL, SIGN_ALL)).strayStorage.length === 0);
}
{
  // Two functions, one name: the proof follows the BINDING, not the spelling.
  const two = `${plant(GOOD_FILL, SIGN_ALL)}\nasync function other(svc: any, rows: string[]) { const keys: string[] = []; for (const r of rows) keys.push(r); await svc.storage.from('plan-sheets').createSignedUrls(keys, 60); }`;
  const st = plantedSites(two);
  ok('a collector is judged by its own binding: the same name in another function neither taints it nor vouches for it',
    st.length === 2 && st.filter((x) => x.fn === 'probe').every((x) => x.pathWhy === '') && st.filter((x) => x.fn === 'other').every((x) => x.pathWhy !== ''),
    st.map((x) => `${x.fn}: ${x.pathWhy || 'proven'}`).join('; '));
  // A bucket parameter is a constant only when every caller makes it one.
  const signer = (callers: string, head = 'async function sign', inside = '') => `
const SHEETS = 'plan-sheets';
const pid0 = 'project-photos';
${head}(svc: any, bucket: string, rows: string[], pid: string) {
  ${inside}
  const keys: string[] = [];
  for (const r of rows) { const key = requestStoragePath(r, PLAN_SHEET_PATH, { 0: pid }); if (key) keys.push(key); }
  await svc.storage.from(bucket).createSignedUrls(keys, 60);
}
async function caller(svc: any, rows: string[], pid: string, fromRequest: string) { ${callers} }`;
  const TWO_CONSTANTS = "await sign(svc, SHEETS, rows, pid); await sign(svc, 'project-photos', rows, pid);";
  /** The two ways the prover says "the function itself can change this parameter". */
  const HELD = /may change before the storage call|is a var somewhere in this function/;
  ok('accepted: a bucket parameter that every caller fills with a constant', provenPlant(signer(TWO_CONSTANTS)));
  ok('accepted: …that the function also compares and logs (reads)',
    provenPlant(signer(TWO_CONSTANTS, 'async function sign', "if (bucket !== SHEETS && bucket === 'x') return; console.error('sign failed', bucket, `in ${bucket}`);")));
  ok('flagged: one caller fills the bucket from the request', flaggedPlant(signer('await sign(svc, SHEETS, rows, pid); await sign(svc, fromRequest, rows, pid);')));
  ok('flagged: the function with the bucket parameter is exported (a caller this file cannot see)', flaggedPlant(signer('await sign(svc, SHEETS, rows, pid);', 'export async function sign')));
  ok('flagged: the function is passed around as a value', flaggedPlant(signer('await sign(svc, SHEETS, rows, pid); const s = sign; await s(svc, fromRequest, rows, pid);')));
  ok('flagged: nobody calls it (nothing proves the bucket)', flaggedPlant(signer('void svc;')));
  // Review round 1: a bucket parameter every caller fills with a constant was trusted even when the function
  // itself replaced it before the storage call. Each line below is one way to do that.
  const BUCKET_WRITES: [string, string][] = [
    ['assigned', 'bucket = pid;'],
    ['assigned in a branch', "if (rows.length > 3) bucket = rows[3];"],
    ['appended to', "bucket += '/../other';"],
    ['assigned with ??=', 'bucket ??= pid;'],
    ['assigned through an array destructuring', '[bucket] = rows;'],
    ['assigned through an object destructuring', '({ bucket } = { bucket: pid });'],
    ['assigned through a renamed object destructuring', '({ b: bucket } = { b: pid });'],
    ['the variable of a for-of', 'for (bucket of rows) { void bucket; }'],
    ['assigned inside a closure that runs first', '(() => { bucket = pid; })();'],
    ['assigned inside a call argument', 'void String(bucket = pid);'],
    ['re-declared by a var in a nested block', '{ var bucket = pid; }'],
    ['reached through arguments', 'arguments[1] = pid;'],
    ['reached through eval', "eval('bucket = pid');"],
  ];
  for (const [how, statement] of BUCKET_WRITES) {
    const body = signer(TWO_CONSTANTS, 'async function sign', statement);
    ok(`flagged: every caller passes a constant bucket, but inside the function it is ${how}`, flaggedFor(body, HELD) && plantedSites(body).every((x) => x.pathWhy === ''), plantedWhy(body));
    if (process.env.SWEEP_REASONS) console.log(`      ${plantedWhy(body)}`);
  }
  ok('flagged: a caller spreads its arguments, so the constant it writes at position 2 is not the bucket',
    flaggedFor(signer("const pre = [svc, fromRequest] as const; await sign(...pre, 'plan-sheets', rows, pid);"), /a caller spreads its arguments/));
  ok('flagged: the bucket parameter has a default value', flaggedFor(signer(TWO_CONSTANTS, 'async function sign', '').replace('bucket: string,', 'bucket: string = pid0,'), /has a default value/));
  // A PATH parameter gets the same treatment, with the array rules on top (no write of any kind).
  const remover = (inside: string, callers: string, params = 'svc: any, keys: string[], raw: string') => `
async function rm(${params}) {
  ${inside}
  await svc.storage.from('plan-sheets').remove(keys);
}
async function caller(svc: any, rows: string[], pid: string) {
  const good: string[] = [];
  for (const r of rows) { const key = requestStoragePath(r, PLAN_SHEET_PATH, { 0: pid }); if (key) good.push(key); }
  ${callers}
}`;
  const GOOD_CALLER = 'await rm(svc, good.slice(0, 5), rows[0]);';
  ok('accepted: an array parameter every caller fills with a slice of a collector, and the function only reads',
    provenPlant(remover('if (keys.length === 0) return; for (const k of keys) void k;', `${GOOD_CALLER} await rm(svc, good.slice(5), rows[1]);`)));
  const PATH_WRITES: [string, string][] = [
    ['pushed to', 'keys.push(raw);'],
    ['assigned', 'keys = [raw];'],
    ['assigned by index', 'keys[0] = raw;'],
    ['unshifted to', 'keys.unshift(raw);'],
    ['spliced', 'keys.splice(0, 0, raw);'],
    ['the target of a destructuring with a rest', '[...keys] = [raw];'],
    ['written through a callback’s third argument', 'keys.forEach((k, i, all) => { all.push(raw); });'],
    ['handed to another function', 'taint(keys, raw);'],
    ['aliased', 'const alias = keys; alias.push(raw);'],
    ['reached through arguments', 'arguments[1].push(raw);'],
    ['re-declared by a var in a nested block', '{ var keys = [raw]; }'],
  ];
  for (const [how, statement] of PATH_WRITES) {
    const body = remover(statement, GOOD_CALLER);
    ok(`flagged: every caller passes a slice of a collector, but inside the function the array is ${how}`, flaggedFor(body, HELD) && plantedSites(body).every((x) => x.bucketWhy === ''), plantedWhy(body));
    if (process.env.SWEEP_REASONS) console.log(`      ${plantedWhy(body)}`);
  }
  ok('flagged: one caller passes the request array', flaggedFor(remover('', `${GOOD_CALLER} await rm(svc, rows, rows[0]);`), /a caller passes a value that is not proven/));
  ok('flagged: a caller passes the collector itself (the function could then write to it)', flaggedFor(remover('', 'await rm(svc, good, rows[0]);'), /a caller passes a value that is not proven \(good is used in a way the sweep cannot follow/));
  ok('flagged: the path parameter is a rest parameter (it collects every further argument)',
    flaggedFor(remover('', 'await rm(svc, good.slice(0, 5), rows[0]);', 'svc: any, ...keys: any[]'), /is a rest parameter/));
  ok('flagged: the path parameter has a default value', flaggedFor(remover('', GOOD_CALLER, 'svc: any, keys: string[] = [raw0], raw?: string'), /has a default value/));
  ok('flagged: a caller spreads its arguments', flaggedFor(remover('', 'const pre = [svc, rows] as const; await rm(...pre, good.slice(0, 5), rows[0]);'), /a caller spreads its arguments/));
}

// The pin: a request path is tied to the caller. Every use of the rule outside
// the plan-sheet helper pins at least the first segment; the helper instead
// checks project access on the validated string (executed in section 5).
const unpinned = ruleCalls.filter((c) => !c.pinned && c.file !== `${FN_ROOT}/_shared/planSheetBytes.ts`);
ok(`every requestStoragePath() call in a function pins a segment to the caller (${ruleCalls.length} calls)`,
  ruleCalls.length >= 5 && unpinned.length === 0, unpinned.map((c) => `${c.file}:${c.line} ${c.text}`).join('\n      '));
const sheetSrc = read(`${FN_ROOT}/_shared/planSheetBytes.ts`);
ok('planSheetBytes downloads only a key whose project passed the access check',
  /const path = requestStoragePath\(entry, PLAN_SHEET_PATH\);\s*if \(!path \|\| !reachable\.has\(storagePathSegment\(path, 0\)\)\) throw new PlanSheetAccessError\(\);\s*const \{ data, error \} = await supabase\.storage\.from\(PLAN_SHEET_BUCKET\)\.download\(path\);/.test(sheetSrc));
ok('planSheetBytes takes the project id from the validated string, not from the request',
  /const key = requestStoragePath\(p, PLAN_SHEET_PATH\);\s*if \(!key\) throw new PlanSheetAccessError\(\);\s*checked\.push\(key\);\s*projectIds\.add\(storagePathSegment\(key, 0\)\);/.test(sheetSrc));

// The three sites that used a prefix check.
const sealPunch = read(`${FN_ROOT}/seal-punch/index.ts`);
const sealDoc = read(`${FN_ROOT}/seal-document/index.ts`);
const convert = read(`${FN_ROOT}/convert-pdf-to-images/index.ts`);
ok('seal-punch: the after photo must be <owner>/<this project>/<file>, by the rule',
  /const src = requestStoragePath\(r\.after_photo_uri, PUNCH_AFTER_PHOTO_PATH, \{ 0: uid, 1: project\.id \}\);/.test(sealPunch));
ok('seal-punch: `copied` only ever receives the built destination key',
  (sealPunch.match(/copied\.push\(/g) ?? []).length === 1 && /copied\.push\(dest\);/.test(sealPunch)
  && /const dest = punchSealPhotoPath\(uid, sealId, id\);/.test(sealPunch));
ok('seal-punch: the record PDF is the rebuilt key, and the request must equal it',
  /const recordKey = punchSealRecordPath\(uid, seal_id\);\s*if \(!recordKey \|\| storage_path !== recordKey\)/.test(sealPunch)
  && /pdf_path: recordKey/.test(sealPunch));
ok('seal-document: the key is rebuilt from the caller and the contract ROW, and the request must equal it',
  /const sealedKey = contractPdfPath\(auth\.userId, ownRes\.data\.id\);\s*if \(!sealedKey \|\| storage_path !== sealedKey\)/.test(sealDoc)
  && /signed_pdf_url: sealedKey, document_hash/.test(sealDoc));
ok('convert-pdf-to-images: the PDF key is the rule’s answer, pinned to the caller',
  /const pdfPath = requestStoragePath\(pdfStoragePath, PDF_UPLOAD_PATH, \{ 0: auth\.userId \}\);/.test(convert));
ok('convert-pdf-to-images: pages are written under the project row it read, not the request’s spelling',
  /const outPath = planSheetPagePath\(ownedProject\.id, baseId, pageNumber\);/.test(convert));
const stripComments = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const prefixChecks = [...sources.keys()].filter((f) => /\.startsWith\(`\$\{[^}]+\}\/`\)/.test(stripComments(read(f))));
ok('no function checks ownership of a path by its prefix (startsWith(`${id}/`))', prefixChecks.length === 0, prefixChecks.join(', '));

// ── 8. ask-files: a plan page and a client's message file ───────────────────
// The AI file reader names a stored file two ways: a plan page by its key (from
// the request), a client's message file by two ids (the key is rebuilt on the
// server). Both downloads sit behind the rule; this section runs them.
console.log('\n8. ask-files (a plan page by key, a client message file by ids), executed:');

interface AskFilesCore {
  planSheetKey(raw: unknown): string;
  ownedPlanSheetKey(key: unknown, ownedJobs: Iterable<string>): string;
  parseAskFilesRequest(body: unknown): { ok: boolean };
}
const ASK_CORE_FILE = `${FN_ROOT}/ask-files/core.ts`;
const ASK_INDEX_FILE = `${FN_ROOT}/ask-files/index.ts`;
const MSG_LOADER_FILE = `${FN_ROOT}/_shared/messageFileBytes.ts`;
const askCore = await import(fromHere(ASK_CORE_FILE)) as AskFilesCore;
const askPlanBody = (path: unknown) => ({ mode: 'ask', question: 'What is on this sheet?', files: [{ source: 'plan', storagePath: path, name: 'A-101' }] });

const planLegit = legit.filter((l) => l.shape === PLAN_SHEET_PATH && l.path !== null).map((l) => l.path as string);
ok(`ask-files takes every legitimate plan key (${planLegit.length}), unchanged, for a caller who owns its project`,
  planLegit.length >= 7 && planLegit.every((k) => askCore.planSheetKey(k) === k && askCore.ownedPlanSheetKey(k, [OWN]) === k && askCore.parseAskFilesRequest(askPlanBody(k)).ok === true));
ok('…and refuses the same keys for a caller who owns only ANOTHER project (the pin), or none',
  planLegit.every((k) => askCore.ownedPlanSheetKey(k, [VICTIM]) === '' && askCore.ownedPlanSheetKey(k, []) === ''));
const askFenceLeaks = sheetAttacks.filter((c) => askCore.planSheetKey(c.path) !== '' || askCore.parseAskFilesRequest(askPlanBody(c.path)).ok !== false);
ok(`ask-files: none of the ${sheetAttacks.length} attack paths gets past the request parser`, askFenceLeaks.length === 0, askFenceLeaks.map((c) => `${c.name}: ${show(c.path)}`).join('\n      '));
const askRuleLeaks = sheetAttacks.filter((c) => askCore.ownedPlanSheetKey(c.path, [OWN, VICTIM]) !== '');
ok('ask-files: none of them is a key to load, even with BOTH projects owned', askRuleLeaks.length === 0, askRuleLeaks.map((c) => `${c.name}: ${show(c.path)}`).join('\n      '));
ok("ask-files: a well-formed key in another tenant's project is not a key to load",
  askCore.ownedPlanSheetKey(`${VICTIM}/${BASE}-page-1.png`, [OWN]) === '' && askCore.planSheetKey(`${VICTIM}/${BASE}-page-1.png`) !== '');

// The function's own fence and the rule say the same thing about every string.
const fenceRand = mulberry32(20261005);
let fenceDisagree = 0, fenceAccepted = 0;
const firstDisagreements: string[] = [];
for (let i = 0; i < FUZZ_RUNS; i++) {
  let str = fenceRand() < 0.6 ? `${OWN}/` : '';
  const n = 1 + Math.floor(fenceRand() * 5);
  for (let k = 0; k < n; k++) str += TOKENS[Math.floor(fenceRand() * TOKENS.length)];
  const byRule = requestStoragePath(str, PLAN_SHEET_PATH) !== null;
  const byFence = askCore.planSheetKey(str) !== '';
  if (byRule) fenceAccepted++;
  if (byRule !== byFence) { fenceDisagree++; if (firstDisagreements.length < 3) firstDisagreements.push(show(str)); }
  if (byFence && askCore.ownedPlanSheetKey(str, [OWN]) !== (str.startsWith(`${OWN}/`) ? str : '')) { fenceDisagree++; if (firstDisagreements.length < 3) firstDisagreements.push(`owned: ${show(str)}`); }
}
const EDGE_KEYS = [`${OWN.toUpperCase()}/a.png`, `${OWN}/a.PNG`, `${OWN}/a.jpeg`, `${OWN}/a.webp`, `${OWN}/a.JPG`, `${OWN}/${'a'.repeat(124)}.png`, `${OWN}/${'a'.repeat(125)}.png`,
  `${OWN}/${'a'.repeat(196)}.png`, `${OWN}/plán.png`, `${OWN}/a..png`, `${OWN}/a.png.jpg`, `${OWN}/_a.png`, `tmp/${BASE}-page-1.png`];
const edgeDisagree = EDGE_KEYS.filter((k) => (requestStoragePath(k, PLAN_SHEET_PATH) !== null) !== (askCore.planSheetKey(k) !== ''));
ok(`ask-files: its own fence and the rule agree on ${FUZZ_RUNS} fuzzed strings (${fenceAccepted} accepted) and on the edge spellings (case, .jpeg, .webp, length, non-ASCII)`,
  fenceAccepted >= 200 && fenceDisagree === 0 && edgeDisagree.length === 0, [...firstDisagreements, ...edgeDisagree.map(show)].join(', '));

const askCoreSrc = read(ASK_CORE_FILE);
const askIndexSrc = read(ASK_INDEX_FILE);
ok('ask-files: the key to load is the rule’s answer, pinned to a project that passed the owner check',
  /const checked = requestStoragePath\(key, PLAN_SHEET_PATH, \{ 0: job \}\);\s*if \(checked !== null\) return checked;/.test(askCoreSrc)
  && /if \(!\(await callerOwnsProject\(svc, auth\.userId, job\)\)\) return fail\("file_unavailable", 403\);\s*ownedJobs\.add\(job\);/.test(askIndexSrc)
  && (askIndexSrc.match(/ownedJobs\.add\(/g) ?? []).length === 1);
ok('ask-files: the plan loader is handed that key and nothing else',
  /const planKey = PLAN_PAGES_OWNER_ONLY !== false \? ownedPlanSheetKey\(file\.storagePath, ownedJobs\) : file\.storagePath;\s*if \(planKey === ""\) return fail\("file_unavailable", 403\);/.test(askIndexSrc)
  && (askIndexSrc.match(/loadPlanSheetImageParts\(/g) ?? []).length === 1 && askIndexSrc.includes('await loadPlanSheetImageParts([planKey], auth.userId,'));
ok('ask-files has no storage call of its own: its two downloads are the plan-sheet helper’s and the message loader’s (both swept above)',
  sites.filter((x) => x.file.startsWith(`${FN_ROOT}/ask-files/`)).length === 0
  && sites.filter((x) => x.file === MSG_LOADER_FILE).length === 1 && sites.filter((x) => x.file === MSG_LOADER_FILE).every((x) => x.method === 'download' && x.pathWhy === '' && x.bucketWhy === ''));
ok('no ledger entry speaks for ask-files or its loader (both are proven by syntax)',
  LEDGER.every((l) => !l.file.startsWith(`${FN_ROOT}/ask-files/`) && l.file !== MSG_LOADER_FILE));

// The message loader, run against a stub database and a stub bucket.
interface MsgLoaderModule {
  loadOwnedMessageFiles(svc: unknown, callerId: string, refs: { messageId: string; attachmentId: string }[],
    opts: { maxBytesEach: number; maxBytesTotal: number; notBefore: string }): Promise<{ files: { name: string }[] }>;
  MessageFileAccessError: new () => Error;
}
const msgLoader = await import(fromHere(MSG_LOADER_FILE)) as MsgLoaderModule;
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const msgDownloads: string[] = [];
let msgQueries = 0;
/** A database holding ONE client message (BASE, on project OWN, owned by UID) whose single attachment carries `storedPath`. */
function msgSvc(storedPath: unknown, attachmentId: string = ITEM) {
  const rows: Record<string, Record<string, unknown>[]> = {
    portal_messages: [{ id: BASE, project_id: OWN, author_type: 'client', body: 'hello', created_at: '2026-11-02T10:00:00Z',
      attachments: [{ id: attachmentId, name: 'a.jpg', mime: 'image/jpeg', size: JPEG_BYTES.length, kind: 'image', path: storedPath }] }],
    projects: [{ id: OWN, user_id: UID }, { id: VICTIM, user_id: VICTIM_UID }],
  };
  return {
    from: (table: string) => ({
      select: () => {
        const filters: [string, string][] = [];
        const q = {
          eq: (c: string, v: string) => { filters.push([c, v]); return q; },
          maybeSingle: async () => { msgQueries++; return { data: (rows[table] ?? []).find((r) => filters.every(([c, v]) => String(r[c]).toLowerCase() === String(v).toLowerCase())) ?? null, error: null }; },
        };
        return q;
      },
    }),
    storage: { from: () => ({ download: async (key: string) => { msgDownloads.push(key); return { data: { arrayBuffer: async () => JPEG_BYTES.buffer.slice(0) }, error: null }; } }) },
  };
}
const MSG_OPTS = { maxBytesEach: 1 << 20, maxBytesTotal: 1 << 21, notBefore: '2026-11-01T00:00:00Z' };
const MSG_KEY = `${OWN}/${BASE}/${ITEM}.jpg`;
const msgRef = [{ messageId: BASE, attachmentId: ITEM }];
const tryMsg = async (svc: unknown, caller: string, refs: { messageId: string; attachmentId: string }[]): Promise<'ok' | 'access' | 'other'> => {
  try { await msgLoader.loadOwnedMessageFiles(svc, caller, refs, MSG_OPTS); return 'ok'; }
  catch (e) { return e instanceof msgLoader.MessageFileAccessError ? 'access' : 'other'; }
};
msgDownloads.length = 0;
ok('message loader: the owner reads his client’s file, and the bucket is asked for exactly <project>/<message>/<attachment>.jpg',
  (await tryMsg(msgSvc(MSG_KEY), UID, msgRef)) === 'ok' && JSON.stringify(msgDownloads) === JSON.stringify([MSG_KEY]), JSON.stringify(msgDownloads));
msgDownloads.length = 0;
ok('message loader: the same ids from another account download nothing',
  (await tryMsg(msgSvc(MSG_KEY), VICTIM_UID, msgRef)) === 'access' && msgDownloads.length === 0);
msgDownloads.length = 0;
const msgCorpus = attacks(`${OWN}/${BASE}`, `${VICTIM}/${BASE}`, `${ITEM}.jpg`);
const msgLeaks: string[] = [];
for (const c of msgCorpus) {
  const how = await tryMsg(msgSvc(c.path), UID, msgRef);
  if (how !== 'access' || msgDownloads.length > 0) { msgLeaks.push(`${c.name}: ${how} ${show(msgDownloads[0])}`); msgDownloads.length = 0; }
}
ok(`message loader: a row whose stored path is any of the ${msgCorpus.length} attack forms downloads nothing (the key is rebuilt, never read from the row)`, msgLeaks.length === 0, msgLeaks.join('\n      '));
msgDownloads.length = 0; msgQueries = 0;
const nastyRefs = NASTY.flatMap((b) => [[{ messageId: b, attachmentId: ITEM }], [{ messageId: BASE, attachmentId: b }]]);
let nastyWrong = 0;
for (const r of nastyRefs) if ((await tryMsg(msgSvc(MSG_KEY), UID, r)) !== 'access') nastyWrong++;
ok(`message loader: ${nastyRefs.length} requests whose ids are not ids make no query and no download`, nastyWrong === 0 && msgQueries === 0 && msgDownloads.length === 0, `${nastyWrong} wrong, ${msgQueries} queries, ${msgDownloads.length} downloads`);
const msgLoaderSrc = read(MSG_LOADER_FILE);
ok('message loader: the download takes the rule’s answer for the built key, pinned to the owned project and the message',
  /const ownedProject = projectId\.toLowerCase\(\);/.test(msgLoaderSrc)
  && /const key = requestStoragePath\(w\.key, MESSAGE_ATTACHMENT_PATH, \{ 0: ownedProject, 1: messageId \}\);\s*if \(!key\) throw new MessageFileAccessError\(\);\s*const got = await svc\.storage\.from\(MESSAGE_FILES_BUCKET\)\.download\(key\);/.test(msgLoaderSrc)
  && (msgLoaderSrc.match(/\.download\(/g) ?? []).length === 1);

console.log(`\n${fail === 0 ? '✓' : '✗'} storage paths: ${pass} passed, ${fail} failed (${corpusSize} attack forms × ${TARGETS.length} shapes)\n`);
if (fail > 0) process.exit(1);
