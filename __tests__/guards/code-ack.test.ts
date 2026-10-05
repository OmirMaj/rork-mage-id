// "Before you rely on a code answer": the one-time notice in front of every
// building-code AI request, and the standing line under every code result.
//
// THE RULE ENFORCED HERE.
//   1. Unacknowledged, a code request does not go out until "I understand" is
//      tapped; the tap is recorded per account with the date and the notice
//      version; a dismissal records nothing and asks again; another account
//      on the same phone is asked for itself.
//   2. Every code request entry point awaits the gate before its request.
//   3. Every code result surface carries the same standing line, once.
//
// The smoke suites mount with the notice already acknowledged
// (__tests__/helpers/mountRoute.tsx); this file is where the unacknowledged
// state is the subject.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CODE_ACK_COPY,
  CODE_ACK_STORAGE_KEY,
  CODE_ACK_VERSION,
  CODE_RESULT_NOTE,
  askCodeAckOnce,
  codeAckCovers,
  createCodeAckGate,
  parseCodeAck,
  serializeCodeAck,
} from '@/utils/codeAckCore';
import { APP_STORAGE_PREFIXES } from '@/utils/localCacheKeys';
import { CODE_CHECK_DISCLAIMER } from '@/utils/codeCheckCopy';
import { CODE_LOOK_DISCLAIMER } from '@/utils/codeLook';
import { PREP_DISCLAIMER } from '@/utils/inspectionPrep';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function memoryStorage(seed: Record<string, string> = {}) {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    getItem: async (k: string) => (k in data ? data[k] : null),
    setItem: async (k: string, v: string) => { data[k] = v; },
  };
}

describe('the notice says exactly what was approved', () => {
  it('title, body and the one button', () => {
    expect(CODE_ACK_COPY.title).toBe('Before you rely on a code answer');
    expect(CODE_ACK_COPY.body).toBe('Code requirements, dimensions and figures shown by MAGE ID may be wrong, out of date, or not the edition your town adopted. The adopted code and your building department govern. Check every requirement before you build.');
    expect(CODE_ACK_COPY.button).toBe('I understand');
  });

  it('is one alert with one button, and a dismissal is not a yes', async () => {
    const calls: { title: string; message?: string; buttons: { text: string; onPress?: () => void }[]; onDismiss?: () => void }[] = [];
    const show = (title: string, message?: string, buttons?: { text: string; onPress?: () => void }[], options?: { onDismiss?: () => void }) => {
      calls.push({ title, message, buttons: buttons ?? [], onDismiss: options?.onDismiss });
    };
    const tapped = askCodeAckOnce(show);
    expect(calls).toHaveLength(1);
    expect(calls[0].title).toBe(CODE_ACK_COPY.title);
    expect(calls[0].message).toBe(CODE_ACK_COPY.body);
    expect(calls[0].buttons.map((b) => b.text)).toEqual(['I understand']);
    calls[0].buttons[0].onPress?.();
    await expect(tapped).resolves.toBe(true);

    const dismissed = askCodeAckOnce(show);
    calls[1].onDismiss?.();
    await expect(dismissed).resolves.toBe(false);
  });

  it('the key is under a prefix the tenant-switch sweep owns', () => {
    expect(APP_STORAGE_PREFIXES.some((p) => CODE_ACK_STORAGE_KEY.startsWith(p))).toBe(true);
  });
});

describe('unacknowledged: the request waits on the notice', () => {
  const at = new Date('2026-10-04T15:30:00.000Z');

  it('asks once, records account + date + version, then never asks again', async () => {
    const storage = memoryStorage();
    const gate = createCodeAckGate({ storage, now: () => at });
    let asked = 0;
    gate.setHost({ accountId: () => 'user-a', prompt: async () => { asked += 1; return true; } });

    expect(await gate.read()).toBeNull();
    expect(await gate.ensure()).toBe(true);
    expect(asked).toBe(1);
    expect(JSON.parse(storage.data[CODE_ACK_STORAGE_KEY])).toEqual({ v: CODE_ACK_VERSION, at: '2026-10-04T15:30:00.000Z', account: 'user-a' });

    expect(await gate.ensure()).toBe(true);
    expect(asked).toBe(1);
    expect(await gate.read()).toEqual({ v: CODE_ACK_VERSION, at: '2026-10-04T15:30:00.000Z', account: 'user-a' });
  });

  it('a dismissal sends nothing, stores nothing, and the next tap asks again', async () => {
    const storage = memoryStorage();
    const gate = createCodeAckGate({ storage, now: () => at });
    let asked = 0;
    gate.setHost({ accountId: () => 'user-a', prompt: async () => { asked += 1; return false; } });
    expect(await gate.ensure()).toBe(false);
    expect(storage.data[CODE_ACK_STORAGE_KEY]).toBeUndefined();
    expect(await gate.ensure()).toBe(false);
    expect(asked).toBe(2);
  });

  it('a second request while the notice is up is refused: one notice, one request', async () => {
    const storage = memoryStorage();
    const gate = createCodeAckGate({ storage, now: () => at });
    let asked = 0;
    let tap: (v: boolean) => void = () => {};
    gate.setHost({ accountId: () => 'user-a', prompt: () => { asked += 1; return new Promise<boolean>((r) => { tap = r; }); } });
    const a = gate.ensure();
    await new Promise((r) => setTimeout(r, 0));
    const b = gate.ensure();
    expect(await b).toBe(false);
    expect(asked).toBe(1);
    tap(true);
    expect(await a).toBe(true);
  });

  it('known() is false until the account acknowledged, then true with no await', async () => {
    const storage = memoryStorage();
    const gate = createCodeAckGate({ storage, now: () => at });
    let who = 'user-a';
    gate.setHost({ accountId: () => who, prompt: async () => true });
    expect(gate.known()).toBe(false);
    await gate.ensure();
    expect(gate.known()).toBe(true);
    who = 'user-b';
    expect(gate.known()).toBe(false);

    // A fresh session learns it from storage (the host reads on mount).
    const next = createCodeAckGate({ storage, now: () => at });
    next.setHost({ accountId: () => 'user-a', prompt: async () => false });
    expect(next.known()).toBe(false);
    await next.read();
    expect(next.known()).toBe(true);
  });

  it('another account on the same phone is asked for itself', async () => {
    const storage = memoryStorage({ [CODE_ACK_STORAGE_KEY]: serializeCodeAck('user-a', at) });
    const gate = createCodeAckGate({ storage, now: () => at });
    let asked = 0;
    gate.setHost({ accountId: () => 'user-b', prompt: async () => { asked += 1; return true; } });
    expect(await gate.ensure()).toBe(true);
    expect(asked).toBe(1);
    expect(parseCodeAck(storage.data[CODE_ACK_STORAGE_KEY])?.account).toBe('user-b');
  });

  it('an older notice version is asked again; garbage is not a record', () => {
    const old = parseCodeAck(serializeCodeAck('user-a', at, CODE_ACK_VERSION - 1));
    expect(codeAckCovers(old, 'user-a')).toBe(false);
    expect(codeAckCovers(parseCodeAck(serializeCodeAck('user-a', at)), 'user-a')).toBe(true);
    for (const raw of [null, '', 'granted', '{}', '{"v":"1","at":"x","account":"a"}', '[1]']) expect(parseCodeAck(raw)).toBeNull();
  });

  it('with nobody to show the notice, the request waits (fail closed)', async () => {
    const gate = createCodeAckGate({ storage: memoryStorage() });
    expect(await gate.ensure()).toBe(false);
  });

  it('a write that fails still stands for this session', async () => {
    const storage = { getItem: async () => null, setItem: async () => { throw new Error('disk full'); } };
    const gate = createCodeAckGate({ storage, now: () => at });
    let asked = 0;
    gate.setHost({ accountId: () => 'user-a', prompt: async () => { asked += 1; return true; } });
    expect(await gate.ensure()).toBe(true);
    expect(await gate.ensure()).toBe(true);
    expect(asked).toBe(1);
  });
});

describe('every code request entry point awaits the gate', () => {
  // file → how many requests it sends (each one behind its own await).
  const ENTRY_POINTS: [string, number][] = [
    ['app/(tabs)/construction-ai/index.tsx', 3], // Code Check, its drill-in, Plan Review
    ['components/construction/AskConstructionMode.tsx', 1], // Ask
    ['components/plans/PlanSweepPanel.tsx', 2], // the sweep: find sheets, review them
    ['components/inspectionPrep/InspectionReadySheet.tsx', 1], // Inspection Ready's recall list
    ['components/codeLook/CodeLookSheet.tsx', 1], // the photo code look
  ];
  it.each(ENTRY_POINTS)('%s', (file, n) => {
    const src = read(file);
    expect(src).toContain("from '@/utils/codeAck'");
    expect(src.split('if (!codeAckKnown() && !(await ensureCodeAck())) return;').length - 1).toBe(n);
  });

  it('the gate comes before the request in each handler', () => {
    const before = (file: string, request: string) => {
      const src = read(file);
      const at = src.indexOf(request);
      expect(at).toBeGreaterThan(-1);
      const gateAt = src.lastIndexOf('if (!codeAckKnown() && !(await ensureCodeAck())) return;', at);
      expect(gateAt).toBeGreaterThan(-1);
      // No other handler starts between the gate and the request.
      expect(src.slice(gateAt, at)).not.toMatch(/= useCallback\(/);
    };
    before('app/(tabs)/construction-ai/index.tsx', 'await reviewPlanCode(');
    before('app/(tabs)/construction-ai/index.tsx', "await mageAISmart(prompt, codeCheckSchema, cacheKey, 'ai_code_check')");
    before('app/(tabs)/construction-ai/index.tsx', "await mageAISmart(prompt, codeDetailSchema, cacheKey, 'ai_code_check')");
    before('components/construction/AskConstructionMode.tsx', 'await askConstruction(');
    before('components/plans/PlanSweepPanel.tsx', 'await findSweepSheets(');
    before('components/plans/PlanSweepPanel.tsx', 'await reviewSweepSheets(');
    before('components/inspectionPrep/InspectionReadySheet.tsx', 'await runInspectionRecall(');
    before('components/codeLook/CodeLookSheet.tsx', 'await analyzePhotoCodeLook(');
  });

  it('the host is mounted once at the root, and the smoke mount seeds the acknowledgement', () => {
    expect(read('app/_layout.tsx').split('<CodeAckHost />').length - 1).toBe(1);
    expect(read('__tests__/helpers/mountRoute.tsx')).toContain('AsyncStorage.setItem(CODE_ACK_STORAGE_KEY, serializeCodeAck(SMOKE_USER.id');
  });
});

describe('every code result surface carries the same standing line, once', () => {
  it('the line', () => {
    expect(CODE_RESULT_NOTE).toBe('Not a substitute for the adopted code. Confirm with your building department.');
  });

  it('Code Check, the photo code look and Inspection Ready end with it', () => {
    for (const line of [CODE_CHECK_DISCLAIMER, CODE_LOOK_DISCLAIMER, PREP_DISCLAIMER]) {
      expect(line.endsWith(CODE_RESULT_NOTE)).toBe(true);
      expect(line.split(CODE_RESULT_NOTE).length - 1).toBe(1);
    }
  });

  it('Plan Review and the sweep end with it (source text: the module imports native files)', () => {
    expect(read('utils/planCodeReviewer.ts')).toContain(`'AI pre-check, not a plan review. ${CODE_RESULT_NOTE}'`);
  });

  it('the code cards close with it, and Ask shows it only when there are no cards', () => {
    expect(read('components/codeCard/parts.tsx')).toContain(`<Text style={styles.confirmHead}>${CODE_RESULT_NOTE}</Text>`);
    const ask = read('components/construction/AskConstructionMode.tsx');
    expect(ask).toMatch(/\{cards\.length > 0 && cardInfo \? null : \(\s*<Text style=\{styles\.codeNote\} testID="construction-ask-code-note">\{CODE_RESULT_NOTE\}<\/Text>/);
  });
});
