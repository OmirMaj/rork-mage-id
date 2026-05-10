// utils/closeoutBinderZip.ts — bundles the closeout binder PDF +
// every attached COI / permit / warranty / as-built into a single
// .zip the GC can hand the homeowner.
//
// Pre-fix `utils/closeoutBinderEngine.ts:shareCloseoutBinderPDF`
// generated ONE PDF (selections, warranties, sub contacts,
// maintenance schedule). PM audit said "real binders are 80-200
// pages of attachments — COIs, permits, plan markups, manuals."
// Now: zip everything.
//
// Why JSZip and not a native zip module:
//   - JSZip works in pure JS, no native code, no rebuild required.
//   - Bundle size: ~120KB minified — fine for our scale.
//   - Cross-platform — same code path on iOS / Android / web.
//   - The trade-off vs. react-native-zip-archive: JSZip can OOM on
//     >100MB binders (rare; typical residential is 20-40MB). When
//     a project hits that, the alternative is to upload each file
//     to Storage and stream them server-side.
//
// Files included:
//   1. binder.pdf — the existing single-PDF deliverable
//   2. coi/<sub-name>.pdf — each subcontractor's current COI
//   3. permits/<type>.pdf — each permit doc
//   4. warranties/<title>.pdf — manufacturer warranties uploaded
//      against the project
//   5. plans/as-built-<sheet-number>.png — final plan sheets
//   6. README.txt — index page + GC contact info

import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { Project, Warranty, PlanSheet, Permit, CertificateOfInsurance, Subcontractor } from '@/types';

export interface BuildBinderZipInput {
  project: Project;
  /** The binder PDF, already rendered. Pass either the local file
   *  URI from FileSystem.cacheDirectory or a base64 string. */
  binderPdf: { localUri?: string; base64?: string };
  warranties: Warranty[];
  permits: Permit[];
  cois: { coi: CertificateOfInsurance; sub: Subcontractor }[];
  planSheets: PlanSheet[];
  /** Free-text contractor info for the README header. */
  gcInfo: { companyName: string; contact: string; phone: string; email: string };
}

export interface BinderZipResult {
  ok: boolean;
  uri?: string;
  fileName: string;
  bytes?: number;
  error?: string;
}

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
    console.log('[closeoutBinderZip] read failed', uri, err);
    return null;
  }
}

function safeFile(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
}

export async function buildAndShareCloseoutBinderZip(input: BuildBinderZipInput): Promise<BinderZipResult> {
  const { project, binderPdf, warranties, permits, cois, planSheets, gcInfo } = input;
  const zip = new JSZip();

  // 1. Binder PDF — the always-present cover document.
  if (binderPdf.base64) {
    zip.file('binder.pdf', binderPdf.base64, { base64: true });
  } else if (binderPdf.localUri) {
    const b64 = await readUriAsBase64(binderPdf.localUri);
    if (b64) zip.file('binder.pdf', b64, { base64: true });
  }

  // 2. README index — what's in the zip + GC contact info. Plain text
  //    so any tool that opens the zip can read it (vs. a PDF that
  //    requires a renderer).
  const readme = [
    `MAGE ID — Closeout Binder for ${project.name}`,
    `Generated ${new Date().toLocaleDateString()}`,
    '',
    `Contractor: ${gcInfo.companyName}`,
    `Contact:    ${gcInfo.contact}`,
    `Phone:      ${gcInfo.phone}`,
    `Email:      ${gcInfo.email}`,
    '',
    'Contents:',
    '  binder.pdf            — Selections, warranties, sub contacts, maintenance',
    `  coi/                  — ${cois.length} certificate of insurance file${cois.length === 1 ? '' : 's'}`,
    `  permits/              — ${permits.length} permit document${permits.length === 1 ? '' : 's'}`,
    `  warranties/           — ${warranties.length} manufacturer warranty${warranties.length === 1 ? 'y' : 'ies'}`,
    `  plans/                — ${planSheets.length} as-built plan sheet${planSheets.length === 1 ? '' : 's'}`,
    '',
    'Save this archive to a permanent location. Reach out anytime if a warranty',
    'claim, system question, or maintenance reminder comes up.',
  ].join('\n');
  zip.file('README.txt', readme);

  // 3. COIs. Schema field is `fileUri` (verified types/index.ts:3021).
  for (const { coi, sub } of cois) {
    if (!coi.fileUri) continue;
    const b64 = await readUriAsBase64(coi.fileUri);
    if (b64) {
      const ext = coi.fileUri.toLowerCase().endsWith('.png') ? 'png' : 'pdf';
      zip.file(`coi/${safeFile(sub.companyName)}.${ext}`, b64, { base64: true });
    }
  }

  // 4. Permits. Schema field is `attachmentUri` (verified
  //    types/index.ts:3178).
  for (const permit of permits) {
    if (!permit.attachmentUri) continue;
    const b64 = await readUriAsBase64(permit.attachmentUri);
    if (b64) {
      zip.file(`permits/${safeFile(permit.type)}-${safeFile(permit.permitNumber ?? permit.id.slice(0, 8))}.pdf`, b64, { base64: true });
    }
  }

  // 5. Warranties. Schema field is `documentUri` and the human-
  //    readable label is `title` (verified types/index.ts:3243).
  for (const w of warranties) {
    if (!w.documentUri) continue;
    const b64 = await readUriAsBase64(w.documentUri);
    if (b64) {
      zip.file(`warranties/${safeFile(w.title ?? w.id.slice(0, 8))}.pdf`, b64, { base64: true });
    }
  }

  // 6. As-built plan sheets. PNG export from the existing plan
  //    upload pipeline. Skip superseded revisions — only the current
  //    one goes in the binder.
  const currentSheets = planSheets.filter(s => !s.superseded);
  for (const sheet of currentSheets) {
    if (!sheet.imageUri) continue;
    const b64 = await readUriAsBase64(sheet.imageUri);
    if (b64) {
      zip.file(`plans/${safeFile(sheet.sheetNumber ?? sheet.name)}.png`, b64, { base64: true });
    }
  }

  // Generate + share.
  const safeName = safeFile(project.name ?? 'project');
  const fileName = `mage-id-${safeName}-closeout.zip`;

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
      return { ok: true, fileName, bytes: blob.size };
    }

    const b64 = await zip.generateAsync({ type: 'base64' });
    const path = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, {
        mimeType: 'application/zip',
        dialogTitle: `${project.name} — Closeout binder`,
        UTI: 'public.zip-archive',
      });
    }
    return { ok: true, uri: path, fileName };
  } catch (err) {
    console.warn('[closeoutBinderZip] generate failed', err);
    return { ok: false, fileName, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
