// validate-motion-adopt-2.ts — lane ADOPT2: the four app rows the KITFIX merge
// unblocked use the motion kit, at the right moment, with real numbers.
//
//   AD18 scan → filed            app/scan.tsx                       (useFileInto)
//   AD19 upload → folder receive components/ProjectFilesBrowser.tsx  (useFileInto)
//   AD15 Cost X-Ray accumulate   app/cost-xray.tsx + utils/costXrayAccumulate.ts (useAccumulate)
//   AD21 the Gantt Today rule    components/schedule/InteractiveGantt.tsx (useFocusPush, ruleAxis 'y')
//
// Checks:
//   V1 each screen imports its hook from '@/components/motion/kit' and adds no
//      Animated.timing / Animated.spring / setTimeout of its own (a ratchet on
//      the counts the base file already had: InteractiveGantt's zoom pill and
//      dash march, and its long-press timer, predate this lane).
//   V2 scan.tsx: fileInto( sits after the `done < total` early return and after
//      addScan(, before setCaptures([]); it is awaited, setSaving(false) and
//      setSaved( come after it (no second tap while it measures), the delivery
//      arrival push is never behind it, and the layer renders once.
//   V3 ProjectFilesBrowser: fileInto( is inside handleUpload's try block, after
//      uploadProjectFile( and refreshFiles(, never in catch / finally.
//   V4 xrayAccumulateCents golden (1 234.50 → 123 450; 99.99 → 9 999, not the
//      floating-point 9 998; a verify tell with a band of 500 → 0; sum
//      133 449) and the screen wiring: the band comes from effectiveBand (no
//      second copy of the math), armed: reviewsLive, the cards go straight into
//      the TileGrid, the C1 total sits above it, the accepted-contingency
//      readout is unchanged.
//   V5 Gantt: useFocusPush(hScrollRef, { axis: 'x', ruleAxis: 'y', … }), Today
//      pushes through it (no raw scrollTo left in scrollToToday) with the same
//      lead-in, todayPush.styleFor('today') is on the today line while it draws
//      (the plain View at rest, so the goldens hold), and the horizontal
//      scroller reports onMomentumScrollEnd.
//
// Imports ONLY utils/costXrayAccumulate.ts (pure); every other file is read as
// TEXT, comment-stripped.
//
// MUTATION PROOF: set MOTIONADOPT_2_MUT_DIR to a directory that mirrors repo
// paths; a file found there is read (or imported) INSTEAD of the repo copy.
//
// Run via: bun run scripts/validate-motion-adopt-2.ts

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MUT = process.env.MOTIONADOPT_2_MUT_DIR;

const FILES = {
  scan: 'app/scan.tsx',
  files: 'components/ProjectFilesBrowser.tsx',
  xray: 'app/cost-xray.tsx',
  gantt: 'components/schedule/InteractiveGantt.tsx',
  acc: 'utils/costXrayAccumulate.ts',
} as const;

let failures = 0;
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log('  PASS  ' + name); return; }
  failures += 1;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail.split('\n').join('\n        ') : ''));
}

function pathOf(rel: string): string {
  if (MUT && existsSync(join(MUT, rel))) return join(MUT, rel);
  return join(ROOT, rel);
}
function read(rel: string): string {
  try { return readFileSync(pathOf(rel), 'utf8'); } catch { return ''; }
}

/** Blank out // and /* *\/ comments (strings kept, newlines kept). A copy of validate-motion-adopt-b's. */
function stripComments(src: string): string {
  const out = src.split('');
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; blank(i); blank(i + 1); i += 2; continue; }
      if (two === '/*') { mode = 'block'; blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === "'") mode = 'sq';
      else if (src[i] === '"') mode = 'dq';
      else if (src[i] === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') {
      if (src[i] === '\n') { mode = 'code'; i++; continue; }
      blank(i); i++; continue;
    }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; blank(i); blank(i + 1); i += 2; continue; }
      blank(i); i++; continue;
    }
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) mode = 'code';
    else if ((mode === 'sq' || mode === 'dq') && src[i] === '\n') mode = 'code';
    i++;
  }
  return out.join('');
}

/** The balanced (…) / {…} / […] group that opens at `open`. */
function group(src: string, open: number): string {
  const o = src[open];
  const c = o === '(' ? ')' : o === '{' ? '}' : ']';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c) { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}
/** The opening JSX tag that starts at `at` ('<Name …>'), braces respected. */
function openTag(src: string, at: number): string {
  if (at < 0) return '';
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    else if (src[i] === '>' && depth === 0 && src[i - 1] !== '=') return src.slice(at, i + 1);
  }
  return src.slice(at);
}
const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;

const KIT_IMPORT = /import\s*\{([^}]*)\}\s*from\s*'@\/components\/motion\/kit'/;
function kitNames(src: string): Set<string> {
  const m = KIT_IMPORT.exec(src);
  return new Set((m?.[1] ?? '').split(',').map((n) => n.trim().replace(/^type\s+/, '')).filter(Boolean));
}

async function main() {
  const S = {
    scan: stripComments(read(FILES.scan)),
    files: stripComments(read(FILES.files)),
    xray: stripComments(read(FILES.xray)),
    gantt: stripComments(read(FILES.gantt)),
  };
  for (const [k, rel] of Object.entries(FILES)) ok(`files: ${rel} is readable`, read(rel).length > 0, k);

  // ── V1 the kit, and no motion of their own ─────────────────────────────
  const hooks: [keyof typeof S, string][] = [['scan', 'useFileInto'], ['files', 'useFileInto'], ['xray', 'useAccumulate'], ['gantt', 'useFocusPush']];
  for (const [f, hook] of hooks) {
    const src = S[f];
    ok(`V1 ${FILES[f]} imports ${hook} from '@/components/motion/kit' and calls it`, kitNames(src).has(hook) && new RegExp(`\\b${hook}\\(`).test(src));
  }
  // The base file's own counts (b5c123cc, comments stripped): only the Gantt had any.
  const BASE: Record<keyof typeof S, { timing: number; spring: number; timeout: number }> = {
    scan: { timing: 0, spring: 0, timeout: 0 },
    files: { timing: 0, spring: 0, timeout: 0 },
    xray: { timing: 0, spring: 0, timeout: 0 },
    gantt: { timing: 1, spring: 1, timeout: 2 },
  };
  for (const f of Object.keys(BASE) as (keyof typeof S)[]) {
    const src = S[f];
    const n = { timing: count(src, /\bAnimated\.timing\b/g), spring: count(src, /\bAnimated\.spring\b/g), timeout: count(src, /\bsetTimeout\b/g) };
    const b = BASE[f];
    ok(`V1 ${FILES[f]} adds no Animated.timing / Animated.spring / setTimeout of its own (${n.timing}/${n.spring}/${n.timeout} ≤ ${b.timing}/${b.spring}/${b.timeout})`,
      n.timing <= b.timing && n.spring <= b.spring && n.timeout <= b.timeout);
  }
  ok('V1 cost-xray no longer uses useStagger / tellStagger (B7 → AD15)', !/\buseStagger\b|\btellStagger\b/.test(S.xray));

  // ── V2 scan: fly only after every page landed and the scan is logged ───
  {
    const at = S.scan.indexOf('const onSave = useCallback(');
    const body = at >= 0 ? group(S.scan, S.scan.indexOf('(', at)) : '';
    const early = body.indexOf('if (done < total)');
    const earlyEnd = early >= 0 ? early + 'if (done < total) '.length + group(body, body.indexOf('{', early)).length : -1;
    const add = body.indexOf('addScan(');
    const fly = body.indexOf('fileInto(');
    const clear = body.indexOf('setCaptures([])', Math.max(0, earlyEnd));
    ok('V2 scan: fileInto( comes after the `done < total` early return', early >= 0 && fly > earlyEnd, `early=${early} end=${earlyEnd} fly=${fly}`);
    ok('V2 scan: fileInto( comes after addScan(', add >= 0 && fly > add, `addScan=${add} fly=${fly}`);
    ok('V2 scan: fileInto( comes before setCaptures([]) (the first one after the early return)', fly >= 0 && clear > fly, `fly=${fly} setCaptures=${clear}`);
    ok('V2 scan: fileInto is awaited (measured before the thumbs clear)', /await\s+fileInto\(/.test(body));
    ok('V2 scan: exactly one fileInto( call, none outside onSave', count(body, /\bfileInto\(/g) === 1 && count(S.scan, /\bfileInto\(/g) === 1);
    const savingOff = body.indexOf('setSaving(false)', earlyEnd);
    const saved = body.indexOf('setSaved(');
    ok('V2 scan: setSaving(false) and setSaved( come after the flight is planned (no second tap re-files)', savingOff > fly && saved > fly, `setSaving(false)=${savingOff} setSaved=${saved} fly=${fly}`);
    const guard = body.lastIndexOf('if (!arrival)', fly);
    ok('V2 scan: a delivery arrival never waits on the flight (fileInto sits under `if (!arrival)`)', guard >= 0 && fly - guard < 400 && guard > body.indexOf('const arrival ='));
    const fl = body.slice(fly, fly + group(body, body.indexOf('(', fly)).length + 9);
    ok('V2 scan: the sources are the capture thumbs and the target is the folder name', /sources:/.test(fl) && /target:\s*folderRef/.test(fl) && /thumbs:/.test(fl));
    ok('V2 scan: every capture thumb carries a ref', /<View key=\{c\.uri \+ i\} style=\{styles\.thumbWrap\} ref=\{\(el\) => \{ thumbEls\.current\[i\] = el; \}\}>/.test(S.scan));
    const target = openTag(S.scan, S.scan.indexOf('<Animated.View ref={folderRef}'));
    ok('V2 scan: the folder name is wrapped in an Animated.View with the ref and receiveStyle', /style=\{folderReceiveStyle\}/.test(target)
      && S.scan.indexOf('{scanFolderLabel(destination.folder)}') > S.scan.indexOf('<Animated.View ref={folderRef}'));
    ok('V2 scan: the flight layer renders exactly once (bound once, rendered once, while a confirm card or a filed result is up)', count(S.scan, /\bfileLayer\b/g) === 2 && /\{result \|\| saved \? fileLayer : null\}/.test(S.scan));
  }

  // ── V3 upload: fly only after the upload resolved and the list came back ─
  {
    const at = S.files.indexOf('const handleUpload = useCallback(');
    const body = at >= 0 ? group(S.files, S.files.indexOf('(', at)) : '';
    const tryAt = body.indexOf('try {');
    const tryBlock = tryAt >= 0 ? group(body, body.indexOf('{', tryAt)) : '';
    const catchAt = body.indexOf('catch (', tryAt);
    const rest = catchAt >= 0 ? body.slice(catchAt) : '';
    const up = tryBlock.indexOf('uploadProjectFile(');
    const refresh = tryBlock.indexOf('refreshFiles(');
    const fly = tryBlock.indexOf('fileInto(');
    ok('V3 files: fileInto( is inside the try block', fly >= 0);
    ok('V3 files: fileInto( comes after uploadProjectFile( and refreshFiles(', up >= 0 && refresh > up && fly > refresh, `upload=${up} refresh=${refresh} fly=${fly}`);
    ok('V3 files: refreshFiles( is awaited before the flight', /await\s+refreshFiles\(\)/.test(tryBlock.slice(0, Math.max(0, fly))));
    ok('V3 files: never in catch / finally', rest.length > 0 && !/\bfileInto\(/.test(rest));
    ok('V3 files: exactly one fileInto( call in the file', count(S.files, /\bfileInto\(/g) === 1);
    const fl = tryBlock.slice(fly);
    ok('V3 files: the source is the Upload button and the target the folder header', /sources:\s*\[uploadBtnRef\]/.test(fl) && /target:\s*folderHeaderRef/.test(fl));
    ok('V3 files: the Upload button carries the ref', /<TouchableOpacity\s+ref=\{uploadBtnRef\}/.test(S.files));
    const head = openTag(S.files, S.files.indexOf('<Animated.View ref={folderHeaderRef}'));
    ok('V3 files: the folder header is an Animated.View with the ref and receiveStyle', /folderReceiveStyle/.test(head)
      && S.files.indexOf('styles.folderTitle') > S.files.indexOf('<Animated.View ref={folderHeaderRef}'));
    ok('V3 files: the flight layer renders exactly once', count(S.files, /\bfileLayer\b/g) === 2 && count(S.files, /\{\s*fileLayer\s*\}/g) === 1);
  }

  // ── V4 the X-Ray amounts ────────────────────────────────────────────────
  {
    let mod: { xrayAccumulateCents?: (r: { id: string; route: string; band?: { expected: number } | null }[]) => { key: string; cents: number }[] } = {};
    try { mod = await import(pathToFileURL(pathOf(FILES.acc)).href); } catch (e) { ok('V4 utils/costXrayAccumulate.ts loads', false, String(e)); }
    const fn = mod.xrayAccumulateCents;
    ok('V4 xrayAccumulateCents is exported', typeof fn === 'function');
    if (typeof fn === 'function') {
      const got = fn([
        { id: 'a', route: 'price', band: { expected: 1234.5 } },
        { id: 'b', route: 'price', band: { expected: 99.99 } },
        { id: 'c', route: 'verify', band: { expected: 500 } },
      ]);
      const cents = got.map((g) => g.cents);
      const sum = cents.reduce((s, c) => s + c, 0);
      ok('V4 golden: 1 234.50 → 123 450 cents', cents[0] === 123450, String(cents[0]));
      ok('V4 golden: 99.99 → 9 999 cents (rounded, not the floating-point 9 998)', cents[1] === 9999, String(cents[1]));
      ok('V4 golden: a verify tell (band 500) → 0', cents[2] === 0, String(cents[2]));
      ok('V4 golden: the sum is 133 449', sum === 133449, String(sum));
      // 99.99 * 100 is exactly 9999 in IEEE doubles, so the spec's floor trap
      // needs amounts that really do land a hair under the cent.
      const trap = fn([
        { id: 'd', route: 'price', band: { expected: 19.99 } },
        { id: 'e', route: 'price', band: { expected: 0.29 } },
      ]).map((g) => g.cents);
      ok('V4 golden: 19.99 → 1 999 and 0.29 → 29 (19.99 * 100 is 1998.999…, 0.29 * 100 is 28.999…)', trap[0] === 1999 && trap[1] === 29, trap.join(','));
      ok('V4 keys follow the reviews, in order', got.map((g) => g.key).join() === 'a,b,c');
      ok('V4 every amount is an integer', cents.every(Number.isInteger));
      ok('V4 a priced tell with no band → 0 (never NaN)', fn([{ id: 'x', route: 'price' }])[0]?.cents === 0);
    }
    ok('V4 cost-xray passes effectiveBand(r) in (the allowance math lives once)', /xrayAccumulateCents\(\s*reviews\.map\(\(r\)\s*=>\s*\(\{\s*id:\s*r\.id,\s*route:\s*r\.route,\s*band:\s*effectiveBand\(r\)\s*\}\)\)\)/.test(S.xray));
    ok('V4 cost-xray does no cents math of its own (no * 100)', !/\*\s*100\b/.test(S.xray.replace(/\*\s*100\}%/g, '')));
    const acc = S.xray.indexOf('useAccumulate(');
    const args = acc >= 0 ? group(S.xray, S.xray.indexOf('(', acc)) : '';
    ok('V4 useAccumulate is armed by the live analysis (armed: reviewsLive)', /armed:\s*reviewsLive\b/.test(args));
    ok('V4 useAccumulate items carry the helper\'s cents', /cents:\s*xrayCents\[i\]\.cents/.test(args));
    const grid = S.xray.indexOf('<TileGrid preset="content"');
    const gridTag = openTag(S.xray, grid);
    const afterTag = S.xray.slice(grid + gridTag.length).trimStart();
    ok('V4 the cards go straight into the TileGrid (its first child is {xrayAcc.cards})', grid >= 0 && afterTag.startsWith('{xrayAcc.cards}'));
    const total = S.xray.indexOf('testID="xray-walk-priced-total"');
    ok('V4 the C1 total sits above the TileGrid', total >= 0 && total < grid);
    ok('V4 C1 copy and key', /t\('money\.costXray\.walkPricedTotal',\s*'Priced on your costs: \{amount\} expected'/.test(S.xray));
    ok('V4 the accepted-contingency readout is unchanged', S.xray.includes('{formatMoney(acceptedContingency)} contingency</Text>')
      && /accepted\.filter\(r => r\.route === 'price'\)\.reduce\(\(s, r\) => s \+ effectiveBand\(r\)\.expected, 0\)/.test(S.xray));
    ok('V4 the figure formats cents with the screen\'s formatMoney (cents / 100)', /formatMoney\(c \/ 100\)/.test(S.xray));
  }

  // ── V5 the Gantt Today rule ─────────────────────────────────────────────
  {
    const decl = /const todayPush = useFocusPush\(hScrollRef, \{([^}]*)\}\)/.exec(S.gantt);
    const o = decl?.[1] ?? '';
    ok("V5 useFocusPush(hScrollRef, { axis: 'x', ruleAxis: 'y', … })", /axis:\s*'x'/.test(o) && /ruleAxis:\s*'y'/.test(o));
    ok('V5 the inset keeps the old lead-in: todayX − 2·pxPerDay = (today − 3)·pxPerDay', /inset:\s*2 \* pxPerDay/.test(o) && /const todayX = \(todayDayNumber - 1\) \* pxPerDay;/.test(S.gantt));
    const at = S.gantt.indexOf('const scrollToToday = useCallback(');
    const body = at >= 0 ? group(S.gantt, S.gantt.indexOf('(', at)) : '';
    ok("V5 Today pushes through the kit: todayPush('today', { x: todayX, … h: gridHeight })", /todayPush\('today',\s*\{\s*x:\s*todayX,\s*y:\s*0,\s*w:\s*1\.5,\s*h:\s*gridHeight\s*\}\)/.test(body));
    ok('V5 scrollToToday has no raw scrollTo of its own', body.length > 0 && !/scrollTo\(/.test(body));
    ok("V5 the rule style is todayPush.styleFor('today')", /const todayRule = todayPush\.styleFor\('today'\);/.test(S.gantt));
    ok('V5 while it draws, the today line is an Animated.View carrying it (last, after the web layer)',
      /todayRule\s*\?\s*<Animated\.View style=\{\[styles\.todayLine, \{ left: todayX \}, isDesktopWeb && TODAY_LINE_WEB, todayRule\]\} \/>/.test(S.gantt));
    ok('V5 at rest it is the same plain View as before (nothing at rest changes)',
      /:\s*<View style=\{\[styles\.todayLine, \{ left: todayX \}, isDesktopWeb && TODAY_LINE_WEB\]\} \/>\}/.test(S.gantt));
    const h = S.gantt.indexOf('ref={hScrollRef}');
    const hTag = openTag(S.gantt, S.gantt.lastIndexOf('<ScrollView', h));
    ok('V5 the horizontal scroller reports onMomentumScrollEnd={todayPush.onScrollSettled}', /\bhorizontal\b/.test(hTag) && /onMomentumScrollEnd=\{todayPush\.onScrollSettled\}/.test(hTag));
    ok('V5 the row push (A5) stays as it was', /const push = useFocusPush\(vScrollRef, \{ axis: 'y', inset: 2 \* rowH \}\);/.test(S.gantt));
  }

  console.log('');
  if (failures > 0) {
    console.log(`✗ validate-motion-adopt-2: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('✓ validate-motion-adopt-2: scan, upload, X-Ray and the Gantt Today rule use the kit, after real writes, with exact cents');
}

void main();
