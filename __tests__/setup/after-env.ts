/**
 * __tests__/setup/after-env.ts — runs inside the test framework.
 *
 * The one policy decision in here is what counts as failure.
 *
 * Spec: "A test fails if mounting throws. That is all, initially. Specifically
 * NOT failing on console.error ... this repo carries 2,931 existing lint
 * warnings. If the smoke suite lights up red on day one for pre-existing noise,
 * it will be ignored — and an ignored suite is worse than no suite, because it
 * looks like coverage."
 *
 * So console.error is captured (so a run stays readable) but never promoted to
 * a failure. When the suite is green and trusted, the follow-up change is:
 * delete the `swallow` list below and throw from the console.error patch.
 */

import '@testing-library/react-native/dont-cleanup-after-each';
import { cleanup } from '@testing-library/react-native';

// RNTL's auto-cleanup is opted out of above so each smoke test can control
// unmount ordering explicitly; we still clean up after every test.
afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Console capture. NOT a failure channel — see the header comment.
// Kept quiet so a run with twelve mount failures is readable without
// scrolling past thousands of React key warnings.
// ---------------------------------------------------------------------------
const realError = console.error;
const realWarn = console.warn;
const realLog = console.log;

// Set SMOKE_VERBOSE=1 to see everything the app logs while mounting. Useful
// when a screen fails and the thrown message alone is not enough.
const verbose = process.env.SMOKE_VERBOSE === '1';

beforeAll(() => {
  if (verbose) return;
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
});

afterAll(() => {
  console.error = realError;
  console.warn = realWarn;
  console.log = realLog;
});

// ---------------------------------------------------------------------------
// Unhandled promise rejections from a provider's fire-and-forget hydration
// would otherwise crash the whole worker mid-file and lose every result after
// it. Mounting is the assertion; a background rejection is not a mount failure.
// ---------------------------------------------------------------------------
process.on('unhandledRejection', () => {});

// A long provider tree plus 200 routes is slow on a cold module graph.
jest.setTimeout(120_000);
