// cloudStorage.ts — unified file-picker abstraction for cloud
// storage providers (Google Drive, Dropbox, OneDrive, Box).
//
// Each provider exposes the same interface so the calling screen
// doesn't care which one the user picks. Returned file refs are
// stored against a project (or other entity) with `cloud_source`
// tagged so we can re-fetch via the right provider later.
//
// Design choices:
//   - Web: use each provider's official Picker SDK (script tag).
//     They each open a hosted modal where the user signs in + picks
//     a file; we get back metadata + a download URL.
//   - Native: open the Picker hosted URL inside WebBrowser
//     (expo-web-browser) and use a deep-link return. Simpler than
//     native OAuth; reuses the same provider UI.
//
// Cost: $0 across all four providers for our use case (file
// metadata only; we don't store the files on our side).
//
// Setup required PER provider (documented inline in each section):
//   Google Drive: Google Cloud Console → OAuth 2.0 client ID
//   Dropbox: dropbox.com/developers → app key
//   OneDrive: portal.azure.com → Azure AD app registration
//   Box: developer.box.com → custom app + client ID
//
// Without setup, each picker is a no-op that returns null + shows
// a "this provider hasn't been configured" alert. Ship code first,
// register apps when ready.

import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export type CloudSource = 'gdrive' | 'dropbox' | 'onedrive' | 'box';

export interface CloudFileRef {
  /** Provider-specific file ID. */
  id: string;
  source: CloudSource;
  name: string;
  /** MIME type if available. */
  mimeType?: string;
  /** Size in bytes if available. */
  size?: number;
  /** Direct download URL when the provider exposes one. May expire. */
  downloadUrl?: string;
  /** Provider's web URL (always works, opens in browser). */
  webUrl?: string;
  /** Thumbnail URL if available. */
  thumbnailUrl?: string;
  /** Picker session metadata for re-fetch. */
  pickedAt: string;
}

// ─── Provider client IDs ────────────────────────────────────────
// Read from env so prod and dev can have separate OAuth apps. Each
// is OPTIONAL — if unset, the picker reports "not configured" and
// the UI hides that source.
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID ?? '';
const GOOGLE_API_KEY   = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_API_KEY ?? '';
const DROPBOX_APP_KEY  = process.env.EXPO_PUBLIC_DROPBOX_APP_KEY ?? '';
const ONEDRIVE_CLIENT_ID = process.env.EXPO_PUBLIC_ONEDRIVE_CLIENT_ID ?? '';
const BOX_CLIENT_ID    = process.env.EXPO_PUBLIC_BOX_CLIENT_ID ?? '';

/** Which providers are configured (have a client ID set). */
export function configuredProviders(): CloudSource[] {
  const out: CloudSource[] = [];
  if (GOOGLE_CLIENT_ID && GOOGLE_API_KEY) out.push('gdrive');
  if (DROPBOX_APP_KEY) out.push('dropbox');
  if (ONEDRIVE_CLIENT_ID) out.push('onedrive');
  if (BOX_CLIENT_ID) out.push('box');
  return out;
}

// ─── Google Drive Picker ─────────────────────────────────────────
// Uses the Google Drive Picker API. Web: loads gapi + picker script,
// shows the hosted modal. Native: opens the Drive picker URL in
// WebBrowser with a deep-link return.
//
// Setup:
//   1. console.cloud.google.com → APIs & Services → Credentials
//   2. Create OAuth 2.0 Client ID (Web app) — add app.mageid.app to
//      authorized JS origins
//   3. Create API key — restrict to "Picker API" only
//   4. Enable Google Picker API on the project
//   5. Add to .env:
//        EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID=xxxx.apps.googleusercontent.com
//        EXPO_PUBLIC_GOOGLE_DRIVE_API_KEY=AIzaSy...
//   6. Rebuild + redeploy

export async function pickFromGoogleDrive(): Promise<CloudFileRef | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_API_KEY) {
    if (__DEV__) console.info('[cloudStorage] Google Drive not configured — set EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID + _API_KEY');
    return null;
  }

  if (Platform.OS === 'web') {
    return pickGoogleDriveWeb();
  }
  // Native: open a hosted picker page (we host it on mageid.app/cloud/
  // gdrive-picker) which runs the Picker JS and posts the result back
  // via deep link. For v1, fall back to "not yet supported on native"
  // and direct the user to the web app.
  if (__DEV__) console.info('[cloudStorage] Google Drive native picker not yet implemented; use web');
  return null;
}

async function pickGoogleDriveWeb(): Promise<CloudFileRef | null> {
  if (typeof document === 'undefined') return null;

  // Ensure gapi + Picker script are loaded
  await loadScript('https://apis.google.com/js/api.js');
  await loadScript('https://accounts.google.com/gsi/client');

  // @ts-expect-error gapi is loaded globally
  const gapi = window.gapi;
  if (!gapi) return null;

  // Step 1: load auth + picker modules
  await new Promise<void>(resolve => gapi.load('client:picker', resolve));

  // Step 2: get access token via Google Identity Services. The
  // `google.accounts.oauth2` namespace isn't in the @types/google.* d.ts
  // we have, so cast through `any` for these calls only — the GSI
  // surface is well-documented and stable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const google = (window as any).google;
  if (!google?.accounts?.oauth2) return null;

  const accessToken = await new Promise<string | null>((resolve) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: (resp: { access_token?: string; error?: string }) => {
        resolve(resp.access_token ?? null);
      },
    });
    tokenClient.requestAccessToken({ prompt: '' });
  });

  if (!accessToken) return null;

  // Step 3: open Picker
  return new Promise<CloudFileRef | null>((resolve) => {
    // @ts-expect-error google.picker is loaded by gapi.load
    const picker = window.google.picker;
    const view = new picker.View(picker.ViewId.DOCS);
    const built = new picker.PickerBuilder()
      .setOAuthToken(accessToken)
      .setDeveloperKey(GOOGLE_API_KEY)
      .addView(view)
      .setCallback((data: { action: string; docs?: { id: string; name: string; mimeType: string; sizeBytes?: string; url?: string }[] }) => {
        if (data.action === picker.Action.PICKED && data.docs && data.docs[0]) {
          const d = data.docs[0];
          resolve({
            id: d.id,
            source: 'gdrive',
            name: d.name,
            mimeType: d.mimeType,
            size: d.sizeBytes ? parseInt(d.sizeBytes, 10) : undefined,
            webUrl: d.url,
            pickedAt: new Date().toISOString(),
          });
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    built.setVisible(true);
  });
}

// ─── Dropbox Chooser ─────────────────────────────────────────────
// Setup: dropbox.com/developers → Apps → Create app → "App folder"
// or "Full Dropbox" → Set app key. Add to .env:
//   EXPO_PUBLIC_DROPBOX_APP_KEY=xxxxxxxxxxxx

export async function pickFromDropbox(): Promise<CloudFileRef | null> {
  if (!DROPBOX_APP_KEY) {
    if (__DEV__) console.info('[cloudStorage] Dropbox not configured — set EXPO_PUBLIC_DROPBOX_APP_KEY');
    return null;
  }
  if (Platform.OS === 'web') {
    return pickDropboxWeb();
  }
  if (__DEV__) console.info('[cloudStorage] Dropbox native picker not yet implemented');
  return null;
}

async function pickDropboxWeb(): Promise<CloudFileRef | null> {
  if (typeof document === 'undefined') return null;

  // Dropbox Chooser SDK
  // @ts-expect-error Dropbox global
  if (!window.Dropbox) {
    await loadScript(`https://www.dropbox.com/static/api/2/dropins.js`, {
      'id': 'dropboxjs',
      'data-app-key': DROPBOX_APP_KEY,
    });
  }

  // @ts-expect-error Dropbox global
  const Dropbox = window.Dropbox;
  if (!Dropbox) return null;

  return new Promise<CloudFileRef | null>((resolve) => {
    Dropbox.choose({
      linkType: 'preview',
      multiselect: false,
      success: (files: { id: string; name: string; link: string; bytes: number; thumbnailLink?: string }[]) => {
        const f = files[0];
        if (!f) return resolve(null);
        resolve({
          id: f.id,
          source: 'dropbox',
          name: f.name,
          size: f.bytes,
          webUrl: f.link,
          thumbnailUrl: f.thumbnailLink,
          pickedAt: new Date().toISOString(),
        });
      },
      cancel: () => resolve(null),
    });
  });
}

// ─── OneDrive Picker ─────────────────────────────────────────────
// Setup: portal.azure.com → Azure Active Directory → App registrations
// → New registration. Add redirect URI for app.mageid.app. Add to .env:
//   EXPO_PUBLIC_ONEDRIVE_CLIENT_ID=xxxx-xxxx-xxxx-xxxx-xxxx

export async function pickFromOneDrive(): Promise<CloudFileRef | null> {
  if (!ONEDRIVE_CLIENT_ID) {
    if (__DEV__) console.info('[cloudStorage] OneDrive not configured — set EXPO_PUBLIC_ONEDRIVE_CLIENT_ID');
    return null;
  }
  if (Platform.OS !== 'web') {
    if (__DEV__) console.info('[cloudStorage] OneDrive native picker not yet implemented');
    return null;
  }
  if (typeof document === 'undefined') return null;

  await loadScript('https://js.live.net/v7.2/OneDrive.js');
  // @ts-expect-error OneDrive global
  const OneDrive = window.OneDrive;
  if (!OneDrive) return null;

  return new Promise<CloudFileRef | null>((resolve) => {
    OneDrive.open({
      clientId: ONEDRIVE_CLIENT_ID,
      action: 'share',
      multiSelect: false,
      advanced: { redirectUri: window.location.origin },
      success: (files: { value: { id: string; name: string; size: number; '@microsoft.graph.downloadUrl'?: string; webUrl?: string }[] }) => {
        const f = files.value?.[0];
        if (!f) return resolve(null);
        resolve({
          id: f.id,
          source: 'onedrive',
          name: f.name,
          size: f.size,
          downloadUrl: f['@microsoft.graph.downloadUrl'],
          webUrl: f.webUrl,
          pickedAt: new Date().toISOString(),
        });
      },
      cancel: () => resolve(null),
      error: () => resolve(null),
    });
  });
}

// ─── Box Picker ──────────────────────────────────────────────────
// Setup: developer.box.com → Apps → Create new app → Custom App
// (OAuth 2.0 with JWT or with User Authentication). Add to .env:
//   EXPO_PUBLIC_BOX_CLIENT_ID=xxxxxxxxxxxxxxxxxx

export async function pickFromBox(): Promise<CloudFileRef | null> {
  if (!BOX_CLIENT_ID) {
    if (__DEV__) console.info('[cloudStorage] Box not configured — set EXPO_PUBLIC_BOX_CLIENT_ID');
    return null;
  }
  // Box's picker requires OAuth + Content Picker init. We open the
  // OAuth flow in WebBrowser and use a deep link return for native;
  // on web, the page hosts the picker iframe directly.
  if (Platform.OS === 'web') {
    // Light-touch v1: redirect through Box OAuth to a hosted page that
    // runs the Content Picker. We don't yet host that page on
    // mageid.app, so this is a scaffold-only.
    if (__DEV__) console.info('[cloudStorage] Box web picker requires a hosted picker page; not yet shipped');
    return null;
  }
  if (__DEV__) console.info('[cloudStorage] Box native picker not yet implemented');
  return null;
}

// ─── Unified picker ──────────────────────────────────────────────

export async function pickFromCloud(source: CloudSource): Promise<CloudFileRef | null> {
  switch (source) {
    case 'gdrive':   return pickFromGoogleDrive();
    case 'dropbox':  return pickFromDropbox();
    case 'onedrive': return pickFromOneDrive();
    case 'box':      return pickFromBox();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function loadScript(src: string, attrs?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('no document'));
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// Re-export so callers don't need to also import expo-web-browser
export { WebBrowser };
