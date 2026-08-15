/**
 * __tests__/helpers/routes.ts — walk `app/` and derive the route list.
 *
 * Spec: "A hand-maintained list is the obvious alternative and it is wrong: it
 * drifts the moment someone adds a screen, and catching new screens is the
 * point. A screen added next month must be covered without anyone remembering
 * to add it."
 *
 * So: no list. This applies the same conventions Expo Router does when it
 * builds its route tree from the filesystem.
 */

import fs from 'node:fs';
import path from 'node:path';

export const APP_DIR = path.resolve(__dirname, '../../app');

/** Extensions Expo Router treats as route modules. */
const ROUTE_EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js']);

export type DiscoveredRoute = {
  /** Path relative to app/, e.g. "(tabs)/settings/appearance.tsx". */
  file: string;
  /** The URL a user would navigate to, e.g. "/settings/appearance". */
  href: string;
  /** True if the file path contained a [param] segment we had to fill in. */
  dynamic: boolean;
};

/**
 * Values for dynamic segments. Only one exists today
 * (`(tabs)/materials/[category].tsx`), but this is a table rather than a
 * special case so that adding `app/foo/[id].tsx` tomorrow needs one line here
 * instead of a redesign — and, more importantly, so an UNMAPPED dynamic
 * segment is a loud failure (see `fillDynamic`) rather than a silently skipped
 * route.
 */
const DYNAMIC_SEGMENT_VALUES: Record<string, string> = {
  // A real key of CATEGORY_META in constants/materials.ts. An unknown value
  // would exercise the fallback branch instead of the real one.
  category: 'lumber',
};

function fillDynamic(segment: string): string {
  // [...rest] catch-all
  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll) {
    const value = DYNAMIC_SEGMENT_VALUES[catchAll[1]];
    if (!value) {
      throw new Error(
        `Route discovery: no test value for catch-all segment "[...${catchAll[1]}]". `
          + `Add one to DYNAMIC_SEGMENT_VALUES in __tests__/helpers/routes.ts — `
          + `leaving it unmapped would silently drop the route from the suite.`
      );
    }
    return value;
  }
  const dynamic = segment.match(/^\[(.+)\]$/);
  if (dynamic) {
    const value = DYNAMIC_SEGMENT_VALUES[dynamic[1]];
    if (!value) {
      throw new Error(
        `Route discovery: no test value for dynamic segment "[${dynamic[1]}]". `
          + `Add one to DYNAMIC_SEGMENT_VALUES in __tests__/helpers/routes.ts — `
          + `leaving it unmapped would silently drop the route from the suite.`
      );
    }
    return value;
  }
  return segment;
}

/**
 * Is this file a route?
 *
 * Expo Router skips, and so do we:
 *  - `_layout.*`          — layouts wrap routes, they are not routes
 *  - `+not-found`, `+html`, `+native-intent`, and any other `+`-prefixed file
 *                         — framework hooks, not navigable screens
 *  - anything under a `_`-prefixed directory — private, not routed
 *  - `.d.ts` declaration files
 *  - non-source files (.DS_Store lives in app/ in this repo)
 */
function isRouteFile(relativePath: string): boolean {
  const segments = relativePath.split('/');
  const basename = segments[segments.length - 1];
  const ext = path.extname(basename);

  if (!ROUTE_EXTENSIONS.has(ext)) return false;
  if (basename.endsWith('.d.ts')) return false;

  const stem = basename.slice(0, -ext.length);
  if (stem === '_layout') return false;
  if (stem.startsWith('+')) return false;

  // A `_`-prefixed directory anywhere in the path means "not routed".
  if (segments.slice(0, -1).some((s) => s.startsWith('_'))) return false;

  return true;
}

/**
 * File path -> URL, applying Expo Router's URL conventions:
 *  - `(group)` segments are organisational and do NOT appear in the URL
 *  - `index` resolves to its parent directory
 *  - `[param]` is filled from DYNAMIC_SEGMENT_VALUES
 */
function fileToHref(relativePath: string): string {
  const ext = path.extname(relativePath);
  const withoutExt = relativePath.slice(0, -ext.length);

  const segments = withoutExt
    .split('/')
    // Route groups: "(tabs)", "(home)" — present in the file tree, absent
    // from the URL. This is why app/(tabs)/(home)/index.tsx is "/".
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
    .map(fillDynamic);

  // "index" is the parent path, not a path called "index".
  if (segments[segments.length - 1] === 'index') segments.pop();

  return '/' + segments.join('/');
}

function walk(dir: string, base = dir, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, base, out);
      continue;
    }
    out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

let cached: DiscoveredRoute[] | null = null;

/**
 * Every navigable route in `app/`, derived from the filesystem.
 *
 * Sorted by href so a failing run reads the same way twice, and de-duplicated
 * because two files can legitimately resolve to the same URL only if one is a
 * re-export — in which case testing it twice is wasted time, not extra
 * coverage. (`app/(tabs)/discover/estimate.tsx` is exactly that: a one-line
 * `export { default } from '../../(tabs)/estimate/index'`.)
 */
export function discoverRoutes(): DiscoveredRoute[] {
  if (cached) return cached;

  const files = walk(APP_DIR).filter(isRouteFile).sort();

  const byHref = new Map<string, DiscoveredRoute>();
  for (const file of files) {
    const href = fileToHref(file);
    if (byHref.has(href)) continue;
    byHref.set(href, {
      file,
      href,
      dynamic: /\[.+\]/.test(file),
    });
  }

  cached = [...byHref.values()].sort((a, b) => a.href.localeCompare(b.href));
  return cached;
}

/**
 * A floor on the discovered count.
 *
 * Not a pin — pinning would make every new screen a failing test, which is the
 * opposite of what the spec wants ("Adding a new screen to app/ puts it under
 * test with no other action"). A floor only catches the failure mode that
 * actually matters: the walk silently matching nothing (wrong path, changed
 * conventions, a refactor that moves app/) and the suite reporting a
 * triumphant zero failures over zero routes.
 */
export const MINIMUM_EXPECTED_ROUTES = 150;
