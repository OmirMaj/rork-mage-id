// ganttArrowPath — orthogonal (right-angled) dependency arrow routing for the
// gantt. Returns an SVG path `d` string from a predecessor bar's right edge to
// a successor bar's left edge using only horizontal + vertical segments.
//
// Standard case: right of predecessor → step right → drop vertically →
// land on successor's left edge.
//
// Overlap case (successor.leftX <= predecessor.rightX, i.e. start-to-start or
// finish-to-start-with-negative-lag): route AROUND, not through. We exit the
// predecessor's right edge, step right a clearance gap, drop to a mid-gutter
// between the two rows, run left to just before the successor's left edge,
// then drop into the successor row and land on its left edge.

export interface ArrowPoint {
  x: number;
  y: number;
}

/** Horizontal clearance (px) the arrow steps out before turning. */
const CLEARANCE = 3;

/**
 * @param from  predecessor bar's right-edge midpoint {x, y}
 * @param to    successor bar's left-edge midpoint {x, y}
 * @returns SVG path `d` attribute
 */
export function orthogonalArrowPath(from: ArrowPoint, to: ArrowPoint): string {
  const standard = to.x >= from.x + CLEARANCE;
  if (standard) {
    const turnX = from.x + CLEARANCE;
    return `M ${from.x} ${from.y} L ${turnX} ${from.y} L ${turnX} ${to.y} L ${to.x} ${to.y}`;
  }
  const midY = (from.y + to.y) / 2;
  const outX = from.x + CLEARANCE;
  const backX = to.x - CLEARANCE;
  return [
    `M ${from.x} ${from.y}`,
    `L ${outX} ${from.y}`,
    `L ${outX} ${midY}`,
    `L ${backX} ${midY}`,
    `L ${backX} ${to.y}`,
    `L ${to.x} ${to.y}`,
  ].join(' ');
}
