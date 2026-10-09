// utils/roomScan/scanDebugCore.ts — what the first real scans have to tell us.
//
// WHY THIS EXISTS. utils/roomScan/capturedRoomParser.ts was written from
// Apple's documentation, and Apple does not document the JSON that JSONEncoder
// writes for a CapturedRoom. So the first real scan may parse wrongly, or not
// at all. This file is how that is SEEN instead of guessed at:
//
//   * three independent counts of the same room, side by side:
//       phone   what Swift counted on the CapturedRoom itself
//               (modules/mage-room-scan, `summary`), before any JSON,
//       file    what a plain look at the JSON's top-level lists finds,
//               with no knowledge of the parser,
//       app     what capturedRoomParser.ts understood;
//     any difference is a mismatch and is said in words;
//   * the first wall three ways (the phone's numbers, and the app's);
//   * the size of the raw text and its top-level keys, so an unreadable scan
//     still shows what arrived;
//   * the name and the body of the file the owner shares back.
//
// THE SHARED FILE holds Apple's JSON, character for character as the module
// returned it, under "capturedRoom", after one "mageScanFacts" object. The raw
// text is spliced in, never re-encoded: re-encoding would lose the very
// spelling this file is for. It holds shapes and sizes. No photo, no video.
//
// Pure: no React, no React Native, no storage, no clock.

import type { NativeScanSummary } from './native';
import type { ParsedRoom } from './capturedRoomParser';

export const SCAN_COUNT_KEYS = ['walls', 'doors', 'windows', 'openings', 'objects'] as const;
export type ScanCountKey = (typeof SCAN_COUNT_KEYS)[number];

/** How a finished scan turned out. `read` is the only one that reaches the floor plan. */
export type ScanOutcome =
  /** Parsed, and at least one wall. */
  | 'read'
  /** The phone finished, and there is no wall in what it handed over. Usually a scan that was too short. */
  | 'noWalls'
  /** JSON arrived and the app could not read it. */
  | 'unreadable'
  /** The phone finished, and the room would not encode as JSON. Only the phone's own counts exist. */
  | 'notEncoded';

export interface ScanCountRow {
  key: ScanCountKey;
  /** What Swift counted. null when this build's module sent no summary. */
  phone: number | null;
  /** Length of the top-level list of this name in the JSON. null when there is no such list. */
  file: number | null;
  /** What the parser kept. null when the parser did not finish. */
  app: number | null;
  /** True when every count that exists says the same number, and at least two exist. */
  match: boolean;
}

export interface ScanFirstWall {
  /** [x, y, z] in metres, from Swift. */
  phoneDimensions: number[] | null;
  /** 16 numbers, column by column, from Swift. */
  phoneTransform: number[] | null;
  /** Width and height the parser read for its first wall, metres. */
  appWidthM: number | null;
  appHeightM: number | null;
  appTransform: number[] | null;
  /** True when the phone's and the app's first wall agree to a millimetre. null when one side is missing. */
  match: boolean | null;
}

export interface ScanFactsReport {
  version: 1;
  scanId: string;
  projectId: string;
  /** ISO time the scan ended. */
  at: string;
  outcome: ScanOutcome;
  osVersion: string;
  deviceModel: string;
  /** Seconds, or null when the module did not say and the two times could not be read. */
  durationSeconds: number | null;
  /** Characters in the raw JSON text. 0 when none arrived. */
  rawLength: number;
  rawSha256: string;
  /** Did the raw text parse as JSON at all (nothing to do with the room parser)? */
  rawIsJson: boolean;
  /** The top-level keys of the JSON, as written. Empty when it is not a JSON object. */
  topLevelKeys: string[];
  counts: ScanCountRow[];
  /** True when any row of `counts` does not match. */
  mismatch: boolean;
  firstWall: ScanFirstWall;
  /** The real words of whatever went wrong: the parser's error, the encoder's, or ''. */
  errorText: string;
  /** What the parser dropped, in its own words. */
  parserNotes: string[];
  /** RoomPlan's instructions seen during the scan. */
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown): number | null => (isNum(v) && v >= 0 ? Math.round(v) : null);

/** A plain look at the raw text: is it JSON, what are its top-level keys, how long are its lists. Never throws. */
export function inspectRawScan(raw: string | null | undefined): {
  rawLength: number;
  rawIsJson: boolean;
  topLevelKeys: string[];
  listLengths: Record<string, number>;
} {
  const text = typeof raw === 'string' ? raw : '';
  const out = { rawLength: text.length, rawIsJson: false, topLevelKeys: [] as string[], listLengths: {} as Record<string, number> };
  if (!text) return out;
  let root: unknown;
  try { root = JSON.parse(text); } catch { return out; }
  out.rawIsJson = true;
  if (!isObj(root)) return out;
  out.topLevelKeys = Object.keys(root);
  for (const k of out.topLevelKeys) {
    const v = root[k];
    if (Array.isArray(v)) out.listLengths[k] = v.length;
  }
  return out;
}

function sameNumbers(a: number[] | null, b: number[] | null, tolerance: number): boolean | null {
  if (!a || !b) return null;
  if (a.length !== b.length) return false;
  return a.every((x, i) => Math.abs(x - b[i]) <= tolerance);
}

function durationOf(seconds: unknown, startedAt: string, endedAt: string): number | null {
  if (isNum(seconds) && seconds >= 0) return seconds;
  const a = Date.parse(startedAt);
  const b = Date.parse(endedAt);
  if (Number.isFinite(a) && Number.isFinite(b) && b >= a) return (b - a) / 1000;
  return null;
}

export interface ScanFactsInput {
  scanId: string;
  projectId: string;
  raw: string;
  rawSha256: string;
  summary: NativeScanSummary | null | undefined;
  /** The parser's result, or null when it threw. */
  parsed: ParsedRoom | null;
  outcome: ScanOutcome;
  errorText: string;
  osVersion: string;
  deviceModel: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number | null | undefined;
  warnings: string[];
}

/** Everything the owner's Scan Facts block and the shared file say about one scan. */
export function buildScanFacts(input: ScanFactsInput): ScanFactsReport {
  const look = inspectRawScan(input.raw);
  const summary = isObj(input.summary) ? (input.summary as unknown as NativeScanSummary) : null;
  const counts: ScanCountRow[] = SCAN_COUNT_KEYS.map((key) => {
    const phone = summary ? count(summary[key]) : null;
    const file = key in look.listLengths ? look.listLengths[key] : null;
    const app = input.parsed ? input.parsed[key].length : null;
    const have = [phone, file, app].filter((n): n is number => n !== null);
    return { key, phone, file, app, match: have.length >= 2 && have.every((n) => n === have[0]) };
  });
  const sw = summary?.firstWall;
  const phoneDimensions = sw && Array.isArray(sw.dimensions) && sw.dimensions.every(isNum) ? sw.dimensions : null;
  const phoneTransform = sw && Array.isArray(sw.transform) && sw.transform.length === 16 && sw.transform.every(isNum) ? sw.transform : null;
  const aw = input.parsed?.walls[0] ?? null;
  const dimsMatch = sameNumbers(phoneDimensions ? phoneDimensions.slice(0, 2) : null, aw ? [aw.widthM, aw.heightM] : null, 0.001);
  const transformMatch = sameNumbers(phoneTransform, aw ? aw.transform : null, 0.001);
  return {
    version: 1,
    scanId: input.scanId,
    projectId: input.projectId,
    at: input.endedAt,
    outcome: input.outcome,
    osVersion: input.osVersion,
    deviceModel: input.deviceModel,
    durationSeconds: durationOf(input.durationSeconds, input.startedAt, input.endedAt),
    rawLength: look.rawLength,
    rawSha256: input.rawSha256,
    rawIsJson: look.rawIsJson,
    topLevelKeys: look.topLevelKeys,
    counts,
    mismatch: counts.some((c) => !c.match),
    firstWall: {
      phoneDimensions,
      phoneTransform,
      appWidthM: aw ? aw.widthM : null,
      appHeightM: aw ? aw.heightM : null,
      appTransform: aw ? aw.transform : null,
      match: dimsMatch === null || transformMatch === null ? null : dimsMatch && transformMatch,
    },
    errorText: input.errorText,
    parserNotes: input.parsed ? input.parsed.notes : [],
    warnings: input.warnings,
  };
}

/** "mage-room-scan-2026-10-08-hall-bathroom.json". `day` is a calendar day (YYYY-MM-DD); anything else is left out. */
export function rawScanFileName(day: string | null | undefined, roomName: string | null | undefined): string {
  const d = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'undated';
  const slug = (roomName ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `mage-room-scan-${d}-${slug || 'unnamed-room'}.json`;
}

/**
 * The file the owner shares. Apple's JSON goes in CHARACTER FOR CHARACTER (it
 * is spliced in as text, not parsed and written again). When the raw text is
 * not JSON it goes in as one string, so the file itself is always JSON.
 */
export function rawScanFileBody(facts: ScanFactsReport, summary: NativeScanSummary | null | undefined, roomName: string, raw: string): string {
  const head = JSON.stringify({ ...facts, roomName, phoneSummary: summary ?? null });
  const look = inspectRawScan(raw);
  const room = look.rawIsJson ? raw : JSON.stringify(raw);
  return `{"mageScanFacts":${head},"capturedRoom":${room}}`;
}
