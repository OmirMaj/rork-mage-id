// scripts/validate-w5-benchmark-financing-client.ts — wave 5, benchmark-financing lane.
//
// The app half of three findings:
//   #79  the Public Price Index switch — the choice is per ACCOUNT, read and
//        written through RPCs, and the switch shows what the server stored
//        (no optimistic flip over an UPDATE that matched 0 rows); "On" with
//        nothing on file says "nothing to publish yet".
//   #84  Cost Truth contributions go through contribute_benchmark_rate (the
//        client never writes cost_benchmark_samples), and a benchmark the
//        server withholds (below 5 other contractors, n NULL) reads
//        "building", never a fabricated "0 of 5".
//   #180 financing: the emailed ref is the capability — ensureReferral returns
//        '' when its row wasn't created and the email block refuses a ref that
//        isn't `fin_` + 32 hex, the same REF_RE financing-redirect accepts;
//        financing-redirect no longer demands a header a browser link can't
//        send, and the portal branch proves the homeowner with
//        portal_project_for_token.
//
// Pure functions are EXECUTED: their source is lifted out of the module and
// transpiled with Bun.Transpiler, because the modules themselves import the
// Supabase client and React Native. The DB half is executed in PGlite (the
// script named in 20260923180000's header).
//
// Run via: bun run scripts/validate-w5-benchmark-financing-client.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
/** Source with // and /* *\/ comments removed (so a comment can't satisfy a code check). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/**
 * Lift `function <name>(…) {…}` (optionally exported) out of a source file:
 * the parameter list is paren-matched (it may hold an object type), the body
 * is the first `{` after it (none of the lifted functions has a brace in its
 * return type) and is brace-matched.
 */
function liftFunction(src: string, name: string): string {
  const m = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) return '';
  let j = m.index + m[0].length - 1, paren = 0;
  for (; j < src.length; j++) {
    if (src[j] === '(') paren++;
    else if (src[j] === ')') { paren--; if (paren === 0) break; }
  }
  const open = src.indexOf('{', j);
  let depth = 0;
  for (let p = open; p < src.length; p++) {
    if (src[p] === '{') depth++;
    else if (src[p] === '}') { depth--; if (depth === 0) return src.slice(m.index, p + 1).replace(/^export\s+/, ''); }
  }
  return '';
}
// Bun's global (the repo's tsconfig has no bun types; same declaration as
// validate-ai-failure-copy.ts).
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};
const transpiler = new Bun.Transpiler({ loader: 'ts' });
/**
 * Evaluate lifted sources and return `expr`. A function that is missing (the
 * old code never had it) is a FAILED check, not a crash: the returned stub
 * answers undefined, so every behavioural assertion on it goes red too.
 */
function load<T>(sources: string[], expr: string): T {
  if (sources.some((s) => !s.trim())) {
    ok(`${expr} exists and can be lifted`, false);
    return ((() => undefined) as unknown) as T;
  }
  try {
    const js = transpiler.transformSync(sources.join('\n\n') + `\n;globalThis.__w5bf = (${expr});`);
    new Function(js)();
    return (globalThis as unknown as { __w5bf: T }).__w5bf;
  } catch (e) {
    ok(`${expr} evaluates`, false, String(e));
    return ((() => undefined) as unknown) as T;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// #84 / #79 · hooks/useCostBenchmark.ts
// ════════════════════════════════════════════════════════════════════════════
const hookSrc = read('hooks/useCostBenchmark.ts');
const hook = code(hookSrc);
ok('hook source loaded', hook.length > 0);

type Stats = { median: number | null; p25: number | null; p75: number | null; n: number } | null;
const benchmarkStatsFromRow = load<(r: unknown) => Stats>([liftFunction(hookSrc, 'benchmarkStatsFromRow')], 'benchmarkStatsFromRow');
ok('a withheld row (median + n NULL — used only once a benchmark reopens) is not stats',
  benchmarkStatsFromRow({ median: null, p25: null, p75: null, n: null }) === null);
ok('…even if a server ever sent n without a median, no "n of 5" is fabricated',
  benchmarkStatsFromRow({ median: null, p25: null, p75: null, n: 0 }) === null);
{
  const s = benchmarkStatsFromRow({ median: '12.5', p25: '10', p75: '15', n: 6 });
  ok('an unlocked benchmark maps to numbers', !!s && s.median === 12.5 && s.p25 === 10 && s.p75 === 15 && s.n === 6, JSON.stringify(s));
}

type IndexState = { optIn: boolean; ratesOnFile: number } | null;
const parsePublicIndexState = load<(d: unknown) => IndexState>([liftFunction(hookSrc, 'parsePublicIndexState')], 'parsePublicIndexState');
ok('the stored opt-in is read from the RPC\'s jsonb',
  JSON.stringify(parsePublicIndexState({ public_index_opt_in: true, rates_on_file: 3 })) === '{"optIn":true,"ratesOnFile":3}');
ok('an answer without a boolean is NOT read as Off (null → the switch stays locked)',
  parsePublicIndexState({ rates_on_file: 0 }) === null && parsePublicIndexState(null) === null && parsePublicIndexState([]) === null);

const publicIndexCopy = load<(a: { publicOptIn: boolean | null; unreadable: boolean; ratesOnFile: number | null; publishableCount: number }) => string>(
  [liftFunction(hookSrc, 'publicIndexCopy')], 'publicIndexCopy');
{
  const onEmpty = publicIndexCopy({ publicOptIn: true, unreadable: false, ratesOnFile: 0, publishableCount: 0 });
  ok('#79: On with nothing on file says "nothing to count yet"', /^On — nothing to count yet/.test(onEmpty), onEmpty);
  ok('…and does not claim his rates are helping build the index', !/help build/.test(onEmpty), onEmpty);
  const onRates = publicIndexCopy({ publicOptIn: true, unreadable: false, ratesOnFile: 4, publishableCount: 4 });
  ok('On with measured rates says they are kept for the index', /measured rates are kept for the public price index/.test(onRates) && !/nothing to count/.test(onRates), onRates);
  const onPending = publicIndexCopy({ publicOptIn: true, unreadable: false, ratesOnFile: 0, publishableCount: 2 });
  ok('On with rates being sent this open is not "nothing to count"', !/nothing to count/.test(onPending), onPending);
  const off = publicIndexCopy({ publicOptIn: false, unreadable: false, ratesOnFile: 3, publishableCount: 3 });
  ok('Off says the rates stay private', /^Off\. Your rates stay private/.test(off), off);
  const unread = publicIndexCopy({ publicOptIn: null, unreadable: true, ratesOnFile: null, publishableCount: 0 });
  ok('an unreadable setting says so instead of showing Off', /Couldn't load your Public Price Index setting/.test(unread), unread);
  const loading = publicIndexCopy({ publicOptIn: null, unreadable: false, ratesOnFile: null, publishableCount: 0 });
  ok('while loading it says loading', /^Loading/.test(loading), loading);
  // round-2 review: NOTHING is published (#84) — k fell to one sybil, the 5%
  // grid fell to a threshold search. No state may say or imply that his
  // rates are live in an index, or promise a floor / rounding the server no
  // longer runs.
  const all = [onEmpty, onRates, onPending, off, unread];
  ok('every settled state says the index isn\'t published yet',
    all.every((c) => /isn't (published|live) yet/.test(c)), all.join(' | '));
  ok('…and none claims a publishing rule or contribution that does not exist',
    all.every((c) => !/help build|rounded quartiles|\d\+ contractors|never your numbers|is published once/i.test(c)), all.join(' | '));
}
ok('the hook comment states the proven rule — NO AGGREGATE IS PUBLISHED — and why (threshold search)',
  /NO AGGREGATE IS PUBLISHED/.test(hookSrc) && /threshold search/.test(hookSrc)
  && !/can no longer solve/.test(hookSrc) && !/0\.3%-4\.7%/.test(hookSrc) && !/neighbourhood, not the price/.test(hookSrc));
{
  const gate = (/export const MARKET_BENCHMARK_PUBLISHED: boolean = (\w+);/.exec(hook) ?? [])[1];
  ok('#84: MARKET_BENCHMARK_PUBLISHED is exported and FALSE', gate === 'false', String(gate));
  const eff = hook.slice(Math.max(0, hook.indexOf("rpc('contribute_benchmark_rate'")));
  const gateAt = eff.indexOf('if (!MARKET_BENCHMARK_PUBLISHED) {');
  ok('…and the stats read returns BEFORE any cost_benchmark_stats call while it is false',
    gateAt > 0 && gateAt < eff.indexOf("rpc('cost_benchmark_stats'")
    && /if \(!MARKET_BENCHMARK_PUBLISHED\) \{\s*if \(!cancelled\) \{ setStats\(\{\}\); setBuilding\(\{\}\); setLoading\(false\); \}\s*return;\s*\}/.test(eff));
  const w = (/export const MARKET_BENCHMARK_WITHHELD_COPY =\s*"([^"]+)";/.exec(hookSrc) ?? [])[1] ?? '';
  ok('the withheld line says no market figure is shown and why', /isn't shown yet/.test(w) && /exact price/.test(w) && /logged job costs/.test(w), w);
}

ok('#84: the hook never writes cost_benchmark_samples directly',
  !/\.from\(\s*['"]cost_benchmark_samples['"]\s*\)/.test(hook));
ok('…contributions go through contribute_benchmark_rate',
  /supabase\.rpc\(\s*'contribute_benchmark_rate'/.test(hook));
ok('…with only category / unit / price — the opt-in is never sent (no race with the read)',
  /const rows = contributions\.map\(\(k\) => \(\{\s*p_category: k\.trade,\s*p_unit: k\.unit,\s*p_unit_price: k\.personalRate,\s*\}\)\)/.test(hook)
  && !/public_index_opt_in\s*:/.test(hook));
ok('#79: the opt-in is read through get_benchmark_public_opt_in (no arbitrary .limit(1) row)',
  /supabase\.rpc\(\s*'get_benchmark_public_opt_in'\s*\)/.test(hook) && !/\.limit\(1\)/.test(hook));
{
  const setFn = (/const setPublicOptIn = async[\s\S]*?\n  \};/.exec(hook) ?? [''])[0];
  ok('#79: the switch is written through set_benchmark_public_opt_in', /supabase\.rpc\(\s*'set_benchmark_public_opt_in',\s*\{\s*p_on: next\s*\}\)/.test(setFn), setFn.slice(0, 200));
  ok('…and local state comes from the RETURNED value, not an optimistic flip',
    /const stored = error \? null : parsePublicIndexState\(data\);/.test(setFn)
    && /setIndexState\(stored\)/.test(setFn)
    && !/setIndexState\(\{\s*optIn:\s*next/.test(setFn)
    && setFn.indexOf('setIndexState(stored)') > setFn.indexOf("rpc('set_benchmark_public_opt_in'"));
  ok('…and a failed save reports why', /ok: false,\s*message:/.test(setFn));
}
ok('the stats read maps rows through benchmarkStatsFromRow and records "building"',
  /stats: benchmarkStatsFromRow\(row\)/.test(hook) && /else nextBuilding\[r\.key\] = true;/.test(hook));
ok('the privacy comment no longer promises "no one ever sees another contractor\'s prices"',
  !/no one ever sees another contractor's prices/.test(hookSrc));
// validate-cost-seed's pins still hold (the publish filter is unchanged)
ok('the publish filter is untouched (isPublishableRate feeds contributions)',
  /const contributions = useMemo\(\(\) => keys\.filter\(isPublishableRate\), \[keys\]\);/.test(hook));

// ════════════════════════════════════════════════════════════════════════════
// #79 / #84 · app/cost-database.tsx
// ════════════════════════════════════════════════════════════════════════════
const screen = code(read('app/cost-database.tsx'));
ok('the card body is publicIndexCopy (the tested sentence)',
  /\{publicIndexCopy\(\{ publicOptIn, unreadable: publicOptInUnreadable, ratesOnFile, publishableCount \}\)\}/.test(screen));
ok('the old always-contributing sentence is gone from the screen',
  !/Your rates help build the only public index/.test(screen));
ok('the switch is locked while unread or saving, and toggles through the checked save',
  /disabled=\{publicOptIn === null \|\| optInSaving\}/.test(screen)
  && /onValueChange=\{\(v\) => \{ void onTogglePublicIndex\(v\); \}\}/.test(screen));
ok('a refused save is shown under the card', /\{optInError \? \(/.test(screen) && /if \(!res\.ok\) setOptInError\(res\.message\);/.test(screen));
ok('#84: the card says once, under the gate, that no market figure is shown',
  /\{!MARKET_BENCHMARK_PUBLISHED \? \(\s*<Text style=\{styles\.publicIndexBody\} testID="cost-market-withheld">\s*\{MARKET_BENCHMARK_WITHHELD_COPY\}/.test(screen));
ok('…and no row claims the benchmark is "building" toward a contributor count',
  !/Market benchmark building/.test(screen) && !/isBuilding\(/.test(screen) && !/other contractors so far/.test(screen));

// ════════════════════════════════════════════════════════════════════════════
// #180 · financing
// ════════════════════════════════════════════════════════════════════════════
const finSrc = read('utils/financing.ts');
const fin = code(finSrc);
const refLine = (/export const FINANCING_REF_RE = (\/[^\n]+\/);/.exec(finSrc) ?? [])[1] ?? '';
const isFinancingRefToken = load<(t: unknown) => boolean>(
  [`const FINANCING_REF_RE = ${refLine || '/$^/'};`, liftFunction(finSrc, 'isFinancingRefToken')], 'isFinancingRefToken');
{
  const minted = `fin_${crypto.randomUUID().replace(/-/g, '').toLowerCase()}`;
  ok('a ref minted the way ensureReferral mints it is a sendable token', isFinancingRefToken(minted), minted);
  ok('an empty ref (insert failed) is not', !isFinancingRefToken('') && !isFinancingRefToken(null));
  ok('a ref that is not fin_ + 32 hex is not', !isFinancingRefToken('fin_xyz') && !isFinancingRefToken(`fin_${'A'.repeat(32)}`) && !isFinancingRefToken(`${minted}x`));
}
{
  const block = liftFunction(finSrc, 'financingEmailBlockHtml');
  ok('the email block refuses a ref it cannot send, before building the link',
    /if \(!isFinancingRefToken\(refToken\)\) return '';/.test(block)
    && block.indexOf('isFinancingRefToken(refToken)') < block.indexOf('buildFinancingRedirectUrl(refToken)'), block.slice(0, 300));
}
ok('utils/financing still exports the redirect builder with the same signature',
  /export function buildFinancingRedirectUrl\(refToken: string\): string/.test(fin));

const refs = code(read('hooks/useFinancingReferrals.ts'));
{
  const ensure = (/const ensureReferral = useCallback\([\s\S]*?\n    \[gcUserId, referralsQ\.data, queryClient\],/.exec(refs) ?? [''])[0];
  ok('ensureReferral returns \'\' when the insert fails (no dead financing link is emailed)',
    /if \(error\) \{[\s\S]*?return '';\s*\}\s*return token;/.test(ensure), ensure.slice(-400));
  ok('…and mints fin_ + lower-case hex', /const token = `fin_\$\{generateUUID\(\)\.replace\(\/-\/g, ''\)\.toLowerCase\(\)\}`;/.test(ensure));
}

const redirSrc = read('supabase/functions/financing-redirect/index.ts');
const redir = code(redirSrc);
const serverRef = (/const REF_RE = (\/[^\n]+\/);/.exec(redirSrc) ?? [])[1] ?? '';
ok('financing-redirect\'s REF_RE is IDENTICAL to the app\'s FINANCING_REF_RE', serverRef !== '' && serverRef === refLine, `${serverRef} vs ${refLine}`);
{
  const refBranch = (/if \(ref\) \{[\s\S]*?\} else if \(projectParam && srcParam === "portal"\) \{/.exec(redir) ?? [''])[0];
  ok('#180: the ?ref= branch no longer demands a header signature a browser link cannot send',
    refBranch.length > 0 && !/validSignature|x-financing-signature|headers\.get/.test(refBranch), refBranch.slice(0, 300));
  ok('…it validates the ref\'s exact shape, then looks the row up',
    /if \(!REF_RE\.test\(ref\)\) return redirect\(FALLBACK_URL\);/.test(refBranch)
    && /\.eq\("id", ref\)\.maybeSingle\(\)/.test(refBranch));
}
ok('…and only created → clicked is ever advanced', /if \(row\.status === "created"\) \{[\s\S]{0,200}status: "clicked"/.test(redir));
{
  const portal = (/\} else if \(projectParam && srcParam === "portal"\) \{[\s\S]*?\n    \}\n\n    if \(!row\)/.exec(redir) ?? [''])[0];
  ok('#180: the portal branch no longer accepts any 20-character Authorization/apikey header',
    portal.length > 0 && !/length >= 20|hasToken|headers\.get\("Authorization"\)|headers\.get\("apikey"\)/.test(portal), portal.slice(0, 200));
  ok('…it resolves the portal id + access token with portal_project_for_token',
    /db\.rpc\("portal_project_for_token", \{\s*p_portal_id: portalParam,\s*p_access_token: accessToken,\s*\}\)/.test(portal));
  ok('…and requires the token to resolve to THIS project before any row is found or created',
    /resolved\.toLowerCase\(\) !== projectParam\.toLowerCase\(\)\) \{\s*return redirect\(FALLBACK_URL\);/.test(portal)
    && portal.indexOf('portal_project_for_token') < portal.indexOf('from("financing_referrals")'));
}
ok('the header comment no longer claims "redirect still happens" behind a header gate',
  !/redirect\s*\/\/\s*still happens/.test(redirSrc) && !/Both fail-closed: no signature\/token/.test(redirSrc));

console.log(`\n${fail === 0 ? '✓' : '✗'} w5 benchmark-financing (client): ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
