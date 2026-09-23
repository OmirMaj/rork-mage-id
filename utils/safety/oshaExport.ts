// oshaExport.ts — RN glue for the OSHA-300 log. Imports the pure builders
// from oshaLog.ts and renders/share them. Kept separate from oshaLog.ts so
// the validator can run the pure module under bun without loading react-native.
import { Platform } from 'react-native';
import { openPrintWindowOrThrow } from '@/utils/platformFile';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import type { SafetyIncident } from '@/types';
import { buildOsha300Log, buildOsha300Html, osha300ToCsv, type OshaEstablishment, type Osha300ASummaryInput } from '@/utils/safety/oshaLog';

/** `summary` is the 300A page — passed only once the user has confirmed the
 *  hours and headcount on screen; without it the PDF carries the 300 and its
 *  column totals and nothing that depends on an unconfirmed denominator. */
export async function exportOsha300Pdf(incidents: SafetyIncident[], est: OshaEstablishment, summary?: Osha300ASummaryInput): Promise<void> {
  const rows = buildOsha300Log(incidents, est.year);
  const html = buildOsha300Html(rows, est, summary);
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    // CONTRACT 25 (#147): one print-window path for the whole app. It opens
    // synchronously (this runs inside the tap), writes the HTML, prints once
    // its images settle, and THROWS PRINT_WINDOW_BLOCKED_MESSAGE when the
    // browser blocks the window — the old blob-URL fallback was blocked just
    // the same and returned as if it had worked. The caller shows
    // pdfFailureMessage(err, …).
    openPrintWindowOrThrow(html);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'OSHA 300 Log', UTI: 'com.adobe.pdf' });
  else await Print.printAsync({ uri });
}

export async function shareOsha300Csv(incidents: SafetyIncident[], est: OshaEstablishment): Promise<void> {
  const rows = buildOsha300Log(incidents, est.year);
  const csv = osha300ToCsv(rows, est);
  const filename = `OSHA300_${est.year}.csv`;
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    return;
  }
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const uri = `${dir}${filename}`;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: 'utf8' });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: filename });
}
