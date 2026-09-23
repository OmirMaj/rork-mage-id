// What an RFI email actually attaches (app/rfi.tsx send).
//
// A plan-sheet attachment is stored as its bare durable key
// ('<projectUuid>/<id>-page-1.png', #93). A key is not a fetchable address:
// on web, emailService's fileUriToAttachment fetches it as a RELATIVE path,
// the SPA answers with its index.html, and the architect received that page
// attached as a ".png". So a drawing reaches the email only as a real http(s)
// URL — freshly signed for this send, or one the screen already holds signed
// (or a legacy public URL while the bucket is public). A drawing that could
// not be signed (offline, or the signing call failed) is left OUT and counted,
// so the email can say where to see it instead of attaching a broken file.

export type RfiSheetTileState = 'ready' | 'loading' | 'unavailable' | null;

export interface RfiAttachmentView {
  uri: string;
  /** null = not a plan sheet (a photo): its uri is sent as it is. */
  sheet: RfiSheetTileState;
}

export interface RfiEmailAttachments {
  uris: string[];
  /** Plan sheets that had no signed/public URL and were not attached. */
  droppedSheets: number;
}

const HTTP_URL = /^https?:\/\//i;

export function rfiEmailAttachments(
  durable: readonly string[],
  view: (uri: string, index: number) => RfiAttachmentView,
  minted: ReadonlyMap<string, string>,
): RfiEmailAttachments {
  const uris: string[] = [];
  let droppedSheets = 0;
  durable.forEach((u, index) => {
    const v = view(u, index);
    if (v.sheet === null) {
      uris.push(v.uri);
      return;
    }
    const signed = minted.get(u) ?? (v.sheet === 'ready' && HTTP_URL.test(v.uri) ? v.uri : undefined);
    if (signed && HTTP_URL.test(signed)) uris.push(signed);
    else droppedSheets += 1;
  });
  return { uris, droppedSheets };
}
