/**
 * __tests__/setup/strict-mode.ts — the one escape hatch for SMOKE_STRICT.
 *
 * When console.error is promoted to a failure (SMOKE_STRICT=1), the tests that
 * deliberately CRASH a screen to prove the detector works would fail on their
 * own success: React logs "The above error occurred in <...>" through
 * console.error every time an error boundary catches something.
 *
 * Rather than pattern-matching that message — which would also suppress the
 * real ones — the intent is declared. `mountInjectedRoute` is the only caller,
 * and injected routes exist for exactly one purpose: proving the harness
 * detects a crash. A real screen can never reach this.
 */

let allowed = false;

/** Mark the current test as one that is SUPPOSED to log a React error. */
export function allowConsoleErrors(): void {
  allowed = true;
}

/** Read-and-reset. Called by after-env.ts in its afterEach. */
export function consumeConsoleErrorAllowance(): boolean {
  const was = allowed;
  allowed = false;
  return was;
}
