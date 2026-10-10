// utils/deliveryLink/mapMath.ts — the arithmetic behind the delivery map (lane
// DELIVERIES-2, part 3): which map tiles cover a yard and a job, and where a
// point lands on the picture.
//
// The map is the standard web map (Web Mercator, 256 px tiles, the same grid
// OpenStreetMap serves). Nothing here knows where a truck is. `truckPoint`
// places the truck at the yard, at the MIDDLE of the straight line, or at the
// job, from which of the three steps was tapped on the supplier link: a
// drawing of what someone said, not a position.
//
// Pure: no React, no network, no storage.

export interface LatLng { latitude: number; longitude: number }
export interface Size { width: number; height: number }
export interface Point { x: number; y: number }

export const TILE = 256;
/** OpenStreetMap's standard tiles stop at 19; a yard next door to the job does not need more than 15. */
export const MAX_ZOOM = 15;
export const MIN_ZOOM = 2;
/** Past this many straight-line miles the yard was most likely looked up to the wrong town: no map is drawn. */
export const MAX_MAP_MILES = 3000;
/** Web Mercator has no picture past these latitudes. */
const MAX_LAT = 85.05112878;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** True for a usable pair of coordinates. (0, 0) is "no answer" from a geocoder, not a place a load comes from. */
export function isPlace(p: LatLng | null | undefined): p is LatLng {
  return !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
    && Math.abs(p.latitude) <= MAX_LAT && Math.abs(p.longitude) <= 180
    && !(p.latitude === 0 && p.longitude === 0);
}

/** A place in world pixels at a zoom (x grows east, y grows SOUTH). */
export function worldPixel(p: LatLng, zoom: number): Point {
  const scale = TILE * 2 ** zoom;
  const lat = clamp(p.latitude, -MAX_LAT, MAX_LAT) * Math.PI / 180;
  return {
    x: (p.longitude + 180) / 360 * scale,
    y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * scale,
  };
}

/** Miles between two places along the ground in a straight line (great circle). */
export function straightLineMiles(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The closest zoom at which both places fit in the picture with `pad` px to spare on every side, or null when even the widest one does not fit them. */
export function fitZoom(a: LatLng, b: LatLng, size: Size, pad: number): number | null {
  const w = Math.max(1, size.width - pad * 2);
  const h = Math.max(1, size.height - pad * 2);
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const pa = worldPixel(a, z);
    const pb = worldPixel(b, z);
    if (Math.abs(pa.x - pb.x) <= w && Math.abs(pa.y - pb.y) <= h) return z;
  }
  return null;
}

/** One map picture: which tile, where its top-left corner goes, and how big it is drawn. */
export interface MapTile { key: string; z: number; x: number; y: number; left: number; top: number; size: number }

export interface MapView {
  zoom: number;
  /** World pixel of the picture's top-left corner. */
  origin: Point;
  /** Where the yard and the job land in the picture. */
  from: Point;
  to: Point;
  /** The tiles that cover the picture, each with where its top-left corner goes. */
  tiles: MapTile[];
}

/** True when a yard and a job are close enough to be one trip on one map. */
export function isMappablePair(from: LatLng | null | undefined, to: LatLng | null | undefined): boolean {
  return isPlace(from) && isPlace(to) && straightLineMiles(from, to) <= MAX_MAP_MILES;
}

/**
 * The picture: a zoom, the two ends in picture pixels, and the tiles to draw.
 * Null when either end is not a place, the picture has no size, the two are
 * more than MAX_MAP_MILES apart, or they do not both fit at the widest zoom:
 * a map that cannot show both ends is not drawn at all.
 */
export function buildMapView(from: LatLng | null | undefined, to: LatLng | null | undefined, size: Size, pad = 44): MapView | null {
  if (!isPlace(from) || !isPlace(to) || !(size.width >= 80) || !(size.height >= 80)) return null;
  if (!isMappablePair(from, to)) return null;
  const zoom = fitZoom(from, to, size, pad);
  if (zoom === null) return null;
  const a = worldPixel(from, zoom);
  const b = worldPixel(to, zoom);
  const origin = { x: Math.round((a.x + b.x) / 2 - size.width / 2), y: Math.round((a.y + b.y) / 2 - size.height / 2) };
  // The pictures come from one zoom closer and are drawn at half size, so they are sharp on a phone's screen
  // (a 256 px tile drawn at 256 points is blurry at 2x and 3x) and the street names are not oversized.
  const tz = zoom + 1;
  const draw = TILE / 2;
  const n = 2 ** tz;
  const tiles: MapTile[] = [];
  const x0 = Math.floor(origin.x / draw);
  const x1 = Math.floor((origin.x + size.width - 1) / draw);
  const y0 = Math.floor(origin.y / draw);
  const y1 = Math.floor((origin.y + size.height - 1) / draw);
  for (let ty = y0; ty <= y1; ty++) {
    if (ty < 0 || ty >= n) continue; // no map above the top or below the bottom of the world
    for (let tx = x0; tx <= x1; tx++) {
      const wrapped = ((tx % n) + n) % n; // the map repeats east and west
      tiles.push({ key: `${tz}/${wrapped}/${ty}@${tx}`, z: tz, x: wrapped, y: ty, left: tx * draw - origin.x, top: ty * draw - origin.y, size: draw });
    }
  }
  return { zoom, origin, from: { x: a.x - origin.x, y: a.y - origin.y }, to: { x: b.x - origin.x, y: b.y - origin.y }, tiles };
}

/** The address of one standard OpenStreetMap tile. */
export function tileUrl(t: Pick<MapTile, 'z' | 'x' | 'y'>): string {
  return `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;
}

/**
 * Where the truck is DRAWN for a step: 0 nowhere (null), 1 at the yard, 2 at
 * the middle of the straight line, 3 at the job. The middle is a drawing
 * convention for "on the way", not a position.
 */
export function truckPoint(view: Pick<MapView, 'from' | 'to'>, stop: 0 | 1 | 2 | 3): Point | null {
  if (stop === 0) return null;
  if (stop === 1) return view.from;
  if (stop === 3) return view.to;
  return { x: (view.from.x + view.to.x) / 2, y: (view.from.y + view.to.y) / 2 };
}
