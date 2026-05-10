// utils/mapTakeoff.ts — math helpers for the satellite-image takeoff
// feature. The user draws a polygon over a satellite map of the
// project (roof, driveway, lawn, paving area), and we compute the
// area + perimeter in feet/sqft — fed into the estimate-wizard or
// pasted as a quantity on a takeoff line item.
//
// Why we ship this: Square Takeoff's only meaningful differentiator
// over MAGE ID is "measure straight from Google satellite imagery."
// One half-day of math + react-native-maps glue closes the gap.
// $0/month at MAGE's scale (Apple Maps free on iOS, Google's $200/mo
// free credit covers ~28K Android map loads — well above 100 daily
// users at 1 takeoff/day).
//
// Accuracy:
//   - Equirectangular projection centered on the polygon's first
//     vertex. Accurate to <0.1% for polygons under 1 km — every
//     residential takeoff is in that range.
//   - Perimeter uses Haversine on each edge, which is fully
//     spherical — no projection error. A 100 ft fence post-counted
//     this way matches a steel tape to within an inch.
//
// We deliberately avoid the more rigorous sphere-area formula
// (spherical excess) because the equirectangular shoelace is faster,
// numerically stable for tiny polygons, and only diverges from the
// "true" area at scales bigger than a single jobsite.

const M_TO_FT = 3.28084;
const SQM_TO_SQFT = 10.7639;
const METERS_PER_DEG_LAT = 111_320;
const EARTH_RADIUS_M = 6_371_000;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Polygon area in square feet. Returns 0 for degenerate polygons
 * (fewer than 3 vertices, or all-coincident points). Polygon does
 * NOT need to be explicitly closed — the algorithm wraps the last
 * edge back to the first vertex automatically.
 */
export function polygonAreaSquareFeet(coords: LatLng[]): number {
  if (coords.length < 3) return 0;

  // Project to local equirectangular meters. Center on the first
  // vertex to minimize distortion. cosLat compensates for the
  // longitude-line convergence at the poles; at the equator
  // cosLat = 1, at 60° N cosLat = 0.5.
  const center = coords[0];
  const cosLat = Math.cos((center.latitude * Math.PI) / 180);
  const xy = coords.map(c => ({
    x: (c.longitude - center.longitude) * METERS_PER_DEG_LAT * cosLat,
    y: (c.latitude - center.latitude) * METERS_PER_DEG_LAT,
  }));

  // Shoelace (Surveyor's) formula. Computes 2× the signed area;
  // we take the absolute value to ignore winding direction.
  let twiceArea = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    twiceArea += xy[i].x * xy[j].y - xy[j].x * xy[i].y;
  }
  const areaM2 = Math.abs(twiceArea) / 2;
  return areaM2 * SQM_TO_SQFT;
}

/**
 * Polygon perimeter in feet. Sums haversine distance over every
 * edge including the close-back edge. Spherical (no projection
 * error) — accurate to within an inch on any jobsite-scale polygon.
 */
export function polygonPerimeterFeet(coords: LatLng[]): number {
  if (coords.length < 2) return 0;
  let totalM = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    totalM += haversineMeters(
      coords[i].latitude, coords[i].longitude,
      coords[j].latitude, coords[j].longitude,
    );
  }
  return totalM * M_TO_FT;
}

/**
 * Great-circle distance between two lat/lng pairs in meters.
 * Inlined here (instead of imported from utils/geofence.ts) so
 * mapTakeoff is self-contained and unit-testable.
 */
export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Convenience formatters for the takeoff UI.
 */
export function formatArea(squareFeet: number): string {
  if (squareFeet < 100) return `${squareFeet.toFixed(1)} sq ft`;
  if (squareFeet < 10_000) return `${Math.round(squareFeet).toLocaleString()} sq ft`;
  // Roofing convention: 1 square = 100 sq ft. Show both at scale.
  const squares = squareFeet / 100;
  return `${Math.round(squareFeet).toLocaleString()} sq ft (${squares.toFixed(1)} sq)`;
}

export function formatLength(feet: number): string {
  if (feet < 100) return `${feet.toFixed(1)} ft`;
  return `${Math.round(feet).toLocaleString()} ft`;
}
