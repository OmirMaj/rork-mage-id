/**
 * __tests__/setup/clock-shift-env.web.js — the shifted-clock DETECTOR for the
 * desktop-web suite (__tests__/web/jest.web.config.js).
 *
 * The jest-expo/web preset sets `testEnvironment: 'jsdom'`
 * (node_modules/jest-expo/config/getPlatformPreset.js getWebPreset), which jest
 * resolves to the `jest-environment-jsdom` package. This extends exactly that, and
 * installs the same shift as the native detector — see clock-shift-env.native.js
 * for what is shifted and why.
 *
 * OPT-IN, CLI ONLY:
 *   MAGE_CLOCK_SHIFT_DAYS=40 npx jest -w 1 --config __tests__/web/jest.web.config.js \
 *     --testEnvironment ./__tests__/setup/clock-shift-env.web.js
 */
'use strict';

const JsdomEnv = require('jest-environment-jsdom').TestEnvironment;
const { applyClockShift } = require('./clock-shift-env.native.js');

class ClockShiftWebEnv extends JsdomEnv {
  constructor(config, context) {
    super(config, context);
    applyClockShift(this);
  }
}

module.exports = ClockShiftWebEnv;
