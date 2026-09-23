// utils/imageMetadataStrip.ts: drop the metadata from an image's bytes before
// it goes somewhere public (wave 5 integration, portfolio privacy).
//
// Why: a portfolio page copies his private jobsite photos into the PUBLIC,
// permanent `portfolio` bucket. A photo uploaded from the web app keeps the
// camera's own bytes, EXIF included — and EXIF can carry the GPS position of
// the client's house, on a public URL, even with "Show street address" off.
// No native module (expo-image-manipulator would need a native build, so no
// OTA) and no re-encode: this is a byte filter over the container format,
// pure JS, so it runs the same on iOS, Android and web.
//
// What it keeps and drops:
//   JPEG  drops APP1 (Exif + XMP), APP3–APP13 (incl. APP13 IPTC/Photoshop),
//         APP15, COM, MPF (APP2 "MPF") and everything after the main image's
//         EOI (the secondary images MPF points at — iPhone depth / HDR frames
//         carry their own EXIF). Keeps APP0 (JFIF), APP2 ICC_PROFILE (colour)
//         and APP14 (Adobe colour transform). The Exif Orientation is NOT
//         lost: when the original had one other than 1, a minimal Exif block
//         holding only that tag is written back, so a portrait photo doesn't
//         turn sideways on the page.
//   PNG   drops eXIf, tEXt, iTXt, zTXt, tIME (an Orientation other than 1 is
//         written back as an orientation-only eXIf); stops at IEND.
//   WebP  drops the EXIF and XMP chunks and clears their VP8X flag bits.
//   Anything else (HEIC, GIF, an unreadable or truncated file) → null: the
//   caller leaves that photo out rather than publish bytes it couldn't clean.
//   Production today holds JPEG only (63 of 63 project photos, 2026-09-23).

export type StrippedImage = { bytes: Uint8Array; contentType: 'image/jpeg' | 'image/png' | 'image/webp' };

export function stripImageMetadata(input: Uint8Array): StrippedImage | null {
  if (isJpeg(input)) {
    const bytes = stripJpeg(input);
    return bytes ? { bytes, contentType: 'image/jpeg' } : null;
  }
  if (isPng(input)) {
    const bytes = stripPng(input);
    return bytes ? { bytes, contentType: 'image/png' } : null;
  }
  if (isWebp(input)) {
    const bytes = stripWebp(input);
    return bytes ? { bytes, contentType: 'image/webp' } : null;
  }
  return null;
}

// ─── JPEG ───────────────────────────────────────────────────────────────────

function isJpeg(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0xff && b[1] === 0xd8;
}

function startsWithAscii(b: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > b.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

/** The Exif Orientation (1–8) inside an APP1 payload that starts "Exif\0\0", or null. */
export function readExifOrientation(payload: Uint8Array): number | null {
  if (!startsWithAscii(payload, 0, 'Exif\0\0')) return null;
  const t = 6; // TIFF header start
  if (t + 8 > payload.length) return null;
  const le = payload[t] === 0x49 && payload[t + 1] === 0x49;
  const be = payload[t] === 0x4d && payload[t + 1] === 0x4d;
  if (!le && !be) return null;
  const u16 = (o: number) => (o + 2 > payload.length ? -1 : le ? payload[o] | (payload[o + 1] << 8) : (payload[o] << 8) | payload[o + 1]);
  const u32 = (o: number) => (o + 4 > payload.length ? -1
    : le ? (payload[o] | (payload[o + 1] << 8) | (payload[o + 2] << 16)) + payload[o + 3] * 0x1000000
      : payload[o] * 0x1000000 + ((payload[o + 1] << 16) | (payload[o + 2] << 8) | payload[o + 3]));
  if (u16(t + 2) !== 42) return null;
  const ifd = u32(t + 4);
  if (ifd < 8) return null;
  const count = u16(t + ifd);
  if (count < 0) return null;
  for (let i = 0; i < count; i++) {
    const e = t + ifd + 2 + i * 12;
    if (e + 12 > payload.length) return null;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8); // SHORT, count 1: the value sits left-justified in the value field
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** An APP1 segment (marker included) holding an Exif block with ONLY the Orientation tag. */
export function orientationOnlyApp1(orientation: number): Uint8Array {
  const seg = new Uint8Array(4 + 6 + 26);
  seg.set([0xff, 0xe1, 0x00, 0x22]); // APP1, length 34 (payload 32 + the 2 length bytes)
  seg.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4); // "Exif\0\0"
  seg.set([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, orientation >> 8, orientation & 0xff, 0x00, 0x00, // Orientation SHORT ×1
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ], 10);
  return seg;
}

function stripJpeg(b: Uint8Array): Uint8Array | null {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let pos = 2;
  let orientationWritten = false;
  // Segment loop. Returns at EOI; anything after the main image is dropped.
  while (pos < b.length) {
    if (b[pos] !== 0xff) return null; // not a marker where one must be: malformed
    while (pos < b.length && b[pos] === 0xff) pos++; // fill bytes
    if (pos >= b.length) return null;
    const m = b[pos];
    const markerAt = pos - 1;
    pos++;
    if (m === 0xd9) { out.push(new Uint8Array([0xff, 0xd9])); return concat(out); }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { out.push(new Uint8Array([0xff, m])); continue; }
    if (pos + 2 > b.length) return null;
    const len = (b[pos] << 8) | b[pos + 1];
    if (len < 2 || pos + len > b.length) return null;
    const payload = b.subarray(pos + 2, pos + len);
    const segment = b.subarray(markerAt, pos + len);
    pos += len;
    if (m === 0xe1) {
      const o = readExifOrientation(payload);
      if (o && o !== 1 && !orientationWritten) { out.push(orientationOnlyApp1(o)); orientationWritten = true; }
      continue;
    }
    if (m === 0xe2 && startsWithAscii(payload, 0, 'MPF\0')) continue;
    if ((m >= 0xe3 && m <= 0xed) || m === 0xef || m === 0xfe) continue;
    out.push(segment);
    if (m === 0xda) {
      // Entropy-coded data follows the SOS header. It ends at the first
      // marker that is not a stuffed 0xFF00 or a restart (RSTn); the loop
      // then carries on (progressive files have more DHT / SOS after it).
      const start = pos;
      while (pos < b.length) {
        if (b[pos] === 0xff && pos + 1 < b.length) {
          const n = b[pos + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7) || n === 0xff) { pos += n === 0xff ? 1 : 2; continue; }
          break;
        }
        pos++;
      }
      if (pos >= b.length) return null; // no EOI: truncated file
      out.push(b.subarray(start, pos));
    }
  }
  return null;
}

// ─── PNG ────────────────────────────────────────────────────────────────────

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v);
}
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A PNG eXIf chunk holding only the Orientation tag (same TIFF block as the JPEG one). */
export function orientationOnlyExifChunk(orientation: number): Uint8Array {
  const tiff = orientationOnlyApp1(orientation).subarray(10); // drop marker, length and "Exif\0\0"
  const chunk = new Uint8Array(12 + tiff.length);
  chunk.set([0, 0, 0, tiff.length, 0x65, 0x58, 0x49, 0x66]); // length, "eXIf"
  chunk.set(tiff, 8);
  const crc = crc32(chunk.subarray(4, 8 + tiff.length));
  chunk.set([crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff], 8 + tiff.length);
  return chunk;
}

function stripPng(b: Uint8Array): Uint8Array | null {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let pos = 8;
  let orientationWritten = false;
  while (pos + 12 <= b.length) {
    const len = b[pos] * 0x1000000 + ((b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]);
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const end = pos + 12 + len;
    if (end > b.length) return null;
    if (type === 'eXIf' && !orientationWritten) {
      // Same rule as JPEG: the orientation survives, nothing else does. The
      // eXIf payload is a bare TIFF block, so it is read as "Exif\0\0" + it.
      const tiff = b.subarray(pos + 8, pos + 8 + len);
      const withHeader = new Uint8Array(6 + tiff.length);
      withHeader.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
      withHeader.set(tiff, 6);
      const o = readExifOrientation(withHeader);
      if (o && o !== 1) { out.push(orientationOnlyExifChunk(o)); orientationWritten = true; }
    }
    if (!PNG_DROP.has(type)) out.push(b.subarray(pos, end));
    pos = end;
    if (type === 'IEND') return concat(out);
  }
  return null;
}

// ─── WebP ───────────────────────────────────────────────────────────────────

function isWebp(b: Uint8Array): boolean {
  return b.length >= 12 && startsWithAscii(b, 0, 'RIFF') && startsWithAscii(b, 8, 'WEBP');
}

function stripWebp(b: Uint8Array): Uint8Array | null {
  const chunks: Uint8Array[] = [];
  let pos = 12;
  while (pos + 8 <= b.length) {
    const fourcc = String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3]);
    const size = b[pos + 4] | (b[pos + 5] << 8) | (b[pos + 6] << 16) | (b[pos + 7] * 0x1000000);
    const end = pos + 8 + size + (size & 1);
    if (pos + 8 + size > b.length) return null;
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
      const chunk = b.slice(pos, Math.min(end, b.length));
      if (fourcc === 'VP8X' && chunk.length > 8) chunk[8] &= ~(0x08 | 0x04); // EXIF / XMP present flags
      chunks.push(chunk);
    }
    pos = end;
  }
  const body = concat(chunks);
  const total = 12 + body.length;
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  const riff = total - 8;
  head[4] = riff & 0xff; head[5] = (riff >> 8) & 0xff; head[6] = (riff >> 16) & 0xff; head[7] = (riff >>> 24) & 0xff;
  return concat([head, body]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
