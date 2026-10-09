// components/livingModel/threeScene.ts — the job model as a 3D scene.
//
// The Living Model, Phase 1. This file does NOT load the 3D library. It is
// handed the library by its one caller (JobReplay3D.web.tsx, which loads it
// with a dynamic import, on the web only, when the view opens) and only names
// its type. So the phone bundle, which never reads the web view, never reads
// this file either, and nothing here can pull the library in at startup.
//
// It draws what utils/livingModel/sceneCore.ts worked out as plain numbers:
// extruded walls with holes for doors and windows, floor slabs, and the layers
// a stage shows (the frame, pipes and wires in the open wall, batts, board,
// trim). One sky light and one soft sun. No texture, no gradient, no blur.
//
// A SCHEMATIC. Colours come from the theme and the palette
// (utils/livingModel/palette.ts, which holds a light table and a dark one);
// none is written here, the lights included.
//
// EACH ROOM'S FLOOR CARRIES ITS STAGE COLOUR (palette.stage, by palette.floorTint), so the stage
// reads from the room itself and not only from the dot on its label.
//
// THE HOME VIEW FITS THE WALLS, not only the floor: the zoom comes from
// sceneCore.viewExtent with the height the walls are drawn at, so full-height
// walls stay inside the frame on Reset View.
//
// ONE SCENE, ONE CANVAS. `dispose` gives the WebGL context back to the browser
// (forceContextLoss), so a canvas that held a scene cannot hold another: the
// web view mounts a fresh canvas for each scene it makes.
import { modelBounds, roomBounds } from '@/utils/livingModel/modelCore';
import { hexToRgb, type LivingModelPalette } from '@/utils/livingModel/palette';
import type { RoomLayers } from '@/utils/livingModel/replayCore';
import { buildRoomGeometry, fitSpan, fitZoom, revealRange, viewExtent, type BoxBuf, type RoomGeometry } from '@/utils/livingModel/sceneCore';
import type { RoomStage } from '@/utils/livingModel/stageCore';
import type { Bounds } from '@/utils/livingModel/types';
import type { PlacedRoom } from '@/utils/livingModel/types';

type Three = typeof import('three');
type Mesh = InstanceType<Three['Mesh']>;
type Material = InstanceType<Three['Material']>;
type LambertMaterial = InstanceType<Three['MeshLambertMaterial']>;

export interface RoomLook {
  solid: RoomLayers;
  /** The plan for the moment being looked at, drawn faint where it is ahead of `solid`. */
  ghost: RoomLayers;
  /** True when the room's floor may loosen to subfloor (it has work that opens the walls). */
  opens: boolean;
  /** The room's stage at the moment shown: its floor takes that colour. */
  stage: RoomStage;
}

export interface JobSceneHandle {
  setRooms: (rooms: readonly PlacedRoom[], cutHeightM: number | null) => void;
  apply: (looks: ReadonlyMap<string, RoomLook>) => void;
  resize: (width: number, height: number, pixelRatio: number) => void;
  render: () => void;
  orbit: (dxPx: number, dyPx: number) => void;
  pan: (dxPx: number, dyPx: number) => void;
  zoomBy: (factor: number) => void;
  /** Turn the model about its middle by an angle in radians (two fingers twisting). */
  turnBy: (radians: number) => void;
  resetView: () => void;
  /** The room under a point of the canvas (pixels from its top left), or null. */
  pick: (xPx: number, yPx: number) => string | null;
  /** Where a room's label goes, in canvas pixels. */
  project: (roomId: string) => { x: number; y: number } | null;
  /** How wide a room is drawn on the canvas right now, in pixels. null for a room that is not in the scene. */
  roomWidthPx: (roomId: string) => number | null;
  /** How many rooms the scene holds. A scene that was just made holds none until `setRooms`. */
  roomCount: () => number;
  /** Let go of everything, the WebGL context included. The canvas cannot be used for another scene afterwards. */
  dispose: () => void;
}

/** The default angle: looking down and across, like a board game. */
export const DEFAULT_VIEW = { azimuth: 0.72, elevation: 0.9 } as const;

interface RoomMeshes {
  geo: RoomGeometry;
  box: Bounds | null;
  floor: Mesh;
  floorMat: LambertMaterial;
  boardMat: LambertMaterial;
  shell: Mesh | null;
  skin: Mesh | null;
  board: Mesh | null;
  studs: Mesh | null;
  pipes: Mesh | null;
  wires: Mesh | null;
  insulation: Mesh | null;
  trim: Mesh | null;
}

const ease = (x: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

export function createJobScene(THREE: Three, canvas: HTMLCanvasElement, palette: LivingModelPalette, opts: { preserveDrawingBuffer?: boolean } = {}): JobSceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
  renderer.setClearColor(palette.ground, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
  scene.add(new THREE.HemisphereLight(palette.sky, palette.plinth, palette.skyStrength));
  const sun = new THREE.DirectionalLight(palette.sun, palette.sunStrength);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const lambert = (color: string, extra: Record<string, unknown> = {}): LambertMaterial => new THREE.MeshLambertMaterial({ color, ...extra });
  const faint = (color: string, opacity = 0.3, extra: Record<string, unknown> = {}): LambertMaterial => new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false, ...extra });
  const M = {
    shell: lambert(palette.shell),
    old: lambert(palette.wallOld),
    stud: lambert(palette.stud),
    gStud: faint(palette.stud),
    pipes: lambert(palette.vertexBase, { vertexColors: true }),
    gPipes: faint(palette.vertexBase, 0.3, { vertexColors: true }),
    wire: lambert(palette.wire),
    gWire: faint(palette.wire),
    insulation: lambert(palette.insulation),
    gInsulation: faint(palette.insulation),
    gBoard: faint(palette.wallBoard, 0.5),
    trim: lambert(palette.trim),
    gTrim: faint(palette.trim),
    glass: new THREE.MeshLambertMaterial({ color: palette.glass, transparent: true, opacity: 0.55, depthWrite: false }),
    none: faint(palette.vertexBase, 0),
    plinth: lambert(palette.plinth),
    ground: lambert(palette.ground),
  };
  const C = {
    floorOld: new THREE.Color(palette.floorOld),
    floorSub: new THREE.Color(palette.floorSub),
    floorFinished: new THREE.Color(palette.floorFinished),
    board: new THREE.Color(palette.wallBoard),
    finished: new THREE.Color(palette.wallFinished),
  };
  const tint = new THREE.Color();
  const tmp = new THREE.Vector3();
  const ndc = new THREE.Vector2();
  const ray = new THREE.Raycaster();

  let world: InstanceType<Three['Group']> | null = null;
  let rooms = new Map<string, RoomMeshes>();
  let owned: Material[] = [];
  let pickable: Mesh[] = [];
  const V = { az: DEFAULT_VIEW.azimuth as number, el: DEFAULT_VIEW.elevation as number, zoom: 1, tx: 0, tz: 0, w: 1, h: 1, span: 8, homeX: 0, homeZ: 0, midY: 0.6, wallH: 1.2 };
  let floorBox: Bounds | null = null;
  /** Pixels per metre before the person's own zoom: the home view fitted to the floor box and the walls on it. */
  const baseZoom = (): number => fitZoom(viewExtent(floorBox, V.wallH, DEFAULT_VIEW.azimuth, DEFAULT_VIEW.elevation), V.w, V.h);

  function layerMesh(buf: BoxBuf, solid: Material, ghost: Material | null, shadow: boolean): Mesh | null {
    if (!buf.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.n, 3));
    if (buf.c.length) g.setAttribute('color', new THREE.Float32BufferAttribute(buf.c, 3));
    g.addGroup(0, 0, 0);
    g.addGroup(0, 0, 1);
    const m = new THREE.Mesh(g, [solid, ghost ?? M.none]);
    m.userData.boxes = buf.boxes;
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
  }

  function reveal(m: Mesh | null, solid: number, ghost: number): void {
    if (!m) return;
    const r = revealRange(m.userData.boxes as number, solid, ghost);
    const groups = m.geometry.groups;
    groups[0].start = 0;
    groups[0].count = r.solidCount;
    groups[1].start = r.ghostStart;
    groups[1].count = r.ghostCount;
    m.visible = r.solidCount + r.ghostCount > 0;
  }

  function clear(): void {
    if (!world) return;
    scene.remove(world);
    world.traverse((o) => { const g = (o as Mesh).geometry; if (g) g.dispose(); });
    for (const m of owned) m.dispose();
    owned = [];
    world = null;
    rooms = new Map();
    pickable = [];
  }

  function setRooms(list: readonly PlacedRoom[], cutHeightM: number | null): void {
    clear();
    world = new THREE.Group();
    const glassBuf: BoxBuf = { p: [], n: [], c: [], boxes: 0 };
    for (const room of list) {
      const geo = buildRoomGeometry(room, { cutHeightM, pipeCold: hexToRgb(palette.pipeCold), pipeHot: hexToRgb(palette.pipeHot), pipeDrain: hexToRgb(palette.pipeDrain) });
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(geo.floor.p, 3));
      fg.setAttribute('normal', new THREE.Float32BufferAttribute(geo.floor.n, 3));
      const floorMat = lambert(palette.floorOld, { side: THREE.DoubleSide });
      const boardMat = lambert(palette.wallBoard);
      owned.push(floorMat, boardMat);
      const floor = new THREE.Mesh(fg, floorMat);
      floor.position.y = 0.004;
      floor.receiveShadow = true;
      floor.userData.roomId = room.id;
      world.add(floor);
      pickable.push(floor);
      const rm: RoomMeshes = {
        geo, box: roomBounds(room), floor, floorMat, boardMat,
        shell: layerMesh(geo.shell, M.shell, null, true),
        skin: layerMesh(geo.skin, M.old, null, true),
        board: layerMesh(geo.skin, boardMat, M.gBoard, true),
        studs: layerMesh(geo.studs, M.stud, M.gStud, false),
        pipes: layerMesh(geo.pipes, M.pipes, M.gPipes, false),
        wires: layerMesh(geo.wires, M.wire, M.gWire, false),
        insulation: layerMesh(geo.insulation, M.insulation, M.gInsulation, false),
        trim: layerMesh(geo.trim, M.trim, M.gTrim, false),
      };
      reveal(rm.shell, 1, 1);
      for (const m of [rm.shell, rm.skin, rm.board, rm.studs, rm.pipes, rm.wires, rm.insulation, rm.trim]) if (m) world.add(m);
      for (let i = 0; i < geo.glass.p.length; i++) { glassBuf.p.push(geo.glass.p[i]); glassBuf.n.push(geo.glass.n[i]); }
      glassBuf.boxes += geo.glass.boxes;
      rooms.set(room.id, rm);
    }
    const glass = layerMesh(glassBuf, M.glass, null, false);
    if (glass) { reveal(glass, 1, 1); world.add(glass); }

    const level = list.length ? list[0].level : 0;
    const b = modelBounds({ version: 1, projectId: '', rooms: [...list], links: {}, updatedAt: '' }, level);
    const fit = fitSpan(b);
    if (b) {
      const pad = 0.35;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX + pad * 2, 0.16, b.maxY - b.minY + pad * 2), M.plinth);
      slab.position.set(fit.cx, -0.08, fit.cz);
      slab.receiveShadow = true;
      slab.castShadow = true;
      world.add(slab);
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), M.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(fit.cx, -0.17, fit.cz);
    ground.receiveShadow = true;
    world.add(ground);
    scene.add(world);

    sun.position.set(fit.cx - fit.span * 0.35, fit.span * 1.4 + 6, fit.cz + fit.span * 0.9);
    sun.target.position.set(fit.cx, 0, fit.cz);
    const sc = sun.shadow.camera;
    const reach = fit.span * 0.9 + 3;
    sc.left = -reach; sc.right = reach; sc.top = reach; sc.bottom = -reach; sc.near = 1; sc.far = fit.span * 4 + 40;
    sc.updateProjectionMatrix();

    // Look at the middle of the walls, so cut walls and full walls both sit in the frame.
    V.wallH = list.length ? Math.max(...Array.from(rooms.values()).map((r) => r.geo.heightM)) : 1.2;
    V.midY = V.wallH / 2;
    floorBox = b;
    V.span = fit.span;
    V.homeX = fit.cx;
    V.homeZ = fit.cz;
    V.tx = fit.cx;
    V.tz = fit.cz;
    updateCamera();
  }

  function apply(looks: ReadonlyMap<string, RoomLook>): void {
    rooms.forEach((rm, roomId) => {
      const look = looks.get(roomId);
      const s: RoomLayers = look?.solid ?? { skin: 1, studs: 0, roughIn: 0, insulation: 0, board: 0, finish: 0 };
      const g: RoomLayers = look?.ghost ?? s;
      reveal(rm.skin, s.skin, s.skin);
      reveal(rm.studs, s.studs, g.studs);
      reveal(rm.pipes, s.roughIn, g.roughIn);
      reveal(rm.wires, s.roughIn, g.roughIn);
      reveal(rm.insulation, s.insulation, g.insulation);
      reveal(rm.board, s.board, g.board);
      reveal(rm.trim, s.finish, g.finish);
      rm.boardMat.color.copy(C.board).lerp(C.finished, ease(s.finish));
      const bare = look?.opens ? 1 - s.skin : 0;
      const fs = ease(s.finish);
      const fgh = ease(g.finish);
      rm.floorMat.color.copy(C.floorOld).lerp(C.floorSub, bare).lerp(C.floorFinished, fs + (fgh > fs ? (fgh - fs) * 0.45 : 0));
      // The stage colour over the floor, so the room itself says its stage.
      const stage = look?.stage;
      if (stage && stage !== 'no_tasks' && stage !== 'not_started') rm.floorMat.color.lerp(tint.set(palette.stage[stage]), palette.floorTint);
    });
  }

  function updateCamera(): void {
    const zoom = baseZoom() * V.zoom;
    const ce = Math.cos(V.el);
    const se = Math.sin(V.el);
    camera.left = -V.w / 2 / zoom;
    camera.right = V.w / 2 / zoom;
    camera.top = V.h / 2 / zoom;
    camera.bottom = -V.h / 2 / zoom;
    const far = 200;
    camera.position.set(V.tx + ce * Math.sin(V.az) * far, V.midY + se * far, V.tz + ce * Math.cos(V.az) * far);
    camera.lookAt(V.tx, V.midY, V.tz);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  return {
    setRooms,
    apply,
    resize(width, height, pixelRatio) {
      V.w = Math.max(1, width);
      V.h = Math.max(1, height);
      renderer.setPixelRatio(Math.min(2, Math.max(1, pixelRatio)));
      renderer.setSize(V.w, V.h, false);
      updateCamera();
    },
    render() { renderer.render(scene, camera); },
    orbit(dx, dy) {
      V.az -= dx * 0.006;
      V.el = Math.max(0.38, Math.min(1.5, V.el + dy * 0.005));
      updateCamera();
    },
    pan(dx, dy) {
      const zoom = baseZoom() * V.zoom;
      const ca = Math.cos(V.az);
      const sa = Math.sin(V.az);
      const k = 1 / Math.max(0.3, Math.sin(V.el));
      const lim = V.span;
      V.tx = Math.max(V.homeX - lim, Math.min(V.homeX + lim, V.tx - (ca * dx + sa * dy * k) / zoom));
      V.tz = Math.max(V.homeZ - lim, Math.min(V.homeZ + lim, V.tz - (-sa * dx + ca * dy * k) / zoom));
      updateCamera();
    },
    zoomBy(factor) {
      V.zoom = Math.max(0.5, Math.min(6, V.zoom * factor));
      updateCamera();
    },
    turnBy(radians) {
      if (!Number.isFinite(radians)) return;
      V.az += radians;
      updateCamera();
    },
    resetView() {
      V.az = DEFAULT_VIEW.azimuth;
      V.el = DEFAULT_VIEW.elevation;
      V.zoom = 1;
      V.tx = V.homeX;
      V.tz = V.homeZ;
      updateCamera();
    },
    pick(xPx, yPx) {
      ndc.set((xPx / V.w) * 2 - 1, -(yPx / V.h) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(pickable, false)[0];
      return hit ? ((hit.object.userData.roomId as string | undefined) ?? null) : null;
    },
    project(roomId) {
      const rm = rooms.get(roomId);
      if (!rm) return null;
      tmp.set(rm.geo.centre.x, 0.1, rm.geo.centre.z).project(camera);
      return { x: ((tmp.x + 1) / 2) * V.w, y: ((1 - tmp.y) / 2) * V.h };
    },
    roomWidthPx(roomId) {
      const rm = rooms.get(roomId);
      if (!rm || !rm.box) return null;
      let lo = Infinity;
      let hi = -Infinity;
      for (const [x, z] of [[rm.box.minX, rm.box.minY], [rm.box.maxX, rm.box.minY], [rm.box.maxX, rm.box.maxY], [rm.box.minX, rm.box.maxY]] as const) {
        tmp.set(x, 0.1, z).project(camera);
        const px = ((tmp.x + 1) / 2) * V.w;
        lo = Math.min(lo, px);
        hi = Math.max(hi, px);
      }
      return hi - lo;
    },
    roomCount() { return rooms.size; },
    dispose() {
      clear();
      for (const m of Object.values(M)) m.dispose();
      renderer.dispose();
      // Give the WebGL context back now. A browser keeps only a handful, and a page that opens and closes this view should not use them up.
      try { renderer.forceContextLoss(); } catch { /* the context is already gone */ }
    },
  };
}
