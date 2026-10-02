// validate-realtime-topics.ts: no two mounts may share a realtime channel by accident.
//
// realtime-js's supabase.channel(topic) returns the EXISTING channel for a
// repeated topic, and adding a listener after subscribe() THROWS. On web that
// was the "This screen hit an error — cannot add `presence` callbacks for
// realtime:schedule:… after `subscribe()`" crash (2026-10-02).
//
//   A. Static: every supabase.channel(...) in the app uses mountTopic(...)
//      (utils/realtimeTopic.ts), except the presence registry, which shares
//      one channel per topic on purpose.
//   B. Behaviour: a fake client that behaves like realtime-js (returns the
//      existing channel, throws on a late .on, removes asynchronously) proves
//      the presence registry survives share / release / instant re-acquire,
//      and a planted naive implementation is caught throwing.
//   C. mountTopic never repeats.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPresenceRegistry, type PresenceClientLike } from '../utils/realtimePresenceRegistry';
import { mountTopic } from '../utils/realtimeTopic';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── A. static ────────────────────────────────────────────────────────────────
// useLiveSchedule already owns a per-mount topic (its own mountSeq suffix; see its header).
const ALLOWED = new Set(['utils/realtimePresenceRegistry.ts', 'hooks/useSchedulePresence.ts', 'hooks/useLiveSchedule.ts']);
function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
export function unsafeChannelCalls(src: string): number {
  const code = stripComments(src);
  let bad = 0;
  const re = /\.channel\(\s*([^,)]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const arg = m[1].trim();
    if (arg.startsWith('mountTopic(')) continue;
    if (/^[A-Za-z_$][\w$]*$/.test(arg) && new RegExp(`\\b${arg}\\s*=\\s*mountTopic\\(`).test(code)) continue;
    bad += 1;
  }
  return bad;
}
const files: string[] = [];
for (const d of ['app', 'components', 'hooks', 'utils', 'contexts']) walk(join(ROOT, d), files);
let channelFiles = 0;
for (const f of files) {
  const rel = relative(ROOT, f);
  const src = readFileSync(f, 'utf8');
  if (!/\.channel\(/.test(stripComments(src))) continue;
  channelFiles += 1;
  if (ALLOWED.has(rel)) continue;
  const bad = unsafeChannelCalls(src);
  check(`A ${rel}`, bad === 0, `${bad} supabase.channel(...) call(s) without mountTopic(...)`);
}
check('A found the known channel sites', channelFiles >= 9, `only ${channelFiles}`);
check('A self-test flags a fixed topic', unsafeChannelCalls("supabase.channel(`notif-feed-${id}`)") === 1);
check('A self-test passes mountTopic inline', unsafeChannelCalls("supabase.channel(mountTopic(`x-${id}`))") === 0);
check('A self-test passes a mountTopic variable', unsafeChannelCalls("const channelName = mountTopic(`x`);\nsupabase.channel(channelName)") === 0);
check('A self-test flags a plain variable', unsafeChannelCalls("const channelName = `x`;\nsupabase.channel(channelName)") === 1);
const hook = readFileSync(join(ROOT, 'hooks/useSchedulePresence.ts'), 'utf8');
check('A presence hook goes through the registry', /presenceRegistry\.acquire\(/.test(hook) && /onSync: \(ch, cb\) => \{ ch\.on\('presence'/.test(hook) && !/const channel = supabase\.channel\(/.test(stripComments(hook)));

// ── B. behaviour against a realtime-js-like fake ─────────────────────────────
class FakeChannel {
  subscribed = false; removed = false; onCalls = 0; tracks: Record<string, unknown>[] = [];
  private syncs: (() => void)[] = [];
  constructor(public topic: string) {}
  on(_t: 'presence', _f: { event: 'sync' }, cb: () => void) {
    if (this.subscribed) throw new Error(`cannot add \`presence\` callbacks for realtime:${this.topic} after \`subscribe()\`.`);
    this.onCalls += 1; this.syncs.push(cb); return this;
  }
  subscribe(cb: (s: string) => void) { this.subscribed = true; queueMicrotask(() => cb('SUBSCRIBED')); return this; }
  track(p: Record<string, unknown>) { this.tracks.push(p); return Promise.resolve('ok'); }
  presenceState<T>() { return {} as Record<string, T[]>; }
  fireSync() { for (const s of this.syncs) s(); }
}
function fakeClient() {
  const live = new Map<string, FakeChannel>();
  const made: FakeChannel[] = [];
  const client: PresenceClientLike<FakeChannel> = {
    channel(topic) {
      const existing = live.get(topic);          // realtime-js: same topic → same channel
      if (existing) return existing;
      const c = new FakeChannel(topic); live.set(topic, c); made.push(c); return c;
    },
    onSync: (c, cb) => { c.on('presence', { event: 'sync' }, cb); },
    subscribe: (c, cb) => { c.subscribe(cb); },
    track: (c, p) => c.track(p),
    removeChannel(c) {                            // asynchronous, like the real one
      return new Promise((res) => setTimeout(() => { c.removed = true; if (live.get(c.topic) === c) live.delete(c.topic); res('ok'); }, 5));
    },
    setAuth: () => Promise.resolve(),
  };
  return { client, made };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

{
  const { client, made } = fakeClient();
  const reg = createPresenceRegistry(client);
  let a = 0; let b = 0;
  const l1 = await reg.acquire('schedule:p1', 'u1', () => { a += 1; });
  const l2 = await reg.acquire('schedule:p1', 'u1', () => { b += 1; });
  await tick(1);
  check('B two mounts share one channel', made.length === 1 && l1.channel === l2.channel);
  made[0].fireSync();
  check('B both mounts hear a sync', a === 1 && b === 1);
  l1.track({ userId: 'u1' });
  check('B track reaches the subscribed channel', made[0].tracks.length >= 1);
  l1.release();
  await tick(10);
  check('B releasing one mount keeps the channel', !made[0].removed);
  l2.release();
  // Re-acquire IMMEDIATELY, while the removal is still in flight: the crash case.
  let threw = '';
  try {
    const l3 = await reg.acquire('schedule:p1', 'u1', () => {});
    await tick(1);
    check('B instant re-acquire gets a fresh channel', made.length === 2 && l3.channel !== made[0]);
    l3.release();
  } catch (e) { threw = String(e); }
  check('B instant re-acquire never throws', threw === '', threw);
  check('B every channel got exactly one listener, before subscribe', made.every((c) => c.onCalls === 1));
  await tick(10);
  check('B last release removes the channel', reg._size() === 0);
}
{
  // Planted naive version (the shipped bug): a fresh channel + .on per mount.
  const { client } = fakeClient();
  let caught = '';
  try {
    const c1 = client.channel('schedule:p2', { config: { private: true, presence: { key: 'u' } } });
    c1.on('presence', { event: 'sync' }, () => {});
    c1.subscribe(() => {});
    void client.removeChannel(c1);                 // not awaited, as the old cleanup did
    const c2 = client.channel('schedule:p2', { config: { private: true, presence: { key: 'u' } } });
    c2.on('presence', { event: 'sync' }, () => {});
  } catch (e) { caught = String(e); }
  check('B planted naive version is caught throwing', /after `subscribe\(\)`/.test(caught), caught || 'did not throw');
}

// ── C. mountTopic ────────────────────────────────────────────────────────────
const t1 = mountTopic('notif-feed-u1');
const t2 = mountTopic('notif-feed-u1');
check('C mountTopic never repeats', t1 !== t2 && t1.startsWith('notif-feed-u1:') && t2.startsWith('notif-feed-u1:'));

console.log(`validate-realtime-topics: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
