/**
 * Web — the marketing site's motion (lane MOTIONWEB). Fixture: the REAL
 * marketing/index.html body + its main inline <script> + the real
 * marketing/assets/motion-kit.js + the static (non-@media) part of
 * motion-kit.css. IntersectionObserver, matchMedia, getBoundingClientRect,
 * requestAnimationFrame and the canvas 2D context are mocked and driven by
 * hand (the motion-kit-marketing.webtest.ts pattern).
 *
 *  W1 no-JS truth: nothing hidden before any script; the inline script alone
 *     changes classes only inside #cmpPanel / .faculty / #brainCap.
 *  W2 kit missing: the compare select renders and does not throw.
 *  W3 reduce at init: nothing armed; MageMotion.play(#cmpPanel) is a no-op.
 *  W4 first screen on a 2160 px monitor: in-view groups never arm or change.
 *  W5 caps: ≤ 8 animated children per group (≤ 6 cards); the panel has 8 rows.
 *  W6 payoff: $1,400 → $2,220 → $2,830, ends byte-equal, <small> survives.
 *  W7 compare: a select change calls MageMotion.play once and the panel plays.
 *  W8 chat: q → thinking → answered; no chip class before the answer.
 *  W9 watch: mk-prio on the stop row at sequenceMs(6) + 120 ms; board complete at rest.
 *  W10 brain canvas: no loop on the first screen until input; stops off screen.
 *  W11 fling: all ten groups at once → the last starts within 3 s (printed).
 *  W12 slim motion.js: year + progress line, no script, no mousemove, no rAF.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const HTML = readFileSync(join(ROOT, 'marketing/index.html'), 'utf8');
const KIT = readFileSync(join(ROOT, 'marketing/assets/motion-kit.js'), 'utf8');
const KIT_CSS_STATIC = readFileSync(join(ROOT, 'marketing/assets/motion-kit.css'), 'utf8').split('@media')[0];
const SLIM = readFileSync(join(ROOT, 'marketing/motion.js'), 'utf8');
const FIN = readFileSync(join(ROOT, 'marketing/features/financials.html'), 'utf8');

const BODY_RAW = (HTML.match(/<body>([\s\S]*)<\/body>/) ?? ['', ''])[1];
const INLINE = [...BODY_RAW.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const MAIN = INLINE[INLINE.length - 1];
const BODY = BODY_RAW.replace(/<script[\s\S]*?<\/script>/g, '');

type IOEntry = { target: Element; isIntersecting: boolean };
type IOOpts = { threshold?: number; rootMargin?: string };
let observers: FakeIO[] = [];
class FakeIO {
  cb: (e: IOEntry[]) => void;
  opts: IOOpts;
  watched = new Set<Element>();
  constructor(cb: (e: IOEntry[]) => void, opts: IOOpts) { this.cb = cb; this.opts = opts || {}; observers.push(this); }
  observe(el: Element) { this.watched.add(el); }
  unobserve(el: Element) { this.watched.delete(el); }
  disconnect() { this.watched.clear(); }
}
let reduce = false;
let rafQueue: { cb: FrameRequestCallback; name: string }[] = [];
let rafCalls: string[] = [];
let inView = new Set<string>();

/** A callable, chainable no-op standing in for CanvasRenderingContext2D (and its gradients). */
function noop2d(): unknown {
  const fn = function () { return proxy; };
  const proxy: unknown = new Proxy(fn, { get: () => proxy, set: () => true, apply: () => proxy });
  return proxy;
}

function setup(opts: { reduce?: boolean; vh?: number; inView?: string[] } = {}) {
  document.head.innerHTML = '<style>' + KIT_CSS_STATIC + '</style>';
  document.body.innerHTML = BODY;
  observers = [];
  reduce = !!opts.reduce;
  rafQueue = [];
  rafCalls = [];
  inView = new Set(opts.inView ?? ['hero']);
  const w = window as unknown as Record<string, unknown>;
  w.IntersectionObserver = FakeIO;
  w.matchMedia = (q: string) => ({ matches: q.includes('reduce') ? reduce : false, addEventListener: () => {}, removeEventListener: () => {} });
  w.requestAnimationFrame = (cb: FrameRequestCallback) => { rafCalls.push(cb.name); rafQueue.push({ cb, name: cb.name }); return rafQueue.length; };
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: opts.vh ?? 800 });
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => noop2d() as never);
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const sec = this.closest('section');
    const key = sec ? (sec.classList.contains('hero') ? 'hero' : sec.id || sec.className) : 'none';
    const top = inView.has(key) ? 100 : 5000;
    return { top, bottom: top + 400, left: 0, right: 600, width: 600, height: 400, x: 0, y: top, toJSON() { return {}; } } as DOMRect;
  });
}
const runMain = () => { new Function(MAIN)(); };
const runKit = () => { new Function('window', 'document', KIT)(window, document); };
const kitIO = () => observers.find((o) => o.opts.rootMargin === '0px 0px -20% 0px')!;
const brainIO = () => observers.find((o) => o.opts.threshold === 0)!;
const enter = (...els: Element[]) => kitIO().cb(els.map((target) => ({ target, isIntersecting: true })));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const groups = () => Array.from(document.querySelectorAll('[data-mk]')) as HTMLElement[];
const mm = () => (window as unknown as { MageMotion?: { play: (el: Element) => void; sequenceMs: (n: number) => number } }).MageMotion;
function flushRaf(times = 1) {
  for (let i = 0; i < times; i++) { const q = rafQueue; rafQueue = []; q.forEach((f) => f.cb(16 * (i + 1))); }
}
const classSnapshot = () => Array.from(document.querySelectorAll('*')).map((el) => [el, el.getAttribute('class') ?? ''] as const);

describe('marketing motion (homepage + slim motion.js)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (window as unknown as { MageMotion?: unknown }).MageMotion;
  });

  it('W1 no-JS truth: nothing is hidden before any script, and the inline script alone touches only the compare panel, faculties and caption', () => {
    setup();
    const hiding = /(^|\s)(rv|in|reveal|mk-[\w-]+)(\s|$)/;
    const offenders = Array.from(document.querySelectorAll('[class]')).filter((el) => hiding.test(el.getAttribute('class') ?? ''));
    expect(offenders.map((el) => el.getAttribute('class'))).toEqual([]);
    const hidden = Array.from(document.querySelectorAll('[data-mk], [data-mk] *'))
      .filter((el) => !el.matches('[data-mk-think], [data-mk-think] *'))
      .filter((el) => getComputedStyle(el).opacity === '0' || getComputedStyle(el).visibility === 'hidden');
    expect(hidden).toHaveLength(0);
    const hidingStyle = Array.from(document.querySelectorAll('[data-mk] [style], [data-mk][style]'))
      .filter((el) => /(opacity|visibility|max-height|display\s*:\s*none)/i.test(el.getAttribute('style') ?? ''));
    expect(hidingStyle).toHaveLength(0);

    const before = new Map(classSnapshot());
    runMain();
    const changed = classSnapshot().filter(([el, c]) => before.has(el) && before.get(el) !== c).map(([el]) => el);
    const outside = changed.filter((el) => !el.closest('#cmpPanel, .faculty, #brainCap'));
    expect(outside).toEqual([]);
    expect(document.querySelectorAll('#cmpPanel [data-mk-row]')).toHaveLength(8);
  });

  it('W2 kit missing: a compare change renders and does not throw', () => {
    setup();
    runMain();
    expect(mm()).toBeUndefined();
    const sel = $('#cmpSel') as unknown as HTMLSelectElement;
    // PROTECT-TEXT (2026-10-09): the named-competitor entries left the homepage
    // widget (unsourced claims about other products). The one entry left is
    // the spreadsheet baseline, and the change path is exercised on it.
    sel.value = 'sheets';
    expect(() => sel.dispatchEvent(new Event('change'))).not.toThrow();
    expect($('#cmpPanel').textContent).toContain('Spreadsheets');
    expect(document.querySelectorAll('#cmpPanel [data-mk-row]')).toHaveLength(8);
  });

  it('W3 Reduce Motion at init: nothing arms, play() is a no-op', () => {
    setup({ reduce: true });
    runMain();
    runKit();
    expect(document.querySelectorAll('.mk-armed')).toHaveLength(0);
    mm()!.play($('#cmpPanel'));
    jest.advanceTimersByTime(2000);
    expect($('#cmpPanel').getAttribute('class')).toBe('cmp-panel');
    expect(rafCalls.filter((n) => n === 'frame')).toHaveLength(0);
  });

  it('W4 first screen at 2160 px: in-view groups never arm or change; the rest arm; the hero has no data-mk', () => {
    setup({ vh: 2160, inView: ['hero', 'brain', 'score'] });
    runMain();
    runKit();
    expect(document.querySelectorAll('.hero [data-mk]')).toHaveLength(0);
    const scoreGroups = Array.from(document.querySelectorAll('#score [data-mk]'));
    expect(scoreGroups.length).toBe(3);
    scoreGroups.forEach((g) => expect(Array.from(g.classList).filter((c) => c.startsWith('mk-'))).toEqual([]));
    const below = groups().filter((g) => !g.closest('#score'));
    expect(below.length).toBe(7);
    below.forEach((g) => expect(g.classList.contains('mk-armed')).toBe(true));
    scoreGroups.forEach((g) => expect(kitIO().watched.has(g)).toBe(false));
  });

  it('W5 caps: every armed group animates at most 8 children (6 cards); the panel renders exactly 8 rows', () => {
    setup();
    runMain();
    runKit();
    const armed = Array.from(document.querySelectorAll('.mk-armed'));
    expect(armed.length).toBe(10);
    for (const g of armed) {
      for (const k of ['item', 'cell', 'row', 'label', 'chip']) expect(g.querySelectorAll('[data-mk-' + k + ']').length).toBeLessThanOrEqual(8);
      expect(g.querySelectorAll('[data-mk-card]').length).toBeLessThanOrEqual(6);
    }
    expect(document.querySelectorAll('#cmpPanel [data-mk-row]')).toHaveLength(8);
    expect(document.querySelectorAll('#cmpPanel .cmp-row')).toHaveLength(9);
  });

  it('W6 payoff: the total steps $1,400 → $2,220 → $2,830 and ends byte-equal, <small> intact', () => {
    setup();
    runMain();
    runKit();
    const card = $('.payoff [data-mk="accumulate"]');
    const count = card.querySelector('[data-mk-count]') as HTMLElement;
    const original = count.textContent;
    enter(card);
    const seen: string[] = [];
    for (let t = 0; t < 1200; t += 10) {
      jest.advanceTimersByTime(10);
      if (seen[seen.length - 1] !== count.textContent) seen.push(count.textContent ?? '');
    }
    expect(seen).toEqual(['$2,830', '$1,400', '$2,220', '$2,830']);
    expect(count.textContent).toBe(original);
    const small = count.nextElementSibling as HTMLElement;
    expect(small.tagName).toBe('SMALL');
    expect(small.textContent).toBe('protected');
    expect(count.children).toHaveLength(0);
  });

  it('W7 compare: a select change calls MageMotion.play once with the panel, which plays', () => {
    setup();
    runMain();
    runKit();
    const panel = $('#cmpPanel');
    const spy = jest.spyOn(mm()!, 'play');
    const sel = $('#cmpSel') as unknown as HTMLSelectElement;
    sel.value = 'sheets';
    sel.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(panel);
    expect(panel.classList.contains('mk-in')).toBe(true);
    expect(panel.querySelectorAll('[data-mk-row]')).toHaveLength(8);
  });

  it('W8 chat: question, then thinking, then answer; chips get no class before the answer', () => {
    setup();
    runMain();
    runKit();
    const chat = $('[data-mk="chat"]');
    const chips = Array.from(chat.querySelectorAll('[data-mk-chip]'));
    expect(chips).toHaveLength(4);
    enter(chat);
    const order: string[] = [];
    const note = (c: string) => { if (chat.classList.contains(c) && !order.includes(c)) order.push(c); };
    for (let t = 0; t <= 1500; t += 10) {
      ['mk-q', 'mk-thinking', 'mk-answered'].forEach(note);
      if (!chat.classList.contains('mk-answered')) chips.forEach((ch) => expect(ch.getAttribute('class')).toBeNull());
      jest.advanceTimersByTime(10);
    }
    expect(order).toEqual(['mk-q', 'mk-thinking', 'mk-answered']);
    expect(chat.classList.contains('mk-thinking')).toBe(false);
    expect(chat.classList.contains('mk-done')).toBe(true);
  });

  it('W9 watch: the worst row gets mk-prio at sequenceMs(6) + 120 ms; the board is complete at rest', () => {
    setup();
    const atRest = () => ['.wl-cascade', '.wl-note'].forEach((s) => {
      const el = $(s);
      // Only the kit's own stagger index (--mk-i) may sit inline; nothing that hides or sizes the row.
      expect((el.getAttribute('style') ?? '').replace(/--mk-[\w-]+\s*:[^;]*;?/g, '').trim()).toBe('');
      expect(Array.from(el.classList).filter((c) => c.startsWith('mk-') || c === 'in')).toEqual([]);
    });
    atRest();
    runMain();
    runKit();
    const board = $('#watch [data-mk="priority"]');
    const stop = board.querySelector('[data-mk-priority]') as HTMLElement;
    expect(stop.getAttribute('data-sev')).toBe('stop');
    expect(board.querySelectorAll('[data-mk-cell]')).toHaveLength(6);
    const due = mm()!.sequenceMs(6) + 120;
    enter(board);
    jest.advanceTimersByTime(due - 1);
    expect(stop.classList.contains('mk-prio')).toBe(false);
    jest.advanceTimersByTime(1);
    expect(stop.classList.contains('mk-prio')).toBe(true);
    jest.advanceTimersByTime(2000);
    atRest();
  });

  it('W10 brain canvas: on the first screen nothing loops until input; off screen the loop stops', () => {
    setup({ vh: 2160, inView: ['hero', 'brain'] });
    runMain();
    brainIO().cb([{ target: $('#brainCanvas'), isIntersecting: true }]);
    jest.advanceTimersByTime(3000);
    expect(rafCalls.filter((n) => n === 'frame')).toHaveLength(0);
    window.dispatchEvent(new Event('scroll'));
    expect(rafCalls.filter((n) => n === 'frame')).toHaveLength(1);
    flushRaf(5);
    const running = rafCalls.filter((n) => n === 'frame').length;
    expect(running).toBe(6);
    brainIO().cb([{ target: $('#brainCanvas'), isIntersecting: false }]);
    flushRaf(3);
    expect(rafCalls.filter((n) => n === 'frame').length).toBe(running);
    expect(rafQueue.filter((f) => f.name === 'frame')).toHaveLength(0);
  });

  it('W11 fling: all ten groups enter at once and the last one starts within 3 s', () => {
    setup();
    runMain();
    runKit();
    const all = groups();
    expect(all).toHaveLength(10);
    const startedAt = new Map<Element, number>();
    enter(...all);
    for (let t = 0; t <= 4000; t += 10) {
      all.forEach((g) => { if (!startedAt.has(g) && (g.classList.contains('mk-in') || g.classList.contains('mk-done'))) startedAt.set(g, t); });
      jest.advanceTimersByTime(10);
    }
    expect(startedAt.size).toBe(10);
    const last = Math.max(...startedAt.values());
    // eslint-disable-next-line no-console
    console.log('W11 fling: the last of 10 groups started at ' + last + ' ms');
    expect(last).toBeLessThanOrEqual(3000);
    all.forEach((g) => expect(g.classList.contains('mk-done')).toBe(true));
  });

  it('W12 slim motion.js on a features page: year + progress line only, no script, no mousemove, no rAF', () => {
    setup();
    const body = (FIN.match(/<body>([\s\S]*)<\/body>/) ?? ['', ''])[1].replace(/<script[\s\S]*?<\/script>/g, '');
    document.body.innerHTML = body + '<span id="year"></span>';
    const added: string[] = [];
    const winAdd = jest.spyOn(window, 'addEventListener').mockImplementation(((t: string) => { added.push(t); }) as never);
    const docAdd = jest.spyOn(document, 'addEventListener').mockImplementation(((t: string) => { added.push(t); }) as never);
    const scriptsBefore = document.querySelectorAll('script').length;
    new Function(SLIM)();
    expect($('#year').textContent).toBe(String(new Date().getFullYear()));
    expect(document.querySelectorAll('.scroll-progress')).toHaveLength(1);
    expect(document.querySelectorAll('script').length).toBe(scriptsBefore);
    expect(added).not.toContain('mousemove');
    expect(added).not.toContain('wheel');
    expect(rafCalls).toHaveLength(0);
    winAdd.mockRestore();
    docAdd.mockRestore();
  });
});
