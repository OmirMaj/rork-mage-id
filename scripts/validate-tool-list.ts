// validate-tool-list.ts — "Plain trade": the tool / feature lists have ONE
// treatment, and a row can not bring a colour back.
//
// WHY THIS EXISTS (2026-10-05, founder pick: direction A + B's locked hatch).
// The lists of tools (Discover > Tools, the project page's tile groups and field
// action row, Home's Ask doors, the Create sheet, Discover's overview cards)
// each drew the same atom their own way: a pastel rounded square in a hue set
// by hand per row, an icon at 16-22 pt and five different strokes, and the
// bespoke MAGE glyphs' detail in brand green on top. That atom is the
// generated-app look. components/ui/toolList.tsx is now the one rule:
//
//   - no chip, no tint, no card around a row;
//   - one glyph: 24 pt, stroke 2, single ink (the bespoke MAGE glyphs' detail
//     included — ToolGlyph hands them the row's ink);
//   - a row can not choose a hue (NavRow's `tone` is accepted and ignored);
//   - green only on the ONE primary action and the pressed / active state,
//     and never as a background;
//   - locked = the diagonal hatch + muted glyph + the reason in words.
//
// This guard reads the SOURCE of those surfaces (comments blanked) and fails
// when any of that comes back. It is deliberately scoped to the tool lists:
// the `colour + '15'` chip still exists on ~90 other screens, which move over
// screen by screen — widen SURFACES as they do.
//
// PLANTED MUTATIONS: MUTATE=1..N edits file text IN MEMORY (nothing on disk
// changes) and the run must FAIL:
//   for i in $(seq 1 N); do MUTATE=$i bun run scripts/validate-tool-list.ts >/dev/null 2>&1 && echo "MUTATION $i SURVIVED"; done
// `MUTATE=list` prints them; `MUTATE=count` prints N.
//
// Pure node:fs. fileURLToPath + join because the repo path contains a space.
//
// Run via: bun run test:tool-list

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const KIT = 'components/ui/toolList.tsx';
const NAVROW = 'components/NavRow.tsx';
const TOOLS = 'app/(tabs)/discover/tools.tsx';
const SHEET = 'components/summary/ToolsSheet.tsx';
const CREATE = 'components/CreateMenu.tsx';
const PROJECT = 'app/project-detail.tsx';
const HOME = 'app/(tabs)/(home)/index.tsx';
const DISCOVER = 'app/(tabs)/discover/index.tsx';
const GLYPHS = 'components/icons/glyphs.tsx';
const AIMARK = 'components/icons/MageAIMark.tsx';

// ── planted mutations (in memory) ────────────────────────────────────────────
type Mutation = { name: string; file: string; from: string | RegExp; to: string };
const MUTATIONS: Mutation[] = [
  { name: 'the glyph size drifts off 24', file: KIT, from: 'export const TOOL_GLYPH_SIZE = 24;', to: 'export const TOOL_GLYPH_SIZE = 20;' },
  { name: 'the stroke drifts off 2', file: KIT, from: 'export const TOOL_GLYPH_STROKE = 2;', to: 'export const TOOL_GLYPH_STROKE = 1.75;' },
  { name: 'ToolGlyph hard-codes its own size', file: KIT, from: '<Icon size={TOOL_GLYPH_SIZE} color={ink}', to: '<Icon size={20} color={ink}' },
  { name: 'ToolGlyph drops the shared stroke', file: KIT, from: ' strokeWidth={TOOL_GLYPH_STROKE} {...toolGlyphInk(Icon, ink)} />', to: ' {...toolGlyphInk(Icon, ink)} />' },
  { name: 'the kit row gets a surface', file: KIT, from: "      paddingHorizontal: 2,\n      borderTopWidth: 1,", to: "      paddingHorizontal: 2,\n      backgroundColor: t.surface,\n      borderTopWidth: 1," },
  { name: 'the kit row becomes a rounded card', file: KIT, from: "      paddingHorizontal: 2,\n      borderTopWidth: 1,", to: "      paddingHorizontal: 2,\n      borderRadius: 12,\n      borderTopWidth: 1," },
  { name: 'the pressed row is washed green', file: KIT, from: 'rowPressed: { backgroundColor: t.surfaceAlt,', to: 'rowPressed: { backgroundColor: t.accentSoft,' },
  { name: 'the count is set in brand green', file: KIT, from: "      lineHeight: 22,\n      color: t.text,\n      fontVariant", to: "      lineHeight: 22,\n      color: t.accent,\n      fontVariant" },
  { name: 'the title-block rule goes green', file: KIT, from: "      borderTopWidth: 2,\n      borderTopColor: t.text,\n      paddingTop: 8,", to: "      borderTopWidth: 2,\n      borderTopColor: t.accent,\n      paddingTop: 8," },
  { name: 'the locked glyph loses its hatch', file: KIT, from: '      {locked ? (\n        <Svg width={HATCH_BOX}', to: '      {false ? (\n        <Svg width={HATCH_BOX}' },
  { name: 'the locked glyph stays full ink', file: KIT, from: 'const ink = locked ? colors.textMuted : (color ?? colors.text);', to: 'const ink = color ?? colors.text;' },
  { name: 'the kit tints a chip (+ \'15\')', file: KIT, from: 'const glyphBox: ViewStyle = { width: TOOL_GLYPH_SIZE,', to: "const glyphBox: ViewStyle = { backgroundColor: '#2F6B3A' + '15', width: TOOL_GLYPH_SIZE," },

  { name: 'NavRow reads `tone` again', file: NAVROW, from: "  badge,\n  locked = false,", to: "  badge,\n  tone = 'neutral',\n  locked = false," },
  { name: 'NavRow brings the tone → colour map back', file: NAVROW, from: 'function NavRowImpl({', to: 'function toneColor(t: ThemeColors) { return t.info; }\nfunction NavRowImpl({' },
  { name: 'NavRow draws its own icon chip', file: NAVROW, from: '<ToolGlyph Icon={Icon} locked={locked} color={pressed ? colors.accentLabel : undefined} />', to: "<View style={{ backgroundColor: colors.info + '15' }}><Icon size={20} color={colors.info} /></View>" },
  { name: 'NavRow glyph is green at rest', file: NAVROW, from: 'color={pressed ? colors.accentLabel : undefined} />', to: 'color={colors.accentLabel} />' },
  { name: 'NavRow name is green at rest', file: NAVROW, from: 'pressed && { color: colors.accentLabel }', to: '{ color: colors.accentLabel }' },
  { name: 'NavRow list row paints a surface', file: NAVROW, from: '    list: tool.row,', to: '    list: { ...tool.row, backgroundColor: t.surface },' },
  { name: 'NavRow badge becomes a tinted pill', file: NAVROW, from: "badge: { color: t.textSecondary, fontWeight: '700' as const },", to: "badge: { color: t.accent, backgroundColor: t.accentSoft, fontWeight: '700' as const }," },

  { name: 'a Tools row sets a tone', file: TOOLS, from: "title: 'Photo triage', subtitle: 'Tag, organize & file jobsite photos',", to: "title: 'Photo triage', subtitle: 'Tag, organize & file jobsite photos', tone: 'info'," },
  { name: 'a Tools row sets a colour', file: TOOLS, from: "title: 'Punch list', subtitle: 'Walk-through items + closeout',", to: "title: 'Punch list', subtitle: 'Walk-through items + closeout', color: Colors.success," },
  { name: 'Tools passes a tone to NavRow', file: TOOLS, from: '                  locked={!!tier}\n', to: "                  locked={!!tier}\n                  tone=\"accent\"\n" },
  { name: 'Tools styles a row per call', file: TOOLS, from: '                  locked={!!tier}\n', to: "                  locked={!!tier}\n                  style={{ backgroundColor: themeColors.accentSoft }}\n" },
  { name: 'Tools wraps its rows in a section card again', file: TOOLS, from: "    sectionWrap: {\n      marginTop: 22,", to: "    sectionCard: { backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line },\n    sectionWrap: {\n      marginTop: 22," },
  { name: 'Tools drops the title block', file: TOOLS, from: /<ToolGroupHeader index=\{String\(gi \+ 1\)\.padStart\(2, '0'\)\} label=\{section\} count=\{rows\.length\} \/>/, to: '<Text>{section}</Text>' },
  { name: 'a locked Tools row is not marked locked', file: TOOLS, from: '                  locked={!!tier}\n', to: '' },

  { name: 'ToolsSheet row sets a tone', file: SHEET, from: '                locked={!!locked}\n', to: "                locked={!!locked}\n                tone=\"warning\"\n" },
  { name: 'ToolsSheet locked row loses the hatch', file: SHEET, from: '                locked={!!locked}\n', to: '' },

  { name: 'Create menu chip comes back', file: CREATE, from: '<ToolGlyph Icon={opt.Icon} locked={!!lockedTier(opt)} />', to: '<View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: themeColors.surfaceAlt }}><opt.Icon size={18} color={themeColors.textSecondary} strokeWidth={2} /></View>' },
  { name: 'Create menu row glyph goes green', file: CREATE, from: '<ToolGlyph Icon={opt.Icon} locked={!!lockedTier(opt)} />', to: '<ToolGlyph Icon={opt.Icon} locked={!!lockedTier(opt)} color={themeColors.accent} />' },
  { name: 'Create menu locked row loses the hatch', file: CREATE, from: '<ToolGlyph Icon={opt.Icon} locked={!!lockedTier(opt)} />', to: '<ToolGlyph Icon={opt.Icon} />' },
  { name: 'Create menu gains a new green use', file: CREATE, from: "  rowDesc: toolListStyles(t).desc,", to: "  rowDesc: { ...toolListStyles(t).desc, color: t.accent }," },

  { name: 'a project tile gets its chip back', file: PROJECT, from: '<ToolGlyph Icon={TileIcon} locked={isLocked} />', to: "<View style={{ backgroundColor: themeColors.info + '15' }}><TileIcon size={20} color={themeColors.info} /></View>" },
  { name: 'a project tile glyph takes a hue', file: PROJECT, from: '<ToolGlyph Icon={TileIcon} locked={isLocked} />', to: '<ToolGlyph Icon={TileIcon} locked={isLocked} color={themeColors.success} />' },
  { name: 'a locked project tile loses the hatch', file: PROJECT, from: '<ToolGlyph Icon={TileIcon} locked={isLocked} />', to: '<ToolGlyph Icon={TileIcon} />' },
  { name: 'the Tile type carries a colour again', file: PROJECT, from: 'strokeWidth?: number }>; count: number | null };', to: 'strokeWidth?: number }>; color: string; count: number | null };' },
  { name: 'project tile row becomes a card again', file: PROJECT, from: 'sectionTile: { ...tool.row, ...tool.rowTight, minHeight: 44 },', to: 'sectionTile: { ...tool.row, ...tool.rowTight, minHeight: 44, backgroundColor: themeColors.surface, borderRadius: 12, borderWidth: 1 },' },
  { name: 'the hard-hat tap takes a group hue', file: PROJECT, from: 'hatColor={themeColors.text}', to: 'hatColor={themeColors.info}' },
  { name: 'a moved row glyph takes a hue', file: PROJECT, from: '<ToolGlyph Icon={r.Icon} locked={!!r.lock} />', to: '<ToolGlyph Icon={r.Icon} locked={!!r.lock} color={themeColors.success} />' },
  { name: 'every field action goes green', file: PROJECT, from: 'color={primary ? themeColors.accentLabel : undefined} />', to: 'color={themeColors.accentLabel} />' },
  { name: 'two field actions are primary', file: PROJECT, from: 'const primary = i === 0 && !a.lock;', to: 'const primary = i <= 1 && !a.lock;' },
  { name: 'a locked field action loses the hatch', file: PROJECT, from: '<ToolGlyph Icon={a.Icon} locked={!!a.lock}', to: '<ToolGlyph Icon={a.Icon}' },
  { name: 'the field action row tints a chip', file: PROJECT, from: '{primary ? <View style={styles.fieldActionPrimaryRule} /> : null}', to: "<View style={{ backgroundColor: themeColors.accent + '15' }} />" },
  { name: 'a quick action chip comes back', file: PROJECT, from: '<ToolGlyph Icon={Wallet} />', to: "<View style={[styles.quickActionIcon, { backgroundColor: themeColors.success + '15' }]}><Wallet size={18} color={themeColors.success} strokeWidth={1.75} /></View>" },
  { name: 'the group header gets its tinted icon back', file: PROJECT, from: '                        index={group.sheet}\n', to: "                        index={group.sheet}\n                        trailing={<View style={{ backgroundColor: themeColors.accent + '15' }} />}\n" },
  { name: 'the open-RFI line is drawn in brand green', file: PROJECT, from: 'color: themeColors.warningLabel, flexShrink: 1 },', to: 'color: themeColors.accent, flexShrink: 1 },' },
  { name: 'the desktop index row takes a hue', file: PROJECT, from: '<TileIcon size={16} color={themeColors.text} strokeWidth={TOOL_GLYPH_STROKE}', to: '<TileIcon size={16} color={themeColors.info} strokeWidth={TOOL_GLYPH_STROKE}' },

  { name: 'Ask MAGE is a green-washed card again', file: HOME, from: 'style={[styles.launcherRow, responsive.isDesktop && styles.launcherDesktop]}\n      >\n        <MageAIMark size={TOOL_GLYPH_SIZE} color={themeColors.text} accentColor={themeColors.accent} />\n        <View style={styles.launcherBody}>\n          <Text style={styles.launcherName} numberOfLines={1}>Ask MAGE anything', to: 'style={[styles.launcherRow, { backgroundColor: themeColors.accentSoft }, responsive.isDesktop && styles.launcherDesktop]}\n      >\n        <MageAIMark size={TOOL_GLYPH_SIZE} color={themeColors.text} accentColor={themeColors.accent} />\n        <View style={styles.launcherBody}>\n          <Text style={styles.launcherName} numberOfLines={1}>Ask MAGE anything' },
  { name: 'Ask MAGE gets a green border', file: HOME, from: '  launcherRow: toolListStyles(t).row,', to: '  launcherRow: { ...toolListStyles(t).row, borderWidth: 1, borderColor: t.accent },' },
  { name: 'the Ask mark is drawn all green', file: HOME, from: '<MageAIMark size={TOOL_GLYPH_SIZE} color={themeColors.text} accentColor={themeColors.accent} />', to: '<MageAIMark size={TOOL_GLYPH_SIZE} color={themeColors.accent} accentColor={themeColors.accent} />' },
  { name: 'the Ask chevron goes green', file: HOME, from: '<ChevronRight size={TOOL_CHEVRON_SIZE} color={themeColors.textMuted} strokeWidth={1.75} style={styles.launcherChevron} />', to: '<ChevronRight size={TOOL_CHEVRON_SIZE} color={themeColors.accent} strokeWidth={1.75} style={styles.launcherChevron} />' },
  { name: 'the Home search glyph goes green', file: HOME, from: '<Search size={TOOL_GLYPH_SIZE} color={themeColors.text}', to: '<Search size={TOOL_GLYPH_SIZE} color={themeColors.accent}' },
  { name: 'the Home bell gets its grey disc back', file: HOME, from: "  headerGlyphButton: {\n    width: 40,", to: "  headerGlyphButton: {\n    backgroundColor: t.surfaceAlt,\n    width: 40," },

  { name: 'a Discover card picks an icon colour', file: DISCOVER, from: '  icon: Icon,\n', to: '  icon: Icon,\n  iconColor,\n' },
  { name: 'a Discover card tints its icon', file: DISCOVER, from: '        <ToolGlyph Icon={Icon} />\n', to: "        <View style={{ backgroundColor: Colors.primary + '15' }}><Icon size={22} color={Colors.primary} /></View>\n" },
  { name: 'a Discover quick action chip comes back', file: DISCOVER, from: '<ToolGlyph Icon={UserCircle} />', to: "<View style={[styles.quickActionIcon, { backgroundColor: Colors.accent + '15' }]}><UserCircle size={16} color={Colors.accent} strokeWidth={1.75} /></View>" },

  { name: 'ToolGlyph stops inking the glyph detail', file: KIT, from: ' {...toolGlyphInk(Icon, ink)} />', to: ' />' },
  { name: 'toolGlyphInk hands back the brand', file: KIT, from: '? { accentColor: ink } : null;', to: "? { accentColor: '#2F6B3A' } : null;" },
  { name: 'the MAGE glyphs lose the single-ink flag', file: GLYPHS, from: 'return Object.assign(C, { acceptsAccent: true as const });', to: 'return C;' },
  { name: 'the AI mark loses the single-ink flag', file: AIMARK, from: 'export default Object.assign(MageAIMark, { acceptsAccent: true as const });', to: 'export default MageAIMark;' },
  { name: 'the desktop index glyph detail stays green', file: PROJECT, from: ' {...toolGlyphInk(TileIcon, themeColors.text)} />', to: ' />' },
];

const MUTATE_ARG = process.env.MUTATE || '';
if (MUTATE_ARG === 'list') {
  MUTATIONS.forEach((m, i) => console.log(`${i + 1}. ${m.name} (${m.file})`));
  process.exit(0);
}
if (MUTATE_ARG === 'count') { console.log(MUTATIONS.length); process.exit(0); }
const MUTATE = Number(MUTATE_ARG || 0);
const planted: Mutation | null = MUTATE ? MUTATIONS[MUTATE - 1] ?? null : null;
if (MUTATE && !planted) { console.error('unknown MUTATE'); process.exit(2); }

/** Blank comments, keeping offsets and line count. Strings are left alone. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  let quote: string | null = null;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += d ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}

const cache = new Map<string, string>();
/** Source with comments blanked (and the planted mutation applied). */
function read(rel: string): string {
  const hit = cache.get(rel);
  if (hit !== undefined) return hit;
  let text = readFileSync(join(ROOT, rel), 'utf8');
  if (planted && planted.file === rel) {
    const before = text;
    text = typeof planted.from === 'string'
      ? (text.includes(planted.from) ? text.replace(planted.from, planted.to) : text)
      : text.replace(planted.from, planted.to);
    if (text === before) { console.error(`MUTATE=${MUTATE}: anchor not found in ${rel}`); process.exit(3); }
  }
  // JSX text apostrophes (What's) would open a "string" and swallow the rest of
  // the file; these screens write them as &apos; or inside {'…'} already.
  const stripped = stripComments(text);
  cache.set(rel, stripped);
  return stripped;
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
/** Slice [from, to) by anchors; a missing anchor is itself a failure. */
function region(rel: string, from: string, to: string): string {
  const s = read(rel);
  const a = s.indexOf(from);
  const b = a < 0 ? -1 : s.indexOf(to, a + from.length);
  if (a < 0 || b < 0) { ok(`${rel}: region "${from.slice(0, 40)}…" found`, false, a < 0 ? 'start anchor missing' : 'end anchor missing'); return ''; }
  return s.slice(a, b);
}
const lines = (s: string) => s.split('\n');
/** An alpha-suffix tint: `something + '15'` (any two hex digits). */
const TINT = /\+\s*'[0-9A-Fa-f]{2}'/;
/** Any brand-green token. */
const GREEN = /\baccent(Soft|Label|Fill|Hot)?\b|Colors\.primary\b|#2F6B3A|#5DB36E|#388046/;
/** Any other hue a row could pick. */
const HUE = /\b(themeColors|colors|Colors|t|c)\.(success|info|warning|danger|error)\b(?!Label)/;
const greenLines = (s: string) => lines(s).filter(l => GREEN.test(l));
const show = (ls: string[]) => ls.slice(0, 4).map(l => l.trim().slice(0, 140)).join(' | ');

// ── 1. The kit: one size, one stroke, no surface, no hue ─────────────────────
console.log('components/ui/toolList.tsx — the rule');
{
  const k = read(KIT);
  ok('TOOL_GLYPH_SIZE is 24', /export const TOOL_GLYPH_SIZE = 24;/.test(k));
  ok('TOOL_GLYPH_STROKE is 2', /export const TOOL_GLYPH_STROKE = 2;/.test(k));
  ok('ToolGlyph draws at the shared size and stroke',
    /<Icon size=\{TOOL_GLYPH_SIZE\} color=\{ink\} strokeWidth=\{TOOL_GLYPH_STROKE\} \{\.\.\.toolGlyphInk\(Icon, ink\)\} \/>/.test(k));
  ok('…and the bespoke glyphs\' detail in the same ink (never a second colour)',
    /return \(Icon as \{ acceptsAccent\?: boolean \}\)\.acceptsAccent \? \{ accentColor: ink \} : null;/.test(k));
  ok('a locked glyph is hatched', /\{locked \? \(\s*<Svg width=\{HATCH_BOX\}/.test(k) && /<Path d=\{HATCH_D\} stroke=\{toolRule\(colors\)\}/.test(k));
  ok('a locked glyph drops to muted ink', /const ink = locked \? colors\.textMuted : \(color \?\? colors\.text\);/.test(k));
  ok('no alpha-suffix tint anywhere in the kit', !TINT.test(k), show(lines(k).filter(l => TINT.test(l))));
  const bgs = [...k.matchAll(/backgroundColor:\s*([^,}\n]+)/g)].map(m => m[1].trim());
  ok('the only fills are the pressed row (surfaceAlt) and the 2 pt primary rule (accent)',
    JSON.stringify(bgs) === JSON.stringify(['t.surfaceAlt', 't.accent']), `backgroundColor values: ${JSON.stringify(bgs)}`);
  ok('no radius, no card border on any kit style', !/borderRadius|borderWidth:/.test(k));
  const g = greenLines(k);
  // `accentColor` is the glyph-detail PROP name (set to the row's ink), not a green.
  const kitGreen = g.filter(l => !/accentColor/.test(l));
  ok('green appears once in the kit — the primary rule', kitGreen.length === 1 && /stripPrimaryRule:/.test(kitGreen[0]), show(kitGreen));
  ok('no other hue in the kit', !HUE.test(k), show(lines(k).filter(l => HUE.test(l))));
  ok('counts are set in the display face, in ink',
    /count: \{\s*fontFamily: DISPLAY_FONT\.semibold,\s*fontSize: Type\.subheadline\.fontSize,\s*lineHeight: 22,\s*color: t\.text,/.test(k));
  ok('the title block is a 2 pt ink rule', /header: \{[^}]*borderTopWidth: 2,\s*borderTopColor: t\.text,/.test(k));
  ok('the hairline is ink at 18% / 14%', /return t\.text \+ \(isDarkGround\(t\) \? '24' : '2E'\);/.test(k));
}

// ── 2. NavRow: the row can not choose a hue ──────────────────────────────────
console.log('\ncomponents/NavRow.tsx');
{
  const n = read(NAVROW);
  const impl = region(NAVROW, 'function NavRowImpl({', 'export const NavRow');
  ok('`tone` is not read by the row', !/\btone\b/.test(impl));
  ok('no tone → colour map', !/toneColor|function \w*[Tt]one\w*\(/.test(n));
  ok('the glyph is the kit glyph', /<ToolGlyph Icon=\{Icon\} locked=\{locked\} color=\{pressed \? colors\.accentLabel : undefined\} \/>/.test(impl));
  ok('no icon is drawn outside the kit glyph', !/<Icon\b/.test(impl));
  ok('no alpha-suffix tint', !TINT.test(n), show(lines(n).filter(l => TINT.test(l))));
  // From the implementation down: the exported NavRowTone union above it
  // still spells 'accent' so existing callers compile.
  const g = greenLines(n.slice(n.indexOf('function NavRowImpl({')));
  ok('green only while pressed', g.length > 0 && g.every(l => /pressed/.test(l)), show(g.filter(l => !/pressed/.test(l))));
  ok('no other hue', !HUE.test(n), show(lines(n).filter(l => HUE.test(l))));
  ok('the list row is the kit row, with no surface of its own', /\n\s*list: tool\.row,/.test(n));
  const bgs = [...n.matchAll(/backgroundColor:\s*([^,}\n]+)/g)].map(m => m[1].trim());
  ok('the only fills are the standalone card and its pressed state',
    JSON.stringify(bgs) === JSON.stringify(['t.surface', 't.surfaceAlt']), `backgroundColor values: ${JSON.stringify(bgs)}`);
  ok('a locked row prints its tier as the mono lock tag', /locked \? \(\s*<ToolLockTag label=\{meta\} \/>/.test(impl));
}

// ── 3. Discover > Tools ──────────────────────────────────────────────────────
console.log('\napp/(tabs)/discover/tools.tsx');
{
  const t = read(TOOLS);
  const rows = region(TOOLS, 'const TOOL_ROWS: ToolRow[] = [', '\n];');
  const n = (rows.match(/\btestID: 'tools-/g) ?? []).length;
  ok(`the table still has its rows (${n})`, n >= 50);
  ok('no row sets a tone', !/\btone\s*:/.test(t));
  ok('no row sets a colour', !/\bcolor\s*:/.test(rows) && !GREEN.test(rows) && !HUE.test(rows) && !/#[0-9A-Fa-f]{3,8}\b/.test(rows));
  const call = region(TOOLS, '<NavRow', '/>');
  ok('NavRow gets no tone and no per-call style', !/\btone=|\bstyle=/.test(call));
  ok('a tier-gated row is marked locked (hatch + tag)', /meta=\{tier\}\s*locked=\{!!tier\}/.test(call));
  ok('each section opens with a numbered title block',
    /<ToolGroupHeader index=\{String\(gi \+ 1\)\.padStart\(2, '0'\)\} label=\{section\} count=\{rows\.length\} \/>/.test(t));
  ok('no section card, no divider of its own', !/sectionCard|divider/.test(t));
  ok('no alpha-suffix tint', !TINT.test(t));
  const g = greenLines(t);
  ok('the only green is the empty-state mark', g.length === 1 && /<EmptyState|icon=\{<Wrench/.test(g[0]), show(g));
}

// ── 4. Summary's Tools sheet (same NavRow) ───────────────────────────────────
console.log('\ncomponents/summary/ToolsSheet.tsx');
{
  const call = region(SHEET, '<NavRow', '/>');
  ok('NavRow gets no tone and no per-call style', !/\btone=|\bstyle=/.test(call));
  ok('the locked lineup row is hatched', /locked=\{!!locked\}/.test(call));
}

// ── 5. Create sheet ──────────────────────────────────────────────────────────
console.log('\ncomponents/CreateMenu.tsx');
{
  const c = read(CREATE);
  ok('rows draw the kit glyph, hatched when the tier locks them', /<ToolGlyph Icon=\{opt\.Icon\} locked=\{!!lockedTier\(opt\)\} \/>/.test(c));
  ok('no icon chip style is left', !/iconSquare|tierChip/.test(c));
  ok('each group opens with a title block', /<ToolGroupHeader index=\{g\.label\.charAt\(0\)\.toUpperCase\(\)\} label=\{g\.label\} count=\{g\.items\.length\}/.test(c));
  ok('no alpha-suffix tint', !TINT.test(c));
  ok('no other hue', !HUE.test(c), show(lines(c).filter(l => HUE.test(l))));
  // Green in the Create sheet is the create-something-new doors only: "Add a
  // sub" (glyph + words), "New project" (glyph + words) and the "Change" link.
  const g = greenLines(c);
  const allowed = [
    /<Plus size=\{16\} color=\{themeColors\.accent\} strokeWidth=\{2\} \/>/,
    /<Text style=\{\[Type\.headline, \{ color: themeColors\.accent \}\]\}>Add a Sub<\/Text>/,
    /<ToolGlyph Icon=\{Plus\} color=\{themeColors\.accentLabel\} \/>/,
    /<Text style=\{\[Type\.headline, \{ color: themeColors\.accent \}\]\} numberOfLines=\{1\}>/,
    /jobBarAction: \{ color: t\.accent, fontWeight: '600' as const \},/,
  ];
  const stray = g.filter(l => !allowed.some(re => re.test(l)));
  ok('green is only the new-project / add-a-sub doors and the Change link', stray.length === 0 && g.length === allowed.length, `${g.length} green lines; stray: ${show(stray)}`);
  ok('green is never a background', !lines(c).some(l => /backgroundColor/.test(l) && GREEN.test(l)));
}

// ── 6. The project page ──────────────────────────────────────────────────────
console.log('\napp/project-detail.tsx');
{
  const p = read(PROJECT);
  ok('a Tile has no colour', /type Tile = \{ key: SectionKey; label: string; icon: React\.ComponentType<\{[^}]*\}>; count: number \| null \};/.test(p) && !/colorFor\(/.test(p));
  ok('a group has a sheet letter, not a colour',
    /\{ key: 'field', label: 'Field Ops', sheet: 'F', icon: \w+, tileKeys:/.test(p) && /\{ key: 'money', label: 'Money', sheet: 'M', icon: \w+, tileKeys:/.test(p)
    && /\{ key: 'docs', label: 'Documentation', sheet: 'D', icon: \w+, tileKeys:/.test(p) && /\{ key: 'people', label: 'People and Communication', sheet: 'P', icon: \w+, tileKeys:/.test(p));
  ok('no tinted quick-action / tile / group chip style is left', !/quickActionIcon|sectionTileIcon|tileGroupHeaderIcon|tileGroupBadge|sectionTileBadge/.test(p));

  const tiles = region(PROJECT, 'const renderTile = (tile: Tile) => {', '{!isDesktop && (\n        <Modal');
  ok('tiles draw the kit glyph, hatched when locked', /<ToolGlyph Icon=\{TileIcon\} locked=\{isLocked\} \/>/.test(tiles));
  ok('moved rows draw the kit glyph, hatched when locked', /<ToolGlyph Icon=\{r\.Icon\} locked=\{!!r\.lock\} \/>/.test(tiles));
  ok('a locked tile still prints its reason', /lockReason \? \(\s*<Text style=\{\[styles\.sectionTileStatus/.test(tiles));
  ok('the group header is the title block with its sheet letter', /<ToolGroupHeader\s+index=\{group\.sheet\}\s+label=\{group\.label\}/.test(tiles));
  ok('no icon is drawn outside the kit glyph in the tile groups', !/<(TileIcon|GroupIcon|r\.Icon)\b/.test(tiles));
  ok('no alpha-suffix tint in the tile groups', !TINT.test(tiles), show(lines(tiles).filter(l => TINT.test(l))));
  ok('no green in the tile groups', greenLines(tiles).length === 0, show(greenLines(tiles)));
  // STATUS_TONES[...] is the status WORD's state colour — that stays.
  const hues = lines(tiles).filter(l => HUE.test(l));
  ok('no row hue in the tile groups (status words keep STATUS_TONES)', hues.length === 0, show(hues));
  ok('the hard-hat tap is ink', /hatColor=\{themeColors\.text\}/.test(tiles));
  ok('the tile count is the kit count', /<Text style=\{styles\.sectionTileCount\}>\{tile\.count\}<\/Text>/.test(tiles) && /sectionTileCount: tool\.count,/.test(p));
  const tileStyle = (p.match(/\n\s*sectionTile: \{[^\n]*\},/) ?? [''])[0];
  ok('the tile row is the kit row — no card', /sectionTile: \{ \.\.\.tool\.row, \.\.\.tool\.rowTight, minHeight: 44 \},/.test(tileStyle) && !/backgroundColor|borderRadius|borderWidth/.test(tileStyle));
  ok('the open-RFI line is a state colour, not the brand', /tileGroupRfiLine: \{[^}]*color: themeColors\.warningLabel,/.test(p));

  const field = region(PROJECT, '<View style={styles.fieldActionRow} testID="project-field-actions">', '})() : null}');
  ok('field actions draw the kit glyph, hatched when locked', /<ToolGlyph Icon=\{a\.Icon\} locked=\{!!a\.lock\} color=\{primary \? themeColors\.accentLabel : undefined\} \/>/.test(field));
  ok('exactly one field action is primary (the first, when it is open)', /const primary = i === 0 && !a\.lock;/.test(field));
  ok('no alpha-suffix tint in the field row', !TINT.test(field));
  const fg = greenLines(field);
  ok('green in the field row only on the primary action', fg.length > 0 && fg.every(l => /\bprimary\b/.test(l)), show(fg.filter(l => !/\bprimary\b/.test(l))));
  ok('the field row is the kit strip — no card per button',
    /fieldActionRow: \{ \.\.\.tool\.strip,/.test(p) && /fieldActionBtn: \{ \.\.\.tool\.stripCell, minHeight: 72 \},/.test(p) && !/styles\.quickActionBtn, styles\.fieldActionBtn/.test(p));

  const quick = [...p.matchAll(/style=\{\[?styles\.quickActionBtn\b[\s\S]*?<\/TouchableOpacity>/g)].map(m => m[0]);
  ok(`every quick action draws the kit glyph (${quick.length})`, quick.length >= 13 && quick.every(q => /<ToolGlyph Icon=\{\w+\} \/>/.test(q)));
  ok('no quick action tints or colours its glyph', quick.every(q => !TINT.test(q) && !/<ToolGlyph[^>]*color=/.test(q)));

  const index = region(PROJECT, 'testID="project-section-index"', '</TileGrid>');
  ok('the desktop section index is single ink at the shared stroke',
    /<GroupIcon size=\{16\} color=\{themeColors\.textSecondary\} strokeWidth=\{TOOL_GLYPH_STROKE\} \{\.\.\.toolGlyphInk\(GroupIcon, themeColors\.textSecondary\)\} \/>/.test(index)
    && /<TileIcon size=\{16\} color=\{themeColors\.text\} strokeWidth=\{TOOL_GLYPH_STROKE\} \{\.\.\.toolGlyphInk\(TileIcon, themeColors\.text\)\} \/>/.test(index));
}

// ── 7. Home ──────────────────────────────────────────────────────────────────
console.log('\napp/(tabs)/(home)/index.tsx');
{
  const h = read(HOME);
  const ask = region(HOME, '    askMage: (', '    briefing: (');
  ok('Ask MAGE and the Copilot are plain rows', (ask.match(/style=\{\[styles\.launcherRow, responsive\.isDesktop && styles\.launcherDesktop\]\}/g) ?? []).length === 2);
  ok('neither door has a fill, a border or a tint', !/backgroundColor|borderColor|borderWidth|accentSoft/.test(ask) && !TINT.test(ask));
  const g = greenLines(ask);
  ok('the only green on the doors is the mark\'s spark',
    g.length === 2 && g.every(l => /<MageAIMark size=\{TOOL_GLYPH_SIZE\} color=\{themeColors\.text\} accentColor=\{themeColors\.accent\} \/>/.test(l)), show(g));
  ok('the launcher row is the kit row', /launcherRow: toolListStyles\(t\)\.row,/.test(h));
  ok('the Ask section opens with a title block', /<ToolGroupHeader index="AI" label="Ask" \/>/.test(h));
  ok('search and the bell are bare ink glyphs',
    /<Search size=\{TOOL_GLYPH_SIZE\} color=\{themeColors\.text\} strokeWidth=\{TOOL_GLYPH_STROKE\} \/>/.test(h)
    && /<Bell size=\{TOOL_GLYPH_SIZE\} color=\{themeColors\.text\} strokeWidth=\{TOOL_GLYPH_STROKE\} \/>/.test(h));
  const btn = (h.match(/\n\s*headerGlyphButton: \{[\s\S]*?\n\s*\},/) ?? [''])[0];
  ok('the header glyph button has no disc behind it', btn.length > 0 && !/backgroundColor|borderRadius/.test(btn));
}

// ── 8. Discover overview ─────────────────────────────────────────────────────
console.log('\napp/(tabs)/discover/index.tsx');
{
  const d = read(DISCOVER);
  ok('a navigation card can not pick an icon colour', !/\biconColor\b|\biconBg\b/.test(d));
  ok('cards and quick actions draw the kit glyph', /<ToolGlyph Icon=\{Icon\} \/>/.test(d) && (d.match(/<ToolGlyph Icon=\{\w+\} \/>/g) ?? []).length >= 4);
  ok('no icon chip style is left', !/quickActionIcon|navIconWrap/.test(d));
}

// ── 9. The bespoke glyphs can be inked ───────────────────────────────────────
console.log('\ncomponents/icons');
{
  const g = read(GLYPHS);
  ok('every MAGE glyph carries the single-ink flag', /return Object\.assign\(C, \{ acceptsAccent: true as const \}\);/.test(g));
  ok('a glyph\'s detail is whatever accentColor it is handed', /a: accentColor,/.test(g));
  const a = read(AIMARK);
  ok('the AI mark carries the flag too', /export default Object\.assign\(MageAIMark, \{ acceptsAccent: true as const \}\);/.test(a));
}

console.log(`\n${pass} passed, ${fail} failed${planted ? `  [MUTATE=${MUTATE}: ${planted.name}]` : ''}`);
if (fail > 0) process.exit(1);
