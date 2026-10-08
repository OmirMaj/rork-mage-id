// scripts/validate-copy-voice.ts — the copy-voice ratchet (docs/VOICE.md).
//
// The founder: "throughout the entire app there's a lot of vibe coded wording,
// lower case wording, things like that that clearly show this app is vibe
// coded". The copy pass fixed what it could reach; this guard keeps every
// file's count of each tell from GROWING. It never fails on a count at or
// below the committed baseline, so a lane that fixes strings only ever lowers
// it (run with --write-baseline to record the lower number).
//
// SCOPE: .ts/.tsx under app/, components/, hooks/, contexts/ (skips
// __tests__, *.d.ts, app/dev-*.tsx). Files are parsed with the TypeScript
// compiler (parse only, no type check), so comments are never read as copy
// and every hit carries an exact file:line.
//
// USER-FACING POSITIONS (rules R01-R08, R10, R12-R19 read only these):
//   (a) JSX text children, plus string literals written directly as a JSX
//       child ({'…'} or {cond ? '…' : '…'});
//   (b) string / template values of the props in PROP_NAMES, and the values
//       of the object-literal keys in OBJECT_KEYS;
//   (c) the first two string arguments of showAlert / Alert.alert /
//       confirmAsync / showConfirm, and the first argument of nailIt / oops /
//       toast / setError, and of the message setters in MESSAGE_SETTERS
//       (setSessionExpiredReason, recordDidForYou).
//   A '+' concatenation in any of these positions is read as one sentence:
//   its literal operands joined, every other operand standing in as "0".
//   A template literal is tested on its literal parts, each ${…} standing in
//   as "0". AI prompt text is not UI: a template literal that contains
//   "You are " and any initializer bound to a name matching
//   /prompt|instruction|schema/i are skipped, as are `description:` values
//   inside a JSON-schema object (one with a schema `type:`).
// LINE RULES (R09, R11) read every line after comments and prompt bodies are
// blanked.
//
// THE COPY STYLE (docs/VOICE.md §3 and §4, founder decision 2026-10-05):
// Title Case on every label, sentences stay sentences, no dash used as
// punctuation, "and" not "&", no "e.g.", no arrows, never "unlimited".
// Rules R15 and R20-R23 are STRICT: they are not ratcheted, they must be zero,
// and they are enforced on the files in scripts/copy-style-converted.json —
// the list of files already converted. That list may only GROW: its length is
// pinned by CONVERTED_PINNED below, so dropping a file means editing this
// script in the same change. R24 ("unlimited") is strict in EVERY file under
// app/, components/, hooks/, contexts/, utils/ and constants/.
// Strict rules read more than the ratchet does: R20-R24 read every string
// literal, template and JSX text in the file (console.* arguments, imports
// and AI prompt text excepted), and R15 also reads the English inside
// t('key', 'English') and the `text:` of an alert button.
//
// Modes:
//   (default)                      fail when any file/rule count is above the baseline
//   --write-baseline               rewrite the baseline; refuses a raise unless
//   --allow-raise "<reason>"       …is also passed (recorded under "raises")
//   --report                       per-rule totals + the 20 worst files, exit 0
//   --extra <dir>                  also scan <dir> as if in scope, baseline 0
//   --hits [a,b]                   list every hit (in files whose path contains a or b), exit 0
//   --fix-labels                   rewrite every R15 hit in a converted file to titleCase(), then exit 0
//   --strict-preview <a,b>         list the strict hits files matching a or b WOULD have, exit 0
//   --dump <a,b>                   print every string read in files matching a or b (position, text), exit 0
//
// Pure node:fs + the typescript parser — no bundler, no react-native import
// (those crash bun). fileURLToPath + join because the repo path contains a
// space. Run: bun run scripts/validate-copy-voice.ts

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, isAbsolute, resolve } from 'node:path';
import ts from 'typescript';
import { titleCase, isTitleCase, isSentenceTitle, sentenceTitleProblem } from './copy-title-case';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'copy-voice-baseline.json');
const ALLOWLIST_PATH = join(ROOT, 'scripts', 'copy-voice-allowlist.json');
const CONVERTED_PATH = join(ROOT, 'scripts', 'copy-style-converted.json');
const SCOPE_DIRS = ['app', 'components', 'hooks', 'contexts'];
/** Also read, for R24 only (and for the strict rules when a file is on the converted list). */
const STRICT_ONLY_DIRS = ['utils', 'constants'];

/**
 * The number of files on scripts/copy-style-converted.json. The list may only
 * grow: a lane that converts more files adds them and raises this number in
 * the same change. A shorter list, or a list this number does not match, fails.
 */
const CONVERTED_PINNED = 869;

type RuleId =
  | 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06' | 'R07' | 'R08' | 'R09' | 'R10'
  | 'R11' | 'R12' | 'R13' | 'R14' | 'R15' | 'R16' | 'R17' | 'R18' | 'R19'
  | 'R20' | 'R21' | 'R22' | 'R23' | 'R24';

const RULE_NAMES: Record<RuleId, string> = {
  R01: 'dots',
  R02: 'plural-s',
  R03: 'exclaim',
  R04: 'emoji',
  R05: 'banned-tone',
  R06: 'meta-honesty',
  R07: 'dev-speak',
  R08: 'please',
  R09: 'raw-exception',
  R10: 'caps',
  R11: 'humanize',
  R12: 'gendered',
  R13: 'toast-shape',
  R14: 'job',
  R15: 'label-case',
  R16: 'lowercase',
  R17: 'dashes',
  R18: 'first-person',
  R19: 'homeowner',
  R20: 'prose-dash',
  R21: 'ampersand',
  R22: 'eg-ie',
  R23: 'arrow',
  R24: 'unlimited',
};
const ALL_RULES = Object.keys(RULE_NAMES) as RuleId[];
/** Zero-tolerance rules of the copy style. Never in the baseline. */
const STRICT_RULES: readonly RuleId[] = ['R15', 'R20', 'R21', 'R22', 'R23', 'R24'];
/** Strict in every scanned file, converted or not. */
const GLOBAL_STRICT: readonly RuleId[] = ['R24'];
const RATCHET_RULES = ALL_RULES.filter((r) => !STRICT_RULES.includes(r));

// ── Positions ────────────────────────────────────────────────────────────────

/** Where a user-facing string was found. `label` positions feed R15 / R16. */
type Kind =
  | 'jsx' // JSX text child
  | 'prop' // a listed JSX prop
  | 'key' // a listed object-literal key
  | 'alertTitle' // first arg of an alert / confirm
  | 'alertBody' // second arg of an alert / confirm
  | 'toast' // first arg of nailIt / oops / toast
  | 'error' // first arg of setError
  | 'raw'; // any other string in the file (strict rules R20-R24 only)

type Str = {
  text: string; // literal parts, each ${…} as "0"; JSX text whitespace-collapsed
  line: number;
  kind: Kind;
  name: string; // prop / key / callee name ('' for JSX text)
  leadingJsx: boolean; // JSX text that starts its element (no sibling before it)
  strictOnly?: boolean; // read by the strict rules only (keeps the ratchet's counts where they were)
  styleNames?: string[]; // JSX text: the style keys and tag name of its element
  inButton?: boolean; // JSX text inside a Touchable / Pressable / Button
  span?: [number, number]; // source range that --fix-labels may rewrite (simple literals only)
};

const PROP_NAMES = new Set([
  'title', 'label', 'placeholder', 'accessibilityLabel', 'accessibilityHint', 'eyebrow',
  'headline', 'subtitle', 'emptyTitle', 'emptyBody', 'confirmLabel', 'actionLabel',
  'buttonLabel', 'ctaLabel', 'hint', 'caption', 'badge', 'message',
]);
const OBJECT_KEYS = new Set([
  'label', 'title', 'subtitle', 'description', 'placeholder', 'headline', 'eyebrow',
  'emptyTitle', 'body',
]);
/** Props / keys that are a LABEL (R15 title case, R16 lowercase). */
const LABEL_NAMES = new Set([
  'title', 'label', 'eyebrow', 'headline', 'emptyTitle', 'confirmLabel', 'actionLabel',
  'buttonLabel', 'ctaLabel', 'badge',
]);
/** Strict-only label props / keys (R15). */
const STRICT_LABEL_NAMES = new Set(['text', 'tabBarLabel', 'headerTitle', 'sectionTitle', 'cta', 'buttonText', 'secondaryLabel']);
/** VoiceOver says the label a sighted user reads: a short name is Title Case too. A
 *  label with a comma, a colon or a period in it is a description and is left alone. */
const A11Y_LABEL_NAMES = new Set(['accessibilityLabel', 'tabBarAccessibilityLabel']);
/** A constant whose values are labels: KIND_LABEL, SECTION_LABEL, USER_ROLE_LABELS, FEATURE_TITLE. */
const LABEL_MAP_NAME = /(?:LABELS?|TITLES?)$/;
const ALERT_CALLEES = new Set(['showAlert', 'confirmAsync', 'showConfirm']);
const ONE_ARG_CALLEES = new Set(['nailIt', 'oops', 'toast', 'setError']);
/** Setters whose first argument is a sentence the user reads (scanned as 'error'). */
const MESSAGE_SETTERS = new Set(['setSessionExpiredReason', 'recordDidForYou']);
const PROMPT_NAME = /prompt|instruction|schema/i;
const SCHEMA_TYPES = new Set([
  'object', 'string', 'array', 'number', 'boolean', 'integer',
  'OBJECT', 'STRING', 'ARRAY', 'NUMBER', 'BOOLEAN', 'INTEGER',
]);

// ── Allowlist ────────────────────────────────────────────────────────────────

type AllowEntry = { file: string; rule: RuleId; match: string; reason: string };
type Allowlist = { globalTokens: string[]; properNouns: string[]; entries: AllowEntry[] };

const DEFAULT_ALLOWLIST: Allowlist = { globalTokens: [], properNouns: [], entries: [] };

function loadAllowlist(): Allowlist {
  if (!existsSync(ALLOWLIST_PATH)) return DEFAULT_ALLOWLIST;
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as Partial<Allowlist>;
  return {
    globalTokens: raw.globalTokens ?? [],
    properNouns: raw.properNouns ?? [],
    entries: raw.entries ?? [],
  };
}

// ── Rules on one user-facing string ─────────────────────────────────────────

const RE = {
  R02: /\w\(s\)/,
  R03: /[A-Za-z0-9)\]'"]!(\s|$)/,
  R04: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
  R05: /\b(?:Oops|Whoops|Uh oh|Yay|Boom|Nailed it|Awesome|Magic(?:al)?|Let's|Let’s|Coming soon|coming soon|seamless(?:ly)?|effortless(?:ly)?|supercharge|[Uu]nlock(?:s|ed)?|dive in|level up|game-?changer|powerful|robust|we've got you|all-in-one|Simply|Easily|Click here)\b|\bNote:/,
  R06: /\b(?:honest(?:ly)?|real data|no fake data|never guess|will not invent|won't invent|made-up|not a guess)\b/i,
  R07a: /\b(?:seat|seats|tenant|payload|re?hydrat\w*|schema|sync ledger|sync queue|offline queue|edge function|sample guard|null|undefined)\b/i,
  R07b: /\b(?:RLS|NaN|PGRST\d+|42501)\b/,
  R07c: /\b[a-z]+_[a-z_]+\b/,
  R08: /\bplease\b/i,
  R09: /instanceof Error \? \w+\.message|\.message\s*(\?\?|\|\|)\s*['"`]|\(\w+ as Error\)\.message/,
  R09call: /showAlert|Alert\.alert|setError|nailIt|oops|toast|<Text/,
  R11: /\.replace\(\/_\/g,\s*['"` ]+\)|charAt\(0\)\.toUpperCase\(\)\s*\+|\.split\(['"`]_['"`]\)\.join\(['"`] ['"`]\)/,
  R12: /\b(?:he|him|his|she|her|hers|himself|herself)\b/i,
  R14: /\b(?:this job(?!s| hazard)(?:'s|’s)?|on this job|your jobs|the job's|the job’s)\b/i,
  R17: /—[^—]*—/,
  R18: /\bI (?:can|will|think|found)\b|\bI['’](?:m|ll)\b/,
  R19: /\b[Hh]omeowner/,
  // Strict (copy style).
  R20dash: /[—–]/,
  R20spaced: /[A-Za-z0-9)”"'’.] - [A-Za-z(“"'‘]/,
  R21: /&/,
  R21fixed: /\b[A-Z]&[A-Z]\b|&(?:nbsp|apos|quot|lt|gt|middot|bull|#\d+);/g,
  R22: /\b(?:e\.g\.|i\.e\.)/i,
  R23: /[→←⇒⇐➔➜➝➞]|(?:^|\s)(?:->|=>|<-)(?:\s|$)/,
  R24: /\bunlimited\b/i,
};

// ── The label test (R15) ─────────────────────────────────────────────────────

/** A string that opens like this is a sentence, not a label. */
const SENTENCE_START = /^(?:You|You['’](?:re|ve|ll|d)|This|It|It['’]s|We|We['’](?:re|ve|ll)|There|That['’]s|I['’](?:m|ll|ve))\b/;
/** Style keys that mark a sentence or a value, whatever else the key says. */
const NOT_LABEL_STYLE = /sub|hint|help|caption|desc|body|note|lede|meta|detail|message|msg|copy|blurb|value|foot|fine|legal|error|para|info|price|amount|count|stat|empty(?!title)|placeholder|step|quote|lead|line|bullet|item|feature|reason|answer|result|summary|notice|banner|toast|disclaimer/i;
/** Style keys / tag names that mark a label. */
const LABEL_STYLE = /title|label|header|heading|headline|eyebrow|btn|button|cta|tab|chip|badge|pill|tag|kicker|link|action|section/i;

const LABEL_STYLE_END = /(?:Title|Label|Header|Heading|Headline|Eyebrow|Btn|Button|Cta|CTA|Chip|Badge|Pill|Kicker)$/;

function styleSaysLabel(names: string[] | undefined): boolean | null {
  if (!names || names.length === 0) return null;
  const cleaned = names.map((n) => n.replace(/(?:Text|Txt)$/, ''));
  // The LAST word of a style key decides first: stripeBannerTitle and stepLabel are labels,
  // whatever "banner" or "step" would say. A subtitle is still a sentence.
  if (cleaned.some((n) => LABEL_STYLE_END.test(n) && !/sub-?(?:title|head|heading|label)$/i.test(n))) return true;
  if (cleaned.some((n) => NOT_LABEL_STYLE.test(n))) return false;
  if (cleaned.some((n) => LABEL_STYLE.test(n))) return true;
  return null;
}

function isStrictLabel(str: Str): boolean {
  if (str.kind === 'alertTitle') return true;
  if (str.kind === 'prop' || str.kind === 'key') {
    if (A11Y_LABEL_NAMES.has(str.name)) return !/[,:.]/.test(str.text);
    return LABEL_NAMES.has(str.name) || STRICT_LABEL_NAMES.has(str.name);
  }
  if (str.kind === 'jsx') {
    if (!str.leadingJsx) return false;
    const byStyle = styleSaysLabel(str.styleNames);
    if (byStyle !== null) return byStyle;
    return !!str.inButton;
  }
  return false;
}

/** The fault in a sentence alert title, or null. Names on the allow-list keep their capitals. */
function sentenceTitleIssue(t: string, ctx: Ctx): string | null {
  // A multi-word name (Home Passport, Schedule Pro) is blanked to one fixed token first.
  const blanked = ctx.nounRe ? t.replace(ctx.nounRe, 'N0') : t;
  return sentenceTitleProblem(blanked, (w) => ctx.nounWords.has(w));
}

/** R15: a label of two to eight words, with no number in it, must be in Title Case. */
function breaksLabelCase(str: Str, ctx: Ctx): boolean {
  if (!isStrictLabel(str)) return false;
  const t = str.text.trim();
  // An alert title that is a full sentence or a question is written as one (VOICE.md §3):
  // sentence case and closing punctuation. Anything else is a label and falls through.
  if (str.kind === 'alertTitle' && wordCount(t) >= 2 && isSentenceTitle(t)) return sentenceTitleIssue(t, ctx) !== null;
  const n = wordCount(t);
  if (n < 2 || n > (str.kind === 'jsx' ? 6 : 8)) return false;
  // Data, or a value the app fills in. A digit INSIDE a name (G702/G703) is not a number.
  if (/(?:^|[\s$#(+~-])\d/.test(t) || /[{}]/.test(t)) return false;
  if (/[.?!:…,;]$/.test(t)) return false; // a sentence, a question, a lead-in, work in progress
  if (SENTENCE_START.test(t)) return false;
  return !isTitleCase(t);
}

/** The strict rules a string breaks. R15 needs a position; R20-R24 read every string. */
function strictRules(str: Str, ctx: Ctx): RuleId[] {
  const s = str.text;
  const out: RuleId[] = [];
  if (RE.R24.test(s)) out.push('R24');
  if (str.kind !== 'raw' && breaksLabelCase(str, ctx)) out.push('R15');
  const prose = /[A-Za-z]/.test(s) && /\s/.test(s.trim());
  // A lone "—" is an empty cell; an en dash between two numbers is a range.
  if (/[A-Za-z]/.test(s) && RE.R20dash.test(s.replace(/\d\s?–\s?\$?\d/g, '0'))) out.push('R20');
  else if (prose && RE.R20spaced.test(s)) out.push('R20');
  if (prose && RE.R21.test(s.replace(RE.R21fixed, ''))) out.push('R21');
  if (prose && RE.R22.test(s)) out.push('R22');
  if (prose && RE.R23.test(s)) out.push('R23');
  return out;
}

const WEEKDAYS_MONTHS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type Ctx = { allow: Allowlist; tokenRe: RegExp | null; nounRe: RegExp | null; nounWords: Set<string> };

function makeCtx(allow: Allowlist): Ctx {
  const byLen = (a: string, b: string) => b.length - a.length;
  const toks = [...allow.globalTokens].sort(byLen).map(escapeRe);
  const multi = [...allow.properNouns].filter((n) => /\s/.test(n)).sort(byLen).map(escapeRe);
  const words = new Set<string>([
    ...allow.properNouns.filter((n) => !/\s/.test(n)),
    ...allow.globalTokens.filter((n) => !/\s/.test(n)),
    ...WEEKDAYS_MONTHS,
  ]);
  return {
    allow,
    tokenRe: toks.length ? new RegExp(`(?<![A-Za-z0-9])(?:${toks.join('|')})(?![A-Za-z0-9])`, 'g') : null,
    nounRe: multi.length ? new RegExp(`(?<![A-Za-z0-9])(?:${multi.join('|')})(?![A-Za-z0-9])`, 'g') : null,
    nounWords: words,
  };
}

function isCapsString(s: string, ctx: Ctx): boolean {
  const t = s.trim();
  if (!/^[A-Z0-9][A-Z0-9 ·&'’/+\-,.:?]{3,}$/.test(t)) return false;
  const stripped = (ctx.tokenRe ? t.replace(ctx.tokenRe, ' ') : t).trim();
  if (!stripped) return false;
  const words = stripped.split(/\s+/).filter((w) => /[A-Z0-9]/.test(w));
  const hasRun = /[A-Z]{3,}/.test(stripped);
  if (words.length >= 2 && hasRun) return true;
  return words.length === 1 && /^[^A-Z]*[A-Z]{6,}/.test(words[0]) && (words[0].match(/[A-Z]/g) ?? []).length >= 6;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
}

function isLabelPosition(str: Str): boolean {
  if (str.kind === 'alertTitle') return true;
  if (str.kind === 'prop' || str.kind === 'key') return LABEL_NAMES.has(str.name);
  if (str.kind === 'jsx') {
    const n = wordCount(str.text);
    return str.leadingJsx && n >= 2 && n <= 6;
  }
  return false;
}

/** Every rule a user-facing string breaks (each rule at most once). */
function stringRules(str: Str, ctx: Ctx): RuleId[] {
  const s = str.text;
  const out: RuleId[] = [];
  if (str.strictOnly || str.kind === 'raw') return out;
  if (s.includes('...') || (str.name === 'placeholder' && /…\s*$/.test(s))) out.push('R01');
  if (RE.R02.test(s)) out.push('R02');
  if (RE.R03.test(s)) out.push('R03');
  if (RE.R04.test(s)) out.push('R04');
  if (RE.R05.test(s)) out.push('R05');
  if (RE.R06.test(s)) out.push('R06');
  if (RE.R07a.test(s) || RE.R07b.test(s) || RE.R07c.test(s)) out.push('R07');
  if (RE.R08.test(s)) out.push('R08');
  if (isCapsString(s, ctx)) out.push('R10');
  if (RE.R12.test(s)) out.push('R12');
  if (str.kind === 'toast') {
    const t = s.trim();
    if (t.includes('—') || (t.endsWith('.') && !t.includes('. '))) out.push('R13');
  }
  if (RE.R14.test(s)) out.push('R14');
  if (isLabelPosition(str)) {
    const t = s.trim();
    if (/^[a-z]/.test(t) && !/^i[A-Z]/.test(t) && (t.match(/[A-Za-z]{2,}/g) ?? []).length >= 2) out.push('R16');
  }
  if (RE.R17.test(s)) out.push('R17');
  if (RE.R18.test(s)) out.push('R18');
  if (RE.R19.test(s)) out.push('R19');
  return out;
}

function lineRules(line: string): RuleId[] {
  const out: RuleId[] = [];
  if (RE.R09.test(line) && RE.R09call.test(line)) out.push('R09');
  if (RE.R11.test(line)) out.push('R11');
  return out;
}

// ── Extraction ───────────────────────────────────────────────────────────────

function nameOf(n: ts.PropertyName | ts.BindingName | ts.Expression | undefined): string {
  if (!n) return '';
  if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) return n.text;
  if (ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  return '';
}

function templateText(n: ts.TemplateExpression): string {
  let s = n.head.text;
  for (const span of n.templateSpans) s += '0' + span.literal.text;
  return s;
}

/** The string values an expression can evaluate to, as written in source. */
type Lit = { text: string; node: ts.Node; viaT?: boolean };
function literalValues(e: ts.Expression | undefined): Lit[] {
  if (!e) return [];
  if (isPromptTemplate(e)) return []; // AI prompt text is not UI, wherever it sits
  // t('key', 'English'): the English is what an English reader sees (strict rules only).
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 't' && e.arguments.length >= 2) {
    const en = e.arguments[1];
    if (ts.isStringLiteral(en) || ts.isNoSubstitutionTemplateLiteral(en)) return [{ text: en.text, node: en, viaT: true }];
    return [];
  }
  if (ts.isParenthesizedExpression(e)) return literalValues(e.expression);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [{ text: e.text, node: e }];
  if (ts.isTemplateExpression(e)) return [{ text: templateText(e), node: e }];
  if (ts.isConditionalExpression(e)) return [...literalValues(e.whenTrue), ...literalValues(e.whenFalse)];
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return [...literalValues(e.left), ...literalValues(e.right)];
    }
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return literalValues(e.right);
    if (op === ts.SyntaxKind.PlusToken) return concatValues(e);
  }
  if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) return literalValues(e.expression);
  return [];
}

/**
 * A '+' concatenation read as ONE sentence: literal operands keep their text,
 * any other operand stands in as "0" (like a ${…}). A concatenation with no
 * literal operand is arithmetic or an opaque join and yields nothing; an
 * operand that is itself a ternary / fallback adds its own literals too.
 */
function concatValues(e: ts.BinaryExpression): Lit[] {
  const parts: ts.Expression[] = [];
  const flat = (x: ts.Expression): void => {
    if (ts.isParenthesizedExpression(x) && ts.isBinaryExpression(x.expression) && x.expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      flat(x.expression);
    } else if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      flat(x.left);
      flat(x.right);
    } else parts.push(x);
  };
  flat(e);
  let text = '';
  let literal = false;
  const extra: Lit[] = [];
  for (const p of parts) {
    if (isPromptTemplate(p)) return [];
    if (ts.isStringLiteral(p) || ts.isNoSubstitutionTemplateLiteral(p)) { text += p.text; literal = true; }
    else if (ts.isTemplateExpression(p)) { text += templateText(p); literal = true; }
    else {
      text += '0';
      if (!ts.isIdentifier(p) && !ts.isPropertyAccessExpression(p) && !ts.isCallExpression(p)) extra.push(...literalValues(p));
    }
  }
  return literal ? [{ text, node: e }, ...extra] : extra;
}

function isPromptTemplate(n: ts.Node): boolean {
  if (ts.isNoSubstitutionTemplateLiteral(n)) return n.text.includes('You are ');
  if (ts.isTemplateExpression(n)) {
    if (n.head.text.includes('You are ')) return true;
    return n.templateSpans.some((s) => s.literal.text.includes('You are '));
  }
  return false;
}

/** A prompt/schema initializer: its whole subtree is not UI. */
function isPromptBinding(n: ts.Node): boolean {
  if (ts.isVariableDeclaration(n)) return !!n.initializer && PROMPT_NAME.test(nameOf(n.name));
  if (ts.isPropertyAssignment(n)) return PROMPT_NAME.test(nameOf(n.name));
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return PROMPT_NAME.test(nameOf(n.left));
  }
  return false;
}

function isSchemaObject(o: ts.ObjectLiteralExpression): boolean {
  for (const p of o.properties) {
    if (!ts.isPropertyAssignment(p) || nameOf(p.name) !== 'type') continue;
    const v = p.initializer;
    if ((ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) && SCHEMA_TYPES.has(v.text)) return true;
    if (ts.isPropertyAccessExpression(v) && SCHEMA_TYPES.has(v.name.text)) return true;
  }
  return false;
}

type FileScan = { strings: Str[]; lines: string[] };

function extract(fileName: string, text: string): FileScan {
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const strings: Str[] = [];
  const blank: [number, number][] = [];

  const claimed = new Set<ts.Node>();
  const simpleSpan = (node: ts.Node): [number, number] | undefined =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? [node.getStart(sf) + 1, node.end - 1] : undefined;
  const push = (v: Lit | string, node: ts.Node, kind: Kind, name: string, leadingJsx = false, more: Partial<Str> = {}) => {
    const text = typeof v === 'string' ? v : v.text;
    claimed.add(node);
    if (!/[A-Za-z]/.test(text) && !RE.R04.test(text) && !text.includes('...') && !text.includes('!')) return;
    const viaT = typeof v !== 'string' && !!v.viaT;
    strings.push({ text, line: lineOf(node.getStart(sf)), kind, name, leadingJsx, span: simpleSpan(node), ...(viaT ? { strictOnly: true } : {}), ...more });
  };
  /** Style keys and tag name of a JSX element, and whether it sits inside a button. */
  const jsxContext = (el: ts.Node): { styleNames: string[]; inButton: boolean } => {
    const styleNames: string[] = [];
    let inButton = false;
    if (ts.isJsxElement(el)) {
      const open = el.openingElement;
      styleNames.push(open.tagName.getText(sf));
      for (const a of open.attributes.properties) {
        if (ts.isJsxAttribute(a) && a.name.getText(sf) === 'style' && a.initializer) {
          for (const m of a.initializer.getText(sf).matchAll(/\.([A-Za-z_]\w*)/g)) styleNames.push(m[1]);
        }
      }
    }
    let up: ts.Node | undefined = el;
    for (let i = 0; i < 4 && up; i++) {
      if (ts.isJsxElement(up) && /Touchable|Pressable|Button|Chip|Link$/.test(up.openingElement.tagName.getText(sf))) inButton = true;
      up = up.parent;
    }
    return { styleNames, inButton };
  };

  const addComments = (ranges: ts.CommentRange[] | undefined) => {
    for (const r of ranges ?? []) blank.push([r.pos, r.end]);
  };
  const JSX_KINDS = new Set([
    ts.SyntaxKind.JsxText, ts.SyntaxKind.JsxOpeningElement, ts.SyntaxKind.JsxClosingElement,
    ts.SyntaxKind.JsxSelfClosingElement, ts.SyntaxKind.JsxElement, ts.SyntaxKind.JsxExpression,
    ts.SyntaxKind.JsxFragment, ts.SyntaxKind.JsxOpeningFragment, ts.SyntaxKind.JsxClosingFragment,
  ]);

  const jsxChildren = (children: ts.NodeArray<ts.JsxChild>, owner: ts.Node) => {
    const jc = jsxContext(owner);
    let seenContent = false;
    for (const c of children) {
      if (ts.isJsxText(c)) {
        const raw = c.text;
        if (!raw.trim()) continue;
        const collapsed = raw.replace(/\s+/g, ' ').trim();
        const firstNonWs = c.getStart(sf) + (raw.length - raw.trimStart().length);
        claimed.add(c);
        const trimmedLen = raw.trim().length;
        strings.push({
          text: collapsed,
          line: lineOf(firstNonWs),
          kind: 'jsx',
          name: '',
          leadingJsx: !seenContent,
          ...jc,
          // c.pos, not getStart(): getStart() already skips the leading whitespace.
          span: /[\n&{}<>]/.test(raw.trim()) ? undefined : [c.pos + (raw.length - raw.trimStart().length), c.pos + (raw.length - raw.trimStart().length) + trimmedLen],
        });
        seenContent = true;
      } else if (ts.isJsxExpression(c)) {
        if (!c.expression) {
          blank.push([c.getStart(sf), c.end]); // {/* … */}
          continue;
        }
        for (const v of literalValues(c.expression)) push(v, v.node, 'jsx', '', !seenContent, jc);
        seenContent = true;
      } else {
        seenContent = true;
      }
    }
  };

  const visit = (node: ts.Node, skip: boolean) => {
    if (!JSX_KINDS.has(node.kind)) {
      addComments(ts.getLeadingCommentRanges(text, node.pos));
      addComments(ts.getLeadingCommentRanges(text, node.end));
    }
    if (!skip && (isPromptBinding(node) || isPromptTemplate(node))) {
      skip = true;
      if (isPromptTemplate(node) || ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) {
        const target =
          ts.isVariableDeclaration(node) ? node.initializer
          : ts.isPropertyAssignment(node) ? node.initializer
          : node;
        if (target && (ts.isTemplateExpression(target) || ts.isNoSubstitutionTemplateLiteral(target))) {
          blank.push([target.getStart(sf), target.end]);
        }
      }
    }
    if (!skip) {
      if (ts.isJsxElement(node) || ts.isJsxFragment(node)) jsxChildren(node.children, node);
      else if (ts.isJsxAttribute(node)) {
        const name = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(sf);
        if (PROP_NAMES.has(name) && node.initializer) {
          if (ts.isStringLiteral(node.initializer)) push(node.initializer.text, node.initializer, 'prop', name);
          else if (ts.isJsxExpression(node.initializer)) {
            for (const v of literalValues(node.initializer.expression)) push(v, v.node, 'prop', name);
          }
        }
      } else if (ts.isVariableDeclaration(node) && LABEL_MAP_NAME.test(nameOf(node.name)) && node.initializer) {
        // A label map (KIND_LABEL, SECTION_LABEL, FEATURE_TITLE …): every value is a label. Strict rules only.
        let init: ts.Expression = node.initializer;
        while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
        if (ts.isObjectLiteralExpression(init)) {
          for (const p of init.properties) {
            if (ts.isPropertyAssignment(p)) for (const v of literalValues(p.initializer)) push(v, v.node, 'key', 'label', false, { strictOnly: true });
          }
        }
      } else if (ts.isObjectLiteralExpression(node)) {
        const schema = isSchemaObject(node);
        const keys = new Set(node.properties.map((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p) ? nameOf(p.name) : '')));
        for (const p of node.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const key = nameOf(p.name);
          // An alert button ({ text, onPress } / { text, style }) or a nav option: strict rules only.
          const strictKey =
            (key === 'text' && (keys.has('onPress') || keys.has('style'))) ||
            (STRICT_LABEL_NAMES.has(key) && key !== 'text');
          if (!OBJECT_KEYS.has(key)) {
            if (strictKey) for (const v of literalValues(p.initializer)) push(v, v.node, 'key', key, false, { strictOnly: true });
            continue;
          }
          if (schema && key === 'description') continue;
          for (const v of literalValues(p.initializer)) push(v, v.node, 'key', key);
        }
      } else if (ts.isCallExpression(node)) {
        const callee = node.expression;
        let cname = '';
        if (ts.isIdentifier(callee)) cname = callee.text;
        else if (ts.isPropertyAccessExpression(callee)) {
          cname = ts.isIdentifier(callee.expression) && callee.expression.text === 'Alert' && callee.name.text === 'alert'
            ? 'Alert.alert'
            : callee.name.text;
        }
        if (ALERT_CALLEES.has(cname) || cname === 'Alert.alert') {
          node.arguments.slice(0, 2).forEach((a, i) => {
            for (const v of literalValues(a)) push(v, v.node, i === 0 ? 'alertTitle' : 'alertBody', cname);
          });
        } else if (MESSAGE_SETTERS.has(cname) && node.arguments.length > 0) {
          for (const v of literalValues(node.arguments[0])) push(v, v.node, 'error', cname);
        } else if (ONE_ARG_CALLEES.has(cname) && node.arguments.length > 0) {
          for (const v of literalValues(node.arguments[0])) {
            push(v, v.node, cname === 'setError' ? 'error' : 'toast', cname);
          }
        }
      }
    }
    ts.forEachChild(node, (c) => visit(c, skip));
  };
  visit(sf, false);

  // Every other string in the file, for the strict rules (R20-R24). Not read:
  // imports / exports, console.* arguments, type positions, AI prompt text,
  // and the keys of an object or a lookup (`'Unlimited Projects': …`, x['k']).
  const sweep = (node: ts.Node, skip: boolean) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'console') return;
    if (!skip && (isPromptBinding(node) || isPromptTemplate(node))) skip = true;
    if (!skip && !claimed.has(node)) {
      const parent = node.parent;
      const isKey = !!parent && ((ts.isPropertyAssignment(parent) && parent.name === node) || (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) || ts.isComputedPropertyName(parent));
      if (!isKey) {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) strings.push({ text: node.text, line: lineOf(node.getStart(sf)), kind: 'raw', name: '', leadingJsx: false });
        else if (ts.isTemplateExpression(node)) strings.push({ text: templateText(node), line: lineOf(node.getStart(sf)), kind: 'raw', name: '', leadingJsx: false });
      }
    }
    ts.forEachChild(node, (c) => sweep(c, skip));
  };
  sweep(sf, false);

  // Blank comments and prompt bodies (keep newlines) for the line rules.
  const chars = text.split('');
  for (const [a, b] of blank) {
    for (let i = a; i < b && i < chars.length; i++) if (chars[i] !== '\n') chars[i] = ' ';
  }
  return { strings, lines: chars.join('').split('\n') };
}

// ── Scanning ─────────────────────────────────────────────────────────────────

type Hit = { file: string; line: number; rule: RuleId; text: string; span?: [number, number]; sentence?: boolean };

/**
 * mode 'ratchet+strict': a converted file under SCOPE_DIRS (every rule).
 * mode 'ratchet': an unconverted file under SCOPE_DIRS (the ratchet + R24).
 * mode 'strict': a converted file outside SCOPE_DIRS (strict rules only).
 * mode 'global': an unconverted file outside SCOPE_DIRS (R24 only).
 */
type ScanMode = 'ratchet+strict' | 'ratchet' | 'strict' | 'global';

function scanSource(file: string, text: string, ctx: Ctx, mode: ScanMode = 'ratchet+strict'): Hit[] {
  const { strings, lines } = extract(file, text);
  const hits: Hit[] = [];
  const ratchet = mode === 'ratchet+strict' || mode === 'ratchet';
  const strict = mode === 'ratchet+strict' || mode === 'strict';
  for (const s of strings) {
    if (ratchet) for (const rule of stringRules(s, ctx)) hits.push({ file, line: s.line, rule, text: s.text });
    for (const rule of strictRules(s, ctx)) {
      // A sentence alert title is fixed by hand (--fix-labels would Title Case it): no span.
      const sentence = rule === 'R15' && s.kind === 'alertTitle' && isSentenceTitle(s.text);
      if (strict || GLOBAL_STRICT.includes(rule)) hits.push({ file, line: s.line, rule, text: s.text, span: sentence ? undefined : s.span, sentence });
    }
  }
  if (ratchet) lines.forEach((l, i) => {
    for (const rule of lineRules(l)) hits.push({ file, line: i + 1, rule, text: l.trim() });
  });
  hits.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return hits;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walk(full));
    else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function inScope(rel: string): boolean {
  if (/(^|\/)__tests__\//.test(rel)) return false;
  if (rel.endsWith('.d.ts')) return false;
  if (/^app\/dev-[^/]*\.tsx$/.test(rel)) return false;
  return true;
}

// ── Self-test ────────────────────────────────────────────────────────────────

type Fixture = { rule: RuleId; flag: boolean; src: string };
const FIXTURES: Fixture[] = [
  { rule: 'R01', flag: true, src: `const a = <Text>Loading...</Text>;` },
  { rule: 'R01', flag: true, src: `const a = <TextInput placeholder="Add notes…" />;` },
  { rule: 'R01', flag: false, src: `const x = [...items]; const a = <Text>Loading projects…</Text>;` },
  { rule: 'R02', flag: true, src: `showAlert('Imported', 'Imported 3 task(s).');` },
  { rule: 'R02', flag: false, src: `showAlert('Imported', 'Imported 3 tasks.');` },
  { rule: 'R03', flag: true, src: `nailIt('Invoice sent!');` },
  { rule: 'R03', flag: false, src: `if (a !== b) { nailIt('Invoice sent'); }` },
  { rule: 'R04', flag: true, src: `const a = <Text>Done 🎉</Text>;` },
  { rule: 'R04', flag: true, src: `nailIt('✓ Saved');` },
  { rule: 'R04', flag: false, src: `const a = <Text>Kitchen · Electrical</Text>;` },
  { rule: 'R05', flag: true, src: `const a = <Button title="Upgrade to unlock" />;` },
  { rule: 'R05', flag: true, src: `const a = <Text>Note: rates change</Text>;` },
  { rule: 'R05', flag: false, src: `const a = <Button title="See plans" />;` },
  { rule: 'R06', flag: true, src: `const o = { subtitle: 'Built from real data only' };` },
  { rule: 'R06', flag: false, src: `const o = { subtitle: 'From your 14 closed projects' };` },
  { rule: 'R07', flag: true, src: `showAlert('Couldn’t save', 'The sync queue is full.');` },
  { rule: 'R07', flag: true, src: `const a = <Text>Status: in_progress</Text>;` },
  { rule: 'R07', flag: false, src: `showAlert('Couldn’t save', 'Saved on this phone. It sends when you’re back online.');` },
  { rule: 'R08', flag: true, src: `showAlert('Add a title', 'Please enter a title.');` },
  { rule: 'R08', flag: false, src: `showAlert('Add a title', 'Enter a title.');` },
  { rule: 'R09', flag: true, src: `showAlert('Failed', e instanceof Error ? e.message : 'x');` },
  { rule: 'R09', flag: false, src: `console.warn(e instanceof Error ? e.message : 'x');` },
  { rule: 'R10', flag: true, src: `const a = <Text>MANAGE WORK</Text>;` },
  { rule: 'R10', flag: true, src: `const a = <Text>AWARDED</Text>;` },
  { rule: 'R10', flag: false, src: `const a = <Text>MAGE ID</Text>; const b = <Text>PDF</Text>;` },
  { rule: 'R11', flag: true, src: `const l = s.replace(/_/g, ' ');` },
  { rule: 'R11', flag: false, src: `// s.replace(/_/g, ' ')\nconst l = LABELS[s];` },
  { rule: 'R11', flag: true, src: `const l = s.split('_').join(' ');` },
  { rule: 'R11', flag: false, src: `const l = s.split('_').join('-');` },
  { rule: 'R08', flag: true, src: `setError("We couldn't save it. " + 'Otherwise please try again.');` },
  { rule: 'R08', flag: false, src: `setError('Couldn’t save it. ' + 'Otherwise try again.');` },
  { rule: 'R08', flag: true, src: `setSessionExpiredReason('Your session expired — please sign in again.');` },
  { rule: 'R08', flag: false, src: `setSessionExpiredReason('Your session expired. Sign in again.');` },
  { rule: 'R18', flag: true, src: 'recordDidForYou(`My pace calls for ${t} slipped. I\'ll ask first again`);' },
  { rule: 'R18', flag: false, src: 'recordDidForYou(`Your pace calls for ${t} slipped. MAGE asks first again.`);' },
  { rule: 'R08', flag: false, src: `const total = a + b; const id = 'x' + n;` },
  { rule: 'R12', flag: true, src: `showAlert('Remove crew member?', 'His certificates go with him.');` },
  { rule: 'R12', flag: false, src: `showAlert('Remove crew member?', 'Their certificates go with them.');` },
  { rule: 'R13', flag: true, src: `nailIt('Daily report saved.');` },
  { rule: 'R13', flag: true, src: `nailIt('Saved — sent to the client');` },
  { rule: 'R13', flag: false, src: `nailIt('Saved offline. It sends when you’re back online.'); nailIt('Daily report saved');` },
  { rule: 'R14', flag: true, src: `const a = <Text>Your role on this job</Text>;` },
  { rule: 'R14', flag: false, src: `const a = <Text>Job costing</Text>;` },
  // R15, the label case (Title Case on a label, sentences left alone).
  { rule: 'R15', flag: true, src: `const a = <Screen title="Waiting on others" />;` },
  { rule: 'R15', flag: true, src: `const a = <Screen title="Bring The Plan Up To Date" />;` },
  { rule: 'R15', flag: true, src: `const o = { label: 'Supplier catalog (demo)' };` },
  { rule: 'R15', flag: true, src: `showAlert('Invoice not sent', 'Check your signal and try again.');` },
  { rule: 'R15', flag: true, src: `showAlert('Sign out?', m, [{ text: 'Delete and sign out', onPress: go }]);` },
  { rule: 'R15', flag: true, src: `const a = <Tabs.Screen options={{ title: t('nav.tab.x', 'Daily reports') }} />;` },
  { rule: 'R15', flag: true, src: `const a = <TouchableOpacity><Text>Set up Stripe</Text></TouchableOpacity>;` },
  { rule: 'R15', flag: true, src: `const a = <Text style={styles.sectionHeader}>Estimate defaults</Text>;` },
  { rule: 'R15', flag: true, src: `const KIND_LABEL: Record<string, string> = { punch: 'Punch list', rfi: 'RFI' };` },
  { rule: 'R15', flag: false, src: `const KIND_LABEL = { punch: 'Punch List' } as const; const KIND_NOTE = { punch: 'Punch list' };` },
  { rule: 'R15', flag: false, src: `const a = <Screen title="Waiting on Others" />; const b = <Screen title="Sign In to MAGE ID" />;` },
  { rule: 'R15', flag: false, src: `const o = { label: 'AIA-Style G702/G703 Pay Apps' }; const p = { label: 'Email Me a Sign-In Link' };` },
  { rule: 'R15', flag: false, src: `showAlert('Delete this change order?', 'This cannot be undone.'); showAlert("You're offline.", 'x');` },
  // Alert titles: a full sentence or a question is a sentence (sentence case, closing punctuation);
  // a noun phrase or a short command is a label (Title Case). Both directions.
  { rule: 'R15', flag: true, src: `showAlert('Milestone Was Already Billed', 'x');` },
  { rule: 'R15', flag: true, src: `showAlert('Milestone was already billed', 'x');` },
  { rule: 'R15', flag: true, src: `showAlert('Takeoffs Are on the Pro Plan.', 'x');` },
  { rule: 'R15', flag: true, src: `showAlert('Delete This Sheet?', 'x');` },
  { rule: 'R15', flag: true, src: `showAlert("You're offline", 'x');` },
  { rule: 'R15', flag: true, src: `showAlert('Saved, but the Sub Hasn’t Been Told', 'x');` },
  { rule: 'R15', flag: true, src: 'showAlert(`${name} is on the Pro plan`, body);' },
  { rule: 'R15', flag: true, src: `showAlert('Only the Project Owner Bills.', 'x');` },
  { rule: 'R15', flag: true, src: `showAlert('Delete scan', 'x');` },
  { rule: 'R15', flag: true, src: `showAlert("Couldn't send invoice", 'x');` },
  { rule: 'R15', flag: true, src: `showAlert('Not signed in', 'x');` },
  { rule: 'R15', flag: false, src: `showAlert('Milestone was already billed.', 'x'); showAlert('Takeoffs are on the Pro plan.', 'x');` },
  { rule: 'R15', flag: false, src: `showAlert('Delete this sheet?', 'x'); showAlert('Ready to file?', 'x'); showAlert('Remove this photo?', 'x');` },
  { rule: 'R15', flag: false, src: `showAlert('Saved, but the sub hasn’t been told.', 'x'); showAlert('That is not an email address.', 'x');` },
  { rule: 'R15', flag: false, src: 'showAlert(`${name} is on the Pro plan.`, body); showAlert("You\'re on Business.", body);' },
  { rule: 'R15', flag: false, src: `showAlert('QuickBooks shows this invoice closed.', 'x'); showAlert('Only the project owner bills.', 'x');` },
  { rule: 'R15', flag: false, src: `showAlert('Delete Scan', 'x'); showAlert('Not Signed In', 'x'); showAlert('Upgrade Required', 'x');` },
  { rule: 'R15', flag: false, src: `showAlert("Couldn't Send Invoice", 'x'); showAlert("Can't Delete This Item", 'x'); showAlert('Invoice Not Sent', 'x');` },
  // The sentence test is for alert titles only: a button or a row is still a label.
  { rule: 'R15', flag: true, src: `const a = <Button title="Portal is off" />;` },
  { rule: 'R15', flag: false, src: `const o = { label: 'Overdue 3 days' }; const a = <Text style={styles.rowSub}>Overdue RFIs and submittals</Text>;` },
  { rule: 'R15', flag: false, src: `const a = <Text style={styles.body}>Pay app for March</Text>; const b = <Button title="Sending invoice…" />;` },
  { rule: 'R16', flag: true, src: `const o = { label: 'no cost basis' };` },
  { rule: 'R16', flag: false, src: `const a = <Text>{n} days left</Text>; const o = { label: 'iPhone app' };` },
  { rule: 'R17', flag: true, src: `const a = <Text>One — two — three</Text>;` },
  { rule: 'R17', flag: false, src: `const a = <Text>One — two</Text>;` },
  { rule: 'R18', flag: true, src: `const a = <Text>I can draft that for you</Text>;` },
  { rule: 'R18', flag: false, src: `const a = <Text>MAGE drafted this</Text>;` },
  { rule: 'R19', flag: true, src: `const a = <Text>Send to the homeowner</Text>;` },
  { rule: 'R19', flag: false, src: `const a = <Text>Send to the client</Text>;` },
  // R20, no dash as punctuation.
  { rule: 'R20', flag: true, src: `const a = <Text>Get paid in one tap — connect Stripe.</Text>;` },
  { rule: 'R20', flag: true, src: `const o = { subtitle: 'Sent – without the PDF' };` },
  { rule: 'R20', flag: true, src: `const o = { subtitle: 'Saved - sent to the client' };` },
  { rule: 'R20', flag: true, src: `const line = 'Net 30 is the default — set your own.';` },
  { rule: 'R20', flag: false, src: `const a = <Text>—</Text>; const b = <Text>Target 80–85%</Text>; const c = <Text>3-5 days</Text>;` },
  { rule: 'R20', flag: false, src: `// a — b\nconsole.warn('load failed — retrying'); const a = <Text>Sign-in link sent</Text>;` },
  // R21, "and" not "&".
  { rule: 'R21', flag: true, src: `const o = { label: 'Proposal & Contract' };` },
  { rule: 'R21', flag: true, src: `const a = <Text>Tips &amp; notes for the crew</Text>;` },
  { rule: 'R21', flag: false, src: `const o = { label: 'T&M Tickets' }; const u = 'https://x.test/a?b=1&c=2'; const ok = a && b;` },
  // R22, no "e.g." / "i.e.".
  { rule: 'R22', flag: true, src: `const a = <TextInput placeholder="e.g. Kitchen Renovation" />;` },
  { rule: 'R22', flag: true, src: `const o = { subtitle: 'One trade, i.e. framing only' };` },
  { rule: 'R22', flag: false, src: `const a = <TextInput placeholder="Kitchen Renovation" />;` },
  // R23, no arrows.
  { rule: 'R23', flag: true, src: `const o = { label: 'Back to invoice →' };` },
  { rule: 'R23', flag: true, src: `const a = <Text>Settings -> Estimate defaults</Text>;` },
  { rule: 'R23', flag: false, src: `const f = (x: number) => x + 1; const a = <Text>↑ ↓ Move · ↵ Open</Text>;` },
  // R24, never "unlimited" (strict in every file).
  { rule: 'R24', flag: true, src: `const o = { label: 'Unlimited projects' };` },
  { rule: 'R24', flag: true, src: `const line = \`Pro adds unlimited projects for \${price}.\`;` },
  { rule: 'R24', flag: false, src: `// unlimited\nconst k = canAccess('unlimited_bid_responses'); const m = { 'Unlimited Projects': pitch };` },
  // Not UI: comments, prompt text and schema descriptions never count.
  { rule: 'R03', flag: false, src: `// Wow!\nconst a = <View>{/* Great! */}</View>;` },
  { rule: 'R18', flag: false, src: 'const prompt = `You are a GC. I can help!`;' },
  { rule: 'R18', flag: false, src: 'ask(`You are an estimator. I can price ${x}.`); showAlert("x", `You are a GC. I can help.`);' },
  { rule: 'R12', flag: false, src: `const s = { type: 'object', description: 'his estimate' };` },
];

function selfTest(ctx: Ctx): string[] {
  const failures: string[] = [];
  FIXTURES.forEach((f, i) => {
    const hits = scanSource(`fixture${i}.tsx`, f.src, ctx).filter((h) => h.rule === f.rule);
    if (f.flag && hits.length === 0) failures.push(`${f.rule} should flag: ${f.src}`);
    if (!f.flag && hits.length > 0) failures.push(`${f.rule} should NOT flag: ${f.src} (got "${hits[0].text}")`);
  });
  return failures;
}

// ── The converted list (may only grow) ───────────────────────────────────────

type Converted = { paths: string[] };

function loadConverted(): Converted {
  if (!existsSync(CONVERTED_PATH)) return { paths: [] };
  const raw = JSON.parse(readFileSync(CONVERTED_PATH, 'utf8')) as Partial<Converted>;
  return { paths: raw.paths ?? [] };
}

/** Why the converted list is not acceptable ([] when it is). */
function convertedListProblems(paths: string[], pinned: number, exists: (rel: string) => boolean): string[] {
  const out: string[] = [];
  if (paths.length < pinned) out.push(`the list has ${paths.length} files and CONVERTED_PINNED is ${pinned}: the list may only grow, a converted file cannot be taken off it`);
  if (paths.length > pinned) out.push(`the list has ${paths.length} files and CONVERTED_PINNED is ${pinned}: raise CONVERTED_PINNED to ${paths.length} in the same change`);
  const seen = new Set<string>();
  for (const p of paths) {
    if (seen.has(p)) out.push(`listed twice: ${p}`);
    seen.add(p);
    if (!/\.tsx?$/.test(p) || p.startsWith('/') || p.includes('..')) out.push(`not a repo-relative .ts/.tsx path: ${p}`);
    else if (!exists(p)) out.push(`no such file (a renamed file keeps its place on the list under the new name): ${p}`);
  }
  if ([...paths].sort().join('\n') !== paths.join('\n')) out.push('the list is not sorted');
  return out;
}

// ── Planted mutations ────────────────────────────────────────────────────────
// Each one plants a violation in memory and must turn the guard red. A
// mutation that stays green means the rule it covers has stopped checking.

type Planted = { name: string; rule: RuleId; append: string };
const PLANTED: Planted[] = [
  { name: 'a sentence-case button', rule: 'R15', append: `\nexport const PlantedA = () => <Button title="Send invoice" />;\n` },
  { name: 'a sentence-case alert title', rule: 'R15', append: `\nexport const plantedB = () => showAlert('Portal saved', 'Your client can open it now.');\n` },
  { name: 'a sentence alert title typed in Title Case', rule: 'R15', append: `\nexport const plantedK = () => showAlert('Milestone Was Already Billed.', 'Pick another one.');\n` },
  { name: 'a sentence alert title with no closing punctuation', rule: 'R15', append: `\nexport const plantedL = () => showAlert('Takeoffs are on the Pro plan', 'See plans.');\n` },
  { name: 'a question alert title typed in Title Case', rule: 'R15', append: `\nexport const plantedM = () => showAlert('Delete This Sheet?', 'It is removed from the set.');\n` },
  { name: 'a label alert title (a short command) typed in sentence case', rule: 'R15', append: `\nexport const plantedN = () => showAlert('Delete scan', 'It is removed.');\n` },
  { name: 'a sentence-case tab title through t()', rule: 'R15', append: `\nexport const plantedC = { title: t('nav.tab.planted', 'Cash flow') };\n` },
  { name: 'an em dash gluing two halves', rule: 'R20', append: `\nexport const PlantedD = () => <Text>These are sample projects — create your own.</Text>;\n` },
  { name: 'an em dash in a string no position reads', rule: 'R20', append: `\nexport const plantedE = 'Free covers one project — Pro takes the cap off.';\n` },
  { name: 'a spaced hyphen used as a dash', rule: 'R20', append: `\nexport const plantedF = { subtitle: 'Saved - sent to the client' };\n` },
  { name: 'an ampersand for "and"', rule: 'R21', append: `\nexport const plantedG = { label: 'Help & Tutorials' };\n` },
  { name: 'an "e.g." placeholder', rule: 'R22', append: `\nexport const PlantedH = () => <TextInput placeholder="e.g. 123 Main St" />;\n` },
  { name: 'an arrow in a label', rule: 'R23', append: `\nexport const plantedI = { label: 'Open the Project →' };\n` },
  { name: '"unlimited" in a plan row', rule: 'R24', append: `\nexport const plantedJ = { label: 'Unlimited Projects' };\n` },
];

function plantedFailures(ctx: Ctx, converted: string[]): string[] {
  const failures: string[] = [];
  const host = converted.find((p) => p.endsWith('.tsx') && existsSync(join(ROOT, p)));
  const hostText = host ? readFileSync(join(ROOT, host), 'utf8') : 'export {};\n';
  const hostName = host ?? 'planted.tsx';
  for (const m of PLANTED) {
    const before = scanSource(hostName, hostText, ctx).filter((h) => h.rule === m.rule).length;
    const after = scanSource(hostName, hostText + m.append, ctx).filter((h) => h.rule === m.rule).length;
    if (after <= before) failures.push(`${m.rule} stayed green with ${m.name} planted in ${hostName}`);
  }
  // R24 is strict outside the converted list too.
  const globalHit = scanSource('utils/planted.ts', `export const x = { label: 'Unlimited bids' };`, ctx, 'global').some((h) => h.rule === 'R24');
  if (!globalHit) failures.push('R24 stayed green in an unconverted file outside app/');
  const leak = scanSource('app/planted.tsx', `export const x = { label: 'Send invoice — now' };`, ctx, 'ratchet').some((h) => h.rule === 'R15' || h.rule === 'R20');
  if (leak) failures.push('R15 / R20 fired in a file that is not on the converted list');
  // The list itself: shorter, unpinned growth, a duplicate, a missing file, out of order.
  const real = (rel: string) => converted.includes(rel);
  const base = converted.length >= 2 ? converted : ['app/a.tsx', 'app/b.tsx'];
  const ok = (rel: string) => base.includes(rel) || real(rel);
  const listCases: [string, string[], number][] = [
    ['a file dropped from the list', base.slice(1), base.length],
    ['a file added without raising the pin', [...base, 'zz/new.tsx'].sort(), base.length],
    ['a file listed twice', [...base.slice(0, -1), base[0]].sort(), base.length],
    ['a file that does not exist', [...base.slice(0, -1), 'zz/gone.tsx'].sort(), base.length],
    ['an unsorted list', [...base].reverse(), base.length],
  ];
  for (const [name, paths, pinned] of listCases) {
    if (convertedListProblems(paths, pinned, ok).length === 0) failures.push(`the converted list stayed green with ${name}`);
  }
  if (convertedListProblems([...base].sort(), base.length, ok).length !== 0) failures.push('the converted list is red on a clean list');
  return failures;
}

// ── Baseline ─────────────────────────────────────────────────────────────────

type Counts = Record<string, Partial<Record<RuleId, number>>>;
type Baseline = { version: 1; counts: Counts; raises?: { date: string; reason: string; pairs: string[] }[] };

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) return { version: 1, counts: {} };
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
}

function sortedCounts(c: Counts): Counts {
  const out: Counts = {};
  for (const f of Object.keys(c).sort()) {
    const rules: Partial<Record<RuleId, number>> = {};
    for (const r of RATCHET_RULES) if (c[f][r]) rules[r] = c[f][r];
    if (Object.keys(rules).length) out[f] = rules;
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): number {
  const args = process.argv.slice(2);
  const has = (f: string) => args.includes(f);
  const argAfter = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const writeBaseline = has('--write-baseline');
  const report = has('--report');
  const allowRaise = argAfter('--allow-raise');
  const extraDir = argAfter('--extra');
  const t0 = Date.now();

  const allow = loadAllowlist();
  const ctx = makeCtx(allow);

  console.log('\ncopy-voice ratchet (docs/VOICE.md):');
  const st = selfTest(ctx);
  if (st.length) {
    console.log(`  FAIL  self-test — ${st.length} fixture(s) misclassified:`);
    for (const f of st) console.log('        ' + f);
    return 1;
  }
  console.log(`  PASS  self-test (${FIXTURES.length} fixtures, every rule flags and passes)`);

  const converted = loadConverted().paths;
  const convertedSet = new Set(converted);
  const planted = plantedFailures(ctx, converted);
  if (planted.length) {
    console.log(`  FAIL  planted mutations — ${planted.length} stayed green:`);
    for (const f of planted) console.log('        ' + f);
    return 1;
  }
  console.log(`  PASS  planted mutations (${PLANTED.length} copy-style violations and 5 list edits, each one turns the guard red)`);

  const previewArg = argAfter('--strict-preview');
  const preview = previewArg ? previewArg.split(',') : null;
  const isConverted = (key: string) => convertedSet.has(key) || (!!preview && preview.some((p) => key.includes(p)));

  const files: { abs: string; key: string; extra: boolean; mode: ScanMode }[] = [];
  for (const d of SCOPE_DIRS) {
    for (const abs of walk(join(ROOT, d))) {
      const key = relative(ROOT, abs);
      if (inScope(key)) files.push({ abs, key, extra: false, mode: isConverted(key) ? 'ratchet+strict' : 'ratchet' });
    }
  }
  for (const d of STRICT_ONLY_DIRS) {
    for (const abs of walk(join(ROOT, d))) {
      const key = relative(ROOT, abs);
      if (inScope(key)) files.push({ abs, key, extra: false, mode: isConverted(key) ? 'strict' : 'global' });
    }
  }
  if (extraDir) {
    const dir = isAbsolute(extraDir) ? extraDir : resolve(process.cwd(), extraDir);
    for (const abs of walk(dir)) files.push({ abs, key: abs, extra: true, mode: 'ratchet' });
  }

  const dumpArg = argAfter('--dump');
  if (dumpArg) {
    for (const f of files) {
      if (!dumpArg.split(',').some((p) => f.key.includes(p))) continue;
      const { strings } = extract(f.key, readFileSync(f.abs, 'utf8'));
      for (const x of strings) {
        const tag = x.kind === 'raw' ? 'raw' : `${x.kind}${x.name ? ':' + x.name : ''}${x.kind === 'jsx' ? `[${(x.styleNames ?? []).join(',')}${x.inButton ? ',BTN' : ''}]` : ''}`;
        console.log(`${f.key}:${x.line}\t${tag}\t${JSON.stringify(x.text)}`);
      }
    }
    return 0;
  }

  if (has('--fix-labels')) {
    let fixed = 0;
    for (const f of files) {
      if (f.mode !== 'ratchet+strict' && f.mode !== 'strict') continue;
      let text = readFileSync(f.abs, 'utf8');
      const spans = scanSource(f.key, text, ctx, f.mode)
        .filter((h) => h.rule === 'R15' && h.span)
        // An allow-listed label (one matched by code) is never rewritten.
        .filter((h) => !allow.entries.some((e) => e.file === f.key && e.rule === 'R15' && h.text.includes(e.match)))
        .map((h) => h.span as [number, number])
        .sort((a, b) => b[0] - a[0]);
      let last = Infinity;
      for (const [a, b] of spans) {
        if (b > last) continue;
        last = a;
        const was = text.slice(a, b);
        const now = titleCase(was);
        if (now !== was) { text = text.slice(0, a) + now + text.slice(b); fixed++; console.log(`  ${f.key}  "${was}" -> "${now}"`); }
      }
      writeFileSync(f.abs, text);
    }
    console.log(`\n  --fix-labels: ${fixed} label(s) rewritten. Read the diff: a script cannot tell a label from a short sentence.`);
    return 0;
  }

  const counts: Counts = {};
  const hitsByFile = new Map<string, Hit[]>();
  const allowUsed = new Set<number>();
  for (const f of files) {
    const seen = new Set<string>();
    const hits = scanSource(f.key, readFileSync(f.abs, 'utf8'), ctx, f.mode).filter((h) => {
      // A strict hit found twice (once in its position, once by the whole-file read) is one hit.
      // The text is part of the key: two different strings on one line are two hits, so an
      // allow-listed string never hides its neighbour.
      if (STRICT_RULES.includes(h.rule)) {
        const k = `${h.rule}|${h.line}|${h.text}`;
        if (seen.has(k)) return false;
        seen.add(k);
      }
      const idx = allow.entries.findIndex(
        (e) => e.file === f.key && e.rule === h.rule && (h.text === e.match || h.text.includes(e.match)),
      );
      if (idx >= 0) {
        allowUsed.add(idx);
        return false;
      }
      return true;
    });
    hitsByFile.set(f.key, hits);
    for (const h of hits) {
      counts[f.key] ??= {};
      counts[f.key][h.rule] = (counts[f.key][h.rule] ?? 0) + 1;
    }
  }
  const scanMs = Date.now() - t0;

  const totals: Record<RuleId, number> = Object.fromEntries(ALL_RULES.map((r) => [r, 0])) as Record<RuleId, number>;
  for (const c of Object.values(counts)) for (const r of ALL_RULES) totals[r] += c[r] ?? 0;
  const printTotals = () => {
    console.log('\n  rule  name            hits');
    for (const r of ALL_RULES) console.log(`  ${r}   ${RULE_NAMES[r].padEnd(14)}  ${String(totals[r]).padStart(5)}`);
    const sum = ALL_RULES.reduce((a, r) => a + totals[r], 0);
    console.log(`  total                 ${String(sum).padStart(5)}   (${files.length} files, ${scanMs} ms)`);
  };

  if (preview) {
    let n = 0;
    for (const [f, hits] of hitsByFile) {
      if (!preview.some((p) => f.includes(p))) continue;
      for (const h of hits) if (STRICT_RULES.includes(h.rule)) { n++; console.log(`  ${h.file}:${h.line}  ${h.rule}  "${h.text.slice(0, 200)}"`); }
    }
    console.log(`\n  --strict-preview: ${n} strict hit(s)`);
    return 0;
  }

  const hitsFilter = has('--hits') ? (argAfter('--hits') ?? '') : null;
  if (hitsFilter !== null) {
    const pats = hitsFilter.startsWith('--') ? [''] : hitsFilter.split(',');
    for (const [f, hits] of hitsByFile) {
      if (!pats.some((p) => f.includes(p))) continue;
      for (const h of hits) console.log(`  ${h.file}:${h.line}  ${h.rule}  "${h.text.slice(0, 140)}"`);
    }
    return 0;
  }

  if (report) {
    printTotals();
    const worst = Object.entries(counts)
      .map(([f, c]) => [f, ALL_RULES.reduce((a, r) => a + (c[r] ?? 0), 0)] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    console.log('\n  20 worst files:');
    for (const [f, n] of worst) {
      const detail = ALL_RULES.filter((r) => counts[f][r]).map((r) => `${r}:${counts[f][r]}`).join(' ');
      console.log(`  ${String(n).padStart(4)}  ${f}   ${detail}`);
    }
    return 0;
  }

  let failed = false;

  // Stale allowlist entries.
  const stale = allow.entries.filter((_, i) => !allowUsed.has(i));
  if (stale.length) {
    failed = true;
    console.log(`  FAIL  allowlist — ${stale.length} entr${stale.length === 1 ? 'y matches' : 'ies match'} nothing any more:`);
    for (const e of stale) console.log(`        ${e.file}  ${e.rule}  "${e.match}"`);
  }

  // The converted list may only grow.
  const listProblems = convertedListProblems(converted, CONVERTED_PINNED, (rel) => existsSync(join(ROOT, rel)));
  const unscanned = converted.filter((p) => !files.some((f) => f.key === p));
  for (const p of unscanned) listProblems.push(`on the list but outside what this guard reads (${[...SCOPE_DIRS, ...STRICT_ONLY_DIRS].join(', ')}): ${p}`);
  if (listProblems.length) {
    failed = true;
    console.log('  FAIL  scripts/copy-style-converted.json:');
    for (const m of listProblems) console.log('        ' + m);
  } else {
    console.log(`  PASS  converted list (${converted.length} files, pinned; it may only grow)`);
  }

  // The copy style: strict, zero, never in the baseline.
  const strictHits = [...hitsByFile.values()].flat().filter((h) => STRICT_RULES.includes(h.rule));
  if (strictHits.length) {
    failed = true;
    console.log(`  FAIL  copy style — ${strictHits.length} string(s) break docs/VOICE.md §3 / §4:`);
    for (const h of strictHits) {
      const fix = h.rule !== 'R15' ? ''
        : h.sentence ? '  (an alert title that is a sentence: sentence case, ending in "." or "?")'
        : `  (Title Case: "${titleCase(h.text).slice(0, 80)}")`;
      console.log(`        ${h.file}:${h.line}  ${h.rule} ${RULE_NAMES[h.rule]}  "${h.text.slice(0, 120)}"${fix}`);
    }
    console.log('        (R15: Title Case on a label; an alert title that is a full sentence or a question is sentence case with its period or question mark. R20: no dash as punctuation.');
    console.log('         R21: "and", not "&". R22: no "e.g." / "i.e.". R23: no arrows. R24: never "unlimited".)');
  } else {
    console.log(`  PASS  copy style (R15, R20-R23 are zero in the ${converted.length} converted files; R24 is zero everywhere)`);
  }

  const baseline = loadBaseline();
  const base = baseline.counts;
  const above: string[] = [];
  const below: string[] = [];
  const scannedKeys = new Set(files.filter((f) => !f.extra).map((f) => f.key));
  for (const f of files) {
    for (const r of RATCHET_RULES) {
      const cur = counts[f.key]?.[r] ?? 0;
      const was = f.extra ? 0 : (base[f.key]?.[r] ?? 0);
      if (cur > was) above.push(`${f.key}|${r}|${was}->${cur}`);
      else if (cur < was) below.push(`${f.key}|${r}|${was}->${cur}`);
    }
  }
  // Baseline rows for files that no longer exist can always be tightened.
  for (const f of Object.keys(base)) if (!scannedKeys.has(f)) for (const r of RATCHET_RULES) if (base[f][r]) below.push(`${f}|${r}|${base[f][r]}->0`);
  // A strict rule is never baselined (the old sentence-case R15 rows are dropped on the next write).
  for (const f of Object.keys(base)) for (const r of STRICT_RULES) if (base[f][r]) below.push(`${f}|${r}|${base[f][r]}->(strict, not baselined)`);

  if (writeBaseline) {
    if (extraDir) {
      console.log('  FAIL  --write-baseline cannot be combined with --extra');
      return 1;
    }
    // The very first write seeds the ratchet; every later write may only lower it.
    const initial = !existsSync(BASELINE_PATH);
    if (above.length && !allowRaise && !initial) {
      console.log(`  FAIL  --write-baseline refused: ${above.length} file/rule count(s) would go UP:`);
      for (const p of above) console.log('        ' + p);
      console.log('        (fix the new strings, or pass --allow-raise "<reason>" to record a deliberate raise)');
      return 1;
    }
    const next: Baseline = { version: 1, counts: sortedCounts(Object.fromEntries(Object.entries(counts).filter(([k]) => scannedKeys.has(k)))) };
    const raises = [...(baseline.raises ?? [])];
    if (above.length && allowRaise && !initial) raises.push({ date: new Date().toISOString().slice(0, 10), reason: allowRaise, pairs: above });
    if (raises.length) next.raises = raises;
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n');
    printTotals();
    console.log(`\n  WROTE scripts/copy-voice-baseline.json (${initial ? 'initial baseline' : `${below.length} pair(s) tightened${above.length ? `, ${above.length} raised: ${allowRaise}` : ''}`})`);
    return failed ? 1 : 0;
  }

  if (above.length) {
    failed = true;
    console.log(`  FAIL  ${above.length} file/rule count(s) above the baseline. The new hits:`);
    for (const p of above) {
      const [file, rule] = p.split('|');
      const hits = (hitsByFile.get(file) ?? []).filter((h) => h.rule === rule);
      for (const h of hits) console.log(`        ${h.file}:${h.line}  ${h.rule}  "${h.text.slice(0, 120)}"`);
    }
    console.log('        (fix them per docs/VOICE.md; every listed hit for an over-count pair is shown, the new one is among them)');
  }
  printTotals();
  if (extraDir) {
    const extraHits = files.filter((f) => f.extra).flatMap((f) => hitsByFile.get(f.key) ?? []);
    const rules = [...new Set(extraHits.map((h) => h.rule))].sort();
    console.log(`\n  --extra ${extraDir}: ${extraHits.length} hit(s) across ${rules.length} rule(s)${rules.length ? ` (${rules.join(' ')})` : ''}`);
  }
  if (below.length) console.log(`\n  ${below.length} file/rule pairs can be tightened: run with --write-baseline`);
  console.log(failed ? '\n  FAIL  copy-voice ratchet' : '\n  PASS  copy-voice ratchet (no file/rule count above its baseline, the copy style holds)');
  return failed ? 1 : 0;
}

process.exit(main());
