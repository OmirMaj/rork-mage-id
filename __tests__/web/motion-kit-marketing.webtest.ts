/**
 * Web — the marketing motion kit (marketing/assets/motion-kit.js), lane
 * MOTIONKIT, spec D4. Fixture: scripts/motion-kit-demo/index.html. The
 * IntersectionObserver and matchMedia are mocked and triggered by hand;
 * getBoundingClientRect is stubbed so one card sits above the fold.
 *
 *  M1 before the script runs nothing is hidden (the no-JS truth).
 *  M2 in-view groups never arm; below-fold groups do; on intersect mk-in, then unobserved.
 *  M3 a list of 20: only the first 8 items get --mk-i (0..7); the rest land with item 8.
 *  M4 accumulate: the counter steps through the partial sums and ends byte-equal to its HTML.
 *  M5 reduce at init → nothing armed; a flip to reduce mid-run → every armed group mk-done.
 *  M6 matrix pan only when the track overflows; a pointerdown cancels it.
 *  M7 getBoundingClientRect at most once per data-mk element at init, never in an IO callback.
 *  M8 chat: q → thinking → answered, in that order; no chip motion before the answer.
 *  M9 stack: the chapter sits on top (z-index 4) until the group plays, then is hidden.
 *  M10 file: 3 flyers at most; the rest carry mk-rest and leave with the 3rd, which wears '+N'.
 *  M11 focus-push: the ≤ 720 px frame is what scales, never the section; a wider frame gets the accent.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const HTML = readFileSync(join(ROOT, 'scripts/motion-kit-demo/index.html'), 'utf8');
const JS = readFileSync(join(ROOT, 'marketing/assets/motion-kit.js'), 'utf8');
/** The rules outside the motion block (jsdom cascades them; the motion block is the browser's). */
const CSS_STATIC = readFileSync(join(ROOT, 'marketing/assets/motion-kit.css'), 'utf8').split('@media')[0];
const BODY = (HTML.match(/<body>([\s\S]*)<\/body>/) ?? ['', ''])[1].replace(/<script[\s\S]*?<\/script>/g, '');

type IOEntry = { target: Element; isIntersecting: boolean };
let observers: FakeIO[] = [];
class FakeIO {
  cb: (e: IOEntry[]) => void;
  opts: unknown;
  watched = new Set<Element>();
  unobserved: Element[] = [];
  constructor(cb: (e: IOEntry[]) => void, opts: unknown) { this.cb = cb; this.opts = opts; observers.push(this); }
  observe(el: Element) { this.watched.add(el); }
  unobserve(el: Element) { this.watched.delete(el); this.unobserved.push(el); }
  disconnect() { this.watched.clear(); }
}
let reduce = false;
let reduceListeners: ((e: { matches: boolean }) => void)[] = [];
let rectCalls = new Map<Element, number>();
let inIOCallback = false;
let readsInIO = 0;

function setup(opts: { reduce?: boolean; overflow?: boolean; frameW?: number } = {}) {
  document.body.innerHTML = BODY;
  observers = [];
  reduce = !!opts.reduce;
  reduceListeners = [];
  rectCalls = new Map();
  readsInIO = 0;
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
  (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
    matches: q.includes('reduce') ? reduce : q.includes('min-width') ? true : false,
    addEventListener: (_t: string, fn: (e: { matches: boolean }) => void) => { if (q.includes('reduce')) reduceListeners.push(fn); },
  });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    rectCalls.set(this, (rectCalls.get(this) ?? 0) + 1);
    if (inIOCallback) readsInIO += 1;
    const above = this.id === 'above-fold';
    const top = above ? 200 : 2000;
    const width = this.hasAttribute('data-mk-frame') && opts.frameW ? opts.frameW : 600;
    return { top, bottom: top + 100, left: 0, right: width, width, height: 100, x: 0, y: top, toJSON() { return {}; } } as DOMRect;
  });
  const track = document.querySelector('#matrix [data-mk-track]') as HTMLElement;
  Object.defineProperty(track, 'scrollWidth', { configurable: true, value: opts.overflow === false ? 400 : 900 });
  Object.defineProperty(track, 'clientWidth', { configurable: true, value: 400 });
}
const run = () => { new Function('window', 'document', JS)(window, document); };
const io = () => observers.find((o) => (o.opts as { rootMargin?: string }).rootMargin === '0px 0px -10% 0px')!;
function enter(el: Element) {
  inIOCallback = true;
  try { io().cb([{ target: el, isIntersecting: true }]); } finally { inIOCallback = false; }
}
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

describe('marketing motion kit', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); delete (window as unknown as { MageMotion?: unknown }).MageMotion; });

  it('M1 before the script runs nothing carries a kit class', () => {
    setup();
    expect(document.querySelectorAll('[class*="mk-"]')).toHaveLength(0);
  });

  it('M2 in-view groups never arm; below-fold groups arm, play on intersect, then are unobserved', () => {
    setup();
    run();
    expect($('#above-fold').classList.contains('mk-armed')).toBe(false);
    expect(io().watched.has($('#above-fold'))).toBe(false);
    expect($('#list').classList.contains('mk-armed')).toBe(true);
    enter($('#list'));
    expect($('#list').classList.contains('mk-in')).toBe(true);
    expect($('#list').classList.contains('mk-armed')).toBe(false);
    expect(io().unobserved).toContain($('#list'));
    jest.advanceTimersByTime(600);
    expect($('#list').classList.contains('mk-in')).toBe(false);
    expect($('#list').classList.contains('mk-done')).toBe(true);
  });

  it('M3 a list of 20: only the first 8 items get --mk-i (0..7)', () => {
    setup();
    run();
    const items = Array.from(document.querySelectorAll('#list [data-mk-item]')) as HTMLElement[];
    expect(items).toHaveLength(20);
    items.forEach((it, i) => expect(it.style.getPropertyValue('--mk-i')).toBe(i < 8 ? String(i) : ''));
  });

  it('M4 accumulate: the counter steps through the partial sums and ends byte-equal to its HTML', () => {
    setup();
    const counter = $('#accumulate [data-mk-count]');
    const original = counter.innerHTML;
    run();
    enter($('#accumulate'));
    const seen: string[] = [];
    for (let t = 0; t < 900; t += 10) {
      jest.advanceTimersByTime(10);
      if (seen[seen.length - 1] !== counter.textContent) seen.push(counter.textContent ?? '');
    }
    expect(seen.filter((s) => s !== original)).toEqual(['$1,400 protected', '$2,220 protected']);
    expect(seen[seen.length - 1]).toBe(original);
    expect(counter.innerHTML).toBe(original);
  });

  it('M5 reduce at init arms nothing; a flip to reduce mid-run marks every armed group done', () => {
    setup({ reduce: true });
    run();
    expect(document.querySelectorAll('.mk-armed')).toHaveLength(0);
    delete (window as unknown as { MageMotion?: unknown }).MageMotion;

    setup();
    run();
    const armed = Array.from(document.querySelectorAll('.mk-armed'));
    expect(armed.length).toBeGreaterThan(5);
    enter($('#list'));
    reduce = true;
    reduceListeners.forEach((fn) => fn({ matches: true }));
    expect(document.querySelectorAll('.mk-armed, .mk-in')).toHaveLength(0);
    armed.forEach((el) => expect(el.classList.contains('mk-done')).toBe(true));
  });

  it('M6 the matrix pans only when its track overflows, and a pointerdown cancels it', () => {
    setup({ overflow: false });
    run();
    enter($('#matrix'));
    expect($('#matrix [data-mk-track]').classList.contains('mk-pan')).toBe(false);
    jest.restoreAllMocks();

    setup({ overflow: true });
    run();
    enter($('#matrix'));
    const track = $('#matrix [data-mk-track]');
    expect(track.classList.contains('mk-pan')).toBe(true);
    expect(track.style.getPropertyValue('--mk-pan')).toBe('-500px');
    track.dispatchEvent(new Event('pointerdown'));
    expect(track.classList.contains('mk-pan')).toBe(false);
  });

  it('M7 getBoundingClientRect: at most once per data-mk element at init, never inside an IO callback', () => {
    setup();
    run();
    for (const el of Array.from(document.querySelectorAll('[data-mk]'))) expect(rectCalls.get(el) ?? 0).toBeLessThanOrEqual(1);
    const before = [...rectCalls.values()].reduce((a, b) => a + b, 0);
    for (const id of ['#list', '#chat', '#range', '#file', '#priority', '#matrix']) { enter($(id)); jest.advanceTimersByTime(800); }
    expect(readsInIO).toBe(0);
    expect([...rectCalls.values()].reduce((a, b) => a + b, 0)).toBe(before);
  });

  it('M8 chat: q → thinking → answered, in that order; no chip motion before the answer', () => {
    setup();
    run();
    const chat = $('#chat');
    const order: string[] = [];
    const note = () => ['mk-q', 'mk-thinking', 'mk-answered'].forEach((c) => { if (chat.classList.contains(c) && !order.includes(c)) order.push(c); });
    enter(chat);
    note();
    for (let t = 0; t < 1400; t += 10) {
      jest.advanceTimersByTime(10);
      note();
      if (!chat.classList.contains('mk-answered')) {
        // Before the answer the chips are hidden by `.mk-in:not(.mk-answered) [data-mk-chip]`; nothing else is set on them.
        Array.from(chat.querySelectorAll('[data-mk-chip]')).forEach((c) => expect((c as HTMLElement).className).toBe('chip'));
      }
    }
    expect(order).toEqual(['mk-q', 'mk-thinking', 'mk-answered']);
    expect(chat.classList.contains('mk-thinking')).toBe(false);
  });

  it('M9 stack: the chapter is on top until the group plays, then hidden and click-through', () => {
    setup();
    const sheet = document.createElement('style');
    sheet.textContent = CSS_STATIC;
    document.head.appendChild(sheet);
    try {
      run();
      const stack = $('#stack');
      const chapter = $('#stack [data-mk-chapter]');
      expect(stack.classList.contains('mk-armed')).toBe(true);
      expect(stack.classList.contains('mk-stacked')).toBe(true);
      expect(getComputedStyle(chapter).zIndex).toBe('4');
      expect(getComputedStyle(chapter).opacity).not.toBe('0');
      const cards = Array.from(stack.querySelectorAll('[data-mk-card]'));
      expect(cards.map((c) => c.className.split(' ').filter((k) => /^mk-d/.test(k)).join())).toEqual(['mk-d0', 'mk-d1', 'mk-d2']);
      enter(stack);
      expect(stack.classList.contains('mk-in')).toBe(true);
      jest.advanceTimersByTime(500);
      expect(stack.classList.contains('mk-done')).toBe(true);
      expect(getComputedStyle(chapter).opacity).toBe('0');
      expect(getComputedStyle(chapter).pointerEvents).toBe('none');
    } finally {
      sheet.remove();
    }
  });

  it("M10 file: at most 3 flyers; the 4th carries mk-rest and leaves with the 3rd, which wears '+1'", () => {
    setup();
    run();
    const docs = Array.from(document.querySelectorAll('#file [data-mk-doc]')) as HTMLElement[];
    expect(docs).toHaveLength(4);
    expect(docs.map((d) => d.style.getPropertyValue('--mk-i'))).toEqual(['0', '1', '2', '']);
    expect(docs.map((d) => d.classList.contains('mk-rest'))).toEqual([false, false, false, true]);
    expect(docs.map((d) => d.getAttribute('data-mk-more'))).toEqual([null, null, '+1', null]);
    expect(docs[3].style.getPropertyValue('--mk-dx')).toBe('');
    enter($('#file'));
    jest.advanceTimersByTime(119);
    expect($('#file').classList.contains('mk-hand')).toBe(false);
    jest.advanceTimersByTime(1);
    expect($('#file').classList.contains('mk-hand')).toBe(true);
  });

  it('M11 focus-push: the frame scales (never the section); a frame wider than 720 px gets the accent only', () => {
    setup();
    run();
    const group = $('#focus-push');
    const frame = $('#focus-push [data-mk-frame]');
    enter(group);
    expect(group.classList.contains('mk-pushed')).toBe(true);
    expect(frame.style.getPropertyValue('--mk-dx')).not.toBe('');
    expect(group.style.getPropertyValue('--mk-dx')).toBe('');
    jest.restoreAllMocks();
    delete (window as unknown as { MageMotion?: unknown }).MageMotion;

    setup({ frameW: 1100 });
    run();
    enter($('#focus-push'));
    expect($('#focus-push').classList.contains('mk-pushed')).toBe(false);
    expect($('#focus-push [data-mk-focus]').classList.contains('mk-accent')).toBe(true);
  });
});
