// validate-w5-portfolio-exif.ts — wave 5 integration (web-comms-ai lens).
//
// A portfolio page published byte-identical copies of his private jobsite
// photos into the PUBLIC, permanent `portfolio` bucket, and a photo uploaded
// from the web app keeps the camera's EXIF — GPS of the client's house
// included. utils/imageMetadataStrip.ts now drops the metadata before the
// upload (utils/portfolioPublish.ts; validate-w5-portfolio-screens pins that
// wiring). This runs the REAL filter:
//   1. on a JPEG and a PNG written by Apple ImageIO with GPS, Make, a lens,
//      a user comment and Orientation 6 (embedded below): every tag string is
//      gone, the GPS block is gone, the orientation survives, the image data
//      is byte-identical;
//   2. on a synthetic JPEG carrying XMP, IPTC (APP13), a COM, an MPF APP2 and
//      a secondary image appended after EOI (what iPhone HDR / depth frames
//      look like), in both TIFF byte orders; ICC and JFIF are kept;
//   3. on a WebP with EXIF + XMP chunks (flags cleared, RIFF size right);
//   4. refusals: HEIC, GIF, a truncated JPEG, random bytes → null (the photo
//      is left out, never published as-is); idempotence.
//
// Run: bun run scripts/validate-w5-portfolio-exif.ts

import { stripImageMetadata, readExifOrientation } from '../utils/imageMetadataStrip';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const has = (hay: Uint8Array, needle: string | number[]) => {
  const n = typeof needle === 'string' ? ascii(needle) : needle;
  outer: for (let i = 0; i + n.length <= hay.length; i++) {
    for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
};
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const cat = (...parts: (number[] | Uint8Array)[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...Array.from(p));
  return new Uint8Array(out);
};
const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
/** The SOS header through EOI of a JPEG — the compressed image itself. */
const scanOf = (b: Uint8Array) => {
  for (let i = 2; i + 1 < b.length; i++) if (b[i] === 0xff && b[i + 1] === 0xda) return b.subarray(i);
  return new Uint8Array();
};
/** APP1 payload ("Exif\0\0"…) of the first APP1 segment, or null. */
const app1Of = (b: Uint8Array) => {
  let pos = 2;
  while (pos + 4 <= b.length && b[pos] === 0xff) {
    const m = b[pos + 1];
    if (m === 0xda || m === 0xd9) return null;
    const len = (b[pos + 2] << 8) | b[pos + 3];
    if (m === 0xe1) return b.subarray(pos + 4, pos + 2 + len);
    pos += 2 + len;
  }
  return null;
};

// Written by Apple ImageIO (CGImageDestination) with a GPS dictionary
// (40.712812 N, 74.006015 W), TIFF Make "SECRETMAKE", Exif LensModel
// "SECRETLENS", UserComment "SECRETCOMMENT" and Orientation 6.
const IMAGEIO_JPEG =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QEQRXhpZgAATU0AKgAAAAgABAEPAAIAAAALAAAAPgESAAMAAAABAAYAAIdpAAQAAAABAAAASoglAAQAAAABAAAAogAAAABTRUNSRVRNQUtFAAAABJKGAAcAAAAVAAAAgKACAAQAAAABAAAAQKADAAQAAAABAAAAIKQ0AAIAAAALAAAAlgAAAABBU0NJSQAAAFNFQ1JFVENPTU1FTlQAU0VDUkVUTEVOUwAAAAQAAQACAAAAAk4AAAAAAgAFAAAAAwAAANgAAwACAAAAAlcAAAAABAAFAAAAAwAAAPAAAAAAAAAAKAAAAAEAAAAqAAAAAQAAEgQAAABkAAAASgAAAAEAAAAAAAAAAQAACHUAAABk/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/AABEIACAAQAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAICAgICAgMCAgMFAwMDBQYFBQUFBggGBgYGBggKCAgICAgICgoKCgoKCgoMDAwMDAwODg4ODg8PDw8PDw8PDw//2wBDAQICAgQEBAcEBAcQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/3QAEAAT/2gAMAwEAAhEDEQA/AOHooor8rP5LCiiigAooooAKKKKAP//Q8s/4SPRv+fj/AMcf/CtS2uYbuFbi3bfG+cHBHQ47141XqPhz/kDW/wDwP/0M1+L4HHTqzcZJbH2X0mvoy5DwXkNHNMrrVpznWjTaqSg1ZwqSuuWnB3vBdbWvobdFFFeofwyFFFFABRRRQB//2Q==';;
const IMAGEIO_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAAXNSR0IArs4c6QAAAQhlWElmTU0AKgAAAAgABAEPAAIAAAALAAAAPgESAAMAAAABAAYAAIdpAAQAAAABAAAASoglAAQAAAABAAAAogAAAABTRUNSRVRNQUtFAAAABJKGAAcAAAAVAAAAgKACAAQAAAABAAAAQKADAAQAAAABAAAAIKQ0AAIAAAALAAAAlgAAAABBU0NJSQAAAFNFQ1JFVENPTU1FTlQAU0VDUkVUTEVOUwAAAAQAAQACAAAAAk4AAAAAAgAFAAAAAwAAANgAAwACAAAAAlcAAAAABAAFAAAAAwAAAPAAAAAAAAAAKAAAAAEAAAAqAAAAAQAAEgQAAABkAAAASgAAAAEAAAAAAAAAAQAACHUAAABkM2yZawAAA0dpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDYuMC4wIj4KICAgPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4KICAgICAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgICAgICAgICAgeG1sbnM6ZXhpZj0iaHR0cDovL25zLmFkb2JlLmNvbS9leGlmLzEuMC8iCiAgICAgICAgICAgIHhtbG5zOnRpZmY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vdGlmZi8xLjAvIgogICAgICAgICAgICB4bWxuczpleGlmRVg9Imh0dHA6Ly9jaXBhLmpwL2V4aWYvMS4wLyI+CiAgICAgICAgIDxleGlmOkdQU0xvbmdpdHVkZT43NCwwLjM2MDlXPC9leGlmOkdQU0xvbmdpdHVkZT4KICAgICAgICAgPGV4aWY6R1BTTG9uZ2l0dWRlUmVmPlc8L2V4aWY6R1BTTG9uZ2l0dWRlUmVmPgogICAgICAgICA8ZXhpZjpHUFNMYXRpdHVkZVJlZj5OPC9leGlmOkdQU0xhdGl0dWRlUmVmPgogICAgICAgICA8ZXhpZjpHUFNMYXRpdHVkZT40MCw0Mi43Njg3TjwvZXhpZjpHUFNMYXRpdHVkZT4KICAgICAgICAgPGV4aWY6VXNlckNvbW1lbnQ+U0VDUkVUQ09NTUVOVDwvZXhpZjpVc2VyQ29tbWVudD4KICAgICAgICAgPHRpZmY6TWFrZT5TRUNSRVRNQUtFPC90aWZmOk1ha2U+CiAgICAgICAgIDx0aWZmOk9yaWVudGF0aW9uPjY8L3RpZmY6T3JpZW50YXRpb24+CiAgICAgICAgIDxleGlmRVg6TGVuc01vZGVsPlNFQ1JFVExFTlM8L2V4aWZFWDpMZW5zTW9kZWw+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgoMrDGUAAAAeElEQVRoBe2YQRHAIBDEoDKwgQ40VUcN1gbMVEHvuwlvPpvLHjP0+azdwOcCZ/+iC0AD4ASsAFyApgEaACdgBeACuAStgBWAE7ACcAF8BayAFYAT6O8Yv36F1z0jUbkDIsdaCKUBBViRVzUgcqyFUBpQgBV5FW/AATyYBW/CW5qjAAAAAElFTkSuQmCC';;

console.log('\n1 · real encoder output (Apple ImageIO)');
{
  const src = b64(IMAGEIO_JPEG);
  ok('the fixture really carries the metadata', has(src, 'SECRETMAKE') && has(src, 'SECRETLENS') && has(src, 'SECRETCOMMENT') && readExifOrientation(app1Of(src) ?? new Uint8Array()) === 6);
  const r = stripImageMetadata(src);
  ok('JPEG: cleaned', !!r && r.contentType === 'image/jpeg');
  if (r) {
    ok('JPEG: no Make / lens / comment string survives', !has(r.bytes, 'SECRET'));
    // The GPS IFD pointer tag 0x8825 (either byte order) lives only in the Exif block.
    ok('JPEG: no GPS IFD pointer', !has(r.bytes, [0x88, 0x25]) && !has(r.bytes, [0x25, 0x88]));
    ok('JPEG: Orientation 6 is kept (an orientation-only Exif block)', readExifOrientation(app1Of(r.bytes) ?? new Uint8Array()) === 6 && (app1Of(r.bytes)?.length ?? 0) === 32);
    ok('JPEG: the compressed image (SOS → EOI) is byte-identical', eq(scanOf(r.bytes), scanOf(src)) && scanOf(src).length > 0);
    ok('JPEG: the ICC profile is kept', has(src, 'ICC_PROFILE') === has(r.bytes, 'ICC_PROFILE'));
    ok('JPEG: idempotent', eq(stripImageMetadata(r.bytes)?.bytes ?? new Uint8Array(), r.bytes));
  }
  const png = b64(IMAGEIO_PNG);
  ok('the PNG fixture carries the metadata', has(png, 'SECRETMAKE') && has(png, 'eXIf'));
  const p = stripImageMetadata(png);
  ok('PNG: cleaned', !!p && p.contentType === 'image/png');
  if (p) {
    ok('PNG: no Make / lens / comment string survives', !has(p.bytes, 'SECRET'));
    ok('PNG: IHDR, IDAT and IEND kept; ends at IEND', has(p.bytes, 'IHDR') && has(p.bytes, 'IDAT') && eq(p.bytes.subarray(p.bytes.length - 8, p.bytes.length - 4), new Uint8Array(ascii('IEND'))));
    ok('PNG: Orientation 6 is kept in an orientation-only eXIf', (() => {
      const at = Buffer.from(p.bytes).indexOf('eXIf');
      if (at < 4) return false;
      const len = p.bytes[at - 1];
      return len === 26 && readExifOrientation(cat(ascii('Exif\0\0'), p.bytes.subarray(at + 4, at + 4 + len))) === 6;
    })());
    ok('PNG: idempotent', eq(stripImageMetadata(p.bytes)?.bytes ?? new Uint8Array(), p.bytes));
  }
}

console.log('\n2 · synthetic JPEG: XMP, IPTC, COM, MPF, a trailing image, both byte orders');
function tiffOrientation(le: boolean, o: number, extraTag = true): number[] {
  const u16 = (v: number) => (le ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (le ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  const entries = extraTag ? 2 : 1;
  return [
    ...(le ? ascii('II') : ascii('MM')), ...u16(42), ...u32(8), ...u16(entries),
    ...(extraTag ? [...u16(0x8825), ...u16(4), ...u32(1), ...u32(0)] : []), // GPS IFD pointer
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(o), 0, 0,
    ...u32(0), ...ascii('GPSSECRET'),
  ];
}
const DQT = seg(0xdb, [0x00, ...new Array(64).fill(1)]);
const SOF = seg(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
const DHT = seg(0xc4, [0x00, 1, ...new Array(15).fill(0), 0]);
const SOS = seg(0xda, [1, 1, 0, 0, 63, 0]);
const ENTROPY = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xff, 0x00, 0x78];
function synthJpeg(le: boolean, o: number): Uint8Array {
  return cat(
    [0xff, 0xd8],
    seg(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    seg(0xe1, [...ascii('Exif\0\0'), ...tiffOrientation(le, o)]),
    seg(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>XMPSECRET</x:xmpmeta>')),
    seg(0xe2, [...ascii('ICC_PROFILE\0'), 1, 1, 0xaa, 0xbb]),
    seg(0xe2, [...ascii('MPF\0'), ...ascii('MPFSECRET')]),
    seg(0xed, [...ascii('Photoshop 3.0\0'), ...ascii('IPTCSECRET')]),
    seg(0xfe, ascii('COMSECRET')),
    DQT, SOF, DHT, SOS, ENTROPY,
    [0xff, 0xd9],
    // A secondary image after EOI, with its own Exif (iPhone MPF frames).
    [0xff, 0xd8], seg(0xe1, [...ascii('Exif\0\0'), ...tiffOrientation(le, 1)]), ascii('TRAILSECRET'), [0xff, 0xd9],
  );
}
for (const le of [false, true]) {
  const label = le ? 'little-endian (II)' : 'big-endian (MM)';
  const src = synthJpeg(le, 8);
  const r = stripImageMetadata(src);
  ok(`${label}: cleaned`, !!r);
  if (!r) continue;
  ok(`${label}: no XMP / IPTC / COM / MPF / GPS / trailing-image bytes`, !has(r.bytes, 'SECRET'));
  ok(`${label}: output ends at the main image's EOI`, r.bytes[r.bytes.length - 2] === 0xff && r.bytes[r.bytes.length - 1] === 0xd9 && !has(r.bytes, [0xff, 0xd9, 0xff, 0xd8]));
  ok(`${label}: JFIF + ICC kept, MPF dropped`, has(r.bytes, 'JFIF') && has(r.bytes, 'ICC_PROFILE') && !has(r.bytes, 'MPF\0'));
  ok(`${label}: Orientation 8 carried over`, readExifOrientation(app1Of(r.bytes) ?? new Uint8Array()) === 8);
  ok(`${label}: DQT / SOF / DHT / SOS + stuffed / RST entropy data unchanged`, has(r.bytes, [...DQT, ...SOF, ...DHT, ...SOS, ...ENTROPY, 0xff, 0xd9]));
}
{
  const r = stripImageMetadata(synthJpeg(false, 1));
  ok('Orientation 1 (the default): no Exif block written at all', !!r && app1Of(r.bytes) === null);
}

console.log('\n3 · WebP');
{
  const chunk = (cc: string, data: number[]) => {
    const pad = data.length & 1 ? [0] : [];
    return [...ascii(cc), data.length & 0xff, (data.length >> 8) & 0xff, 0, 0, ...data, ...pad];
  };
  const vp8x = chunk('VP8X', [0x0c, 0, 0, 0, 7, 0, 0, 7, 0, 0]);
  const vp8 = chunk('VP8 ', [1, 2, 3, 4, 5]);
  const body = [...ascii('WEBP'), ...vp8x, ...vp8, ...chunk('EXIF', ascii('EXIFSECRET')), ...chunk('XMP ', ascii('XMPSECRET'))];
  const src = cat(ascii('RIFF'), [body.length & 0xff, (body.length >> 8) & 0xff, 0, 0], body);
  const r = stripImageMetadata(src);
  ok('WebP: cleaned', !!r && r.contentType === 'image/webp');
  if (r) {
    ok('WebP: EXIF and XMP chunks gone', !has(r.bytes, 'SECRET') && !has(r.bytes, 'EXIF') && !has(r.bytes, 'XMP '));
    ok('WebP: the VP8X EXIF / XMP flags are cleared', r.bytes[20] === 0x00);
    ok('WebP: the image chunk is kept', has(r.bytes, vp8));
    const riff = r.bytes[4] | (r.bytes[5] << 8) | (r.bytes[6] << 16) | (r.bytes[7] << 24);
    ok('WebP: the RIFF size matches the new length', riff === r.bytes.length - 8, `${riff} vs ${r.bytes.length - 8}`);
  }
}

console.log('\n4 · refusals: never published as-is');
{
  const heic = cat([0, 0, 0, 0x18], ascii('ftypheic'), new Array(40).fill(0), ascii('Exif\0\0GPSSECRET'));
  ok('HEIC → null', stripImageMetadata(heic) === null);
  ok('GIF → null', stripImageMetadata(cat(ascii('GIF89a'), new Array(20).fill(0))) === null);
  const full = synthJpeg(false, 6);
  const cut = full.subarray(0, Buffer.from(full).indexOf(Buffer.from(ENTROPY)) + 4);
  ok('a JPEG truncated inside its image data → null', stripImageMetadata(cut) === null);
  ok('a JPEG whose segment length runs past the end → null', stripImageMetadata(cat([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2])) === null);
  ok('random bytes → null', stripImageMetadata(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])) === null);
  ok('empty → null', stripImageMetadata(new Uint8Array()) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
