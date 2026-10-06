// utils/roomScan/types.ts — the app's own shape for one scanned room.
//
// Scan The Room, Phase 1 (dark behind SCAN_ROOM_ENABLED). Pure data: no React,
// no React Native, no storage. Apple's RoomPlan hands back a CapturedRoom; the
// native module returns that JSON untouched and everything below is worked out
// in TypeScript (utils/roomScan/capturedRoomParser.ts and geometryCore.ts), so
// the maths runs on a Mac with no phone and can be fixed over the air.
//
// Lengths are METRES everywhere in the model. Feet and inches exist only at
// the edge (utils/roomScan/units.ts), in one place.
//
// A scan is a fast first measure, not a survey. Nothing in this model is a
// percentage of how right a number is: `facts` are plain statements ("4 of 4
// walls found") and every hand correction is kept with its before and after.

export type Confidence = 'low' | 'medium' | 'high';

export interface Pt { x: number; y: number }

/** Where a length on the model came from. */
export type LengthSource =
  /** Read from the scan. */
  | 'scan'
  /** Typed by hand from a tape. */
  | 'typed'
  /** Moved by the app so the outline still closes after a typed wall. */
  | 'adjusted';

export interface ScanWall {
  id: string;
  /** "Wall 1", "Wall 2" in outline order. Stable for one scan. */
  label: string;
  /** Plan metres. Plan y is Apple's minus z, so the plan is not mirrored. */
  a: Pt;
  b: Pt;
  /** The length the quantities use (corner to corner on the outline). */
  lengthM: number;
  /** Apple's own width for the wall, kept for the record. */
  scanLengthM: number;
  lengthSource: LengthSource;
  /** 0 when the scan gave no usable height. */
  heightM: number;
  confidence: Confidence;
  /** Phase 1 draws the straight chord and says so. */
  curved: boolean;
  /** iOS 17 polygonCorners in the wall's own plane (slanted or stepped walls). */
  polygon?: { u: number; v: number }[];
  /** False when the wall is not part of the room outline. */
  onOutline: boolean;
}

export interface ScanOpening {
  id: string;
  kind: 'door' | 'window' | 'opening';
  /** parentIdentifier on iOS 17, else the nearest wall. */
  wallId: string | null;
  /** From wall end `a` to the opening's near edge. */
  offsetM: number;
  widthM: number;
  heightM: number;
  /** Bottom of the opening above the floor. */
  sillM: number;
  confidence: Confidence;
  widthSource: LengthSource;
  heightSource: LengthSource;
}

export interface ScanObject {
  id: string;
  /** Apple's category: toilet, sink, bathtub, storage, stove ... */
  category: string;
  center: Pt;
  widthM: number;
  depthM: number;
  heightM: number;
  rotationRad: number;
  confidence: Confidence;
}

export interface ScanClosure {
  closed: boolean;
  /** The largest distance two wall ends had to be pulled together, or the open gap. */
  gapM: number;
  /** How many breaks the outline has. 0 when closed. */
  gaps: number;
  /** The walls either side of the widest break, for "check this wall". */
  gapWallIds: string[];
  /** 'scan' = the walls never met. 'typed' = typed lengths opened a closed outline. */
  cause: 'scan' | 'typed';
  /** True when the walls DID join into a ring but the ring crosses itself. It is treated as open: no floor area. `gapWallIds` are the walls that cross. */
  crossing?: boolean;
}

export interface CeilingHeight {
  /** False when no wall carried a height and nobody typed one. */
  known: boolean;
  min: number;
  max: number;
  typical: number;
  source: LengthSource;
}

export interface TapeCheck { wallId: string; scanM: number; tapeM: number; at: string }

/** One hand correction. `by` is always 'typed': the app never edits a scan by itself. */
export interface ScanEdit {
  at: string;
  /** 'wall:<id>', 'opening:<id>' or 'ceiling'. */
  target: string;
  field: 'lengthM' | 'widthM' | 'heightM';
  from: number;
  to: number;
  by: 'typed';
}

export type RoomType = 'bathroom' | 'kitchen' | 'bedroom' | 'room';

export interface RoomScan {
  id: string;
  projectId: string;
  /** "Hall Bathroom", typed by the person. '' until he types one: a scan is never named for him. */
  name: string;
  version: 1;
  /** Native clock, ISO. */
  capturedAt: string;
  device: { model: string; os: string };
  roomType: RoomType;
  /** What iOS 17 `sections` suggested, when it said anything. */
  suggestedRoomType: RoomType | null;
  walls: ScanWall[];
  openings: ScanOpening[];
  objects: ScanObject[];
  /** Closed polygon in plan metres, counter-clockwise. Empty when the outline is open. */
  floor: Pt[];
  closure: ScanClosure;
  ceilingHeightM: CeilingHeight;
  /** Session warnings passed through from the native side plus parser notes. */
  warnings: string[];
  tapeChecks: TapeCheck[];
  /** Every hand correction, oldest first. The model above already includes them. */
  edits: ScanEdit[];
  /** Hash of Apple's JSON string (utils/roomScan/store.ts fills it in). '' in a pure test. */
  rawSha256: string;
}

export type QuantityFlag =
  | 'low_confidence_wall'
  | 'not_closed'
  | 'typed_lengths_do_not_close'
  | 'ceiling_varies'
  | 'ceiling_height_missing'
  | 'curved_wall'
  | 'over_size_limit'
  | 'walls_off_outline'
  | 'opening_without_wall';

export interface DoorSize { widthIn: number; heightIn: number; nominalWidthIn: number | null; count: number }
export interface WindowSize { widthIn: number; heightIn: number; count: number }

export interface ScanQuantities {
  /** null when the outline is open: no floor area is ever reported from an open loop. */
  floorAreaSF: number | null;
  ceilingAreaSF: number | null;
  /** null when no ceiling height is known. */
  grossWallSF: number | null;
  openingSF: number | null;
  netWallSF: number | null;
  perimeterLF: number;
  baseboardLF: number;
  crownLF: number;
  casingLF: number;
  doorCount: number;
  windowCount: number;
  openingCount: number;
  doors: DoorSize[];
  windows: WindowSize[];
  fixtures: { category: string; count: number }[];
  fixtureCount: number;
  flags: QuantityFlag[];
}

/** A plain statement about the scan. Never a percentage. */
export interface ScanFact {
  kind:
    | 'walls_found'
    | 'outline_closed'
    | 'outline_open'
    | 'outline_crosses'
    | 'opening_no_wall'
    | 'typed_open'
    | 'low_confidence'
    | 'ceiling_missing'
    | 'ceiling_varies'
    | 'curved'
    | 'over_size'
    | 'off_outline'
    | 'typed_by_hand'
    | 'adjusted';
  /** 'ok' is information, 'check' asks the person to look. */
  tone: 'ok' | 'check';
  found?: number;
  needed?: number;
  count?: number;
  wallLabels?: string[];
  gapM?: number;
}

export class RoomScanParseError extends Error {
  readonly code: 'not_json' | 'not_a_room' | 'no_walls' | 'bad_transform' | 'bad_dimensions';
  constructor(code: RoomScanParseError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'RoomScanParseError';
  }
}
