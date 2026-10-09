/* MAGE ID marketing preview: the page around the model.
   Scroll position becomes one number (0 to 5) and the model, the cards, the dots,
   the phone and the rail all follow it. Reduce Motion: the model steps between
   still stages, nothing plays by itself, screens fade. */
(function () {
  'use strict';
  var D = window.MAGE_DATA, doc = document, root = doc.documentElement;
  if (!D) return;
  function $(id) { return doc.getElementById(id); }
  function all(sel, el) { return [].slice.call((el || doc).querySelectorAll(sel)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function param(k) { var m = new RegExp('[?&]' + k + '=([^&]*)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; }

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var P = { stage: param('stage'), t: param('t'), full: param('full') === '1', shot: param('shot'), at: param('at') };
  if (P.shot !== null) root.classList.add('shotmode');
  var frozen = P.stage !== null || P.t !== null || P.full || P.shot !== null || P.at !== null;
  /* ?at=id starts the page at that section, for screenshots of the lower page */
  if (P.at !== null) { root.classList.add('atmode'); var atEl = $(P.at), sib = atEl && atEl.previousElementSibling; while (sib) { sib.style.display = 'none'; sib = sib.previousElementSibling; } }
  var virt = -1;
  var still = reduce || frozen;
  var THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  var THREE_SRI = 'sha512-dLxUelApnYxpLt6K2iomGngnHO83iUvZytA3YjDUCjT0HDOHKXnVYdf3hU4JjM8uEhxf9nD1/ey98U3t2vZ0qQ==';

  var scene = $('scene'), canvas = $('jobCanvas'), stepsEl = $('steps');
  var steps = all('.step', stepsEl);
  function wide() { return window.innerWidth >= 1000; }
  function is3d() { return root.classList.contains('is3d'); }

  /* ---------- numbers that count ---------- */
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function countText(el, text, ms) {
    var m = /^(\D*)([\d,]+)(.*)$/.exec(text);
    if (!m || still) { el.textContent = text; return; }
    var to = parseInt(m[2].replace(/,/g, ''), 10), t0 = 0;
    function step(ts) {
      if (!t0) t0 = ts;
      var k = clamp((ts - t0) / ms, 0, 1); k = 1 - Math.pow(1 - k, 4);
      el.textContent = m[1] + fmt(to * k) + m[3];
      if (k < 1) requestAnimationFrame(step); else el.textContent = text;
    }
    requestAnimationFrame(step);
  }
  function tierClass(p) { return p === 'Pro' ? ' pro' : p === 'Business' ? ' biz' : ''; }
  function tierTag(p) { return p ? '<span class="tier' + tierClass(p) + '">' + p + '</span>' : ''; }

  /* ---------- phone screens, from the data list ---------- */
  function Phone(screenEl, capEl) { this.el = screenEl; this.cap = capEl; this.stage = 0; this.imgs = {}; this.timer = 0; this.cur = null; }
  Phone.prototype.frames = function (stage) {
    var out = [];
    (D.SCREENS[stage] || []).forEach(function (sc) { sc.frames.forEach(function (f) { out.push({ f: f, sc: sc }); }); });
    return out;
  };
  Phone.prototype.img = function (stage, i, f) {
    var k = stage + ':' + i, im = this.imgs[k];
    if (!im) { im = new Image(); im.decoding = 'async'; im.alt = f.alt; im.src = f.src; this.imgs[k] = im; this.el.appendChild(im); }
    return im;
  };
  Phone.prototype.warm = function (stage) { var me = this; this.frames(stage).forEach(function (x, i) { me.img(stage, i, x.f); }); };
  Phone.prototype.show = function (stage) {
    if (stage === this.stage) return;
    this.stage = stage; clearTimeout(this.timer);
    if (!stage) return;
    var me = this, fr = this.frames(stage), i = still ? fr.length - 1 : 0;
    this.warm(stage);
    function put() {
      var x = fr[i]; if (!x) return;
      var im = me.img(stage, i, x.f);
      if (me.cur && me.cur !== im) me.cur.classList.remove('on');
      /* a frame of the same screen fades in place; a new screen slides up */
      im.classList.add('on'); me.cur = im;
      if (me.cap && me.capId !== x.sc.id) {
        me.capId = x.sc.id;
        me.cap.innerHTML = '<b>' + x.sc.title + tierTag(x.sc.plan) + '</b>' + x.sc.line + (x.sc.real ? '' : '<span class="standin">Older capture standing in. The new one is on its way.</span>');
      }
      if (i < fr.length - 1) { i++; me.timer = setTimeout(put, 1500); }
    }
    requestAnimationFrame(put);
  };

  var device = $('device'), devicePhone = new Phone($('phoneScreen'), $('deviceCap'));
  var shotPhones = all('.shot').map(function (fig) {
    var stage = +fig.getAttribute('data-stage'), scr = fig.querySelector('.phone-screen');
    scr.innerHTML = '';
    var ph = new Phone(scr, fig.querySelector('figcaption'));
    ph.fig = fig; ph.forStage = stage; ph.warm(stage);
    var first = ph.imgs[stage + ':0']; if (first) { first.classList.add('on'); ph.cur = first; }
    return ph;
  });
  if (window.IntersectionObserver) {
    var shotIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var ph = shotPhones.filter(function (p) { return p.fig === e.target; })[0];
        if (ph && e.isIntersecting) { ph.stage = 0; ph.show(ph.forStage); }
      });
    }, { threshold: 0.5 });
    shotPhones.forEach(function (p) { shotIO.observe(p.fig); });
  } else shotPhones.forEach(function (p) { p.show(p.forStage); });

  /* ---------- in testing strip, from the data list ---------- */
  (function () {
    var box = $('testingShots'); if (!box) return;
    D.TESTING.forEach(function (t) {
      var f = doc.createElement('figure');
      f.innerHTML = '<img loading="lazy" alt="" /><figcaption></figcaption>';
      f.firstChild.src = t.src; f.firstChild.alt = t.alt; f.lastChild.textContent = t.title + '. In testing.';
      box.appendChild(f);
    });
  })();

  /* ---------- cards and dots ---------- */
  var cardsEl = $('cards'), pinsEl = $('pins');
  var cards = D.CARDS.map(function (c) {
    var el = doc.createElement('div'); el.className = 'card ' + c.side;
    el.innerHTML = '<span class="stem"></span><div class="card-in"><p class="c-tag"><span>' + c.tag + '</span><i>Example</i></p><p class="c-big"></p>' +
      (c.bars ? '<div class="c-bars"><i></i><i></i><i></i><i></i><i></i></div>' : '') +
      (c.meter ? '<div class="c-meter"><i style="width:' + c.meter + '%"></i></div>' : '') +
      '<p class="c-sub' + (c.ok ? ' ok' : '') + '">' + c.sub + '</p></div>';
    cardsEl.appendChild(el);
    var big = el.querySelector('.c-big'); big.textContent = c.big;
    return { c: c, el: el, big: big, on: false };
  });
  var pins = D.PINS.map(function (p) {
    var b = doc.createElement('button'); b.type = 'button'; b.className = 'pin'; b.tabIndex = -1;
    b.setAttribute('aria-label', p.title + ': what the app does here');
    b.innerHTML = '<i></i>';
    b.addEventListener('click', function () { openPanel(p, b); });
    pinsEl.appendChild(b);
    return { p: p, el: b, on: false };
  });

  /* ---------- panel ---------- */
  var panel = $('panel'), panelFrom = null, panelPin = null;
  function openPanel(p, from) {
    panelFrom = from; panelPin = p;
    pins.forEach(function (x) { x.el.classList.toggle('sel', x.p === p); });
    $('panelTag').innerHTML = '<span>' + p.tag + '</span>' + tierTag(p.plan);
    $('panelTitle').textContent = p.title;
    $('panelSub').textContent = p.sub;
    $('panelRows').innerHTML = p.rows.map(function (r) {
      return '<li><span>' + r[0] + (r[1] ? '<small>' + r[1] + '</small>' : '') + '</span>' + (r[2] ? '<span class="chip' + (r[3] ? ' ' + r[3] : '') + '">' + r[2] + '</span>' : '') + '</li>';
    }).join('');
    $('panelNote').textContent = p.note || '';
    panel.hidden = false;
    $('panelClose').focus({ preventScroll: true });
  }
  function closePanel(back) {
    if (panel.hidden) return;
    panel.hidden = true; pins.forEach(function (x) { x.el.classList.remove('sel'); });
    if (back && panelFrom) panelFrom.focus({ preventScroll: true });
    panelPin = null;
  }
  $('panelClose').addEventListener('click', function () { closePanel(true); });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(true); });

  /* ---------- scroll position as one number ---------- */
  var marks = [], scrollS = 0, atTop = true, job = null;
  function measure() {
    var vh = window.innerHeight, sy = window.pageYOffset, w = wide();
    var sceneH = scene.offsetHeight;
    marks = steps.map(function (st) {
      var r = st.getBoundingClientRect(), top = r.top + sy;
      return w ? top + r.height / 2 - vh / 2 : top - sceneH - (vh - sceneH) * 0.3;
    });
    marks[0] = Math.min(marks[0], 0);
  }
  function readScroll() {
    if (virt >= 0) { scrollS = virt; atTop = virt === 0; return; }
    var y = window.pageYOffset, i = 0;
    if (y <= marks[0]) scrollS = 0;
    else if (y >= marks[5]) scrollS = 5;
    else { while (i < 4 && y > marks[i + 1]) i++; scrollS = i + (y - marks[i]) / (marks[i + 1] - marks[i]); }
    atTop = scrollS < 0.14;
  }
  function goStage(n, instant) {
    var y = Math.max(0, Math.round(marks[n]) + (n ? 1 : 0));
    if (instant) { root.style.scrollBehavior = 'auto'; window.scrollTo(0, y); root.style.scrollBehavior = ''; }
    else window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  }
  all('#rail button').forEach(function (b) { b.addEventListener('click', function () { goStage(+b.getAttribute('data-go')); }); });

  /* ---------- hero: the job plays by itself, once ---------- */
  var auto = { on: false, t: 0, last: 0, done: false };
  function autoTick(ts) {
    if (!auto.on) return;
    var dt = Math.min(0.05, (ts - auto.last) / 1000 || 0); auto.last = ts;
    auto.t += dt / 15;
    if (auto.t >= 1) { auto.t = 1; auto.on = false; auto.done = true; }
    drive();
    if (auto.on) requestAnimationFrame(autoTick);
  }
  function play() {
    closePanel(false);
    if (reduce) return;
    auto.on = true; auto.t = 0; auto.done = false; auto.last = performance.now();
    if (job) job.setS(0, true);
    requestAnimationFrame(autoTick);
  }
  $('replay').addEventListener('click', function () { goStage(0, true); readScroll(); play(); });
  $('turnL').addEventListener('click', function () { if (job) job.turn(-0.5); });
  $('turnR').addEventListener('click', function () { if (job) job.turn(0.5); });

  /* what the model should show right now */
  var uiStage = -1, target = 0;
  function drive() {
    if (P.shot !== null) target = clamp(parseFloat(P.shot) || 0, 0, 5);
    else if (P.t !== null) target = 5 * clamp(parseFloat(P.t) || 0, 0, 1);
    else if (atTop) target = auto.on ? 5 * auto.t : 5;
    else { if (auto.on) { auto.on = false; auto.done = true; } target = reduce ? Math.round(scrollS) : scrollS; }
    var st = atTop ? 0 : clamp(Math.round(scrollS), 1, 5);
    if (job) {
      job.setS(target, still);
      var hk = clamp(1 - scrollS / 0.7, 0, 1); hk = hk * hk * (3 - 2 * hk);
      if (P.shot !== null) job.setLayout(0.5, 0.5, 0.8, true);
      else if (wide()) job.setLayout(0.56 + 0.11 * hk, 0.47 + 0.03 * hk, 0.44 + 0.08 * hk, still);
      else job.setLayout(0.5, 0.44, 0.98, still);
    }
    if (st !== uiStage) {
      uiStage = st;
      all('#rail button').forEach(function (b) { var n = +b.getAttribute('data-go'); b.classList.toggle('on', n === st); b.classList.toggle('done', n < st); if (n === st) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
      device.classList.toggle('on', st > 0);
      if (st > 0) { devicePhone.show(st); if (st < 5) devicePhone.warm(st + 1); }
      if (panelPin && (st === 0 || panelPin.show[0] > st + 0.5 || panelPin.show[1] < st - 0.5)) closePanel(false);
    }
    $('railFill').style.transform = 'scaleX(' + (atTop ? 0 : clamp((scrollS - 0.5) / 5 + 0.1, 0, 1)).toFixed(4) + ')';
  }

  /* called by the model after every frame it draws */
  var pt = [0, 0];
  function overlay(s) {
    var settled = Math.abs(target - s) < 0.7, heroRest = atTop && !auto.on && settled && P.t === null && P.shot === null, w = wide(), shown = 0, i, c, on;
    var narrow = window.innerWidth < 600;
    for (i = cards.length - 1; i >= 0; i--) {
      c = cards[i];
      on = settled && ((s >= c.c.show[0] && s < c.c.show[1] && !heroRest) || (heroRest && c.c.hero));
      if (on && narrow) { if (shown) on = false; shown++; }
      if (on) {
        var at = heroRest && c.c.heroAt ? c.c.heroAt : c.c.at;
        if (c.c.heroSide) { c.el.classList.toggle('r', heroRest); c.el.classList.toggle('l', !heroRest); }
        job.project(at[0], at[1], at[2], pt);
        var x = pt[0], y = pt[1];
        if (!c.w) { c.w = c.el.lastChild.offsetWidth; c.h = c.el.lastChild.offsetHeight; }
        var vw = scene.clientWidth, left = c.el.classList.contains('l');
        x = left ? clamp(x, c.w - 14, vw + 14) : clamp(x, 30, vw - c.w + (narrow ? 14 : -2));
        y = Math.max(y, c.h + (narrow ? 30 : 100));
        c.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      }
      if (on !== c.on) { c.on = on; c.el.classList.toggle('on', on); if (on) countText(c.big, c.c.big, 900); }
    }
    for (i = 0; i < pins.length; i++) {
      c = pins[i];
      on = settled && s >= c.p.show[0] && s < c.p.show[1] && !(heroRest && !w);
      if (on) { job.project(c.p.at[0], c.p.at[1], c.p.at[2], pt); c.el.style.transform = 'translate(' + pt[0].toFixed(1) + 'px,' + pt[1].toFixed(1) + 'px)'; }
      if (on !== c.on) { c.on = on; c.el.classList.toggle('on', on); c.el.tabIndex = on ? 0 : -1; }
    }
  }

  /* a screenshot of stage N: every other step is taken out, so stage N sits where it would after scrolling
     and the picture is the same every time, whatever the window does */
  function placeVirt() {
    var n = clamp(parseInt(P.stage, 10) || 0, 0, 5);
    virt = n; root.classList.add('virt');
    steps.forEach(function (st, i) { st.classList.add('in'); if (i !== n) st.style.display = 'none'; });
    if (n > 0) doc.querySelector('.top').style.display = 'none';
    readScroll();
  }
  /* ---------- load the 3D only when it is wanted ---------- */
  function fallBack() { root.classList.remove('is3d'); job = null; }
  function boot() {
    if (job || !is3d()) return;
    try {
      job = window.MageJob.create(canvas, { small: window.innerWidth < 800, snap: still, keep: frozen });
    } catch (err) { fallBack(); return; }
    job.onFrame(overlay);
    measure(); readScroll();
    if (P.stage !== null) placeVirt();
    drive();
    job.resize(); job.drawNow();
    scene.classList.add('live');
    watch();
    if (!still && atTop) play();
    var pp = param('pin'); if (pp) pins.forEach(function (x) { if (x.p.id === pp) openPanel(x.p, x.el); });
  }
  function loadThree() {
    if (window.THREE) { boot(); return; }
    var s = doc.createElement('script');
    s.src = THREE_URL; s.integrity = THREE_SRI; s.crossOrigin = 'anonymous'; s.async = true;
    s.onload = boot; s.onerror = fallBack;
    doc.head.appendChild(s);
  }
  var visible = true;
  function watch() {
    function sync() { if (!job) return; if (visible && !doc.hidden) job.start(); else job.stop(); }
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; sync(); }).observe(scene);
    doc.addEventListener('visibilitychange', sync);
    sync();
  }
  if (is3d()) {
    var asked = false;
    var ask = function () { if (asked) return; asked = true; (window.requestIdleCallback || function (f) { setTimeout(f, 60); })(loadThree, { timeout: 1200 }); };
    var near = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { near.disconnect(); if (doc.readyState === 'complete' || frozen) ask(); else window.addEventListener('load', ask); } }, { rootMargin: '400px' });
    near.observe(scene);
  }

  /* ---------- scroll and resize ---------- */
  var ticking = false;
  function onScroll() { if (ticking) return; ticking = true; requestAnimationFrame(function () { ticking = false; readScroll(); drive(); }); }
  window.addEventListener('scroll', onScroll, { passive: true });
  var rz = 0;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (virt < 0) measure(); readScroll(); if (job) job.resize(); drive(); }, frozen ? 0 : 120); });
  window.addEventListener('load', function () { if (virt < 0) measure(); readScroll(); drive(); });
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { if (virt < 0) measure(); readScroll(); drive(); });
  measure(); readScroll();

  /* ---------- things that arrive as you reach them ---------- */
  var riseSel = '.facts div, .how li, .book, .plan, .straight, .testing-copy, .end-copy > *, .end-lot';
  all(riseSel).forEach(function (el, i) { el.classList.add('rise'); el.style.transitionDelay = (i % 4) * 70 + 'ms'; });
  if (window.IntersectionObserver && !P.full && P.at === null) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target; io.unobserve(el);
        el.classList.add('in');
        if (el.classList.contains('one-line')) lightUp(el);
        if (el.id === 'book') setTimeout(closeAJob, still ? 0 : 700);
        all('[data-count]', el).forEach(function (n) { countText(n, n.textContent, 1100); });
      });
    }, { threshold: 0.25 });
    all('.step, .rise, .one-line').forEach(function (el) { io.observe(el); });
  } else {
    all('.step, .rise').forEach(function (el) { el.classList.add('in'); });
    all('.one-line, .one-line em').forEach(function (el) { el.classList.add('lit'); });
    setTimeout(function () { closeAJob(); }, 0);
  }
  function lightUp(el) {
    el.classList.add('lit');
    all('em', el).forEach(function (em, i) { setTimeout(function () { em.classList.add('lit'); }, still ? 0 : 350 + i * 260); });
  }

  /* ---------- the price book fills as jobs close ---------- */
  var BOOK = [
    [],
    [[0, '$3.25 per sq ft'], [2, '$640 each']],
    [[1, '$2.40 per sq ft'], [3, '$6.80 per sq ft']],
    [[4, '$185 each'], [0, '$3.18 per sq ft']]
  ];
  var bookRows = all('#bookRows li'), bookStart = bookRows.map(function (li) { return li.innerHTML; }), closed = 0, closeBtn = $('closeJob');
  function closeAJob() {
    if (closed >= 3) { closed = 0; bookRows.forEach(function (li, i) { li.innerHTML = bookStart[i]; li.className = ''; }); }
    else {
      closed++;
      BOOK[closed].forEach(function (ch, k) {
        setTimeout(function () {
          var li = bookRows[ch[0]], src = li.querySelector('.src'), b = li.querySelector('b');
          src.className = 'src own'; src.textContent = 'From Your Jobs';
          li.classList.remove('pop'); void li.offsetWidth; li.classList.add('pop', 'fresh');
          countMoney(b, ch[1]);
        }, still ? 0 : k * 260);
      });
    }
    $('bookN').textContent = closed;
    closeBtn.textContent = closed >= 3 ? 'Start Over' : closed ? 'Close Another Job' : 'Close A Job';
  }
  function countMoney(el, text) {
    var m = /^\$([\d.]+)(.*)$/.exec(text), from = parseFloat((/^\$([\d.]+)/.exec(el.textContent) || [0, 0])[1]);
    if (!m || still) { el.textContent = text; return; }
    var to = parseFloat(m[1]), dec = m[1].indexOf('.') >= 0 ? 2 : 0, t0 = 0;
    function step(ts) {
      if (!t0) t0 = ts;
      var k = clamp((ts - t0) / 700, 0, 1); k = 1 - Math.pow(1 - k, 3);
      el.textContent = '$' + (from + (to - from) * k).toFixed(dec) + m[2];
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  closeBtn.hidden = false;
  closeBtn.addEventListener('click', closeAJob);
})();
