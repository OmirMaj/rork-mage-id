// utils/livingModel/three-shim.d.ts — the few shapes of the 3D library the
// Living Model uses, declared by hand.
//
// `three` (MIT, pinned in package.json) ships no type files, and Phase 1 adds
// no other dependency, so the part of it the web-only view touches is declared
// here. Nothing in this file is code: it is erased when the app is built, and
// it does not make the phone bundle load the library.
declare module 'three' {
  export class Color {
    constructor(c?: string | number);
    r: number; g: number; b: number;
    set(c: string | number): this;
    copy(c: Color): this;
    lerp(c: Color, alpha: number): this;
    getHexString(): string;
  }
  export class Vector2 {
    constructor(x?: number, y?: number);
    x: number; y: number;
    set(x: number, y: number): this;
  }
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number; y: number; z: number;
    set(x: number, y: number, z: number): this;
    project(camera: Camera): this;
  }
  export class Object3D {
    position: Vector3;
    rotation: { x: number; y: number; z: number };
    visible: boolean;
    castShadow: boolean;
    receiveShadow: boolean;
    userData: Record<string, unknown>;
    add(...o: Object3D[]): this;
    remove(...o: Object3D[]): this;
    traverse(fn: (o: Object3D) => void): void;
    lookAt(x: number, y: number, z: number): void;
    updateMatrixWorld(force?: boolean): void;
  }
  export class Group extends Object3D {}
  export class Scene extends Object3D {
    /** The picture that lights every rough-and-smooth surface (the Realistic look's sky dome). */
    environment: Texture | null;
    environmentIntensity: number;
  }
  export class Camera extends Object3D {}
  export class OrthographicCamera extends Camera {
    constructor(left: number, right: number, top: number, bottom: number, near: number, far: number);
    left: number; right: number; top: number; bottom: number; near: number; far: number;
    updateProjectionMatrix(): void;
  }
  export class PerspectiveCamera extends Camera {
    constructor(fov: number, aspect: number, near: number, far: number);
    fov: number; aspect: number; near: number; far: number;
    updateProjectionMatrix(): void;
  }
  export class HemisphereLight extends Object3D {
    constructor(sky: string | number, ground: string | number, intensity?: number);
  }
  export class DirectionalLight extends Object3D {
    constructor(color: string | number, intensity?: number);
    target: Object3D;
    shadow: { mapSize: Vector2; bias: number; normalBias: number; radius: number; camera: OrthographicCamera };
  }
  export class BufferAttribute {
    count: number;
    getY(i: number): number;
  }
  export class Float32BufferAttribute extends BufferAttribute {
    constructor(array: number[] | Float32Array, itemSize: number);
  }
  export class BufferGeometry {
    groups: { start: number; count: number; materialIndex?: number }[];
    setAttribute(name: string, attr: BufferAttribute): this;
    getAttribute(name: string): BufferAttribute;
    addGroup(start: number, count: number, materialIndex?: number): void;
    dispose(): void;
  }
  export class BoxGeometry extends BufferGeometry {
    constructor(width: number, height: number, depth: number);
  }
  export class PlaneGeometry extends BufferGeometry {
    constructor(width: number, height: number);
  }
  export class SphereGeometry extends BufferGeometry {
    constructor(radius: number, widthSegments?: number, heightSegments?: number);
  }
  export class Texture {
    needsUpdate: boolean;
    magFilter: number;
    minFilter: number;
    dispose(): void;
  }
  export class DataTexture extends Texture {
    constructor(data: Uint8Array, width: number, height: number);
  }
  export class PMREMGenerator {
    constructor(renderer: WebGLRenderer);
    fromScene(scene: Scene, sigma?: number): { texture: Texture; dispose(): void };
    dispose(): void;
  }
  export class Material {
    transparent: boolean;
    opacity: number;
    dispose(): void;
  }
  export interface MeshLambertMaterialParameters {
    color?: string | number;
    transparent?: boolean;
    opacity?: number;
    depthWrite?: boolean;
    vertexColors?: boolean;
    side?: number;
    emissive?: string | number;
    emissiveIntensity?: number;
  }
  export class MeshLambertMaterial extends Material {
    constructor(p?: MeshLambertMaterialParameters);
    color: Color;
    emissive: Color;
    emissiveIntensity: number;
  }
  export interface MeshStandardMaterialParameters extends MeshLambertMaterialParameters {
    roughness?: number;
    metalness?: number;
    emissive?: string | number;
    emissiveIntensity?: number;
  }
  /** The rough-and-smooth shading of the Realistic look. */
  export class MeshStandardMaterial extends Material {
    constructor(p?: MeshStandardMaterialParameters);
    color: Color;
    emissive: Color;
    emissiveIntensity: number;
    roughness: number;
    metalness: number;
  }
  /** Draws nothing but the shadow that falls on it. */
  export class ShadowMaterial extends Material {
    constructor(p?: { color?: string | number; opacity?: number });
  }
  export class MeshBasicMaterial extends Material {
    constructor(p?: { color?: string | number; map?: Texture; transparent?: boolean; opacity?: number; depthWrite?: boolean; vertexColors?: boolean; side?: number; toneMapped?: boolean });
    color: Color;
  }
  export class Mesh extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material | Material[]);
    geometry: BufferGeometry;
    material: Material | Material[];
  }
  export class Raycaster {
    setFromCamera(v: Vector2, camera: Camera): void;
    intersectObjects(objects: Object3D[], recursive?: boolean): { object: Object3D }[];
  }
  export class WebGLRenderer {
    constructor(p?: { canvas?: HTMLCanvasElement; antialias?: boolean; alpha?: boolean; preserveDrawingBuffer?: boolean });
    shadowMap: { enabled: boolean; type: number };
    toneMapping: number;
    toneMappingExposure: number;
    domElement: HTMLCanvasElement;
    extensions?: { has?: (name: string) => boolean };
    setClearColor(c: string | number, alpha?: number): void;
    setPixelRatio(n: number): void;
    setSize(w: number, h: number, updateStyle?: boolean): void;
    render(scene: Scene, camera: Camera): void;
    dispose(): void;
    forceContextLoss(): void;
  }
  export const PCFSoftShadowMap: number;
  export const DoubleSide: number;
  export const BackSide: number;
  export const ACESFilmicToneMapping: number;
  export const LinearFilter: number;
}
