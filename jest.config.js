// jest.config.js — runtime smoke-test harness.
//
// See docs/superpowers/specs/2026-08-15-runtime-smoke-tests-design.md.
//
// This is the SECOND test system in the repo and it is deliberately separate
// from the 137 `bun run scripts/validate-*.ts` validators. Those assert on pure
// functions and on source text; they never import React and cannot answer
// "does the screen render?". This one mounts real components. Neither replaces
// the other — `testMatch` below is narrow on purpose so jest never tries to
// collect the bun validators.
module.exports = {
  preset: 'jest-expo',

  // Only files that end in `.test.tsx?` under __tests__/. Fixtures, helpers and
  // the route walker live in the same tree and must NOT be run as suites.
  testMatch: ['<rootDir>/__tests__/**/*.test.[jt]s?(x)'],

  // Never look at the bun validators, the built web bundle, or native dirs.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/ios/',
    '/android/',
    '/.expo/',
    '/.claude/',
  ],

  // Agent worktrees under .claude/ and the exported web bundle under dist/
  // contain their own package.json named "expo-app", which makes jest-haste-map
  // abort with "Haste module naming collision". Keep them out of the module map
  // entirely.
  modulePathIgnorePatterns: [
    '<rootDir>/.claude/',
    '<rootDir>/dist/',
    '<rootDir>/ios/',
    '<rootDir>/android/',
    '<rootDir>/.expo/',
    '<rootDir>/marketing/',
  ],

  setupFiles: ['<rootDir>/__tests__/setup/edge-mocks.js'],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup/after-env.ts'],

  moduleNameMapper: {
    // Metro dev-server plumbing that jest-expo's preset imports before any of
    // our setup files run. See __tests__/mocks/noop.js for why.
    'async-require/setup$': '<rootDir>/__tests__/mocks/noop.js',
    // The network edge. Mocked before the `@/` alias so it wins.
    // (All 104 call sites import it as exactly `@/lib/supabase`.)
    '^@/lib/supabase$': '<rootDir>/__tests__/mocks/supabase.ts',
    // metro.config.js redirects bare `tslib` to the CJS build because the ESM
    // wrapper explodes at module-eval time. Jest needs the same redirect or
    // anything pulling pdf-lib dies with
    // "Cannot destructure property '__extends' of 'tslib.default'".
    '^tslib$': '<rootDir>/node_modules/tslib/tslib.js',
    // tsconfig paths: `@/*` -> repo root.
    '^@/(.*)$': '<rootDir>/$1',
  },

  // jest-expo's list plus the packages this app actually pulls that ship
  // untranspiled ESM. Every addition here was driven by an observed
  // "Unexpected token 'export'" — none are speculative.
  transformIgnorePatterns: [
    '/node_modules/(?!(' +
      [
        '.pnpm',
        'react-native',
        '@react-native',
        '@react-native-community',
        'expo',
        '@expo',
        '@expo-google-fonts',
        'react-navigation',
        '@react-navigation',
        '@sentry/react-native',
        'native-base',
        'react-native-svg',
        'lucide-react-native',
        'react-native-gesture-handler',
        'react-native-safe-area-context',
        'react-native-screens',
        'react-native-purchases',
        'react-native-worklets',
        'react-native-web',
        '@nkzw',
        'nanoid',
        'uuid',
      ].join('|') +
      '))',
    '/node_modules/react-native-reanimated/plugin/',
  ],

  // A single screen inside the real 16-provider stack is not fast. The default
  // 5s trips on the first cold module graph.
  testTimeout: 30000,

  // No snapshots (spec: "Snapshots ... churn on every style change and train
  // people to run -u without reading the diff"). This makes an accidental
  // toMatchSnapshot() fail rather than silently write a file.
  ci: false,

  clearMocks: true,
};
