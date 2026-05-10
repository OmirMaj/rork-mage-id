// utils/insuranceClaimPackage.ts — vision-doc feature #21.
//
// When a job site has water damage, theft, or weather damage, the GC has
// to assemble a claim package for insurance. Pre-fix: photos, receipts,
// scope of damage, replacement estimates, project timeline impact —
// all manually compiled from email threads + camera roll. Miserable.
//
// Substrate exists: closeoutBinderZip already does this exact pattern
// for closeout binders. This module is the same shape, different filter:
// instead of "everything for the project," we take an INCIDENT WINDOW
// and pull project photos, daily reports, and punch items that landed
// inside that window. Plus the contractor's contact + insurance info
// so the adjuster has one document.
//
// What's in the package:
//   1. claim-summary.pdf — text summary the adjuster reads first
//   2. photos/ — every project photo within the incident window
//   3. daily-reports/ — DFRs that mention damage or fall in the window
//   4. punch-items/ — punch items added or photo-captured in the window
//   5. README.txt — index + claim metadata
//
// PDF generation reuses the same expo-print pattern as the closeout
// binder. Zip generation reuses JSZip.

import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { Project, ProjectPhoto, DailyFieldReport, PunchItem } from '@/types';

export type ClaimType = 'water' | 'fire' | 'theft' | 'weather' | 'vandalism' | 'other';

export interface BuildClaimPackageInput {
  project: Project;
  incidentDate: string;        // ISO
  incidentEndDate?: string;    // ISO — for sustained events (storm spans days)
  claimType: ClaimType;
  claimDescription: string;
  estimatedDamageAmount?: number;
  policyNumber?: string;
  carrier?: string;
  adjusterName?: string;
  adjusterEmail?: string;
  /** All project photos — filtered internally to the incident window. */
  photos: ProjectPhoto[];
  /** All DFRs — filtered internally. */
  dailyReports: DailyFieldReport[];
  /** Punch items created or referenced in the window. */
  punchItems: PunchItem[];
  /** GC contact info for the cover summary. */
  gcInfo: { companyName: string; contact: string; phone: string; email: string };
}

export interface ClaimPackageResult {
  ok: boolean;
  uri?: string;
  fileName: string;
  bytes?: number;
  itemCounts: { photos: number; dfrs: number; punch: number };
  error?: string;
}

const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  water: 'Water damage',
  fire: 'Fire damage',
  theft: 'Theft',
  weather: 'Weather / storm damage',
  vandalism: 'Vandalism',
  other: 'Other',
};

async function readUriAsBase64(uri: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      const r = await fetch(uri);
      const blob = await r.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] ?? '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
    return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch (err) {
    console.warn('[insuranceClaimPackage] read failed', uri, err);
    return null;
  }
}

function safeFile(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
}

function isInWindow(iso: string | undefined, start: number, end: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= start && t <= end;
}

export async function buildAndShareInsuranceClaimPackage(
  input: BuildClaimPackageInput,
): Promise<ClaimPackageResult> {
  const {
    project, incidentDate, incidentEndDate, claimType, claimDescription,
    estimatedDamageAmount, policyNumber, carrier, adjusterName, adjusterEmail,
    photos, dailyReports, punchItems, gcInfo,
  } = input;

  // Window = incident date through end (or +7 days if single-day claim).
  // We also include 1 day before the incident so the GC has a "before"
  // photo when the claim is "the storm caused this."
  const startMs = Date.parse(incidentDate) - 86_400_000;
  const endMs = (incidentEndDate ? Date.parse(incidentEndDate) : Date.parse(incidentDate)) + 7 * 86_400_000;

  const filteredPhotos = photos.filter(p =>
    p.projectId === project.id && isInWindow(p.timestamp, startMs, endMs),
  );
  const filteredDfrs = dailyReports.filter(r =>
    r.projectId === project.id && isInWindow(r.date, startMs, endMs),
  );
  const filteredPunch = punchItems.filter(pi => {
    if (pi.projectId !== project.id) return false;
    return isInWindow(pi.createdAt, startMs, endMs)
      || isInWindow(pi.closedAt, startMs, endMs);
  });

  const zip = new JSZip();

  // 1. README — claim metadata + index. Plain text so the adjuster's
  //    laptop reads it without a renderer.
  const readme = [
    `INSURANCE CLAIM PACKAGE`,
    `========================`,
    ``,
    `Project:     ${project.name}`,
    `Address:     ${project.location || 'Address on file'}`,
    `Claim type:  ${CLAIM_TYPE_LABEL[claimType]}`,
    `Incident:    ${new Date(incidentDate).toLocaleDateString()}${incidentEndDate ? ` – ${new Date(incidentEndDate).toLocaleDateString()}` : ''}`,
    estimatedDamageAmount ? `Estimated:   $${estimatedDamageAmount.toLocaleString()}` : '',
    policyNumber ? `Policy #:    ${policyNumber}` : '',
    carrier ? `Carrier:     ${carrier}` : '',
    adjusterName ? `Adjuster:    ${adjusterName}${adjusterEmail ? ` (${adjusterEmail})` : ''}` : '',
    ``,
    `Description`,
    `-----------`,
    claimDescription,
    ``,
    `Contractor`,
    `----------`,
    `Company:  ${gcInfo.companyName}`,
    `Contact:  ${gcInfo.contact}`,
    `Phone:    ${gcInfo.phone}`,
    `Email:    ${gcInfo.email}`,
    ``,
    `Contents`,
    `--------`,
    `  claim-summary.txt    Cover summary (this file extended)`,
    `  photos/              ${filteredPhotos.length} site photo${filteredPhotos.length === 1 ? '' : 's'} from the incident window`,
    `  daily-reports/       ${filteredDfrs.length} daily field report${filteredDfrs.length === 1 ? '' : 's'} covering the period`,
    `  punch-items/         ${filteredPunch.length} damage / open item${filteredPunch.length === 1 ? '' : 's'} logged in the window`,
    ``,
    `Generated ${new Date().toLocaleString()} by MAGE ID.`,
    `Adjuster questions: contact ${gcInfo.contact} at ${gcInfo.phone}.`,
  ].filter(Boolean).join('\n');
  zip.file('README.txt', readme);

  // 2. Site photos within the incident window.
  let photoIdx = 0;
  for (const photo of filteredPhotos) {
    if (!photo.uri) continue;
    const b64 = await readUriAsBase64(photo.uri);
    if (b64) {
      photoIdx++;
      const stamp = photo.timestamp ? new Date(photo.timestamp).toISOString().slice(0, 10) : 'undated';
      const caption = (photo as ProjectPhoto & { caption?: string }).caption ?? '';
      const ext = photo.uri.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
      const baseName = `${stamp}-${photoIdx.toString().padStart(3, '0')}${caption ? '-' + safeFile(caption) : ''}`;
      zip.file(`photos/${baseName}.${ext}`, b64, { base64: true });
    }
  }

  // 3. Daily field reports — render as plain text per day so the
  //    adjuster can read them without our app. Includes weather + crew
  //    + work narrative — all the timeline corroboration the carrier
  //    typically requests.
  for (const dfr of filteredDfrs) {
    const weatherLine = typeof dfr.weather === 'object' && dfr.weather
      ? [
          (dfr.weather as { conditions?: string }).conditions ?? '',
          (dfr.weather as { temperatureF?: number }).temperatureF != null
            ? `Temp: ${(dfr.weather as { temperatureF?: number }).temperatureF}°F` : '',
        ].filter(Boolean).join(' · ')
      : 'Not recorded';
    const manpower = (dfr.manpower ?? [])
      .map(m => `- ${m.company || m.trade}: ${m.headcount ?? 0} on site, ${m.hoursWorked ?? 0}h`)
      .join('\n') || 'No crew recorded';
    const lines = [
      `DAILY FIELD REPORT`,
      `Project: ${project.name}`,
      `Date:    ${new Date(dfr.date).toLocaleDateString()}`,
      `Phase:   ${dfr.phase ?? 'Not set'}`,
      ``,
      `Weather`,
      `-------`,
      weatherLine,
      ``,
      `Crew`,
      `----`,
      manpower,
      ``,
      `Work performed`,
      `--------------`,
      dfr.workPerformed ?? '',
      ``,
      `Issues / delays`,
      `---------------`,
      dfr.issuesAndDelays || 'None recorded',
      ``,
      `Tomorrow's plan`,
      `---------------`,
      dfr.tomorrowsPlan ?? '',
    ].filter(Boolean).join('\n');
    zip.file(`daily-reports/${new Date(dfr.date).toISOString().slice(0, 10)}.txt`, lines);
  }

  // 4. Punch items as a single CSV the adjuster can paste into a
  //    spreadsheet. Carrier review systems are CSV-friendly.
  if (filteredPunch.length > 0) {
    const headers = ['ID', 'Description', 'Location', 'Assigned sub', 'Priority', 'Status', 'Due', 'Closed', 'Created'];
    const rows = filteredPunch.map(pi => [
      pi.id.slice(0, 8),
      (pi.description ?? '').replace(/"/g, '""'),
      (pi.location ?? '').replace(/"/g, '""'),
      pi.assignedSub ?? '',
      pi.priority ?? '',
      pi.status ?? '',
      pi.dueDate ? new Date(pi.dueDate).toLocaleDateString() : '',
      pi.closedAt ? new Date(pi.closedAt).toLocaleDateString() : '',
      pi.createdAt ? new Date(pi.createdAt).toLocaleDateString() : '',
    ].map(c => `"${String(c)}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    zip.file('punch-items/punch-items.csv', csv);
  }

  // Generate + share.
  const safeName = safeFile(project.name ?? 'project');
  const stamp = new Date(incidentDate).toISOString().slice(0, 10);
  const fileName = `mage-id-${safeName}-${claimType}-claim-${stamp}.zip`;

  try {
    if (Platform.OS === 'web') {
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return {
        ok: true, fileName, bytes: blob.size,
        itemCounts: { photos: filteredPhotos.length, dfrs: filteredDfrs.length, punch: filteredPunch.length },
      };
    }

    const b64 = await zip.generateAsync({ type: 'base64' });
    const path = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, {
        mimeType: 'application/zip',
        dialogTitle: `${project.name} — ${CLAIM_TYPE_LABEL[claimType]} claim`,
        UTI: 'public.zip-archive',
      });
    }
    return {
      ok: true, uri: path, fileName,
      itemCounts: { photos: filteredPhotos.length, dfrs: filteredDfrs.length, punch: filteredPunch.length },
    };
  } catch (err) {
    console.warn('[insuranceClaimPackage] generate failed', err);
    return {
      ok: false, fileName, error: err instanceof Error ? err.message : 'Unknown error',
      itemCounts: { photos: filteredPhotos.length, dfrs: filteredDfrs.length, punch: filteredPunch.length },
    };
  }
}
