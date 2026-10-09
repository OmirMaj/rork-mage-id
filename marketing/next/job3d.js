/* MAGE ID marketing preview: the job that builds itself.
   three.js r128, loaded by page.js only when the hero is near the screen.
   The whole scene is a function of one number, s, from 0 to 5:
   0 empty lot, 1 Win It, 2 Plan It, 3 Build It, 4 Get Paid, 5 Close It.
   Every piece is a box in a merged buffer. Pieces drop into place in the vertex
   shader, so nothing is allocated or rebuilt per frame, and a frame is drawn
   only when something changed. This is an illustration of a job, not a view of
   the app. */
(function () {
  'use strict';

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(k) { k = clamp(k); return k * k * (3 - 2 * k); }
  function lerp(a, b, k) { return a + (b - a) * k; }

  var SHADER = [
    'float mgK = clamp((uR * (1.0 + uW) - aOrd) / uW, 0.0, 1.0);',
    'float mgB = mgK - 1.0;',
    'float mgE = 1.0 + 2.2 * mgB * mgB * mgB + 1.2 * mgB * mgB;',
    'vec3 transformed = mix(aCtr, position, smoothstep(0.0, 0.3, mgK));',
    'transformed.y += (1.0 - mgE) * uLift;'
  ].join('\n');
  var HEAD = 'attribute float aOrd;\nattribute vec3 aCtr;\nuniform float uR;\nuniform float uW;\nuniform float uLift;\nuniform float uSweep;\nuniform vec3 uTint;\n';
  /* paint: a colour edge that sweeps across the job. Colour pass only, the shadow pass has no colours. */
  var PAINT = '\nvColor *= mix(uTint, vec3(1.0), smoothstep(0.0, 1.0, (uSweep - (position.x + position.z * 0.6)) / 2.4));';

  function create(canvas, opt) {
    var THREE = window.THREE;
    opt = opt || {};
    var small = !!opt.small;

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!opt.keep });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;

    var scene = new THREE.Scene();
    var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300);
    var hemi = new THREE.HemisphereLight(0xffffff, 0x8E968F, 0.72); scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffffff, 0.44);
    sun.position.set(-9, 30, 20); sun.target.position.set(6.5, 0, 5.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    var sc = sun.shadow.camera; sc.left = -17; sc.right = 17; sc.top = 17; sc.bottom = -17; sc.near = 4; sc.far = 90;
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);

    /* ---------- layers ---------- */
    var layers = [];
    function Layer(a, b, o) {
      o = o || {};
      this.a = a; this.b = b; this.c = o.out ? o.out[0] : null; this.d = o.out ? o.out[1] : null;
      this.boxes = []; this.o = o; this.last = -1;
      this.u = { uR: { value: 0 }, uW: { value: o.w || 0.3 }, uLift: { value: o.lift == null ? 1.4 : o.lift }, uSweep: { value: 999 }, uTint: { value: new THREE.Vector3(1, 1, 1) } };
      layers.push(this);
    }
    /* y is the bottom of the box. key orders the reveal (low first). */
    Layer.prototype.box = function (cx, y, cz, sx, sy, sz, col, key) {
      this.boxes.push([cx, y, cz, sx, sy, sz, col, key == null ? cx + cz : key]); return this;
    };
    var F = [
      [1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1],
      [-1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0],
      [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0],
      [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
      [0, 0, -1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0]
    ];
    var IDX = [0, 1, 2, 0, 2, 3];
    var tmpC = new THREE.Color();
    Layer.prototype.finish = function () {
      var bx = this.boxes, n = bx.length; if (!n) return;
      bx.sort(function (p, q) { return p[7] - q[7]; });
      var P = new Float32Array(n * 90), N = new Float32Array(n * 90), C = new Float32Array(n * 90), K = new Float32Array(n * 90), O = new Float32Array(n * 30);
      var w = 0, wo = 0;
      for (var i = 0; i < n; i++) {
        var b = bx[i], x0 = b[0] - b[3] / 2, y0 = b[1], z0 = b[2] - b[5] / 2, sx = b[3], sy = b[4], sz = b[5];
        tmpC.set(b[6]);
        var ord = n > 1 ? i / (n - 1) : 0;
        for (var f = 0; f < 5; f++) {
          var ff = F[f];
          for (var k = 0; k < 6; k++) {
            var q = 3 + IDX[k] * 3;
            P[w] = x0 + ff[q] * sx; P[w + 1] = y0 + ff[q + 1] * sy; P[w + 2] = z0 + ff[q + 2] * sz;
            N[w] = ff[0]; N[w + 1] = ff[1]; N[w + 2] = ff[2];
            C[w] = tmpC.r; C[w + 1] = tmpC.g; C[w + 2] = tmpC.b;
            K[w] = b[0]; K[w + 1] = y0; K[w + 2] = b[2];
            O[wo++] = ord; w += 3;
          }
        }
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      g.setAttribute('color', new THREE.BufferAttribute(C, 3));
      g.setAttribute('aCtr', new THREE.BufferAttribute(K, 3));
      g.setAttribute('aOrd', new THREE.BufferAttribute(O, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(6.5, 0, 5.5), 40);
      var u = this.u, o = this.o;
      var m = o.glow ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true, transparent: !!o.alpha, opacity: o.alpha || 1, depthWrite: !o.alpha });
      function bind(sh) { sh.uniforms.uR = u.uR; sh.uniforms.uW = u.uW; sh.uniforms.uLift = u.uLift; sh.uniforms.uSweep = u.uSweep; sh.uniforms.uTint = u.uTint; }
      m.onBeforeCompile = function (sh) { bind(sh); sh.vertexShader = HEAD + sh.vertexShader.replace('#include <begin_vertex>', SHADER + PAINT); };
      var mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      if (!o.alpha && !o.flat && !o.glow) {
        var dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        dm.onBeforeCompile = function (sh) { bind(sh); sh.vertexShader = HEAD + sh.vertexShader.replace('#include <begin_vertex>', SHADER); };
        mesh.customDepthMaterial = dm; mesh.castShadow = true;
      }
      mesh.receiveShadow = !o.alpha && !o.glow;
      this.mesh = mesh; this.mat = m; this.boxes = null;
      scene.add(mesh);
    };

    /* ---------- palette ---------- */
    var K = {
      ground: 0x262D2F, groundEdge: 0x1D2325, street: 0x33393C, dash: 0xD8DAD3, walk: 0x8D948D, walkB: 0x9AA19A,
      lawn: 0x2B5233, lawnB: 0x315C39, slab: 0xC4C8C0, slabSide: 0xA9AEA6,
      green: 0x2F6B3A, greenL: 0x4C8A57, greenD: 0x24542D, teal: 0x12806E, tealL: 0x8FC7BC,
      wood: 0xDDB877, woodB: 0xCFA763, woodD: 0xB48A4B, pipe: 0x2E7FC1, hot: 0xC8503C, wire: 0xEDB52A, pink: 0xE2A79E,
      wall: 0xFFFFFF, cap: 0xB9BEB6, floorA: 0xCFA873, floorB: 0xC59C66, floorC: 0xD8B482,
      tileA: 0xE7EAE6, tileB: 0xC9D9D4, tileK: 0xD9DCD6, white: 0xF6F6F2, ink: 0x1F2628, slate: 0x40505A, slateL: 0x566873,
      vis: 0xEDB52A, string: 0xF2F4EE, pvc: 0xE9EBE6, box: 0x5E696E, lamp: 0xFFE2A0, skin: 0xC99A72, hat: 0xF6F6F2, rust: 0x8A5A3C, steel: 0x7C858A, paper: 0xF4F4EF
    };
    var Y = 0.3, H = 1.5;

    /* ---------- the lot (always there) ---------- */
    var base = new Layer(-1, -0.5, { lift: 0 });
    base.box(6.5, -1.1, 5.8, 21.4, 1.1, 17.8, K.ground);
    base.box(6.5, 0, 13.2, 21.4, 0.03, 3, K.street);
    for (var dx = -3.2; dx < 16.5; dx += 2) base.box(dx + 0.5, 0.03, 13.2, 1, 0.012, 0.1, K.dash);
    base.box(6.5, 0, 10.95, 21.4, 0.1, 1.5, K.walk);
    for (dx = -3; dx < 17; dx += 1.5) base.box(dx, 0.1, 10.95, 0.03, 0.004, 1.5, 0x7A817A);
    base.box(6.5, 0.1, 11.66, 21.4, 0.02, 0.08, K.walkB);
    base.box(-2.2, 0, 3.6, 3.2, 0.05, 12, K.lawn);
    base.box(6, 0, -1.9, 13, 0.05, 1.6, K.lawn);
    base.box(15.2, 0, -1.2, 3, 0.05, 2.4, K.lawnB);
    base.box(6, 0, 4.5, 14.2, Y, 10.6, K.slab);
    base.box(12.9, 0, 6.8, 0.9, 0.12, 1.4, K.slabSide);
    function tree(l, x, z, s, key) {
      l.box(x, 0.05, z, 0.14 * s, 0.9 * s, 0.14 * s, K.rust, key);
      l.box(x, 0.8 * s, z, 1.0 * s, 0.75 * s, 1.0 * s, K.green, key + 0.01);
      l.box(x + 0.15 * s, 1.45 * s, z - 0.1 * s, 0.7 * s, 0.55 * s, 0.7 * s, K.greenL, key + 0.02);
    }
    tree(base, -2.6, 0.6, 1.25, 0); tree(base, -2.0, 6.6, 1, 0); tree(base, 15.6, -1.5, 1.1, 0); tree(base, 3.4, -2.1, 0.85, 0);
    base.finish();

    /* ---------- walls ---------- */
    /* a to b, axis aligned. open: [from, to, kind] along the wall, kind w = window, d = door */
    var WALLS = [
      { a: [0, 0], b: [12, 0], ext: 1, open: [[2, 4.6, 'w'], [8.9, 10.9, 'w']] },
      { a: [12, 0], b: [12, 9], ext: 1, open: [[1.1, 2.7, 'w'], [6.3, 7.3, 'd']] },
      { a: [12, 9], b: [0, 9], ext: 1, open: [[5, 5.9, 'w'], [8.4, 10.6, 'w']] },
      { a: [0, 9], b: [0, 0], ext: 1, open: [[1, 2.6, 'w'], [5.2, 7.6, 'w']] },
      { a: [0, 5.5], b: [8, 5.5], open: [[3.3, 4.2, 'd']] },
      { a: [5, 5.5], b: [5, 9], open: [] },
      { a: [8, 5.5], b: [8, 9], open: [[0.8, 1.7, 'd']] },
      { a: [8, 0], b: [8, 4], open: [[1.2, 3.2, 'd']] },
      { a: [8, 4], b: [12, 4], open: [[1.5, 2.5, 'd']] }
    ];
    function wallBox(l, w, s0, s1, y, h, t, col, key, off) {
      var dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.abs(dx) + Math.abs(dz);
      var ux = dx / len, uz = dz / len, sm = (s0 + s1) / 2;
      var cx = w.a[0] + ux * sm, cz = w.a[1] + uz * sm;
      if (off) { cx += -uz * off; cz += ux * off; }
      var L = s1 - s0;
      l.box(cx, y, cz, ux !== 0 ? L : t, h, ux !== 0 ? t : L, col, key == null ? cx + cz : key);
    }
    function pieces(w) {
      var dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.abs(dx) + Math.abs(dz), out = [], cur = 0;
      w.open.forEach(function (o) {
        if (o[0] > cur) out.push([cur, o[0], 'x']);
        out.push([o[0], o[1], o[2]]); cur = o[1];
      });
      if (cur < len) out.push([cur, len, 'x']);
      return out;
    }

    var plan = new Layer(0.12, 1, { w: 0.5, lift: 0.5, out: [2.9, 3.4], flat: 1 });
    var ghost = new Layer(1.05, 1.9, { w: 0.6, lift: 0.9, alpha: 0.26, out: [2.05, 2.75] });
    var studs = new Layer(2.02, 2.72, { w: 0.22, lift: 1.3 });
    var mep = new Layer(2.5, 2.92, { w: 0.4, lift: 0.7, out: [3.5, 3.8] });
    var insul = new Layer(3.04, 3.22, { w: 0.5, lift: 0.5, out: [3.5, 3.8] });
    var dry = new Layer(3.16, 3.68, { w: 0.25, lift: 1.3 });
    /* each wall is painted its own soft colour, like rooms in a real job */
    var PAINTS = [0xFFFFFF, 0xF4EEDD, 0xE3EADD, 0xFFFFFF, 0xDCE5EA, 0xD9E8E3, 0xF1E6DC, 0xF4EEDD, 0xE3EADD];
    var glass = new Layer(3.3, 3.75, { w: 0.5, lift: 0.8, alpha: 0.5 });

    WALLS.forEach(function (w, wi) {
      var sill = 0.85, paintCol = PAINTS[wi % PAINTS.length];
      pieces(w).forEach(function (p) {
        var s0 = p[0], s1 = p[1], kind = p[2], s;
        if (kind !== 'd') {
          wallBox(plan, w, s0, s1, Y + 0.004, 0.02, 0.12, K.green);
          if (kind === 'w') wallBox(plan, w, s0 + 0.05, s1 - 0.05, Y + 0.006, 0.02, 0.3, K.greenL);
        } else {
          wallBox(plan, w, s0, s0 + 0.06, Y + 0.004, 0.02, 0.3, K.green);
          wallBox(plan, w, s1 - 0.06, s1, Y + 0.004, 0.02, 0.3, K.green);
        }
        if (kind === 'd') return;
        var h = kind === 'w' ? sill : H;
        wallBox(ghost, w, s0, s1, Y, h, 0.17, K.greenL);
        /* framing */
        wallBox(studs, w, s0, s1, Y, 0.07, 0.13, K.woodB);
        for (s = s0 + 0.04; s < s1 - 0.01; s += 0.46) wallBox(studs, w, s, Math.min(s1, s + 0.075), Y + 0.07, h - 0.14, 0.13, K.wood);
        wallBox(studs, w, s1 - 0.075, s1, Y + 0.07, h - 0.14, 0.13, K.wood);
        wallBox(studs, w, s0, s1, Y + h - 0.07, 0.07, 0.13, K.woodB);
        if (kind === 'x') {
          wallBox(studs, w, s0, s1, Y + h, 0.06, 0.13, K.woodD);
          /* blocking between the studs, staggered the way a framer nails it */
          for (s = s0 + 0.04; s < s1 - 0.5; s += 0.46) wallBox(studs, w, s + 0.075, Math.min(s1, s + 0.46), Y + 0.62 + (Math.round(s / 0.46) % 2) * 0.12, 0.06, 0.11, K.woodB);
        }
        if (w.ext) for (s = s0; s < s1 - 0.01; s += 1) wallBox(insul, w, s + 0.02, Math.min(s1, s + 1) - 0.02, Y + 0.07, h - 0.14, 0.07, K.pink, null, -0.02);
        /* board, in sheets */
        for (s = s0; s < s1 - 0.01; s += 1.15) {
          var e = Math.min(s1, s + 1.15);
          wallBox(dry, w, s, e, Y, h, 0.19, paintCol);
          wallBox(dry, w, s, e, Y + h, 0.025, 0.19, K.cap);
        }
        if (kind === 'w') {
          wallBox(glass, w, s0 + 0.04, s1 - 0.04, Y + sill + 0.025, H - sill - 0.03, 0.05, K.tealL);
          wallBox(dry, w, s0, s0 + 0.07, Y + sill, H - sill + 0.025, 0.19, K.cap);
          wallBox(dry, w, s1 - 0.07, s1, Y + sill, H - sill + 0.025, 0.19, K.cap);
        }
      });
    });
    /* stakes and string at the corners while the job is being priced */
    [[-0.5, -0.5], [12.5, -0.5], [12.5, 9.5], [-0.5, 9.5]].forEach(function (c, i) {
      plan.box(c[0], 0.05, c[1], 0.08, 0.6, 0.08, K.wood, -3 + i * 0.2);
      plan.box(c[0] + 0.12, 0.5, c[1], 0.26, 0.14, 0.03, K.vis, -2.9 + i * 0.2);
    });
    plan.box(6, 0.52, -0.5, 13, 0.025, 0.025, K.string, -2); plan.box(6, 0.52, 9.5, 13, 0.025, 0.025, K.string, -1.9);
    plan.box(-0.5, 0.52, 4.5, 0.025, 0.025, 10, K.string, -1.8); plan.box(12.5, 0.52, 4.5, 0.025, 0.025, 10, K.string, -1.7);
    /* a dimension line with ticks along the front, like a drawing */
    plan.box(6, Y + 0.004, 9.75, 12, 0.02, 0.04, K.greenL, 30);
    for (var tk = 0; tk <= 12; tk++) plan.box(tk, Y + 0.004, 9.75, 0.04, 0.02, tk % 4 ? 0.16 : 0.34, K.greenL, 30 + tk * 0.1);
    plan.box(-0.75, Y + 0.004, 4.5, 0.04, 0.02, 9, K.greenL, 32);
    for (tk = 0; tk <= 9; tk++) plan.box(-0.75, Y + 0.004, tk, tk % 3 ? 0.16 : 0.34, 0.02, 0.04, K.greenL, 32 + tk * 0.1);
    /* pipes and wires */
    function run(x0, z0, x1, z1, y, col, t) { mep.box((x0 + x1) / 2, y, (z0 + z1) / 2, Math.abs(x1 - x0) + t, t, Math.abs(z1 - z0) + t, col); }
    function riser(x, z, y0, y1, col, t) { mep.box(x, y0, z, t, y1 - y0, t, col); }
    var PT = 0.1, HT = 0.085, WT = 0.055;
    /* bath wet wall: cold (blue), hot (red), and a white drain stack */
    run(5.25, 8.8, 7.8, 8.8, Y + 0.42, K.pipe, PT); run(5.25, 8.8, 7.8, 8.8, Y + 0.66, K.hot, HT);
    [5.6, 6.5, 7.4].forEach(function (x) { riser(x, 8.8, Y + 0.07, Y + 1.15, K.pipe, PT); riser(x + 0.22, 8.8, Y + 0.07, Y + 0.95, K.hot, HT); });
    run(5.2, 5.75, 5.2, 8.8, Y + 0.42, K.pipe, PT); run(5.2, 5.75, 5.2, 8.8, Y + 0.66, K.hot, HT);
    riser(5.2, 6.4, Y + 0.07, Y + 0.95, K.pipe, PT); riser(5.2, 7.9, Y + 0.07, Y + 1.4, K.pvc, 0.15); riser(7.6, 5.72, Y + 0.07, Y + 1.4, K.pvc, 0.15);
    run(5.3, 5.72, 7.6, 5.72, Y + 0.2, K.pvc, 0.13);
    /* kitchen wall */
    run(8.3, 0.2, 11.8, 0.2, Y + 0.46, K.pipe, PT); run(8.3, 0.2, 11.8, 0.2, Y + 0.7, K.hot, HT);
    [9.2, 10.4].forEach(function (x) { riser(x, 0.2, Y + 0.07, Y + 1.05, K.pipe, PT); riser(x + 0.22, 0.2, Y + 0.07, Y + 0.9, K.hot, HT); });
    run(11.8, 0.2, 11.8, 3.6, Y + 0.46, K.pipe, PT); run(11.8, 0.2, 11.8, 3.6, Y + 0.7, K.hot, HT); riser(11.8, 2.2, Y + 0.07, Y + 1.4, K.pvc, 0.15);
    /* wires: a run high on every wall, with drops to the boxes */
    run(0.2, 0.2, 0.2, 5.3, Y + 1.22, K.wire, WT); run(0.2, 5.3, 7.9, 5.3, Y + 1.22, K.wire, WT);
    run(0.2, 0.2, 7.8, 0.2, Y + 1.22, K.wire, WT); run(7.8, 0.2, 7.8, 4, Y + 1.22, K.wire, WT);
    run(0.2, 5.7, 0.2, 8.8, Y + 1.22, K.wire, WT); run(0.2, 8.8, 4.8, 8.8, Y + 1.22, K.wire, WT);
    run(8.2, 4.2, 11.8, 4.2, Y + 1.22, K.wire, WT); run(11.8, 4.2, 11.8, 8.8, Y + 1.22, K.wire, WT);
    run(4.8, 5.7, 4.8, 8.8, Y + 1.22, K.wire, WT); run(8.2, 5.7, 8.2, 8.8, Y + 1.22, K.wire, WT); run(8.2, 8.8, 11.8, 8.8, Y + 1.22, K.wire, WT);
    [[0.2, 1.2], [0.2, 2.6], [0.2, 4.4], [1.6, 5.3], [3, 5.3], [6.4, 5.3], [2.2, 0.2], [5.6, 0.2], [7.8, 0.7], [7.8, 3.4], [0.2, 7.2], [1.2, 8.8], [2.4, 8.8], [4, 8.8],
      [4.8, 7], [8.2, 7.6], [9.4, 8.8], [10, 4.2], [11.2, 4.2], [11.8, 5.6], [11.8, 8]].forEach(function (p) {
      riser(p[0], p[1], Y + 0.5, Y + 1.22, K.wire, WT); mep.box(p[0], Y + 0.4, p[1], 0.16, 0.16, 0.16, K.box);
    });
    /* the panel */
    mep.box(11.8, Y + 0.55, 8.4, 0.14, 0.7, 0.5, K.box);

    /* ---------- floors ---------- */
    var floor = new Layer(3.5, 3.97, { w: 0.3, lift: 0.5, flat: 1 });
    function planks(x0, z0, x1, z1) {
      var i = 0;
      for (var z = z0; z < z1 - 0.02; z += 0.42) {
        var d = Math.min(0.4, z1 - z), x = x0, j = 0;
        while (x < x1 - 0.02) {
          var L = Math.min(x1 - x, 1.5 + ((i * 7 + j * 3) % 5) * 0.45);
          floor.box(x + L / 2 - 0.01, Y, z + d / 2, L - 0.02, 0.05, d, [K.floorA, K.floorB, K.floorC][(i + j * 2) % 3]);
          x += L; j++;
        }
        i++;
      }
    }
    function tiles(x0, z0, x1, z1, a, b, sz) {
      for (var x = x0, i = 0; x < x1 - 0.02; x += sz, i++) for (var z = z0, j = 0; z < z1 - 0.02; z += sz, j++) {
        floor.box(x + Math.min(sz, x1 - x) / 2, Y, z + Math.min(sz, z1 - z) / 2, Math.min(sz, x1 - x) - 0.03, 0.05, Math.min(sz, z1 - z) - 0.03, (i + j) % 2 ? a : b);
      }
    }
    planks(0.1, 0.1, 7.9, 5.4); planks(0.1, 5.6, 4.9, 8.9); planks(8.1, 4.1, 11.9, 8.9); planks(7.9, 4, 8.1, 5.5);
    tiles(5.1, 5.6, 7.9, 8.9, K.tileA, K.tileB, 0.47); tiles(8.1, 0.1, 11.9, 3.9, K.tileA, K.tileK, 0.63);

    /* ---------- finishes ---------- */
    var fin = new Layer(3.78, 4.95, { w: 0.16, lift: 1.6 });
    var FY = Y + 0.05, kk = 0;
    function f(cx, y, cz, sx, sy, sz, col) { fin.box(cx, FY + y, cz, sx, sy, sz, col, kk); kk += 0.001; }
    function next() { kk += 1; }
    /* kitchen */
    f(10.05, 0, 0.42, 3.5, 0.55, 0.62, K.green); f(10.05, 0.55, 0.42, 3.56, 0.05, 0.68, K.white);
    f(9.3, 0.6, 0.42, 0.6, 0.02, 0.42, K.ink); f(10.9, 0.57, 0.42, 0.55, 0.04, 0.38, K.steel); next();
    f(11.58, 0, 1.75, 0.62, 0.55, 2.0, K.green); f(11.58, 0.55, 1.75, 0.68, 0.05, 2.06, K.white); next();
    f(11.5, 0, 3.3, 0.72, 1.25, 0.72, K.steel); next();
    f(9.6, 0, 2.5, 1.5, 0.55, 0.7, K.greenD); f(9.6, 0.55, 2.5, 1.62, 0.05, 0.82, K.white);
    f(9.1, 0, 3.15, 0.3, 0.38, 0.3, K.wood); f(10.1, 0, 3.15, 0.3, 0.38, 0.3, K.wood); next();
    /* bath */
    f(6.25, 0, 8.45, 1.9, 0.42, 0.78, K.white); f(6.25, 0.38, 8.45, 1.66, 0.045, 0.56, K.tealL); next();
    f(5.5, 0, 6.5, 0.42, 0.3, 0.55, K.white); f(5.33, 0.3, 6.5, 0.16, 0.34, 0.5, K.white); next();
    f(6.6, 0, 5.92, 1.3, 0.5, 0.48, K.green); f(6.6, 0.5, 5.92, 1.36, 0.05, 0.54, K.white); f(6.6, 0.56, 5.72, 0.9, 0.5, 0.04, K.tealL); next();
    /* bedroom */
    f(2.4, 0.005, 7.4, 3.3, 0.02, 2.4, K.tileB); next();
    f(2.4, 0.03, 7.6, 1.8, 0.22, 2.3, K.woodD); f(2.4, 0.25, 7.6, 1.7, 0.2, 2.2, K.white); f(2.4, 0.45, 7.2, 1.74, 0.04, 1.3, K.green);
    f(1.95, 0.45, 8.35, 0.6, 0.1, 0.36, K.paper); f(2.85, 0.45, 8.35, 0.6, 0.1, 0.36, K.paper); f(2.4, 0.03, 8.78, 1.9, 0.75, 0.1, K.woodD); next();
    f(1.0, 0, 8.5, 0.5, 0.36, 0.5, K.wood); f(1.0, 0.36, 8.5, 0.16, 0.26, 0.16, K.vis); f(3.8, 0, 8.5, 0.5, 0.36, 0.5, K.wood); next();
    f(4.55, 0, 6.6, 0.55, 1.2, 1.5, K.woodB); next();
    /* living */
    f(3.2, 0.005, 2.7, 3.6, 0.02, 2.6, K.slateL); next();
    f(0.72, 0, 2.7, 0.95, 0.3, 2.7, K.slate); f(0.4, 0.3, 2.7, 0.3, 0.42, 2.7, K.slate);
    f(0.78, 0.3, 1.47, 0.82, 0.22, 0.25, K.slate); f(0.78, 0.3, 3.93, 0.82, 0.22, 0.25, K.slate);
    f(0.95, 0.3, 2.2, 0.5, 0.12, 0.5, K.green); f(0.95, 0.3, 3.2, 0.5, 0.12, 0.5, K.tealL); next();
    f(2.9, 0.025, 2.7, 0.9, 0.3, 1.5, K.wood); f(2.9, 0.33, 2.5, 0.3, 0.05, 0.4, K.paper); next();
    f(4.6, 0, 5.12, 2.6, 0.42, 0.45, K.woodB); f(4.6, 0.48, 5.22, 1.7, 0.85, 0.07, K.ink); next();
    f(6.2, 0.5, 1.5, 1.9, 0.07, 1.1, K.wood);
    [[5.4, 1.05], [7.0, 1.05], [5.4, 1.95], [7.0, 1.95]].forEach(function (p) { f(p[0], 0, p[1], 0.08, 0.5, 0.08, K.woodD); });
    [[5.75, 0.6], [6.65, 0.6], [5.75, 2.4], [6.65, 2.4]].forEach(function (p) { f(p[0], 0, p[1], 0.42, 0.32, 0.42, K.slateL); }); next();
    f(0.55, 0, 0.55, 0.45, 0.4, 0.45, K.paper); f(0.55, 0.4, 0.55, 0.7, 0.6, 0.7, K.green); f(0.62, 0.95, 0.5, 0.45, 0.4, 0.45, K.greenL); next();
    /* hall */
    f(10.9, 0.005, 6.8, 1.6, 0.02, 1.0, K.tealL); f(9, 0, 8.6, 1.5, 0.34, 0.5, K.wood); f(8.7, 0.34, 8.6, 0.4, 0.1, 0.36, K.green); next();
    /* doors, left ajar */
    f(3.33, 0, 5.05, 0.06, 1.3, 0.9, K.woodB); f(8.45, 0, 6.3, 0.9, 1.3, 0.06, K.woodB); f(12.45, 0, 6.3, 0.9, 1.3, 0.07, K.green); next();
    f(13.1, -0.2, 7.8, 0.6, 0.45, 0.6, K.paper); f(13.1, 0.25, 7.8, 0.75, 0.5, 0.75, K.greenL); next();

    /* ---------- the yard: what comes and goes ---------- */
    var desk = new Layer(0.3, 0.8, { w: 0.6, lift: 1.2, out: [1.9, 2.4] });
    desk.box(14.9, 0, 6.6, 0.08, 0.6, 0.08, K.wood, 0); desk.box(16.1, 0, 6.6, 0.08, 0.6, 0.08, K.wood, 0);
    desk.box(14.9, 0, 7.5, 0.08, 0.6, 0.08, K.wood, 0); desk.box(16.1, 0, 7.5, 0.08, 0.6, 0.08, K.wood, 0);
    desk.box(15.5, 0.6, 7.05, 1.7, 0.06, 1.2, K.woodB, 1); desk.box(15.5, 0.66, 7.05, 1.35, 0.015, 0.9, K.paper, 2);
    desk.box(15.5, 0.676, 6.85, 0.9, 0.006, 0.04, K.green, 3); desk.box(15.2, 0.676, 7.1, 0.04, 0.006, 0.5, K.green, 3); desk.box(15.75, 0.676, 7.25, 0.5, 0.006, 0.04, K.green, 3);
    desk.finish();

    var bin = new Layer(1.35, 1.9, { w: 0.7, lift: 2.2, out: [4.35, 4.8] });
    bin.box(15.2, 0.05, 1.9, 2.0, 0.12, 3.2, K.greenD, 0);
    bin.box(14.25, 0.17, 1.9, 0.1, 0.95, 3.2, K.green, 1); bin.box(16.15, 0.17, 1.9, 0.1, 0.95, 3.2, K.green, 1);
    bin.box(15.2, 0.17, 0.35, 1.8, 0.95, 0.1, K.green, 1); bin.box(15.2, 0.17, 3.45, 1.8, 0.95, 0.1, K.green, 1);
    bin.finish();
    /* the dumpster fills as the job goes on */
    var fill = new Layer(1.9, 2.1, { w: 1, lift: 0, out: [4.35, 4.8] });
    fill.box(0, 0, 0, 1.8, 0.8, 3.0, 0x6F6A60, 0); fill.box(-0.3, 0.8, -0.6, 0.9, 0.1, 0.5, K.woodD, 0); fill.box(0.3, 0.8, 0.6, 0.5, 0.13, 0.9, K.cap, 0);
    fill.box(-0.2, 0.8, 0.9, 0.7, 0.08, 0.3, K.pink, 0); fill.box(0.4, 0.8, -0.9, 0.5, 0.09, 0.6, K.woodB, 0);
    fill.finish(); fill.mesh.position.set(15.2, 0.17, 1.9);

    var lumber = new Layer(1.55, 2.0, { w: 0.6, lift: 1.5, out: [2.3, 2.75] });
    for (var li = 0; li < 4; li++) for (var lj = 0; lj < 5; lj++) lumber.box(14.1 + lj * 0.2, 0.12 + li * 0.11, 8.2, 0.17, 0.09, 2.6, lj % 2 ? K.wood : K.woodB, li + lj * 0.1);
    lumber.box(14.5, 0, 7.3, 1.2, 0.12, 0.14, K.woodD, -1); lumber.box(14.5, 0, 9.1, 1.2, 0.12, 0.14, K.woodD, -1);
    lumber.finish();

    var board = new Layer(2.75, 3.05, { w: 0.6, lift: 1.5, out: [3.25, 3.7] });
    for (li = 0; li < 7; li++) board.box(15.0, 0.14 + li * 0.07, 5.2, 1.3, 0.055, 2.5, li % 2 ? K.white : 0xE4E6E0, li);
    board.box(15, 0, 4.4, 1.3, 0.14, 0.14, K.woodD, -1); board.box(15, 0, 6, 1.3, 0.14, 0.14, K.woodD, -1);
    board.finish();

    /* the box truck backs in from the right, drops its load, and drives off the same way */
    var truck = new Layer(2.05, 2.2, { w: 1, lift: 0, out: [4.5, 4.8] });
    truck.box(0, 0.32, 0, 3.0, 1.25, 1.35, K.white, 0); truck.box(0, 0.32, 0.68, 2.2, 0.5, 0.012, K.green, 0);
    truck.box(2.05, 0.32, 0, 1.0, 0.95, 1.3, K.green, 0); truck.box(2.3, 0.85, 0, 0.52, 0.36, 1.2, K.tealL, 0);
    truck.box(0.3, 0.2, 0, 4.4, 0.14, 1.2, K.ink, 0);
    [[-0.9, 0.62], [1.9, 0.62], [-0.9, -0.62], [1.9, -0.62]].forEach(function (p) { truck.box(p[0], 0.03, p[1], 0.5, 0.5, 0.2, K.ink, 0); });
    truck.finish(); truck.mesh.position.set(2, 0, 12.5);
    /* reversing lights: they blink only while the truck is backing up, and only as the job moves */
    var blink = new Layer(2.05, 2.06, { w: 1, lift: 0, glow: 1 });
    blink.box(-1.53, 0.5, 0.5, 0.06, 0.2, 0.26, K.lamp, 0); blink.box(-1.53, 0.5, -0.5, 0.06, 0.2, 0.26, K.lamp, 0); blink.box(-1.2, 1.57, 0, 0.24, 0.1, 0.24, K.vis, 0);
    blink.finish(); truck.mesh.add(blink.mesh); scene.remove(blink.mesh); scene.add(truck.mesh);

    var car = new Layer(4.75, 5, { w: 1, lift: 0 });
    car.box(0, 0.22, 0, 2.3, 0.4, 1.1, K.tealL, 0); car.box(-0.1, 0.62, 0, 1.2, 0.36, 1.0, K.white, 0); car.box(-0.1, 0.66, 0, 1.24, 0.24, 0.9, K.slate, 0);
    [[-0.7, 0.5], [0.75, 0.5], [-0.7, -0.5], [0.75, -0.5]].forEach(function (p) { car.box(p[0], 0.03, p[1], 0.42, 0.42, 0.18, K.ink, 0); });
    car.finish(); car.mesh.position.set(14.5, 0, 12.4);

    [plan, ghost, studs, mep, insul, dry, glass, floor, fin].forEach(function (l) { l.finish(); });

    /* ---------- people ---------- */
    function person(vest, hat, a, b, out, path, carry) {
      var l = new Layer(a, b, { w: 1, lift: 0.8, out: out });
      if (carry) { l.box(0.06, 0.98, 0, 0.16, 0.05, 2.1, K.wood, 0); l.box(0.2, 0.52, 0, 0.1, 0.5, 0.1, vest, 0); }
      l.box(0, 0, 0, 0.26, 0.34, 0.2, K.ink, 0); l.box(0, 0.34, 0, 0.32, 0.36, 0.22, vest, 0);
      l.box(0, 0.7, 0, 0.2, 0.2, 0.2, K.skin, 0); l.box(0, 0.88, 0, 0.26, 0.09, 0.26, hat, 0);
      l.finish(); l.path = path; return l;
    }
    /* path: [s, x, z] waypoints, the figure walks between them as the job moves on */
    var people = [
      person(K.green, K.hat, 0.2, 0.5, null, [[0, 14.3, 7.6], [1, 14.6, 7.9], [2, 13.4, 5.5], [3, 3.2, 3.4], [4, 6.4, 3.6], [4.6, 10.2, 5.2], [5, 13.3, 6.3]]),
      person(K.vis, K.vis, 2.0, 2.3, [4.5, 4.8], [[2, 13.5, 8.6], [2.5, 6.4, 7.2], [3, 6.5, 6.9], [3.5, 10.2, 2.9], [4, 10.6, 1.6], [4.5, 13.5, 3]]),
      person(K.vis, K.hat, 2.1, 2.4, [4.4, 4.7], [[2, 13.2, 9.3], [2.6, 2, 6.5], [3, 2.6, 7.2], [3.6, 4.4, 1.2], [4, 2.2, 4.4], [4.5, 13, 9.4]], true),
      person(K.tealL, K.slate, 4.7, 4.95, null, [[4.6, 14.4, 10.9], [5, 13.9, 7.2]])
    ];
    function walk(l, s) {
      var p = l.path, i = 0;
      while (i < p.length - 2 && s > p[i + 1][0]) i++;
      var k = smooth((s - p[i][0]) / (p[i + 1][0] - p[i][0]));
      l.mesh.position.set(lerp(p[i][1], p[i + 1][1], k), (l.inside ? FY : 0.02), lerp(p[i][2], p[i + 1][2], k));
      var x = l.mesh.position.x, z = l.mesh.position.z;
      l.mesh.position.y = (x > 0 && x < 12 && z > 0 && z < 9) ? Y + 0.02 : (z > 10.2 && z < 11.7 ? 0.1 : 0.03);
    }

    /* ---------- camera ---------- */
    var CAM = [
      { az: -0.66, el: 0.62, zoom: 1.0, tx: 6.5, tz: 5.6 },
      { az: -0.5, el: 0.74, zoom: 1.06, tx: 7.2, tz: 5.4 },
      { az: -0.86, el: 0.66, zoom: 1.08, tx: 6.6, tz: 5.2 },
      { az: -0.42, el: 0.58, zoom: 1.26, tx: 6.2, tz: 5.0 },
      { az: -0.98, el: 0.68, zoom: 1.22, tx: 6.6, tz: 4.8 },
      { az: -0.7, el: 0.6, zoom: 1.12, tx: 6.8, tz: 5.4 }
    ];
    var V = { w: 1, h: 1, cx: 0.5, cy: 0.5, avail: 1, tcx: 0.5, tcy: 0.5, tavail: 1, azOff: 0, elOff: 0, vAz: 0 };
    var S = { dusk: -1, s: opt.s || 0, target: opt.s || 0, dirty: true, shadowDirty: true, running: false, last: 0, drag: false, hold: 0 };
    var listeners = [];

    function camUpdate() {
      var s = S.s, i = Math.min(4, Math.floor(s)), k = smooth(s - i), a = CAM[i], b = CAM[i + 1];
      var az = lerp(a.az, b.az, k) + V.azOff, el = Math.max(0.3, Math.min(1.25, lerp(a.el, b.el, k) + V.elOff));
      var zoom = lerp(a.zoom, b.zoom, k), tx = lerp(a.tx, b.tx, k), tz = lerp(a.tz, b.tz, k);
      var z = fit(V.w, V.h, V.avail) * zoom;
      var hw = V.w / 2 / z, hh = V.h / 2 / z, ox = (V.cx - 0.5) * V.w / z, oy = (V.cy - 0.5) * V.h / z;
      cam.left = -hw - ox; cam.right = hw - ox; cam.top = hh + oy; cam.bottom = -hh + oy;
      var R = 80, ce = Math.cos(el);
      cam.position.set(tx + R * ce * Math.sin(az), 0.6 + R * Math.sin(el), tz + R * ce * Math.cos(az));
      cam.lookAt(tx, 0.6, tz);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    }

    dry.u.uTint.value.set(0.77, 0.78, 0.75);
    var duskSky = new THREE.Color(0x8FA3C4), glassA = new THREE.Color(0xffffff), glassB = new THREE.Color(0xFFD9A8), glassE = new THREE.Color(0xE09A3A);
    var lamps = [[3.6, 2.6, 0.9], [10, 2, 0.75], [2.4, 7.3, 0.6], [6.4, 7.2, 0.5], [10, 6.6, 0.55], [13.2, 6.4, 0.5]].map(function (p) {
      var L = new THREE.PointLight(0xFFC477, 0, 7, 1.5); L.position.set(p[0], Y + 1.25, p[1]); L.userData.full = p[2]; scene.add(L); return L;
    });
    /* lamp shades that glow, and a porch light by the door */
    var glow = new Layer(-1, -0.5, { lift: 0, glow: 1 });
    glow.box(1.0, FY + 0.62, 8.5, 0.2, 0.2, 0.2, K.lamp, 0); glow.box(3.8, FY + 0.38, 8.5, 0.16, 0.2, 0.16, K.lamp, 0);
    glow.box(0.55, FY + 1.02, 5.0, 0.22, 0.26, 0.22, K.lamp, 0); glow.box(9.6, FY + 0.9, 2.5, 0.7, 0.04, 0.12, K.lamp, 0);
    glow.box(12.24, Y + 1.2, 5.9, 0.12, 0.2, 0.16, K.lamp, 0); glow.box(6.6, FY + 1.1, 5.7, 0.7, 0.05, 0.06, K.lamp, 0);
    glow.finish(); glow.mat.transparent = true; glow.mesh.visible = false;
    function apply() {
      var s = S.s, changed = false;
      for (var i = 0; i < layers.length; i++) {
        var l = layers[i], r = l.a < 0 ? 1 : smooth((s - l.a) / (l.b - l.a));
        if (l.c != null) r *= 1 - smooth((s - l.c) / (l.d - l.c));
        if (r !== l.last) { l.last = r; l.u.uR.value = r; l.mesh.visible = r > 0.0005; changed = true; }
      }
      /* paint: primer grey first, then the colour sweeps across the job */
      dry.u.uSweep.value = lerp(-3, 22, clamp((s - 3.62) / 0.36));
      var back = smooth((s - 2.08) / 0.5), away = smooth((s - 4.42) / 0.38);
      truck.mesh.position.x = lerp(15.6, 3.4, back) + lerp(0, 12.4, away);
      blink.mesh.visible = truck.mesh.visible && back > 0.02 && back < 0.98 && (Math.floor(s * 46) % 2 === 0);
      fill.mesh.scale.y = lerp(0.12, 1, clamp((s - 2.0) / 2.2));
      /* the end of the job: the light drops and the lamps come on */
      var dusk = smooth((s - 4.72) / 0.26);
      if (dusk !== S.dusk) {
        S.dusk = dusk;
        hemi.intensity = lerp(0.72, 0.6, dusk); hemi.color.setHex(0xffffff).lerp(duskSky, dusk * 0.7); sun.intensity = lerp(0.44, 0.3, dusk);
        for (i = 0; i < lamps.length; i++) lamps[i].intensity = lamps[i].userData.full * dusk;
        glass.mat.color.copy(glassA).lerp(glassB, dusk); glass.mat.emissive.copy(glassE).multiplyScalar(dusk * 0.55); glass.mat.opacity = lerp(0.5, 0.72, dusk);
        glow.mesh.visible = dusk > 0.01; glow.mat.opacity = dusk;
      }
      car.mesh.position.x = lerp(0, 4.5, smooth((s - 4.7) / 0.3));
      for (i = 0; i < people.length; i++) walk(people[i], s);
      return changed;
    }

    function frame(ts) {
      if (!S.running) return;
      requestAnimationFrame(frame);
      var dt = Math.min(0.05, (ts - S.last) / 1000 || 0.016); S.last = ts;
      var moved = false, d = S.target - S.s;
      if (Math.abs(d) > 0.0004) { S.s += d * (1 - Math.exp(-dt * (opt.snap ? 60 : 4.2))); moved = true; }
      else if (d !== 0) { S.s = S.target; moved = true; }
      var k = 1 - Math.exp(-dt * 5), e;
      e = V.tcx - V.cx; if (Math.abs(e) > 0.0005) { V.cx += e * k; S.dirty = true; } else V.cx = V.tcx;
      e = V.tcy - V.cy; if (Math.abs(e) > 0.0005) { V.cy += e * k; S.dirty = true; } else V.cy = V.tcy;
      e = V.tavail - V.avail; if (Math.abs(e) > 0.0005) { V.avail += e * k; S.dirty = true; } else V.avail = V.tavail;
      if (!S.drag) {
        if (S.hold > 0) S.hold -= dt;
        else if (Math.abs(V.azOff) > 0.001 || Math.abs(V.elOff) > 0.001 || Math.abs(V.vAz) > 0.001) {
          /* a soft spring carries the view back to the stage's own angle */
          V.vAz += (-V.azOff * 26 - V.vAz * 9) * dt; V.azOff += V.vAz * dt; V.elOff += -V.elOff * (1 - Math.exp(-dt * 4)); S.dirty = true;
        } else { V.azOff = 0; V.elOff = 0; V.vAz = 0; }
      }
      if (moved) { apply(); S.shadowDirty = true; S.dirty = true; }
      if (S.dirty) draw();
    }
    function draw() {
      camUpdate();
      if (S.shadowDirty) { renderer.shadowMap.needsUpdate = true; S.shadowDirty = false; }
      renderer.render(scene, cam);
      S.dirty = false;
      for (var i = 0; i < listeners.length; i++) listeners[i](S.s);
    }

    /* ---------- drag to turn ---------- */
    var px = 0, py = 0, pid = null;
    canvas.addEventListener('pointerdown', function (e) { if (pid !== null) return; pid = e.pointerId; px = e.clientX; py = e.clientY; S.drag = true; V.vAz = 0; canvas.classList.add('grab'); });
    window.addEventListener('pointermove', function (e) {
      if (e.pointerId !== pid) return;
      var dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
      V.azOff = Math.max(-1.6, Math.min(1.6, V.azOff - dx * 0.006));
      if (e.pointerType === 'mouse') V.elOff = Math.max(-0.3, Math.min(0.5, V.elOff + dy * 0.004));
      S.dirty = true;
    });
    function up(e) { if (e.pointerId !== pid) return; pid = null; S.drag = false; S.hold = 1.6; canvas.classList.remove('grab'); }
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);

    var tv = new THREE.Vector3();
    var api = {
      setS: function (s, now) { S.target = Math.max(0, Math.min(5, s)); if (now) { S.s = S.target; apply(); S.shadowDirty = true; S.dirty = true; } },
      getS: function () { return S.s; },
      setLayout: function (cx, cy, avail, now) { V.tcx = cx; V.tcy = cy; V.tavail = avail; if (now) { V.cx = cx; V.cy = cy; V.avail = avail; S.dirty = true; } },
      turn: function (d) { V.azOff = Math.max(-1.6, Math.min(1.6, V.azOff + d)); V.vAz = 0; S.hold = 2.4; S.dirty = true; },
      resize: function () {
        var w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
        V.w = w; V.h = h; renderer.setSize(w, h, false); S.dirty = true;
      },
      project: function (x, y, z, out) { tv.set(x, y, z).project(cam); out[0] = (tv.x + 1) / 2 * V.w; out[1] = (1 - tv.y) / 2 * V.h; return out; },
      onFrame: function (fn) { listeners.push(fn); },
      start: function () { if (S.running) return; S.running = true; S.last = performance.now(); S.dirty = true; requestAnimationFrame(frame); },
      stop: function () { S.running = false; },
      drawNow: function () { apply(); S.shadowDirty = true; draw(); },
      calls: function () { return renderer.info.render.calls; }
    };
    api.resize(); apply();
    return api;
  }

  /* pixels per scene unit for a canvas of w by h. The page uses the same sum to lay the still picture exactly over the first live frame. */
  function fit(w, h, avail) { return Math.min(w * avail / 23.5, h / 17.5); }
  window.MageJob = { create: create, fit: fit, REST_ZOOM: 1.12 };
})();
