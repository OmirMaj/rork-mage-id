/**
 * Q6 — "What kind of project?" gets Plumbing / Repipe, Electrical / Rewire and
 * Other (describe it), and the rest of the stepper is untouched.
 *
 * THE FOUNDER: "maybe add 'Other' section? I did a repiping project so not sure
 * what category that would go under here". His live "piping" job is typed
 * plumbing but its scope answer reads "Bathroom Remodel" — the chip row had no
 * trade jobs and no way out, so he picked a wrong box and the AI was told
 * "Project type: Bathroom Remodel".
 *
 * GOLDENS. __tests__/fixtures/scope-stepper-goldens.json was recorded from the
 * component BEFORE this change (RECORD_SCOPE_GOLDENS=1 on the untouched file).
 * Steps 1-7 (size, location, quality, scope, timeline, requirements, budget)
 * must render byte-identical to it; step 0 must keep the ten original chips,
 * element for element and style for style, in the same order, and only ADD
 * the new ones after them.
 */

import React from 'react';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ScopeQuestionStepper } from '@/components/ScopeQuestionStepper';
import { INITIAL_SCOPE, type WizardAnswers } from '@/utils/scopeQuestions';

// react-test-renderer ships no .d.ts here (RNTL wraps it).
type TestRendererInstance = { toJSON(): unknown; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer: { create(el: React.ReactElement): TestRendererInstance } = require('react-test-renderer');

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

const GOLDEN = join(__dirname, '..', 'fixtures', 'scope-stepper-goldens.json');

const FILLED: WizardAnswers = {
  ...INITIAL_SCOPE,
  projectType: 'Bathroom Remodel',
  sizeSqft: '1500',
  location: 'Austin, TX',
  quality: 'high_end',
  scope: 'Gut the hall bath',
  timelineWeeks: '6',
  specialRequirements: 'HOA review',
  targetBudget: '40000',
};

function tree(el: React.ReactElement): unknown {
  let r: TestRendererInstance | null = null;
  act(() => {
    r = TestRenderer.create(el);
  });
  const inst = r as unknown as TestRendererInstance;
  const json = inst.toJSON();
  act(() => {
    inst.unmount();
  });
  return json;
}
const serialize = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'function' ? `[fn ${x.name || 'anonymous'}]` : x === undefined ? '__undefined__' : x)));

const stepTree = (i: number, answers: WizardAnswers = FILLED) =>
  serialize(tree(<ScopeQuestionStepper stepIndex={i} answers={answers} onChange={() => {}} />));

/** Every node with a testID starting with `prefix`, in document order. */
function nodesWithTestId(node: unknown, prefix: string, out: Array<Record<string, unknown>> = []) {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach(n => nodesWithTestId(n, prefix, out));
    return out;
  }
  const n = node as { props?: { testID?: string }; children?: unknown };
  if (typeof n.props?.testID === 'string' && n.props.testID.startsWith(prefix)) out.push(n as Record<string, unknown>);
  if (n.children) nodesWithTestId(n.children, prefix, out);
  return out;
}

if (process.env.RECORD_SCOPE_GOLDENS === '1') {
  test('record goldens from the untouched stepper', () => {
    const steps = Array.from({ length: 8 }, (_, i) => stepTree(i));
    writeFileSync(GOLDEN, JSON.stringify({ steps }, null, 1) + '\n');
    expect(existsSync(GOLDEN)).toBe(true);
  });
} else {
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { steps: unknown[] };

  describe('scope stepper — unchanged where the spec does not change it', () => {
    test.each([1, 2, 3, 4, 5, 6, 7])('step %i renders byte-identical to the pre-change golden', (i) => {
      expect(stepTree(i)).toEqual(golden.steps[i]);
    });

    test('step 0 keeps the ten original chips, identical and in order, and only appends', () => {
      const before = nodesWithTestId(golden.steps[0], 'scope-type-');
      const after = nodesWithTestId(stepTree(0), 'scope-type-');
      expect(before).toHaveLength(10);
      expect(after.slice(0, 10)).toEqual(before);
      const added = after.slice(10).map(n => (n.props as { testID: string }).testID);
      expect(added).toEqual(['scope-type-Plumbing / Repipe', 'scope-type-Electrical / Rewire', 'scope-type-other']);
    });
  });

  describe('Other (describe it)', () => {
    function Harness({ initial }: { initial: string }) {
      const [answers, setAnswers] = React.useState<WizardAnswers>({ ...INITIAL_SCOPE, projectType: initial });
      return (
        <>
          <ScopeQuestionStepper
            stepIndex={0}
            answers={answers}
            onChange={(k, v) => setAnswers(prev => ({ ...prev, [k]: v }))}
          />
          <HarnessValue value={answers.projectType} />
        </>
      );
    }
    function HarnessValue({ value }: { value: string }) {
      // Rendered through a testID so the test reads the parent's answer.
      const { Text } = jest.requireActual('react-native');
      return <Text testID="harness-projectType">{`[${value}]`}</Text>;
    }

    test('no text box until Other is tapped; a chip answer never shows it', () => {
      const r = render(<Harness initial="Bathroom Remodel" />);
      expect(r.queryByTestId('scope-type-other-input')).toBeNull();
      r.unmount();
    });

    test('tapping Other clears a chip answer and opens the box; typing is the answer', () => {
      const r = render(<Harness initial="Bathroom Remodel" />);
      fireEvent.press(r.getByTestId('scope-type-other'));
      expect(r.getByTestId('harness-projectType').props.children).toBe('[]');
      const input = r.getByTestId('scope-type-other-input');
      fireEvent.changeText(input, 'Whole-house repipe');
      expect(r.getByTestId('harness-projectType').props.children).toBe('[Whole-house repipe]');
      // Tapping a chip closes it again and the chip is the answer.
      fireEvent.press(r.getByTestId('scope-type-Plumbing / Repipe'));
      expect(r.queryByTestId('scope-type-other-input')).toBeNull();
      expect(r.getByTestId('harness-projectType').props.children).toBe('[Plumbing / Repipe]');
      r.unmount();
    });

    test('a seeded free-text answer (an Other job) opens on Other with his words', () => {
      const r = render(<Harness initial="Whole-house repipe" />);
      expect(r.getByTestId('scope-type-other-input').props.value).toBe('Whole-house repipe');
      r.unmount();
    });

    test('typing a word that equals a chip under Other keeps his text in the box', () => {
      const r = render(<Harness initial="" />);
      fireEvent.press(r.getByTestId('scope-type-other'));
      fireEvent.changeText(r.getByTestId('scope-type-other-input'), 'Addition');
      expect(r.getByTestId('scope-type-other-input').props.value).toBe('Addition');
      r.unmount();
    });

    test('the box caps what he types at 60 characters (the column CHECK)', () => {
      const r = render(<Harness initial="" />);
      fireEvent.press(r.getByTestId('scope-type-other'));
      expect(r.getByTestId('scope-type-other-input').props.maxLength).toBe(60);
      r.unmount();
    });
  });
}
