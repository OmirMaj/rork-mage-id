// validate-mcp-field-scope.ts — field data reaches the GC's server-side
// readers by JOB, not by who typed it (audit round 2 #28).
//
// Two service-role readers filtered field rows by author:
//   • supabase/functions/mcp — list_open_rfis / list_overdue asked for
//     `rfis?user_id=eq.<me>`, so Claude never mentioned the RFI a foreman
//     logged on the GC's job, and a collaborator's own jobs were missing from
//     the project-name map ("—").
//   • supabase/functions/morning-digest — yesterday's daily reports and the
//     open-RFI count were `.eq('user_id', userId)`, so on a job where the
//     super files the report the GC's 6 am briefing said nothing happened,
//     while the project screen (RLS-scoped, no author filter) showed it.
// Both run as the SERVICE ROLE: RLS scopes nothing there, so the project
// filter each reader writes is the entire tenant boundary. This guard pins
// that filter to the project, and pins it PRESENT (an unfiltered rfis read
// under the service role would be every tenant's RFIs).
//
// Source-level (both are Deno modules that serve() on import). Comments are
// stripped first so prose naming the old query cannot satisfy or trip a check.
//
// Run via: bun run scripts/validate-mcp-field-scope.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const mcp = strip(readFileSync(join(ROOT, 'supabase', 'functions', 'mcp', 'index.ts'), 'utf8'));
const digest = strip(readFileSync(join(ROOT, 'supabase', 'functions', 'morning-digest', 'index.ts'), 'utf8'));

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}
const caseBody = (src: string, name: string) => {
  const at = src.indexOf(`case "${name}":`);
  if (at === -1) return '';
  const next = src.indexOf('\n    case "', at + 10);
  return src.slice(at, next === -1 ? undefined : next);
};

console.log('\nmcp — RFIs by job, not by author:');
ok('no RFI read is filtered by the caller as author', !/rfis\?user_id=eq\./.test(mcp),
  'rfis?user_id=eq.<me> returns only what the caller typed — the foreman\'s RFI on the GC\'s job is invisible');
const nameMap = mcp.slice(mcp.indexOf('async function accessibleProjectNames'), mcp.indexOf('const projectNameMap'));
ok('the project map covers owned AND accepted-collaborator jobs',
  /projects\?user_id=eq\.\$\{userId\}/.test(nameMap) && /project_collaborators\?user_id=eq\.\$\{userId\}&status=eq\.accepted/.test(nameMap));
ok('projectNameMap IS the accessible map (so no tool labels a shared job "—")', /const projectNameMap = accessibleProjectNames;/.test(mcp));
const helper = mcp.slice(mcp.indexOf('async function openRfisOnProjects'), mcp.indexOf('async function authorNames'));
ok('the RFI helper filters by project_id=in.(…) — present, never omitted', /rfis\?project_id=in\.\(/.test(helper) && /status=eq\.open/.test(helper));
for (const tool of ['list_open_rfis', 'list_overdue']) {
  const body = caseBody(mcp, tool);
  ok(`${tool} reads RFIs through the job-scoped helper`, /openRfisOnProjects\(\s*Object\.keys\(names\)/.test(body), 'expected openRfisOnProjects(Object.keys(names), …)');
  ok(`${tool} says who logged someone else's RFI`, /loggedBy\(userId,/.test(body));
}
ok('the money tools stay owner-scoped', /invoices\?user_id=eq\.\$\{userId\}/.test(caseBody(mcp, 'list_overdue'))
  && /change_orders\?user_id=eq\.\$\{userId\}/.test(caseBody(mcp, 'list_change_orders')));

console.log('\nmorning-digest — yesterday\'s reports and open RFIs by job:');
const dfrAt = digest.indexOf(".from('daily_reports')");
const dfrQuery = digest.slice(dfrAt, digest.indexOf(';', dfrAt));
ok('daily reports are read for the jobs being briefed', /\.in\('project_id', activeIds\)/.test(dfrQuery), dfrQuery);
ok('…not by author', !/\.eq\('user_id'/.test(dfrQuery));
const rfiAt = digest.indexOf(".from('rfis')");
const rfiQuery = digest.slice(rfiAt, digest.indexOf(';', rfiAt));
ok('the open-RFI count is over the user\'s own jobs', /\.in\('project_id', ownedIds/.test(rfiQuery), rfiQuery);
ok('…not by author', !/\.eq\('user_id'/.test(rfiQuery));
ok('the owned-job list the count uses is the user\'s projects', /from\('projects'\)\s*\.select\('id'\)\s*\.eq\('user_id', userId\)/.test(digest));
ok('an empty job list skips the report read instead of sending an empty in-list',
  /if \(activeIds\.length > 0\)\s*\{[\s\S]{0,80}from\('daily_reports'\)/.test(digest));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
