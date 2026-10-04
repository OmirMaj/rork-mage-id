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
//      one of them being removed.
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
//      a constant, or a const the rule produced, or a parameter every caller
//      fills that way. Whatever is left must be in the reviewed ledger below
//      with its reason — a new storage call that is none of those fails here.
//
// Nothing in this file touches the network. Run from the repo root:
//   bun run scripts/validate-storage-paths.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import ts from 'typescript';
import { StorageClient } from '@supabase/storage-js';
import { buildPlanSheetImagePath } from '../utils/planSheetImageCore';
import { buildPhotoStoragePath } from '../utils/photoUploadCore';

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
  | { kind: 'literal'; value: string };
interface Shape { bucket: string; segments: readonly SegmentRule[] }
interface StoragePathModule {
  STORAGE_PATH_MAX_LENGTH: number;
  STORAGE_FILE_NAME_MAX_LENGTH: number;
  PLAN_SHEET_PATH: Shape;
  PDF_UPLOAD_PATH: Shape;
  CONTRACT_PDF_PATH: Shape;
  PUNCH_AFTER_PHOTO_PATH: Shape;
  PUNCH_SEAL_PHOTO_PATH: Shape;
  PUNCH_SEAL_RECORD_PATH: Shape;
  isStorageId(v: unknown): boolean;
  storagePathHasForbiddenChar(path: string): boolean;
  storagePathSegments(path: string): string[] | null;
  storageSegmentMatches(segment: string, rule: SegmentRule): boolean;
  storagePathSurvivesUrlParser(path: string): boolean;
  requestStoragePath(raw: unknown, shape: Shape, pinned?: Record<number, string>): string | null;
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
  PUNCH_SEAL_PHOTO_PATH, PUNCH_SEAL_RECORD_PATH, requestStoragePath,
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

interface Legit { name: string; shape: Shape; path: string | null; pinned?: Record<number, string> }
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

// punch-seals.
ok('punchSealShare still uploads the record to <userId>/<sealId>/record.pdf',
  read('utils/punchSealShare.ts').includes('return `${userId}/${sealId}/record.pdf`;'));
legit.push({ name: 'punch-seals: the sealed record PDF', shape: PUNCH_SEAL_RECORD_PATH, path: `${UID}/${BASE}/record.pdf`, pinned: { 0: UID, 1: BASE } });
ok('punchSealRecordPath rebuilds exactly what the app uploads', rule.punchSealRecordPath(UID, BASE) === `${UID}/${BASE}/record.pdf`);
legit.push({ name: 'punch-seals: a copied after photo', shape: PUNCH_SEAL_PHOTO_PATH, path: rule.punchSealPhotoPath(UID, BASE, ITEM), pinned: { 0: UID, 1: BASE } });

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

interface Target { name: string; shape: Shape; own: string; victim: string; file: string; pinned?: Record<number, string> }
const TARGETS: Target[] = [
  { name: 'plan-sheets', shape: PLAN_SHEET_PATH, own: OWN, victim: VICTIM, file: `${BASE}-page-1.png` },
  { name: 'pdf-uploads', shape: PDF_UPLOAD_PATH, own: UID, victim: VICTIM_UID, file: `${BASE}-plans.pdf`, pinned: { 0: UID } },
  { name: 'secure-contracts', shape: CONTRACT_PDF_PATH, own: UID, victim: VICTIM_UID, file: `${BASE}.pdf`, pinned: { 0: UID } },
  { name: 'project-photos (after photo)', shape: PUNCH_AFTER_PHOTO_PATH, own: `${UID}/${OWN}`, victim: `${VICTIM_UID}/${VICTIM}`, file: `punch-${ITEM}-after.jpg`, pinned: { 0: UID, 1: OWN } },
  { name: 'punch-seals (photo)', shape: PUNCH_SEAL_PHOTO_PATH, own: `${UID}/${BASE}`, victim: `${VICTIM_UID}/${BASE}`, file: `${ITEM}.jpg`, pinned: { 0: UID, 1: BASE } },
  { name: 'punch-seals (record)', shape: PUNCH_SEAL_RECORD_PATH, own: `${UID}/${BASE}`, victim: `${VICTIM_UID}/${BASE}`, file: 'record.pdf', pinned: { 0: UID, 1: BASE } },
];
let corpusSize = 0;
for (const t of TARGETS) {
  const corpus = attacks(t.own, t.victim, t.file);
  corpusSize = corpus.length;
  const accepted = corpus.filter((c) => requestStoragePath(c.path, t.shape, t.pinned) !== null);
  ok(`${t.name}: all ${corpus.length} attack forms are refused`, accepted.length === 0,
    accepted.map((c) => `${c.name}: ${show(c.path)}`).join('\n      '));
  // The same key in someone else's folder is a perfectly shaped key — only the pin refuses it.
  if (t.pinned) {
    ok(`${t.name}: a well-formed key in ANOTHER tenant's folder is refused by the pin`,
      requestStoragePath(`${t.victim}/${t.file}`, t.shape, t.pinned) === null
      && requestStoragePath(`${t.victim}/${t.file}`, t.shape) === `${t.victim}/${t.file}`);
    ok(`${t.name}: a pin that is missing at runtime refuses (never "no pin, so anything")`,
      requestStoragePath(`${t.own}/${t.file}`, t.shape, { 0: undefined as unknown as string }) === null
      && requestStoragePath(`${t.own}/${t.file}`, t.shape, { 0: '' }) === null
      && requestStoragePath(`${t.own}/${t.file}`, t.shape, { 9: UID }) === null);
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
ok('literal layer is exact', rule.storageSegmentMatches('record.pdf', { kind: 'literal', value: 'record.pdf' })
  && !rule.storageSegmentMatches('record.pdf ', { kind: 'literal', value: 'record.pdf' })
  && !rule.storageSegmentMatches('Record.pdf', { kind: 'literal', value: 'record.pdf' }));

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
  ['the length is capped', /if \(raw\.length === 0 \|\| raw\.length > STORAGE_PATH_MAX_LENGTH\) return null;/],
  ['forbidden characters are refused', /if \(storagePathHasForbiddenChar\(raw\)\) return null;/],
  ['the segments come from the same string', /const segments = storagePathSegments\(raw\);/],
  ['the segment count is fixed', /if \(!segments \|\| segments\.length !== shape\.segments\.length\) return null;/],
  ['EVERY segment is matched, not the first', /for \(let i = 0; i < segments\.length; i\+\+\) \{\s*if \(!storageSegmentMatches\(segments\[i\], shape\.segments\[i\]\)\) return null;\s*\}/],
  ['pinned segments must be equal', /if \(segments\[Number\(index\)\] !== pinned\[Number\(index\)\]\) return null;/],
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
  {
    file: `${FN_ROOT}/shared-photos-sign/index.ts`, fn: 'serve', method: 'createSignedUrls', arg: 'ok.map((p) => p.path)',
    why: 'body-carried; signableSharePhotos keeps a photos row only when its key is exactly 3 segments, <the row’s user>/<the requested project>/<file>.',
  },
  {
    file: `${FN_ROOT}/job-facts-view/index.ts`, fn: 'serve', method: 'createSignedUrls', arg: 'ok.map((p) => p.path)',
    why: 'body-carried; signableFactsPhotos applies the same 3-segment <user>/<project>/<file> rule to rows of the link’s own project.',
  },
  {
    file: `${FN_ROOT}/signed-media-urls/index.ts`, fn: 'signKeys', method: 'createSignedUrls', arg: 'unique',
    why: 'body-carried; portal photos are rows of the portal’s project (photoSource), RFI sheets only the keys the RFI itself references (rfiSheetKeysToSign); both refuse dot segments.',
    bucketWhy: 'both callers pass a module constant (PHOTO_BUCKET / PLAN_SHEET_BUCKET).',
  },
  {
    file: `${FN_ROOT}/delete-account/index.ts`, fn: 'listPathsRecursive', method: 'list', arg: 'prefix',
    why: 'body-carried; prefixes are built from the caller’s own user id and ids gated by SAFE_DELETE_KEY (no slash, percent or backslash).',
    bucketWhy: 'the bucket names are a server-side list in the same function.',
  },
  {
    file: `${FN_ROOT}/delete-account/index.ts`, fn: 'removePaths', method: 'remove', arg: 'chunk',
    why: 'body-carried; object names come from list() answers under the caller’s own prefixes, or from rows re-checked against a prefix the caller owns.',
    bucketWhy: 'the bucket names are a server-side list in the same function.',
  },
  {
    file: `${FN_ROOT}/seal-punch/index.ts`, fn: 'removeCopies', method: 'remove', arg: 'copied',
    why: 'body-carried; `copied` only ever receives `dest`, a punchSealPhotoPath() key (asserted below).',
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
/** The nearest lexical binding of an identifier, walking outwards from where it is used. */
function bindingOf(id: ts.Identifier, file: string): Binding {
  const name = id.text;
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) {
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
    const statements = ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n) ? n.statements : undefined;
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

/** '' when the path expression is proven by syntax, else the reason it is not. */
function unproven(e: ts.Expression | undefined, file: string, sf: ts.SourceFile, depth = 0): string {
  if (!e) return 'there is no path argument';
  const x = unwrap(e);
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return '';
  if (isProducerCall(x, file)) return '';
  if (ts.isArrayLiteralExpression(x)) {
    for (const el of x.elements) {
      const why = ts.isSpreadElement(el) ? 'it spreads another value' : unproven(el, file, sf, depth);
      if (why) return `an element is not proven: ${why}`;
    }
    return x.elements.length > 0 ? '' : 'it is an empty array';
  }
  if (ts.isIdentifier(x)) {
    const b = bindingOf(x, file);
    if (b.kind === 'const') return b.init && isProducerCall(b.init, file) ? '' : `const ${x.text} is not assigned from the rule`;
    if (b.kind === 'parameter') {
      // A parameter is proven when the function is local, not exported, and EVERY call of it passes a proven value.
      const fn = b.fn;
      const fnName = ts.isFunctionDeclaration(fn) && fn.name ? fn.name.text : '';
      if (!fnName || depth > 1) return `${x.text} is a parameter`;
      if ((ts.getCombinedModifierFlags(fn as ts.FunctionDeclaration) & ts.ModifierFlags.Export) !== 0) return `${x.text} is a parameter of an exported function`;
      const calls: ts.CallExpression[] = [];
      const find = (n: ts.Node) => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === fnName) calls.push(n); n.forEachChild(find); };
      find(sf);
      let otherUses = 0;
      const refs = (n: ts.Node) => { if (ts.isIdentifier(n) && n.text === fnName && !(ts.isCallExpression(n.parent) && n.parent.expression === n) && n.parent !== fn) otherUses++; n.forEachChild(refs); };
      refs(sf);
      if (calls.length === 0 || otherUses > 0) return `${x.text} is a parameter of ${fnName}, which is not only called directly`;
      for (const c of calls) {
        const why = unproven(c.arguments[b.index], file, sf, depth + 1);
        if (why) return `${x.text} is a parameter of ${fnName}, and a caller passes a value that is not proven (${why})`;
      }
      return '';
    }
    if (b.kind === 'import') return `${x.text} is imported, not produced by the rule here`;
    if (b.kind === 'other') return `${x.text} is ${b.what}`;
    return `${x.text} has no binding in this file`;
  }
  return 'it is an expression, not a constant or a const the rule produced';
}

/** '' when the bucket is a string literal, a module-level const string, or an imported constant. */
function bucketUnproven(e: ts.Expression | undefined, file: string): string {
  if (!e) return 'there is no bucket argument';
  const x = unwrap(e);
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return '';
  if (ts.isIdentifier(x)) {
    const b = bindingOf(x, file);
    if (b.kind === 'import') return '';
    if (b.kind === 'const' && b.init && (ts.isStringLiteral(unwrap(b.init)) || ts.isNoSubstitutionTemplateLiteral(unwrap(b.init)))) return '';
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
const sites: Site[] = [];
const strayStorage: string[] = [];
const rawStorageFetch: string[] = [];
const ruleCalls: { file: string; line: number; text: string; pinned: boolean }[] = [];
const sources = new Map<string, ts.SourceFile>();

for (const file of edgeFiles(FN_ROOT)) {
  const text = read(file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  sources.set(file, sf);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const accounted = new Set<ts.Node>();
  const addSite = (node: ts.Node, method: string, pathArg: ts.Expression | undefined, bucketArg: ts.Expression | undefined, hasBucket: boolean) => {
    const base = method.split(' ')[0];
    sites.push({
      file, line: lineOf(node), fn: enclosingName(node), method, arg: pathArg ? pathArg.getText(sf).replace(/\s+/g, ' ') : '',
      pathWhy: unproven(pathArg, file, sf), bucketWhy: hasBucket ? bucketUnproven(bucketArg, file) : '',
      transport: base in transport ? transport[base] : base === 'getPublicUrl' ? 'none' : 'unknown',
    });
  };
  /** `<x>.storage.from(<bucket>)` → the `.storage` node and the bucket argument. */
  const storageFrom = (e: ts.Expression): { storageNode: ts.Node; bucket: ts.Expression | undefined } | null => {
    if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression) || e.expression.name.text !== 'from') return null;
    const recv = e.expression.expression;
    if (ts.isPropertyAccessExpression(recv) && recv.name.text === 'storage') return { storageNode: recv, bucket: e.arguments[0] };
    return null;
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
        if (name === 'fetch' && node.arguments[0] && /storage\/v1/.test(node.arguments[0].getText(sf))) rawStorageFetch.push(`${file}:${lineOf(node)}`);
        if (name === 'requestStoragePath' && file !== RULE_FILE) {
          ruleCalls.push({ file, line: lineOf(node), text: node.getText(sf).replace(/\s+/g, ' '), pinned: node.arguments.length >= 3 });
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  const stray = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'storage' && !accounted.has(node)) strayStorage.push(`${file}:${lineOf(node)} ${node.parent.getText(sf).slice(0, 80)}`);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'storage') strayStorage.push(`${file}:${lineOf(node)} ${node.getText(sf).slice(0, 80)}`);
    node.forEachChild(stray);
  };
  stray(sf);
}

ok(`the sweep found the storage calls (${sites.length} in ${new Set(sites.map((s) => s.file)).size} files)`, sites.length >= 20, String(sites.length));
ok('every `.storage` in the tree is `.storage.from(bucket).<method>(…)` or handed to a known helper (no alias the sweep cannot follow)',
  strayStorage.length === 0, strayStorage.join('\n      '));
ok('no function builds a storage REST URL for fetch() by hand', rawStorageFetch.length === 0, rawStorageFetch.join(', '));
ok('every storage method in use has a measured transport', sites.every((s) => s.transport !== 'unknown'),
  sites.filter((s) => s.transport === 'unknown').map((s) => `${s.file}:${s.line} ${s.method}`).join(', '));

const keyOf = (s: { file: string; fn: string; method: string; arg: string }) => `${s.file} | ${s.fn} | ${s.method} | ${s.arg}`;
const ledgerByKey = new Map(LEDGER.map((l) => [keyOf(l), l]));
const used = new Set<string>();
const PROOFS_RUN = new Set(['signable']); // section 6 executed it
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

console.log(`\n${fail === 0 ? '✓' : '✗'} storage paths: ${pass} passed, ${fail} failed (${corpusSize} attack forms × ${TARGETS.length} shapes)\n`);
if (fail > 0) process.exit(1);
