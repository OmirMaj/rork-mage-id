// scripts/validate-copilot-turn-reducer.ts — pure-fn validator for the turn reducer.
import { copilotReducer, initialCopilotState } from '../utils/copilot/turnReducer';
import type { Gap } from '../utils/copilot/types';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
const gap = (f: string): Gap => ({ field: f, impact: 0.9, question: f + '?', groundedDefault: { value: 1, basis: 'b' }, kind: 'number' });
const G = { facts: [], data: {} };

let s = initialCopilotState('schedule', {});
s = copilotReducer(s, { type: 'START', grounding: G });
eq('START → listening', s.phase, 'listening');

s = copilotReducer(s, { type: 'UTTERANCE', turnId: 't1', text: 'gut bath' });
eq('UTTERANCE → thinking', s.phase, 'thinking');
eq('transcript captured', s.transcript.map(t => t.text), ['gut bath']);

s = copilotReducer(s, { type: 'AI_DRAFT', draft: { a: 1 }, resolved: [{ field: 'x', label: 'X', basis: 'b' }], nextGap: gap('start'), ready: false });
eq('AI_DRAFT with gap → asking', s.phase, 'asking');
eq('currentGap set', s.currentGap?.field, 'start');
eq('resolved recorded', s.resolved.length, 1);

s = copilotReducer(s, { type: 'ANSWER', field: 'start', value: '2026-03-21' });
eq('ANSWER → thinking (loops back for next turn)', s.phase, 'thinking');
eq('asked field recorded', s.askedFields, ['start']);
eq('question count incremented', s.questionCount, 1);

s = copilotReducer(s, { type: 'AI_DRAFT', draft: { a: 1 }, resolved: [], nextGap: null, ready: true });
eq('AI_DRAFT ready → review', s.phase, 'review');

s = copilotReducer(s, { type: 'CONFIRM' });
eq('CONFIRM → applying', s.phase, 'applying');
s = copilotReducer(s, { type: 'APPLY_OK' });
eq('APPLY_OK → done', s.phase, 'done');

let e = copilotReducer(initialCopilotState('schedule', {}), { type: 'START', grounding: G });
e = copilotReducer(e, { type: 'UTTERANCE', turnId: 't1', text: 'ten K' });
e = copilotReducer(e, { type: 'EDIT_TRANSCRIPT', turnId: 't1', text: '$10k' });
eq('EDIT_TRANSCRIPT updates text', e.transcript[0].text, '$10k');
eq('EDIT_TRANSCRIPT marks edited', e.transcript[0].edited, true);
eq('EDIT_TRANSCRIPT → thinking', e.phase, 'thinking');

eq('CANCEL → idle', copilotReducer(s, { type: 'CANCEL' }).phase, 'idle');
{
  let f = copilotReducer(e, { type: 'AI_DRAFT', draft: { a: 9 }, resolved: [], nextGap: null, ready: true });
  f = copilotReducer(f, { type: 'CONFIRM' });
  f = copilotReducer(f, { type: 'APPLY_ERR', errorKind: 'network', message: 'offline' });
  eq('APPLY_ERR → error', f.phase, 'error');
  eq('APPLY_ERR preserves draft', (f.draft as any).a, 9);
  eq('APPLY_ERR records kind', f.errorKind, 'network');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
