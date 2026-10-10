// scripts/marketing-screens/server.ts: serves the exported web app and stands
// in for the backend. The app's real Supabase client is built against this
// address (EXPO_PUBLIC_SUPABASE_URL, see build.sh), so nothing here reaches a
// real account and nobody signs in. The stand-in answers the way an account
// that has synced before answers: the rows it returns are the same rows the
// fixture put on the device.
import { existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

export interface ServerWorld {
  /** The signed-in user object (/auth/v1/user). */
  user: Record<string, unknown>;
  /** Table name -> rows, already in the server's snake_case column names. */
  tables: Record<string, unknown[]>;
  /** The subscriptions row. */
  subscription: Record<string, unknown> | null;
  /** Edge function name -> JSON answer, or a function of the request body. */
  functions: Record<string, unknown | ((body: any) => unknown)>;
  /** Files under /__fixture/ (name -> SVG text): the flat tinted tiles that stand where site photos would be. */
  assets: Record<string, string>;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// The harness runs under bun; the app's tsconfig has no bun types, so the two
// calls it makes are declared here (the repo's other scripts do the same).
declare const Bun: {
  serve: (o: { port: number; hostname: string; fetch: (req: Request) => Response | Promise<Response> }) => { stop: (closeActive?: boolean) => unknown };
  file: (path: string) => BodyInit;
};

export function startServer(dist: string, port: number, world: () => ServerWorld, log: (line: string) => void) {
  const index = join(dist, 'index.html');
  if (!existsSync(index)) throw new Error(`no web export at ${dist}; run scripts/marketing-screens/build.sh first`);
  return Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(req: Request) {
      const url = new URL(req.url);
      const p = url.pathname;
      const w = world();
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });

      if (p.startsWith('/auth/v1/')) {
        if (p === '/auth/v1/user') return json(w.user);
        if (p === '/auth/v1/logout') return new Response(null, { status: 204 });
        // A refresh or anything else: say the service is busy, which the client
        // treats as "try later" and keeps the stored session.
        return json({ message: 'stand-in backend' }, 503);
      }

      if (p.startsWith('/rest/v1/rpc/')) { log(`rpc ${p.slice(13)}`); return json([]); }

      if (p.startsWith('/rest/v1/')) {
        const table = p.slice(9);
        const wantsObject = (req.headers.get('accept') ?? '').includes('vnd.pgrst.object');
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          // Writes are accepted and dropped: the phone keeps its own copy.
          return wantsObject ? json({}) : json([], 201);
        }
        let rows: unknown[] = [];
        if (table === 'subscriptions') rows = w.subscription ? [w.subscription] : [];
        else if (w.tables[table]) {
          rows = w.tables[table]!;
          // The simple equality filters the app uses (project_id=eq.x, id=eq.x).
          for (const [k, v] of url.searchParams) {
            if (!v.startsWith('eq.')) continue;
            const want = v.slice(3);
            if (rows.some((r) => k in (r as object))) rows = rows.filter((r) => String((r as Record<string, unknown>)[k]) === want);
          }
        }
        const range = { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' };
        if (req.method === 'HEAD') return new Response(null, { status: 200, headers: range });
        if (wantsObject) return rows.length ? json(rows[0]) : json({ code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' }, 406);
        return json(rows, 200, range);
      }

      if (p.startsWith('/functions/v1/')) {
        const name = p.slice(14).split('/')[0]!;
        if (name in w.functions) {
          const f = w.functions[name];
          if (typeof f !== 'function') return json(f);
          let body: unknown = null;
          try { body = await req.json(); } catch { /* no body */ }
          return json((f as (b: unknown) => unknown)(body));
        }
        log(`function ${name} (no fixture)`);
        return json({ error: 'stand-in backend: no fixture for this function' }, 404);
      }

      if (p.startsWith('/storage/v1/') || p.startsWith('/realtime/v1/')) return json({ message: 'stand-in backend' }, 404);

      if (p.startsWith('/__fixture/')) {
        const svg = w.assets[p.slice(11)];
        return svg ? new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }) : new Response('not found', { status: 404 });
      }

      // The exported app. One page; every route falls back to index.html.
      const file = normalize(join(dist, decodeURIComponent(p)));
      if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) return new Response(Bun.file(file));
      return new Response(Bun.file(index), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  });
}
