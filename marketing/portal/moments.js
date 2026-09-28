/*
 * moments.js: the client portal's signing line (wave-next W3, lane MOMPORTAL).
 *
 * A vanilla port of the app's line skin (components/moments/signing/*): one
 * MomentLine class and one sealResult() that both signing paths draw with.
 * No dependencies. Loaded by marketing/portal/index.html before its own
 * script; the page works without it (every caller falls back to a plain
 * button and a plain note), so a failed load never blocks a signature.
 *
 * THE RULES THIS FILE KEEPS (scripts/moments-checks/portal.ts pins them):
 *  - Every spring, timing and gesture number below is a COPY of
 *    utils/moments/motionSpec.ts and utils/moments/signTimeline.ts. The check
 *    loads both and fails on any drift.
 *  - The spring solver steps at a fixed 1/240 s whatever the frame rate.
 *  - Only transform and opacity move (plus the seal's stroke-dashoffset, which
 *    is how an SVG arc is drawn).
 *  - The seal appears only when the caller's commit resolves
 *    { status: 'confirmed' }: the caller decides that from the server's
 *    answer, never from the gesture.
 *  - No "MAGE ID" on the seal: it is the signer's record, not our brand.
 *  - Every sentence comes from the page (opts.strings / opts.label): this
 *    file holds no copy of its own.
 *  - prefers-reduced-motion: positions jump behind short cross-fades
 *    (moments.css carries the media query).
 */
(function (root) {
  'use strict';

  // ── numbers (copied; portal.ts compares them with the app's) ─────────────
  // utils/moments/motionSpec.ts MOMENT_SPRING
  var SPRING = {
    snapBack: { stiffness: 380, damping: 39, mass: 1 },
    dock: { stiffness: 420, damping: 34, mass: 1 },
    contractTrail: { stiffness: 240, damping: 30, mass: 1 },
    expand: { stiffness: 260, damping: 31, mass: 1 },
    homeLead: { stiffness: 520, damping: 44, mass: 1 },
    homeTrail: { stiffness: 200, damping: 28, mass: 1 },
    settle: { stiffness: 300, damping: 35, mass: 1 },
    headScale: { stiffness: 420, damping: 34, mass: 1 },
    sealX: { stiffness: 200, damping: 27, mass: 1 },
    sealY: { stiffness: 320, damping: 35, mass: 1 },
    press: { stiffness: 600, damping: 44, mass: 1 }
  };
  // utils/moments/motionSpec.ts MOMENT_TIMING (the keys this port uses)
  var TIMING = {
    minBusy: 500, holdFill: 700, holdMs: 1200, resultIn: 160, labelOut: 120,
    failHomeLeadAt: 480, reasonIn: 200, reasonOut: 140,
    reducedFade: 100, reducedHold: 200, reducedFailHold: 700
  };
  // utils/moments/motionSpec.ts CAPSULE_RULES (the keys this port uses)
  var RULES = {
    threshold: 0.85, unlockHysteresis: 0.07,
    flickMinProgress: 0.55, flickMinVx: 900, flickProjectionS: 0.099,
    hitSlop: 12, rubberStart: 12, rubberEnd: 14,
    resistKnee: 24, resistA: 0.45, grabScale: 1.04, lockScale: 1.07
  };
  // utils/moments/motionSpec.ts CAPSULE_GEOMETRY.line
  var GEOMETRY = { H: 56, D: 40, inset: 20 };
  // utils/moments/signTimeline.ts SEAL_TIMING (the keys this port uses) + LINE_GEOMETRY.seal
  var SEAL = {
    ringAt: 200, arcDraw: 360, checkShortAt: 160, checkShort: 110, checkLongAt: 270, checkLong: 170,
    closeCheckShortAt: 640, closeCheckLongAt: 750, bindingAt: 920, chipFade: 160,
    recordAt: 760, recordIn: 160, rmTone: 200
  };
  var SEAL_BOX = 64;
  var SEAL_R = 30.6;
  var SEAL_STROKE = 1.5;
  /** The fixed solver step, in seconds. */
  var STEP = 1 / 240;
  /** A tap (or an assistive-tech activation) arms a second, confirming tap for this long. */
  var ARM_MS = 5000;

  // ── pure maths (portal.ts executes these against utils/moments/capsuleMath.ts) ──
  var K = RULES.resistKnee;
  var A = RULES.resistA;
  var U = 1 - A;
  var B = (2 * U) / K;
  var C = -U / (K * K);

  /** A rubber band that approaches dim and never reaches it. */
  function rubber(x, dim) {
    var a = Math.abs(x);
    if (a === 0) return 0;
    return (x < 0 ? -1 : 1) * (a * dim * 0.55) / (dim + 0.55 * a);
  }
  /** Finger travel -> head travel: rubber below 0, the start cubic to the knee, 1:1, rubber past T. */
  function resist(x, T) {
    if (x < 0) return rubber(x, RULES.rubberStart);
    if (x < K) return A * x + B * x * x + C * x * x * x;
    if (x <= T) return x;
    return T + rubber(x - T, RULES.rubberEnd);
  }
  /** Lock at the threshold; once locked, unlock only below threshold minus the hysteresis. */
  function lockStep(locked, p, threshold) {
    if (!locked && p >= threshold) return true;
    if (locked && p < threshold - RULES.unlockHysteresis) return false;
    return locked;
  }
  /** Release: locked, or a flick from past 55% whose projection reaches the end. */
  function shouldCommit(a) {
    if (a.locked) return true;
    return a.progress >= RULES.flickMinProgress
      && a.vx >= RULES.flickMinVx
      && a.f + a.vx * RULES.flickProjectionS >= a.T;
  }
  /** One semi-implicit Euler step of a damped spring toward `to`. */
  function springStep(st, cfg, to, dt) {
    var acc = (-cfg.stiffness * (st.x - to) - cfg.damping * st.v) / cfg.mass;
    st.v += acc * dt;
    st.x += st.v * dt;
  }
  function springAtRest(st, to) {
    return Math.abs(st.x - to) < 0.05 && Math.abs(st.v) < 0.5;
  }
  /** The whole curve at the fixed step, for the check: { steps, peak, x } after at most maxS seconds. */
  function simulateSpring(cfg, from, to, v0, maxS) {
    var st = { x: from, v: v0 || 0 };
    var steps = 0;
    var peak = from;
    var limit = Math.round((maxS || 3) / STEP);
    while (steps < limit && !springAtRest(st, to)) {
      springStep(st, cfg, to, STEP);
      steps++;
      if (to >= from ? st.x > peak : st.x < peak) peak = st.x;
    }
    return { steps: steps, peak: peak, x: st.x, settled: springAtRest(st, to) };
  }

  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (_e) { return false; }
  }
  function raf(fn) {
    return (root.requestAnimationFrame || function (f) { return setTimeout(function () { f(Date.now()); }, 16); })(fn);
  }
  function cancelRaf(id) {
    (root.cancelAnimationFrame || clearTimeout)(id);
  }
  function now() {
    return (root.performance && root.performance.now) ? root.performance.now() : Date.now();
  }
  function el(doc, tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(doc, tag, attrs) {
    var n = doc.createElementNS(SVGNS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  /**
   * "Recorded {date}, {time} (server time)." from a server timestamp, or null.
   * The template comes from the page; this only fills the two placeholders.
   * Never called with a device clock: the caller passes the time the server
   * stored (a snapshot's signed-at, an RPC's sealed_at).
   */
  function formatRecorded(iso, template) {
    if (!iso || !template) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return String(template).replace('{date}', function () { return date; }).replace('{time}', function () { return time; });
  }

  /**
   * The seal: two half arcs (top = the contractor's, bottom = the signer's)
   * drawn with stroke-dashoffset, a check, a chip, the record line.
   *   opts.label           the record sentence ("Signed. This contract is binding.")
   *   opts.chip            the chip word ("Binding", "APPROVED", "ACCEPTED")
   *   opts.closing         true: the top arc is already drawn and this signature
   *                        closes the ring (a two-party contract); false: both
   *                        arcs draw at once (a one-party record)
   *   opts.recordedAt      the SERVER's timestamp, or null (then no Recorded line)
   *   opts.recordedTemplate the page's "Recorded {date}, {time} (server time)."
   *   opts.animate         false draws the final state at once
   * Returns the seal element.
   */
  function sealResult(host, opts) {
    opts = opts || {};
    var doc = host.ownerDocument || root.document;
    var closing = !!opts.closing;
    // play: the arcs draw; rm (Reduce Motion): the finished seal fades in; static: drawn at once.
    var mode = opts.animate === false ? 'static' : (reducedMotion() ? 'rm' : 'play');
    var seal = el(doc, 'div', 'mp-seal mp-' + mode);
    seal.setAttribute('data-moment-seal', closing ? 'closing' : 'single');
    var ring = svg(doc, 'svg', {
      'class': 'mp-seal-ring', viewBox: '0 0 ' + SEAL_BOX + ' ' + SEAL_BOX,
      width: String(SEAL_BOX), height: String(SEAL_BOX), 'aria-hidden': 'true', focusable: 'false'
    });
    var c = SEAL_BOX / 2;
    var left = (c - SEAL_R).toFixed(2);
    var right = (c + SEAL_R).toFixed(2);
    var half = (Math.PI * SEAL_R).toFixed(2);
    // Top arc: 9 o'clock over 12 to 3. Bottom arc: 3 under 6 back to 9.
    var top = svg(doc, 'path', {
      'class': 'mp-arc mp-arc-top' + (closing ? '' : ' mp-draw'),
      d: 'M ' + left + ' ' + c + ' A ' + SEAL_R + ' ' + SEAL_R + ' 0 0 1 ' + right + ' ' + c,
      'stroke-width': String(SEAL_STROKE)
    });
    var bottom = svg(doc, 'path', {
      'class': 'mp-arc mp-arc-bottom mp-draw',
      d: 'M ' + right + ' ' + c + ' A ' + SEAL_R + ' ' + SEAL_R + ' 0 0 1 ' + left + ' ' + c,
      'stroke-width': String(SEAL_STROKE)
    });
    var check = svg(doc, 'polyline', { 'class': 'mp-check', points: '22,33 29,40 43,25' });
    [top, bottom].forEach(function (p) {
      p.style.strokeDasharray = half;
      p.style.setProperty('--mp-len', half);
    });
    check.style.strokeDasharray = '31';
    check.style.setProperty('--mp-len', '31');
    ring.appendChild(top);
    ring.appendChild(bottom);
    ring.appendChild(check);

    var text = el(doc, 'div', 'mp-seal-text');
    if (opts.chip) text.appendChild(el(doc, 'span', 'mp-chip', opts.chip));
    if (opts.label) text.appendChild(el(doc, 'p', 'mp-seal-title', opts.label));
    var recorded = formatRecorded(opts.recordedAt, opts.recordedTemplate);
    var rec = el(doc, 'p', 'mp-seal-record', recorded || '');
    rec.setAttribute('data-moment-recorded', recorded ? '1' : '0');
    if (!recorded) rec.hidden = true;
    text.appendChild(rec);

    seal.appendChild(ring);
    seal.appendChild(text);

    // Timeline (ms after the confirmed answer), the app's numbers.
    var arcAt = SEAL.ringAt;
    var checkShort = closing ? SEAL.closeCheckShortAt : SEAL.checkShortAt;
    var chipAt = closing ? SEAL.bindingAt : SEAL.checkLongAt + SEAL.checkLong;
    bottom.style.setProperty('--mp-at', arcAt + 'ms');
    top.style.setProperty('--mp-at', arcAt + 'ms');
    check.style.setProperty('--mp-at', checkShort + 'ms');
    check.style.setProperty('--mp-dur', (SEAL.checkShort + SEAL.checkLong) + 'ms');
    text.style.setProperty('--mp-chip-at', chipAt + 'ms');
    text.style.setProperty('--mp-record-at', SEAL.recordAt + 'ms');
    seal.style.setProperty('--mp-arc', SEAL.arcDraw + 'ms');
    seal.style.setProperty('--mp-fade', SEAL.chipFade + 'ms');

    host.textContent = '';
    host.appendChild(seal);
    return seal;
  }
  /** Fill the Recorded line of a seal already on screen (the snapshot caught up). */
  function sealRecorded(seal, iso, template) {
    if (!seal) return false;
    var rec = seal.querySelector('.mp-seal-record');
    var line = formatRecorded(iso, template);
    if (!rec || !line) return false;
    rec.textContent = line;
    rec.hidden = false;
    rec.setAttribute('data-moment-recorded', '1');
    return true;
  }

  // ── the line ──────────────────────────────────────────────────────────────
  var uid = 0;

  /**
   * new MomentLine(host, opts)
   *   opts.label          what the line says ("Slide along the line to approve · +$4,200.00")
   *   opts.strings        { hint, armed, busy, cancelled, noAnswer } whole sentences from the page
   *   opts.disabledReason why the line is locked, or null
   *   opts.onCommit       () => Promise<result>; the ONLY place a result comes from.
   *                       result: { status: 'confirmed', seal: {sealResult opts} }
   *                             | { status: 'refused', reason, final? }
   *                             | { status: 'timeout', reason }
   *                       A rejected promise reads as timeout with strings.noAnswer.
   *   opts.onDone         (result) => void, after the result has been on screen
   *   opts.onBusy         (busy:boolean) => void
   */
  function MomentLine(host, opts) {
    if (!(this instanceof MomentLine)) return new MomentLine(host, opts);
    this.host = host;
    this.doc = host.ownerDocument || root.document;
    this.opts = opts || {};
    this.strings = this.opts.strings || {};
    this.state = 'idle';
    this.x = 0;
    this.scale = 1;
    this.locked = false;
    this.springs = {};
    this.frame = null;
    this.drag = null;
    this.hold = null;
    this.armTimer = null;
    this.timers = [];
    this.id = 'mp-line-' + (++uid);
    this.build();
    this.bind();
    this.setDisabledReason(this.opts.disabledReason || null);
  }

  MomentLine.prototype.build = function () {
    var d = this.doc;
    var wrap = el(d, 'div', 'mp-line');
    wrap.setAttribute('data-moment-line', '1');
    wrap.setAttribute('data-state', 'idle');
    var zone = el(d, 'div', 'mp-zone');
    var groove = el(d, 'span', 'mp-groove');
    groove.setAttribute('aria-hidden', 'true');
    var fill = el(d, 'span', 'mp-fill');
    groove.appendChild(fill);
    var head = el(d, 'button', 'mp-head');
    head.type = 'button';
    head.setAttribute('aria-describedby', this.id + '-hint ' + this.id + '-row');
    head.setAttribute('aria-label', this.opts.label || '');
    var chev = svg(d, 'svg', { 'class': 'mp-chev', viewBox: '0 0 24 24', width: '18', height: '18', 'aria-hidden': 'true', focusable: 'false' });
    chev.appendChild(svg(d, 'polyline', { points: '9 6 15 12 9 18' }));
    var spin = svg(d, 'svg', { 'class': 'mp-spin', viewBox: '0 0 40 40', width: '40', height: '40', 'aria-hidden': 'true', focusable: 'false' });
    spin.appendChild(svg(d, 'circle', { cx: '20', cy: '20', r: '13', 'stroke-dasharray': '20 62' }));
    head.appendChild(chev);
    head.appendChild(spin);
    zone.appendChild(groove);
    zone.appendChild(head);

    var row = el(d, 'div', 'mp-row');
    row.id = this.id + '-row';
    var label = el(d, 'span', 'mp-label', this.opts.label || '');
    var reason = el(d, 'span', 'mp-reason');
    reason.setAttribute('data-moment-reason', '1');
    row.appendChild(label);
    row.appendChild(reason);

    var hint = el(d, 'span', 'mp-sr', this.strings.hint || '');
    hint.id = this.id + '-hint';
    var live = el(d, 'span', 'mp-sr');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    var result = el(d, 'div', 'mp-result');
    result.setAttribute('data-moment-result', '1');

    wrap.appendChild(zone);
    wrap.appendChild(row);
    wrap.appendChild(hint);
    wrap.appendChild(live);
    wrap.appendChild(result);
    this.host.textContent = '';
    this.host.appendChild(wrap);
    this.el = { wrap: wrap, zone: zone, groove: groove, fill: fill, head: head, row: row, label: label, reason: reason, live: live, result: result };
  };

  MomentLine.prototype.T = function () {
    var w = this.el.zone.getBoundingClientRect().width || this.el.zone.clientWidth || 0;
    return Math.max(1, w - GEOMETRY.D);
  };

  MomentLine.prototype.setState = function (s) {
    this.state = s;
    this.el.wrap.setAttribute('data-state', s);
  };
  MomentLine.prototype.announce = function (text) {
    if (!text) return;
    var live = this.el.live;
    live.textContent = '';
    this.later(function () { live.textContent = text; }, 30);
  };
  MomentLine.prototype.later = function (fn, ms) {
    var t = setTimeout(fn, ms);
    this.timers.push(t);
    return t;
  };
  MomentLine.prototype.showReason = function (text, tone) {
    var r = this.el.reason;
    r.textContent = text || '';
    r.setAttribute('data-tone', tone || 'neutral');
    this.el.row.setAttribute('data-show', text ? 'reason' : 'label');
  };

  MomentLine.prototype.paint = function () {
    var T = this.T();
    var p = Math.max(0, Math.min(1, this.x / T));
    this.el.head.style.transform = 'translateX(' + this.x.toFixed(2) + 'px) scale(' + this.scale.toFixed(4) + ')';
    this.el.fill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    this.el.label.style.opacity = String(Math.max(0, 1 - p * 1.6).toFixed(3));
  };

  /** Spring a channel ('x' or 'scale') to `to`, carrying velocity v0. Reduced motion jumps. */
  MomentLine.prototype.spring = function (key, cfg, to, v0, done) {
    var self = this;
    if (reducedMotion()) {
      // No travel: the head fades out, moves, fades back in (moments.css).
      delete this.springs[key];
      if (key !== 'x') { this[key] = 1; this.paint(); if (done) done(); return; }
      var head = this.el.head;
      head.style.opacity = '0';
      this.later(function () {
        self[key] = to;
        self.paint();
        head.style.opacity = '';
        if (done) done();
      }, TIMING.reducedFade);
      return;
    }
    this.springs[key] = { st: { x: this[key], v: v0 || 0 }, cfg: cfg, to: to, done: done || null };
    if (this.frame != null) return;
    var last = null;
    var acc = 0;
    var tick = function (ts) {
      var t = typeof ts === 'number' ? ts : now();
      if (last == null) last = t;
      acc += Math.min(0.064, Math.max(0, (t - last) / 1000));
      last = t;
      var finished = [];
      var active = 0;
      for (var k in self.springs) {
        if (!Object.prototype.hasOwnProperty.call(self.springs, k)) continue;
        var s = self.springs[k];
        var a = acc;
        while (a >= STEP) { springStep(s.st, s.cfg, s.to, STEP); a -= STEP; }
        if (springAtRest(s.st, s.to)) { s.st.x = s.to; finished.push(k); } else active++;
        self[k] = s.st.x;
      }
      acc = acc % STEP;
      self.paint();
      finished.forEach(function (k) {
        var s = self.springs[k];
        delete self.springs[k];
        if (s && s.done) s.done();
      });
      if (active > 0 || Object.keys(self.springs).length) self.frame = raf(tick);
      else self.frame = null;
    };
    this.frame = raf(tick);
  };
  MomentLine.prototype.stopSprings = function () {
    this.springs = {};
    if (this.frame != null) { cancelRaf(this.frame); this.frame = null; }
  };

  MomentLine.prototype.interactive = function () {
    return this.state === 'idle' || this.state === 'armed' || this.state === 'refused';
  };

  MomentLine.prototype.bind = function () {
    var self = this;
    var head = this.el.head;
    this.handlers = {
      down: function (e) { self.onDown(e); },
      move: function (e) { self.onMove(e); },
      up: function (e) { self.onUp(e); },
      click: function (e) { self.onClick(e); },
      keydown: function (e) { self.onKeyDown(e); },
      keyup: function (e) { self.onKeyUp(e); },
      blur: function () { if (self.state === 'holding') self.cancel(); }
    };
    head.addEventListener('pointerdown', this.handlers.down);
    head.addEventListener('pointermove', this.handlers.move);
    head.addEventListener('pointerup', this.handlers.up);
    head.addEventListener('pointercancel', this.handlers.up);
    head.addEventListener('click', this.handlers.click);
    head.addEventListener('keydown', this.handlers.keydown);
    head.addEventListener('keyup', this.handlers.keyup);
    head.addEventListener('blur', this.handlers.blur);
  };

  MomentLine.prototype.onDown = function (e) {
    if (!this.interactive()) return;
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    try { this.el.head.setPointerCapture(e.pointerId); } catch (_err) { /* old browser: moves still reach the head */ }
    this.stopSprings();
    this.disarm();
    if (this.state === 'refused') this.showReason('', null);
    this.drag = { id: e.pointerId, startX: e.clientX, x0: this.x, moved: false, samples: [[now(), e.clientX]] };
    this.locked = false;
    this.setState('dragging');
    this.spring('scale', SPRING.headScale, RULES.grabScale, 0);
  };
  MomentLine.prototype.onMove = function (e) {
    var dg = this.drag;
    if (!dg || this.state !== 'dragging') return;
    var dx = e.clientX - dg.startX;
    if (Math.abs(dx) > 8) dg.moved = true;
    var T = this.T();
    var x = resist(dg.x0 + dx, T);
    var wasLocked = this.locked;
    this.locked = lockStep(this.locked, x / T, RULES.threshold);
    if (this.locked !== wasLocked) this.spring('scale', SPRING.headScale, this.locked ? RULES.lockScale : RULES.grabScale, 0);
    this.x = x;
    dg.samples.push([now(), e.clientX]);
    if (dg.samples.length > 6) dg.samples.shift();
    if (this.frame == null) this.paint();
  };
  MomentLine.prototype.onUp = function (e) {
    var dg = this.drag;
    if (!dg || (e && dg.id != null && e.pointerId != null && e.pointerId !== dg.id)) return;
    this.drag = null;
    try { this.el.head.releasePointerCapture(dg.id); } catch (_err) { /* already released */ }
    if (!dg.moved) {
      // A tap, not a slide: the click that follows arms the confirming tap.
      this.setState('idle');
      this.spring('scale', SPRING.headScale, 1, 0);
      this.spring('x', SPRING.snapBack, 0, 0);
      return;
    }
    this.suppressClick = true;
    var self = this;
    setTimeout(function () { self.suppressClick = false; }, 0);
    var s = dg.samples;
    var a = s[0];
    var b = s[s.length - 1];
    var dt = (b[0] - a[0]) / 1000;
    var vx = dt > 0 ? (b[1] - a[1]) / dt : 0;
    var T = this.T();
    var go = shouldCommit({ locked: this.locked, progress: this.x / T, vx: vx, f: this.x, T: T });
    this.spring('scale', SPRING.headScale, 1, 0);
    if (go) {
      this.commit(vx);
    } else {
      this.setState('idle');
      this.spring('x', SPRING.snapBack, 0, vx);
    }
  };
  MomentLine.prototype.onClick = function (e) {
    if (this.suppressClick) { e.preventDefault(); return; }
    if (!this.interactive()) return;
    e.preventDefault();
    if (this.state === 'armed') { this.disarm(); this.commit(0); return; }
    // Screen readers and switch access activate with a click; so does a tap
    // that never moved. Both get the two-step confirm the app uses.
    this.setState('armed');
    this.showReason(this.strings.armed || '', 'neutral');
    this.announce(this.strings.armed || '');
    var self = this;
    this.armTimer = setTimeout(function () {
      if (self.state === 'armed') { self.setState('idle'); self.showReason('', null); }
    }, ARM_MS);
  };
  MomentLine.prototype.disarm = function () {
    if (this.armTimer) { clearTimeout(this.armTimer); this.armTimer = null; }
  };
  MomentLine.prototype.onKeyDown = function (e) {
    var key = e.key;
    if (key === 'Escape' || key === 'Esc') {
      if (this.state === 'holding' || this.state === 'armed' || this.state === 'dragging') {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
      }
      return;
    }
    if (key !== ' ' && key !== 'Spacebar' && key !== 'Enter') return;
    e.preventDefault();
    if (e.repeat || !this.interactive() || this.state === 'armed') {
      if (this.state === 'armed' && !e.repeat) { this.disarm(); this.commit(0); }
      return;
    }
    this.startHold();
  };
  MomentLine.prototype.onKeyUp = function (e) {
    var key = e.key;
    if (key !== ' ' && key !== 'Spacebar' && key !== 'Enter') return;
    e.preventDefault();
    if (this.state === 'holding') this.cancel();
  };
  /** Press and hold Space or Enter: the head travels the line in holdFill ms; letting go early cancels. */
  MomentLine.prototype.startHold = function () {
    var self = this;
    this.stopSprings();
    if (this.state === 'refused') this.showReason('', null);
    this.setState('holding');
    var start = now();
    var T = this.T();
    var step = function () {
      if (self.state !== 'holding') return;
      var p = Math.min(1, (now() - start) / TIMING.holdFill);
      self.x = T * p;
      self.paint();
      if (p >= 1) { self.hold = null; self.commit(0); return; }
      self.hold = raf(step);
    };
    this.hold = raf(step);
  };
  /** Esc, an early key-up, or a blur: back to the start, nothing sent. */
  MomentLine.prototype.cancel = function () {
    if (this.hold != null) { cancelRaf(this.hold); this.hold = null; }
    this.disarm();
    this.drag = null;
    var wasArmed = this.state === 'armed';
    this.setState('idle');
    this.showReason('', null);
    this.spring('scale', SPRING.headScale, 1, 0);
    this.spring('x', SPRING.snapBack, 0, 0);
    if (!wasArmed) this.announce(this.strings.cancelled || '');
  };

  /** The one path to a write: dock the head, run onCommit, show what the server said. */
  MomentLine.prototype.commit = function (vx) {
    if (!this.interactive() && this.state !== 'dragging' && this.state !== 'holding') return;
    var self = this;
    this.disarm();
    this.setState('busy');
    this.showReason(this.strings.busy || '', 'neutral');
    this.announce(this.strings.busy || '');
    this.el.head.setAttribute('aria-busy', 'true');
    if (this.opts.onBusy) this.opts.onBusy(true);
    this.spring('x', SPRING.dock, this.T(), vx || 0);
    var started = now();
    var done = false;
    var finish = function (res) {
      if (done) return;
      done = true;
      var wait = Math.max(0, TIMING.minBusy - (now() - started));
      self.later(function () { self.result(res); }, wait);
    };
    var p;
    try { p = this.opts.onCommit ? this.opts.onCommit() : null; } catch (_err) { p = null; }
    Promise.resolve(p).then(function (res) {
      finish(res && typeof res === 'object' ? res : { status: 'timeout', reason: self.strings.noAnswer || '' });
    }, function () {
      finish({ status: 'timeout', reason: self.strings.noAnswer || '' });
    });
  };

  MomentLine.prototype.result = function (res) {
    var self = this;
    this.el.head.removeAttribute('aria-busy');
    if (this.opts.onBusy) this.opts.onBusy(false);
    if (res.status === 'confirmed') {
      this.setState('confirmed');
      this.showReason('', null);
      var seal = sealResult(this.el.result, res.seal || {});
      this.sealEl = seal;
      var said = (res.seal && res.seal.label) || '';
      this.announce(said);
      var hold = reducedMotion() ? TIMING.reducedHold + TIMING.holdMs : TIMING.holdMs;
      this.later(function () { if (self.opts.onDone) self.opts.onDone(res); }, hold);
      return;
    }
    // refused / timeout: the head goes home, the reason stays under the line.
    var reason = res.reason || this.strings.noAnswer || '';
    var locked = res.status === 'timeout' || res.final === true;
    this.setState(locked ? 'failing' : 'refused');
    this.showReason(reason, 'error');
    this.announce(reason);
    var home = function () {
      self.spring('x', SPRING.homeTrail, 0, 0, function () {
        // A timeout or a final refusal locks the line: trying again could
        // double a write the server may already hold.
        if (locked) self.lock(reason, res.status === 'timeout' ? 'timeout' : 'final');
        if (self.opts.onDone) self.opts.onDone(res);
      });
    };
    if (reducedMotion()) this.later(home, TIMING.reducedFade);
    else this.later(home, TIMING.failHomeLeadAt);
  };

  /** Locked for good after a timeout or a final refusal; nothing unlocks it but a reload. */
  MomentLine.prototype.lock = function (text, stateName) {
    this.stopSprings();
    this.x = 0;
    this.scale = 1;
    this.paint();
    this.setState(stateName);
    this.el.head.disabled = true;
    this.el.head.setAttribute('aria-disabled', 'true');
    this.showReason(text, 'error');
  };
  /** Lock the line with the reason shown, or unlock it (null). Ignored mid-write and after a result that locked it. */
  MomentLine.prototype.setDisabledReason = function (text, tone) {
    if (this.state === 'busy' || this.state === 'confirmed' || this.state === 'failing'
      || this.state === 'timeout' || this.state === 'final') return;
    if (text) {
      this.stopSprings();
      if (this.hold != null) { cancelRaf(this.hold); this.hold = null; }
      this.disarm();
      this.drag = null;
      this.x = 0;
      this.scale = 1;
      this.paint();
      this.setState('disabled');
      this.el.head.disabled = true;
      this.el.head.setAttribute('aria-disabled', 'true');
      this.showReason(text, tone || 'neutral');
      return;
    }
    if (this.state === 'disabled') {
      this.setState('idle');
      this.showReason('', null);
    }
    this.el.head.disabled = false;
    this.el.head.removeAttribute('aria-disabled');
  };
  MomentLine.prototype.setLabel = function (text) {
    this.opts.label = text;
    this.el.label.textContent = text || '';
    this.el.head.setAttribute('aria-label', text || '');
  };
  /** Take the listeners and timers down (the sheet closed). */
  MomentLine.prototype.destroy = function () {
    var h = this.handlers;
    var head = this.el.head;
    head.removeEventListener('pointerdown', h.down);
    head.removeEventListener('pointermove', h.move);
    head.removeEventListener('pointerup', h.up);
    head.removeEventListener('pointercancel', h.up);
    head.removeEventListener('click', h.click);
    head.removeEventListener('keydown', h.keydown);
    head.removeEventListener('keyup', h.keyup);
    head.removeEventListener('blur', h.blur);
    this.stopSprings();
    if (this.hold != null) cancelRaf(this.hold);
    this.disarm();
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.destroyed = true;
  };
  MomentLine.prototype.focus = function () {
    try { this.el.head.focus(); } catch (_e) { /* not focusable yet */ }
  };

  root.MageMoments = {
    MomentLine: MomentLine,
    sealResult: sealResult,
    sealRecorded: sealRecorded,
    formatRecorded: formatRecorded,
    // for scripts/moments-checks/portal.ts
    SPRING: SPRING, TIMING: TIMING, RULES: RULES, GEOMETRY: GEOMETRY, SEAL: SEAL,
    SEAL_BOX: SEAL_BOX, SEAL_R: SEAL_R, SEAL_STROKE: SEAL_STROKE, STEP: STEP,
    rubber: rubber, resist: resist, lockStep: lockStep, shouldCommit: shouldCommit,
    springStep: springStep, simulateSpring: simulateSpring
  };
})(typeof window !== 'undefined' ? window : this);
