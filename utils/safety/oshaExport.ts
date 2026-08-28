// oshaExport.ts — RN glue for the OSHA-300 log. Imports the pure builders
// from oshaLog.ts and renders/share them. Kept separate from oshaLog.ts so
// the validator can run the pure module under bun without loading react-native.
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import type { SafetyIncident } from '@/types';
import { buildOsha300Log, buildOsha300Html, osha300ToCsv, type OshaEstablishment } from '@/utils/safety/oshaLog';

export async function exportOsha300Pdf(incidents: SafetyIncident[], est: OshaEstablishment): Promise<void> {
  const rows = buildOsha300Log(incidents, est.year);
  const html = buildOsha300Html(rows, est);
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
// NO 'noopener' in the feature string. Per the HTML spec, window.open()
    // returns NULL whenever noopener is present — in every browser — so `w` was
    // always null, the write-and-print path below was unreachable dead code, and
    // 100% of users silently took the branch commented "popup blocked": a tab
    // opens with the right content but the print dialog never appears, and
    // because it is a blob: URL the tab title is a UUID so "Save as PDF"
    // defaults to a garbage filename.
    //
    // Dropping noopener is safe here specifically: we open about:blank and write
    // our own HTML into it. It is same-origin by definition and there is no
    // third-party page to tabnab us.
    const w = window.open('', '_blank');
    if (!w) { const blob = new Blob([html], { type: 'text/html' }); window.open(URL.createObjectURL(blob), '_blank'); return; }
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* user can Cmd-P */ } }, 350);
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
