// scripts/validate-ai-consent.ts — App Store 5.1.2(i): nothing a contractor
// types, says, photographs or uploads leaves for a third-party AI until he has
// said yes, and the question names who receives it.
//
// WHY THIS EXISTS. The first App Store submission's audit (finding 6) found no
// in-app permission before AI data sharing — only the website privacy policy.
// utils/aiConsent (logic in utils/aiConsentCore) is the one gate, and every
// native AI entry point must await it BEFORE its network call. The failure this
// file stops is quiet: a new AI button added next month that calls
// supabase.functions.invoke('analyze-photos') directly would ship a silent
// data share, and nothing would crash.
//
// What it checks:
//   A. THE GATE ITSELF, run for real under bun with a fake storage and a fake
//      AI transport: declined → the transport is never called; unknown → the
//      host is asked once (two racing calls share the question) and the answer
//      is stored; granted → called; the web host → always yes, nothing asked
//      or stored; a stored "no" holds even with no host; require() throws the
//      honest sentence. A NO THE PHONE COULD NOT STORE STILL HOLDS: after a
//      write that failed, a stored yes is not read back over it. NO HOST AND
//      NO STORED ANSWER IS A NO (fail closed):
//      the yes-without-a-host path exists only for a headless run, behind a
//      named switch that no app file sets and no runtime implies (pinned in C2).
//   A2. THE THREE ANSWERS, pressed for real on a fake alert (askAiConsentOnce):
//      only "Allow AI features" is a yes; "Not now" and a dismissed alert are
//      no; "Privacy policy" opens the policy and asks again; the first answer
//      wins. A button rewired to a silent grant turns this red.
//   B. THE QUESTION: names every provider the edge functions actually call
//      (derived from their outbound hosts, so a new vendor fails this until it
//      is disclosed), says what is sent, links the privacy policy; the storage
//      key sits under an app prefix (the tenant sweep wipes it). The copy
//      claims only what the gate controls: "from this app". The two server
//      features that use AI with no tap (the weekly client recap, Ask Your
//      Home) are named in the question, and the Off row says they follow the
//      answer saved on the account — true only while those functions read it
//      (supabase/functions/_shared/aiConsent.ts), which is checked here and,
//      call by call, in scripts/validate-ai-consent-server.ts.
//   C. EVERY ENTRY POINT: every client call (supabase.functions.invoke,
//      invokeWithTimeout, fetch) to a function that reaches an AI vendor has
//      ensureAiConsent / requireAiConsent earlier in its enclosing async
//      function, or a written `ai-consent: exempt` reason; the indirect
//      transports (mageAI's relay fetch, Project Memory's authedPost) are
//      pinned; the host is mounted in app/_layout.tsx; Settings has the
//      revocable row.
//
// Run: bun run scripts/validate-ai-consent.ts

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AI_CONSENT_COPY,
  AI_CONSENT_DECLINED_CODE,
  AI_CONSENT_HEADLESS_SWITCH,
  AI_CONSENT_OFF_MESSAGE,
  AI_CONSENT_OFF_ROW,
  AI_CONSENT_PRIVACY_URL,
  AI_CONSENT_STORAGE_KEY,
  AiConsentDeclinedError,
  aiConsentAlertMessage,
  aiConsentErrorText,
  aiConsentHeadless,
  aiFailureError,
  askAiConsentOnce,
  createAiConsentGate,
  isAiConsentDeclinedError,
  parseAiConsent,
  type AiConsentAlertButton,
  type AiConsentStorage,
} from '../utils/aiConsentCore';
import { APP_STORAGE_PREFIXES, DEVICE_SCOPED_KEYS } from '../utils/localCacheKeys';
import { describeError } from '../utils/errorCopy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  \u2713', name); }
  else { fail++; console.log('  \u2717', name, detail ? `\n      ${detail}` : ''); }
}

// ── A. The gate, for real ─────────────────────────────────────────────────
console.log('\n\u2500\u2500 A. the gate (fake storage, fake transport) \u2500\u2500');

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const log: string[] = [];
  let throwOnRead = false;
  let throwOnWrite = false;
  const storage: AiConsentStorage = {
    async getItem(k) { log.push(`get:${k}`); if (throwOnRead) throw new Error('storage refused'); return map.has(k) ? map.get(k)! : null; },
    async setItem(k, v) { log.push(`set:${k}=${v}`); if (throwOnWrite) throw new Error('storage refused the write'); map.set(k, v); },
    async removeItem(k) { log.push(`rm:${k}`); if (throwOnWrite) throw new Error('storage refused the write'); map.delete(k); },
  };
  return { storage, map, log, failReads: () => { throwOnRead = true; }, failWrites: (on = true) => { throwOnWrite = on; } };
}

/** The shape every entry point has: gate, then the network call. */
function makeAiCall(gate: ReturnType<typeof createAiConsentGate>) {
  const sent: string[] = [];
  const call = async (payload: string) => {
    await gate.require();
    sent.push(payload); // the fake transport: reaching here IS the network call
    return 'answer';
  };
  return { call, sent };
}

async function partA() {
  // declined → no network call, the honest sentence
  {
    const s = fakeStorage({ [AI_CONSENT_STORAGE_KEY]: 'declined' });
    const gate = createAiConsentGate({ storage: s.storage });
    let asked = 0;
    gate.setHost({ isWeb: false, prompt: async () => { asked++; return true; } });
    const { call, sent } = makeAiCall(gate);
    let err: unknown = null;
    try { await call('my scope'); } catch (e) { err = e; }
    ok('declined: the transport is never called', sent.length === 0);
    ok('declined: the host is not asked again', asked === 0);
    ok('declined: throws AiConsentDeclinedError with the exact sentence',
      err instanceof AiConsentDeclinedError && (err as Error).message === 'AI features are off. Turn them on in Settings \u2192 AI features.');
    ok('declined: the error carries the machine code', isAiConsentDeclinedError(err) && (err as AiConsentDeclinedError).code === AI_CONSENT_DECLINED_CODE);
    ok('ensure() answers false, never throws', (await gate.ensure()) === false);
  }
  // a stored "no" holds with NO host too
  {
    const s = fakeStorage({ [AI_CONSENT_STORAGE_KEY]: 'declined' });
    const gate = createAiConsentGate({ storage: s.storage });
    ok('declined + no host: still refused', (await gate.ensure()) === false);
  }
  // granted → called, nobody asked
  {
    const s = fakeStorage({ [AI_CONSENT_STORAGE_KEY]: 'granted' });
    const gate = createAiConsentGate({ storage: s.storage });
    let asked = 0;
    gate.setHost({ isWeb: false, prompt: async () => { asked++; return false; } });
    const { call, sent } = makeAiCall(gate);
    await call('ok');
    ok('granted: the transport is called once', sent.length === 1 && asked === 0);
  }
  // unknown → asked once; "no" stored, nothing sent
  {
    const s = fakeStorage();
    const gate = createAiConsentGate({ storage: s.storage });
    let asked = 0;
    gate.setHost({ isWeb: false, prompt: async () => { asked++; return false; } });
    const { call, sent } = makeAiCall(gate);
    let threw = false;
    try { await call('x'); } catch { threw = true; }
    ok('unknown + "Not now": asked once, nothing sent, refused', asked === 1 && sent.length === 0 && threw);
    ok('unknown + "Not now": declined is stored under the key', s.map.get(AI_CONSENT_STORAGE_KEY) === 'declined');
    ok('…and the next call is refused without asking', (await gate.ensure()) === false && asked === 1);
  }
  // unknown → "Allow": stored, sent
  {
    const s = fakeStorage();
    const gate = createAiConsentGate({ storage: s.storage });
    let asked = 0;
    const states: string[] = [];
    gate.subscribe((st) => states.push(st));
    gate.setHost({ isWeb: false, prompt: async () => { asked++; return true; } });
    const { call, sent } = makeAiCall(gate);
    await call('scope');
    ok('unknown + "Allow": sent after the answer', sent.length === 1 && asked === 1);
    ok('unknown + "Allow": granted is stored', s.map.get(AI_CONSENT_STORAGE_KEY) === 'granted');
    ok('subscribers hear the change', states.includes('granted') && gate.getState() === 'granted');
  }
  // two racing calls share ONE question
  {
    const s = fakeStorage();
    const gate = createAiConsentGate({ storage: s.storage });
    let asked = 0;
    let release: (v: boolean) => void = () => {};
    gate.setHost({ isWeb: false, prompt: () => { asked++; return new Promise<boolean>((r) => { release = r; }); } });
    const a = gate.ensure();
    const b = gate.ensure();
    await new Promise((r) => setTimeout(r, 5));
    release(true);
    const [ra, rb] = await Promise.all([a, b]);
    ok('two calls racing on first use: one question, one answer', asked === 1 && ra === true && rb === true);
  }
  // a host whose question throws → "no"
  {
    const s = fakeStorage();
    const gate = createAiConsentGate({ storage: s.storage });
    gate.setHost({ isWeb: false, prompt: async () => { throw new Error('alert failed'); } });
    ok('a question that fails is a "no", never a silent yes', (await gate.ensure()) === false);
  }
  // the web app: always yes, nothing asked, nothing read or stored
  {
    const s = fakeStorage({ [AI_CONSENT_STORAGE_KEY]: 'declined' });
    const gate = createAiConsentGate({ storage: s.storage });
    let asked = 0;
    gate.setHost({ isWeb: true, prompt: async () => { asked++; return false; } });
    const { call, sent } = makeAiCall(gate);
    await call('web');
    ok('web: allowed with no question', sent.length === 1 && asked === 0);
    ok('web: storage is not touched', s.log.length === 0);
  }
  // the web host registers WHILE the first call reads storage (a mount-time
  // call that starts before AiConsentSheet's own mount effect): still web
  {
    const s = fakeStorage();
    const gate = createAiConsentGate({ storage: s.storage });
    let asked = 0;
    const p = gate.ensure();
    gate.setHost({ isWeb: true, prompt: async () => { asked++; return false; } });
    const r = await p;
    ok('web host registered mid-read: allowed, never asked, nothing stored',
      r === true && asked === 0 && !s.map.has(AI_CONSENT_STORAGE_KEY));
  }
  // NO HOST AND NO STORED ANSWER. The host (components/AiConsentSheet) is mounted at the app
  // root, so the app does not get here; if it ever did, the App Store control must fail CLOSED.
  // The yes-without-a-host path is for a headless run only (a bun validator importing an AI
  // util on its own), decided by aiConsentHeadless(): the named switch, and nothing else.
  {
    const g = globalThis as unknown as Record<string, unknown>;
    const had = Object.prototype.hasOwnProperty.call(g, AI_CONSENT_HEADLESS_SWITCH);
    const before = g[AI_CONSENT_HEADLESS_SWITCH];
    try {
      // As the app sees it: the switch is not set. This run is under Bun, and that changes nothing.
      delete g[AI_CONSENT_HEADLESS_SWITCH];
      ok('the switch not set: not headless, on any runtime (this run is under Bun)', aiConsentHeadless() === false && typeof g.Bun === 'object');
      const s = fakeStorage();
      const gate = createAiConsentGate({ storage: s.storage });
      const heard: string[] = [];
      gate.onAnswer((a) => heard.push(a));
      const { call, sent } = makeAiCall(gate);
      let err: unknown = null;
      try { await call('my scope'); } catch (e) { err = e; }
      ok('no host + no stored answer, as the app: REFUSED (fail closed): the transport is never called', sent.length === 0 && (await gate.ensure()) === false);
      ok('…the refusal is the honest sentence with its machine code', err instanceof AiConsentDeclinedError && isAiConsentDeclinedError(err));
      ok('…and it is not an answer: nothing is stored, the state stays unknown, no answer event fires (the account is told nothing)',
        !s.map.has(AI_CONSENT_STORAGE_KEY) && gate.getState() === 'unknown' && heard.length === 0 && !s.log.some((l) => l.startsWith('set:') || l.startsWith('rm:')), s.log.join(' '));
      let asked = 0;
      gate.setHost({ isWeb: false, prompt: async () => { asked++; return true; } });
      ok('…so once the host is there the person is ASKED (the earlier refusal did not answer for him)', (await gate.ensure()) === true && asked === 1 && heard.join(',') === 'granted');
      {
        // A mount-time call that starts before AiConsentSheet's own mount effect: the host
        // registers while the stored answer is being read. It is asked, not refused.
        const s2 = fakeStorage();
        const gate2 = createAiConsentGate({ storage: s2.storage });
        let asked2 = 0;
        const p = gate2.ensure();
        gate2.setHost({ isWeb: false, prompt: async () => { asked2++; return true; } });
        ok('a phone host registered mid-read: the question is asked (not a refusal)', (await p) === true && asked2 === 1);
      }
      {
        const s3 = fakeStorage({ [AI_CONSENT_STORAGE_KEY]: 'granted' });
        const gate3 = createAiConsentGate({ storage: s3.storage });
        ok('no host + a stored yes, as the app: allowed (the person answered; nobody needs to be asked)', (await gate3.ensure()) === true);
      }
      // A headless run that says so: let through, nothing stored.
      g[AI_CONSENT_HEADLESS_SWITCH] = true;
      const h = fakeStorage();
      const headless = createAiConsentGate({ storage: h.storage });
      ok('no host + no stored answer, HEADLESS (the switch set to true): the call goes through', aiConsentHeadless() === true && (await headless.ensure()) === true);
      ok('…and nothing is stored on its behalf', !h.map.has(AI_CONSENT_STORAGE_KEY));
      // Only the exact value true opens it.
      const ignored = ['true', 'false', 1, 0, null, {}, false].every((val) => { g[AI_CONSENT_HEADLESS_SWITCH] = val; return aiConsentHeadless() === false; });
      ok('a switch value that is not exactly true ("true", "false", 1, 0, null, {}, false) is "not headless"', ignored);
    } finally {
      if (had) g[AI_CONSENT_HEADLESS_SWITCH] = before; else delete g[AI_CONSENT_HEADLESS_SWITCH];
    }
  }
  // unreadable storage keeps this session's answer
  {
    const s = fakeStorage();
    const gate = createAiConsentGate({ storage: s.storage });
    gate.setHost({ isWeb: false, prompt: async () => true });
    await gate.grant();
    s.failReads();
    ok('storage refuses a read: this session\u2019s answer holds', (await gate.ensure()) === true);
  }
  // A NO THE PHONE COULD NOT STORE STILL HOLDS ON THIS PHONE. AI is switched off, the write is
  // refused, and storage keeps the older yes. ensure() re-reads storage first; before this rule
  // that read put the yes back, and this app's own AI buttons went on sending after the no.
  {
    const s = fakeStorage({ [AI_CONSENT_STORAGE_KEY]: 'granted' });
    const gate = createAiConsentGate({ storage: s.storage });
    let asked = 0;
    gate.setHost({ isWeb: false, prompt: async () => { asked++; return true; } });
    const heard: string[] = [];
    gate.onAnswer((a) => heard.push(a));
    const { call, sent } = makeAiCall(gate);
    await call('before');
    ok('a stored yes: sent (the starting point)', sent.length === 1 && asked === 0);
    s.failWrites();
    await gate.decline();
    ok('AI switched off, the write refused: storage still holds the old yes, and the answer event fired (the account is told)',
      s.map.get(AI_CONSENT_STORAGE_KEY) === 'granted' && s.log.includes(`set:${AI_CONSENT_STORAGE_KEY}=declined`) && heard.join(',') === 'declined');
    let err: unknown = null;
    try { await call('after the no'); } catch (e) { err = e; }
    ok('…the NEXT AI request is refused: the stale stored yes does not come back, nothing is sent, nobody is asked',
      sent.length === 1 && isAiConsentDeclinedError(err) && asked === 0 && gate.getState() === 'declined', `sent ${sent.length}, asked ${asked}, state ${gate.getState()}`);
    ok('…and a re-read (a screen mounting, a foreground) says no as well, every time',
      (await gate.load()) === 'declined' && (await gate.load()) === 'declined' && (await gate.ensure()) === false);
    // The person turns AI back on: a yes is a yes, stored or not (storage already says yes).
    await gate.grant();
    ok('…a yes given afterwards is honored (the person changed his mind): sent again', (await gate.ensure()) === true && heard.join(',') === 'declined,granted');
    // Reset with the removal refused: the person is asked again, not waved through on the old yes.
    await gate.reset();
    ok('reset() with the removal refused: the stored yes is not taken back; the question is asked',
      s.map.get(AI_CONSENT_STORAGE_KEY) === 'granted' && gate.getState() === 'unknown' && (await gate.ensure()) === true && asked === 1);
  }
  // …a stored NO, or no stored answer, is still read after a failed write (neither can open the
  // gate), and once a write lands storage is the truth again.
  {
    const s = fakeStorage({ [AI_CONSENT_STORAGE_KEY]: 'declined' });
    const gate = createAiConsentGate({ storage: s.storage });
    s.failWrites();
    await gate.grant();
    ok('a YES the phone could not store, over a stored no: the stored no is read, refused (fail closed, as before)', (await gate.ensure()) === false && gate.getState() === 'declined');
    s.map.delete(AI_CONSENT_STORAGE_KEY);
    let asked = 0;
    gate.setHost({ isWeb: false, prompt: async () => { asked++; return false; } });
    ok('…and with the stored answer gone (the sign-out sweep) the question is asked', (await gate.ensure()) === false && asked === 1);
    s.failWrites(false);
    await gate.decline();
    ok('a write that lands ends it: declined is stored', s.map.get(AI_CONSENT_STORAGE_KEY) === 'declined');
    s.map.set(AI_CONSENT_STORAGE_KEY, 'granted');
    ok('…and storage is the truth again (a stored yes is read)', (await gate.load()) === 'granted' && (await gate.ensure()) === true);
  }
  // reset / revoke
  {
    const s = fakeStorage({ [AI_CONSENT_STORAGE_KEY]: 'granted' });
    const gate = createAiConsentGate({ storage: s.storage });
    let asked = 0;
    gate.setHost({ isWeb: false, prompt: async () => { asked++; return false; } });
    await gate.decline();
    ok('Settings \u2192 Off: declined stored, next call refused', s.map.get(AI_CONSENT_STORAGE_KEY) === 'declined' && (await gate.ensure()) === false && asked === 0);
    await gate.reset();
    ok('reset(): the key is removed, state unknown', !s.map.has(AI_CONSENT_STORAGE_KEY) && gate.getState() === 'unknown');
    await gate.ensure();
    ok('after reset the question is asked again', asked === 1);
  }
  ok('parseAiConsent: anything but granted/declined is unknown',
    parseAiConsent('granted') === 'granted' && parseAiConsent('declined') === 'declined'
    && parseAiConsent('yes') === 'unknown' && parseAiConsent(null) === 'unknown');
}

// ── A2. The three answers, pressed ────────────────────────────────────────
//
// Round-3 review: the validator only checked that the copy constants appear
// in the host file. With "Not now" (or a dismissed alert) rewired to a yes,
// everything stayed green — a silent grant, the exact thing 5.1.2(i) forbids.
// The answers are now pure logic (utils/aiConsentCore askAiConsentOnce) and
// each one is pressed here on a fake alert.
type FakeAlert = { title: string; message: string; buttons: AiConsentAlertButton[]; options: { cancelable: boolean; onDismiss: () => void } };
function fakeAlert() {
  const shown: FakeAlert[] = [];
  const show = (title: string, message: string, buttons: AiConsentAlertButton[], options: { cancelable: boolean; onDismiss: () => void }) => {
    shown.push({ title, message, buttons, options });
  };
  const press = (alertIdx: number, text: string) => {
    // A button (or a whole alert) that is not there is simply not pressed: the
    // check that follows then fails by name instead of the run crashing.
    shown[alertIdx]?.buttons.find((x) => x.text === text)?.onPress();
  };
  return { shown, show, press };
}
/** Settled value of a promise right now, or 'pending'. */
async function peek(p: Promise<boolean>): Promise<boolean | 'pending'> {
  return Promise.race([p, new Promise<'pending'>((r) => setTimeout(() => r('pending'), 5))]);
}

async function partA2() {
  console.log('\n── A2. the three answers, pressed on a fake alert ──');
  const ALLOW = 'Allow AI features', NOT_NOW = 'Not now', POLICY = 'Privacy policy';
  {
    const a = fakeAlert();
    const p = askAiConsentOnce(a.show, () => {});
    const first = a.shown[0];
    ok('the alert shows the question: its title, the full message, and exactly three answers',
      a.shown.length === 1 && first.title === AI_CONSENT_COPY.title && first.message === aiConsentAlertMessage()
      && first.buttons.map((b) => b.text).join('|') === [POLICY, NOT_NOW, ALLOW].join('|'));
    ok('"Not now" is the cancel answer; no tap-outside dismissal', first.buttons[1].style === 'cancel' && first.options.cancelable === false);
    ok('nothing is answered until a button is pressed', (await peek(p)) === 'pending');
    a.press(0, ALLOW);
    ok('"Allow AI features" → yes', (await peek(p)) === true);
  }
  {
    const a = fakeAlert();
    const p = askAiConsentOnce(a.show, () => {});
    a.press(0, NOT_NOW);
    ok('"Not now" → no (never a silent grant)', (await peek(p)) === false);
    a.press(0, ALLOW);
    ok('the first answer wins: a later press changes nothing', (await p) === false);
  }
  {
    const a = fakeAlert();
    const p = askAiConsentOnce(a.show, () => {});
    a.shown[0].options.onDismiss();
    ok('an alert the system dismisses → no (never a silent grant)', (await peek(p)) === false);
  }
  {
    const a = fakeAlert();
    let opened = 0;
    const p = askAiConsentOnce(a.show, () => { opened++; });
    a.press(0, POLICY);
    ok('"Privacy policy" opens the policy, is not an answer, and the question comes back',
      opened === 1 && a.shown.length === 2 && (await peek(p)) === 'pending');
    a.press(0, ALLOW);
    a.shown[0].options.onDismiss();
    ok('the spent first alert can no longer answer', (await peek(p)) === 'pending');
    a.press(1, NOT_NOW);
    ok('…and the second alert’s "Not now" → no', (await peek(p)) === false);
  }
  {
    const a = fakeAlert();
    const p = askAiConsentOnce(a.show, () => { throw new Error('no browser'); });
    a.press(0, POLICY);
    a.press(1, ALLOW);
    ok('a policy link that fails to open still asks again; "Allow" on it → yes', a.shown.length === 2 && (await peek(p)) === true);
  }
  // Through the real gate: what each answer STORES.
  for (const [label, act, want] of [
    ['"Not now"', (a: ReturnType<typeof fakeAlert>) => a.press(0, NOT_NOW), 'declined'],
    ['a dismissed alert', (a: ReturnType<typeof fakeAlert>) => a.shown[0].options.onDismiss(), 'declined'],
    ['"Allow AI features"', (a: ReturnType<typeof fakeAlert>) => a.press(0, ALLOW), 'granted'],
  ] as const) {
    const s = fakeStorage();
    const gate = createAiConsentGate({ storage: s.storage });
    const a = fakeAlert();
    gate.setHost({ isWeb: false, prompt: () => askAiConsentOnce(a.show, () => {}) });
    const e = gate.ensure();
    await new Promise((r) => setTimeout(r, 5));
    act(a);
    const yes = await e;
    ok(`through the gate: ${label} stores '${want}'`, s.map.get(AI_CONSENT_STORAGE_KEY) === want && yes === (want === 'granted'));
  }
}

// ── B. The question and the key ───────────────────────────────────────────
function partB() {
  console.log('\n\u2500\u2500 B. the question names the providers \u2500\u2500');
  const FN_DIR = join(ROOT, 'supabase', 'functions');
  const fnSource = (name: string): string => {
    const dir = join(FN_DIR, name);
    let out = '';
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js)$/.test(f)) out += readFileSync(p, 'utf8') + '\n';
      }
    };
    walk(dir);
    return out;
  };
  const sharedEmbeddings = readFileSync(join(FN_DIR, '_shared', 'embeddings.ts'), 'utf8');
  const fnNames = readdirSync(FN_DIR).filter((n) => !n.startsWith('_') && statSync(join(FN_DIR, n)).isDirectory());
  const all = fnNames.map((n) => fnSource(n)).join('\n') + readdirSync(join(FN_DIR, '_shared')).map((f) => {
    const p = join(FN_DIR, '_shared', f);
    return statSync(p).isFile() ? readFileSync(p, 'utf8') : '';
  }).join('\n');
  const msg = aiConsentAlertMessage();
  const usesGemini = /generativelanguage\.googleapis\.com/.test(all) || /generativelanguage/.test(sharedEmbeddings);
  const usesAnthropic = /api\.anthropic\.com|@anthropic-ai\/sdk/.test(all);
  const usesStt = /toolkit\.rork\.com\/stt/.test(all);
  ok('the functions call Google Gemini → the question names "Google Gemini"', !usesGemini || /Google Gemini/.test(msg));
  ok('the functions call Anthropic → the question names "Anthropic Claude"', !usesAnthropic || /Anthropic Claude/.test(msg));
  ok('transcribe-audio relays to a speech-to-text service → the question says so', !usesStt || /speech-to-text service/i.test(msg));
  const UNDISCLOSED = /api\.openai\.com|openai\.azure|api\.deepgram\.com|api\.assemblyai\.com|api\.elevenlabs\.io|api\.cohere\.|api\.mistral\.ai|api\.groq\.com|api\.replicate\.com|api\.together\.xyz|api\.voyageai\.com/;
  const hit = all.match(UNDISCLOSED);
  ok('no edge function calls an AI vendor the question does not name', !hit, hit ? `found ${hit[0]} — add it to AI_CONSENT_COPY.providers` : '');
  ok('says what is sent: typed or said, project details, photos/plans, recordings',
    /What you type or say/.test(msg) && /project details/.test(msg) && /Photos, plan pages and documents/.test(msg) && /Voice recordings/.test(msg));
  ok('says what it is used for and that it is revocable', /used only to answer that request/.test(msg) && /Settings \u2192 AI features/.test(msg));
  ok('title and buttons are the spec\u2019s words',
    AI_CONSENT_COPY.title === 'Use AI features?' && AI_CONSENT_COPY.allow === 'Allow AI features' && AI_CONSENT_COPY.notNow === 'Not now');
  ok('the privacy link is https://mageid.app/privacy', AI_CONSENT_PRIVACY_URL === 'https://mageid.app/privacy' && AI_CONSENT_COPY.privacyLink === 'Privacy policy');
  ok('American spelling in the question (analyze, not analyse)', !/analys(e|ing)|authoris|organis|colour|licence\b|favour/i.test(msg + AI_CONSENT_OFF_MESSAGE));
  ok('never "unlimited"', !/unlimited/i.test(msg));

  ok('"from this app": the question claims only what the gate controls',
    AI_CONSENT_COPY.use.includes('Nothing is sent from this app until you allow it') && !/Nothing is sent until/.test(msg));
  // The two server paths that send job records to an AI vendor with no tap in
  // the app. While either function reaches a vendor, the question must say so.
  const serverAi = aiFunctions();
  ok('the weekly recap function reaches an AI vendor → the question names the "weekly client recap", sent "with no tap from you"',
    !serverAi.has('homeowner-weekly-digest') || (/weekly client recap/.test(msg) && /with no tap from you/.test(msg)));
  ok('portal-ask-home reaches an AI vendor → the question names "Ask Your Home", sent "with no tap from you"',
    !serverAi.has('portal-ask-home') || (/Ask Your Home/.test(msg) && /with no tap from you/.test(msg)));

  const sheet = stripComments(read('components/AiConsentSheet.tsx'));
  ok('the host asks through askAiConsentOnce (the answers pressed in A2), with the app’s own alert',
    /prompt: \(\) => askAiConsentOnce\(showAlert, openPrivacyPolicy\)/.test(sheet)
    && /import \{ showAlert \} from '@\/utils\/alert';/.test(sheet)
    && /import \{[^}]*\baskAiConsentOnce\b[^}]*\} from '@\/utils\/aiConsent';/.test(sheet));
  ok('the host has no answer logic of its own (one prompt, no resolve / done / onPress in the file)',
    (sheet.match(/\bprompt:/g) ?? []).length === 1 && !/\bresolve\b|\bdone\(|onPress|onDismiss|new Promise/.test(sheet));
  ok('the Privacy policy answer opens https://mageid.app/privacy',
    /const openPrivacyPolicy = \(\): void => \{\s*Linking\.openURL\(AI_CONSENT_PRIVACY_URL\)/.test(sheet));
  ok('the host registers isWeb from Platform.OS', /isWeb: Platform\.OS === 'web'/.test(sheet) && /setAiConsentHost\(null\)/.test(sheet));

  console.log('\n\u2500\u2500 B2. the storage key \u2500\u2500');
  ok(`the key (${AI_CONSENT_STORAGE_KEY}) is under an app prefix`, APP_STORAGE_PREFIXES.some((p) => AI_CONSENT_STORAGE_KEY.startsWith(p)));
  ok('the key is tenant-scoped (wiped with the person\u2019s data), not device-scoped', !DEVICE_SCOPED_KEYS.includes(AI_CONSENT_STORAGE_KEY));
}

// ── C. Every entry point ──────────────────────────────────────────────────

/** Comments blanked to spaces, line structure kept, strings untouched. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'bt' = 'code';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") mode = 'sq'; else if (c === '"') mode = 'dq'; else if (c === '`') mode = 'bt';
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } else out += ' '; i++; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; out += '  '; i += 2; continue; } out += c === '\n' ? c : ' '; i++; continue; }
    // strings
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'bt' && c === '`')) mode = 'code';
    if ((mode === 'sq' || mode === 'dq') && c === '\n') mode = 'code';
    out += c; i++;
  }
  return out;
}

/** From `header` to the end of that top-level declaration (the first line that is just `}`). */
function topBlock(src: string, header: string): string {
  const at = src.indexOf(header);
  if (at < 0) return '';
  const end = src.indexOf('\n}\n', at);
  return src.slice(at, end < 0 ? src.length : end + 2);
}

function listClientFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(join(ROOT, d))) {
      if (f === 'node_modules' || f === '__tests__' || f.startsWith('.')) continue;
      const rel = join(d, f);
      const st = statSync(join(ROOT, rel));
      if (st.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f)) out.push(rel);
    }
  };
  for (const d of ['app', 'components', 'utils', 'hooks', 'contexts', 'lib']) if (existsSync(join(ROOT, d))) walk(d);
  return out;
}

/**
 * Top-level directories Metro can never put in the app bundle, each with why.
 * EVERY OTHER top-level directory is swept by listBundledFiles (the list is
 * read from the disk, so a source directory added later is covered the day it
 * is added, with nobody remembering to list it).
 */
const NOT_BUNDLED: Record<string, string> = {
  node_modules: 'third-party packages (the switch is this repo\'s own global; a package cannot be edited in a commit)',
  __tests__: 'jest suites: never imported by app code; a suite may set the switch for its own run',
  scripts: 'bun validators: never imported by app code; a validator may set the switch for its own run',
  supabase: 'the server (Deno edge functions and SQL): another runtime, never bundled',
  docs: 'documents',
  marketing: 'the static marketing site: its own pages, not the app bundle',
  android: 'native project',
  ios: 'native project',
};
/**
 * Every source file Metro COULD bundle: .ts / .tsx / .js / .jsx / .mjs / .cjs
 * under every top-level directory that is not in NOT_BUNDLED (constants/,
 * i18n/, modules/, mocks/, stubs/, types/, plugins/, … and whatever is added
 * later), plus the source files at the repo root (the Metro and Babel config
 * and any entry file). Metro bundles what an import resolves to, not what a
 * list says, so a file in any of them can end up in the app.
 */
function listBundledFiles(): { files: string[]; dirs: string[] } {
  const out: string[] = [];
  const dirs: string[] = [];
  const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
  const walk = (d: string) => {
    for (const f of readdirSync(join(ROOT, d))) {
      if (f === 'node_modules' || f === '__tests__' || f.startsWith('.')) continue;
      const rel = join(d, f);
      const st = statSync(join(ROOT, rel));
      if (st.isDirectory()) walk(rel);
      else if (SOURCE.test(f) && !/\.d\.ts$/.test(f)) out.push(rel);
    }
  };
  for (const f of readdirSync(ROOT).sort()) {
    if (f.startsWith('.')) continue;
    const st = statSync(join(ROOT, f));
    if (st.isDirectory()) {
      if (Object.prototype.hasOwnProperty.call(NOT_BUNDLED, f)) continue;
      dirs.push(f);
      walk(f);
    } else if (SOURCE.test(f) && !/\.d\.ts$/.test(f)) out.push(f);
  }
  return { files: out, dirs };
}

/** Edge functions whose code reaches an AI vendor (derived, not listed). */
function aiFunctions(): Set<string> {
  const FN_DIR = join(ROOT, 'supabase', 'functions');
  const AI_HOST = /generativelanguage\.googleapis\.com|api\.anthropic\.com|@anthropic-ai\/sdk|toolkit\.rork\.com\/stt|_shared\/embeddings(\.ts)?['"]/;
  const set = new Set<string>();
  for (const n of readdirSync(FN_DIR)) {
    if (n.startsWith('_')) continue;
    const dir = join(FN_DIR, n);
    if (!statSync(dir).isDirectory()) continue;
    let src = '';
    for (const f of readdirSync(dir)) if (/\.ts$/.test(f)) src += readFileSync(join(dir, f), 'utf8');
    if (AI_HOST.test(src)) set.add(n);
  }
  return set;
}

/** Functions an app call may reach without the gate, each with its reason. */
const EXEMPT_FUNCTIONS: Record<string, string> = {
  'portal-ask-home': 'the homeowner\u2019s web portal calls it; the app never does',
};

type Site = { file: string; line: number; fn: string; how: string };

/** The line where the async function or arrow that CONTAINS line idx starts:
 *  the nearest `async` above it whose body block is still open at idx (an
 *  inner `photos.map(async (p) => { … })` that closed earlier is skipped). */
function enclosingAsyncStart(lines: string[], idx: number): number {
  const ASYNC = /\basync\b\s*(function\b|\(|[A-Za-z_$][\w$]*\s*=>)|\basync\s+[A-Za-z_$][\w$]*\s*\(/;
  const text = lines.join('\n');
  const offsetOf = (line: number) => lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  const target = offsetOf(idx);
  for (let i = idx; i >= 0; i--) {
    const m = lines[i].match(ASYNC);
    if (!m || m.index === undefined) continue;
    // The body: the first `{` after the async token that follows its `=>` or `)`.
    let p = offsetOf(i) + m.index;
    let open = -1;
    let paren = 0;
    let angle = 0; // a return type like Promise<{ data: T }> is not the body
    for (; p < text.length; p++) {
      const c = text[p];
      if (c === '(') paren++;
      else if (c === ')') paren--;
      else if (c === '<') angle++;
      else if (c === '>' && text[p - 1] !== '=') angle = Math.max(0, angle - 1);
      else if (c === '{' && paren <= 0 && angle === 0) { open = p; break; }
    }
    if (open < 0 || open > target) { if (open > target) continue; return i; }
    let depth = 0;
    let close = text.length;
    for (let q = open; q < text.length; q++) {
      if (text[q] === '{') depth++;
      else if (text[q] === '}') { depth--; if (depth === 0) { close = q; break; } }
    }
    if (close >= target) return i;
  }
  return -1;
}

function partC() {
  console.log('\n\u2500\u2500 C. every AI entry point awaits the gate first \u2500\u2500');
  const AI = aiFunctions();
  ok('AI functions were found by their outbound hosts (sanity)', AI.has('ai') && AI.has('analyze-photos') && AI.has('transcribe-audio') && AI.has('construction-answer'),
    `found: ${[...AI].sort().join(', ')}`);
  const files = listClientFiles();
  const sites: Site[] = [];
  const ungated: string[] = [];
  const GATE = /\b(ensureAiConsent|requireAiConsent)\s*\(/;
  for (const file of files) {
    const raw = read(file);
    const code = stripComments(raw);
    const lines = code.split('\n');
    const rawLines = raw.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      for (const fn of AI) {
        const lit = new RegExp(`(['"\`])${fn.replace(/-/g, '\\-')}\\1|/${fn.replace(/-/g, '\\-')}['"\`]`);
        if (!lit.test(line)) continue;
        // Is this occurrence the argument of a network call? Look back to the
        // start of the call expression (same line or a multi-line generic).
        let callLine = -1;
        let how = '';
        for (let k = li; k >= Math.max(0, li - 8); k--) {
          const m = lines[k].match(/(functions\.invoke|invokeWithTimeout|\bfetch)\s*(<|\()/);
          if (m) { callLine = k; how = m[1]; break; }
        }
        if (callLine < 0) continue; // a route path, a feature id, a URL constant
        if (sites.some((x) => x.file === file && x.line === callLine + 1 && x.fn === fn)) continue;
        sites.push({ file, line: callLine + 1, fn, how });
        if (EXEMPT_FUNCTIONS[fn]) continue;
        const marker = rawLines.slice(Math.max(0, callLine - 4), callLine + 1).join('\n');
        if (/ai-consent:\s*exempt\b\s*\S/.test(marker)) continue;
        const start = enclosingAsyncStart(lines, callLine);
        const body = start < 0 ? '' : lines.slice(start, callLine + 1).join('\n');
        if (process.env.AI_CONSENT_SITES) console.log(`      ${file}:${callLine + 1} ${fn} ← ${start + 1}: ${(lines[start] ?? '').trim().slice(0, 70)}`);
        if (!GATE.test(body)) ungated.push(`${file}:${callLine + 1} ${how}('${fn}')`);
      }
    }
  }
  ok(`every direct AI call site is gated (${sites.length} sites found)`, ungated.length === 0, ungated.join('\n      '));
  if (process.env.AI_CONSENT_SITES) for (const st of sites) console.log(`      ${st.file}:${st.line} ${st.how}('${st.fn}')`);
  ok('the sweep found the sites this file was written against (no silent zero)', sites.length >= 25, `sites: ${sites.length}`);

  // URL constants → the fetch that uses them must be gated in its function.
  const viaConst: string[] = [];
  for (const file of files) {
    const code = stripComments(read(file));
    const consts = [...code.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*`[^`]*\/(?:functions\/v1\/)?([a-z0-9-]+)`/g)]
      .filter((m) => AI.has(m[2]) && !EXEMPT_FUNCTIONS[m[2]]).map((m) => m[1]);
    if (consts.length === 0) continue;
    const lines = code.split('\n');
    lines.forEach((l, i) => {
      if (!/\bfetch\s*\(/.test(l)) return;
      const start = enclosingAsyncStart(lines, i);
      if (start < 0 || !GATE.test(lines.slice(start, i + 1).join('\n'))) viaConst.push(`${file}:${i + 1}`);
    });
  }
  ok('every fetch in a file that builds an AI function URL is gated', viaConst.length === 0, viaConst.join('\n      '));

  // The indirect transports, pinned by name.
  const fnBody = (src: string, header: RegExp): string => {
    const m = src.match(header);
    if (!m || m.index === undefined) return '';
    const open = src.indexOf('{', m.index + m[0].length - 1);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
    }
    return '';
  };
  const mageAI = stripComments(read('utils/mageAI.ts'));
  const mb = fnBody(mageAI, /export async function mageAI\(params: MageAIParams\): Promise<MageAIResult> \{/);
  ok('mageAI(): the gate runs before the relay fetch, refusing with the sentence and code',
    mb.indexOf('ensureAiConsent()') > 0 && mb.indexOf('ensureAiConsent()') < mb.indexOf('fetch(AI_URL')
    && /error: AI_CONSENT_OFF_MESSAGE/.test(mb) && /errorCode: AI_CONSENT_DECLINED_CODE/.test(mb));
  ok('mageAI(): the refusal reuses an existing errorKind (copies of the union elsewhere still type-check)', /errorKind: 'unknown', errorCode: AI_CONSENT_DECLINED_CODE/.test(mb));
  const pm = stripComments(read('utils/projectMemory.ts'));
  const ab = fnBody(pm, /async function authedPost\(url: string, body: unknown\): Promise<unknown \| null> \{/);
  ok('Project Memory authedPost(): gated before its fetch', ab.indexOf('ensureAiConsent()') > 0 && ab.indexOf('ensureAiConsent()') < ab.indexOf('fetch('));
  // Round-3 review: authedPost's null read as "The search index could not be
  // updated just now", and the Home Passport build then said "Check your
  // connection and try again" to a person who had turned AI off. The sync
  // asks the gate ITSELF, first, and answers with the sentence and the code.
  const sb = fnBody(pm, /export async function syncMemoryEmbeddings\([\s\S]*?\): Promise<MemorySyncStatus> \{/);
  const sGate = sb.indexOf('!(await ensureAiConsent())');
  ok('Project Memory syncMemoryEmbeddings(): the gate is the FIRST thing the run does, before any record is hashed or sent',
    /const run = \(async \(\): Promise<MemorySyncStatus> => \{\s*if \(!\(await ensureAiConsent\(\)\)\) \{/.test(sb)
    && sGate > 0 && sGate < sb.indexOf('memoryDocHash(') && sGate < sb.indexOf('authedPost(')
    && (sb.match(/\bensureAiConsent\(/g) ?? []).length === 1);
  ok('…and a refusal returns the sentence and the machine code (never "could not be updated just now")',
    /if \(!\(await ensureAiConsent\(\)\)\) \{\s*return \{ total, indexed: 0, ok: false, reason: AI_CONSENT_OFF_MESSAGE, code: AI_CONSENT_DECLINED_CODE \};\s*\}/.test(sb));
  ok('…a call that waited on a refused run gets the refusal too, and a refusal is never recorded as the last sync',
    /return ran\.code \? \{ \.\.\.ran, total \} : lastSyncByProject\.get\(projectId\)/.test(sb)
    && sb.indexOf('lastSyncByProject.set(') > sGate
    && !/lastSyncByProject\.set\(/.test(sb.slice(sGate, sb.indexOf('const hashes ='))));
  const syncCallers = files.filter((f) => f !== 'utils/projectMemory.ts' && /\bsyncMemoryEmbeddings\(/.test(stripComments(read(f))));
  const deaf = syncCallers.filter((f) => {
    const c = stripComments(read(f));
    return !/\.code === AI_CONSENT_DECLINED_CODE/.test(c) || !/AI_CONSENT_OFF_MESSAGE/.test(c);
  });
  ok(`every screen that syncs the index reads the refusal code and shows the sentence (${syncCallers.length} callers)`,
    syncCallers.length >= 2 && deaf.length === 0, `callers: ${syncCallers.join(', ')}; not handling it: ${deaf.join(', ')}`);
  const binder = stripComments(read('app/closeout-binder.tsx'));
  const refusedAt = binder.indexOf('if (indexStatus.code === AI_CONSENT_DECLINED_CODE) {');
  const failedAt = binder.indexOf('if (!indexStatus.ok) {');
  const refusedBlock = refusedAt < 0 || failedAt < 0 ? '' : binder.slice(refusedAt, failedAt);
  ok('closeout binder: a refused index says "AI features are off" and stops, BEFORE the "Check your connection" alert',
    refusedAt > 0 && refusedAt < failedAt
    && /^if \(indexStatus\.code === AI_CONSENT_DECLINED_CODE\) \{\s*showAlert\(AI_CONSENT_OFF_TITLE, AI_CONSENT_OFF_MESSAGE\);\s*return;\s*\}\s*$/.test(refusedBlock)
    && refusedAt > binder.indexOf('await syncMemoryEmbeddings(project.id, memoryDocs)'), refusedBlock.slice(0, 200));
  const memScreen = stripComments(read('app/project-memory.tsx'));
  ok('Project Memory screen: with AI off the index line is the sentence, not "N of M indexed"',
    /\{syncStatus\?\.code === AI_CONSENT_DECLINED_CODE \? \(\s*<Text style=\{styles\.indexNote\} testID="memory-index-status">\{AI_CONSENT_OFF_MESSAGE\}<\/Text>\s*\) : syncStatus && syncStatus\.total > 0/.test(memScreen));
  const tq = stripComments(read('utils/audioTranscribeQueue.ts'));
  ok('the offline dictation queue keeps recordings queued while AI is off (no retry spent)',
    /if \(!\(await ensureAiConsent\(\)\)\) \{\s*kept\.push\(\.\.\.pending\.slice\(pending\.indexOf\(task\)\)\);\s*break;/.test(tq)
    && tq.indexOf('ensureAiConsent()') < tq.indexOf('await transcribeAudio('));

  // A refusal is never a silent no-op: every file that branches on the gate
  // shows the sentence (requireAiConsent throws it, so its callers' own error
  // paths carry it).
  const silent: string[] = [];
  const QUIET_OK: Record<string, string> = {
    'utils/audioTranscribeQueue.ts': 'a background drain: the recordings stay queued; the dictation sheet itself asks before recording',
  };
  // One FUNCTION, not a file (round-3 review: the whole of utils/projectMemory
  // was excused, which hid the index sync telling a person who turned AI off
  // to check his connection). The sync now answers with the sentence itself
  // (pinned above); what stays quiet is only the transport's null, and only
  // while its other two callers are searches that fall back to this phone.
  const QUIET_FN: Record<string, { why: string; pin: (code: string) => boolean }> = {
    'utils/projectMemory.ts::authedPost': {
      why: 'search only: a null sends answerFromMemorySemantic / retrieveRelevantSemantic to the keyword path on this phone, and the answer step goes through mageAI, which carries the sentence; the index sync asks the gate itself',
      // Every authedPost( in the file is its declaration, the gated sync (×2),
      // or one of the two searches (×1 each). A new caller fails this.
      pin: (code) => {
        const n = (src: string) => (src.match(/\bauthedPost\(/g) ?? []).length;
        return n(code) === 5
          && n(fnBody(code, /export async function syncMemoryEmbeddings\([\s\S]*?\): Promise<MemorySyncStatus> \{/)) === 2
          && n(fnBody(code, /export async function answerFromMemorySemantic\([\s\S]*?\): Promise<MemoryAnswer> \{/)) === 1
          && n(fnBody(code, /export async function retrieveRelevantSemantic\([\s\S]*?\): Promise<MemoryDoc\[\]> \{/)) === 1;
      },
    },
  };
  const usedQuietFn = new Set<string>();
  for (const file of files) {
    const code = stripComments(read(file));
    if (!/\bensureAiConsent\s*\(/.test(code) || file.startsWith('utils/aiConsent') || QUIET_OK[file]) continue;
    const lines = code.split('\n');
    // Each refusal branch itself must carry the sentence, not just the file.
    for (const m of code.matchAll(/!\(await ensureAiConsent\(\)\)\)?/g)) {
      const branch = code.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 420);
      if (/AI_CONSENT_OFF_MESSAGE/.test(branch)) continue;
      const line = code.slice(0, m.index).split('\n').length;
      const key = `${file}::${enclosingFnName(lines, line - 1)}`;
      if (QUIET_FN[key]) {
        usedQuietFn.add(key);
        if (!QUIET_FN[key].pin(code)) silent.push(`${key}: listed as quiet, but the code no longer proves it (${QUIET_FN[key].why})`);
        continue;
      }
      silent.push(`${file}:${line}`);
    }
  }
  ok('every ensureAiConsent() refusal shows "AI features are off…" (no silent no-op)', silent.length === 0, silent.join(', '));
  const staleFn = Object.keys(QUIET_FN).filter((k) => !usedQuietFn.has(k));
  ok('no stale quiet-function entry', staleFn.length === 0, staleFn.join(', '));

  partC3(files);
  partC4(files);
  partC5(files);

  console.log('\n\u2500\u2500 C2. the host and the switch \u2500\u2500');
  const layout = stripComments(read('app/_layout.tsx'));
  ok('app/_layout.tsx imports and mounts <AiConsentSheet />',
    /import AiConsentSheet from "@\/components\/AiConsentSheet";/.test(layout) && /<AiConsentSheet \/>/.test(layout));

  // THE HEADLESS SWITCH IS NEVER SET BY THE APP. With no host and no stored answer the gate
  // refuses (executed in A). The only way through is aiConsentHeadless(): the named switch. So
  // no app file may name the switch (to set it, or at all), and the gate file reads no runtime
  // global. `files` is every .ts / .tsx under app/, components/, utils/, hooks/, contexts/ and
  // lib/.
  {
    const CORE = 'utils/aiConsentCore.ts';
    const core = stripComments(read(CORE));
    ok('the gate fails closed: "if (!host) return aiConsentHeadless();" (and no "if (!host) return true;")',
      core.includes('if (!host) return aiConsentHeadless();') && !/if \(!host\) return true;/.test(core) && (core.match(/\baiConsentHeadless\(\)/g) ?? []).length === 2);
    ok(`the switch is the global '${AI_CONSENT_HEADLESS_SWITCH}', and ${CORE} only READS it (one read, inside aiConsentHeadless; no assignment)`,
      AI_CONSENT_HEADLESS_SWITCH === '__MAGEID_AI_CONSENT_HEADLESS__'
      && (core.match(/AI_CONSENT_HEADLESS_SWITCH/g) ?? []).length === 2
      && core.includes('const flag = g[AI_CONSENT_HEADLESS_SWITCH];')
      && !/\[AI_CONSENT_HEADLESS_SWITCH\]\s*=[^=]/.test(core)
      && (core.match(/__MAGEID_AI_CONSENT_HEADLESS__/g) ?? []).length === 1);
    ok('…only the exact value true is headless, and no runtime is (the gate file names no Bun, process or navigator); anything unreadable is "not headless"',
      core.includes('return flag === true;')
      && !/\b(Bun|process|navigator)\b/.test(core)
      && /\} catch \{\s*return false;\s*\}/.test(topBlock(core, 'export function aiConsentHeadless(): boolean {')));
    const SWITCH_NAME = /__MAGEID_AI_CONSENT_HEADLESS__|AI_CONSENT_HEADLESS_SWITCH|aiConsentHeadless/;
    // EVERY directory Metro bundles from, not six named ones: a file under
    // constants/, i18n/, modules/, mocks/, stubs/ (or a directory added next
    // month) is bundled the moment something imports it.
    const bundled = listBundledFiles();
    const naming = bundled.files.filter((f) => f !== CORE && SWITCH_NAME.test(read(f)));
    ok(`no file Metro could bundle sets the headless switch: none even names it, comments included (${bundled.files.length} files under ${bundled.dirs.length} top-level directories and the repo root)`,
      bundled.files.includes(CORE) && bundled.files.length > 300 && naming.length === 0, naming.join(', '));
    const mustSweep = ['app', 'components', 'hooks', 'contexts', 'lib', 'utils', 'constants', 'i18n', 'modules', 'mocks', 'stubs', 'types'];
    ok('…the sweep is read from the disk: every top-level directory is swept unless it is one of the eight that can never be bundled, and the six it used to stop at plus constants/, i18n/, modules/, mocks/, stubs/ and types/ are all in it',
      mustSweep.filter((d) => existsSync(join(ROOT, d))).every((d) => bundled.dirs.includes(d)) && ['constants', 'i18n', 'modules', 'mocks', 'stubs'].every((d) => existsSync(join(ROOT, d)))
      && Object.keys(NOT_BUNDLED).sort().join() === '__tests__,android,docs,ios,marketing,node_modules,scripts,supabase' && bundled.dirs.every((d) => !(d in NOT_BUNDLED))
      && readdirSync(ROOT).filter((f) => !f.startsWith('.') && statSync(join(ROOT, f)).isDirectory()).every((d) => bundled.dirs.includes(d) !== (d in NOT_BUNDLED))
      && files.every((f) => bundled.files.includes(f))
      && ['constants/featureFlags.ts', 'i18n/index.ts', 'mocks/bids.ts', 'stubs/react-native-reanimated-absent.js', 'metro.config.js'].every((f) => bundled.files.includes(f)),
      `swept: ${bundled.dirs.join(', ')}`);
    ok('…and the sweep is live: the switch’s name is found in a file that names it, spelled any of the three ways',
      SWITCH_NAME.test(read(CORE)) && ['globalThis.__MAGEID_AI_CONSENT_HEADLESS__ = true;', '(globalThis as any)[AI_CONSENT_HEADLESS_SWITCH] = true;', 'if (aiConsentHeadless()) run();'].every((t) => SWITCH_NAME.test(t))
      && !SWITCH_NAME.test('const headless = true;'));
    const wrapper = stripComments(read('utils/aiConsent.ts'));
    ok('utils/aiConsent.ts (the app’s gate) builds the gate with storage only: createAiConsentGate({ storage: AsyncStorage })',
      wrapper.includes('const gate = createAiConsentGate({ storage: AsyncStorage });'));
  }
  const settings = stripComments(read('app/(tabs)/settings/index.tsx'));
  ok('Settings → AI features: On/Off from the stored answer, Off → decline',
    /<Text style=\{styles\.rowLabel\}>AI Features<\/Text>/.test(settings)
    && /\{aiConsentState === 'granted' \? 'On' : 'Off'\}/.test(settings)
    && /if \(!on\) \{ void declineAiConsent\(\); return; \}/.test(settings)
    && /subscribeAiConsent\(setAiConsentState\)/.test(settings));
  ok('…and On shows the same question first (who receives what), never a silent grant',
    /if \(getAiConsentState\(\) === 'granted'\) return;\s*void resetAiConsent\(\)\.then\(\(\) => ensureAiConsent\(\)\);/.test(settings)
    && !/grantAiConsent/.test(settings));
  // Round-3 review: "Nothing is sent to an AI provider." is a fact the phone
  // cannot know: the Friday recap cron and Ask Your Home run on the server.
  // Lane AICONSENT: the answer is now also stored on the account, and those two
  // functions read it (supabase/functions/_shared/aiConsent.ts) right before
  // any AI call. So the Off row claims the app's own AI buttons, and says the
  // server features FOLLOW THE ANSWER SAVED ON THE ACCOUNT — a sentence that is
  // only true while each function that reaches an AI vendor (derived from its
  // hosts) imports the shared gate and calls it. It never says the account was
  // told: the line beneath the row (components/AiAccountNote) states that.
  ok('Settings → AI features, Off: the row is AI_CONSENT_OFF_ROW',
    /: aiConsentState === 'declined'\s*\? AI_CONSENT_OFF_ROW\s*:/.test(settings));
  ok('the Off row claims only the app’s own AI buttons',
    AI_CONSENT_OFF_ROW.startsWith('AI buttons in this app send nothing to an AI provider until you turn this on.'));
  const readsAccountAnswer = (fn: string): boolean => {
    const src = stripComments(read(`supabase/functions/${fn}/index.ts`));
    return /import \{[^}]*\breadOwnerAiConsent\b[^}]*\} from ['"]\.\.\/_shared\/aiConsent\.ts['"];/.test(src) && /\bawait readOwnerAiConsent\(/.test(src);
  };
  ok('the weekly recap cron reaches an AI vendor → it reads the account’s answer (_shared/aiConsent), and the Off row says the recap follows it',
    !AI.has('homeowner-weekly-digest')
    || (readsAccountAnswer('homeowner-weekly-digest') && /weekly client recap/.test(AI_CONSENT_OFF_ROW) && /follow the answer saved on your account/.test(AI_CONSENT_OFF_ROW)));
  ok('portal-ask-home reaches an AI vendor → it reads the account’s answer (_shared/aiConsent), and the Off row names Ask Your Home',
    !AI.has('portal-ask-home')
    || (readsAccountAnswer('portal-ask-home') && /Ask Your Home/.test(AI_CONSENT_OFF_ROW) && /follow the answer saved on your account/.test(AI_CONSENT_OFF_ROW)));
  ok('the Off row no longer says the server "still uses AI" (the server now obeys the account)', !/still uses AI on our server/.test(AI_CONSENT_OFF_ROW));
  ok('…and that switch exists where the row says: "Send weekly recap" on the Client portal screen',
    /title: 'Client Portal'/.test(read('app/client-portal-setup.tsx')) && /<Text style=\{styles\.toggleLabel\}>Send Weekly Recap<\/Text>/.test(read('app/client-portal-setup.tsx')));
  const blanket = files.filter((f) => !f.startsWith('utils/aiConsent') && /Nothing is sent to an AI provider|Nothing is sent until you allow/.test(stripComments(read(f))));
  ok('no screen says a blanket "Nothing is sent to an AI provider" / "Nothing is sent until you allow"',
    blanket.length === 0 && !/Nothing is sent to an AI provider/.test(AI_CONSENT_OFF_ROW), blanket.join(', '));
  ok('the privacy FAQ answer is scoped the same way ("In this app, AI features…")',
    /In this app, AI features send what you choose to our AI providers only after you allow it/.test(settings));
  ok('American spelling and never "unlimited" in the Off row', !/analys(e|ing)|authoris|organis|colour|favour|unlimited/i.test(AI_CONSENT_OFF_ROW));
  ok('the row is phones only (the web app never asks)', /\{Platform\.OS !== 'web' && \(\s*<View style=\{styles\.row\} testID="ai-features-row">/.test(settings));
  ok('the message names the Settings row that exists', AI_CONSENT_OFF_MESSAGE.includes('Settings \u2192 AI features'));
}

// ── C3. mageAI callers carry the refusal's sentence ───────────────────────
//
// mageAI() refuses with { success:false, error: AI_CONSENT_OFF_MESSAGE,
// errorCode: AI_CONSENT_DECLINED_CODE }. A caller that writes its OWN failure
// words ("Could not reach AI — drafted a starter sheet") would tell a person
// who turned AI off that the network failed. THE RULE, per call site: either
// the code after the call is consent-aware (isAiConsentRefusal / aiConsentReason
// / AI_CONSENT_DECLINED_CODE), or every exit of its `if (!res.success…)` block
// (return / throw / showAlert / setError / setRun / dispatch / limitHit)
// carries `res.error` — which IS the sentence. Anything else is listed in
// MAGEAI_QUIET with its reason; an entry that names screens is only honoured
// while each of those screens asks first (ensureAiConsent) and so never
// reaches the util with AI off.

const MAGEAI_QUIET: Record<string, { why: string; screens?: string[] }> = {
  'utils/copilot/scheduleBuilder/followups.ts::generateFollowups': {
    why: 'optional extra questions; an empty list just skips them, and the schedule build that follows passes res.error through',
  },
  'utils/instantBid.ts::aiMidpoint': { why: 'never-throws enhancement; the proposal reports source: \'heuristic\' when the AI added nothing' },
  'utils/instantBid.ts::aiMessage': { why: 'never-throws enhancement; the proposal reports source: \'heuristic\' when the AI added nothing' },
  'utils/judges/narrateVerdict.ts::narrateVerdict': { why: 'falls back to the verdict\u2019s own deterministic driver sentences, which are true without the AI' },
  'utils/projectMemory.ts::answerFromMemorySemantic': { why: 'falls through to the keyword path, whose own mageAI call shows res.error' },
  'utils/voiceCommandParser.ts::parseBatchVoiceCommand': {
    why: 'both screens that call it ask first', screens: ['components/VoiceCommandModal.tsx'],
  },
  'utils/voiceCommandParser.ts::parseDailyReportVoice': {
    why: 'the one screen that calls it asks first', screens: ['components/VoiceCommandModal.tsx'],
  },
  'utils/voiceFormParsers.ts::*': {
    why: 'they read a transcript: the dictation (VoiceCaptureModal / transcribeAudio) refuses before there is one; the one typed-text caller asks first',
    screens: ['components/RFITriageModal.tsx', 'components/VoiceCaptureModal.tsx'],
  },
};

/** Name of the function that contains line idx (nearest declaration above whose body is open). */
function enclosingFnName(lines: string[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    const m = lines[i].match(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:useCallback\()?\s*async\b|^\s*([A-Za-z_$][\w$]*)\s*:\s*async\b/);
    if (m && enclosingAsyncStart(lines, idx) <= i) return m[1] ?? m[2] ?? m[3] ?? '?';
  }
  return '?';
}

/** From `from` (an index of `{`), the matching `}` index. */
function matchBrace(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return text.length;
}

/** The statement starting at i, up to its `;` (or the block's end) at depth 0. */
function statementAt(text: string, i: number, end: number): string {
  let depth = 0;
  for (let j = i; j < end; j++) {
    const c = text[j];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { if (depth === 0) return text.slice(i, j); depth--; }
    else if (c === ';' && depth === 0) return text.slice(i, j);
  }
  return text.slice(i, end);
}

/** One statement starting at i: up to its `;`, or through the `}` that closes
 *  a block it opened (`if (x) { … }`), or the bracket that closes its parent. */
function stmtFrom(text: string, i: number): string {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return text.slice(i, j);
      depth--;
      if (c === '}' && depth === 0) return text.slice(i, j + 1);
    } else if (c === ';' && depth === 0) return text.slice(i, j);
  }
  return text.slice(i);
}

/** Does the code after a mageAI call USE its consent check — does the refusal
 *  reach the person as the sentence — or does it only mention the check?
 *  (Round-2 review: with toolbox's `if (consentRefused) throw …` deleted, the
 *  caller still read as "aware" while filing template notes as AI-written.)
 *  A use is one of:
 *   • `throw aiFailureError(res, …)` — the typed rethrow;
 *   • `aiConsentReason(res) ?? …` / `return aiConsentReason(res)` — the
 *     sentence flows into the value shown;
 *   • `name = aiConsentReason(res)` and `name` is read afterwards;
 *   • `isAiConsentRefusal(res) ? … : …` whose statement carries the sentence;
 *   • `if (isAiConsentRefusal(res)) …` whose body throws AiConsentDeclinedError
 *     or carries AI_CONSENT_OFF_MESSAGE — or sets a flag that a LATER statement
 *     reads to do so;
 *   • `flag = isAiConsentRefusal(res)` and a later statement reads `flag` to
 *     throw AiConsentDeclinedError / carry AI_CONSENT_OFF_MESSAGE.
 *  A check whose result goes nowhere is not a use. */
export function consentCheckIsUsed(windowText: string): boolean {
  if (/\bthrow\s+aiFailureError\s*\(/.test(windowText)) return true;
  const SENTENCE = /\bthrow new AiConsentDeclinedError\b|\bAI_CONSENT_OFF_MESSAGE\b|\bthrow\s+aiFailureError\s*\(/;
  const closeParen = (open: number): number => {
    let depth = 0;
    for (let i = open; i < windowText.length; i++) {
      if (windowText[i] === '(') depth++;
      else if (windowText[i] === ')') { depth--; if (depth === 0) return i; }
    }
    return windowText.length;
  };
  /** `name` read (not assigned) after `from`; with needsSentence, only in a statement that carries the sentence. */
  const readLater = (name: string, from: number, needsSentence: boolean): boolean => {
    const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b(?!\\s*=[^=])`, 'g');
    re.lastIndex = from;
    for (let r = re.exec(windowText); r; r = re.exec(windowText)) {
      if (!needsSentence) return true;
      const lineStart = windowText.lastIndexOf('\n', r.index) + 1;
      if (SENTENCE.test(stmtFrom(windowText, lineStart))) return true;
    }
    return false;
  };
  for (const m of windowText.matchAll(/\b(isAiConsentRefusal|aiConsentReason)\s*\(/g)) {
    const at = m.index ?? 0;
    const close = closeParen(at + m[0].length - 1);
    const before = windowText.slice(Math.max(0, at - 120), at);
    const afterCall = windowText.slice(close + 1);
    const assigned = (before.match(/\b([A-Za-z_$][\w$]*)\s*=\s*$/) ?? [])[1];
    if (m[1] === 'aiConsentReason') {
      if (/^\s*\?\?/.test(afterCall) || /\?\?\s*$/.test(before) || /\breturn\s+$/.test(before)) return true;
      if (assigned && readLater(assigned, close + 1, false)) return true;
      continue;
    }
    // isAiConsentRefusal: a ternary, an if-condition, or a stored flag.
    if (/^\s*\?(?!\?)/.test(afterCall)) {
      const stmtStart = windowText.lastIndexOf('\n', at) + 1;
      if (SENTENCE.test(stmtFrom(windowText, stmtStart))) return true;
      continue;
    }
    if (/\bif\s*\(\s*$/.test(before)) {
      // the condition's own `)` then the body: a block or one statement
      const condClose = windowText.indexOf(')', close + 1);
      let b = condClose + 1;
      while (b < windowText.length && /\s/.test(windowText[b])) b++;
      const bodyEnd = windowText[b] === '{' ? matchBrace(windowText, b) : b + stmtFrom(windowText, b).length;
      const body = windowText.slice(b, bodyEnd + 1);
      if (SENTENCE.test(body)) return true;
      for (const f of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*true\b/g)) if (readLater(f[1], bodyEnd + 1, true)) return true;
      continue;
    }
    if (assigned && readLater(assigned, close + 1, true)) return true;
  }
  return false;
}

export function mageAICallerVerdict(code: string, callIdx: number, v: string | null): 'aware' | 'passes' | 'own-words' {
  // The window: the call's own arguments, then the 45 lines after it closes,
  // never reaching into the next mageAI call.
  const argOpen = code.indexOf('(', callIdx);
  let depth = 0;
  let argClose = code.length;
  for (let i = argOpen; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') { depth--; if (depth === 0) { argClose = i; break; } }
  }
  const after = code.slice(argClose).split('\n').slice(0, 46).join('\n');
  const next = code.indexOf('mageAI(', argClose);
  const windowText = code.slice(argClose, next < 0 ? argClose + after.length : Math.min(next, argClose + after.length));
  if (consentCheckIsUsed(windowText)) return 'aware';
  if (!v) return 'own-words';
  const ifRe = new RegExp(`if\\s*\\(\\s*!\\s*${v}\\.success[^)]*\\)\\s*`);
  const m = windowText.match(ifRe);
  if (!m || m.index === undefined) return 'own-words';
  const at = m.index + m[0].length;
  // `if (!res.success) { … }` or a braceless `if (!res.success) return …;`
  const body = windowText[at] === '{'
    ? windowText.slice(at + 1, matchBrace(windowText, at))
    : statementAt(windowText, at, windowText.length);
  // res.error itself, or a local the block starts from it (`const msg = r.error ?? …`).
  const names = [`${v}\\??\\.error\\b(?!Kind|Code|Detail)`];
  // Only a local whose value LEADS with res.error counts: `reason = cap ? res.error : 'Could not reach AI'` does not.
  for (const d of body.matchAll(new RegExp(`(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${v}\\??\\.error\\b(?!Kind|Code|Detail)`, 'g'))) names.push(`\\b${d[1]}\\b`);
  const carries = new RegExp(names.join('|'));
  const EXIT = /\b(return|throw|showAlert\(|set[A-Z]\w*\(|dispatch\(|limitHit\()/g;
  let exits = 0;
  for (const e of body.matchAll(EXIT)) {
    const stmt = statementAt(body, e.index ?? 0, body.length).trim();
    if (/^return\s*$/.test(stmt)) continue; // a bare return carries no words
    exits++;
    if (!carries.test(stmt)) return 'own-words';
  }
  return exits > 0 ? 'passes' : 'own-words';
}

function partC3(files: string[]) {
  console.log('\n\u2500\u2500 C3. mageAI callers say "AI features are off", never their own failure words \u2500\u2500');
  const bad: string[] = [];
  const used = new Set<string>();
  let calls = 0;
  for (const file of files) {
    if (file === 'utils/mageAI.ts' || file.startsWith('utils/aiConsent')) continue;
    const code = stripComments(read(file));
    const lines = code.split('\n');
    for (const m of code.matchAll(/\bmageAI\(/g)) {
      const idx = m.index ?? 0;
      const before = code.slice(Math.max(0, idx - 80), idx);
      if (/import\s*\{[^}]*$|function\s+$|typeof\s+$/.test(before)) continue;
      calls++;
      const line = code.slice(0, idx).split('\n').length - 1;
      const v = (lines[line].match(/(?:const|let)?\s*([A-Za-z_$][\w$]*)\s*=\s*await\s+mageAI\(/) ?? [])[1] ?? null;
      const verdict = mageAICallerVerdict(code, idx, v);
      if (verdict !== 'own-words') continue;
      const fn = enclosingFnName(lines, line);
      const key = MAGEAI_QUIET[`${file}::${fn}`] ? `${file}::${fn}` : MAGEAI_QUIET[`${file}::*`] ? `${file}::*` : '';
      if (key) {
        used.add(key);
        const missing = (MAGEAI_QUIET[key].screens ?? []).filter((sc) => !/\b(ensureAiConsent|requireAiConsent)\s*\(/.test(stripComments(read(sc))));
        if (missing.length === 0) continue;
        bad.push(`${file}:${line + 1} (${fn}) — listed as quiet, but ${missing.join(', ')} no longer asks first`);
        continue;
      }
      bad.push(`${file}:${line + 1} (${fn}) writes its own failure words — check isAiConsentRefusal(${v ?? 'res'}) / aiConsentReason first, or pass ${v ?? 'res'}.error`);
    }
  }
  ok(`every mageAI caller carries the refusal\u2019s sentence (${calls} calls)`, bad.length === 0, bad.join('\n      '));
  ok('the sweep found the callers this file was written against (no silent zero)', calls >= 60, `calls: ${calls}`);
  const stale = Object.keys(MAGEAI_QUIET).filter((k) => !used.has(k));
  ok('no stale MAGEAI_QUIET entry (each still matches a quiet caller)', stale.length === 0, stale.join(', '));

  // 'aware' means the check is present; it must also be USED (round-2 review:
  // delete toolbox's `if (consentRefused) throw …` and the caller still read
  // as aware while filing template notes as if the AI wrote them).
  const unused: string[] = [];
  for (const file of files) {
    if (file.startsWith('utils/aiConsent')) continue;
    const code = stripComments(read(file));
    for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*(?:isAiConsentRefusal|aiConsentReason)\(/g)) {
      const rest = code.slice((m.index ?? 0) + m[0].length);
      const reads = [...rest.matchAll(new RegExp(`\\b${m[1]}\\b(?!\\s*=[^=])`, 'g'))].length;
      if (reads === 0) unused.push(`${file}:${code.slice(0, m.index).split('\n').length} (${m[1]})`);
    }
  }
  ok('every consent check a caller stores is read afterwards (no dead check)', unused.length === 0, unused.join(', '));
  const PIN_THROW: Record<string, RegExp> = {
    'utils/copilot/jha/jhaCapability.ts': /if \(isAiConsentRefusal\(gen\)\) \{\s*consentRefused = true;[\s\S]*?if \(consentRefused\) throw new AiConsentDeclinedError\(\);/,
    'utils/copilot/toolbox/toolboxCapability.ts': /consentRefused = isAiConsentRefusal\(gen\);[\s\S]*?if \(consentRefused\) throw new AiConsentDeclinedError\(\);/,
    'utils/selectionsEngine.ts': /if \(isAiConsentRefusal\(aiRes\)\) throw new AiConsentDeclinedError\(\);/,
  };
  const unpinned = Object.entries(PIN_THROW).filter(([f, re]) => !re.test(stripComments(read(f)))).map(([f]) => f);
  ok('JHA, toolbox and selections throw AiConsentDeclinedError on a refusal (no template notes, no "No options found")', unpinned.length === 0, unpinned.join(', '));

  // The rule itself, on fixtures: a starter-sheet fallback with its own words is caught.
  const own = `const res = await mageAI({ prompt });\n  if (!res.success || !res.data) {\n    const reason = res.errorKind === 'monthly_cap' ? (res.error || 'cap') : 'Could not reach AI';\n    return { sheet, warning: reason };\n  }`;
  const aware = `const res = await mageAI({ prompt });\n  if (!res.success) {\n    return { warning: aiConsentReason(res) ?? 'Could not reach AI' };\n  }`;
  const pass = `const r = await mageAI({ prompt });\n  if (!r.success) {\n    showAlert('Couldn\u2019t', r.error || 'Try again.');\n    return;\n  }`;
  ok('fixture: own failure words → caught', mageAICallerVerdict(own, own.indexOf('mageAI('), 'res') === 'own-words');
  ok('fixture: consent-aware → passes', mageAICallerVerdict(aware, aware.indexOf('mageAI('), 'res') === 'aware');
  ok('fixture: every exit shows r.error → passes', mageAICallerVerdict(pass, pass.indexOf('mageAI('), 'r') === 'passes');
}

// ── C5. a refusal that is THROWN lands on copy that says so ────────────────
//
// Round-2 review: 13 aiService functions `throw new Error(aiResult.error)` —
// the sentence — and C3 counted that as carried. But the screens that catch
// it show describeError(e).body, and describeError reads neither the message
// nor the code: "That didn't go through. MAGE couldn't run the risk forecast.
// Try again in a moment" — untrue, and the wrong advice. The same is true of
// every requireAiConsent() and `throw new AiConsentDeclinedError`.
//
// THE RULE, provable by following the throw: from every place a refusal is
// thrown (requireAiConsent(), throw new AiConsentDeclinedError, a util's
// `throw aiFailureError(<mageAI result>, …)`), find where it lands:
//   • a catch / .catch(…) whose body checks aiConsentErrorText /
//     isAiConsentDeclinedError / ownSentence, or shows describeError copy
//     (all four return the sentence) → carried;
//   • a catch that rethrows, or no catch in a util/hook/context → the
//     enclosing function throws it too: follow every call of that function;
//   • the call's own handler asked first (`!(await ensureAiConsent())` above
//     it) → the refusal can't reach it;
//   • anything else is a catch that tells a person who turned AI off that
//     something broke — or an unhandled rejection in a screen. Listed in
//     C5_QUIET only with a reason AND a pin that proves the reason.

// Keyed `file::function` — `lets: 'out'`, the function the refusal is thrown
// out of (it stops being followed there), or `lets: 'swallow'`, the function
// whose own catch keeps it. Each excuses only its own kind. `pin` is matched
// against that file and must prove the reason still holds.
const COPILOT_APPLY_WHY = 'copilot capability apply(): the one caller, useCopilotConversation.confirm, puts e.message (the sentence) on APPLY_ERR, and CopilotShell shows state.errorMessage (both pinned below)';
const C5_QUIET: Record<string, { lets: 'out' | 'swallow'; why: string; pin: RegExp }> = {
  'utils/copilot/jha/jhaCapability.ts::apply': { lets: 'out', why: COPILOT_APPLY_WHY, pin: /apply: async \(/ },
  'utils/copilot/toolbox/toolboxCapability.ts::apply': { lets: 'out', why: COPILOT_APPLY_WHY, pin: /apply: async \(/ },
  'utils/copilot/schedule/scheduleCapability.ts::apply': { lets: 'out', why: COPILOT_APPLY_WHY, pin: /apply: async \(/ },
  'utils/copilot/dailyReport/dfrCapability.ts::apply': { lets: 'out', why: COPILOT_APPLY_WHY, pin: /apply: async \(/ },
  'utils/photoAnalyzer.ts::captionPhoto': {
    lets: 'swallow',
    why: 'an optional caption SUGGESTION after an upload that always succeeds; null = no suggestion, and nothing tells the person anything failed',
    pin: /export async function captionPhoto\([^)]*\): Promise<AiCaptionResult \| null> \{\s*try \{/,
  },
  'app/(tabs)/schedule/index.tsx::handleBuildFromEstimate': {
    lets: 'swallow',
    why: 'the button still builds the schedule from the estimate quantities, with no AI and no claim of AI, so nothing is blocked and nothing false is said',
    pin: /\} catch \(aiErr\) \{\s*console\.warn\('\[Schedule\] AI estimate generator failed, falling back to heuristic:', aiErr\);\s*\}\s*\}\s*const tasks: ScheduleTask\[\] = \[\];/,
  },
};
const C5_CONFIRM_PIN = /await cap\.apply\(stateRef\.current\.draft, ctx\);[\s\S]{0,900}message: \(e as Error\)\.message/;
const C5_SHELL_PIN = /\{state\.errorMessage \?\? 'Try again\.'\}/;

/** matchBrace in O(1) after one pass per file (C5 asks thousands of times). */
const braceCache = new Map<string, Int32Array>();
function closeOf(code: string, open: number): number {
  let map = braceCache.get(code);
  if (!map) {
    map = new Int32Array(code.length).fill(-1);
    const stack: number[] = [];
    for (let i = 0; i < code.length; i++) {
      if (code[i] === '{') stack.push(i);
      else if (code[i] === '}') { const o = stack.pop(); if (o !== undefined) map[o] = i; }
    }
    braceCache.set(code, map);
  }
  const c = map[open];
  return c < 0 ? code.length : c;
}

// describeError counts since the integration round: utils/errorCopy reads the
// refusal FIRST and returns { title: 'AI features are off', body: the sentence }
// (run for real in the root checks below), so a catch that shows its copy is honest.
const CONSENT_CATCH = /\b(aiConsentErrorText|isAiConsentDeclinedError|ownSentence|describeError)\s*\(|\bAI_CONSENT_DECLINED_CODE\b/;

/** Where a throw at idx lands: the innermost catch around it, a `.catch(…)` on
 *  its statement, or nothing (it leaves the function). */
export function landingOf(code: string, idx: number): { kind: 'catch'; body: string; param: string } | { kind: 'none' } {
  const stmt = statementAt(code, idx, code.length);
  const dot = stmt.indexOf('.catch(');
  if (dot >= 0) {
    const open = idx + dot + '.catch'.length;
    let depth = 0;
    let close = code.length;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
    }
    const body = code.slice(open + 1, close);
    return { kind: 'catch', body, param: (body.match(/^\s*\(?\s*([A-Za-z_$][\w$]*)/) ?? [])[1] ?? '' };
  }
  const tries: Array<{ open: number; close: number }> = [];
  for (const m of code.matchAll(/\btry\s*\{/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    if (open >= idx) break;
    const close = closeOf(code, open);
    if (close > idx) tries.push({ open, close });
  }
  for (const t of tries.sort((a, b) => b.open - a.open)) {
    const c = code.slice(t.close + 1).match(/^\s*catch\s*(?:\(\s*([A-Za-z_$][\w$]*)[^)]*\))?\s*\{/);
    if (!c) continue; // try … finally: keeps going out
    const open = t.close + 1 + c[0].length - 1;
    return { kind: 'catch', body: code.slice(open + 1, closeOf(code, open)), param: c[1] ?? '' };
  }
  return { kind: 'none' };
}

/** The innermost NAMED function whose body contains idx: `function n(`,
 *  `const n = async (…) =>` / `= useCallback(async`, `n: async (`, or a
 *  method `async n(`. Sync or async — the name is what callers call. */
export function enclosingNamedFn(code: string, idx: number): string {
  return enclosingNamed(code, idx).name;
}

const declCache = new Map<string, Array<{ name: string; open: number; close: number }>>();
function declsOf(code: string) {
  let list = declCache.get(code);
  if (list) return list;
  list = [];
  const DECL = /(?:\bfunction\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\()|(?:\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:useCallback\(\s*)?(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>))|(?:^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?::\s*async\s*\(|\([^)]*\)\s*(?::[^{]+)?\{))/gm;
  for (const m of code.matchAll(DECL)) {
    const at = m.index ?? 0;
    const name = m[1] ?? m[2] ?? m[3];
    if (!name || /^(if|for|while|switch|catch|return)$/.test(name)) continue;
    // the body: first `{` after the match at paren/angle depth 0
    let paren = 0, angle = 0, open = -1;
    const stop = Math.min(code.length, at + m[0].length + 4000);
    for (let p = at + m[0].length - 1; p < stop; p++) {
      const c = code[p];
      if (c === '(') paren++;
      else if (c === ')') paren--;
      else if (c === '<') angle++;
      else if (c === '>' && code[p - 1] !== '=') angle = Math.max(0, angle - 1);
      else if (c === '{' && paren <= 0 && angle === 0) { open = p; break; }
      else if (c === ';' && paren <= 0 && angle === 0) break;
    }
    if (open >= 0) list.push({ name, open, close: closeOf(code, open) });
  }
  declCache.set(code, list);
  return list;
}

/** The innermost named function around idx: its name and body start. */
function enclosingNamed(code: string, idx: number): { name: string; open: number } {
  let best = { name: '?', open: -1 };
  for (const d of declsOf(code)) {
    if (d.open >= idx) break;
    if (d.open > best.open && d.close > idx) best = { name: d.name, open: d.open };
  }
  return best;
}

/** 'carried' | 'rethrows' | 'swallowed' for one landing. */
export function landingVerdict(l: ReturnType<typeof landingOf>): 'carried' | 'rethrows' | 'swallowed' | 'leaves' {
  if (l.kind === 'none') return 'leaves';
  if (CONSENT_CATCH.test(l.body)) return 'carried';
  if (l.param && new RegExp(`\\bthrow\\s+${l.param.replace(/\$/g, '\\$')}\\b`).test(l.body)) return 'rethrows';
  return 'swallowed';
}

function partC5(files: string[]) {
  console.log('\n── C5. a thrown refusal lands on copy that says "AI features are off" ──');
  const codeOf = new Map<string, string>();
  for (const f of files) if (!f.startsWith('utils/aiConsent')) codeOf.set(f, stripComments(read(f)));
  const bad: string[] = [];
  const usedQuiet = new Set<string>();
  const queued = new Set<string>();
  const queue: string[] = [];
  let sources = 0, landings = 0;
  const unused: string[] = [];
  const isUtil = (f: string) => /^(utils|hooks|contexts|lib)\//.test(f);

  const judge = (file: string, idx: number, what: string) => {
    const code = codeOf.get(file)!;
    const line = code.slice(0, idx).split('\n').length - 1;
    const encl = enclosingNamed(code, idx);
    // Asked first, or (a background run) only goes when the stored answer is yes.
    if (encl.open >= 0 && /!\(await ensureAiConsent\(\)\)|\(await loadAiConsent\(\)\) !== 'granted'/.test(code.slice(encl.open, idx))) return;
    landings++;
    const landing = landingOf(code, idx);
    let v = landingVerdict(landing);
    // One hop: a catch that hands the error to a helper in the same file
    // (`catch (e) { failRun(e, kept); }`) is carried when that helper is.
    if (v === 'swallowed' && landing.kind === 'catch' && landing.param) {
      for (const h of landing.body.matchAll(new RegExp(`\\b([A-Za-z_$][\\w$]*)\\(\\s*${landing.param}\\b`, 'g'))) {
        const def = code.match(new RegExp(`(?:const|let)\\s+${h[1]}\\s*=\\s*(?:useCallback\\(\\s*)?\\([^)]*\\)\\s*(?::[^=]+)?=>\\s*\\{|function\\s+${h[1]}\\s*\\([^)]*\\)[^{]*\\{`));
        if (def && def.index !== undefined) {
          const open = def.index + def[0].length - 1;
          if (CONSENT_CATCH.test(code.slice(open, closeOf(code, open)))) { v = 'carried'; break; }
        }
      }
    }
    if (v === 'carried') return;
    const here = `${file}::${encl.name}`;
    // 'out': the refusal may leave this function (its caller is pinned);
    // 'swallow': this function's own catch may keep it. Never both.
    if (C5_QUIET[here] && (C5_QUIET[here].lets === 'swallow') === (v === 'swallowed')) {
      usedQuiet.add(here);
      if (!C5_QUIET[here].pin.test(code)) bad.push(`${here}: listed as quiet, but the code no longer proves it (${C5_QUIET[here].why})`);
      return;
    }
    if (v === 'swallowed') { bad.push(`${file}:${line + 1} ${what} — its catch never says "AI features are off" (use aiConsentErrorText(e) ?? …)`); return; }
    // rethrows / leaves: the enclosing function throws it too. A util's
    // function is followed into every file; a screen's own function
    // (useCallback, a handler) only inside that screen.
    const fn = encl.name;
    if (fn === '?') { bad.push(`${file}:${line + 1} ${what} — thrown out of a function this rule can't name`); return; }
    const key = isUtil(file) ? fn : `${file}::${fn}`;
    if (process.env.C5_DEBUG) console.log(`      [c5] ${file}:${line + 1} ${what} → ${v} → follows ${key}()`);
    if (!queued.has(key)) { queued.add(key); queue.push(key); }
  };

  for (const [file, code] of codeOf) {
    const mageVars = new Set([...code.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+mageAI\(/g)].map((m) => m[1]));
    const SRC = /\brequireAiConsent\(\)|\bthrow new AiConsentDeclinedError\b|\bthrow aiFailureError\(|\bthrow new Error\(\s*([A-Za-z_$][\w$]*)\??\.error\b/g;
    for (const m of code.matchAll(SRC)) {
      if (m[1] && !mageVars.has(m[1])) continue;
      if (/^\s*import\b/.test(code.slice(code.lastIndexOf('\n', m.index ?? 0) + 1, (m.index ?? 0) + 1))) continue;
      sources++;
      judge(file, m.index ?? 0, m[0].replace(/\($/, '()').slice(0, 48));
    }
  }
  while (queue.length) {
    const key = queue.shift()!;
    const only = key.includes('::') ? key.slice(0, key.indexOf('::')) : null;
    const fn = only ? key.slice(key.indexOf('::') + 2) : key;
    const call = new RegExp(`(?<![.\\w$])${fn.replace(/\$/g, '\\$')}\\s*(?:<[^>()]*>)?\\s*\\(`, 'g');
    let found = 0;
    for (const [file, code] of codeOf) {
      if ((only && file !== only) || !code.includes(fn)) continue;
      for (const m of code.matchAll(call)) {
        const lineStart = code.lastIndexOf('\n', m.index ?? 0) + 1;
        const head = code.slice(lineStart, m.index ?? 0);
        if (/\bfunction\s*\*?\s*$|^\s*import\b|typeof\s+$/.test(head)) continue;
        found++;
        judge(file, m.index ?? 0, `${fn}()`);
      }
    }
    if (found === 0) {
      // Nothing calls it at all (its name appears only where it is declared):
      // the refusal can't reach a person. Referenced but never found as a
      // call (passed as a value, called through a member) is not provable.
      const word = new RegExp(`(?<![.\\w$])${fn.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
      let refs = 0;
      for (const [file, code] of codeOf) if ((!only || file === only) && code.includes(fn)) refs += [...code.matchAll(word)].filter((m) => !/\bfunction\s*$|\b(?:const|let)\s+$/.test(code.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0))).length;
      if (refs > 0) bad.push(`${key}(): throws the refusal; it is referenced ${refs}× but never as a call this rule can follow (an unhandled rejection unless something catches it)`);
      else unused.push(key);
    }
  }
  ok(`every thrown refusal lands on copy that names it (${sources} throws, ${landings} landings${unused.length ? `; never called: ${unused.join(', ')}` : ''})`, bad.length === 0, bad.join('\n      '));
  ok('the sweep found the throwers this file was written against (no silent zero)', sources >= 30 && landings >= 40, `throws ${sources}, landings ${landings}`);
  ok('the copilot confirm puts the apply error’s message on screen (C5_QUIET …::apply)',
    C5_CONFIRM_PIN.test(codeOf.get('hooks/useCopilotConversation.ts') ?? '') && C5_SHELL_PIN.test(codeOf.get('components/copilot/CopilotShell.tsx') ?? ''));
  const staleQ = Object.keys(C5_QUIET).filter((k) => !usedQuiet.has(k));
  ok('no stale C5_QUIET entry', staleQ.length === 0, staleQ.join(', '));

  // The rule on fixtures: the AIScheduleRisk shape is caught; the fixed one passes.
  const generic = `async function run() {\n  try {\n    const data = await analyzeScheduleRisk(s);\n    setResult(data);\n  } catch (err) {\n    setError('AI search unavailable right now. Try again in a moment.');\n  }\n}`;
  const fixed = generic.replace("setError('AI search", "setError(aiConsentErrorText(err) ?? 'AI search");
  const viaCopy = generic.replace("setError('AI search unavailable right now. Try again in a moment.')", "setError(describeError(err, { action: 'run the risk forecast' }).body)");
  const rethrow = `async function a() {\n  try { await analyzeScheduleRisk(s); } catch (e) { log(e); throw e; }\n}`;
  const at = (src: string) => src.indexOf('analyzeScheduleRisk(');
  ok('fixture: a catch with its own failure words → swallowed', landingVerdict(landingOf(generic, at(generic))) === 'swallowed');
  ok('fixture: a catch that shows describeError copy → carried', landingVerdict(landingOf(viaCopy, at(viaCopy))) === 'carried');
  ok('fixture: aiConsentErrorText first → carried', landingVerdict(landingOf(fixed, at(fixed))) === 'carried');
  ok('fixture: a catch that rethrows → followed up', landingVerdict(landingOf(rethrow, at(rethrow))) === 'rethrows');
  ok('fixture: helper reads the typed error and a util’s new Error(res.error)',
    aiConsentErrorText(new AiConsentDeclinedError()) === AI_CONSENT_OFF_MESSAGE
    && aiConsentErrorText(new Error(AI_CONSENT_OFF_MESSAGE)) === AI_CONSENT_OFF_MESSAGE
    && aiConsentErrorText(new Error('Schedule risk analysis unavailable')) === null);
  // ── THE ROOT (integration round). A util never throws a mageAI result's
  // error as a plain Error: aiFailureError() rethrows the refusal TYPED, and
  // describeError() — the copy path nearly every AI catch already shows —
  // reads it first. Run for real, then pinned across every client file.
  const refusal = { success: false, data: null, error: AI_CONSENT_OFF_MESSAGE, errorKind: 'unknown', errorCode: AI_CONSENT_DECLINED_CODE };
  const typed = aiFailureError(refusal, 'Weekly summary unavailable');
  ok('aiFailureError: a refusal becomes the typed AiConsentDeclinedError (code + sentence)',
    typed instanceof AiConsentDeclinedError && isAiConsentDeclinedError(typed) && typed.message === AI_CONSENT_OFF_MESSAGE);
  const plain = aiFailureError({ error: 'Gemini 503' }, 'Weekly summary unavailable');
  ok('aiFailureError: any other failure stays a plain Error with its own text, or the fallback',
    !(plain instanceof AiConsentDeclinedError) && plain.message === 'Gemini 503'
    && aiFailureError({}, 'Weekly summary unavailable').message === 'Weekly summary unavailable'
    && aiFailureError(null, 'fb').message === 'fb' && !isAiConsentDeclinedError(aiFailureError({ error: AI_CONSENT_OFF_MESSAGE + ' x' }, 'fb')));
  const shown = describeError(typed, { action: 'run the risk forecast', keptLocally: true, title: "Couldn't write the client update" });
  ok('describeError(refusal): title "AI features are off", body the exact sentence — no "try again", no reference code',
    shown.title === 'AI features are off' && shown.body === AI_CONSENT_OFF_MESSAGE && shown.code === null
    && describeError(new Error(AI_CONSENT_OFF_MESSAGE), { action: 'x' }).body === AI_CONSENT_OFF_MESSAGE);
  const other = describeError(plain, { action: 'run the risk forecast' });
  ok('describeError(any other failure): unchanged copy, and never the raw text',
    other.title === "That didn't go through." && other.body.startsWith("MAGE couldn't run the risk forecast.") && !other.body.includes('Gemini 503'));
  const untyped: string[] = [];
  let typedThrows = 0;
  for (const [file, code] of codeOf) {
    const mageVars = new Set([...code.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+mageAI\(/g)].map((m) => m[1]));
    for (const m of code.matchAll(/\bthrow new [A-Za-z]*Error\(\s*`?[^;\n]*?\b([A-Za-z_$][\w$]*)\??\.error\b/g)) {
      if (mageVars.has(m[1])) untyped.push(`${file}:${code.slice(0, m.index).split('\n').length}`);
    }
    typedThrows += [...code.matchAll(/\bthrow aiFailureError\(/g)].length;
  }
  ok('no util throws a mageAI result\u2019s error as a plain Error (use `throw aiFailureError(res, fallback)`)', untyped.length === 0, untyped.join(', '));
  ok('the typed rethrow is in use (aiService \u00d713 and the six other utils; no silent zero)', typedThrows >= 20, `throw aiFailureError: ${typedThrows}`);
  const svc = codeOf.get('utils/aiService.ts') ?? '';
  ok('utils/aiService.ts: every failed mageAI result is rethrown through aiFailureError',
    [...svc.matchAll(/\bthrow aiFailureError\(aiResult, '[^']+'\);/g)].length >= 13 && !/throw new Error\(aiResult/.test(svc));
}

// ── C4. a plan upload waits for the yes ───────────────────────────────────
//
// convert-pdf-to-images uploads the plan and charges the month's takeoff pages
// before the AI read. A screen that asks only inside the AI util would spend a
// person's pages on a run that can never go through. So in every handler that
// calls uploadAndRenderPdf, the gate comes FIRST.

const UPLOAD_EXEMPT: Record<string, string> = {
  'app/plans.tsx': 'a plain plan import (no AI); the optional title-block read after it goes through plan-extract, which is gated',
  'hooks/useTakeoffPdfDrop.ts': 'web drag-and-drop only (returns INERT off the web), where the gate always answers yes',
};

function partC4(files: string[]) {
  console.log('\n\u2500\u2500 C4. the gate runs before every plan upload that feeds an AI read \u2500\u2500');
  const late: string[] = [];
  let uploads = 0;
  for (const file of files) {
    if (file === 'utils/pdfRenderClient.ts') continue;
    const code = stripComments(read(file));
    if (!/\buploadAndRenderPdf\(/.test(code)) continue;
    if (UPLOAD_EXEMPT[file]) {
      if (file === 'hooks/useTakeoffPdfDrop.ts' && !/if \(Platform\.OS !== 'web'\) return INERT;/.test(code)) late.push(`${file}: no longer web-only`);
      continue;
    }
    const lines = code.split('\n');
    lines.forEach((l, i) => {
      if (!/\buploadAndRenderPdf\(/.test(l) || /^\s*import\b/.test(l)) return;
      uploads++;
      const start = enclosingAsyncStart(lines, i);
      const body = start < 0 ? '' : lines.slice(start, i + 1).join('\n');
      if (!/!\(await ensureAiConsent\(\)\)/.test(body)) late.push(`${file}:${i + 1}`);
    });
  }
  ok(`every AI plan upload asks first, before the picker and the render (${uploads} uploads)`, late.length === 0, late.join('\n      '));
  ok('the four AI upload screens were found (takeoff ×2, drawing analyzer, compare, spec book)', uploads >= 5, `uploads: ${uploads}`);
}

await partA();
await partA2();
partB();
partC();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
