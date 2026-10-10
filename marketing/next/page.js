/* MAGE ID marketing preview: the page around the drawing.
   Scroll position becomes one number (0 to 5). The drawing, the keynotes, the
   app screen, the title block and the schedule chart all follow it.
   Reduce Motion: the drawing steps between finished stages, nothing plays by
   itself, screens show their last frame. */
(function () {
  'use strict';
  var D = window.MAGE_DATA, doc = document, root = doc.documentElement;
  if (!D) return;
  function $(id) { return doc.getElementById(id); }
  function all(sel, el) { return [].slice.call((el || doc).querySelectorAll(sel)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function param(k) { var m = new RegExp('[?&]' + k + '=([^&]*)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; }
  function interp(x, xs, ys) {
    if (x <= xs[0]) return ys[0];
    for (var i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (xs[i] === xs[i - 1] ? 1 : (x - xs[i - 1]) / (xs[i] - xs[i - 1]));
    return ys[ys.length - 1];
  }

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var Q = { stage: param('stage'), t: param('t'), full: param('full') === '1', shot: param('shot'), at: param('at'), view: param('view'), pin: param('pin') };

  /* ?shot=N draws the drawing alone, to make the still pictures */
  if (Q.shot !== null && window.MageDraw) {
    doc.body.innerHTML = '<canvas id="c" style="position:fixed;left:0;top:0;width:100vw;height:100vh;background:#FBFBF9"></canvas>';
    var sd = window.MageDraw($('c'), { p: parseFloat(Q.shot) || 0, still: true, maxDpr: 2 });
    if (Q.view) sd.view(Q.view);
    (doc.fonts && doc.fonts.load ? doc.fonts.load('600 12px "Barlow Condensed"') : Promise.resolve()).then(function () { sd.now(); });
    return;
  }

  var frozen = Q.stage !== null || Q.t !== null || Q.full || Q.at !== null;
  var still = reduce || frozen;
  var live = root.classList.contains('live');
  var heroEl = doc.querySelector('.hero'), stepsEl = $('steps'), articles = all('.step', stepsEl);
  var sceneWrap = doc.querySelector('.scene-wrap'), sheetBody = $('sheetBody'), canvas = $('jobCanvas');
  function wide() { return window.innerWidth >= 1100; }

  /* screenshots: ?at=id starts the page at that section, ?stage=N shows that stage alone */
  if (Q.at !== null) { var atEl = $(Q.at), sib = atEl && atEl.previousElementSibling; while (sib) { sib.style.display = 'none'; sib = sib.previousElementSibling; } var tp = doc.querySelector('.top'); if (tp) tp.style.display = 'none'; }
  var forced = null;
  if (Q.stage !== null) forced = clamp(parseInt(Q.stage, 10) || 0, 0, 5);
  else if (Q.t !== null) forced = clamp(parseFloat(Q.t) || 0, 0, 5);
  if (forced !== null && live) {
    var keep = Math.round(forced) || (forced > 0.5 ? 1 : 0);
    if (keep > 0) { heroEl.style.display = 'none'; var tb = doc.querySelector('.top'); if (tb && window.innerWidth < 1100) tb.style.display = 'none'; }
    articles.forEach(function (a, i) { if (i + 1 !== keep) a.style.display = 'none'; });
  }

  function tierClass(p) { return p === 'Pro' ? ' pro' : p === 'Business' ? ' biz' : ''; }
  function tierTag(p) { return p ? '<span class="tier' + tierClass(p) + '">' + p + '</span>' : ''; }

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

  /* ---------- app screens: real captures, the small file on small screens and the sharp one on large ---------- */
  function shotImg(stem, alt, sizes) {
    var im = new Image();
    im.decoding = 'async'; im.alt = alt; im.width = 393; im.height = 852;
    im.sizes = sizes;
    im.srcset = 'img/screens/' + stem + '-1x.webp 393w, img/screens/' + stem + '-2x.webp 786w';
    im.src = 'img/screens/' + stem + '-1x.webp';
    return im;
  }
  /* one screen that can show any frame of a list. Frames are only fetched when asked for. */
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
  /* the frames of a stage, in the order they play: the main screen doing its job, then the second screen */
  var HERO_FRAMES = [{ img: 'summary', title: 'Summary', plan: 'Free', cap: 'Today on site, the week and the money on the job.', alt: 'MAGE ID Summary tab: today on site, this week, and the money on the job' }];
  function framesFor(n) {
    if (!n) return { list: HERO_FRAMES, main: 1 };
    var s = D.SCREENS[n], list = s.main.frames.map(function (f) { return { img: f.img, alt: f.alt, cap: f.cap, title: f.title || s.main.title, plan: f.plan || s.main.plan }; });
    var main = list.length;
    if (s.side) list.push({ img: s.side.img, alt: s.side.alt, cap: s.side.cap, title: s.side.title, plan: s.side.plan });
    return { list: list, main: main };
  }
  function capHtml(f) { return '<b>' + f.title + tierTag(f.plan) + '</b>' + f.cap + ' Example job.'; }

  /* ---------- the drawing ---------- */
  var draw = null;
  if (live && window.MageDraw && canvas) {
    draw = window.MageDraw(canvas, { still: still, maxDpr: 2 });
    if (draw) {
      if (window.ResizeObserver) new ResizeObserver(function () { draw.resize(); }).observe(sheetBody);
      else window.addEventListener('resize', function () { draw.resize(); });
      new IntersectionObserver(function (es) { draw.show(es[0].isIntersecting); }).observe(sheetBody);
      var first = true;
      draw.onDraw(function () { if (first) { first = false; root.classList.add('drawn'); } placePins(); syncViews(); });
    } else { root.classList.remove('live'); live = false; }
  }

  /* ---------- keynotes on the drawing, and the panel they open ---------- */
  var pinsEl = $('pins'), pinEls = [], panel = $('panel'), openPin = null, counts = {};
  D.PINS.forEach(function (p) {
    var b = doc.createElement('button'); counts[p.tag] = (counts[p.tag] || 0) + 1;
    b.type = 'button'; b.className = 'pin'; b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'panel');
    b.innerHTML = '<i>' + counts[p.tag] + '</i><span>' + p.title + '</span>';
    b.setAttribute('aria-label', p.title + ', ' + p.plan + ' plan. Show what the app does here.');
    b.addEventListener('click', function () { if (openPin === p) closePanel(true); else showPanel(p, b); });
    pinsEl.appendChild(b); pinEls.push(b);
  });
  var P = 0;
  function placePins() {
    if (!draw) return;
    var sz = draw.size(), ov = draw.over();
    D.PINS.forEach(function (p, i) {
      var b = pinEls[i], on = P >= p.show[0] && P <= p.show[1] && (!ov || openPin === p);
      if (on) {
        var q = draw.project(p.at), x = clamp(q[0], 14, sz[0] - 14), y = clamp(q[1], 14, sz[1] - 14);
        var flip = p.side ? p.side === 'l' : x > sz[0] * 0.56;
        b.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)' + (flip && wide() ? ' translateX(calc(-100% + 24px))' : '');
        b.classList.toggle('flip', flip);
      }
      if (b.classList.contains('on') !== on) { b.classList.toggle('on', on); b.tabIndex = on ? 0 : -1; if (!on && openPin === p) closePanel(false); }
    });
  }
  function showPanel(p, btn) {
    openPin = p;
    pinEls.forEach(function (b) { b.setAttribute('aria-expanded', b === btn ? 'true' : 'false'); });
    $('panelTag').innerHTML = p.tag + ' ' + tierTag(p.plan);
    $('panelTitle').textContent = p.title; $('panelSub').textContent = p.sub; $('panelNote').textContent = p.note;
    $('panelRows').innerHTML = p.rows.map(function (r) { return '<li><span>' + r[0] + '</span>' + (r[1] ? '<small>' + r[1] + '</small>' : '') + '<b' + (r[3] ? ' class="' + r[3] + '"' : '') + '>' + r[2] + '</b></li>'; }).join('');
    panel.hidden = false;
  }
  function closePanel(refocus) {
    if (!openPin) return;
    var i = D.PINS.indexOf(openPin); openPin = null; panel.hidden = true;
    pinEls.forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    if (refocus && pinEls[i]) pinEls[i].focus();
  }
  $('panelClose').addEventListener('click', function () { closePanel(true); });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(true); });

  /* ---------- plan, axonometric, section ---------- */
  var viewBtns = all('#views [data-view]'), lastView = '';
  viewBtns.forEach(function (b) {
    b.addEventListener('click', function () { if (!draw) return; var v = b.getAttribute('data-view'); draw.view(draw.over() === v ? null : v); });
  });
  function syncViews() {
    var n = draw.viewName(); if (n === lastView) return; lastView = n;
    viewBtns.forEach(function (b) { var v = b.getAttribute('data-view'); b.setAttribute('aria-pressed', (v === 'plan' && n === 'Plan') || (v === 'axon' && n === 'Axonometric') || (v === 'section' && n !== 'Plan' && n !== 'Axonometric') ? 'true' : 'false'); });
  }

  /* ---------- the big screen beside the drawing ---------- */
  var device = $('device'), devScreen = new Screen($('phoneScreen'), '318px'), devCap = $('deviceCap');
  function showDevice(stage, p) {
    if (!wide() || !live) return;
    var F = framesFor(stage), i;
    if (!stage) i = 0;
    else if (still) i = F.main - 1;
    else i = Math.floor(clamp((p - (stage - 0.5)) * 1.12, 0, 0.999) * F.list.length);
    if (devScreen.show(F.list[i])) devCap.innerHTML = capHtml(F.list[i]);
    /* have the next stage's first screen ready */
    if (!still && stage < 5 && p > stage + 0.2) devScreen.get(framesFor(stage + 1).list[0]);
  }

  /* ---------- small screens: each stage's own screen plays through its frames while it is in view ---------- */
  var seqs = [];
  all('.shot[data-stage]').forEach(function (fig) {
    var n = +fig.getAttribute('data-stage'), F = framesFor(n), holder = fig.querySelector('.phone-screen'), im0 = holder.querySelector('img'), cap = fig.querySelector('figcaption');
    var sc = new Screen(holder, im0.sizes), last = F.list[F.main - 1];
    sc.imgs[last.img] = im0; sc.cur = im0; sc.key = last.img;
    seqs.push({ fig: fig, sc: sc, F: F, cap: cap, i: F.main - 1, timer: 0, im0: im0 });
  });
  function seqStep(s) {
    s.i = (s.i + 1) % s.F.list.length;
    var f = s.F.list[s.i];
    s.fig.classList.add('seq'); s.im0.classList.add('on');
    s.sc.show(f);
    s.cap.innerHTML = '<b>' + f.title + tierTag(f.plan) + '</b>' + f.cap + ' Example job.';
  }
  if (!still && window.IntersectionObserver) {
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var s = seqs.filter(function (x) { return x.fig === e.target; })[0]; if (!s) return;
        clearInterval(s.timer); s.timer = 0;
        if (e.isIntersecting && s.F.list.length > 1) { s.i = -1; seqStep(s); s.timer = setInterval(function () { seqStep(s); }, 2400); }
      });
    }, { threshold: 0.55 });
    seqs.forEach(function (s) { so.observe(s.fig); });
  }

  /* ---------- title block, schedule chart, sheet title ---------- */
  var figEls = {}, figSeen = {};
  all('#titleblock [data-fig]').forEach(function (el) { figEls[el.getAttribute('data-fig')] = el; });
  var rows = all('.g-row'), gantt = $('gantt'), sheetTitle = $('sheetTitle'), legend = $('legend'), replay = $('replay');
  var ENDS = [0].concat(D.STAGES.slice(1).map(function (s) { return s.b; })), PS = [0, 1, 2, 3, 4, 5];
  if (gantt) gantt.style.setProperty('--f', D.TODAY);
  var uiStage = -1;
  function ui(p) {
    var stage = p < 0.5 ? 0 : clamp(Math.round(p), 1, 5), f = interp(p, PS, ENDS);
    if (gantt) gantt.style.setProperty('--h', f.toFixed(4));
    rows.forEach(function (r, i) {
      var s = D.STAGES[i + 1], k = clamp((f - s.a) / (s.b - s.a), 0, 1);
      r.style.setProperty('--k', k.toFixed(3));
    });
    if (legend) legend.classList.toggle('on', p > 2.5 && p < 3.2);
    if (stage !== uiStage) {
      uiStage = stage;
      rows.forEach(function (r, i) { r.classList.toggle('on', i + 1 === stage); r.classList.toggle('done', i + 1 < stage); if (i + 1 === stage) r.setAttribute('aria-current', 'step'); else r.removeAttribute('aria-current'); });
      if (sheetTitle) sheetTitle.textContent = stage ? D.STAGES[stage].sheet : 'The Job';
      if (replay) replay.hidden = !(stage === 0 && live && !reduce && !frozen);
      D.FIGS.forEach(function (g) {
        var el = figEls[g.id]; if (!el) return;
        el.classList.toggle('now', g.stage === stage);
        if (g.stage === stage && !figSeen[g.id]) { figSeen[g.id] = 1; countText(el.querySelector('dd'), g.value, 900); }
      });
      if (draw && draw.over()) draw.view(null);
    }
    showDevice(stage, p);
  }

  /* ---------- scroll to place ---------- */
  var ys = [], F = 0, intro = { on: false, t0: 0 };
  function measure() {
    var vh = window.innerHeight, sy = window.pageYOffset;
    if (wide()) F = vh / 2;
    else { var sh = sceneWrap.offsetHeight; F = sh + (vh - sh) * 0.42; }
    var y0 = wide() ? vh / 2 : sceneWrap.getBoundingClientRect().top + sy - sceneWrap.offsetTop + sceneWrap.offsetTop + F;
    if (!wide()) { /* the place where the drawing has just pinned to the top */ y0 = heroEl.getBoundingClientRect().top + sy + heroEl.offsetHeight + F; }
    ys = [y0];
    articles.forEach(function (a) { var r = a.getBoundingClientRect(); ys.push(wide() ? r.top + sy + r.height / 2 : r.top + sy + Math.min(r.height / 2, (vh - F) * 0.9)); });
    for (var i = 1; i < ys.length; i++) if (ys[i] <= ys[i - 1]) ys[i] = ys[i - 1] + 1;
  }
  function scrollP() { return interp(window.pageYOffset + F, ys, PS); }
  function yFor(p) { return interp(p, PS, ys) - F; }
  function drive() {
    var p;
    if (forced !== null) p = forced;
    else { p = scrollP(); if (reduce) p = p < 0.5 ? 0 : Math.round(p); }
    if (intro.on) {
      if (p > 0.03) intro.on = false;
      else {
        var k = clamp((performance.now() - intro.t0) / 5200, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        if (k >= 1) { intro.on = false; if (draw) { draw.set(0); draw.settle(); } }
        else { if (draw) draw.set(0.3 + e * 4.26); requestAnimationFrame(drive); P = 0; ui(0); return; }
      }
    }
    P = p;
    if (draw) draw.set(p);
    ui(p);
    placePins();
  }
  function goStage(n) {
    closePanel(false);
    window.scrollTo({ top: Math.max(0, n ? yFor(n) : 0), behavior: reduce ? 'auto' : 'smooth' });
  }
  if (live) {
    measure();
    var ticking = false;
    window.addEventListener('scroll', function () { if (ticking) return; ticking = true; requestAnimationFrame(function () { ticking = false; drive(); }); }, { passive: true });
    window.addEventListener('resize', function () { measure(); drive(); });
    window.addEventListener('load', function () { measure(); drive(); });
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { measure(); drive(); });
    if (Q.view && draw) draw.view(Q.view);
    drive();
    if (Q.pin) { var qp = D.PINS.filter(function (x) { return x.id === Q.pin; })[0]; if (qp) showPanel(qp, pinEls[D.PINS.indexOf(qp)]); }
    /* once, when the page opens at the top: the job is drawn from the plan to the finished rooms */
    function playIntro() { if (reduce || frozen || !draw) return; intro.on = true; intro.t0 = performance.now(); drive(); }
    if (window.pageYOffset < 4) setTimeout(playIntro, 350);
    if (replay) replay.addEventListener('click', playIntro);

    rows.forEach(function (r) { r.addEventListener('click', function (e) { if (dragged) { e.preventDefault(); return; } goStage(+r.getAttribute('data-go')); }); });
    /* drag along the chart to scrub the job */
    var dragging = false, dragged = false, x0 = 0;
    function scrub(e) {
      var tr = rows[0].querySelector('.g-track').getBoundingClientRect(), f = clamp((e.clientX - tr.left) / tr.width, 0, 1);
      window.scrollTo(0, Math.max(0, yFor(interp(f, ENDS, PS))));
    }
    gantt.addEventListener('pointerdown', function (e) { if (!wide() || e.button) return; dragging = true; dragged = false; x0 = e.clientX; });
    window.addEventListener('pointermove', function (e) { if (!dragging) return; if (!dragged && Math.abs(e.clientX - x0) < 5) return; dragged = true; root.style.scrollBehavior = 'auto'; scrub(e); });
    window.addEventListener('pointerup', function () { if (!dragging) return; dragging = false; root.style.scrollBehavior = ''; setTimeout(function () { dragged = false; }, 0); });
  } else {
    rows.forEach(function (r) { r.addEventListener('click', function () { var a = $('stage' + r.getAttribute('data-go')); if (a) a.scrollIntoView(); }); });
  }

  /* ---------- your prices, not ours: close a job and watch the book change ---------- */
  var closeBtn = $('closeJob'), bookN = $('bookN'), bookRows = all('#bookRows li');
  var LEARN = [[2, '$640 each'], [3, '$6.90 per sq ft'], [4, '$195 each'], [0, '$3.25 per sq ft']], closed = 0, orig = bookRows.map(function (li) { return li.innerHTML; });
  if (closeBtn) {
    closeBtn.hidden = false;
    closeBtn.addEventListener('click', function () {
      if (closed >= LEARN.length) { closed = 0; bookRows.forEach(function (li, i) { li.innerHTML = orig[i]; }); bookN.textContent = '0'; closeBtn.textContent = 'Close A Job'; return; }
      var L = LEARN[closed], li = bookRows[L[0]]; closed++;
      bookN.textContent = String(closed);
      var src = li.querySelector('.src'), val = li.querySelector('b');
      src.className = 'src job'; src.textContent = 'From Your Closed Jobs';
      countText(val, L[1], 700);
      if (closed >= LEARN.length) closeBtn.textContent = 'Start Over';
    });
  }

  /* ---------- in testing ---------- */
  var ts = $('testingShots');
  if (ts) D.TESTING.forEach(function (t) {
    var fig = doc.createElement('figure'), flag = doc.createElement('span'), ph = doc.createElement('div'), scr = doc.createElement('div'), cap = doc.createElement('figcaption');
    flag.className = 'flag'; flag.textContent = 'In Testing';
    ph.className = 'phone'; scr.className = 'phone-screen'; ph.appendChild(scr);
    var start = t.frames.length > 2 ? 2 : 0, im = shotImg(t.frames[start].img, t.frames[start].alt, '220px'); im.loading = 'lazy'; scr.appendChild(im);
    cap.innerHTML = '<b>' + t.title + '</b>' + t.line + ' In testing. Not in the app yet.';
    fig.appendChild(flag); fig.appendChild(ph); fig.appendChild(cap);
    if (t.frames.length > 1) {
      var tabs = doc.createElement('div'); tabs.className = 'tabs'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', t.title + ': pick a week');
      t.frames.forEach(function (f, i) {
        var b = doc.createElement('button'); b.type = 'button'; b.textContent = f.label; b.setAttribute('aria-pressed', i === start ? 'true' : 'false');
        b.addEventListener('click', function () { im.srcset = 'img/screens/' + f.img + '-1x.webp 393w, img/screens/' + f.img + '-2x.webp 786w'; im.src = 'img/screens/' + f.img + '-1x.webp'; im.alt = f.alt; all('button', tabs).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); });
        tabs.appendChild(b);
      });
      fig.appendChild(tabs);
    }
    ts.appendChild(fig);
  });
})();
