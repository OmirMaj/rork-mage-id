/* MAGE ID marketing preview: the page around the model.
   Scroll position becomes one number (0 to 5) and the model, the cards, the dots,
   the phone screens, the big word and the tape all follow it. Reduce Motion: the
   model steps between still stages, nothing plays by itself, screens show their
   last frame. */
(function () {
  'use strict';
  var D = window.MAGE_DATA, doc = document, root = doc.documentElement;
  if (!D) return;
  function $(id) { return doc.getElementById(id); }
  function all(sel, el) { return [].slice.call((el || doc).querySelectorAll(sel)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
  function param(k) { var m = new RegExp('[?&]' + k + '=([^&]*)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; }

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var P = { stage: param('stage'), t: param('t'), full: param('full') === '1', shot: param('shot'), at: param('at') };
  if (P.shot !== null) root.classList.add('shotmode');
  var frozen = P.stage !== null || P.t !== null || P.full || P.shot !== null || P.at !== null;
  /* ?at=id starts the page at that section, for screenshots of the lower page */
  if (P.at !== null) { root.classList.add('atmode', 'pinned'); var atEl = $(P.at), sib = atEl && atEl.previousElementSibling; while (sib) { sib.style.display = 'none'; sib = sib.previousElementSibling; } }
  var virt = -1;
  var still = reduce || frozen;
  var THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  var THREE_SRI = 'sha512-dLxUelApnYxpLt6K2iomGngnHO83iUvZytA3YjDUCjT0HDOHKXnVYdf3hU4JjM8uEhxf9nD1/ey98U3t2vZ0qQ==';
  var SHOT_AVAIL = 0.62, POSTER_W = 1600, POSTER_H = 1200;

  var scene = $('scene'), canvas = $('jobCanvas'), stepsEl = $('steps'), poster = $('poster');
  var steps = all('.step', stepsEl), articles = steps.slice(1);
  function wide() { return window.innerWidth >= 1000; }
  function narrow() { return window.innerWidth < 600; }
  function is3d() { return root.classList.contains('is3d'); }

  /* ---------- numbers that count up and land on the real figure ---------- */
  function countText(el, text, ms) {
    var m = /^(\D*)([\d,]+(?:\.\d+)?)(.*)$/.exec(text);
    if (!m || still) { el.textContent = text; return; }
    var raw = m[2].replace(/,/g, ''), to = parseFloat(raw), dec = raw.indexOf('.') >= 0 ? raw.length - raw.indexOf('.') - 1 : 0, t0 = 0;
    function step(ts) {
      if (!t0) t0 = ts;
      var k = clamp((ts - t0) / ms, 0, 1); k = 1 - Math.pow(1 - k, 4);
      el.textContent = m[1] + (to * k).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3];
      if (k < 1) requestAnimationFrame(step); else el.textContent = text;
    }
    requestAnimationFrame(step);
  }
  function tierClass(p) { return p === 'Pro' ? ' pro' : p === 'Business' ? ' biz' : ''; }
  function tierTag(p) { return p ? '<span class="tier' + tierClass(p) + '">' + p + '</span>' : ''; }

  /* ---------- app screens: real captures, the small file on small screens and the sharp one on large ---------- */
  function shotImg(stem, alt, sizes) {
    var im = new Image();
    im.decoding = 'async'; im.alt = alt; im.width = 393; im.height = 852;
    im.sizes = sizes;
    im.srcset = 'img/screens/' + stem + '-1x.webp 393w, img/screens/' + stem + '-2x.webp 786w';
    im.src = 'img/screens/' + stem + '-1x.webp';
    return im;
  }
  /* one phone screen that can show any frame of a list. Frames are only fetched when asked for. */
  function Screen(el, sizes) { this.el = el; this.sizes = sizes; this.imgs = {}; this.cur = null; this.key = ''; }
  Screen.prototype.get = function (f) {
    var im = this.imgs[f.img];
    if (!im) { im = shotImg(f.img, f.alt, this.sizes); this.imgs[f.img] = im; this.el.appendChild(im); }
    return im;
  };
  Screen.prototype.show = function (f) {
    if (!f || this.key === f.img) return false;
    this.key = f.img;
    var im = this.get(f), was = this.cur;
    all('img.was', this.el).forEach(function (x) { x.classList.remove('was'); });
    if (was && was !== im) { was.classList.remove('on'); was.classList.add('was'); }
    im.classList.remove('was');
    void im.offsetWidth; im.classList.add('on'); this.cur = im;
    return true;
  };
  function capHtml(sc, f) { return '<b>' + (f.title || sc.title) + tierTag(sc.plan) + '</b>' + (f.cap || ''); }
  /* which frame of a stage's main screen, for a scroll position s: the frames play out as the stage arrives */
  function frameAt(stage, s) {
    var fr = D.SCREENS[stage].main.frames, n = fr.length;
    if (still) return n - 1;
    return Math.min(n - 1, Math.floor(clamp((s - (stage - 0.44)) / 0.44, 0, 1) * n));
  }

  /* wide screens: one main phone and one peeking behind it, pinned beside the model */
  var device = $('device'), deviceCap = $('deviceCap');
  var mainScr = new Screen($('phoneScreen'), '(min-width: 1000px) 270px, 1px'), sideScr = new Screen($('sideScreen'), '(min-width: 1000px) 205px, 1px');
  var devStage = 0;
  function driveScreens(stage, s) {
    if (!stage || !wide() || !is3d()) return;
    var sc = D.SCREENS[stage], f = sc.main.frames[frameAt(stage, s)];
    if (mainScr.show(f) || devStage !== stage) {
      devStage = stage;
      sideScr.show(sc.side);
      deviceCap.innerHTML = capHtml(sc.main, f) + '<span class="also"><b>Behind It: ' + sc.side.title + tierTag(sc.side.plan) + '</b> ' + sc.side.cap + '</span>';
    }
  }
  function warm(stage) { var sc = D.SCREENS[stage]; if (!sc || !wide() || !is3d()) return; sc.main.frames.forEach(function (f) { mainScr.get(f); }); sideScr.get(sc.side); }

  /* narrow screens and the still layout: each stage carries its own strip of screens */
  var strips = all('.shot').map(function (fig) {
    var stage = +fig.getAttribute('data-stage'), sc = D.SCREENS[stage];
    var holder = doc.createElement('div');
    holder.className = 'shot strip'; holder.setAttribute('data-stage', stage);
    holder.innerHTML = '<figure class="first"><div class="phone"><div class="phone-screen"></div></div><figcaption></figcaption></figure>' +
      '<figure class="second"><div class="phone"><div class="phone-screen"></div></div><figcaption></figcaption></figure>';
    fig.parentNode.replaceChild(holder, fig);
    var a = holder.firstChild, b = holder.lastChild;
    var st = { el: holder, stage: stage, sc: sc, main: new Screen(a.querySelector('.phone-screen'), '(min-width: 1000px) 250px, 58vw'), side: new Screen(b.querySelector('.phone-screen'), '(min-width: 1000px) 190px, 46vw'), cap: a.lastChild, timer: 0, built: false };
    b.lastChild.innerHTML = '<b>' + sc.side.title + tierTag(sc.side.plan) + '</b>' + sc.side.cap;
    st.cap.innerHTML = capHtml(sc.main, sc.main.frames[sc.main.frames.length - 1]);
    return st;
  });
  function playStrip(st) {
    var fr = st.sc.main.frames, i = still ? fr.length - 1 : 0;
    clearTimeout(st.timer);
    if (!st.built) { st.built = true; st.side.show(st.sc.side); fr.forEach(function (f) { st.main.get(f); }); }
    (function put() {
      st.main.show(fr[i]); st.cap.innerHTML = capHtml(st.sc.main, fr[i]);
      if (i < fr.length - 1) { i++; st.timer = setTimeout(put, 1700); }
    })();
  }
  if (window.IntersectionObserver) {
    var stripIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var st = strips.filter(function (x) { return x.el === e.target; })[0];
        if (st) playStrip(st);
      });
    }, { threshold: 0.35 });
    strips.forEach(function (st) { stripIO.observe(st.el); });
  } else strips.forEach(playStrip);

  /* ---------- in testing strip, from the data list ---------- */
  var replay = null;
  (function () {
    var box = $('testingShots'); if (!box) return;
    box.innerHTML = '';
    D.TESTING.forEach(function (t) {
      var f = doc.createElement('figure');
      f.innerHTML = '<span class="t-flag">In Testing</span><div class="phone"><div class="phone-screen"></div></div>' +
        (t.frames.length > 1 ? '<div class="t-weeks" role="group" aria-label="Pick a week"></div>' : '') +
        '<figcaption><b>' + t.title + '</b>' + t.line + '<em>In testing. Not in the app yet.</em></figcaption>';
      box.appendChild(f);
      var scr = new Screen(f.querySelector('.phone-screen'), '(min-width: 1000px) 250px, 62vw'), last = t.frames.length - 1;
      var item = { fig: f, t: t, scr: scr, i: -1, locked: false, btns: [] };
      item.set = function (i) {
        if (i === item.i) return; item.i = i; scr.show(t.frames[i]);
        item.btns.forEach(function (b, k) { b.classList.toggle('on', k === i); b.setAttribute('aria-pressed', k === i ? 'true' : 'false'); });
      };
      if (t.frames.length > 1) {
        var wk = f.querySelector('.t-weeks');
        t.frames.forEach(function (fr, k) {
          var b = doc.createElement('button'); b.type = 'button'; b.textContent = fr.label;
          b.addEventListener('click', function () { item.locked = true; item.set(k); });
          wk.appendChild(b); item.btns.push(b);
        });
        replay = item;
      }
      function load() { item.set(last); if (replay === item && !still) { t.frames.forEach(function (fr) { scr.get(fr); }); scrub(); } }
      if (window.IntersectionObserver && P.at === null) {
        var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); load(); } }, { rootMargin: '500px' });
        io.observe(f);
      } else load();
    });
  })();
  /* the replay scrubs through its four weeks as it crosses the screen, until a week is picked by hand */
  function scrub() {
    if (!replay || replay.locked || still || replay.i < 0) return;
    var r = replay.fig.getBoundingClientRect(), vh = window.innerHeight, n = replay.t.frames.length;
    if (r.bottom < 0 || r.top > vh) return;
    replay.set(Math.min(n - 1, Math.floor(clamp((vh * 0.92 - r.top) / (vh * 0.62), 0, 0.999) * n)));
  }

  /* ---------- cards, dimension tags and dots ---------- */
  var cardsEl = $('cards'), pinsEl = $('pins'), dimsEl = $('dims');
  var cards = D.CARDS.map(function (c) {
    var el = doc.createElement('div'); el.className = 'card ' + c.side;
    el.innerHTML = '<span class="stem"></span><div class="card-in' + (c.print ? ' printed' : '') + '"><p class="c-tag"><span>' + c.tag + '</span><i>Example</i></p>' +
      (c.print ? '<div class="c-print">' + c.print.map(function (x) { return '<i>' + x + '</i>'; }).join('') + '</div>' : '') +
      '<p class="c-big"></p>' +
      (c.bars ? '<div class="c-bars"><i></i><i></i><i></i><i></i><i></i></div>' : '') +
      (c.meter ? '<div class="c-meter"><i style="width:' + c.meter + '%"></i></div>' : '') +
      '<p class="c-sub' + (c.ok ? ' ok' : '') + '">' + c.sub + '</p></div>';
    cardsEl.appendChild(el);
    var big = el.querySelector('.c-big'); big.textContent = c.big;
    return { c: c, el: el, big: big, on: false };
  });
  var dims = D.DIMS.map(function (d) {
    var el = doc.createElement('div'); el.className = 'dim' + (d.room ? ' room' : '');
    el.innerHTML = '<span>' + d.text + '</span>'; dimsEl.appendChild(el);
    return { d: d, el: el, on: false };
  });
  var pins = D.PINS.map(function (p) {
    var b = doc.createElement('button'); b.type = 'button'; b.className = 'pin'; b.tabIndex = -1;
    b.setAttribute('aria-label', p.title + ': what the app does here');
    b.innerHTML = '<i></i>';
    b.addEventListener('click', function () { openPanel(p, b); });
    pinsEl.appendChild(b);
    return { p: p, el: b, on: false };
  });

  /* ---------- the stage panel on wide screens: built from the same words the page already carries ---------- */
  var stagePanel = $('stagePanel');
  (function () {
    var h = '<p class="sp-num"><span class="sp-n"><span>' + articles.map(function (a, i) { return '<b>0' + (i + 1) + '</b>'; }).join('') + '</span></span>Of 05</p>';
    h += '<div class="sp-word"><div>' + articles.map(function (a) { return '<span>' + a.querySelector('h2').textContent + '</span>'; }).join('') + '</div></div><div class="sp-bodies">';
    articles.forEach(function (a) { h += '<div class="sp-body"><p class="say">' + a.querySelector('.say').innerHTML + '</p><ul class="tools">' + a.querySelector('.tools').innerHTML + '</ul></div>'; });
    stagePanel.innerHTML = h + '</div>';
  })();
  var spBodies = all('.sp-body', stagePanel);

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
  var railBtns = all('#rail button');
  railBtns.forEach(function (b) { b.addEventListener('click', function () { goStage(+b.getAttribute('data-go')); }); });

  /* ---------- where the model sits ---------- */
  function heroLayout() { return wide() ? [0.725, 0.5, 0.5] : [0.5, 0.46, 0.98]; }
  function layoutFor(hk) {
    if (P.shot !== null) return [0.5, 0.5, SHOT_AVAIL];
    var h = heroLayout();
    if (wide()) return [0.56 + (h[0] - 0.56) * hk, 0.455 + (h[1] - 0.455) * hk, 0.4 + (h[2] - 0.4) * hk];
    if (narrow()) return [0.5, 0.38 + (h[1] - 0.38) * hk, 0.98];
    return [0.5, 0.44, 0.98];
  }
  /* the still picture is laid exactly where the first live frame will be drawn, so the hand-over is a fade and not a jump */
  function posterFit() {
    if (!is3d() || !window.MageJob || !poster) return;
    var w = scene.clientWidth, h = scene.clientHeight, L = heroLayout();
    var k = window.MageJob.fit(w, h, L[2]) / window.MageJob.fit(POSTER_W, POSTER_H, SHOT_AVAIL);
    poster.classList.add('fit');
    poster.style.width = (POSTER_W * k).toFixed(1) + 'px'; poster.style.height = (POSTER_H * k).toFixed(1) + 'px';
    poster.style.left = (L[0] * w - POSTER_W * k / 2).toFixed(1) + 'px'; poster.style.top = (L[1] * h - POSTER_H * k / 2).toFixed(1) + 'px';
  }
  posterFit();

  /* ---------- hero: the finished job, wound back to the bare lot, then built once ---------- */
  var auto = { on: false, t: 0, last: 0, back: 0, from: 5 };
  function autoTick(ts) {
    if (!auto.on) return;
    var dt = Math.min(0.05, (ts - auto.last) / 1000 || 0); auto.last = ts;
    if (auto.back < 1) auto.back = Math.min(1, auto.back + dt / 1.15);
    else auto.t = Math.min(1, auto.t + dt / 14);
    if (auto.t >= 1) auto.on = false;
    drive();
    if (auto.on) requestAnimationFrame(autoTick);
  }
  function autoS() { return auto.back < 1 ? auto.from * (1 - ease(auto.back)) : 5 * auto.t; }
  function play() {
    closePanel(false);
    if (reduce) return;
    auto.on = true; auto.t = 0; auto.back = 0; auto.from = job ? job.getS() : 5; auto.last = performance.now();
    requestAnimationFrame(autoTick);
  }
  $('replay').addEventListener('click', function () { goStage(0, true); readScroll(); play(); });
  $('turnL').addEventListener('click', function () { if (job) job.turn(-0.5); });
  $('turnR').addEventListener('click', function () { if (job) job.turn(0.5); });

  /* what the model should show right now */
  var uiStage = -1, target = 0, rail = $('rail'), railNeedle = $('railNeedle'), railWeek = $('railWeek');
  function drive() {
    if (P.shot !== null) target = clamp(parseFloat(P.shot) || 0, 0, 5);
    else if (P.t !== null) target = 5 * clamp(parseFloat(P.t) || 0, 0, 1);
    else if (atTop) target = auto.on ? autoS() : 5;
    else { auto.on = false; target = reduce ? Math.round(scrollS) : scrollS; }
    var st = atTop ? 0 : clamp(Math.round(scrollS), 1, 5);
    if (job) {
      job.setS(target, still || auto.on);
      var L = layoutFor(ease(1 - scrollS / 0.7));
      job.setLayout(L[0], L[1], L[2], still);
    }
    if (st !== uiStage) {
      uiStage = st;
      railBtns.forEach(function (b) { var n = +b.getAttribute('data-go'); b.classList.toggle('on', n === st); b.classList.toggle('done', n < st); if (n === st) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
      device.classList.toggle('on', st > 0);
      stagePanel.classList.toggle('on', st > 0);
      if (st > 0) {
        stagePanel.style.setProperty('--i', st - 1);
        spBodies.forEach(function (b, i) { b.classList.toggle('on', i === st - 1); });
        warm(st); if (st < 5) warm(st + 1);
      }
      railWeek.textContent = st > 0 ? D.STAGES[st].week : '';
      if (panelPin && (st === 0 || panelPin.show[0] > st + 0.5 || panelPin.show[1] < st - 0.5)) closePanel(false);
    }
    driveScreens(st, scrollS);
    var p = atTop ? 0 : clamp((scrollS - 0.5) / 5, 0, 1);
    $('railFill').style.transform = 'scaleX(' + p.toFixed(4) + ')';
    railNeedle.style.setProperty('--x', (p * rail.clientWidth).toFixed(1) + 'px');
    /* the drawing grid behind the job is strongest while it is being planned */
    scene.style.setProperty('--grid', (0.35 + 0.65 * clamp(1 - Math.abs(target - 1.4) / 1.6, 0, 1)).toFixed(3));
  }

  /* called by the model after every frame it draws */
  var pt = [0, 0];
  function overlay(s) {
    var settled = Math.abs(target - s) < 0.7, heroRest = atTop && !auto.on && settled && P.t === null && P.shot === null, w = wide(), nr = narrow(), shown = 0, i, c, on;
    for (i = cards.length - 1; i >= 0; i--) {
      c = cards[i];
      on = settled && ((s >= c.c.show[0] && s < c.c.show[1] && !heroRest && !(auto.on && auto.back < 1)) || (heroRest && c.c.hero && w));
      if (on && !w) { if (shown) on = false; shown++; }
      if (on && !nr) {
        var at = heroRest && c.c.heroAt ? c.c.heroAt : c.c.at;
        if (c.c.heroSide) { c.el.classList.toggle('r', heroRest); c.el.classList.toggle('l', !heroRest); }
        job.project(at[0], at[1], at[2], pt);
        var x = pt[0], y = pt[1];
        if (!c.w) { c.w = c.el.lastChild.offsetWidth; c.h = c.el.lastChild.offsetHeight; }
        var vw = scene.clientWidth, left = c.el.classList.contains('l');
        var lo = w && !heroRest ? stagePanel.offsetLeft + stagePanel.offsetWidth + 26 : 30;
        x = left ? clamp(x, lo + c.w - 22, vw + 14) : clamp(x, lo + 22, vw - c.w - 2);
        y = Math.max(y, c.h + 100);
        c.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      }
      if (on !== c.on) { c.on = on; c.el.classList.toggle('on', on); if (on) countText(c.big, c.c.big, 1100); }
    }
    for (i = 0; i < dims.length; i++) {
      c = dims[i];
      on = !nr && s >= c.d.show[0] && s < c.d.show[1] && !heroRest;
      if (on) { job.project(c.d.at[0], c.d.at[1], c.d.at[2], pt); c.el.style.transform = 'translate(' + pt[0].toFixed(1) + 'px,' + pt[1].toFixed(1) + 'px)'; }
      if (on !== c.on) { c.on = on; c.el.classList.toggle('on', on); }
    }
    for (i = 0; i < pins.length; i++) {
      c = pins[i];
      on = settled && s >= c.p.show[0] && s < c.p.show[1] && !heroRest && !auto.on;
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
  function fallBack() { root.classList.remove('is3d'); job = null; if (poster) { poster.classList.remove('fit'); poster.removeAttribute('style'); } }
  function boot() {
    if (job || !is3d()) return;
    try {
      job = window.MageJob.create(canvas, { small: window.innerWidth < 800, snap: still, keep: frozen, s: 5 });
    } catch (err) { fallBack(); return; }
    job.onFrame(overlay);
    measure(); readScroll();
    if (P.stage !== null) placeVirt();
    /* the first live frame is the finished job, in the same place and at the same size as the still picture */
    job.resize();
    var L = layoutFor(ease(1 - scrollS / 0.7)); job.setLayout(L[0], L[1], L[2], true);
    drive();
    job.drawNow();
    scene.classList.add('live');
    watch();
    if (!still && atTop) setTimeout(function () { if (atTop && !auto.on) play(); }, 1500);
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

  /* ---------- the phone leans toward the pointer ---------- */
  if (!reduce && !frozen && window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var tiltWait = false, tx = 0, ty = 0;
    scene.addEventListener('pointermove', function (e) {
      tx = e.clientX / window.innerWidth * 2 - 1; ty = e.clientY / window.innerHeight * 2 - 1;
      if (tiltWait) return; tiltWait = true;
      requestAnimationFrame(function () { tiltWait = false; device.style.setProperty('--mx', tx.toFixed(3)); device.style.setProperty('--my', ty.toFixed(3)); });
    }, { passive: true });
    scene.addEventListener('pointerleave', function () { device.style.setProperty('--mx', 0); device.style.setProperty('--my', 0); });
  }

  /* ---------- scroll and resize ---------- */
  var ticking = false;
  function onScroll() { if (ticking) return; ticking = true; requestAnimationFrame(function () { ticking = false; readScroll(); drive(); scrub(); }); }
  window.addEventListener('scroll', onScroll, { passive: true });
  var rz = 0;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (virt < 0) measure(); readScroll(); posterFit(); if (job) job.resize(); uiStage = -1; drive(); }, frozen ? 0 : 120); });
  window.addEventListener('load', function () { if (virt < 0) measure(); readScroll(); posterFit(); drive(); });
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { if (virt < 0) measure(); readScroll(); drive(); });
  measure(); readScroll();

  /* ---------- things that arrive as you reach them ---------- */
  var riseSel = '.facts div, .how li, .book, .plan, .straight, .testing-copy, .testing-shots figure, .end-copy > *, .end-art';
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
    }, { threshold: 0.2 });
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
