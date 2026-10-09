// scripts/validate-server-copy-voice.ts — the copy style (docs/VOICE.md §3 and
// §4) for the words that do NOT ship in the app bundle: push and email text in
// supabase/functions/ and the static customer pages under marketing/ (client
// portal, sub portal, bid invite, lien waiver, architect, preferences,
// unsubscribe, paid). marketing/access.html is NOT here: scripts/validate-
// marketing-seo.ts holds it to the marketing site's own rules (sentence-case
// <title>, the " — MAGE ID" suffix), so it converts with the marketing pass. The sibling of scripts/validate-copy-voice.ts,
// which reads app/, components/, utils/ and the rest of the bundle.
//
// It holds the files in scripts/server-copy-style-converted.json to:
//   R15  a label is in Title Case
//   R20  no dash used as punctuation (em dash, en dash, " - ")
//   R21  "and", not "&" (T&M, O&P and HTML entities other than &amp; pass)
//   R22  no "e.g." / "i.e."
//   R23  no arrows
//   R24  never "unlimited"
// That list may only GROW: its length is pinned by CONVERTED_PINNED below.
//
// WHAT IT READS. It does not try to understand TypeScript or HTML.
//   .ts (an edge function file), parsed with the TypeScript parser (parse
//   only): every string literal and template literal, a ${…} standing in as
//   "0". Not read: comments, imports, console.* arguments, type positions,
//   object keys, and AI prompt text (a template that contains "You are ", or a
//   value bound to a name matching /prompt|instruction|schema/i).
//   .html: (1) the text between tags, outside <script>, <style> and comments;
//   (2) the attributes aria-label, title, alt and placeholder; (3) every string
//   literal of an inline <script>, read the same way as a .ts file.
//
// WHERE IT CALLS A STRING A LABEL (R15 only). Only where the position says so:
//   - the text of <button>, <th>, <label>, <legend>, <summary>, <h1> to <h6>,
//     and of an <a> whose class has "btn", "button" or "cta" in it, in the
//     page markup or written whole inside one string literal of a script;
//   - the text of a leaf element (no child tags) whose class ends in label,
//     title, eyebrow, heading, chip, badge, pill, btn, button, cta or kicker
//     (detail-row-label, section-title), unless a class on it says subtitle,
//     hint, note, desc, value, meta, body, help or caption;
//   - an aria-label with no comma, colon or period in it;
//   - the value of an object key, or of a const, whose name is one of
//     LABEL_NAMES or ends in Title, Label, Eyebrow, Button, Btn, Cta, Chip,
//     Badge, Heading, Header or Subject ("Subtitle" is not a label);
//   - the first argument of emailStatRow(), emailButton() and
//     emailSecondaryButton() (the label of an email row or button).
//   A label is split at each middle dot (" · ") and every part is read on its
//   own, so "Daily Report Filed · ${project}" is held to Title Case before the
//   dot and the part with a value in it is left alone.
//   A label of two to eight words with no number in it must equal its Title
//   Case form (titleCase() in scripts/copy-title-case.ts). A string that is a
//   sentence (isSentenceTitle(), or one that opens with You / This / It / We /
//   There, or ends in . ? : … , ;) is left alone.
//
// WHAT IT DOES NOT COVER. Say this to whoever reads a green run:
//   - A label built by concatenation ('Pay ' + amount), set through
//     textContent / innerHTML from a variable, held under a key this file
//     does not know (payNow: 'Pay Now'), or written as the first item of a
//     row pair (['Filed By', who]) is read for R20 to R24 but NOT for Title
//     Case. Those were converted by reading the file and can drift.
//   - Text assembled from several literals is read one literal at a time.
//   - A template with a value in it ("Invoice ${n} sent") is never a label.
//   - It cannot tell prose from data: a dash inside a regular expression
//     written as a string, a CSS string, or a value compared by code has an
//     entry in scripts/server-copy-voice-allowlist.json with the reason.
//   - Legal and signed text (lien waiver language, e-signature consent,
//     canonical records, CAN-SPAM footers) is on that allow-list on purpose
//     and is not restyled.
//   - Spanish, Portuguese, Vietnamese and French strings are read for R20 to
//     R24 only when they sit in a listed file; they are never Title Case.
//   - Nothing here renders a page or an email. It reads source text.
//
// Modes:
//   (default)            fail on any hit in a converted file
//   --preview <a,b>      list the hits files matching a or b WOULD have, exit 0
//   --dump <a,b>         print every string read in files matching a or b, exit 0
//
// Pure node:fs + the typescript parser. Run: bun scripts/validate-server-copy-voice.ts

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';
import { isTitleCase, isSentenceTitle, titleCase } from './copy-title-case';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONVERTED_PATH = join(ROOT, 'scripts', 'server-copy-style-converted.json');
const ALLOWLIST_PATH = join(ROOT, 'scripts', 'server-copy-voice-allowlist.json');

/** The number of files on the converted list. It may only grow. */
const CONVERTED_PINNED = 19;

/** Never on the list: the marketing site proper and the redesign in progress. */
const OUT_OF_SCOPE = /^marketing\/(?:index\.html|pricing\.html|features\/|compare\/|cities\/|costs\/|[a-z-]+-alternative\.html|changelog\.html|playbook\.html|proof\.html|demo\.html|next\/|privacy\.html|terms\.html)/;

type Rule = 'R15' | 'R20' | 'R21' | 'R22' | 'R23' | 'R24';
type Kind = 'raw' | 'label';
type Str = { text: string; line: number; kind: Kind; where: string };
type Hit = { file: string; line: number; rule: Rule; text: string; where: string };
type Allow = { file: string; text?: string; contains?: string; reason: string };

const RE = {
  dash: /[—–]/,
  spaced: /[A-Za-z0-9)”"'’.] - [A-Za-z(“"'‘]/,
  amp: /&/,
  // T&M, O&P; any HTML entity except &amp; ; a query string.
  ampFixed: /\b[A-Z]&[A-Z]\b|&(?!amp;)(?:[a-zA-Z][a-zA-Z0-9]*|#x?[0-9a-fA-F]+);|[?&][A-Za-z_][\w.-]*=|&&/g,
  eg: /\b(?:e\.g\.|i\.e\.)/i,
  arrow: /[→←⇒⇐➔➜➝➞]|(?:^|\s)(?:->|<-)(?:\s|$)|&(?:rarr|larr|rArr|lArr);/,
  unlimited: /\bunlimited\b/i,
};

const LABEL_NAMES = new Set(['subject', 'title', 'heading', 'headline', 'cta', 'label', 'eyebrow', 'kicker', 'buttonText', 'ctaText', 'ctaLabel', 'pushTitle', 'emailSubject']);
/** Email helpers in supabase/functions/_shared/email.ts whose first argument is a label. */
const LABEL_CALLS = new Set(['emailStatRow', 'emailButton', 'emailSecondaryButton']);
const LABEL_NAME_END = /(?:Title|Label|Eyebrow|Button|Btn|Cta|CTA|Chip|Badge|Heading|Header|Subject)$/;
const SENTENCE_START = /^(?:You|You['’](?:re|ve|ll|d)|This|It|It['’]s|We|We['’](?:re|ve|ll)|There|That['’]s|I['’](?:m|ll|ve))\b/;
const LABEL_TAGS = 'button|th|label|legend|summary|h[1-6]';

function isLabelName(name: string): boolean {
  if (/sub-?(?:title|heading|header|label)$/i.test(name)) return false;
  return LABEL_NAMES.has(name) || LABEL_NAME_END.test(name);
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&mdash;|&#8212;|&#x2014;/gi, '—')
    .replace(/&ndash;|&#8211;|&#x2013;/gi, '–')
    .replace(/&rarr;|&#8594;/gi, '→')
    .replace(/&larr;|&#8592;/gi, '←')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&rsquo;|&#8217;|&#39;|&apos;/gi, '’')
    .replace(/&ldquo;|&rdquo;|&quot;/gi, '"')
    .replace(/&amp;/gi, '&');
}

/** R15: a label of two to eight words, with no number in it, equals its Title Case form. */
export function breaksLabelCase(raw: string): boolean {
  const t = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  const n = wordCount(t);
  if (n < 2 || n > 8) return false;
  if (/(?:^|[\s$#(+~-])\d/.test(t) || /[{}<>]/.test(t)) return false;
  if (/[.?!:…,;]$/.test(t)) return false;
  if (SENTENCE_START.test(t) || isSentenceTitle(t)) return false;
  return !isTitleCase(t);
}

export function rulesFor(str: Str): Rule[] {
  const s = decodeEntities(str.text);
  const out: Rule[] = [];
  if (RE.unlimited.test(s)) out.push('R24');
  // "Daily Report Filed · ${project}": each part between middle dots is read on its own,
  // and a part with a value in it (a "0") is data, not a label.
  if (str.kind === 'label' && s.split(' · ').some((part) => breaksLabelCase(part))) out.push('R15');
  const prose = /[A-Za-z]/.test(s) && /\s/.test(s.trim());
  if (/[A-Za-z]/.test(s) && RE.dash.test(s.replace(/\d\s?–\s?\$?\d/g, '0'))) out.push('R20');
  else if (prose && RE.spaced.test(s)) out.push('R20');
  if (prose && RE.amp.test(str.text.replace(RE.ampFixed, ''))) out.push('R21');
  if (prose && RE.eg.test(s)) out.push('R22');
  if (prose && RE.arrow.test(str.text)) out.push('R23');
  return out;
}

// ── Reading a script (a .ts file, or an inline <script>) ─────────────────────

function templateText(n: ts.TemplateExpression): string {
  return n.head.text + n.templateSpans.map((s) => '0' + s.literal.text).join('');
}

function isPromptTemplate(n: ts.Node): boolean {
  if (ts.isNoSubstitutionTemplateLiteral(n)) return /You are /.test(n.text);
  if (ts.isTemplateExpression(n)) return /You are /.test(templateText(n));
  return false;
}

function isPromptBinding(n: ts.Node): boolean {
  const named = (name: ts.Node | undefined) => !!name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) && /prompt|instruction|schema/i.test(name.text);
  if (ts.isVariableDeclaration(n)) return named(n.name);
  if (ts.isPropertyAssignment(n)) return named(n.name);
  if (ts.isFunctionDeclaration(n)) return named(n.name);
  return false;
}

/** A class name that marks a label: detail-row-label, section-title, co-chip. A subtitle, a hint or a value is not one. */
const LABEL_CLASS = /(?:^|[-_])(?:label|title|eyebrow|heading|chip|badge|pill|btn|button|cta|kicker)$/i;
const NOT_LABEL_CLASS = /sub-?(?:title|label|heading)|hint|note|desc|value|meta|body|help|caption/i;

/** Leaf elements (text only, no child tags) whose class marks a label. */
function classLabels(markup: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  const re = /<(span|div|p|a|strong|td|li|small)\b[^>]*\bclass=(["'])([^"']*)\2[^>]*>([^<>]+)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup))) {
    const classes = m[3].split(/\s+/).filter(Boolean);
    if (!classes.some((c) => LABEL_CLASS.test(c)) || classes.some((c) => NOT_LABEL_CLASS.test(c))) continue;
    const text = m[4].replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, index: m.index });
  }
  return out;
}

/** Labels written whole inside one string: '<button class="x">Pay Now</button>'. */
function labelsInMarkup(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(${LABEL_TAGS})\\b[^>]*>([\\s\\S]*?)</\\1>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[2]);
  const link = /<a\b[^>]*class=(["'])[^"']*(?:btn|button|cta)[^"']*\1[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = link.exec(text))) out.push(m[2]);
  for (const c of classLabels(text)) out.push(c.text);
  return out.map((t) => t.replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function readScript(source: string, lineOffset: number, isJs: boolean): Str[] {
  const sf = ts.createSourceFile(isJs ? 'x.js' : 'x.ts', source, ts.ScriptTarget.Latest, true, isJs ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const out: Str[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1 + lineOffset;
  const labelNameOf = (node: ts.Node): string | null => {
    const p = node.parent;
    if (!p) return null;
    if (ts.isPropertyAssignment(p) && p.initializer === node && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return p.name.text;
    if (ts.isVariableDeclaration(p) && p.initializer === node && ts.isIdentifier(p.name)) return p.name.text;
    // The label of an email row or button: emailStatRow('Total Due', …), emailButton('Open the Invoice', …).
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && LABEL_CALLS.has(p.expression.text) && p.arguments[0] === node) return 'label';
    return null;
  };
  const sweep = (node: ts.Node, skip: boolean) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'console') return;
    if (ts.isRegularExpressionLiteral(node)) return;
    if (!skip && (isPromptBinding(node) || isPromptTemplate(node))) skip = true;
    if (!skip) {
      const parent = node.parent;
      const isKey = !!parent && ((ts.isPropertyAssignment(parent) && parent.name === node) || (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) || ts.isComputedPropertyName(parent));
      if (!isKey) {
        let text: string | null = null;
        let whole = false;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { text = node.text; whole = true; }
        else if (ts.isTemplateExpression(node)) text = templateText(node);
        if (text !== null && text.trim()) {
          const line = lineOf(node.getStart(sf));
          const name = labelNameOf(node);
          const isLabel = !!name && isLabelName(name) && !/</.test(text);
          out.push({ text: text.replace(/\s+/g, ' ').trim(), line, kind: isLabel ? 'label' : 'raw', where: isLabel ? `key ${name}` : 'string' });
          if (/</.test(text)) for (const l of labelsInMarkup(text)) out.push({ text: l, line, kind: 'label', where: 'label tag in a string' });
        }
      }
    }
    ts.forEachChild(node, (c) => sweep(c, skip));
  };
  sweep(sf, false);
  return out;
}

// ── Reading a page ───────────────────────────────────────────────────────────

function blank(s: string): string {
  return s.replace(/[^\n]/g, ' ');
}

export function readHtml(source: string): Str[] {
  const out: Str[] = [];
  const lineAt = (pos: number) => source.slice(0, pos).split('\n').length;
  let markup = source.replace(/<!--[\s\S]*?-->/g, blank);
  markup = markup.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs: string, body: string, pos: number) => {
    const isData = /type=["'](?:application\/(?:ld\+)?json|text\/template)["']/i.test(attrs);
    if (!isData && body.trim()) {
      const bodyStart = pos + all.indexOf('>') + 1;
      out.push(...readScript(body, lineAt(bodyStart) - 1, true));
    }
    return blank(all);
  });
  markup = markup.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, blank);
  markup = markup.replace(/<svg\b[\s\S]*?<\/svg>/gi, blank);

  // Label elements.
  const labelRe = new RegExp(`<(${LABEL_TAGS})\\b[^>]*>([\\s\\S]*?)</\\1>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(markup))) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, line: lineAt(m.index), kind: 'label', where: `<${m[1].toLowerCase()}>` });
  }
  const linkRe = /<a\b[^>]*class=(["'])[^"']*(?:btn|button|cta)[^"']*\1[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = linkRe.exec(markup))) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, line: lineAt(m.index), kind: 'label', where: '<a class=btn>' });
  }
  for (const c of classLabels(markup)) out.push({ text: c.text, line: lineAt(c.index), kind: 'label', where: 'label class' });
  // Attributes a person reads or hears.
  const attrRe = /\s(aria-label|title|alt|placeholder)=(["'])([^"']*?)\2/gi;
  while ((m = attrRe.exec(markup))) {
    const text = m[3].trim();
    if (!text) continue;
    const isLabel = m[1].toLowerCase() === 'aria-label' && !/[,:.]/.test(text);
    out.push({ text, line: lineAt(m.index), kind: isLabel ? 'label' : 'raw', where: `attribute ${m[1].toLowerCase()}` });
  }
  // Every text node.
  const textRe = />([^<>]+)</g;
  while ((m = textRe.exec(markup))) {
    const text = m[1].replace(/\s+/g, ' ').trim();
    if (text && /[A-Za-z—–→←&]/.test(text)) out.push({ text, line: lineAt(m.index + 1 + (m[1].length - m[1].trimStart().length)), kind: 'raw', where: 'text' });
  }
  return out;
}

export function readFile(rel: string, source: string): Str[] {
  if (rel.endsWith('.html')) return readHtml(source);
  return readScript(source, 0, rel.endsWith('.js'));
}

// ── Scanning ─────────────────────────────────────────────────────────────────

function allowed(file: string, text: string, allow: Allow[], used: Set<Allow>): boolean {
  for (const a of allow) {
    if (a.file !== file) continue;
    if ((a.text !== undefined && a.text === text) || (a.contains !== undefined && text.includes(a.contains))) {
      used.add(a);
      return true;
    }
  }
  return false;
}

export function scan(rel: string, source: string, allow: Allow[], used: Set<Allow> = new Set()): Hit[] {
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const s of readFile(rel, source)) {
    const rules = rulesFor(s);
    if (rules.length === 0) continue;
    if (allowed(rel, s.text, allow, used)) continue;
    for (const rule of rules) {
      const key = `${rule}|${s.line}|${s.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ file: rel, line: s.line, rule, text: s.text, where: s.where });
    }
  }
  return hits;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(?:ts|html|js)$/.test(name) && !/\.test\.ts$|\.d\.ts$/.test(name)) out.push(relative(ROOT, p));
  }
}

function show(h: Hit): string {
  const t = h.text.length > 150 ? h.text.slice(0, 150) + '…' : h.text;
  const fix = h.rule === 'R15' ? `  => ${titleCase(decodeEntities(h.text))}` : '';
  return `  ${h.file}:${h.line}  ${h.rule}  [${h.where}]  ${JSON.stringify(t)}${fix}`;
}

// ── Self-test: fixtures and planted mutations ────────────────────────────────

type Fixture = { name: string; file: string; src: string; rule: Rule; flag: boolean };
const FIXTURES: Fixture[] = [
  { name: 'an em dash in an email body', file: 'a.ts', src: "const body = 'Your invoice is ready — pay online.';", rule: 'R20', flag: true },
  { name: 'a spaced hyphen as a dash', file: 'a.ts', src: "const body = 'Saved - sent to the client';", rule: 'R20', flag: true },
  { name: 'a number range and an empty cell', file: 'a.ts', src: "const a = 'Oct 5–12'; const b = '—'; const c = '3-5 days';", rule: 'R20', flag: false },
  { name: 'a dash in a comment or a log', file: 'a.ts', src: "// a — b\nconsole.log('load failed — retrying');", rule: 'R20', flag: false },
  { name: 'a dash in prompt text', file: 'a.ts', src: "const systemPrompt = 'Reply in one line — no preamble.'; const t = `You are a clerk — be brief.`;", rule: 'R20', flag: false },
  { name: 'an ampersand in a push title', file: 'a.ts', src: "const o = { title: 'Proposal & Contract' };", rule: 'R21', flag: true },
  { name: 'T&M, an entity and a query string', file: 'a.ts', src: "const a = 'T&M ticket sent'; const b = 'Paid&nbsp;in full'; const u = 'open the link ?a=1&b=2 now';", rule: 'R21', flag: false },
  { name: 'e.g. in a hint', file: 'a.ts', src: "const hint = 'A trade, e.g. framing';", rule: 'R22', flag: true },
  { name: 'an arrow in a button', file: 'a.ts', src: "const cta = 'Open the Portal →';", rule: 'R23', flag: true },
  { name: 'an arrow function is not copy', file: 'a.ts', src: "const f = (x: number) => x + 1;", rule: 'R23', flag: false },
  { name: 'unlimited', file: 'a.ts', src: "const line = 'Business has unlimited projects.';", rule: 'R24', flag: true },
  { name: 'a sentence-case subject', file: 'a.ts', src: "const o = { subject: 'Closeout binder ready' };", rule: 'R15', flag: true },
  { name: 'a sentence-case push title before a value', file: 'a.ts', src: "const o = { pushTitle: `Daily report filed · ${projectName}` };", rule: 'R15', flag: true },
  { name: 'a Title Case push title before a value', file: 'a.ts', src: "const o = { pushTitle: `Daily Report Filed · ${projectName}` };", rule: 'R15', flag: false },
  { name: 'a subject with a value in every part', file: 'a.ts', src: "const o = { subject: `${company} sent you a message · ${projectName}` };", rule: 'R15', flag: false },
  { name: 'a Title Case subject', file: 'a.ts', src: "const o = { subject: 'Closeout Binder Ready' };", rule: 'R15', flag: false },
  { name: 'a subject that is a sentence', file: 'a.ts', src: "const o = { subject: 'Your portal link has ended.' };", rule: 'R15', flag: false },
  { name: 'a sentence-case email row label', file: 'a.ts', src: "const r = emailStatRow('Total due', total);", rule: 'R15', flag: true },
  { name: 'a Title Case email row label', file: 'a.ts', src: "const r = emailStatRow('Total Due', total);", rule: 'R15', flag: false },
  { name: 'a subtitle is not a label', file: 'a.ts', src: "const o = { invoicesSectionSubtitle: 'Tap any invoice to see line items' };", rule: 'R15', flag: false },
  { name: 'a key that ends in Title', file: 'a.ts', src: "const o = { changeOrdersTitle: 'Change orders' };", rule: 'R15', flag: true },
  { name: 'a sentence-case button in the page', file: 'a.html', src: '<p>Hi.</p><button class="b" type="button">Pay now</button>', rule: 'R15', flag: true },
  { name: 'a Title Case button in the page', file: 'a.html', src: '<button class="b">Pay Now</button><h2>Change Orders</h2>', rule: 'R15', flag: false },
  { name: 'a sentence-case table header', file: 'a.html', src: '<table><tr><th>Amount due</th></tr></table>', rule: 'R15', flag: true },
  { name: 'a heading that is a question', file: 'a.html', src: '<h2>Not what you expected?</h2>', rule: 'R15', flag: false },
  { name: 'a button written inside a script string', file: 'a.html', src: `<script>var h = '<button class="x">Send message</button>';</script>`, rule: 'R15', flag: true },
  { name: 'a dash in page text', file: 'a.html', src: '<p>Your contractor shared this &mdash; read it.</p>', rule: 'R20', flag: true },
  { name: 'a dash in an HTML comment or in CSS', file: 'a.html', src: '<!-- a — b --><style>.a::after{content:"—"}</style><p>Fine.</p>', rule: 'R20', flag: false },
  { name: '&amp; in page text', file: 'a.html', src: '<p>Scope &amp; price</p>', rule: 'R21', flag: true },
  { name: 'an arrow entity in a link', file: 'a.html', src: '<a href="/x">See the schedule &rarr;</a>', rule: 'R23', flag: true },
  { name: 'a dash in a script string', file: 'a.html', src: "<script>var s = 'Not sent — try again.';</script>", rule: 'R20', flag: true },
  { name: 'a dash in a script comment', file: 'a.html', src: "<script>// not sent — try again\nvar s = 'Not sent. Try again.';</script>", rule: 'R20', flag: false },
  { name: 'an aria-label in sentence case', file: 'a.html', src: '<div aria-label="Close this panel" role="button"></div>', rule: 'R15', flag: true },
];

/** Appended to a real converted file: each one must turn the guard red. */
const PLANTED: { name: string; rule: Rule; ts: string; html: string }[] = [
  { name: 'an em dash', rule: 'R20', ts: "\nexport const plantedA = 'Your link has ended — ask for a new one.';\n", html: '\n<p>Your link has ended — ask for a new one.</p>\n' },
  { name: 'an ampersand', rule: 'R21', ts: "\nexport const plantedB = { title: 'Photos & Files' };\n", html: '\n<p>Photos &amp; files</p>\n' },
  { name: 'an "e.g."', rule: 'R22', ts: "\nexport const plantedC = 'A trade, e.g. framing only';\n", html: '\n<p>A trade, e.g. framing only</p>\n' },
  { name: 'an arrow', rule: 'R23', ts: "\nexport const plantedD = 'Open the portal →';\n", html: '\n<p>Open the portal →</p>\n' },
  { name: '"unlimited"', rule: 'R24', ts: "\nexport const plantedE = 'Send unlimited invoices.';\n", html: '\n<p>Send unlimited invoices.</p>\n' },
  { name: 'a sentence-case label', rule: 'R15', ts: "\nexport const plantedF = { subject: 'Weekly project update' };\n", html: '\n<button type="button">Send my reply</button>\n' },
];

/** Everything wrong with the converted list and the allow-list themselves. */
export function listProblems(converted: string[], allow: Allow[], pinned: number = CONVERTED_PINNED): string[] {
  const out: string[] = [];
  if (converted.length !== pinned) out.push(`scripts/server-copy-style-converted.json has ${converted.length} files, CONVERTED_PINNED says ${pinned}. The list may only grow: raise the number in the same change.`);
  if (converted.join('\n') !== [...new Set(converted)].sort().join('\n')) out.push('the converted list is not sorted, or has a duplicate');
  for (const f of converted) {
    if (!existsSync(join(ROOT, f))) out.push(`converted file is missing: ${f}`);
    if (OUT_OF_SCOPE.test(f)) out.push(`${f} is a marketing or legal page and is not held to the app's copy style`);
    if (!/^(?:supabase\/functions|marketing)\//.test(f)) out.push(`${f} is not under supabase/functions/ or marketing/ (the app is held by validate-copy-voice)`);
  }
  for (const a of allow) {
    if (!a.reason || a.reason.trim().length < 12) out.push(`allow-list entry for ${a.file} has no reason`);
    if ((a.text === undefined) === (a.contains === undefined)) out.push(`allow-list entry for ${a.file} needs exactly one of "text" or "contains"`);
    if (a.contains !== undefined && a.contains.length < 8) out.push(`allow-list entry for ${a.file}: "contains" is too short to be one string`);
    if (!converted.includes(a.file)) out.push(`allow-list entry for a file that is not converted: ${a.file}`);
  }
  return out;
}

function selfTest(converted: string[], allow: Allow[]): string[] {
  const failures: string[] = [];
  for (const f of FIXTURES) {
    const got = scan(f.file, f.src, []).some((h) => h.rule === f.rule);
    if (got !== f.flag) failures.push(`fixture "${f.name}": ${f.rule} ${got ? 'fired' : 'stayed quiet'}, expected ${f.flag ? 'a hit' : 'none'}`);
  }
  const firstTs = converted.find((f) => f.endsWith('.ts'));
  const firstHtml = converted.find((f) => f.endsWith('.html'));
  for (const target of [firstTs, firstHtml]) {
    if (!target) continue;
    const src = readFileSync(join(ROOT, target), 'utf8');
    for (const p of PLANTED) {
      const mutated = src + (target.endsWith('.html') ? p.html : p.ts);
      const before = scan(target, src, allow).filter((h) => h.rule === p.rule).length;
      const after = scan(target, mutated, allow).filter((h) => h.rule === p.rule).length;
      if (after <= before) failures.push(`planted ${p.name} in ${target}: ${p.rule} stayed green`);
    }
  }
  // List edits: each one must be refused.
  if (converted.length > 0 && listProblems(converted, allow).length === 0) {
    const edits: [string, string[], Allow[]][] = [
      ['a file dropped from the list', converted.slice(1), allow.filter((a) => a.file !== converted[0])],
      ['a marketing page added to the list', [...converted, 'marketing/pricing.html'].sort(), allow],
      ['an app file added to the list', [...converted, 'app/paywall.tsx'].sort(), allow],
      ['the list out of order', [...converted].reverse(), allow],
      ['an allow-list entry with no reason', converted, [...allow, { file: converted[0], text: 'x y', reason: '' }]],
    ];
    for (const [name, list, al] of edits) {
      const pinned = name === 'a file dropped from the list' ? CONVERTED_PINNED : list.length;
      if (listProblems(list, al, pinned).length === 0) failures.push(`list edit "${name}" stayed green`);
    }
  }
  return failures;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const argOf = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? (args[i + 1] ?? '') : null; };
  const allow: Allow[] = existsSync(ALLOWLIST_PATH) ? JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')).entries : [];
  const converted: string[] = existsSync(CONVERTED_PATH) ? JSON.parse(readFileSync(CONVERTED_PATH, 'utf8')).files : [];

  const preview = argOf('--preview');
  const dump = argOf('--dump');
  if (preview !== null || dump !== null) {
    const wanted = (preview ?? dump ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const files: string[] = [];
    walk(join(ROOT, 'supabase', 'functions'), files);
    walk(join(ROOT, 'marketing'), files);
    let n = 0;
    for (const f of files.sort()) {
      if (!wanted.some((w) => f.includes(w))) continue;
      const src = readFileSync(join(ROOT, f), 'utf8');
      if (dump !== null) {
        for (const s of readFile(f, src)) console.log(`  ${f}:${s.line}  [${s.where}]  ${JSON.stringify(s.text.length > 200 ? s.text.slice(0, 200) + '…' : s.text)}`);
      } else {
        for (const h of scan(f, src, allow)) { console.log(show(h)); n++; }
      }
    }
    if (preview !== null) console.log(`\n  --preview: ${n} hit(s)`);
    return;
  }

  console.log('server and portal copy style (docs/VOICE.md §3 and §4):');
  let failed = false;
  const fail = (msg: string) => { failed = true; console.log(`  FAIL  ${msg}`); };

  // The list.
  for (const msg of listProblems(converted, allow)) fail(msg);
  if (!failed) console.log(`  PASS  the list (${converted.length} files, sorted, pinned; ${allow.length} allow-list entries, each with a reason)`);

  const st = selfTest(converted, allow);
  if (st.length) st.forEach(fail);
  else console.log(`  PASS  self-test (${FIXTURES.length} fixtures; ${PLANTED.length} planted mutations in a function file and in a page and 5 list edits, each one turns the guard red)`);

  const used = new Set<Allow>();
  const hits: Hit[] = [];
  let strings = 0;
  for (const f of converted) {
    if (!existsSync(join(ROOT, f))) continue;
    const src = readFileSync(join(ROOT, f), 'utf8');
    strings += readFile(f, src).length;
    hits.push(...scan(f, src, allow, used));
  }
  if (hits.length) {
    fail(`${hits.length} copy style hit(s):`);
    hits.forEach((h) => console.log(show(h)));
    console.log('        (R15: Title Case on a label. R20: no dash as punctuation. R21: "and", not "&". R22: no "e.g." / "i.e.". R23: no arrows. R24: never "unlimited".)');
  } else {
    console.log(`  PASS  copy style (R15, R20 to R24 are zero in ${converted.length} files, ${strings} strings read)`);
  }
  const stale = allow.filter((a) => !used.has(a));
  if (stale.length) {
    fail(`${stale.length} allow-list entr${stale.length === 1 ? 'y matches' : 'ies match'} nothing any more. Remove:`);
    stale.forEach((a) => console.log(`        ${a.file}: ${JSON.stringify(a.text ?? a.contains)}`));
  } else if (!hits.length) {
    console.log('  PASS  every allow-list entry still matches a string');
  }

  if (failed) {
    console.log('\nserver copy style: FAIL');
    process.exit(1);
  }
  console.log('\nserver copy style: PASS');
}

main();
