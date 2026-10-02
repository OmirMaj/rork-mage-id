// components/changeOrders/COProofPacketButton.tsx — "Proof packet" on a saved
// change order, beside "Share PDF".
//
// One tap gathers this job's records already on the device, builds the proof
// packet (utils/coProofPacketShare.ts) and opens the share sheet (iPhone) or a
// print tab the user saves as PDF (web). It writes nothing, so it shows no
// success: the share sheet or the print tab IS the result. A failure says so.
//
// The tap must reach shareCoProofPacket before anything is awaited: on web the
// print tab has to open inside the tap or the browser blocks it.
//
// The row's existing reason line (change-order.tsx, pdfReason) already says
// why both buttons wait (number pending) and what they print (last saved), so
// this button adds no second reason line.
//
// Pinned by scripts/validate-co-proof-screen.ts.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react-native';
import type { ChangeOrder, CompanyBranding, Project } from '@/types';
import { Button } from '@/components/ui/Button';
import { useProjects } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { coProofPacketAction, type CoProofDecline } from '@/utils/coProofPacket';
import { shareCoProofPacket } from '@/utils/coProofPacketShare';
import { pdfFailureMessage } from '@/utils/platformFile';
import { showAlert } from '@/utils/alert';

/** The same fallback the CO screen's Share PDF prints with when no branding is set. */
const FALLBACK_BRANDING: CompanyBranding = {
  companyName: 'MAGE ID', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '',
};

export interface COProofPacketButtonProps {
  co: ChangeOrder;
  project: Project;
  dirty: boolean;
  numberHold: string | null;
  declineLine: CoProofDecline | null;
}

export default function COProofPacketButton({ co, project, dirty, numberHold, declineLine }: COProofPacketButtonProps) {
  const { t } = useT();
  const { colors: themeColors } = useTheme();
  const {
    settings,
    getPhotosForProject, photosLoaded,
    getDailyReportsForProject, dailyReportsLoaded,
    getRFIsForProject,
    getPortalMessagesForProject,
    getCommEventsForProject,
    getFieldTicketsForProject,
    getDelayEventsForProject,
  } = useProjects();

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const action = coProofPacketAction({ saved: true, dirty, numberHold, busy });
  const branding = useMemo(() => settings.branding ?? FALLBACK_BRANDING, [settings.branding]);

  const onPress = useCallback(() => {
    if (busyRef.current || numberHold) return;
    busyRef.current = true;
    // First call after the guard, nothing awaited before it (web print tab).
    // A section whose records have not loaded still builds; the packet prints
    // it as "not checked".
    const projectId = co.projectId;
    const run = shareCoProofPacket({
      co,
      project,
      branding,
      declineLine,
      sources: {
        photos: getPhotosForProject(projectId),
        photosLoaded,
        dailyReports: getDailyReportsForProject(projectId),
        dailyReportsLoaded,
        rfis: getRFIsForProject(projectId),
        portalMessages: getPortalMessagesForProject(projectId),
        commEvents: getCommEventsForProject(projectId),
        fieldTickets: getFieldTicketsForProject(projectId),
        delayEvents: getDelayEventsForProject(projectId),
      },
    });
    setBusy(true);
    run
      .catch((err: unknown) => {
        showAlert(
          t('money.coProof.failTitle', 'Could not make the packet'),
          pdfFailureMessage(err, t('money.coProof.failBody', "Couldn't build the proof packet. Try again.")),
        );
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  }, [
    co, project, branding, declineLine, numberHold, t,
    getPhotosForProject, photosLoaded, getDailyReportsForProject, dailyReportsLoaded,
    getRFIsForProject, getPortalMessagesForProject, getCommEventsForProject,
    getFieldTicketsForProject, getDelayEventsForProject,
  ]);

  return (
    <Button
      label={busy ? t('money.coProof.busy', 'Building the packet…') : t('money.coProof.button', 'Proof packet')}
      variant="secondary"
      size="sm"
      loading={busy}
      disabled={!action.enabled}
      onPress={onPress}
      iconLeft={<FileText size={14} color={themeColors.text} strokeWidth={1.75} />}
      testID="co-proof-packet"
    />
  );
}
