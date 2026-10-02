// scripts/moments-checks/signline.ts — the SIGNLINE lane's checks (the signing
// line skin, the seal, the letter fold, display ink, SignaturePad logic).
//
// Loaded by scripts/validate-moments.ts, which passes ctx. Pure modules are
// imported (they have no react-native import); everything that touches React
// Native is checked as TEXT, comments stripped.
//
// MUTATION PROOF (S14): set SIGNLINE_MUT_DIR to a directory that mirrors repo
// paths; any file found there is read / imported INSTEAD of the repo copy, so
// a mutant can be shown to turn a check red without ever touching the repo.
// The directory needs a tsconfig.json mapping "@/*" to the repo for imports.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Ctx = {
  ok(name: string, cond: boolean, detail?: string): void;
  read(rel: string): string;
  stripComments(src: string): string;
  listFiles(dir: string, exts: string[]): string[];
  root: string;
};

const MUT = process.env.SIGNLINE_MUT_DIR;

function pathFor(ctx: Ctx, rel: string): string {
  if (MUT && existsSync(join(MUT, rel))) return join(MUT, rel);
  return join(ctx.root, rel);
}
function readF(ctx: Ctx, rel: string): string {
  return readFileSync(pathFor(ctx, rel), 'utf8');
}
async function load<T>(ctx: Ctx, rel: string): Promise<T> {
  return (await import(pathToFileURL(pathFor(ctx, rel)).href)) as T;
}
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
/** The brace-balanced body that starts at the first `{` at/after `from`. */
function bodyFrom(src: string, from: number): string {
  const open = src.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const SIGNING = 'components/moments/signing';
const MY_UTILS = ['signatureInk', 'sealText', 'sealPlan', 'platform3d', 'signTimeline'].map((n) => `utils/moments/${n}.ts`);

export default async function run(ctx: Ctx): Promise<void> {
  const strip = (rel: string) => ctx.stripComments(readF(ctx, rel));
  const pad = strip('components/SignaturePad.tsx');
  const ceremony = strip(`${SIGNING}/SigningCeremony.tsx`);

  // ── S1 hash parity ─────────────────────────────────────────────────────
  {
    const ink = await load<typeof import('../../utils/moments/signatureInk')>(ctx, 'utils/moments/signatureInk.ts');
    const legacy = (pts: { x: number; y: number }[]) => {
      let d = '';
      pts.forEach(({ x, y }, i) => {
        d += i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`;
      });
      return d;
    };
    const sets: { x: number; y: number }[][] = [
      [{ x: 100.05, y: 50 }],
      [{ x: 0, y: 0 }, { x: 299.96, y: 149.94 }],
      [{ x: 10.04, y: 20.06 }, { x: 15.55, y: 25.449 }, { x: 30, y: 40.25 }],
      [{ x: -3.26, y: 180.44 }, { x: 412.5, y: -0.04 }, { x: 1e-9, y: 7.25 }],
      Array.from({ length: 50 }, (_, i) => ({ x: i * 6.123, y: Math.sin(i) * 60 + 75 })),
    ];
    const bad = sets.filter((p) => ink.buildStroke(p) !== legacy(p));
    const pointOk = ink.formatPoint(1.25, -2.35, true) === `M${(1.25).toFixed(1)},${(-2.35).toFixed(1)}`
      && ink.formatPoint(3, 4, false) === ' L3.0,4.0';
    const coordOk = ink.toCoordinate(-10, 500, 300 / 352, 0.5).x === -10 * (300 / 352)
      && ink.toCoordinate(-10, 500, 300 / 352, 0.5).y === 250;
    ctx.ok('S1 buildStroke/formatPoint are byte-identical to the legacy builder (1-point, negative, out-of-canvas; no clamp)',
      bad.length === 0 && pointOk && coordOk && ink.buildStroke([]) === '',
      bad.length ? `mismatch: ${ink.buildStroke(bad[0])} vs ${legacy(bad[0])}` : undefined);
    const importsInk = /from '@\/utils\/moments\/signatureInk'/.test(pad) && /\b(formatPoint|buildStroke)\(/.test(pad);
    const forbidden = /toFixed\(|quadratic|bezier|perfect-freehand|taper|velocity|['"`][QC]\s?['"`$]|\s[QC]\$\{/i.exec(pad);
    ctx.ok('S1 SignaturePad builds strokes only through signatureInk (no toFixed, no curve/taper/velocity)',
      importsInk && !forbidden, forbidden ? `found "${forbidden[0]}"` : importsInk ? undefined : 'no signatureInk import/use');
  }

  // ── S2 SignaturePad logic ──────────────────────────────────────────────
  {
    const loc = /locationX/.test(pad) && /locationY/.test(pad);
    const noPage = !/pageX|pageY|\.measure\(/.test(pad);
    const svgTag = /<Svg\b[\s\S]*?>/.exec(pad)?.[0] ?? '';
    const svgNone = /pointerEvents="none"/.test(svgTag);
    const startIdx = pad.indexOf('onStartShouldSetPanResponder');
    const startBody = startIdx >= 0 ? bodyFrom(pad, startIdx) : '';
    const startOk = /noStartRects/.test(startBody) && /locked/.test(startBody);
    const releaseOk = /onPanResponderRelease:\s*commit/.test(pad) && /onChange\?\.\(/.test(bodyFrom(pad, pad.indexOf('const commit')));
    const nested = /set\w+\(\s*\(?\s*\w*\s*\)?\s*=>\s*\{[^}]*\bset[A-Z]\w*\(/.test(pad);
    ctx.ok('S2 SignaturePad reads locationX/Y (no pageX/pageY/measure), Svg pointerEvents none', loc && noPage && svgNone,
      !loc ? 'no locationX/Y' : !noPage ? 'pageX/pageY/measure still present' : 'Svg lacks pointerEvents="none"');
    ctx.ok('S2 start consults noStartRects + locked; release commits and fires onChange; no setState inside an updater',
      startOk && releaseOk && !nested,
      !startOk ? 'onStartShouldSetPanResponder ignores noStartRects/locked' : !releaseOk ? 'release does not commit+onChange' : 'nested setState');
  }

  // ── S3 display = PDF ───────────────────────────────────────────────────
  {
    const PDF_PATH = /<path d="\$\{escHtml\(d\)\}" stroke="[^"]+" stroke-width="1\.6" fill="none" stroke-linecap="round" stroke-linejoin="round" \/>/g;
    const pdfN = (readF(ctx, 'utils/pdfGenerator.ts').match(PDF_PATH) ?? []).length;
    const lienN = (readF(ctx, 'utils/lienWaiverDocument.ts').match(PDF_PATH) ?? []).length;
    const ink = await load<typeof import('../../utils/moments/signatureInk')>(ctx, 'utils/moments/signatureInk.ts');
    const constOk = ink.PDF_SIGNATURE_STROKE_WIDTH === 1.6 && ink.PDF_SIGNATURE_LINECAP === 'round' && ink.PDF_SIGNATURE_LINEJOIN === 'round';
    const inkView = strip(`${SIGNING}/SignatureInk.tsx`);
    const viewOk = /strokeWidth=\{PDF_SIGNATURE_STROKE_WIDTH\}/.test(inkView)
      && /strokeLinecap=\{PDF_SIGNATURE_LINECAP\}/.test(inkView)
      && /strokeLinejoin=\{PDF_SIGNATURE_LINEJOIN\}/.test(inkView)
      && /\bd=\{d\}/.test(inkView)
      && /viewBox=/.test(inkView);
    const padPaths = pad.match(/<Path\b[\s\S]*?\/>/g) ?? [];
    const padOk = padPaths.length >= 2
      && padPaths.every((p) => /strokeLinecap="round"/.test(p) && /strokeLinejoin="round"/.test(p) && /\bd=\{(d|currentPath)\}/.test(p));
    const cerOk = /strokeWidth=\{PDF_SIGNATURE_STROKE_WIDTH\}/.test(ceremony);
    ctx.ok('S3 PDF draws d verbatim at 1.6, round caps/joins (pdfGenerator x2, lienWaiverDocument x1)', pdfN >= 2 && lienN >= 1,
      `pdfGenerator ${pdfN}, lienWaiverDocument ${lienN}`);
    ctx.ok('S3 display ink = PDF: 1.6 constant, SignatureInk + ceremony pad use it, d verbatim, round caps/joins',
      constOk && viewOk && padOk && cerOk,
      !constOk ? 'constants drifted' : !viewOk ? 'SignatureInk drifted' : !padOk ? 'SignaturePad Path drifted' : 'ceremony pad width drifted');
  }

  // ── S4 seal text ───────────────────────────────────────────────────────
  {
    const t = await load<typeof import('../../utils/moments/sealText')>(ctx, 'utils/moments/sealText.ts');
    const iso = '2026-09-27T18:41:00.000Z';
    const tz = 'America/New_York';
    const ring = t.buildSealRingText({ verb: 'SIGNED', method: 'drawn', signedAtIso: iso, timeZone: tz });
    const inPerson = t.buildSealRingText({ verb: 'SIGNED', method: 'in_person', signedAtIso: iso, timeZone: tz });
    const accepted = t.buildSealRingText({ verb: 'ACCEPTED', signedAtIso: iso, timeZone: tz });
    const dev = t.buildRecordLine({ verb: 'Signed', signedAtIso: iso, timeSource: 'device', timeZone: tz });
    const srv = t.buildRecordLine({ verb: 'Signed', signedAtIso: iso, timeSource: 'server', timeZone: tz, binding: true, name: 'Jane Smith' });
    const expect = {
      ring: 'SIGNED · SEP 27 2026 · 2:41 PM · ',
      inPerson: 'SIGNED IN PERSON · SEP 27 2026 · 2:41 PM · ',
      accepted: 'ACCEPTED · SEP 27 2026 · 2:41 PM · ',
      dev: 'Signed Sep 27, 2026, 2:41 PM (device time)',
      srv: 'Jane Smith · Signed. Binding · Sep 27, 2026, 2:41 PM (server time)',
    };
    const noBrand = ![ring, inPerson, accepted].some((s) => /MAGE ID/i.test(s))
      && !['utils/moments/sealText.ts', `${SIGNING}/SealStamp.tsx`, `${SIGNING}/SigningCeremony.tsx`].some((f) => /MAGE ID/i.test(strip(f)));
    const paperThrows = throws(() => t.buildSealRingText({ verb: 'SIGNED', method: 'paper', signedAtIso: iso }))
      && throws(() => t.methodLabel('paper'));
    const allOk = ring === expect.ring && inPerson === expect.inPerson && accepted === expect.accepted
      && dev.text === expect.dev && dev.verb === 'Signed' && srv.text === expect.srv;
    ctx.ok('S4 ring text + record line from the stored record (NY fixture), device/server time labelled',
      allOk, allOk ? undefined : JSON.stringify({ ring, inPerson, accepted, dev: dev.text, srv: srv.text }));
    ctx.ok('S4 never "MAGE ID" on a seal; proposals read ACCEPTED; paper throws', noBrand && paperThrows && accepted.startsWith('ACCEPTED'),
      !noBrand ? 'MAGE ID found' : 'paper did not throw');
    ctx.ok('S4 a bad timestamp throws (never an invented date)', throws(() => t.buildSealRingText({ verb: 'SIGNED', signedAtIso: 'not a date' })));
  }

  // ── S5 seal plan ───────────────────────────────────────────────────────
  {
    const { sealPlan } = await load<typeof import('../../utils/moments/sealPlan')>(ctx, 'utils/moments/sealPlan.ts');
    const one = sealPlan({ parties: 1, signedBefore: 0 });
    const first = sealPlan({ parties: 2, signedBefore: 0 });
    const close = sealPlan({ parties: 2, signedBefore: 1 });
    const oneOk = one.arcsDraw.top && one.arcsDraw.bottom && !one.arcsBefore.top && !one.arcsBefore.bottom
      && one.centre === 'check' && one.checkAt === 160 && !one.binding;
    const firstOk = first.arcsDraw.top && !first.arcsDraw.bottom && first.centre === 'count' && first.countText === '1 of 2'
      && first.checkAt === null && !first.binding;
    const closeOk = close.arcsBefore.top && !close.arcsBefore.bottom && close.arcsDraw.bottom && !close.arcsDraw.top
      && close.centre === 'check' && close.checkAt === 640 && close.binding;
    const bad = [
      [1, 1], [3, 0], [0, 0], [2, 2],
    ] as const;
    const throwsBad = bad.every(([p, s]) => throws(() => sealPlan({ parties: p as 1, signedBefore: s as 0 })));
    ctx.ok('S5 sealPlan truth table (1 party / GC first of 2 / closing signer); only 2/1 is binding; others throw',
      oneOk && firstOk && closeOk && throwsBad, JSON.stringify({ oneOk, firstOk, closeOk, throwsBad }));
  }

  // ── S6 platform 3D gate ────────────────────────────────────────────────
  {
    const { can3DFor } = await load<typeof import('../../utils/moments/platform3d')>(ctx, 'utils/moments/platform3d.ts');
    const gate = can3DFor('android') === false && can3DFor('ios') === true && can3DFor('web') === true
      && can3DFor('windows') === false && can3DFor('') === false;
    const both = ['LetterFold', 'HandoffTurn'].map((n) => {
      const src = strip(`${SIGNING}/${n}.tsx`);
      return /can3DFor\(Platform\.OS\)/.test(src) && /\b(useReducedMotion|reducedMotion)\(/.test(src) && /!threeD|if \(threeD\)|threeD \?/.test(src)
        && /Cross-fade|cross-fade/.test(readF(ctx, `${SIGNING}/${n}.tsx`));
    });
    ctx.ok('S6 3D off on Android/unknown; LetterFold + HandoffTurn gate on can3DFor + Reduce Motion with a cross-fade branch',
      gate && both.every(Boolean), JSON.stringify({ gate, LetterFold: both[0], HandoffTurn: both[1] }));
  }

  // ── S7 line zone ───────────────────────────────────────────────────────
  {
    const tl = await load<typeof import('../../utils/moments/signTimeline')>(ctx, 'utils/moments/signTimeline.ts');
    const { CAPSULE_RULES } = await load<typeof import('../../utils/moments/motionSpec')>(ctx, 'utils/moments/motionSpec.ts');
    const { inNoStartRect } = await load<typeof import('../../utils/moments/signatureInk')>(ctx, 'utils/moments/signatureInk.ts');
    const G = tl.LINE_GEOMETRY;
    const headTop = G.lineY - G.D / 2;
    const grabTop = headTop - CAPSULE_RULES.hitSlop; // Android RNGH honours positive hitSlop
    const slopPinned = G.capsuleHitSlop === CAPSULE_RULES.hitSlop;
    const rects = [320, 352, 390, 420].map((W) => {
      const padH = tl.padHeightFor(W);
      const r = tl.noStartRectFor(W, padH);
      // Structural: the band starts at or above the line zone AND the head's grab area.
      const shape = r.x === 0 && r.width === W && r.y <= G.zoneTop && r.y <= grabTop
        && Math.abs(r.y + r.height - padH) < 1e-9 && padH <= 172;
      // Behavioural: no touch anywhere in [min(zoneTop, grabTop), padH] x [0, W] can start a stroke.
      let startable = 0;
      for (let y = Math.min(G.zoneTop, grabTop); y <= padH; y += 0.5) {
        for (let x = 0; x <= W; x += 4) if (!inNoStartRect(x, y, [r])) startable++;
      }
      return shape && startable === 0;
    });
    const passes = /noStartRects=\{noStart\}/.test(ceremony) && /locked=\{locked \|\| (?:sealed|done)\}/.test(ceremony)
      && /noStartRectFor\(W, padH\)/.test(ceremony);
    ctx.ok('S7 no-start rect starts at/above the line zone (110) and the head grab area (118 - hitSlop = 106), no stroke can start in [106, padH] for W 320/352/390/420; the ceremony passes noStartRects + locked',
      slopPinned && rects.every(Boolean) && passes, JSON.stringify({ slopPinned, rects, passes }));
  }

  // ── S8 consent ─────────────────────────────────────────────────────────
  {
    const { consentRenderable } = await load<typeof import('../../utils/moments/signatureInk')>(ctx, 'utils/moments/signatureInk.ts');
    const pure = !consentRenderable('') && !consentRenderable('   ') && !consentRenderable(undefined) && !consentRenderable(null)
      && consentRenderable('co-esign-2');
    const row = strip(`${SIGNING}/ConsentRow.tsx`);
    const gate = /if \(!consentRenderable\(p\.version\)\) return null;/.test(row);
    ctx.ok('S8 a consent box renders only with a stored version (pure helper + ConsentRow returns null)', pure && gate,
      JSON.stringify({ pure, gate }));
  }

  // ── S9 legal ───────────────────────────────────────────────────────────
  {
    const forced = /writeOptions:\s*\{\s*\.\.\.props\.writeOptions,\s*legal:\s*true\s*\}/.test(ceremony);
    // Step 0: the site's whole-sentence copy.offline, else offlineLegalReason() (offlineReasonLine).
    const offline = /offlineReason:\s*(?:offlineLegalReason\(\)|offlineReasonLine\(props\.writeOptions\))/.test(ceremony);
    const pcIdx = ceremony.indexOf('const playConfirmed = async');
    const pcBody = pcIdx >= 0 ? bodyFrom(ceremony, pcIdx) : '';
    const outside = pcBody ? ceremony.replace(pcBody, '') : ceremony;
    const drivesOutside = /\bsv\.\w+\.setValue|\btw\(sv\.|\bsp\(sv\.|setSeal\(|\btw\(lr\b|\btw\(rec\b|momentHaptic\('success'\)|onBinding\?\.\(/.exec(outside);
    const drivesInside = /setSeal\(/.test(pcBody) && /momentHaptic\('success'\)/.test(pcBody) && /tw\(rec\b/.test(pcBody);
    const sealMount = /\{seal \? \(\s*<SealStamp/.test(ceremony);
    ctx.ok('S9 legal: writeOptions.legal forced true; offline reason in readiness', forced && offline, JSON.stringify({ forced, offline }));
    ctx.ok('S9 the seal, arcs, check, record and success haptic are driven only inside playConfirmed; the seal mounts only after it',
      !drivesOutside && drivesInside && sealMount,
      drivesOutside ? `driven outside playConfirmed: ${drivesOutside[0]}` : !drivesInside ? 'playConfirmed does not drive the seal' : 'seal mounted unconditionally');
  }

  // ── S10 paper ──────────────────────────────────────────────────────────
  {
    const union = /method:\s*([^;]+);/.exec(bodyFrom(ceremony, ceremony.indexOf('export interface SigningCeremonyProps')))?.[1] ?? '';
    const notInUnion = union.length > 0 && !/'paper'/.test(union);
    const runtime = /if \(\(props\.method as string\) === 'paper'\) \{[\s\S]{0,200}?return null;/.test(ceremony);
    ctx.ok("S10 'paper' is not in the method union and the ceremony returns null for it", notInUnion && runtime,
      JSON.stringify({ union: union.trim(), runtime }));
  }

  // ── S11 homeowner name ─────────────────────────────────────────────────
  {
    const ok = /useState\(signer === 'gc'\)/.test(ceremony) && /nameTouched \? name\.value : ''/.test(ceremony)
      && /if \(signer !== 'gc' && name\.value\) name\.onChange\(''\)/.test(ceremony);
    ctx.ok('S11 a homeowner / authorizer name is never prefilled', ok);
  }

  // ── S12 dark-mode body dim ─────────────────────────────────────────────
  {
    const line = strip(`${SIGNING}/SignatureLine.tsx`);
    const ok = /resolved === 'dark' \? 0\.45 : 1/.test(line) && /part="body" bodyOpacity=\{bodyOpacity\}/.test(line)
      && /const bodyOpacity = lineBodyOpacity\(resolved\)/.test(line) && !/part="head"[^>]*bodyOpacity/.test(line);
    ctx.ok('S12 the capsule body under the ink is 0.45 in dark mode; the head is never dimmed', ok);
  }

  // ── S13 motion + tokens ────────────────────────────────────────────────
  {
    const files = walk(join(ctx.root, SIGNING)).map((abs) => abs.slice(ctx.root.length + 1));
    const src = files.map((f) => ({ f, s: strip(f) }));
    const layoutAnim = src.filter(({ s }) => /LayoutAnimation/.test(s)).map(({ f }) => f);
    const layoutNextCalls = src.flatMap(({ f, s }) => (s.match(/\blayoutNext\(\)/g) ?? []).map(() => f));
    const badDriver = src.flatMap(({ f, s }) => (s.match(/useNativeDriver:\s*[^,}\s]+/g) ?? [])
      .filter((m) => !/useNativeDriver:\s*nativeDriver$/.test(m)).map((m) => `${f}: ${m}`));
    const timings = src.reduce((n, { s }) => n + (s.match(/Animated\.(timing|spring)\(/g) ?? []).length, 0);
    const drivers = src.reduce((n, { s }) => n + (s.match(/useNativeDriver:\s*nativeDriver/g) ?? []).length, 0);
    ctx.ok('S13 no LayoutAnimation; the single layoutNext() lives in LetterFold', layoutAnim.length === 0
      && layoutNextCalls.length === 1 && layoutNextCalls[0].endsWith('LetterFold.tsx'), JSON.stringify({ layoutAnim, layoutNextCalls }));
    ctx.ok('S13 every Animated timing/spring in signing uses useNativeDriver: nativeDriver', badDriver.length === 0 && drivers >= timings,
      badDriver.length ? badDriver.join('; ') : `${drivers} drivers for ${timings} animations`);
    const tokenFiles = [...files, ...MY_UTILS, 'components/SignaturePad.tsx'];
    const tokenHits: string[] = [];
    for (const f of tokenFiles) {
      const s = strip(f);
      const hits = s.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\bfontSize:\s*\d/g) ?? [];
      // SignaturePad keeps its existing literals as DEFAULTS (spec: add none).
      const allowed = f === 'components/SignaturePad.tsx' ? ['#1a1a1a', '#FAFAFA', 'rgba(', '#FFFFFF', '#FFFFFF'] : [];
      const left = [...hits];
      for (const a of allowed) {
        const i = left.indexOf(a);
        if (i >= 0) left.splice(i, 1);
      }
      for (const h of left) tokenHits.push(`${f}: ${h}`);
    }
    ctx.ok('S13 theme tokens only: no hex / rgb() / inline fontSize in signing + SIGNLINE utils (SignaturePad adds none)',
      tokenHits.length === 0, tokenHits.join('; '));
  }

  // ── S15 copy ───────────────────────────────────────────────────────────
  {
    const { lintMomentCopy } = await load<typeof import('../../utils/moments/copy')>(ctx, 'utils/moments/copy.ts');
    const ink = await load<typeof import('../../utils/moments/signatureInk')>(ctx, 'utils/moments/signatureInk.ts');
    const fixed = [
      ...Object.values(ink.LINE_REASONS),
      'Not sent. The connection dropped, so nothing left your phone.',
      'Not recorded. This contract changed on another device.',
      'Not signed. The connection dropped, so nothing was recorded.',
      "You're offline. Signing needs a connection.",
      'Done. Hand the phone back to Omir',
      'Signed · Email not sent. Share the link instead.',
      'Signed · Email not sent',
      'Signed · awaiting countersignature',
      'Signed. Email not sent.',
      'Share the link instead.',
      'Awaiting your signature',
      'Slide along the line to sign',
      'Slide along the line to sign and send',
      'Slide along the line to make it binding',
      'Slide along the line to accept',
    ];
    const bad = fixed.map((s) => ({ s, e: lintMomentCopy(s) })).filter((x) => x.e.length);
    ctx.ok('S15 the signing copy lints clean (no em dash, no "!", sentence case)', bad.length === 0,
      bad.map((b) => `${b.s}: ${b.e.join(', ')}`).join('; '));
  }

  // ── S16 the waiting chip never claims a send it cannot know ─────────────
  {
    const t = await load<typeof import('../../utils/moments/sealText')>(ctx, 'utils/moments/sealText.ts');
    const cases: [Parameters<typeof t.waitingChipText>[0], string][] = [
      [{ to: 'Jane Smith' }, 'Sent · awaiting Jane Smith'],
      [{ to: 'Jane Smith', sent: true }, 'Sent · awaiting Jane Smith'],
      [{ to: 'Jane Smith', sent: false }, 'Signed · Email not sent'],
      [undefined, 'Signed · awaiting countersignature'],
      [null, 'Signed · awaiting countersignature'],
    ];
    const got = cases.map(([f, want]) => ({ want, got: t.waitingChipText(f) })).filter((c) => c.got !== c.want);
    const cer = ctx.stripComments(readF(ctx, 'components/moments/signing/SigningCeremony.tsx'));
    const wired = /waitingChipText\(p\.fold\)/.test(cer) && !/`Sent · awaiting/.test(cer);
    ctx.ok('S16 the chip says "Sent" only for a fold whose email left (waitingChipText, wired in the ceremony)',
      got.length === 0 && wired, JSON.stringify({ got, wired }));
  }

  // ── S17 the line reasons go through t(), with the same English ──────────
  // "Sign above the line" and its two siblings are read under the signature
  // and as the slide's disabled reason, so they translate (common.moment.line*).
  // LINE_REASONS stays the English statement S15 lints; each t() fallback must
  // equal it, and lineReadiness may not hand back a raw LINE_REASONS string.
  {
    const ink = await load<typeof import('../../utils/moments/signatureInk')>(ctx, 'utils/moments/signatureInk.ts');
    const src = strip('utils/moments/signatureInk.ts');
    const KEYS = { sign: 'common.moment.lineSign', name: 'common.moment.lineName', consent: 'common.moment.lineConsent' } as const;
    const mismatch: string[] = [];
    for (const [k, key] of Object.entries(KEYS) as [keyof typeof KEYS, string][]) {
      const m = new RegExp(`\\bt\\('${key.replace(/\./g, '\\.')}', '([^']*)'\\)`).exec(src);
      if (!m) mismatch.push(`${key}: no t() call`);
      else if (m[1] !== ink.LINE_REASONS[k]) mismatch.push(`${key}: "${m[1]}" is not LINE_REASONS.${k} "${ink.LINE_REASONS[k]}"`);
    }
    const body = bodyFrom(src, src.indexOf('export function lineReadiness'));
    const raw = /return LINE_REASONS\./.test(body);
    const base = { offline: false, offlineReason: 'off', mode: 'drawn' as const, paths: [] as string[], name: '', minName: 2 };
    const english = ink.lineReadiness(base) === ink.LINE_REASONS.sign
      && ink.lineReadiness({ ...base, mode: 'typed' }) === ink.LINE_REASONS.name
      && ink.lineReadiness({ ...base, mode: 'typed', name: 'Jane Smith', consent: { version: 'v1', checked: false } }) === ink.LINE_REASONS.consent;
    ctx.ok('S17 the line reasons are t(common.moment.line*) with LINE_REASONS\' exact English; lineReadiness returns no raw LINE_REASONS',
      mismatch.length === 0 && !raw && english, JSON.stringify({ mismatch, raw, english }));
  }
}
