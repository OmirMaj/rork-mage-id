// Snapshot for the public project portfolio page at
// mageid.app/builders/<companySlug>/<projectSlug>. Same base64-in-URL-hash
// pattern as the client and sub portals: the page's CONTENT lives entirely in
// the share URL. What the URL cannot carry is whether the builder still wants
// the page up, so since v2 the snapshot also carries `pid`, the id of his
// public_profiles row (migration 20260923200000). The page asks the anon RPC
// public_profile_status(pid) before it renders and shows "taken down" when he
// has switched Publish off. Links made before v2 carry no pid and can't be
// recalled. The setup screen says so.
//
// THREE THINGS THIS FILE NEVER PUTS IN A LINK (audit wave 5, #47/#75/#77/#78/#81):
//   1. The client's street address, unless he turned "Show street address" on.
//      By default only city/state from the STRUCTURED address fields go out,
//      and nothing at all when those aren't set. The free-text location is
//      never parsed into a guess.
//   2. A photo URL that dies. `ProjectPhoto.uri` is a file:// path on the phone
//      that took it, or a 24-hour signed URL everywhere else. Only public
//      copies in the `portfolio` bucket (utils/portfolioPublish.ts makes them)
//      are kept. Everything else is dropped, and the screen says how many.
//   3. A data: logo. A base64 logo made every link hundreds of KB long, and
//      texts and site builders cut it off. Only a durable https logo goes out.
//      Otherwise the page shows the company initial.
//
// Pure (no react-native / supabase import) so the bun validators can run it.

import type {
  Project, AppSettings, ProjectPhoto, PublicProfileSettings,
} from '@/types';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';

export const PUBLIC_PROFILE_SNAPSHOT_VERSION = 2;

/** The bucket the page's photos and logo are copied into (public read). */
export const PORTFOLIO_BUCKET = 'portfolio';

/** The public-page hide keys (types/index.ts PublicProfileSettings.hideStats):
 *   'address' → no location line at all, not even the city;
 *   showAddress true → the full `project.location` prints (opt-in). */
type PublicProfileHideKey = NonNullable<PublicProfileSettings['hideStats']>[number];

export interface PublicProfileSnapshot {
  v: number;
  /** public_profiles.id: the page checks it before rendering. Absent on v1 links. */
  pid?: string;
  publishedAt: string;
  company: {
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    licenseNumber?: string;
    tagline?: string;
    /** Durable https only. Never data:, file:, blob: or a signed URL. */
    logoUri?: string;
    about?: string;
    yearFounded?: number;
    servingArea?: string;
    /**
     * The owning account's id — the /builders "Request a quote" form sends it
     * to public-lead-intake as `contractor_id`, which routes by it before the
     * company-name slug (audit round 2, #10: two companies with one name, an
     * accented name, or a blank name all misrouted or lost leads by slug).
     * Not a secret: it grants nothing, and widget snippets already carry it.
     */
    contractorId?: string;
  };
  project: {
    id: string;
    name: string;
    slug: string;
    type?: string;
    /** The full street address: present ONLY when showAddress is true. */
    address?: string;
    /** Set with `address`. The page prints `address` only when this is true. */
    showAddress?: boolean;
    /** "City, ST" from the structured address fields, never parsed from free text. */
    locality?: string;
    squareFootage?: number;
    durationDays?: number;
    contractValue?: number;
    headline?: string;
    body?: string;
    completedAt?: string;
    hideStats?: PublicProfileHideKey[];
  };
  testimonial?: {
    quote: string;
    author?: string;
  };
  photos: {
    url: string;
    caption?: string;
    timestamp?: string;
  }[];
}

interface BuildOpts {
  project: Project;
  /** The signed-in owner's account id (see company.contractorId). */
  ownerId?: string;
  settings?: AppSettings;
  photos?: ProjectPhoto[];
  maxPhotos?: number;
  /** public_profiles.id for this page (publicProfileIdFor). */
  pid?: string;
  /**
   * photo id → its public copy in the portfolio bucket. A chosen photo with no
   * entry here is left OUT. p.uri is never a fallback (see the header).
   */
  publicPhotoUrls?: Record<string, string>;
  /** The logo's public copy in the portfolio bucket, when one was made. */
  publicLogoUrl?: string;
}

export const PORTFOLIO_MAX_PHOTOS = 18;

export function slugify(input: string | undefined | null): string {
  if (!input) return 'project';
  return input
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

/** A public object in the portfolio bucket: the only photo URL a link may carry. */
export function isPortfolioPublicUrl(url: string | undefined | null): boolean {
  return typeof url === 'string'
    && /^https:\/\/[^/\s]+\/storage\/v1\/object\/public\/portfolio\/[^\s]+$/i.test(url.trim());
}

/**
 * An https URL that won't expire: not a signed storage URL (/object/sign/…)
 * and not a tokenised one. data:, file:, blob:, ph:, content: all fail the
 * https test.
 */
export function isDurablePublicUrl(url: string | undefined | null): boolean {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  return /^https:\/\/[^/\s]+\//i.test(u)
    && !/\/object\/sign\//i.test(u)
    && !/[?&](token|X-Amz-Signature|Signature)=/i.test(u);
}

/** The photos the page shows, in order: his explicit pick wins, else newest first. */
export function choosePortfolioPhotos(
  profile: Pick<PublicProfileSettings, 'selectedPhotoIds'> | undefined,
  photos: ProjectPhoto[],
  maxPhotos: number = PORTFOLIO_MAX_PHOTOS,
): ProjectPhoto[] {
  let chosen: ProjectPhoto[];
  if (profile?.selectedPhotoIds && profile.selectedPhotoIds.length) {
    const order = new Map(profile.selectedPhotoIds.map((id, i) => [id, i]));
    chosen = photos
      .filter(p => order.has(p.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  } else {
    chosen = [...photos].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });
  }
  return chosen.slice(0, maxPhotos);
}

/**
 * The location line the page prints, and exactly what the setup screen
 * previews. hideStats 'address' → nothing at all. showAddress → the full
 * location. Otherwise "City, ST" from the structured fields, or nothing.
 */
export function publicLocationFor(
  project: Pick<Project, 'location' | 'structuredAddress'>,
  profile: Pick<PublicProfileSettings, 'showAddress' | 'hideStats'> | undefined,
): { address?: string; locality?: string; shown: string } {
  if ((profile?.hideStats ?? []).includes('address')) return { shown: '' };
  const full = (project.location ?? '').trim();
  if (profile?.showAddress === true && full) return { address: full, shown: full };
  const city = project.structuredAddress?.city?.trim() ?? '';
  const state = project.structuredAddress?.state?.trim() ?? '';
  const locality = [city, state].filter(Boolean).join(', ');
  return locality ? { locality, shown: locality } : { shown: '' };
}

export function buildPublicProfileSnapshot(opts: BuildOpts): PublicProfileSnapshot {
  const { project, settings, photos = [], maxPhotos = PORTFOLIO_MAX_PHOTOS } = opts;
  const profile: PublicProfileSettings = project.publicProfile ?? { enabled: false };

  const companyBranding = settings?.branding;
  const projectSlug = profile.slug || slugify(project.name);

  const chosen = choosePortfolioPhotos(profile, photos, maxPhotos);

  const _ev = effectiveEstimateTotal(project);
  const contractValue = (_ev > 0 ? _ev : project.targetBudget?.amount) ?? undefined;

  const durationDays = project.schedule?.totalDurationDays;

  const where = publicLocationFor(project, profile);

  // The branding logo itself stays as it is (the PDFs inline it). The link
  // carries only a durable https copy.
  const logoUri = isDurablePublicUrl(opts.publicLogoUrl)
    ? opts.publicLogoUrl
    : isDurablePublicUrl(companyBranding?.logoUri) ? companyBranding?.logoUri : undefined;

  return {
    v: PUBLIC_PROFILE_SNAPSHOT_VERSION,
    ...(opts.pid ? { pid: opts.pid } : {}),
    publishedAt: new Date().toISOString(),
    company: {
      name: companyBranding?.companyName ?? 'MAGE ID',
      contactName: companyBranding?.contactName,
      email: companyBranding?.email,
      phone: companyBranding?.phone,
      licenseNumber: companyBranding?.licenseNumber,
      tagline: companyBranding?.tagline,
      logoUri,
      ...(opts.ownerId ? { contractorId: opts.ownerId } : {}),
    },
    project: {
      id: project.id,
      name: project.name,
      slug: projectSlug,
      type: project.type,
      ...(where.address ? { address: where.address, showAddress: true } : {}),
      ...(where.locality ? { locality: where.locality } : {}),
      squareFootage: project.squareFootage,
      durationDays,
      contractValue,
      headline: profile.publicHeadline,
      body: profile.publicBody,
      completedAt: project.closedAt,
      hideStats: profile.hideStats,
    },
    testimonial: profile.testimonialQuote
      ? { quote: profile.testimonialQuote, author: profile.testimonialAuthor }
      : undefined,
    // Caption: his tag only. The free-text / GPS location label can name the
    // client's street, so it is never a fallback.
    photos: chosen.map(p => ({
      url: opts.publicPhotoUrls?.[p.id] ?? '',
      caption: p.tag || undefined,
      timestamp: p.timestamp,
    })).filter(p => isPortfolioPublicUrl(p.url)),
  };
}

function encodeBase64Url(input: string): string {
  const b64 = typeof btoa !== 'undefined'
    ? btoa(unescape(encodeURIComponent(input)))
    : globalThis.Buffer
      ? (globalThis as any).Buffer.from(input, 'utf-8').toString('base64')
      : '';
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildPublicProfileUrl(
  baseUrl: string,
  companySlug: string,
  projectSlug: string,
  snapshot: PublicProfileSnapshot,
): string {
  const json = JSON.stringify(snapshot);
  const encoded = encodeBase64Url(json);
  return `${baseUrl}/${companySlug}/${projectSlug}#d=${encoded}`;
}

/** Above this, texts, email clients and site-builder link fields start cutting links. */
export const PORTFOLIO_URL_WARN_LENGTH = 8000;

// ── public_profiles id ──────────────────────────────────────────────────────
// Deterministic: sha256('mageid-portfolio:v1:<ownerId>:<projectId>'), first
// 16 bytes, as a uuid. The server derives the SAME id in its BEFORE INSERT
// trigger (public.public_profile_id_for), so:
//  * every device computes the same row for one job, with nothing to store or
//    sync (project.publicProfile is device-local), and a second phone can still
//    take the page down;
//  * nobody can pre-create the row for someone else's page, because the server
//    derives the id from the INSERTING user's uid.
// scripts/validate-w5-portfolio-snapshot.ts pins a vector computed by the SQL.
export function publicProfileIdFor(ownerId: string, projectId: string): string {
  const hex = sha256Hex(`mageid-portfolio:v1:${ownerId}:${projectId}`).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** SHA-256 of a string's UTF-8 bytes, lowercase hex. Sync and dependency-free. */
export function sha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // Length in bits, big-endian, in the last 8 bytes (hi word covers >512 MB inputs).
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  const n = padded.length;
  padded[n - 8] = (hi >>> 24) & 0xff; padded[n - 7] = (hi >>> 16) & 0xff;
  padded[n - 6] = (hi >>> 8) & 0xff; padded[n - 5] = hi & 0xff;
  padded[n - 4] = (lo >>> 24) & 0xff; padded[n - 3] = (lo >>> 16) & 0xff;
  padded[n - 2] = (lo >>> 8) & 0xff; padded[n - 1] = lo & 0xff;
  const w = new Array<number>(64);
  for (let off = 0; off < n; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map(x => x.toString(16).padStart(8, '0')).join('');
}

function utf8Bytes(input: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let cp = input.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < input.length) {
      const lo2 = input.charCodeAt(i + 1);
      if (lo2 >= 0xdc00 && lo2 <= 0xdfff) { cp = 0x10000 + ((cp - 0xd800) << 10) + (lo2 - 0xdc00); i++; }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

/**
 * Only the job's owner publishes its page. An invited editor or field seat can
 * read the owner's private photos, so letting him publish would copy the
 * owner's client photos into a PUBLIC folder under the collaborator's uid,
 * where the owner can't see or remove them. And the link would be dead anyway:
 * public_profile_status needs projects.user_id = the row's owner. An unset
 * ownerUserId is a job made on this phone before its first sync, so it is his.
 * The storage policy in 20260923200000 refuses the copy on the server too.
 * Lives here (pure) so validate-w5-portfolio-snapshot can run it.
 */
export function ownsForPortfolio(
  project: { ownerUserId?: string } | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!project || !userId) return false;
  return !project.ownerUserId || project.ownerUserId === userId;
}

/**
 * Runs async jobs one after another, in the order they were handed in. The
 * screen puts every server-side step of publishing on one of these: the flag
 * write, the photo copies and the take-down's removal. Without it, a take-down's
 * list-then-remove could run while a republish copies the same paths and delete
 * the fresh copies, or an in-flight "on" upsert could land after the "off" one.
 * A failed job doesn't stop the ones behind it.
 */
export function makeSerialQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(job: () => Promise<T>): Promise<T> => {
    const next = tail.then(job, job);
    tail = next.catch(() => undefined);
    return next;
  };
}
