// validate-w5-settings-reset.ts — audit wave 5, lane settings: #3 / #4
// (blockers), #46, and the #123/#128 carry.
//
// #3/#4: "Clear All Projects & Data" said it cleared THIS device and then ran
// deleteProject() for every owned job — a server DELETE per project, with 38
// child tables cascading (invoices, COs, pay apps, contracts, portals,
// collaborators, safety records). It is now "Reset this device": a local key
// sweep, then a reload from the account. This pins that the reset path can
// never reach a server delete again, that the sweep is the prefix sweep (never
// AsyncStorage.clear()), that pending work is counted before he confirms, and
// that the lists are re-read rather than zeroed.
// #46: the Face ID / Touch ID switch saved a flag nothing read. Until an app
// lock exists the row is disabled and says so.
// #123/#128: the AI counters roll over at 00:00 UTC; Settings says the real
// local time from nextAiResetLabel(), never "midnight" / "the 1st".
//
// Run: bun run scripts/validate-w5-settings-reset.ts

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const raw = read('app/(tabs)/settings/index.tsx');
const src = stripComments(raw);

/** The source of `const <name> = useCallback(` up to its dependency list. */
function callbackBody(name: string): string {
  const at = src.indexOf(`const ${name} = useCallback(`);
  if (at < 0) return '';
  const end = src.indexOf('\n  }, [', at);
  return end > at ? src.slice(at, end) : '';
}

console.log('\n── #3 / #4: the reset never deletes anything on the server ──');
const reset = callbackBody('resetThisDevice');
const clear = callbackBody('handleClearAll');
ok('resetThisDevice and handleClearAll were found', reset.length > 0 && clear.length > 0);
const both = reset + clear;
ok('neither calls deleteProject', !/deleteProject\s*\(/.test(both));
ok("neither sends a projects delete (supabaseWrite('projects', 'delete'))", !/supabaseWrite\(\s*['"]projects['"]\s*,\s*['"]delete['"]/.test(both));
ok('neither calls forgetProjectsLocally / syncProjectToSupabase', !/forgetProjectsLocally|syncProjectToSupabase/.test(both));
ok('the screen no longer takes deleteProject from the context', !/\bdeleteProject\b/.test(src));
ok('the sweep is selectTenantKeysToWipe + multiRemove', /selectTenantKeysToWipe\(allKeys, \{ dropOfflineQueue: false \}\)\.filter\(\(k\) => !RESET_KEEPS\.has\(k\)\)/.test(reset) && /AsyncStorage\.multiRemove\(keysToWipe\)/.test(reset));
// Integration round 1 (web-comms-ai): pending work is dropped under the queue
// locks (AuthContext's dropPendingWrites, the sign-out path) BEFORE the sweep,
// and the sweep never touches a queue key itself. The unlocked multiRemove let
// an in-flight flush write the queue back and orphaned the durable photo copies.
{
  const dropAt = reset.indexOf('await dropPendingWrites();');
  const sweepAt = reset.indexOf('selectTenantKeysToWipe(');
  ok('pending writes are dropped through dropPendingWrites() before the sweep', dropAt > -1 && sweepAt > dropAt);
  ok('…imported from AuthContext (the lock-holding helper, not a copy)', /import \{ useAuth, dropPendingWrites \} from '@\/contexts\/AuthContext';/.test(src)
    && /export async function dropPendingWrites\(\): Promise<void> \{/.test(read('contexts/AuthContext.tsx')));
  ok('the sweep keeps the queue keys (dropOfflineQueue: false)', /dropOfflineQueue: false/.test(reset) && !/selectTenantKeysToWipe\(allKeys\)/.test(reset));
  // A reset with no signal: the role / onboarding queries fall back to these
  // device keys when the profile read fails, and with them gone the root
  // layout sent a working GC to persona-select. They are kept, and a reset is
  // refused while the app already knows it can't reach the account.
  const pc = read('contexts/ProjectContext.tsx');
  const role = /const USER_ROLE_KEY = '([^']+)';/.exec(pc)?.[1];
  const onb = /const ONBOARDING_KEY = '([^']+)';/.exec(pc)?.[1];
  const keeps = /const RESET_KEEPS: ReadonlySet<string> = new Set\(\[([^\]]*)\]\);/.exec(src)?.[1] ?? '';
  ok('RESET_KEEPS names ProjectContext\'s USER_ROLE_KEY and ONBOARDING_KEY', !!role && !!onb && keeps.includes(`'${role}'`) && keeps.includes(`'${onb}'`), `role=${role} onboarding=${onb} keeps=${keeps}`);
  const refuse = reset.indexOf('if (sourceFailed) {');
  ok('the reset is refused (before anything is dropped) while the account is unreachable', refuse > -1 && refuse < dropAt
    && /if \(sourceFailed\) \{\s*showAlert\('Reset needs a connection'[\s\S]{0,300}?return;\s*\}/.test(reset)
    && src.includes('}, [user?.id, queryClient, retryRemoteReads, reloadLocalMirrors, sourceFailed]);'));
}
ok('never AsyncStorage.clear()', !/AsyncStorage\.clear\(/.test(src));
ok('the lists are re-read, not zeroed: invalidateQueries + retryRemoteReads, no setQueryData([])',
  /queryClient\.invalidateQueries\(\{ queryKey: \[name, userId\] \}\)/.test(reset)
  && /retryRemoteReads\(\);/.test(reset)
  && !/setQueryData\(\[[^\]]*\],\s*\[\]\)/.test(reset));
// Integration round 1 (data-security): the plan lists are in-memory state, not
// react-query data, so the invalidations above never reach them. Without
// reloadLocalMirrors a sheet whose upload sat in the wiped queue stays on
// screen and the next plan edit writes it back to disk.
{
  const sweepAt = reset.indexOf('AsyncStorage.multiRemove(keysToWipe)');
  const reloadAt = reset.indexOf('await reloadLocalMirrors()');
  const retryAt = reset.indexOf('retryRemoteReads();');
  ok('the in-memory plan lists are reloaded: await reloadLocalMirrors() after the sweep, before retryRemoteReads',
    sweepAt >= 0 && reloadAt > sweepAt && retryAt > reloadAt
    && /reloadLocalMirrors[^}]*\}\s*=\s*useCoreData\(\)/.test(src)
    && src.includes('}, [user?.id, queryClient, retryRemoteReads, reloadLocalMirrors, sourceFailed]);'));
}
ok('pending changes and photos are counted BEFORE the dialog, with the read-only helpers',
  /getOwnOfflineQueue\(\)[\s\S]{0,80}getOwnPhotoUploadQueue\(\)[\s\S]*showAlert\(\s*'Reset this device\?'/.test(clear));
ok("…and the dialog says they haven't reached MAGE and will be lost",
  /on this phone \$\{[^}]*\} reached MAGE and will be lost/.test(clear));
ok('Cancel is the first (safe) choice', /\[\s*\{ text: 'Cancel', style: 'cancel' \},\s*(?:\.\.\.\(unsaved > 0 \? \[\{ text: 'Review Not saved', onPress: \(\) => requestSyncSheet\(\) \}\] : \[\]\),\s*)?\{ text: 'Reset this device', style: 'destructive'/.test(clear));
// w5-join-screens (settings handoff 1): the reset sweep removes the Not-saved
// list, the only copy of a record the server refused — count it, say so, and
// offer the list before the reset.
ok('handleClearAll counts the Not-saved records (countOwnUnsavedRecords)', /countOwnUnsavedRecords\(\)\.catch\(\(\) => 0\)/.test(clear));
ok('…says a reset deletes them, and offers Review Not saved first',
  /Resetting deletes/.test(clear) && /\{ text: 'Review Not saved', onPress: \(\) => requestSyncSheet\(\) \}/.test(clear));
ok('the dialog says jobs stay on the account and reload', /Your jobs stay on your account and reload/.test(clear));
ok('the Done alert says the device was reset and jobs are reloading',
  /showAlert\('Done', 'This device was reset\. Your jobs are reloading from your account\.'\)/.test(reset));
ok('the row is "Reset this device" (not "Clear All Projects & Data")',
  />Reset this device</.test(src) && !/Clear All Projects/.test(src) && !/Delete Everything/.test(src));
ok('the row copy says the jobs stay on the account', /Your jobs stay on your account and reload\./.test(src));

console.log('\n── #46: no security switch that does nothing ──');
ok('the switch is disabled and fixed off', /<Switch\s+value=\{false\}\s+disabled/.test(src));
ok('no switch toggles biometricsEnabled any more', !/onValueChange=\{setBiometrics\}/.test(src) && !/onPress=\{\(\) => setBiometrics\(/.test(src));
ok("the row says the app lock isn't built and where Face ID sign-in is",
  /const APP_LOCK_NOT_BUILT = 'App lock isn\\u2019t built yet\. Face ID sign-in is on the login screen\.';/.test(src)
  && /\{APP_LOCK_NOT_BUILT\}/.test(src));
ok('setBiometrics keeps its load-guard lines (validate-settings-load-guard pins them)',
  /if \(!commitScreen\(\{ biometricsEnabled: val \}\)\) return;\s*setBiometricsEnabled\(val\);/.test(src));

console.log('\n── #123 / #128 carry: real local reset times ──');
ok('the usage line is built from nextAiResetLabel()', /const aiResetLabels = nextAiResetLabel\(\);/.test(src)
  && /aiResetLabels\.daily/.test(src) && /aiResetLabels\.monthly/.test(src) && /\{aiResetLine\}/.test(src));
ok('no "resets at midnight" / "resets the 1st" claim', !/resets at midnight/i.test(src) && !/resets the 1st/i.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
