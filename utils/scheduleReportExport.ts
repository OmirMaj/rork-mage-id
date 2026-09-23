import { Platform } from 'react-native';
import { openPrintWindowOrThrow } from '@/utils/platformFile';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import type { ScheduleTask } from '@/types';
import { exportTasksToCsv, buildSharePayload, tryEncodeShareToken } from '@/utils/scheduleOps';
import { buildShareUrl } from '@/utils/webAppOrigin';

export async function generateScheduleReportPdf(html: string, title: string): Promise<void> {
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
  if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
  else await Print.printAsync({ uri });
}

export async function shareScheduleCsv(
  tasks: ScheduleTask[],
  projectStartDate: Date,
  projectName: string,
  // Optional so existing callers keep compiling, but a caller that HAS the
  // schedule must pass it: exportTasksToCsv defaults to a 5-day week, and a
  // 6- or 7-day project would otherwise export dates that skip weekends it
  // actually works.
  calendar?: { workingDaysPerWeek?: number; nonWorkingDates?: string[] },
): Promise<void> {
  const csv = exportTasksToCsv(
    tasks, projectStartDate, calendar?.workingDaysPerWeek, calendar?.nonWorkingDates,
  );
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

export function buildScheduleShareUrl(
  projectName: string,
  projectStartDate: Date,
  tasks: ScheduleTask[],
  // The project calendar TRAVELS WITH THE LINK. Without it the payload carries
  // no workingDaysPerWeek/nonWorkingDates, `cpmOptionsFromSharePayload` falls
  // back to 5 and the recipient of a 6- or 7-day project's link is shown dates
  // the sender never planned. The old call passed no opts at all, with a
  // comment claiming that was needed to get a "decodable" v1 token — a
  // workaround for `decodeShareToken` rejecting everything that was not v1,
  // which is fixed: v1-v4 all decode now.
  calendar?: { workingDaysPerWeek?: number; nonWorkingDates?: string[] },
): string | null {
  const payload = buildSharePayload(projectName, projectStartDate, tasks, {
    workingDaysPerWeek: calendar?.workingDaysPerWeek,
    nonWorkingDates: calendar?.nonWorkingDates,
  });
  const res = tryEncodeShareToken(payload);
  if (res.kind !== 'inline') return null;
  // Public web-app host (app.mageid.app serves the Expo /shared-schedule route).
  // This is the reachable host — distinct from the Expo Router `origin` pin in
  // app.json, which is only a deep-link resolution hint, not fetched at runtime.
  // Routed through buildShareUrl so the host lives in exactly one place: this
  // call site was RIGHT while three others were wrong, and the fix was to give
  // them all one source rather than to copy this line a fourth time.
  return buildShareUrl('shared-schedule', res.token);
}
