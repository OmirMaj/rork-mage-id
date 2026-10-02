/* MAGE ID motion kit (marketing). Numbers copy utils/motion/kit; guard: scripts/validate-motion-kit.ts K5. */
(function (window, document) {
  'use strict';
  function sp(k, d) { return { stiffness: k, damping: d, mass: 1 }; }
  var SPEC = {
    spring: { rise: sp(260, 31), snap: sp(420, 34), glideLead: sp(520, 44), glideTrail: sp(240, 30), sheet: sp(320, 36) },
    ms: { tap: 100, fade: 160, enter: 220, exit: 160, swap: 160, layout: 240, glide: 320, hold: 900, reducedFade: 100, rollOut: 90, rollIn: 140, beatGap: 120, pairLag: 60, tagStagger: 60, priorityAfter: 120, accumulateStep: 70, panMs: 2400, panHoldMs: 800, panBackMs: 1600 },
    stagger: { ms: 35, cap: 8 },
    dist: { rise: 8, roll: 6, tagInset: 12, pairX: 6, depthY: 8, focusLift: 2, rule: 2, sendY: { page: 56, panel: 44 } },
    scale: { from: 0.98, receive: 1.04, depthStep: 0.04, checkFrom: 0.6, flyMin: 0.3, pushMax: 1.06 },
    opacity: { depthStep: 0.2, pushDim: 0.55 },
    caps: { list: 8, matrixRows: 8, accumulate: 6, checkBeats: 4, flyers: 3, tags: 4, stackLayers: 3, chips: 8, screenNodes: 24 },
    web: { easeOut: 'cubic-bezier(0.2, 0, 0, 1)', easeIn: 'cubic-bezier(0.4, 0, 1, 1)', easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    chat: {
      send: { fromY: { page: 56, panel: 44 }, fromScale: 0.98, fadeMs: 120, spring: sp(260, 31) },
      thinking: { delayMs: 140, fadeMs: 160, fromY: 6, stillWorkingAfterMs: 10000, dot: { count: 3, size: 6, gap: 5, periodMs: 1200, riseMs: 360, staggerMs: 160, low: 0.3, high: 1, scaleLow: 0.8, samples: 25, reducedOpacity: 0.6 } },
      thinkingOut: { fadeMs: 120 },
      answer: { delayMs: 60, fadeMs: 220, fromY: 8 },
      chips: { delayMs: 120, staggerMs: 35, fadeMs: 160, cap: 8 },
      sendPress: { scale: 0.92, spring: sp(420, 34) },
      jump: { showAfterPx: 160, fadeMs: 160 },
      reduced: { fadeMs: 100 }
    }
  };
  var MS = SPEC.ms, ST = SPEC.stagger, STEP = 1 / 240, SUB = 4;

  function springAt(t, c, from, to) {
    if (!(t > 0)) return from;
    var e = (t / 1000) / STEP, n = Math.floor(e + 1e-9), s = { x: from, v: 0 }, i, b;
    function frame() {
      for (var j = 0, dt = STEP / SUB; j < SUB; j++) {
        s.v += ((-c.stiffness * (s.x - to) - c.damping * s.v) / c.mass) * dt;
        s.x += s.v * dt;
      }
    }
    for (i = 0; i < n; i++) frame();
    if (e - n <= 1e-9) return s.x;
    b = s.x; frame();
    return b + (s.x - b) * (e - n);
  }
  var CURVES = { out: [0, 0, 0.2, 1], 'in': [0.4, 0, 1, 1], inOut: [0.4, 0, 0.2, 1] };
  function ease(x, kind) {
    var p = CURVES[kind] || CURVES.out, t = x, lo = 0, hi = 1, i;
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    function bz(a, b, u) { return 3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u; }
    for (i = 0; i < 40; i++) { if (bz(p[0], p[2], t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return bz(p[1], p[3], t);
  }
  function stagger(i) { return Math.min(Math.max(0, i | 0), ST.cap - 1) * ST.ms; }
  function sequenceMs(n) { return n >= 1 ? (Math.min(n | 0, ST.cap) - 1) * ST.ms + MS.enter : 0; }

  var api = { spec: SPEC, springAt: springAt, ease: ease, stagger: stagger, sequenceMs: sequenceMs, play: function () {} };
  window.MageMotion = api;
  if (!document || !document.querySelectorAll || typeof window.IntersectionObserver !== 'function') return;

  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduced = !!(mq && mq.matches);
  var running = 0, queue = [], live = [], timers = [];
  function $$(el, sel) { return [].slice.call(el.querySelectorAll(sel)); }
  function on(el, c) { el.classList.add(c); }
  function off(el, c) { el.classList.remove(c); }
  function prop(el, k, v) { el.style.setProperty('--mk-' + k, v); }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

  // All layout reads: one batch per group.
  function measure(el) {
    var r = el.getBoundingClientRect(), t = el.getAttribute('data-mk'), g = { top: r.top, bottom: r.bottom };
    function box(x) { var q = x.getBoundingClientRect(); return { x: q.left - r.left, y: q.top - r.top, w: q.width, h: q.height }; }
    function one(sel) { var x = el.querySelector(sel); return x ? box(x) : null; }
    if (t === 'range') { g.track = one('[data-mk-track]'); g.low = one('[data-mk-low]'); g.high = one('[data-mk-high]'); g.mark = one('[data-mk-mark]'); }
    if (t === 'file') { g.docs = $$(el, '[data-mk-doc]').map(box); g.folder = one('[data-mk-folder]'); }
    if (t === 'focus-push') { g.frame = one('[data-mk-frame]'); g.focus = one('[data-mk-focus]'); }
    if (t === 'focus-sidebar') { g.nav = $$(el, '[data-mk-nav]').map(box); g.marker = one('[data-mk-marker]'); }
    if (t === 'matrix') { var k = el.querySelector('[data-mk-track]'); g.pan = k ? k.scrollWidth - k.clientWidth : 0; }
    return g;
  }

  function prep(el, g) {
    var t = el.getAttribute('data-mk'), c, d;
    function index(sel, cap) {
      $$(el, sel).forEach(function (x, i) { if (i < cap) prop(x, 'i', i); });
    }
    if (t === 'list') index('[data-mk-item]', ST.cap);
    if (t === 'chat') index('[data-mk-chip]', SPEC.chat.chips.cap);
    if (t === 'accumulate') index('[data-mk-card]', SPEC.caps.accumulate);
    if (t === 'priority') index('[data-mk-cell]', ST.cap);
    if (t === 'matrix') index('[data-mk-row]', SPEC.caps.matrixRows);
    if (t === 'file') {
      // 3 flyers at most; the 3rd carries '+N'.
      c = $$(el, '[data-mk-doc]'); d = SPEC.caps.flyers;
      c.forEach(function (x, i) {
        var f = g.folder, b = g.docs && g.docs[i];
        x.classList.toggle('mk-rest', i >= d);
        if (i === d - 1 && c.length > d) x.setAttribute('data-mk-more', '+' + (c.length - d)); else x.removeAttribute('data-mk-more');
        if (i >= d) return;
        prop(x, 'i', i);
        if (!f || !b || !b.w) return;
        prop(x, 'dx', (f.x + f.w / 2 - b.x - b.w / 2) + 'px');
        prop(x, 'dy', (f.y + f.h / 2 - b.y - b.h / 2) + 'px');
        prop(x, 's', Math.max(f.w / b.w, SPEC.scale.flyMin).toFixed(3));
      });
    }
    if (t === 'corner-tags') {
      ['tl', 'tr', 'br', 'bl'].forEach(function (k, i) { var x = el.querySelector('[data-mk-tag="' + k + '"]'); if (x) prop(x, 'i', i); });
    }
    if (t === 'range' && g.track) {
      c = g.track.x + g.track.w / 2;
      [['low', '[data-mk-low]'], ['high', '[data-mk-high]'], ['mark', '[data-mk-mark]']].forEach(function (p) {
        var b = g[p[0]], x = el.querySelector(p[1]);
        if (b && x) prop(x, 'dx', (c - (b.x + b.w / 2)) + 'px');
      });
    }
    if (t === 'focus-push' && g.frame && g.focus) {
      d = SPEC.scale.pushMax; c = el.querySelector('[data-mk-frame]');
      prop(c, 'dx', ((g.frame.w / 2 - (g.focus.x - g.frame.x + g.focus.w / 2)) * d) + 'px');
      prop(c, 'dy', ((g.frame.h / 2 - (g.focus.y - g.frame.y + g.focus.h / 2)) * d) + 'px');
    }
    if (t === 'stack') stack(el, 0);
    if (t === 'matrix' && g.pan > 0) { var k = el.querySelector('[data-mk-track]'); if (k) prop(k, 'pan', (-g.pan) + 'px'); }
  }

  function run(el, g) {
    var t = el.getAttribute('data-mk'), n, x;
    if (t === 'list') return sequenceMs($$(el, '[data-mk-item]').length);
    if (t === 'chat') {
      on(el, 'mk-q');
      later(function () { on(el, 'mk-thinking'); }, SPEC.chat.thinking.delayMs);
      later(function () { on(el, 'mk-answered'); off(el, 'mk-thinking'); }, SPEC.chat.thinking.delayMs + 600);
      n = Math.min($$(el, '[data-mk-chip]').length, SPEC.chat.chips.cap);
      return SPEC.chat.thinking.delayMs + 600 + SPEC.chat.answer.delayMs + Math.max(MS.enter, n ? SPEC.chat.chips.delayMs + (n - 1) * 35 + MS.fade : 0);
    }
    if (t === 'checklist') return checklist(el);
    if (t === 'accumulate') return accumulate(el);
    if (t === 'range') return 400;
    if (t === 'file') { later(function () { on(el, 'mk-filed'); }, 0); later(function () { on(el, 'mk-hand'); }, 2 * MS.pairLag); return 270 + 2 * MS.pairLag + 360; }
    if (t === 'priority') {
      n = sequenceMs($$(el, '[data-mk-cell]').length) + MS.priorityAfter;
      x = el.querySelector('[data-mk-priority]');
      if (x) later(function () { on(x, 'mk-prio'); }, n);
      return n + 520;
    }
    if (t === 'stack') return 400;
    if (t === 'focus-push') {
      x = el.querySelector('[data-mk-focus]');
      if (g.frame && g.frame.w <= 720 && g.frame.h <= 720) { on(el, 'mk-pushed'); $$(el, '[data-mk-frame] > *').forEach(function (c) { if (c !== x && !c.contains(x)) on(c, 'mk-dim'); }); } else if (x) on(x, 'mk-accent');
      return 600;
    }
    if (t === 'corner-tags') return 3 * MS.tagStagger + MS.enter;
    if (t === 'matrix') { if (g.pan > 0) pan(el); return sequenceMs(Math.min($$(el, '[data-mk-row]').length, 8)) + MS.pairLag; }
    return MS.enter;
  }

  function checklist(el) {
    var rows = $$(el, '[data-mk-row]'), sync = el.getAttribute('data-mk-sync'), v = sync && document.querySelector(sync), next = 0, burst = 0;
    function tick(r) {
      var now = Date.now(), at;
      if (now > next) { burst = 0; next = now; }
      at = next; burst++;
      if (burst < SPEC.caps.checkBeats) next += MS.beatGap;
      later(function () { on(r, 'mk-tick'); }, at - now);
    }
    if (v && v.addEventListener) {
      on(el, 'mk-sync');
      var left = rows.slice();
      var check = function () {
        left = left.filter(function (r) { var due = v.currentTime >= parseFloat(r.getAttribute('data-mk-at') || '0'); if (due) tick(r); return !due; });
        if (left.length) watch();
      };
      var watch = function () { if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(check); else v.addEventListener('timeupdate', check, { once: true }); };
      watch();
      return 0;
    }
    rows.forEach(function (r, i) { later(function () { on(r, 'mk-tick'); }, Math.min(i, SPEC.caps.checkBeats - 1) * MS.beatGap); });
    return Math.min(rows.length - 1, 3) * MS.beatGap + 180;
  }

  function accumulate(el) {
    var cards = $$(el, '[data-mk-card]'), out = el.querySelector('[data-mk-count]'), badge = el.querySelector('[data-mk-badge]');
    var orig = out ? out.textContent : '', m = orig.match(/\d[\d,]*(\.\d+)?/), sum = 0, sums = [], cap = SPEC.caps.accumulate, k = 0;
    cards.forEach(function (c) { sum += Math.round(parseFloat(c.getAttribute('data-mk-cents')) || 0); sums.push(sum); });
    if (sums.length > cap) sums = sums.slice(0, cap - 1).concat(sums[sums.length - 1]);
    function text(cents, last) {
      if (last || !m) return orig;
      var dec = m[1] ? m[1].length - 1 : 0;
      return orig.slice(0, m.index) + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + orig.slice(m.index + m[0].length);
    }
    sums.forEach(function (s, i) {
      later(function () {
        if (!out) return;
        out.textContent = text(s, i === sums.length - 1);
        on(el, 'mk-c');
        off(out, k % 2 ? 'mk-roll-b' : 'mk-roll-a');
        on(out, k % 2 ? 'mk-roll-a' : 'mk-roll-b');
        k++;
      }, i * MS.accumulateStep + 110);
    });
    var end = Math.max(0, sums.length - 1) * MS.accumulateStep + 110;
    if (badge) prop(badge, 'd', (end + MS.priorityAfter) + 'ms');
    return end + MS.priorityAfter + 280;
  }

  function stack(el, i) {
    var cards = $$(el, '[data-mk-card]');
    on(el, 'mk-stacked');
    cards.forEach(function (c, j) {
      ['mk-d0', 'mk-d1', 'mk-d2', 'mk-dn', 'mk-gone'].forEach(function (k) { off(c, k); });
      on(c, j < i ? 'mk-gone' : j - i < 3 ? 'mk-d' + (j - i) : 'mk-dn');
    });
    if (!el.__mkNext) {
      el.__mkNext = 1;
      $$(el, '[data-mk-next]').forEach(function (b) {
        b.addEventListener('click', function () { el.__mkI = ((el.__mkI || 0) + 1) % Math.max(1, cards.length); stack(el, el.__mkI); });
      });
    }
    return 280;
  }

  function pan(el) {
    var k = el.querySelector('[data-mk-track]');
    if (!k) return;
    function stop() { off(k, 'mk-pan'); ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(function (e) { k.removeEventListener(e, stop); }); }
    ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(function (e) { k.addEventListener(e, stop, { passive: true }); });
    on(k, 'mk-pan');
    later(stop, MS.panMs + MS.panHoldMs + MS.panBackMs);
  }

  function start(el) {
    if (reduced) return;
    if (running >= 2) { queue.push(el); return; }
    running++;
    off(el, 'mk-armed'); off(el, 'mk-done'); on(el, 'mk-in'); on(el, 'mk-run');
    later(function () {
      off(el, 'mk-run'); off(el, 'mk-in'); on(el, 'mk-done');
      running--;
      if (queue.length) start(queue.shift());
    }, run(el, el.__mk || {}));
  }

  var io = new window.IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); start(e.target); } });
  }, { threshold: 0, rootMargin: '0px 0px -20% 0px' });

  function sidebar(el, g) {
    var marker = el.querySelector('[data-mk-marker]'), navs = $$(el, '[data-mk-nav]');
    if (!marker || !g.marker || !window.matchMedia || !window.matchMedia('(min-width: 1024px)').matches) return;
    var spy = new window.IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        navs.forEach(function (n, i) {
          var b = el.__mk.nav[i];
          if (b && (n.getAttribute('data-mk-nav') || (n.getAttribute('href') || '').slice(1)) === e.target.id) {
            prop(marker, 'y', (b.y - el.__mk.marker.y) + 'px');
            prop(marker, 'sy', (b.h / (el.__mk.marker.h || b.h)).toFixed(3));
          }
        });
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    $$(document, '[data-mk-section]').forEach(function (s) { spy.observe(s); });
  }

  function init() {
    var els = $$(document, '[data-mk]'), vh = window.innerHeight || 0, gs;
    if (reduced) return;
    gs = els.map(measure);
    els.forEach(function (el, i) {
      var g = gs[i];
      el.__mk = g;
      if (el.getAttribute('data-mk') === 'focus-sidebar') { sidebar(el, g); return; }
      if (g.top < vh && g.bottom > 0) return;
      prep(el, g);
      on(el, 'mk-armed');
      live.push(el);
      io.observe(el);
    });
    if (window.ResizeObserver) {
      var seen = [];
      var ro = new window.ResizeObserver(function (entries) {
        entries.forEach(function (e) {
          var el = e.target;
          if (seen.indexOf(el) < 0) { seen.push(el); return; }
          if (el.classList.contains('mk-armed')) { el.__mk = measure(el); prep(el, el.__mk); }
        });
      });
      live.forEach(function (el) { ro.observe(el); });
    }
  }

  function onReduce(e) {
    reduced = !!e.matches;
    if (!reduced) return;
    io.disconnect();
    timers.forEach(clearTimeout);
    timers = []; queue = []; running = 0;
    live.forEach(function (el) {
      ['mk-armed', 'mk-in', 'mk-run', 'mk-q', 'mk-thinking', 'mk-stacked'].forEach(function (k) { off(el, k); });
      on(el, 'mk-done');
    });
  }
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', onReduce); else if (mq.addListener) mq.addListener(onReduce); }

  api.play = function (el) {
    if (!el || reduced || !el.getAttribute) return;
    el.__mk = measure(el);
    prep(el, el.__mk);
    ['mk-done', 'mk-q', 'mk-thinking', 'mk-answered', 'mk-c', 'mk-filed', 'mk-hand'].forEach(function (k) { off(el, k); });
    if (live.indexOf(el) < 0) live.push(el);
    start(el);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, window.document);
