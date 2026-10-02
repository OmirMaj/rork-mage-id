// utils/coProofPacketShare.ts — the change order proof packet, built and shared.
//
// The I/O half of the proof packet. utils/coProofPacket.ts (pure) decides what
// the packet says and utils/coProofPacketHtml.ts (pure) prints it; this file
// gathers the two things they cannot (the schedule audit log and freshly
// signed photo URLs), then hands the finished HTML to the share sheet (native)
// or a print window (web).
//
// READ-ONLY. Nothing here writes: no database, no device storage, no queue.
// Sharing a packet leaves no trace on the change order (founder default Q1).
//
// The CO document inside the packet is buildChangeOrderBodyHtml, the exact
// body the CO PDF prints, so the packet can never show a different amount,
// tax row or approval line than the CO PDF.
//
// Pinned by scripts/validate-co-proof-screen.ts.
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { ChangeOrder, CompanyBranding, Project } from '@/types';
import {
  buildCoProofPacket,
  coProofPacketFileTitle,
  type CoProofDecline,
  type CoProofInput,
  type CoProofPacket,
} from '@/utils/coProofPacket';
import { buildCoProofPacketHtml } from '@/utils/coProofPacketHtml';
import { buildChangeOrderBodyHtml } from '@/utils/pdfGenerator';
import { resolveDfrPhotosForDocument } from '@/utils/projectDocuments';
import { loadScheduleAudit } from '@/utils/scheduleAudit';
import { openPrintWindowAfterOrThrow } from '@/utils/platformFile';

export interface CoProofShareArgs {
  co: ChangeOrder;
  project: Project;
  branding: CompanyBranding;
  declineLine: CoProofDecline | null;
  sources: Pick<CoProofInput, 'photos' | 'photosLoaded' | 'dailyReports' | 'dailyReportsLoaded'
    | 'rfis' | 'portalMessages' | 'commEvents' | 'fieldTickets' | 'delayEvents'>;
}

/** Gathers, computes and renders the packet. Throws only if rendering does. */
export async function buildCoProofPacketDocument(
  args: CoProofShareArgs,
): Promise<{ html: string; title: string; packet: CoProofPacket }> {
  const { co, project, branding, declineLine, sources } = args;
  // loadScheduleAudit says it never throws; a throw anyway means "not read",
  // which the packet prints as such, never as an empty log.
  let scheduleAudit: CoProofInput['scheduleAudit'] = null;
  try {
    scheduleAudit = await loadScheduleAudit(project.id);
  } catch {
    scheduleAudit = null;
  }
  const generatedAt = new Date().toISOString();
  const packet = buildCoProofPacket({
    ...sources,
    co,
    project,
    scheduleAudit,
    declineLine,
    generatedAt,
  });
  // Same order and ids as packet.photos.items (the HTML layer pairs them up).
  // Signs storage paths fresh, embeds on native, never fetches incident photos.
  const photos = await resolveDfrPhotosForDocument(packet.photos.items, sources.photos);
  const html = buildCoProofPacketHtml(packet, {
    project,
    branding,
    coBodyHtml: buildChangeOrderBodyHtml(co, project, branding),
    photos,
  });
  const title = coProofPacketFileTitle(co.number, project.name);
  return { html, title, packet };
}

/**
 * Builds the packet and opens it for the user to keep or send.
 *  - web: opens the print tab INSIDE the tap (nothing is awaited before it),
 *    shows "Preparing the report…", then the packet and the print dialog.
 *  - native: renders a PDF and opens the share sheet, or the print dialog when
 *    sharing is unavailable.
 * Errors propagate; the caller shows them. A failed web build closes the tab.
 */
export async function shareCoProofPacket(args: CoProofShareArgs): Promise<'shared' | 'printed' | 'web_print'> {
  if (Platform.OS === 'web') {
    return openPrintWindowAfterOrThrow(async () => (await buildCoProofPacketDocument(args)).html)
      .then(() => 'web_print' as const);
  }
  const { html, title } = await buildCoProofPacketDocument(args);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: title,
      UTI: 'com.adobe.pdf',
    });
    return 'shared';
  }
  await Print.printAsync({ uri });
  return 'printed';
}
