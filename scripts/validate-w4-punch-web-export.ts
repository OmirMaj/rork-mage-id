// scripts/validate-w4-punch-web-export.ts — how the plan sheets print in the
// punch list export.
//
// WHY THIS EXISTS. Founder, 2026-09-22: "Fix punchlist when exporting. Plans
// look terrible." The export was printed (Chrome for the web tab, WebKit for
// the phone's pipeline) over a 24-item job with a 2200×1700 line drawing and a
// 3024×4032 phone photo of a plan saved sideways with EXIF orientation 6
// (scratchpad punch-export-before.pdf / -after.pdf). What was wrong:
//
//   1. On the phone (portrait pages only) a landscape sheet was a strip across
//      the top 40 % of the page — room names unreadable.
//   2. On web a portrait sheet was capped at 700 px of a 960 px page.
//   3. The legend was torn off onto the next page with no heading, and the
//      caption carried no revision.
//   4. Nothing on an item showed WHERE its pin is — the plans sit at the back.
//   5. Every item with no photo spent a third of its card on a grey square
//      reading "No photo".
//
// The fixes, and what each guard below pins:
//   • iOS: a landscape sheet is turned 90° onto the portrait page — but ONLY on
//     a verified aspect (the OS-reported size agreeing with the stored size),
//     because a turned box on a wrong aspect letterboxes the image and puts
//     every pin off its spot. Anything unsure falls back to the natural fit,
//     where the marker box IS the image box and a pin cannot drift.
//   • Web: portrait sheets up to 840 px; landscape keeps its landscape page.
//   • The figure (caption + sheet) never splits; the legend gets "Pins on …".
//   • Each pinned item carries a square close-up around its pin (web: cut on
//     a canvas; iOS: the sheet's own URL, scaled — never a data: sheet, which
//     would be repeated per item) with its number on it.
//
// Run via: bun run scripts/validate-w4-punch-web-export.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlanSheet, PunchItem } from '../types';
import {
  buildPunchExportModel,
  planLayoutFor,
  sheetCaption,
  verifiedSheetAspect,
  PUNCH_EXPORT_PLAN_MAX_H_PX,
  PUNCH_EXPORT_WEB_PLAN_MAX_H_PX,
  PUNCH_EXPORT_PIN_CROP_CAP,
  type PunchExportAssets,
  type PunchExportImageAsset,
  type PunchExportModel,
  type PunchExportTarget,
} from '../utils/punchExportCore';
import { buildPunchExportHtml, cropPinClass, LEGEND_CHUNK_ROWS, planCropSource, PUNCH_EXPORT_CSS } from '../utils/punchExportHtml';
import { pinCropWindow } from '../utils/punchPlanPin';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(label: string, got: T, want: T) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(label, g === w, g === w ? undefined : `got  ${g}\n      want ${w}`);
}
const read = (rel: string): string => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function between(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j);
}
const count = (s: string, sub: string) => s.split(sub).length - 1;
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
/** The whole card for item #n (its photo cell comes BEFORE the number). */
function cardOf(h: string, n: number): string {
  const at = h.indexOf(`<span class="pe-num">#${n}</span>`);
  if (at < 0) return '';
  const start = h.lastIndexOf('<div class="pe-card', at);
  const end = h.indexOf('</table></div>', at);
  return start < 0 || end < 0 ? '' : h.slice(start, end);
}

const ORIGIN = 'https://x.supabase.co';
const JPEG = 'data:image/jpeg;base64,/9j/AAAA';
const SHEETS: PlanSheet[] = [
  { id: 'SA', projectId: 'p1', name: 'Floor Plan', sheetNumber: 'A-101', revision: 2, imageUri: '', storagePath: 'p1/a.png', width: 2200, height: 1700, createdAt: '', updatedAt: '' },
  { id: 'SB', projectId: 'p1', name: 'Level 2', sheetNumber: 'A-201', imageUri: '', storagePath: 'p1/b.jpg', width: 3024, height: 4032, createdAt: '', updatedAt: '' },
];
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ITEMS: PunchItem[] = Array.from({ length: 6 }, (_, i) => ({
  id: uid(i + 1), projectId: 'p1', description: `Item ${i + 1}`, location: 'Kitchen', assignedSub: '', dueDate: '',
  priority: 'medium', status: 'open', listType: 'punch', createdAt: `2026-09-1${i}T08:00:00.000Z`, updatedAt: '',
  ...(i < 3 ? { planSheetId: 'SA', pinX: 0.2 + i * 0.2, pinY: 0.3 } : i < 5 ? { planSheetId: 'SB', pinX: 0.4, pinY: 0.1 + i * 0.1 } : {}),
  ...(i === 0 ? { photoStoragePath: 'u/p1/punch-1.jpg' } : {}),
}) as PunchItem);
const FILTERS = { status: 'all' as const, sub: '', priority: 'all' as const, locationKey: '', locationLabel: '' };
function model(target: PunchExportTarget): PunchExportModel {
  return buildPunchExportModel({
    scopeInput: { allItems: ITEMS, filteredItems: ITEMS, selectedIds: [], activeList: 'punch', filters: FILTERS },
    scope: 'all', includeCrew: false, target, project: { id: 'p1', name: 'Job' }, sheets: SHEETS,
    markupByItemId: new Map(), now: new Date(2026, 8, 22, 10, 0),
  });
}
function assets(sheets: Record<string, PunchExportImageAsset>, extra: Partial<PunchExportAssets> = {}): PunchExportAssets {
  return {
    photos: new Map([[uid(1), { kind: 'image', src: JPEG, mime: 'image/jpeg' } as PunchExportImageAsset]]),
    sheets: new Map(Object.entries(sheets)), approxBytes: null, remoteCount: 0, includedPhotoCount: 1, ...extra,
  };
}
const html = (m: PunchExportModel, a: PunchExportAssets, target: PunchExportTarget, includePhotos = true) =>
  buildPunchExportHtml(m, a, { includePhotos, branding: { companyName: 'Co', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' }, target, allowedOrigins: [ORIGIN] });

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nA. captions and trusted sizes');
// ─────────────────────────────────────────────────────────────────────────────
{
  const m = model('web');
  const pa = m.sheetPages.find(p => p.sheetId === 'SA');
  const pb = m.sheetPages.find(p => p.sheetId === 'SB');
  eq('revision carried onto the page (legacy sheet: null)', [pa?.revision, pb?.revision], [2, null]);
  eq('caption: number · name · Rev', pa ? sheetCaption(pa) : '', 'A-101 · Floor Plan · Rev 2');
  eq('caption without a revision, superseded', sheetCaption({ label: 'A-201 · Level 2', revision: null, superseded: true }), 'A-201 · Level 2 · older revision');
  const page = { aspect: 3024 / 4032 };
  const upright: PunchExportImageAsset = { kind: 'image', src: `${ORIGIN}/b.jpg`, mime: 'image/jpeg', width: 3024, height: 4032 };
  const sideways: PunchExportImageAsset = { ...upright, width: 4032, height: 3024 };
  ok('iOS: OS size agreeing with the stored size is trusted', near(verifiedSheetAspect(upright, page, 'ios') ?? 0, 0.75));
  eq('iOS: raw sideways pixels (EXIF not applied) are NOT trusted', verifiedSheetAspect(sideways, page, 'ios'), null);
  eq('iOS: no stored size → not trusted', verifiedSheetAspect(upright, { aspect: null }, 'ios'), null);
  eq('iOS: no OS size → not trusted', verifiedSheetAspect({ kind: 'image', src: JPEG, mime: 'image/jpeg' }, page, 'ios'), null);
  ok('web: the canvas re-encode\'s own size is trusted', near(verifiedSheetAspect({ kind: 'image', src: JPEG, mime: 'image/jpeg', width: 2200, height: 1700 }, { aspect: null }, 'web') ?? 0, 2200 / 1700));
  eq('web: a remote (CORS-fallback) sheet has no trusted size', verifiedSheetAspect({ ...upright, remote: true }, page, 'web'), null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nB. how each sheet fits the page');
// ─────────────────────────────────────────────────────────────────────────────
{
  const landAsset: PunchExportImageAsset = { kind: 'image', src: `${ORIGIN}/a.png`, mime: 'image/png', width: 2200, height: 1700 };
  const landPage = { aspect: 2200 / 1700 };
  eq('web landscape → its own landscape page', planLayoutFor({ ...landAsset, src: JPEG }, landPage, 'web'), { mode: 'natural', landscapePage: true });
  const rot = planLayoutFor(landAsset, landPage, 'ios');
  ok('iOS landscape on a verified size → turned', rot.mode === 'rotated' && near(rot.aspect, 2200 / 1700));
  eq('iOS landscape on an unverified size → natural fit', planLayoutFor({ ...landAsset, width: undefined, height: undefined }, landPage, 'ios'), { mode: 'natural', landscapePage: false });
  eq('iOS landscape whose stored size disagrees → natural fit', planLayoutFor(landAsset, { aspect: 1700 / 2200 }, 'ios'), { mode: 'natural', landscapePage: false });
  eq('Android landscape → natural fit (no reliable oriented size)', planLayoutFor(landAsset, landPage, 'android'), { mode: 'natural', landscapePage: false });
  eq('iOS portrait → natural fit', planLayoutFor({ ...landAsset, width: 3024, height: 4032 }, { aspect: 0.75 }, 'ios'), { mode: 'natural', landscapePage: false });
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nC. the turned sheet');
// ─────────────────────────────────────────────────────────────────────────────
{
  const m = model('ios');
  const a = 2200 / 1700;
  const h = html(m, assets({
    SA: { kind: 'image', src: `${ORIGIN}/a.png`, mime: 'image/png', width: 2200, height: 1700 },
    SB: { kind: 'image', src: `${ORIGIN}/b.jpg`, mime: 'image/jpeg', width: 3024, height: 4032 },
  }), 'ios');
  ok('the landscape sheet gets a turned page, the portrait one does not', count(h, '<section class="pe-plan pe-plan-rot-page">') === 1 && count(h, '<section class="pe-plan">') === 1);
  const sec = between(h, '<section class="pe-plan pe-plan-rot-page">', '</section>');
  const wrap = /<div class="pe-plan-rot-wrap" style="width:100%;max-width:(\d+)px">/.exec(sec);
  eq('wrapper no taller than the native page cap: max-width = floor(cap / aspect)', wrap ? Number(wrap[1]) : null, Math.floor(PUNCH_EXPORT_PLAN_MAX_H_PX / a));
  const spacer = /pe-plan-rot-spacer" style="padding-top:([\d.]+)%"/.exec(sec);
  const box = /<div class="pe-plan-rot" style="width:([\d.]+)%;height:([\d.]+)%">/.exec(sec);
  ok('spacer = aspect × width; turned box = aspect × W wide, W tall', !!spacer && !!box && near(Number(spacer[1]), a * 100, 1e-3) && near(Number(box[1]), a * 100, 1e-3) && near(Number(box[2]), 100 / a, 1e-3));
  // The turned box closes right after its three markers: object, markers,
  // </turned box></wrapper></figure>, then the legend. A marker drawn after
  // the turned box closes would sit on the unturned wrapper — on the wrong spot.
  ok('the markers are INSIDE the turned box (they turn with the sheet)',
    /<div class="pe-plan-rot" style="[^"]*"><object class="pe-plan-obj"[^>]*>[\s\S]*?<\/object>(<div class="pe-pin[^"]*" style="[^"]*"><div class="pe-pin-head">[^<]*<\/div><div class="pe-pin-tail"><\/div><\/div>){3}<\/div><\/div><\/div><div class="pe-legend">/.test(sec));
  ok('the page says the sheet is turned and which way', sec.includes('sheet turned to fit the page — top of the sheet is on the right'));
  const rule = /\.pe-plan-rot \{([^}]*)\}/.exec(PUNCH_EXPORT_CSS)?.[1] ?? '';
  ok('turn = rotate(90deg) translateY(-100%) about the top-left corner (with the -webkit- twin)',
    /transform-origin:\s*0 0/.test(rule) && /(^|[^-])transform:\s*rotate\(90deg\) translateY\(-100%\)/.test(rule) && /-webkit-transform:\s*rotate\(90deg\) translateY\(-100%\)/.test(rule));
  // Execute that transform: a point (x·w', y·h') of the turned box must land
  // inside the wrapper [0,h'] × [0,w'], and the corners where a plan set puts
  // them (sheet top → page right).
  const wp = a * 100, hp = 100; // turned box in wrapper units (W = 100)
  const map = (x: number, y: number) => { const ty = y * hp - hp; return { X: -ty, Y: x * wp }; }; // rotate(90): (x,y)→(−y,x)
  const tl = map(0, 0), br = map(1, 1), tr = map(1, 0);
  ok('sheet top-left → wrapper top-right; bottom-right → bottom-left; top-right → bottom-right',
    near(tl.X, 100) && near(tl.Y, 0) && near(br.X, 0) && near(br.Y, wp) && near(tr.X, 100) && near(tr.Y, wp), JSON.stringify({ tl, br, tr }));
  ok('every point stays inside the wrapper', [0, 0.3, 1].every(x => [0, 0.6, 1].every(y => { const p = map(x, y); return p.X >= -1e-9 && p.X <= 100 + 1e-9 && p.Y >= -1e-9 && p.Y <= wp + 1e-9; })));
  const sideways = html(m, assets({ SA: { kind: 'image', src: `${ORIGIN}/a.png`, mime: 'image/png', width: 1700, height: 2200 } }), 'ios');
  ok('an unverified size keeps the natural fit (no turned page)', !sideways.includes('pe-plan-rot-page') && sideways.includes('<div class="pe-plan-natural">'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nD. the plan page on web');
// ─────────────────────────────────────────────────────────────────────────────
{
  const m = model('web');
  const h = html(m, assets({
    SA: { kind: 'image', src: JPEG, mime: 'image/jpeg', width: 2200, height: 1700 },
    SB: { kind: 'image', src: JPEG, mime: 'image/jpeg', width: 1800, height: 2400 },
  }), 'web');
  ok('landscape: landscape page; portrait: the taller web cap', h.includes('<section class="pe-plan pe-plan-land">') && h.includes('<section class="pe-plan pe-plan-web">'));
  ok(`web portrait cap ${PUNCH_EXPORT_WEB_PLAN_MAX_H_PX}px in CSS, the native 700px kept`,
    new RegExp(`\\.pe-plan-web \\.pe-plan-obj \\{ max-height: ${PUNCH_EXPORT_WEB_PLAN_MAX_H_PX}px; \\}`).test(PUNCH_EXPORT_CSS) && PUNCH_EXPORT_WEB_PLAN_MAX_H_PX > PUNCH_EXPORT_PLAN_MAX_H_PX);
  ok('the figure (caption + sheet) never splits across pages', /\.pe-plan-fig \{[^}]*break-inside:\s*avoid/.test(PUNCH_EXPORT_CSS) && h.includes('<div class="pe-plan-fig">'));
  ok('the caption carries the revision', h.includes('Plan — A-101 · Floor Plan · Rev 2'));
  // Integration round 1: the caption is IN the legend table's thead (so it
  // travels with the rows), not a lone heading that printed by itself at the
  // bottom of a full landscape plan page.
  ok('the legend names its sheet in its own thead, after the figure',
    /<\/div><div class="pe-legend"><div class="pe-legend-chunk"><table[^>]*><thead><tr class="pe-legend-cap"><th colspan="6">Pins on A-101 · Floor Plan · Rev 2<\/th><\/tr><tr>/.test(h));
  ok('no lone "Pins on" heading outside the table', !/<div class="pe-sec-label">Pins on/.test(h));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nE. the per-item close-up');
// ─────────────────────────────────────────────────────────────────────────────
{
  const mw = model('web');
  const r1 = mw.rows.find(r => r.id === uid(2))!;
  const crop = { src: 'data:image/jpeg;base64,/9j/CROP', mime: 'image/jpeg' as const, pinX: 0.5, pinY: 0.4 };
  const webA = assets({ SA: { kind: 'image', src: JPEG, mime: 'image/jpeg', width: 2200, height: 1700 } }, { pinCrops: new Map([[uid(2), crop]]) });
  eq('web: a canvas crop is used', planCropSource(r1, webA, mw, 'web', [ORIGIN])?.kind, 'bitmap');
  eq('web: no crop cut → no close-up (never the multi-MB sheet per item)', planCropSource(mw.rows.find(r => r.id === uid(3))!, webA, mw, 'web', [ORIGIN]), null);
  eq('a crop whose source fails the allow-list is dropped', planCropSource(r1, assets({}, { pinCrops: new Map([[uid(2), { ...crop, src: 'javascript:alert(1)' }]]) }), mw, 'web', [ORIGIN]), null);
  const hw = html(mw, webA, 'web');
  const card = cardOf(hw, 2);
  ok('web card: the close-up with the item number on it and its sheet — pin caption',
    card.includes('<object class="pe-crop-obj" data="data:image/jpeg;base64,/9j/CROP"') && card.includes('<div class="pe-cpin-head">2</div>') && card.includes('A-101 · Floor Plan — pin 2'));
  ok('the crop marker sits at the crop\'s pin (vertical as a width-based margin)', card.includes('<div class="pe-cpin" style="left:50.000%;top:0;margin-top:40.000%">'));
  // WebKit (the iOS print engine) mis-resolves a percentage top/height of an
  // absolute box inside a table cell — printed, the window slid a room up and
  // stretched. Inside the close-up every vertical length is width-based.
  const cropInner = between(card, '<div class="pe-crop">', '<div class="pe-crop-cap">');
  ok('no percentage top/height anywhere in the close-up', cropInner.length > 0 && !/(^|[;"\s])top:\s*-?[\d.]+%/.test(cropInner) && !/(^|[;"\s])height:\s*[\d.]+%/.test(cropInner), cropInner.slice(0, 300));
  ok('no percentage top/height in the close-up CSS', ['.pe-crop-img', '.pe-crop-sp', '.pe-cpin'].every(sel => !/(^|[\s;{])(top|height):\s*-?[\d.]+%/.test(new RegExp(`\\${sel} \\{([^}]*)\\}`).exec(PUNCH_EXPORT_CSS)?.[1] ?? 'top: 1%')));
  // SB has no image in this fixture, so only SA's three markers are drawn.
  ok('a close-up is not a plan-page marker (plan counts unchanged)', count(hw, '<div class="pe-pin-head">') === (mw.sheetPages.find(p => p.sheetId === 'SA')?.markers.length ?? -1));

  const mi = model('ios');
  const iosAssets = assets({
    SA: { kind: 'image', src: `${ORIGIN}/a.png`, mime: 'image/png', width: 2200, height: 1700 },
    SB: { kind: 'image', src: JPEG, mime: 'image/jpeg', width: 3024, height: 4032 },
  });
  const rA = mi.rows.find(r => r.id === uid(2))!;
  const c = planCropSource(rA, iosAssets, mi, 'ios', [ORIGIN]);
  ok('iOS: a remote sheet on a verified size → the sheet itself, windowed', c?.kind === 'css');
  if (c?.kind === 'css') {
    const w = pinCropWindow(0.4, 0.3, 2200 / 1700)!;
    ok('iOS window = pinCropWindow on the verified aspect', near(c.left, w.left) && near(c.width, w.width) && near(c.pinX, w.pinX) && near(c.pinY, w.pinY));
    // Execute the CSS: the object is 1/width × the square wide, shifted by
    // −left/width — so image point x shows at (x − left)/width of the square.
    const x = 0.4, y = 0.3;
    const sx = (-c.left / c.width) + x * (1 / c.width);
    const sy = (-c.top / c.height) + y * (1 / c.height);
    ok('the pin\'s image point shows exactly under the crop marker', near(sx, c.pinX) && near(sy, c.pinY), `${sx},${sy} vs ${c.pinX},${c.pinY}`);
    // The printed styles are those numbers, as width-based lengths: left and
    // width in % of the square, the vertical shift a margin-top in % of the
    // square's width (= its height), the sheet's height a padding in % of the
    // sheet box's own width — its verified aspect.
    const hc = html(mi, assets({ SA: { kind: 'image', src: `${ORIGIN}/a.png`, mime: 'image/png', width: 2200, height: 1700 } }), 'ios');
    const f = (n: number) => `${(n * 100).toFixed(3)}%`;
    ok('the iOS close-up prints left/width/margin-top/padding from the window',
      hc.includes(`<div class="pe-crop-img" style="left:${f(-c.left / c.width)};width:${f(1 / c.width)};margin-top:${f(-c.top / c.height)}"><div class="pe-crop-sp" style="padding-top:${f(c.width / c.height)}"></div>`));
    ok('…and the spacer is the sheet\'s own H/W (a square window: width·W = height·H)', near(c.width / c.height, 1700 / 2200));
  }
  eq('iOS: a data: sheet is never windowed per item', planCropSource(mi.rows.find(r => r.id === uid(4))!, iosAssets, mi, 'ios', [ORIGIN]), null);
  eq('iOS: an unverified size → no close-up', planCropSource(rA, assets({ SA: { kind: 'image', src: `${ORIGIN}/a.png`, mime: 'image/png' } }), mi, 'ios', [ORIGIN]), null);
  eq('Android: no trusted size → no close-up', planCropSource(model('android').rows.find(r => r.id === uid(2))!, iosAssets, model('android'), 'android', [ORIGIN]), null);
  ok('the CSS window stretches only on a verified aspect (object-fit: fill inside .pe-crop-obj)', /\.pe-crop-obj \{[^}]*object-fit:\s*fill/.test(PUNCH_EXPORT_CSS));

  const hi = html(mi, iosAssets, 'ios');
  ok('an item with no photo but a pin shows the close-up in the photo\'s place', cardOf(hi, 2).includes('<td class="pe-ph-cell"><div class="pe-crop">'));
  ok('an item with neither prints a slim "No photo" line, not a full square', hi.includes('<div class="pe-ph pe-ph-none"><div class="pe-ph-msg">No photo</div></div>') && /\.pe-ph-none \{[^}]*padding-top:\s*0/.test(PUNCH_EXPORT_CSS));
  ok('an item with a photo AND a pin keeps its photo, close-up under it', /<td class="pe-ph-cell"><div class="pe-ph"><object class="pe-obj"[\s\S]*?<\/object><\/div><div class="pe-crop">/.test(cardOf(hi, 1)));
  ok('an item with neither is #6', cardOf(hi, 6).includes('pe-ph-none'));
  const src = stripTsComments(read('utils/punchExportHtml.ts'));
  ok('native close-ups stay within the phone photo cap; web within PUNCH_EXPORT_PIN_CROP_CAP',
    /let cropsLeft = target === 'web' \? PUNCH_EXPORT_PIN_CROP_CAP : photoCapFor\(target\)/.test(src) && PUNCH_EXPORT_PIN_CROP_CAP > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nG. a long legend and edge pins (integration round 1)');
// ─────────────────────────────────────────────────────────────────────────────
{
  // 23 pins on one landscape sheet: the legend must print as unsplittable
  // chunks, each captioned with its sheet (WebKit never repeats a thead).
  const many: PunchItem[] = Array.from({ length: 23 }, (_, i) => ({
    id: uid(100 + i), projectId: 'p1', description: `Long ${i + 1}`, location: 'Hall', assignedSub: '', dueDate: '',
    priority: 'medium', status: 'open', listType: 'punch', createdAt: `2026-09-10T08:${String(i).padStart(2, '0')}:00.000Z`, updatedAt: '',
    planSheetId: 'SA', pinX: 0.5, pinY: 0.5,
  }) as PunchItem);
  const mm = buildPunchExportModel({
    scopeInput: { allItems: many, filteredItems: many, selectedIds: [], activeList: 'punch', filters: FILTERS },
    scope: 'all', includeCrew: false, target: 'web', project: { id: 'p1', name: 'Job' }, sheets: SHEETS,
    markupByItemId: new Map(), now: new Date(2026, 8, 22, 10, 0),
  });
  const hh = html(mm, assets({ SA: { kind: 'image', src: JPEG, mime: 'image/jpeg', width: 2459, height: 1349 } }), 'web', false);
  const sec = between(hh, '<section class="pe-plan pe-plan-land">', '</section>');
  const chunks = sec.split('<div class="pe-legend-chunk">').slice(1);
  ok(`23 rows → 3 chunks of at most ${LEGEND_CHUNK_ROWS} (a chunk is small enough to fit a page)`, chunks.length === 3 && LEGEND_CHUNK_ROWS <= 12, String(chunks.length));
  ok('every chunk carries the sheet caption and the column header in its thead',
    chunks.length > 1 && chunks.every((c, i) => c.includes(`<thead><tr class="pe-legend-cap"><th colspan="6">Pins on A-101 · Floor Plan · Rev 2${i > 0 ? ' (continued)' : ''}</th></tr><tr><th`)));
  ok('a chunk that starts mid-marker still names its marker on its first row',
    chunks.slice(1).every(c => { const td = /<tbody><tr[^>]*><td[^>]*>([^<]*)<\/td>/.exec(c); return !!td && td[1].trim() !== ''; }));
  ok('a chunk never splits across pages; the thead repeats where the engine can',
    /\.pe-legend-chunk \{[^}]*break-inside:\s*avoid/.test(PUNCH_EXPORT_CSS) && /\.pe-legend thead \{[^}]*display:\s*table-header-group/.test(PUNCH_EXPORT_CSS));

  // The close-up clips its box: a pin in the top corner must hang below and
  // inward, so its number is inside the box.
  eq('pin at (0.01, 0.01) hangs below and runs right', cropPinClass(0.01, 0.01), 'pe-cpin pe-cpin-below pe-cpin-l');
  eq('pin at (0.97, 0.05) hangs below and runs left', cropPinClass(0.97, 0.05), 'pe-cpin pe-cpin-below pe-cpin-r');
  eq('a mid-sheet pin is unchanged', cropPinClass(0.5, 0.4), 'pe-cpin');
  ok('the below variant drops translateY(-100%) and turns the tail up',
    /\.pe-cpin-below \{[^}]*flex-direction:\s*column-reverse[^}]*transform:\s*translate\(-50%,0\)/.test(PUNCH_EXPORT_CSS)
      && /\.pe-cpin-below \.pe-cpin-tail \{[^}]*border-bottom:\s*6px solid/.test(PUNCH_EXPORT_CSS));
  const srcH = stripTsComments(read('utils/punchExportHtml.ts'));
  ok('the close-up marker takes its class from cropPinClass', /<div class="\$\{cpinCls\}" style="left:/.test(srcH) && /cropPinClass\(clamp01\(pinX\), clamp01\(pinY\)\)/.test(srcH));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nF. the platform file');
// ─────────────────────────────────────────────────────────────────────────────
{
  const d = stripTsComments(read('utils/punchExportDelivery.ts'));
  const crops = between(d, 'async function webPinCrops(', '\nfunction nativeImageSize(');
  ok('web close-ups are cut from the export\'s own data: sheet JPEGs (untainted canvas), via pinCropWindow',
    /asset\.remote/.test(crops) && /data:image/.test(crops) && /pinCropWindow\(r\.plan\.x,\s*r\.plan\.y,\s*iw \/ ih\)/.test(crops) && /drawImage\(img,\s*w\.left \* iw,\s*w\.top \* ih,\s*w\.width \* iw,\s*w\.height \* ih/.test(crops));
  ok('web close-ups are capped and in document order', /docRows\.slice\(0,\s*PUNCH_EXPORT_PIN_CROP_CAP\)/.test(crops) && /model\.sections\.flatMap/.test(crops));
  ok('the OS size is asked for only where a sheet can be turned', count(d, 'PUNCH_EXPORT_ROTATE_TARGETS.includes(target)') === 2 && /RNImage\.getSize\(/.test(d));
  ok('close-ups only on the web cards (photos on)', /if \(target === 'web' && opts\.includePhotos\) pinCrops = await webPinCrops\(model, sheets, signal\)/.test(d));
  ok('the assets hand the close-ups over', /pinCrops && pinCrops\.size > 0 \? \{ pinCrops \} : \{\}/.test(d));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
