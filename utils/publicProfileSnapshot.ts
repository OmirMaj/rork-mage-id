// Snapshot for the public project portfolio page at
// mageid.app/builders/<companySlug>/<projectSlug>. Same base64-in-URL-hash
// pattern as the client and sub portals — no backend round-trip, the
// snapshot lives entirely in the share URL.

import type {
  Project, AppSettings, ProjectPhoto, PublicProfileSettings,
} from '@/types';

export const PUBLIC_PROFILE_SNAPSHOT_VERSION = 1;

export interface PublicProfileSnapshot {
  v: number;
  publishedAt: string;
  company: {
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    licenseNumber?: string;
    tagline?: string;
    logoUri?: string;
    about?: string;
    yearFounded?: number;
    servingArea?: string;
  };
  project: {
    id: string;
    name: string;
    slug: string;
    type?: string;
    address?: string;
    squareFootage?: number;
    durationDays?: number;
    contractValue?: number;
    headline?: string;
    body?: string;
    completedAt?: string;
    hideStats?: ('value' | 'duration' | 'sqft')[];
  };
  testimonial?: {
    quote: string;
    author?: string;
  };
  photos: Array<{
    url: string;
    caption?: string;
    timestamp?: string;
  }>;
}

interface BuildOpts {
  project: Project;
  settings?: AppSettings;
  photos?: ProjectPhoto[];
  maxPhotos?: number;
}

export function slugify(input: string | undefined | null): string {
  if (!input) return 'project';
  return input
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

export function buildPublicProfileSnapshot(opts: BuildOpts): PublicProfileSnapshot {
  const { project, settings, photos = [], maxPhotos = 18 } = opts;
  const profile: PublicProfileSettings = project.publicProfile ?? { enabled: false };

  const companyBranding = settings?.branding;
  const companySlug = slugify(companyBranding?.companyName);
  const projectSlug = profile.slug || slugify(project.name);

  // Photo selection — explicit selection wins, otherwise newest first.
  let chosen = photos;
  if (profile.selectedPhotoIds && profile.selectedPhotoIds.length) {
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

  const contractValue = project.estimate?.grandTotal
    ?? project.targetBudget?.amount
    ?? undefined;

  const durationDays = project.schedule?.totalDurationDays;

  return {
    v: PUBLIC_PROFILE_SNAPSHOT_VERSION,
    publishedAt: new Date().toISOString(),
    company: {
      name: companyBranding?.companyName ?? 'MAGE ID',
      contactName: companyBranding?.contactName,
      email: companyBranding?.email,
      phone: companyBranding?.phone,
      licenseNumber: companyBranding?.licenseNumber,
      tagline: companyBranding?.tagline,
      logoUri: companyBranding?.logoUri,
    },
    project: {
      id: project.id,
      name: project.name,
      slug: projectSlug,
      type: project.type,
      address: project.location,
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
    photos: chosen.slice(0, maxPhotos).map(p => ({
      url: p.uri ?? '',
      caption: p.tag ?? p.location,
      timestamp: p.timestamp,
    })).filter(p => p.url),
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
