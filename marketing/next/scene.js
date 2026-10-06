/* MAGE ID marketing preview: the building that goes up as you scroll.
   Plain SVG, no library. The drawing is a function of one number, s, from 0 to 5:
   0 empty lot, 1 Win It, 2 Plan It, 3 Build It, 4 Get Paid, 5 Close It.
   Reduce Motion: s snaps to whole stages and nothing runs on a timer. */
(function () {
  'use strict';
  var stageEl = document.getElementById('sceneStage');
  if (!stageEl || !document.createElementNS) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var NS = 'http://www.w3.org/2000/svg';
  var U = 40, CX = 0.866;

  function P(x, y, z) { return [(x - y) * CX * U, (x + y) * 0.5 * U - (z || 0) * U]; }
  function pts(a) { return a.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); }
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function g(parent, attrs) { return el('g', attrs || {}, parent); }
  function poly(parent, a, fill, extra) {
    var at = { points: pts(a), fill: fill };
    if (extra) for (var k in extra) at[k] = extra[k];
    return el('polygon', at, parent);
  }
  function line(parent, a, b, stroke, w, extra) {
    var at = { x1: a[0].toFixed(1), y1: a[1].toFixed(1), x2: b[0].toFixed(1), y2: b[1].toFixed(1), stroke: stroke, 'stroke-width': w || 1.5, 'stroke-linecap': 'round' };
    if (extra) for (var k in extra) at[k] = extra[k];
    return el('line', at, parent);
  }
  function top(parent, x0, y0, x1, y1, z, fill, extra) { return poly(parent, [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], fill, extra); }
  function left(parent, x0, x1, z0, z1, y, fill, extra) { return poly(parent, [P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)], fill, extra); }
  function right(parent, y0, y1, z0, z1, x, fill, extra) { return poly(parent, [P(x, y0, z0), P(x, y1, z0), P(x, y1, z1), P(x, y0, z1)], fill, extra); }
  function box(parent, x, y, z, dx, dy, dz, c) {
    var grp = g(parent);
    left(grp, x, x + dx, z, z + dz, y + dy, c[1]);
    right(grp, y, y + dy, z, z + dz, x + dx, c[2]);
    top(grp, x, y, x + dx, y + dy, z + dz, c[0]);
    return grp;
  }
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(k) { return k * k * (3 - 2 * k); }

  var C = {
    ink: '#14181A', green: '#2F6B3A', greenD: '#24542D', greenL: '#4C8A57', teal: '#12806E', yellow: '#EDB52A', yellowD: '#C9951A',
    plat: ['#DFE1DB', '#B4B8AE', '#C4C7BF'],
    street: '#353B3D', walk: ['#E9EAE5', '#C9CCC4', '#D6D8D1'],
    dirt: '#CBC1AE', dirtD: '#B9AE99',
    nA: ['#D7D9D3', '#C3C6BE', '#AEB2A9'], nB: ['#CFC8BE', '#BBB2A6', '#A69C8F'],
    con: ['#F8F8F5', '#E4E5E0', '#CED0C9'], glass: '#D9E7DA', lit: '#F3DF93', wood: ['#E2D2AC', '#CDBB90', '#B9A77C']
  };

  var VIEW_WIDE = [-630, -455, 1045, 965], VIEW_TIGHT = [-330, -345, 600, 700];
  var svg = el('svg', { viewBox: VIEW_WIDE.join(' '), preserveAspectRatio: 'xMidYMid meet', role: 'group', 'aria-label': 'Interactive drawing of a building going up on a New York corner lot. The dots open example job details.' }, stageEl);

  /* ---- timeline registry ---- */
  var items = [];
  function reg(node, a, b, o) {
    o = o || {};
    items.push({ n: node, a: a, b: b, c: o.out ? o.out[0] : null, d: o.out ? o.out[1] : null, dy: o.dy == null ? 26 : o.dy, last: -1 });
    return node;
  }

  /* ================= static world ================= */
  var world = g(svg);
  // diorama slab
  poly(world, [P(-6.5, 11, -0.7), P(10.5, 11, -0.7), P(10.5, -1, -0.7), P(11.5, 0, -0.7), P(11.5, 12, -0.7), P(-5.5, 12, -0.7)], C.ink, { opacity: 0.1 });
  box(world, -6.5, -1, -0.7, 17, 12, 0.7, C.plat);
  // streets
  top(world, -6.5, 8.3, 10.5, 11, 0, C.street);
  top(world, 8, -1, 10.5, 8.3, 0, C.street);
  var x, y, i, f;
  for (x = -6; x < 7.2; x += 1.5) top(world, x, 9.61, x + 0.7, 9.69, 0, '#ECEDE9', { opacity: 0.75 });
  for (y = -0.6; y < 7.6; y += 1.5) top(world, 9.21, y, 9.29, y + 0.7, 0, '#ECEDE9', { opacity: 0.75 });
  for (y = 8.5; y < 10.85; y += 0.46) top(world, 7.05, y, 7.85, y + 0.22, 0, '#ECEDE9', { opacity: 0.9 });
  for (x = 8.25; x < 10.4; x += 0.46) top(world, x, 7.3, x + 0.22, 8.1, 0, '#ECEDE9', { opacity: 0.9 });
  // sidewalks
  box(world, -6.5, 7, 0, 14.5, 1.3, 0.09, C.walk);
  box(world, 7, -1, 0, 1, 8, 0.09, C.walk);
  for (x = -5.5; x < 8; x += 1) line(world, P(x, 7, 0.09), P(x, 8.3, 0.09), '#C9CCC4', 1);
  for (y = 0; y < 7; y += 1) line(world, P(7, y, 0.09), P(8, y, 0.09), '#C9CCC4', 1);
  // back strip behind the buildings
  top(world, -6.5, -1, 7, 0.2, 0.001, '#D3D5CF');

  function windowsLeft(parent, x0, x1, z0, n, w, h, y, fill) {
    var gap = (x1 - x0 - n * w) / (n + 1);
    for (var k = 0; k < n; k++) { var xa = x0 + gap + k * (w + gap); left(parent, xa, xa + w, z0, z0 + h, y, fill); }
  }
  function windowsRight(parent, y0, y1, z0, n, w, h, x, fill) {
    var gap = (y1 - y0 - n * w) / (n + 1);
    for (var k = 0; k < n; k++) { var ya = y0 + gap + k * (w + gap); right(parent, ya, ya + w, z0, z0 + h, x, fill); }
  }

  // neighbour B: brownstone with a stoop and cornice
  var nb = g(world);
  box(nb, -6.5, 1.4, 0, 2.7, 5.6, 4.5, C.nB);
  for (f = 0; f < 3; f++) windowsLeft(nb, -6.5, -3.8, 0.55 + f * 1.4, 2, 0.6, 0.85, 7, f === 0 ? '#8C8378' : '#90877C');
  box(nb, -6.6, 6.9, 4.5, 2.9, 0.22, 0.2, ['#DDD6CC', '#C9C0B4', '#B3A99C']);
  box(nb, -4.9, 7, 0, 0.7, 0.5, 0.36, ['#D8D1C7', '#BFB6AA', '#AAA093']);
  box(nb, -4.9, 7.5, 0, 0.7, 0.3, 0.18, ['#D8D1C7', '#BFB6AA', '#AAA093']);
  left(nb, -4.85, -4.25, 0.36, 1.45, 7, '#5A534B');

  // neighbour A: six storey walk-up with a fire escape and a water tower
  var na = g(world);
  box(na, -3.7, 0.2, 0, 3.55, 6.8, 7.3, C.nA);
  for (f = 0; f < 5; f++) windowsLeft(na, -3.7, -0.15, 0.5 + f * 1.4, 3, 0.62, 0.82, 7, '#8F958C');
  box(na, -3.8, 6.9, 7.3, 3.75, 0.2, 0.22, ['#E4E6E0', '#CFD2CA', '#B9BDB4']);
  // party wall faint courses
  for (f = 1; f < 5; f++) line(na, P(-0.15, 0.2, f * 1.4 + 0.2), P(-0.15, 7, f * 1.4 + 0.2), '#A1A59C', 1, { opacity: 0.7 });
  // fire escape
  for (f = 1; f < 5; f++) {
    var fz = 0.42 + f * 1.4;
    poly(na, [P(-2.75, 7, fz), P(-1.1, 7, fz), P(-1.1, 7.36, fz), P(-2.75, 7.36, fz)], '#2B3033');
    line(na, P(-2.75, 7.36, fz), P(-2.75, 7.36, fz + 0.42), C.ink, 1.3);
    line(na, P(-1.1, 7.36, fz), P(-1.1, 7.36, fz + 0.42), C.ink, 1.3);
    line(na, P(-2.75, 7.36, fz + 0.42), P(-1.1, 7.36, fz + 0.42), C.ink, 1.3);
    if (f > 1) line(na, P(-1.3, 7.2, fz), P(-2.55, 7.2, fz - 1.4), C.ink, 1.6);
  }
  // water tower
  (function () {
    var b = P(-2.2, 2.6, 7.3), w = 30, h = 44, lg = 26;
    var wt = g(na);
    line(wt, [b[0] - w + 5, b[1] + 4], [b[0] - w + 5, b[1] - lg], C.ink, 2);
    line(wt, [b[0] + w - 5, b[1] + 4], [b[0] + w - 5, b[1] - lg], C.ink, 2);
    line(wt, [b[0], b[1] + 10], [b[0], b[1] - lg], C.ink, 2);
    line(wt, [b[0] - w + 5, b[1] - 4], [b[0] + w - 5, b[1] - lg + 4], C.ink, 1.2);
    el('path', { d: 'M' + (b[0] - w) + ' ' + (b[1] - lg) + ' v' + (-h) + ' a' + w + ' ' + (w * 0.42) + ' 0 0 1 ' + (2 * w) + ' 0 v' + h + ' a' + w + ' ' + (w * 0.42) + ' 0 0 1 ' + (-2 * w) + ' 0z', fill: '#9B8F7F' }, wt);
    line(wt, [b[0] - w, b[1] - lg - h * 0.3], [b[0] + w, b[1] - lg - h * 0.3], '#6F6457', 1.5);
    line(wt, [b[0] - w, b[1] - lg - h * 0.7], [b[0] + w, b[1] - lg - h * 0.7], '#6F6457', 1.5);
    poly(wt, [[b[0] - w - 3, b[1] - lg - h + 2], [b[0], b[1] - lg - h - 30], [b[0] + w + 3, b[1] - lg - h + 2]], '#6F6457');
    el('ellipse', { cx: b[0], cy: b[1] - lg - h + 2, rx: w + 3, ry: (w + 3) * 0.3, fill: '#6F6457' }, wt);
  })();

  // the lot
  var lot = g(world);
  top(lot, 0.05, 0.2, 6.95, 6.95, 0.01, C.dirt);
  top(lot, 0.6, 4.2, 2.4, 5.6, 0.012, C.dirtD, { opacity: 0.6 });
  top(lot, 3.8, 0.8, 5.9, 2.2, 0.012, C.dirtD, { opacity: 0.6 });
  top(lot, 4.4, 4.6, 6.2, 6.2, 0.012, C.dirtD, { opacity: 0.45 });

  /* ================= the job ================= */
  var apron = g(svg);
  var BX0 = 1, BX1 = 6, BY0 = 1.2, BY1 = 6.2, FH = 1.5, Z0 = 0.16, FLOORS = 5;
  var job = g(svg);

  // shadow of the building on the ground, grows with it
  var shadow = el('polygon', { fill: C.ink, opacity: 0.13 }, job);

  // finished ground: paving and a planted strip (Close It)
  var paved = reg(g(apron), 4.6, 4.8, { dy: 0 });
  top(paved, 0.05, 0.2, 6.95, 6.95, 0.02, '#E9EAE5');
  for (i = 1; i < 7; i++) line(paved, P(i, 6.2, 0.02), P(i, 6.95, 0.02), '#C9CCC4', 1);
  top(paved, 6.15, 1.2, 6.8, 6.1, 0.03, '#62A06D');
  top(paved, 0.3, 0.4, 6.8, 1.0, 0.03, '#62A06D');

  // the promise: a faint outline of what will stand here, from the first screen
  var promise = reg(g(svg), -1, -0.5, { out: [2.3, 2.9], dy: 0 });
  function pl(a, b) { line(promise, a, b, C.ink, 1.3, { 'stroke-dasharray': '3 7', opacity: 0.42 }); }

  // dashed footprint (Win It into Plan It)
  var foot = reg(g(job), 0.45, 0.8, { out: [1.95, 2.15], dy: 0 });
  poly(foot, [P(BX0, BY0, 0.02), P(BX1, BY0, 0.02), P(BX1, BY1, 0.02), P(BX0, BY1, 0.02)], 'none', { stroke: C.ink, 'stroke-width': 1.6, 'stroke-dasharray': '7 6' });

  // survey stakes with string
  var stakes = g(job);
  [[BX0, BY0], [BX1, BY0], [BX0, BY1], [BX1, BY1]].forEach(function (c, k) {
    var s = reg(g(stakes), 0.45 + k * 0.08, 0.7 + k * 0.08, { out: [1.9, 2.1], dy: -22 });
    var a = P(c[0], c[1], 0), b = P(c[0], c[1], 0.62);
    el('ellipse', { cx: a[0], cy: a[1], rx: 7, ry: 3.4, fill: C.ink, opacity: 0.18 }, s);
    line(s, a, b, '#8A6F3D', 4, { 'stroke-linecap': 'butt' });
    poly(s, [b, [b[0] + 13, b[1] + 4], [b[0], b[1] + 9]], C.yellow);
  });
  var strings = reg(g(job), 0.75, 1.0, { out: [1.9, 2.1], dy: 0 });
  [[BX0, BY0, BX1, BY0], [BX1, BY0, BX1, BY1], [BX1, BY1, BX0, BY1], [BX0, BY1, BX0, BY0]].forEach(function (q) {
    line(strings, P(q[0], q[1], 0.5), P(q[2], q[3], 0.5), C.ink, 1.1);
  });

  // foundation
  var found = reg(g(job), 1.95, 2.2, { dy: 10 });
  box(found, BX0 - 0.2, BY0 - 0.2, 0, BX1 - BX0 + 0.4, BY1 - BY0 + 0.4, Z0, C.con);

  // frames (structure) per floor
  var frames = [], facades = [], cols = [[BX0, BY0], [3.4, BY0], [BX1 - 0.2, BY0], [BX0, 3.6], [BX1 - 0.2, 3.6], [BX0, BY1 - 0.2], [3.4, BY1 - 0.2], [BX1 - 0.2, BY1 - 0.2]];
  for (f = 0; f < FLOORS; f++) {
    var z = Z0 + f * FH;
    var fr = reg(g(job), 2.22 + f * 0.17, 2.42 + f * 0.17, { dy: -46 });
    // the two far walls, seen through the open frame
    left(fr, BX0, BX1, z, z + FH - 0.14, BY0, '#C2C5BD');
    right(fr, BY0, BY1, z, z + FH - 0.14, BX0, '#B1B5AC');
    cols.forEach(function (c) { box(fr, c[0], c[1], z, 0.2, 0.2, FH - 0.14, ['#EFEFEB', '#DCDED8', '#C3C6BE']); });
    box(fr, BX0, BY0, z + FH - 0.14, BX1 - BX0, BY1 - BY0, 0.14, ['#F8F8F5', '#D9DBD5', '#C0C3BB']);
    frames.push(fr);
  }
  // facades per floor
  var litNodes = [];
  for (f = 0; f < FLOORS; f++) {
    z = Z0 + f * FH;
    var fa = reg(g(job, { 'data-hot': 'floor' + (f + 1), 'class': 'hot' }), 3.16 + f * 0.13, 3.38 + f * 0.13, { dy: 0 });
    left(fa, BX0, BX1, z, z + FH, BY1, C.green);
    right(fa, BY0, BY1, z, z + FH, BX1, C.greenD);
    // floor band
    left(fa, BX0, BX1, z + FH - 0.14, z + FH, BY1, '#EDEEE9');
    right(fa, BY0, BY1, z + FH - 0.14, z + FH, BX1, '#CFD1CA');
    if (f === 0) {
      left(fa, 1.35, 2.25, z, z + 1.12, BY1, '#1B2A1F');
      left(fa, 1.45, 2.15, z + 0.1, z + 1.02, BY1, C.glass, { opacity: 0.55 });
      left(fa, 2.7, 5.65, z + 0.28, z + 1.12, BY1, C.glass);
      line(fa, P(4.17, BY1, z + 0.28), P(4.17, BY1, z + 1.12), C.green, 2);
      windowsRight(fa, BY0, BY1, z + 0.28, 3, 1.05, 0.84, BX1, '#B9CDBB');
    } else {
      var wg = (BX1 - BX0 - 4 * 0.72) / 5, wk, wa;
      for (wk = 0; wk < 4; wk++) {
        wa = BX0 + wg + wk * (0.72 + wg);
        left(fa, wa - 0.07, wa + 0.79, z + 0.25, z + 1.25, BY1, '#F3F4F0');
        left(fa, wa, wa + 0.72, z + 0.34, z + 1.18, BY1, C.glass);
        line(fa, P(wa + 0.36, BY1, z + 0.34), P(wa + 0.36, BY1, z + 1.18), '#F3F4F0', 1.6, { 'stroke-linecap': 'butt' });
        wa = BY0 + wg + wk * (0.72 + wg);
        right(fa, wa - 0.07, wa + 0.79, z + 0.25, z + 1.25, BX1, '#D5D8D1');
        right(fa, wa, wa + 0.72, z + 0.34, z + 1.18, BX1, '#A9C2AC');
        line(fa, P(BX1, wa + 0.36, z + 0.34), P(BX1, wa + 0.36, z + 1.18), '#D5D8D1', 1.6, { 'stroke-linecap': 'butt' });
      }
      var lit = g(fa, { opacity: 0 });
      var gap = (BX1 - BX0 - 4 * 0.72) / 5;
      [[0, 2], [1, 3], [0, 3], [1, 2]][f - 1].forEach(function (k) { var xa = BX0 + gap + k * (0.72 + gap); left(lit, xa, xa + 0.72, z + 0.34, z + 1.18, BY1, C.lit); });
      litNodes.push(lit);
    }
    facades.push(fa);
  }
  // roof and parapet
  var roof = reg(g(job), 3.78, 3.95, { dy: 0 });
  var RZ = Z0 + FLOORS * FH;
  box(roof, BX0, BY0, RZ - 0.2, BX1 - BX0 + 0.16, BY1 - BY0 + 0.16, 0.2, ['#F8F8F5', '#EDEEE9', '#CFD1CA']);
  top(roof, BX0, BY0, BX1, BY1, RZ + 0.001, '#E6E7E2');
  box(roof, BX0, BY1 - 0.14, RZ, BX1 - BX0, 0.14, 0.22, [C.con[0], C.green, C.greenD]);
  box(roof, BX1 - 0.14, BY0, RZ, 0.14, BY1 - BY0, 0.22, [C.con[0], C.green, C.greenD]);
  box(roof, 1.4, 1.6, RZ, 1.3, 1.2, 0.9, C.con);
  // roof garden (Close It)
  var garden = reg(g(job), 4.72, 4.95, { dy: -18 });
  box(garden, 3.3, 4.6, RZ, 2.2, 0.9, 0.24, C.wood);
  [[3.75, 5.05, 13], [4.45, 5.05, 16], [5.1, 5.05, 12]].forEach(function (t) {
    var b = P(t[0], t[1], RZ + 0.24);
    el('circle', { cx: b[0], cy: b[1] - t[2] + 2, r: t[2], fill: C.greenL }, garden);
    el('circle', { cx: b[0] - 5, cy: b[1] - t[2] - 3, r: t[2] * 0.62, fill: '#62A06D' }, garden);
  });
  // awning and lit windows (Close It)
  var awn = reg(g(job), 4.7, 4.9, { dy: 0 });
  poly(awn, [P(1.2, BY1, Z0 + 1.2), P(2.4, BY1, Z0 + 1.2), P(2.4, BY1 + 0.55, Z0 + 1.02), P(1.2, BY1 + 0.55, Z0 + 1.02)], C.teal);
  poly(awn, [P(2.4, BY1, Z0 + 1.2), P(2.4, BY1 + 0.55, Z0 + 1.02), P(2.4, BY1 + 0.55, Z0 + 0.92), P(2.4, BY1, Z0 + 1.1)], '#0C6557');
  poly(awn, [P(1.2, BY1 + 0.55, Z0 + 1.02), P(2.4, BY1 + 0.55, Z0 + 1.02), P(2.4, BY1 + 0.55, Z0 + 0.92), P(1.2, BY1 + 0.55, Z0 + 0.92)], '#0F7362');
  litNodes.forEach(function (n, k) { reg(n, 4.6 + k * 0.08, 4.8 + k * 0.08, { dy: 0 }); });

  // the plan: a drawn outline of the finished building (Plan It)
  var ghost = reg(g(job), 1.35, 1.55, { out: [2.45, 3.0], dy: 0 });
  var ghostLines = [];
  function gl(a, b) { var n = line(ghost, a, b, C.green, 2, { 'stroke-dasharray': '1000', 'stroke-dashoffset': '1000' }); ghostLines.push(n); }
  [[BX0, BY1], [BX1, BY1], [BX1, BY0], [BX0, BY0]].forEach(function (c) { gl(P(c[0], c[1], Z0), P(c[0], c[1], RZ)); pl(P(c[0], c[1], 0), P(c[0], c[1], RZ)); });
  pl(P(BX0, BY1, RZ), P(BX1, BY1, RZ)); pl(P(BX1, BY1, RZ), P(BX1, BY0, RZ)); pl(P(BX1, BY0, RZ), P(BX0, BY0, RZ)); pl(P(BX0, BY0, RZ), P(BX0, BY1, RZ));
  for (f = 1; f <= FLOORS; f++) {
    z = Z0 + f * FH;
    gl(P(BX0, BY1, z), P(BX1, BY1, z)); gl(P(BX1, BY1, z), P(BX1, BY0, z));
    if (f === FLOORS) { gl(P(BX1, BY0, z), P(BX0, BY0, z)); gl(P(BX0, BY0, z), P(BX0, BY1, z)); }
  }

  // the schedule lays itself out across the street face (Plan It): one bar per floor,
  // the first task top left, each later task one floor down and one step to the right,
  // every bar the same length, so it reads as a schedule and not as loose slabs
  var gantt = reg(g(job), 1.55, 1.6, { out: [2.3, 2.5], dy: 0 }), ganttBars = [];
  for (f = 0; f < FLOORS; f++) {
    ganttBars.push({ n: el('polygon', { fill: f === FLOORS - 1 ? C.teal : C.green }, gantt), x: BX0 + 0.3 + f * 0.75, w: 1.6, z: Z0 + (FLOORS - 1 - f) * FH + (FH - 0.42) / 2 });
  }

  // scaffolding per floor, in front of the two street faces
  var scaf = [];
  for (f = 0; f < FLOORS; f++) {
    z = Z0 + f * FH;
    var sc = reg(g(job), 2.3 + f * 0.17, 2.5 + f * 0.17, { out: [4.5 + (FLOORS - 1 - f) * 0.07, 4.66 + (FLOORS - 1 - f) * 0.07], dy: -30 });
    var sy = BY1 + 0.42, sx = BX1 + 0.42;
    // planks
    poly(sc, [P(BX0, BY1 + 0.08, z + FH), P(sx, BY1 + 0.08, z + FH), P(sx, sy, z + FH), P(BX0, sy, z + FH)], C.wood[0]);
    poly(sc, [P(BX1 + 0.08, BY0, z + FH), P(sx, BY0, z + FH), P(sx, BY1 + 0.08, z + FH), P(BX1 + 0.08, BY1 + 0.08, z + FH)], C.wood[1]);
    left(sc, BX0, sx, z + FH - 0.07, z + FH, sy, C.wood[2]);
    right(sc, BY0, sy, z + FH - 0.07, z + FH, sx, '#A39168');
    for (x = BX0; x <= sx + 0.01; x += (sx - BX0) / 5) line(sc, P(x, sy, z), P(x, sy, z + FH), C.ink, 1.6);
    for (y = BY0; y < sy - 0.2; y += (sy - BY0) / 5) line(sc, P(sx, y, z), P(sx, y, z + FH), C.ink, 1.6);
    line(sc, P(BX0, sy, z + FH * 0.5), P(sx, sy, z + FH * 0.5), C.ink, 1.1);
    line(sc, P(sx, BY0, z + FH * 0.5), P(sx, sy, z + FH * 0.5), C.ink, 1.1);
    var xa = BX0 + (f % 2 ? 2 : 1) * (sx - BX0) / 5;
    line(sc, P(xa, sy, z), P(xa + (sx - BX0) / 5, sy, z + FH), C.ink, 1.1);
    var ya = BY0 + (f % 2 ? 1 : 3) * (sy - BY0) / 5;
    line(sc, P(sx, ya, z), P(sx, ya + (sy - BY0) / 5, z + FH), C.ink, 1.1);
    scaf.push(sc);
  }

  // paid badges per floor (Get Paid)
  for (f = 0; f < FLOORS; f++) {
    var bp = P(BX1 + 0.44, 3.7, Z0 + f * FH + 0.75);
    var bd = reg(g(job), 3.5 + f * 0.09, 3.62 + f * 0.09, { out: [4.45, 4.6], dy: 10 });
    el('circle', { cx: bp[0], cy: bp[1], r: 15, fill: C.teal, stroke: '#F7F7F4', 'stroke-width': 3 }, bd);
    el('path', { d: 'M' + (bp[0] - 6.5) + ' ' + bp[1] + ' l4.5 4.8 l8.5 -9.5', fill: 'none', stroke: '#fff', 'stroke-width': 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, bd);
  }

  // people
  function person(parent, x, y, z, vest) {
    var b = P(x, y, z), outer = g(parent), p = g(outer, { transform: 'translate(' + b[0].toFixed(1) + ' ' + b[1].toFixed(1) + ') scale(1.45) translate(' + (-b[0]).toFixed(1) + ' ' + (-b[1]).toFixed(1) + ')' });
    el('ellipse', { cx: b[0], cy: b[1], rx: 7, ry: 3.2, fill: C.ink, opacity: 0.2 }, p);
    el('rect', { x: b[0] - 4.5, y: b[1] - 21, width: 9, height: 20, rx: 3.5, fill: vest || C.ink }, p);
    el('rect', { x: b[0] - 4.5, y: b[1] - 9, width: 9, height: 8, rx: 2, fill: C.ink }, p);
    el('circle', { cx: b[0], cy: b[1] - 25.5, r: 4.4, fill: '#C99B76' }, p);
    el('path', { d: 'M' + (b[0] - 5.4) + ' ' + (b[1] - 26) + ' a5.4 5.4 0 0 1 10.8 0z', fill: C.yellow }, p);
    return outer;
  }
  var crew = [];
  var c1 = reg(g(job), 2.5, 2.65, { out: [4.4, 4.55], dy: 0 }); crew.push(person(c1, 5.0, BY1 + 0.25, Z0 + FH, C.teal));
  var c2 = reg(g(job), 2.75, 2.9, { out: [4.4, 4.55], dy: 0 }); crew.push(person(c2, 2.2, BY1 + 0.25, Z0 + 3 * FH, '#E86A2B'));
  var c3 = reg(g(job), 3.06, 3.14, { out: [3.75, 3.9], dy: 0 }); crew.push(person(c3, 3.2, 3.4, RZ, C.teal));
  var c4 = reg(g(job), 3.08, 3.16, { out: [3.75, 3.9], dy: 0 }); crew.push(person(c4, 4.6, 4.4, RZ, '#E86A2B'));

  // tower crane
  var MX = 6.32, MY = 0.42, MZ = 10.6;
  var crane = reg(g(job, { 'data-hot': 'crane', 'class': 'hot' }), 2.3, 2.55, { out: [4.42, 4.62], dy: 60 });
  box(crane, MX - 0.12, MY - 0.12, 0, 0.62, 0.62, 0.2, ['#8F958C', '#6F756D', '#5C625B']);
  box(crane, MX, MY, 0.2, 0.38, 0.38, MZ - 0.2, [C.yellow, C.yellow, C.yellowD]);
  for (var zz = 0.2; zz < MZ - 0.5; zz += 0.76) {
    line(crane, P(MX, MY + 0.38, zz), P(MX + 0.38, MY + 0.38, zz + 0.38), '#7A5A0C', 1.1);
    line(crane, P(MX + 0.38, MY + 0.38, zz + 0.38), P(MX, MY + 0.38, zz + 0.76), '#7A5A0C', 1.1);
    line(crane, P(MX + 0.38, MY + 0.38, zz), P(MX + 0.38, MY, zz + 0.38), '#7A5A0C', 1.1);
    line(crane, P(MX + 0.38, MY, zz + 0.38), P(MX + 0.38, MY + 0.38, zz + 0.76), '#7A5A0C', 1.1);
  }
  var jib = g(crane);
  var jTie1 = el('line', { stroke: C.ink, 'stroke-width': 1.4 }, jib), jTie2 = el('line', { stroke: C.ink, 'stroke-width': 1.4 }, jib);
  var jMain = el('line', { stroke: C.yellow, 'stroke-width': 7, 'stroke-linecap': 'round' }, jib);
  var jLow = el('line', { stroke: C.yellowD, 'stroke-width': 2.2 }, jib);
  var jCw = el('rect', { width: 26, height: 17, rx: 2, fill: '#5C625B' }, jib);
  var jRope = el('line', { stroke: C.ink, 'stroke-width': 1.2 }, jib);
  var jLoad = el('rect', { width: 26, height: 12, rx: 1.5, fill: C.wood[0], stroke: C.ink, 'stroke-width': 1.2 }, jib);
  box(crane, MX - 0.08, MY - 0.08, MZ, 0.54, 0.54, 0.5, ['#F8F8F5', '#E4E5E0', '#CED0C9']);
  var jApexLine = line(crane, P(MX + 0.19, MY + 0.19, MZ + 0.5), P(MX + 0.19, MY + 0.19, MZ + 1.45), C.yellow, 5);
  function setLine(n, a, b) { n.setAttribute('x1', a[0].toFixed(1)); n.setAttribute('y1', a[1].toFixed(1)); n.setAttribute('x2', b[0].toFixed(1)); n.setAttribute('y2', b[1].toFixed(1)); }
  function setCrane(th, trol, drop) {
    var cx = MX + 0.19, cy = MY + 0.19, dx = Math.cos(th), dy = Math.sin(th), jz = MZ + 0.62;
    var tip = P(cx + dx * 6.4, cy + dy * 6.4, jz), back = P(cx - dx * 2.3, cy - dy * 2.3, jz), apex = P(cx, cy, MZ + 1.45);
    setLine(jMain, back, tip);
    setLine(jLow, P(cx, cy, jz - 0.16), P(cx + dx * 6.2, cy + dy * 6.2, jz - 0.16));
    setLine(jTie1, apex, P(cx + dx * 4.6, cy + dy * 4.6, jz)); setLine(jTie2, apex, back);
    jCw.setAttribute('x', (back[0] - 8).toFixed(1)); jCw.setAttribute('y', (back[1] + 2).toFixed(1));
    var t0 = P(cx + dx * trol, cy + dy * trol, jz), t1 = P(cx + dx * trol, cy + dy * trol, jz - drop);
    setLine(jRope, t0, t1);
    jLoad.setAttribute('x', (t1[0] - 13).toFixed(1)); jLoad.setAttribute('y', t1[1].toFixed(1));
  }
  setCrane(2.34, 3.6, 2.2);

  // green site fence on the two street edges
  var fence = reg(g(job, { 'data-hot': 'lot', 'class': 'hot' }), -1, -0.5, { out: [4.55, 4.75], dy: 0 });
  box(fence, 0.05, 6.9, 0, 2.95, 0.07, 0.86, ['#3C7A47', C.green, C.greenD]);
  box(fence, 4.4, 6.9, 0, 2.57, 0.07, 0.86, ['#3C7A47', C.green, C.greenD]);
  box(fence, 6.9, 0.2, 0, 0.07, 6.77, 0.86, ['#3C7A47', C.green, C.greenD]);
  left(fence, 0.5, 1.9, 0.3, 0.7, 6.975, '#F7F7F4');
  line(fence, P(0.66, 6.98, 0.56), P(1.74, 6.98, 0.56), C.ink, 2);
  line(fence, P(0.66, 6.98, 0.44), P(1.4, 6.98, 0.44), C.ink, 1.4);

  // sidewalk: trees, lamp, tripod
  function tree(parent, x, y) {
    var b = P(x, y, 0.09), t = g(parent);
    el('ellipse', { cx: b[0] + 4, cy: b[1] + 1, rx: 20, ry: 8, fill: C.ink, opacity: 0.14 }, t);
    poly(t, [P(x - 0.25, y - 0.25, 0.1), P(x + 0.25, y - 0.25, 0.1), P(x + 0.25, y + 0.25, 0.1), P(x - 0.25, y + 0.25, 0.1)], '#8A8F86');
    line(t, b, [b[0], b[1] - 42], '#6B5A3E', 4);
    el('circle', { cx: b[0], cy: b[1] - 58, r: 24, fill: C.greenL }, t);
    el('circle', { cx: b[0] - 12, cy: b[1] - 46, r: 15, fill: '#3F7A49' }, t);
    el('circle', { cx: b[0] + 11, cy: b[1] - 66, r: 14, fill: '#62A06D' }, t);
    return t;
  }
  var streetside = g(svg);
  tree(streetside, -2.4, 7.7);
  tree(streetside, 7.5, 1.4);
  var newTree = reg(g(streetside), 4.75, 4.95, { dy: -20 }); tree(newTree, 5.6, 7.7);
  (function () {
    var b = P(7.7, 7.95, 0.09), tp = [b[0], b[1] - 104];
    line(streetside, b, tp, '#4A5154', 2.4);
    line(streetside, tp, [tp[0] - 22, tp[1] + 9], '#4A5154', 2.4);
    el('ellipse', { cx: tp[0] - 24, cy: tp[1] + 13, rx: 8, ry: 4, fill: C.lit }, streetside);
  })();
  var tripod = reg(g(streetside), 0.5, 0.7, { out: [1.6, 1.8], dy: 0 });
  (function () {
    var b = P(3.7, 7.6, 0.09), h = [b[0], b[1] - 34];
    line(tripod, [b[0] - 11, b[1] + 3], h, C.ink, 2); line(tripod, [b[0] + 11, b[1] + 3], h, C.ink, 2); line(tripod, [b[0], b[1] - 5], h, C.ink, 2);
    el('rect', { x: h[0] - 8, y: h[1] - 9, width: 16, height: 9, rx: 2, fill: C.yellow, stroke: C.ink, 'stroke-width': 1.2 }, tripod);
    person(tripod, 4.3, 7.75, 0.09, C.teal);
  })();
  var owner = reg(g(streetside), 4.72, 4.9, { dy: 0 });
  person(owner, 1.6, 7.25, 0.09, C.green); person(owner, 2.25, 7.4, 0.09, '#6C7479');

  // delivery truck
  var truckWrap = g(svg);
  var truck = g(truckWrap, { 'data-hot': 'truck', 'class': 'hot' });
  (function () {
    var tx = 2.3, ty = 8.62, wy = ty + 0.95;
    var a = P(tx - 0.1, ty + 0.5, 0.01);
    poly(truck, [P(tx - 0.15, ty + 0.1, 0.005), P(tx + 3.25, ty + 0.1, 0.005), P(tx + 3.25, ty + 1.12, 0.005), P(tx - 0.15, ty + 1.12, 0.005)], C.ink, { opacity: 0.25 });
    box(truck, tx, ty, 0.3, 2.2, 0.95, 0.14, ['#4A5154', '#2B3033', '#1F2325']);
    box(truck, tx + 0.15, ty + 0.12, 0.44, 0.9, 0.7, 0.62, ['#F8F8F5', '#DADCD6', '#C4C7BF']);
    box(truck, tx + 1.15, ty + 0.12, 0.44, 0.9, 0.7, 0.42, C.wood);
    line(truck, P(tx + 0.6, ty + 0.82, 0.44), P(tx + 0.6, ty + 0.82, 1.06), C.teal, 3, { 'stroke-linecap': 'butt' });
    box(truck, tx + 2.25, ty, 0.3, 0.85, 0.95, 0.86, ['#F8F8F5', '#E4E5E0', '#C9CCC4']);
    right(truck, ty + 0.12, ty + 0.83, 0.72, 1.06, tx + 3.1, '#3B4447');
    left(truck, tx + 2.5, tx + 2.98, 0.74, 1.06, wy, '#3B4447');
    left(truck, tx + 2.25, tx + 3.1, 0.3, 0.42, wy, C.green);
    [tx + 0.5, tx + 1.6, tx + 2.7].forEach(function (wx) {
      var w = P(wx, wy + 0.01, 0.17);
      el('ellipse', { cx: w[0], cy: w[1], rx: 7.5, ry: 8, fill: '#14181A' }, truck);
      el('ellipse', { cx: w[0], cy: w[1], rx: 3, ry: 3.2, fill: '#8F958C' }, truck);
    });
    void a;
  })();

  // yellow cab on the far lane
  var cab = g(svg);
  (function () {
    var cx0 = 0, cy0 = 9.95;
    poly(cab, [P(cx0 - 0.08, cy0 + 0.08, 0.005), P(cx0 + 1.6, cy0 + 0.08, 0.005), P(cx0 + 1.6, cy0 + 0.86, 0.005), P(cx0 - 0.08, cy0 + 0.86, 0.005)], C.ink, { opacity: 0.25 });
    box(cab, cx0, cy0, 0.12, 1.5, 0.72, 0.3, [C.yellow, '#D9A21C', C.yellowD]);
    box(cab, cx0 + 0.4, cy0 + 0.06, 0.42, 0.75, 0.6, 0.26, ['#F6C543', '#3B4447', '#2B3033']);
    [cx0 + 0.3, cx0 + 1.2].forEach(function (wx) { var w = P(wx, cy0 + 0.73, 0.12); el('ellipse', { cx: w[0], cy: w[1], rx: 5, ry: 5.4, fill: '#14181A' }, cab); });
  })();

  /* ---- hotspots: the dots you can click ---- */
  var hotLayer = g(svg);
  var hots = [];
  function hot(id, label, p, a, b) {
    var h = g(hotLayer, { 'class': 'hot', role: 'button', tabindex: '0', 'aria-label': label, 'data-hot': id });
    el('circle', { 'class': 'hot-ring', cx: p[0], cy: p[1], r: 11, fill: 'none', stroke: C.teal, 'stroke-width': 2.5 }, h);
    el('circle', { cx: p[0], cy: p[1], r: 22, fill: 'transparent' }, h);
    el('circle', { 'class': 'hot-dot', cx: p[0], cy: p[1], r: 9, fill: '#fff', stroke: C.teal, 'stroke-width': 4 }, h);
    hots.push({ n: h, a: a, b: b, on: null, id: id });
    return h;
  }
  hot('lot', 'The lot. Open an example estimate.', P(3.5, 3.7, 0.3), -1, 1.45);
  hot('plan', 'The plan. Open an example schedule.', P(3.5, 3.7, RZ + 0.2), 1.55, 2.3);
  for (f = 0; f < FLOORS; f++) hot('floor' + (f + 1), 'Floor ' + (f + 1) + '. Open its example punch items.', P(2.1 + (f % 2) * 0.9, BY1 + 0.46, Z0 + f * FH + 0.8), 2.5 + f * 0.17, 5.5);
  var truckHot = hot('truck', 'The truck. Open an example delivery.', P(3.9, 9.1, 1.75), 2.95, 4.15);
  hot('crane', 'The crane. Open an example daily report.', P(MX + 0.2, MY + 0.2, MZ + 0.25), 2.6, 4.4);
  hot('keys', 'The front door. Open an example handover.', P(1.8, BY1 + 0.62, Z0 + 0.72), 4.8, 5.5);

  /* ================= update ================= */
  var sCur = 0, sTarget = 0, tNow = 0, running = false, visible = true, lastStage = -1;
  var floatCard = document.getElementById('floatCard'), phone = document.getElementById('phone'), hint = document.getElementById('hint'), rail = document.getElementById('rail');
  var phoneImgs = phone ? phone.querySelectorAll('img') : [];
  var railBtns = rail ? rail.querySelectorAll('button') : [];
  var FLOATS = [
    null,
    '<p class="f-tag">Estimate Sent</p><p class="f-big">$45,309</p><p class="f-sub">The Henderson Residence</p><p class="f-sub">Example</p>',
    '<p class="f-tag">Schedule</p><div class="bars"><i></i><i></i><i></i><i></i><i></i></div><p class="f-sub">20 tasks, 30 working days</p><p class="f-sub">Example</p>',
    '<p class="f-tag">Daily Report</p><p class="f-big">9 On Site</p><p class="f-sub">Clear, 53°F. <span class="f-ok">Sent</span></p><p class="f-sub">Example</p>',
    '<p class="f-tag">Progress Invoice 3</p><p class="f-big f-ok">Paid</p><p class="f-sub">Floors 1 to 4 billed and collected</p><p class="f-sub">Example</p>',
    '<p class="f-tag">Walkthrough</p><p class="f-big">9 Of 9 Done</p><p class="f-sub"><span class="f-ok">Keys handed over</span></p><p class="f-sub">Example</p>'
  ];

  function builtHeight(s) {
    var h = 0;
    for (var k = 0; k < FLOORS; k++) h += ease(clamp((s - (2.22 + k * 0.17)) / 0.2)) * FH;
    return h + (s > 2 ? Z0 : 0);
  }

  function render(s, t, raw) {
    var k, it, kin, kout, v, n;
    // Reduce Motion: nothing plays in the hero, so show the finished building there
    // instead of an empty lot. sv keeps the real stage for the cards and the rail.
    var sv = s;
    if (reduce && !raw && s < 0.5) s = 5;
    for (k = 0; k < items.length; k++) {
      it = items[k];
      kin = ease(clamp((s - it.a) / (it.b - it.a)));
      kout = it.c == null ? 1 : 1 - ease(clamp((s - it.c) / (it.d - it.c)));
      v = Math.min(kin, kout);
      if (Math.abs(v - it.last) < 0.002) continue;
      it.last = v; n = it.n;
      if (v <= 0) { n.style.display = 'none'; continue; }
      n.style.display = '';
      n.setAttribute('opacity', v.toFixed(3));
      if (it.dy) n.setAttribute('transform', 'translate(0 ' + ((1 - (kout < 1 ? kout : kin)) * it.dy).toFixed(1) + ')');
    }
    // the plan draws itself
    var gk = clamp((s - 1.4) / 0.55);
    for (k = 0; k < ghostLines.length; k++) {
      var lk = clamp(gk * 1.8 - (k / ghostLines.length) * 0.8);
      ghostLines[k].setAttribute('stroke-dashoffset', ((1 - ease(lk)) * 1000).toFixed(0));
    }
    for (k = 0; k < ganttBars.length; k++) {
      var gb = ganttBars[k], gw = gb.w * ease(clamp((s - 1.58 - k * 0.05) / 0.2));
      gb.n.setAttribute('points', pts([P(gb.x, BY1, gb.z), P(gb.x + gw, BY1, gb.z), P(gb.x + gw, BY1, gb.z + 0.42), P(gb.x, BY1, gb.z + 0.42)]));
    }
    // shadow
    var bh = builtHeight(s), L = bh * 0.42;
    if (bh < 0.05) shadow.style.display = 'none';
    else {
      shadow.style.display = '';
      shadow.setAttribute('points', pts([P(BX1, BY0, 0.1), P(BX1 + L, BY0 + L * 0.35, 0.1), P(BX1 + L, BY1 + L * 0.35, 0.1), P(BX0 + L * 0.2, BY1 + L * 0.35, 0.1), P(BX0, BY1, 0.1), P(BX1, BY1, 0.1)]));
    }
    // truck: arrives during Build It, leaves once the job is being billed
    var arrive = ease(clamp((s - 2.55) / 0.4)), leave = ease(clamp((s - 4.2) / 0.4));
    var off = (1 - arrive) * -9.5 + leave * 9, d = P(off, 0, 0), d0 = P(0, 0, 0);
    var tv = Math.min(clamp((s - 2.5) / 0.12), 1 - clamp((s - 4.48) / 0.12));
    truckWrap.style.display = tv <= 0 ? 'none' : '';
    truckWrap.setAttribute('opacity', tv.toFixed(2));
    var tt = 'translate(' + (d[0] - d0[0]).toFixed(1) + ' ' + (d[1] - d0[1]).toFixed(1) + ')';
    truck.setAttribute('transform', tt); truckHot.setAttribute('transform', tt);
    // crane sways, load travels
    setCrane(2.34 + Math.sin(t * 0.00042) * 0.2, 3.6 + Math.sin(t * 0.0006 + 1) * 1.1, 2.2 + Math.sin(t * 0.0009) * 1.2);
    // crew shift their weight
    for (k = 0; k < crew.length; k++) crew[k].setAttribute('transform', 'translate(' + (Math.sin(t * 0.0016 + k * 2.1) * 3.2).toFixed(1) + ' ' + (Math.abs(Math.sin(t * 0.004 + k)) * -1.4).toFixed(1) + ')');
    // cab drives by
    var cyc = (t % 11000) / 11000, cabX = 11.5 - cyc * 21, cd = P(cabX, 0, 0);
    var cv = Math.min(clamp((cabX + 6.4) / 0.8), clamp((8.6 - cabX) / 0.8));
    cab.setAttribute('transform', 'translate(' + cd[0].toFixed(1) + ' ' + cd[1].toFixed(1) + ')');
    cab.setAttribute('opacity', cv.toFixed(2));
    // hotspots
    for (k = 0; k < hots.length; k++) {
      var on = sv === s && s >= hots[k].a && s <= hots[k].b;
      if (on !== hots[k].on) { hots[k].on = on; hots[k].n.style.display = on ? '' : 'none'; }
    }
    // stage chrome
    var st = Math.max(0, Math.min(5, Math.round(sv)));
    if (st !== lastStage) {
      lastStage = st;
      if (floatCard) {
        if (FLOATS[st]) { floatCard.innerHTML = FLOATS[st]; floatCard.classList.add('on'); } else floatCard.classList.remove('on');
      }
      if (phone) phone.classList.toggle('on', st > 0);
      for (k = 0; k < phoneImgs.length; k++) phoneImgs[k].classList.toggle('on', +phoneImgs[k].getAttribute('data-stage') === st);
      for (k = 0; k < railBtns.length; k++) {
        var gnum = +railBtns[k].getAttribute('data-go');
        railBtns[k].classList.toggle('on', gnum === st);
        railBtns[k].classList.toggle('done', gnum < st);
        if (gnum === st) railBtns[k].setAttribute('aria-current', 'step'); else railBtns[k].removeAttribute('aria-current');
      }
      if (hint) hint.classList.toggle('on', st >= 3 && !clicked);
    }
  }

  /* ---- scroll drives s ---- */
  var steps = Array.prototype.slice.call(document.querySelectorAll('.job [data-step]'));
  var sceneEl = document.getElementById('scene');
  function measure() {
    var vh = window.innerHeight, wide = window.innerWidth >= 1000;
    var topEdge = wide ? 0 : sceneEl.getBoundingClientRect().height;
    var mid = topEdge + (vh - topEdge) * (wide ? 0.5 : 0.42);
    var centres = steps.map(function (n) { var r = n.getBoundingClientRect(); return wide ? r.top + r.height / 2 : r.top + Math.min(r.height / 2, 160); });
    if (centres[0] >= mid) return 0;
    for (var k = 0; k < centres.length - 1; k++) {
      if (centres[k] <= mid && centres[k + 1] > mid) {
        var fr = (mid - centres[k]) / (centres[k + 1] - centres[k]);
        // hold each stage for a moment, then move
        return k + ease(clamp((fr - 0.18) / 0.64));
      }
    }
    return centres.length - 1;
  }
  function fit() {
    var r = sceneEl.getBoundingClientRect();
    var tight = r.width < 700;
    svg.setAttribute('viewBox', (tight ? VIEW_TIGHT : VIEW_WIDE).join(' '));
    svg.setAttribute('preserveAspectRatio', tight ? 'xMidYMid slice' : (r.width >= 860 ? 'xMinYMid meet' : 'xMidYMid meet'));
  }

  /* ---- the hero plays the whole job on a loop until you scroll ---- */
  var attractT0 = 0, attractOff = false;
  function attractOn() {
    return !reduce && !attractOff && (window.pageYOffset || 0) < 6 && (!panel || panel.hidden);
  }
  function attractS(ms) {
    var lead = 1400, per = 2300, hold = 3600, back = 900, rest = 1500;
    var total = lead + per * 5 + hold + back + rest, m = ms % total;
    if (m < lead) return 0;
    m -= lead;
    if (m < per * 5) { var seg = Math.floor(m / per), fr = (m - seg * per) / per; return seg + ease(clamp(fr / 0.62)); }
    m -= per * 5;
    if (m < hold) return 5;
    m -= hold;
    if (m < back) return 5 * (1 - ease(m / back));
    return 0;
  }
  function frame(now) {
    running = false;
    tNow = now || 0;
    sTarget = measure();
    if (attractOn()) {
      if (!attractT0) attractT0 = tNow;
      sTarget = attractS(tNow - attractT0);
    } else attractT0 = 0;
    if (reduce) sCur = Math.round(sTarget);
    else sCur += (sTarget - sCur) * 0.14;
    if (Math.abs(sTarget - sCur) < 0.0015) sCur = sTarget;
    render(sCur, reduce ? 0 : tNow);
    if (!reduce && visible) kick();
  }
  function kick() { if (!running) { running = true; window.requestAnimationFrame(frame); } }

  window.addEventListener('scroll', kick, { passive: true });
  window.addEventListener('resize', function () { fit(); kick(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible) kick(); }).observe(sceneEl);
  }

  /* ---- jump: rail buttons and ?stage=N ---- */
  function goStage(nIdx, instant) {
    var n = steps[nIdx]; if (!n) return;
    var r = n.getBoundingClientRect(), wide = window.innerWidth >= 1000;
    var topEdge = wide ? 0 : sceneEl.getBoundingClientRect().height;
    var mid = topEdge + (window.innerHeight - topEdge) * (wide ? 0.5 : 0.42);
    var c = wide ? r.top + r.height / 2 : r.top + Math.min(r.height / 2, 160);
    var yTo = Math.max(0, window.pageYOffset + c - mid + 2);
    if (nIdx === 0) yTo = 0;
    if (instant || reduce) window.scrollTo(0, yTo); else window.scrollTo({ top: yTo, behavior: 'smooth' });
  }
  for (i = 0; i < railBtns.length; i++) railBtns[i].addEventListener('click', function () { goStage(+this.getAttribute('data-go'), false); });

  /* ---- click panel ---- */
  var clicked = false;
  var panel = document.getElementById('panel'), pTag = document.getElementById('panelTag'), pTitle = document.getElementById('panelTitle'), pSub = document.getElementById('panelSub'), pRows = document.getElementById('panelRows'), pNote = document.getElementById('panelNote'), pClose = document.getElementById('panelClose');
  var lastFocus = null;
  var PUNCH = [
    [['Storefront glass, clean and seal', 'Glazier'], ['Lobby light on the wrong switch', 'Electrician'], ['Scuffed tile at the entry', 'Tile sub']],
    [['Touch up paint at the stair landing', 'Painter'], ['Outlet cover missing, bedroom 2', 'Electrician'], ['Closet door rubs the frame', 'Carpenter']],
    [['Caulk the tub surround', 'Plumber'], ['Cabinet pull missing, kitchen', 'Carpenter'], ['Thermostat reads blank', 'HVAC sub']],
    [['Grout haze on the bath floor', 'Tile sub'], ['Patch the ceiling at the hallway light', 'Drywall sub'], ['Window lock, bedroom 1', 'Glazier']],
    [['Roof hatch latch sticks', 'Carpenter'], ['Smoke alarm chirps, hallway', 'Electrician'], ['Paint the stair rail', 'Painter']]
  ];
  function data(id) {
    var st = Math.round(sCur), m = /^floor(\d)$/.exec(id);
    if (m) {
      var fl = +m[1], rows = PUNCH[fl - 1].map(function (r, k) {
        var done = st >= 5 || (st === 4 && k < 2) || (st === 3 && k === 1 && fl < 3);
        return [r[0], r[1], done ? 'Closed' : 'Open', done ? 'ok' : ''];
      });
      return { tag: 'Punch List', title: 'Floor ' + fl, sub: st >= 5 ? 'Every item closed before the keys change hands.' : 'Each item can carry a location, a photo and the sub who owns it.', rows: rows, note: 'Example items. The punch list is on the Business plan. Scroll to Close It and they are all closed.' };
    }
    if (id === 'truck') return { tag: 'Delivery', title: 'Windows, 14 Units', sub: 'Deliveries shows what was promised and keeps late loads at the top.', rows: [['Promised for Tuesday', 'Supplier has not confirmed', 'Chase', 'warn'], ['Hoist booked for the drop', 'Tuesday, 7 to 9 am', 'Booked', 'ok'], ['Glazier on site', 'Wednesday', 'Scheduled', '']], note: 'Example delivery.' };
    if (id === 'crane') return { tag: 'Daily Report', title: 'Today On Site', sub: 'Say it out loud and the app fills in the crew, the work and the delays for you to check. Voice fill is on Pro, with 3 free tries.', rows: [['Crew on site', 'Skilled trades', '9', ''], ['Weather', 'Clear, 53°F, wind 11 mph', 'Logged', 'ok'], ['Report to the client', 'With photos', 'Sent', 'ok']], note: 'Example report.' };
    if (id === 'plan') return { tag: 'Schedule', title: 'The Plan', sub: 'Built from the estimate, with the critical path marked. The assistant drafts it and you approve it. AI drafts are on Pro, with 3 free tries.', rows: [['Site work and foundation', '8 working days', 'Critical', 'warn'], ['Framing and structure', '12 working days', 'Critical', 'warn'], ['Rough plumbing and electrical', '6 working days', 'Has float', ''], ['Finishes', '4 working days', 'Has float', '']], note: 'Example schedule: 20 tasks, 30 working days.' };
    if (id === 'keys') return { tag: 'Closeout', title: 'Handover', sub: 'The walkthrough day checklist, done.', rows: [['Punch list cleared', '15 of 15 items', 'Done', 'ok'], ['Closeout binder delivered', 'Selections, warranties, photos', 'Done', 'ok'], ['Final invoice paid', '', 'Done', 'ok']], note: 'Example handover.' };
    return { tag: 'Estimate', title: 'The Lot', sub: 'Before anything is built, the job is a number. On Pro, the assistant drafts it and you approve every line.', rows: [['Demolition and site work', 'From your price book', '$6,200', ''], ['Framing and drywall', 'From your price book', '$14,850', ''], ['Kitchen and baths', 'Not in your price book yet', 'Market average', 'warn'], ['Total so far', '', '$45,309', '']], note: 'Example estimate. Lines priced from your book are marked. The rest use market averages until you add a rate.' };
  }
  function openPanel(id, fromKey) {
    var d = data(id); if (!panel) return;
    clicked = true; if (hint) hint.classList.remove('on');
    pTag.textContent = d.tag + ' · Example'; pTitle.textContent = d.title; pSub.textContent = d.sub; pNote.textContent = d.note;
    pRows.innerHTML = '';
    d.rows.forEach(function (r) {
      var li = document.createElement('li'), sp = document.createElement('span'), ch = document.createElement('span');
      sp.textContent = r[0];
      if (r[1]) { var sm = document.createElement('small'); sm.textContent = r[1]; sp.appendChild(sm); }
      ch.className = 'chip' + (r[3] ? ' ' + r[3] : ''); ch.textContent = r[2];
      li.appendChild(sp); li.appendChild(ch); pRows.appendChild(li);
    });
    panel.hidden = false;
    if (fromKey) { lastFocus = document.activeElement; pClose.focus(); }
  }
  function closePanel() { if (!panel || panel.hidden) return; panel.hidden = true; if (lastFocus && lastFocus.focus) { lastFocus.focus(); lastFocus = null; } }
  function hotOf(t) { while (t && t !== svg) { if (t.getAttribute && t.getAttribute('data-hot')) return t.getAttribute('data-hot'); t = t.parentNode; } return null; }
  svg.addEventListener('click', function (e) { var id = hotOf(e.target); if (id) openPanel(id, false); });
  svg.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var id = hotOf(e.target); if (id) { e.preventDefault(); openPanel(id, true); }
  });
  if (pClose) pClose.addEventListener('click', closePanel);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });

  /* ---- Your Prices: close a job, the book fills in ---- */
  (function () {
    var rows = document.querySelectorAll('#bookRows li'), count = document.getElementById('bookCount'), btn = document.getElementById('closeJob'), lots = document.getElementById('lots');
    if (!rows.length || !btn) return;
    var vals = [], n = 0, i2;
    for (i2 = 0; i2 < rows.length; i2++) vals.push(rows[i2].querySelector('b').textContent);
    function mini(h) {
      var s2 = '<svg viewBox="-24 -44 48 56" aria-hidden="true">', w = 17, d = 8.5, hh = 8 + h * 7;
      s2 += '<polygon points="0,' + d + ' -' + w + ',0 -' + w + ',-' + hh + ' 0,' + (d - hh) + '" fill="#2F6B3A"/>';
      s2 += '<polygon points="0,' + d + ' ' + w + ',0 ' + w + ',-' + hh + ' 0,' + (d - hh) + '" fill="#24542D"/>';
      s2 += '<polygon points="0,' + (d - hh) + ' -' + w + ',-' + hh + ' 0,' + (-d - hh) + ' ' + w + ',-' + hh + '" fill="#ECEDE9"/>';
      return s2 + '</svg>';
    }
    function paint() {
      for (var k = 0; k < rows.length; k++) {
        var has = k < n, b = rows[k].querySelector('b');
        rows[k].classList.toggle('empty', !has);
        rows[k].classList.toggle('fresh', has && k === n - 1);
        b.textContent = has ? vals[k] : 'No cost on file';
      }
      count.textContent = n === 0 ? 'No closed jobs yet' : 'From ' + n + (n === 1 ? ' closed job' : ' closed jobs');
      var html = ''; for (var j = 0; j < n; j++) html += mini(1 + ((j * 2) % 3));
      lots.innerHTML = html;
      btn.textContent = n >= rows.length ? 'Start Over' : (n === 0 ? 'Close A Job' : 'Close Another Job');
    }
    btn.hidden = false;
    btn.addEventListener('click', function () { n = n >= rows.length ? 0 : n + 1; paint(); });
    paint();
  })();

  /* ---- go ---- */
  fit();
  var q = /[?&]stage=(\d)/.exec(window.location.search); if (q) { attractOff = true; document.documentElement.classList.add('snap'); }
  var qy = /[?&]y=(\d+)/.exec(window.location.search), qp = /[?&]open=([a-z0-9]+)/.exec(window.location.search);
  if (qy) { attractOff = true; document.documentElement.classList.add('snap'); }
  if (/[?&]full=1/.test(window.location.search)) document.documentElement.classList.add('full');
  // the closing section gets a still copy of the empty lot: your job goes here
  (function () {
    var slot = document.getElementById('endLot'); if (!slot) return;
    render(0, 0, true);
    var copy = svg.cloneNode(true), dots = copy.querySelectorAll('[role="button"]'), k;
    for (k = 0; k < dots.length; k++) dots[k].parentNode.removeChild(dots[k]);
    var hid = copy.querySelectorAll('[style*="display: none"], [style*="display:none"]');
    for (k = 0; k < hid.length; k++) hid[k].parentNode.removeChild(hid[k]);
    copy.removeAttribute('role'); copy.removeAttribute('aria-label'); copy.setAttribute('aria-hidden', 'true');
    copy.setAttribute('viewBox', '-640 -420 1065 930'); copy.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    slot.appendChild(copy);
  })();
  function boot() {
    fit();
    if (q) goStage(Math.min(5, +q[1]), true);
    if (qy) window.scrollTo(0, +qy[1]);
    sTarget = measure(); sCur = reduce ? Math.round(sTarget) : sTarget;
    render(sCur, 0);
    if (qp) openPanel(qp[1], false);
    kick();
  }
  if (document.readyState === 'complete') boot(); else { render(0, 0); window.addEventListener('load', boot); }
})();
