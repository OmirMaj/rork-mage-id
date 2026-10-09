// scripts/marketing-screens/shoot.ts: re-shoot the marketing screens.
//
//   bun run scripts/marketing-screens/shoot.ts            every screen
//   bun run scripts/marketing-screens/shoot.ts home co    only these ids
//   OUT=/some/dir bun run scripts/marketing-screens/shoot.ts
//
// What is real: the exported web build of the app (expo export, the same
// bundle app.mageid.app serves), its real root layout and provider stack, the
// real screen code, the real fonts. What is stood in: the backend (server.ts),
// the data on the device (world.ts), the clock, and the phone's status bar and
// safe areas (statusbar.ts). See README.md.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser, type Page } from './cdp';
import { startServer } from './server';
import { buildWorld, NOW_ISO, TIMEZONE, type World } from './world';
import { SCREENS, type Screen, type Step, type Shot } from './screens';
import { statusBarScript } from './statusbar';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = 8797; // baked into the export by build.sh
const CDP_PORT = Number(process.env.CDP_PORT ?? 9347);
const VIEW = { width: 393, height: 852, scale: 3 };
const INSETS = { top: 59, bottom: Number(process.env.INSET_BOTTOM ?? 34), left: 0, right: 0 }; // iPhone 15 / 16
const OUT = process.env.OUT ?? join(ROOT, '.marketing-screens-out');
const DIST = (set: 'shipped' | 'in-testing') => process.env[set === 'shipped' ? 'DIST' : 'DIST_TESTING']
  ?? join(ROOT, set === 'shipped' ? '.marketing-screens-dist' : '.marketing-screens-dist-testing');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let current: World = buildWorld();
const serverLog: string[] = [];

/** Runs before any app code on every load: the clock, then the device data. */
function bootScript(world: World, theme: 'light' | 'dark'): string {
  return `(() => {
    if (location.hostname !== '127.0.0.1') return;
    const RealDate = Date; const offset = new RealDate(${JSON.stringify(NOW_ISO)}).getTime() - RealDate.now();
    class FixedDate extends RealDate { constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); } static now() { return RealDate.now() + offset; } }
    globalThis.Date = FixedDate;
    if (!sessionStorage.getItem('__seeded')) {
      localStorage.clear();
      const data = ${JSON.stringify(world.storage)};
      for (const k of Object.keys(data)) localStorage.setItem(k, data[k]);
      localStorage.setItem('mageid_theme', ${JSON.stringify(theme)});
      sessionStorage.setItem('__seeded', '1');
    }
    globalThis.__shotErrors = [];
    addEventListener('error', (e) => globalThis.__shotErrors.push(String(e.message)));
    addEventListener('unhandledrejection', (e) => globalThis.__shotErrors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
  })();`;
}

/** Helpers the steps use, living in the page. */
const PAGE_HELPERS = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const byText = (text, exact) => {
    const all = [...document.querySelectorAll('div[dir="auto"], span, button, [role="button"], a, [tabindex="0"]')].filter(visible);
    const m = all.filter((e) => { const t = (e.innerText || e.textContent || '').trim(); return exact ? t === text : t.includes(text); });
    // The innermost match: the label itself, not a card that happens to contain it.
    return m.filter((e) => !m.some((o) => o !== e && e.contains(o))).pop() || null;
  };
  const find = (sel) => sel.testID ? [...document.querySelectorAll('[data-testid="' + sel.testID + '"]')].filter(visible)[sel.nth || 0] || null
    : sel.label ? [...document.querySelectorAll('[aria-label="' + sel.label + '"]')].filter(visible)[sel.nth || 0] || null
    : sel.css ? [...document.querySelectorAll(sel.css)].filter(visible)[sel.nth || 0] || null
    : byText(sel.text, sel.exact !== false);
  const press = (el) => {
    const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); el.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0 }));
  };
  const type = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  globalThis.__shot = { find, press, type, byText };
})();`;

async function runStep(page: Page, step: Step): Promise<void> {
  if ('wait' in step) { await wait(step.wait); return; }
  if ('js' in step) { await page.eval(`(async () => { ${step.js} })()`); await wait(250); return; }
  if ('click' in step) {
    const ok = await page.eval<boolean>(`(async () => { for (let i = 0; i < 40; i++) { const el = __shot.find(${JSON.stringify(step.click)}); if (el) { el.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 60)); __shot.press(el); return true; } await new Promise(r => setTimeout(r, 150)); } return false; })()`);
    if (!ok) throw new Error(`nothing to press for ${JSON.stringify(step.click)}`);
    await wait(step.then ?? 500); return;
  }
  if ('type' in step) {
    const ok = await page.eval<boolean>(`(async () => { for (let i = 0; i < 40; i++) { const el = __shot.find(${JSON.stringify(step.type)}); if (el) { el.focus(); __shot.type(el, ${JSON.stringify(step.value)}); el.blur(); return true; } await new Promise(r => setTimeout(r, 150)); } return false; })()`);
    if (!ok) throw new Error(`nothing to type into for ${JSON.stringify(step.type)}`);
    await wait(300); return;
  }
  if ('scroll' in step) {
    await page.eval(`(() => { const t = ${'to' in step && step.to ? `__shot.find(${JSON.stringify(step.to)})` : 'null'}; if (t) { t.scrollIntoView({ block: ${JSON.stringify(step.block ?? 'start')} }); return; }
      const s = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 40 && getComputedStyle(d).overflowY !== 'visible' && getComputedStyle(d).overflowY !== 'hidden').sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0];
      if (s) s.scrollTop = ${step.scroll}; })()`);
    await wait(350); return;
  }
}

async function shoot(browser: Browser, screen: Screen, shot: Shot, file: string): Promise<{ errors: string[]; texts: string }> {
  const theme = shot.theme ?? 'light';
  current = buildWorld(shot.world ?? screen.world);
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  try {
    await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
    page.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') consoleErrors.push(p.args.map((a: any) => a.value ?? a.description ?? '').join(' ').slice(0, 300)); });
    await page.send('Emulation.setDeviceMetricsOverride', { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.scale, mobile: true, screenWidth: VIEW.width, screenHeight: VIEW.height });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.send('Emulation.setTimezoneOverride', { timezoneId: TIMEZONE });
    await page.send('Emulation.setLocaleOverride', { locale: 'en-US' }).catch(() => {});
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.send('Emulation.setSafeAreaInsetsOverride', { insets: INSETS }).catch((e) => consoleErrors.push('safe-area override unavailable: ' + e.message));
    // Nothing leaves this machine: only the stand-in backend is reachable.
    // OpenWeather is answered from the fixture.
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    page.on('Fetch.requestPaused', (p) => {
      const url: string = p.request.url;
      if (url.startsWith(`http://127.0.0.1:${PORT}/`) || url.startsWith('data:') || url.startsWith('blob:')) { void page.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}); return; }
      const canned = current.outside.find((o) => url.includes(o.match));
      if (canned) { void page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: canned.type ?? 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(typeof canned.body === 'string' ? canned.body : JSON.stringify(canned.body)).toString('base64') }).catch(() => {}); return; }
      void page.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: bootScript(current, theme) });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS });
    await page.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${screen.route}` });
    // The app is up when its launch curtain is gone and the fonts are in.
    await page.eval(`new Promise((resolve) => { const t0 = performance.now(); const tick = () => { const root = document.getElementById('root'); if ((root && root.innerText.trim().length > 20 && document.fonts.status === 'loaded') || performance.now() - t0 > 20000) resolve(true); else setTimeout(tick, 150); }; tick(); })`);
    await wait(screen.settle ?? 2500);
    for (const step of [...(screen.steps ?? []), ...(shot.steps ?? [])]) await runStep(page, step);
    await page.eval('document.fonts.ready.then(() => true)');
    await wait(shot.settle ?? 700);
    if (!shot.noStatusBar) await page.eval(statusBarScript(theme, INSETS, shot.statusBar));
    await wait(120);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(file, Buffer.from(data, 'base64'));
    if (process.env.EVAL) console.log(JSON.stringify(await page.eval(process.env.EVAL), null, 1));
    const texts = await page.eval<string>('document.body.innerText');
    const pageErrors = await page.eval<string[]>('globalThis.__shotErrors || []');
    return { errors: [...consoleErrors, ...pageErrors], texts };
  } finally { await page.close().catch(() => {}); }
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const debug = process.argv.includes('--text');
  const screens = SCREENS.filter((s) => only.length === 0 || only.includes(s.id));
  if (!screens.length) { console.error('no screen with that id; ids: ' + SCREENS.map((s) => s.id).join(' ')); process.exit(1); }
  const browser = await Browser.launch(CDP_PORT);
  let failed = 0;
  try {
    for (const set of ['shipped', 'in-testing'] as const) {
      const group = screens.filter((s) => s.set === set);
      if (!group.length) continue;
      const dist = DIST(set);
      if (!existsSync(join(dist, 'index.html'))) { console.error(`! no ${set} build at ${dist}: run scripts/marketing-screens/build.sh${set === 'in-testing' ? ' in-testing' : ''}`); failed += group.length; continue; }
      const server = startServer(dist, PORT, () => current.server, (l) => serverLog.push(l));
      mkdirSync(join(OUT, set), { recursive: true });
      for (const screen of group) {
        const shots: { shot: Shot; name: string }[] = [{ shot: screen.shot ?? {}, name: `${screen.id}.png` }];
        (screen.sequence ?? []).forEach((shot, i) => shots.push({ shot, name: `${screen.id}-seq-${i + 1}.png` }));
        if (screen.dark) shots.push({ shot: { ...(screen.shot ?? {}), theme: 'dark' }, name: `${screen.id}-dark.png` });
        for (const { shot, name } of shots) {
          try {
            const r = await shoot(browser, screen, shot, join(OUT, set, name));
            const bad = /undefined|NaN|Something went wrong|This screen hit an error|Unmatched Route/.exec(r.texts);
            console.log(`${bad ? '!' : '✓'} ${set}/${name}${bad ? `  (page text contains "${bad[0]}")` : ''}`);
            if (bad) failed++;
            if (debug) console.log(r.texts.replace(/\n+/g, ' | ').slice(0, 1500));
            if (process.env.SHOT_ERRORS) for (const e of r.errors.slice(0, 8)) console.log('    console: ' + e);
          } catch (e) { failed++; console.log(`✗ ${set}/${name}: ${(e as Error).message}`); }
        }
      }
      await server.stop(true);
    }
  } finally { await browser.close(); }
  if (process.env.SHOT_ERRORS) console.log([...new Set(serverLog)].join('\n'));
  if (failed) { console.error(`${failed} shot(s) need a look`); process.exit(1); }
}
void main();
