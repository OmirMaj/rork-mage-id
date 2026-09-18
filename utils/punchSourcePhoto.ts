// utils/punchSourcePhoto.ts — render a legacy punch photo from its source.
//
// WHY. An item raised from a gallery photo that was not on this device (the
// office marking up a field photo) used to be saved with that photo's SIGNED
// URL in punch_items.photo_uri. Signed URLs die after 24 h
// (PHOTO_URL_TTL_SECONDS), and the loader passes a non-path value through
// untouched — so those items, and the sub portal snapshot built from them,
// showed a dead image forever. stagePunchPhoto (ProjectContext) heals the row
// on the item's NEXT edit; this covers every item that has not been edited
// since: when the item knows its source photo and carries no durable path of
// its own, borrow the source photo's current (freshly signed or local) uri and
// its storage path. Any later save then writes that durable path.
//
// Pure, so scripts/validate-photo-markup-join.ts executes it.
import { isDeviceLocalUri } from '@/utils/photoUploadCore';
import type { ProjectPhoto, PunchItem } from '@/types';

type PunchPhotoFields = Pick<PunchItem, 'photoUri' | 'photoStoragePath' | 'sourcePhotoId'>;
type SourcePhoto = Pick<ProjectPhoto, 'id' | 'uri' | 'storagePath'>;

/** One item: the source photo's live uri + path when the item's own photo is
 *  a non-durable remote URL. Returns the SAME object when nothing changes. */
export function withSourcePhotoUri<T extends PunchPhotoFields>(item: T, photosById: ReadonlyMap<string, SourcePhoto>): T {
  if (!item.photoUri || item.photoStoragePath || !item.sourcePhotoId) return item;
  // A file on this phone is always the best copy — it never expires.
  if (isDeviceLocalUri(item.photoUri)) return item;
  const source = photosById.get(item.sourcePhotoId);
  if (!source?.storagePath || !source.uri) return item;
  return { ...item, photoUri: source.uri, photoStoragePath: source.storagePath };
}

/** The whole list; returns the SAME array when no item changes, so a memo
 *  over it does not re-render every punch consumer on each photo update. */
export function withSourcePhotoUris<T extends PunchPhotoFields>(items: T[], photos: readonly SourcePhoto[]): T[] {
  if (!items.some(i => i.sourcePhotoId && !i.photoStoragePath)) return items;
  const byId = new Map(photos.map(p => [p.id, p] as const));
  let changed = false;
  const out = items.map(i => {
    const next = withSourcePhotoUri(i, byId);
    if (next !== i) changed = true;
    return next;
  });
  return changed ? out : items;
}
