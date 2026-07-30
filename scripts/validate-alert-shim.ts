// validate-alert-shim.ts — pins utils/alert.ts + guards the migration.
//
// Context: react-native-web ships `class Alert { static alert() {} }`, so every
// Alert.alert in the app was a silent no-op on web. This validator pins the
// pure normalization logic AND fails if new raw Alert.alert / Alert.prompt
// call sites creep back into the app, which would silently break on web again.
//
// Run: bun run scripts/validate-alert-shim.ts
import { normalizeButtons, cancelButtonIndex } from '../utils/alertCore';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

console.log('\nalert shim:');

// ── normalizeButtons ──
expect('no buttons → a single OK', normalizeButtons(), [{ text: 'OK', style: 'default' }]);
expect('empty array → a single OK', normalizeButtons([]), [{ text: 'OK', style: 'default' }]);
expect('blank text → OK', normalizeButtons([{ text: '' }])[0].text, 'OK');
expect('style defaults to default', normalizeButtons([{ text: 'Go' }])[0].style, 'default');
expect('styles preserved',
  normalizeButtons([{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive' }]).map(b => b.style),
  ['cancel', 'destructive']);
ok('onPress preserved', typeof normalizeButtons([{ text: 'A', onPress: () => undefined }])[0].onPress === 'function');

// ── cancelButtonIndex (drives backdrop dismissal) ──
expect('finds the cancel button', cancelButtonIndex(normalizeButtons([{ text: 'Delete', style: 'destructive' }, { text: 'Cancel', style: 'cancel' }])), 1);
expect('no cancel button → -1 (backdrop does nothing, like native)',
  cancelButtonIndex(normalizeButtons([{ text: 'OK' }])), -1);

// ── migration guard: no raw Alert.alert / Alert.prompt left in app code ──
const ROOTS = ['app', 'components', 'hooks', 'contexts'];
const ALLOW = new Set(['utils/alert.ts', 'components/AlertHost.tsx']);
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}
const offenders: string[] = [];
for (const root of ROOTS) {
  let files: string[] = [];
  try { files = walk(root); } catch { continue; }
  for (const f of files) {
    if (ALLOW.has(f)) continue;
    const src = readFileSync(f, 'utf8');
    // Strip line + block comments so prose mentioning Alert.alert doesn't trip us.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/\bAlert\s*\.\s*(alert|prompt)\s*\(/.test(code)) offenders.push(f);
  }
}
ok('no raw Alert.alert/Alert.prompt in app code (they no-op on web)',
  offenders.length === 0,
  offenders.length ? `${offenders.length} file(s):\n      ` + offenders.slice(0, 12).join('\n      ') : '');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
