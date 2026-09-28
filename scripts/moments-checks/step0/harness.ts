// harness.ts: run ONE useCallback (or one top-level function) of a React
// source file against a scope, under bun. The same technique as
// scripts/validate-context-money-portal-writes.ts (extractCallback /
// runCallback), copied here so the moments checks do not import a validator.
//
// The callback's own text (arrow + deps) is transpiled and evaluated inside
// `with (scope)`: names the scope provides are used; any other non-global name
// resolves to a recording stub, so an unexpected dependency cannot crash the
// run — the assertions decide what matters.

declare const Bun: { Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string } };

export type Scope = Record<string, unknown>;

export function extractCallback(src: string, name: string): string {
  const decl = `const ${name} = useCallback(`;
  const i = src.indexOf(decl);
  if (i < 0) throw new Error(`not found: ${decl}`);
  const open = i + decl.length;
  const rest = src.slice(open);
  const ends = [
    /\n {2}\}, \[[^\n]*\]\);/.exec(rest),
    /\n {2}\}, \[\n[\s\S]*?\n {2}\]\);/.exec(rest),
    /\n {2}\);/.exec(rest),
  ].filter((m): m is RegExpExecArray => !!m).sort((x, y) => x.index - y.index);
  if (!ends.length) throw new Error(`no end for ${name}`);
  const m = ends[0];
  return m[0].startsWith('\n  }') ? rest.slice(0, m.index + m[0].length - 2) : rest.slice(0, m.index);
}

function evalIn<T>(js: string, scope: Scope, stubCalls: string[]): T {
  const full: Scope = { __cb: (fn: unknown) => fn, ...scope };
  const proxy = new Proxy(full, {
    has: (_t, k) => typeof k === 'string' && (k in full || !(k in globalThis)),
    get: (_t, k) => {
      if (typeof k !== 'string') return undefined;
      if (k in full) return full[k];
      return (..._args: unknown[]) => { stubCalls.push(k); return undefined; };
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('__scope', `with (__scope) { ${js}\n return __r; }`)(proxy) as T;
}

export function runCallback<T>(src: string, name: string, scope: Scope, stubCalls: string[] = []): T {
  const text = extractCallback(src, name);
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`var __r = __cb(${text});`);
  return evalIn<T>(js, scope, stubCalls);
}

/** A top-level `export function NAME(…) { … }` (ends at the first "\n}" in column 0). */
export function extractFunction(src: string, name: string): string {
  const re = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*[(<]`);
  const m = re.exec(src);
  if (!m) throw new Error(`function not found: ${name}`);
  const end = src.indexOf('\n}', m.index);
  if (end < 0) throw new Error(`no end for function ${name}`);
  return src.slice(m.index, end + 2).replace(/^export\s+/, '');
}

export function runFunction<T>(src: string, name: string, scope: Scope, stubCalls: string[] = []): T {
  const text = extractFunction(src, name);
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${text}\nvar __r = ${name};`);
  return evalIn<T>(js, scope, stubCalls);
}
