// scripts/validate-w5-desktop-web-share.ts — a share he cancelled is not a
// share (audit 2026-09-23 #54).
//
// On iPhone, React Native's Share.share does NOT reject when he taps X on the
// share sheet: it RESOLVES with { action: Share.dismissedAction }. shareText
// returned 'shared' for any resolve, so Quick Quote and Smart Proposal marked a
// quote "sent" that never left the phone, and /waiting-on (which called
// Share.share itself) logged a chase that never happened — reset the reminder
// clock and put a fake entry in the delay-evidence log.
//
// Behavioural half: utils/shareText is run for real against a stand-in
// react-native whose Share.share resolves / rejects the way each platform does.
// Source half: /waiting-on routes through shareText and records nothing on a
// cancel.
//
// Run via: bun run scripts/validate-w5-desktop-web-share.ts

// `bun:test` has no type declarations in this repo's tsc program, so it is
// reached through a variable specifier; bun resolves it at runtime.
const BUN_TEST = 'bun:test';
const { mock } = (await import(BUN_TEST)) as {
  mock: { module: (specifier: string, factory: () => Record<string, unknown>) => void };
};
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const Platform = { OS: 'ios' as string };
let shareImpl: (content: unknown) => Promise<unknown> = async () => ({ action: 'sharedAction' });
let shareCalls = 0;
const Share = {
  sharedAction: 'sharedAction',
  dismissedAction: 'dismissedAction',
  share: (content: unknown) => { shareCalls++; return shareImpl(content); },
};
let clipboardWrites: string[] = [];
let clipboardOk = true;
mock.module('react-native', () => ({ Platform, Share }));
mock.module('expo-clipboard', () => ({
  setStringAsync: async (t: string) => { if (!clipboardOk) throw new Error('denied'); clipboardWrites.push(t); return true; },
  getStringAsync: async () => clipboardWrites[clipboardWrites.length - 1] ?? '',
}));

const { shareText } = await import('../utils/shareText');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const reset = () => { shareCalls = 0; clipboardWrites = []; clipboardOk = true; };

console.log('\n#54 shareText reads the share RESULT, not just the promise:');
{
  reset(); Platform.OS = 'ios';
  shareImpl = async () => ({ action: 'dismissedAction' });
  const out = await shareText({ message: 'Quote #12' });
  ok("iOS: the sheet dismissed (resolves dismissedAction) → 'cancelled'", out === 'cancelled', `got '${out}'`);
  ok('…and nothing went to the clipboard in its place', clipboardWrites.length === 0);
}
{
  reset(); Platform.OS = 'ios';
  shareImpl = async () => ({ action: 'sharedAction', activityType: 'com.apple.UIKit.activity.Mail' });
  const out = await shareText({ message: 'Quote #12' });
  ok("iOS: a target was picked (sharedAction) → 'shared'", out === 'shared', `got '${out}'`);
}
{
  reset(); Platform.OS = 'android';
  shareImpl = async () => ({ action: 'sharedAction' });
  const out = await shareText({ message: 'Quote #12' });
  ok("Android: always resolves sharedAction → 'shared' (a cancel cannot be detected there)", out === 'shared', `got '${out}'`);
}
{
  reset(); Platform.OS = 'ios';
  shareImpl = async () => undefined;
  const out = await shareText({ message: 'Quote #12' });
  ok("a resolve with no result object is not mistaken for a cancel → 'shared'", out === 'shared', `got '${out}'`);
}
{
  reset(); Platform.OS = 'web';
  (globalThis as unknown as { navigator: unknown }).navigator = { share: async () => {} };
  shareImpl = async () => { const e = new Error('Share canceled'); e.name = 'AbortError'; throw e; };
  const out = await shareText({ message: 'Quote #12' });
  ok("web: Web Share rejects AbortError on cancel → 'cancelled'", out === 'cancelled', `got '${out}'`);
  ok('…and nothing went to the clipboard', clipboardWrites.length === 0);
}
{
  reset(); Platform.OS = 'web';
  (globalThis as unknown as { navigator: unknown }).navigator = { share: async () => {} };
  shareImpl = async () => ({ action: 'sharedAction' });
  const out = await shareText({ message: 'Quote #12', url: 'https://pay.example/x' });
  ok("web: Web Share resolved → 'shared'", out === 'shared', `got '${out}'`);
}
{
  reset(); Platform.OS = 'web';
  (globalThis as unknown as { navigator: unknown }).navigator = {};
  const out = await shareText({ message: 'Quote #12', url: 'https://pay.example/x' });
  ok("web without navigator.share → 'copied', and the sheet was never asked", out === 'copied' && shareCalls === 0, `got '${out}', ${shareCalls} share calls`);
  ok('…the url rides in the copied text', clipboardWrites[0] === 'Quote #12\n\nhttps://pay.example/x', JSON.stringify(clipboardWrites));
}
{
  reset(); Platform.OS = 'ios';
  shareImpl = async () => { throw new Error('No activity controller'); };
  const out = await shareText({ message: 'Quote #12' });
  ok("a real share failure falls back to the clipboard → 'copied'", out === 'copied', `got '${out}'`);
  reset(); clipboardOk = false;
  shareImpl = async () => { throw new Error('No activity controller'); };
  const out2 = await shareText({ message: 'Quote #12' });
  ok("…and when the clipboard fails too → 'failed'", out2 === 'failed', `got '${out2}'`);
}

console.log('\n#54 the ShareOutcome doc states the Android limit rather than implying certainty:');
{
  const src = read('utils/shareText.ts');
  ok("shareText tests the result against Share.dismissedAction",
    /if \(r\?\.action === Share\.dismissedAction\) return 'cancelled';/.test(src));
  ok("'shared' is documented as undetectable-cancel on Android",
    /ANDROID[\s\S]{0,200}always resolves with sharedAction/.test(src));
  ok('the signature and the four-way union are unchanged (Quick Quote / Smart Proposal rely on them)',
    /export async function shareText\(opts: \{\s*message: string;\s*title\?: string;\s*url\?: string;\s*\}\): Promise<ShareOutcome>/.test(src)
    && /\| 'shared'[\s\S]*\| 'cancelled'[\s\S]*\| 'copied'[\s\S]*\| 'failed';/.test(src));
}

console.log('\n#54 /waiting-on logs a chase only for what actually left:');
{
  const src = read('app/waiting-on.tsx');
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('the screen no longer calls Share.share itself', !/Share\.share\(/.test(code),
    'a direct Share.share records the chase on a resolve, and iOS resolves on dismiss');
  ok('it goes through shareText', /const outcome = await shareText\(\{ message \}\);/.test(code));
  ok("a cancel returns before anything is recorded",
    /if \(outcome === 'cancelled'\) return;/.test(code)
    && code.indexOf("if (outcome === 'cancelled') return;") < code.indexOf("recordChase(holdId, projectId, 'share', message)"));
  ok("'shared' records a share chase", /if \(outcome === 'shared'\) \{\s*recordChase\(holdId, projectId, 'share', message\);/.test(code));
  ok("'copied' records a clipboard chase", /if \(outcome === 'copied'\) recordChase\(holdId, projectId, 'clipboard', message\);/.test(code));
  ok('the duplicate canWebShare / clipboard fallback is gone', !/canWebShare/.test(code) && !/copyToClipboard\(/.test(code));
}

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-w5-desktop-web-share: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
