// _shared/punchSealManifest.ts — the sealed final punch, the parts both sides run.
//
// NO imports of any kind, on purpose. The app (app/punch-seal.tsx,
// app/punch-list.tsx, utils/punchSealHtml.ts) imports this file through
// `@/supabase/functions/_shared/punchSealManifest`, the seal-punch edge
// function (Deno) imports it as `../_shared/punchSealManifest.ts`, and
// scripts/validate-punch-seal.ts runs it under bun. So the rule that decides
// "this punch list can be sealed", the manifest that gets hashed and the
// canonical JSON the hash is taken over are written once and run in one shape
// everywhere.
//
// What a seal certifies: these formal punch items were closed, each with an
// after photo, as of the server's date, and the client accepted that in person.
// It is not a warranty, not a lien release and not a payment record. Nothing in
// the manifest is money.

/** The acceptance text's version. Stored on the row; the server refuses any other. */
export const PUNCH_SEAL_CONSENT_VERSION = 'punch-accept-1';

/**
 * The legal acceptance text. ENGLISH ONLY, never translated (a translated legal
 * line is a second contract): the screen shows exactly these words beside the
 * consent box, and the manifest stores them, so the hash covers what was read.
 */
export const PUNCH_SEAL_ACCEPTANCE_TEXT =
  'By signing you confirm you walked this project with the contractor and the items listed were closed on the date shown, each with an after photo. This record is not a warranty and does not change your contract or its warranty terms. A copy is kept by your contractor and is available to you on request.';

export const PUNCH_SEAL_MANIFEST_VERSION = 'punch-seal-manifest-1';

/** Hard caps the server enforces (the screen checks the same numbers first). */
export const PUNCH_SEAL_MAX_ITEMS = 300;
export const PUNCH_SEAL_MAX_PATHS = 400;
export const PUNCH_SEAL_MAX_PATH_CHARS = 20_000;
export const PUNCH_SEAL_NAME_MIN = 2;
export const PUNCH_SEAL_NAME_MAX = 120;
export const PUNCH_SEAL_ROLE_MAX = 60;

/** Every `code` seal-punch answers with. The screen maps each one to a sentence. */
export const PUNCH_SEAL_ERROR_CODES = [
  'bad_request',
  'forbidden',
  'not_found',
  'sample',
  'already_sealed',
  'not_ready',
  'changed',
  'too_many',
  'photo_uploading',
  'photo_foreign',
  'hash_mismatch',
  'pdf_attached',
  'server',
] as const;
export type PunchSealErrorCode = typeof PUNCH_SEAL_ERROR_CODES[number];

// ── Readiness ──────────────────────────────────────────────────────────────

export type PunchSealBlockReason = 'not_closed' | 'no_after_photo';

/** The slice of a punch item (app PunchItem or a server row mapped to it) readiness reads. */
export interface PunchSealReadinessItem {
  id: string;
  status?: string | null;
  listType?: string | null;
  afterPhotoUri?: string | null;
  afterPhotoStoragePath?: string | null;
  xray?: { clientVisible?: boolean } | null;
}

export interface PunchSealReadiness {
  ready: boolean;
  /** Formal items the client accepts (crew and client-hidden X-ray items left out). */
  count: number;
  /** Those items' ids, sorted: the list the client signs, and the server compares. */
  itemIds: string[];
  blockers: { itemId: string; reason: PunchSealBlockReason }[];
}

function nonBlank(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Formal punch item the client walks: the app's punchListTypeOf rule restated
 *  (absent or anything but 'crew' is 'punch'), minus client-hidden X-ray items. */
export function isSealableItem(item: PunchSealReadinessItem): boolean {
  if (item.listType === 'crew') return false;
  if (item.xray && item.xray.clientVisible === false) return false;
  return true;
}

export function hasAfterPhoto(item: PunchSealReadinessItem): boolean {
  return nonBlank(item.afterPhotoStoragePath) || nonBlank(item.afterPhotoUri);
}

/**
 * Can this project's final punch be sealed? Ready only when there is at least
 * one formal item and every one is closed with an after photo. Zero formal items
 * is NOT ready: an empty list is "no punch list on file", never a clear one
 * (the same refusal utils/retainage.ts retainageReadiness makes).
 */
export function punchSealReadiness(items: readonly PunchSealReadinessItem[]): PunchSealReadiness {
  const sealable = items.filter(isSealableItem);
  const blockers: PunchSealReadiness['blockers'] = [];
  for (const it of sealable) {
    if (it.status !== 'closed') blockers.push({ itemId: it.id, reason: 'not_closed' });
    else if (!hasAfterPhoto(it)) blockers.push({ itemId: it.id, reason: 'no_after_photo' });
  }
  blockers.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  const itemIds = sealable.map((i) => i.id).sort();
  return { ready: sealable.length > 0 && blockers.length === 0, count: sealable.length, itemIds, blockers };
}

/** Same set, any order, no duplicates on either side. */
export function sameItemSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== a.length || sb.size !== b.length || sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

// ── The edit block ─────────────────────────────────────────────────────────

/**
 * A sealed item is closed for good: no status change, no edit, no move, no
 * delete, no new photo. Rework after the seal is a NEW item. Returns 'sealed'
 * for an item that carries a seal id or is named in the project's sealed record
 * (`sealedItemIds`, from the punch_seals manifest, which covers the moment
 * between the seal and the item's seal_id reaching this phone); null otherwise.
 * The database pins the same columns (punch_items_seal_pin).
 */
export function sealedPunchEditBlock(
  item: { id?: string | null; sealId?: string | null } | null | undefined,
  sealedItemIds?: ReadonlySet<string> | readonly string[] | null,
): 'sealed' | null {
  if (!item) return null;
  if (nonBlank(item.sealId)) return 'sealed';
  if (sealedItemIds && typeof item.id === 'string' && item.id) {
    const has = Array.isArray(sealedItemIds)
      ? (sealedItemIds as readonly string[]).includes(item.id)
      : (sealedItemIds as ReadonlySet<string>).has(item.id);
    if (has) return 'sealed';
  }
  return null;
}

// ── Request validation (seal action) ───────────────────────────────────────

export interface PunchSealRequest {
  projectId: string;
  itemIds: string[];
  signerName: string;
  signerRole: string;
  signaturePaths: string[];
  consentVersion: string;
}

export type PunchSealRequestCheck =
  | { ok: true; value: PunchSealRequest }
  | { ok: false; code: 'bad_request' | 'too_many'; message: string };

const bad = (message: string): PunchSealRequestCheck => ({ ok: false, code: 'bad_request', message });

/** The seal body, checked. Messages are whole sentences the screen may show. */
export function checkPunchSealRequest(body: unknown): PunchSealRequestCheck {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const projectId = typeof b.project_id === 'string' ? b.project_id.trim() : '';
  if (!projectId) return bad('The project is missing from the request.');
  if (!Array.isArray(b.item_ids) || b.item_ids.length === 0 || !b.item_ids.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 200)) {
    return bad('The list of punch items is missing from the request.');
  }
  if (b.item_ids.length > PUNCH_SEAL_MAX_ITEMS) {
    return { ok: false, code: 'too_many', message: `A sealed record holds up to ${PUNCH_SEAL_MAX_ITEMS} punch items. This list has ${b.item_ids.length}.` };
  }
  const signerName = typeof b.signer_name === 'string' ? b.signer_name.trim() : '';
  if (signerName.length < PUNCH_SEAL_NAME_MIN || signerName.length > PUNCH_SEAL_NAME_MAX) {
    return bad('Type the client’s full name.');
  }
  const signerRole = typeof b.signer_role === 'string' ? b.signer_role.trim() : '';
  if (!signerRole || signerRole.length > PUNCH_SEAL_ROLE_MAX) return bad('The signer’s role is missing.');
  const paths = b.signature_paths;
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > PUNCH_SEAL_MAX_PATHS
    || !paths.every((p) => typeof p === 'string' && p.length > 0 && p.length <= PUNCH_SEAL_MAX_PATH_CHARS)) {
    return bad('The signature did not come through. Sign again.');
  }
  if (b.consent_version !== PUNCH_SEAL_CONSENT_VERSION) {
    return bad('This app is out of date. Update it, then sign again.');
  }
  return {
    ok: true,
    value: {
      projectId,
      itemIds: (b.item_ids as string[]).slice(),
      signerName,
      signerRole,
      signaturePaths: (paths as string[]).slice(),
      consentVersion: PUNCH_SEAL_CONSENT_VERSION,
    },
  };
}

// ── The manifest ───────────────────────────────────────────────────────────

export interface PunchSealManifestItemInput {
  id: string;
  description?: string | null;
  location?: string | null;
  closedAt?: string | null;
  /** project-photos path of the before photo, null when it never uploaded. */
  beforePhotoPath?: string | null;
  /** punch-seals path of the sealed after-photo copy. */
  afterPhotoPath: string;
  afterPhotoSha256: string;
  planSheetId?: string | null;
  pinX?: number | null;
  pinY?: number | null;
}

export interface PunchSealManifestInput {
  sealId: string;
  projectId: string;
  projectName?: string | null;
  /** Server time, ISO. */
  sealedAt: string;
  items: readonly PunchSealManifestItemInput[];
  signer: {
    name: string;
    role: string;
    method: 'in_person';
    consentVersion: string;
    /** SHA-256 (hex) of canonicalJson(signature_paths): binds the strokes stored on the row. */
    signatureSha256: string;
    strokeCount: number;
  };
}

export interface PunchSealManifestItem {
  id: string;
  description: string;
  location: string;
  closedAt: string | null;
  beforePhoto: string | null;
  afterPhoto: { path: string; sha256: string };
  planPin: { sheetId: string; x: number | null; y: number | null } | null;
}

export interface PunchSealManifest {
  version: string;
  sealId: string;
  project: { id: string; name: string };
  sealedAt: string;
  itemCount: number;
  items: PunchSealManifestItem[];
  signer: { name: string; role: string; method: 'in_person'; signatureSha256: string; strokeCount: number };
  statement: { version: string; text: string };
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strOrNull = (v: unknown): string | null => (nonBlank(v) ? (v as string).trim() : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The record that gets hashed. Pure: a fresh object, items sorted by id, every
 * field named explicitly (nothing spread from the input, so an extra key on a
 * row never lands in the record), no clock, and the input is never mutated.
 */
export function buildPunchSealManifest(input: PunchSealManifestInput): PunchSealManifest {
  const items = input.items
    .map((it): PunchSealManifestItem => ({
      id: it.id,
      description: str(it.description),
      location: str(it.location),
      closedAt: strOrNull(it.closedAt),
      beforePhoto: strOrNull(it.beforePhotoPath),
      afterPhoto: { path: it.afterPhotoPath, sha256: it.afterPhotoSha256 },
      planPin: nonBlank(it.planSheetId)
        ? { sheetId: (it.planSheetId as string).trim(), x: numOrNull(it.pinX), y: numOrNull(it.pinY) }
        : null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    version: PUNCH_SEAL_MANIFEST_VERSION,
    sealId: input.sealId,
    project: { id: input.projectId, name: str(input.projectName) },
    sealedAt: input.sealedAt,
    itemCount: items.length,
    items,
    signer: {
      name: str(input.signer.name),
      role: str(input.signer.role),
      method: 'in_person',
      signatureSha256: input.signer.signatureSha256,
      strokeCount: input.signer.strokeCount,
    },
    statement: { version: input.signer.consentVersion, text: PUNCH_SEAL_ACCEPTANCE_TEXT },
  };
}

/**
 * Canonical JSON: object keys sorted (UTF-16 order) at every depth, no
 * whitespace, strings escaped by JSON.stringify, undefined object keys dropped,
 * undefined array slots written as null. A non-finite number, a function, a
 * symbol or a bigint throws: a value JSON cannot carry must never be hashed as
 * something else.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return '[' + value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',') + ']';
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
    }
    default:
      throw new Error(`canonicalJson: cannot encode ${typeof value}`);
  }
}

/** The stored punch_seals row, as the app reads it (select only). */
export interface PunchSealRow {
  id: string;
  user_id: string;
  project_id: string;
  sealed_at: string;
  item_count: number;
  manifest: PunchSealManifest;
  manifest_hash: string;
  signer_name: string;
  signer_role: string;
  method: 'in_person';
  signature_paths: string[];
  consent_version: string;
  pdf_path: string | null;
  pdf_hash: string | null;
}

/** Ids the sealed record covers (for sealedPunchEditBlock). */
export function sealedItemIdsOf(row: Pick<PunchSealRow, 'manifest'> | null | undefined): string[] {
  const items = row?.manifest?.items;
  return Array.isArray(items) ? items.map((i) => i.id).filter((id): id is string => typeof id === 'string') : [];
}
