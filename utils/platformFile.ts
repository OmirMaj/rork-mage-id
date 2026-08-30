// platformFile.ts — read a file, or hand the user a file, on either platform.
//
// WHY THIS EXISTS. expo-file-system has no meaningful web implementation:
// `cacheDirectory` and `documentDirectory` are undefined, `writeAsStringAsync`
// has nowhere to write, and `readAsStringAsync` cannot read a `blob:` URL. The
// browser's equivalents are `fetch` + `FileReader` for reading and an anchor
// with a Blob URL for saving.
//
// Both patterns were already correct in this repo — utils/fileBytes.ts:33 for
// reading, utils/icsGenerator.ts:342 for downloading — and both were then
// re-implemented WITHOUT the web branch in four other places, each of which
// failed 100% of the time on web:
//   • app/cost-xray.tsx        — "Detect & price" died and blamed the user
//   • utils/dataExport.ts      — the GDPR/CCPA "Export my data" button
//   • utils/accountingExport.ts — QuickBooks / Xero invoice CSV
//   • utils/planCodeReviewer.ts — AI plan code review + Ask-Your-Plans indexing
//
// Four copies of a thing means three of them are wrong. This is the one copy.
//
// Pure-ish: no storage, no network beyond fetching the URI it was handed.

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Read any local URI to base64 — `file://` on native, `blob:` / `data:` on web.
 *
 * Web cannot use FileSystem at all, so it goes through fetch + FileReader.
 * FileReader yields `data:<mime>;base64,<payload>`; only the payload is
 * returned, matching what readAsStringAsync gives on native.
 */
export async function readAsBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web' || uri.startsWith('blob:') || uri.startsWith('data:')) {
    const blob = await (await fetch(uri)).blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Could not read the file.'));
      fr.onload = () => resolve(String(fr.result));
      fr.readAsDataURL(blob);
    });
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  }
  // String-literal 'base64', not the enum — expo-file-system moved EncodingType
  // into a legacy namespace and the string form stays accepted.
  return FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
}

/** True when a real filesystem exists to write into. False on web. */
export function hasFileSystem(): boolean {
  return Platform.OS !== 'web' && !!(FileSystem.cacheDirectory ?? FileSystem.documentDirectory);
}

/**
 * Put a generated text file in the user's hands.
 *
 * Native: writes into the cache directory and returns the URI, so the caller can
 * hand it to Sharing / Print as it always did.
 * Web: triggers a browser download and returns null — there is no URI to share,
 * and the file has already reached the user, which is the actual goal.
 *
 * Returning null rather than throwing matters: every caller of this on web was
 * previously either crashing or silently doing nothing, and a null return lets
 * the caller simply stop instead of reporting a failure that did not happen.
 */
export async function deliverTextFile(
  fileName: string,
  contents: string,
  mimeType = 'text/plain;charset=utf-8',
): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return null;
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on the next tick so the download has a chance to start.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return null;
  }

  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!dir) throw new Error('No writable directory available on this device.');
  const uri = `${dir}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, contents, { encoding: 'utf8' });
  return uri;
}


/**
 * Render HTML as a printable document the user can save as PDF.
 *
 * expo-print's ENTIRE web module is:
 *     async printToFileAsync() { window.print(); }
 * — it ignores the `html` prop, prints whatever is currently on screen, and
 * returns UNDEFINED. So `const { uri } = await Print.printToFileAsync({html})`
 * on web shows the user a print dialog of the app UI and then throws on the
 * destructure. utils/exportSchedulePdf.ts already worked around this correctly;
 * three other call sites did not.
 *
 * Web: opens a tab, writes the real HTML into it, and triggers print there — so
 * the user prints the DOCUMENT, and can Save as PDF. Returns null (there is no
 * file URI to hand to Sharing).
 * Native: returns the generated PDF's URI, exactly as before.
 *
 * Note the missing 'noopener': window.open() returns null whenever noopener is
 * in the feature string, which would make `w` null and the write unreachable.
 * Safe here because we open about:blank and write our own markup — same-origin
 * by definition, with no third-party page to tabnab us.
 */
export async function printHtmlDocument(html: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return null;
    const w = window.open('', '_blank');
    if (!w) {
      // Popup blocked — fall back to a Blob URL so the content is at least
      // reachable, even though the print dialog cannot be triggered for them.
      const blob = new Blob([html], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
      return null;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // The browser needs a tick to lay out, or Chrome prints a blank page.
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* user can Cmd-P */ } }, 350);
    return null;
  }
  const Print = await import('expo-print');
  const { uri } = await Print.printToFileAsync({ html });
  return uri;
}
