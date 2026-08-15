/**
 * An empty module. Used by jest.config.js `moduleNameMapper` to neutralise
 * dev-server-only modules that jest-expo's own preset pulls in before any of
 * our setup files get a chance to run.
 *
 * Currently: `expo/src/async-require/setup`, which unconditionally wires up
 * Fast Refresh and the Metro HMR websocket whenever `__DEV__ && window` — and
 * under jest `window` exists (jest-expo aliases it to `global`) while
 * `window.location` does not, so it dies with
 *   TypeError: Cannot read properties of undefined (reading 'protocol')
 * at expo/src/async-require/hmr.ts:160 before a single test can load.
 *
 * Neutralising it is safe: everything in that module is Metro-dev-server
 * plumbing (fast refresh, HMR socket, the log message socket). None of it is
 * app behaviour, so nothing the smoke suite is meant to detect hides here.
 */
module.exports = {};
