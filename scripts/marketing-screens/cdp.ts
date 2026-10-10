// scripts/marketing-screens/cdp.ts: a small Chrome DevTools Protocol client
// (headless Chrome over its debugging WebSocket). No puppeteer in this repo.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };
export type Listener = (params: any, sessionId?: string) => void;

export class Browser {
  private ws!: WebSocket;
  private next = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, Set<Listener>>();
  private proc!: ChildProcess;
  private profile = '';

  static async launch(port: number): Promise<Browser> {
    const b = new Browser();
    b.profile = mkdtempSync(join(tmpdir(), 'mage-shots-'));
    b.proc = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${b.profile}`,
      '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-extensions',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-networking',
      '--disable-sync', '--disable-component-update', '--force-color-profile=srgb', 'about:blank',
    ], { stdio: 'ignore' });
    let url = '';
    for (let i = 0; i < 100 && !url; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try { url = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as any).webSocketDebuggerUrl; } catch { /* not up yet */ }
    }
    if (!url) throw new Error('Chrome did not open its debugging port');
    b.ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => { b.ws.onopen = () => resolve(); b.ws.onerror = () => reject(new Error('CDP socket failed')); });
    b.ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id) {
        const p = b.pending.get(msg.id); b.pending.delete(msg.id);
        if (p) msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      } else if (msg.method) {
        for (const l of b.listeners.get(msg.method) ?? []) l(msg.params, msg.sessionId);
      }
    };
    return b;
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(method: string, l: Listener): () => void {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method)!.add(l);
    return () => this.listeners.get(method)!.delete(l);
  }

  async newPage(): Promise<Page> {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return new Page(this, targetId, sessionId);
  }

  async close(): Promise<void> {
    try { await this.send('Browser.close'); } catch { /* already gone */ }
    try { this.proc.kill('SIGKILL'); } catch { /* already gone */ }
    try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* temp cleaner got there first */ }
  }
}

export class Page {
  constructor(private b: Browser, readonly targetId: string, readonly sessionId: string) {}
  send(method: string, params: Record<string, unknown> = {}): Promise<any> { return this.b.send(method, params, this.sessionId); }
  on(method: string, l: (params: any) => void): () => void {
    return this.b.on(method, (p, sid) => { if (sid === this.sessionId) l(p); });
  }
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }
  async close(): Promise<void> { await this.b.send('Target.closeTarget', { targetId: this.targetId }); }
}
