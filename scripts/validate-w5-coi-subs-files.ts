// validate-w5-coi-subs-files.ts — the COI file is stored where every device
// can reach it (audit #26 / #66, CONTRACT 7).
//
// COI Vault saved the picker's own URI (file:///…/ImagePicker/x.jpg, or a web
// blob:) as CertificateOfInsurance.fileUri and rendered it raw: blank on the
// web, on a second phone, and on the same iPhone once iOS purged its caches.
// This pins:
//   1. BEHAVIOUR — resolveCoiFileUrl mints a signed URL for each stored format
//      ('sub-documents:<path>' → the private sub-documents bucket; a bare
//      project-documents path or a legacy signed/public URL → re-signed) and
//      returns '' for a device-local URI or a path that won't sign, driven
//      through a stubbed storage client;
//   2. the helpers the vault writes with (storage path, type sniffing, PDF);
//   3. the vault itself: the picked file is uploaded to sub-documents, the row
//      never gets the picker URI, an offline pick waits in the device-only
//      pending map with an honest label, PDFs can be picked and are opened,
//      not drawn with <Image>, and the card renders through resolveCoiFileUrl.
//
// Run: bun run scripts/validate-w5-coi-subs-files.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Comments out, so a pin can't be satisfied by prose. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

// ── stub the network edge ───────────────────────────────────────────────────
const HOST = 'https://nteoqhcswappxxjlpvap.supabase.co';
const signed: { bucket: string; path: string; ttl: number }[] = [];
let signOk = true;
function bucketApi(bucket: string) {
  return {
    createSignedUrl: async (path: string, ttl: number) => {
      signed.push({ bucket, path, ttl });
      if (!signOk) return { data: null, error: { message: 'offline' } };
      return { data: { signedUrl: `${HOST}/storage/v1/object/sign/${bucket}/${path}?token=t` }, error: null };
    },
    createSignedUrls: async (paths: string[], ttl: number) => {
      for (const p of paths) signed.push({ bucket, path: p, ttl });
      if (!signOk) return { data: null, error: { message: 'offline' } };
      return { data: paths.map(p => ({ path: p, signedUrl: `${HOST}/storage/v1/object/sign/${bucket}/${p}?token=t`, error: null })), error: null };
    },
  };
}
const supabaseStub = { storage: { from: (b: string) => bucketApi(b) }, auth: { getSession: async () => ({ data: { session: null } }) } };

interface VirtualModuleBuilder { module(s: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void }
const bun = (globalThis as unknown as { Bun?: { plugin(d: { name: string; setup: (b: VirtualModuleBuilder) => void }): void } }).Bun;
if (!bun) { console.error('must run under bun'); process.exit(1); }
bun.plugin({
  name: 'stub-supabase-coi-files',
  setup(build) {
    build.module('@/lib/supabase', () => ({ exports: { supabase: supabaseStub, isSupabaseConfigured: true }, loader: 'object' }));
  },
});

const m = await import('../utils/coiFiles');

console.log('\nresolveCoiFileUrl — every stored format:');
{
  signed.length = 0;
  const a = await m.resolveCoiFileUrl('sub-documents:sub-1/coi-c1.pdf');
  ok('sub-documents: path → a signed URL on the sub-documents bucket', a.includes('/object/sign/sub-documents/sub-1/coi-c1.pdf'), a);
  ok('…minted for one hour (never stored)', signed[0]?.bucket === 'sub-documents' && signed[0]?.ttl === 3600, JSON.stringify(signed[0]));

  signed.length = 0;
  const b = await m.resolveCoiFileUrl('proj-9/insurance/scan-1.jpg');
  ok('bare project-documents path (Scan Anything) → re-signed on project-documents',
    b.includes('/object/sign/project-documents/proj-9/insurance/scan-1.jpg') && signed[0]?.bucket === 'project-documents', b);

  const c = await m.resolveCoiFileUrl(`${HOST}/storage/v1/object/sign/project-documents/proj-9/insurance/old.jpg?token=expired`);
  ok('legacy (expired) signed project-documents URL → re-signed from its path', c.includes('proj-9/insurance/old.jpg?token=t'), c);

  const d = await m.resolveCoiFileUrl('https://picsum.photos/seed/mage-coi/800/1000');
  ok('an unrelated https URL (seed data) is shown as is', d === 'https://picsum.photos/seed/mage-coi/800/1000', d);

  for (const local of ['file:///var/mobile/Containers/Data/tmp/ImagePicker/x.jpg', 'blob:https://app.mageid.app/abc', 'content://media/1', 'ph://ABC']) {
    ok(`device-local ${local.split(':')[0]}: → '' (the card says re-upload, never a blank image)`, (await m.resolveCoiFileUrl(local)) === '');
  }
  ok("empty → ''", (await m.resolveCoiFileUrl('')) === '' && (await m.resolveCoiFileUrl(null)) === '');

  signOk = false;
  ok("sub-documents path that won't sign (offline) → ''", (await m.resolveCoiFileUrl('sub-documents:sub-1/coi-c1.jpg')) === '');
  ok("bare path that won't sign → '' (a bare path is not an image source)", (await m.resolveCoiFileUrl('proj-9/insurance/scan-1.jpg')) === '');
  signOk = true;

  signed.length = 0;
  const w = await m.signW9Url('sub-1/w9-17.pdf');
  ok('signW9Url mints a 5-minute link on sub-documents', w.includes('/sub-documents/sub-1/w9-17.pdf') && signed[0]?.ttl === 300, JSON.stringify(signed[0]));
}

console.log('\nhelpers:');
ok('coiStoragePath → <subId>/coi-<coiId>.<ext>', m.coiStoragePath('sub-1', 'c1', 'PDF') === 'sub-1/coi-c1.pdf');
ok('subDocumentsFileUri → sub-documents:<path>', m.subDocumentsFileUri('sub-1/coi-c1.pdf') === 'sub-documents:sub-1/coi-c1.pdf');
ok('coiFileType: mime wins (a web blob: has no extension)',
  JSON.stringify(m.coiFileType({ uri: 'blob:https://x/abc', mimeType: 'application/pdf' })) === JSON.stringify({ ext: 'pdf', contentType: 'application/pdf' }));
ok('coiFileType: falls back to the name', m.coiFileType({ name: 'ACORD.PNG' }).contentType === 'image/png');
ok('coiFileType: defaults to jpeg', m.coiFileType({ uri: 'file:///x' }).ext === 'jpg');
ok('isPdfCoiFile reads the stored path', m.isPdfCoiFile('sub-documents:s/coi-c.pdf') && !m.isPdfCoiFile('sub-documents:s/coi-c.jpg'));
ok('coiFileLocation', m.coiFileLocation('file:///x') === 'device' && m.coiFileLocation('sub-documents:a') === 'stored'
  && m.coiFileLocation('p/insurance/a.jpg') === 'stored' && m.coiFileLocation('https://picsum.photos/x') === 'external' && m.coiFileLocation('') === 'none');
ok('the pending-upload key is under the swept mageid_ prefix', m.COI_PENDING_UPLOADS_KEY.startsWith('mageid_'));

console.log('\napp/coi-vault.tsx:');
{
  const vault = code(src('app/coi-vault.tsx'));
  ok('no row is saved with the picker URI (the old `fileUri: uri`)', !/fileUri:\s*uri\b/.test(vault));
  ok('the picked file is uploaded to the sub-documents bucket with readFileBytes + contentType',
    /readFileBytes\(entry\.localUri\)/.test(vault) && /\.from\(SUB_DOCUMENTS_BUCKET\)\s*\.upload\(path, bytes, \{ contentType: entry\.contentType/.test(vault));
  ok('…at coiStoragePath(<subId>, <coiId>, <ext>) and stored as subDocumentsFileUri(path)',
    /coiStoragePath\(entry\.subId, entry\.coiId, entry\.ext\)/.test(vault) && /return subDocumentsFileUri\(path\)/.test(vault));
  const ingest = vault.slice(vault.indexOf('const ingest = useCallback'), vault.indexOf('const pickFrom = useCallback'));
  ok('the new row is added with the uploaded fileUri or \'\' — never the local uri',
    /let fileUri = '';/.test(ingest) && /fileUri = await uploadCoiFile\(entry\)/.test(ingest) && /fileUri,\n/.test(ingest) && !/fileUri:\s*picked\.uri/.test(ingest));
  ok('a failed upload keeps the local file in the device-only pending map', /updatePending\(m => \(\{ \.\.\.m, \[coiId\]: entry \}\)\)/.test(ingest));
  ok('…labelled "Not uploaded yet — only on this phone"', /Not uploaded yet — only on this phone/.test(vault));
  ok('…and retried on the next open, then patched onto the certificate',
    /void uploadCoiFile\(entry\)\.then\(/.test(vault) && /queuePatch\(entry\.coiId, \{ fileUri \}\)/.test(vault));
  // Raw source: the comment stripper reads the '/*' inside 'image/*' as a comment.
  ok('PDFs can be picked (DocumentPicker with application/pdf)', /getDocumentAsync\(\{\s*type: \['application\/pdf', 'image\/\*'\]/.test(src('app/coi-vault.tsx')));
  ok('the card renders through resolveCoiFileUrl, not the raw fileUri', /resolveCoiFileUrl\(coi\.fileUri\)/.test(vault) && !/source=\{\{ uri: coi\.fileUri \}\}/.test(vault));
  ok('a PDF is an "Open certificate" row, not an <Image>', /accessibilityLabel="Open certificate"/.test(vault) && /pdf \? \(/.test(vault));
  ok('an unreachable file says so ("not on this device — re-upload")', /Certificate file not on this device — re-upload it\./.test(vault));
  ok('the AI read still runs on the local file', /validateCOIImage\(picked\.uri, contentType\)/.test(vault));
  ok('writes after an await go through the latest context (ctxRef), not a stale capture',
    /ctxRef\.current\.addCOI\?\.\(newCoi\)/.test(vault) && !/\bctx\.updateCOI\?\.\(newCoi\.id/.test(vault));
}

console.log(`\nvalidate-w5-coi-subs-files: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
