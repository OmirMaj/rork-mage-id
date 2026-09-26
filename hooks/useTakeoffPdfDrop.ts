// hooks/useTakeoffPdfDrop.ts — list-3 lane TK-c. The I/O half of dropping a
// PDF plan set onto the desktop takeoff (the sheet rail or the first-run
// screen). It mirrors app/plans.tsx handleImportPdf step for step, so a drop
// is held to exactly the checks the Plans button applies:
//   seat/role block → re-import confirm → page count → quota confirm →
//   upload + render → ONE addPlanSheets call with the same field mapping.
// Pages are named the way Plans names them (pdfPageSheetName) — never an
// invented sheet number; numbering happens in Plans.
//
// Web only: a drop is a browser DOM event. On native it returns an inert
// object (the hooks above the early return still run, in the same order).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { onlineManager } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { useUsageStatus } from '@/hooks/useUsageStatus';
import { uploadAndRenderPdf, countPdfPages } from '@/utils/pdfRenderClient';
import { confirmQuotaFits } from '@/utils/quotaPrecheck';
import { pdfPageSheetName, priorImportOf } from '@/utils/planSheetBatchCore';
import { planControlBlock, effectivePlanRole } from '@/utils/plans/revisionActions';
import { showAlert } from '@/utils/alert';
import { pdfDropVerdict, pdfDropDoneLine, pdfDropSavingLine } from '@/utils/takeoff/pdfDrop';

export interface TakeoffPdfDrop {
  importing: boolean;
  status: string;
  /** Why this seat can't add sheets (the Plans sentence), or null. */
  blockReason: string | null;
  /** Resolves with the created sheet ids ([] when nothing was added). */
  importFile: (file: File) => Promise<string[]>;
}

const DONE_MS = 4000;

/** A settled null seat: he is not on this job's team (RLS would refuse the sheets). */
export const NO_SEAT_IMPORT = 'You\u2019re not on this job\u2019s team, so you can\u2019t add sheets to it \u2014 ask the project owner for an editor seat.';

const INERT: TakeoffPdfDrop = {
  importing: false,
  status: '',
  blockReason: null,
  importFile: async () => [],
};

export function useTakeoffPdfDrop(projectId: string | null | undefined): TakeoffPdfDrop {
  const pid = projectId ?? undefined;
  const router = useRouter();
  const { role } = useProjectAccess(pid);
  const roleState = useProjectRoleState(pid);
  const offline = useSyncExternalStore(onlineManager.subscribe, () => !onlineManager.isOnline(), () => false);
  const { user: authUser } = useAuth();
  const { refresh: refreshQuota } = useUsageStatus();
  const { getProject, getPlanSheetsForProject, addPlanSheets } = useProjects();
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState('');
  // The done line stays up for DONE_MS, then clears (the drop zones show it).
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);
  const settle = useCallback((line: string) => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setStatus(line);
    clearTimer.current = setTimeout(() => setStatus(''), DONE_MS);
  }, []);

  const project = pid ? getProject(pid) : null;
  // Same seat rule as Plans (app/plans.tsx seatRole / importBlock).
  const seatRole = effectivePlanRole(role, project, authUser?.id);
  // #90 (mirrors app/plans.tsx planScreenGate): a SETTLED null seat — the
  // read is not loading, not failed, not paused offline — is "not on this
  // job", never "Checking…" for good.
  const settledNoSeat = seatRole === null && !roleState.isLoading && !roleState.isError
    && !roleState.isPaused && !offline;
  const blockReason = settledNoSeat
    ? NO_SEAT_IMPORT
    : planControlBlock(seatRole, 'import', { isError: roleState.isError, offline: offline || roleState.isPaused });

  const importFile = useCallback(async (file: File): Promise<string[]> => {
    if (!pid) return [];
    if (blockReason) { showAlert('Can’t add sheets', blockReason); return []; }
    const verdict = pdfDropVerdict([{ name: file.name, type: file.type, size: file.size }]);
    if (!verdict.ok) { showAlert('Can’t add that file', verdict.reason); return []; }

    // Same file already imported? Rendering it again charges the month's
    // takeoff pages again — ask BEFORE the upload, with Plans' sentence.
    const baseName = file.name?.replace(/\.[^/.]+$/, '') || 'Plan set';
    const prior = priorImportOf(getPlanSheetsForProject(pid), pid, baseName);
    if (prior.length > 0) {
      const again = await new Promise<boolean>((resolve) => {
        showAlert(
          'Already imported',
          `“${baseName}” is already on this project (${prior.length} sheet${prior.length === 1 ? '' : 's'}). Importing it again uses takeoff pages again and replaces those sheets with the new copy. Pins stay on the old sheets.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Import again', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!again) return [];
    }

    // The browser owns the File; a blob: URL is what readFileBytes' web
    // branch fetches (utils/fileBytes.ts).
    const fileUri = URL.createObjectURL(file);
    try {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      setImporting(true);
      setStatus('Uploading PDF…');
      const pageCount = await countPdfPages(fileUri);
      if (pageCount != null) {
        const fits = await confirmQuotaFits(pageCount, file.name || 'PDF', router);
        if (!fits) { setStatus(''); return []; }
      }

      const pages = await uploadAndRenderPdf({ fileUri, fileName: file.name, projectId: pid });

      setStatus(pdfDropSavingLine(pages.length));
      // ONE call for the whole set, the same field mapping as Plans.
      const { created } = addPlanSheets(pages.map((p) => ({
        projectId: pid,
        name: pdfPageSheetName(baseName, pages.length, p.pageNumber),
        sheetNumber: undefined,
        userId: authUser?.id,
        storagePath: p.storagePath,
        imageUri: p.viewUrl,
        width: p.width,
        height: p.height,
        pageNumber: p.pageNumber,
      })), { matchUnnumberedByPage: true });

      refreshQuota();
      settle(created.length > 0 ? pdfDropDoneLine(created.length) : 'The PDF rendered no pages, so no sheets were added.');
      return created.map((s) => s.id);
    } catch (err) {
      const msg = (err as Error)?.message || 'Could not import that PDF.';
      setStatus('');
      showAlert('Import failed', msg);
      return [];
    } finally {
      URL.revokeObjectURL(fileUri);
      setImporting(false);
    }
  }, [pid, blockReason, getPlanSheetsForProject, addPlanSheets, router, refreshQuota, authUser?.id, settle]);

  if (Platform.OS !== 'web') return INERT;
  return { importing, status, blockReason, importFile };
}
