// __tests__/web/jest.web.config.js — the REAL-DOM harness for desktop web.
//
// WHY A SECOND CONFIG. jest.config.js runs the smoke suite on the jest-expo
// (iOS) preset: React Native's renderer, no <a>, no DOM events. That harness
// cannot see two classes of desktop-web bug, and wave 6b shipped both past it:
//   • an expo-router <Link> that hard-reloads the SPA on a plain click (the
//     bug lives in how Link's props merge with react-native-web's Pressable);
//   • a keyboard shortcut that never hears a key typed in a field
//     (react-native-web's TextInput stops keydown propagation).
// This config runs the same modules on the jest-expo/web preset — jsdom +
// react-dom + react-native-web — and clicks / types on real DOM nodes.
//
// Files are `*.webtest.tsx` so the default (native) run never collects them.
// Run: npx jest --config __tests__/web/jest.web.config.js
const path = require('path');
const base = require('../../jest.config.js');

module.exports = {
  ...base,
  preset: 'jest-expo/web',
  // CommonJS injects __dirname; the flat eslint config does not declare it for
  // .js files outside the repo root.
  // eslint-disable-next-line no-undef
  rootDir: path.resolve(__dirname, '../..'),
  testMatch: ['<rootDir>/__tests__/web/**/*.webtest.[jt]s?(x)'],
  // Only this folder is scanned for tests AND snapshots: the native suite's
  // .snap files would otherwise read as "obsolete" here (their tests do not
  // match this testMatch) and fail the run. Modules still resolve from the
  // repo through node resolution and the base moduleNameMapper.
  roots: ['<rootDir>/__tests__/web'],
  // The native smoke suite's after-env imports @testing-library/react-native;
  // these tests drive react-dom directly and clean up their own roots.
  setupFilesAfterEnv: [],
};
