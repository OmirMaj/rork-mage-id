import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import type { ScheduleTask } from '@/types';
import { exportTasksToCsv, buildSharePayload, tryEncodeShareToken } from '@/utils/scheduleOps';

export async function generateScheduleReportPdf(html: string, title: string): Promise<void> {
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
  if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
  else await Print.printAsync({ uri });
}

export async function shareScheduleCsv(tasks: ScheduleTask[], projectStartDate: Date, projectName: string): Promise<void> {
  const csv = exportTasksToCsv(tasks, projectStartDate);
  const filename = `${projectName.replace(/[^\w]+/g, '_')}_schedule.csv`;
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

export function buildScheduleShareUrl(projectName: string, projectStartDate: Date, tasks: ScheduleTask[]): string | null {
  const payload = buildSharePayload(projectName, projectStartDate, tasks); // no opts → v1 token (decodable)
  const res = tryEncodeShareToken(payload);
  if (res.kind !== 'inline') return null;
  // Public web-app host (app.mageid.app serves the Expo /shared-schedule route).
  // This is the reachable host — distinct from the Expo Router `origin` pin in
  // app.json, which is only a deep-link resolution hint, not fetched at runtime.
  return `https://app.mageid.app/shared-schedule?t=${encodeURIComponent(res.token)}`;
}
