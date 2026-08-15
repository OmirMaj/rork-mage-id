/**
 * Stage 3 — routes are discovered, not listed.
 *
 * Spec success criterion 3: "Adding a new screen to app/ puts it under test
 * with no other action."
 *
 * This file guards the walk itself. The failure mode it exists to catch is the
 * quiet one: the walk stops matching (app/ moves, conventions change, a glob
 * regresses), discovers zero routes, and the every-route suite reports a
 * triumphant clean run over nothing at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, MINIMUM_EXPECTED_ROUTES, discoverRoutes } from '@/__tests__/helpers/routes';

describe('route discovery', () => {
  const routes = discoverRoutes();

  it('finds the routes in app/', () => {
    // Printed on every run so the headline number is visible without digging.
    process.stdout.write(`\n  [smoke] discovered ${routes.length} routes under app/\n`);
    expect(routes.length).toBeGreaterThanOrEqual(MINIMUM_EXPECTED_ROUTES);
  });

  it('skips layouts and framework files, which are not navigable', () => {
    const files = routes.map((r) => r.file);
    expect(files.filter((f) => f.includes('_layout'))).toEqual([]);
    expect(files.filter((f) => path.basename(f).startsWith('+'))).toEqual([]);
  });

  it('strips route groups from the URL', () => {
    // app/(tabs)/(home)/index.tsx is the app's "/" — if groups leaked into the
    // href it would be "/(tabs)/(home)" and the home screen would go untested.
    const home = routes.find((r) => r.file === '(tabs)/(home)/index.tsx');
    expect(home?.href).toBe('/');
    expect(routes.every((r) => !r.href.includes('('))).toBe(true);
  });

  it('resolves index files to their parent path', () => {
    const settings = routes.find((r) => r.file === '(tabs)/settings/index.tsx');
    expect(settings?.href).toBe('/settings');
    expect(routes.every((r) => !r.href.endsWith('/index'))).toBe(true);
  });

  it('fills dynamic segments with a real value', () => {
    const dynamic = routes.filter((r) => r.dynamic);
    // Today there is exactly one: (tabs)/materials/[category].tsx. The
    // assertion is on the shape, not the count, so adding another is not a
    // failure — but leaving one unmapped IS, because routes.ts throws rather
    // than silently dropping it.
    expect(dynamic.length).toBeGreaterThan(0);
    for (const route of dynamic) {
      expect(route.href).not.toMatch(/[[\]]/);
    }
  });

  it('produces one entry per URL', () => {
    const hrefs = routes.map((r) => r.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('every discovered route points at a file that exists', () => {
    // Spec: "A route that cannot be resolved to a component fails with the
    // file path, not a stack trace from inside the router."
    for (const route of routes) {
      const full = path.join(APP_DIR, route.file);
      if (!fs.existsSync(full)) {
        throw new Error(`Discovered route ${route.href} has no file at ${full}`);
      }
    }
  });
});
