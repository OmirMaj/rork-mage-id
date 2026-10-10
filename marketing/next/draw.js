/* MAGE ID marketing preview: the drawing.
   One small job (30 ft by 22 ft 6 in, four rooms and an entry) drawn the way a
   builder's set is drawn: a plan, a cutaway axonometric and a section, in ink
   linework on paper. It is an illustration. Plain canvas, no 3D engine.
   p is the place in the job: 0 the finished job, 1 the plan, 2 planned walls,
   3 framing and rough-in, 4 board and finishes, 5 handover. It only draws when
   something changes. */
window.MageDraw = function (canvas, opts) {
  'use strict';
  opts = opts || {};
  var ctx = canvas.getContext('2d');
  if (!ctx) return null;

  var INK = '#161B1E', GRAPH = '#566067', HAIR = '#8E9794', GREEN = '#2F6B3A', TEAL = '#12806E', WARM = '#B4531A';
  var COLD = '#2A6FB0', HOT = '#B8402A', ELEC = '#A87B0C';
  var PAPER = opts.paper || '#FBFBF9', WHITE = '#FFFFFF', CARD1 = '#F6F6F3', CARD2 = '#E7E9E5', POCHE = '#2A3135', SLAB = '#FBFBF9';
  var BW = 30, BD = 22.5, FULL = 8, CUT = 4, TH = 0.25, CUTY = 19.2, CX = 15, CY = 11.25;
  var FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

  /* ax x: the wall runs across at depth c. ax y: it runs front to back at x = c.
     open t: w window, d door, o cased opening. full: drawn full height (the two far walls); the rest are cut at 4 ft so you can see in. */
  var WALLS = [
    { id: 'N', ax: 'x', c: 0, s: 0, e: 30, full: 1, open: [{ s: 4, e: 9, t: 'w' }, { s: 21.5, e: 26.5, t: 'w' }] },
    { id: 'W', ax: 'y', c: 0, s: 0, e: 22.5, full: 1, open: [{ s: 4, e: 9, t: 'w' }, { s: 15.5, e: 19.5, t: 'w' }] },
    { id: 'P2', ax: 'y', c: 18, s: 0, e: 12.5, open: [{ s: 3, e: 9.5, t: 'o' }] },
    { id: 'P1', ax: 'x', c: 12.5, s: 0, e: 30, open: [{ s: 9.5, e: 12.3, t: 'd', sw: -1 }, { s: 23, e: 27, t: 'o' }] },
    { id: 'P3', ax: 'y', c: 13, s: 12.5, e: 22.5, open: [] },
    { id: 'P4', ax: 'y', c: 21, s: 12.5, e: 22.5, open: [{ s: 14, e: 16.7, t: 'd', sw: 1 }] },
    { id: 'E', ax: 'y', c: 30, s: 0, e: 22.5, open: [{ s: 4, e: 8, t: 'w' }] },
    { id: 'S', ax: 'x', c: 22.5, s: 0, e: 30, open: [{ s: 4, e: 9, t: 'w' }, { s: 15.5, e: 18.5, t: 'w' }, { s: 24, e: 27, t: 'd', sw: -1 }] }
  ];
  var ROOMS = [
    { n: 'Living', x0: 0, y0: 0, x1: 18, y1: 12.5, lx: 9, ly: 6.4, fin: 'wood', size: '18\'-0" x 12\'-6"' },
    { n: 'Kitchen', x0: 18, y0: 0, x1: 30, y1: 12.5, lx: 24, ly: 9.4, fin: 'tile', size: '12\'-0" x 12\'-6"' },
    { n: 'Bedroom', x0: 0, y0: 12.5, x1: 13, y1: 22.5, lx: 6.5, ly: 16.2, fin: 'wood', size: '13\'-0" x 10\'-0"' },
    { n: 'Bath', x0: 13, y0: 12.5, x1: 21, y1: 22.5, lx: 17, ly: 16.6, fin: 'tile', size: '8\'-0" x 10\'-0"', open: 1 },
    { n: 'Entry', x0: 21, y0: 12.5, x1: 30, y1: 22.5, lx: 25.5, ly: 16.6, fin: 'tile', size: '9\'-0" x 10\'-0"' }
  ];
  var GRIDX = [[0, '1'], [13, '2'], [21, '3'], [30, '4']], GRIDY = [[0, 'A'], [12.5, 'B'], [22.5, 'C']];
  /* casework and fixtures as plain blocks: x0, y0, x1, y1, height */
  var CASE = [
    { b: [18.6, 0.35, 29.65, 2.4, 3], top: [[22.6, 0.75, 25.4, 2.0]] },
    { b: [27.6, 2.4, 29.65, 9.4, 3] },
    { b: [21, 5.4, 25.6, 8.2, 3], top: [[22.2, 6.0, 24.4, 7.6]] },
    { b: [13.4, 12.85, 17.6, 14.7, 2.8], top: [[14.6, 13.2, 16.4, 14.3]] },
    { b: [19.1, 12.85, 20.5, 14.9, 1.4] },
    { b: [13.35, 19.7, 18.4, 22.15, 1.7], top: [[13.75, 20.1, 18.0, 21.75]] }
  ];
  /* rough-in runs: thin coloured lines inside the walls */
  var MEP = [
    { c: COLD, pts: [[29.7, 22.2, 1.1], [29.7, 12.75, 1.1], [13.3, 12.75, 1.1], [13.3, 21, 1.1]] },
    { c: COLD, pts: [[29.7, 12.75, 1.1], [29.7, 0.3, 1.1], [24, 0.3, 1.1], [24, 0.3, 2.2]] },
    { c: COLD, pts: [[15.5, 12.75, 1.1], [15.5, 12.75, 2.2]] },
    { c: HOT, pts: [[29.4, 21.6, 1.55], [29.4, 13.0, 1.55], [13.6, 13.0, 1.55], [13.6, 21, 1.55], [13.6, 21, 3.6]] },
    { c: HOT, pts: [[29.4, 13.0, 1.55], [29.4, 0.6, 1.55], [24.5, 0.6, 1.55], [24.5, 0.6, 2.2]] },
    { c: HOT, pts: [[16, 13.0, 1.55], [16, 13.0, 2.2]] },
    { c: ELEC, box: 1, pts: [[27.6, 22.4, 3.4], [29.9, 22.4, 3.4], [29.9, 0.1, 3.4], [0.1, 0.1, 3.4], [0.1, 22.4, 3.4], [3, 22.4, 3.4]] },
    { c: ELEC, box: 1, pts: [[18, 0.1, 3.4], [18, 3, 3.4]] },
    { c: ELEC, box: 1, pts: [[0.1, 12.5, 3.4], [9.5, 12.5, 3.4]] },
    { c: ELEC, box: 1, pts: [[13, 22.4, 3.4], [13, 12.6, 3.4], [23, 12.6, 3.4]] }
  ];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sm(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
  function seg(p, a, b) { return clamp((p - a) / (b - a), 0, 1); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function wp(w, u, o, z) { return w.ax === 'x' ? [u, w.c + o, z] : [w.c + o, u, z]; }

  /* ---------- cut every wall into short pieces once, so far pieces can be drawn before near ones ---------- */
  WALLS.forEach(function (w, wi) {
    var cuts = [w.s, w.e], i, segs = [];
    w.i = wi;
    w.open.forEach(function (o) { cuts.push(o.s, o.e); });
    if (w.ax === 'y' && CUTY > w.s && CUTY < w.e) cuts.push(CUTY);
    cuts.sort(function (a, b) { return a - b; });
    for (i = 0; i < cuts.length - 1; i++) {
      var a = cuts[i], b = cuts[i + 1], kind = 's', op = null;
      if (b - a < 0.01) continue;
      w.open.forEach(function (o) { if (a >= o.s - 0.001 && b <= o.e + 0.001) { kind = o.t; op = o; } });
      var n = kind === 's' ? Math.ceil((b - a) / 2.6) : 1, j;
      for (j = 0; j < n; j++) {
        var u0 = a + (b - a) * j / n, u1 = a + (b - a) * (j + 1) / n;
        segs.push({ u0: u0, u1: u1, k: kind, op: op, r0: false, r1: false });
      }
    }
    segs.forEach(function (s2, k) {
      var pv = segs[k - 1], nx = segs[k + 1];
      s2.r0 = !pv || pv.k !== s2.k;
      s2.r1 = !nx || nx.k !== s2.k;
      if (s2.k === 's') { if (pv && pv.k === 'w') s2.w0 = 1; if (nx && nx.k === 'w') s2.w1 = 1; }
    });
    w.segs = segs;
    /* framing: plates, studs at 16 in on centre, kings, headers, sills and cripples, in the order they are stood */
    var L = [], u, hh = w.full ? FULL : CUT;
    function inOpen(x) { var r = null; w.open.forEach(function (o) { if (x > o.s + 0.05 && x < o.e - 0.05) r = o; }); return r; }
    L.push([wp(w, w.s, 0, 0.12), wp(w, w.e, 0, 0.12), 1]);
    for (u = w.s; u <= w.e + 0.001; u += 4 / 3) {
      var o = inOpen(u);
      if (!o) L.push([wp(w, u, 0, 0.12), wp(w, u, 0, hh), 0]);
      else if (o.t === 'w') { L.push([wp(w, u, 0, 0.12), wp(w, u, 0, 3), 0]); if (w.full) L.push([wp(w, u, 0, 7), wp(w, u, 0, hh), 0]); }
      else if (w.full) L.push([wp(w, u, 0, 6.9), wp(w, u, 0, hh), 0]);
    }
    L.push([wp(w, w.e, 0, 0.12), wp(w, w.e, 0, hh), 0]);
    w.open.forEach(function (o) {
      L.push([wp(w, o.s, 0, 0.12), wp(w, o.s, 0, hh), 0], [wp(w, o.e, 0, 0.12), wp(w, o.e, 0, hh), 0]);
      if (o.t === 'w') L.push([wp(w, o.s, 0, 3), wp(w, o.e, 0, 3), 1]);
      if (w.full) L.push([wp(w, o.s, 0, 7), wp(w, o.e, 0, 7), 1], [wp(w, o.s, 0, 6.7), wp(w, o.e, 0, 6.7), 1]);
    });
    if (w.full) L.push([wp(w, w.s, 0, FULL), wp(w, w.e, 0, FULL), 1], [wp(w, w.s, 0, FULL - 0.2), wp(w, w.e, 0, FULL - 0.2), 1]);
    w.studs = L;
  });

  /* ---------- camera ---------- */
  var VIEWS = { plan: [0, Math.PI / 2], axon: [0.62, 0.66], section: [0, 0] };
  var KEYS = [[0, 0.62, 0.66], [0.29, 0.62, 0.66], [0.3, 0, Math.PI / 2], [1.06, 0, Math.PI / 2], [1.62, 0.62, 0.66], [2.2, 0.62, 0.66], [3, 0.72, 0.64], [4, 0.52, 0.68], [5, 0.62, 0.66]];
  function baseCam(p) {
    var i;
    for (i = 0; i < KEYS.length - 1; i++) if (p <= KEYS[i + 1][0]) break;
    i = Math.min(i, KEYS.length - 2);
    var a = KEYS[i], b = KEYS[i + 1], k = sm(seg(p, a[0], b[0]));
    return [lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  }
  var P = 5, W = 0, H = 0, dpr = 1, cam = baseCam(0), over = null, free = false, last = 0, raf = 0, visible = true;
  var ca, sa, se, ce, sc = 10, ox = 0, oy = 0, GA = 1, pf = 0, sf = 0, da = 0, listeners = [];
  /* the part of the sheet the current pass draws into, and whether that pass is the small key plan under the section */
  var VX = 0, VY = 0, VW = 0, VH = 0, keyPass = false;

  function setTrig() { ca = Math.cos(cam[0]); sa = Math.sin(cam[0]); se = Math.sin(cam[1]); ce = Math.cos(cam[1]); }
  function raw(x, y, z) { var dx = x - CX, dy = y - CY; return [dx * ca - dy * sa, (dx * sa + dy * ca) * se - z * ce]; }
  function prj(x, y, z) { var dx = x - CX, dy = y - CY, yr = dx * sa + dy * ca; return [ox + (dx * ca - dy * sa) * sc, oy + (yr * se - z * ce) * sc, yr * ce + z * se]; }
  function pp(a) { return prj(a[0], a[1], a[2]); }
  function fit() {
    var x0 = -lerp(0.6, 6.2, da), x1 = BW + 3.7, y0 = -lerp(0.6, 6.2, da), y1 = BD + 3.7, z1 = lerp(8.4, 0, pf) + sf * 1.4, z0 = -sf * 2.2;
    var mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, i, r;
    for (i = 0; i < 8; i++) {
      r = raw(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0);
      if (r[0] < mnx) mnx = r[0]; if (r[0] > mxx) mxx = r[0]; if (r[1] < mny) mny = r[1]; if (r[1] > mxy) mxy = r[1];
    }
    var padX = Math.max(10, VW * 0.03), padT = Math.max(10, VH * 0.03), padB = Math.max(26, VH * 0.07);
    if (keyPass) { padT = 6; padB = Math.max(22, VH * 0.16); }
    else if (sf > 0.5) padB = Math.max(padB, 36); /* room for the view title under the section */
    else if (P > 2.5 && P < 3.2) padT = Math.max(padT, 30 * sm(seg(sf, 0.5, 1))); /* room for the legend above the section */
    sc = Math.min((VW - padX * 2) / (mxx - mnx), (VH - padT - padB) / (mxy - mny));
    ox = VX + VW / 2 - (mnx + mxx) / 2 * sc;
    oy = VY + padT + (VH - padT - padB) / 2 - (mny + mxy) / 2 * sc;
  }

  /* ---------- drawing helpers ---------- */
  function al(a) { ctx.globalAlpha = clamp(a, 0, 1) * GA; }
  function line3(a, b, k) {
    var A = pp(a), B = pp(b);
    if (k === undefined) k = 1;
    ctx.moveTo(A[0], A[1]); ctx.lineTo(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k);
  }
  function poly3(pts, k, close) {
    var q = pts.map(pp), i, tot = 0, d = [], n = close ? q.length : q.length - 1;
    for (i = 0; i < n; i++) { var a = q[i], b = q[(i + 1) % q.length]; d[i] = Math.hypot(b[0] - a[0], b[1] - a[1]); tot += d[i]; }
    var left = tot * k;
    ctx.moveTo(q[0][0], q[0][1]);
    for (i = 0; i < n && left > 0; i++) {
      var a2 = q[i], b2 = q[(i + 1) % q.length], t = d[i] > 0 ? Math.min(1, left / d[i]) : 1;
      ctx.lineTo(a2[0] + (b2[0] - a2[0]) * t, a2[1] + (b2[1] - a2[1]) * t);
      left -= d[i];
    }
  }
  function stroke(c, w, dash) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); }
  function text(s, x, y, size, color, weight, align, sp, halo) {
    ctx.font = (weight || 600) + ' ' + size + 'px ' + FONT;
    if ('letterSpacing' in ctx) ctx.letterSpacing = (sp === undefined ? size * 0.08 : sp) + 'px';
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
    if (halo) { ctx.strokeStyle = PAPER; ctx.lineWidth = Math.max(3, size * 0.34); ctx.lineJoin = 'round'; ctx.setLineDash([]); ctx.strokeText(s.toUpperCase(), x, y); }
    ctx.fillText(s.toUpperCase(), x, y);
  }
  /* a view title the way a sheet letters one: the name over a rule, a note under it. Right aligned at x, sitting on y. */
  function title(name, note, x, y, a) {
    var fs = clamp(Math.min(W, H * 1.3) / 46, 8.5, 12.5), tw;
    ctx.font = '700 ' + fs * 1.08 + 'px ' + FONT; if ('letterSpacing' in ctx) ctx.letterSpacing = fs * 0.1 + 'px';
    tw = Math.max(ctx.measureText(name.toUpperCase()).width, fs * 6);
    al(a); text(name, x, y - fs * 1.75, fs * 1.08, INK, 700, 'right', fs * 0.1, true);
    ctx.beginPath(); ctx.moveTo(x - tw, y - fs * 0.98); ctx.lineTo(x, y - fs * 0.98); stroke(INK, 1.1);
    text(note, x, y - fs * 0.3, fs * 0.8, GRAPH, 600, 'right', fs * 0.06, true);
  }
  var faces = [];
  function face(pts, nx, ny, nz, fill, edges, a, hatch) {
    if (nx * sa * ce + ny * ca * ce + nz * se < 0.004) return;
    var q = pts.map(pp);
    faces.push({ q: q, d: (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4 + (nz > 0 ? 0.02 : 0), fill: fill, e: edges, a: a, h: hatch });
  }
  function box(x0, y0, x1, y1, z0, z1, a, o) {
    /* o: which ends are real edges, and the top colour */
    o = o || {};
    var top = o.top || WHITE, ex = o.ex === undefined ? 15 : o.ex, cutF = o.cutFace;
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0, 0, 1, top, o.topE === undefined ? 15 : o.topE, a);
    face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 0, 1, 0, cutF === 'y1' ? POCHE : CARD1, o.yE === undefined ? 15 : o.yE, a, cutF === 'y1h');
    face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0, -1, 0, CARD1, o.yE === undefined ? 15 : o.yE, a);
    if (ex & 2) face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], 1, 0, 0, CARD2, o.xE === undefined ? 15 : o.xE, a);
    if (ex & 1) face([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], -1, 0, 0, CARD2, o.xE === undefined ? 15 : o.xE, a);
  }
  /* a wall piece as a box in the wall's own directions. Edge bits: 1 bottom, 2 far vertical, 4 top, 8 near vertical. */
  function piece(w, s2, z0, z1, a, realEnds) {
    var r0 = realEnds ? s2.r0 : false, r1 = realEnds ? s2.r1 : false;
    var long = 5 | (r1 ? 2 : 0) | (r0 ? 8 : 0), topE = 5 | (r1 ? 2 : 0) | (r0 ? 8 : 0);
    var cutEnd = w.ax === 'y' && Math.abs(s2.u1 - CUTY) < 0.001 && sf > 0.5;
    if (w.ax === 'x') {
      face([[s2.u0, w.c - TH, z1], [s2.u1, w.c - TH, z1], [s2.u1, w.c + TH, z1], [s2.u0, w.c + TH, z1]], 0, 0, 1, POCHE, topE, a);
      face([[s2.u0, w.c + TH, z0], [s2.u1, w.c + TH, z0], [s2.u1, w.c + TH, z1], [s2.u0, w.c + TH, z1]], 0, 1, 0, CARD1, long, a);
      face([[s2.u0, w.c - TH, z0], [s2.u1, w.c - TH, z0], [s2.u1, w.c - TH, z1], [s2.u0, w.c - TH, z1]], 0, -1, 0, CARD1, long, a);
      if (r1) face([[s2.u1, w.c - TH, z0], [s2.u1, w.c + TH, z0], [s2.u1, w.c + TH, z1], [s2.u1, w.c - TH, z1]], 1, 0, 0, CARD2, 15, a);
      if (r0) face([[s2.u0, w.c - TH, z0], [s2.u0, w.c + TH, z0], [s2.u0, w.c + TH, z1], [s2.u0, w.c - TH, z1]], -1, 0, 0, CARD2, 15, a);
    } else {
      face([[w.c - TH, s2.u0, z1], [w.c - TH, s2.u1, z1], [w.c + TH, s2.u1, z1], [w.c + TH, s2.u0, z1]], 0, 0, 1, POCHE, topE, a);
      face([[w.c + TH, s2.u0, z0], [w.c + TH, s2.u1, z0], [w.c + TH, s2.u1, z1], [w.c + TH, s2.u0, z1]], 1, 0, 0, CARD2, long, a);
      face([[w.c - TH, s2.u0, z0], [w.c - TH, s2.u1, z0], [w.c - TH, s2.u1, z1], [w.c - TH, s2.u0, z1]], -1, 0, 0, CARD2, long, a);
      if (r1 || cutEnd) face([[w.c - TH, s2.u1, z0], [w.c + TH, s2.u1, z0], [w.c + TH, s2.u1, z1], [w.c - TH, s2.u1, z1]], 0, 1, 0, cutEnd ? POCHE : CARD1, 15, a);
      if (r0) face([[w.c - TH, s2.u0, z0], [w.c + TH, s2.u0, z0], [w.c + TH, s2.u0, z1], [w.c - TH, s2.u0, z1]], 0, -1, 0, CARD1, 15, a);
    }
  }
  function frontA(y) { return y > CUTY - 0.01 ? 1 - sf : 1; }

  /* ---------- one frame ---------- */
  function state(p) {
    faces.length = 0;
    var fs = clamp(Math.min(W, H * 1.3) / 46, 8.5, 12.5), i;
    var solid = p >= 3, done = p >= 4.999;

    /* structure grid with bubbles */
    var kg = sm(seg(p, 0.3, 0.52));
    if (kg > 0) {
      ctx.beginPath();
      GRIDX.forEach(function (g) { line3([g[0], BD + 2.4, 0], [g[0], -1.0, 0], kg); });
      GRIDY.forEach(function (g) { line3([BW + 2.4, g[0], 0], [-1.0, g[0], 0], kg); });
      al(0.75 * (1 - sf)); stroke(HAIR, 0.8, [9, 3, 1.5, 3]);
      var rb = fs * 0.95;
      GRIDX.concat(GRIDY).forEach(function (g, k) {
        var c = k < GRIDX.length ? prj(g[0], BD + 2.4 + rb / sc, 0) : prj(BW + 2.4 + rb / sc, g[0], 0);
        al(kg * (1 - sf));
        ctx.beginPath(); ctx.arc(c[0], c[1], rb, 0, 6.2832); ctx.fillStyle = '#FFFFFF'; ctx.fill(); stroke(GRAPH, 0.9);
        text(g[1], c[0], c[1] + 0.5, fs, INK, 600, 'center', 0);
      });
    }

    /* slab */
    var ks = p >= 1 ? 1 : 0;
    var slabA = sm(seg(p, 0.42, 0.6));
    if (slabA > 0) {
      var yEnd = sf > 0.5 ? CUTY : BD + 0.25, q = [[-0.25, -0.25, 0], [BW + 0.25, -0.25, 0], [BW + 0.25, yEnd, 0], [-0.25, yEnd, 0]].map(pp);
      if (pf < 0.999) {
        /* the slab's thickness, seen on its near edges */
        var f1 = [[-0.25, yEnd, -0.5], [BW + 0.25, yEnd, -0.5], [BW + 0.25, yEnd, 0], [-0.25, yEnd, 0]].map(pp), f2 = [[BW + 0.25, -0.25, -0.5], [BW + 0.25, yEnd, -0.5], [BW + 0.25, yEnd, 0], [BW + 0.25, -0.25, 0]].map(pp);
        [f1, f2].forEach(function (f, k) {
          if (k === 1 && sa < 0.01) return;
          al(slabA * (1 - pf)); ctx.beginPath(); ctx.moveTo(f[0][0], f[0][1]); for (i = 1; i < 4; i++) ctx.lineTo(f[i][0], f[i][1]); ctx.closePath();
          ctx.fillStyle = k === 0 && sf > 0.5 ? '#C9CDC9' : CARD2; ctx.fill(); stroke(INK, 0.9);
        });
      }
      al(slabA * (1 - sf)); ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]); ctx.closePath(); ctx.fillStyle = SLAB; ctx.fill(); stroke(INK, 0.7);
    }
    ks = ks;

    /* floor finishes: flat tones and a fine joint pattern, room by room */
    ROOMS.forEach(function (r, k) {
      var kf = sm(seg(p, 3.5 + k * 0.07, 3.72 + k * 0.07)); if (kf <= 0 || sf > 0.9) return;
      var x1 = lerp(r.x0, r.x1, kf), c = [[r.x0 + TH, r.y0 + TH, 0.01], [x1 - TH, r.y0 + TH, 0.01], [x1 - TH, r.y1 - TH, 0.01], [r.x0 + TH, r.y1 - TH, 0.01]].map(pp), j;
      al(1 - sf); ctx.beginPath(); ctx.moveTo(c[0][0], c[0][1]); for (j = 1; j < 4; j++) ctx.lineTo(c[j][0], c[j][1]); ctx.closePath();
      ctx.fillStyle = r.fin === 'wood' ? '#EFE9DC' : '#E3E8E6'; ctx.fill();
      ctx.beginPath();
      if (r.fin === 'wood') for (j = r.y0 + 1; j < r.y1 - TH; j += 1) line3([r.x0 + TH, j, 0.01], [x1 - TH, j, 0.01]);
      else { for (j = r.y0 + 2; j < r.y1 - TH; j += 2) line3([r.x0 + TH, j, 0.01], [x1 - TH, j, 0.01]); for (j = r.x0 + 2; j < x1 - TH; j += 2) line3([j, r.y0 + TH, 0.01], [j, r.y1 - TH, 0.01]); }
      al(0.5 * (1 - sf)); stroke(r.fin === 'wood' ? '#C9BFA9' : '#B9C2BF', 0.6);
      if (kf < 1) { ctx.beginPath(); line3([x1 - TH, r.y0 + TH, 0.01], [x1 - TH, r.y1 - TH, 0.01]); al(1); stroke(GREEN, 1.4); }
    });

    /* the plan: wall lines, openings and door swings, stroked in */
    WALLS.forEach(function (w, wi) {
      var k = sm(seg(p, 0.44 + wi * 0.035, 0.6 + wi * 0.035)); if (k <= 0) return;
      var act = k < 1;
      ctx.beginPath();
      w.segs.forEach(function (s2) {
        if (s2.k !== 's') return;
        if (s2.r0 && s2.r1) poly3([wp(w, s2.u0, -TH, 0), wp(w, s2.u1, -TH, 0), wp(w, s2.u1, TH, 0), wp(w, s2.u0, TH, 0)], k, true);
        else {
          line3(wp(w, s2.u0, -TH, 0), wp(w, s2.u1, -TH, 0), k); line3(wp(w, s2.u0, TH, 0), wp(w, s2.u1, TH, 0), k);
          if (s2.r0) line3(wp(w, s2.u0, -TH, 0), wp(w, s2.u0, TH, 0), k);
          if (s2.r1 && k >= 1) line3(wp(w, s2.u1, -TH, 0), wp(w, s2.u1, TH, 0));
        }
      });
      al((solid ? 0.35 : 1) * frontA(w.ax === 'x' ? w.c : 0) * (1 - sf)); stroke(act ? GREEN : INK, act ? 1.3 : 1);
      var ko = sm(seg(p, 0.72, 0.9)); if (ko <= 0 || solid) return;
      ctx.beginPath();
      w.open.forEach(function (o) {
        if (o.t === 'w') { line3(wp(w, o.s, -0.08, 0), wp(w, o.e, -0.08, 0), ko); line3(wp(w, o.s, 0.08, 0), wp(w, o.e, 0.08, 0), ko); }
        if (o.t === 'd') {
          var r = o.e - o.s, n = 14, j, pts = [wp(w, o.s, 0, 0)];
          for (j = 0; j <= n * ko; j++) { var a = j / n * Math.PI / 2; pts.push(wp(w, o.s + Math.cos(a) * r, o.sw * Math.sin(a) * r, 0)); }
          poly3(pts.slice(1), 1); line3(wp(w, o.s, 0, 0), wp(w, o.s, o.sw * r, 0), ko);
        }
      });
      al(0.9 * (1 - sf)); stroke(GRAPH, 0.8);
    });

    /* planned walls: dashed outlines stand up where the plan says */
    WALLS.forEach(function (w, wi) {
      var k = sm(seg(p, 1.42 + wi * 0.05, 1.68 + wi * 0.05)), fade = 1 - sm(seg(p, 2.05 + wi * 0.05, 2.3 + wi * 0.05));
      /* a section cut before any wall stands shows the walls as planned, not an empty box */
      if (!keyPass && p >= 0.6) k = Math.max(k, sm(seg(sf, 0.5, 1)));
      if (k <= 0 || fade <= 0) return;
      var h = (w.full ? FULL : lerp(CUT, FULL, sf)) * k, c = [[w.s, -TH], [w.e, -TH], [w.e, TH], [w.s, TH]];
      /* a faint body, so a planned wall reads as a wall and not as loose lines */
      ctx.beginPath();
      w.segs.forEach(function (s2) {
        var z0 = s2.k === 's' ? 0 : s2.k === 'w' ? 7 : 6.8, bands = s2.k === 'w' ? [[0, Math.min(3, h)], [7, h]] : [[z0, h]];
        bands.forEach(function (b) {
          if (b[1] - b[0] < 0.05) return;
          var g = [wp(w, s2.u0, 0, b[0]), wp(w, s2.u1, 0, b[0]), wp(w, s2.u1, 0, b[1]), wp(w, s2.u0, 0, b[1])].map(pp);
          ctx.moveTo(g[0][0], g[0][1]); ctx.lineTo(g[1][0], g[1][1]); ctx.lineTo(g[2][0], g[2][1]); ctx.lineTo(g[3][0], g[3][1]); ctx.closePath();
        });
      });
      al(fade * frontA(w.ax === 'x' ? w.c : 0) * (w.full ? 0.07 : 0.1)); ctx.fillStyle = GREEN; ctx.fill();
      ctx.beginPath();
      poly3(c.map(function (m) { return wp(w, m[0], m[1], h); }), 1, true);
      c.forEach(function (m) { line3(wp(w, m[0], m[1], 0), wp(w, m[0], m[1], h)); });
      w.open.forEach(function (o) { var zt = o.t === 'w' ? 7 : 6.8; if (h < 3) return; ctx.rect(0, 0, 0, 0); poly3([wp(w, o.s, 0, o.t === 'w' ? 3 : 0), wp(w, o.s, 0, Math.min(h, zt)), wp(w, o.e, 0, Math.min(h, zt)), wp(w, o.e, 0, o.t === 'w' ? 3 : 0)], 1, o.t === 'w'); });
      al(fade * frontA(w.ax === 'x' ? w.c : 0) * 0.95); stroke(k < 1 ? GREEN : '#4E7F57', k < 1 ? 1.2 : 0.9, [5, 3]);
    });

    /* door and window tags on the planned walls, the way a drawing set keys its openings to a schedule */
    if (!keyPass && sf < 0.5 && pf < 0.5) {
      var nW = 0, nD = 0, rt = fs * 0.92;
      WALLS.forEach(function (w, wi) {
        var k = sm(seg(p, 1.56 + wi * 0.03, 1.7 + wi * 0.03)), fade = 1 - sm(seg(p, 2.05 + wi * 0.05, 2.3 + wi * 0.05));
        w.open.forEach(function (o) {
          if (o.t === 'o') return;
          var lab = o.t === 'w' ? 'W' + (++nW) : 'D' + (++nD);
          if (k <= 0 || fade <= 0) return;
          var c = prj.apply(null, wp(w, (o.s + o.e) / 2, 0, o.t === 'w' ? (w.full ? 5 : 3.4) : (w.full ? 3.6 : 2.6))), j;
          al(k * fade * frontA(w.ax === 'x' ? w.c : 0));
          ctx.beginPath();
          if (o.t === 'w') { for (j = 0; j < 6; j++) { var a = Math.PI / 6 + j * Math.PI / 3; if (j) ctx.lineTo(c[0] + Math.cos(a) * rt * 1.08, c[1] + Math.sin(a) * rt * 1.08); else ctx.moveTo(c[0] + Math.cos(a) * rt * 1.08, c[1] + Math.sin(a) * rt * 1.08); } ctx.closePath(); }
          else ctx.arc(c[0], c[1], rt, 0, 6.2832);
          ctx.fillStyle = PAPER; ctx.fill(); stroke(GREEN, 0.9);
          text(lab, c[0], c[1] + 0.5, fs * 0.78, GREEN, 700, 'center', 0);
        });
      });
    }

    /* framing: studs at 16 in on centre, stood wall by wall */
    var studFade = 1 - sm(seg(p, 3.08, 3.5));
    if (p > 2 && studFade > 0) WALLS.forEach(function (w, wi) {
      var k = seg(p, 2.04 + wi * 0.06, 2.2 + wi * 0.06); if (k <= 0) return;
      var n = w.studs.length, upto = k * n, hs = w.full ? 1 : lerp(1, 2, sf), a0 = frontA(w.ax === 'x' ? w.c : 0), nearW = (w.id === 'S' || w.id === 'E') ? 0.8 : 1;
      function grow(L2, t) { var b = L2[1]; return [L2[0], [lerp(L2[0][0], b[0], t), lerp(L2[0][1], b[1], t), lerp(L2[0][2], b[2] > 3.5 && !w.full && !L2[2] ? b[2] * hs : b[2], t)]]; }
      ctx.beginPath(); w.studs.forEach(function (L2, j) { if (j < Math.floor(upto) && !L2[2]) { var g = grow(L2, 1); line3(g[0], g[1]); } });
      al(studFade * a0 * nearW); stroke(GRAPH, 0.85);
      ctx.beginPath(); w.studs.forEach(function (L2, j) { if (j < Math.floor(upto) && L2[2]) line3(L2[0], L2[1]); });
      al(studFade * a0 * nearW); stroke(INK, 1.1);
      if (k < 1) { var cur = w.studs[Math.floor(upto)]; if (cur) { var g2 = grow(cur, upto % 1); ctx.beginPath(); line3(g2[0], g2[1]); al(1); stroke(GREEN, 1.6); } }
    });

    /* rough-in */
    if (p > 2.5 && studFade > 0) MEP.forEach(function (m, k) {
      var km = sm(seg(p, 2.56 + k * 0.03, 2.8 + k * 0.03)); if (km <= 0) return;
      ctx.beginPath(); poly3(m.pts, km); al(studFade * (1 - sf * 0.6)); stroke(m.c, 1.25);
      if (m.box && km >= 1) m.pts.forEach(function (pt, j) { if (!j) return; var c = pp(pt); al(studFade); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(c[0] - 2.5, c[1] - 2.5, 5, 5); ctx.strokeStyle = m.c; ctx.lineWidth = 1; ctx.strokeRect(c[0] - 2.5, c[1] - 2.5, 5, 5); });
    });

    /* board: the walls close as clean planes with ink edges */
    WALLS.forEach(function (w, wi) {
      var k = sm(seg(p, 3.06 + wi * 0.05, 3.34 + wi * 0.05)); if (k <= 0) return;
      var h = w.full ? FULL : lerp(CUT, FULL, sf);
      w.segs.forEach(function (s2) {
        var a = k * (w.ax === 'x' ? frontA(w.c) : frontA((s2.u0 + s2.u1) / 2 + 0.02)); if (a <= 0.02) return;
        if (s2.k === 's') piece(w, s2, 0, h, a, true);
        else if (s2.k === 'w') {
          piece(w, s2, 0, 3, a, false);
          if (h > 7) piece(w, s2, 7, h, a, false);
          var zt = Math.min(h, 7), g = [wp(w, s2.u0, 0, 3), wp(w, s2.u1, 0, 3), wp(w, s2.u1, 0, zt), wp(w, s2.u0, 0, zt)].map(pp);
          faces.push({ q: g, d: (g[0][2] + g[2][2]) / 2, fill: 'rgba(196,212,214,0.42)', e: 15, a: a, glass: 1 });
        } else if (h > 6.8) piece(w, s2, 6.8, h, a, false);
      });
    });

    /* casework and fixtures: plain blocks */
    CASE.forEach(function (c, k) {
      var kc = sm(seg(p, 4.08 + k * 0.05, 4.3 + k * 0.05)); if (kc <= 0) return;
      var b = c.b, a = frontA((b[1] + b[3]) / 2); if (a <= 0.02) return;
      box(b[0], b[1], b[2], b[3], 0, b[4] * kc, a);
      if (c.top && kc >= 1) c.top.forEach(function (t) { var g = [[t[0], t[1], b[4] + 0.01], [t[2], t[1], b[4] + 0.01], [t[2], t[3], b[4] + 0.01], [t[0], t[3], b[4] + 0.01]].map(pp); if (se > 0.05) faces.push({ q: g, d: (g[0][2] + g[2][2]) / 2 + 0.05, fill: CARD1, e: 15, a: a, thin: 1 }); });
    });

    faces.sort(function (a, b) { return a.d - b.d; });
    faces.forEach(function (f) {
      var q = f.q, j;
      al(f.a); ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (j = 1; j < 4; j++) ctx.lineTo(q[j][0], q[j][1]); ctx.closePath(); ctx.fillStyle = f.fill; ctx.fill();
      ctx.beginPath();
      for (j = 0; j < 4; j++) if (f.e & (1 << j)) { ctx.moveTo(q[j][0], q[j][1]); ctx.lineTo(q[(j + 1) % 4][0], q[(j + 1) % 4][1]); }
      stroke(f.glass || f.thin ? GRAPH : INK, f.glass || f.thin ? 0.7 : 1);
      if (f.glass) { ctx.beginPath(); ctx.moveTo((q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2); ctx.lineTo((q[2][0] + q[3][0]) / 2, (q[2][1] + q[3][1]) / 2); stroke(GRAPH, 0.7); }
    });

    /* section: ground line, ceiling line and a height dimension */
    if (sf > 0.6) {
      var g0 = prj(-3.5, CUTY, -0.5), g1 = prj(BW + 3.5, CUTY, -0.5), c0 = prj(-0.25, CUTY, 8), c1 = prj(BW + 0.25, CUTY, 8), sa2 = sm(seg(sf, 0.6, 1));
      al(sa2); ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); stroke(INK, 1.6);
      ctx.beginPath(); for (i = -3; i < BW + 3.5; i += 0.9) { var h0 = prj(i, CUTY, -0.5), h1 = prj(i - 0.6, CUTY, -1.2); ctx.moveTo(h0[0], h0[1]); ctx.lineTo(h1[0], h1[1]); } stroke(HAIR, 0.8);
      ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]); stroke(INK, 1);
      var d0 = prj(BW + 2, CUTY, 0), d1 = prj(BW + 2, CUTY, 8);
      ctx.beginPath(); ctx.moveTo(d0[0], d0[1]); ctx.lineTo(d1[0], d1[1]); ctx.moveTo(d0[0] - 4, d0[1] + 4); ctx.lineTo(d0[0] + 4, d0[1] - 4); ctx.moveTo(d1[0] - 4, d1[1] + 4); ctx.lineTo(d1[0] + 4, d1[1] - 4); stroke(GRAPH, 0.9);
      ctx.save(); ctx.translate(d0[0] + fs, (d0[1] + d1[1]) / 2); ctx.rotate(-Math.PI / 2); text('8\'-0"', 0, 0, fs, INK, 600); ctx.restore();
      ROOMS.slice(2).forEach(function (r) { var c = prj(r.lx, CUTY, 4.6); text(r.n, c[0], c[1], fs * 1.05, INK, 600); });
      title('Section A-A', 'Looking North', VX + VW - Math.max(12, W * 0.03), VY + VH - Math.max(12, H * 0.035), sa2);
    }

    /* dimension strings with tick marks */
    var kd = sm(seg(p, 0.76, 0.96));
    if (kd > 0 && da > 0.02) {
      var D = [[[0, -2.8], [13, -2.8], '13\'-0"'], [[13, -2.8], [21, -2.8], '8\'-0"'], [[21, -2.8], [30, -2.8], '9\'-0"'], [[0, -4.9], [30, -4.9], '30\'-0"'],
        [[-2.8, 0], [-2.8, 12.5], '12\'-6"'], [[-2.8, 12.5], [-2.8, 22.5], '10\'-0"'], [[-4.9, 0], [-4.9, 22.5], '22\'-6"']];
      D.forEach(function (d) {
        var A = prj(d[0][0], d[0][1], 0), B = prj(d[1][0], d[1][1], 0), horiz = d[0][1] === d[1][1];
        al(da * kd); ctx.beginPath();
        ctx.moveTo(A[0], A[1]); ctx.lineTo(A[0] + (B[0] - A[0]) * kd, A[1] + (B[1] - A[1]) * kd);
        [d[0], d[1]].forEach(function (e) {
          var w0 = horiz ? prj(e[0], -0.8, 0) : prj(-0.8, e[1], 0), w1 = horiz ? prj(e[0], e[1] - 0.5, 0) : prj(e[0] - 0.5, e[1], 0), t = prj(e[0], e[1], 0);
          ctx.moveTo(w0[0], w0[1]); ctx.lineTo(w1[0], w1[1]);
          ctx.moveTo(t[0] - 3.5, t[1] + 3.5); ctx.lineTo(t[0] + 3.5, t[1] - 3.5);
        });
        stroke(GRAPH, 0.8);
        var ang = Math.atan2(B[1] - A[1], B[0] - A[0]); if (ang > Math.PI / 2 + 0.01 || ang < -Math.PI / 2 - 0.01) ang += Math.PI;
        if (!horiz && pf > 0.9) ang = -Math.PI / 2;
        ctx.save(); ctx.translate((A[0] + B[0]) / 2, (A[1] + B[1]) / 2); ctx.rotate(ang); text(d[2], 0, -fs * 0.75, fs, INK, 600, 'center', 0.4); ctx.restore();
      });
      /* where the section is cut */
      var s0 = prj(BW + 1.6, CUTY, 0), s1 = prj(-1.4, CUTY, 0);
      al(da * kd * 0.9); ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s0[0] + (s1[0] - s0[0]) * kd, s0[1] + (s1[1] - s0[1]) * kd); stroke(GREEN, 0.9, [12, 3, 2, 3]);
      text('A', s0[0] + fs * 0.9, s0[1], fs * 1.05, GREEN, 700, 'center', 0);
    }

    /* room names */
    var kl = sm(seg(p, 0.84, 1));
    if (kl > 0 && sf < 0.4 && !(keyPass && sc < 5.2)) ROOMS.forEach(function (r, k) {
      var c = prj(r.lx, r.ly, 0), wNar = W < 420, kz = 1 - sm(seg(p, 2.3, 2.5));
      al(kl * (1 - sf * 2.5));
      text(r.n, c[0], c[1], fs * (keyPass ? 0.95 : 1.15), INK, 700, 'center', undefined, p > 1.3);
      if (!wNar && !keyPass && kz > 0) { al(kl * 0.85 * (1 - sf * 2.5) * (p < 1.5 ? 1 : 0.8) * kz); text(r.size, c[0], c[1] + fs * 1.25, fs * 0.86, GRAPH, 500, 'center', 0.3, p > 1.3); }
      var kc = sm(seg(p, 4.58 + k * 0.06, 4.74 + k * 0.06));
      if (kc > 0 && !opts.noMarks && !keyPass) {
        var warm = r.open, y = c[1] + fs * 1.5, tw, lab = warm ? '1 Open' : 'Closed';
        ctx.font = '600 ' + fs * 0.86 + 'px ' + FONT; tw = ctx.measureText(lab.toUpperCase()).width + fs * 1.9;
        al(kc); ctx.beginPath(); ctx.arc(c[0] - tw / 2 + fs * 0.45, y, fs * 0.56, 0, 6.2832); ctx.fillStyle = PAPER; ctx.fill(); ctx.beginPath(); ctx.arc(c[0] - tw / 2 + fs * 0.45, y, fs * 0.42, 0, 6.2832); ctx.fillStyle = warm ? WARM : TEAL; ctx.fill();
        if (!warm) { ctx.beginPath(); ctx.moveTo(c[0] - tw / 2 + fs * 0.22, y); ctx.lineTo(c[0] - tw / 2 + fs * 0.4, y + fs * 0.18); ctx.lineTo(c[0] - tw / 2 + fs * 0.68, y - fs * 0.18); stroke('#FFFFFF', 1.2); }
        text(lab, c[0] - tw / 2 + fs * 1.15, y + 0.5, fs * 0.86, warm ? WARM : TEAL, 600, 'left', 0.5, true);
      }
    });

    /* north arrow and scale bar: small, true details */
    var kn = sm(seg(p, 0.32, 0.5));
    if (kn > 0 && H > 200 && !keyPass) {
      var bx = Math.max(12, W * 0.03), by = VY + VH - Math.max(12, H * 0.035), ft = sc, len = ft * 10, half = ft * 5;
      al(kn * 0.95);
      ctx.fillStyle = INK; ctx.fillRect(bx, by - 4, half, 4); ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.strokeRect(bx, by - 4, len, 4);
      text('0', bx, by - 11, fs * 0.82, GRAPH, 600, 'center', 0); text('5', bx + half, by - 11, fs * 0.82, GRAPH, 600, 'center', 0); text('10 Ft', bx + len, by - 11, fs * 0.82, GRAPH, 600, 'center', 0.3);
      if (sf < 0.5) {
        var nx = bx + len + fs * 3.4, ny = by - fs * 0.9, r2 = fs * 1.05, an = -cam[0] - Math.PI / 2;
        al(kn * (1 - sf * 2)); ctx.beginPath(); ctx.arc(nx, ny, r2, 0, 6.2832); stroke(GRAPH, 0.9);
        ctx.beginPath(); ctx.moveTo(nx + Math.cos(an) * r2, ny + Math.sin(an) * r2 * lerp(se, 1, 0.5)); ctx.lineTo(nx + Math.cos(an + 2.5) * r2 * 0.7, ny + Math.sin(an + 2.5) * r2 * 0.7); ctx.lineTo(nx, ny); ctx.lineTo(nx + Math.cos(an - 2.5) * r2 * 0.7, ny + Math.sin(an - 2.5) * r2 * 0.7); ctx.closePath(); ctx.fillStyle = INK; ctx.fill();
        text('N', nx + Math.cos(an) * (r2 + fs * 0.7), ny + Math.sin(an) * (r2 + fs * 0.7), fs * 0.86, INK, 700, 'center', 0);
      }
    }
    ctx.globalAlpha = 1;
    return done;
  }

  /* on the key plan: the cut line, its two letters, and arrows for the way the section looks */
  function keyPlanMarks(a) {
    var fs = clamp(Math.min(W, H * 1.3) / 46, 8.5, 12.5), s0 = prj(-1.6, CUTY, 0), s1 = prj(BW + 1.6, CUTY, 0), r = fs * 0.78;
    /* what is in front of the cut is not in the section: tone it back */
    var f = [[-0.25, CUTY, 0], [BW + 0.25, CUTY, 0], [BW + 0.25, BD + 0.25, 0], [-0.25, BD + 0.25, 0]].map(pp), i;
    al(a * 0.62); ctx.beginPath(); ctx.moveTo(f[0][0], f[0][1]); for (i = 1; i < 4; i++) ctx.lineTo(f[i][0], f[i][1]); ctx.closePath(); ctx.fillStyle = PAPER; ctx.fill();
    al(a); ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); stroke(GREEN, 1.2, [12, 3, 2, 3]);
    [s0, s1].forEach(function (c, k) {
      var x = c[0] + (k ? r : -r);
      ctx.beginPath(); ctx.moveTo(x - r, c[1]); ctx.lineTo(x, c[1] - r * 1.9); ctx.lineTo(x + r, c[1]); ctx.closePath(); ctx.fillStyle = GREEN; ctx.fill();
      ctx.beginPath(); ctx.arc(x, c[1], r, 0, 6.2832); ctx.fillStyle = '#FFFFFF'; ctx.fill(); stroke(GREEN, 1);
      text('A', x, c[1] + 0.5, fs * 0.9, GREEN, 700, 'center', 0);
    });
    title('Key Plan', 'Section A-A Is Cut Here', VX + VW - Math.max(12, W * 0.03), VY + VH - Math.max(12, H * 0.035), a);
  }

  function draw() {
    raf = 0;
    if (!W || !H) return;
    var now = performance.now(), dt = Math.min(64, now - (last || now)); last = now;
    var p = P, heroA = 1;
    if (p < 0.3) { heroA = 1 - sm(seg(p, 0.05, 0.27)); }
    var target = over ? VIEWS[over] : baseCam(p), moving = false;
    if (over || free) {
      var k = opts.still ? 1 : 1 - Math.exp(-dt / 150);
      cam[0] += (target[0] - cam[0]) * k; cam[1] += (target[1] - cam[1]) * k;
      if (Math.abs(target[0] - cam[0]) + Math.abs(target[1] - cam[1]) < 0.003) { cam = target.slice(); if (!over) free = false; }
      else moving = true;
    } else cam = target;
    setTrig();
    pf = sm(seg(cam[1], 1.0, 1.5)); sf = 1 - sm(seg(cam[1], 0.04, 0.5));
    da = pf * (p < 0.3 ? 0 : 1) * (1 - sm(seg(p, 1.1, 1.5)) * 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    /* A section of a low, wide job is a thin strip. So the Section view is laid out like a sheet:
       the section on top, and under it a key plan that shows where the cut is and which way it looks. */
    var comp = sm(seg(sf, 0.5, 1)), split = Math.round(H * 0.5);
    if (comp > 0.01) {
      var keep = [cam[0], cam[1], pf, sf, da];
      cam = VIEWS.plan.slice(); setTrig(); pf = 1; sf = 0; da = 0; keyPass = true;
      VX = 0; VY = split; VW = W; VH = H - split; fit();
      GA = comp * (p < 0.3 ? heroA : 1); state(p < 0.3 ? 5 : Math.max(p, 1));
      GA = p < 0.3 ? heroA : 1; keyPlanMarks(comp);
      keyPass = false; cam = [keep[0], keep[1]]; setTrig(); pf = keep[2]; sf = keep[3]; da = keep[4];
      al(comp * 0.9); ctx.beginPath(); ctx.moveTo(Math.max(12, W * 0.03), split + 0.5); ctx.lineTo(W - Math.max(12, W * 0.03), split + 0.5); stroke(HAIR, 0.8);
    }
    VX = 0; VY = 0; VW = W; VH = lerp(H, split, comp); fit();
    if (p < 0.3) { GA = heroA; opts.noMarks = true; state(5); opts.noMarks = false; } else { GA = 1; state(p); }
    listeners.forEach(function (f) { f(api); });
    if (moving) { last = now; raf = requestAnimationFrame(draw); } else last = 0;
  }
  function invalidate() { if (!raf && visible) raf = requestAnimationFrame(draw); }
  function resize() {
    var r = canvas.getBoundingClientRect(), w = Math.round(r.width), h = Math.round(r.height);
    if (!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2);
    if (w !== W || h !== H || canvas.width !== Math.round(w * dpr)) { W = w; H = h; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    invalidate();
  }
  var api = {
    set: function (p) { p = clamp(p, 0, 5); if (Math.abs(p - P) < 0.0005) return; P = p; invalidate(); },
    get: function () { return P; },
    view: function (name) { if (name === over) return; if (!name) free = true; over = name || null; invalidate(); },
    viewName: function () { return cam[1] > 1.25 ? 'Plan' : cam[1] < 0.3 ? 'Section A-A' : 'Axonometric'; },
    over: function () { return over; },
    project: function (pt) { var q = pp(pt); return [q[0], q[1]]; },
    size: function () { return [W, H]; },
    onDraw: function (f) { listeners.push(f); },
    resize: resize, redraw: invalidate,
    show: function (v) { visible = v; if (v) invalidate(); },
    settle: function () { free = true; invalidate(); },
    now: function () { if (raf) cancelAnimationFrame(raf); raf = 0; draw(); }
  };
  if (opts.p !== undefined) P = opts.p;
  cam = baseCam(P);
  resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(invalidate);
  return api;
};
