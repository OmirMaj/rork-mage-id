// planSheetBytes
//
// Read plan-sheet PNG bytes for the vision functions WITHOUT a fetchable URL.
//
// WHY THIS EXISTS (audit DB-F11). analyze-takeoff / analyze-drawings /
// analyze-spec-book / compare-drawings used to take `pageUrls` from the client
// and fetch them server-side (see _shared/urlGuard.ts for the SSRF fence that
// became necessary as a result). Handing a server a fetchable URL is the weaker
// design, for three separate reasons:
//
//   1. it REQUIRES the object to be readable by URL, which is precisely what
//      kept `plan-sheets` a public bucket serving permanent unsigned links;
//   2. a signed URL can expire between the request and the fetch — a 24-page
//      spec book analysis is not instant;
//   3. "fetch whatever the client names" is an SSRF shape. urlGuard pins the
//      host to our own Supabase project, which works, but the safest amount of
//      attacker-controlled URL is none.
//
// These functions already run with the SERVICE ROLE (they have to: they write
// usage counters and read tier). convert-pdf-to-images downloads its PDF with
// `storage.from(...).download(...)` and seal-document does the same. So the
// stronger design is simply: the client sends STORAGE PATHS and we read the
// bytes ourselves. No URL, no expiry, no public read anywhere.
//
// ── THE IDOR THIS FILE MUST NOT CREATE ──────────────────────────────────────
// The service role BYPASSES RLS. A path is an opaque string from the client, so
// without an explicit check a paid user could pass
// `<someone-elses-project-id>/sheet-page-1.png` and have us read a stranger's
// drawings out of the bucket and describe them back. Switching from URLs to
// paths would then have traded an SSRF surface for a worse one.
//
// So every path is checked twice before a single byte is read:
//   • SHAPE — folder[1] must be a uuid. That is the same segment the storage
//     policy evaluates (`can_access_project((storage.foldername(name))[1])`),
//     and it rejects traversal, absolute paths and shared literal prefixes such
//     as the old `tmp/`.
//   • ACCESS — that project must be one the CALLER owns or is an accepted
//     collaborator on. This mirrors public.can_access_project's SQL, which we
//     cannot call here because a service-role connection has no auth.uid().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export const PLAN_SHEET_BUCKET = 'plan-sheets';

/** Raised for a malformed path or a project the caller cannot reach. Callers
 *  answer with a GENERIC 400/403 and never echo the path back. */
export class PlanSheetAccessError extends Error {
  constructor(message = 'Invalid or inaccessible plan sheet.') {
    super(message);
    this.name = 'PlanSheetAccessError';
  }
}

export interface InlineImagePart {
  inlineData: { mimeType: string; data: string };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The project id a plan-sheet path belongs to, or '' when the path is not a
 * project-scoped plan-sheet key.
 *
 * Rejects, in order: empty, absolute (`/a/b` — a leading empty segment is not
 * the project), traversal (`..`), a single-segment key with no folder, and a
 * first segment that is not a uuid. The last one is what makes a shared prefix
 * such as `tmp/` unusable: `can_access_project('tmp')` is false in Postgres, so
 * an object there is unreadable by every client, and we refuse to pretend
 * otherwise by reading it with the service role.
 */
export function planSheetProjectId(rawPath: unknown): string {
  if (typeof rawPath !== 'string') return '';
  const path = rawPath.trim();
  if (!path || path.startsWith('/')) return '';
  const segments = path.split('/');
  if (segments.length < 2) return '';
  if (segments.some(seg => seg === '' || seg === '.' || seg === '..')) return '';
  const first = segments[0];
  return UUID_RE.test(first) ? first : '';
}

/**
 * Which input a request should be served from, and the values to use.
 *
 * PATHS WIN. The post-DB-F11 client sends BOTH — `pagePaths` because that is the
 * design, and `pageUrls` so the OTA is safe whichever order the function deploy
 * and the OTA happen in — and a request carrying both must never fetch a URL.
 * An installed build that has not taken the OTA yet sends URLs only, and has to
 * keep working for one release or takeoff breaks for every existing user.
 *
 * Lives here, shared by all four analyzers, so this decision is executed by a
 * guard rather than eyeballed four times.
 *
 * @throws Error when neither input is usable, or the page count is over the cap
 */
export function selectPageSource(
  req: { pagePaths?: unknown; pageUrls?: unknown },
  maxPages: number,
): { kind: 'paths' | 'urls'; values: string[] } {
  const paths = Array.isArray(req?.pagePaths) ? (req.pagePaths as unknown[]) : [];
  const urls = Array.isArray(req?.pageUrls) ? (req.pageUrls as unknown[]) : [];
  const chosen = paths.length > 0 ? paths : urls;
  const kind: 'paths' | 'urls' = paths.length > 0 ? 'paths' : 'urls';
  if (chosen.length === 0) throw new Error('No pages provided.');
  if (chosen.length > maxPages) {
    throw new Error(`Maximum ${maxPages} pages per request — split larger sets.`);
  }
  return { kind, values: chosen.map(v => String(v)) };
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function mimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png'; // convert-pdf-to-images only ever writes PNG
}

/**
 * Download plan-sheet objects by path with the service role and return them as
 * inline base64 image parts, IN THE ORDER GIVEN (page order matters to every
 * prompt that says "page 1", so this must never be reordered or deduped).
 *
 * @throws PlanSheetAccessError  bad shape, or a project the caller cannot reach
 * @throws Error                 a page that is missing or over maxBytes
 */
export async function loadPlanSheetImageParts(
  paths: string[],
  userId: string,
  maxBytes: number,
): Promise<InlineImagePart[]> {
  if (!Array.isArray(paths) || paths.length === 0) throw new PlanSheetAccessError();
  if (!userId) throw new PlanSheetAccessError();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Storage is not configured on the server.');
  }

  // 1. Shape check on every path first, so nothing unvalidated reaches a query.
  const projectIds = new Set<string>();
  for (const p of paths) {
    const pid = planSheetProjectId(p);
    if (!pid) throw new PlanSheetAccessError();
    projectIds.add(pid);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 2. Access check. `.in()` splices its values into a PostgREST filter string
  //    without escaping them, which is why the uuid shape check above runs
  //    FIRST and not as a nicety — every id here matched UUID_RE.
  const ids = [...projectIds];
  const reachable = new Set<string>();

  const owned = await supabase.from('projects').select('id').in('id', ids).eq('user_id', userId);
  if (owned.error) throw new Error(`Could not verify project access: ${owned.error.message}`);
  for (const row of owned.data ?? []) reachable.add(String((row as { id: string }).id));

  const missing = ids.filter(id => !reachable.has(id));
  if (missing.length > 0) {
    // Mirrors public.can_access_project's second arm: an ACCEPTED collaborator
    // can read the project's sheets (compare-drawings reads an existing sheet,
    // which may live on a shared job). 'pending' does not count.
    const shared = await supabase
      .from('project_collaborators')
      .select('project_id')
      .in('project_id', missing)
      .eq('user_id', userId)
      .eq('status', 'accepted');
    if (shared.error) throw new Error(`Could not verify project access: ${shared.error.message}`);
    for (const row of shared.data ?? []) {
      reachable.add(String((row as { project_id: string }).project_id));
    }
  }

  if (ids.some(id => !reachable.has(id))) {
    console.log('[planSheetBytes] access denied', { userId, projectCount: ids.length });
    throw new PlanSheetAccessError();
  }

  // 3. Read the bytes. Parallel, but the RESULT ORDER is the input order.
  return await Promise.all(paths.map(async (path) => {
    const { data, error } = await supabase.storage.from(PLAN_SHEET_BUCKET).download(path);
    if (error || !data) {
      throw new Error(`Could not read a plan sheet page (${error?.message ?? 'no data'}).`);
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new Error(`Page too large: ${(bytes.length / 1024 / 1024).toFixed(1)}MB (max ${(maxBytes / 1024 / 1024).toFixed(0)}MB).`);
    }
    return { inlineData: { mimeType: mimeFromPath(path), data: base64FromBytes(bytes) } };
  }));
}

/**
 * Mint the DEPRECATED `publicUrl` field convert-pdf-to-images still returns for
 * one release, and guarantee it is not a permanent public link.
 *
 * WHY THIS IS A FUNCTION AND NOT FOUR LINES INLINE. The field is still called
 * `publicUrl`, so the single most likely way this defect grows back is a future
 * dev chasing a missing thumbnail and hand-rolling
 * `${SUPABASE_URL}/storage/v1/object/public/plan-sheets/${path}` — a string
 * concatenation that type-checks, needs no import, and that a "does this file
 * call getPublicUrl()" grep cannot see. Pulling the minting out here gives the
 * guard a VALUE to assert on instead of a name to grep for.
 *
 * Returns '' rather than throwing: the bytes are already in the bucket and a
 * post-OTA client signs `storagePath` itself, so a signing failure must not
 * fail the render. And it returns '' for anything carrying `/object/public/`,
 * so even a storage SDK that handed one back cannot leak through this path.
 */
export async function mintLegacyViewUrl(
  storage: {
    createSignedUrl(
      path: string, ttlSeconds: number,
    ): Promise<{ data?: { signedUrl?: string | null } | null; error?: unknown }>;
  },
  path: string,
  ttlSeconds: number,
): Promise<string> {
  try {
    const { data } = await storage.createSignedUrl(path, ttlSeconds);
    const url = data?.signedUrl ?? '';
    if (!url) return '';
    if (url.includes('/object/public/')) return '';
    return url;
  } catch {
    return '';
  }
}

/**
 * Which input ONE SIDE of compare-drawings is served from.
 *
 * The page-list functions get a homogeneous batch and use selectPageSource; the
 * two sides of a comparison are independent, because the fresh revision has a
 * path while the sheet it supersedes may be a legacy object under the old
 * shared `tmp/` prefix.
 *
 *   'path' — folder[1] is a project id, so membership can be checked and the
 *            bytes read with the service role.
 *   'url'  — no path, or a path with no project to check against. The URL route
 *            is fenced by validateFetchableUrl and can only reach an object
 *            that is publicly readable, so this is a degradation, not a bypass:
 *            once the bucket is private it fails instead of leaking. A path
 *            that IS project-scoped never lands here, so a stranger's project
 *            id can never be laundered into a URL fetch.
 *   'none' — nothing usable at all; the caller answers 403.
 *
 * Lives here so the decision is executed by a guard rather than eyeballed.
 */
export function planSheetSideSource(
  path: unknown,
  url: unknown,
): 'path' | 'url' | 'none' {
  if (planSheetProjectId(path)) return 'path';
  if (typeof url === 'string' && url.length > 0) return 'url';
  return 'none';
}
