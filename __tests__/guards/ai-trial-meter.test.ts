// A metered free trial has to show its meter, and the upgrade pitch has to
// quote the real allowance.
//
// WHY THIS EXISTS. Two defects in the same funnel, found by rendering it:
//
//   1. utils/aiRateLimiterCore FEATURE_CONFIG gives aiEstimateWizard
//      `freeLifetimeCap: 2`. `evaluateLimit` computed what was left, returned it
//      as `remaining`, and app/estimate-wizard.tsx threw it away —
//      `getFreeTrialsRemaining` (utils/aiRateLimiter) had ZERO callsites in the
//      whole app. So the contractor generated one estimate, tapped Refine to
//      sharpen the number (which re-runs the model and spends the second), and
//      met a wall on the third tap, from a button labelled "Try it free". The
//      count only became visible at zero, which turns a metered offer into an
//      ambush.
//   2. The wall itself said "Upgrade to Pro for unlimited use" while
//      app/paywall.tsx — two taps away — prints Pro's real quota (6 advanced AI
//      runs a day) from the same LIMITS table. The app retracted its own
//      promise at the moment the contractor was deciding to spend $29.
//
// THE RULE ENFORCED HERE: while a lifetime cap exists, the wizard must read and
// display the remaining count and must say that refining spends one; and no
// message built from LIMITS may promise "unlimited".
//
// Source-text, like the repo's other copy guards: the defect IS the missing
// callsite and the literal word.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('the free AI-estimate meter is visible before it is spent', () => {
  const core = read('utils/aiRateLimiterCore.ts');
  const wizard = read('app/estimate-wizard.tsx');

  it('aiEstimateWizard still has a lifetime cap (otherwise this guard is moot)', () => {
    // If the cap is ever removed, delete this file rather than weakening it.
    expect(core).toMatch(/aiEstimateWizard:\s*\{[^}]*freeLifetimeCap:\s*\d+/);
  });

  it('the wizard reads the remaining count and puts it on screen', () => {
    // The read (no spend) and the post-run update, both of which the screen
    // used to do without.
    expect(wizard).toContain("getFreeTrialsRemaining('aiEstimateWizard')");
    expect(wizard).toMatch(/setFreeRunsLeft\(Math\.max\(0,\s*limit\.remaining\)\)/);
    // …and it is rendered, not just held in state. freeRunsLabel is the only
    // thing that formats it for a user.
    expect(wizard).toMatch(/function freeRunsLabel/);
    const renderedUses = wizard.match(/freeRunsLabel\(freeRunsLeft\)/g) ?? [];
    expect(renderedUses.length).toBeGreaterThanOrEqual(2);
  });

  it('the refine loop admits that it spends one', () => {
    // Refine appends to the prompt and re-asks the model (the prompt-keyed
    // cache misses by design), so it costs a trial. Saying so is the whole
    // fix: a user who thinks he is editing must not be spending.
    expect(wizard).toContain('uses one of your');
  });

  it('no upgrade message promises unlimited use', () => {
    // LIMITS.pro is finite and app/paywall.tsx renders it. Any "unlimited"
    // here is contradicted two taps later.
    //
    // The WHOLE module, not just evaluateLimit onward: the sentence that
    // replaced "unlimited" is built by proAllowanceSentence, which is defined
    // ABOVE evaluateLimit. Scanning from evaluateLimit let that helper be
    // rewritten back to "Upgrade to Pro for unlimited use." with all four
    // assertions still green — verified by mutation, which is the whole reason
    // this scan starts at the top of the file.
    //
    // Comments are stripped first: this file EXPLAINS the word, and a guard
    // that trips on its own reasoning teaches people to delete the reasoning.
    const body = core
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(body.toLowerCase()).not.toContain('unlimited');
    // The replacement must quote the table rather than a typed number.
    expect(core).toMatch(/LIMITS\.pro\.(smart|daily)/);
  });
});
