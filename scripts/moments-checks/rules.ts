// rules.ts: moments Step 0, the adoption rules every W2/W3 site obeys (lane MOMSTEP0).
//
// Loaded by scripts/validate-moments.ts. Text rules over every SITE: a file
// under app/ or components/ (outside components/moments/**) that renders
// <SlideToConfirm> or <SigningCeremony>. No site exists yet (W2 adopts), so
// each rule is proven here on planted good and bad strings, then run over the
// real tree (0 sites today: the rules pass vacuously and bite the moment a
// site lands).
//
//   R1 legal (plan rule 2): a slide with writeOptions.legal true, and EVERY
//      SigningCeremony (legal is forced), must pass `offline` (useOffline) to
//      that same element, and the handler it gives as the commit write
//      (onCommit / write, followed one hop into local helpers) must not call a
//      queue-backed write: supabaseWrite, supabaseWriteDetailed,
//      supabaseRpcDetailed, addToOfflineQueue, enqueue*.
//   R2 idempotent (plan rule 3): `idempotent: true` together with a
//      queue-backed write in the commit handler fails (a 20 s timeout on a
//      queued write never means "nothing was saved").
//   R3 moment copy (docs/I18N.md §3.5): writeOptions.copy carries `refused`
//      and `timeout` (and `legalQueued` when legal), each an expression that
//      CALLS a function imported from utils/moments/sites/*: never a string
//      literal, never a template assembled in the screen. A site that calls
//      the English frames (genericRefusedCopy / timeoutCopy / legalQueuedCopy
//      / transportCopy) fails.
//   R4 sites copy: every copy string in utils/moments/sites/*.ts lints clean
//      (lintMomentCopy), and no sites export is called inside a template
//      literal or next to `+` (each function returns one whole sentence).
//   R5 confetti ratchet: fireConfetti( call sites in app/ + components/
//      (the definition in components/animations/Confetti.tsx excluded) and
//      fireWebConfetti( calls in marketing/portal/index.html (its definition
//      excluded) may not rise above today's CEILINGS. Below a ceiling prints
//      "lower the ceiling to N". W2 retires the app sites; W3 takes both to 0.
//   R6 confetti is gone (W3 close-out, lane MOMPORTAL): ZERO occurrences of
//      fireConfetti / ConfettiHost / fireWebConfetti in the code of app/,
//      components/ (moments included) and marketing/ — definitions, imports
//      and JSX included, the deleted components/animations/Confetti.tsx not
//      excepted. Comments are stripped first: a sentence that explains why a
//      thing is gone is not the thing. Success is the capsule's check and the
//      seal, never confetti (plan rule 4).

import type { MomentsCtx } from '../validate-moments';
import { lintMomentCopy } from '../../utils/moments/copy';

type Fails = string[];

/** Both at 0 since W3 (2026-09-28): the app's burst was deleted (ESSHELL), the portal's retired (MOMPORTAL). */
export const CONFETTI_CEILING = { app: 0, portal: 0 } as const;

/** R6: every name the confetti ever went by. */
export const CONFETTI_NAMES = /\b(fireConfetti|ConfettiHost|fireWebConfetti)\b/g;
/** R6 over one file's comment-stripped text: each hit as `name@line`. */
export function confettiHits(codeText: string): string[] {
  const out: string[] = [];
  for (const m of codeText.matchAll(CONFETTI_NAMES)) {
    const line = codeText.slice(0, m.index ?? 0).split('\n').length;
    out.push(`${m[1]}@${line}`);
  }
  return out;
}

const MOMENT_TAGS = ['SlideToConfirm', 'SigningCeremony'] as const;
const QUEUE_BACKED = /\b(supabaseWrite|supabaseWriteDetailed|supabaseRpcDetailed|addToOfflineQueue|enqueue\w*)\s*\(/;
const FRAMES = /\b(genericRefusedCopy|timeoutCopy|legalQueuedCopy|transportCopy)\s*\(/;
const SITES_DIR = 'utils/moments/sites';

// ─────────────────────────────────────────────────────────────────────────────
// a small scanner (strings, templates, brackets)
// ─────────────────────────────────────────────────────────────────────────────

/** Index just past the string or template literal that starts at `i`. */
export function skipString(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') { j += 2; continue; }
    if (q !== '`' && src[j] === '\n') return j;
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') {
      const end = closeOf(src, j + 1);
      if (end < 0) return src.length;
      j = end;
      continue;
    }
    j++;
  }
  return j + 1;
}

/** Index just past the bracket that closes the one at `open` ('{', '(' or '['); -1 when unbalanced. */
export function closeOf(src: string, open: number): number {
  const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
  const stack: string[] = [];
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i);
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === '}' || c === ')' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

export interface JsxEl { tag: string; attrs: Map<string, string>; start: number }

/** Every `<Tag …>` opening element in `code`, with its attributes (value text inside `{}` or the string). */
export function jsxElements(code: string, tag: string): JsxEl[] {
  const out: JsxEl[] = [];
  const re = new RegExp(`<${tag}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const attrs = new Map<string, string>();
    let i = m.index + m[0].length;
    for (;;) {
      while (i < code.length && /\s/.test(code[i])) i++;
      if (i >= code.length || code[i] === '>' || (code[i] === '/' && code[i + 1] === '>')) break;
      if (code[i] === '{') { // {...spread}
        const end = closeOf(code, i);
        if (end < 0) break;
        attrs.set(`...${attrs.size}`, code.slice(i + 1, end - 1));
        i = end;
        continue;
      }
      const nm = /^[A-Za-z_][\w-]*/.exec(code.slice(i));
      if (!nm) break;
      i += nm[0].length;
      if (code[i] === '=') {
        i++;
        if (code[i] === '{') {
          const end = closeOf(code, i);
          if (end < 0) break;
          attrs.set(nm[0], code.slice(i + 1, end - 1).trim());
          i = end;
        } else if (code[i] === '"' || code[i] === "'") {
          const q = code[i];
          const end = code.indexOf(q, i + 1);
          attrs.set(nm[0], JSON.stringify(code.slice(i + 1, end)));
          i = end + 1;
        }
      } else {
        attrs.set(nm[0], 'true');
      }
    }
    out.push({ tag, attrs, start: m.index });
  }
  return out;
}

/** The text a local name is defined as: the first balanced `{…}` after `const NAME =` (an object, or a function body). */
export function definitionBody(code: string, name: string): string | null {
  const decl = new RegExp(`(?:const|let|var)\\s+${name}\\b[^=\\n]*=\\s*|function\\s+${name}\\s*\\(`).exec(code);
  if (!decl) return null;
  const from = decl.index + decl[0].length;
  // An arrow with an expression body: `const f = () => write(x);`
  const arrow = /^(?:useCallback\(\s*)?(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>\s*(?!\{|\()/.exec(code.slice(from));
  if (arrow) {
    const rest = code.slice(from + arrow[0].length);
    const semi = rest.search(/;\s*\n|,\s*\[/);
    return rest.slice(0, semi < 0 ? rest.length : semi);
  }
  const open = code.indexOf('{', from);
  if (open < 0) return null;
  const end = closeOf(code, open);
  return end < 0 ? null : code.slice(open, end);
}

/** A value text that is an identifier (maybe `this.x`-free), resolved one level to its definition. */
function resolveValue(code: string, value: string | undefined): string {
  if (!value) return '';
  const v = value.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(v)) return definitionBody(code, v) ?? v;
  return v;
}

/** The commit handler's text, plus one hop into the local functions it calls. */
export function handlerText(code: string, value: string | undefined): string {
  const first = resolveValue(code, value);
  let text = first;
  const called = new Set<string>();
  const re = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(first))) called.add(m[1]);
  for (const name of called) {
    if (!new RegExp(`(?:const|let|var)\\s+${name}\\b[^=\\n]*=\\s*(?:useCallback\\(\\s*)?(?:async\\s*)?\\(|function\\s+${name}\\s*\\(`).test(code)) continue;
    const body = definitionBody(code, name);
    if (body) text += `\n${body}`;
  }
  return text;
}

/** `key: <expr>` at the top level of an object literal's text (`{ … }` or bare). */
export function objectProp(objText: string, key: string): string | undefined {
  const body = objText.trim().startsWith('{') ? objText.trim().slice(1, -1) : objText;
  // Walk top-level entries.
  let depth = 0;
  let start = 0;
  const entries: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{' || c === '(' || c === '[') {
      const end = closeOf(body, i);
      if (end < 0) break;
      i = end - 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(body, i) - 1;
      continue;
    }
    if (c === ',' && depth === 0) { entries.push(body.slice(start, i)); start = i + 1; }
  }
  entries.push(body.slice(start));
  for (const e of entries) {
    const m = new RegExp(`^\\s*${key}\\s*(:|,|$)`).exec(e);
    if (!m) continue;
    if (m[1] === ':') return e.slice(m.index + m[0].length).trim();
    return key; // shorthand
  }
  return undefined;
}

/** Names this file imports from utils/moments/sites/* (named imports and namespaces). */
export function siteImports(code: string): Set<string> {
  const out = new Set<string>();
  const re = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (!/utils\/moments\/sites\//.test(m[2])) continue;
    const clause = m[1];
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (ns) out.add(ns[1]);
    const named = /\{([\s\S]*?)\}/.exec(clause);
    if (named) for (const part of named[1].split(',')) {
      const p = part.trim();
      if (!p) continue;
      const as = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(p);
      out.add(as ? as[1] : p.replace(/^type\s+/, ''));
    }
  }
  return out;
}

/** An expression that CALLS a function imported from utils/moments/sites/* (`fn(…)` or `ns.fn(…)`). */
export function isSiteCopyCall(expr: string | undefined, imports: Set<string>): boolean {
  if (!expr) return false;
  const e = expr.trim();
  if (/^['"`]/.test(e)) return false;
  const m = /^(?:await\s+)?([A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)?\s*\(/.exec(e);
  return !!m && imports.has(m[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// the rules (pure, on one file's text)
// ─────────────────────────────────────────────────────────────────────────────

/** R1 + R2 + R3 for one site file. `code` has comments stripped. */
export function checkSite(path: string, code: string): Fails {
  const f: Fails = [];
  const imports = siteImports(code);
  if (FRAMES.test(code)) f.push(`${path}: R3 calls an English frame (${FRAMES.exec(code)?.[1]}) — pass whole sentences from utils/moments/sites/*`);
  for (const tag of MOMENT_TAGS) {
    for (const el of jsxElements(code, tag)) {
      const at = `${path} <${tag}> @${el.start}`;
      const wo = resolveValue(code, el.attrs.get('writeOptions'));
      const legal = tag === 'SigningCeremony' || /\blegal\s*:\s*true\b/.test(wo);
      const commit = handlerText(code, el.attrs.get(tag === 'SigningCeremony' ? 'write' : 'onCommit'));
      const queueBacked = QUEUE_BACKED.exec(commit)?.[1];
      if (legal) {
        const off = el.attrs.get('offline');
        if (off === undefined || /^false$/.test(off.trim())) f.push(`${at}: R1 a legal moment must pass offline={useOffline()} to the same element`);
        if (queueBacked) f.push(`${at}: R1 a legal commit write calls ${queueBacked}( (queue-backed): use the online-only write`);
      }
      if (/\bidempotent\s*:\s*true\b/.test(wo) && queueBacked) f.push(`${at}: R2 idempotent: true with a queue-backed write (${queueBacked}) in the commit handler`);
      const copy = resolveValue(code, objectProp(wo, 'copy'));
      const keys = legal ? ['refused', 'timeout', 'legalQueued'] : ['refused', 'timeout'];
      if (!copy) { f.push(`${at}: R3 writeOptions.copy missing (${keys.join(', ')} as whole sentences from utils/moments/sites/*)`); continue; }
      for (const k of keys) {
        const expr = objectProp(copy, k);
        if (!isSiteCopyCall(expr, imports)) f.push(`${at}: R3 copy.${k} must call a function imported from utils/moments/sites/* (got ${expr === undefined ? 'nothing' : JSON.stringify(expr.slice(0, 60))})`);
      }
    }
  }
  return f;
}

/** Every string literal that reads as copy (a letter and a space; template placeholders become X). */
export function copyStrings(code: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, 'X').replace(/\\'/g, "'");
    if (!/[A-Za-z]/.test(raw) || !/\s/.test(raw)) continue;
    if (/^(?:@\/|\.{1,2}\/)/.test(raw)) continue;
    out.push(raw);
  }
  return out;
}

/** R4 for one utils/moments/sites/*.ts file, given every sites export name. */
export function checkSitesFile(path: string, code: string, exportNames: Set<string>): Fails {
  const f: Fails = [];
  if (FRAMES.test(code)) f.push(`${path}: R3 builds a sentence from an English frame (${FRAMES.exec(code)?.[1]})`);
  for (const s of copyStrings(code)) {
    const lint = lintMomentCopy(s);
    if (lint.length) f.push(`${path}: R4 "${s}": ${lint.join(', ')}`);
  }
  f.push(...checkNoFragments(path, code, exportNames));
  return f;
}

/** R4: no sites export is called inside `${…}` or next to `+` (a sentence is never assembled from fragments). */
export function checkNoFragments(path: string, code: string, exportNames: Set<string>): Fails {
  const f: Fails = [];
  for (const name of exportNames) {
    const inTpl = new RegExp(`\\$\\{[^}]*\\b${name}\\s*\\(`).test(code);
    const plusAfter = new RegExp(`\\b${name}\\s*\\([^;\\n]*?\\)\\s*\\+`).test(code);
    const plusBefore = new RegExp(`\\+\\s*${name}\\s*\\(`).test(code);
    if (inTpl || plusAfter || plusBefore) f.push(`${path}: R4 ${name}() is concatenated into a bigger sentence`);
  }
  return f;
}

/** Exported function / const names of a sites file. */
export function exportsOf(code: string): string[] {
  const out: string[] = [];
  const re = /export\s+(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.push(m[1] ?? m[2]);
  return out;
}

/** R5: call sites (not definitions, not comments). */
export function countCalls(code: string, fn: string): number {
  const calls = (code.match(new RegExp(`\\b${fn}\\(`, 'g')) ?? []).length;
  const defs = (code.match(new RegExp(`function\\s+${fn}\\(`, 'g')) ?? []).length;
  return calls - defs;
}

/**
 * R5: the ratchet decision, pure. Over the ceiling fails; at it passes; under
 * it passes with the "lower the ceiling" note (a retired site is progress,
 * never a red gate for the lane that retired it).
 */
export function confettiRatchet(count: number, ceiling: number): { pass: boolean; lowerTo?: number } {
  if (count > ceiling) return { pass: false };
  return count < ceiling ? { pass: true, lowerTo: count } : { pass: true };
}

/** Strip // and /* *\/ comments from HTML-embedded JS and <!-- --> blocks (strings kept). */
function stripHtmlComments(src: string, strip: (s: string) => string): string {
  return strip(src.replace(/<!--[\s\S]*?-->/g, ''));
}

// ─────────────────────────────────────────────────────────────────────────────
// planted proofs
// ─────────────────────────────────────────────────────────────────────────────

const GOOD_LEGAL = `
import { SigningCeremony } from '@/components/moments/signing/SigningCeremony';
import { useOffline } from '@/hooks/useOnline';
import { ticketSigned, ticketRefused, ticketTimeout, ticketLegalQueued } from '@/utils/moments/sites/signingCopy';
function Sheet() {
  const offline = useOffline();
  const handleSign = useCallback(async () => {
    const r = await signFieldTicket(input);
    return fromOnlineOutcome(r, { title: ticketSigned(n) }, { refused: ticketRefused(), timeout: ticketTimeout(n) });
  }, [input]);
  return <SigningCeremony write={handleSign} offline={offline} writeOptions={{ idempotent: false, copy: { refused: ticketRefused(), timeout: ticketTimeout(n), legalQueued: ticketLegalQueued() } }} />;
}`;

const GOOD_MONEY = `
import * as money from '@/utils/moments/sites/moneyCopy';
function Sheet() {
  const approve = async () => fromWriteOutcome(await approveChangeOrder(co.id), { title: money.coApproved(co) }, { refused: money.coRefused() });
  const writeOptions = useMemo(() => ({ idempotent: false, copy: { refused: money.coRefused(), timeout: money.coTimeout(co.number) } }), [co]);
  return <SlideToConfirm onCommit={approve} writeOptions={writeOptions} label="x" />;
}`;

const PLANTED: [string, string, RegExp][] = [
  ['R1 legal without offline', GOOD_LEGAL.replace(' offline={offline}', ''), /R1 a legal moment must pass offline/],
  ['R1 legal commit that queues', GOOD_LEGAL.replace('await signFieldTicket(input)', "await supabaseWriteDetailed('field_tickets', 'update', row)"), /R1 a legal commit write calls supabaseWriteDetailed/],
  ['R1 legal commit that queues one hop down', GOOD_LEGAL.replace('await signFieldTicket(input)', 'await persistTicket(input)').replace('function Sheet() {', "const persistTicket = async (i) => { enqueueWrite(i); };\nfunction Sheet() {"), /R1 a legal commit write calls enqueueWrite/],
  ['R1 legal slide without offline', GOOD_MONEY.replace('idempotent: false,', 'idempotent: false, legal: true,').replace('money.coTimeout(co.number) }', 'money.coTimeout(co.number), legalQueued: money.coLegal() }'), /R1 a legal moment must pass offline/],
  ['R2 idempotent with a queued write', GOOD_MONEY.replace('idempotent: false', 'idempotent: true').replace('await approveChangeOrder(co.id)', "await supabaseWrite('change_orders', 'update', row)"), /R2 idempotent: true with a queue-backed write/],
  ['R3 refused as a string literal', GOOD_MONEY.replace('copy: { refused: money.coRefused(),', "copy: { refused: 'Not approved. Something went wrong on our side.',"), /R3 copy\.refused must call/],
  ['R3 timeout as a template in the screen', GOOD_MONEY.replace('timeout: money.coTimeout(co.number)', 'timeout: `No answer yet. Check CO #${co.number} before trying again.`'), /R3 copy\.timeout must call/],
  ['R3 copy missing', GOOD_MONEY.replace(", copy: { refused: money.coRefused(), timeout: money.coTimeout(co.number) }", ''), /R3 writeOptions\.copy missing/],
  ['R3 legalQueued missing on a legal ceremony', GOOD_LEGAL.replace(', legalQueued: ticketLegalQueued()', ''), /R3 copy\.legalQueued must call/],
  ['R3 an English frame in a site', GOOD_MONEY.replace('money.coRefused() });', 'genericRefusedCopy("approved") });'), /R3 calls an English frame/],
  ['R3 a function not from sites', GOOD_MONEY.replace('refused: money.coRefused(), timeout', 'refused: localWords(), timeout'), /R3 copy\.refused must call/],
];

function plantedProofs(): { good: Fails; bad: [string, boolean, string][] } {
  const good = [...checkSite('planted/good-legal.tsx', GOOD_LEGAL), ...checkSite('planted/good-money.tsx', GOOD_MONEY)];
  const bad: [string, boolean, string][] = PLANTED.map(([name, code, expect]) => {
    const fails = checkSite(`planted/${name}.tsx`, code);
    return [name, fails.some((x) => expect.test(x)), fails.join(' | ')];
  });
  return { good, bad };
}

function plantedSitesProofs(): [string, boolean][] {
  const names = new Set(['coApproved', 'coRefused', 'coTimeout']);
  const good = [
    "export function coApproved(n: number, total: string): string { return `CO #${n} approved · contract ${total}`; }",
    "export function coRefused(): string { return 'Not approved. Something went wrong on our side.'; }",
  ].join('\n');
  const out: [string, boolean][] = [];
  out.push(['R4 clean sites file passes', checkSitesFile('planted/sites/good.ts', good, names).length === 0]);
  out.push(['R4 a Title Case sentence is red', checkSitesFile('planted/sites/bad.ts', "export function coRefused(): string { return 'Not Approved Something Went Wrong.'; }", names).length > 0]);
  out.push(['R4 an amount without cents is red', checkSitesFile('planted/sites/bad.ts', "export function coApproved(): string { return 'Approved $4,200 today'; }", names).length > 0]);
  out.push(['R4 a fragment concatenated in a template is red', checkNoFragments('planted/site.tsx', 'const s = `${coRefused()} Try again.`;', names).length > 0]);
  out.push(['R4 a fragment joined with + is red', checkNoFragments('planted/site.tsx', "const s = coRefused() + ' Try again.';", names).length > 0]);
  out.push(['R4 an English frame in a sites file is red', checkSitesFile('planted/sites/bad.ts', "export function coRefused(): string { return genericRefusedCopy('approved'); }", names).length > 0]);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function run(ctx: MomentsCtx): void {
  const { ok, read, stripComments, listFiles } = ctx;

  // Planted proofs first: a rule that cannot see a planted defect proves nothing.
  const p = plantedProofs();
  ok('R1-R3 planted good sites (a legal ceremony, a money slide) pass', p.good.length === 0, p.good.join('\n'));
  for (const [name, red, detail] of p.bad) ok(`R1-R3 red on planted: ${name}`, red, detail || 'no failure reported');
  for (const [name, pass] of plantedSitesProofs()) ok(`${name}`, pass);

  // The real tree.
  const files = [...listFiles('app', ['.ts', '.tsx']), ...listFiles('components', ['.ts', '.tsx'])]
    .filter((x) => !x.startsWith('components/moments/'));
  const sites: string[] = [];
  const siteFails: Fails = [];
  const codeOf = new Map<string, string>();
  for (const path of files) {
    const code = stripComments(read(path));
    if (!MOMENT_TAGS.some((t) => new RegExp(`<${t}\\b`).test(code))) continue;
    sites.push(path);
    codeOf.set(path, code);
    siteFails.push(...checkSite(path, code));
  }
  ok(`R1-R3 every site passes offline on legal moments, never queues a legal or idempotent write, and takes its outcome sentences from utils/moments/sites/* (${sites.length} site file${sites.length === 1 ? '' : 's'}${sites.length ? `: ${sites.join(', ')}` : ''})`,
    siteFails.length === 0, siteFails.join('\n'));

  const sitesFiles = listFiles(SITES_DIR, ['.ts']);
  const exportNames = new Set<string>();
  const sitesCode = new Map<string, string>();
  for (const path of sitesFiles) {
    const code = stripComments(read(path));
    sitesCode.set(path, code);
    for (const n of exportsOf(code)) exportNames.add(n);
  }
  const r4: Fails = [];
  for (const [path, code] of sitesCode) r4.push(...checkSitesFile(path, code, exportNames));
  for (const [path, code] of codeOf) r4.push(...checkNoFragments(path, code, exportNames));
  ok(`R4 utils/moments/sites/* copy lints clean and every sentence is returned whole (${sitesFiles.length} file${sitesFiles.length === 1 ? '' : 's'})`, r4.length === 0, r4.join('\n'));

  // R5 confetti ratchet
  let app = 0;
  const where: string[] = [];
  for (const path of files) {
    if (path === 'components/animations/Confetti.tsx') continue;
    const n = countCalls(stripComments(read(path)), 'fireConfetti');
    if (n > 0) { app += n; where.push(`${path} x${n}`); }
  }
  const portalSrc = read('marketing/portal/index.html');
  const portal = portalSrc ? countCalls(stripHtmlComments(portalSrc, stripComments), 'fireWebConfetti') : 0;
  const appR = confettiRatchet(app, CONFETTI_CEILING.app);
  const portalR = confettiRatchet(portal, CONFETTI_CEILING.portal);
  ok(`R5 fireConfetti( call sites in app/ + components/ stay at or under the ceiling (${app} of ${CONFETTI_CEILING.app}: ${where.join(', ') || 'none'})`,
    appR.pass, `A new confetti burst: success is the capsule's check, not confetti (plan rule 4). Found ${app}.`);
  ok(`R5 fireWebConfetti( calls in marketing/portal/index.html stay at or under the ceiling (${portal} of ${CONFETTI_CEILING.portal})`,
    portalR.pass, `Found ${portal}.`);
  if (appR.lowerTo !== undefined) console.log(`        note: fireConfetti count is ${app}: lower the ceiling to ${appR.lowerTo} (scripts/moments-checks/rules.ts CONFETTI_CEILING.app)`);
  if (portalR.lowerTo !== undefined) console.log(`        note: fireWebConfetti count is ${portal}: lower the ceiling to ${portalR.lowerTo} (scripts/moments-checks/rules.ts CONFETTI_CEILING.portal)`);
  // The ratchet itself bites, proven on synthetic numbers and planted code,
  // never on today's live count (a lane that retires a site must stay green).
  for (const [name, pass] of confettiRatchetProofs()) ok(name, pass);

  // R6: nothing named confetti is left in the shipped code.
  const r6Files = [
    ...listFiles('app', ['.ts', '.tsx']),
    ...listFiles('components', ['.ts', '.tsx']),
    ...listFiles('marketing', ['.html', '.js', '.css', '.ts', '.tsx']),
  ];
  const r6: string[] = [];
  for (const path of r6Files) {
    const src = read(path);
    const hits = confettiHits(path.endsWith('.html') ? stripHtmlComments(src, stripComments) : stripComments(src));
    if (hits.length) r6.push(`${path}: ${hits.join(', ')}`);
  }
  ok(`R6 zero fireConfetti / ConfettiHost / fireWebConfetti in the code of app/, components/ and marketing/ (${r6Files.length} files, definitions included)`,
    r6Files.length > 200 && r6.length === 0, r6.join('\n') || `only ${r6Files.length} files scanned: the walk is broken`);
  for (const [name, pass] of confettiGoneProofs(stripComments)) ok(name, pass);
}

/** R6 planted proofs: a definition, an import, JSX and a portal call are each found; a comment is not. */
export function confettiGoneProofs(strip: (s: string) => string): [string, boolean][] {
  const hit = (s: string) => confettiHits(strip(s)).length > 0;
  return [
    ['R6 red on planted: a fireConfetti definition', hit('export function fireConfetti(opts?: { count: number }) {}')],
    ['R6 red on planted: an import of ConfettiHost', hit("import { ConfettiHost } from '@/components/animations/Confetti';")],
    ['R6 red on planted: <ConfettiHost /> in a layout', hit('return (<View>{children}<ConfettiHost /></View>);')],
    ['R6 red on planted: a fireWebConfetti call in a page script', hit("if (ok) fireWebConfetti();")],
    ['R6 a comment that says why confetti is gone stays green', !hit('// No fireConfetti here: success is the seal.\n/* ConfettiHost was deleted in W3. */\nconst x = 1;')],
  ];
}

/** R5 planted proofs, independent of the live counts and of the ceiling's value. */
export function confettiRatchetProofs(): [string, boolean][] {
  const out: [string, boolean][] = [];
  for (const ceiling of [...new Set([0, 1, CONFETTI_CEILING.app, CONFETTI_CEILING.portal])]) {
    const over = confettiRatchet(ceiling + 1, ceiling);
    const at = confettiRatchet(ceiling, ceiling);
    out.push([`R5 red on planted: ${ceiling + 1} calls over a ceiling of ${ceiling} fail`, over.pass === false]);
    out.push([`R5 ${ceiling} calls at a ceiling of ${ceiling} pass with no note`, at.pass === true && at.lowerTo === undefined]);
    if (ceiling > 0) {
      const under = confettiRatchet(ceiling - 1, ceiling);
      out.push([`R5 ${ceiling - 1} calls under a ceiling of ${ceiling} pass and say "lower the ceiling to ${ceiling - 1}"`, under.pass === true && under.lowerTo === ceiling - 1]);
    }
  }
  // countCalls: N planted calls plus a definition count N,
  // and N = ceiling + 1 fails the ratchet.
  const n = CONFETTI_CEILING.app + 1;
  const planted = [
    ...Array.from({ length: n }, (_, i) => (i % 2 ? 'fireConfetti();' : 'fireConfetti({ count: 1 });')),
    'export function fireConfetti() {}',
  ].join('\n');
  const counted = countCalls(planted, 'fireConfetti');
  out.push([`R5 red on planted: ${n} fireConfetti calls count ${n} (a definition does not) and fail the ceiling of ${CONFETTI_CEILING.app}`,
    counted === n && confettiRatchet(counted, CONFETTI_CEILING.app).pass === false]);
  return out;
}
