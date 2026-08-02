// validate-pdf-bytes.ts — pins the PDF byte decoder in utils/pdfRenderClient.
//
// WHY: PDF upload was broken on native because readFileAsBlob did
// `fetch(file://…).blob()`, which on React Native yields a Blob supabase-js
// uploads as ZERO BYTES (surfacing to the user as "That file is empty"). The
// fix reads base64 and decodes to a Uint8Array; this pins that decode, because
// a silently-wrong decoder would corrupt every uploaded PDF instead of
// visibly failing.
// Run: bun run scripts/validate-pdf-bytes.ts
import { base64ToBytes } from '../utils/base64Bytes';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

console.log('\npdf byte decoding:');

const enc = (s: string) => Buffer.from(s, 'binary').toString('base64');

expect('empty string → empty bytes', Array.from(base64ToBytes('')), []);
expect('ascii round-trips', Array.from(base64ToBytes(enc('PDF'))), [80, 68, 70]);

// A real PDF starts with the magic bytes %PDF-. If the decoder mangles them the
// file is corrupt on arrival and the renderer fails with a confusing error.
const magic = base64ToBytes(enc('%PDF-1.7'));
expect('PDF magic bytes survive', Array.from(magic.slice(0, 5)), [0x25, 0x50, 0x44, 0x46, 0x2d]);

// Binary-safe: PDFs are full of high bytes and NULs. A naive decoder that goes
// through a UTF-8 path mangles exactly these.
const binary = Uint8Array.from([0x00, 0x7f, 0x80, 0xff, 0x0a, 0x1a]);
const roundTripped = base64ToBytes(Buffer.from(binary).toString('base64'));
expect('high bytes and NULs survive', Array.from(roundTripped), Array.from(binary));

// Native base64 from expo-file-system can arrive with a data: prefix or
// wrapped in newlines depending on platform; neither may corrupt the output.
expect('data: prefix stripped',
  Array.from(base64ToBytes(`data:application/pdf;base64,${enc('PDF')}`)), [80, 68, 70]);
expect('whitespace/newlines ignored',
  Array.from(base64ToBytes(`${enc('PDF').slice(0, 2)}\n ${enc('PDF').slice(2)}`)), [80, 68, 70]);

// Length fidelity on a larger blob — an off-by-one here silently truncates.
const big = Uint8Array.from({ length: 5000 }, (_, i) => i % 256);
ok('5000-byte payload keeps its exact length',
  base64ToBytes(Buffer.from(big).toString('base64')).byteLength === 5000);

// Guard the regression itself: the native path must NOT go back to fetch().blob().
import { readFileSync } from 'node:fs';
const src = readFileSync('utils/pdfRenderClient.ts', 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('native read uses expo-file-system, not fetch().blob()',
  code.includes('readAsStringAsync'),
  'native PDF reads must not go back through fetch().blob() — it uploads 0 bytes on RN');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
