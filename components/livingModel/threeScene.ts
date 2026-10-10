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
// THE CALLER MAY SET THREE COSTS (JobSceneOptions): the pixel-ratio cap, the
// renderer's own edge smoothing and the shadow map's size. Left out, each is
// what the web has always used (2, on, 2048), so the web view is unchanged.
// The phone (components/livingModel/phone3d) sets all three.
//
// TWO LOOKS (utils/livingModel/looks.ts). A palette with no `finish` is Game
// Style, the look this file has always drawn, and every line it ran before
// still runs as it did. A palette WITH a `finish` is Realistic: a film curve
// on the picture, a camera with a mild vanishing point, rough and smooth
// surfaces where the device may afford them (finish.cost.surfaces), the sky
// dome's light on the web, a soft patch where the slab meets the ground, and
// each room's stage as a light floor tint plus a band of the stage colour
// round the floor. A look is fixed when the scene is made: the views make a
// new scene for a new look, as they do for a new theme, so the old look's
// shapes, materials and textures all go in `dispose`.
//
// ONE SCENE, ONE CANVAS. `dispose` gives the WebGL context back to the browser
// (forceContextLoss), so a canvas that held a scene cannot hold another: the
// web view mounts a fresh canvas for each scene it makes.
import { modelBounds, roomBounds } from '@/utils/livingModel/modelCore';
import { hexToRgb, type LivingModelPalette } from '@/utils/livingModel/palette';
import type { RoomLayers } from '@/utils/livingModel/replayCore';
import type { SurfacedElement } from '@/utils/livingModel/looks';
import { buildFloorBand, buildRoomGeometry, fitSpan, fitZoom, labelRoomPx, revealRange, viewExtent, type BoxBuf, type RoomGeometry } from '@/utils/livingModel/sceneCore';
import type { RoomStage } from '@/utils/livingModel/stageCore';
import type { Bounds } from '@/utils/livingModel/types';
import type { PlacedRoom } from '@/utils/livingModel/types';

type Three = typeof import('three');
type Mesh = InstanceType<Three['Mesh']>;
type Material = InstanceType<Three['Material']>;
type LambertMaterial = InstanceType<Three['MeshLambertMaterial']>;
type StandardMaterial = InstanceType<Three['MeshStandardMaterial']>;
/** What a shape is shaded with: flat (every look, every device) or rough-and-smooth (Realistic, where it is afforded). */
type SurfaceMaterial = LambertMaterial | StandardMaterial;
type Texture = InstanceType<Three['Texture']>;

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
  /** How much room a label has across a room as it is drawn right now, in pixels (sceneCore.labelRoomPx). null for a room that is not in the scene. */
  roomWidthPx: (roomId: string) => number | null;
  /** The colour a room's floor is drawn in right now, as '#rrggbb'. null for a room that is not in the scene. */
  floorHex: (roomId: string) => string | null;
  /** How many rooms the scene holds. A scene that was just made holds none until `setRooms`. */
  roomCount: () => number;
  /** The colour of the band round a room's floor right now, as '#rrggbb'. null when the look draws no band, or the room's stage shows none. */
  bandHex?: (roomId: string) => string | null;
  /** How the scene was made, for the checks: which shading, which camera, and what is still held. */
  stats?: () => { look: 'game' | 'realistic'; shading: 'flat' | 'surface'; camera: 'level' | 'perspective'; shadows: boolean; skyDome: boolean; groundPatch: boolean; textures: number; ownedMaterials: number };
  /** Let go of everything, the WebGL context included. The canvas cannot be used for another scene afterwards. */
  dispose: () => void;
}

/** The default angle: looking down and across, like a board game. */
export const DEFAULT_VIEW = { azimuth: 0.72, elevation: 0.9 } as const;

interface RoomMeshes {
  geo: RoomGeometry;
  box: Bounds | null;
  floor: Mesh;
  floorMat: SurfaceMaterial;
  boardMat: SurfaceMaterial;
  /** Realistic only: the band of stage colour round the floor. */
  band: Mesh | null;
  bandMat: SurfaceMaterial | null;
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

/**
 * Can this renderer's context be given back? Every browser's can. Asked with `has`, which answers without a warning
 * (forceContextLoss itself asks with `get`, which prints one where the answer is no). A renderer that cannot be asked is taken as yes.
 */
function canLoseContext(renderer: { extensions?: { has?: (name: string) => boolean } }): boolean {
  const has = renderer.extensions?.has;
  if (typeof has !== 'function') return true;
  return has.call(renderer.extensions, 'WEBGL_lose_context') === true;
}

export interface JobSceneOptions {
  preserveDrawingBuffer?: boolean;
  /** The renderer's own edge smoothing. On when left out (the web). The phone smooths in its drawing surface instead. */
  antialias?: boolean;
  /** The most pixels a unit `resize` will accept. 2 when left out (the web). */
  maxPixelRatio?: number;
  /** The shadow map's width and height in pixels. 2048 when left out (the web). */
  shadowMapSize?: number;
}

/** What the web has always used. A caller that passes no option gets exactly these. */
export const WEB_SCENE_DEFAULTS = { antialias: true, maxPixelRatio: 2, shadowMapSize: 2048 } as const;

export function createJobScene(THREE: Three, canvas: HTMLCanvasElement, palette: LivingModelPalette, opts: JobSceneOptions = {}): JobSceneHandle {
  const maxPixelRatio = typeof opts.maxPixelRatio === 'number' && opts.maxPixelRatio >= 1 ? opts.maxPixelRatio : WEB_SCENE_DEFAULTS.maxPixelRatio;
  const shadowMapSize = typeof opts.shadowMapSize === 'number' && opts.shadowMapSize >= 256 ? Math.round(opts.shadowMapSize) : WEB_SCENE_DEFAULTS.shadowMapSize;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.antialias ?? WEB_SCENE_DEFAULTS.antialias, alpha: false, preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
  renderer.setClearColor(palette.ground, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  /** Realistic's settings. null is Game Style: nothing below that reads it changes what was always drawn. */
  const finish = palette.finish ?? null;
  const surfaces = finish && finish.cost.surfaces ? finish.surfaces : null;
  if (finish) {
    renderer.shadowMap.enabled = finish.cost.shadows;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = finish.exposure;
  }
  const scene = new THREE.Scene();
  const level = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
  const lens = finish ? new THREE.PerspectiveCamera(finish.fovDeg, 1, 0.5, 2000) : null;
  const camera = lens ?? level;
  scene.add(new THREE.HemisphereLight(palette.sky, palette.plinth, palette.skyStrength));
  const sun = new THREE.DirectionalLight(palette.sun, palette.sunStrength);
  sun.castShadow = finish ? finish.cost.shadows : true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.bias = -0.0006;
  // A smaller shadow map has larger texels, so a surface is pushed further off its own shadow by the same measure. 0.02 at the web's 2048.
  sun.shadow.normalBias = 0.02 * (WEB_SCENE_DEFAULTS.shadowMapSize / shadowMapSize);
  scene.add(sun);
  scene.add(sun.target);

  // One maker for every surface. With no element named, or where rough-and-smooth shading is not afforded, it is the flat shading the view has always used.
  const lambert = (color: string, extra: Record<string, unknown> = {}, el?: SurfacedElement): SurfaceMaterial => {
    const s = el && surfaces ? surfaces[el] : null;
    return s ? new THREE.MeshStandardMaterial({ color, roughness: s.roughness, metalness: s.metalness, ...extra }) : new THREE.MeshLambertMaterial({ color, ...extra });
  };
  const faint = (color: string, opacity = 0.3, extra: Record<string, unknown> = {}, el?: SurfacedElement): SurfaceMaterial => lambert(color, { transparent: true, opacity, depthWrite: false, ...extra }, el);
  const M = {
    shell: lambert(palette.shell, {}, 'shell'),
    old: lambert(palette.wallOld, {}, 'wallOld'),
    stud: lambert(palette.stud, {}, 'stud'),
    gStud: faint(palette.stud, 0.3, {}, 'stud'),
    pipes: lambert(palette.vertexBase, { vertexColors: true }, 'pipes'),
    gPipes: faint(palette.vertexBase, 0.3, { vertexColors: true }, 'pipes'),
    wire: lambert(palette.wire, {}, 'wire'),
    gWire: faint(palette.wire, 0.3, {}, 'wire'),
    insulation: lambert(palette.insulation, {}, 'insulation'),
    gInsulation: faint(palette.insulation, 0.3, {}, 'insulation'),
    gBoard: faint(palette.wallBoard, 0.5, {}, 'wallBoard'),
    trim: lambert(palette.trim, {}, 'trim'),
    gTrim: faint(palette.trim, 0.3, {}, 'trim'),
    glass: finish ? faint(palette.glass, finish.glassOpacity, {}, 'glass') : new THREE.MeshLambertMaterial({ color: palette.glass, transparent: true, opacity: 0.55, depthWrite: false }),
    none: faint(palette.vertexBase, 0),
    plinth: lambert(palette.plinth, {}, 'plinth'),
    // Realistic: the ground is the page itself (the clear colour), and this plane shows only the shadow that falls on it.
    ground: finish ? new THREE.ShadowMaterial({ color: finish.contact.color, opacity: finish.groundShadow }) : lambert(palette.ground),
  };

  // Realistic on the web: a sky dome lights every surface as well as the two lamps. Made once, from three colours, with no picture loaded.
  // Where the device cannot make it (or the renderer here draws nothing), the scene is lit by the two lamps alone.
  let skyLight: { texture: Texture; dispose(): void } | null = null;
  if (finish && finish.cost.skyDome) {
    try {
      const maker = new THREE.PMREMGenerator(renderer);
      const dome = new THREE.Scene();
      const ball = new THREE.SphereGeometry(40, 24, 12);
      const at = ball.getAttribute('position');
      const zenith = new THREE.Color(finish.env.zenith);
      const horizon = new THREE.Color(finish.env.horizon);
      const below = new THREE.Color(finish.env.ground);
      const mix = new THREE.Color();
      const cols: number[] = [];
      for (let i = 0; i < at.count; i++) {
        const up = at.getY(i) / 40;
        if (up >= 0) mix.copy(horizon).lerp(zenith, Math.pow(up, 0.6)); else mix.copy(horizon).lerp(below, Math.min(1, -up * 4));
        cols.push(mix.r, mix.g, mix.b);
      }
      ball.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const paint = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
      dome.add(new THREE.Mesh(ball, paint));
      skyLight = maker.fromScene(dome, 0.04);
      scene.environment = skyLight.texture;
      scene.environmentIntensity = finish.env.strength;
      ball.dispose();
      paint.dispose();
      maker.dispose();
    } catch {
      skyLight = null;
    }
  }
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
  let textures: Texture[] = [];
  let pickable: Mesh[] = [];
  const V = { az: DEFAULT_VIEW.azimuth as number, el: DEFAULT_VIEW.elevation as number, zoom: 1, tx: 0, tz: 0, w: 1, h: 1, span: 8, homeX: 0, homeZ: 0, midY: 0.6, wallH: 1.2 };
  let floorBox: Bounds | null = null;
  /** Pixels per metre before the person's own zoom: the home view fitted to the floor box and the walls on it. */
  const baseZoom = (): number => fitZoom(viewExtent(floorBox, V.wallH, DEFAULT_VIEW.azimuth, DEFAULT_VIEW.elevation), V.w, V.h) * (finish ? finish.fit : 1);

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
    for (const t of textures) t.dispose();
    textures = [];
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
      const floorMat = lambert(palette.floorOld, { side: THREE.DoubleSide }, 'floorOld');
      const boardMat = lambert(palette.wallBoard, {}, 'wallBoard');
      owned.push(floorMat, boardMat);
      // Realistic: the room's stage is a band round its floor. It glows a little with its own colour, so it reads in a shadow too.
      const bandMat = finish ? lambert(palette.vertexBase, { emissive: palette.vertexBase, emissiveIntensity: finish.band.glow }, 'trim') : null;
      if (bandMat) owned.push(bandMat);
      const floor = new THREE.Mesh(fg, floorMat);
      floor.position.y = 0.004;
      floor.receiveShadow = true;
      floor.userData.roomId = room.id;
      world.add(floor);
      pickable.push(floor);
      const rm: RoomMeshes = {
        geo, box: roomBounds(room), floor, floorMat, boardMat, bandMat,
        band: finish && bandMat ? layerMesh(buildFloorBand(room, finish.band.widthM), bandMat, null, false) : null,
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
      reveal(rm.band, 1, 1);
      if (rm.band) rm.band.visible = false;
      for (const m of [rm.shell, rm.skin, rm.board, rm.studs, rm.pipes, rm.wires, rm.insulation, rm.trim, rm.band]) if (m) world.add(m);
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
    // Realistic: a soft dark patch where the slab meets the ground, so the model sits ON the ground with or without a shadow map.
    if (finish && finish.cost.groundPatch && b) {
      const spread = finish.contact.spreadM;
      const bw = b.maxX - b.minX + 0.7;
      const bd = b.maxY - b.minY + 0.7;
      const N = 64;
      const px = new Uint8Array(N * N * 4);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const x = ((i + 0.5) / N - 0.5) * (bw + spread * 2);
          const z = ((j + 0.5) / N - 0.5) * (bd + spread * 2);
          const out = Math.hypot(Math.max(0, Math.abs(x) - bw / 2), Math.max(0, Math.abs(z) - bd / 2));
          const k = 1 - Math.min(1, out / spread);
          const o = (j * N + i) * 4;
          px[o] = 255; px[o + 1] = 255; px[o + 2] = 255; px[o + 3] = Math.round(255 * k * k);
        }
      }
      const soft = new THREE.DataTexture(px, N, N);
      soft.magFilter = THREE.LinearFilter;
      soft.minFilter = THREE.LinearFilter;
      soft.needsUpdate = true;
      textures.push(soft);
      const patchMat = new THREE.MeshBasicMaterial({ color: finish.contact.color, map: soft, transparent: true, opacity: finish.contact.opacity, depthWrite: false, toneMapped: false });
      owned.push(patchMat);
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(bw + spread * 2, bd + spread * 2), patchMat);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(fit.cx, -0.165, fit.cz);
      world.add(patch);
    }
    scene.add(world);

    sun.position.set(fit.cx - fit.span * 0.35, (fit.span * 1.4 + 6) * (finish ? finish.sunLift : 1), fit.cz + fit.span * 0.9);
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
      if (surfaces && 'roughness' in rm.boardMat) rm.boardMat.roughness = surfaces.wallBoard.roughness + (surfaces.wallFinished.roughness - surfaces.wallBoard.roughness) * ease(s.finish);
      const bare = look?.opens ? 1 - s.skin : 0;
      const fs = ease(s.finish);
      const fgh = ease(g.finish);
      rm.floorMat.color.copy(C.floorOld).lerp(C.floorSub, bare).lerp(C.floorFinished, fs + (fgh > fs ? (fgh - fs) * 0.45 : 0));
      // The stage colour over the floor, so the room itself says its stage.
      const stage = look?.stage;
      if (stage && stage !== 'no_tasks' && stage !== 'not_started') rm.floorMat.color.lerp(tint.set(palette.stage[stage]), palette.floorTint);
      if (surfaces && 'roughness' in rm.floorMat) rm.floorMat.roughness = surfaces.floorOld.roughness + (surfaces.floorSub.roughness - surfaces.floorOld.roughness) * bare + (surfaces.floorFinished.roughness - surfaces.floorOld.roughness) * fs;
      // Realistic: the band takes the stage colour. A room with nothing ticked, or not started, shows none.
      if (rm.band && rm.bandMat) {
        const marked = !!stage && stage !== 'no_tasks' && stage !== 'not_started';
        rm.band.visible = marked;
        if (marked && stage) { rm.bandMat.color.set(palette.stage[stage]); rm.bandMat.emissive.set(palette.stage[stage]); }
      }
    });
  }

  function updateCamera(): void {
    const zoom = baseZoom() * V.zoom;
    const ce = Math.cos(V.el);
    const se = Math.sin(V.el);
    level.left = -V.w / 2 / zoom;
    level.right = V.w / 2 / zoom;
    level.top = V.h / 2 / zoom;
    level.bottom = -V.h / 2 / zoom;
    // Realistic's camera stands where the middle of the model is drawn at the same size as the level camera draws it, so a drag, a pinch and a label mean the same in both looks.
    const far = lens ? V.h / 2 / zoom / Math.tan((lens.fov * Math.PI) / 360) : 200;
    if (lens) {
      lens.aspect = V.w / V.h;
      lens.near = Math.max(0.5, far * 0.05);
      lens.far = far * 3 + 700;
    }
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
      renderer.setPixelRatio(Math.min(maxPixelRatio, Math.max(1, pixelRatio)));
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
      const cx = (rm.box.minX + rm.box.maxX) / 2;
      const cz = (rm.box.minY + rm.box.maxY) / 2;
      const px = (x: number, z: number): { x: number; y: number } => {
        tmp.set(x, 0.1, z).project(camera);
        return { x: ((tmp.x + 1) / 2) * V.w, y: ((1 - tmp.y) / 2) * V.h };
      };
      const c = px(cx, cz);
      const a = px(rm.box.maxX, cz);
      const b = px(cx, rm.box.maxY);
      return labelRoomPx({ x: a.x - c.x, y: a.y - c.y }, { x: b.x - c.x, y: b.y - c.y });
    },
    floorHex(roomId) {
      const rm = rooms.get(roomId);
      return rm ? `#${rm.floorMat.color.getHexString()}` : null;
    },
    roomCount() { return rooms.size; },
    bandHex(roomId) {
      const rm = rooms.get(roomId);
      return rm && rm.band && rm.bandMat && rm.band.visible ? `#${rm.bandMat.color.getHexString()}` : null;
    },
    stats() {
      return {
        look: finish ? 'realistic' : 'game', shading: surfaces ? 'surface' : 'flat', camera: lens ? 'perspective' : 'level',
        shadows: renderer.shadowMap.enabled, skyDome: !!skyLight, groundPatch: !!(finish && finish.cost.groundPatch), textures: textures.length, ownedMaterials: owned.length,
      };
    },
    dispose() {
      clear();
      for (const m of Object.values(M)) m.dispose();
      if (skyLight) { skyLight.dispose(); skyLight = null; scene.environment = null; }
      renderer.dispose();
      // Give the WebGL context back now. A browser keeps only a handful, and a page that opens and closes this view should not use them up.
      // Only where the context can be given back: a phone's drawing surface has no WEBGL_lose_context and ends with its own view.
      try { if (canLoseContext(renderer)) renderer.forceContextLoss(); } catch { /* the context is already gone */ }
    },
  };
}
