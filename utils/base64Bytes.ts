// utils/base64Bytes.ts — RN-free base64 → bytes.
//
// Split out of utils/pdfRenderClient (which imports react-native and so can't
// be parsed by bun) so the decode can be unit-tested. Same pattern as
// utils/alertCore.ts and utils/brain/predictionLedgerCore.ts.
//
// This is binary-critical: PDFs are full of NULs and high bytes, and a decoder
// that round-trips through a UTF-8 path corrupts them silently — the upload
// succeeds and the render fails with something unrelated.

/** Decode base64 (with or without a data: prefix / embedded whitespace) to bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^;]*;base64,/, '').replace(/\s/g, '');
  if (clean.length === 0) return new Uint8Array(0);
  const bin = typeof atob === 'function'
    ? atob(clean)
    : globalThis.Buffer.from(clean, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
