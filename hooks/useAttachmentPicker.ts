// hooks/useAttachmentPicker.ts — photos (camera or library) and PDFs for a
// client message (track MSG, lane MSGAPP).
//
// Every picked file is held to utils/messageAttachments checkAttachment, in
// the picker's order, so the eleventh file, a GIF, an empty file or a 25 MB
// scan is refused here with a reason the copy hook words — never thrown at the
// screen. A denied permission is a refusal too. The bytes are checked again at
// upload (sniffMatches) and by the server trigger.
//
// Photos go out at quality 0.7 (about 1-3 MB, the same as other app photos);
// on iOS `Compatible` hands back a JPEG for a HEIC original. A PDF goes as is.

import { useCallback } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import type { MessageAttachmentMime } from '@/types';
import {
  MESSAGE_ATTACHMENT_MAX_COUNT,
  checkAttachment,
  extForMime,
  normalizeMime,
  type AttachmentRefusal,
} from '@/utils/messageAttachments';
import { generateUUID } from '@/utils/generateId';

export interface PickedAttachment {
  id: string;
  name: string;
  mime: MessageAttachmentMime;
  size: number;
  width?: number;
  height?: number;
  localUri: string;
}

export type PickKind = 'camera' | 'photos' | 'pdf' | 'any';
export type PickRefusal = AttachmentRefusal | 'cameraDenied' | 'photosDenied';
export interface PickResult {
  picked: PickedAttachment[];
  refused: { name: string; reason: PickRefusal; size?: number }[];
}

/** A candidate file, before the checks. */
export interface AttachmentCandidate {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  width?: number;
  height?: number;
}

const lastSegment = (uri: string) => {
  const clean = String(uri ?? '').split(/[?#]/)[0];
  const seg = clean.split('/').pop() ?? '';
  try { return decodeURIComponent(seg); } catch { return seg; }
};

/** A picked JPEG named IMG_0001.HEIC keeps its name but gets the real extension. */
function nameWithExt(name: string, mime: MessageAttachmentMime): string {
  const ext = extForMime(mime);
  const dot = name.lastIndexOf('.');
  const have = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (have === ext || (ext === 'jpg' && have === 'jpeg')) return name;
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return stem ? `${stem}.${ext}` : '';
}

/**
 * Hold each candidate to checkAttachment in order, counting the ones kept
 * toward the cap. Pure: the size must already be known (or null).
 */
export function vetCandidates(cands: AttachmentCandidate[], alreadyAttached: number): PickResult {
  const picked: PickedAttachment[] = [];
  const refused: PickResult['refused'] = [];
  for (const c of cands) {
    const rawName = (c.name && String(c.name).trim()) || lastSegment(c.uri);
    const v = checkAttachment({ mime: c.mimeType ?? null, size: c.size ?? null, name: rawName }, alreadyAttached + picked.length);
    if (!v.ok) {
      refused.push(typeof c.size === 'number' ? { name: rawName, reason: v.reason, size: c.size } : { name: rawName, reason: v.reason });
      continue;
    }
    const named = nameWithExt(v.name, v.mime);
    const p: PickedAttachment = {
      id: generateUUID().toLowerCase(),
      name: named ? checkAttachmentName(named, v.mime) : v.name,
      mime: v.mime,
      // An unknown size passed the check; Storage and the trigger measure it.
      size: typeof c.size === 'number' && c.size > 0 ? Math.round(c.size) : 0,
      localUri: c.uri,
    };
    if (typeof c.width === 'number' && c.width > 0) p.width = Math.round(c.width);
    if (typeof c.height === 'number' && c.height > 0) p.height = Math.round(c.height);
    picked.push(p);
  }
  return { picked, refused };
}

function checkAttachmentName(name: string, mime: MessageAttachmentMime): string {
  const v = checkAttachment({ mime, size: null, name }, 0);
  return v.ok ? v.name : name;
}

async function sizeOf(uri: string, known?: number | null): Promise<number | null> {
  if (typeof known === 'number' && known > 0) return known;
  if (Platform.OS === 'web') return typeof known === 'number' ? known : null;
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true } as never);
    return info.exists && typeof (info as { size?: number }).size === 'number' ? (info as { size: number }).size : null;
  } catch {
    return null;
  }
}

/**
 * Fill in a size the picker did not report. One that still cannot be measured
 * passes the check as unknown: the outbox records the real byte count before
 * the upload (the trigger compares the row's size with the stored object's).
 */
async function withSizes(cands: AttachmentCandidate[]): Promise<AttachmentCandidate[]> {
  const out: AttachmentCandidate[] = [];
  for (const c of cands) out.push({ ...c, size: await sizeOf(c.uri, c.size) });
  return out;
}

const countRefusal = (): PickResult => ({ picked: [], refused: [{ name: '', reason: 'count' }] });

/** Files dropped on the desktop thread (web only): same checks as the picker. */
export function vetDroppedFiles(files: File[], alreadyAttached: number): PickResult {
  if (Platform.OS !== 'web' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { picked: [], refused: [] };
  }
  const byKey = new Map<string, File>();
  const cands: AttachmentCandidate[] = files.map((f, i) => {
    const key = `drop:${i}`;
    byKey.set(key, f);
    return { uri: key, name: f.name, mimeType: f.type || null, size: f.size };
  });
  const res = vetCandidates(cands, alreadyAttached);
  // Only a kept file gets an object URL (a refused one would leak it).
  for (const p of res.picked) {
    const f = byKey.get(p.localUri);
    if (f) p.localUri = URL.createObjectURL(f);
  }
  return res;
}

export async function pickAttachments(kind: PickKind, alreadyAttached: number): Promise<PickResult> {
  const room = MESSAGE_ATTACHMENT_MAX_COUNT - alreadyAttached;
  if (room <= 0) return countRefusal();
  try {
    if (kind === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { picked: [], refused: [{ name: '', reason: 'cameraDenied' }] };
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, exif: false });
      if (r.canceled || !r.assets) return { picked: [], refused: [] };
      return vetCandidates(await withSizes(r.assets.map(imageCandidate)), alreadyAttached);
    }
    if (kind === 'photos') {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return { picked: [], refused: [{ name: '', reason: 'photosDenied' }] };
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        exif: false,
        allowsMultipleSelection: true,
        selectionLimit: room,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Compatible,
      });
      if (r.canceled || !r.assets) return { picked: [], refused: [] };
      return vetCandidates(await withSizes(r.assets.map(imageCandidate)), alreadyAttached);
    }
    const r = await DocumentPicker.getDocumentAsync({
      type: kind === 'pdf' ? 'application/pdf' : ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (r.canceled || !r.assets) return { picked: [], refused: [] };
    const cands: AttachmentCandidate[] = r.assets.map((a) => ({
      uri: a.uri,
      name: a.name,
      mimeType: a.mimeType ?? null,
      size: typeof a.size === 'number' ? a.size : (a.file?.size ?? null),
    }));
    return vetCandidates(await withSizes(cands), alreadyAttached);
  } catch (err) {
    console.warn('[useAttachmentPicker] pick failed', err);
    return { picked: [], refused: [] };
  }
}

function imageCandidate(a: ImagePicker.ImagePickerAsset): AttachmentCandidate {
  const name = a.fileName || lastSegment(a.uri);
  return {
    uri: a.uri,
    name,
    // A camera shot may carry no type; the extension decides, and the bytes
    // are sniffed before upload.
    mimeType: a.mimeType ?? (normalizeMime('', name) ?? normalizeMime('', lastSegment(a.uri))),
    size: a.fileSize ?? a.file?.size ?? null,
    width: a.width,
    height: a.height,
  };
}

export function useAttachmentPicker() {
  const pick = useCallback((kind: PickKind, alreadyAttached: number) => pickAttachments(kind, alreadyAttached), []);
  return { pick, vetDroppedFiles };
}
